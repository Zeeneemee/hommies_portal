## ADDED Requirements

### Requirement: Cohort assembly primitive

The system SHALL expose a pure function `assembleCohort(prop, pool, options?)` that, given a whole-unit property and a pool of response records, returns either a structured cohort decision or `null` with a structured reason. The function SHALL be deterministic given the same input pool order and SHALL NOT mutate its inputs.

The `options` argument MAY include `splitPolicy ∈ {'equal','light','standard'}` (default `'standard'`). The policy is threaded into every internal `pairFitForProperty` call and into the final `splitRent` used for room assignment, so the cohort's per-person rents reflect the selected policy. Worked-example assertions below use the standard policy unless stated.

The function SHALL return `{ cohort, cohortScore, roomAssignments, notes, pairFits, reason: null }` on success and `{ cohort: null, reason }` on failure (where `reason` is one of: `'property_not_splittable'`, `'no_eligible_candidates'`, `'pool_too_small'`, `'no_fit_pair'`, `'cohort_incomplete'`, `'no_valid_room_assignment'`).

#### Scenario: Wei × Arjun × Mei on Normanton Park 1M+2C — standard policy
- **WHEN** `assembleCohort(normantonPark, [wei, arjun, mei])` is called with no options (or with `{ splitPolicy: 'standard' }`)
- **THEN** the result includes a `cohort` of length 3 containing all three responses
- **AND** `roomAssignments[mei._id]` is `{ rent: 1800, roomKind: 'master' }`
- **AND** `roomAssignments[wei._id]` and `roomAssignments[arjun._id]` are `{ rent: 1350, roomKind: 'common' }`
- **AND** the assigned rents sum to 4500 (the unit rent)

#### Scenario: Property not a whole unit
- **WHEN** `assembleCohort({ housingType: 'Room', ... }, pool)` is called
- **THEN** the result is `{ cohort: null, reason: 'property_not_splittable' }`

#### Scenario: Property has no room counts
- **WHEN** `assembleCohort({ housingType: 'Whole Unit', masterCount: undefined, commonCount: undefined, ... }, pool)` is called
- **THEN** the result is `{ cohort: null, reason: 'property_not_splittable' }`

### Requirement: Eligibility filter

Before assembly, the system SHALL filter the input pool to retain only response records satisfying ALL of:
- `wantRoommate === true`
- `housingType === 'Room'`
- `(groupSize ?? 1) === 1`

Customers who opted out of roommates, prefer the whole unit alone, or arrived as a pre-formed group SHALL be excluded from the cohort. The filter SHALL NOT consider them even if the cohort would otherwise be unfillable.

#### Scenario: Mixed wantRoommate pool
- **WHEN** the pool contains [opted-in A, opted-out B, opted-in C, opted-in D] for a 3-bedroom unit
- **THEN** the eligible pool is [A, C, D] only
- **AND** the cohort, if assembled, never includes B

#### Scenario: Pre-formed group in pool
- **WHEN** the pool contains a response with `groupSize === 3`
- **THEN** that response is excluded from cohort assembly

#### Scenario: "Whole Unit" preference excludes the customer
- **WHEN** the pool contains a response with `housingType === 'Whole Unit'`
- **THEN** that response is excluded from cohort assembly

#### Scenario: Empty eligible pool
- **WHEN** every pool member fails the eligibility filter
- **THEN** the result is `{ cohort: null, reason: 'no_eligible_candidates' }`

### Requirement: Target cohort size

The target cohort size SHALL equal `prop.masterCount + prop.commonCount`. The function SHALL NOT return partial cohorts smaller than the target.

#### Scenario: Pool smaller than target
- **WHEN** the eligible pool has 2 members for a 3-bedroom unit
- **THEN** the result is `{ cohort: null, reason: 'pool_too_small' }`

#### Scenario: Pool exactly matches target
- **WHEN** the eligible pool has exactly 3 members for a 3-bedroom unit
- **THEN** the assembler attempts the only possible cohort; if any pair is `unfit`, returns `{ cohort: null, reason: 'cohort_incomplete' }`

### Requirement: Seed pair selection

The system SHALL compute `pairFitForProperty(a, b, prop)` for every distinct pair in the eligible pool, drop `null` returns and `unfit` verdicts, and select the seed pair as the one with the highest `score`. Ties on score SHALL be broken by tightest move-in window across the pair (smallest day difference between parsed move-in dates).

#### Scenario: One clearly best pair
- **WHEN** pair (A, B) scores 100 and all others score ≤ 80
- **THEN** the seed is (A, B)

#### Scenario: Tie broken by tightest move-in span
- **WHEN** pairs (A, B) and (A, C) both score 100, A and B's move-ins are 3 days apart, A and C's are 21 days apart
- **THEN** the seed is (A, B)

#### Scenario: No fit pair exists
- **WHEN** every pair in the eligible pool returns `verdict: 'unfit'` or `null`
- **THEN** the result is `{ cohort: null, reason: 'no_fit_pair' }`

### Requirement: Grow step — anti-fragile candidate ranking

After the seed pair is selected, the system SHALL grow the cohort one member at a time until `cohort.length === target`. At each step, the system SHALL rank remaining eligible candidates by the **minimum** pair-fit score between the candidate and every current cohort member, and select the candidate with the highest minimum. Candidates with any `unfit` pair to a current cohort member SHALL be excluded.

Ties on the minimum metric SHALL be broken by:
1. Sum of pair-fit scores to current cohort (higher wins).
2. Stable input pool order.

When no remaining candidate qualifies, the result SHALL be `{ cohort: null, reason: 'cohort_incomplete' }`.

#### Scenario: Anti-fragile choice
- **WHEN** the cohort is {A, B} and candidates are C (pair-fits A=100, B=60) and D (pair-fits A=80, B=80)
- **THEN** D is added next (min 80 > min 60)

#### Scenario: Unfit pair blocks an otherwise-strong candidate
- **WHEN** cohort is {A, B}, candidate C has `verdict: 'unfit'` with B
- **THEN** C is not eligible regardless of pair-fit with A

#### Scenario: Cohort cannot be completed
- **WHEN** cohort needs one more member but every remaining candidate has an `unfit` pair with someone already in
- **THEN** the result is `{ cohort: null, reason: 'cohort_incomplete' }`

### Requirement: Room assignment

After the cohort is assembled, the system SHALL assign each cohort member a room kind (`'master'` or `'common'`) such that:
- The total number of master assignments equals `prop.masterCount`.
- The total number of common assignments equals `prop.commonCount`.
- Each member's assigned rent is at most their `budget.max + BUDGET_SOFT_OVERSHOOT`.

The assignment policy SHALL be: sort cohort by `budget.max` descending, assign the top `masterCount` to master, the rest to common. If the highest-budget member cannot afford master, the system SHALL attempt a swap with a lower-ranked member who can. If no valid assignment exists after at most one swap, the result SHALL be `{ cohort: null, reason: 'no_valid_room_assignment' }`.

The output `roomAssignments` SHALL be a record keyed by response `_id` (fallback to positional index when `_id` is absent), each value `{ rent: number, roomKind: 'master'|'common' }`. The sum of assigned rents SHALL equal `prop.rentSGD` within standard floating-point tolerance.

#### Scenario: Top budget takes master (1M+2C)
- **WHEN** cohort is [Mei (max 2000), Wei (max 1500), Arjun (max 1600)] on a 1M+2C @ S$4,500
- **THEN** Mei is assigned master at S$1,800; Wei and Arjun each take common at S$1,350

#### Scenario: All-common layout (0M+3C)
- **WHEN** the property has `masterCount === 0` and `commonCount === 3`
- **THEN** every cohort member is assigned common at the same rent

#### Scenario: Rent conserves to property rent
- **WHEN** any successful cohort is returned
- **THEN** `sum(roomAssignments[member].rent for each member) === prop.rentSGD` (within floating-point tolerance)

### Requirement: cohortScore is the mean of intra-cohort pair-fits

The output `cohortScore` SHALL be `round(sum(p.score for p in pairFits) / pairFits.length)` — the mean of every intra-cohort pair-fit score. The score SHALL be in the range 0–100 and comparable to a single pair-fit score.

#### Scenario: All pairs score 100
- **WHEN** every intra-cohort pair scores 100
- **THEN** `cohortScore === 100`

#### Scenario: One weak pair drags the mean
- **WHEN** a trio's pair-fits are 100, 100, 60
- **THEN** `cohortScore === 87` (round(260/3))

### Requirement: pairFits in the output

The output SHALL include a `pairFits` array of `{ a, b, score }` entries — one entry per distinct intra-cohort pair, using each member's `_id` (or positional index when absent). The array SHALL be stable in order so UI rendering is deterministic.

#### Scenario: Three-person cohort exposes 3 pair-fits
- **WHEN** a 3-person cohort is returned
- **THEN** `pairFits.length === 3` (C(3,2) = 3 pairs)
- **AND** each entry has `{ a, b, score }` keys with member ids

### Requirement: Notes aggregation

The output `notes` SHALL include all notes from every intra-cohort pair-fit, deduplicated by string equality, preserving the order they first appear. The system SHALL prepend a structural note describing the room assignment (e.g. naming who takes master and why).

#### Scenario: Master assignment is announced in notes
- **WHEN** a cohort is returned with Mei taking the master because of budget
- **THEN** `notes[0]` mentions Mei and the master assignment

#### Scenario: Pair-fit notes are deduplicated
- **WHEN** two intra-cohort pair-fits both emit the same lifestyle note (e.g. about a shared free-text note from one member)
- **THEN** the note appears only once in the aggregated `notes` array

### Requirement: cohortMoveInSpan helper

The system SHALL expose `cohortMoveInSpan(cohort)` — a pure function returning the day span between the earliest and latest parseable move-in dates across the cohort. When fewer than 2 members have parseable move-ins, the function SHALL return `null`.

#### Scenario: Computing span across 3 members
- **WHEN** cohort members have move-ins 2026-08-01, 2026-08-10, 2026-08-05
- **THEN** `cohortMoveInSpan(cohort) === 9` (Aug 10 minus Aug 1)

#### Scenario: All move-ins unparseable
- **WHEN** every cohort member has `moveIn === 'Immediate'` or empty
- **THEN** `cohortMoveInSpan(cohort) === null`

### Requirement: COHORT_TIE_BREAKERS documents canonical ordering

The system SHALL export an immutable `COHORT_TIE_BREAKERS` array containing the strings `'sum_pair_fits'`, `'movein_span'`, `'budget_spread'` in that order. The array SHALL be frozen so external callers cannot mutate it.

#### Scenario: Tie-breaker array is the canonical ordering
- **WHEN** any caller imports `COHORT_TIE_BREAKERS`
- **THEN** the value is `['sum_pair_fits', 'movein_span', 'budget_spread']` and `Object.isFrozen(COHORT_TIE_BREAKERS) === true`
