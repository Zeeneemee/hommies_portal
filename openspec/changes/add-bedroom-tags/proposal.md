## Why

Operators want to filter the property inventory by bedroom count, but the existing `bedrooms: number` field is only reliably populated on newly-added listings — many rows already live in prod (added before extraction matured, or where Gemini missed the count) with `bedrooms` absent, so they silently drop out of any bedroom filter. A normalized, human-readable `tags` array gives us a single, filterable dimension we can backfill for the whole prod inventory today and keep growing later (furnishing, area, housing type), with bedroom tags as the first kind.

## What Changes

- Add an optional `tags: string[]` field to the `properties` document — a free, normalized label set. The first tag kind is a **bedroom tag** (e.g. `"2BR"`, `"Studio"`) derived from the extracted bedroom count.
- Extraction derives and attaches the bedroom tag whenever it determines a bedroom count, on **both** extraction paths: the PropertyGuru URL path (`extractPropertyGuruUrl`) and the poster PDF path (`extractPosterDetails`). The tag is recomputed (not duplicated) so re-extraction stays idempotent.
- A one-shot backfill migration **re-extracts** every existing prod property from its attached poster / source to recover `bedrooms` and write the corresponding tag, so the existing inventory becomes filterable.
- Operators can filter by bedroom tag on the property-search surfaces, reusing the existing filter machinery.
- The listing edit modal keeps tags in sync when an operator manually changes the bedroom count.

## Capabilities

### New Capabilities
- `property-tags`: How properties carry a normalized `tags` array — the bedroom-tag vocabulary and derivation rule, how extraction (URL + poster) attaches tags idempotently, how the prod backfill re-extraction populates tags on existing rows, and how operators filter by bedroom tag.

### Modified Capabilities
<!-- None — no existing spec files in openspec/specs/ to amend; add-bedroom-bathroom-filters is a sibling change, not an archived spec. -->

## Impact

- `convex/schema.ts` — add `tags: v.optional(v.array(v.string()))` to `properties`.
- `convex/extraction.ts` — derive a bedroom tag from the (sanitised) bedroom count and merge it into the patch on both `extractPosterDetails` and `extractPropertyGuruUrl`; centralize the derivation in a small helper.
- `convex/properties.ts` — accept `tags` in the `update` mutation validator; add an internal backfill mutation/action that re-runs extraction across all properties.
- `src/components/AddProperty.jsx` / `BatchAddProperty.jsx` — carry `tags` from the URL-extraction result into the property on save.
- `src/components/ListingEditModal.jsx` — recompute the bedroom tag when the operator edits bedroom count.
- Property-search surface(s) (`src/components/Listings.jsx`, optionally `Recommend.jsx`) — bedroom-tag filter, reusing existing filter state/Clear logic.
- One-shot prod migration run (Convex dashboard / CLI) — re-extraction over the inventory; costs Gemini API calls proportional to the number of properties.
