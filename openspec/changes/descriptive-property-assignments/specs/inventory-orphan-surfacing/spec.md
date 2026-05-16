## ADDED Requirements

### Requirement: Listings surfaces orphan properties

The Listings screen SHALL flag properties that have zero active pinned and zero sent assignments AND whose `posterExtractedAt` (or, absent that, `createdAt`) is older than 3 days. The flag SHALL be visible without expanding the card and SHALL link to the property's view inside Recommend.

#### Scenario: A matchable property with no assignments is flagged
- **WHEN** a property has `posterExtractedAt` set 4 days ago and zero assignments
- **THEN** its Listings card SHALL display an "Orphan — needs recipients" indicator
- **AND** clicking the indicator SHALL navigate to `/recommend` with that property selected

#### Scenario: A freshly added property is not flagged
- **WHEN** a property was created 2 hours ago and has zero assignments
- **THEN** its Listings card SHALL NOT display the orphan indicator

#### Scenario: An assigned property is not flagged
- **WHEN** a property has at least one active pinned or sent assignment
- **THEN** its Listings card SHALL NOT display the orphan indicator regardless of age

### Requirement: Customers surfaces engagement summary per client

The Customers screen SHALL render an engagement chip on each customer card derived from that client's `assignments`. The chip SHALL count active pins and sent rows separately and SHALL show the timestamp of the most recent transition.

#### Scenario: Engagement chip for a client with mixed history
- **WHEN** a client has 1 pinned assignment and 2 sent assignments, the latest sent 2 days ago
- **THEN** the Customers card SHALL display "1 pinned · 2 sent · latest 2d ago" (or equivalent concise text)

#### Scenario: Engagement chip for a client with no history
- **WHEN** a client has zero assignments of any status
- **THEN** the Customers card SHALL display "no engagement yet"

### Requirement: Orphan and engagement views read from the same `assignments` query

The Listings orphan flag and the Customers engagement chip SHALL derive their state from the reactive `assignments:list` query joined client-side with the existing `properties:list` and `responses:list` data. The Convex backend SHALL NOT expose orphan-specific or engagement-specific endpoints.

#### Scenario: A new pin updates both screens without refetch
- **WHEN** the operator pins (property P, client C) from Recommend
- **AND** the Listings and Customers screens are open in another tab
- **THEN** P's orphan indicator (if previously shown) SHALL disappear without a refresh
- **AND** C's engagement chip SHALL update its pinned count without a refresh
