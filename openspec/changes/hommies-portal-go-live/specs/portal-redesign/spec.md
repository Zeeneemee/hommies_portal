## ADDED Requirements

### Requirement: Navy sidebar shell with workflow navigation

The portal SHALL present a navy left **sidebar** holding the Hommies brand mark and wordmark, a numbered four-step workflow navigation (Add Property, Status, Recommend, Listings) with live counts, and a "we are not agents" footer; the main column SHALL show the active screen above a footer strip carrying the same disclaimer.

#### Scenario: Sidebar shows the numbered workflow

- **WHEN** the portal opens
- **THEN** the sidebar shows the four screens numbered 1–4 in workflow order, with the active one highlighted, and the portal opens on Add Property

#### Scenario: Nav counts reflect live data

- **WHEN** properties or responses exist
- **THEN** the Status and Listings nav items show the property count and the Recommend item shows the response count

### Requirement: Fraunces/Inter design system and brand tokens

The portal SHALL use Fraunces as the display typeface and Inter as the body typeface, and SHALL apply the design's full token set (orange, navy and navy variants, cream, green, grey, hairline, ink levels, danger, radii, card shadow) from a single source of truth.

#### Scenario: Type and tokens match the design

- **WHEN** any screen renders
- **THEN** headings use Fraunces, body text uses Inter, and colours come from the shared token set with no hard-coded hex values in components

### Requirement: Add Property screen

The Add Property screen SHALL capture the property record across a Property details card (condo, area, age, building-type and housing-type segments, rent, room type, full address), a Commute card (NUS/NTU/SMU minutes), a Recorded media card (chip inputs for photo filenames, listing links, video links), the Generate poster prompt card, and a Poster PDF upload card; saving SHALL require condo, area, and rent.

#### Scenario: Property is saved with the required basics

- **WHEN** the admin fills condo, area, and rent and saves
- **THEN** the property is persisted and the admin is taken to the Status screen

#### Scenario: Saving is blocked without the basics

- **WHEN** the admin saves with condo, area, or rent missing
- **THEN** the portal blocks the save and tells the admin which basics to fill

#### Scenario: Poster upload advances status

- **WHEN** the admin attaches a poster PDF to the property
- **THEN** the property's status is `poster_attached`; otherwise a saved property's status is `data_received`

### Requirement: Status screen

The Status screen SHALL show three stage-stat cards counting properties at each lifecycle stage and a table listing every property with its room type, area, a three-dot progress track, a status pill, and a context action that advances the lifecycle (`Attach poster` → `Mark sent` → `Reopen`).

#### Scenario: Stage counts and table reflect the pipeline

- **WHEN** the Status screen renders
- **THEN** the three stage-stat cards count properties at `data_received`, `poster_attached`, and `sent`, and each property row shows its progress track and status pill

#### Scenario: Context action advances the lifecycle

- **WHEN** the admin uses a property's context action
- **THEN** a `poster_attached` property can be marked `sent`, a `sent` property can be reopened, and a `data_received` property without a poster prompts the admin to attach one first

### Requirement: Recommend screen

The Recommend screen SHALL present a property picker on the left and, on the right, the "we do not blast" principle, a matching-against fact card, Send/Don't-send bucket tabs with counts, and match cards; it SHALL support importing a Google Form CSV and adding a response through a manual-entry modal.

#### Scenario: Picking a property splits the responses

- **WHEN** the admin picks a property
- **THEN** the right side shows ranked Send match cards and Hold match cards, each with the verdict, reason, and pass/soft/fail criteria chips

#### Scenario: Send match card reveals a bilingual draft

- **WHEN** the admin opens the draft on a Send match card
- **THEN** a bilingual 中/EN outreach draft is shown with a copy action

#### Scenario: Responses load by CSV or manual entry

- **WHEN** the admin imports a Google Form CSV or saves the manual-entry modal
- **THEN** the parsed response records are added and appear in the matching results

### Requirement: Listings screen

The Listings screen SHALL show every property as a card in a grid, filterable by All / Condo / HDB, each card surfacing the four facts (room type, building type, area, age) plus rent, poster status, and dispatch status.

#### Scenario: Cards surface the four facts and status

- **WHEN** the Listings screen renders
- **THEN** each property card shows room type, building type, area, age, rent, whether a poster is ready, and the dispatch status pill

#### Scenario: Building-type filter narrows the grid

- **WHEN** the admin selects the Condo or HDB filter
- **THEN** only properties of that building type are shown, and selecting All restores the full grid
