## 1. Schema and backend module

- [x] 1.1 Add the `assignments` table to `convex/schema.ts` with fields `propertyId`, `responseId`, `status` (`'pinned' | 'sent'`), `pinnedAt`, `pinnedScore`, optional `pinnedReason`, optional `sentAt`, optional `sentVia`, optional `unpinnedAt`
- [x] 1.2 Add three indexes on `assignments`: `by_property` (`['propertyId']`), `by_response` (`['responseId']`), `by_status` (`['status']`)
- [x] 1.3 Create `convex/assignments.ts` with the `list` query — accepts optional `propertyId` and `responseId`, returns rows ordered by `pinnedAt` descending
- [x] 1.4 Implement `assignments:pin` mutation — inserts a new row with `status: 'pinned'`, captures `pinnedScore` from the argument, idempotent on an existing active row for the same pair
- [x] 1.5 Implement `assignments:unpin` mutation — sets `unpinnedAt` on the row; throws if `sentAt` is set
- [x] 1.6 Implement `assignments:markSent` mutation — sets `status: 'sent'`, `sentAt: Date.now()`, and optional `sentVia`; rejects if the row is already sent or has `unpinnedAt`

## 2. Recommend page restructure

- [x] 2.1 Subscribe `RecommendScreen` to `useQuery('assignments:list')` and pass the result down to `ByPropertyView` and `ByClientView`
- [x] 2.2 Add a `partitionAssignmentsForProperty(propertyId, assignments)` helper that returns `{ pinned, sent }` for that property, filtering out `unpinnedAt`-set rows from active sets
- [x] 2.3 Mirror the helper as `partitionAssignmentsForClient(responseId, assignments)`
- [x] 2.4 In `ByPropertyView`, render three sections above the existing Send/Hold split: Must-send, Sent, Suggestions — Suggestions = current `recommendRecipients(prop, responses).send` minus pairs already covered by an active or sent assignment
- [x] 2.5 In `ByClientView`, render the symmetric three sections — Must-send / Sent / Suggestions over `recommendListingsForClient(client, properties)`
- [x] 2.6 Add a `[Pin]` button to every Suggestions row; clicking it calls `assignments:pin` with the row's current decide() score as `pinnedScore`
- [x] 2.7 Add a `[Mark sent]` button to every Must-send row; clicking it calls `assignments:markSent` (with `sentVia` from the response's channel)
- [x] 2.8 Add an `[Unpin]` button to every Must-send row; clicking it calls `assignments:unpin` (disabled when row is sent)
- [x] 2.9 Render `pinnedScore` and the freshly computed current `decide()` score side by side on every Must-send and Sent row, neutral styling
- [x] 2.10 Update the existing Hold-bucket cards to expose an `[Override and pin]` button gated by `window.confirm("This client scored N/100 — pin anyway?")`

## 3. Listings orphan banner

- [x] 3.1 Compute an `isOrphan(property, assignments)` predicate: `posterExtractedAt` (or `createdAt` if unset) older than 3 days AND zero active or sent assignments for that property
- [x] 3.2 Subscribe `ListingsScreen` to `useQuery('assignments:list')`
- [x] 3.3 Render an "Orphan — needs recipients" pill on each orphan card, linking to `/recommend?property=<id>` (or programmatic navigation that sets the selected property)
- [x] 3.4 Update `RecommendScreen` to read an optional `?property=<id>` search param and pre-select that property in `ByPropertyView`

## 4. Customers engagement chip

- [x] 4.1 Compute `engagementFor(responseId, assignments)` returning `{ pinnedCount, sentCount, latestAt }`
- [x] 4.2 Subscribe `CustomersScreen` to `useQuery('assignments:list')`
- [x] 4.3 Render a per-customer chip on each customer card showing `pinned N · sent M · latest <relative>` (or "no engagement yet" when both counts are zero)

## 5. Styling

- [x] 5.1 Add `.assignment-section` styling (Must-send / Sent / Suggestions group headers) in `src/styles.css`, matching the existing card / chip language
- [x] 5.2 Add `.score-pair` styling (`pinned at 71 · now 42`) — neutral, no warning colour
- [x] 5.3 Add `.orphan-pill` styling on Listings cards

## 6. Verification

- [ ] 6.1 Manual: pin a suggestion, confirm it disappears from Suggestions and appears in Must-send without page reload
- [ ] 6.2 Manual: mark a pinned row as sent, confirm it appears in Sent and `[Unpin]`/`[Mark sent]` controls disappear
- [ ] 6.3 Manual: attempt to unpin a sent row via the mutation directly (e.g. Convex dashboard) and verify the rejection error
- [ ] 6.4 Manual: pin a Hold-bucket client via `[Override and pin]`, confirm the confirm prompt appears and naming the current score
- [ ] 6.5 Manual: delete a property that has pinned and sent assignments — confirm the rows remain in the database and disappear from active views
- [ ] 6.6 Manual: open Listings and Customers in another tab while pinning from Recommend; confirm the orphan pill disappears and the engagement chip updates without refresh
- [x] 6.7 Confirm `decisionLogic.js` is unchanged in this branch (`git diff src/decisionLogic.js` returns no output)
