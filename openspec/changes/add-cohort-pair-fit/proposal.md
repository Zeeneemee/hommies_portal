## Why

The portal can already score a pre-formed group of customers against a whole-unit listing (the `add-group-rent-split-recommend` change). What it cannot do is *construct* a group from the pool of unmatched solo customers — most of whom said `wantRoommate: true` on intake, signalling exactly that intent. To get there, we need a primitive that answers "given customers A and B and a target property, are they compatible enough to share that unit?" This change adds that primitive and nothing else.

The primitive is deliberately small and headless. It does not assemble cohorts of three (the cohort-builder is a follow-up change) and it does not change any UI. It is the building block both the cohort builder and any operator-facing "potential housemates" surface will consume.

## What Changes

- Add `pairFitForProperty(a, b, prop)` to `src/decisionLogic.js` — a pure function returning `{ score, verdict, criteria, blockers, notes, perPersonRent }` or `null` for nonsensical comparisons (same identity, either side already part of a pre-formed group).
- Add two tolerant string parsers to `src/decisionLogic.js`: `parseMoveInDate(s)` and `parseLeaseMonths(s)`. Both exported for reuse + direct testing.
- Add unit tests covering every blocker path, the pass scenarios from the design's worked trace (Wei × Arjun and Wei × Mei against a 1M+2C Normanton Park unit), and the friction variants A–D (move-in too far, lease mismatch, consent missing, budget unaffordable).
- Lifestyle preferences (`quiet`, `cooking`, `petFriendly`, `extras.note`) are surfaced via a new `notes[]` field on the result — operator-visible, never used in ranking.

Three scored factors, weights summing to 100: budget (45), commute (25), move-in (30). Lease length is a pure hard gate (exact integer-month equality), not a scored factor. The function only runs against a target property — there is no property-independent variant.

## Capabilities

### New Capabilities
- `cohort-pair-fit`: defines the pair compatibility primitive — the inputs, the factor scoring, the hard blockers, and the result shape that downstream cohort assembly will consume.

### Modified Capabilities
<!-- No existing specs in openspec/specs/ yet; the prior change has not been archived. -->

## Impact

- `src/decisionLogic.js` (+ ~120 lines: one function + two parsers; imports `splitRent`, `BUDGET_SOFT_OVERSHOOT`, `COMMUTE_SOFT_OVER` from the same file).
- `src/decisionLogic.test.js` (new tests covering the pair-fit and parser surfaces).
- No Convex schema changes. No UI changes. `decide()` is untouched — the existing pre-formed-group scoring path is unaffected.
- No new dependencies.
- Non-breaking: existing callers of `decide()` and `splitRent()` see no behavioural change.
