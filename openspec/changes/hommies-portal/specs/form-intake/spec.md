## ADDED Requirements

### Requirement: Parse the 13 bilingual Google Form fields

The portal SHALL parse every Google Form response through `formSchema.js` into one clean record with 13 fields: name, channel (Line/Instagram/Facebook), contact handle, school (NUS/NTU/SMU/OTHER), move-in date, lease length, budget as a numeric `{min, max}` range, building type (Condo/HDB/Any), housing type (Room/Whole Unit), unit layout as a multi-select list, commute tolerance in minutes, want-roommate boolean, and extras (pet/cooking/quiet/gym flags plus free-text note). The parser SHALL recognise both 中 and EN values.

#### Scenario: Bilingual values are recognised

- **WHEN** a response uses Chinese values (e.g. a 中 school name or building-type term)
- **THEN** `formSchema.js` maps it to the same normalized field value as the English equivalent

#### Scenario: Budget range is parsed numerically

- **WHEN** a response states a monthly budget range
- **THEN** it is parsed into a numeric `{min, max}` range

#### Scenario: Multi-select layout is parsed as a list

- **WHEN** a response selects multiple unit layouts (e.g. Common Room and Master Room)
- **THEN** the parsed record holds them as a list

#### Scenario: Unrecognised school falls back to OTHER

- **WHEN** a response names a school that is not NUS, NTU, or SMU
- **THEN** the parsed `school` field is OTHER

### Requirement: Import responses from Google Form CSV export

The portal SHALL let the admin upload a Google Form CSV export and parse every row into a clean response record stored through `store.js`.

#### Scenario: Admin uploads a CSV export

- **WHEN** the admin uploads a Google Form CSV export
- **THEN** every row is parsed via `formSchema.js` and the resulting response records are saved

#### Scenario: Columns are matched by header, not position

- **WHEN** the CSV's columns are reordered relative to a previous export
- **THEN** the importer still maps each column correctly by its recognised 中/EN header

### Requirement: Add a response manually

The portal SHALL let the admin add a single response manually — for a walk-in or DM enquiry that never went through the form — producing the same clean 13-field record as a CSV import.

#### Scenario: Admin enters a walk-in enquiry

- **WHEN** the admin fills in the manual-entry form for a walk-in enquiry and submits
- **THEN** the portal saves a response record in the same shape as a CSV-imported one, marked as manually sourced
