## ADDED Requirements

### Requirement: Pair-fit primitive for cohort assembly

The system SHALL expose a pure function `pairFitForProperty(a, b, prop)` that evaluates whether two response records describe customers who could share a whole-unit listing as housemates. The function returns either a structured decision object `{ score, verdict, criteria, blockers, notes, perPersonRent }` or the literal value `null` for comparisons that are nonsensical.

The function SHALL return `null` (not a decision) when ANY of the following hold:
- Both inputs reference the same identity (same `_id` when present, otherwise same object reference).
- Either input has `groupSize > 1` (the customer is part of a pre-formed group and is not eligible for cohort matching with strangers).

#### Scenario: Same customer compared with themselves
- **WHEN** `pairFitForProperty(wei, wei, prop)` is called with the same response object
- **THEN** the function returns `null`

#### Scenario: Same customer by `_id`
- **WHEN** `pairFitForProperty({ _id: 'r1', ... }, { _id: 'r1', ... }, prop)` is called
- **THEN** the function returns `null`

#### Scenario: One side has groupSize > 1
- **WHEN** `pairFitForProperty(soloA, groupOfThree, prop)` is called with `groupOfThree.groupSize === 3`
- **THEN** the function returns `null`

### Requirement: Hard blockers

The decision SHALL include a `blockers: string[]` field. When at least one blocker is present, `verdict` SHALL be `'unfit'`. The three supported blockers are:

- `consent_missing` — at least one side has `wantRoommate === false`.
- `lease_mismatch` — `parseLeaseMonths` succeeds on both sides AND the integer-month values differ.
- `budget_unaffordable` — at least one side has no room kind on the property within `budget.max + BUDGET_SOFT_OVERSHOOT` (S$200). Considers only room kinds the property actually has (i.e. requires `masterCount > 0` or `commonCount > 0` respectively).

Move-in date alignment is NOT a hard gate — co-tenants can have different move-in dates (the cohort coordinates one lease-start date downstream). Move-in only contributes to the score (see "Three-factor weighted scoring"). Unparseable `leaseLength` on either side SHALL NOT trigger the `lease_mismatch` blocker; instead the function emits a soft criterion plus a `note` flagging the operator to verify.

#### Scenario: Consent missing
- **WHEN** `pairFitForProperty({ wantRoommate: false, ... }, b, prop)` is called
- **THEN** `blockers` includes `'consent_missing'` and `verdict === 'unfit'`

#### Scenario: Move-in dates 65 days apart — no blocker
- **WHEN** `a.moveIn = '2026-06-01'` and `b.moveIn = '2026-08-05'`
- **THEN** `blockers` does NOT include `'movein_too_far'` and `verdict === 'fit'` (assuming no other blocker)
- **AND** the move-in factor contributes 0 points to the score

#### Scenario: Lease lengths differ (12 vs 6)
- **WHEN** both lease lengths parse but `parseLeaseMonths(a) === 12` and `parseLeaseMonths(b) === 6`
- **THEN** `blockers` includes `'lease_mismatch'`

#### Scenario: Lease lengths identical via different strings
- **WHEN** `a.leaseLength === '12 months'` and `b.leaseLength === '1 year'`
- **THEN** both parse to `12` and `'lease_mismatch'` is NOT a blocker

#### Scenario: One lease length unparseable
- **WHEN** `a.leaseLength === 'flexible'` (unparseable) and `b.leaseLength === '12 months'`
- **THEN** `'lease_mismatch'` is NOT a blocker; `notes` includes an entry flagging the unparseable field

#### Scenario: Budget unaffordable
- **WHEN** the cheapest room on the property exceeds one side's `budget.max + BUDGET_SOFT_OVERSHOOT`
- **THEN** `blockers` includes `'budget_unaffordable'`

### Requirement: Three-factor weighted scoring (sum 100)

`pairFitForProperty` SHALL accept an optional fourth argument `options` carrying `splitPolicy ∈ {'equal','light','standard'}` (default `'standard'`). The policy SHALL be threaded into `splitRent` and determine the per-room rents used by the budget assignment search. Invalid policy keys SHALL fall back to `'standard'` silently. Worked-example assertions below use the standard policy unless stated.

When no blocker fires, the decision SHALL include a `score` between 0 and 100 computed from three factors with the following weights:

- `budget`: weight 45. Pass (full points) when both sides have an affordable room on the property within their budget; soft (45% of weight) when at least one side fits only by overshooting their max by ≤ `BUDGET_SOFT_OVERSHOOT`.
- `commute`: weight 25. Pass when both sides' commute on the property is within their `commuteTolMins`; soft (40% of weight) when the over-tolerance overshoot ≤ `COMMUTE_SOFT_OVER` (15 minutes) for at least one side.
- `schedule — move-in`: weight 30. Pass when move-in dates are within 14 days; soft (40% of weight) when 14–30 days apart; **0 points when more than 30 days apart (no blocker — co-tenants negotiate a single lease-start date)**. Unparseable dates score as soft.

The `verdict` SHALL be `'fit'` when no blockers are present, regardless of score. Score is a quality signal; verdict is a feasibility signal.

#### Scenario: Wei × Arjun on Normanton Park 1M+2C @ S$4,500
- **WHEN** `pairFitForProperty(wei, arjun, normantonPark)` is called with the worked-trace fixtures (wei: 1200-1500, NUS, 2026-08-01, 12mo, tol 20; arjun: 1300-1600, NUS, 2026-08-10, 12mo, tol 25)
- **THEN** `score === 100`, `verdict === 'fit'`, `blockers === []`

#### Scenario: Wei × Mei (cross-budget cohort works because rooms differ — under the standard policy)
- **WHEN** wei (budget 1200-1500) and mei (budget 1600-2000) are compared on Normanton Park 1M+2C with `splitPolicy: 'standard'` (or default)
- **THEN** the budget factor passes because Wei→common (S$1,350 fits 1200-1500) and Mei→master (S$1,800 fits 1600-2000)
- **AND** `perPersonRent` is `{ <wei-id>: { rent: 1350, roomKind: 'common' }, <mei-id>: { rent: 1800, roomKind: 'master' } }`

### Requirement: Per-person rent assignment

The decision SHALL include a `perPersonRent` object keyed by each side's identifier (the response's `_id` if present, otherwise `'a'` and `'b'` as positional fallbacks). Each entry has `{ rent: number, roomKind: 'master'|'common' }` describing the cheapest room slot the side could take. The assignment SHALL be feasible — i.e. the property's `masterCount` and `commonCount` SHALL be sufficient to accommodate both assignments simultaneously (e.g. both `common` requires `commonCount >= 2`).

When more than one feasible assignment exists, the assignment chosen SHALL minimise `max(rent_a, rent_b)` — both sides get their cheapest available slot.

#### Scenario: Both can afford common, two commons exist
- **WHEN** wei and arjun are compared on a 1M+2C unit (both can afford the common at S$1,350)
- **THEN** `perPersonRent` assigns both to `common` with rent S$1,350 each

#### Scenario: Only one can afford master, two commons exist
- **WHEN** mei (1600-2000) and wei (1200-1500) are compared on a 1M+2C unit
- **THEN** mei is assigned the master and wei a common (the only feasible assignment given Wei cannot afford master)

#### Scenario: Both could afford master but only one master exists
- **WHEN** two high-budget customers compete for the single master on a 1M+2C unit
- **THEN** the assignment minimises `max(rent)` — both take common when feasible (`commonCount >= 2`), so neither pays the master premium

### Requirement: Operator-visible notes channel (lifestyle never scored)

The decision SHALL include a `notes: string[]` field carrying human-readable observations that do NOT affect `score` or `verdict`. The function SHALL emit notes for:

- Asymmetric lifestyle signals (`quiet`, `cooking`, `petFriendly`) where one side has the preference true and the other false.
- Non-empty `extras.note` free-text from either side, prefixed with the customer's name.
- Soft warnings (e.g. unparseable lease or move-in strings).

Lifestyle booleans SHALL NEVER add to or subtract from `score`. The factor weights cover only budget, commute, and move-in.

#### Scenario: Asymmetric quiet preference
- **WHEN** `a.extras.quiet === true` and `b.extras.quiet === false`
- **THEN** `notes` includes an entry such as `"<a.name> prefers quiet; <b.name> does not — mention in intro"`
- **AND** the `score` is identical to the score that would be computed if both had matching quiet values

#### Scenario: Free-text note from one side
- **WHEN** `a.extras.note === 'Prefer non-smoker'` and `b.extras.note === ''`
- **THEN** `notes` includes an entry such as `"<a.name>'s note: \"Prefer non-smoker.\""`

#### Scenario: Both lifestyle flags match
- **WHEN** both have `quiet: true`, `cooking: false`, `petFriendly: false`
- **THEN** no lifestyle entries appear in `notes` (matching values are silent)

### Requirement: Tolerant moveIn / leaseLength parsers

The system SHALL expose two parsers consumed by `pairFitForProperty` and also available to external callers:

- `parseMoveInDate(s)` — returns a JavaScript `Date` for parseable inputs (`'2026-08-01'`, `'Aug 2026'`, `'1 Aug 2026'`, etc.) or `null` for unparseable inputs (including `''`, `null`, `'immediate'`, `'ASAP'`, `'flexible'`).
- `parseLeaseMonths(s)` — returns a positive integer for parseable inputs (`'12 months'` → 12, `'1 year'` → 12, `'12mo'` → 12, `'半年'` → 6, `'一年'` → 12, `'6+6'` → 12) or `null` for unparseable inputs (`''`, `null`, `'flexible'`).

Both parsers SHALL be deterministic and side-effect-free.

#### Scenario: parseMoveInDate accepts ISO format
- **WHEN** `parseMoveInDate('2026-08-01')` is called
- **THEN** the result is a `Date` whose UTC year is 2026, month is August, day is 1

#### Scenario: parseMoveInDate rejects "immediate"
- **WHEN** `parseMoveInDate('Immediate')` is called
- **THEN** the result is `null`

#### Scenario: parseLeaseMonths normalises common variants
- **WHEN** `parseLeaseMonths('1 year')` and `parseLeaseMonths('12 months')` and `parseLeaseMonths('12mo')` are called
- **THEN** all three return `12`

#### Scenario: parseLeaseMonths accepts Chinese variants
- **WHEN** `parseLeaseMonths('半年')` and `parseLeaseMonths('一年')` are called
- **THEN** they return `6` and `12` respectively
