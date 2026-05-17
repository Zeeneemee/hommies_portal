## 1. Dependencies & theme

- [x] 1.1 Add `html2pdf.js` to `package.json` and lockfile
- [x] 1.2 Confirm `src/theme.js` exposes the colors and font families the poster needs; if a print-safe palette is missing, add `theme.posterPalette` as a small named-key map (e.g. `{ cream, navy, orange, ink }`) and a default key
- [x] 1.3 Add (or confirm presence of) a brand mark asset under `public/` suitable for embedding in the PDF (PNG, ~256px square)

## 2. Convex action: generatePosterContent

- [x] 2.1 In `convex/ai.ts`, add `generatePosterContent` action accepting `{ id: v.id('properties') }`
- [x] 2.2 Load the property record; refuse if it fails the matchability + image preconditions; refuse if `images` is missing
- [x] 2.3 Resolve image storage URLs via the existing `properties:get` query (do not re-implement the resolver)
- [x] 2.4 Build the Gemini system prompt: instruct the model to emit ONLY the JSON shape from the spec (headline / tagline / photoOrder / accent / vibeTags), with the allowed accent palette keys inlined into the prompt
- [x] 2.5 Call Gemini Flash with `responseMimeType: 'application/json'`, `thinkingConfig: { thinkingBudget: 0 }`, `temperature: 0.2`, image parts inlined from the resolved URLs
- [x] 2.6 Parse + validate the response: drop out-of-range / duplicate photo indices; fall back to `[0, 1, …, n-1]` if validation empties the array; coerce `accent` to the default palette key if unrecognized; cap `vibeTags` to 4 entries
- [x] 2.7 Return `{ ok, content, note }` matching the spec; cover the malformed-JSON path with a fenced-block fallback like `extraction:extractPosterDetails` does

## 3. React component: <Poster />

- [x] 3.1 Create `src/components/Poster.jsx` accepting `{ property, content }` props
- [x] 3.2 Define the A4-portrait container at fixed pixel dimensions (`794 × 1123` at 96 DPI) so `html2pdf` scales predictably
- [x] 3.3 Lay out hero, headline + tagline, four-facts block (rent, area, building type, housing type, age if present, commutes), photo grid, brand mark, accent strip
- [x] 3.4 Source all colors and fonts from `src/theme.js` (and the new `posterPalette` if added in 1.2)
- [x] 3.5 Handle the absent-optional-fields case (no age, no fullAddress, no unitType) by omitting rows entirely — never render placeholder dashes
- [x] 3.6 Render the component off-screen (visibility hidden or absolute-position outside viewport) when invoked for PDF generation

## 4. Generate-poster client flow

- [x] 4.1 Add a `generatePosterInPortal(propertyId)` helper module (e.g. `src/poster/generate.js`) that orchestrates: call `ai:generatePosterContent`, mount `<Poster>` to an off-screen container, run `html2pdf` with the configured options, return the Blob
- [x] 4.2 Wire the helper to call `properties:generateUploadUrl`, POST the Blob, then call `properties:setPoster` with the returned `storageId` + a slugified filename
- [x] 4.3 After successful attach, call `extraction:extractPosterDetails` (same as the manual-upload path)
- [x] 4.4 Always clean up the off-screen DOM node and revoke any object URLs created during rendering, even on error

## 5. Status screen UI

- [x] 5.1 In `src/components/Status.jsx`, add a "Generate poster in-portal" button on each row that meets the spec's eligibility test
- [x] 5.2 Use existing button styles (`btn btn-secondary` or equivalent) — do not introduce new visual primitives
- [x] 5.3 Disable the button + show a busy label (`Generating…`) while the flow runs; re-enable on completion or error
- [x] 5.4 Toast each outcome: success ("Poster generated for <condo>"), Gemini failure (uses note), PDF failure, upload failure
- [x] 5.5 When the property already has a `posterStorageId`, the button label SHALL be "Re-generate in-portal"; clicking it re-runs the flow and replaces the existing poster (existing `properties:setPoster` cleanup handles the previous blob)

## 6. Verification

- [x] 6.1 Run `npm test` (vitest) — no regressions in `posterExtraction.test.ts` or `decisionLogic.test.js`
- [x] 6.2 Run `npm run build` (vite) — bundle builds clean, `html2pdf.js` lazy-loaded if needed
- [ ] 6.3 Manual: generate a poster for at least 3 properties of different shapes (Room vs Whole Unit, with/without `ageYears`, 1 image vs many) — **operator verification required**
- [ ] 6.4 Manual: verify the manual upload path on Status still works untouched (coexist requirement) — **operator verification required**
- [ ] 6.5 Manual: verify `PosterPromptCard` on AddProperty still renders and still copies a brief (coexist requirement) — **operator verification required**
- [ ] 6.6 Manual: confirm the generated PDF is ≤ 1.5 MB for a typical listing with 6 images — **operator verification required**

## 7. Follow-ups (not in this change)

- [ ] 7.1 Open a follow-up change `remove-claude-poster-flow` after one release cycle to delete `PosterPromptCard`, `convex/ai.ts:generatePosterPrompt`, and the prompt block in AddProperty
- [ ] 7.2 Open a follow-up change `skip-extraction-for-self-generated-posters` to avoid the harmless-but-wasteful re-extraction noted in design.md risks
