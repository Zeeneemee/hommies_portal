## Why

The Apps Script → Convex sheet-sync pipeline (`convex/http.ts` → `convex/sheetSync.ts` → `convex/responses.ts`) dedupes incoming form rows by `sheetTimestamp`. That works for re-runs of `syncAll` and repeated trigger fires on the *same sheet row*, but it does **not** catch the realistic case where a customer was first added manually (via the portal) or imported via CSV before the Google Form sync was wired up. Those pre-existing rows have no `sheetTimestamp`, so when that same person now submits the form, the dedupe index returns nothing and a second row gets inserted. Operators are seeing the same customer appear twice in the Customers screen — once with `source: 'manual'` (or `'csv'`), once with `source: 'sheet'`.

The portal is small enough that we can fix this with two narrow changes: a fallback dedupe by normalised `(name, contact)` so the form row is skipped when it overlaps an existing entry, and a one-shot cleanup mutation to merge the duplicates already sitting in the table.

## What Changes

- Extend `internal.responses.upsertFromSheet` (in `convex/responses.ts`) with a second dedupe check. The existing `by_sheetTimestamp` index lookup runs first; if it misses, the mutation computes a normalised match key from the incoming row's `name` + `contact` and scans existing rows for the same key. On a hit the form row is **skipped** (counted toward `skipped`) and the existing row is left untouched — `source`, `sheetTimestamp`, `createdAt`, and any portal edits all survive.
- Add a pure normalisation helper `normaliseMatchKey({ name, contact })` exported from `convex/sheetSync.ts`: lowercases, trims, and collapses internal whitespace on both fields, joins as `name + '|' + contact`. Same helper is reused by the cleanup mutation so the logic stays in one place.
- Add a one-shot internal mutation `responses.mergeDuplicates` that walks the entire `responses` table, groups rows by the normalised key, keeps the **oldest** `createdAt` row in each group, and deletes the rest. Before deleting a row the mutation checks the `assignments` table for any row referencing that response `_id`; if assignments exist on the about-to-be-deleted row, the row is skipped and the conflict is reported in the return shape so the operator can resolve manually. Returns `{ groups, kept, deleted, skippedDueToAssignments }`.
- Operator runs cleanup once from the CLI: `npx convex run responses:mergeDuplicates`. No UI surface, no scheduled cron — this is a one-shot.

Out of scope: smarter normalisation (phone format unification, fuzzy name match), per-field merge of duplicate rows, undo for the cleanup, deletion of older rows when a newer row holds assignments. Operators handle those edge cases by hand.

## Capabilities

### New Capabilities
- `sheet-sync`: the Apps-Script-driven ingest pipeline that turns Google Form submissions into rows in the `responses` table. This change captures (a) the two-tier dedupe behavior the pipeline must guarantee and (b) the one-shot cleanup mutation contract.

### Modified Capabilities
<!-- No `openspec/specs/` directory exists yet in this project; nothing to modify. -->

## Impact

- Modified Convex files: `convex/responses.ts` (extended `upsertFromSheet`, new `mergeDuplicates`), `convex/sheetSync.ts` (new `normaliseMatchKey` export).
- No schema migration required — match key is computed at lookup time. No new index needed; `mergeDuplicates` is a one-shot full-table scan and the dedupe fallback in `upsertFromSheet` runs at form-submission cadence (1–2 rows per call), so cost is bounded.
- No frontend changes. Customers screen continues to read from `responses:list`; it just stops seeing dupes.
- No change to the Apps Script (`scripts/sheet-sync.gs`).
- Operator-visible behavior change: customers who re-submit the form with **updated preferences** will have those updates silently dropped because the form row is skipped on match. Documented in `design.md` as an accepted trade-off — operators edit such customers in the portal directly.
