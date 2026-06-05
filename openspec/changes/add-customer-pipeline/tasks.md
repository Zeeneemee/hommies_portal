## 1. Schema migration: sales → deals

- [x] 1.1 Define the new `deals` table in `convex/schema.ts` per the design (fields, indexes by_response/by_property/by_stage).
- [x] 1.2 Write a one-shot migration script (`convex/migrations/salesToDeals.ts` or equivalent) that copies every `sales` row into `deals` as `{ stage: 'moved_in', movedInAt: closedAt, cancelledAt: unclosedAt, finalRentSGD }`.
- [ ] 1.3 Run the migration against the dev database; verify row counts match and spot-check a few rows.
- [ ] 1.4 Remove the `sales` table definition from the schema once the migration has been verified.
- [x] 1.5 Update any code that still imports from `convex/sales.ts` to import from the new `convex/deals.ts` (rename or replace the file).

## 2. Deal lifecycle Convex layer

- [x] 2.1 `deals:start({ responseId, propertyId })` mutation — rejects if an active deal already exists for the response; creates a row with `stage: 'loi_sent'`, `loiSentAt: now()`.
- [x] 2.2 `deals:advance({ id, to })` mutation — validates forward-only transitions; sets every per-stage timestamp visited in a skip to the same `now()`.
- [x] 2.3 `deals:cancel({ id })` mutation — sets `cancelledAt: now()`.
- [x] 2.4 `deals:list` query — returns `(_id, responseId, propertyId, stage, *At fields, cancelledAt, finalRentSGD)` — the minimal shape Pipeline + Recommend need.
- [ ] 2.5 Convex tests: transition legality (forward ok, backward rejected, skip-forward sets all visited timestamps), cancel re-allows a fresh `deals:start`, `start` rejects on existing active deal.

## 3. Pipeline data + assignments mutations

- [x] 3.1 `hasMovedInDeal(responseId, deals)` pure helper; unit-test it.
- [x] 3.2 `responses:listWithPipelineStatus` query: server-side join of `responses` × `assignments` × `deals`, returning `{ ...response, stage, sentCount, lastSentAt, lastSentPropertyId, activeDeal? }`. Stage priority: moved_in > ta_issued > loi_signed > loi_sent > sent > not_contacted.
- [x] 3.3 `assignments:pinMany({ propertyId, members, pinnedReason })` mutation — atomic batch insert; reject if `members` is empty or contains duplicate `responseId`s.
- [ ] 3.4 Convex tests for the pipeline query (bucket correctness across all six stages) and `pinMany` (atomicity, dedup).

## 4. Pipeline screen

- [x] 4.1 Create `src/components/Pipeline.jsx` with six stacked sections (Not contacted / Sent / LOI sent / LOI signed / TA issued / Moved in), each rendering rows from `responses:listWithPipelineStatus` filtered by `stage`.
- [x] 4.2 Row component shows name, school, channel, sent-count + last-sent meta, linked deal property + stage age (for in-progress rows), plus action buttons.
- [x] 4.3 Action buttons per row: "Start deal" (Sent rows), "Advance to <next>" + "Cancel deal" (in-progress rows), "View" (links to `/customers/<id>`). Wire them to `deals:start`, `deals:advance`, `deals:cancel`.
- [x] 4.4 Skip-forward affordance — small dropdown on each in-progress row lets the operator jump to any later stage in one click.
- [x] 4.5 Add `/pipeline` route + a "Pipeline" nav entry between Customers and Recommend.
- [x] 4.6 Search box that filters by name/contact across all six buckets.
- [x] 4.7 Empty-state copy per bucket.

## 5. Recommend filtering

- [x] 5.1 Subscribe `src/components/Recommend.jsx` to `deals:list` and build a `Set<responseId>` of moved-in customers (`stage === 'moved_in' && !cancelledAt`).
- [x] 5.2 Derive `openResponses = responses.filter(r => !movedIn.has(r._id))` and pass it everywhere `responses` is used downstream (By-property bucketing, By-client picker, `assembleCohort` candidate pool).
- [x] 5.3 Confirm Must-send + Sent sections still render historical assignment rows for moved-in customers (audit trail).
- [ ] 5.4 Manual smoke test: advance a customer to `moved_in`, verify they vanish from Suggestions/Hold/cohort but remain in Sent.

## 6. CustomerDetail update

- [x] 6.1 Replace the existing "Mark closed" / `sales:close` write in `src/components/CustomerDetail.jsx` with a stage-aware widget (Start deal → Advance → Cancel) that calls the new `deals:*` mutations.
- [x] 6.2 If CustomerDetail rendered closed-sale info (finalRentSGD, closedAt), update those readouts to read from the `deals` row instead.

## 7. Manual single-pair match

- [x] 7.1 Create `src/components/ManualMatchModal.jsx` with two pickers (customer, property) and a "Pin" button.
- [x] 7.2 Customer picker source = `responses:listWithPipelineStatus` filtered to NOT moved_in; property picker source = `properties:list` (matchable + unmatchable).
- [x] 7.3 On submit, compute `pinnedScore` via `decide()` (or `0` if property isn't matchable) and call `assignments:pin` with `pinnedReason: 'manual-match'`.
- [x] 7.4 Add a "Manual match" button on each Pipeline row in Not-contacted + Sent buckets that opens the modal with the customer pre-selected.
- [x] 7.5 Add a top-level "Manual match" entry point on the Pipeline screen header.

## 8. Manual cohort builder

- [x] 8.1 Extend `ManualMatchModal` (or add a sibling `ManualCohortModal.jsx`) with a "Cohort" mode: one property picker + multi-select customer picker.
- [x] 8.2 Gate the **Pin cohort** button on `housingType === 'Whole Unit'`, `masterCount + commonCount > 0`, and `selected.length === masterCount + commonCount`.
- [x] 8.3 Show a non-blocking warning chip next to any selected customer with `wantRoommate === false`.
- [x] 8.4 On submit, call `assignments:pinMany({ propertyId, members, pinnedReason: 'manual-cohort' })` and toast success/failure.
- [ ] 8.5 Test atomicity: force `pinMany` to throw mid-batch and confirm zero rows are written.

## 9. Verification & cleanup

- [x] 9.1 Run `npm run lint` / type-check and fix any new issues.
- [x] 9.2 Run the Convex test suite and confirm green.
- [ ] 9.3 Walkthrough each spec scenario manually in the running app (six pipeline buckets, stage advancement, skip-forward, cancel, Recommend exclusion, manual single pin, manual cohort).
- [ ] 9.4 Update `CLAUDE.md` / project README if there's a "screens" or "data flow" section that should reflect the new Pipeline screen, deals table, and manual-match flow.
