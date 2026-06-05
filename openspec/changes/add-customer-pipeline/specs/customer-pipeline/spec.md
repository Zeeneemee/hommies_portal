## ADDED Requirements

### Requirement: Deal lifecycle table replaces sales

The system SHALL replace the existing `sales` table with a `deals` table that captures the leasing journey from LOI through move-in:

```
deals: {
  responseId, propertyId,
  stage: 'loi_sent' | 'loi_signed' | 'ta_issued' | 'moved_in',
  loiSentAt?, loiSignedAt?, taIssuedAt?, movedInAt?,
  finalRentSGD?, cancelledAt?,
}
```

Existing `sales` rows SHALL be migrated as `{ stage: 'moved_in', movedInAt: closedAt, cancelledAt: unclosedAt, finalRentSGD }`. A customer SHALL have at most one active (`!cancelledAt`) deal at any time, enforced by the `deals:start` mutation.

#### Scenario: Migrated rows preserve their identity

- **WHEN** the migration runs on a database with existing `sales` rows
- **THEN** every `sales` row produces exactly one `deals` row with `stage: 'moved_in'` and `movedInAt` equal to the original `closedAt`.

#### Scenario: Cannot start a second active deal

- **WHEN** the operator calls `deals:start` for a customer who already has an active (`!cancelledAt`) deal
- **THEN** the mutation rejects and no row is written.

### Requirement: Customer stage is derived from ledger state

The system SHALL classify every customer into exactly one stage at read time, computed from `assignments` and `deals`:

- **moved_in** — there is a `deals` row with `stage = 'moved_in'` and `cancelledAt` undefined.
- **ta_issued** — there is an active deal with `stage = 'ta_issued'`.
- **loi_signed** — there is an active deal with `stage = 'loi_signed'`.
- **loi_sent** — there is an active deal with `stage = 'loi_sent'`.
- **sent** — no active deal, but at least one `assignments` row with `status: 'sent'` exists.
- **not_contacted** — none of the above.

The classification SHALL NOT be persisted on the `responses` table.

#### Scenario: Customer with no assignments and no deals

- **WHEN** the Pipeline screen loads a customer who has no rows in `assignments` or `deals`
- **THEN** the customer appears in the **Not contacted** bucket.

#### Scenario: Customer with a sent assignment but no deal

- **WHEN** a customer has at least one `assignments.status = 'sent'` row and no active `deals` row
- **THEN** the customer appears in the **Sent** bucket.

#### Scenario: Customer with an LOI-signed deal

- **WHEN** a customer has an active `deals` row at `stage = 'loi_signed'`
- **THEN** the customer appears in the **LOI signed** bucket, regardless of any pinned or sent assignments.

#### Scenario: Customer with a moved-in deal

- **WHEN** a customer has a `deals` row with `stage = 'moved_in'` and `cancelledAt` undefined
- **THEN** the customer appears in the **Moved in** bucket.

#### Scenario: Cancelled deal drops the customer back

- **WHEN** a customer's only `deals` row has `cancelledAt` set
- **THEN** that row does NOT determine the customer's stage; their stage falls back to **Sent** (or **Not contacted** if no sent assignment exists).

### Requirement: Operator can advance a deal stage from a Pipeline row

The system SHALL provide a `deals:advance({ id, to })` mutation that transitions a deal forward through `loi_sent → loi_signed → ta_issued → moved_in`. Backward transitions SHALL be rejected. Skipping forward stages SHALL be allowed (e.g., `loi_sent → moved_in`); each stage's `*At` timestamp visited in the skip SHALL be set to the same `now()` value.

The Pipeline screen SHALL render a stepper / dropdown on every in-progress row (any row whose stage is `sent`, `loi_sent`, `loi_signed`, or `ta_issued`) that calls the appropriate mutation:

- `sent` → "Start deal (LOI sent)" calls `deals:start`.
- `loi_sent` / `loi_signed` / `ta_issued` → next-step button calls `deals:advance`.
- Any in-progress stage → "Cancel deal" calls `deals:cancel`.

#### Scenario: Advance from Sent to LOI sent

- **WHEN** the operator clicks "Start deal" on a Pipeline row at stage **Sent** for property Riverwalk
- **THEN** a new `deals` row is created with `responseId`, `propertyId = Riverwalk`, `stage: 'loi_sent'`, `loiSentAt = now()`.

#### Scenario: Advance through stages records timestamps

- **WHEN** a deal is at `stage: 'loi_sent'` and the operator clicks "LOI signed"
- **THEN** the row updates to `stage: 'loi_signed'` with `loiSignedAt = now()`; `loiSentAt` is unchanged.

#### Scenario: Skip forward sets every visited timestamp

- **WHEN** a deal is at `stage: 'loi_sent'` and the operator advances directly to `moved_in`
- **THEN** `loiSignedAt`, `taIssuedAt`, and `movedInAt` are all set to the same `now()` value and `stage = 'moved_in'`.

#### Scenario: Backward transition rejected

- **WHEN** the operator attempts `deals:advance({ id, to: 'loi_sent' })` on a deal at `stage: 'ta_issued'`
- **THEN** the mutation rejects and the row is unchanged.

#### Scenario: Cancel returns customer to Sent

- **WHEN** the operator clicks "Cancel deal" on a deal at any in-progress stage
- **THEN** `cancelledAt = now()` is set, and on the next render the customer appears in the **Sent** bucket if they have any sent assignments, otherwise **Not contacted**.

### Requirement: Pipeline screen surfaces actionable context per row

The Pipeline screen SHALL display, for each customer, at minimum:

- Name, school, contact channel
- Their current stage
- The count of `status: 'sent'` assignments and the timestamp + property name of the most recent one
- For customers in any deal stage: the linked property name and the timestamp of the current stage's `*At` field
- A link to the existing CustomerDetail screen
- The stage-advancement controls described in the previous requirement

#### Scenario: Sent customer row

- **WHEN** the screen renders a customer in the **Sent** bucket with 3 sent assignments, most recently for property "Riverwalk" on 2026-06-01
- **THEN** the row shows "3 sent · last: Riverwalk · 4d ago" or equivalent, plus a "Start deal" action.

#### Scenario: In-progress deal row shows linked property

- **WHEN** the screen renders a customer at `stage: 'loi_signed'` for property "Sunrise" with `loiSignedAt = 2026-06-04`
- **THEN** the row shows "Sunrise · LOI signed · 1d ago" plus "Next: Issue TA" and "Cancel deal" actions.

#### Scenario: Click-through to CustomerDetail

- **WHEN** the operator clicks a Pipeline row's "View" affordance
- **THEN** the app navigates to `/customers/<responseId>`.

### Requirement: Recommend excludes moved-in customers

The Recommend screen SHALL exclude any customer classified as **moved_in** from:

- The By-client picker list
- The candidate pool used to compute By-property Suggestion and Hold buckets
- The candidate pool passed to `assembleCohort` for whole-unit cohort suggestions

Customers in any earlier deal stage (`loi_sent`, `loi_signed`, `ta_issued`) SHALL remain visible in Recommend — deals fall through and the operator may want to offer alternatives.

Existing pinned or sent assignments for a moved-in customer SHALL continue to render in the Must-send and Sent sections (audit trail), but no new pin path SHALL surface them as a Suggestion.

#### Scenario: Moved-in customer disappears from By-client picker

- **WHEN** a customer has a moved-in deal and the operator opens Recommend → By client
- **THEN** that customer's name does not appear in the picker.

#### Scenario: LOI-signed customer still appears in Suggestions

- **WHEN** a customer has an active `loi_signed` deal and the operator opens Recommend → By property
- **THEN** the customer can still appear in Suggestions and the Held back list for other properties.

#### Scenario: Moved-in customer absent from cohort assembly

- **WHEN** the operator clicks "Suggest cohorts" on a whole-unit property
- **THEN** the input pool to `assembleCohort` excludes any customer with a moved-in deal, even if `wantRoommate` is true.

#### Scenario: Historical sent rows remain visible

- **WHEN** a customer was sent property X, then later moved into property Y, and the operator opens property X's view in Recommend
- **THEN** the Sent section still shows the sent row for that customer, even though they are excluded from Suggestions.

### Requirement: Pipeline data is fetched via a single server query

The system SHALL expose a Convex query `responses:listWithPipelineStatus` that returns one row per response with the computed `stage`, `sentCount`, `lastSentAt`, `lastSentPropertyId`, and `activeDeal` fields, joined server-side from `responses`, `assignments`, and `deals`.

The `activeDeal` field SHALL carry `{ _id, propertyId, stage, loiSentAt, loiSignedAt, taIssuedAt, movedInAt }` so the Pipeline row can render the linked property and stage controls without a second fetch.

#### Scenario: Pipeline screen subscribes to a single query

- **WHEN** the Pipeline screen mounts
- **THEN** it uses `responses:listWithPipelineStatus` and does not separately subscribe to `assignments:list` or `deals:list` for bucketing.
