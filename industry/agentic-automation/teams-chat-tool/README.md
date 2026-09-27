# Microsoft Teams Chat Extractor

This is a custom implementation of the original repository with newer features being added.

![Transcript Icon](./icons/chat-128.png)

A Chrome extension to extract chat transcripts from Microsoft Teams Web (v2).

Microsoft Teams does not support easily copying or exporting chat transcripts. This extension lets you pull them out with a couple of clicks.

## Features

- Extract messages instantly, or auto-scroll back to load messages from the **last 24 hours, 7 days, 30 days, 3 months**, **all history**, or a **custom date range**
- Custom date range with inclusive start/end dates (date-only granularity, max date is today)
- Range selection and sort selection are separate from execution; extraction starts only when you click **Start Extraction**
- Popup displays the active chat target name before extraction starts
- View the most recently extracted session directly from the popup without re-running extraction, including stored images even after the Teams DOM changes
- Toggle an Image only mode in the results view to focus on inline images; Markdown and CSV are disabled while that mode is active, and PDF remains available
- Sort output **oldest-first** or **newest-first**
- **Copy to clipboard** with one click
- **Export to Markdown** file with a metadata header block at the top
- **Export to CSV** file with metadata rows prepended before the transcript table, plus UTF-8 BOM for Chinese compatibility and robust line-separator normalization to keep rows correctly aligned
- **Export to PDF** button in results toolbar with a rendered metadata header, local client-side rendering, inline image embedding when possible, and visible in-document fallback markers for images that cannot be embedded
- Exported files use the `ChatName_YYYYMMDDHHMM` naming pattern
- Centralized Teams selector configuration in `selector-config.js` for faster DOM-maintenance updates
- Layered selector resolution per UI component: **TID -> ARIA -> legacy fallback**
- Layer matches are validated per component before acceptance, so false-positive TID/ARIA matches fall through to lower layers instead of breaking extraction
- Automatic per-component selector fallback to legacy hardcoded values if configured selectors fail
- Automatic full extraction retry in legacy-only mode when layered resolution returns no usable transcript rows
- Selector diagnostics in popup result view showing TID/ARIA/fallback/unresolved component usage
- Handles @mentions, emoji, quoted replies, and date dividers
- Normalizes Teams attachments (including video/file preview variants) into emoji placeholders during extraction so stored results and exports stay consistent
- Dark-themed popup UI
- Stop extraction: while extraction runs, a "Stop extraction" button pauses DOM extraction and displays partial results locally in the popup (no network upload).

## Installation

1. Click on "Code" button above then go to Download Source Code and click on "zip"
2. Unzip the downloaded folder, extracting the extension folder.
3. Open `chrome://extensions` in Chrome
4. Enable **Developer mode** (top-right toggle)
5. Click **Load unpacked** and select the extension folder

## Usage

1. Log into Microsoft Teams on the web at [teams.microsoft.com](https://teams.microsoft.com)
2. Open the chat you want to extract
3. Click the purple chat icon in the Chrome toolbar
4. Choose a quick range preset or set custom start/end dates, then choose sort order
5. Click **Start Extraction**
6. Wait for the extension to scroll back and collect messages (a spinner shows progress)
7. Use the **Copy**, **Markdown**, **CSV**, or **PDF** buttons in the toolbar to export the transcript

## How it works

The extension injects a content script into the active Teams tab that:

1. Locates the `#chat-pane-list` container in the Teams v2 DOM
2. Applies either quick-range or custom-date-range filtering based on popup request payload
3. If historical backfill is needed, finds the scrollable ancestor and repeatedly scrolls to the top to trigger Teams' infinite scroll, collecting message nodes via a `MutationObserver`
4. Deduplicates and sorts messages by their internal ID
5. Extracts author, timestamp, and body content from each message
6. Sends the resulting HTML back to the popup for display

## Permissions

- **activeTab** -- access the current tab only when you click the extension icon
- **scripting** -- inject the extraction script into the Teams page

No data leaves your browser. The extension makes no network requests. The latest successful extraction is persisted locally in IndexedDB, with small metadata in `chrome.storage.local`, so you can reopen the popup and view the last result without re-running extraction. See [docs/decisions/0005-extraction-job-persistence-and-ux.md](docs/decisions/0005-extraction-job-persistence-and-ux.md) for details.

## Developer Notes

- The MV3 service worker coordinates extraction lifecycle and local persistence.
- OpenSpec is the source of truth for feature specs and tasks. Legacy superpowers plan/spec notes have been migrated into [openspec/changes/service-worker-indexeddb-persistence](openspec/changes/service-worker-indexeddb-persistence).
- Image handling is local only: the popup rehydrates stored images from local persistence or the original Teams image source when needed.

### PDF Export Image Handling (May 21, 2026)

The popup PDF export was updated to embed rendered images reliably. The export clones the visible transcript DOM, fetches each image from the rendered `currentSrc` (or `src` fallback), creates local blob URLs, normalizes clone text color for readable output, and then rasterizes the clone with `html2canvas` before packaging with `jsPDF`. The PDF header is rendered through the browser's DOM/font stack so the existing Chinese-capable message fonts are preserved. This avoids blank placeholder boxes in exported PDFs and keeps all processing local to the client.

See `docs/changes/2026-05-21-pdf-export-image-fix.md` for full details and verification steps.

## License

[MIT](LICENSE)
