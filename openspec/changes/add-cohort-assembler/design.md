## Context

The portal now has two recommendation primitives:
- `decide(resp, prop)` — scores one customer against one property (six factors, hard blockers, `groupContext` for pre-formed groups).
- `pairFitForProperty(a, b, prop)` — scores two solo customers as potential housemates on one property (three factors, three blockers, returns `perPersonRent` and `notes[]`).

Neither answers the operator's actual question for a whole-unit listing with multiple bedrooms: *"Which three (or four, or five) people from my pool should I propose to live in this unit together?"* That question requires:
- A pool filter (only solo customers who opted in to roommates),
- All-pairs pair-fit scoring across the filtered pool,
- A search for a complete N-person cohort whose pairwise compatibility is mutually high,
- A room assignment respecting each member's budget,
- A scoring metric for ranking cohorts (so the UI can show the best one first when it lands).

This change adds that layer as a single pure function `assembleCohort(prop, pool, options?)`. It is consumed by the future cohort UI and could be reused by an "auto-pin" workflow if we ever build one.

The algorithm is deliberately greedy. A globally optimal cohort search is `O(C(N, K))` where N is the pool size and K is the room count — combinatorial. For typical Hommies pools (tens of customers, K = 2-4), the difference between greedy and global is small in practice, and greedy is `O(N² · K)` which is sub-millisecond. We accept locally optimal cohorts for v1; if operators ever flag "the system missed a better trio", we revisit.

## Goals / Non-Goals

**Goals:**
- A single deterministic pure function that, given a property and a pool of response records, returns either a complete cohort (size matches `masterCount + commonCount`) or `null` with a reason describing why no cohort could be assembled.
- Honour the four pair-fit hard blockers transitively: no cohort can contain a pair that is `unfit`.
- Respect the eligibility filter (`wantRoommate: true`, `housingType: 'Room'`, solo customers only).
- Produce a per-member room assignment that conserves the unit rent (sum equals `prop.rentSGD`).
- Expose enough structure in the return value (`cohort[]`, `cohortScore`, `roomAssignments`, `notes[]`, `pairFits[]`) that the future UI can render the cohort card without re-running any logic.
- Tie-breakers (sum-of-pair-fits → move-in span → budget spread) are documented and applied deterministically.

**Non-Goals:**
- Global search across all possible cohorts. Greedy is the chosen algorithm.
- Cross-property cohort optimisation (a customer being in cohorts for multiple properties). The assembler runs per-property; deciding which property a customer "belongs to" is an operator call.
- Persistence. The function is called on demand; no Convex caching, no stored cohort records.
- Auto-pinning, auto-introductions, or auto-messaging. The output is a *suggestion*; the operator decides what to do with it.
- Cohort sizes outside the property's room count. If `masterCount + commonCount = 3`, only 3-person cohorts are returned.
- Partial cohorts (e.g. "we found 2 of 3 — operator finds the third"). The function either returns a full cohort or `null`.
- Schema changes — no new fields, no migration of existing customer data.
- UI in `Recommend.jsx` or anywhere else.

## Decisions

### Eligibility filter (Step 1)

Pool members must satisfy ALL of:
- `wantRoommate === true` — they opted in to housemate matching.
- `housingType === 'Room'` — they want to live in a shared unit (not their own whole unit).
- `(groupSize ?? 1) === 1` — solo customers only; pre-formed groups bypass cohort assembly via the existing `decide()` path.

The property must satisfy:
- `housingType === 'Whole Unit'` — only whole units have multiple rooms to fill.
- `masterCount + commonCount > 0` AND both defined — without counts, there is no target size and no room to assign.

If the property fails its check, return `null` with reason `'property_not_splittable'`. If the filtered pool is empty, return `null` with reason `'no_eligible_candidates'`.

### Target cohort size

```
target = prop.masterCount + prop.commonCount
```

This is the number of bedrooms — and therefore the number of people the unit needs to be filled. Hommies' model presumes one tenant per bedroom; multi-occupancy single rooms are out of scope.

If `filteredPool.length < target` → return `null` with reason `'pool_too_small'`. No partial cohorts.

### Seed pair selection (Step 5)

Compute every `pairFitForProperty(i, j, prop)` for distinct (i, j) in the filtered pool. Drop the null returns (same identity, group-tagged) and the `unfit` verdicts.

The remaining pairs are candidates for the seed. Pick the pair with the highest `score`. Tie-break by **tightest move-in span across the pair** — i.e. smallest `|parseMoveInDate(a.moveIn) - parseMoveInDate(b.moveIn)|` in days. Further ties are broken by stable sort order (input pool order), so the algorithm is deterministic given the same input.

If no fit pair exists, return `null` with reason `'no_fit_pair'`.

### Grow step — the "min pair-fit to cohort" metric (Step 6)

To grow the cohort from size 2 to `target`, repeatedly pick the candidate `c` from the remaining pool that maximises:

```
min(pairFit(c, m).score for m in cohort)
```

Candidates with any unfit pair to existing cohort members are rejected outright. If no candidate qualifies → return `null` with reason `'cohort_incomplete'`.

**Why `min`, not `sum`:** A candidate scoring 100 with one cohort member but 60 with another is more fragile than a candidate scoring 80 with everyone. The `min` metric protects against the "A fits B, A fits C, but B–C is barely fit" trap by surfacing the weakest link in the cohort as it grows.

Ties on the min metric are broken by `sum` of pair-fits (highest wins), then by tightest move-in span between the candidate and the cohort centroid (here, just the seed pair). Further ties: input pool order.

### Room assignment (Step 7)

Sort cohort members by `budget.max` descending. The top `masterCount` members are assigned `master`; the rest assigned `common`.

Then verify each assignment fits within `member.budget.max + BUDGET_SOFT_OVERSHOOT`:
- If the highest-budget member cannot afford the master rent (rare — would mean Mei has budget 1500 but master is 1800), the assembler attempts a swap: bring a lower-ranked member to master if they have budget for it. (In practice this almost never fires, but it's correct.)
- If no valid swap exists (no cohort member can afford master), return `null` with reason `'no_valid_room_assignment'`. This is rare given the pair-fit filter already enforces affordability at the pair level, but defensive.

For all-common layouts (`masterCount === 0`), every member takes common at the same rent; assignment is trivial. For all-master layouts (`commonCount === 0`), every member takes master; assignment is by descending budget (just for cohort ordering, since rent is the same).

### `cohortScore` is the mean of intra-cohort pair-fits

```
pairs = C(target, 2) pair-fits between cohort members
cohortScore = round(sum(p.score for p in pairs) / pairs.length)
```

Mean (not sum) keeps the score on the 0–100 scale and directly comparable to a single pair-fit. A cohort where every pair scores 100 has cohortScore 100. A cohort with one 60-score pair drags the cohort score down even if other pairs are 100.

### `notes[]` aggregation (Step 9)

Concatenate all `notes[]` from every intra-cohort pair-fit. Deduplicate by string equality. Prepend one structural note describing the room assignment, e.g.:

```
"Mei takes master — only cohort member whose budget covers S$1,800. Wei and Arjun split commons at S$1,350 each."
```

Order: structural note first, then deduplicated pair-fit notes in the same stable order they appear (lifestyle → free-text → warnings, from the pair-fit notes' own ordering).

### Return shape — `pairFits[]` for future UI use

The result includes a `pairFits` array of `{ a: respId, b: respId, score }` for every intra-cohort pair. This lets the future UI render a tiny matrix or a "weakest pair" highlight without re-running the algorithm. The full pair-fit decision objects are *not* stored on the result — only the score — to keep the payload small.

### Tie-breaker constants

```js
COHORT_TIE_BREAKERS = ['sum_pair_fits', 'movein_span', 'budget_spread']
```

Exported as a frozen array so external code can reference the ordering by name. The assembler itself uses tightest move-in span at the seed step and sum-of-pair-fits at the grow step (different tie contexts call for different primary breakers); the array documents the canonical order for any caller that wants to rank multiple complete cohorts (e.g. "which of these 3 candidate cohorts should I pin?"). The cohort UI will consume this for "why this cohort?" explanations.

### Optional `options` argument

For testability and future flexibility:
- `options.now?: Date` — override "now" for move-in span calculations (irrelevant for v1 since we measure absolute span, not days-from-now). Documented for parity with patterns elsewhere.
- `options.targetOverride?: number` — accept a smaller cohort than `target`. Default off. Future use: "fill 3 of 4 rooms, leave one for a friend the cohort knows" is a real operator request, but out of v1 scope.

For v1 we accept `options` but ignore it — keeps the call sites future-proof.

## Risks / Trade-offs

- **[Greedy is not optimal]** A pathological pool can have a globally better cohort that greedy misses (e.g. the seed pair locks the algorithm into a sub-optimal trio). **Mitigation:** documented v1 limitation. Operators can manually mix-and-match in the UI when the assembler's suggestion looks off. If this becomes a real problem, swap in a small backtracking search (bounded depth) before global optimisation.

- **[Greedy is deterministic but sensitive to input order]** Two semantically equivalent pools that differ only in order can produce different cohorts when many ties occur. **Mitigation:** ties are broken by tightest move-in span and then stable input order, so behaviour is predictable per input. We document that operators wanting a different cohort can re-order the pool (e.g. by sorting by recent intake).

- **[Eligibility filter excludes "Whole Unit"-preferring solo customers]** Some operators may want to surface these too — someone who said "I want a whole unit" might still co-tenant if shown a strong cohort. **Mitigation:** v1 strict. We err on the side of respecting customer intent. If the operator wants to broaden, they can change the customer's `housingType` in the manual response modal.

- **[Room assignment can refuse a fit-pair cohort]** When the only top-budget member also has lifestyle conflicts with the rest, the cohort might pair-fit but fail room assignment. **Mitigation:** the swap step catches most cases; a return of `'no_valid_room_assignment'` is correct (rare) signal to the operator that the cohort is unusable as configured.

- **[`pairFitForProperty` is called O(N²) per call to `assembleCohort`]** For a pool of N=100 that's 10,000 invocations. Each is cheap (no I/O, regex + arithmetic). At ~5µs per pair-fit (measured from existing tests), total is ~50ms for a 100-pool call — well within "single screen render" budget. **Mitigation:** if pools grow beyond a few hundred, memoise per `(a._id, b._id)` across multiple `assembleCohort` calls for the same property; defer until profiling shows it.

- **[`cohortScore` mean is intuitive but hides variance]** A cohort with scores 100/100/60 has the same mean as 80/80/100. Worth flagging — but variance is reflected in `pairFits[]`, which the UI can show. **Mitigation:** the future UI can highlight the weakest pair; the assembler's job is to return data, not to mask it.
