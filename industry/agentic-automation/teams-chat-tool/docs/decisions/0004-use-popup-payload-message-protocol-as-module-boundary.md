---
status: accepted
date: 2026-04-16
decision-makers: Ingo Muschenetz, Current requester
---

# Use popup-payload message protocol as module boundary

## Context and Problem Statement

The extension has two distinct responsibilities:
1. popup-side user interaction and presentation,
2. page-side extraction and normalization.

A stable boundary is needed so UI changes do not require deep extraction rewrites, and extraction changes do not tightly couple to popup internals.

Constraints:
- Must work with Chrome extension runtime messaging.
- Must support progress updates during long backfill extraction.

## Decision

Use a runtime message protocol between popup and injected payload:
- Popup sends extraction request:
  - quick mode: `{ action: 'extract', rangeMode: 'quick', days, sort }`
  - custom mode: `{ action: 'extract', rangeMode: 'custom', startDate, endDate, sort }`
- Popup can send stop request during extraction: `{ type: 'STOP_EXTRACTION' }`.
- Payload emits lifecycle messages: `progress`, `result`, `error`.
- Payload can emit pause lifecycle message for partial results: `EXTRACTION_PAUSED`.
- `result` may include selector diagnostics metadata describing per-component selector source (e.g., `config` or `fallback`) and the exact selector string used, for maintenance visibility.
- Popup remains responsible for status UI, transcript display, partial-results banner, copy/export actions, and sort/range controls.
- Payload remains responsible for collection, normalization (mentions/emoji/quoted replies), filtering, and transcript HTML generation.

Non-goals:
- Sharing UI state management logic inside payload.
- Returning raw DOM nodes across the boundary.

## Consequences

* Good, because responsibilities are separated and easier to evolve independently.
* Good, because progress and failure paths are explicit in protocol events.
* Bad, because message schema changes require coordinated updates on both sides.
* Bad, because protocol is implicit in code unless maintained in ADR/documentation.

## Implementation Plan

* **Affected paths**: `popup.js`, `payload.js`, `popup.html`, `README.md`
* **Dependencies**: none
* **Patterns to follow**: keep payload output contract explicit (`type` + payload fields); keep popup as the single UI state controller.
* **Patterns to avoid**: direct DOM coupling from popup to Teams page internals; overloading message types with ambiguous payloads.
* **Configuration changes**: when adding message types/fields, update both handlers and docs in the same change.

### Verification

- [ ] `popup.js` sends extraction request with explicit range mode and required fields (`days` for quick mode, `startDate`/`endDate` for custom mode).
- [ ] `popup.js` sends `{ type: 'STOP_EXTRACTION' }` during in-progress extraction when user requests pause/stop.
- [ ] `payload.js` listens for `action === 'extract'` and starts extraction.
- [ ] `payload.js` sends `progress`, `result`, and `error` message types.
- [ ] `payload.js` handles stop request and sends `EXTRACTION_PAUSED` with partial data.
- [ ] `payload.js` includes selector diagnostics metadata in `result` when layered selector resolution is used; diagnostics must identify the source type (`config` or `fallback`) and the selector string applied.
- [ ] `popup.js` renders each lifecycle state (`status`, transcript/result, and errors) from message type handling.
- [ ] `popup.js` surfaces selector diagnostics summary without breaking transcript rendering/export actions.
- [ ] Transcript normalization features (emoji replacement, mention normalization, quoted-reply transformation) remain payload-side.

## Alternatives Considered

* Monolithic extraction + UI logic in one script context: rejected because it mixes Teams DOM parsing with popup rendering concerns.
* Tight callback-only protocol without typed message events: rejected because explicit event types are easier to maintain and debug.

## More Information

Related ADRs:
- [ADR-0001](0001-use-popup-triggered-mv3-injection-architecture.md)
- [ADR-0002](0002-use-teams-dom-based-extraction-with-progressive-backfill.md)
- [ADR-0003](0003-keep-transcript-processing-local-and-ephemeral.md)
