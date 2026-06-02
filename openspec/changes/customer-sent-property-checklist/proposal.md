## Why

Today the operator can see (property, customer) sent state only inside `Recommend` — buried below the live decide() engine, mixed with suggestions and held-back matches. There is no per-customer landing place that answers the daily question: **"For this client, which of our properties have I sent — and which haven't I yet?"**

The Customers screen is where the operator already goes to think customer-first. The right shape for the question is a **dedicated subpage per customer** — `/customers/:id` — where every property in the database appears as a card and the operator marks "sent / not sent" with one click. That is the cleanest fit for the spoken brief: *click on the customer, then mark which listings have been sent.*

(An earlier iteration tried embedding the checklist inline on each customer card; in practice the cards became cramped and the action target was too small. The detail-page shape gives the operator room to scan, search, and act.)

## What Changes

- **Customer cards become clickable** — clicking a card on `/customers` navigates to `/customers/:id`. Card hover/focus state make the affordance obvious. The lightweight `EngagementChip` (`N sent · M queued · latest 2h ago`) returns as the at-a-glance summary on the list page; the heavyweight per-row tracking moves to the detail page.
- **New screen `/customers/:id` (CustomerDetail)** — a focused subpage with:
  - A customer hero strip — avatar, name, school/source pills, channel/contact, budget, housing, move-in, commute tolerance, and three count tiles (`Sent`, `Queued`, `Properties total`).
  - A toolbar — search-by-condo input + a `Hide sent` toggle.
  - A grid of **property cards**, one per database property, each showing condo name, building/area/unit sub-line, rent, commute-for-this-customer's-school, poster status, and either a **`Mark sent`** action button (with an orange `Queued` badge when the row was already pinned) or a sticky **`Sent <date> · via <channel>`** confirmation badge once sent.
  - Sort order: sent first (audit), then queued, then idle — within each, alphabetical by condo.
- **One-click Mark sent** — the operator does not need to think about "pin vs sent". Clicking the action calls `assignments:pin` first (only if no active assignment exists), then immediately `assignments:markSent` with `sentVia = response.channel || 'manual'`. A toast confirms.
- **Customers-screen page-header totals** — the two existing-from-the-previous-iteration counters `In flight · N` and `Sent · M` remain on the list page. They give the operator backlog visibility at a glance.
- **No schema changes, no new mutations** — `assignments` and its `list`, `pin`, `markSent`, `unpin` mutations already model everything required.

## Capabilities

### New Capabilities
- `customer-sent-tracker`: A clickable Customers list plus a per-customer detail subpage that lists every property as a card and lets the operator mark which properties have been sent to that customer.

### Modified Capabilities
<!-- None. `openspec/specs/` is empty; the existing assignments ledger lives
     inside the in-flight `descriptive-property-assignments` change. We are
     adding a customer-centric view on top, not changing assignment semantics. -->

## Impact

- **Schema**: no changes. `properties`, `responses`, and `assignments` are untouched.
- **Backend (Convex)**: no new files. `assignments:list` is used with `{ responseId }` on the detail page to scope the read; `assignments:pin` and `assignments:markSent` are called by the action button.
- **Frontend**:
  - `src/components/CustomerDetail.jsx` — **new file**. The subpage component (hero strip + toolbar + property-card grid + mark-sent handler).
  - `src/components/Customers.jsx` — cards become clickable (`navigate('/customers/:id')`); `EngagementChip` restored as the small summary; page-header `In flight` / `Sent` totals retained.
  - `src/App.jsx` — adds a `Route` for `/customers/:id` and passes `properties`, `responses`, `toast` through.
  - `src/assignmentHelpers.js` — shared `partitionAssignmentsForProperty`, `partitionAssignmentsForClient`, `isPairCovered`, extracted from `Recommend.jsx` in the same change (still used by Recommend; CustomerDetail computes its own per-property state inline since it needs the full set, not the partition).
  - `src/components/Recommend.jsx` — imports the shared helpers; local definitions deleted (mechanical refactor, no behaviour change).
  - `src/styles.css` — new rules for clickable card affordance, detail page hero, hero counts, detail toolbar, and property mark-card grid. Uses existing brand tokens (navy/orange/cream/green/hairline) only.
- **Decision logic**: `src/decisionLogic.js` is **not** modified.
- **No external dependencies, no migrations, no breaking changes.** The Recommend screen continues to work standalone; the Customers screen gains a list-detail flow.
- **Design language**: stays inside the Hommies brand tokens and Nunito sans + display tokens. The detail-page hero is a single confident block with the display font on the customer name and tabular-num counts — a calm, editorial header that makes the page feel like *this customer's page*, not just another grid screen.
