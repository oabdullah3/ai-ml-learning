---
status: proposed
date: 2026-04-23
decision-makers: Current requester
note: Implementation pending — ADR reverted to proposed status until service worker and storage changes are implemented.
---

> Archived copy: authoritative active version is `docs/decisions/0005-extraction-job-persistence-and-ux.md`.

# Extraction job persistence and UX improvements

## Context

The extension currently runs extraction jobs from a content script injected into the Teams page. When the popup UI is closed while an extraction is running, the content script continues scrolling and extracting in the background but the popup, when reopened, shows the extraction-selection screen (not the running job or results). There is no user-visible way to cancel an ongoing extraction from the popup, and completed results are not persisted: closing the extension while results are displayed loses them. This harms UX and makes cancellation and revisits impossible.

## Decision

Adopt a small MV3 background service worker that coordinates extraction job metadata and persistence, and use IndexedDB (local, client-side) to persist the last completed extraction result and metadata. Continue using content scripts to perform scrolling and DOM extraction; content scripts will communicate progress and results to the service worker. The popup will query the service worker / storage on open and render the appropriate screen (in-progress, cancelled, or results). Only the most recent completed result will be stored; a running/cancelled run must not overwrite the last completed result unless the new run completes successfully.

## Alternatives considered

1. Content-script-only persistence (no service worker). Pros: no architecture change; simpler manifest. Cons: fragile: when popup and/or extension unloads, coordination is fragile and there is no central authority to persist metadata reliably or accept cancellation requests reliably.

2. Background page (persistent, MV2-style). Not available in MV3 and incompatible with current manifest_version.

Chosen: MV3 service worker + IndexedDB because it centralizes job state, persists results reliably across popup open/close, enables robust cancellation, and keeps storage local.

## Constraints

- No network requests or external services (privacy policy must remain: "No data leaves your browser").
- Only one completed run is persisted at any time (policy to limit cache use).
- UI responsiveness: actions (open popup and show correct state, or send cancel) must complete within 5 seconds in normal conditions.
- Avoid adding heavy third-party dependencies. Use a small IndexedDB helper or light inline wrapper.

## Success criteria (measurable)

- Reopening the popup when a run is in-progress shows the in-progress screen (or last known progress) within 5 seconds.
- Reopening the popup when a completed result exists shows results within 5 seconds.
- Cancel request from popup causes background to signal content script to stop within 5 seconds, and the popup reflects cancellation.
- Only one completed result exists on disk; starting a new run that completes replaces the previous completed result atomically.

## Non-goals

- Storing multiple historical runs or enabling browsing of past runs.
- Sending any data off-device or creating a remote sync.

## Implementation Plan (detailed)

Affected files / areas:
- manifest.json
- service-worker.js (new file at extension root)
- popup.js (update UI state machine and message handling)
- popup.html (add "Stop extraction" and "View last results" controls where appropriate)
- payload.js (content script) — add cancellation listener and resilient messaging to service worker
- selector-config.js (no change expected)
- README.md (document new behavior and developer notes)

Step-by-step tasks:
1. Manifest update
   - Add `"permissions": [ ..., "storage" ]` if not present.
   - Add `"background": { "service_worker": "service-worker.js" }` to manifest.json.

2. Add service-worker.js
   - Provide message handlers for:
     - `extract-progress` (from content script): persist lightweight metadata and forward to popup if connected
     - `extract-result` (from content script): persist final result to IndexedDB as the new "lastCompletedResult" (overwrite previous)
     - `extract-error` (from content script): persist final error state
     - `get-last-run` (from popup): return active run metadata and/or last completed result
     - `cancel-run` (from popup): set a cancellation flag in storage and send `cancel` message to the content script(s) on the relevant tab(s)
   - Persist metadata redundantly: quick metadata in chrome.storage.local for fast reads, full payload (html, row JSON) in IndexedDB.
   - Schema: DB name `teams-chat-extractor`, store `results` with key `last` storing {runId, status, startTs, endTs, html, rows, count, rangeMeta}
   - Enforce a strict size cap (configurable) — default e.g., 5MB for the stored result; if exceeded store truncated summary and provide a user-facing notice.
   - Ensure write operations are atomic: write to IndexedDB then update chrome.storage.local metadata reference.

3. payload.js (content script)
   - Continue performing scrolling/extraction as now.
   - Send progress and result messages to the service worker via `chrome.runtime.sendMessage({type: 'extract-progress', ...})` and `chrome.runtime.sendMessage({type: 'extract-result', ...})`.
   - Add a listener for `chrome.runtime.onMessage` to handle `{type: 'cancel'}` and gracefully stop scrolling and send a final `extract-error` or `extract-cancelled` message.
   - If content script cannot reach service worker (rare), fall back to `chrome.storage.local` writes as a backup.

4. popup.js / popup.html
   - On popup open (init), query service worker: `chrome.runtime.sendMessage({type:'get-last-run'})`.
   - Update UI state machine to three primary states: `selection`, `in-progress`, `results`.
   - If `in-progress`, show a `Stop extraction` button that sends `{type:'cancel-run', runId}` to service worker.
   - If `results` exist, show `Back to selection` and `View last results` toggle; `Back to selection` keeps previous results accessible via `View last results` without closing extension. Implement `View last results` to fetch the stored result from service worker or IndexedDB and render.
   - When popup receives ephemeral `progress` messages (via runtime messages from service worker), update spinner and counts in real time.

5. Cancellation semantics
   - Popup `cancel-run` -> service worker sets `cancellationRequested=true` for that run in storage and sends `{type:'cancel'}` to the target tab's content script.
   - Content script receives `cancel`, stops scrolling immediately, sends final progress/result indicating cancellation.
   - If cancellation completes before new completed run, the previously stored completed result remains unchanged.
   - If a new run completes successfully, it replaces the previous completed result.

6. Storage lifecycle / pruning
   - Only the most recent completed result is retained under key `last`.
   - On `extract-result` success, overwrite `last` and compact DB if necessary.
   - Provide a developer-accessible cleanup API in service worker (`clear-last-result`) for debugging.

7. README and docs
   - Update README features and developer notes explaining the new background worker responsibilities and how to run the extension in dev mode.

8. Tests / verification steps (manual)
   - Start an extraction and close popup: reopen within 5s, popup must show `in-progress` with counts.
   - Start an extraction and cancel via popup: content script stops within 5s and previous completed result (if any) remains.
   - Start extraction that completes: new result replaces previous completed result and is viewable after reopening extension.

## Verification Criteria (Acceptance)

- Reopen the popup while an extraction is running -> popup shows in-progress view and accurate message count within 5s.
- From in-progress popup, pressing Stop triggers cancellation and content script stops within 5s.
- Completed run overwrites previous completed result; cancelled runs do not overwrite previous completed result.
- No more than one completed result persists in storage.
- UI controls: selection -> start; in-progress -> stop; results -> back-to-selection + view-last-results work as described.

## Consequences

- Positive: Users can safely close and reopen the popup and continue or view results; cancellation is available; data remains local.
- Slight complexity increase: manifest and a new worker file; service worker lifecycle must be handled carefully (timeouts, event-based wakeups).
- Must handle MV3 service worker lifetime (short-lived): rely on IndexedDB + chrome.storage.local as durable stores and event-driven logic (message handlers) rather than expecting long-running JS.

## Implementation Notes / Agent Guidance

- Prefer minimal native IndexedDB wrapper inside service-worker.js instead of introducing new npm libs. Keep the code small and synchronous-pattern-friendly.
- Use chrome.storage.local for small metadata (runId, status, count) for fast popup reads and IndexedDB for large payloads.
- When messaging from content script, always include `tabId` and `runId` to disambiguate messages in multi-tab situations.
- Add ADR reference comments in code where behavior is enforced (e.g., popup.js: // ADR-0005: Extraction job persistence).

## Related ADRs

- 0001-use-popup-triggered-mv3-injection-architecture
- 0004-use-popup-payload-message-protocol-as-module-boundary

## Open Questions

- Exact storage size cap (default suggested 5MB). Confirm cap and truncation strategy.
- Whether to compress stored HTML/rows (defer unless signs of running out of space).
