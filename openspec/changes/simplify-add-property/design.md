## Context

`hommies-portal-go-live` shipped the live portal: Convex backend, sidebar UI, Gemini-assisted poster prompt, decision engine. Add Property is a faithful port of the v2 design with the full 15-field form. In practice the admin types most of those fields by guessing — the same facts come back, in polished form, on the poster `/room-showcase-pdf` produces a moment later. This change collapses Add Property to its real intent (capture the WhatsApp forward — a name and some photos), lets the poster do the heavy lifting, and lifts the structured details back out of the PDF.

Constraints, confirmed with the owner:
- Strip the detail fields from Add Property — area, building, age, room type, rent, full address, commute. They'll be **extracted later from the Claude-generated PDF**, not retyped.
- Gemini stays **prompt-only** — it doesn't analyse the uploaded images. (Less spend; the actual photo intelligence happens inside the `/room-showcase-pdf` skill chat.)
- Cards live on **Listings** — each property card surfaces the asset collection (images + poster + extracted facts). No new screen, no new table.
- Build on the live `hommies-portal-go-live` state; supersede only what's listed here.

## Goals / Non-Goals

**Goals:**
- Add Property is a tiny form: condo name + multi-image dropzone + the Gemini prompt button + the poster upload. End of form.
- Uploading a poster triggers a Convex action that lifts the property's detail fields out of the PDF text and patches the record.
- Listings cards render each property as a collection of assets — image gallery, poster, and the lifted detail facts (with graceful "—" placeholders).
- The Recommend engine and Status screen continue to work unchanged; properties with extracted details participate in matching, properties without are hidden from the Recommend picker until extraction populates the required fields.

**Non-Goals:**
- Inline editing of extracted facts (admin re-attaches a corrected poster instead).
- Gemini-vision extraction of the poster (text-based extraction first; vision is a future change if needed).
- A new property-detail screen — Listings is the asset view.
- Changes to Status, Recommend, or the decision engine beyond a small "hide undetailed properties from the picker" guard.

## Decisions

### 1. Image uploads go to Convex file storage, kept as an array on the property
Each uploaded image is PUT to a Convex upload URL and recorded on the property as `images: [{storageId, name, size, contentType}]`. The frontend resolves a served URL per image on demand for rendering (same pattern as the poster). **Why:** Convex file storage already handles blobs, the URL never rots, and the array shape lets the gallery iterate naturally. **Alternative considered:** a separate `assets` table joined by property id — rejected, the array is simpler for the v1 asset-on-card view and the owner asked for cards on Listings, not a new screen.

### 2. Schema detail fields become optional, no data migration
`condo` (and `images` once added) is the only required entry path; `area`, `buildingType`, `housingType`, `ageYears`, `unitType`, `rentSGD`, `fullAddress`, `commuteMins` are made optional. Existing properties from `hommies-portal-go-live` still satisfy the schema (they have values); new properties may omit them until extraction fills them in. **Why:** backward-compatible, no migration step, no data loss.

### 3. Gemini Vision generates the brief from the photos
`generatePosterPrompt` accepts `{condo, images}` where each image carries inline base64 bytes (the client encodes the picked Files in the browser before the call). The action sends the images to Gemini's multimodal model so the brief is informed by what is *visible* in the photos — room type, layout cues, condition, view, building era — and weaves those observations into the brief. The brief still asks for the canonical labeled "Facts" block on the poster so text-based extraction can lift the values back later. A separate **Copy prompt** button on the card surfaces the generated brief independently of the Generate button. **Why:** the previous "prompt-only" decision left Gemini blind to the photos and the brief leaned heavily on Claude's skill to do all the seeing — running Vision in the prompt step produces a noticeably more specific brief; the explicit Copy button matches the design's affordance and keeps Generate / Copy as distinct intents.

Inline base64 payloads are capped at ~14 MB per request (well under Convex's 16 MB limit); if the user picks images that exceed that the action is called without inline data and the static template fills the gap. **Alternative considered:** server-side fetch of images from Convex file storage instead of inline base64 — rejected for v1 because the prompt step runs *before* the property is saved, so the images aren't in Convex storage yet.

### 4. Poster attach triggers extraction via a dedicated Convex action
On poster upload the client orchestrates two calls: `properties:setPoster` (persists the storage id, advances lifecycle as today), then `extraction:extractPosterDetails({id})` (reads the PDF blob, parses, patches the property). The reactive Convex queries re-render the UI when the patch lands. **Why:** explicit and visible; a small client orchestration is simpler than wiring the mutation through `ctx.scheduler` and easier to surface errors for.

### 5. Text-based PDF extraction with `pdf-parse`
The extraction action runs `'use node'` and uses `pdf-parse` (npm) to extract the poster's raw text. A small set of regex matchers — `Monthly rent: S\$([\d,]+)`, `Area:\s*(.+)`, `Building type:\s*(Condo|HDB)`, `Age:\s*(\d+)\s*year`, `Room type:\s*(.+)`, `Housing type:\s*(.+)`, `NUS\s*(\d+)` etc — pull each field if present. Any field that doesn't match is simply left absent. The raw extracted text and an `ok` flag are stored on the property (`posterExtractionRaw`, `posterExtractedAt`) for debugging without exposing the parser internals to the UI. **Why:** Claude's `/room-showcase-pdf` output is generated from a brief we control; we can ask for an explicit labeled block. **Alternative considered:** Gemini Vision over the PDF rasterised — more robust but costlier and AI-dependent; deferred.

### 6. Listings cards become the asset view
Each card now renders:
- A hero image (first uploaded image) with a small thumbnail strip below for the rest
- A photo count badge
- The four extracted facts (room type / area / building / age) in the existing facts grid — each cell shows "—" when the field is absent
- The poster status pill (with a link to the served poster URL when present) and the dispatch pill

No new route, no new table. **Why:** matches the owner's "record the cards on listing by appending from the poster details" framing.

### 7. Recommend hides undetailed properties from the picker
The Recommend screen's property picker filters to properties where the required engine fields are present (`rentSGD`, `housingType`, `commuteMins`). A small footnote explains why a property may be missing ("waiting for poster extraction"). The decision engine itself is unchanged. **Why:** keeps the engine deterministic with no special-casing for undefined inputs, and gives the admin a clear "I see why it's not matchable" signal.

## Risks / Trade-offs

- **Extraction depends on Claude's poster including the labeled text block** → The brief Gemini writes explicitly asks for it, and Claude follows the brief faithfully when the skill is the user's own `/room-showcase-pdf`. If a generated poster is missing labels, the property simply lands with empty detail fields and the admin can edit-then-reattach; nothing breaks.
- **PDF parsers vary in fidelity** → `pdf-parse` handles most posters generated by Claude's PDF tooling (text layer present). If a future poster variant rasters its text, extraction will silently produce empty fields — the raw text is captured for debugging and a Vision-based extractor is the planned upgrade path.
- **No in-portal edit for extracted fields (v1)** → If extraction is wrong, the admin re-attaches a corrected poster. This is acceptable for a single-admin workflow; a follow-up change can add inline-edit on Listings if the gap proves real.
- **Recommend picker silently hiding properties** → The footnote spells out the rule so the admin understands the omission isn't a bug.
- **Image upload count and size** → Convex file storage handles each blob fine; we cap at 12 images per property in the UI (soft limit) and accept any reasonable size; the brief mentions only the filenames so payload size to Gemini stays small.

## Migration Plan

In-place. No data migration step: making detail fields optional is backward-compatible, and existing properties already have those fields populated. The `images: []` array defaults to empty for old rows (interpreted as "no per-image upload yet — see `media.photos` for the prior shape if anything's there"). The old `media.{photos, links, videos}` fields are no longer written by Add Property but stay in the schema so old rows render. Rollback: revert the change; existing data keeps working.

## Open Questions

- The exact labeled-text format Claude's `/room-showcase-pdf` emits today — to verify against a real generated poster on first run and tune the regexes if needed.
- Per-image kind/role (hero vs detail vs floorplan) — left ungrouped for v1; can be added later if extraction or the UI grows a use for it.
