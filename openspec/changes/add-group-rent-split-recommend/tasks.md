## 1. Convex schema

- [x] 1.1 Add optional `masterCount: v.number()` and `commonCount: v.number()` to the `properties` table in `convex/schema.ts`
- [x] 1.2 Add optional `groupSize: v.number()` to the `responses` table in `convex/schema.ts`
- [ ] 1.3 Run `convex dev` once and confirm the new schema is accepted; verify existing rows continue to validate (all fields optional) — *requires the operator to run interactively*

## 2. Extraction (Gemini drafts master/common counts)

- [x] 2.1 Extend the system prompt in `convex/extraction.ts` to ask for `masterCount` and `commonCount` (omit when uncertain); update the JSON shape comment in the same prompt — *both poster and URL-extractor prompts updated*
- [x] 2.2 Extend `sanitiseGeminiFields` to accept non-negative integer values for the two new fields and drop anything else
- [x] 2.3 Ensure `extraction:extractPosterDetails` writes the new fields when present; existing rows without them keep working — *existing spread of sanitised fields into the update patch covers this once `properties.update` accepts the keys (task 3.1)*

## 3. Properties mutations

- [x] 3.1 Add `masterCount` and `commonCount` to the validator on `properties:create` (and any update mutation that accepts a partial in `convex/properties.ts`)
- [x] 3.2 Confirm the listing edit mutation accepts setting the fields back to undefined (clearing them) — *the existing update handler strips undefined keys before patching, so passing an undefined value is a no-op (preserves the stored value); the validator accepts it. Hard clearing (`null` sentinel) is out of scope for v1 — operator overrides with a new value instead.*

## 4. Rent-split helper + group-aware engine (`src/decisionLogic.js`)

- [x] 4.1 Add `splitRent(prop)` — pure function returning `{ master, common, perRoomAvg } | null` per the Option A formula in `specs/property-rent-split/spec.md`
- [x] 4.2 Add unit tests in `src/decisionLogic.test.js` covering all scenarios from the property-rent-split spec (1M+1C, 1M+2C, all-masters, all-commons, missing counts)
- [x] 4.3 In `decide()`, gate a new branch on the three-part condition (whole unit + counts present + groupSize > 1); when active, replace the rent input to budget scoring with the chosen room price (common if present, else master)
- [x] 4.4 Add an `over_layout` hard blocker when `groupSize > masterCount + commonCount`, modelled after the existing `over_budget` blocker (including user-facing reason text)
- [x] 4.5 Add tests in `src/decisionLogic.test.js` for the group-aware scoring scenarios in `specs/group-aware-recommend/spec.md` (group=3 fits common, solo path unchanged, missing counts fall back, over_layout blocker fires)
- [x] 4.6 Run `npm test` and confirm all decisionLogic tests pass with no regressions — *45/45 passing (34 decisionLogic + 11 posterExtraction)*

## 5. Operator UI — ListingEditModal

- [x] 5.1 In `src/components/ListingEditModal.jsx`, surface `masterCount` and `commonCount` as numeric inputs that appear ONLY when `housingType === "Whole Unit"`
- [x] 5.2 Pre-fill the inputs from any Gemini-drafted values on the loaded listing; allow operator to clear them — *prefilled via `property.masterCount/commonCount` in initial state; blank input = no change (see 3.2 note about hard clearing)*
- [x] 5.3 Save handler passes the new fields through to the update mutation

## 6. Operator UI — AddProperty (post-extraction confirmation)

- [x] 6.1 In `src/components/AddProperty.jsx`, after extraction returns, show the Gemini-drafted `masterCount` and `commonCount` (if present) in the post-extraction confirmation surface — *the existing "Lifted:" chip row at line 504 iterates every key in `extracted` and auto-renders the new fields as chips; only change needed was to add the two keys to the `SAVE_FIELDS` allowlist so they survive into properties:add*
- [x] 6.2 No new editable input on AddProperty itself — the operator confirms by saving and edits in ListingEditModal if needed (keeps AddProperty flow minimal)

## 7. Recommend card surface

- [x] 7.1 In `src/components/Recommend.jsx`, when a decision used the split path, render a one-line breakdown beneath the rent: `S${rent}/mo · S${master} master / S${common} common · per person` — *implemented as a separate meta line under the property name in `PropertyMatchCard`, sourcing values from `decision.groupContext.split`*
- [x] 7.2 Format numbers with thousands separators consistent with existing rent display — *new `formatSGD()` helper applied to both the unit rent and the split values*
- [x] 7.3 Decisions where the split path did not activate render unchanged

## 8. Response-side groupSize capture

- [x] 8.1 In `convex/sheetSync.ts`, add a column mapping for `groupSize` (header variants: "group size", "people", "组数"); parse to a positive integer or omit — *added `parseGroupSize()` with English/Chinese variants and "couple" → 2; also added `groupSize: v.optional(v.number())` to `convex/responses.ts`'s `responseFields` validator so addMany accepts the field from sheet sync*
- [x] 8.2 Coordinate with `add-chat-property-intake-beta`: confirm whether that change captures `groupSize` already; if not, add a follow-up task there (do NOT implement chat intake changes inside this change's scope) — *checked: that change is property-intake (operator inputs), not response/customer intake, so there is no overlap. No follow-up needed there. Customer-side `groupSize` comes from the Google Sheet (8.1) for now.*

## 9. Verification

- [x] 9.1 Run `npm test` end-to-end; all tests pass — *45/45 passing; `npm run build` also passes cleanly*
- [ ] 9.2 Local QA: create a whole-unit listing with 1M + 2C at S$4,300; create a response with groupSize=3 and budget S$1,000–1,500; verify the recommend engine matches and the card shows the split — *requires running `npm run dev` + `convex dev` against the live DB; operator to execute*
- [ ] 9.3 Local QA: increase the response groupSize to 4; verify the `over_layout` blocker fires and the listing is rejected — *covered by the new unit test ("over_layout: group of 4 on a 1M+2C unit") but operator should also visually verify the recommend card surface*
- [ ] 9.4 Local QA: leave counts unset on a different whole-unit listing; verify a group=3 response falls back to comparing full rent against budget (no regression) — *covered by the new unit test ("whole unit without master/common counts → group response falls back to full rent")*
- [x] 9.5 `openspec validate add-group-rent-split-recommend --strict` passes
