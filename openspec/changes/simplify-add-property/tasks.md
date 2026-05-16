## 1. Schema & data model

- [x] 1.1 In `convex/schema.ts`, mark `area`, `buildingType`, `housingType`, `ageYears`, `unitType`, `rentSGD`, `fullAddress`, and `commuteMins` as `v.optional(...)` on the `properties` table
- [x] 1.2 Add `images: v.optional(v.array(v.object({ storageId, name, size, contentType })))` to the `properties` table
- [x] 1.3 Add extraction metadata: `posterExtractedAt: v.optional(v.number())` and `posterExtractionRaw: v.optional(v.string())` (also `posterExtractionOk`)
- [x] 1.4 Run `npx convex dev --once` and confirm the schema deploys without breaking existing rows

## 2. Convex functions for images

- [x] 2.1 Extend `convex/properties.ts` — `add` mutation accepts `{condo, images?}` with all detail fields optional
- [x] 2.2 Add `attachImages({id, images})` and `removeImage({id, storageId})` mutations
- [x] 2.3 Wire image uploads to reuse the existing `generateUploadUrl` flow (no new upload endpoint)
- [x] 2.4 Extend the `list`/`get` queries to resolve a served URL per entry in `images` alongside the existing `posterUrl`

## 3. Gemini prompt action — simplified payload

- [x] 3.1 Shrink `ai:generatePosterPrompt` arg to `{condo, images: [{name}]}` and update the action's `propertyArg` validator
- [x] 3.2 Update `convex/posterPrompt.ts` `buildPosterPrompt` (the static fallback) to take the same simpler payload and produce a brief that names the property, lists the image filenames, asks Claude to derive physical details from the photos, and demands the explicit labeled text block (Monthly rent, Area, Building type, Housing type, Age, Room type, NUS/NTU/SMU commute) so extraction can lift them
- [x] 3.3 Update the Gemini system instruction in `convex/ai.ts` to mirror the new structure

## 4. Poster detail extraction

- [x] 4.1 Add the `pdf-parse` npm dependency
- [x] 4.2 Create `convex/extraction.ts` with `extractPosterDetails({id})` — a `'use node'` action that loads the poster blob from storage, extracts text via `pdf-parse`, and parses it with `parsePosterText` (regex-based, in `convex/posterExtraction.ts`)
- [x] 4.3 Patch the property with whatever fields parsed; leave unparsed fields absent (never overwrite an existing value with `undefined`)
- [x] 4.4 Store `posterExtractedAt`, `posterExtractionRaw`, and `posterExtractionOk` regardless of outcome so failures can be diagnosed
- [x] 4.5 Unit-test the regex parser against a representative poster text sample (each labeled field hit, each missed cleanly) — **6/6 passing**

> Implementation note: `pdf-parse` v2 wraps pdfjs-dist, which references DOM globals (`DOMMatrix`, `ImageData`, `Path2D`) at module load. Convex's V8 analyzer rejects that statically. Fixed by installing minimal global stubs and **dynamically importing** `pdf-parse` inside the handler — the bundler ships the lib, the analyzer never evaluates it, and at run time the stubs are in place.

## 5. Add Property — strip to name + images

- [x] 5.1 Rewrite `src/components/AddProperty.jsx` — name input, multi-file image dropzone (with thumbnail previews, remove buttons, soft 12-image cap), and Save
- [x] 5.2 Wire Save: per image, request `generateUploadUrl`, PUT the file, collect `{storageId, name, size, contentType}`; then call `properties:add({condo, images})`
- [x] 5.3 Keep the `PosterPromptCard` and the Poster PDF upload card below the form; payload shrunk to `{condo, images: [{name}]}`
- [x] 5.4 On poster upload, after `properties:setPoster`, call `extraction:extractPosterDetails({id})` — wired in both `AddProperty.jsx` (poster attached on create) and `Status.jsx` (poster attached on an existing property)
- [x] 5.5 Remove from this screen: every detail field (area, building/housing type, age, room type, rent, full address, commute), the photo-filename chip input, and the listing-link / video chip inputs

## 6. Listings — asset-card view

- [x] 6.1 Rebuild the listing card in `src/components/Listings.jsx` with a hero image (first uploaded image), a thumbnail strip, and the photo count badge
- [x] 6.2 Render the four extracted facts (room type, building type, area, age) — show "—" gracefully when absent
- [x] 6.3 Add a "Poster ready" affordance that opens or downloads the stored poster URL when present
- [x] 6.4 Keep the rent line and the dispatch / status pill on the card

## 7. Recommend — hide undetailed properties

- [x] 7.1 Filter the property picker to entries where `rentSGD`, `housingType`, and `commuteMins` are all present
- [x] 7.2 Show a one-line note when any property is hidden ("N properties are waiting on poster extraction")

## 8. Verification

- [x] 8.1 `npx vitest run` — confirm logic-core tests still pass after schema/Gemini-payload changes (28/28 — `decisionLogic` + `posterExtraction`)
- [x] 8.2 `npx convex dev --once` — schema, the new mutations, and the extraction action deploy cleanly; 16 functions registered including `extraction:extractPosterDetails`, `properties:attachImages`, `properties:removeImage`
- [ ] 8.3 `npx convex run extraction:extractPosterDetails` against a real attached poster — confirm fields lift correctly (owner action — DB is empty; first real upload exercises this)
- [x] 8.4 `npm run build` — production build succeeds (258 KB JS / 20 KB CSS); confirmed the client bundle holds no `GEMINI_API_KEY`, no `AIzaSy…` key prefix, and no `pdf-parse` / `pdfParse` reference (extraction is server-side only)
- [ ] 8.5 Browser walk: add a property (name + 3 images) → generate prompt → paste into a Claude `/room-showcase-pdf` chat → upload returned PDF → confirm Listings card now shows the extracted facts and the image gallery (owner action — needs the live deployment + the Claude skill chat)

## 9. Gemini Vision + distinct Copy button (follow-up tweak)

- [x] 9.1 Extend `ai:generatePosterPrompt` to accept inline image bytes (`{name, mimeType, dataB64}`) and call Gemini's multimodal model with those parts when present
- [x] 9.2 Rewrite the system instruction to ask Gemini to look at the photos, name what it observes, and derive the Facts values from those observations
- [x] 9.3 Browser-side base64-encode each picked image File in `PosterPromptCard` before calling the action; cap inline payload at ~14 MB with a graceful fallback
- [x] 9.4 Split the card's button into distinct **Re-generate** and **Copy prompt** actions; surface the prompt source (`Gemini Vision` vs `template (fallback)`) above the preview
- [x] 9.5 Update the `simplified-property-intake` spec and `design.md` decision #3 to reflect the Vision capability rather than the original "prompt-only" stance
