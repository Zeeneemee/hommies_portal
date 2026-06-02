## 1. Extract shared assignment helpers

- [x] 1.1 Create `src/assignmentHelpers.js` and move `partitionAssignmentsForClient`, `partitionAssignmentsForProperty`, and `isPairCovered` out of `src/components/Recommend.jsx` (no behaviour change).
- [x] 1.2 Update `Recommend.jsx` to import the three helpers from `../assignmentHelpers.js` and delete the local definitions.
- [x] 1.3 Run `npm test` (vitest) — confirm all existing assignment-related tests still pass; if any existed inside `Recommend.jsx`'s tests, port them to a sibling `assignmentHelpers.test.js`.
- [ ] 1.4 Manual check: run `npm run dev`, open `/recommend`, switch between by-property and by-client views — both must still render Must-send and Sent sections identically.

## 2. Wire data through to the Customers screen

- [x] 2.1 In `src/App.jsx`, pass `properties` (already loaded via `useQuery('properties:list')`) as a prop to `<CustomersScreen>`.
- [x] 2.2 In `src/components/Customers.jsx`, accept the new `properties` prop and add `const assignments = useQuery('assignments:list', {}) ?? []` at the screen level (single fetch, partitioned per card).
- [x] 2.3 Build a `propertiesById` Map from `properties` once per render and pass it to each `<CustomerCard>` so the checklist can resolve `propertyId → property` without scanning the array per row.

## 3. Implement the `CustomerChecklist` subcomponent

- [x] 3.1 Create a new `<CustomerChecklist>` component inside `Customers.jsx` (or in a new file `src/components/CustomerChecklist.jsx` if the file grows). It takes `{ response, assignments, propertiesById, onMarkSent, onPin }`.
- [x] 3.2 Inside it, call `partitionAssignmentsForClient(response._id, assignments)` to get `{ sent, pinned }`.
- [x] 3.3 Render the checklist header: `Properties · N sent · M queued` (omit the zero segment per spec).
- [x] 3.4 Render the Sent section (newest-first): `✓` glyph in `--green`, condo name, `· sent <fmtDate(sentAt)>` in `--ink-mute` with `font-variant-numeric: tabular-nums`. No action button. Cap at 5 rows with a `Show all (N)` expander (per-card React state).
- [x] 3.5 Render the section divider `— queued —` only when both `sent.length > 0` and `pinned.length > 0`.
- [x] 3.6 Render the Queued section (newest-first): `☐` glyph in `--hairline-strong`, condo name in 600 weight, right-aligned `Mark sent` button (small ghost button).
- [x] 3.7 Render the empty state when both sections are empty: a muted line "No properties tracked yet." followed by the pin-another-property affordance.
- [x] 3.8 Remove the old `<EngagementChip>` rendering site from `CustomerCard`; the checklist replaces it. Delete `EngagementChip` and `engagementFor` if no other consumer remains.

## 4. Implement Mark-sent

- [x] 4.1 Add `const markSent = useMutation('assignments:markSent')` at the `CustomersScreen` level and pass an `onMarkSent(assignmentRow, response)` handler into each `<CustomerChecklist>`.
- [x] 4.2 In the handler, compute `sentVia = response.channel || 'manual'` and call `markSent({ id: assignmentRow._id, sentVia })`.
- [x] 4.3 On success, fire toast: `"<condo> marked sent to <response.name>."`.
- [x] 4.4 On rejection, fire an error toast (`toast` already supports a single string; prefix with `Couldn't mark sent — `) and verify the optimistic UI snaps back when Convex returns the canonical state.
- [x] 4.5 Add a CSS transition on `.checklist-row` (`transform`, `opacity`) for the relocation animation; wrap the animated styles in `@media (prefers-reduced-motion: no-preference)` so reduced-motion environments skip it.

## 5. Implement the "Pin another property" picker

- [x] 5.1 Add `const pin = useMutation('assignments:pin')` at the screen level; pass an `onPin(property, response)` handler into the checklist.
- [x] 5.2 In `<CustomerChecklist>`, add local state `pickerOpen` (boolean) for the collapsed/expanded affordance and `pickerQuery` (string) for the searchable filter.
- [x] 5.3 When collapsed, render a single hairline-bordered row `+ Pin another property` (clickable, focusable). When expanded, render an `<input>` filter plus a scrollable list of properties that are NOT covered for this customer (filter via `isPairCovered`).
- [x] 5.4 On select, call `onPin(property, response)` which calls `pin({ propertyId: property._id, responseId: response._id, pinnedScore: 0, pinnedReason: 'manual-from-customer-card' })`; on success, collapse the picker and clear the query; let the Convex live query surface the new row.
- [x] 5.5 When the filtered list is empty (no available properties), render "All properties already pinned or sent to this customer."

## 6. Add page-header totals strip

- [x] 6.1 Compute `inFlightTotal = assignments.filter(a => !a.unpinnedAt && a.status === 'pinned').length` and `sentTotal = assignments.filter(a => !a.unpinnedAt && a.status === 'sent').length` at the screen level.
- [x] 6.2 Render two small inline totals in the `page-header` (right of the title block, alongside `Add customer`): `In flight · {inFlightTotal}` (orange) and `Sent · {sentTotal}` (green).
- [x] 6.3 `In flight` total: on click, find the first `<CustomerCard>` DOM node whose card has at least one queued row and `scrollIntoView({ behavior: 'smooth', block: 'start' })`.
- [x] 6.4 `Sent` total: on click, `window.scrollTo({ top: 0, behavior: 'smooth' })`.

## 7. Styling

- [x] 7.1 Add new CSS classes to `src/styles.css`, scoped under `.customer-card`:
   - `.customer-checklist`, `.checklist-head`, `.checklist-row`, `.checklist-row--sent`, `.checklist-row--queued`, `.checklist-divider`, `.checklist-add-row`, `.checklist-show-all`, `.checklist-empty`.
- [x] 7.2 Use tokens only — `--green` for sent glyph, `--hairline-strong` for empty box, `--ink` / `--ink-mute` for text, `--hairline` for dividers. No new colour values.
- [x] 7.3 `font-variant-numeric: tabular-nums` on the date span so dates align column-wise within a card.
- [x] 7.4 Add `.page-header-totals` (or extend the existing `.page-header` layout) for the two-pill totals strip — orange pill + green pill, same small `Pill` look as elsewhere; reuse `Pill` if it covers it, otherwise a small new style.
- [ ] 7.5 Verify the card height impact on the grid (`.customers-grid`) — cards should still align reasonably; if cards become ragged for customers with many sent rows, the cap-at-5 + expander already handles it. Confirm visually.

## 8. Manual QA matrix

- [ ] 8.1 Customer with no assignments → checklist shows empty-state line + pin picker.
- [ ] 8.2 Customer with only sent rows → no divider, no queued section, header reads `N sent`.
- [ ] 8.3 Customer with only queued rows → no divider, no sent section, header reads `M queued`.
- [ ] 8.4 Customer with both → divider visible between sections.
- [ ] 8.5 Customer with 7 sent rows → only 5 visible by default; `Show all (7)` reveals the rest; navigating away and back resets to collapsed.
- [ ] 8.6 Click `Mark sent` on a queued row → row glides to top of sent section, toast appears, Convex `sentAt` is populated, `sentVia` is the customer's `channel` (or `'manual'`).
- [ ] 8.7 Pin via picker → picker collapses, new queued row appears at top of queued section, Recommend's score-drift display labels it `manual-from-customer-card`.
- [ ] 8.8 Picker with no available properties → shows the all-covered empty-state line.
- [ ] 8.9 Page-header totals match the manual sum of pinned/sent rows.
- [ ] 8.10 Click `In flight · N` → page scrolls to first card with a queued row; click `Sent · M` → page scrolls to top.
- [ ] 8.11 With OS `prefers-reduced-motion: reduce`, mark-sent does not animate.
- [ ] 8.12 Tombstoned (unpinned) rows do not appear in either section or in totals.

## 9. Wrap-up

- [x] 9.1 Run `npm test` and `npm run build` — both must pass.
- [x] 9.2 Self-review the diff: confirm `decisionLogic.js`, `convex/schema.ts`, and `convex/assignments.ts` are untouched; the change is UI-only.
- [ ] 9.3 Update screenshots / notes in any internal doc if the team keeps one (not blocking).
- [x] 9.4 Run `openspec validate customer-sent-property-checklist --strict` and fix any reported issues.
- [ ] 9.5 Ready to archive: run `/opsx:archive customer-sent-property-checklist` after merge.
