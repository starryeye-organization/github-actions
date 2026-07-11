import { render, screen } from '@testing-library/react';
import App from './App';

test('renders learn GithubAction cicd link', () => {
  render(<App />);
  const linkElement = screen.getByText(/learn githubaction cicd/i);
  expect(linkElement).toBeInTheDocument();
});
