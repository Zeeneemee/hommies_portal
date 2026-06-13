## ADDED Requirements

### Requirement: Properties carry a normalized tags array

The `properties` document SHALL have an optional `tags` field that is an array of normalized string labels. A property with no tags is valid (the field is absent or an empty array). Tags SHALL be de-duplicated within a property.

#### Scenario: New property without tags

- **WHEN** a property is added with only a name and images and no tags are derived yet
- **THEN** the property document is valid with `tags` absent
- **AND** no property-search surface errors when `tags` is missing

#### Scenario: Tags persisted and editable

- **WHEN** a `tags` array is written to a property via the `update` mutation
- **THEN** the validator accepts it and the stored property exposes the same de-duplicated tags

### Requirement: Bedroom tag is derived from bedroom count

The system SHALL define a single, deterministic rule that maps an extracted bedroom count to one bedroom tag, so the vocabulary is consistent across extraction, backfill, and manual edits. The rule SHALL produce `"Studio"` when the unit is a studio (one bedroom presented as a studio) and `"<n>BR"` for a whole-unit count of `n` bedrooms (e.g. `"1BR"`, `"2BR"`, `"3BR"`). When no bedroom count is known, no bedroom tag is produced.

#### Scenario: Whole-unit count maps to NBR

- **WHEN** the derivation runs with a bedroom count of 2
- **THEN** the derived bedroom tag is `"2BR"`

#### Scenario: Missing count yields no tag

- **WHEN** the derivation runs with no usable bedroom count
- **THEN** no bedroom tag is produced and existing non-bedroom tags are left untouched

### Requirement: Extraction attaches the bedroom tag idempotently

Both extraction paths — the PropertyGuru URL path (`extractPropertyGuruUrl`) and the poster PDF path (`extractPosterDetails`) — SHALL derive the bedroom tag from the sanitised bedroom count and include it in the property's `tags`. Re-running extraction SHALL replace any prior bedroom tag rather than appending a duplicate, and SHALL preserve any non-bedroom tags already present.

#### Scenario: URL extraction adds a bedroom tag

- **WHEN** `extractPropertyGuruUrl` determines the listing has 3 bedrooms
- **THEN** the returned fields carry a bedroom tag `"3BR"` so the client can persist it on save

#### Scenario: Poster extraction adds a bedroom tag

- **WHEN** `extractPosterDetails` lifts a bedroom count from the poster
- **THEN** the property patch sets `tags` including the matching bedroom tag

#### Scenario: Re-extraction does not duplicate

- **WHEN** a property already tagged `"2BR"` is re-extracted and now resolves to 3 bedrooms
- **THEN** the resulting tags contain `"3BR"`, do not contain `"2BR"`, and retain any non-bedroom tags

### Requirement: Existing prod inventory is backfilled by re-extraction

A one-shot backfill SHALL iterate every existing property and re-run extraction from its attached source (poster or stored listing source) to recover the bedroom count and write the bedroom tag. Properties for which no bedroom count can be recovered SHALL be left without a bedroom tag (operator can set it via the edit modal) and SHALL NOT block the rest of the backfill.

#### Scenario: Tagged from poster on backfill

- **WHEN** the backfill processes a property that has a poster and the poster yields 2 bedrooms
- **THEN** the property ends with a bedroom tag `"2BR"`

#### Scenario: Backfill skips unrecoverable rows without failing

- **WHEN** the backfill processes a property whose source yields no bedroom count
- **THEN** that property is left without a bedroom tag and the backfill continues to the next property

### Requirement: Operators can filter properties by bedroom tag

A property-search surface SHALL let operators narrow the inventory by bedroom tag, reusing the existing filter state and Clear-filters behavior. A property with no matching bedroom tag SHALL be excluded only when a bedroom-tag filter is active.

#### Scenario: Filter narrows to a bedroom tag

- **WHEN** an operator activates the `"2BR"` bedroom-tag filter
- **THEN** only properties whose tags include `"2BR"` remain visible

#### Scenario: Cleared filter restores all

- **WHEN** the operator clears filters
- **THEN** the bedroom-tag filter is reset and all properties are visible again

### Requirement: Manual bedroom edits keep the tag in sync

When an operator changes a property's bedroom count in the listing edit modal, the saved property's bedroom tag SHALL be recomputed from the new count using the same derivation rule, replacing any prior bedroom tag.

#### Scenario: Editing bedroom count updates the tag

- **WHEN** an operator changes bedrooms from 2 to 3 in the edit modal and saves
- **THEN** the property's tags include `"3BR"` and no longer include `"2BR"`
