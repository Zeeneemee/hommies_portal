## ADDED Requirements

### Requirement: Master and common room counts on whole-unit listings

The `properties` record SHALL accept two optional non-negative integer fields, `masterCount` and `commonCount`, representing how many master bedrooms and how many common bedrooms the whole-unit listing contains. The fields are only meaningful when `housingType === "Whole Unit"`. They MAY both be absent (the listing opts out of split-aware behaviour) or both be present (the listing participates).

#### Scenario: Operator sets counts on a whole-unit listing
- **WHEN** an operator edits a whole-unit listing in `ListingEditModal` and enters `masterCount = 1`, `commonCount = 2`
- **THEN** both values are persisted on the `properties` row and become visible to downstream consumers (recommend engine, listing card)

#### Scenario: Counts omitted on a whole-unit listing
- **WHEN** a whole-unit listing has neither `masterCount` nor `commonCount` set
- **THEN** the listing is valid and persisted, and downstream consumers SHALL treat it as not participating in the split

#### Scenario: Counts on a non-whole-unit listing
- **WHEN** a listing with `housingType !== "Whole Unit"` has values written into `masterCount` or `commonCount`
- **THEN** the fields are persisted (for forward-compat) but ignored by the rent-split formula and the recommend engine

### Requirement: Gemini extraction drafts master and common counts

The poster extraction action (`convex/extraction.ts`) SHALL extend its Gemini prompt to request `masterCount` and `commonCount` alongside the existing fields, and SHALL include both values in the sanitised output when Gemini returns non-negative integers for them. Drafted values are persisted to the `properties` row by `extraction:extractPosterDetails` so the operator confirms (or overrides) them in the listing editor — the system does not require operator confirmation before persisting.

#### Scenario: Poster names master + 2 common rooms
- **WHEN** Gemini returns `{ masterCount: 1, commonCount: 2 }` from a poster for a whole-unit listing
- **THEN** both fields are written to the `properties` row by the extraction action

#### Scenario: Poster does not name room composition
- **WHEN** Gemini omits `masterCount` or `commonCount` from its response
- **THEN** the extraction action leaves those fields unset on the `properties` row (does not write zeros)

#### Scenario: Gemini returns invalid count
- **WHEN** Gemini returns a non-numeric or negative value for `masterCount` or `commonCount`
- **THEN** the sanitiser drops the invalid field and the row receives no value for it

### Requirement: Rent-split formula (Option A)

The system SHALL expose a pure function that, given a whole-unit listing's `rentSGD`, `masterCount`, and `commonCount`, returns the per-person rent for a master room and for a common room such that `masterCount * masterRent + commonCount * commonRent === rentSGD` (within standard floating-point tolerance). The formula is:

- If `commonCount === 0` and `masterCount > 0`: each master pays `rentSGD / masterCount`.
- If `masterCount === 0` and `commonCount > 0`: each common pays `rentSGD / commonCount`.
- Otherwise: `avg = rentSGD / (masterCount + commonCount)`, `masterRent = avg * 1.20`, `commonRent = (rentSGD - masterCount * masterRent) / commonCount`.

When `masterCount + commonCount === 0`, the function SHALL return null (no split possible).

#### Scenario: 1 master + 1 common at S$4,300
- **WHEN** `splitRent({ rentSGD: 4300, masterCount: 1, commonCount: 1 })` is called
- **THEN** the result is `{ master: 2580, common: 1720, perRoomAvg: 2150 }` and `1 * 2580 + 1 * 1720 === 4300`

#### Scenario: 1 master + 2 common at S$4,300
- **WHEN** `splitRent({ rentSGD: 4300, masterCount: 1, commonCount: 2 })` is called
- **THEN** the result satisfies `1 * master + 2 * common === 4300` with `master = 4300 * 1.20 / 3` and `common = (4300 - master) / 2`

#### Scenario: All masters, no commons
- **WHEN** `splitRent({ rentSGD: 4000, masterCount: 2, commonCount: 0 })` is called
- **THEN** the result is `{ master: 2000, common: null, perRoomAvg: 2000 }` (the 1.2× premium does not apply because no commons absorb the discount)

#### Scenario: All commons, no master
- **WHEN** `splitRent({ rentSGD: 3000, masterCount: 0, commonCount: 3 })` is called
- **THEN** the result is `{ master: null, common: 1000, perRoomAvg: 1000 }`

#### Scenario: Missing counts
- **WHEN** `splitRent({ rentSGD: 4300, masterCount: 0, commonCount: 0 })` or either count is undefined is called
- **THEN** the function returns null
