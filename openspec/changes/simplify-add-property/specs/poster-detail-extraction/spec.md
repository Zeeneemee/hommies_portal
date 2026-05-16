## ADDED Requirements

### Requirement: Attaching a poster triggers detail extraction

When the admin attaches a poster PDF to a property, the portal SHALL invoke a Convex action that reads the PDF blob from Convex file storage, extracts its text, and patches the property record with any structured details it can lift — `area`, `buildingType`, `housingType`, `ageYears`, `unitType`, `rentSGD`, `fullAddress`, and per-campus `commuteMins` (NUS / NTU / SMU).

#### Scenario: Extraction runs on poster attach

- **WHEN** the admin attaches a poster PDF to a property
- **THEN** the extraction action runs against the stored PDF and the property record is patched with the lifted detail fields

#### Scenario: Lifecycle advances regardless of extraction outcome

- **WHEN** the poster is attached, whether or not extraction finds every field
- **THEN** the property's lifecycle still advances to `poster_attached`

### Requirement: Tolerant of missing fields

The extraction action SHALL skip any field it cannot find in the PDF text — without raising an error and without overwriting any value already on the record — leaving the missing field absent until a corrected poster is re-attached.

#### Scenario: Missing fields are simply absent

- **WHEN** the poster text is missing one or more expected labeled fields
- **THEN** the property record keeps those fields absent (no overwrites of existing values, no error) and the rest of the lifted fields are still patched in

#### Scenario: Failed extraction does not block the workflow

- **WHEN** the PDF cannot be parsed at all (e.g. raster-only text)
- **THEN** the action records the failure on the property and the property still appears in Status with its `poster_attached` lifecycle stage

### Requirement: Extraction metadata captured for debugging

The property record SHALL carry extraction metadata — `posterExtractedAt` (timestamp) and `posterExtractionRaw` (the raw extracted PDF text) — so a failed or partial extraction can be diagnosed without re-uploading the poster.

#### Scenario: Raw text is stored after a run

- **WHEN** the extraction action completes (successfully or not)
- **THEN** the property record carries `posterExtractedAt` and the raw extracted text, available for diagnosis
