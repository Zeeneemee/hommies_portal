## Context

The Hommies portal already stores everything needed to answer *"which properties did we send to which customer?"*:

- `assignments` table — `(propertyId, responseId, status, pinnedAt, sentAt, sentVia, unpinnedAt)`.
- `assignments:list` / `pin` / `markSent` / `unpin` mutations.
- Helpers `partitionAssignmentsForClient` and `engagementFor` already extract pinned vs sent rows per customer.

Today the operator sees this only as:
1. A one-line **EngagementChip** on the Customers card (`2 pinned · 5 sent · latest 2h ago`).
2. Two stacked sections inside Recommend's by-client view, mixed with engine suggestions.

Neither view answers "did we send X to Y?" at a glance, and neither lets the operator close the loop *from* the customer screen. The constraint: this is an internal operator tool, single-user-at-a-time, mobile-occasionally, optimised for *speed of scan* over decoration. The visual system is a fixed Hommies palette (navy `#041f60`, orange `#fd6925`, cream `#fff5ec`, green `#1d9e75`) on a Nunito sans stack — design must extend it, not displace it.

## Goals / Non-Goals

**Goals:**
- Make the per-customer property history glanceable in <1 second per card.
- Let the operator mark a queued property as sent in **one click** without leaving the card.
- Let the operator pin one more property to a customer from the same card.
- Keep visual gravity on the *sent ledger* (the audit) and the *queue* (the work) — push everything else down.
- Reuse existing tokens (`--navy`, `--orange`, `--green`, `--hairline`, `--radius-m`) and primitives (`Pill`, `Icon`) so the screen still feels like Hommies.
- Surface portal-wide totals in the page header so the operator can see backlog/throughput at a glance.

**Non-Goals:**
- Redesigning the Customers screen filters, stats strip, or the customer-card header/facts area.
- Adding undo/edit to sent rows. Sent is immutable by design (existing assignments contract). The checklist surfaces that immutability — it never offers an "uncheck" action on a sent row.
- Building a property↔customer matrix or a global "Sent tracker" page. That was rejected in scoping.
- Modal-driven sent flow. One-click only, with toast confirm.
- Capturing `sentVia` in v1. Default to `'manual'` for inline marks; if the operator needs channel granularity they can still use Recommend, where the existing UI captures it.

## Decisions

### D1. Per-customer checklist embedded in `CustomerCard`, below the existing facts

**Decision:** Add a new region `customer-checklist` to `CustomerCard`, positioned after `customer-facts` / `customer-tags` and before `customer-foot`. The current `EngagementChip` is replaced by an inline counts row that sits on the checklist header (e.g. `Properties · 2 sent · 1 queued`), not by a separate chip.

**Alternatives considered:**
- *New screen at `/sent` with a customer↔property grid.* Rejected: 95% of operator workflow is customer-first; a grid optimises for a different question and adds a route to maintain.
- *Modal opened from the card.* Rejected: forces a click before the data is visible; defeats the "glanceable" goal.
- *Keep EngagementChip and add a `[View history]` link that expands inline.* Rejected as a half-measure — if the data is worth showing it's worth showing by default. Cards already scroll within their column.

### D2. Two visual states for a checklist row — `✓ Sent` and `☐ Queued` — with a single hairline divider between sections

Sent rows sit on top, queued rows below, separated by a hairline labelled `— queued —` only when both sections are non-empty (avoids an empty divider). Within each section, sort sent newest-first by `sentAt`, queued newest-first by `pinnedAt` (matches `partitionAssignmentsForClient`).

**Rationale:** putting sent on top makes the ledger feel printed-and-settled; the queue at the bottom is the *next action* and naturally reads as "what's left to do" — the checklist metaphor the user asked for.

**Alternatives considered:**
- *Queued on top.* Rejected: would put action above audit, but the user's primary question is "what did we send" — the audit *is* the headline.
- *Tabs (Sent | Queued | All).* Rejected: 3 clicks to get a complete picture; for the typical 0–8 rows per customer, a single scrollable list reads faster.

### D3. One-click `Mark sent` button on every queued row, with optimistic UI + toast

Pressed button calls `useMutation('assignments:markSent')({ id, sentVia: 'manual' })`. The row animates up out of the queued section and re-anchors at the top of the sent section (CSS transition on `transform: translateY(...)` with `prefers-reduced-motion` opting out). Toast confirms `"<Condo> marked sent to <Name>."`. If the mutation rejects (immutability conflict, network), the row snaps back and a red toast surfaces the error.

**Rationale:** the user explicitly chose one-click + button (over checkbox-toggle and over modal). Animation reinforces the metaphor *"a row settled from work into ledger"* — this is the single distinctive micro-interaction the screen earns.

**Alternatives considered:**
- *Optimistic toggle with rollback only on error.* Equivalent UX; chose explicit button-with-icon because Convex `useMutation` already returns a promise we can await and the button affords clarity ("what happens if I click this?") better than a checkbox in a row of mixed read-only and active rows.

### D4. Inline "Add property to send" picker (collapsed by default)

A hairline-bordered footer row at the bottom of the checklist labelled `+ Pin another property`. Clicked, it expands into a searchable combobox listing properties **not already covered** for this customer (i.e. filtered through `isPairCovered`). Selecting a property calls `assignments:pin` with `pinnedScore: 0` and `pinnedReason: 'manual-from-customer-card'` so the audit explains where the pin originated. The new row appears in the queued section.

**Rationale:** the daily flow ("oh, also send Park Avenue Sora to Alex") shouldn't require navigating to Recommend, locating the customer, and pinning from there. Tagging `pinnedReason` keeps Recommend's score-drift display honest — it can flag "no algorithmic recommendation; pinned from Customer card."

**Alternatives considered:**
- *Deep-link to Recommend with the customer pre-selected.* Rejected: a context switch for what should be a single click + select.
- *No add-property at all from this screen.* Rejected: leaves the checklist purely read-only-ish; the user wanted *tracking and closing*, not just tracking.

### D5. Page-header total strip: `In flight: <queued> · Sent: <sent>`

Add a small inline summary in `CustomersScreen`'s `page-header` right of the title, alongside the existing `Add customer` button. Reads `In flight · N` (queued total, orange) and `Sent · M` (sent total, green). Tap-targets: clicking `In flight · N` scrolls to the first card with `queuedCount > 0`; clicking `Sent · M` scrolls to top.

**Rationale:** answers "how big is the backlog" without leaving the page. Reuses the existing `customer-stats` visual grammar but keeps it lightweight (two values, no big numerals — those belong to the cohort counts).

### D6. Visual language — calm ledger, not chrome

- **Sent row:** `✓` in `--green` (16px), property name in `--ink` at normal weight, `· sent <date>` in `--ink-mute` with `font-variant-numeric: tabular-nums` so dates align column-wise.
- **Queued row:** `☐` (1.25px hairline square in `--hairline-strong`) at the same 16px, property name in `--ink` slightly heavier (`font-weight: 600`) to signal "this is the active item", and the `Mark sent` button right-aligned (small ghost button, `--green` text, `--green-soft` hover).
- **Section divider:** the `— queued —` rule is hairline `--hairline` with the label centred and 11px uppercase letter-spaced — a print-ledger cue.
- **Empty state:** when both sections are empty, a single muted line `"No properties tracked yet."` followed by the `+ Pin another property` row. No illustration, no oversized empty card.
- **Density:** 8px vertical between rows, 12px between sections. Match existing `customer-card` 14px padding so the checklist breathes inside the card without bursting it.
- **Distinctive detail (one, not many):** the mark-sent animation in D3, plus tabular-num dates that line up vertically across all rows in a card — together they make the section *feel* like a ledger without leaning on extra ornament.

### D7. Shared helper module `src/assignmentHelpers.js`

`partitionAssignmentsForClient` currently lives in `Recommend.jsx`. We move it (and `partitionAssignmentsForProperty`, `isPairCovered`) into `src/assignmentHelpers.js` and import from both screens. No behaviour change — a refactor enabled by the new consumer.

**Rationale:** keeps the rule that "tombstones are excluded; sort newest-first" defined in one place. Avoids drift.

## Risks / Trade-offs

- **Risk:** Cards become tall once a customer has many sent rows → grid layout looks ragged.
  **Mitigation:** cap the visible sent rows at 5 with a `Show all (N)` expander; queued rows are always fully shown (work-in-progress is small). Expander state is per-card React local — does not need to persist.
- **Risk:** The page becomes data-heavy because each card now reads `assignments:list` indirectly.
  **Mitigation:** `assignments:list` is a single Convex query fetched once at the screen level (already the pattern in `Recommend`), then partitioned per card client-side. No N+1.
- **Risk:** "Pin from customer card" might be used to pin properties the score would have held back, blurring Recommend's audit story.
  **Mitigation:** stamp `pinnedReason: 'manual-from-customer-card'` so Recommend's score-drift section already knows to label the source. No new schema needed.
- **Risk:** One-click mark-sent is destructive in the sense that sent is immutable — accidental click is unrecoverable except by a fresh pin.
  **Mitigation:** (a) the button explicitly reads `Mark sent` (no icon-only), (b) the row sits two clicks away from a delete affordance (different colour, different region), (c) the toast surfaces the action and a 4-second window — but no undo button (matches the existing data contract; an undo would require either making sent mutable or implementing tombstone-on-sent which is out of scope).
- **Trade-off:** No `sentVia` capture at v1. We accept the loss of channel granularity for inline marks in exchange for one-click speed; channel is still captured by the existing Recommend flow when the operator wants it.
- **Trade-off:** Moving `partitionAssignmentsForClient` out of `Recommend.jsx` touches a file outside the new feature's scope. The diff is mechanical (import path) but it widens the blast radius of the change by one file.

## Migration Plan

1. Extract `partitionAssignmentsForClient`, `partitionAssignmentsForProperty`, `isPairCovered` from `Recommend.jsx` into `src/assignmentHelpers.js`. Update `Recommend.jsx` imports. Run `npm test` (vitest) and `npm run dev` — verify Recommend still renders both views.
2. Lift `properties` prop into `<CustomersScreen>` in `App.jsx` (already loaded at App level).
3. Implement `<CustomerChecklist>` subcomponent in `Customers.jsx` and replace `EngagementChip` site with it.
4. Add CSS for `.customer-checklist`, `.checklist-row`, `.checklist-row--sent`, `.checklist-row--queued`, `.checklist-divider`, `.checklist-add-row` in `src/styles.css`, scoped under `.customer-card`.
5. Add header totals strip to `CustomersScreen`.
6. Manual QA: empty customer (no engagement), customer with only sent, customer with only queued, customer with both, customer with 7+ sent (expander), mark-sent + toast, pin-from-card + new row appearance, `prefers-reduced-motion` disables the row animation.
7. No schema migration, no data migration, no Convex deploy step beyond what `npm run build && convex deploy` already covers — the `assignments:markSent` and `assignments:pin` mutations already exist.

**Rollback:** revert the Customers.jsx + styles.css + assignmentHelpers.js changes. The assignment ledger is unaffected — no data shape changes were made.

## Pivot — inline checklist → detail subpage (2026-06-02)

The first iteration embedded the per-customer checklist **inline** on each customer card on `/customers`. In practice the cards became cramped, the `Mark sent` button was small, the divider/expander noise competed with the rest of the card content, and the operator's intent ("open this customer, then mark sent") didn't match an in-card affordance.

We pivoted to a **list / detail** shape:
- `/customers` — the customer list with clickable cards. The lightweight `EngagementChip` (`N sent · M queued · latest <time>`) returns as the per-card summary. The page-header `In flight` / `Sent` totals from the first iteration stay (they earn their space at a glance).
- `/customers/:id` — the focused detail subpage. Customer hero + 3 count tiles, then a grid of property mark-cards (one per database property) with one-click `Mark sent`. Search and `Hide sent` filter live in the toolbar.

This change is reflected in `proposal.md`, `specs/customer-sent-tracker/spec.md`, and the implementation. The earlier inline-checklist code (the `<CustomerChecklist>` subcomponent and its CSS) has been removed from the codebase; the helper module `src/assignmentHelpers.js` survives because Recommend still uses it.

Implementation specifics for the detail subpage:
- `useQuery('assignments:list', { responseId: id })` — scoped to one customer.
- `Mark sent` click handler is idempotent: if no active assignment exists, it calls `pin` first (returns the new id), then `markSent`. If a pinned row exists, it skips `pin`. If a sent row exists, it no-ops.
- Sort order in the property grid: `sent` → `pinned` → `idle`, alphabetical by condo within each band. This puts audit on top and the operator's next-action surface beneath it without forcing a tab.
- Visual treatment: the customer hero uses `--font-display` for the name and a 32px line-height-1.1 setting — the rest of the portal is utilitarian sans, so the hero feels like *this customer's page* rather than another grid. Cards use a subtle green tint on sent (`linear-gradient(..., var(--green-soft) 320%)` — most of the gradient is off-card so only a faint wash shows). The `Mark sent` button is the high-contrast `--ink` button on idle cards and `--orange` on already-queued cards — making the queued state feel like *the next action you committed to*.

## Open Questions

- Should the `Mark sent` action default `sentVia` to the customer's `channel` field (e.g. `whatsapp`, `email`) when present, falling back to `'manual'`? Slightly higher fidelity for almost no UX cost. **Tentative answer:** yes, do this in v1 — it's a one-line change in the handler.
- Should the expander on long sent lists be card-level or screen-level (i.e. one global "compact / detailed" toggle)? **Tentative answer:** card-level for v1; revisit if cards routinely have 10+ sent.
- Long term, do we want a dedicated `/sent` route (the rejected D1 alternative) as a reporting/export surface, even though it's not the primary workflow? Not blocking; leave for a future change if asked.
