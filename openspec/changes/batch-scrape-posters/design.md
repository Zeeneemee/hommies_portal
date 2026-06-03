## Context

The Add Property screen (`src/components/AddProperty.jsx`) already does everything needed for one listing: paste URL → `extractPropertyGuruUrl` → `fetchImagesAsData` → editable `PropertyDetailsCard` → `generatePosterContent` + `renderPosterToBlob` → upload via `properties:generateUploadUrl` → `properties:add` → `extractPosterDetails`. Operators want this same flow applied to N listings at once with a tabular overview rather than N sequential screen sessions. The Convex backend already supports parallel calls; the only missing piece is a multi-row UI and a small state machine per row.

Constraint: PropertyGuru / Cloudflare rate-limits aggressive fetches, and `extractPropertyGuruUrl` is an Anthropic-powered action whose call cost matters. So extraction concurrency must default low and be capped at 3.

## Goals / Non-Goals

**Goals:**
- One screen where the operator pastes many PG URLs and gets a row-per-URL table with extracted facts streaming in.
- Per-row edit + per-row poster generation + per-row save.
- Batch poster generation and batch save that handle per-row failures without aborting the batch.
- Draft persistence across sidebar navigation; localStorage persistence for URLs and edited fields across refresh.
- Zero changes to Convex schema, mutations, actions, or the single-URL Add Property screen.

**Non-Goals:**
- Walk-through video uploads in batch mode (single-URL screen retains video; batch is image+poster only).
- Parallel poster generation (sequential only — Gemini calls + browser PDF rendering serialize fine and avoid memory spikes).
- Resumable batches across browsers/devices (Convex-backed batch state is overkill for this workflow).
- An "import from CSV / spreadsheet" intake — out of scope; the paste-URLs textarea is the only intake mode.

## Decisions

### 1. New screen vs. extending Add Property

Create a separate `BatchAddProperty.jsx` component at route `/add/batch` rather than retrofitting `AddProperty.jsx`. Rationale: the table-centric multi-row UX is structurally different from the single-listing form, and mixing them would force every existing handler in `AddProperty.jsx` to branch on "are we in batch mode." Keeping them separate also leaves the existing flow untouched, reducing regression risk.

Alternative considered: a mode toggle inside `AddProperty.jsx`. Rejected because the form layout, state shape, and submission flow all differ enough that the branching would dominate the file.

### 2. Per-row state machine

Each row carries a `status` field that is one of:
`queued` → `extracting` → `fetching_images` → `ready` → (`generating_poster` → `ready`)? → (`saving` → `saved` | `save_failed`) | `failed` (extraction)

Rationale: a single enum drives all UI affordances (status pill, disabled buttons, error text), and the linear transitions are easy to reason about. Failed extraction is a terminal-but-recoverable state: the operator can manually fill fields and the row becomes eligible for poster + save anyway.

### 3. Concurrency

Default 1 concurrent extraction, configurable up to 3 via a small select in the screen header. Rationale: `extractPropertyGuruUrl` calls Anthropic + fetches PG HTML, and PG is touchy under load. 1-at-a-time gives the operator a clean visual cadence and avoids triggering rate limits; the cap of 3 is for impatient batches of well-behaved (cached) URLs.

Implementation: a tiny in-component worker pool — a `runQueue()` async function that picks the next `queued` row, transitions it through statuses, and respects a `maxParallel` counter. No external lib.

### 4. Draft persistence

Use the same pattern as `useAddPropertyDraft` in `App.jsx`: lift batch state up to App via a `useBatchAddDraft()` hook. Persist the JSON-safe parts (URLs, extracted/edited field values, per-row status) to `localStorage` under key `hommies.batchAdd.v1`. Image and poster blobs are `File` objects and cannot be serialized — they stay in-memory only and reset to `queued`/no-poster after a refresh.

Alternative considered: Convex-backed batch persistence. Rejected: adds schema + mutations for a transient operator workspace, and operators almost never refresh mid-batch.

### 5. Image handling

Reuse `fetchImagesAsData` exactly as in `AddProperty.handleExtractUrl`. Each row owns its own `images` array of `{file, name, size, contentType, previewUrl}`. The IMAGE_CAP (12) applies per row. Operators cannot upload manual images in batch mode (would clutter the row UI); if a row needs custom images, route them through the single-URL Add screen — listed as a deliberate limitation in the UI copy.

### 6. Poster generation

Reuse `ai:generatePosterContent` + `renderPosterToBlob` per row, exactly as `handleGeneratePoster` does. The "primary university" highlight is set per-row (default null = auto by lowest commute). Batch "Generate all" calls them sequentially because each render takes a few seconds and parallel renders risk OOM in the browser tab.

### 7. Save behaviour

`Save row` and `Save all` reuse the exact upload + `properties:add` + `extractPosterDetails` flow from `AddProperty.handleSubmit`, extracted into a small helper `saveRow(row)` inside the batch component. Saved rows stay visible with a `saved` status badge and a deep link to `/status` for the new property id; their action buttons disable (except Remove) to prevent double-save.

## Risks / Trade-offs

- **PG rate-limiting** → Default concurrency of 1 + 750ms inter-row delay before starting the next extraction. Cap is 3 even at operator request.
- **Memory spikes from many image sets** → Hard cap of 30 rows per batch. Beyond that, the textarea trims with a toast. Operators with bigger batches do two passes.
- **localStorage size** → Extracted fields are small JSON; URLs are short. 30 rows × ~2KB ≈ 60KB, well under quota.
- **Operator loses image blobs on refresh mid-batch** → Acceptable; status pill shows `queued` after refresh so re-extraction is one click. Documented in the screen's empty-state copy.
- **Anthropic cost on long batches** → Each row = 1 `extractPropertyGuruUrl` call + 1 `generatePosterContent` call. At 20 rows that's 40 calls. Operators are aware; no usage cap enforced in-app (cost monitoring is out-of-band).
- **Stale poster after edits** → If the operator edits a row's fields after generating its poster, the attached poster doesn't auto-regenerate. UI surfaces a "fields changed since poster generated — regenerate?" notice on that row.

## Migration Plan

No data migration. Ship the new screen + route + sidebar item behind no flag — it's additive and self-contained. Rollback = remove the route and component.

## Open Questions

- Should `Save all` route to `/status` afterwards (like single-URL Add does)? Default proposal: stay on Batch Add with a green "Saved N properties" header and a "Go to Status" link so the operator can clear the batch and start a new one.
- Per-row "primary university" override — auto vs. manual chips. Proposal: a per-row dropdown defaulting to auto, mirroring the single-URL screen's chip behaviour but condensed.
