# Agent Skills

Operational policies for AI agents — the instructions that tell an agent *how* to safely drive Jira, Confluence, GitLab, and browser-based extraction through the deterministic CLIs in [`../agent-clis`](../agent-clis).

## The idea

Giving an agent API access is dangerous unless you constrain it. Raw REST calls let an agent improvise `POST` bodies, skip validation, and write before anyone has looked at the result. Each skill here encodes a non-negotiable safety policy on top of a deterministic CLI so the agent's freedom is bounded by design:

- **Preview before mutate.** Every write follows a `prepare → show-changes → finalize` flow.
- **Explicit human approval.** Nothing is applied until `--human-approval-obtained` is passed.
- **Deterministic output.** `--format json` everywhere, so downstream tooling never parses prose.
- **No secret exposure.** Skills refuse to read or print credentials.

## The skills

| Skill | Purpose | Backing CLI |
|-------|---------|-------------|
| `jira-skill` | Canonical Jira operations with approval-gated create/edit mutations | `agent-jira-cli` |
| `confluence-skill` | Confluence page workflows via a pipe-file approve-and-apply flow | `agent-confluence-cli` |
| `gitlab-skill` | MR-first GitLab workflows with strict mutation gates | `agent-gitlab-cli` |
| `teams-extractor-skill` | Extract Teams chat history for a user-approved chat and time range | Chrome DevTools MCP |
| `chrome-devtools-mcp-skill` | Guide for connecting an agent to Chrome DevTools via MCP (adapted from the Hermes agent ecosystem, MIT) | — |

## Safety model

All three platform skills share the same invariants:

- Resolve exact targets (IDs, keys, branches) *before* mutating — never guess.
- Prefer the CLI over ad-hoc HTTP; refuse operations the CLI doesn't support rather than approximating them.
- Show a preview and obtain explicit approval before finalizing any write.

## Layout

- `skills/` — one directory per skill, each with a `SKILL.md` policy document (and supporting `docs/` or `scripts/` where relevant).
- `docker/` — a `Dockerfile` that bakes the three CLIs into a reusable agent runtime image.
