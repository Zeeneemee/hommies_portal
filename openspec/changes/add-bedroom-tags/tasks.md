## 1. Schema & validators

- [x] 1.1 Add `tags: v.optional(v.array(v.string()))` to the `properties` table in `convex/schema.ts` with a short comment (normalized label set; bedroom tags first).
- [x] 1.2 Add `tags: v.optional(v.array(v.string()))` to the `update` mutation args validator in `convex/properties.ts`. (Also added to the `add` mutation args so URL-extracted rows persist tags at insert.)

## 2. Bedroom-tag derivation helper

- [x] 2.1 Added `convex/lib/bedroomTags.ts` with `deriveBedroomTag({ bedrooms, unitType })` → `"Studio"` | `"<n>BR"` | `undefined`, plus `BEDROOM_TAG_RE` and `mergeBedroomTag(existing, newTag)` that strips prior bedroom tags, appends the new one, and de-dups. (Pure module so both Convex and the Vite frontend import it.)
- [x] 2.2 Added `convex/bedroomTags.test.ts` covering 2 → `"2BR"`, studio → `"Studio"`, missing count → `undefined`, and `mergeBedroomTag` idempotency / tag-swap / preservation of non-bedroom tags.

## 3. Extraction paths attach the tag

- [x] 3.1 In `extractUrlWithGemini` (URL path), after `sanitiseGeminiFields`, derive the bedroom tag and set `fields.tags`.
- [x] 3.2 In `extractPosterDetails`, read the property's current `tags`, `mergeBedroomTag` with the derived tag, and include `tags` in the patch; also returns `bedroomTag` for the backfill tally.
- [x] 3.3 In `AddProperty.jsx` and `BatchAddProperty.jsx`, added `bedrooms`/`bathrooms`/`tags` to `SAVE_FIELDS` so the URL-extraction result persists on save.

## 4. Prod backfill (re-extraction)

- [x] 4.1 Added internal action `extraction:backfillBedroomTags` + internal query `properties:listForBackfill`; pages all properties, re-extracts each poster-bearing row via `extractPosterDetails` in per-row try/catch, returns `{ total, tagged, skipped, failed }`.
- [x] 4.2 Rows without a poster / recoverable count are counted as skipped (left untagged); a failing row is caught and counted, not fatal.

## 5. Manual edit keeps tag in sync

- [x] 5.1 In `ListingEditModal.jsx`, on save recompute `mergeBedroomTag(property.tags, deriveBedroomTag(...))` from the edited bedroom count and include `tags` in the patch.

## 6. Filter UI

- [x] 6.1 Added a bedroom-tag `select` to `Listings.jsx` (only shown when tags exist); predicate keeps `p` iff `p.tags?.includes(bedTag)` when active.
- [x] 6.2 Wired into `advancedActive` and `clearFilters` (and thereby `filtersActive`).

## 7. Verify & roll out

- [x] 7.1 Ran `vitest run` (151 passed, incl. 9 new bedroom-tag tests), `vite build` (frontend import of `convex/lib/bedroomTags` resolves), and `convex codegen` (backend TypeScript clean).
- [ ] 7.2 Deploy Convex functions, then run `backfillBedroomTags` once against prod from the Convex dashboard/CLI; record the tagged/skipped/failed counts.
- [ ] 7.3 Spot-check the Listings bedroom-tag filter against backfilled prod rows and confirm previously-untagged properties now appear.
