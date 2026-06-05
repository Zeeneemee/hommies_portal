## Context

The portal currently tracks the customer lifecycle across three tables:

- `responses` — every customer that ever entered the funnel.
- `assignments` — operator commitments `(propertyId, responseId, status: 'pinned' | 'sent')`, with `unpinnedAt` tombstones for withdrawn commitments.
- `sales` — closed deals `(responseId, propertyId, closedAt, unclosedAt?)`. An "active" sale is one where `unclosedAt` is undefined.

`sales` only captures the end of the leasing journey. The operator now needs visibility into the in-between stages (Sent LOI → Signed → TA issued → Moved in). This change **renames `sales` to `deals`** and adds a `stage` field plus per-stage timestamps so the same table tracks the full post-sent lifecycle.

Today the operator workflow is fragmented:

- **Customers** screen lists everyone with no funnel context.
- **Recommend** runs `decide()` against every response, including ones that already have a signed lease, so closed customers pollute suggestions and the cohort assembler.
- **Sales** screen lists closed deals but doesn't tell you who is *still open* in the middle of being matched.
- The only way to commit a pair is to find it inside the auto-ranked Suggestion list or click `Override and pin` inside the Hold list — there is no surface for "I just want to pair customer X with property Y" or "these three customers are going to be roommates at this whole-unit."

The data model is already sufficient. The work is presentation + filtering + a new write path.

## Goals / Non-Goals

**Goals:**
- One screen that shows every customer bucketed into **Not contacted / Sent / LOI sent / LOI signed / TA issued / Moved in**, derived from `assignments` + the new `deals` table.
- Operator can advance a deal stage in one click directly from a Pipeline row.
- Recommend (both views + cohort assembler) excludes any customer whose deal has reached `moved_in`.
- A direct way to pin an arbitrary (customer, property) pair without scrolling through Suggestions or invoking the Override-and-pin confirm dialog.
- A direct way to pin N customers against a whole-unit property as a manual cohort, in one atomic write.
- Manually created assignments are distinguishable in audit (`pinnedReason`).

**Non-Goals:**
- Changing `decide()`, `assembleCohort`, or scoring behaviour.
- New cohort schema. Manual cohorts are just N normal `assignments` rows that happen to share a property and were created together — they do not get their own table.
- Filtering pre-moved-in deals (LOI sent, signed, TA issued) out of Recommend. Deals fall through; the operator may want to offer alternatives.
- Free-form notes or attachments on the deal (e.g., LOI document upload). Stage tracking only in v1.
- Multi-tenant or per-operator views.

## Decisions

### 1. Rename `sales` → `deals` with a stage field

Schema replaces `sales` with:

```ts
deals: defineTable({
  responseId: v.id('responses'),
  propertyId: v.id('properties'),
  stage: v.union(
    v.literal('loi_sent'),
    v.literal('loi_signed'),
    v.literal('ta_issued'),
    v.literal('moved_in'),
  ),
  loiSentAt: v.optional(v.number()),
  loiSignedAt: v.optional(v.number()),
  taIssuedAt: v.optional(v.number()),
  movedInAt: v.optional(v.number()),
  finalRentSGD: v.optional(v.number()),
  cancelledAt: v.optional(v.number()),
})
  .index('by_response', ['responseId'])
  .index('by_property', ['propertyId'])
  .index('by_stage', ['stage'])
```

Migration script copies existing `sales` rows as `{ stage: 'moved_in', movedInAt: closedAt, cancelledAt: unclosedAt, finalRentSGD }`. The repo is on `feat/initial-implementation` and pre-launch so the migration risk is minimal.

Alternatives rejected:
- Add a new `deals` table alongside `sales` — two tables for related data, every query reads both.
- Add stage + timestamps onto `assignments` — assignments is the outreach-commitment ledger; mixing the leasing journey would muddle its semantics.

### 2. Customer stage is derived, not stored

A customer's bucket is computed from `assignments` + `deals` on read. There is no `responses.stage` field, no risk of the cached stage drifting from the source tables.

```
activeDeal = deals.where(responseId).find(d => !d.cancelledAt)
if (activeDeal) → activeDeal.stage  // 'loi_sent' | … | 'moved_in'
else if (hasSentAssignment)        → 'sent'
else                                → 'not_contacted'
```

A customer has at most one active (`!cancelledAt`) deal at a time — enforced by the `deals:start` mutation.

### 3. One Convex query, server-side join

A new `responses:listWithPipelineStatus` query loads `responses`, `assignments`, `deals` once on the server and returns rows of the shape:

```
{ ...response, stage, sentCount, lastSentAt, lastSentPropertyId, activeDeal? }
```

`activeDeal` carries `{ _id, propertyId, stage, …timestamps }` so the row can render the linked property and the stage stepper without a second fetch.

### 4. Stage advancement happens via a Convex mutation, not row edits

`deals:advance({ id, to })` enforces stage transitions:

- Allowed forward transitions: `sent → loi_sent → loi_signed → ta_issued → moved_in`. Skipping forward is allowed (e.g., the operator may go straight from `loi_sent` to `moved_in` if the deal collapsed the in-between steps offline).
- Backward transitions are NOT allowed (correction case is handled by `deals:cancel` + re-start, or by editing the deal's stage timestamps via CustomerDetail in a future iteration — out of scope for v1).
- The corresponding `*At` timestamp is set on each transition.

`deals:start({ responseId, propertyId })` is the entry point — creates a row with `stage: 'loi_sent'` and `loiSentAt: now()`. Rejected if an active deal already exists for that response.

`deals:cancel({ id })` sets `cancelledAt: now()`, dropping the customer back to **Sent** in the pipeline.

### 5. Recommend filtering at the call site, not inside `decide()`

`decide()` and `assembleCohort` stay pure. `Recommend.jsx` filters its `responses` prop before handing it to the engine:

```js
const movedIn = new Set(deals.filter(d => d.stage === 'moved_in' && !d.cancelledAt).map(d => d.responseId))
const openResponses = responses.filter((r) => !movedIn.has(r._id))
```

This requires Recommend to subscribe to `deals:list`. Alternative considered: bake the filter into `decide()`. Rejected — `decide()` is a pure function with no DB access by design; adding a deals lookup would couple it to Convex.

### 6. Manual single pin reuses `assignments:pin`

A "Manual match" modal lets the operator pick any customer and any property, then calls `assignments:pin` with `pinnedReason: 'manual-match'` and `pinnedScore: decide(client, property).score` (or `0` if the property isn't matchable). The existing Must-send / Mark-sent flow handles the rest.

This is the same write path as Override-and-pin — only the UI entry point and the reason tag are new. No mutation changes required.

### 7. Manual cohort uses a new batch mutation

`assignments:pinMany({ propertyId, members: [{ responseId, pinnedScore }], pinnedReason })` writes N pinned rows in a single transaction. Atomicity matters: a partial cohort (say 2 of 3 customers pinned before a crash) leaves the operator with an inconsistent commitment.

Alternative considered: loop the existing `assignments:pin` from the client. Rejected — no atomicity guarantee, harder to undo with a single Unpin click, and the audit timestamps would drift across members.

The cohort builder UI only enables the **Pin cohort** button when:
- The selected property is whole-unit with `masterCount + commonCount > 0`.
- The number of selected customers equals `masterCount + commonCount` (or the operator explicitly opts into a partial cohort, deferred to a non-goal).

### 8. Unpin behaviour for manual cohorts

Each cohort member is an independent `assignments` row. The operator unpins members individually — there is no "unpin whole cohort" affordance in v1. Members of a manual cohort are identifiable by `pinnedReason === 'manual-cohort'` plus shared `propertyId` and a close `pinnedAt` window, which is enough to render them grouped in the Must-send section if desired (deferred).

### 9. Route & nav

New route `/pipeline`, added to the nav between Customers and Recommend. The Pipeline rows that link out use existing routes:

- "View customer" → `/customers/:id` (CustomerDetail)
- "Manual match" → opens the modal inline (no route change)

## Risks / Trade-offs

- [Schema migration from `sales` → `deals` could lose data] → Migration is a one-shot script that runs before the new code ships; tested against a snapshot of `sales` first. Existing `CustomerDetail` close-button writes go through a temporary compatibility shim that calls `deals:start` + immediate `deals:advance(moved_in)` to land the same end state.
- [Pipeline query becomes the hot path] → Tables are small (hundreds of rows). If it becomes hot, add `by_stage` index reads instead of full scans, or memoise per-customer aggregates.
- [Recommend now depends on a new `deals:list` query] → If the query is empty (no deals), behaviour is unchanged. If it fails to load, fail open (treat as "no moved-in customers") rather than blocking matching.
- [Operator advances a deal to `moved_in` by mistake] → No backward transition allowed; recovery path is `deals:cancel` + `deals:start` again. Documented; acceptable for v1.
- [Manual cohort can pin people whose decide() score is 0 or below threshold] → That's the explicit point of manual matching. The `pinnedReason: 'manual-cohort'` tag preserves audit; the existing Score-pair widget shows the gap between pinned and live score.
- [Operator manually pins a customer who has a moved-in deal] → The Manual match modal hides moved-in customers in its picker. Same filter as Recommend.
- [Schema field `pinnedReason` is already `v.optional(v.string())`] → No assignments migration; new tags are additive.

## Migration Plan

1. Land the `deals` schema and the `sales → deals` migration script. Run the migration; verify row counts and that every old `sales` row produced a `deals` row with `stage: 'moved_in'`.
2. Update `CustomerDetail.jsx` to write to `deals:start`/`deals:advance` instead of `sales:close`.
3. Land the new Convex queries (`deals:list`, `responses:listWithPipelineStatus`) and mutations (`deals:start`, `deals:advance`, `deals:cancel`, `assignments:pinMany`).
4. Add the Pipeline screen + route; Recommend is unchanged.
5. Wire Recommend's `openResponses` filter once `deals:list` is live.
6. Add the Manual match modal.

Rollback: revert the migration by mapping `deals` rows with `stage: 'moved_in' && !cancelledAt` back to `sales` rows (`closedAt: movedInAt`, `unclosedAt: cancelledAt`). Pre-launch data volume makes this cheap.

## Open Questions

- Should the Pipeline stage row show all per-stage timestamps inline (LOI sent 3d ago · signed 1d ago · …) or just the current stage + when it was entered? (Lean: current stage + age, with a hover/expand for the full timeline.)
- Should `deals:advance` allow skipping forward (e.g., `loi_sent → moved_in` directly)? (Lean: yes — operators reconcile offline deals; recorded as both timestamps set to `now()`.)
- Should the manual cohort modal warn when one of the selected customers has `wantRoommate: false`? (Lean: yes — soft warning, not a block.)
