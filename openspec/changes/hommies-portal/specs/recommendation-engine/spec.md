## ADDED Requirements

### Requirement: Binary Send / Don't-send verdict with reason

Given one Google Form response and one property, `decisionLogic.js` SHALL produce a binary verdict of exactly Send or Don't send, accompanied by a human-readable reason. The portal SHALL never display STRONG/MEDIUM/WEAK grades.

#### Scenario: Engine returns a binary verdict

- **WHEN** the engine evaluates a response against a property
- **THEN** it returns either Send or Don't send, never an intermediate grade

#### Scenario: Every verdict carries a reason

- **WHEN** the engine returns a verdict
- **THEN** it includes a human-readable reason explaining why, so that a held-back student is a deliberate, explained decision

### Requirement: Weighted six-factor scoring

`decisionLogic.js` SHALL compute a 0–100 score from six weighted factors — Budget (30), School (22), Commute (20), Housing type (12), Unit layout (9), Building type (7). Budget compares property rent against the student's stated min–max range. School recognises NUS/NTU/SMU and unlocks the campus commute number. Commute compares door-to-door minutes to that campus against the student's stated tolerance. Unit layout counts any overlap between preferred layouts and the property's unit type. Building type compares Condo/HDB/Any against the property. The score SHALL be used only to rank the Send list, not shown as a grade.

#### Scenario: Score ranks the Send list

- **WHEN** multiple responses receive a Send verdict for the same property
- **THEN** the Send list is ordered by descending 0–100 score so the admin knows who to contact first

#### Scenario: Budget within range scores fully, small overshoot scores partial

- **WHEN** a property's rent sits inside the student's budget range
- **THEN** the Budget factor scores fully; **AND WHEN** the rent is a small overshoot, the Budget factor scores partially

### Requirement: Hard blockers cap the verdict at Don't send

`decisionLogic.js` SHALL treat over-budget (rent well above the stated range) and a Room vs Whole-Unit housing-type mismatch as hard blockers that cap the verdict at Don't send regardless of the computed score.

#### Scenario: Over-budget is a hard blocker

- **WHEN** a property's rent is well above the student's stated budget range
- **THEN** the verdict is Don't send with an over-budget reason, regardless of other factors

#### Scenario: Housing-type mismatch is a hard blocker

- **WHEN** the student wants a Room but the property is a Whole Unit (or vice versa)
- **THEN** the verdict is Don't send with a housing-type-mismatch reason

#### Scenario: Stacked mismatches or weak overall fit yield Don't send

- **WHEN** a response has two or more stacked factor mismatches, or a generally weak overall fit, with no hard blocker
- **THEN** the verdict is still Don't send with the corresponding reason

### Requirement: Ranked Send list and explained Hold list

`decisionLogic.js` SHALL expose a `recommendRecipients()` function that runs an entire response database against one property and splits it into a ranked Send list and an explained Hold list; the Recommend screen SHALL present both.

#### Scenario: Database is split into Send and Hold

- **WHEN** the admin runs the recommendation for a chosen property
- **THEN** the portal shows a ranked Send list and a Hold list, with every Hold entry showing its reason

#### Scenario: No recipient is silently dropped

- **WHEN** the recommendation runs
- **THEN** every response in the database appears in exactly one of the Send or Hold lists

### Requirement: Drafted bilingual message per Send recipient

For each recipient on the Send list, the portal SHALL draft a warm, family-first bilingual (中/EN) message suited to the recipient's preferred channel (Line/Instagram) to accompany the poster; the admin reviews and sends manually.

#### Scenario: Each Send recipient gets a drafted message

- **WHEN** the recommendation produces a Send list
- **THEN** each Send entry includes a drafted bilingual message the admin can review before sending

#### Scenario: Draft tone is warm, not corporate

- **WHEN** a message is drafted
- **THEN** it uses a warm, family-first tone consistent with the Hommies.sg brand
