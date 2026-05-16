## ADDED Requirements

### Requirement: Assignment record shape

The system SHALL persist each operator commitment as a row in an `assignments` table keying a property to a response (client). Each row SHALL carry the lifecycle status (`pinned` or `sent`), the score snapshot at the moment of pinning (`pinnedScore`), and the timestamps of every transition (`pinnedAt`, optional `sentAt`, optional `unpinnedAt`). Optional fields SHALL be available for `pinnedReason` (free-text) and `sentVia` (channel string).

#### Scenario: Pin captures the score at the moment of commitment
- **WHEN** the operator pins a client to a property whose current `decide()` score is 71
- **THEN** the new `assignments` row SHALL have `status: 'pinned'`, `pinnedScore: 71`, `pinnedAt` set to the current time, and no `sentAt` or `unpinnedAt` set

#### Scenario: Sent stamps the assignment without rewriting pin metadata
- **WHEN** the operator marks an existing pinned assignment as sent
- **THEN** the row's `status` SHALL become `sent` and `sentAt` SHALL be set
- **AND** the original `pinnedAt`, `pinnedScore`, and `pinnedReason` SHALL be preserved unchanged

### Requirement: Active-pin uniqueness per (property, client) pair

The system SHALL allow at most one active row per `(propertyId, responseId)` pair, where "active" means `status` is `pinned` or `sent` and `unpinnedAt` is unset. Withdrawn rows (with `unpinnedAt` set) SHALL be allowed to coexist with a fresh active row for the same pair.

#### Scenario: Repeat pin is idempotent
- **WHEN** the operator pins a client to a property that already has an active pinned row for that pair
- **THEN** the mutation SHALL return the existing row without creating a duplicate
- **AND** the existing row's `pinnedAt` and `pinnedScore` SHALL remain unchanged

#### Scenario: Pin after withdrawal creates a new active row
- **WHEN** a previous pin for (property X, client Y) has `unpinnedAt` set
- **AND** the operator pins (property X, client Y) again
- **THEN** the mutation SHALL create a new row with `status: 'pinned'` and the withdrawn row SHALL remain in place untouched

### Requirement: Sent rows are immutable

The system SHALL reject any attempt to unpin or otherwise mutate an assignment whose `sentAt` is set. Sent rows are the audit trail and the trust ledger; they MUST NOT be edited or deleted by the application.

#### Scenario: Unpin after sent is rejected
- **WHEN** the operator attempts to unpin an assignment whose `sentAt` is set
- **THEN** the mutation SHALL throw an error referencing the immutability of sent rows
- **AND** the row SHALL remain unchanged

### Requirement: Pin and unpin and mark-sent are explicit mutations

The system SHALL expose three Convex mutations covering the lifecycle: `pin`, `unpin`, and `markSent`. The system SHALL NOT expose a bulk endpoint that pins, sends, or transitions more than one assignment at a time. No automation SHALL transition an assignment between states without an operator action.

#### Scenario: No bulk-send endpoint exists
- **WHEN** a caller searches the `assignments` module for a bulk action
- **THEN** the module SHALL expose only `pin`, `unpin`, and `markSent` as state-changing mutations
- **AND** each SHALL accept exactly one assignment-shaped argument

### Requirement: Deleted properties orphan rather than cascade

The system SHALL preserve assignment rows when their parent property or response is deleted. The orphaned rows SHALL be filtered out of the active operator views (Must-send, Suggestions) and SHALL be presentable in a muted "removed" state inside Sent history.

#### Scenario: Property deletion preserves the audit trail
- **WHEN** a property with two sent assignments is removed
- **THEN** the two `assignments` rows SHALL remain in the database
- **AND** they SHALL NOT appear in any Must-send or Suggestions list
- **AND** they MAY appear in the per-client engagement history as "(property removed)"

### Requirement: Assignment query is reactive and filterable

The system SHALL expose a `list` query that accepts optional `propertyId` and `responseId` filters and returns matching rows ordered by `pinnedAt` descending. The query SHALL be reactive — mutations to `assignments` SHALL flow to subscribed clients without manual refetch.

#### Scenario: Filtering by property
- **WHEN** a client calls `assignments:list({ propertyId: P })`
- **THEN** the result SHALL contain every assignment row whose `propertyId === P`, including withdrawn and sent rows
- **AND** the rows SHALL be ordered by `pinnedAt` descending

#### Scenario: Reactivity after a new pin
- **WHEN** a client is subscribed to `assignments:list({ propertyId: P })`
- **AND** another caller invokes `assignments:pin` for that property
- **THEN** the subscribed client SHALL receive the updated row set without re-issuing the query
