## ADDED Requirements

### Requirement: Ensure a Clients tab exists
The system SHALL write client data to a dedicated "Clients" tab in the configured spreadsheet, creating the tab with a fixed header row if it does not already exist, without touching the existing property "Room Tour" tab.

#### Scenario: Clients tab missing
- **WHEN** the first sheet write runs and no "Clients" tab exists
- **THEN** the system SHALL create the tab and write the documented header row before appending data

#### Scenario: Clients tab present
- **WHEN** the "Clients" tab already exists
- **THEN** the system SHALL reuse it and not duplicate the header or alter other tabs

### Requirement: Upsert a client by name + contact
When the operator records a sent link, the system SHALL look up the client in the Clients tab by a normalised name + contact key and update the existing row if found, otherwise append a new client row carrying the parsed requirement data.

#### Scenario: Existing client matched
- **WHEN** a row whose normalised name + contact equals the client's is found
- **THEN** the system SHALL update that row in place rather than appending a duplicate

#### Scenario: New client appended
- **WHEN** no row matches the normalised name + contact
- **THEN** the system SHALL append a new row with the client's parsed fields and the sent link

#### Scenario: Anonymous never collapses
- **WHEN** the client has neither a name nor a contact
- **THEN** the system SHALL append a new row and SHALL NOT merge it with other empty-key rows

### Requirement: Append the chosen link to the Sent column
The system SHALL record the selected PropertyGuru link in the client's "Sent Listings" column, accumulating multiple links over time without overwriting previously sent ones.

#### Scenario: First link sent
- **WHEN** a client has no prior sent links
- **THEN** the Sent Listings cell SHALL contain the chosen link

#### Scenario: Additional link sent
- **WHEN** the client already has one or more sent links
- **THEN** the new link SHALL be appended to the existing ones (de-duplicated) rather than replacing them

### Requirement: Service-account write with graceful degradation
The system SHALL authenticate to the Google Sheets API with a service account and degrade gracefully when misconfigured.

#### Scenario: Sheets not configured
- **WHEN** `GOOGLE_SHEETS_SERVICE_ACCOUNT` or `GOOGLE_SHEETS_SPREADSHEET_ID` is missing
- **THEN** the system SHALL return a clear "sheet not configured" status and not crash the portal action

#### Scenario: Sheet not shared with the service account
- **WHEN** the Sheets API returns a permission error
- **THEN** the system SHALL surface an actionable error naming the service-account email to share the sheet with
