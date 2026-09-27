---
status: accepted
date: 2026-04-16
decision-makers: Ingo Muschenetz, Current requester
---

# Use Teams DOM-based extraction with progressive backfill

## Context and Problem Statement

Microsoft Teams web chat history is virtualized and lazily loaded. To extract transcript content from currently visible and older messages, the extension needs a robust in-page strategy that can:
- collect present nodes,
- trigger historical loading,
- avoid duplicate rows,
- preserve chronological ordering.

Constraints:
- No supported Teams export API is integrated in this repository.
- Extraction must run inside the Teams page context through injected script logic.

## Decision

Use DOM-driven extraction in `payload.js`:
- Anchor on `#chat-pane-list`.
- Collect message nodes repeatedly while stepping scroll position through a detected scroll container.
- Use bounded seek loops with date-bound checks and stall/no-change detection to stop scrolling safely.
- Deduplicate by resolved message identity (`message-body-*` when available, with timestamp/content fallback), filter GIF-only entries, and sort by resolved timestamp.
- Support bounded extraction by cutoff date (N days) or full history mode.
- Resolve Teams selectors from centralized `selector-config.js` in layered order, with per-component contract validation and fallback to legacy hardcoded selectors when configured selectors fail or return unusable matches.
- If a layered extraction pass yields no usable output, rerun the extraction in legacy-only selector mode to preserve original behavior.
- Support bounded extraction by inclusive custom date range (`startDate` to `endDate`).
- Support user-requested stop/pause from popup via message protocol (`STOP_EXTRACTION` / `EXTRACTION_PAUSED`) and return partial results.

Non-goals:
- API-based export integrations.
- Perfect resilience to arbitrary future Teams DOM redesigns without selector updates.

## Consequences

* Good, because extraction works without external services and can include older history through backfill scrolling.
* Good, because deduplication/sorting produces stable transcript ordering.
* Good, because selector maintenance is centralized and updates are faster after Teams DOM changes.
* Bad, because it depends on Teams DOM structure and selectors that may change.
* Bad, because historical loading speed is bounded by client-side scrolling and render timing.

## Operational Scenarios

The extractor is expected to handle these runtime scenarios:

1. **No chat pane found**
   - Trigger: payload cannot locate the chat list container (`#chat-pane-list`).
   - Behavior: abort extraction and emit an error message.

2. **No-scroll extraction (currently loaded messages)**
   - Trigger: user selects "Currently loaded messages".
   - Behavior: collect visible nodes, filter/deduplicate/sort, and return results without scrolling.

3. **Missing or non-scrollable container**
   - Trigger: no usable scroll ancestor exists.
   - Behavior: collect what is currently available and return result or empty-range error.

4. **Progressive backfill with bounded stepping**
   - Trigger: user requests day-bound range or all-history.
   - Behavior: step scroll position in bounded loops, collect nodes, and stop at range boundaries or safety limits.

5. **Stability stop**
   - Trigger: repeated iterations show no meaningful boundary/scroll progress.
   - Behavior: stop backfill and finalize with collected data.

6. **Selector fallback and legacy rerun**
   - Trigger: layered selector pass yields no usable rows.
   - Behavior: apply per-component fallback and, if needed, rerun in legacy-only mode.

7. **User stop/pause**
   - Trigger: popup sends `STOP_EXTRACTION` during extraction.
   - Behavior: pause at safe interruption points and emit `EXTRACTION_PAUSED` with partial results.

## Implementation Plan

* **Affected paths**: `selector-config.js`, `payload.js`, `popup.js`, `popup.html`, `README.md` (behavior documentation when flow changes)
* **Dependencies**: none
* **Patterns to follow**: keep selector-based extraction localized in `payload.js`; clone and normalize message nodes before output generation.
* **Patterns to avoid**: coupling popup UI rendering logic directly to Teams DOM internals; skipping deduplication before transcript generation.
* **Configuration changes**: if selector strategy changes significantly, update this ADR or supersede it.

### Verification

- [ ] `payload.js` resolves the Teams list via layered selector resolution using `selector-config.js` and falls back to legacy selectors when configured selectors fail.
- [ ] `payload.js` uses bounded scrolling loops with stall/no-change detection while backfilling.
- [ ] `payload.js` deduplicates using resolved message identity (`message-body-*` where available with fallback identity) and sorts consistently by timestamp.
- [ ] `payload.js` resolves selector keys from `selector-config.js` (an ordered array of selectors per component) and falls back per-component to legacy selectors when configured values fail.
- [ ] `payload.js` rejects unusable higher-layer selector matches per component contract and continues down the layer chain.
- [ ] `payload.js` automatically reruns extraction in legacy-only mode when the layered run yields no usable rows.
- [ ] `payload.js` supports cutoff-date filtering for day-based extraction, inclusive custom date range filtering, and an all-history path.
- [ ] `popup.js` can request stop/pause during extraction and `payload.js` returns `EXTRACTION_PAUSED` partial results.
- [ ] `payload.js` emits extraction progress and a final result/error through runtime messages.

## Alternatives Considered

* Network/API interception: rejected because this repo implements no authenticated API exporter and relies on in-page extraction.
* Extract currently loaded nodes only: rejected because it fails the use case of retrieving older chat history ranges.

## More Information

Related ADRs:
- [ADR-0001](0001-use-popup-triggered-mv3-injection-architecture.md)
- [ADR-0004](0004-use-popup-payload-message-protocol-as-module-boundary.md)
