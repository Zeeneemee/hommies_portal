## 1. Parsers

- [x] 1.1 Add `parseMoveInDate(s)` to `src/decisionLogic.js` — returns `Date | null`. Accept ISO (`2026-08-01`), `Aug 2026`, `1 Aug 2026`. Reject empty, `null`, "immediate", "asap", "flexible".
- [x] 1.2 Add `parseLeaseMonths(s)` to `src/decisionLogic.js` — returns positive integer or `null`. Accept "12 months", "1 year", "12mo", "半年" (6), "一年" (12), "6+6" (12). Reject empty, "flexible".
- [x] 1.3 Export both parsers from `src/decisionLogic.js`.

## 2. `pairFitForProperty` core

- [x] 2.1 Add `pairFitForProperty(a, b, prop)` to `src/decisionLogic.js`. Imports `splitRent`, `BUDGET_SOFT_OVERSHOOT`, `COMMUTE_SOFT_OVER` from the same module.
- [x] 2.2 Implement sentinel-null cases: same `_id` (or same reference), either side has `groupSize > 1`. Return literal `null`.
- [x] 2.3 Implement the `consent_missing` blocker (`wantRoommate === false` on either side).
- [x] 2.4 Implement the budget-feasibility check using `splitRent(prop)` and the assignment-search described in design.md (enumerate room slots × room slots, filter by per-side budget+soft, pick the one minimising softCount → underCount → max(rent)). When no feasible assignment exists, add `budget_unaffordable` blocker.
- [x] 2.5 Score the budget factor (weight 45): pass when both sides fit within their budget; soft (×0.45) when at least one fits only by overshooting ≤ `BUDGET_SOFT_OVERSHOOT`.
- [x] 2.6 Score the commute factor (weight 25): for each side, look up `prop.commuteMins[side.school]` and compare to `side.commuteTolMins`. Pass when both within tolerance; soft (×0.4) when at least one within `COMMUTE_SOFT_OVER` of tolerance; fail when farther.
- [x] 2.7 Score the move-in factor (weight 30): compute days between `parseMoveInDate(a.moveIn)` and `parseMoveInDate(b.moveIn)`. Pass ≤14d; soft (×0.4) 14–30d; blocker `movein_too_far` >30d. Unparseable either side → soft + note.
- [x] 2.8 Implement the lease equality gate (after the scored factors): parse both, compare. Identical → continue. Different → `lease_mismatch` blocker. Either unparseable → soft note (no blocker).
- [x] 2.9 Build the `perPersonRent` map keyed by each side's `_id` (fallback to `'a'` / `'b'`) using the assignment selected in 2.4.
- [x] 2.10 Build the `notes[]` array: asymmetric lifestyle observations (quiet, cooking, petFriendly), each side's non-empty `extras.note`, parser warnings. Stable order: lifestyle → free-text → warnings.
- [x] 2.11 Set `verdict` to `'unfit'` if any blocker is present, else `'fit'`. Set `reason` to a human-readable summary (mirroring `decide()`'s pattern).
- [x] 2.12 Export `pairFitForProperty` from `src/decisionLogic.js`.

## 3. Tests — parsers

- [x] 3.1 `parseMoveInDate`: accepts ISO date, "Aug 2026", "1 Aug 2026". Rejects "", null, undefined, "immediate", "ASAP", "flexible". Numeric-noise tolerance ("on 2026-08-01" still parses).
- [x] 3.2 `parseLeaseMonths`: "12 months"→12, "1 year"→12, "12mo"→12, "半年"→6, "一年"→12, "6+6"→12. Rejects "", "flexible".

## 4. Tests — `pairFitForProperty`

- [x] 4.1 Fixture: build the Normanton Park 1M+2C @ S$4,500 property and the three customers (Wei, Arjun, Mei) from the design's worked trace.
- [x] 4.2 Wei × Arjun → `score === 100`, `verdict === 'fit'`, `blockers === []`, `perPersonRent` assigns both to common at S$1,350.
- [x] 4.3 Wei × Mei → `verdict === 'fit'`, `perPersonRent` assigns Wei to common (S$1,350) and Mei to master (S$1,800). Score reflects the budget-pass (both have a valid room).
- [x] 4.4 Variant A: Wei with `moveIn === '2026-06-01'` × Mei → `blockers` includes `'movein_too_far'`, `verdict === 'unfit'`.
- [x] 4.5 Variant B: Arjun with `leaseLength === '12 months'` × Mei with `leaseLength === '6 months'` → `blockers` includes `'lease_mismatch'`.
- [x] 4.6 Variant C: any customer with `wantRoommate: false` → `blockers` includes `'consent_missing'`.
- [x] 4.7 Variant D: a customer with `budget.max === 1000` (cannot afford even the common at S$1,350 even with soft margin) → `blockers` includes `'budget_unaffordable'`.
- [x] 4.8 Sentinel-null cases: same object reference → null. Same `_id` → null. Either `groupSize > 1` → null.
- [x] 4.9 Lease equality via different strings ("12 months" vs "1 year") → no `lease_mismatch`, both parse to 12.
- [x] 4.10 Lease unparseable on one side ("flexible") → no blocker, soft + note.
- [x] 4.11 Asymmetric quiet preference → score unchanged from matching-quiet case; `notes` contains an entry mentioning the asymmetry.
- [x] 4.12 Free-text `extras.note` on Wei (e.g. "Prefer non-smoker") → `notes` includes a prefixed entry.
- [x] 4.13 Property with `commonCount === 0` and both sides only afford common → `budget_unaffordable` blocker (no common rooms to assign).
- [x] 4.14 Property with `masterCount === 1` and both sides only afford master → exactly one feasible assignment ruled out (can't both take the single master); `budget_unaffordable` blocker.

## 5. Verification

- [x] 5.1 `npm test` passes — existing 60 tests still pass; new tests pass. *88/88 (was 60; +28 new).*
- [x] 5.2 `npm run build` passes with no new warnings.
- [x] 5.3 `openspec validate add-cohort-pair-fit --strict` passes.
