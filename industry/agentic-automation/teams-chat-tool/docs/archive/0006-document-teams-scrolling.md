---
status: deprecated
date: 2026-04-23
decision-makers: Current requester
deprecated_date: 2026-05-06
deprecated_reason: Folded into ADR-0002 to avoid duplicating architecture decisions.
---

# Document Teams scrolling/backfill mechanisms

> Deprecated: content merged into [ADR-0002](0002-use-teams-dom-based-extraction-with-progressive-backfill.md) under **Operational Scenarios**.  
> Keep this file only as a historical pointer.

## Context

The extension's payload (payload.js) implements an in-page scrolling and backfill strategy to retrieve historical chat messages from Microsoft Teams' virtualized, lazily-loaded interface. This logic has evolved to handle multiple runtime scenarios that affect how scrolling proceeds, when it stops, and how results are determined. No dedicated ADR currently documents these operational cases.

## Decision

Create this ADR to document the scrolling/backfill behavior implemented in payload.js at a high level. This ADR records the observable scenarios, the extractor's response in each case, and verification criteria to ensure future maintainers understand the intended behavior. This ADR documents behavior only and does not change code.

## Observable scenarios the extractor handles

1. No chat pane found
   - Trigger: payload cannot locate the chat list container (`#chat-pane-list`).
   - Behavior: abort extraction and emit an error message to the popup.

2. Extraction without scrolling (currently-loaded messages)
   - Trigger: user selected "Currently loaded messages" (no scroll requested).
   - Behavior: collect visible child nodes from the chat list, run filtering/deduplication, and return results without performing scroll actions.

3. Scroll container missing or non-scrollable
   - Trigger: extractor determines a scrollable ancestor is not present or there is no overflow to scroll.
   - Behavior: treat as a non-scrollable extraction: collect current nodes, attempt selector-based matching and return what is available (may be empty -> error).

4. Progressive backfill with active loading
   - Trigger: user requested a day-bound range or all-history; extractor finds a scroll container and performs bounded up/down scroll stepping.
   - Behavior: move scrollTop by viewport-sized increments, wait, collect visible/loaded nodes, and continue until cutoff/range boundaries are reached or stability limits hit.

5. No new content after repeated attempts (stability stop)
   - Trigger: repeated scroll cycles produce no meaningful scroll position change or no-change in boundary timestamps.
   - Behavior: after a small number of consecutive no-change iterations (safety limit), stop scrolling and proceed with whatever was collected.

7. User stop/pause during extraction
   - Trigger: popup sends a `STOP_EXTRACTION` message while extraction is running.
   - Behavior: extractor sets pause state, exits scrolling loops at safe interruption points, and emits `EXTRACTION_PAUSED` with partial results.

6. Selector-layering fallback / legacy re-run
   - Trigger: configured selectors (from selector-config.js) produce no usable rows in a layered pass.
   - Behavior: per-component fallback is attempted during matching; if the layered run yields no usable transcript rows, the extractor reruns in legacy-only selector mode and returns legacy result when available. Selector diagnostics are emitted in the result so maintainers can see which components used config vs fallback selectors.

## Constraints

- This ADR documents behavior only; implementation remains in payload.js.
- Maintain privacy and do not change data storage or transfer behavior.
- Keep description high-level (no line-level code references); link to payload.js for implementers.

## Success criteria / verification

- ADR file exists and is linked from ADR-0002 (done).
- README or docs referencing extraction behavior point maintainers to ADR-0006 for operational scenarios.
- A reviewer can, by reading payload.js and ADR-0006 together, map runtime behavior to the documented scenarios.

## Implementation Plan

- Add this ADR to docs/decisions/ (done).
- Update ADR-0002 to reference ADR-0006 (done).
- Optionally add a short note in README.md linking to ADR-0006 (follow-up task if desired).

## Related ADRs

- ADR-0002: Use Teams DOM-based extraction with progressive backfill
- ADR-0004: Use popup-payload message protocol as module boundary
