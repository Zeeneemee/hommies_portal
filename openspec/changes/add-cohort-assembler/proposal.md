## Why

`add-cohort-pair-fit` shipped the pair-fit primitive — given two solo customers and a property, score whether they could share it. That is the building block, but it cannot answer the operator's actual question: *"For this 3-bedroom unit, find me a complete cohort of three compatible customers from my response pool."* Composing pair-fit scores into a complete cohort is the missing middle layer between the primitive and any UI surface.

This change adds the headless cohort builder. It consumes `pairFitForProperty` for every relevant pair in the customer pool, assembles a cohort large enough to fill the unit (one person per bedroom), picks who gets the master, and emits a structured result the future UI change can render directly. No UI here — the layer above can be designed and tested without committing to a screen yet.

## What Changes

- Add `assembleCohort(prop, pool, options?)` to `src/decisionLogic.js` — a pure function returning a structured cohort or `null` with a reason. Greedy across pair-fit scores, ranks candidates by *min* pair-fit to current cohort members (avoids the "A fits B, A fits C, but B–C is barely fit" trap), picks the seed pair by highest pair-fit and tightest move-in window as the tie-breaker.
- Add `cohortMoveInSpan(cohort)` helper — returns the day span between earliest and latest parsed move-in across a cohort. Exposed for the future UI's "schedule tightness" surface and for the assembler's own tie-breaker logic.
- Add a `COHORT_TIE_BREAKERS` exported array documenting the ordering used at assembly time: sum-of-pair-fits → tightest move-in span → smallest budget spread.
- Add unit tests covering: Wei × Arjun × Mei happy path on Normanton Park 1M+2C, pool too small, all-unfit-pair pool (e.g. one lease-mismatch member), all-masters / all-commons layouts, tie-broken-by-movein, mixed `wantRoommate` pool.
- Eligibility filter on the pool: keep only `wantRoommate === true`, `housingType === 'Room'`, `(groupSize ?? 1) === 1` solo customers. Pre-formed groups and "Whole Unit"-preferring responses are excluded from cohort assembly.
- Room assignment: members sorted by `budget.max` descending. Top-N (where N = `prop.masterCount`) take master, rest take common. Verify each assignment fits within the member's budget + soft margin; if a top-N member cannot afford master, swap with a lower-ranked member who can, or return `null` if no valid assignment exists.
- `cohortScore` is the **mean** of intra-cohort pair-fit scores so the value stays on the 0–100 scale and is directly comparable to `pairFitForProperty.score`.

## Capabilities

### New Capabilities
- `cohort-assembly`: defines the assembler's input/output contract, the eligibility filter, the seed-and-grow algorithm with its anti-fragile candidate metric, the room-assignment policy, and the tie-breaker order.

### Modified Capabilities
<!-- No modifications. `cohort-pair-fit` (the primitive's capability) is consumed unchanged. -->

## Impact

- `src/decisionLogic.js` (+ ~100 lines: `assembleCohort`, `cohortMoveInSpan`, `COHORT_TIE_BREAKERS`). Imports `pairFitForProperty`, `parseMoveInDate`, `splitRent` from the same module — no new external dependencies.
- `src/decisionLogic.test.js` (+ tests for happy path, pool-too-small, all-unfit, layout variants, tie-breakers, eligibility filter).
- No Convex schema changes. No UI changes. `decide()`, `pairFitForProperty`, and `splitRent` are unchanged.
- Non-breaking: existing callers see no behavioural change.
- Greedy assembly is locally optimal, not global. This is intentional v1 simplification (a global search is exponential in pool size) and is documented in `design.md`.
