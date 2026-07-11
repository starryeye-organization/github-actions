# CI/CD

## CI/CD란?

CI/CD는 코드 변경사항을 자동으로 검증하고, 검증된 소프트웨어를 배포 환경에 안정적으로 전달하기 위한 개발 프로세스이다.

### CI (Continuous Integration, 지속적 통합)

공유 저장소의 코드 변경사항에 대해 테스트와 검사를 자동으로 실행하는 과정이다.

- 각 개발자의 작업을 독립적으로 검증한다.
- 변경사항이 기존 코드와 정상적으로 통합되는지 확인한다.
- 버그와 오류를 병합 전에 조기에 발견한다.
- 더 안정적으로 개발할 수 있도록 돕는다.

CI에서는 다음과 같은 검사를 수행할 수 있다.

- 유닛 테스트
- 통합 테스트
- 리그레션 테스트
- 코드 컨벤션 검사
- 보안 취약점 검사

### CD (Continuous Delivery, 지속적 제공)

CI에서 검증된 코드 변경사항을 배포 가능한 상태로 만드는 과정이다.

- 코드가 언제든 배포될 수 있도록 준비한다.
- 실제 운영 환경으로의 배포는 사람이 수동으로 실행한다.

### CD (Continuous Deployment, 지속적 배포)

CI에서 검증된 코드 변경사항을 운영 환경까지 자동으로 배포하는 과정이다.

- 배포 과정까지 자동화한다.
- 새로운 기능과 수정사항을 사용자에게 빠르게 제공한다.

즉, `Continuous Delivery`와 `Continuous Deployment`는 모두 배포를 준비하지만 실제 운영 배포를 자동으로 수행하는지에 차이가 있다.

## CI/CD가 필요한 이유

여러 개발자가 각각 메시지 기능과 이미지 업로드 기능을 개발한다고 가정한다.

CI가 없다면 한 기능에 문제가 있어도 메인 코드에 그대로 반영될 수 있다. CI가 있으면 각 기능의 변경사항을 자동으로 검사하여 정상적인 기능만 병합할 수 있다.

CD가 없다면 검증이 끝난 코드도 실제 사용자에게 전달되기까지 시간이 오래 걸릴 수 있다. CD가 있으면 CI를 통과한 코드를 배포 환경에 안정적이고 효율적으로 전달할 수 있다.

## GitHub Actions 실행 시점

GitHub Actions에서는 Pull Request의 상태에 따라 CI와 CD를 실행할 수 있다.

| 구분 | 실행 시점 | 목적 |
| --- | --- | --- |
| CI | PR Open | 변경사항이 기존 코드와 잘 통합되는지, 새로운 버그가 발생하지 않는지 검증한다. |
| CI | PR Synchronize | 열린 PR에 추가된 커밋도 기존 코드와 잘 통합되는지 다시 검증한다. |
| CD | PR Merge | 메인 코드에 통합된 검증된 변경사항을 실제 배포 환경에 반영한다. |

PR을 처음 열었을 때 CI가 성공했더라도 이후 추가된 커밋에서 문제가 발생할 수 있으므로 `Synchronize` 시점에도 CI를 다시 실행해야 한다.

## CD에 필요한 개념

### Docker

애플리케이션과 실행 환경을 컨테이너 이미지로 패키징하는 플랫폼이다. 개발 환경과 운영 환경의 차이를 줄이고 어느 환경에서든 동일한 실행을 보장한다.

### Kubernetes

컨테이너화된 애플리케이션의 배포, 확장, 관리를 자동화하는 플랫폼이다.

### Helm

Kubernetes 패키지 매니저이다. Kubernetes 애플리케이션에 필요한 설정과 리소스를 묶어 배포하고 관리하기 쉽게 만든다.

## AWS를 이용한 CD 프로세스

### AWS ECR

CD 과정에서 생성한 Docker 이미지를 저장하고 관리하는 AWS의 관리형 컨테이너 레지스트리 서비스이다.

### AWS EKS

AWS에서 Kubernetes 클러스터를 운영할 수 있도록 제공하는 관리형 Kubernetes 서비스이다. ECR에 저장된 이미지를 사용하여 애플리케이션을 배포한다.

전체 CD 과정은 다음과 같다.

```text
GitHub Event
    -> GitHub Actions 실행
    -> Docker 이미지 생성
    -> AWS ECR에 이미지 저장
    -> Helm을 이용하여 AWS EKS에 배포
```

정리하면 CI는 코드 변경사항을 **검증**하는 과정이고, CD는 검증된 코드를 사용자에게 제공할 수 있도록 **배포**하는 과정이다.

## 참고 사항: Argo CD를 사용하는 경우

Argo CD는 Git 저장소에 기록된 Kubernetes 설정을 배포의 기준인 **목표 상태(Desired State)** 로 사용한다. Argo CD는 Git의 목표 상태와 Kubernetes 클러스터의 실제 상태(Live State)를 계속 비교하고, 차이가 발생하면 동기화하여 클러스터를 Git에 선언된 상태로 만든다.

일반적으로 애플리케이션 소스 코드 repository와 Kubernetes manifest 또는 Helm chart를 관리하는 배포 설정 repository를 분리하여 사용한다.

### GitHub Actions가 직접 배포하는 흐름

```text
1. 개발자가 애플리케이션 코드를 commit하고 push한다.
2. Pull Request를 생성하거나 변경하면 GitHub Actions가 CI를 실행한다.
3. 테스트와 검사가 성공한 Pull Request를 merge한다.
4. GitHub Actions가 Docker 이미지를 생성한다.
5. 생성한 이미지를 AWS ECR에 push한다.
6. GitHub Actions가 Helm 또는 kubectl을 사용하여 AWS EKS에 직접 배포한다.
7. AWS EKS에서 새로운 버전의 애플리케이션이 실행된다.
```

이 방식에서는 GitHub Actions가 이미지 생성뿐만 아니라 최종 배포까지 담당한다. 따라서 GitHub Actions runner가 EKS에 접근할 수 있는 권한과 자격 증명을 가져야 한다.

### Argo CD를 사용하는 GitOps 흐름

```text
1. 개발자가 애플리케이션 코드를 commit하고 push한다.
2. Pull Request를 생성하거나 변경하면 GitHub Actions가 CI를 실행한다.
3. 테스트와 검사가 성공한 Pull Request를 merge한다.
4. GitHub Actions가 Docker 이미지를 생성한다.
5. 생성한 이미지를 AWS ECR에 push한다.
6. GitHub Actions가 배포 설정 repository의 manifest 또는 Helm values에
   새로운 이미지 tag를 기록하고 commit한 뒤 push한다.
7. Argo CD가 배포 설정 repository의 변경사항을 감지한다.
8. Argo CD가 Git의 목표 상태와 AWS EKS의 실제 상태를 비교한다.
9. 자동 동기화가 설정되어 있으면 Argo CD가 변경사항을 AWS EKS에 배포한다.
   수동 동기화 방식이면 사용자가 Sync를 실행한 후 배포된다.
10. Argo CD가 애플리케이션의 동기화 상태와 실행 상태를 확인한다.
```

### 두 방식의 차이

| 구분 | GitHub Actions 직접 배포 | GitHub Actions + Argo CD |
| --- | --- | --- |
| GitHub Actions 역할 | 테스트, 이미지 생성, 클러스터 배포 | 테스트, 이미지 생성, 배포 설정 변경 |
| 실제 배포 주체 | GitHub Actions | Argo CD |
| 배포 기준 | workflow에서 실행한 배포 명령 | Git 저장소에 선언된 목표 상태 |
| 클러스터 접근 권한 | GitHub Actions runner에 필요 | 주로 Argo CD에 필요 |
| 변경 이력 | workflow 실행 기록과 클러스터 상태를 함께 확인해야 한다. | 배포 설정의 변경 이력이 Git commit으로 남는다. |
| 상태 불일치 처리 | 별도의 검사 또는 배포 작업이 필요하다. | Argo CD가 Git과 클러스터의 차이를 감지하고 동기화할 수 있다. |

Argo CD를 사용하면 GitHub Actions는 **CI와 이미지 생성**, Argo CD는 **CD와 Kubernetes 상태 동기화**에 집중하도록 역할을 분리할 수 있다. 자동 동기화를 사용하면 배포 설정 저장소에 새로운 이미지 tag가 commit된 후 Argo CD가 자동으로 배포하며, 수동 동기화를 사용하면 승인 후 배포하는 `Continuous Delivery` 방식으로 운영할 수 있다.

- [Argo CD - CI 파이프라인 자동화](https://argo-cd.readthedocs.io/en/latest/user-guide/ci_automation/)
- [Argo CD - 자동 동기화 정책](https://argo-cd.readthedocs.io/en/stable/user-guide/auto_sync/)
- [Argo CD - 핵심 개념](https://argo-cd.readthedocs.io/en/latest/core_concepts/)
