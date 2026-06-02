## ADDED Requirements

### Requirement: Clicking a customer card opens a per-customer detail subpage

Each customer card on `/customers` SHALL behave as a clickable surface (`role="button"`, keyboard-activatable via Enter and Space). Clicking or activating the card SHALL navigate the browser to `/customers/:id`, where `:id` is the `_id` of the underlying `responses` row. The card's inline "remove from database" affordance SHALL NOT trigger navigation (event propagation must be stopped).

#### Scenario: Click opens detail page
- **WHEN** the operator clicks anywhere on a customer card that is not the remove button
- **THEN** the URL changes to `/customers/<responseId>` and the detail subpage renders

#### Scenario: Keyboard activation
- **WHEN** a customer card has keyboard focus and the operator presses Enter or Space
- **THEN** the URL changes to `/customers/<responseId>`

#### Scenario: Remove button does not navigate
- **WHEN** the operator clicks the trash/remove button inside a customer card
- **THEN** the remove confirm dialog appears and the URL does NOT change to the detail page

### Requirement: Customer detail subpage shows the customer hero

The `/customers/:id` subpage SHALL render a hero strip at the top containing: the customer's initials avatar, their `name`, school and source pills, optional channel + contact, and four facts (Budget, Housing, Move-in, Commute ≤). Adjacent to the hero, the page SHALL show three count tiles labelled `Sent`, `Queued`, and `Properties` reflecting the current state of the assignments ledger for this customer and the total property count in the database.

#### Scenario: Hero renders for a known customer
- **WHEN** the operator navigates to `/customers/<id>` for an existing customer
- **THEN** the hero shows the customer's name, school, source, channel, contact, and the four facts in a grid
- **AND** the count tiles show the correct `Sent`, `Queued`, and `Properties` totals

#### Scenario: Unknown customer id
- **WHEN** the operator navigates to `/customers/<id>` for an id not present in `responses`
- **THEN** the page renders a "Customer not found" empty state with a link back to `/customers`

### Requirement: Property grid lists every property as a mark-card

Below the hero, the subpage SHALL render a grid of property mark-cards — one per property in the database. Each card SHALL display the property's `condo` name, a sub-line composed of `buildingType · area · unitType` (whichever are present), and three fact tiles: Rent (`S$<rentSGD>/mo` or `—`), Commute (the `commuteMins[<customer.school>]` value or `—`), and Poster (`Attached` or muted `Not yet`).

The grid SHALL be sorted: properties already sent to this customer first, then queued (pinned but not sent), then idle (no active assignment), and within each group alphabetically by `condo`.

#### Scenario: All properties shown by default
- **WHEN** the operator opens `/customers/<id>` and the database contains 7 properties
- **THEN** 7 property mark-cards are rendered

#### Scenario: Sort order
- **WHEN** the database has 2 sent, 1 queued, and 3 idle properties for a customer
- **THEN** the 2 sent cards appear first (alphabetical), then the 1 queued, then the 3 idle (alphabetical)

### Requirement: Property mark-card has three visual states

Each property mark-card SHALL render in one of three states based on the current assignment ledger for the (property, customer) pair:
- `sent` — an active assignment with `status = 'sent'` exists. The card SHALL show a solid green `Sent` badge in the top-right, a footer reading `Sent <short date> · via <sentVia>`, and NO action button.
- `pinned` — an active assignment with `status = 'pinned'` exists. The card SHALL show an orange `Queued` badge in the top-right and an orange-tinted `Mark sent` action button.
- `idle` — no active assignment exists. The card SHALL show no badge and a dark-ink `Mark sent` action button.

Tombstoned rows (`unpinnedAt` set) SHALL be treated as if they did not exist.

#### Scenario: Sent card is read-only
- **WHEN** a property has an active `sent` assignment for this customer
- **THEN** the card shows the green `Sent` badge and a `Sent <date> · via <channel>` footer
- **AND** the card does NOT show a `Mark sent` button

#### Scenario: Queued card shows orange badge and action
- **WHEN** a property has an active `pinned` assignment for this customer
- **THEN** the card shows an orange `Queued` badge and an orange-tinted `Mark sent` button

#### Scenario: Idle card shows just the action
- **WHEN** no active assignment exists for the (property, customer) pair
- **THEN** the card shows no badge and a dark-ink `Mark sent` button

### Requirement: One-click Mark sent handles pin+markSent atomically

When the operator clicks `Mark sent` on a property mark-card, the system SHALL ensure an `assignments` row exists for the (property, customer) pair and then mark it sent in one user action. The button SHALL be disabled with a "Saving…" label while the operation is in flight.

Specifically, the click handler MUST:
1. If an active assignment exists with `status = 'sent'`: do nothing.
2. If an active assignment exists with `status = 'pinned'`: call `assignments:markSent({ id, sentVia })`.
3. If no active assignment exists: call `assignments:pin({ propertyId, responseId, pinnedScore: 0, pinnedReason: 'manual-from-customer-detail' })`, then call `assignments:markSent({ id: <returned id>, sentVia })`.

The `sentVia` argument SHALL be `response.channel` when present, otherwise the literal string `'manual'`.

On success a toast SHALL surface `"<condo> marked sent to <name>."`; on failure a toast SHALL surface `"Couldn't mark sent — <reason>."`.

#### Scenario: Idle → sent in one click
- **WHEN** the operator clicks `Mark sent` on a card with no active assignment for customer X
- **THEN** the system calls `assignments:pin` with `pinnedReason: 'manual-from-customer-detail'`
- **AND** then calls `assignments:markSent` with the returned id
- **AND** the card transitions to the sent state with the green `Sent` badge
- **AND** a success toast appears

#### Scenario: Queued → sent in one click
- **WHEN** the operator clicks `Mark sent` on a card whose property has an active `pinned` assignment
- **THEN** `assignments:pin` is NOT called
- **AND** `assignments:markSent` is called with the existing assignment id

#### Scenario: sentVia defaults from customer channel
- **WHEN** the customer has `channel = "whatsapp"`
- **THEN** `assignments:markSent` is called with `sentVia: "whatsapp"`

#### Scenario: sentVia falls back to manual
- **WHEN** the customer has no `channel` value
- **THEN** `assignments:markSent` is called with `sentVia: "manual"`

### Requirement: Search and Hide-sent filter on the property grid

The detail subpage SHALL provide two filtering controls above the property grid:
- A search input that filters property mark-cards to those whose `condo` (case-insensitive substring) matches the query.
- A `Hide sent` checkbox toggle that, when on, hides cards in the `sent` state.

Both filters SHALL apply additively and SHALL preserve the sort order described above.

#### Scenario: Search by condo name
- **WHEN** the operator types "park" into the search input
- **THEN** only property cards whose condo contains "park" (case-insensitive) are visible

#### Scenario: Hide sent
- **WHEN** the operator toggles `Hide sent` on
- **THEN** all cards in the `sent` state are hidden
- **AND** queued and idle cards remain visible

### Requirement: Customers list shows page-header totals

The `/customers` page header SHALL display two inline totals to the right of the page title:
- `In flight · <total queued across all non-tombstoned pinned assignments>`
- `Sent · <total sent across all non-tombstoned sent assignments>`

Clicking `In flight` SHALL scroll the page to the first visible customer card whose customer has at least one queued assignment. Clicking `Sent` SHALL scroll the page to the top.

#### Scenario: Totals reflect ledger state
- **WHEN** the `assignments` table contains 5 active pinned rows and 12 active sent rows across all customers
- **THEN** the page header shows `In flight · 5` and `Sent · 12`

#### Scenario: Tombstoned rows excluded from totals
- **WHEN** there is one pinned row with `unpinnedAt` set
- **THEN** that row is not counted toward `In flight`
