## Why

The current poster flow requires an operator to bounce out of the portal: copy a Gemini-generated brief, paste it into a Claude chat that runs the `/room-showcase-pdf` skill, wait for the PDF, download it, then upload it back to the portal so extraction can lift fields into Convex. That is nine manual steps per listing, with a context switch and a closed-loop dependency on an external chat surface.

With PropertyGuru URL scraping now landing structured fields *before* the poster step, the portal already owns the data the skill used to research. The only remaining reason to leave the portal is the rendered PDF — which we can produce locally with a templated React component + Gemini for copy + browser-side PDF rendering. That collapses the flow to three clicks and ends the Claude-chat dependency for the common case.

## What Changes

- New Convex action `ai:generatePosterContent` — takes a property record (condo, rentSGD, area, buildingType, housingType, commuteMins, fullAddress, images) and returns structured content `{ headline, tagline, photoOrder[], accent }` from Gemini Flash with vision.
- New React component `<Poster property content />` — fixed A4-portrait layout with hero image, four-facts block, photo grid, Hommies brand styling sourced from `src/theme.js`.
- New "Generate poster in-portal" button on the Status screen (existing posters list / row actions). Visible on rows that have at least the matchability fields (rent + housingType + commuteMins) and at least one image.
- New flow: button → call `ai:generatePosterContent` → mount `<Poster>` off-screen → `html2pdf.js` renders to a Blob → upload via existing `properties:generateUploadUrl` → call existing `properties:setPoster` to attach. Existing `extraction:extractPosterDetails` then runs as it does for manual uploads.
- New dependency: `html2pdf.js` (~250KB gzipped, browser-only).
- Existing `PosterPromptCard` + `ai:generatePosterPrompt` stay in place for one release as a fallback. They will be removed in a follow-up change after the in-portal generator proves out.

## Capabilities

### New Capabilities

- `poster-generation`: End-to-end in-portal generation of a Hommies-branded property poster PDF from a property record and its images, using Gemini for copy decisions and a fixed React template for layout. Covers content generation, layout invariants, PDF rendering, storage attachment, and the conditions under which generation is offered or refused.

### Modified Capabilities

<!-- none — no existing specs in openspec/specs/ -->

## Impact

- **New code**:
  - `convex/ai.ts` — add `generatePosterContent` action alongside existing `generatePosterPrompt`.
  - `src/components/Poster.jsx` — the print layout (new file).
  - `src/components/Status.jsx` — add the "Generate in-portal" button + handler on each row.
- **New dependency**: `html2pdf.js` in `package.json`.
- **Unchanged**: `extraction:extractPosterDetails`, `properties:setPoster`, `properties:generateUploadUrl`, the upload pipeline, and the `posterStorageId` schema field. The generated PDF flows through the same storage path as a manual upload, so downstream consumers (Listings, Recommend, extraction) need no changes.
- **Brand**: pulls colors, fonts, and the four-facts treatment from `src/theme.js` (no port from the Claude skill).
- **Operational**: each generation is one Gemini Flash call (~$0.001 with thinking off) + ~2s of browser PDF rendering. No new external services.
- **Risk**: visual fidelity sits below the Claude-skill output until the template matures. Mitigated by keeping the Claude flow available for one release.
