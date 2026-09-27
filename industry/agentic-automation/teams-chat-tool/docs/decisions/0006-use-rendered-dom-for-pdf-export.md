---
status: accepted
date: 2026-05-21
decision-makers: Ingo Muschenetz, Current requester
---

# Use rendered popup DOM for PDF export

## Context

The extension provides a PDF export feature that should include inline images present in the extracted transcript. Previously the export path attempted to re-resolve image sources and rehydrate blobs separate from the popup rendering flow. This introduced situations where exported PDFs showed placeholder boxes or empty space in place of images.

## Decision

Use the already-rendered popup transcript DOM as the authoritative source for PDF export. The export shall:

- Clone the visible transcript element into an off-screen render root.
- For each `<img>` in the clone, fetch the image bytes using the browser-visible source (`currentSrc` or `src` fallback).
- Convert fetched bytes to local `blob:` URLs and set them on the clone prior to rasterization.
- Normalize clone text color and fill so PDF output remains readable and consistent.

This decision keeps the extraction and payload persistence paths unchanged; the change is limited to the popup-side export pipeline and preserves the privacy-first local processing model.

## Consequences

- Positive: Eliminates a class of blank-image PDF exports caused by rehydration/fallback timing and cross-origin fetch fragility.
- Positive: Uses exactly the same image bytes the user already sees in the popup, improving fidelity.
- Neutral: No changes to persistent storage schema or service worker messaging are required.
- Negative: The export now depends on the popup DOM being fully rendered and populated; if UI or rendering changes alter image sources before export, the export may need small adaptations.

## Verification

Follow the verification steps described in the PDF export OpenSpec (`openspec/changes/add-pdf-download-with-chat-images/specs/transcript-pdf-export/spec.md`).
