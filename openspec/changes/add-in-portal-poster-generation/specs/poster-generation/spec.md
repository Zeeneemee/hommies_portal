## ADDED Requirements

### Requirement: In-portal poster generation entry point

The system SHALL expose a "Generate in-portal" action on the Status screen for each property that meets the eligibility criteria. The action SHALL be visible only when the property is generation-eligible.

A property is generation-eligible when ALL of the following are true:
- `rentSGD` is a positive number
- `housingType` is set
- `commuteMins` is set (all three of NUS / NTU / SMU present)
- `images.length >= 1`

#### Scenario: Eligible property shows the generate action
- **WHEN** the operator views a Status row whose property has rent, housingType, commuteMins, and ≥ 1 image
- **AND** the property has no `posterStorageId`
- **THEN** the row displays a "Generate poster in-portal" button

#### Scenario: Ineligible property hides the generate action
- **WHEN** the operator views a Status row whose property is missing any matchability field or has no images
- **THEN** the "Generate poster in-portal" button is not shown (or is shown disabled with a tooltip listing the missing fields)

#### Scenario: Existing poster swaps label to re-generate
- **WHEN** the property already has a `posterStorageId`
- **AND** the property is otherwise generation-eligible
- **THEN** the button label SHALL be "Re-generate in-portal" and clicking it replaces the existing poster

### Requirement: Gemini content generation

The system SHALL provide a Convex action `ai:generatePosterContent` that accepts a property identifier and returns structured poster content from Gemini.

The action SHALL:
- Load the property and its image URLs from Convex Storage.
- Send the images and a system prompt to Gemini Flash with thinking disabled.
- Return a JSON object with this exact shape:
  ```ts
  {
    ok: boolean,
    content: {
      headline: string,        // 4–7 words
      tagline: string,         // 8–15 words
      photoOrder: number[],    // indices into property.images, no duplicates, all in range
      accent: string,          // a key from theme.posterPalette
      vibeTags: string[],      // 2–4 short tags
    } | null,
    note?: string,             // error or diagnostic note when ok = false
  }
  ```
- Validate the returned `photoOrder` against `property.images.length`: drop out-of-range indices, drop duplicates, fall back to `[0, 1, …, n-1]` if validation removes everything.
- Validate `accent` against the allowed palette keys; fall back to the palette's default key on mismatch.

#### Scenario: Happy path content generation
- **WHEN** the operator triggers `ai:generatePosterContent` for an eligible property
- **THEN** Gemini is called with the property's images and facts
- **AND** the action returns `{ ok: true, content: { headline, tagline, photoOrder, accent, vibeTags } }`
- **AND** `photoOrder` is a permutation of a subset of `[0..images.length-1]`
- **AND** `accent` is a key from `theme.posterPalette`

#### Scenario: Gemini returns malformed JSON
- **WHEN** Gemini returns text that cannot be parsed as the expected schema
- **THEN** the action returns `{ ok: false, content: null, note: "<diagnostic>" }`
- **AND** the operator sees a toast surfacing the note

#### Scenario: Gemini returns out-of-range photo indices
- **WHEN** Gemini returns `photoOrder` containing indices outside `[0..images.length-1]` or duplicates
- **THEN** the action drops invalid indices before returning
- **AND** if no valid indices remain, the action falls back to `[0, 1, …, n-1]`

### Requirement: Poster layout component

The system SHALL render a `<Poster property content />` React component that produces a single-page A4 portrait layout using styles from `src/theme.js`. The component SHALL be a deterministic function of its props — given the same `property` and `content`, it renders the same DOM.

The layout SHALL include, at minimum:
- A hero region using the first image referenced by `content.photoOrder`
- The `content.headline` and `content.tagline`
- A "Property Facts" block listing: rent (formatted as S$X,XXX), area, building type, housing type, age (if present), and commute minutes to NUS / NTU / SMU
- A photo grid using the remaining indices in `content.photoOrder`, up to a maximum that fits the page
- A Hommies brand mark
- The `content.accent` color applied as the page accent

The component SHALL NOT depend on data that is not present in `property` or `content`. The component SHALL NOT make network requests during render.

#### Scenario: Component renders with all fields present
- **WHEN** `<Poster>` is mounted with a property containing all generation-eligible fields and `content` from a successful Gemini call
- **THEN** the rendered output contains the headline, tagline, all four facts, the brand mark, and at least one image

#### Scenario: Component handles a property with only the matchability fields
- **WHEN** `<Poster>` is mounted with a property where optional fields (ageYears, fullAddress, unitType) are absent
- **THEN** the rendered output omits the absent fields without leaving placeholder text or empty rows

### Requirement: Browser-side PDF rendering and attachment

The system SHALL render the `<Poster>` component to a PDF Blob in the operator's browser using `html2pdf.js`, then upload that Blob to Convex Storage via the existing `properties:generateUploadUrl` endpoint and attach it via the existing `properties:setPoster` mutation.

The rendering SHALL:
- Use A4 portrait orientation
- Use `html2canvas` scale of 2 for visual sharpness
- Output JPEG-encoded image data at quality 0.85 within the PDF to keep size under 1.5 MB for typical listings
- Set the PDF filename to `<condo>-poster.pdf` (slugified)

After successful attachment, the system SHALL invoke the existing `extraction:extractPosterDetails` action so the property's `posterExtractedAt` / `posterExtractionOk` fields update consistently with manual uploads.

#### Scenario: Successful generation and attachment
- **WHEN** the operator clicks "Generate poster in-portal" on an eligible property
- **AND** the Gemini content call succeeds
- **THEN** a PDF is generated client-side
- **AND** the PDF is uploaded to Convex Storage
- **AND** `properties:setPoster` is called with the new storageId
- **AND** `extraction:extractPosterDetails` runs immediately afterward
- **AND** the property's status advances from `data_received` to `poster_attached` if it was previously `data_received`

#### Scenario: PDF generation failure leaves property unchanged
- **WHEN** `html2pdf.js` throws during conversion
- **THEN** no upload occurs
- **AND** `properties:setPoster` is not called
- **AND** the operator sees a toast naming the failure
- **AND** the property record is unchanged

#### Scenario: Upload failure leaves property unchanged
- **WHEN** the Convex Storage upload returns a non-2xx response
- **THEN** `properties:setPoster` is not called
- **AND** the existing `posterStorageId` (if any) is unchanged
- **AND** the operator sees a toast surfacing the HTTP status

### Requirement: Coexistence with the existing Claude-skill upload flow

The system SHALL keep `PosterPromptCard` and the `ai:generatePosterPrompt` action available alongside the new in-portal flow for one release cycle. The manual "Attach poster PDF" upload on Status SHALL continue to function unchanged.

#### Scenario: Manual upload still works after this change
- **WHEN** the operator attaches a PDF via the existing Status upload action
- **THEN** the PDF is stored, `properties:setPoster` is called, and `extraction:extractPosterDetails` runs — exactly as before this change

#### Scenario: Generate-in-portal does not block manual upload
- **WHEN** a property has been generated in-portal once
- **THEN** the operator may still replace the poster by manually uploading a different PDF
- **AND** the existing `properties:setPoster` cleanup behavior (deleting the previous storage blob) applies
