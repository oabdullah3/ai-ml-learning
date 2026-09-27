# agent-gitlab-cli

A deterministic GitLab CLI for AI agents, with strict human-approval gates on every mutation.

## Why this exists

GitLab is where the blast radius of an agent error is largest: a bad push, a force-update, or a hastily-opened MR can rewrite history or leak a half-done change into `main`. This CLI exists to make GitLab automation *safe to delegate*.

The core idea is that the agent can *prepare* and *inspect* work freely, but nothing changes remotely until a human signs off on a precise, deterministic diff.

## Design principles

- **Staged mutation flow.** Clone, branch, commit, push, and MR operations follow a `prepare → show-changes → finalize` sequence, with `--human-approval-obtained` required to finalize.
- **Explicit base URL.** API commands require `--gitlab-base-url`, so no call ever resolves against an implicit host.
- **TLS readiness surfaced.** Credential diagnostics report the resolved source *and* TLS trust details (`GITLAB_CA_BUNDLE`), so self-signed/private-cert setups fail loudly instead of mysteriously.
- **Deterministic JSON output** for every command, so downstream tooling never parses prose.

## Requirements

- Node.js >= 20
- `git` available on `PATH`
- Credentials via process env, then `--env-dir <path>/.env`, then `GITLAB_ENV_PATH`:

```dotenv
GITLAB_USERNAME=your-user
GITLAB_TOKEN=your-token
# optional, for git-over-HTTPS trust:
GITLAB_CA_BUNDLE=/path/to/ca-bundle.pem
```

`GITLAB_CA_BUNDLE` accepts an absolute/relative path, inline PEM content, or base64-encoded PEM.

## Install

```bash
npm install -g .
agent-gitlab-cli --help
```

## Command surface

```bash
agent-gitlab-cli doctor credentials --format json
agent-gitlab-cli repo search --gitlab-base-url https://gitlab.example.com --query platform --format json
agent-gitlab-cli repo file search --gitlab-base-url https://gitlab.example.com --repo-path group/project --query README --format json
agent-gitlab-cli repo clone --gitlab-base-url https://gitlab.example.com --repo-path group/project --format json
agent-gitlab-cli repo status --gitlab-base-url https://gitlab.example.com --repo-path group/project --format json
agent-gitlab-cli repo file read --gitlab-base-url https://gitlab.example.com --repo-path group/project --file-path README.md --ref main --format json
agent-gitlab-cli repo branch list --gitlab-base-url https://gitlab.example.com --repo-path group/project --format json
agent-gitlab-cli repo branch create --gitlab-base-url https://gitlab.example.com --repo-path group/project --branch-name feature/x --from-ref main --operation-mode prepare --format json
agent-gitlab-cli repo change apply --gitlab-base-url https://gitlab.example.com --repo-path group/project --branch feature/x --action update --file-path README.md --content "updated" --message "docs: update" --operation-mode prepare --format json
agent-gitlab-cli repo mr list --gitlab-base-url https://gitlab.example.com --repo-path group/project --state opened --format json
agent-gitlab-cli repo mr create --gitlab-base-url https://gitlab.example.com --repo-path group/project --source-branch feature/x --target-branch main --title "feat: x" --operation-mode prepare --format json
```

Credential diagnostics report the resolved source and TLS readiness. Clone and mutation workflows enforce the staged prepare/show-changes/finalize flow above.
