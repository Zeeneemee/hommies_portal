## ADDED Requirements

### Requirement: Weighted six-factor scoring with criteria levels

The decision engine SHALL score one response against one property across six weighted factors — Budget (30), School (22), Commute (20), Housing type (12), Unit layout (9), Building type (7) — producing a 0–100 score and, for each factor, a criterion carrying a level of `pass`, `soft`, or `fail` and a human-readable detail.

#### Scenario: Each factor yields a levelled criterion

- **WHEN** the engine evaluates a response against a property
- **THEN** it returns a 0–100 score and one criterion per factor, each marked `pass`, `soft`, or `fail` with a detail string

#### Scenario: Budget within range passes; a small overshoot is soft

- **WHEN** the rent sits inside the response's budget range
- **THEN** the Budget criterion is `pass`; **AND WHEN** the rent is over the maximum by no more than S$200, the Budget criterion is `soft`

### Requirement: Send threshold and binary verdict

The engine SHALL produce a binary verdict of `send` or `hold`; a response SHALL be `hold` when a hard blocker applies, when two or more blockers stack, or when the score is below the send threshold of 58, and otherwise `send`. Every verdict SHALL carry a plain-language reason.

#### Scenario: Score below threshold is held

- **WHEN** a response has no hard blocker but scores below 58
- **THEN** the verdict is `hold` with a reason naming the score and threshold

#### Scenario: Sufficient score with no blocker is sent

- **WHEN** a response scores 58 or above with no hard blocker
- **THEN** the verdict is `send` with a reason summarising the match

### Requirement: Hard blockers

The engine SHALL treat over-budget (rent more than S$200 above the maximum), a Room vs Whole-Unit housing mismatch, and a commute beyond tolerance plus the soft-over margin as hard blockers; any hard blocker SHALL force a `hold` verdict.

#### Scenario: Over-budget forces a hold

- **WHEN** the rent is more than S$200 above the response's budget maximum
- **THEN** the verdict is `hold` and the reason states it is over budget

#### Scenario: Housing-type mismatch forces a hold

- **WHEN** the response wants a Room but the property is a Whole Unit (or vice versa)
- **THEN** the verdict is `hold` and the reason states the housing-type mismatch

#### Scenario: Commute well beyond tolerance forces a hold

- **WHEN** the property's commute to the response's school exceeds the response's tolerance by more than the soft-over margin
- **THEN** the verdict is `hold` and the reason states the commute is too far

### Requirement: Ranked Send and Hold buckets

`recommendRecipients(property, responses)` SHALL evaluate every response against the property and return a `send` bucket and a `hold` bucket, each ranked by descending score, with every response in exactly one bucket.

#### Scenario: Buckets are ranked and complete

- **WHEN** the engine recommends recipients for a property
- **THEN** the `send` and `hold` buckets are each ordered by descending score and together contain every response exactly once

### Requirement: Bilingual draft messages

For a given response, property, and decision, the engine SHALL produce a warm, family-first outreach draft containing both an English and a 中文 version, naming the property and rent, stating the commute when known, honestly surfacing any soft caveat, and including the "we are not agents" framing.

#### Scenario: Draft is bilingual and honest

- **WHEN** a draft message is produced for a Send recipient
- **THEN** it contains an English section and a 中文 section, names the property and rent, and surfaces any soft caveat rather than hiding it

### Requirement: Tolerant bilingual CSV parsing

The engine SHALL parse a Google Form CSV export by detecting columns from bilingual (中 / EN) header substrings, normalising school, building type, housing type, unit layout, budget range, and commute tolerance into the response data model.

#### Scenario: Bilingual headers are detected regardless of order

- **WHEN** a Google Form CSV export is parsed
- **THEN** columns are matched by their 中 or EN header substrings and each row becomes a normalised response record

#### Scenario: Budget range is parsed to min and max

- **WHEN** a budget cell contains a range
- **THEN** it is parsed into numeric `min` and `max` values
