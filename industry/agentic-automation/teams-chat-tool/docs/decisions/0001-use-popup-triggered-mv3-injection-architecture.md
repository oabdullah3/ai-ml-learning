---
status: accepted
date: 2026-04-16
decision-makers: Ingo Muschenetz, Current requester
---

# Use a popup-triggered MV3 injection architecture

## Context and Problem Statement

The extension needs chat extraction access on Microsoft Teams web pages without broad always-on page access. The current implementation uses a Chrome extension popup as the explicit user trigger and injects extraction logic only when requested.

Constraints:
- Must run as a Chrome extension using Manifest V3.
- Must avoid persistent background runtime for privacy and simplicity.
- Must keep permissions minimal.

## Decision

Use a popup-driven execution model:
- `manifest.json` defines an `action.default_popup` and only grants `activeTab` + `scripting`.
- `popup.js` is the orchestrator and injects `payload.js` into the active tab with `chrome.scripting.executeScript(...)` only after user interaction.
- No `background.service_worker` is defined.

Non-goals:
- Running extraction automatically in all tabs.
- Maintaining a persistent background process.

## Consequences

* Good, because page access is explicitly user-initiated and narrow in scope.
* Good, because the runtime model is simpler (no service-worker lifecycle complexity).
* Bad, because extraction cannot start without opening the popup and clicking an option.
* Bad, because workflow depends on Teams DOM availability at extraction time.

## Implementation Plan

* **Affected paths**: `manifest.json`, `popup.html`, `popup.js`, `payload.js`
* **Dependencies**: none
* **Patterns to follow**: keep extraction entrypoint behind popup UI actions; inject script via `chrome.scripting.executeScript`.
* **Patterns to avoid**: adding background service workers for extraction orchestration; broad permissions (e.g., unnecessary host or storage permissions).
* **Configuration changes**: if new permissions are needed, document why in a new/superseding ADR.

### Verification

- [ ] `manifest.json` contains `"manifest_version": 3`.
- [ ] `manifest.json` includes `"action": { "default_popup": "popup.html" }`.
- [ ] `manifest.json` permissions remain limited to `activeTab` and `scripting` unless superseded by ADR.
- [ ] `manifest.json` has no `background.service_worker`.
- [ ] `popup.js` injects `payload.js` with `chrome.scripting.executeScript` in response to a popup click path.

## Alternatives Considered

* Persistent background service-worker orchestration: rejected to keep architecture explicit and permission surface smaller.
* Declarative always-loaded content scripts: rejected because this design intentionally limits page script execution to user-triggered extraction.

## More Information

Related ADRs:
- [ADR-0002](0002-use-teams-dom-based-extraction-with-progressive-backfill.md)
- [ADR-0004](0004-use-popup-payload-message-protocol-as-module-boundary.md)
