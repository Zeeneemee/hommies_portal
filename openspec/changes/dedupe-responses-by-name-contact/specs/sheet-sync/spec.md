## ADDED Requirements

### Requirement: Sheet-to-Convex sync SHALL skip incoming rows that overlap an existing customer

When the `/sheet/sync` HTTP action receives a normalised row, the system SHALL insert it only if no existing `responses` row matches under either of the following dedupe checks. The checks are evaluated in order; the first hit causes the row to be counted as `skipped` and skipped silently:

1. **Sheet-timestamp match.** If the incoming row has a non-empty `sheetTimestamp` and any existing `responses` row has the same `sheetTimestamp`, the row is a duplicate.
2. **Name+contact match.** Compute a normalised match key from the incoming row's `name` and `contact` using the canonical helper `normaliseMatchKey` (lowercase + trim + collapse internal whitespace on each field, then `${name}|${contact}`). If the key is non-empty and any existing row produces the same key under the same helper, the row is a duplicate.

The existing row SHALL NOT be modified on either match. Its `source`, `sheetTimestamp`, `createdAt`, and all other fields are preserved exactly as they were.

#### Scenario: Form re-submission of an already-synced row

- **GIVEN** a row with `sheetTimestamp = "12/4/2026, 19:45:32"` already exists in the `responses` table
- **WHEN** the Apps Script re-pushes the same sheet row
- **THEN** the HTTP handler returns `parsed: 1, inserted: 0, skipped: 1`
- **AND** the existing row is untouched

#### Scenario: Form submission overlapping a pre-existing manual entry

- **GIVEN** a row exists with `source: 'manual'`, `name: 'Tan Wei Ming'`, `contact: 'tan@example.com'`, and no `sheetTimestamp`
- **WHEN** the Apps Script pushes a row with `name: 'tan wei ming'`, `contact: 'TAN@example.com'`, and `sheetTimestamp: '...'`
- **THEN** the HTTP handler returns `parsed: 1, inserted: 0, skipped: 1`
- **AND** the existing manual row retains `source: 'manual'` and no `sheetTimestamp`

#### Scenario: Anonymous incoming row (both name and contact empty)

- **GIVEN** an existing row with `source: 'manual'`, `name: 'Unnamed'`, `contact: ''`
- **WHEN** the Apps Script pushes a row that the normaliser produces as `name: 'Unnamed'`, `contact: ''` (which `normaliseSheetRows` would already drop, but assume it passes through)
- **THEN** the tier-2 match key is empty
- **AND** the row is inserted (anonymous rows never collapse into each other via name+contact)

### Requirement: Internal `responses.mergeDuplicates` mutation SHALL collapse pre-existing duplicates

The system SHALL expose an internal mutation `responses.mergeDuplicates` callable via `npx convex run responses:mergeDuplicates`. The mutation SHALL:

- Scan the entire `responses` table.
- Group rows by the normalised `(name, contact)` key produced by `normaliseMatchKey`.
- Discard groups whose key is empty.
- For each remaining group of size ≥ 2: sort by `createdAt` ascending, retain the oldest row, and delete each remaining row in the group **only if** it has zero referencing rows in the `assignments` table (indexed by `responseId`).
- Skip deletion (and record the conflict in `skippedDueToAssignments`) for any duplicate row that has one or more referencing assignments.
- Return a summary object `{ groups, kept, deleted, skippedDueToAssignments }`.

The mutation SHALL be idempotent: running it on a deduplicated table SHALL return `{ groups: 0, kept: 0, deleted: 0, skippedDueToAssignments: [] }`.

#### Scenario: Clean run with one duplicate pair, no assignments

- **GIVEN** two rows with normalised match key `'tan wei ming|tan@example.com'`, `createdAt` values `T1` (older) and `T2` (newer), neither referenced by any assignment
- **WHEN** `responses:mergeDuplicates` runs
- **THEN** the return is `{ groups: 1, kept: 1, deleted: 1, skippedDueToAssignments: [] }`
- **AND** the row with `createdAt = T1` remains in the table
- **AND** the row with `createdAt = T2` no longer exists

#### Scenario: Duplicate with assignments on the newer row

- **GIVEN** two rows with the same normalised match key, the older row has zero assignments, the newer row has two assignments
- **WHEN** `responses:mergeDuplicates` runs
- **THEN** the return is `{ groups: 1, kept: 1, deleted: 0, skippedDueToAssignments: [{ key, responseId: <newer._id>, assignmentCount: 2 }] }`
- **AND** both rows remain in the table

#### Scenario: Idempotent re-run

- **GIVEN** the responses table contains no duplicate groups under `normaliseMatchKey`
- **WHEN** `responses:mergeDuplicates` runs
- **THEN** the return is `{ groups: 0, kept: 0, deleted: 0, skippedDueToAssignments: [] }`
- **AND** no rows are modified or deleted
