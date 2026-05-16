## 1. Convex backend setup

- [x] 1.1 Add the `convex` dependency and scaffold the `convex/` directory
- [x] 1.2 Define `convex/schema.ts` — `properties` and `responses` tables on the live data model, with `status` constrained to `data_received` | `poster_attached` | `sent`
- [ ] 1.3 Run `npx convex dev` to provision and link the deployment, writing `VITE_CONVEX_URL` to `.env.local` (owner runs the one-time interactive login)
- [x] 1.4 Wrap the React app in `ConvexProvider` wired to `VITE_CONVEX_URL`

## 2. Convex data functions

- [x] 2.1 `convex/properties.ts` — `list` query plus `add`, `update`, `advanceStatus`, `setPoster`, and `remove` mutations
- [x] 2.2 `convex/responses.ts` — `list` query plus `add`, `addMany`, and `remove` mutations
- [x] 2.3 Poster PDF file storage — a `generateUploadUrl` mutation and a served-URL resolver so the poster lives in Convex file storage referenced by `posterStorageId` / `posterName` / `posterSize`

## 3. Match decision engine (logic core)

- [x] 3.1 Rewrite `decisionLogic.js` — six weighted factors (Budget 30, School 22, Commute 20, Housing 12, Layout 9, Building 7) producing a 0–100 score and a per-factor `criteria` entry with a `pass` / `soft` / `fail` level and a detail string
- [x] 3.2 Implement the verdict — send threshold 58, hard blockers (`over_budget`, `housing_mismatch`, `commute_too_far`), stacked-blocker and below-threshold holds, each with a plain-language reason
- [x] 3.3 Implement `recommendRecipients(property, responses)` — ranked `send` and `hold` buckets with every response in exactly one
- [x] 3.4 Implement `draftMessage(response, property, decision)` — bilingual EN / 中 outreach draft that names the property and rent, states the commute, surfaces soft caveats honestly, and keeps the "we are not agents" framing
- [x] 3.5 Implement `parseGoogleFormCSV(text)` — tolerant bilingual (中 / EN) header detection normalising into the response data model
- [x] 3.6 Rewrite the logic-core unit tests for the new model, criteria levels, threshold 58, blocker types, bucket ranking, and CSV parsing

## 4. AI poster prompt

- [x] 4.1 Implement `buildPosterPrompt(property)` — the deterministic static-template brief (starts with `/room-showcase-pdf`, brand rules, four mandatory facts, A4 single page)
- [x] 4.2 Implement the `convex/ai.ts` `generatePosterPrompt` action — call Gemini with a brand-constrained system prompt built from the property's details and return the generated brief
- [x] 4.3 Fall back to `buildPosterPrompt` on Gemini error, timeout, or missing key; return a `source` flag (`gemini` | `template`)
- [ ] 4.4 Set `GEMINI_API_KEY` as a Convex environment variable (owner runs `npx convex env set GEMINI_API_KEY …`); verified the key never enters the client bundle

## 5. Design system & shared UI

- [x] 5.1 Load Fraunces + Inter and rebuild `theme.js` / CSS custom properties with the design's full token set (orange, navy + variants, cream, green, grey, hairline, ink levels, danger, radii, card shadow)
- [x] 5.2 Port `styles.css` from the handoff design — sidebar, cards, form grid, segments, chip inputs, stage stats, status table, tracks, bucket tabs, match cards, listings grid, prompt card
- [x] 5.3 Port the shared primitives — `Icon`, `Pill`, `Field`, `Segment`, `ChipInput`, `StageTrack`, `StatusPill`, `Toast`

## 6. App shell

- [x] 6.1 Build the navy sidebar shell — brand mark + wordmark, numbered four-step workflow nav with live counts, "we are not agents" footer
- [x] 6.2 Build the main column with the footer strip and `Toast`; default to Add Property; nav switches screens

## 7. Screen 1 — Add Property

- [x] 7.1 Build the Property details, Commute, and Recorded media cards (building/housing-type segments, NUS/NTU/SMU commute fields, chip inputs for photos / links / videos)
- [x] 7.2 Build the Generate poster prompt card — calls the Gemini Convex action, shows summary chips, preview toggle, copy action, the prompt-source label, and the "fill the basics first" guard
- [x] 7.3 Build the Poster PDF upload card — upload the PDF to Convex file storage and store its reference on the property
- [x] 7.4 Save through the Convex `add` mutation with condo / area / rent validation; set status from poster presence; route to Status on save

## 8. Screen 2 — Status

- [x] 8.1 Build the three stage-stat cards counting properties at `data_received`, `poster_attached`, and `sent`
- [x] 8.2 Build the lifecycle table — property, room type, area, three-dot progress track, status pill, and a context action that advances / reopens via Convex mutations (also opens a file picker for `data_received` rows so an existing property can have its poster attached)

## 9. Screen 3 — Recommend

- [x] 9.1 Build the property picker list and the matching-against fact card
- [x] 9.2 Build the "we do not blast" principle, the Send / Don't-send bucket tabs with counts, and the match cards (rank, score, pass/soft/fail criteria chips, reason)
- [x] 9.3 Wire the bilingual draft reveal with a copy action on Send match cards
- [x] 9.4 Wire CSV import (`parseGoogleFormCSV` → Convex `addMany`) and the `ManualResponseModal` (→ Convex `add`)

## 10. Screen 4 — Listings

- [x] 10.1 Build the listings grid of property cards — the four facts (room type, building type, area, age) plus rent, poster status, and dispatch pill
- [x] 10.2 Add the All / Condo / HDB filter chips with counts

## 11. Remove the prototype

- [x] 11.1 Delete `src/store.js`, `src/seedData.js`, `src/formSchema.js` (and its test), and remove the `fake-indexeddb` dev dependency and its test setup
- [x] 11.2 Remove the old top-bar `App` and v1 components, and confirm no v1 data-model field names remain (`name` / `roomType` / `rentPerMonth` / `buildingAgeYears` / the status object / `media.videoUrl`)

## 12. Verification

- [x] 12.1 Run the logic-core unit test suite and confirm it passes (22/22)
- [ ] 12.2 Run `npx convex dev` and confirm the schema deploys and the queries, mutations, and action register (owner action — interactive login required)
- [ ] 12.3 Walk the end-to-end workflow against the live deployment — add a property, generate the Gemini prompt and force the template fallback, upload a poster, import responses, recommend, mark sent, view in Listings (owner action — requires the live Convex deployment from 1.3)
- [x] 12.4 Run the production build and confirm it succeeds with no `GEMINI_API_KEY` and no `store.js` / `localStorage` / `IndexedDB` reference in the client bundle
