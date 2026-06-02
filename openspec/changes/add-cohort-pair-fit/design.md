## Context

The portal's recommend engine has two existing primitives in `src/decisionLogic.js`:
- `decide(resp, prop)` — scores one customer (possibly a pre-formed group via `groupSize`) against one property using six weighted factors and hard blockers.
- `splitRent(prop)` — partitions a whole-unit listing's rent into per-room rents using Option A (master pays 1.2× the per-room average; commons absorb the remainder so totals conserve).

What we lack is any notion of pairwise customer compatibility. To assemble cohorts of strangers (e.g. fill a 3-bedroom unit from three unrelated `wantRoommate: true` responses), the system needs to ask "could A and B share this unit?" — a question neither `decide()` nor `splitRent()` answers on its own.

This change adds exactly that primitive. The cohort *builder* (which would call this primitive across N candidates, search for compatible triples, suggest room assignments, and surface a UI card) is a separate, larger change that depends on this one. Splitting the work keeps each step shippable and the primitive testable in isolation.

The scoring rules locked in this design were validated against a worked trace during exploration: three NUS students (Wei, Arjun, Mei) with realistic budget bands and the Normanton Park 1M+2C @ S$4,500 unit. Two pairwise scenarios (Wei × Arjun and Wei × Mei) both score 100/100; two friction variants (early move-in, mismatched lease) trigger blockers cleanly.

## Goals / Non-Goals

**Goals:**
- A single deterministic pure function `pairFitForProperty(a, b, prop)` that, given two response records and one property record, returns a structured decision usable by both ranking code and UI display.
- Total-conserving rent assignment: each customer in the pair gets a concrete `perPersonRent` value matching a real room slot on the property.
- Honest, narrow gates: only the four blockers (`consent_missing`, `movein_too_far`, `lease_mismatch`, `budget_unaffordable`) and the three scored factors (budget, commute, move-in). Nothing else.
- Lifestyle data (`quiet`, `cooking`, `petFriendly`, `extras.note`) surfaced as operator-visible notes but never scored.
- Tolerant parsers for `moveIn` and `leaseLength` strings; unparseable inputs degrade gracefully (soft on schedule factors, never silently block).

**Non-Goals:**
- Cohort assembly across N customers (greedy, stable-matching, or otherwise). Deferred.
- Any UI changes — Recommend card, Listings card, AddProperty, ManualResponseModal. Deferred.
- Schema changes: no `cohortMax`, no `openToCohort`, no structured `moveInDate` / `leaseMonths` columns. We parse on the fly.
- Modifying `decide()`. Existing pre-formed-group scoring is unchanged.
- Lifestyle scoring. Quiet/cook/pet preferences are flagged for the operator but never numerically score the pair.
- Cross-property pair compatibility (a `pairLifestyleFit` independent of any unit). The user's workflow is property-anchored — building a property-independent variant now is speculative scope.

## Decisions

### Three scored factors, weights summing to 100

```
factor              weight   what it measures
─────                ────    ─────────────────────────────────────────
budget                45     property-conditioned. Each side must be
                             able to take SOME room on the unit within
                             budget + BUDGET_SOFT_OVERSHOOT (S$200).
commute               25     property.commuteMins[side.school] vs
                             side.commuteTolMins for each side.
schedule — move-in    30     days between parseMoveInDate(a.moveIn)
                             and parseMoveInDate(b.moveIn).
                     ─────
                     100
```

**Why these weights:** Budget dominates because an unaffordable cohort is no cohort. Commute and move-in are roughly equal in real-world friction — landlords care more about lease coordination, customers care more about commute time, so 25 + 30 = 55 split between them. Lease length is a hard gate, not a scored factor (see below), so it does not enter the 100-point pool.

**Why no lifestyle weight:** The exploration session compared a weighted-lifestyle scheme to a no-lifestyle scheme. The user picked the latter because (a) `quiet`/`cooking`/`petFriendly` are coarse booleans with unclear semantics ("did you mean you want quiet, or that you ARE quiet?"), (b) the `extras.note` free-text holds the real signal but is unstructured, and (c) operators are the right judges of soft compatibility — the system should surface notes, not pretend to weigh them.

### Lease length: hard equality gate

The user's lock-in: "for lease month they have to be the same to be able to split the room." Co-tenants on one lease must agree on its length. A 6-month/12-month split means one person leaves mid-lease — not a co-tenancy.

So the lease check is a binary gate, not a graduated soft/fail. After running the three scored factors, the function compares `parseLeaseMonths(a.leaseLength)` to `parseLeaseMonths(b.leaseLength)`:
- Both parse + identical integer months → continue.
- Both parse + different → `lease_mismatch` blocker.
- Either fails to parse → soft fail with a note (`"Unparseable lease length on Wei (\"12 months\") — operator to verify"`). The pair is NOT rejected outright, because the strings might still be equivalent ("12 months" vs "1 year") and we'd rather surface the ambiguity than silently drop the pair.

### Sentinel `null` return for "this comparison doesn't make sense"

Two cases:
- **Same identity:** `pairFitForProperty(a, a, prop)` is meaningless. Detected by `_id` equality when both have one; otherwise by reference equality.
- **Either side has `groupSize > 1`:** They are a pre-formed group. Cohort-matching them with another solo would break their existing group. The existing `decide()` engine handles them via the group-aware path.

Both cases return literal `null`. Callers must check for null before reading `.score` / `.verdict`. This keeps the result type "always-valid-decision-or-null" — never an ambiguous half-formed decision.

### Property-conditioned budget check

This is the subtle one. Naive overlap-of-budget-bands would reject Wei (1200–1500) and Mei (1600–2000) outright — their bands don't intersect. But on a 1M+2C unit @ S$4,500, the master is S$1,800 (fits Mei) and the common is S$1,350 (fits Wei). Different rooms, both fit.

So the budget criterion's `pass` condition is: **"there exists an assignment of room-types to sides such that each side's rent falls within its budget+soft margin."** Concretely:

```
For (a, b) on prop, compute split = splitRent(prop):
  - Build the set of rooms with positive count: {master if masterCount>0, common if commonCount>0}.
  - For each side, list the room kinds they can afford:
      affordable[side] = { kind : split[kind] <= side.budget.max + BUDGET_SOFT_OVERSHOOT
                                AND (kind exists on the unit) }
  - The pair fits iff there exists a slot assignment such that:
      - Side a can take kind_a (kind_a ∈ affordable[a])
      - Side b can take kind_b (kind_b ∈ affordable[b])
      - The unit has enough rooms of those kinds (e.g. both common requires commonCount >= 2)
```

Both prefer common: feasible if `commonCount >= 2`. One master one common: feasible if `masterCount >= 1 AND commonCount >= 1`. Etc.

The assignment search is trivial (≤ 4 combinations). Choose the assignment that minimises `max(rent_a, rent_b)` — both sides get their cheapest available slot. This is the assignment surfaced in `perPersonRent`.

Soft cases (one side fits only by overshooting their budget by < S$200) score the budget factor at `pass`-level but add a criterion noting the overshoot. Hard fail: at least one side has *no* affordable room → `budget_unaffordable` blocker.

### `notes[]` channel — the lifestyle escape hatch

The function emits an array of strings for human consumption only:
- One note per asymmetric lifestyle signal (e.g. `"Wei wants quiet; Mei does not — surface in intro."`).
- One note per non-empty `extras.note` from either side, prefixed: `"Wei's note: \"Prefer non-smoker.\""`
- One note for unparseable lease/move-in fields if the soft-fallback path triggered.

The notes are stable in order (lifestyle first, then free-text, then warnings), so UI rendering is deterministic.

### Tie-breaker for future cohort building (documented, not implemented)

When the cohort builder lands, it will rank candidate cohorts by:
1. Sum of pairwise scores (primary).
2. Tightness of move-in window across the cohort (`max(moveIn) - min(moveIn)`, smaller is better). This is the secondary because lease coordination is the most operationally painful friction.
3. Smallest budget spread within the cohort. Cohesion proxy.

These are noted here so the pair-fit result shape can carry the data the cohort builder will need (`perPersonRent`, parsed `moveInDate` exposed in criteria detail, etc.).

## Risks / Trade-offs

- **[Lease parser misses common variants]** "1 year" and "12 months" might parse to different values, silently dropping otherwise-fit pairs. **Mitigation:** unparseable lease → soft + note (not blocker). Tests cover the common variants ("12 months", "1 year", "12mo", "半年", "一年"). If a variant slips through, the operator sees the note and can override.

- **[The 30-day move-in cutoff is opinionated]** Some landlords hold units for longer. **Mitigation:** the cutoff is a const (`MOVEIN_BLOCKER_DAYS = 30`). Easy to tune. We pick 30 because Hommies' agent network typically holds units 2-3 weeks; 30 is a soft upper bound, not gospel.

- **[Budget assignment is greedy not optimal]** When more than one feasible assignment exists, we pick the one that minimises `max(rent_a, rent_b)`. This is locally optimal for the pair but might not be globally optimal once a third cohort member enters. **Mitigation:** the cohort builder is the right place to do global optimisation. The pair-fit is honest about its local choice and exposes `perPersonRent` so the cohort builder can re-assign if needed.

- **[Lifestyle as notes only might frustrate operators]** They'll see a 100/100 pair-fit even when one is quiet and one isn't. **Mitigation:** the `notes[]` channel surfaces the friction unambiguously. We chose this over scoring because lifestyle data quality today is too thin (single bool flags) to justify weighting. When schema gets richer (e.g. structured smoker/cleanliness/gender preference fields), we can revisit.

- **[The function only operates on solo customers]** Anyone with `groupSize > 1` is excluded. **Mitigation:** intentional. Pre-formed groups already have a scoring path. Mixing pre-formed groups into cohorts changes the consent semantics ("we matched you with another group") and is out of scope.

- **[No persistence — pair-fit is computed on demand]** Each call re-parses moveIn and leaseLength. **Mitigation:** the parsers are cheap (regex + Date constructor). Cohort builder will call ~N² times for N candidates; even at N=100 this is sub-second on a laptop. If we ever profile and find this hot, memoisation by `(a._id, b._id)` is trivial.
