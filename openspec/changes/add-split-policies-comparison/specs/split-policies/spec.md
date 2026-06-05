## ADDED Requirements

### Requirement: Three named split policies

The system SHALL expose an immutable enum `SPLIT_POLICIES` from `src/decisionLogic.js` with exactly three keys — `equal`, `light`, `standard` — each mapping to a `{ label: string, premium: number }` object. The premium values SHALL be `1.00`, `1.10`, and `1.20` respectively. The system SHALL also export `DEFAULT_SPLIT_POLICY` set to `'standard'`.

The enum object SHALL be frozen (`Object.isFrozen(SPLIT_POLICIES) === true`) so external callers cannot mutate it.

For backward compatibility, the system SHALL continue to export `MASTER_PREMIUM` bound to `SPLIT_POLICIES.standard.premium` so any caller still importing it sees the same value as before.

#### Scenario: Enum has exactly three policies in order equal, light, standard
- **WHEN** any caller imports `SPLIT_POLICIES`
- **THEN** `Object.keys(SPLIT_POLICIES)` is `['equal', 'light', 'standard']`
- **AND** `SPLIT_POLICIES.equal.premium === 1.00`
- **AND** `SPLIT_POLICIES.light.premium === 1.10`
- **AND** `SPLIT_POLICIES.standard.premium === 1.20`

#### Scenario: Enum is frozen
- **WHEN** code attempts to assign a new key onto `SPLIT_POLICIES`
- **THEN** the object is frozen and the assignment has no effect (in strict mode it throws)

#### Scenario: Backward-compat alias preserved
- **WHEN** legacy code imports `MASTER_PREMIUM`
- **THEN** the value is `1.20` (identical to `SPLIT_POLICIES.standard.premium`)

### Requirement: `splitRent` accepts a policy parameter

The system SHALL extend `splitRent(prop, policy)` to accept a policy key string as a second positional argument. When omitted or invalid, the function SHALL use `DEFAULT_SPLIT_POLICY` (`'standard'`). The premium multiplier SHALL be looked up from `SPLIT_POLICIES[policy].premium`.

All other return-shape semantics (`{ master, common, perRoomAvg } | null`, the rent-conservation invariant, the all-master / all-common edge cases) remain unchanged.

#### Scenario: Default policy reproduces today's behaviour
- **WHEN** `splitRent({ rentSGD: 4300, masterCount: 1, commonCount: 1 })` is called with no policy
- **THEN** the result is `{ master: 2580, common: 1720, perRoomAvg: 2150 }` (the 20% premium output)

#### Scenario: Equal policy returns identical master and common
- **WHEN** `splitRent({ rentSGD: 4300, masterCount: 1, commonCount: 1 }, 'equal')` is called
- **THEN** the result is `{ master: 2150, common: 2150, perRoomAvg: 2150 }` (1.00 premium)

#### Scenario: Light policy applies 10% premium
- **WHEN** `splitRent({ rentSGD: 4300, masterCount: 1, commonCount: 1 }, 'light')` is called
- **THEN** the result satisfies `master === perRoomAvg * 1.10` and `1 * master + 1 * common === 4300`

#### Scenario: Standard policy is the explicit form of the default
- **WHEN** `splitRent(prop, 'standard')` is called against any prop
- **THEN** the result equals `splitRent(prop)` for the same prop (default and explicit standard are identical)

#### Scenario: Invalid policy falls back to standard
- **WHEN** `splitRent(prop, 'whatever-typo')` is called
- **THEN** the result equals `splitRent(prop, 'standard')` (silent fallback, no throw)

#### Scenario: Rent conserves under every policy
- **WHEN** `splitRent` returns a non-null result under any of the three policies
- **THEN** the assigned rents sum to the unit rent (within standard floating-point tolerance)

### Requirement: `pairFitForProperty` accepts `options.splitPolicy`

The system SHALL extend `pairFitForProperty(a, b, prop, options)` to accept an `options` object as a fourth argument with an optional `splitPolicy` field. The function SHALL pass `options.splitPolicy` (defaulting to `DEFAULT_SPLIT_POLICY` when absent or invalid) to `splitRent` and use the resulting per-room rents for the budget assignment search.

All other return-shape semantics (`{ score, verdict, criteria, blockers, notes, perPersonRent } | null`, the four blocker reasons, the three scored factors) remain unchanged.

#### Scenario: Default policy preserves the existing pair-fit numbers
- **WHEN** `pairFitForProperty(wei, mei, normantonPark)` is called against the existing fixtures with no options
- **THEN** the result is identical to `pairFitForProperty(wei, mei, normantonPark, { splitPolicy: 'standard' })`

#### Scenario: Equal policy unlocks otherwise-unaffordable pairs
- **WHEN** two customers with budgets that cannot fit any room under `'standard'` are evaluated under `'equal'` (where master == common == rent/N)
- **THEN** if their combined budgets each cover `rentSGD / target`, the pair returns `verdict: 'fit'` instead of `budget_unaffordable`

#### Scenario: Invalid policy in options falls back to standard
- **WHEN** `pairFitForProperty(a, b, prop, { splitPolicy: 'whatever' })` is called
- **THEN** the result equals the same call with `splitPolicy: 'standard'`

### Requirement: `assembleCohort` accepts `options.splitPolicy`

The system SHALL extend `assembleCohort(prop, pool, options)` to read `options.splitPolicy` (defaulting to `DEFAULT_SPLIT_POLICY` when absent or invalid) and pass it through to every internal `pairFitForProperty` call. The returned cohort's `roomAssignments` SHALL reflect the policy-specific per-room rents.

All other return-shape semantics (`{ cohort, cohortScore, roomAssignments, notes, pairFits, reason }`, the six failure reasons, the eligibility filter, the greedy seed-and-grow algorithm, the room-assignment policy) remain unchanged.

#### Scenario: Default policy reproduces today's cohort output
- **WHEN** `assembleCohort(normantonPark, [wei, arjun, mei])` is called with no options
- **THEN** `roomAssignments['r-mei']` is `{ rent: 1800, roomKind: 'master' }` (the standard-policy assignment)

#### Scenario: Equal policy assigns every member the same rent
- **WHEN** `assembleCohort(normantonPark, [wei, arjun, mei], { splitPolicy: 'equal' })` is called on a 1M+2C @ S$4,500 unit
- **THEN** every member's `roomAssignments[id].rent === 1500` (equal split: 4500 / 3)

#### Scenario: Light policy produces intermediate master/common values
- **WHEN** `assembleCohort(normantonPark, [wei, arjun, mei], { splitPolicy: 'light' })` is called on a 1M+2C @ S$4,500 unit
- **THEN** `roomAssignments['r-mei'].rent` is the light-policy master rent (avg × 1.10) and the cohort still includes Mei as the master-taker
- **AND** the sum of assigned rents conserves to S$4,500

#### Scenario: Regent Heights 1M+1C @ S$3,800 under three policies
- **WHEN** `assembleCohort(regentHeights, pool, { splitPolicy: <p> })` is called for each policy against the actual pool
- **THEN** under `'equal'` (master = common = S$1,900), candidates with `budget.max >= 1,700` can fit
- **AND** under `'light'` (master 2,090, common 1,710), Mei (max 2,000) + Arjun (max 1,600) form a fit pair via soft-margin assignments
- **AND** under `'standard'` (master 2,280, common 1,520), no pair fits and the result is `{ cohort: null, reason: 'no_fit_pair' }`

### Requirement: Side-by-side cohort comparison in the Recommend UI

The Recommend page's by-property view SHALL render three cohort result cards side-by-side when the operator clicks the cohort suggestion button. Each card corresponds to one of the three policies and SHALL display:

- A header showing the policy label (e.g. "Equal split (50/50)").
- The per-room rents under that policy (e.g. "master S$2,090 · common S$1,710"). When a room kind doesn't exist on the property (`masterCount === 0` or `commonCount === 0`), the absent kind is omitted from the header.
- Below the header, the existing success-or-failure body from `CohortResultCard` rendering against the policy-specific result.

Each card SHALL have an independent dismiss button (×) that hides only that card. When all three cards are dismissed, the row SHALL be hidden entirely. The order of cards from left to right SHALL be fixed at `equal`, `light`, `standard`. The row SHALL also display a diagnostic strip above the cards summarising "X cohort fit at equal · Y at light · Z at standard" where each count is 1 if the policy produced a successful cohort and 0 if it returned a failure result.

The cohort suggestion button label SHALL read "Suggest cohorts" (plural) to telegraph that the click produces three results, not one. Visibility gating for the button is unchanged (whole unit with both counts defined).

#### Scenario: Button click renders three cards
- **WHEN** the operator clicks "Suggest cohorts" on a qualifying property
- **THEN** three `CohortResultCard`-style cards render in a horizontal grid in the order equal, light, standard

#### Scenario: Per-policy success and failure side-by-side
- **WHEN** on Regent Heights, the click produces a successful cohort under `'equal'` and `'light'` but a failure under `'standard'`
- **THEN** the first two cards render with the navy-border success variant and the third with the warn-border failure variant

#### Scenario: Diagnostic strip counts per policy
- **WHEN** three results are present, two successful and one failure
- **THEN** the diagnostic strip reads "2 cohorts fit at equal/light · 0 at standard" or equivalent wording showing successful policies

#### Scenario: Independent dismiss per card
- **WHEN** the operator clicks × on the `equal` card
- **THEN** only the `equal` card hides; the `light` and `standard` cards remain rendered

#### Scenario: All-dismissed hides the row
- **WHEN** the operator dismisses all three cards
- **THEN** the entire cohort comparison row is removed from the page (same behaviour as today's single-card dismiss)

#### Scenario: Property switch clears all three
- **WHEN** the operator changes the selected property in the picker
- **THEN** the cohort comparison row clears (resets to no results until the next click)
