## Why

Operators frequently triage 5–20 PropertyGuru listings at a time from WhatsApp forwards, but the current Add Property screen forces a one-at-a-time flow: paste link → extract → review → generate poster → save → repeat. Each listing burns a full screen of context-switching, and the operator has no birds-eye view of what's been pulled before committing to poster generation. A batch intake would let them paste a stack of URLs once, see all the extracted facts side-by-side in a table, then generate posters either all at once or one-at-a-time.

## What Changes

- Add a new **Batch Add** screen reachable from the sidebar (between Add Property and Status).
- Operator pastes a newline/whitespace-separated list of PropertyGuru URLs into a textarea.
- For each URL, run `extraction:extractPropertyGuruUrl` and `extraction:fetchImagesAsData` in sequence, populating one row of a results table per link. Rows stream in as each URL resolves — no all-or-nothing wait.
- Each row exposes the same lifted fields as the existing single-URL extractor (rent, area, building/housing type, sizeSqft, bedrooms, bathrooms, furnishing, availability, fullAddress, commuteMins, listingTitle, image count) plus a status column (queued / extracting / fetching images / ready / failed).
- Each row has per-row actions: **Edit** (open an inline panel of the same fields as `PropertyDetailsCard`), **Generate poster** (renders PDF for that row only, attaches to row), **Remove**.
- Batch-level actions: **Generate all posters** (sequentially, with progress + per-row error capture), **Save all** (persists every ready row via `properties:add`, uploading row images + posters), **Save row** (one-off).
- Save behaviour mirrors single Add Property: schema-accepted fields only, optional poster, optional video (videos are not part of batch — out of scope).
- Draft state persists at App level (like `useAddPropertyDraft`) so sidebar navigation doesn't wipe an in-progress batch. URLs + extracted fields persist to localStorage; image/poster blobs stay in-memory.

## Capabilities

### New Capabilities
- `batch-property-intake`: Paste-many-URLs intake that scrapes each link, displays results in an editable table, and supports batch or per-row poster generation and save.

### Modified Capabilities
<!-- None — the existing single-URL Add Property flow is untouched. -->

## Impact

- **New UI**: `src/components/BatchAddProperty.jsx` (new screen), new sidebar route `/add/batch` in `src/App.jsx`, new draft hook `useBatchAddDraft()` colocated in `App.jsx`.
- **Reused backend**: `extraction:extractPropertyGuruUrl`, `extraction:fetchImagesAsData`, `ai:generatePosterContent`, `properties:generateUploadUrl`, `properties:add`, `extraction:extractPosterDetails` — no Convex schema changes.
- **Reused libs**: `src/poster/generate.jsx` (`renderPosterToBlob`), `src/poster/encode.js`.
- **Concurrency**: extraction is serialized at 1 URL at a time by default to stay friendly to PG / Cloudflare; configurable batch size (cap 3) lives in the component.
- **No breaking changes**. Existing Add Property screen, schema, mutations, and extractors remain unchanged.
