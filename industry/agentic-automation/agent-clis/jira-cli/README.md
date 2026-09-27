# agent-jira-cli

A deterministic Jira CLI built for AI agents, with explicit preview-and-approve mutation workflows.

## Why this exists

When you hand Jira access to an AI agent, the failure mode isn't usually a wrong API call — it's an *unintended write*. Agents improvise `POST` bodies, skip validation, and emit output in shapes that downstream tooling can't parse.

This CLI removes that improvisation. Every command is canonical, every read is paginated and explainable, and every write goes through a staged `prepare → show-changes → finalize` flow that requires explicit human approval before anything touches the instance.

## Design principles

- **Canonical commands only.** Legacy or ambiguous routes are rejected at runtime and point the caller to the nearest supported command.
- **Deterministic output.** A stable `--format json` shape with a `pagination` block (`total`, `startAt`, `maxResults`, `returned`, `strategy`) on every read.
- **Approval-gated writes.** Mutations never fire until `--operation-mode finalize --human-approval-obtained` is passed.
- **Explain mode.** `--explain` prints a read-plan (selectors, query plan, fields, enrichment, pagination) without ever including credentials.

## Requirements

- Node.js 20+
- Jira credentials via one of:
  - `--env-dir <path>` (loads `<path>/.env`), or `JIRA_ENV_DIR`
  - Process env: `JIRA_CLOUD_ID`, `JIRA_EMAIL`, `JIRA_API_TOKEN`

```dotenv
JIRA_CLOUD_ID=your-cloud-id
JIRA_EMAIL=you@example.com
JIRA_API_TOKEN=your-api-token
```

## Install

```bash
npm install -g .
agent-jira-cli --help
```

## Command surface

- `agent-jira-cli doctor credentials`
- `agent-jira-cli project search`
- `agent-jira-cli issue search`
- `agent-jira-cli issue create`
- `agent-jira-cli issue edit add`
- `agent-jira-cli issue edit replace`
- `agent-jira-cli me`

Examples:

```bash
agent-jira-cli doctor credentials --format json
agent-jira-cli project search --query "platform" --with-components --max-results 20 --explain --format json
agent-jira-cli issue search --jql "project = ABC AND statusCategory != Done" --start-at 0 --max-results 20 --explain --format json
agent-jira-cli issue search --issue-key ABC-123 --with-comments [20,0] --with-transitions [20,0] --explain --format json
agent-jira-cli me --assigned --recent --max-results 10 --explain --format json
```

## Pagination contract

Read commands accept `--start-at <n>` (zero-based) and `--max-results <n>`. Nested enrichment uses tuple syntax, e.g. `--with-comments [max,start]`; a bare flag falls back to sensible defaults and reports `strategy: client` when the endpoint has no server-side paging.

## Date handling

Start date resolves dynamically from the issue's `editmeta` field mapping; due date uses Jira's standard `duedate`. One validator and payload builder is shared across create post-actions, edit-replace, and standalone date updates, so date behavior can't drift between code paths.
