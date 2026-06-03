## ADDED Requirements

### Requirement: Paste-many-URL intake

The system SHALL provide a Batch Add screen where the operator can paste multiple PropertyGuru listing URLs and have each URL extracted into its own table row.

#### Scenario: Operator pastes multiple URLs

- **WHEN** the operator pastes a textarea containing 5 newline-separated PropertyGuru URLs and clicks "Add to batch"
- **THEN** the system parses the textarea into 5 trimmed, deduplicated URLs and appends one row per URL to the batch table with status `queued`

#### Scenario: Operator pastes whitespace-separated URLs

- **WHEN** the operator pastes URLs separated by spaces, tabs, or newlines in any combination
- **THEN** the system splits on any whitespace and treats each non-empty token as a URL

#### Scenario: Duplicate URLs in the same paste

- **WHEN** the operator pastes the same URL twice in one batch input
- **THEN** the system collapses duplicates to one row and surfaces a toast noting how many duplicates were skipped

#### Scenario: Duplicate URL across pastes

- **WHEN** the operator adds a URL that already exists as a row in the table
- **THEN** the system skips the duplicate and toasts the count of skipped duplicates

#### Scenario: Non-URL token in paste

- **WHEN** the operator pastes a token that is not a valid `http(s)://` URL
- **THEN** the system omits the token from row creation and toasts the count of invalid tokens

### Requirement: Streaming extraction

The system SHALL extract URLs one row at a time, updating each row's status independently so the operator sees progress without waiting for the whole batch.

#### Scenario: Row transitions through statuses

- **WHEN** extraction starts on a row
- **THEN** the row's status moves `queued → extracting → fetching images → ready` and the table re-renders on each transition

#### Scenario: A single URL fails

- **WHEN** `extractPropertyGuruUrl` returns `ok: false` or throws for one row
- **THEN** that row's status becomes `failed` with the error captured in a row-level message field, and the remaining rows continue extracting unaffected

#### Scenario: Cloudflare-blocked listing

- **WHEN** a URL is blocked by Cloudflare and the extractor returns `ok: false` with a notice
- **THEN** the row is marked `failed` with the extractor's notice and the row remains editable so the operator can fill fields manually and still reach `ready`

#### Scenario: Concurrency cap

- **WHEN** the batch contains more than 1 queued row
- **THEN** the system processes at most N rows in parallel where N is configurable in the component between 1 and 3, default 1

### Requirement: Per-row editable fields

The system SHALL render each row as an editable record of the same fields the existing single-URL extractor populates, so the operator can correct mistakes before generating posters.

#### Scenario: Field set matches single-URL extractor

- **WHEN** a row reaches `ready`
- **THEN** the row exposes editable fields for: `condo`, `listingTitle`, `rentSGD`, `housingType`, `buildingType`, `area`, `unitType`, `sizeSqft`, `bedrooms`, `bathrooms`, `furnishing`, `availability`, `fullAddress`, `ageYears`, `commuteMins.NUS`, `commuteMins.NTU`, `commuteMins.SMU`

#### Scenario: Edit panel inline

- **WHEN** the operator clicks "Edit" on a row
- **THEN** an inline panel opens beneath the row with the same inputs and validation rules as `PropertyDetailsCard` on the single-URL Add screen

#### Scenario: Clearing a field

- **WHEN** the operator clears a numeric or string field
- **THEN** the underlying row state removes the key (rather than storing empty string), matching `PropertyDetailsCard` semantics

### Requirement: Per-row poster generation

The system SHALL allow the operator to generate a poster PDF for any single ready row.

#### Scenario: Single row poster generation

- **WHEN** the operator clicks "Generate poster" on a ready row whose blockers are satisfied (condo, rent, housing type, at least one image)
- **THEN** the system calls `ai:generatePosterContent` with that row's data and images and renders the PDF via `renderPosterToBlob`, attaching the resulting `File` to that row

#### Scenario: Missing required fields

- **WHEN** the operator clicks "Generate poster" on a row missing any blocker
- **THEN** the system surfaces the missing field list inline on that row and does not call the AI

#### Scenario: Regenerate

- **WHEN** the operator clicks "Generate poster" on a row that already has a poster attached
- **THEN** the system replaces the existing row poster with the newly rendered one

### Requirement: Batch poster generation

The system SHALL allow the operator to generate posters for every eligible row sequentially in one click.

#### Scenario: Generate-all sequential

- **WHEN** the operator clicks "Generate all posters"
- **THEN** the system iterates rows in display order, generating posters one row at a time, updating each row's generation status (`generating → done | failed`)

#### Scenario: Skip ineligible rows

- **WHEN** "Generate all posters" runs over rows where some are missing blockers
- **THEN** the system skips ineligible rows, marks them `skipped` with the blocker list, and continues with the rest

#### Scenario: Failure isolation

- **WHEN** poster generation fails on one row
- **THEN** the system records the error on that row and continues with the next row

### Requirement: Per-row and batch save

The system SHALL persist rows to the database via `properties:add`, supporting both single-row and batch save.

#### Scenario: Save a single row

- **WHEN** the operator clicks "Save" on a row whose required intake fields are satisfied (condo plus at least one image or poster) 
- **THEN** the system uploads that row's images and (if attached) poster via `properties:generateUploadUrl`, calls `properties:add` with the schema-accepted subset of fields, runs `extraction:extractPosterDetails` if a poster was uploaded, and marks the row `saved` with the new property id

#### Scenario: Save all ready rows

- **WHEN** the operator clicks "Save all"
- **THEN** the system saves each ready row sequentially, leaving non-ready rows untouched, and surfaces a final toast with the counts of saved vs. skipped vs. failed rows

#### Scenario: Saved rows persist as confirmation only

- **WHEN** a row is saved successfully
- **THEN** the row remains in the table with status `saved` and a link to its Status page entry, but its action buttons (except Remove) are disabled so it cannot be double-saved

### Requirement: Draft persistence across navigation

The system SHALL preserve the in-progress batch when the operator navigates away from the Batch Add screen and returns, so a partially completed batch is not lost.

#### Scenario: Navigate away and back

- **WHEN** the operator has populated several rows and switches to a different sidebar tab, then returns to Batch Add
- **THEN** the rows, their extracted fields, edits, and status are still present

#### Scenario: Page refresh

- **WHEN** the operator refreshes the page
- **THEN** URL list and extracted/edited field data persist via localStorage; in-memory image and poster blobs are not restored and affected rows reset to `queued` so the operator can re-extract or re-attach

### Requirement: Sidebar entry point

The system SHALL expose the Batch Add screen as a sidebar nav item, immediately after Add Property in the workflow order.

#### Scenario: Sidebar nav

- **WHEN** the operator opens the portal
- **THEN** the sidebar shows a "Batch Add" item between "Add Property" and "Status" linking to `/add/batch`
