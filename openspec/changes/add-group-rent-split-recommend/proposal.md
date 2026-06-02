## Why

Customers often house-hunt as a group (2-3 friends, couples) and the natural unit for them is a whole-unit listing whose rent gets split across the bedrooms — but a master bedroom commands a premium, so an equal split misrepresents what each person actually pays. Today the portal has no record of master-vs-common room composition on whole-unit listings and no group-size signal on responses, so the recommend engine compares full unit rent against an individual's budget and pins whole units the group could comfortably afford on a per-person basis as "over budget".

## What Changes

- Add `masterCount` and `commonCount` (optional ints) to `properties` — populated for whole-unit listings, drives the split.
- Add `groupSize` (optional int ≥ 1) to `responses` — the existing `wantRoommate` boolean stays for back-compat but is no longer the signal the engine uses for split-aware ranking.
- Extend the Gemini extraction prompt to draft master/common counts from the poster; operator confirms the drafted values in the listing edit modal.
- Recommend engine learns a rent-split formula (Option A — master pays 1.2× of average; commons absorb the remainder so totals conserve) and uses per-person rent against budget when the group is >1 and the listing has counts.
- Layout feasibility becomes a blocker: if `groupSize > masterCount + commonCount`, the listing is rejected as too small.
- Recommend card surfaces the split breakdown (master S$X, common S$Y) when applicable.

## Capabilities

### New Capabilities
- `property-rent-split`: Records master/common room composition on whole-unit listings and defines the rent-split formula used by downstream consumers.
- `group-aware-recommend`: Adds group size to responses and teaches the recommend engine to score per-person rent and check layout feasibility for groups.

### Modified Capabilities
<!-- No existing specs in openspec/specs/. -->

## Impact

- `convex/schema.ts` — new optional fields on `properties` (`masterCount`, `commonCount`) and `responses` (`groupSize`).
- `convex/extraction.ts` — extend Gemini prompt + sanitiser for master/common counts; coordinate with existing `bedrooms` extraction that is currently dropped on write.
- `convex/properties.ts` — accept new fields in create/update mutations.
- `src/decisionLogic.js` (+ `src/decisionLogic.test.js`) — new `splitRent(prop)` helper, group-aware scoring path, layout-feasibility blocker, tests covering the 4.3k/1M+1C and 4.3k/1M+2C worked examples.
- `src/components/ListingEditModal.jsx` — master/common count inputs (shown only when `housingType === "Whole Unit"`).
- `src/components/Recommend.jsx` — render the per-person split when present.
- `src/components/AddProperty.jsx` — surface Gemini-drafted counts for operator confirmation after extraction.
- Response-side `groupSize` capture: coordinate with the in-progress `add-chat-property-intake-beta` change (chat intake should collect it) and add a Google Sheet column mapping in `convex/sheetSync.ts`.
- No breaking changes: all new fields are optional; listings and responses without counts/groupSize behave exactly as today.
