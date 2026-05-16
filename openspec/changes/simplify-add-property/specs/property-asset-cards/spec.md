## ADDED Requirements

### Requirement: Listings card renders the property as an asset collection

Each Listings card SHALL render the property as its collection of assets — a hero image plus a thumbnail strip of any other uploaded images, the four extracted facts (room type, building type, area, age), the rent, and the poster and dispatch status pills — with a "—" placeholder for any fact the poster extraction has not produced yet.

#### Scenario: Card shows the uploaded image gallery

- **WHEN** a property card renders and the property has uploaded images
- **THEN** the first image is the hero and the remaining images appear as thumbnails, with the photo count badge reflecting the gallery size

#### Scenario: Card shows extracted facts when present

- **WHEN** a property has had poster extraction populate its detail fields
- **THEN** the card displays room type, building type, area, and age in the facts grid, along with the rent and the dispatch pill

#### Scenario: Card degrades gracefully for missing facts

- **WHEN** a property is missing one or more extracted facts
- **THEN** each absent fact shows "—" and the card still renders cleanly

### Requirement: Poster is accessible from the card

When a property has an attached poster, the card SHALL surface a way to open or download the stored poster PDF.

#### Scenario: Poster ready on the card

- **WHEN** a property card has a poster attached
- **THEN** the card shows a "Poster ready" affordance that opens or downloads the stored PDF from Convex file storage

### Requirement: Recommend hides properties without engine-ready details

The Recommend screen's property picker SHALL only list properties whose extracted detail fields cover what the decision engine reads — at minimum `rentSGD`, `housingType`, and `commuteMins` — and SHALL show a brief note explaining that other properties are waiting for poster extraction.

#### Scenario: Undetailed property is filtered out of the picker

- **WHEN** a property exists but is missing `rentSGD`, `housingType`, or `commuteMins`
- **THEN** it does not appear in the Recommend property picker

#### Scenario: Footnote explains the omission

- **WHEN** at least one property is hidden by this filter
- **THEN** the Recommend screen shows a brief note saying those properties are waiting on poster extraction
