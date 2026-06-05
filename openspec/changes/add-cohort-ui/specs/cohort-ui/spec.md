## ADDED Requirements

### Requirement: "Suggest cohort" button visibility

The Recommend page's by-property view SHALL display a "Suggest cohort" button on the property summary card if and only if the currently selected property satisfies all of:

- `property.housingType === 'Whole Unit'`
- `typeof property.masterCount === 'number'`
- `typeof property.commonCount === 'number'`
- `property.masterCount + property.commonCount > 0`

When any condition fails, the button section SHALL be absent (no disabled state, no greyed-out copy — just not rendered).

#### Scenario: Property is a 1M+2C whole unit
- **WHEN** the operator selects a property with `housingType: 'Whole Unit'`, `masterCount: 1`, `commonCount: 2`
- **THEN** the "Suggest cohort" button is visible on the property summary card

#### Scenario: Property is a Master Room rental
- **WHEN** the operator selects a property with `housingType: 'Room'` and `unitType: 'Master Room'`
- **THEN** the "Suggest cohort" button is NOT rendered

#### Scenario: Whole unit without room counts
- **WHEN** the operator selects a property with `housingType: 'Whole Unit'` but `masterCount` or `commonCount` undefined
- **THEN** the "Suggest cohort" button is NOT rendered

### Requirement: Click invokes `assembleCohort` synchronously

The "Suggest cohorts" button's click handler SHALL call `assembleCohort(property, responses, { splitPolicy: key })` synchronously once per policy in `SPLIT_POLICIES` and store the three returned objects in component state. The handler SHALL NOT show a loading spinner, defer the call, or fetch additional data — the assembler is a pure function that runs in well under one frame. The resulting comparison row is specified separately by the `split-policies` capability; this requirement only mandates the synchronous click semantics. (Pre-split-policies behaviour: a single click rendered one card under the implicit standard policy. The `split-policies` capability supersedes that into a three-card side-by-side row, but the underlying assembler-call-on-click invariant is unchanged.)

#### Scenario: Click renders a result card immediately
- **WHEN** the operator clicks "Suggest cohort" on a qualifying property
- **THEN** a `CohortResultCard` renders below the property summary on the next render cycle (no spinner, no delay)

### Requirement: Cohort result card — success variant

When `result.cohort` is a non-null array, the result card SHALL display:

- A header line `"Suggested cohort · ${cohort.length} of ${target}"` where `target = property.masterCount + property.commonCount`.
- A sub-header line `"Cohort fit ${cohortScore}/100 · rents conserve to S$${property.rentSGD}/mo"`.
- One row per cohort member showing: member name, school + budget range + lease length, and the assigned room kind + per-person rent (e.g. "S$1,800 master" or "S$1,350 common").
- A line listing intra-cohort pair-fit scores in stable order.
- A bulleted list of the assembler's `notes[]` strings (one bullet per note, preserving the assembler's ordering).
- A dismiss button (×) in the card header that clears the cohort state when clicked.

The card SHALL use a navy left border (`border-left: 3px solid var(--navy)`) to distinguish success from failure visually.

#### Scenario: Wei × Arjun × Mei trio renders with assignments
- **WHEN** `assembleCohort` returns a cohort of Wei, Arjun, Mei on a 1M+2C @ S$4,500 unit
- **THEN** the success card shows "Suggested cohort · 3 of 3" in the header
- **AND** a row for Mei with "S$1,800 master"
- **AND** rows for Wei and Arjun each with "S$1,350 common"
- **AND** a notes list including the structural room-assignment note

### Requirement: Cohort result card — failure variant

When `result.cohort === null`, the result card SHALL display:

- A header line `"No cohort suggestion"`.
- A friendly explanation looked up from `COHORT_REASON_COPY[result.reason]`.
- A fallback string `"Assembly failed: ${reason}."` when the reason has no mapped copy (defensive against unknown reason codes).
- A dismiss button (×) that clears the cohort state.

The card SHALL use a warn left border (`border-left: 3px solid var(--warn)`) to distinguish failure visually. The raw `result.reason` string SHALL NOT appear in any operator-visible text outside the fallback path.

#### Scenario: no_eligible_candidates failure
- **WHEN** `assembleCohort` returns `{ cohort: null, reason: 'no_eligible_candidates' }`
- **THEN** the failure card shows the copy "No customers in the pool opted in to roommates (wantRoommate=true)."
- **AND** the card border is the warn variant

#### Scenario: Unknown reason fallback
- **WHEN** `assembleCohort` returns `{ cohort: null, reason: 'some_future_reason' }` (a reason not in `COHORT_REASON_COPY`)
- **THEN** the failure card shows "Assembly failed: some_future_reason."

### Requirement: Friendly reason copy table

The component SHALL ship a `COHORT_REASON_COPY` static object mapping every failure reason emitted by `assembleCohort` to operator-facing copy:

- `property_not_splittable` → "This unit isn't set up for cohort matching — set master + common room counts in the listing editor."
- `no_eligible_candidates` → "No customers in the pool opted in to roommates (wantRoommate=true)."
- `pool_too_small` → "Not enough opted-in solo customers to fill every bedroom."
- `no_fit_pair` → "No two compatible customers in the pool — every pair is blocked on budget, consent, or lease length."
- `cohort_incomplete` → "Found a starting pair but couldn't extend to the full cohort — pool too thin or too divergent."
- `no_valid_room_assignment` → "Compatible cohort found but no room assignment fits every member's budget."

#### Scenario: Every documented reason has a mapping
- **WHEN** any of the six documented failure reasons is returned by the assembler
- **THEN** `COHORT_REASON_COPY` contains a non-empty string for that reason

### Requirement: State lifecycle — reset on property switch, dismiss on close

The `cohortResult` state SHALL live in `ByPropertyView` and SHALL reset to `null` whenever `selectedId` changes. The dismiss button (×) on either card variant SHALL set the state to `null` without changing the property selection.

#### Scenario: Switching property clears the suggestion
- **WHEN** the operator clicks "Suggest cohort" on property A, then selects property B in the property picker
- **THEN** the cohort card from property A is no longer rendered

#### Scenario: Dismiss closes without switching property
- **WHEN** the operator clicks the × button on a rendered cohort card
- **THEN** the cohort card disappears AND the selected property is unchanged

### Requirement: No side effects on `decide()` or existing match surfaces

The cohort UI SHALL NOT modify or replace the existing `AssignmentSection` blocks (Must send, Sent, Suggestions, Held back). Those continue to render exactly as before with the existing `decide()` engine output. The cohort card is additive — it appears between the property summary and the AssignmentSection stack.

#### Scenario: Existing match surfaces unchanged
- **WHEN** the operator selects any property
- **THEN** the Must send / Sent / Suggestions / Held back sections render with the same content they would have rendered before this change was applied
