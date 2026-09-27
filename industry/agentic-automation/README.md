# Agentic Automation

A set of tools for safely giving AI agents deterministic, auditable control over real workplace systems — issue tracking, wikis, source control, and chat history.

Built around one principle: **an agent should preview before it mutates, and a human should approve before anything is written.**

## What's here

| Directory | What it is |
|-----------|------------|
| [`agent-clis/`](agent-clis) | Three Node.js CLIs — `agent-jira-cli`, `agent-confluence-cli`, `agent-gitlab-cli` — that wrap each platform's REST API behind a strict, JSON-first command surface. |
| [`agent-skills/`](agent-skills) | Operational policy documents (`SKILL.md`) that teach an agent *how* to use those CLIs safely — approval gates, preview-then-finalize flows, and "refuse rather than approximate" rules. |
| [`teams-chat-tool/`](teams-chat-tool) | A Manifest V3 Chrome extension that captures Teams chat history for a user-approved chat and time range, so it can be reviewed by an agent or a human. |

## The pattern

```
agent-skills (policy)  ──►  agent-clis (enforcement)  ──►  platform REST API
        ▲                                                       │
        └────────────── human approval gate ◄───────────────────┘
```

1. The **skill** tells the agent *what* is and isn't allowed.
2. The **CLI** mechanically enforces that — it won't finalize a write until `--human-approval-obtained` is supplied.
3. The **human** reviews a concrete diff before anything lands.

## Why this shape?

- **Determinism** — `--format json` everywhere; no scraping prose.
- **Safety** — destructive operations are impossible to trigger by accident.
- **Composability** — each CLI is independently installable (`npm install -g ./agent-clis/<name>`), and the whole stack can be baked into one image via [`agent-skills/docker`](agent-skills/docker).

See each sub-directory's README for setup and usage.
