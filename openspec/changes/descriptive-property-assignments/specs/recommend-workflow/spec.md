## ADDED Requirements

### Requirement: Three-section operator workflow per view

The Recommend page SHALL render three new sections in both `ByPropertyView` and `ByClientView`, layered above the existing Send / Hold split: **Must send** (active pinned, not yet sent), **Sent** (historical, read-only), and **Suggestions** (`decide()` Send-bucket output, excluding pairs already covered by an active or sent assignment). The legacy Send / Hold buckets SHALL remain visible.

#### Scenario: ByPropertyView shows pinned, sent, and suggestion sections
- **WHEN** the operator selects a property that has 2 pinned assignments, 1 sent assignment, and 5 clients in the `decide()` Send bucket whose pairs have no assignment
- **THEN** the page SHALL display a Must-send section with the 2 pinned rows
- **AND** a Sent section with the 1 sent row
- **AND** a Suggestions section with the 5 clients

#### Scenario: Suggestions exclude pairs already covered
- **WHEN** a client appears in the `decide()` Send bucket for a property
- **AND** that (property, client) pair already has an active pinned or sent assignment
- **THEN** the client SHALL NOT appear in the Suggestions section
- **AND** the client SHALL appear in the corresponding Must-send or Sent section instead

### Requirement: Pin action on a suggestion creates an active assignment

The Recommend page SHALL provide a `[Pin]` control on every Suggestions row. Clicking it SHALL invoke `assignments:pin` with the current property, the current client, and the score visible to the operator at click time as `pinnedScore`. On success the row SHALL move from Suggestions to Must-send without a page reload (via the reactive query).

#### Scenario: Pin moves a suggestion into Must-send
- **WHEN** the operator clicks `[Pin]` on a Suggestions row scoring 71
- **THEN** an assignment SHALL be created with `pinnedScore: 71`
- **AND** the row SHALL disappear from Suggestions and appear in Must-send

### Requirement: Mark-sent action on a pinned row records the outreach

The Recommend page SHALL provide a `[Mark sent]` control on every Must-send row. Clicking it SHALL invoke `assignments:markSent`. On success the row SHALL move from Must-send to Sent. The bilingual `draftMessage` text SHALL remain available on Sent rows for reference and copy.

#### Scenario: Mark-sent transitions a pinned row to sent
- **WHEN** the operator clicks `[Mark sent]` on a Must-send row
- **THEN** the underlying assignment SHALL have `status: 'sent'` and `sentAt` set
- **AND** the row SHALL appear in the Sent section
- **AND** the row SHALL be read-only — no `[Unpin]` or `[Mark sent]` control SHALL be rendered on it

### Requirement: Pinned rows display both score-at-pin and current score

The Recommend page SHALL display the `pinnedScore` recorded on the assignment side-by-side with the current `decide()` score for the same pair. The presentation SHALL be neutral — neither score SHALL be flagged with a warning treatment based purely on drift.

#### Scenario: Drift is shown without alarm
- **WHEN** a pinned row was captured at score 71 and now computes to 42
- **THEN** the card SHALL display both numbers (e.g. "pinned at 71 · now 42")
- **AND** the card SHALL NOT render any warning icon or red highlight purely because of the difference

### Requirement: Held-back override requires a deliberate confirm

The Recommend page SHALL render the existing Hold-bucket presentation unchanged and SHALL provide an `[Override and pin]` control on each Hold row. The control SHALL require a one-step confirm that names the current score before invoking `assignments:pin`. The page SHALL NOT offer any single-click path from Hold to pinned.

#### Scenario: Hold-bucket pin requires a confirm
- **WHEN** the operator clicks `[Override and pin]` on a Hold row scoring 41
- **THEN** a confirm prompt SHALL appear stating that the score is 41
- **AND** only after the operator confirms SHALL the assignment be created

#### Scenario: Confirm dismissal leaves state unchanged
- **WHEN** the operator clicks `[Override and pin]` and then dismisses the confirm
- **THEN** no assignment SHALL be created and the Hold row SHALL remain in place

### Requirement: ByClientView mirrors the property-side workflow

`ByClientView` SHALL render the same three sections (Must-send, Sent, Suggestions) keyed by the selected client. The Must-send section SHALL list properties the client is pinned to; Sent SHALL list properties sent; Suggestions SHALL list properties from `recommendListingsForClient(client, properties).send` excluding pairs already covered.

#### Scenario: Pinning a property in ByClientView and switching to ByPropertyView
- **WHEN** the operator pins property P to client C from `ByClientView`
- **AND** then switches to `ByPropertyView` and selects P
- **THEN** client C SHALL appear in the Must-send section of P

### Requirement: Decision engine remains unmodified

The Recommend page SHALL continue to use `decide()`, `recommendRecipients()`, `recommendListingsForClient()`, and `draftMessage()` exactly as they exist today. No weight, threshold, blocker rule, or draft template SHALL be changed by this capability.

#### Scenario: Weights and threshold are untouched
- **WHEN** the change is applied
- **THEN** `decisionLogic.js` SHALL still export `W = { budget: 30, school: 22, commute: 20, housing: 12, layout: 9, building: 7 }` and `SEND_THRESHOLD = 58`
- **AND** the bilingual `draftMessage` output SHALL be byte-identical to the pre-change output for the same inputs
