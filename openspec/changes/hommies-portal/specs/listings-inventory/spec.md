## ADDED Requirements

### Requirement: Card-based property inventory

The Listings screen SHALL present every property the portal holds as a card, and each card SHALL show four facts: room type, location and area, Condo or HDB, and building age.

#### Scenario: Every property appears as a card

- **WHEN** the admin opens the Listings screen
- **THEN** every saved property is shown as a card

#### Scenario: Card shows the four key facts

- **WHEN** a property card renders
- **THEN** it displays room type, location and area, Condo or HDB, and building age

### Requirement: Filter the inventory

The Listings screen SHALL let the admin filter the property cards by their facts (e.g. room type, area, building type).

#### Scenario: Admin filters the inventory

- **WHEN** the admin applies a filter (e.g. building type Condo)
- **THEN** only properties matching the filter are shown as cards

#### Scenario: Clearing filters restores the full inventory

- **WHEN** the admin clears all filters
- **THEN** every property card is shown again

### Requirement: Poster and dispatch status on cards

Each property card on the Listings screen SHALL show whether a poster is attached and whether the property has been sent.

#### Scenario: Card reflects poster and dispatch status

- **WHEN** a property card renders
- **THEN** it indicates whether a poster PDF is attached and whether the property has been sent
