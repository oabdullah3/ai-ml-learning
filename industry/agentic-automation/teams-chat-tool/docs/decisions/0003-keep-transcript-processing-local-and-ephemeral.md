---
status: accepted
date: 2026-04-16
decision-makers: Ingo Muschenetz, Current requester
---

# Keep transcript processing local and ephemeral

## Context and Problem Statement

The user-facing architecture promise is that transcript data remains in-browser: no remote upload and no external processing. This needs to remain a concrete architectural constraint, not only a README claim. Users also need access to the latest successful extraction after the popup closes.

Constraints:
- Must preserve a privacy-first processing model.
- Must keep all transcript data local to the device.
- Must retain only the latest successful extraction.

## Decision

Keep transcript handling fully local and privacy-first while allowing limited persistence:
- No network request path in extraction or popup logic.
- Allow local persistence of only the latest successful extraction using IndexedDB (payload) and chrome.storage.local (metadata).
- Allow an MV3 service worker to coordinate persistence and retrieval across popup closes.
- Exports remain user-driven only (clipboard copy or local file download such as Markdown/CSV/PDF).

Non-goals:
- Cross-device sync.
- Cloud backup/search.
- Server-side transcript processing.
- Long-term transcript archives or multiple stored runs.

## Consequences

* Good, because privacy risk and operational complexity remain low and data stays local.
* Good, because users can reopen the popup and access the latest successful extraction.
* Bad, because there is still no historical archive beyond what the user exports.
* Bad, because storage introduces limited retained state that must be managed carefully.

## Implementation Plan

* **Affected paths**: `manifest.json`, `service-worker.js`, `popup.js`, `payload.js`, `README.md`
* **Dependencies**: none
* **Patterns to follow**: keep data flow local; persist only the latest successful run via IndexedDB payload + chrome.storage.local metadata; images stored as blobs with HTML placeholders.
* **Patterns to avoid**: introducing `fetch`/XHR upload paths, analytics beacons, or long-term transcript persistence beyond the latest successful run.
* **Configuration changes**: any future network/storage expansion must be documented by a new ADR and corresponding README changes.

### Verification

- [ ] `manifest.json` includes only the `storage` permission needed for local persistence and no host/network permissions for upload services.
- [ ] `popup.js` and `payload.js` contain no `fetch`, `XMLHttpRequest`, or WebSocket usage for transcript transfer.
- [ ] `popup.js` uses `navigator.clipboard.writeText` and local `Blob` download for user-triggered export.
- [ ] Codebase persists only the latest successful transcript in IndexedDB; cancelled/failed runs do not overwrite it.
- [ ] Stored image blobs render correctly when reopening the popup.
- [ ] `README.md` privacy claims match the implemented behavior above.

## Alternatives Considered

* Persist transcripts locally in extension storage: previously rejected to minimize retained sensitive content; now accepted with strict limits (latest successful run only).
* Upload transcripts to a remote service: rejected due to privacy/security concerns and extra operational scope.

## More Information

Related ADRs:
- [ADR-0001](0001-use-popup-triggered-mv3-injection-architecture.md)
- [ADR-0004](0004-use-popup-payload-message-protocol-as-module-boundary.md)
- [ADR-0005](0005-extraction-job-persistence-and-ux.md)
