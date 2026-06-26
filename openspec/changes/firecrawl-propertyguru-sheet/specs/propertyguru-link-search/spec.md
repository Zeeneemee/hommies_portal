## ADDED Requirements

### Requirement: Operator searches from a free-text requirement
The system SHALL provide a portal screen where an operator pastes a client's free-text housing-requirement message and runs a search that returns candidate PropertyGuru listing links.

#### Scenario: Running a search
- **WHEN** the operator pastes a non-empty message and clicks "Search"
- **THEN** the system parses search-relevant fields, calls the Firecrawl search, and shows a list of candidate links (URL + title/snippet) or a clear "no results" state

#### Scenario: Empty message rejected
- **WHEN** the operator submits an empty or whitespace-only message
- **THEN** the system SHALL reject it with a validation message and call no external service

### Requirement: Build a PropertyGuru search from the requirements
The system SHALL construct a search query from the parsed requirements (at minimum budget, area/building type, and housing type) and call Firecrawl's search API, restricting results to PropertyGuru listing URLs.

#### Scenario: Query restricted to PropertyGuru
- **WHEN** the search runs
- **THEN** the query SHALL scope results to `propertyguru.com.sg` and the returned candidates SHALL be PropertyGuru listing URLs only

#### Scenario: Firecrawl key missing
- **WHEN** `FIRECRAWL_API_KEY` is not configured
- **THEN** the system SHALL return a clear "search not configured" error and not attempt the call

### Requirement: Surface candidate links for selection
The system SHALL display the returned candidates as a selectable list so the operator can choose which link(s) to record as sent; results are transient and not persisted by this capability.

#### Scenario: Candidate selection
- **WHEN** candidates are shown
- **THEN** each candidate exposes its URL and title, and the operator can select one (or more) to hand to the client-sheet-sync flow

#### Scenario: No candidates returned
- **WHEN** Firecrawl returns zero PropertyGuru results for the query
- **THEN** the system SHALL show a "no matching listings" message and offer the operator to refine the message and search again
