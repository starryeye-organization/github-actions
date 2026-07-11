# PR 기반 CI/CD와 AWS EKS 배포

이 실습은 `dev` branch를 대상으로 하는 Pull Request의 상태에 따라 CI와 CD를 나누어 실행한다.

- PR이 open 되거나 새 commit이 추가(synchronize)되면 React 애플리케이션을 테스트하고 build한다.
- PR이 merge되면(closed) Docker image를 만들고 AWS ECR에 push한다.
- ECR에 저장한 image를 Helm으로 AWS EKS에 배포한다.
- 배포 결과를 Slack으로 전송한다.

이 workflow에서 job의 역할은 다음과 같이 구분된다.

| 구분 | Job | 역할 |
| --- | --- | --- |
| CI | `test` | dependency 설치, application test, production build 검증 |
| CD | `image-build` | Docker image 생성 및 AWS ECR push |
| CD | `deploy` | Helm을 이용한 AWS EKS 배포 및 Slack 알림 |

```text
PR opened / synchronize
    -> test job (CI)
    -> npm dependency 설치
    -> application test 실행
    -> React build 검증

PR closed + merged
    -> image-build job (CD)
    -> Docker image 생성
    -> AWS ECR push
    -> deploy job (CD)
    -> Helm으로 AWS EKS 배포
    -> Slack 결과 알림
```

## 사전 준비

### Repository Variables

Repository의 `Settings > Secrets and variables > Actions > Variables`에 다음 값을 등록한다.

| 이름 | 예시 | 설명 |
| --- | --- | --- |
| `AWS_REGION` | `ap-northeast-2` | ECR과 EKS가 위치한 AWS region이다. |
| `REPOSITORY` | `my-app-dev` | Docker image를 저장할 ECR repository 이름이다. |
| `CLUSTER_NAME` | `my-cluster` | 배포 대상 EKS cluster 이름이다. |
| `SUFFIX` | `dev` | Kubernetes namespace를 `my-app-dev`처럼 구분하기 위한 접미사이다. |

### Repository Secrets

Repository의 `Settings > Secrets and variables > Actions > Secrets`에 다음 값을 등록한다.

| 이름 | 예시 | 설명 |
| --- | --- | --- |
| `AWS_ROLE_TO_ASSUME` | `arn:aws:iam::123456789012:role/github-actions-role` | GitHub Actions가 OIDC로 임시 AWS 권한을 얻을 때 사용할 IAM Role ARN이다. |
| `REGISTRY` | `123456789012.dkr.ecr.ap-northeast-2.amazonaws.com` | Docker image를 push할 ECR registry 주소이다. |
| `SLACK_WEBHOOK_URL` | Slack Incoming Webhook URL | 배포 결과를 보낼 Slack webhook 주소이다. |

`AWS_ROLE_TO_ASSUME`과 `REGISTRY`는 값 자체가 반드시 비밀인 것은 아니지만 이 예제에서는 제공된 구성에 맞춰 Secret으로 관리한다.

AWS에서는 다음 준비도 필요하다.

- GitHub의 OIDC Provider인 `token.actions.githubusercontent.com`을 IAM에 등록한다.
- `AWS_ROLE_TO_ASSUME` Role의 trust policy에서 이 repository의 GitHub OIDC 요청을 허용한다.
- Role에 ECR image push, EKS cluster 조회 및 배포에 필요한 최소 권한을 부여한다.
- EKS에서도 해당 Role이 Kubernetes resource를 변경할 수 있도록 EKS Access Entry 또는 접근 권한을 설정한다.
- `REPOSITORY`와 같은 이름의 ECR repository를 미리 생성한다.

## Workflow 이름과 Trigger

```yaml
name: cicd-1-pr-to-eks
```

- `name`은 GitHub repository의 Actions 화면에 표시할 workflow 이름이다.
- `cicd-1-pr-to-eks`라는 이름으로 첫 번째 CI/CD 실습이며 PR을 기준으로 EKS까지 배포한다는 의미를 나타낸다.

```yaml
on:
  pull_request:
    types: [opened, synchronize, closed]
    branches: [dev]
    paths:
      - 'my-app/**'
```

- `on`은 workflow를 시작할 event를 정의한다.
- `pull_request`는 Pull Request 관련 event가 발생했을 때 workflow를 실행한다.
- `types`는 Pull Request event 중 사용할 action만 선택한다.
- `opened`는 새로운 PR이 생성된 순간을 의미한다.
- `synchronize`는 열린 PR의 source branch에 새로운 commit이 push된 순간을 의미한다.
- `closed`는 PR이 merge되거나 merge 없이 닫힌 순간을 의미한다.
- `branches: [dev]`는 PR의 source branch가 아니라 **병합 대상 base branch**가 `dev`인 경우만 허용하는 branch filter이다.
- `paths`는 PR에서 변경된 파일을 기준으로 동작하는 path filter이다.
- `'my-app/**'`는 `my-app` 디렉토리와 모든 하위 파일의 변경을 의미한다.

`closed`는 단순히 PR을 닫은 경우도 포함한다. 실제 image build 여부는 뒤의 `github.event.pull_request.merged == true` 조건에서 다시 구분한다.

현재 path filter는 애플리케이션 코드 변경을 기준으로 만든 예제이다. `Dockerfile`이나 `kubernetes/**`만 변경한 PR에서도 workflow를 실행하려면 다음 경로를 `paths`에 추가해야 한다.

```yaml
paths:
  - 'my-app/**'
  - 'Dockerfile'
  - 'kubernetes/**'
```

## test job - CI

```yaml
jobs:
  test:
    if: github.event.action == 'opened' || github.event.action == 'synchronize'
    runs-on: ubuntu-latest
```

- `jobs`는 workflow에서 실행할 job 목록이다.
- `test`는 CI를 담당하는 job의 식별자이다.
- `if`는 PR action이 `opened` 또는 `synchronize`일 때만 `test` job을 실행한다.
- `||`는 두 조건 중 하나만 참이어도 전체 조건이 참이 되는 OR 연산자이다.
- `runs-on: ubuntu-latest`는 GitHub가 제공하는 최신 Ubuntu runner에서 job을 실행한다.

```yaml
steps:
  - name: checkout the code
    uses: actions/checkout@v4
```

- `steps`는 `test` job에서 순서대로 실행할 작업 목록이다.
- `name`은 Actions 실행 화면에 표시되는 step 이름이다.
- `uses`는 직접 shell 명령을 작성하는 대신 기존 Action을 재사용한다.
- `actions/checkout@v4`는 repository 코드를 runner의 workspace로 내려받는다.

```yaml
- name: setup-node
  uses: actions/setup-node@v3
  with:
    node-version: 18
```

- `actions/setup-node@v3`는 runner에 Node.js 실행 환경을 준비한다.
- `with`는 Action에 전달할 입력값을 정의한다.
- `node-version: 18`은 Node.js 18 버전을 사용한다는 뜻이다.

```yaml
- name: Cache Node.js modules
  uses: actions/cache@v3
  with:
    path: ~/.npm
    key: ${{ runner.os }}-node-${{ hashFiles('**/package-lock.json') }}
    restore-keys: |
      ${{ runner.os }}-node-
```

- `actions/cache@v3`는 workflow 실행 사이에 파일을 cache로 저장하고 복원한다.
- `path: ~/.npm`은 npm이 다운로드한 package cache 디렉토리를 저장한다.
- `runner.os`는 현재 runner 운영체제 이름이며 운영체제별 cache를 구분한다.
- `hashFiles('**/package-lock.json')`는 `package-lock.json` 내용으로 hash를 만든다.
- lock file이 변경되면 hash와 cache key도 변경되어 새로운 dependency cache를 만든다.
- `restore-keys`는 정확히 일치하는 key가 없을 때 같은 OS의 이전 npm cache를 찾는 fallback prefix이다.
- `|`는 여러 줄 문자열을 작성하는 YAML 문법이다.

```yaml
- name: Install dependencies
  run: |
    cd my-app
    npm ci
```

- `run`은 runner의 shell에서 직접 명령을 실행한다.
- `cd my-app`은 React 프로젝트 디렉토리로 이동한다.
- `npm ci`는 `package-lock.json`에 기록된 정확한 버전으로 dependency를 깨끗하게 설치한다.

```yaml
- name: npm test
  run: |
    cd my-app
    npm test -- --watchAll=false
  env:
    CI: 'true'
```

- 이 step은 애플리케이션 코드가 기대한 대로 동작하는지 자동으로 검사하는 CI의 핵심 단계이다.
- `npm test`는 `package.json`의 `react-scripts test` script를 실행한다.
- 현재는 `my-app/src/App.test.js`의 테스트가 실행된다.
- 테스트는 `App` component를 가상 DOM에 render한 뒤 `Learn GithubAction cicd` 문구가 화면에 존재하는지 검사한다.
- `--watchAll=false`는 파일 변경을 계속 기다리지 않고 테스트를 한 번 실행한 뒤 종료하게 한다.
- `env`는 이 step에서 사용할 환경변수를 정의한다.
- `CI: 'true'`는 Create React App test runner를 CI 환경으로 실행하여 대화형 watch mode를 사용하지 않게 한다.
- 테스트 assertion이 하나라도 실패하면 명령이 0이 아닌 종료 코드를 반환하고 `test` job도 실패한다.
- test가 실패하면 다음 `npm build` step은 실행되지 않으므로 문제가 있는 코드는 build 검증 단계로 진행하지 않는다.

```yaml
- name: npm build
  run: |
    cd my-app
    npm run build
```

- 각 step은 별도의 shell process에서 실행되므로 이전 step의 `cd my-app` 상태가 유지되지 않는다.
- 따라서 build step에서도 다시 `cd my-app`을 실행한다.
- `npm run build`는 `package.json`의 build script를 실행하여 production build가 가능한지 검증한다.

## image-build job - CD

```yaml
image-build:
  if: github.event.pull_request.merged == true
  runs-on: ubuntu-latest
  permissions:
    id-token: write
    contents: read
```

- `image-build`는 PR merge 후 Docker image를 생성하고 ECR에 저장하는 job이다.
- `github.event.pull_request.merged`는 닫힌 PR이 실제로 merge되었는지를 나타내는 boolean 값이다.
- 값이 `true`일 때만 job을 실행하므로 merge 없이 닫은 PR에서는 실행하지 않는다.
- `permissions`는 이 job의 `GITHUB_TOKEN` 권한 범위를 정의한다.
- `id-token: write`는 GitHub OIDC token을 발급받아 AWS IAM Role을 Assume하기 위해 필요하다.
- `contents: read`는 checkout Action이 repository 내용을 읽는 데 필요한 최소 권한이다.

```yaml
- name: Configure AWS Credentials
  id: credentials
  uses: aws-actions/configure-aws-credentials@v4
  with:
    aws-region: ${{ vars.AWS_REGION }}
    role-to-assume: ${{ secrets.AWS_ROLE_TO_ASSUME }}
```

- `id: credentials`는 이 step을 다른 expression에서 참조할 수 있는 식별자이다.
- `aws-actions/configure-aws-credentials@v4`는 GitHub OIDC token으로 지정한 IAM Role을 Assume한다.
- Action이 발급받은 임시 AWS credential을 이후 step의 환경에 설정한다.
- `vars.AWS_REGION`은 repository variable에서 AWS region을 가져온다.
- `secrets.AWS_ROLE_TO_ASSUME`은 repository secret에서 IAM Role ARN을 가져온다.
- access key를 장기간 Secret에 저장하지 않고 workflow 실행 중에만 유효한 임시 credential을 사용하는 방식이다.

```yaml
- name: Login to Amazon ECR
  id: login-ecr
  uses: aws-actions/amazon-ecr-login@v2
  with:
    mask-password: 'true'
```

- `aws-actions/amazon-ecr-login@v2`는 앞에서 얻은 AWS credential로 ECR 인증 token을 발급받고 Docker login을 수행한다.
- 이후 `docker push`가 ECR registry에 접근할 수 있다.
- `id: login-ecr`은 이 step의 output을 참조할 때 사용할 식별자이다. 현재 예제에서는 output을 직접 사용하지 않지만 이후 확장을 위해 유지한다.
- `mask-password: 'true'`는 ECR login password가 Actions log에 노출되지 않도록 가린다.

```yaml
- name: docker build & push
  run: |
    docker build -f Dockerfile --tag ${{ secrets.REGISTRY }}/${{ vars.REPOSITORY }}:${{ github.sha }} .
    docker push ${{ secrets.REGISTRY }}/${{ vars.REPOSITORY }}:${{ github.sha }}
```

- `docker build`는 Dockerfile을 읽어 container image를 생성한다.
- `-f Dockerfile`은 repository root의 `Dockerfile`을 사용한다.
- `--tag`는 image에 `<registry>/<repository>:<tag>` 형식의 이름을 붙인다.
- `secrets.REGISTRY`는 AWS 계정의 ECR registry 주소이다.
- `vars.REPOSITORY`는 ECR repository 이름이다.
- `github.sha`는 workflow가 실행된 commit SHA이며 image version을 commit과 연결하는 고유 tag로 사용한다.
- 마지막 `.`은 Docker build context이다. 현재 repository root 전체가 Docker daemon에 전달된다.
- 이 프로젝트의 Dockerfile은 build context 안의 `my-app/package*.json`과 `my-app/`을 image 내부로 복사한다.
- `docker push`는 방금 만든 image를 같은 이름과 tag로 ECR에 업로드한다.

## deploy job - CD

```yaml
deploy:
  runs-on: ubuntu-latest
  needs: [image-build]
  permissions:
    id-token: write
    contents: read
```

- `deploy`는 ECR에 저장된 image를 EKS에 배포하는 job이다.
- `needs: [image-build]`는 `image-build` job이 성공한 후에만 `deploy` job을 실행하도록 순서를 만든다.
- PR이 열리거나 merge 없이 닫혀 `image-build`가 skip되면 `deploy`도 함께 skip된다.
- job마다 서로 다른 새 runner에서 실행되므로 AWS credential과 checkout 결과를 공유하지 않는다.
- 따라서 `deploy`에서도 checkout과 AWS credential 설정을 다시 수행한다.
- `id-token: write`와 `contents: read`의 역할은 `image-build` job과 같다.

```yaml
- name: setup kubectl
  uses: azure/setup-kubectl@v3
  with:
    version: latest
```

- `kubectl`은 Kubernetes cluster의 resource를 조회하고 변경하는 CLI 도구이다.
- `azure/setup-kubectl@v3`는 runner에 kubectl을 설치한다.
- `version: latest`는 Action이 제공하는 최신 kubectl 버전을 사용한다.

```yaml
- name: setup helm
  uses: azure/setup-helm@v3
  with:
    version: v3.11.1
```

- `Helm`은 Kubernetes resource 여러 개를 하나의 package처럼 관리하는 도구이다.
- `azure/setup-helm@v3`는 runner에 Helm CLI를 설치한다.
- `version: v3.11.1`은 실행마다 같은 Helm 동작을 사용하도록 Helm 버전을 고정한다.
- 여기서 Action 자체의 버전은 `@v3`이고, 설치할 Helm CLI 버전은 `v3.11.1`이다.

```yaml
- name: access kubernetes
  run: |
    aws eks update-kubeconfig --name ${{ vars.CLUSTER_NAME }}
```

- `aws eks update-kubeconfig`는 지정한 EKS cluster 접속 정보를 runner의 kubeconfig에 추가한다.
- `--name`은 접속할 EKS cluster 이름이며 `vars.CLUSTER_NAME` 값을 사용한다.
- 앞에서 설정한 AWS region과 임시 credential을 사용해 cluster 정보를 조회한다.
- 이 명령 이후 kubectl과 Helm은 kubeconfig의 현재 context를 통해 해당 EKS cluster에 요청을 보낸다.

## Helm 배포 상세 설명

Helm에서 알아야 할 핵심 용어는 다음과 같다.

- **Chart**: Kubernetes manifest template과 기본 설정을 묶은 배포 package이다. 이 프로젝트에서는 `kubernetes/my-app` 디렉토리가 chart이다.
- **Release**: Chart를 실제 cluster에 설치한 하나의 실행 단위이다. 같은 chart라도 release 이름과 namespace를 다르게 하여 여러 번 설치할 수 있다.
- **Template**: values를 받아 최종 Kubernetes YAML을 생성하는 파일이다. 이 프로젝트에서는 `templates/deployment.yaml`과 `templates/service.yaml`이 해당한다.
- **Values**: Template에 전달할 설정값이다. `values.yaml`에 기본값을 작성하고 `--set`이나 별도 values file로 덮어쓸 수 있다.
- **Revision**: 같은 release가 upgrade될 때마다 Helm이 기록하는 변경 버전이다. 이 기록을 이용해 이전 revision으로 rollback할 수 있다.

```yaml
- name: deploy
  id: status
  run: |
    helm upgrade --install my-app kubernetes/my-app --create-namespace --namespace my-app-${{ vars.SUFFIX }} \
      --set image.tag=${{ github.sha }} \
      --set image.repository=${{ secrets.REGISTRY }}/${{ vars.REPOSITORY }}
```

- `id: status`는 Slack step에서 `steps.status.outcome`으로 이 배포 step의 결과를 참조하기 위한 식별자이다.
- `helm upgrade`는 기존 Helm release를 새로운 chart와 values로 갱신한다.
- `--install`은 release가 아직 없으면 upgrade 대신 최초 설치를 수행한다.
- 두 옵션을 함께 사용하면 최초 배포와 이후 배포에 같은 명령을 사용할 수 있다.
- 첫 번째 `my-app`은 **Helm release 이름**이다.
- `kubernetes/my-app`은 **Helm chart 디렉토리 경로**이다.
- `--create-namespace`는 최초 설치 시 대상 namespace가 없으면 새로 생성한다.
- `--namespace my-app-${{ vars.SUFFIX }}`는 release와 Kubernetes resource를 배치할 namespace를 지정한다.
- `SUFFIX`가 `dev`이면 실제 namespace는 `my-app-dev`가 된다.
- 줄 끝의 `\`는 하나의 긴 shell 명령을 다음 줄에 이어서 작성한다는 뜻이다.
- `--set image.tag=${{ github.sha }}`는 chart의 `values.yaml`에 있는 `image.tag` 기본값을 현재 commit SHA로 덮어쓴다.
- `--set image.repository=...`는 `image.repository` 기본값을 실제 ECR image 경로로 덮어쓴다.

이 값은 `kubernetes/my-app/templates/deployment.yaml`의 다음 template에 전달된다.

```yaml
image: {{ .Values.image.repository }}:{{ .Values.image.tag }}
```

Helm이 최종 manifest를 만들 때 값은 다음과 같이 결합된다.

```text
.Values.image.repository = 123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/my-app-dev
.Values.image.tag        = abc123...

최종 container image
= 123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/my-app-dev:abc123...
```

Helm은 완성된 Deployment와 Service manifest를 Kubernetes API에 전달한다.

- Deployment는 위 ECR image로 React container 두 개를 실행한다.
- container는 `3000` port를 사용한다.
- Service는 `80` port로 받은 요청을 container의 `3000` port로 전달한다.
- Service type이 `LoadBalancer`이므로 AWS에서 외부 접근용 load balancer 생성을 요청한다.

결과적으로 새 commit SHA image가 배포될 때 기존 release를 삭제하고 다시 만드는 것이 아니라 Helm이 변경된 image tag를 반영해 Deployment를 갱신한다.

## Slack 알림

```yaml
- name: notify
  if: always()
  uses: slackapi/slack-github-action@v1.24.0
```

- `notify`는 배포 결과를 Slack으로 전송하는 step이다.
- `if: always()`는 앞의 배포 step이 성공하거나 실패해도 이 step을 실행한다.
- `slackapi/slack-github-action@v1.24.0`은 Slack Incoming Webhook 호출을 대신 수행하는 외부 Action이다.

```yaml
with:
  payload: |
    {
      "text": "message",
      "blocks": [
        {
          "type": "section",
          "text": {
            "type": "mrkdwn",
            "text": "Environment : dev, Deploy Result : ${{ steps.status.outcome }}, Repository : ${{ github.repository }}."
          }
        }
      ]
    }
```

- `with`는 Slack Action에 전달할 입력값을 정의한다.
- `payload`는 Slack API로 보낼 JSON 문자열이다.
- 최상위 `text`는 알림 fallback 문구로 사용될 수 있다.
- `blocks`는 Slack Block Kit 형식으로 메시지 화면을 구성한다.
- `type: section`은 일반 본문 영역을 만든다.
- 내부 `type: mrkdwn`은 Slack의 Markdown 형식으로 text를 표시한다.
- `steps.status.outcome`은 `id: status`를 가진 Helm 배포 step의 결과인 `success`, `failure`, `cancelled`, `skipped` 등을 가져온다.
- `github.repository`는 `organization/repository` 형식의 현재 repository 이름이다.
- `payload: |` 아래는 JSON 문자열이므로 내부 줄에 `#` YAML 주석을 넣으면 JSON 형식이 깨질 수 있다.

```yaml
env:
  SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
  SLACK_WEBHOOK_TYPE: INCOMING_WEBHOOK
```

- `env`는 Slack Action이 사용할 환경변수를 설정한다.
- `SLACK_WEBHOOK_URL`은 repository secret에 저장한 Incoming Webhook URL이다.
- `SLACK_WEBHOOK_TYPE: INCOMING_WEBHOOK`은 Slack Action이 Incoming Webhook 방식으로 메시지를 보내도록 지정한다.

배포 이전의 checkout, AWS 인증, 도구 설치 단계에서 실패하면 `deploy` step 자체가 `skipped`되어 `steps.status.outcome`이 비어 보일 수 있다. 모든 실패 지점을 하나의 상태로 표시하려면 Slack 메시지에서 `${{ job.status }}`를 사용하는 방법도 고려할 수 있다.

## Event별 실행 결과

| PR 상태 | `test` | `image-build` | `deploy` |
| --- | --- | --- | --- |
| `dev` 대상 PR 생성 | 실행 | 건너뜀 | 건너뜀 |
| 열린 PR에 commit 추가 | 실행 | 건너뜀 | 건너뜀 |
| PR merge 없이 닫기 | 건너뜀 | 건너뜀 | 건너뜀 |
| PR merge | 건너뜀 | 실행 | `image-build` 성공 후 실행 |

## 공식 문서

- [GitHub Actions - Pull Request event](https://docs.github.com/ko/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request)
- [GitHub Actions - AWS OIDC 구성](https://docs.github.com/ko/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws)
- [AWS Credentials Action](https://github.com/aws-actions/configure-aws-credentials)
- [Helm upgrade](https://helm.sh/docs/helm/helm_upgrade/)
