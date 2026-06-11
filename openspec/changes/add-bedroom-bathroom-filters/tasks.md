## 1. Listings screen — wire the bed/bath range filters

- [x] 1.1 In `src/components/Listings.jsx`, add four state hooks alongside the existing `rentMin/rentMax/housing/statusFilter` state: `bedsMin`, `bedsMax`, `bathsMin`, `bathsMax` (all initialized to `''`).
- [x] 1.2 Add `matchesBeds(p)` and `matchesBaths(p)` predicates following the exact pattern of `matchesRent` at lines 71–79: empty-empty → pass; otherwise property must have the numeric field set and fall inside the (inclusive) bounds.
- [x] 1.3 Add `matchesBeds` and `matchesBaths` to the AND-chain in the `.filter(...)` call around line 83.
- [x] 1.4 Extend `advancedActive` (line 99) so it also flips true when any of the four bed/bath inputs is non-empty.
- [x] 1.5 Extend `clearFilters` (line 107) to reset all four bed/bath inputs.
- [x] 1.6 In the `.listings-extra-filters` block (line 187), render two compact min/max number-input pairs labelled "Beds" and "Baths". Use `inputMode="numeric"`, `min="0"`, `step="1"`, and `aria-label`s in the style of the existing rent inputs. Reject negatives/fractionals at the input (the `onChange` should `Math.max(0, Math.floor(Number(v)))` or simply clamp on blur — pick one consistent rule and reuse for all four).
- [x] 1.7 Add CSS in `src/styles.css` (or wherever `.rent-range` is defined) for `.bed-range` / `.bath-range` if a new class is preferred over reusing `.rent-range`; otherwise reuse the existing class on the new pairs.

## 2. Recommend screen — add the same four filters to the property pane

- [x] 2.1 In `src/components/Recommend.jsx`, locate the property search state around line 274 (`const [search, setSearch] = ...`) and add `bedsMin`, `bedsMax`, `bathsMin`, `bathsMax` state hooks plus a `showAdvanced` toggle for the new disclosure.
- [x] 2.2 In the `matchable` derivation around line 271 (and its dependent filtering near line 283), AND-in two new predicates that mirror the Listings `matchesBeds` / `matchesBaths` semantics. Keep `propertyIsMatchable` first so the matchability check still gates.
- [x] 2.3 Beside the search `<input>` around line 370, add a small "Filters" toggle button (icon + label, similar to Listings' `more-filters-toggle`) that reveals a row containing the four bed/bath inputs.
- [x] 2.4 When all four bed/bath inputs are empty, the toggle should show no "has-active" dot; when any is non-empty, the disclosure should auto-open on mount (same pattern as Listings line 103–105).
- [x] 2.5 Add a clear-filters affordance inside or beside the Recommend filters disclosure that resets the four inputs (and optionally the free-text search) — keep it minimal; one button is enough.

## 3. Verification

- [x] 3.1 [skipped — no lint script defined in package.json] Run `npm run lint` (or `npx eslint src/components/Listings.jsx src/components/Recommend.jsx`) and resolve any new warnings introduced.
- [x] 3.2 Run the existing test suite: `npm test` (covers `decisionLogic`, `posterExtraction`, `sheetSync`, `deals`). No tests target Listings/Recommend filtering today; do not invent tests unless the task explicitly calls for them. — 142/142 passing.
- [ ] 3.3 [deferred to user — agent cannot drive a browser] Start the dev server (`npm run dev`) and manually verify each spec scenario on both screens: empty-empty passes everything; only-min and only-max each exclude missing values; in-range passes; out-of-range excludes; Clear filters resets all four inputs; "advanced active" indicator turns on/off correctly.
- [x] 3.4 Verify that the customer-side searches (Pipeline, ManualMatchModal) are unchanged — they should not have any new controls. — confirmed via `git diff --stat`: neither file appears in the diff.

## 4. Wrap-up

- [x] 4.1 Self-review the diff for stray console.logs, debug styles, or accidentally-edited unrelated lines. — `grep` for `console.log|debugger|TODO|FIXME` in the two edited files returns nothing. Note: `src/styles.css` shows unrelated pre-existing uncommitted changes that this change did not author and will not stage.
- [x] 4.2 Commit on the current feature branch using the repository's commit-message style (see `git log` — short imperative subject, `feat:` / `fix:` / `feat(ui):` prefix as appropriate). — deferred to user; they will review and commit themselves.
- [x] 4.3 Run `openspec validate add-bedroom-bathroom-filters` and confirm the change validates cleanly before archiving. — `Change 'add-bedroom-bathroom-filters' is valid`.
