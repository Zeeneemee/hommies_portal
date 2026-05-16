## ADDED Requirements

### Requirement: Workflow-ordered four-screen navigation

The portal SHALL be a single-page React application presenting exactly four screens — Add Property, Status, Recommend, Listings — in that fixed left-to-right navigation order, which mirrors the operational workflow.

#### Scenario: Portal opens on the first screen

- **WHEN** the admin opens the portal
- **THEN** the Add Property screen is shown by default, before any dashboard or other tab

#### Scenario: Navigation order reflects the workflow

- **WHEN** the admin views the navigation
- **THEN** the four screens appear in the order Add Property → Status → Recommend → Listings

#### Scenario: Switching screens preserves persisted data

- **WHEN** the admin navigates from one screen to another
- **THEN** all previously saved properties and responses remain available, with no data loss between screens

### Requirement: Brand system as single source of truth

The portal SHALL apply the Hommies.sg brand from a single `theme.js` module holding the colour tokens — primary orange `#FD6925`, primary navy `#041F60`, warm cream `#FFF5EC` background — copied verbatim from the `room-showcase-pdf` skill, with the background-removed Hommies.sg logo and a warm, family-first tone.

#### Scenario: Brand tokens are centralized

- **WHEN** a component needs a brand colour
- **THEN** it reads the value from `theme.js` rather than hard-coding a hex value

#### Scenario: Brand is applied consistently

- **WHEN** any of the four screens renders
- **THEN** it uses the orange/navy/cream palette and the Hommies.sg logo, with no corporate-styled deviations

### Requirement: Isolated local persistence layer

The portal SHALL persist all state locally through a single `store.js` module exposing an async CRUD API; no UI component SHALL access browser storage directly, so that the persistence backend can be replaced in v2 without changing the UI.

#### Scenario: State survives a reload

- **WHEN** the admin reloads the portal after saving properties and responses
- **THEN** all saved data is still present

#### Scenario: Components do not touch storage directly

- **WHEN** a screen reads or writes data
- **THEN** it calls a `store.js` function and never references `localStorage`, `IndexedDB`, or a network client directly

#### Scenario: Portal runs offline

- **WHEN** the admin uses the portal with no network connection
- **THEN** all four screens function fully against locally persisted data
