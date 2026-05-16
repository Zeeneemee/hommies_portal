## Why

The Recommend page today answers "who would score well for this property?" by running `decide(resp, prop)` live and ranking the output. But the operator's actual job is different: for every property in inventory, decide *which specific clients it must be sent to*, then send it, then move on. The score is an input to that decision — not the decision itself.

That gap shows up operationally:

- The portal has no memory that a property was sent to a client. `draftMessage` copies a draft to the clipboard and the trail ends there. Visit the page tomorrow and the engine cheerfully re-suggests the same client.
- Score is noisy near the 58 threshold. A small update (e.g. a refreshed commute number after extraction) silently flips a client between "send" and "hold". The operator's commitment should not be that volatile.
- Properties with zero plausible recipients are invisible — they sit in inventory orphaned until someone notices.

The Recommend header already states the principle: *"We do not blast. A poor match sent today costs a good match's trust tomorrow."* That is a descriptive worldview — the human decides, and the system records the decision. We are adding the recording layer.

## What Changes

- **New `assignments` table** in Convex, keying `(propertyId, responseId)` with a two-state lifecycle: `pinned` (operator committed to sending) → `sent` (operator confirmed outreach). Captures `pinnedAt`, `pinnedScore` snapshot, optional `pinnedReason`, `sentAt`, `sentVia`, and a tombstone `unpinnedAt` for withdrawn pins.
- **New mutations** `assignments:pin`, `assignments:unpin`, `assignments:markSent`. `unpin` is rejected once `sentAt` is set — sent rows are immutable audit.
- **`decide()` remains the engine.** Its output becomes *suggestions*, not verdicts. Weights, thresholds, blockers, and the bilingual draft are unchanged in this change.
- **Recommend page** (both ByProperty and ByClient views) gains three new sections above the existing Send / Hold split:
  - **Must send** — pinned, not yet sent. Operator's working queue for that property/client. Shows `pinnedScore` and `currentScore` side by side; no auto-unpin on drift.
  - **Sent** — historical, read-only. Shows `sentAt`, `sentVia`, and the score at the time it was pinned.
  - **Suggestions** — current `decide()` Send-bucket output, each with a `[Pin]` button.
- **Held-back ("Don't send") matches** remain visible and keep the same reasons. They become pinnable via a deliberate, confirming action (a separate button on the hold card, with a confirm step) — the operator can override the engine, but never accidentally.
- **Listings screen** gains an *orphan banner*: properties with zero active pins after N days surface a "needs attention" callout.
- **Customers screen** gains a per-client engagement summary derived from `assignments`: e.g. `pinned for 1, sent 2, latest May 15`.
- **Out of scope (phase 2):** outcome states (`replied`, `viewing-scheduled`, `passed`), pin reasons as structured tags, cross-operator audit fields.

## Capabilities

### New Capabilities
- `property-assignments`: The pin → sent lifecycle that records which property the operator commits to sending to which client, the mutations that drive transitions, and the audit invariants (sent is immutable, deletes orphan rather than cascade, active uniqueness on `(propertyId, responseId)`).
- `recommend-workflow`: The Recommend page's three-section operator workflow (Must-send / Sent / Suggestions) layered on top of the existing decision engine, plus the held-back override path and score-drift presentation.
- `inventory-orphan-surfacing`: The Listings-screen orphan banner that flags properties with zero active pins past a freshness threshold, plus the Customers-screen engagement summary derived from the same `assignments` data.

### Modified Capabilities
<!-- None. `openspec/specs/` is empty (no archived changes yet); the existing
     decision-engine and recommend logic live inside active in-flight changes.
     We are not changing decide(), draftMessage(), or the Send/Hold split — we
     are layering the assignment lifecycle on top. -->

## Impact

- **Schema**: `convex/schema.ts` gains the `assignments` table with three indexes (`by_property`, `by_response`, `by_status`).
- **Backend**: new file `convex/assignments.ts` with `list` query and `pin`, `unpin`, `markSent` mutations. Active-pin uniqueness on `(propertyId, responseId)` enforced inside the `pin` mutation.
- **Frontend**: `src/components/Recommend.jsx` — three new sections in both `ByPropertyView` and `ByClientView`; pin/sent action buttons on match cards; score-drift display. `src/components/Listings.jsx` — orphan banner on cards / above grid. `src/components/Customers.jsx` — engagement summary chip per customer card.
- **Decision logic**: `src/decisionLogic.js` is **not** modified. `decide()`, `recommendRecipients()`, `draftMessage()`, and `parseGoogleFormCSV()` are unchanged.
- **No external dependencies, no migrations.** Existing rows in `properties` and `responses` work as-is; `assignments` starts empty and accumulates from operator action.
- **No breaking changes** to the existing Convex API or UI routes. The two existing recommend views still work standalone; new sections appear above what was there before.
