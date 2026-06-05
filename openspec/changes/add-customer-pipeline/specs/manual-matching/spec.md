## ADDED Requirements

### Requirement: Operator can manually pin any (customer, property) pair

The system SHALL allow the operator to create a `pinned` assignment for any selected customer and any selected property, regardless of the `decide()` verdict or score, via a "Manual match" workflow.

Manual single pins SHALL be written to the `assignments` table with `pinnedReason: 'manual-match'`. The `pinnedScore` SHALL be the current `decide()` score, or `0` if the property is not matchable.

The picker UIs within the Manual match workflow SHALL exclude customers classified as **moved_in** by the customer-pipeline capability.

#### Scenario: Pin a customer to a property the engine would Hold

- **WHEN** the operator opens Manual match, picks customer Alice and property Riverwalk where `decide(Alice, Riverwalk)` returns verdict `'hold'` with score 40, and confirms the pin
- **THEN** a new `assignments` row is created with `responseId = Alice`, `propertyId = Riverwalk`, `status: 'pinned'`, `pinnedScore: 40`, `pinnedReason: 'manual-match'`.

#### Scenario: Closed customers are hidden in the customer picker

- **WHEN** the operator opens the customer picker inside the Manual match modal
- **THEN** any customer with an moved-in `deals` row is not listed.

#### Scenario: Manual pin appears in Must-send

- **WHEN** the operator successfully creates a manual single pin
- **THEN** the corresponding property's Recommend view shows the pair in the Must-send section, identical to any other pinned assignment.

### Requirement: Operator can manually group customers into a roommate cohort

The system SHALL allow the operator to select a whole-unit property and N customers, and pin the entire group in a single atomic write via an `assignments:pinMany` mutation.

Each cohort member SHALL be persisted as a separate `assignments` row with `pinnedReason: 'manual-cohort'`. All rows SHALL share the same `propertyId` and SHALL be written in a single Convex transaction so that a failure leaves zero rows committed for that batch.

The cohort builder SHALL only enable the **Pin cohort** action when:
- The selected property's `housingType` is `'Whole Unit'`.
- `masterCount + commonCount > 0`.
- The number of selected customers equals `masterCount + commonCount`.

#### Scenario: Pin a 3-person cohort for a 1M+2C unit

- **WHEN** the operator selects property Sunrise (Whole Unit, masterCount=1, commonCount=2) and customers Alice, Bob, Cara, then clicks "Pin cohort"
- **THEN** three `assignments` rows are written atomically with `propertyId = Sunrise`, `status: 'pinned'`, `pinnedReason: 'manual-cohort'`, one per customer.

#### Scenario: Atomic failure on partial batch

- **WHEN** `assignments:pinMany` fails partway through writing a 3-member cohort
- **THEN** no rows from that batch are committed and the operator sees a single error toast.

#### Scenario: Pin cohort disabled for non-whole-unit property

- **WHEN** the operator opens the manual cohort builder on a property where `housingType !== 'Whole Unit'`
- **THEN** the **Pin cohort** action is disabled.

#### Scenario: Pin cohort disabled when selection count mismatches room count

- **WHEN** the property has `masterCount=1, commonCount=2` (3 rooms) and the operator has selected only 2 customers
- **THEN** the **Pin cohort** action is disabled.

#### Scenario: Soft warning for non-roommate-seeking customer

- **WHEN** the operator includes a customer with `wantRoommate: false` in a cohort
- **THEN** the UI shows a non-blocking warning explaining the customer did not opt into roommates, but the **Pin cohort** action remains enabled.

#### Scenario: Closed customers are excluded from cohort selection

- **WHEN** the operator opens the cohort builder's customer picker
- **THEN** any customer with an moved-in `deals` row is not listed.

### Requirement: Manually created assignments are distinguishable in audit

The system SHALL preserve the `pinnedReason` field on every manually created assignment so that downstream views and exports can distinguish auto-pinned, override-pinned, manual-match, and manual-cohort assignments.

Existing assignments with `pinnedReason: undefined` (auto-pin from Suggestion) or `pinnedReason: 'operator-override'` (from Hold list) SHALL continue to work unchanged.

#### Scenario: pinnedReason persisted on manual pins

- **WHEN** a manual single pin is created
- **THEN** the `assignments` row has `pinnedReason: 'manual-match'`.

#### Scenario: pinnedReason persisted on cohort pins

- **WHEN** a manual cohort is pinned
- **THEN** every row in the batch has `pinnedReason: 'manual-cohort'`.

#### Scenario: Existing pins keep working

- **WHEN** a row pre-dates this change and has `pinnedReason: undefined`
- **THEN** it still renders in Must-send and supports Mark sent / Unpin without errors.

### Requirement: Unpin behaviour for manual cohorts

The system SHALL allow each cohort member to be unpinned independently via the existing `assignments:unpin` mutation. A v1 implementation is NOT required to provide a "unpin whole cohort" affordance.

#### Scenario: Unpin one cohort member

- **WHEN** the operator clicks Unpin on one member of a 3-person manual cohort
- **THEN** only that member's `assignments` row gets `unpinnedAt` set; the other two remain pinned.
