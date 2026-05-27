## ADDED Requirements

### Requirement: Chat intake route exists alongside the form intake

The portal SHALL expose a new `/add/chat` route in addition to the existing `/add` form route. Both routes MUST produce the same `properties` row shape on save. The chat route SHALL be reachable from the sidebar with a "beta" pill when `VITE_ENABLE_CHAT_INTAKE` is truthy; when the flag is absent or false, the nav item MUST be hidden and the route MUST redirect to `/add`.

#### Scenario: Flag enabled

- **GIVEN** `VITE_ENABLE_CHAT_INTAKE === 'true'`
- **WHEN** the operator opens the portal
- **THEN** the sidebar shows an "Add Property (chat) · beta" item
- **AND** navigating to `/add/chat` renders the chat screen

#### Scenario: Flag disabled

- **GIVEN** `VITE_ENABLE_CHAT_INTAKE` is unset or `'false'`
- **WHEN** the operator visits `/add/chat` directly
- **THEN** the route redirects to `/add`
- **AND** the sidebar shows no chat nav item

### Requirement: Chat composer accepts text, PropertyGuru URLs, images, video, and PDF

The composer SHALL accept (a) plain text including pasted WhatsApp message blobs and PropertyGuru URLs, (b) one or more image attachments per message (JPEG, PNG, WebP), (c) at most one video attachment per message (MP4, MOV, WebM, ≤ 200 MB), (d) at most one PDF attachment per message. Submitting an empty message MUST be a no-op.

#### Scenario: Pasting a WhatsApp message blob

- **WHEN** the operator pastes a multi-line message like *"Lakeville studio 3.3k available 1 Jul. https://propertyguru.com.sg/listing/..."* and clicks Send
- **THEN** the message appears in the transcript and a `chat.turn` request fires with the operator's text in the user-role message

#### Scenario: Attaching mixed media in one message

- **WHEN** the operator attaches three JPEGs and one MP4, types "see attached", and clicks Send
- **THEN** the images and the video are stored in the chat draft (object URLs for preview)
- **AND** the message sent to Gemini includes a textual summary of each attachment ("user attached 3 images and 1 video: …") plus downsampled inline image parts

#### Scenario: Oversized video rejected

- **WHEN** the operator attaches a 250 MB video
- **THEN** the composer rejects the attachment with a toast and does NOT include it in the outgoing message

### Requirement: An agent loop drives every user message to completion

Each user message SHALL trigger an agent loop. One iteration of the loop is: (1) Convex action `chat.turn` is invoked with the current transcript, the current draft snapshot, and the tool declarations, (2) `chat.turn` calls Gemini and returns Gemini's planned action — zero or more function calls and an optional assistant text reply, (3) the frontend executes each function call against the draft / Convex actions, (4) each tool result is appended to the transcript as a `function`-role message, and (5) the loop re-invokes `chat.turn`. The loop MUST terminate when Gemini returns a turn with no function calls, OR when 8 iterations have completed for the same user message (runaway guard). The agent — not the frontend — decides whether the next step is a tool call, a clarifying question to the operator, or a save request.

#### Scenario: Gemini returns a tool call

- **WHEN** the user message contains a PG URL and Gemini decides to extract from it
- **THEN** the action's response includes a `functionCall` for `extractFromPropertyGuruUrl({ url })`
- **AND** the frontend executes `extraction.extractPropertyGuruUrl({ url })`, applies the lifted fields to the draft, and feeds the result back into the next `chat.turn` invocation

#### Scenario: Tool dispatch loop terminates

- **WHEN** Gemini's response contains no function calls
- **THEN** the loop ends and the latest assistant text is appended to the transcript
- **AND** the user's composer is re-enabled

#### Scenario: Runaway loop guard

- **GIVEN** Gemini has called tools 8 turns in a row without producing a final assistant message
- **THEN** the loop is forcibly stopped
- **AND** the transcript shows a system notice: "Model kept calling tools — paused. Send another message to continue."

### Requirement: Tool surface for the beta is exactly six tools

The Gemini function declarations exposed by `chat.turn` MUST include exactly these six tools, with the named parameter shapes:

- `setCondo(name: string)`
- `setDetail(key: string, value: string | number)` — where `key` is one of: `rentSGD`, `area`, `buildingType`, `housingType`, `ageYears`, `unitType`, `sizeSqft`, `bedrooms`, `bathrooms`, `furnishing`, `availability`, `fullAddress`, `listingTitle`, `commuteNUS`, `commuteNTU`, `commuteSMU`
- `extractFromPropertyGuruUrl(url: string)`
- `attachImageUrls(urls: string[])`
- `generatePoster()`
- `requestSaveConfirmation()`

The frontend dispatcher SHALL map each tool to the existing portal action (or draft mutation) as defined in the design document.

#### Scenario: Unknown tool name

- **WHEN** Gemini returns a function call with a name not in the six-tool list
- **THEN** the dispatcher returns `{ ok: false, error: "unknown tool: <name>" }` to Gemini
- **AND** does NOT silently ignore the call

#### Scenario: setDetail with an unsupported key

- **WHEN** Gemini calls `setDetail({ key: "balconySize", value: 5 })`
- **THEN** the dispatcher returns `{ ok: false, error: "unsupported detail key: balconySize" }`
- **AND** no draft mutation occurs

### Requirement: Save requires explicit operator confirmation

When Gemini calls `requestSaveConfirmation()`, the frontend SHALL render a Preview Card showing every captured field, every attached image (with thumbnails), and the attached video / poster filenames. The card MUST include a "Save property" button and a "Keep editing" button. No `properties:add` mutation MAY fire from a tool call — only from the operator's explicit click on "Save property".

#### Scenario: Operator confirms save

- **WHEN** the operator clicks "Save property" on the preview card
- **THEN** the same upload-and-add sequence used by the form screen runs (image uploads, video upload, poster upload, `properties:add`)
- **AND** the chat session ends with a success message and navigates to `/status`

#### Scenario: Operator cancels save

- **WHEN** the operator clicks "Keep editing" on the preview card
- **THEN** the preview card disappears and the composer is re-enabled
- **AND** a synthetic user message ("operator wants to keep editing") is appended to the transcript so Gemini knows the state on the next turn

### Requirement: Transcript persists in sessionStorage only

The chat transcript and the textual draft state SHALL be JSON-serialised to `sessionStorage` on every state change. `File` blobs (images, video, poster) MUST NOT be serialised — they live only in React state. On a refresh, the transcript MUST be restored but the file attachments MUST be dropped, and the operator MUST see a one-time notice that attached files were cleared.

#### Scenario: Refresh mid-conversation

- **GIVEN** the operator has sent two messages and attached one image
- **WHEN** they refresh the page
- **THEN** the two messages are restored
- **AND** the image is gone
- **AND** a notice reads: "Session restored. Attached files were dropped on refresh — please re-attach."

#### Scenario: New session in a new tab

- **WHEN** the operator opens a second portal tab and visits `/add/chat`
- **THEN** the new tab starts with an empty transcript (sessionStorage is per-tab)

### Requirement: Chat-saved properties are indistinguishable from form-saved properties

A property saved via the chat route SHALL have the same field schema, the same `status` lifecycle (`data_received` → `poster_attached` → `sent`), and the same downstream behavior in the Status, Recommend, Listings, and Customers screens as a property saved via the form route.

#### Scenario: Downstream parity

- **GIVEN** two properties — one saved via `/add` and one via `/add/chat` — both with identical inputs
- **THEN** the resulting `properties` rows are field-by-field equivalent except for `_id` and `createdAt`

### Requirement: WhatsApp message blobs are first-class input

The system prompt sent to Gemini in `chat.turn` SHALL include explicit examples of WhatsApp message shapes (emoji-laden prose, rent prefixed with `$` or `SGD`, bare PG URLs on their own lines, availability phrases like "1 Jul ready") and SHALL instruct Gemini to call the appropriate tools rather than echoing the message back as prose.

#### Scenario: WhatsApp blob produces tool calls

- **WHEN** the operator pastes "Lakeville studio 3.3k available 1 Jul, near MRT https://propertyguru.com.sg/listing/12345"
- **THEN** Gemini calls at minimum `setCondo("Lakeville")`, `setDetail("rentSGD", 3300)`, `setDetail("availability", "1 Jul")`, and `extractFromPropertyGuruUrl("https://propertyguru.com.sg/listing/12345")` across one or more turns
- **AND** the operator's preview card shows those fields populated
