## Why

Operators currently have no single view of where each customer sits in the funnel — who is waiting for first contact, who has been sent listings but not closed, and who has already moved into a room. They cross-reference Customers, Recommend, and Sales to figure this out, and customers who already have a room still surface as match candidates in Recommend, wasting attention and risking duplicate outreach. Separately, the only way to commit a (customer, property) pair today is to find it inside the auto-ranked Suggestion/Hold lists — the operator has no direct path to manually pair an arbitrary customer with an arbitrary property, nor to manually group customers as roommates for a whole-unit listing.

## What Changes

- Add a **Pipeline** screen that buckets every customer into one of six stages derived from `assignments` + the new `deals` table:
  - **Not contacted** — no `sent` assignment row exists
  - **Sent** — at least one `sent` assignment exists, no `deals` row yet
  - **LOI sent** — `deals.stage = 'loi_sent'`
  - **LOI signed** — `deals.stage = 'loi_signed'`
  - **TA issued** — `deals.stage = 'ta_issued'`
  - **Moved in** — `deals.stage = 'moved_in'` (this is the "got a room" bucket)
- Each row shows the customer's basics, what was sent (count + most recent property), the linked deal property + current stage when applicable, and how long since the last activity. Deep-link to `CustomerDetail` for full details.
- **Advance stages directly from a Pipeline row** — each in-progress row has a stepper/dropdown (Sent → LOI sent → LOI signed → TA issued → Moved in) so the operator can advance the deal in one click without leaving Pipeline. A "Cancel deal" affordance writes `cancelledAt` and drops the customer back to **Sent**.
- Filter customers in the **Moved in** bucket out of the Recommend screen — they must not appear in the By-client picker, the By-property Suggestion/Hold lists, or any cohort assembly. (Earlier-stage in-progress customers stay visible — deals fall through and the operator may want to offer alternatives.)
- Add a top-nav entry "Pipeline" between Customers and Recommend.
- Add a **Manual match** workflow with two entry points, both backed by the existing `assignments` ledger:
  - **Customer ↔ property pin** — from any Pipeline row (or a dedicated "Manual match" modal), pick any property and pin it for that customer regardless of the decide() verdict. Distinguished from auto-pins by `pinnedReason = 'manual-match'`.
  - **Manual roommate cohort** — for a whole-unit property, pick N specific customers and pin the entire group at once, bypassing automatic cohort assembly. Each member becomes a separate pinned assignment tagged `pinnedReason = 'manual-cohort'`, so the existing Must-send + Mark-sent flow handles outreach.

## Capabilities

### New Capabilities
- `customer-pipeline`: Funnel visibility over the customer base, derived from assignments + sales, plus the rule that closed customers are excluded from active recommendation surfaces.
- `manual-matching`: Operator-driven creation of (customer, property) pins outside the auto-ranked Suggestion list — both single pairs and N-person roommate cohorts — recorded distinctly in the assignment ledger so they're auditable.

### Modified Capabilities
<!-- No prior spec files exist in openspec/specs/, so no delta files are needed. The exclusion behavior is captured as a requirement on the new capability. -->

## Impact

- **UI**:
  - New `src/components/Pipeline.jsx` screen, new route, nav item in header.
  - New `ManualMatchModal.jsx` (or inline panel) reachable from Pipeline rows and from a top-level button — supports both single pin and multi-customer cohort pin against a whole-unit property.
- **Data layer (Convex)**:
  - **Schema migration**: rename/repurpose the existing `sales` table as `deals` with a `stage` field (`loi_sent | loi_signed | ta_issued | moved_in`), per-stage timestamps (`loiSentAt`, `loiSignedAt`, `taIssuedAt`, `movedInAt`), and `cancelledAt` (renamed from `unclosedAt`). Existing rows migrate as `stage = 'moved_in'` with `movedInAt = closedAt`.
  - New `responses:listWithPipelineStatus` query joining `responses` + `assignments` + `deals` server-side.
  - New `deals:start({ responseId, propertyId })`, `deals:advance({ id, to })`, `deals:cancel({ id })`, and `deals:list` mutations/queries.
  - `assignments:pin` accepts richer `pinnedReason` values (`'manual-match'`, `'manual-cohort'`) — already string-typed in the schema, so no migration.
  - `assignments:pinMany` batch mutation for atomic N-customer cohort creation.
- **CustomerDetail update**: `src/components/CustomerDetail.jsx` switches from `sales:close` to `deals:start` / `deals:advance` so the close button becomes a stage advancer.
- **Recommend filtering**: `src/components/Recommend.jsx` filters out responses with a `moved_in` deal (the practical "got a room" rule) before populating either view; candidate pool passed to `assembleCohort` likewise filtered.
- **Tests**: unit-test the "has moved-in deal" predicate; cover pipeline-bucketing query; cover stage-advancement legality (no skipping stages backwards, cancel is always allowed); cover manual cohort batch-pin atomicity.
