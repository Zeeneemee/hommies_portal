## Why

Properties already capture `bedrooms` and `bathrooms` at extraction time, but operators cannot filter on them anywhere in the portal. When matching a customer who explicitly wants a 3-bed/2-bath whole unit, staff scroll the entire inventory and eyeball each card. Adding bed/bath filters to every property-search surface turns an O(n) visual scan into a one-click narrow.

## What Changes

- Add **bedrooms** and **bathrooms** filters to the Listings screen advanced filter row (alongside the existing rent/housing/status filters).
- Add the same bed/bath filters to the Recommend screen's property search (the "Properties to recommend" pane), so operators can narrow the matchable pool before browsing suggestions.
- Filters are expressed as min/max ranges. A property with no extracted value is excluded only when at least one bound is set (matches existing rent-filter semantics).
- Bed/bath filter state participates in the same "advanced active", "filters active", and Clear-filters logic that already governs Listings rent/housing/status.
- No data-model or backend changes — `bedrooms`/`bathrooms` already exist on the property document and are populated by extraction.

## Capabilities

### New Capabilities
- `property-filtering`: Spec for how operators filter the property inventory across every property-search surface (Listings, Recommend), including the new bed/bath dimensions plus the existing rent/housing/status/chip behavior they extend.

### Modified Capabilities
<!-- None — no existing spec files in openspec/specs/ to amend. -->

## Impact

- `src/components/Listings.jsx` — extend advanced filter row, predicate set, `advancedActive`, and `clearFilters`.
- `src/components/Recommend.jsx` — extend the property-search pane with bed/bath inputs and add bed/bath predicates to the `matchable` derivation.
- CSS may need small additions for a compact min/max numeric pair styled like the existing `rent-range` (reuse where possible).
- No Convex query/schema changes. No migration. Customer-side searches (Pipeline, ManualMatchModal) are untouched because they search people, not properties.
