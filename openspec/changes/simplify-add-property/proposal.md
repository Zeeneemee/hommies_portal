## Why

Adding a property today is a 15-field form (condo, area, building/housing type, age, room type, rent, full address, NUS/NTU/SMU commute, photo filenames, listing links, video links, poster upload). For an admin glancing at a WhatsApp forward of a few photos and a name, that's an unwelcome speed bump — most of those values aren't in the forward and have to be guessed or copied from a listing site. The poster the admin then makes through `/room-showcase-pdf` already contains every one of those facts in a polished form. The portal should let the admin do the cheap visual step (drop the name and images in), generate the brief, attach the poster that comes back, and let the system lift the structured details from the poster itself.

## What Changes

- **Add Property is name + images only.** The current detail fields (area, building type, housing type, age, room type, rent, full address, commute) and the photo-filename / link / video chip inputs are removed from the screen.
- **Image uploads, not filenames.** The admin uploads actual image files; each image is stored as a blob in Convex file storage on the property record (replacing the prior "filenames in shared Drive" abstraction).
- **Gemini brief gets simpler.** The `ai:generatePosterPrompt` action's input shrinks to `{condo, images}`. The brief tells the `/room-showcase-pdf` skill what the property is called and which uploaded images to use; Gemini does not analyse the images (prompt-only, by choice).
- **Poster PDF triggers detail extraction.** When the admin attaches the poster PDF, a new Convex action reads the PDF text and lifts structured details — area, building type, housing type, age, room type, rent, NUS/NTU/SMU commute — back onto the property record. The lifecycle still advances to `poster_attached` whether or not every field is extracted.
- **Listings cards become the asset view.** Each Listings card renders the property as a **collection of assets**: an image gallery built from the uploaded photos, a poster preview/link, and the detail facts as they were lifted from the poster. Fields that the parser couldn't find show "—" gracefully rather than blocking the card.
- **Schema becomes tolerant.** Detail fields on `properties` are now optional so a name-and-images property is valid pre-extraction; `images: [{storageId, name, size, contentType}]` is added; extraction metadata (`posterExtractedAt`, `posterExtractionRaw`) is captured for debugging.

This change builds on the live state from `hommies-portal-go-live` (Convex + Gemini + the sidebar UI). The Recommend engine, Status screen lifecycle, and decision logic are unchanged — they keep reading the same field names; those fields just arrive via extraction instead of typing.

## Capabilities

### New Capabilities
- `simplified-property-intake`: the new Add Property flow — name + image uploads only — and the matching simpler payload for the Gemini `generatePosterPrompt` action and the Convex `properties:add` mutation.
- `poster-detail-extraction`: a Convex action that parses the uploaded poster PDF (text-based extraction) and patches the property record with the lifted detail fields, tolerantly skipping any field it can't find.
- `property-asset-cards`: Listings cards rebuilt as an asset view — image gallery + poster + extracted detail facts — gracefully degrading when fields are missing.

### Modified Capabilities
<!-- None recorded in openspec/specs/ — prior changes are unarchived, so this change declares its capabilities fresh and supersedes the relevant pieces of hommies-portal-go-live. -->

## Impact

- **New dependency: `pdf-parse`** (used in a `'use node'` Convex action) to extract text from the uploaded poster PDFs.
- **Schema changes** (`convex/schema.ts`): every detail field on `properties` becomes optional; `images: v.array(v.object({...}))` added; `posterExtractedAt: v.optional(v.number())` and `posterExtractionRaw: v.optional(v.string())` added. Existing rows stay valid.
- **`convex/properties.ts`**: `add` mutation's argument shape collapses to `{condo, images?}` (with detail fields optional for callers that still want to set them); new `attachImages` / `removeImage` mutations.
- **`convex/extraction.ts`** (new): the `extractPosterDetails({id})` action.
- **`convex/ai.ts`**: `generatePosterPrompt` input simplified to `{condo, images}`; the brief is updated to reference uploaded image filenames and to leave physical details for Claude's skill to fill from the photos.
- **UI**: `src/components/AddProperty.jsx` reduces to a small form with a multi-file image dropzone, the PosterPromptCard, and the Poster PDF upload; `src/components/Listings.jsx` is rebuilt as an asset view; `src/components/PosterPromptCard.jsx` payload trims.
- **Out of scope (this change)**: inline editing of extracted facts (admin re-runs extraction by re-attaching a corrected poster), Gemini-vision extraction of the poster (text-extraction first cut), Status-screen redesign, Recommend-screen changes — they keep working on the same field names.
