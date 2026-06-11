## Context

The Convex `properties` document already carries optional `bedrooms` and `bathrooms` integer fields (see `convex/ai.ts:268-269` and `convex/extraction.ts:120-121, 196-197, 457-458`), populated by the poster/URL extractor and editable from both `AddProperty.jsx` and `BatchAddProperty.jsx`. No backend touch is required.

Two property-search surfaces exist client-side:

1. **`src/components/Listings.jsx`** — the inventory browser. It already has chip filters (All / Condo / HDB / Pending poster / Taken) plus an "advanced" disclosure containing a rent min/max range (`.rent-range`), a housing-type `<select>`, and a status `<select>`. Predicates `matchesChip / matchesSearch / matchesRent / matchesHousing / matchesStatus` are AND-combined in one `.filter()`. `advancedActive`, `filtersActive`, and `clearFilters` coordinate the disclosure dot and the "Clear filters" link.
2. **`src/components/Recommend.jsx`** — the matchable-pool browser around line 271 (`const matchable = ... properties.filter(propertyIsMatchable)`) and the search input around line 370. It has free-text search but no structured filters.

Two other search inputs exist (`Pipeline.jsx`, `ManualMatchModal.jsx`) but they search **customers/responses**, not properties — bed/bath filters do not apply to them.

The user phrased the request as "filter the bedroom and bathroom in listing and every search". We interpret "every search" as "every property-search surface", which is Listings + Recommend.

## Goals / Non-Goals

**Goals:**
- Add min/max bedroom and min/max bathroom filters to the Listings advanced row.
- Add the same four inputs to the Recommend property-search pane.
- Keep filter semantics identical to the existing rent-range filter so operators don't learn two rules.
- Pure UI change — zero backend or schema work.

**Non-Goals:**
- No new chip presets (e.g., a "3-bedroom" chip). Operators already get that by typing `3` into both min and max.
- No filter persistence (URL params, localStorage). Existing filters don't persist either; staying consistent.
- No fuzzy matching against `unitType` strings like "3BR". `bedrooms` is the authoritative numeric field.
- No changes to customer-side searches (Pipeline, ManualMatchModal).
- No changes to the underlying Convex query — filtering remains a client-side `.filter()` over the already-loaded `properties` array, matching the current architecture.

## Decisions

### Decision 1: Min/max integer range, not a single "exact" number or chip

**Choice:** Two integer inputs per dimension (min, max), mirroring the existing rent range.

**Alternatives considered:**
- *Single "Beds = N" select.* Rejected — operators frequently need "3 or more", which a single value can't express. Customers in Singapore often say "at least 2 bedrooms".
- *Chip rail like "1 / 2 / 3 / 4+".* Rejected for now — it grows the chip rail (already 5 entries) and doesn't compose with bathrooms. Can be added later if a single common count dominates queries.

**Rationale:** Range semantics are already the muscle memory on this screen (rent min/max). Reuse the pattern instead of inventing a new one.

### Decision 2: Missing `bedrooms`/`bathrooms` is excluded when any bound is set

**Choice:** When at least one bound is set, a property whose `bedrooms` (resp. `bathrooms`) is `undefined` is excluded from results. When both bounds are empty, the filter is a no-op and missing values pass.

**Alternatives considered:**
- *Always include missing values* — would silently show 0-bed properties as "matching a 3-bed query". Bad for trust.
- *Always exclude missing values* — would hide every legacy property as soon as the filter component mounted, even if the operator hasn't touched it. Worse.

**Rationale:** This is the same rule `matchesRent` already enforces in `Listings.jsx:71-79` — copy it verbatim so behavior is uniform across all three range filters.

### Decision 3: Inputs grouped as a single bed/bath row, styled like the existing rent range

**Choice:** Add two `min – max` pairs side by side in the existing `.listings-extra-filters` row. Label them with the placeholder/`aria-label` pattern already in use. Reuse `.rent-range` CSS or duplicate it under a `.bed-range` / `.bath-range` class — implementation detail to decide during coding, but visually identical.

**Rationale:** No new layout primitive. The existing row already wraps; adding two more compact pairs continues that pattern.

### Decision 4: Recommend uses a collapsible "filters" affordance similar to Listings

**Choice:** Recommend currently has only a search box (no advanced disclosure). Add a small inline "Filters" toggle next to the search input that reveals four bed/bath inputs (no rent/housing/status — those aren't relevant to the matchable pool today and adding them is scope creep).

**Alternatives considered:**
- *Always-visible inputs.* Rejected — the Recommend left pane is dense; permanent extra controls hurt scanability for the common case where operators don't need them.
- *Reuse Listings' full advanced row.* Rejected — Recommend already filters out non-matchable properties (`propertyIsMatchable`), so status/housing filters are largely redundant there.

**Rationale:** Keep parity with Listings' disclosure idiom; introduce only the controls that actually solve the stated problem.

### Decision 5: No URL/localStorage persistence

**Choice:** Filter state lives in component state only, consistent with existing filters.

**Rationale:** Out of scope; can be added later as a single cross-cutting change for all filters at once.

## Risks / Trade-offs

- **Risk:** Many existing properties lack `bedrooms`/`bathrooms` because legacy posters weren't re-extracted. **Mitigation:** The "missing → excluded when bound set, included when no bound" rule (Decision 2) means operators only lose legacy rows when they explicitly opt into filtering by these dimensions. Document this in a one-liner in `proposal.md` ("legacy rows without extracted bed/bath may not appear"). Long-term fix is a re-extraction backfill, not in scope.
- **Risk:** Range inputs may be entered inverted (min > max). **Trade-off:** Match the rent-range behavior, which also doesn't swap them — an inverted range simply produces an empty result. Operators self-correct immediately. Adding swap logic adds surface area for marginal benefit.
- **Trade-off:** Recommend gets its own "Filters" disclosure pattern rather than reusing Listings'. Slight duplication of disclosure styling, but keeps the two screens independently evolvable.

## Migration Plan

Not applicable — purely additive UI. No schema migration, no data backfill, no deploy gating. Roll forward via the normal feat branch → PR flow.

## Open Questions

- Should the Recommend "Filters" disclosure also accept the existing rent range? Out of scope for this change; flagged for a follow-up if operators ask.
- Should we add a small "matches X of Y" counter to the Recommend pane like Listings has? Nice-to-have, not required by the spec; defer.
