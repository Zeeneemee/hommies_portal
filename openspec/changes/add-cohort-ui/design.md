## Context

The Recommend page (`src/components/Recommend.jsx`) is the operator's primary workspace for matching customers to properties. It has two views — by-property and by-client — and a `PropertyMatchCard` / `ClientMatchCard` system that already surfaces the existing `decide()` engine output. The page does not yet consume the cohort-matching primitives shipped in `add-cohort-pair-fit` and `add-cohort-assembler`.

`assembleCohort(prop, pool)` is a synchronous pure function with no I/O. It runs in well under a frame on realistic pools (sub-millisecond for tens of customers). That property makes the operator UX simple: a button → immediate result, no spinner, no async state.

We chose to anchor the UI in the by-property view because cohorts are property-anchored by design (you fill *this specific 3-bedroom unit* with three solos). The by-client view has no natural slot for cohort UX — a customer doesn't belong to one cohort, they're a candidate for many.

## Goals / Non-Goals

**Goals:**
- An operator viewing a whole-unit listing on Recommend can click one button and see a suggested cohort, with each member's name, room assignment, and per-person rent.
- When the assembler can't return a cohort, the operator sees a one-sentence explanation of why — never a raw error code.
- The UI never lies about state: navigating to a different property clears the suggestion (so a stale Mei/Wei/Arjun trio doesn't appear next to a property they were never matched against).
- The button is invisible on properties where cohort matching doesn't apply (Room listings, whole units without room counts). Zero noise.

**Non-Goals:**
- Pinning cohort members. The operator still uses the existing per-member pin flow if they decide to commit.
- Drafting outreach messages for the cohort.
- Persisting the suggestion to Convex.
- Showing multiple alternative cohorts or letting the operator swap members.
- Sorting / filtering controls inside the cohort card.
- Mobile-specific layouts (the existing Recommend page is desktop-first).
- Any change to `decide()`, `pairFitForProperty`, `splitRent`, or `assembleCohort` themselves. This is presentation only.

## Decisions

### Button placement: bottom of the property summary card

The property summary card already lives at the top of the right-hand column in ByPropertyView, showing four `Fact` tiles (Matching against / Rent / Commute / Layout). The button section attaches below those facts with a `border-top: 1px solid var(--hairline)` divider. This keeps cohort actions visually tied to "this is the property we're matching against" without inflating the AssignmentSection stack below.

**Why not a dedicated tab or modal:** the cohort suggestion isn't a parallel workspace — it's a quick read on the current property. Inline rendering matches the operator's mental model of "show me a cohort for what I'm looking at."

### Visibility gate

The button section renders only when:

```js
prop.housingType === 'Whole Unit' &&
typeof prop.masterCount === 'number' &&
typeof prop.commonCount === 'number' &&
(prop.masterCount + prop.commonCount) > 0
```

This is a strict superset of the assembler's `isPropertyAssemblable` check — we never show a button that's guaranteed to return `property_not_splittable`. Operators with Master Room listings (the common case) see no extra UI.

### Failure result rendering

The failure card uses `border-left: 3px solid var(--warn)` to signal "informational, not error." The card never shows the raw `reason` string — it looks up `COHORT_REASON_COPY[reason]` and falls back to a generic "Assembly failed: ${reason}." for unknown codes (defensive against future reasons we haven't mapped yet).

**Why a card, not a toast:** the operator may want to read the reason while still looking at the property. A toast disappears. A dismissible card stays until they're done.

### Success card structure

Three sections inside the navy-bordered card:

1. **Header**: "Suggested cohort · N of M" + score line. M is `prop.masterCount + prop.commonCount` (the target). N is `cohort.length`. For a successful assembly N === M, but writing it as a ratio makes the layout context legible.
2. **Member rows**: one per cohort member, each in a `cream`-background pill. Left side: name + meta (school · budget range · lease length). Right side: rent + room kind ("S$1,800 master" / "S$1,350 common").
3. **Pair-fits + notes**: pair-fit scores joined as " · " for compactness; notes bulleted below.

The `cream` row background matches the existing `Lifted:` chip styling from `AddProperty.jsx`, giving cohort cards a familiar visual feel.

### State lifecycle

`cohortResult` is a `useState` in `ByPropertyView` rather than a memo derived from props. Rationale: the assembler should run on operator demand (click), not on every property switch — operators are exploring, not bulk-comparing. Lazy computation is honest to that workflow and lets operators see "press to suggest cohort" as an affordance.

The reset effect (`useEffect(() => setCohortResult(null), [selectedId])`) keeps the state from leaking between properties. The dismiss button (×) sets state to null without changing the property selection.

### `COHORT_REASON_COPY` is a static module-scope const

The mapping lives next to the component, not in `decisionLogic.js`. Operator-facing copy is a presentation concern; the assembler should keep emitting structured reasons that other surfaces (logs, future UIs) can interpret without coupling to this copy table.

## Risks / Trade-offs

- **[The button-click result is a snapshot — it goes stale]** If a new customer arrives between the click and the operator's review, the suggestion is out of date. **Mitigation:** the operator can re-click any time. We do NOT auto-refresh on response changes — that would create flickering suggestions while the operator is reading.

- **[Cohort suggestions can suggest the same person across multiple property cards in different sessions]** A solo customer can legitimately fit several whole-unit listings. The current UI shows one cohort per property without warning the operator that members might appear in other property cohorts. **Mitigation:** v1 accepts this. The future cross-property optimisation is a separate change.

- **[Lifestyle conflicts surfaced only in notes]** A 100/100 cohort with one quiet vs not-quiet asymmetric pair will show no score penalty (consistent with pair-fit's lifestyle-as-notes policy) but does carry the note. Operators must read the notes. **Mitigation:** the notes list is visually prominent — bulleted, fixed beneath the cohort. We don't bury it in a tooltip.

- **[No keyboard navigation for the dismiss button]** The × button is keyboard-accessible by default (it's a real `<button>`), but the cohort card itself isn't focusable. **Mitigation:** acceptable for v1; the page is desktop-mouse-first.

- **[The friendly reason copy has been written, not user-tested]** Some phrases may be confusing (e.g. "the pool" — what pool? all customers? recent customers?). **Mitigation:** the strings are easy to tune; we ship and iterate based on operator feedback.

- **[Spec drift relative to the relaxed pair-fit]** The `movein_too_far` removal touches the `add-cohort-pair-fit` capability, which has been spec-updated in place since that change hasn't been archived. If/when archive happens, the consolidated capability will already reflect the relaxation. **Mitigation:** noted in the proposal; no separate delta needed.
