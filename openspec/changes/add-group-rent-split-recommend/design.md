## Context

The portal recommends properties to customers by scoring `properties` against `responses` in `src/decisionLogic.js`. Today's scoring is implicitly single-person: `responses.budget = { min, max }` is compared directly against `properties.rentSGD` regardless of whether the customer is alone, paired, or grouped. Whole-unit listings therefore look "over budget" to anyone whose individual budget is below the full rent — even when the per-person share would be well within their range.

The Convex schema records the unit type as a single string (`"Common Room" | "Master Room" | "Studio" | "Whole Unit"`) and nothing about how many of each kind of room exist inside a whole unit. Gemini extraction already drafts a `bedrooms` number from the poster, but the schema has no field to receive it and the value is dropped on write. The response side only carries `wantRoommate: boolean`, which is too coarse for split arithmetic.

The user has chosen Option A as the split policy: master pays 1.2× of the per-room average, commons absorb the remainder so the total equals rent.

## Goals / Non-Goals

**Goals:**
- Capture master/common counts on whole-unit listings as optional, operator-confirmed fields.
- Capture group size on responses as an optional integer (defaults to 1).
- Produce a deterministic, total-conserving rent split usable by the recommend engine and any downstream surface (poster, recommend card).
- Score per-person rent against budget when a meaningful group + listing combination exists; otherwise behave exactly as today.
- Reject layouts that physically cannot fit the group (groupSize > rooms) as a hard blocker.

**Non-Goals:**
- Inferring master/common counts from `bedrooms` or `unitType` alone (penthouses, dual-master, study rooms make this lossy).
- Modelling who-pays-what for mixed parties (some rooms vacant). Engine assumes the whole unit is filled by the group.
- Changing single-room listings (`housingType: "Room"`) — their `rentSGD` is already per-person.
- Backfilling counts on existing whole-unit rows. Untyped rows simply opt out of the split path.
- Pricing-policy tuning beyond the chosen 1.2× master premium.

## Decisions

### Split formula — Option A (master 1.2× of average, commons absorb remainder)

```
rooms = masterCount + commonCount
if commonCount === 0:    each master pays rent / masterCount
elif masterCount === 0:  each common pays rent / commonCount
else:
    avg          = rent / rooms
    masterRent   = avg * 1.20
    commonRent   = (rent - masterCount * masterRent) / commonCount
```

**Why this over a fixed 1.2×/0.8× pair:** the original spec used `master = avg × 1.2`, `common = avg × 0.8`, which only conserves rent when there's exactly one of each. With 1M + 2C the landlord would be shortchanged by ~7%. Option A always sums to the unit rent regardless of composition.

**Why not Option B (master = 1.2 × common, no average anchor):** also conserves rent, but the 1M+1C numbers (master 2345, common 1955) don't match the user's stated 2.58/1.72 target — Option A reproduces those exact numbers.

### Where the counts come from — operator-confirmed, Gemini-drafted

Gemini already reads the poster PDF; extending its prompt to also return `masterCount` and `commonCount` is cheap. But poster layouts vary and the values must be trustworthy because they enter both rent-split arithmetic and feasibility blockers. So Gemini drafts, operator confirms via `ListingEditModal`. We do not silently accept extracted counts. This mirrors how `rentSGD`, `area`, etc. are already extracted-then-editable.

### `groupSize` as a new optional field, not a derivation from `wantRoommate`

`wantRoommate: true` means "I'm open to sharing" — it doesn't say with how many. We add `groupSize: optional number ≥ 1`. When absent (existing rows, untouched intake), the engine treats the customer as solo and skips the split path entirely. `wantRoommate` stays in the schema for back-compat and any existing filtering UI.

### Engine behaviour — split-aware only when both sides present

The new branch in `decide()` activates only when:
1. `prop.housingType === "Whole Unit"`, AND
2. `prop.masterCount` and `prop.commonCount` are both present and at least one is > 0, AND
3. `resp.groupSize` is present and > 1.

If all three hold, the engine:
- Computes `splitRent(prop)` → `{ master, common, perRoomAvg }`.
- Chooses the **lowest available room price** for the budget comparison (i.e. the common-room price if `commonCount > 0`, else the master-room price). This is the cheapest slot the customer could plausibly claim — most generous to the listing.
- If `groupSize > masterCount + commonCount`, adds an `over_layout` hard blocker.
- Otherwise scores per-person rent against `resp.budget` using the existing budget-band logic.

Any other combination falls through to today's per-listing scoring, unchanged.

### Recommend card surface

When the split is active, the card adds a one-line breakdown beneath the rent: `S$4,300/mo · S$2,580 master / S$1,720 common · per person`. When inactive, the card is unchanged.

## Risks / Trade-offs

- **[Gemini misreads room composition]** — A poster that says "3-bedroom unit" without specifying master-vs-common could lead to drafted counts that the operator misses during review. **Mitigation:** the modal shows the drafted values prominently and counts default to undefined (not zero) when Gemini is unsure, so a quiet zero never reaches the engine.

- **[Operator forgets to set counts on new whole-unit listings]** — The engine then treats the listing as if it had no breakdown and skips the split path; group customers won't see it as a match. **Mitigation:** acceptable for v1 — better silent skip than wrong arithmetic. A future change could warn operators when a whole-unit listing lacks counts.

- **[Per-person budget scoring shifts existing recommendations]** — Group=1 (the default for untouched responses) preserves all current behaviour by design. Only responses with `groupSize > 1` enter the new branch. **Mitigation:** the migration is opt-in per response.

- **[Choosing "lowest room price" for the budget comparison is generous]** — A customer might score a whole unit as "in budget" because the common rooms fit, but only the master is actually available. The recommend card surfaces the master/common split so the operator sees both numbers and can judge before pinning. **Mitigation:** acceptable for v1; we don't model room-by-room availability.

- **[`bedrooms` extraction is still dropped]** — This change does not adopt `bedrooms` as a stored field even though Gemini extracts it. Adopting it would invite operators to confuse it with `masterCount + commonCount`. **Mitigation:** leave `bedrooms` unstored for now; revisit if a separate need emerges.
