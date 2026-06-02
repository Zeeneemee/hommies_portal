## 1. Helper exports

- [x] 1.1 Add `COHORT_TIE_BREAKERS` to `src/decisionLogic.js` as `Object.freeze(['sum_pair_fits', 'movein_span', 'budget_spread'])`. Export.
- [x] 1.2 Add `cohortMoveInSpan(cohort)` to `src/decisionLogic.js`. Iterates members, parses each `moveIn` via `parseMoveInDate`, returns `(maxDate - minDate)` in days when ≥2 parse, else `null`. Export.

## 2. Eligibility filter + property check

- [x] 2.1 Internal helper `isEligibleForCohort(resp)` returning true when `resp.wantRoommate === true && resp.housingType === 'Room' && (resp.groupSize ?? 1) === 1`.
- [x] 2.2 Internal helper `isPropertyAssemblable(prop)` returning true when `prop.housingType === 'Whole Unit' && typeof prop.masterCount === 'number' && typeof prop.commonCount === 'number' && (prop.masterCount + prop.commonCount) > 0`.

## 3. `assembleCohort` core

- [x] 3.1 Add `assembleCohort(prop, pool, options)` to `src/decisionLogic.js`. Property check first; return `{ cohort: null, reason: 'property_not_splittable' }` when `isPropertyAssemblable(prop)` is false.
- [x] 3.2 Apply `isEligibleForCohort` to filter the pool. When the filtered pool is empty, return `{ cohort: null, reason: 'no_eligible_candidates' }`.
- [x] 3.3 Compute `target = prop.masterCount + prop.commonCount`. When `filteredPool.length < target`, return `{ cohort: null, reason: 'pool_too_small' }`.
- [x] 3.4 Build a memo of `pairFitForProperty(i, j, prop)` results for every distinct pair (i, j) in the filtered pool. Memo key: ordered pair of indices. Drop null returns. Keep both fit and unfit decisions in the memo (we need unfit info to exclude candidates during grow step).
- [x] 3.5 Seed selection: from all `fit`-verdict pairs in the memo, pick the one with highest score. Tie-break by tightest `cohortMoveInSpan` across the pair. Further tie-break by stable input order. Return `{ cohort: null, reason: 'no_fit_pair' }` when no fit pair exists.
- [x] 3.6 Grow loop: while `cohort.length < target`, rank remaining candidates by `min(pairFit(c, m).score for m in cohort)`. Exclude candidates with any `unfit` pair to current cohort. Tie-break by `sum` of pair-fits, then stable input order. Return `{ cohort: null, reason: 'cohort_incomplete' }` when no qualifying candidate remains and the cohort is incomplete.
- [x] 3.7 Room assignment: sort cohort by `budget.max` descending. Assign top `masterCount` to master, rest to common. Verify each member's rent ≤ `budget.max + BUDGET_SOFT_OVERSHOOT`; on violation, attempt one swap with a lower-ranked member who can afford the higher slot. On failure, return `{ cohort: null, reason: 'no_valid_room_assignment' }`.
- [x] 3.8 Compute `cohortScore = Math.round(sum / count)` of intra-cohort pair-fit scores.
- [x] 3.9 Build `pairFits` array of `{ a, b, score }` for every intra-cohort pair (use cohort member `_id` or positional index).
- [x] 3.10 Build `notes` array: structural assignment note first (three cases — all-common, all-master, mixed), then deduplicated pair-fit notes preserving first-appearance order.
- [x] 3.11 Build `roomAssignments` object keyed by member `_id` (positional fallback), values `{ rent, roomKind }`. Round rents to integers.
- [x] 3.12 Return `{ cohort, cohortScore, roomAssignments, notes, pairFits, reason: null }` on success.
- [x] 3.13 Export `assembleCohort` from `src/decisionLogic.js`.

## 4. Tests — `cohortMoveInSpan` and constants

- [x] 4.1 `cohortMoveInSpan` with 3 parseable dates spanning 9 days → `9`.
- [x] 4.2 `cohortMoveInSpan` with fewer than 2 parseable dates → `null`.
- [x] 4.3 `COHORT_TIE_BREAKERS` equals `['sum_pair_fits', 'movein_span', 'budget_spread']` and is frozen.

## 5. Tests — `assembleCohort` happy paths

- [x] 5.1 Fixture: reuse Wei/Arjun/Mei + Normanton Park from the existing `pairFitForProperty` tests.
- [x] 5.2 Wei × Arjun × Mei → cohort length 3, all three included, Mei assigned master at S$1,800, Wei/Arjun assigned common at S$1,350.
- [x] 5.3 Cohort rents conserve: `sum(roomAssignments[*].rent) === 4500`.
- [x] 5.4 `cohortScore` matches `round(mean(intra-cohort pair-fits))`.
- [x] 5.5 `pairFits.length === 3` (C(3,2)).
- [x] 5.6 `notes[0]` mentions Mei (the structural room-assignment note).

## 6. Tests — failure modes

- [x] 6.1 Property with `housingType: 'Room'` → `{ cohort: null, reason: 'property_not_splittable' }`.
- [x] 6.2 Property with `masterCount`/`commonCount` undefined → `{ cohort: null, reason: 'property_not_splittable' }`.
- [x] 6.3 Pool of 2 for 3-bedroom target → `{ cohort: null, reason: 'pool_too_small' }`.
- [x] 6.4 Pool of 5 where everyone has `wantRoommate: false` → `{ cohort: null, reason: 'no_eligible_candidates' }`.
- [x] 6.5 Pool of 3 where one member has lease 6mo (others 12mo) — every pair with that member is unfit, no full cohort possible → `{ cohort: null, reason: 'cohort_incomplete' }`.
- [x] 6.6 Pool where every pair is unfit (all pairwise movein > 30d) → `{ cohort: null, reason: 'no_fit_pair' }`.

## 7. Tests — eligibility filter

- [x] 7.1 Pool mixes `wantRoommate: true` and `false` → only true members appear in the cohort.
- [x] 7.2 Pool includes a `groupSize: 3` member → excluded from cohort.
- [x] 7.3 Pool includes a `housingType: 'Whole Unit'` member → excluded from cohort.

## 8. Tests — anti-fragile grow + tie-breakers

- [x] 8.1 Grow prefers candidate with higher min pair-fit to current cohort.
- [x] 8.2 Seed tie broken by tightest move-in span among equally-scoring pairs.
- [x] 8.3 An otherwise-strong candidate that is `unfit` with one cohort member is excluded.

## 9. Tests — layout variants

- [x] 9.1 All-common layout (0M+3C @ S$3,900): cohort members all assigned common at S$1,300 each.
- [x] 9.2 All-master layout (2M+0C @ S$3,600 for a 2-person cohort): both assigned master at S$1,800 each.

## 10. Verification

- [x] 10.1 `npm test` passes — existing 88 tests still pass; new tests pass. *111/111 (was 88; +23 new).*
- [x] 10.2 `npm run build` passes with no new warnings.
- [x] 10.3 `openspec validate add-cohort-assembler --strict` passes.
