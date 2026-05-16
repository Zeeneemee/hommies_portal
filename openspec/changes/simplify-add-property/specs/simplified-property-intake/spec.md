## ADDED Requirements

### Requirement: Add Property is name + images only

The Add Property screen SHALL collect exactly two inputs from the admin — the property name (condo / HDB) and one or more uploaded image files — and SHALL NOT present fields for area, building type, housing type, age, room type, rent, full address, or commute.

#### Scenario: Property is saved from name and images alone

- **WHEN** the admin enters a condo name, uploads one or more images, and saves
- **THEN** the property is persisted with the name and the images, no other detail fields required

#### Scenario: Save is blocked without a name or images

- **WHEN** the admin attempts to save without a name or with no images attached
- **THEN** the save is blocked and the admin is told which input is missing

### Requirement: Images upload to Convex file storage

Each image attached on Add Property SHALL be uploaded to Convex file storage and recorded on the property as an entry in `images` with `{storageId, name, size, contentType}`; the UI SHALL resolve a served URL per image on demand for rendering.

#### Scenario: Uploaded image lives with the property record

- **WHEN** the admin uploads an image and saves the property
- **THEN** the image blob is stored in Convex file storage and the property record holds its storage reference, name, size, and content type

#### Scenario: Multiple images can be attached

- **WHEN** the admin attaches multiple images before saving
- **THEN** the property record holds them all in the `images` array

### Requirement: Gemini Vision generates the brief from the uploaded photos

The `ai:generatePosterPrompt` Convex action SHALL accept `{condo, images}` where each image carries its name, MIME type, and inline base64 bytes; the action SHALL pass those images to Gemini's multimodal Vision model so the brief is informed by what is *actually visible* in the photos (room type, layout cues, condition, view, building era, notable features). The brief MUST reference the property by name and the attached images, and MUST instruct the `/room-showcase-pdf` skill to emit a labeled "Facts" text block the portal can lift back.

#### Scenario: Brief is informed by what is visible in the photos

- **WHEN** the prompt is generated for a property with name and uploaded images
- **THEN** the action sends the image bytes to Gemini Vision and the returned brief is specific to what those photos show, with each derived value labelled as observed or estimated

#### Scenario: Brief asks for the labeled text block

- **WHEN** the prompt is generated
- **THEN** it instructs the poster to include labeled lines for at minimum Monthly rent, Area, Building type, Housing type, Age, Room type, and per-campus commute, so the portal can extract them back from the finished PDF

#### Scenario: Action returns the source so the UI can show how the brief was written

- **WHEN** the action returns a prompt
- **THEN** it includes a `source` of `gemini` (Vision succeeded) or `template` (fallback) and a human-readable note naming the model used or the failure cause
