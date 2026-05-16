## ADDED Requirements

### Requirement: Convex schema for properties and responses

The portal SHALL define a Convex schema with a `properties` table and a `responses` table holding the live data model — properties (`condo`, `buildingType`, `area`, `ageYears`, `unitType`, `rentSGD`, `housingType`, `fullAddress`, `commuteMins`, `media`, poster file fields, `status`) and responses (`name`, `channel`, `contact`, `school`, `moveIn`, `leaseLength`, `budget`, `buildingType`, `housingType`, `unitLayout`, `commuteTolMins`, `wantRoommate`, `extras`).

#### Scenario: Schema validates a well-formed property

- **WHEN** a property is written with all required fields of the live data model
- **THEN** Convex accepts and stores the document

#### Scenario: Property status is constrained to the lifecycle enum

- **WHEN** a property is written with a `status` value
- **THEN** the value must be one of `data_received`, `poster_attached`, or `sent`

### Requirement: Reactive Convex persistence replaces local storage

All portal data SHALL be read and written through Convex queries and mutations; the UI SHALL subscribe to reactive Convex reads, and no component SHALL use IndexedDB or `localStorage`.

#### Scenario: A new property appears without a reload

- **WHEN** a property is added through a Convex mutation
- **THEN** every screen subscribed to the properties query reflects it without a page reload

#### Scenario: Data persists across sessions and devices

- **WHEN** the portal is reopened in a different browser session against the same deployment
- **THEN** all previously saved properties and responses are present

#### Scenario: No browser-storage access remains

- **WHEN** the codebase is inspected
- **THEN** no component or module references `localStorage` or `IndexedDB`, and `store.js` / `seedData.js` no longer exist

### Requirement: Poster PDF file storage

The portal SHALL store uploaded poster PDFs in Convex file storage and keep a reference (`posterStorageId`, `posterName`, `posterSize`) on the property record; the UI SHALL resolve a served URL for display or download.

#### Scenario: Poster PDF is uploaded to file storage

- **WHEN** the admin uploads a poster PDF on the Add Property screen
- **THEN** the PDF is stored in Convex file storage and the property record holds its storage reference, name, and size

#### Scenario: Stored poster is retrievable

- **WHEN** a property with an attached poster is viewed
- **THEN** the portal can resolve and serve the stored PDF from its storage reference

### Requirement: No mock or seed data

The portal SHALL ship with no seeded properties or responses; the database starts empty and only ever contains records the admin creates.

#### Scenario: First run shows empty state

- **WHEN** the portal is opened against a fresh deployment
- **THEN** every screen shows its empty state and no mock properties or responses appear
