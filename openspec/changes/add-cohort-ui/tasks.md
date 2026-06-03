## 1. Recommend.jsx — wiring

- [x] 1.1 Add `assembleCohort` to the import from `../decisionLogic.js`. *(src/components/Recommend.jsx:9)*
- [x] 1.2 In `ByPropertyView`, add `const [cohortResult, setCohortResult] = React.useState(null)` next to the existing `selectedId` / `expanded` state. *(line 260)*
- [x] 1.3 Add a reset `useEffect(() => { setCohortResult(null) }, [selectedId])` so navigating between properties clears stale suggestions. *(line 261)*

## 2. Property summary card — button section

- [x] 2.1 Below the existing four-`Fact` row in the property summary card, render a button section gated on `prop.housingType === 'Whole Unit' && typeof prop.masterCount === 'number' && typeof prop.commonCount === 'number' && (prop.masterCount + prop.commonCount) > 0`.
- [x] 2.2 Inline copy reading "Whole unit · {M}M + {C}C — fill it by matching {target} compatible solo customers as housemates." next to the button.
- [x] 2.3 Button labelled "Suggest cohort" with a check icon. `onClick` calls `setCohortResult(assembleCohort(prop, responses))`. *(line 396–398)*
- [x] 2.4 Section separated from the facts above by `border-top: 1px solid var(--hairline)`.

## 3. `CohortResultCard` component

- [x] 3.1 Add a new function component `CohortResultCard({ result, property, onDismiss })` in `Recommend.jsx`. *(line 837)*
- [x] 3.2 Failure branch (`!result.cohort`): renders a card with `border-left: 3px solid var(--warn)`, header "No cohort suggestion", body looking up `COHORT_REASON_COPY[result.reason]` with the `"Assembly failed: ${reason}."` fallback, and a × dismiss button calling `onDismiss`.
- [x] 3.3 Success branch (`result.cohort` truthy): renders a card with `border-left: 3px solid var(--navy)`. Header shows "Suggested cohort · {N} of {target}" and "Cohort fit {cohortScore}/100 · rents conserve to S${formatSGD(property.rentSGD)}/mo".
- [x] 3.4 Member rows: one per cohort member in a cream-background pill. Left side name + meta (school · budget range · lease). Right side rent + room kind. Use `formatSGD` for currency.
- [x] 3.5 Pair-fits line: render scores joined by " · " under the member rows.
- [x] 3.6 Notes list: bulleted `<ul>` of `result.notes`.
- [x] 3.7 × dismiss button on the success card calls `onDismiss`.

## 4. `COHORT_REASON_COPY` map

- [x] 4.1 Add a static module-scope const `COHORT_REASON_COPY` in `Recommend.jsx` containing the six documented failure reasons and their operator-facing strings. *(line 828)*

## 5. Wire result rendering

- [x] 5.1 In `ByPropertyView`, after the property summary card and before the `AssignmentSection` blocks, render `{cohortResult && prop && <CohortResultCard ... />}`. *(line 405–411)*

## 6. Verification

- [x] 6.1 `npm test` — existing 119 tests still pass.
- [x] 6.2 `npm run build` — clean build, no new warnings.
- [x] 6.3 `openspec validate add-cohort-ui --strict` passes.
- [ ] 6.4 Manual smoke (operator runs `npm run dev` and visits `/recommend`): button visibility per gate, click renders card, switch property clears, dismiss closes, failure copy renders. *Requires the operator to drive the browser.*
