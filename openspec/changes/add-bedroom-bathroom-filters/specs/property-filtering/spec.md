## ADDED Requirements

### Requirement: Bedroom filter on every property-search surface

Every UI surface that lets an operator search or browse the property inventory SHALL expose a single-value bedroom filter. The set of in-scope surfaces is the Listings screen advanced filter row and the Recommend screen property search pane.

The filter SHALL offer at minimum: `Any`, exact integer counts `1` / `2` / `3` / `4`, and an open-ended `5+` bucket. `Any` is the default and SHALL NOT exclude any property.

#### Scenario: Default value is Any

- **WHEN** the operator has not changed the bedrooms selector
- **THEN** the filter SHALL NOT exclude any property, regardless of whether the property has a `bedrooms` value

#### Scenario: Exact match

- **WHEN** the operator selects `2` and a property has `bedrooms = 2`
- **THEN** the property SHALL pass the bedroom filter

#### Scenario: Exact non-match

- **WHEN** the operator selects `2` and a property has `bedrooms = 3`
- **THEN** the property SHALL be excluded

#### Scenario: Open-ended bucket

- **WHEN** the operator selects `5+` and a property has `bedrooms = 7`
- **THEN** the property SHALL pass the bedroom filter

#### Scenario: Filter set, property missing bedrooms

- **WHEN** the operator selects any value other than `Any` and a property has no `bedrooms` value
- **THEN** the property SHALL be excluded

### Requirement: Bathroom filter on every property-search surface

Every UI surface that lets an operator search or browse the property inventory SHALL expose a single-value bathroom filter with the same selection semantics as the bedroom filter. The set of in-scope surfaces is the Listings screen advanced filter row and the Recommend screen property search pane.

The filter SHALL offer at minimum: `Any`, exact integer counts `1` / `2` / `3`, and an open-ended `4+` bucket.

#### Scenario: Default value is Any

- **WHEN** the operator has not changed the bathrooms selector
- **THEN** the filter SHALL NOT exclude any property

#### Scenario: Exact match

- **WHEN** the operator selects `2` and a property has `bathrooms = 2`
- **THEN** the property SHALL pass the bathroom filter

#### Scenario: Open-ended bucket

- **WHEN** the operator selects `4+` and a property has `bathrooms = 5`
- **THEN** the property SHALL pass the bathroom filter

#### Scenario: Filter set, property missing bathrooms

- **WHEN** the operator selects any value other than `Any` and a property has no `bathrooms` value
- **THEN** the property SHALL be excluded

### Requirement: Bed/bath filter state integrates with existing advanced-filter behavior

Where a property-search surface already has an "advanced filters" or "more filters" disclosure, the bed/bath selectors SHALL live inside that disclosure and SHALL contribute to its activity state on the same terms as other advanced filters (rent range, housing, status).

#### Scenario: Non-Any selection makes "advanced" active

- **WHEN** either the bedrooms or bathrooms selector is set to any value other than `Any`
- **THEN** the surface SHALL report advanced filters as active (e.g., reveal the disclosure, show the "has-active" dot, count toward the global filters-active state)

#### Scenario: Clear-filters resets bed/bath

- **WHEN** the operator activates the surface's clear-filters action while either selector is non-default
- **THEN** both selectors SHALL be reset to `Any` alongside the other filters that action already resets

### Requirement: Listing card shows bed/bath counts

The Listings screen card for each property SHALL show the extracted bedroom and bathroom counts when present. A card whose property has neither value SHALL render no bed/bath line (no placeholder).

#### Scenario: Both counts present

- **WHEN** a property has `bedrooms = 3` and `bathrooms = 2`
- **THEN** the card SHALL render text equivalent to "3 beds · 2 baths" in the listing body

#### Scenario: Only one count present

- **WHEN** a property has `bedrooms = 2` and no `bathrooms`
- **THEN** the card SHALL render only the bedrooms line ("2 beds") with no separator

#### Scenario: Neither count present

- **WHEN** a property has neither `bedrooms` nor `bathrooms`
- **THEN** the card SHALL render no bed/bath line at all

#### Scenario: Singular vs plural label

- **WHEN** a count equals `1`
- **THEN** the label SHALL be singular ("1 bed", "1 bath"); for any other count it SHALL be plural ("2 beds", "3 baths")
