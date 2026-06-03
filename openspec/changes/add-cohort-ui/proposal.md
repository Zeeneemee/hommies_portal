## Why

`add-cohort-pair-fit` and `add-cohort-assembler` shipped the two headless layers (pair scoring and N-person assembly) but neither surfaces in the portal. Operators looking at a whole-unit listing on the Recommend page still see the existing single-customer engine output — there is no way to ask "find me 3 compatible solos for this 3-bedroom unit" without dropping into a Node REPL. This change adds the thinnest possible UI on top of `assembleCohort` so the feature becomes usable.

The scope is deliberately narrow: a "Suggest cohort" button on the property summary card, plus a result card that renders the assembler's output. No pinning, no drafting, no multi-cohort comparison — just surface what the assembler returns. Those follow-on flows are separate changes once operators actually have hands on the feature.

This change also captures, retroactively, one logic relaxation that landed alongside the UI: the `movein_too_far` hard blocker in `pairFitForProperty` was removed. Move-in dates now contribute to the score (full 30 ≤14d, 12 14–30d, 0 >30d) but no longer gate the pair. The cohort coordinates a single lease-start date downstream, so identical move-in dates are not a co-tenancy requirement. The pair-fit spec was updated in `add-cohort-pair-fit` to reflect this; no separate spec change is needed here.

## What Changes

- Add a "Suggest cohort" button to the property summary card in `src/components/Recommend.jsx` → `ByPropertyView`. Visible ONLY when the selected property is a whole unit with both `masterCount` and `commonCount` defined and their sum > 0.
- On click, the button calls `assembleCohort(prop, responses)` and stores the result in component state. The result is rendered as a new `CohortResultCard` between the property summary card and the existing AssignmentSection blocks.
- `CohortResultCard` has two visual variants: success (navy left border, with member rows, room assignments, cohort score, pair-fits, notes) and failure (warn left border, with a friendly translation of the structured reason via a `COHORT_REASON_COPY` map). Both variants have a dismiss button (×).
- `cohortResult` state lives in `ByPropertyView`. It resets to `null` whenever the selected property changes, so navigating between properties never shows a stale suggestion.
- Friendly copy for every assembler failure reason (`property_not_splittable`, `no_eligible_candidates`, `pool_too_small`, `no_fit_pair`, `cohort_incomplete`, `no_valid_room_assignment`). Operators never see raw reason codes.

## Capabilities

### New Capabilities
- `cohort-ui`: defines the operator-facing surface for cohort matching on the Recommend page — when the button is visible, what the result card displays for success and failure, the friendly reason copy, and the state lifecycle (reset on property switch, dismiss on close).

### Modified Capabilities
<!-- The relaxation of the movein hard blocker was applied in-place to the existing add-cohort-pair-fit spec (which hasn't been archived yet). No delta required here. -->

## Impact

- `src/components/Recommend.jsx` — adds `assembleCohort` import, `cohortResult` state + reset effect, button + inline copy in the property summary card, conditional render of `CohortResultCard`, and the new helper component + `COHORT_REASON_COPY` map. No changes to existing component surfaces (`PropertyMatchCard`, `ClientMatchCard`, `AssignmentSection`).
- No convex schema changes. No new mutations / queries. No new external dependencies.
- Non-breaking: properties without `masterCount` / `commonCount` see no UI difference. Properties with the counts get the new button alongside their existing match results.
- Side note: `pairFitForProperty` in `src/decisionLogic.js` had its `movein_too_far` blocker removed (move-in is now scored only). The spec for that capability was updated in-place. Tests for the removed-blocker scenario were updated to assert "no blocker, score drops by move-in weight".
