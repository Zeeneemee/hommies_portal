## 1. Project setup & scaffolding

- [x] 1.1 Scaffold a Vite + React single-page app, with a dev script and a production build script
- [x] 1.2 Set up a unit test runner (e.g. Vitest) for the framework-agnostic logic core
- [x] 1.3 Create the directory layout: logic core modules at the root of `src/`, `components/` for the four screens, and a place for seed data

## 2. Brand system

- [x] 2.1 Create `theme.js` with the brand colour tokens — orange `#FD6925`, navy `#041F60`, cream `#FFF5EC` — copied verbatim from the `room-showcase-pdf` skill
- [x] 2.2 Add the background-removed Hommies.sg logo asset and a base layout style using the cream background

## 3. Logic core — form parsing (`formSchema.js`)

- [x] 3.1 Implement `formSchema.js` to parse the 13 bilingual Google Form fields into one clean record (name, channel, contact, school, moveIn, leaseLength, budget {min,max}, buildingType, housingType, unitLayout[], commuteTolMins, wantRoommate, extras {flags, note})
- [x] 3.2 Match columns by recognised 中/EN header text (not position); normalize 中 and EN values to the same field values; map unrecognised schools to OTHER
- [x] 3.3 Parse budget into a numeric `{min, max}` range, unit layout into a list, and degrade unstructured extras into `extras.note`
- [x] 3.4 Write unit tests covering bilingual values, budget ranges, multi-select layouts, OTHER-school fallback, and free-text extras

## 4. Logic core — decision engine (`decisionLogic.js`)

- [x] 4.1 Implement the weighted six-factor score (Budget 30, School 22, Commute 20, Housing type 12, Unit layout 9, Building type 7) returning a 0–100 number
- [x] 4.2 Implement the per-pair verdict function: binary Send / Don't send plus a human-readable reason
- [x] 4.3 Implement hard blockers — over-budget and Room vs Whole-Unit mismatch cap the verdict at Don't send; also yield Don't send on two-or-more stacked mismatches or weak overall fit
- [x] 4.4 Implement `recommendRecipients()` — run a full response database against one property, split into a ranked Send list (ordered by score) and an explained Hold list, with every response in exactly one list
- [x] 4.5 Implement the warm, family-first bilingual (中/EN) message draft per Send recipient, varying by preferred channel (Line/Instagram)
- [x] 4.6 Write unit tests for each weight, every hard blocker, the stacked-mismatch path, Send-list ranking, and the no-recipient-dropped guarantee

## 5. Persistence layer & data model (`store.js`)

- [x] 5.1 Define the Property and FormResponse data shapes per the design doc
- [x] 5.2 Implement `store.js` over IndexedDB exposing an async CRUD API for properties and responses, including poster PDF blob storage
- [x] 5.3 Add seed data for properties and responses for local development
- [x] 5.4 Confirm no UI module references `localStorage`/`IndexedDB`/a network client directly — all access goes through `store.js`

## 6. Form intake — CSV importer & manual entry

- [x] 6.1 Build the CSV importer component: upload a Google Form CSV export, parse every row via `formSchema.js`, and save the response records through `store.js`
- [x] 6.2 Build the manual single-response entry form producing the same 13-field record, marked as manually sourced

## 7. Screen 1 — Add Property

- [x] 7.1 Build the Add Property form: name, area, building type, building age, room type, rent — with required-core-field validation
- [x] 7.2 Record property media — photos, links (PropertyGuru), and room-tour video URL — against the record
- [x] 7.3 Add poster PDF file upload that rejects non-PDF files and stores the PDF with the property record
- [x] 7.4 Initialize the property status to Data received on save, and advance to Poster attached when a poster is uploaded

## 8. Screen 3 — Recommend

- [x] 8.1 Build the Recommend screen: pick a property, run `recommendRecipients()` against the stored responses
- [x] 8.2 Render the ranked Send list and the explained Hold list, showing every Hold entry's reason
- [x] 8.3 Show the drafted bilingual message for each Send recipient, reviewable before manual sending
- [x] 8.4 Ensure the UI shows only the binary Send / Don't send verdict — never STRONG/MEDIUM/WEAK grades

## 9. Screen 2 — Status

- [x] 9.1 Build the Status screen listing every property as a row on the Data received → Poster attached → Sent track
- [x] 9.2 Add the action to mark a property as Sent, advancing and persisting its status through `store.js`

## 10. Screen 4 — Listings

- [x] 10.1 Build the card-based Listings inventory, each card showing the four facts — room type, location/area, Condo/HDB, building age
- [x] 10.2 Add filters by property facts (room type, area, building type), with a clear-filters action
- [x] 10.3 Show poster-attached and sent status on each card

## 11. App shell, navigation & brand pass

- [x] 11.1 Assemble the SPA shell with the fixed four-screen navigation in workflow order (Add Property → Status → Recommend → Listings), defaulting to Add Property on open
- [x] 11.2 Do a brand pass across all four screens — orange/navy/cream palette, Hommies logo, warm family-first tone, no corporate styling
- [x] 11.3 Confirm the portal runs fully offline against locally persisted data

## 12. Verification

- [x] 12.1 Run the full logic-core unit test suite and confirm it passes
- [x] 12.2 Walk the end-to-end workflow: add a property → attach a poster → import responses → recommend → mark sent → view in Listings
- [x] 12.3 Run the production build and confirm it succeeds and the built bundle runs
