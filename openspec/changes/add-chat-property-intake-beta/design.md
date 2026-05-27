## Context

The current Add Property screen (`src/components/AddProperty.jsx`) is a 916-line form with several specialised cards: PG URL extractor, editable Property Details, image grid, walk-through video picker, poster generator. The flow assumes the operator has time to fill fields. In practice the dominant input format is a **WhatsApp message blob from an agent**: unstructured prose mixing the condo name, rent, room type, availability dates, and often a PropertyGuru link plus a few image / video attachments. Today the operator reads that message, parses it by eye, and types each piece into the matching field. That manual triage is exactly what a chat-with-Gemini surface removes.

The team wants to A/B a chat alternative for beta. The conversational surface should accept any input the operator pastes or uploads, ask follow-ups when something is missing, and produce the **same** draft shape the form does, so we keep one save path (`properties:add`) and one set of downstream features (extraction, recommend, listings).

The relevant Convex actions already exist:
- `extraction.extractPropertyGuruUrl` lifts fields + image URLs from a PG listing
- `extraction.fetchImagesAsData` server-side fetches images (PG CDN is not CORS-friendly)
- `ai.generatePosterContent` calls Gemini Vision to write the poster brief
- `properties.add` / `properties.generateUploadUrl` / `properties.setVideo` persist
- The Gemini SDK in use (`@google/genai` ^0.7.0) supports function declarations in `generateContent({ config: { tools: [{ functionDeclarations }] } })` and exposes `response.functionCalls`

So the work is mostly orchestration + UI, not new capability.

## Goals / Non-Goals

**Goals:**
- A new `/add/chat` route that accepts the same kinds of input the form does (text, PG URL, images, video, PDF poster) but as chat messages.
- Gemini function calling: the model decides which tool(s) to call per turn from a typed declaration list. Frontend executes each call and feeds the result back.
- Same end state as the form — a `properties` row plus uploaded blobs. Same save path. Same downstream features (extraction, recommend, listings) work without modification.
- Always-confirm save: the model can call `requestSaveConfirmation` but never writes directly; the operator clicks a real "Save property" button on a preview card.
- Beta isolation: nav item gated on `VITE_ENABLE_CHAT_INTAKE`. Refresh-safe via `sessionStorage`; no Convex schema additions.

**Non-Goals:**
- Replacing the form. The form stays at `/add` and remains the default.
- Persistent chat history, cross-device transcripts, or shareable conversation URLs.
- Streaming the model's text reply token-by-token in the UI. Beta is fine with each Gemini turn arriving as one chunk.
- Mobile-optimized chat. Desktop-first; basic responsiveness is enough.
- Auto-save. Every save is operator-confirmed.

## Decisions

### 1. Agentic loop: Gemini is the planner, not a classifier
**Choice:** Build a true agent loop. Each iteration: (a) the Convex action `chat.turn` sends the full transcript + the current draft snapshot + the tool declarations to Gemini, (b) Gemini decides what to do next — call zero or more tools, or produce a final assistant message — and returns its plan, (c) the frontend executes the planned tool calls, appends the tool results to the transcript, and (d) re-invokes `chat.turn` for the next agent step. The loop terminates when Gemini's response contains no further tool calls. The agent owns the control flow: it can decide to extract a URL before asking a clarifying question, ask the operator first and extract later, or skip extraction entirely if the WhatsApp prose already contains every required field.

This is structurally different from intent classification — the model is not picking one branch from a menu, it's planning a multi-step sequence and observing each result before deciding the next step.

**Alternatives considered:**
- *Single-shot extraction (no loop)*: Gemini parses the message once, returns a flat field map, UI applies it. Misses the agent's power — the model can't react to a failed PG extraction by asking the operator for the rent manually; it just dumps what it could parse.
- *Free-form text + regex/heuristics + a `classifyIntent` model call*: brittle and doubles the round-trip. Function calling is the native, well-tested path.
- *A single mega-action `chat.process` that runs all tools server-side*: forces every tool's effect (e.g., creating object URLs for uploaded images) into Convex, which can't do client-side things. Splitting the loop between server (one Gemini call per agent step) and client (tool dispatch + state) keeps each layer doing what it's good at.

**Rationale:** The user is explicit that they want "an agentic AI that performs the function decision". The model owns the plan-act-observe-replan cycle; the portal is the execution environment. Function calling is the Gemini-native way to express that.

### 2. Reuse `useAddPropertyDraft` as the canonical draft shape
**Choice:** The chat builds the same draft object the form uses (`condo`, `images: File[]`, `videoFile`, `posterFile`, `extracted` field map). The save button on the preview card runs the same upload+`properties:add` sequence the form's `handleSubmit` runs. The chat screen *imports* `useAddPropertyDraft` from `App.jsx`.

**Alternatives considered:**
- *A separate `useChatDraft` hook*: would diverge over time and force us to maintain two save paths.
- *Snapshot-only at save time*: the operator can't inspect the live draft in the preview card; we lose the "what does it know so far" UX win.

**Rationale:** One draft shape, one save path, zero risk that a chat-saved property looks structurally different from a form-saved one downstream.

### 3. Tool surface kept narrow for the beta (six tools)
**Choice:** Initial tools exposed to Gemini:
- `setCondo(name: string)` — set the condo / building name
- `setDetail(key: string, value: string | number)` — set any of the optional detail fields (rentSGD, area, buildingType, housingType, ageYears, unitType, sizeSqft, bedrooms, bathrooms, furnishing, availability, fullAddress, listingTitle, commuteNUS/NTU/SMU)
- `extractFromPropertyGuruUrl(url: string)` — wraps `extraction.extractPropertyGuruUrl`; on success, applies the lifted fields to the draft + queues attached image URLs
- `attachImageUrls(urls: string[])` — wraps `extraction.fetchImagesAsData`; uploads results to Convex storage via `properties.generateUploadUrl`
- `generatePoster()` — wraps `ai.generatePosterContent` + the in-browser PDF renderer (`src/poster/generate.jsx`)
- `requestSaveConfirmation()` — renders the preview card; this tool returns "awaiting operator confirmation" and ends Gemini's loop until the operator clicks Save

**Alternatives considered:**
- *Add `removeDetail`, `clearDraft`, `attachVideo` from URL*: defer to v2; the beta operator can edit manually if Gemini gets it wrong.
- *Expose `properties.add` directly to Gemini*: violates the always-confirm decision.

**Rationale:** Six tools cover the form's hot paths. Anything missing the operator can do by hand on the preview card before clicking Save (every detail field is editable inline there).

### 4. Multimodal inputs come through the message, not the tool
**Choice:** When the operator attaches images or a video to a chat message, the frontend uploads them to a temporary spot (object URLs for preview + draft state), then sends Gemini a synthetic user message: *"User attached 3 images: building exterior, living room, kitchen (jpeg, 1.2 MB, 800 KB, 1.1 MB)."* Gemini reasons over the textual description; the actual bytes never leave the browser until save. For images, we can optionally also send Gemini downsampled inline `image/jpeg` parts so it can describe what's in them — same pattern as `ai:generatePosterContent`.

**Alternatives considered:**
- *Pure text descriptions of attachments*: cheaper, but Gemini can't say "the first image looks like the lobby" — loses a useful confirmation signal.
- *Stream binary into the function call*: function-call args are JSON strings; binary doesn't belong there.

**Rationale:** Matches the existing `ai:generatePosterContent` precedent. We already know inline image parts at ~1024px are within budget.

### 4a. WhatsApp message blobs are first-class input

**Choice:** The system prompt explicitly trains Gemini on the WhatsApp-forward shape: emoji-laden prose, condo name on a line of its own, rent prefixed with `$` or `SGD`, sometimes a bare PG URL on a separate line, availability phrases like "1 Jul ready". Examples in the system prompt show how to map common phrases to `setDetail` calls. The composer's placeholder text says *"Paste a WhatsApp message, drop a PG link, attach photos…"* so operators know that's the intended workflow.

**Rationale:** This is the dominant intake format. Without prompt-level training, Gemini will likely under-call tools on long prose blobs.

### 5. Tool dispatcher lives in the frontend; Gemini calls happen server-side
**Choice:** The Convex action `chat.turn` only talks to Gemini — it doesn't run tools. It returns the tool call list to the browser, the browser dispatches each one (some calls fire other Convex actions, some mutate React state), and the browser feeds tool results back into the next `chat.turn` call.

**Rationale:** Tools like `attachImageUrls` need access to the browser's `URL.createObjectURL`, the in-memory draft, and the user's session. Pushing tool dispatch server-side would mean re-uploading the operator's local files just so the server could decide. The client-side dispatcher is the obvious fit.

### 6. Session-only persistence via `sessionStorage`
**Choice:** The message log + minimal draft references are JSON-serialised to `sessionStorage` on every state change. `File` objects (images, video, poster) can't be serialised — they live in memory only and are dropped on refresh. The operator gets a small "session ended (refresh dropped attached files)" notice if the log restores without its blobs.

**Rationale:** Matches the user's "session-only for beta" answer. No Convex schema burden. The day we promote chat out of beta is the day we add a `chatSessions` table.

### 7. Save is always one button click after `requestSaveConfirmation`
**Choice:** When Gemini calls `requestSaveConfirmation`, the loop pauses and the frontend renders a Preview Card showing every field, all attached media, and a green "Save property" button. The operator can still edit any field inline. Clicking Save runs the same `handleSubmit` the form uses. Cancelling re-enters the chat with a synthetic "operator cancelled save, asked to keep editing" message so Gemini knows the state.

**Rationale:** Captures the user's "always confirm" answer concretely and lets us reuse the form's save path verbatim.

## Risks / Trade-offs

- **Gemini hallucinates a field value** → mitigation: the preview card is always shown before save; every field is editable; the operator sees what was captured.
- **Gemini hits `MAX_TOKENS` mid-tool-call** → mitigation: `maxOutputTokens: 8192` for the chat turn (function-call JSON is verbose). Surface `finishReason` from `parseGeminiJson` so the UI can render a "model truncated, ask it again" toast.
- **Tool-dispatcher loop doesn't terminate** → mitigation: cap at 8 model turns per user message; show a "model kept calling tools, paused — type something to continue" message.
- **Operator pastes a PG URL inside a longer message** → Gemini decides whether to call `extractFromPropertyGuruUrl` itself based on the system prompt; we don't pre-parse URLs in the frontend.
- **Cost overrun** → mitigation: `VITE_ENABLE_CHAT_INTAKE=false` removes the nav item without a redeploy; operators fall back to the form.
- **Two intake surfaces drift apart** → mitigation: both use `useAddPropertyDraft` and the same save path. Any field accepted by the form is accepted by chat (and vice versa).
- **`sessionStorage` quota** → 5 MB per origin in most browsers; the log is JSON text only (no blobs), well within budget.

## Migration Plan

- Beta phase: ship behind `VITE_ENABLE_CHAT_INTAKE`. The form remains the default at `/add`; the chat is added at `/add/chat`. No data migration.
- Promotion criteria (out of scope for this change, captured for clarity): once chat handles ≥ 80% of intake without falling back to the form, propose a separate change to make chat the default and tuck the form behind a "form view" toggle.
- Rollback: flip the env var off. No schema rollback needed.

## Open Questions

- Should the preview card render the Gemini-suggested poster brief inline as a section the operator can edit, or wait for an explicit `generatePoster` tool call?
- Do we want Gemini to be able to call `setDetail` for `commuteMins.*` directly, or should we keep that field math-derived from the PG extractor only?
- Long-term: do we want the operator to be able to "fork" a chat into a property (e.g., the same conversation captures three units and produces three properties)?
