# agent-confluence-cli

A deterministic Confluence CLI for AI agents that centralizes API routing, validation, and multi-turn approve-and-apply workflows.

## Why this exists

Agents need reliable Confluence actions — create a page, edit its content, attach labels — without hand-rolling `POST` bodies against the REST API. This CLI gives them a small, stable surface instead: canonical commands, deterministic inputs and response shapes, and a pipe-file mechanism that turns "make a change" into a reviewable, reversible transaction.

## Design principles

- **Centralized routing** through the Atlassian Cloud ID gateway, so agents never construct base URLs by hand.
- **Multi-turn workflows via a pipe file.** `prepare` writes a pipe file, the agent edits it, `show-changes` computes a diff, and `finalize` applies it only after approval.
- **Audit stamps.** On successful finalize, the CLI appends a page comment recording the change nature, UTC timestamp, and acting credential email — best-effort and non-blocking.
- **Deterministic output and opinionated errors** so agent decisioning stays predictable.

## Requirements

- Node.js 20+ (tested with Node 22)
- Confluence credentials via one of:
  - `--env-dir <path>` (loads `<path>/.env`), or `CONFLUENCE_ENV_DIR`
  - Process env: `CONFLUENCE_CLOUD_ID`, `CONFLUENCE_EMAIL`, `CONFLUENCE_API_TOKEN`

```dotenv
CONFLUENCE_CLOUD_ID=your-cloud-id
CONFLUENCE_EMAIL=you@example.com
CONFLUENCE_API_TOKEN=your-token
```

## Install

```bash
npm install -g .
agent-confluence-cli --help
```

## Command surface

1. `space search`
2. `page search`
3. `page create`
4. `page edit content`
5. `page edit details`
6. `me`

## Multi-turn workflows

### Pipe file

Edit flows use a pipe file the agent edits between stages. Default location is configurable via `--pipe-dir <path>`.

1. `prepare` → CLI writes the pipe file
2. agent edits the pipe file
3. `show-changes` → CLI computes the diff
4. `finalize` → CLI applies changes after `--human-approval-obtained`

### Page create

```bash
agent-confluence-cli page create --space-key CH1 --title "My Page" --operation-mode prepare
# edit the pipe file
agent-confluence-cli page create --space-key CH1 --title "My Page" --operation-mode show-changes --pipe-changed
agent-confluence-cli page create --space-key CH1 --title "My Page" --operation-mode finalize --human-approval-obtained
```

### Template presets

Built-in create presets cover common knowledge-work documents: incident reports, meeting notes, gap analyses, risk registers, impact analyses, and change-request forms.

```bash
agent-confluence-cli page create --incident-report --title "INC-2026-0042" --operation-mode prepare
agent-confluence-cli page create --meeting-notes --title "Meeting Notes" --operation-mode prepare
agent-confluence-cli page create --risk-register --title "Risk Register" --operation-mode prepare
```
