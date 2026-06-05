## Context

The cohort matching stack — `splitRent`, `pairFitForProperty`, `assembleCohort` — currently embeds a single number, `MASTER_PREMIUM = 1.20`, deep in the rent-split arithmetic. Every downstream behaviour (room assignment, pair-fit budget feasibility, cohort assembly, cohort UI render) is parameterised by that one constant. The exploration session against Regent Heights made clear that the right answer for one property can be "no cohort fits" at 20% but "two candidates fit" at 10% and "many candidates fit" at 0%. Different tenant negotiations land at different points on that spectrum, and the operator needs visibility into all three to advise honestly.

The exploration session ended with the user picking the **side-by-side comparison** UX flavour (option A): for one property, show three cohort cards in a horizontal grid, one per policy. The engine runs three times (cheap — sub-millisecond per assemble); the UI displays each result side-by-side. The operator reads the cards and decides which policy fits the conversation.

## Goals / Non-Goals

**Goals:**
- A single, deterministic enum of three named policies (`equal`, `light`, `standard`) consumed by every layer that needs to know the master premium.
- Backward-compatible defaults: every existing caller of `splitRent` / `pairFitForProperty` / `assembleCohort` keeps the same behaviour because the default policy is `'standard'`.
- Comparative cohort UI: three cards rendered side-by-side, one per policy, each independently dismissible.
- The engine remains testable in isolation — each layer accepts an explicit `policy` parameter (or `options.splitPolicy`) and doesn't peek at any global state.
- Three documented worked examples per layer: one per policy, with the expected rent split and the expected cohort assignment.

**Non-Goals:**
- Per-property policy defaults stored on the `properties` table. No schema change. The default lives as a JS constant.
- A free-form custom-percentage slider. v1 is three named policies only.
- Persisting which policy the operator picked for a given pin. Pinning stays per-(property, response); the assignment ledger doesn't carry a policy field.
- A policy lock per property (e.g. "this property always uses light"). Out of scope for v1.
- Backfilling existing pins with a policy tag.
- Changes to `BUDGET_SOFT_OVERSHOOT` (still S$200) or `COMMUTE_SOFT_OVER` (still 15min).
- Fixing the room-feasibility-in-grow bug from the prior exploration. Still open, separate change.
- Fixing the Singaporean D/M/YYYY `parseMoveInDate` parser bug. Separate change.

## Decisions

### Enum, not a free number

`SPLIT_POLICIES` is a frozen object keyed by three string names, each mapping to `{ label, premium }`. Reasons:
- Three named policies are easier for operators to talk about ("we'll do the light premium") than free numbers.
- Validation is trivial — invalid keys collapse to the default.
- UI affordances are clean: three cards = three keys; no slider to test.
- Future-extensible: a 4th policy can be added with one entry. A continuous-slider UI can be added later if operators demand it without ripping out the enum (the slider just sets a custom premium).

```js
export const SPLIT_POLICIES = Object.freeze({
  equal:    { label: 'Equal split (50/50)',    premium: 1.00 },
  light:    { label: 'Light premium (10%)',    premium: 1.10 },
  standard: { label: 'Standard premium (20%)', premium: 1.20 },
})
export const DEFAULT_SPLIT_POLICY = 'standard'
```

### Default policy is `'standard'` — backward-compat by intention

Every existing test, every existing UI flow, every operator habit assumes the 20% premium. Defaulting to `standard` means this change is opt-in for callers that want a different policy. The cohort UI is the first caller to opt in (it calls all three explicitly). Everything else (single-customer recommendation via `decide()`, pre-formed group split, anything we haven't built yet) keeps the 20% number.

### `policy` flows as a positional arg on `splitRent`, options bag on `pairFitForProperty` / `assembleCohort`

`splitRent(prop)` only takes one argument today. Adding `policy` as a second positional arg is the smallest extension. `pairFitForProperty` and `assembleCohort` already plan for an `options` bag (the assembler's `options` was previously reserved for forward-compat). Adding `options.splitPolicy` keeps signatures stable and lets us add more options later (e.g. `options.maxCohortSize`).

```js
splitRent(prop, policy = 'standard')
pairFitForProperty(a, b, prop, options = {})        // options.splitPolicy
assembleCohort(prop, pool, options = {})            // options.splitPolicy
```

### Invalid policy → fallback, not throw

If a caller passes `policy: 'whatever-typo'`, the system falls back to `DEFAULT_SPLIT_POLICY` silently. Rationale: this is a UI surface; throwing would crash the whole render path. Tests cover the fallback so the behaviour is observable.

### The comparison grid in the UI

The cohort UI restructures to render three cards in a flex row:

```
┌────────────────┬────────────────┬────────────────┐
│ Equal split    │ Light premium  │ Standard       │
│ master 1900    │ master 2090    │ master 2280    │
│ common 1900    │ common 1710    │ common 1520    │
├────────────────┼────────────────┼────────────────┤
│ Cohort fit:    │ Cohort fit:    │ No cohort:     │
│ {members ...}  │ {members ...}  │ no_fit_pair    │
└────────────────┴────────────────┴────────────────┘
```

Each card uses the existing `CohortResultCard` rendering for its body. The new wrapper `CohortComparisonRow` is responsible for:
- The grid layout (three columns; collapses to stacked on narrow viewports).
- Per-card header showing the policy label + per-room rents.
- Per-card dismiss tracking. When all three are dismissed (or the property changes), the row hides.
- A small diagnostic strip above the grid: "3 of 19 candidates fit at equal · 2 at light · 0 at standard" — the operator's at-a-glance read on which policy is most permissive.

State shape:

```js
const [cohortComparison, setCohortComparison] = React.useState(null)
// shape: { byPolicy: { equal, light, standard }, dismissed: Set<policy> } | null
React.useEffect(() => { setCohortComparison(null) }, [selectedId])
```

### Diagnostic counts come from the assembler output

Each call to `assembleCohort` already exposes enough to count eligible candidates. The diagnostic count is computed in the UI from the three results — no engine change.

### Order of cards is fixed: equal → light → standard

Left-to-right is increasing premium. Reads as a continuum the operator can scan visually. No sortable / draggable / user-reorderable behaviour in v1.

### The `'Suggest cohort'` button label changes

Becomes `'Suggest cohorts'` (plural) to telegraph that the click produces three results. Single-card mode goes away; clicking always produces a triple.

### Spec updates land in the in-progress changes' source files

`add-cohort-pair-fit`, `add-cohort-assembler`, and `add-cohort-ui` are all still in `openspec/changes/`, not archived. Their spec files are the source of truth for those capabilities at the moment. Tasks here include editing those files in place rather than introducing a MODIFIED Requirements delta in this change. When any of them is eventually archived to `openspec/specs/`, the policy parameter will already be in the spec.

### Existing tests keep their assertions

The Wei × Mei worked example tests assert `Mei → master S$1,800`. That number is the standard-policy split, which is still the default. So the existing tests stay green without rewrite — the change just adds new tests for the other two policies.

## Risks / Trade-offs

- **[Operators may pick a policy the landlord won't accept]** A 50/50 split assumes the master tenant subsidises the commons. Many landlords don't want that built into their leases. **Mitigation:** the cards are *suggestions*; operators still negotiate offline and pin under whichever policy the parties agree to. Documentation in the per-card header explains the math; no pretense of automation.

- **[Running the engine 3× per click increases compute]** The cohort assembler is already sub-millisecond. 3× is still sub-millisecond. No realistic concern. **Mitigation:** none needed.

- **[The cards may differ wildly in cohort size]** A failure card next to a success card looks dramatic. That's the *point*. **Mitigation:** the failure card's friendly copy makes the reason clear; the success cards next to it show the alternative.

- **[Diagnostic counts could lie if eligibility filter differs per policy]** Eligibility (`wantRoommate`, `housingType`, `groupSize`) is policy-independent. So "candidates fit" per policy is really "candidates with at least one feasible room assignment under that policy." The diagnostic should describe what it counts precisely to avoid operator confusion. **Mitigation:** wording — "members fit" or "candidates affording at least one room" — chosen in the task spec.

- **[Mobile layout]** Three cards side-by-side don't fit a phone screen. **Mitigation:** the existing Recommend page is desktop-first; three cards stack into a single column on narrow viewports via CSS flex-wrap. v1 accepts that the stacked view is less compact.

- **[The chosen UX bypasses the operator's mental model of "one cohort per property"]** Switching from "the cohort" to "three policy variants" is a vocabulary shift. **Mitigation:** the header text "Cohort suggestions across split policies" makes the shift explicit. Pinning is still per-(property, response), so commitment semantics are unchanged.

- **[Sticky in-flight pins might predate the policies enum]** None today (no pins persist policy). **Mitigation:** nothing to migrate. Future change can add a policy field on assignments if needed.

- **[The room-feasibility bug still fires under 'standard']** Pre-existing bug; orthogonal to this change. **Mitigation:** documented as out-of-scope. The standard policy may still show a failure card even after this change ships, for the reasons that bug describes.
