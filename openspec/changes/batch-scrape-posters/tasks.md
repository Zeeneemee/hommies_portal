## 1. Scaffolding & routing

- [x] 1.1 Create `src/components/BatchAddProperty.jsx` with a minimal page header + textarea + empty table shell.
- [x] 1.2 Add `useBatchAddDraft()` hook to `src/App.jsx` next to `useAddPropertyDraft`, returning `{ rows, setRows, urlInput, setUrlInput, maxParallel, setMaxParallel, reset }`.
- [x] 1.3 Wire localStorage persistence for the JSON-safe slice of draft state under key `hommies.batchAdd.v1` (URLs, status, extracted/edited fields; skip `File` blobs).
- [x] 1.4 Register the `/add/batch` route in `App.jsx`, passing `toast` and `draft` props.
- [x] 1.5 Add sidebar nav item "Batch Add" between Add Property and Status in the `NAV` array in `App.jsx`.

## 2. URL intake

- [x] 2.1 Add a textarea + "Add to batch" button. Parse on submit: split on whitespace, trim, drop empties, validate `http(s)://`, dedupe against existing row URLs.
- [x] 2.2 Toast counts for: rows added, duplicate URLs skipped, invalid tokens skipped.
- [x] 2.3 Enforce a max of 30 active rows in a batch; trim overflow with a toast.

## 3. Per-row state machine

- [x] 3.1 Define the row shape: `{ id, url, status, extracted, images, posterFile, posterPreviewUrl, primaryUni, savedPropertyId, error, lastEditedAt, posterGeneratedAt }`.
- [x] 3.2 Implement `runQueue(rows, setRows, maxParallel)` worker pool that picks queued rows, transitions each through `extracting → fetching_images → ready` or `failed`, respecting `maxParallel` (1–3).
- [x] 3.3 Wire each row's extraction to `extraction:extractPropertyGuruUrl` then `extraction:fetchImagesAsData` (cap at IMAGE_CAP = 12), reusing the shape used in `AddProperty.handleExtractUrl`.
- [x] 3.4 Surface per-row errors in the row (status `failed` + `error` text) without aborting the queue.
- [x] 3.5 Add a 750ms inter-row delay before starting a fresh extraction when `maxParallel = 1` to be PG-friendly.

## 4. Table & inline editor

- [x] 4.1 Render the rows as a table with columns: status pill, condo, listing title, rent, type, area, beds/baths, sqft, images count, poster?, actions.
- [x] 4.2 Add per-row "Edit" toggle that opens an inline panel with the same field set as `PropertyDetailsCard`. Reuse field semantics (empty input deletes key, numbers coerced).
- [x] 4.3 Add per-row "Remove" action that revokes preview URLs and drops the row.
- [x] 4.4 Add per-row "primary university" dropdown (auto / NUS / NTU / SMU) defaulting to auto.

## 5. Poster generation

- [x] 5.1 Implement `generateRowPoster(row)` that mirrors `AddProperty.handleGeneratePoster`: resize images → `ai:generatePosterContent` → `renderPosterToBlob` → attach `File` to row, marking `posterGeneratedAt`.
- [x] 5.2 Compute and display per-row blockers using the same rule as the single-URL screen (condo / rent / housingType / ≥1 image).
- [x] 5.3 Add per-row "Generate poster" button that calls `generateRowPoster`.
- [x] 5.4 Add "Generate all posters" button that iterates rows sequentially, skipping ineligible rows with a `skipped` note and continuing past per-row failures.
- [x] 5.5 Show a "fields changed since poster generated — regenerate?" notice on rows where `lastEditedAt > posterGeneratedAt`.

## 6. Save

- [x] 6.1 Extract `uploadBlob`, the schema-safe field allowlist (`SAVE_FIELDS`), and the upload+`properties:add`+`extractPosterDetails` flow from `AddProperty.jsx` into a small reusable helper file `src/components/batchSave.js` (or inline in the batch component if it's only used once).
- [x] 6.2 Implement `saveRow(row)` returning the new property id; set the row's status to `saving → saved` (or `save_failed` with an error string).
- [x] 6.3 Add per-row "Save" button.
- [x] 6.4 Add "Save all" button that saves rows sequentially, skipping non-ready/already-saved rows, returning a summary toast (`Saved N, skipped M, failed K`).
- [x] 6.5 Once a row is `saved`, disable all its action buttons except Remove and show a deep link to `/status` filtered to its id (or `/status` plain if no filter exists).

## 7. Polish

- [x] 7.1 Add a header bar with batch-level counters: total rows, ready, saved, failed.
- [x] 7.2 Add a "Clear batch" button that calls `draft.reset()` after a confirm prompt.
- [x] 7.3 Add empty state copy explaining the paste-many-URLs intake and the in-memory-blob caveat on refresh.
- [x] 7.4 Add the `maxParallel` select (1, 2, 3) to the header.

## 8. Manual verification

- [ ] 8.1 Paste 5 valid PG URLs, confirm rows stream in one by one, edit one row, generate its poster, save it.
- [ ] 8.2 Paste 3 URLs, one of which is Cloudflare-blocked: confirm the failed row stays editable and the others succeed.
- [ ] 8.3 Generate-all posters across 5 rows where one is missing rent: confirm skipped row, others succeed, no aborts.
- [ ] 8.4 Save-all with mixed eligibility: confirm summary toast counts and that saved rows show up on Status.
- [ ] 8.5 Refresh mid-batch: confirm URLs and edited fields restore, image/poster blobs cleared, statuses reset to `queued`.
- [ ] 8.6 Navigate to Status and back: confirm batch state survives.
