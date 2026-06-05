## 1. Policy enum + back-compat alias

- [x] 1.1 In `src/decisionLogic.js`, add `SPLIT_POLICIES = Object.freeze({ equal, light, standard })` and `DEFAULT_SPLIT_POLICY = 'standard'`. Export both.
- [x] 1.2 Rebind `export const MASTER_PREMIUM = SPLIT_POLICIES.standard.premium` so existing callers see no behavioural change.

## 2. `splitRent(prop, policy)` policy parameter

- [x] 2.1 Extend the function signature to `splitRent(prop, policy = 'standard')`. Look up premium via `SPLIT_POLICIES[policy]?.premium ?? SPLIT_POLICIES[DEFAULT_SPLIT_POLICY].premium` (silent fallback).
- [x] 2.2 Replace the literal `MASTER_PREMIUM` in the function body with the looked-up premium variable. All other behaviour (the all-master, all-common, and mixed cases) is unchanged.

## 3. `pairFitForProperty(a, b, prop, options)` options.splitPolicy

- [x] 3.1 Extend the function signature to accept an optional fourth argument `options = {}`.
- [x] 3.2 Extract `const policy = options.splitPolicy ?? DEFAULT_SPLIT_POLICY` (fallback for invalid keys is handled by `splitRent`).
- [x] 3.3 Replace the existing `const split = splitRent(prop)` call with `splitRent(prop, policy)` so the budget assignment search uses policy-specific rents.

## 4. `assembleCohort(prop, pool, options)` options.splitPolicy

- [x] 4.1 In `assembleCohort`, extract `const policy = options.splitPolicy ?? DEFAULT_SPLIT_POLICY`.
- [x] 4.2 Update internal `pairFitAt(i, j)` to pass `{ splitPolicy: policy }` to `pairFitForProperty`.
- [x] 4.3 Update internal `splitRent(prop)` call (used during room assignment) to `splitRent(prop, policy)`.

## 5. Tests — `splitRent`

- [x] 5.1 Add a test that `splitRent(prop, 'standard')` equals `splitRent(prop)` for several fixtures.
- [x] 5.2 Add a test for `'equal'` on 4500/1M+2C → `{ master: 1500, common: 1500, perRoomAvg: 1500 }`.
- [x] 5.3 Add a test for `'light'` on 4500/1M+2C → master = avg × 1.10, sum conserves to 4500.
- [x] 5.4 Add a test for invalid policy → equals `'standard'` result.
- [x] 5.5 Add a test asserting `SPLIT_POLICIES` is frozen and has exactly three keys in order `equal, light, standard`.

## 6. Tests — `pairFitForProperty`

- [x] 6.1 Add a test that `pairFitForProperty(wei, mei, normantonPark)` (no options) equals the same call with `{ splitPolicy: 'standard' }`.
- [x] 6.2 Add a test where two customers cannot fit `'standard'` (budget too low for master) but DO fit `'light'` (or similar) — verdict flips from `'unfit'` (budget_unaffordable) to `'fit'`. *(Regent Heights Mei+Arjun scenario)*
- [x] 6.3 Add a test for invalid policy → equals standard result.

## 7. Tests — `assembleCohort`

- [x] 7.1 Add a test that `assembleCohort(normantonPark, [wei, arjun, mei])` (no options) equals the same call with `{ splitPolicy: 'standard' }` for cohort identity and assignments.
- [x] 7.2 Add a test for `'equal'`: every member's `roomAssignments[id].rent === 1500`.
- [x] 7.3 Add a test for `'light'`: Mei → master at avg × 1.10 (= 1650), sum conserves to 4500.
- [x] 7.4 Add a test for Regent Heights pool: `'standard'` returns `{ cohort: null, reason: 'no_fit_pair' }`; `'light'` returns a successful Mei + Arjun pair.

## 8. UI — `Recommend.jsx` comparison row

- [x] 8.1 Import `SPLIT_POLICIES`, `splitRent` alongside the existing `assembleCohort`.
- [x] 8.2 Replace the `cohortResult` state with `cohortComparison` of shape `{ byPolicy: { equal, light, standard }, dismissed: Set<policy> } | null`.
- [x] 8.3 Update the reset effect (`useEffect ... [selectedId]`) to clear `cohortComparison`.
- [x] 8.4 The button label becomes "Suggest cohorts". On click, run `assembleCohort(prop, responses, { splitPolicy: key })` for each policy and set `cohortComparison.byPolicy`.
- [x] 8.5 Add a new functional component `CohortComparisonRow({ comparison, property, onDismissPolicy })` that renders the diagnostic strip above and three columns of `CohortResultCard`s below.
- [x] 8.6 Each card's header carries the policy label + per-room rents (`master S$X · common S$Y` — omit absent kinds).
- [x] 8.7 Each card has its own × button calling `onDismissPolicy(policyKey)`. When all three are dismissed, the whole `CohortComparisonRow` returns null.
- [x] 8.8 The diagnostic strip computes `count of policies where byPolicy[p].cohort !== null` and renders text like `2 of 3 produced a cohort`.
- [x] 8.9 Use CSS flex with `flex-wrap` so the row stacks on narrow viewports.

## 9. Spec sync with the in-progress changes

- [x] 9.1 Update `openspec/changes/add-cohort-pair-fit/specs/cohort-pair-fit/spec.md`: note the new `options.splitPolicy` parameter; re-pin Wei × Mei scenario to explicit policy `'standard'`.
- [x] 9.2 Update `openspec/changes/add-cohort-assembler/specs/cohort-assembly/spec.md`: note the new `options.splitPolicy`; re-pin Wei × Arjun × Mei worked example to standard.
- [x] 9.3 Update `openspec/changes/add-cohort-ui/specs/cohort-ui/spec.md`: click invokes assembler once per policy; comparison row spec lives in `split-policies` capability.

## 10. Verification

- [x] 10.1 `npm test` — existing 119 tests still pass; new tests pass. *137/137 (was 119; +18 new).*
- [x] 10.2 `npm run build` — clean build, no new warnings.
- [x] 10.3 `openspec validate add-split-policies-comparison --strict` passes. All four in-progress changes (this one + the three modified) validate.
- [ ] 10.4 Manual smoke (operator runs `npm run dev`): pick the Cohort Demo whole-unit property → click "Suggest cohorts" → three cards render. Switch property without counts → button hidden. Dismiss one card → other two stay. Dismiss all three → row hides. *Requires operator to drive the browser.*
