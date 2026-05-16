## Context

The Recommend page (`src/components/Recommend.jsx`) currently runs `decide(resp, prop)` from `src/decisionLogic.js` live against every property/response pair. It surfaces Send and Hold buckets with scores and bilingual draft messages. `draftMessage` copies a draft to clipboard via `navigator.clipboard?.writeText` and nothing else is recorded — there is no audit, no per-client engagement history, and no way to say "this property MUST go to these specific clients."

Data model today:
- `properties` — listing metadata, all detail fields optional until the poster extraction runs.
- `responses` — Google-Form-style client requirements (budget, school, commute tolerance, layout, extras).
- Indexes: `by_status` / `by_createdAt` on properties; `by_createdAt` / `by_sheetTimestamp` on responses.

Engine today (in `decisionLogic.js`):
- Weights `{ budget: 30, school: 22, commute: 20, housing: 12, layout: 9, building: 7 }` summing to 100.
- `SEND_THRESHOLD = 58`; blockers `over_budget`, `housing_mismatch`, `commute_too_far`.
- Returns `{ verdict, score, reason, criteria[], blockers[] }` per pair.

Constraints:
- Convex is the only backend; mutations and queries are reactive — UI updates without manual refetch.
- No external migrations; the `assignments` table starts empty and accrues from operator action.
- The product principle ("we do not blast") is non-negotiable — adding pin/sent must not introduce a single-click bulk-send path.

Stakeholder: solo operator workflow today, but the audit trail must survive a future team handover. Sent rows must remain immutable for that reason.

## Goals / Non-Goals

**Goals:**
- Persist the operator's commitment per `(property, client)` pair as a first-class record (`assignments`), separating *intent* (`pinned`) from *action* (`sent`).
- Layer the new lifecycle on top of `decide()` without modifying its scoring, weights, threshold, blockers, or draft text.
- Make "where must each property be sent" answerable at a glance per property and per client.
- Preserve the trust ledger: sent is immutable; deletes orphan rather than cascade.
- Surface inventory orphans (properties with no active pin) on the Listings screen.
- Surface engagement history (pinned/sent counts) on the Customers screen.

**Non-Goals:**
- Outcome states (`replied`, `viewing-scheduled`, `passed`, `signed`) — phase 2.
- Multi-operator audit fields (`pinnedBy`, `sentBy`) — phase 2; the schema leaves room but the change does not introduce auth.
- Rewriting the engine, the weights, or the bilingual draft.
- Automated send (the act of actually pushing a message into Line/IG/WhatsApp) — `markSent` records that the operator did it; the portal does not perform it.
- Per-pin reason taxonomy. `pinnedReason` is a free-text optional string; tags can come later.
- A separate "outbox" page. Pin → sent surfaces inside Recommend; orphans surface on Listings; history surfaces on Customers. No new top-level nav.

## Decisions

### 1. Two-state lifecycle (`pinned` → `sent`), not three+

A single binary verdict ("send: yes/no") confuses intent with completion. Four states (`suggested` → `pinned` → `sent` → `outcome`) over-models a workflow we have not yet operated. Two states earn their keep immediately:

- `pinned` = "I am committing to send this property to this client."
- `sent` = "The outreach has actually gone out."

Alternatives considered:
- **One state** (`assignments` just records the send) — rejected. Loses the commitment-without-action distinction that is the whole point of a non-blast workflow.
- **Three+ states with outcomes** — rejected for this change. Outcome modelling is a real product question (what counts as "replied"?) and deserves a separate proposal.

### 2. `decide()` stays the engine; pins are not an engine override

`decide()` continues to produce the Send / Hold split with the same weights and threshold. The new sections render *on top* — pinned and sent rows are read directly from `assignments`, suggestions are read from `decide()` filtered to exclude clients who already have an active pin or sent record for that property.

Alternatives considered:
- **Replace the engine** — out of scope. The engine works; what is missing is memory.
- **Have the engine consult `assignments`** — rejected. Keeps `decisionLogic.js` pure (no Convex imports) so it stays testable in isolation and reusable in the existing Vitest suite.

### 3. Active-pin uniqueness enforced in the mutation, not the schema

A given `(propertyId, responseId)` may have at most one row with `status: 'pinned'` and no `unpinnedAt`. A withdrawn pin (`unpinnedAt` set) can coexist with a fresh pin for the same pair. A `sent` row is permanent and a second pin for that pair is silently a no-op (already done).

Enforced inside `assignments:pin` by reading `by_response` index, filtering to `propertyId` match and active-state predicate, and returning the existing row if present. Convex schemas don't express partial uniqueness, so doing this in the mutation is the natural fit.

Alternatives considered:
- **Hard delete on unpin** — rejected. Loses the trust ledger; we want to be able to say "this was pinned then withdrawn, here is when."
- **Per-(property, response) status field on `responses` or `properties`** — rejected. Doesn't scale (each side has many partners) and pollutes single-purpose tables.

### 4. Score-drift: show both, no auto-action

When a pinned row is displayed, the card shows the score-at-pin (`pinnedScore`) next to a freshly computed `decide()` score. No warning icon unless the operator opts in later. Rationale: the operator pinned for a reason; the system has no business second-guessing.

Alternatives considered:
- **Auto-unpin when score drops below threshold** — rejected. Violates the commitment invariant.
- **Big red drift warning** — rejected for v1. Adds noise before we know whether drift is actually a problem in practice.

### 5. Held-back pins require an explicit confirm step

The hold bucket keeps its current presentation (reasons, criteria, no primary action). A secondary `[Override and pin]` button appears on hold cards, gated by a one-step confirm ("This client scored 41/100 — pin anyway?"). This preserves "we do not blast" while letting the operator act on out-of-band knowledge (e.g. a phone call where the client widened their budget).

### 6. Orphan threshold lives in code, not config

A property is "orphan" when it has zero active pins AND zero sent rows AND was created more than 3 days ago. The 3-day threshold is a constant in `src/decisionLogic.js` (or a new sibling — `src/orphanLogic.js` if it grows). Keeping it codeable, not configurable, until we have evidence the right number is operator-specific.

### 7. `assignments.ts` is a thin Convex module; UI composes the views

Backend module exposes only:
- `list({ propertyId?, responseId? })` — filtered query, all rows by default.
- `pin({ propertyId, responseId, pinnedScore, pinnedReason? })`.
- `unpin({ assignmentId })` — rejected if `sentAt` set.
- `markSent({ assignmentId, sentVia? })`.

No "list orphans" or "engagement summary" endpoints — those are derived client-side from the `list()` reactive query joined with the existing `properties:list` and `responses:list`. Keeps the backend small; lets the UI iterate freely.

## Risks / Trade-offs

- **[Risk] Operator pins a client, never marks sent, forgets.** → Mitigation: the "Pinned, not sent" view inside Recommend is itself the working queue. A future addition could be an age indicator (`pinned 7d ago`); not in v1.
- **[Risk] Two operators (future) pin the same pair concurrently.** → Mitigation: the `pin` mutation is idempotent — second caller gets the existing row. Convex serializes mutations so there is no double-insert.
- **[Risk] Score-drift creates anxiety** ("the system says 41 now, did I make a mistake?"). → Mitigation: visual treatment is neutral; both numbers are equally weighted. Revisit if operators report unease.
- **[Risk] Hold-bucket override path becomes the new blast.** → Mitigation: confirm step is a real interrupt, not a quiet checkbox. If operators routinely click through, that is a signal the scoring needs tuning — but the override stays a single deliberate motion.
- **[Trade-off] `unpinnedAt` tombstones bloat the table.** Accepted. A solo operator generates a handful of rows per day; Convex handles orders of magnitude more without strain. The audit value outweighs the row cost.
- **[Trade-off] `decide()` and `assignments` can disagree** (pinned row whose current score is below threshold). Accepted, and made visible by design — the disagreement is meaningful information, not a bug.

## Migration Plan

1. Ship the schema change (`assignments` table + indexes). No data migration — table starts empty.
2. Ship `convex/assignments.ts`. No callers yet; safe to deploy.
3. Ship the Recommend UI changes behind a single integration. Existing `Send / Hold` rendering remains untouched; the new sections render only when `assignments:list` returns rows or the operator clicks `[Pin]`.
4. Ship the Listings orphan banner and Customers engagement chip — both render gracefully on empty assignments (no banner, "no engagement yet" chip).
5. No rollback complexity: removing the change is a code revert. The `assignments` table can remain in place (Convex tolerates unused tables) or be dropped manually if desired.

## Open Questions

- Should `[Pin]` immediately stamp `pinnedScore` as the *current* `decide()` score, or the score that was visible to the operator at click time? In practice these are identical (live query) — proceeding with "score at the moment the mutation runs," but worth noting.
- Should the orphan threshold be 3 days, 5 days, or property-status-aware (e.g. only count from `poster_attached`)? Leaning property-status-aware: an unextracted property has no commute number and cannot reasonably be assigned — orphan detection should start the clock once the property becomes matchable. Pending operator input.
- When a pinned client's response row is deleted (operator removed a stale customer), what should the orphaned `assignments` row render as? Leaning: show the row in a muted "client removed" state inside Sent history; hide it from Must-send. Not blocking; revisit during implementation if it gets in the way.
