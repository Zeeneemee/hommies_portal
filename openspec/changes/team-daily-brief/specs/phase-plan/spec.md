## ADDED Requirements

### Requirement: Selectable phase period
The system SHALL let the team scope the phase plan by a phase period, selectable as either a week or a month, and SHALL identify the period that covers the current date by default.

#### Scenario: Default to current period
- **WHEN** a user opens the Phase Plan section
- **THEN** the system shows the plan for the period (week or month) covering today

#### Scenario: Switch period granularity
- **WHEN** a user switches the phase period between week and month
- **THEN** the system shows the plan associated with the selected granularity and period

### Requirement: Read and write the phase plan
The system SHALL display the phase plan for the selected period as a tick-off checklist of items (each with text and a done flag) that any teammate can add to, check off, and remove, persisting the items so they are visible to the whole team.

#### Scenario: Add an item to an empty period
- **WHEN** a teammate adds a plan item for a period that has no plan yet
- **THEN** the system creates the plan for that period with the item, unchecked

#### Scenario: Check off a plan item
- **WHEN** a teammate ticks a plan item done
- **THEN** the item is shown checked off and the change is reflected for all viewers in real time

#### Scenario: Remove a plan item
- **WHEN** a teammate removes a plan item
- **THEN** the item no longer appears in that period's plan

### Requirement: Plans are scoped per period
The system SHALL store at most one plan per (granularity, period) so that each week and each month has its own distinct plan.

#### Scenario: Distinct plans across periods
- **WHEN** a plan exists for this week and the user selects next week
- **THEN** the system shows next week's plan (or an empty editor) independently of this week's plan
