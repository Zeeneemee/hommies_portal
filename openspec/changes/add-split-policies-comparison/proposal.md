## Why

The current pair-fit and cohort engines hard-code a single split policy: master pays 1.20× the per-room average. Tracing Regent Heights (1M+1C @ S$3,800) against the live customer pool just exposed the consequence — the master rent (S$2,280) is above every customer's budget ceiling + soft margin, so every pair returns `budget_unaffordable` and the cohort UI shows a failure card. Under a softer 10% premium the master drops to S$2,090 and the demo Mei+Arjun pair becomes feasible; under a flat 50/50 split (master = common = S$1,900) much more of the pool fits.

The premium is not a property attribute — it's a negotiation lever between tenants. The operator should be able to see, for one property, what the cohort looks like under each policy simultaneously, then pick the one that matches the conversation they're having with the customers. Today they see one number and the system gives one verdict; with three policies side-by-side the operator gets the full menu and can steer the negotiation honestly.

## What Changes

- Replace the `MASTER_PREMIUM = 1.20` constant with `SPLIT_POLICIES = { equal:1.00, light:1.10, standard:1.20 }` in `src/decisionLogic.js`. Add `DEFAULT_SPLIT_POLICY = 'standard'`. Keep `MASTER_PREMIUM` as a back-compat alias bound to `standard.premium`.
- `splitRent(prop, policy = 'standard')` accepts a policy key and uses the corresponding premium.
- `pairFitForProperty(a, b, prop, options)` accepts `options.splitPolicy` (default `'standard'`) and threads it into `splitRent`.
- `assembleCohort(prop, pool, options)` accepts `options.splitPolicy` and passes through.
- `src/components/Recommend.jsx` renders cohort results as a **horizontal three-card grid**, one per policy. Each card uses the existing `CohortResultCard` rendering and is independently dismissible (× per card). The "Suggest cohort" button label tweaks to "Suggest cohorts" (plural).
- Each card surfaces a per-room rent line (e.g. `master S$2,090 · common S$1,710`) plus the existing success/failure variants.
- Tests gain explicit per-policy variants in `src/decisionLogic.test.js`. Existing tests keep passing because the default policy is `'standard'` and reproduces today's behaviour.
- The capability specs that previously hard-coded `× 1.20` get updated in place: `add-cohort-pair-fit/specs/cohort-pair-fit/spec.md`, `add-cohort-assembler/specs/cohort-assembly/spec.md`, and `add-cohort-ui/specs/cohort-ui/spec.md`. Those changes haven't been archived yet, so updating them in place is the honest move.

No schema changes. No new convex mutations. No new external dependencies. Non-breaking — every existing caller of `splitRent` / `pairFitForProperty` / `assembleCohort` keeps the same behaviour because the default policy preserves the 20% premium.

## Capabilities

### New Capabilities
- `split-policies`: defines the three-policy enum, the `policy` parameter contract on `splitRent` / `pairFitForProperty` / `assembleCohort`, and the side-by-side comparison surface on the Recommend page.

### Modified Capabilities
<!-- The prior cohort capabilities have not been archived to openspec/specs/ yet —
     their specs live in their respective change folders. The tasks here include
     in-place updates to those specs so they reflect the new policy parameter
     once any of them is eventually archived. -->

## Impact

- `src/decisionLogic.js`: refactor `MASTER_PREMIUM` into `SPLIT_POLICIES` + `DEFAULT_SPLIT_POLICY`, thread `policy` argument through `splitRent`, `pairFitForProperty`, `assembleCohort`. ~30 lines net.
- `src/decisionLogic.test.js`: add policy-explicit tests for `equal`, `light`, `standard`. Existing 119 tests keep passing by default.
- `src/components/Recommend.jsx`: restructure cohort result rendering as a 3-column row of `CohortResultCard`s wrapped in a new `CohortComparisonRow`. The state shape changes from `cohortResult: Result | null` to `cohortResults: { equal, light, standard, dismissed } | null`. Reset-on-property-change behaviour preserved.
- Spec updates in the three prior in-progress changes: re-pin worked-example scenarios to explicit policies; add new scenarios for `equal` and `light`.
- No convex schema changes. No new mutations. No new convex queries.
- Non-breaking: default policy is `'standard'`, which reproduces today's premium exactly. External callers that don't pass a policy see no behavioural difference.
