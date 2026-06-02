## ADDED Requirements

### Requirement: Group size on responses

The `responses` record SHALL accept an optional integer field `groupSize` (≥ 1) capturing how many people will live in the unit together, including the responding customer. When absent, the system SHALL treat the response as solo (`groupSize = 1`). The existing `wantRoommate: boolean` SHALL remain in the schema for back-compat and continues to express openness to sharing, but it does not encode a count.

#### Scenario: Group size captured from chat intake
- **WHEN** the chat property intake collects "I'm with 2 friends" from the customer
- **THEN** the response is persisted with `groupSize = 3`

#### Scenario: Couple captured from intake
- **WHEN** the intake collects a couple
- **THEN** the response is persisted with `groupSize = 2`

#### Scenario: Group size missing
- **WHEN** a response is created without a `groupSize` value (e.g. legacy Google Sheet rows)
- **THEN** the recommend engine SHALL treat the response as solo and skip group-aware behaviour

### Requirement: Group-aware budget scoring

The recommend engine SHALL compare per-person rent (not full unit rent) against the response's budget band when ALL of the following are true:
1. `prop.housingType === "Whole Unit"`, AND
2. `prop.masterCount` and `prop.commonCount` are both defined and at least one is > 0, AND
3. `resp.groupSize` is defined and > 1.

The per-person rent used for the comparison SHALL be the price of the cheapest available room type — `commonRent` when `commonCount > 0`, otherwise `masterRent`. The existing budget-band logic (in-range vs over vs under) is reused unchanged with this per-person value as the rent input.

When any of the three conditions is not satisfied, the engine SHALL use the full `rentSGD` against `resp.budget` exactly as today.

#### Scenario: Group of 3 evaluates a 4.3k whole unit with 1M + 2C, budget ceiling S$1,500
- **WHEN** `decide(prop={rentSGD:4300,housingType:"Whole Unit",masterCount:1,commonCount:2}, resp={groupSize:3,budget:{min:1000,max:1500}})` is called
- **THEN** the engine scores against the common rent (S$1,290), which is within budget, and does NOT add an `over_budget` blocker

#### Scenario: Solo customer evaluates the same whole unit
- **WHEN** the same property is evaluated against a response with `groupSize` absent or `1`
- **THEN** the engine compares the full S$4,300 against the budget and behaves exactly as it does today

#### Scenario: Whole unit without master/common counts
- **WHEN** a group=3 response evaluates a whole unit that has no `masterCount`/`commonCount` set
- **THEN** the engine falls back to comparing full `rentSGD` against budget (no split path)

### Requirement: Layout-feasibility blocker

The recommend engine SHALL add a hard blocker `over_layout` to the decision when `prop.housingType === "Whole Unit"`, both counts are defined, `resp.groupSize > 1`, and `resp.groupSize > masterCount + commonCount`. The blocker behaves the same way as the existing `over_budget` blocker (excludes the listing from "send" recommendations, produces a user-readable reason).

#### Scenario: Group of 4 evaluates a 1M + 2C whole unit
- **WHEN** `decide(prop={housingType:"Whole Unit",masterCount:1,commonCount:2,…}, resp={groupSize:4,…})` is called
- **THEN** the decision includes the `over_layout` blocker and the recommend card explains that the unit has only 3 bedrooms for a group of 4

#### Scenario: Group of 3 exactly fits a 1M + 2C unit
- **WHEN** `groupSize === masterCount + commonCount`
- **THEN** the `over_layout` blocker is NOT triggered (3 ≤ 3 is a fit)

### Requirement: Recommend card shows the split breakdown

The recommend card SHALL display the master and common per-person rent below the unit rent when the group-aware budget scoring path is active for that decision. The display format is monetary (S$ with thousands separator) and labels each value as `master` and `common`. When the split path is not active, the card layout is unchanged.

#### Scenario: Card renders a split for an active group decision
- **WHEN** the recommend card renders a decision where the split path activated (group > 1, whole unit, counts present)
- **THEN** the card includes a line such as `S$4,300/mo · S$2,580 master / S$1,720 common · per person`

#### Scenario: Card renders a solo decision unchanged
- **WHEN** the recommend card renders a decision where the split path did not activate
- **THEN** the card shows the existing rent-only display with no per-person breakdown
