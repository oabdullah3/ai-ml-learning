---
status: accepted
date: 2026-05-21
decision-makers: Current requester
note: Implemented in payload extraction pipeline so normalized placeholders propagate to storage and all export/render paths.
---

# Normalize attachments to emoji placeholders at extraction

## Context

Teams message attachments (file cards, rich file previews, and video placeholders) are difficult to render consistently in extracted transcript output and downstream exports. The extension already normalizes message content during extraction (mentions, emoji images, quoted replies), then persists and reuses that normalized result across popup rendering and export workflows.

Without explicit attachment normalization, some attachment-heavy messages are partially represented or omitted in downstream views and exports.

## Decision

Represent detected attachments as lightweight textual placeholders with type-specific emoji during extraction time in the content script.

Examples:
- `[🎬 Video attachment: output.mp4]`
- `[📊 Spreadsheet attachment: weekly-report.xlsx]`
- `[📎 File attachment]`

Attachment kind detection uses available DOM hints and filename extensions where present. Placeholder text is included in the extracted HTML and `contentText`, so persistence and all render/export modes consume the same normalized representation.

## Alternatives considered

1. Preserve full attachment DOM cards in transcript output.
   - Rejected: brittle across Teams DOM changes; poor portability into popup export surfaces.

2. Normalize attachments only at popup render/export time.
   - Rejected: produces inconsistent behavior across storage, reopen flows, and export formats.

3. Drop attachments entirely from extracted output.
   - Rejected: loses important message context.

## Consequences

- Positive:
  - Stable, portable transcript representation for attachment-heavy chats.
  - Consistent behavior across persisted results, popup rendering, and exports.
  - Minimal implementation footprint within existing extraction normalization stage.

- Trade-offs:
  - Rich preview visuals are intentionally replaced with concise semantic placeholders.
  - Attachment metadata fidelity is limited to what can be inferred from filename/DOM hints.

## Scope and constraints

- Processing remains local and offline from the extension perspective.
- No new permissions or network paths are introduced.
- Applies only to extracted transcript representation; original Teams UI is unchanged.

## Related ADRs

- 0002-use-teams-dom-based-extraction-with-progressive-backfill
- 0003-keep-transcript-processing-local-and-ephemeral
- 0004-use-popup-payload-message-protocol-as-module-boundary
