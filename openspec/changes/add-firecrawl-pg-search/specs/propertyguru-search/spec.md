## ADDED Requirements

### Requirement: Server-side PropertyGuru search action

The system SHALL expose a Convex action `extraction:searchPropertyGuru` that accepts a free-text query and returns a ranked list of PropertyGuru listing candidates by calling Firecrawl's search API server-side with `FIRECRAWL_API_KEY`. The action MUST validate that every returned URL is on `propertyguru.com.sg` and MUST cap the result count at 10.

#### Scenario: Valid query returns candidates
- **WHEN** an authenticated admin calls `extraction:searchPropertyGuru` with a non-empty query string
- **THEN** the action returns `{ ok: true, results: [...] }` where each result has `{ url, title, snippet }`, every `url` is a `propertyguru.com.sg` listing, and the array length is at most 10

#### Scenario: Missing API key
- **WHEN** the action runs in an environment where `FIRECRAWL_API_KEY` is not set
- **THEN** the action returns `{ ok: false, error: 'Firecrawl not configured' }` without throwing

#### Scenario: Empty query
- **WHEN** the action is called with an empty or whitespace-only query
- **THEN** the action returns `{ ok: false, error: 'Query is empty' }` without calling Firecrawl

#### Scenario: Firecrawl rate-limited
- **WHEN** Firecrawl responds with HTTP 429
- **THEN** the action returns `{ ok: false, error: 'PropertyGuru search rate-limited. Try again in a moment.' }`

#### Scenario: Non-PropertyGuru results filtered out
- **WHEN** Firecrawl returns a mix of `propertyguru.com.sg` and other hostnames
- **THEN** the action returns only the `propertyguru.com.sg` listing URLs and discards the rest before responding

### Requirement: Search UI in Add Property

The Add Property screen SHALL include a search input that lets admins find a PropertyGuru listing without leaving the portal. Submitting the query SHALL display the candidates as a clickable list; selecting a candidate SHALL populate the PropertyGuru URL field and trigger the existing extraction flow.

#### Scenario: Admin runs a search and picks a result
- **WHEN** the admin types a query into the search input and submits it
- **AND** the action returns one or more candidates
- **THEN** the screen displays each candidate as a card with title and snippet
- **AND** clicking a card populates the PropertyGuru URL field with that listing's URL
- **AND** the existing `extractPropertyGuruUrl` flow is invoked for that URL

#### Scenario: No results
- **WHEN** the action returns `{ ok: true, results: [] }`
- **THEN** the screen displays a "No PropertyGuru listings found" message and does not change any form state

#### Scenario: Search fails
- **WHEN** the action returns `{ ok: false, error: <msg> }`
- **THEN** the screen surfaces `<msg>` via the existing toast mechanism and re-enables the input for retry

#### Scenario: Firecrawl not configured
- **WHEN** the action returns `{ ok: false, error: 'Firecrawl not configured' }`
- **THEN** the search input and results block are hidden, leaving the existing PropertyGuru URL field as the only intake path

#### Scenario: Loading state
- **WHEN** a search request is in flight
- **THEN** the search input is disabled and a "Searching PropertyGuru…" status line is visible until the request settles
