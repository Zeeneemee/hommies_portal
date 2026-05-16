## ADDED Requirements

### Requirement: Per-property three-step progress tracker

The Status screen SHALL show every property as a row with a three-step progress track — Data received → Poster attached → Sent — so the admin can see at a glance what is waiting on them.

#### Scenario: Every property appears as a tracked row

- **WHEN** the admin opens the Status screen
- **THEN** every saved property is listed as a row showing its position on the Data received → Poster attached → Sent track

#### Scenario: Newly added property shows Data received

- **WHEN** a property has been saved but has no poster attached
- **THEN** its row shows Data received as the current step

#### Scenario: Property with poster shows Poster attached

- **WHEN** a property has a poster PDF attached but has not been sent
- **THEN** its row shows Poster attached as the current step

#### Scenario: Sent property shows Sent

- **WHEN** a property has been dispatched to recipients
- **THEN** its row shows Sent as the completed step

### Requirement: Mark a property as sent

The Status screen SHALL let the admin mark a property as Sent once its poster and drafted messages have been dispatched, advancing its status track.

#### Scenario: Admin marks a property sent

- **WHEN** the admin marks a property as Sent on the Status screen
- **THEN** the property's status advances to Sent and the change persists through `store.js`
