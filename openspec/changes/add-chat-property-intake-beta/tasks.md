## 1. Convex action — agent loop step

- [ ] 1.1 Create `convex/chat.ts` with `'use node'` and a `turn` action whose args are `{ transcript: ChatMessage[], draft: DraftSnapshot, latestUserText?: string, inlineImages?: Array<{name: string, mimeType: string, dataB64: string}> }` and whose return shape is `{ ok: boolean, text?: string, functionCalls?: Array<{ name: string, args: Record<string, unknown> }>, finishReason?: string, note?: string }`.
- [ ] 1.2 Define the six tool declarations (`setCondo`, `setDetail`, `extractFromPropertyGuruUrl`, `attachImageUrls`, `generatePoster`, `requestSaveConfirmation`) using the `@google/genai` function-declaration shape (`name`, `description`, `parameters: { type: 'OBJECT', properties, required }`).
- [ ] 1.3 Write the system prompt: explain the agent's job (build a property record from messy operator input), describe the draft state shape Gemini sees, enumerate the six tools and *when* to call each, include 2-3 examples of WhatsApp message blobs with the expected tool call sequence, and emphasise that the operator must always confirm before save.
- [ ] 1.4 Wire the Gemini call: model = `process.env.GEMINI_CHAT_MODEL || 'gemini-2.5-flash'`, `temperature: 0.2`, `thinkingConfig: { thinkingBudget: 0 }`, `maxOutputTokens: 8192`, `tools: [{ functionDeclarations }]`, `toolConfig: { functionCallingConfig: { mode: 'AUTO' } }`. Surface `finishReason` from the response.
- [ ] 1.5 Convert the transcript into the SDK's `contents` shape — user messages as `{ role: 'user', parts: [{ text }] }`, assistant text as `{ role: 'model', parts: [{ text }] }`, tool results as `{ role: 'function', parts: [{ functionResponse: { name, response: { ok, ... } } }] }`. If `inlineImages` is provided, append them to the latest user message as `{ inlineData: { mimeType, data } }` parts.
- [ ] 1.6 Handle missing `GEMINI_API_KEY` and Gemini errors by returning `{ ok: false, note: '…' }` rather than throwing — the frontend renders the note as a system message.

## 2. Frontend — chat screen scaffolding

- [ ] 2.1 Add `VITE_ENABLE_CHAT_INTAKE` to `.env.example` (or equivalent) with a comment explaining the beta toggle.
- [ ] 2.2 In `src/App.jsx`, conditionally add a NAV entry `{ id: 'add-chat', to: '/add/chat', label: 'Add Property (chat) · beta', step: '★' }` when `import.meta.env.VITE_ENABLE_CHAT_INTAKE === 'true'`. Add a route mapping to a new `AddPropertyChat` component. If the flag is off and a user visits `/add/chat`, redirect to `/add`.
- [ ] 2.3 Create `src/components/AddPropertyChat.jsx` — top-level component. Imports `useAddPropertyDraft` from `App.jsx` (lift the hook to a shared spot if needed, or pass it via the `draft` prop the same way `AddProperty.jsx` receives it).
- [ ] 2.4 Build `useChatSession()` in the same file (or `src/chat/useChatSession.js`): React state for `messages: ChatMessage[]`, `pending: boolean`, `stepCount: number`. JSON-serialise to `sessionStorage` on every `messages` change. On mount, restore from `sessionStorage` and if any restored message references a `File` blob, mark it as "blob unavailable" and surface a one-time notice.

## 3. Frontend — agent loop dispatcher

- [ ] 3.1 Implement `runAgentTurn(userMessageOrToolResult)` in `AddPropertyChat.jsx`: appends the input to the transcript, calls the Convex `chat.turn` action, executes each returned function call via a dispatcher, and recursively calls itself with the tool result until `chat.turn` returns no function calls or `stepCount` hits 8.
- [ ] 3.2 Implement the tool dispatcher — a switch on `functionCall.name`:
  - `setCondo` → `draft.setCondo(args.name)`; returns `{ ok: true }`
  - `setDetail` → validates `args.key` against the allow-list, then `draft.setExtracted(prev => ({ ...prev, [args.key]: args.value }))`; returns `{ ok: true }` or `{ ok: false, error }`
  - `extractFromPropertyGuruUrl` → call `extraction.extractPropertyGuruUrl({ url })`, on success apply the lifted fields to `draft.extracted` and (if room) call `extraction.fetchImagesAsData` for the returned image URLs; returns `{ ok, lifted: keys[], imagesPulled: number }`
  - `attachImageUrls` → call `extraction.fetchImagesAsData({ urls })`, build `File` objects, push into `draft.images`; returns `{ ok, attached: number, skipped: number }`
  - `generatePoster` → mirror `AddProperty.jsx`'s `handleGeneratePoster` (resize, call `ai.generatePosterContent`, render via `poster/generate.jsx`, set `draft.posterFile`); returns `{ ok, filename, sizeKB }`
  - `requestSaveConfirmation` → set `showPreviewCard = true`; returns `{ ok: true, message: 'awaiting operator confirmation' }`; the loop ends naturally because Gemini's next turn typically has no further calls — but if it tries to call more tools, the dispatcher still runs them
- [ ] 3.3 Step-cap guard: when `stepCount >= 8` and Gemini still returned function calls, append a system message ("Model kept calling tools — paused. Send another message to continue.") and stop the loop.

## 4. Frontend — UI

- [ ] 4.1 Render the transcript as a vertical message list. Bubble styles: user messages on the right, assistant text on the left, function-role messages as a small neutral "ran extractFromPropertyGuruUrl → 8 fields lifted" line.
- [ ] 4.2 Composer at the bottom: textarea (multi-line, `Enter` to send, `Shift+Enter` for newline), a paperclip button opening a file picker (multiple images + optional video + optional PDF), a Send button. Disable Send while `pending`.
- [ ] 4.3 Attachment preview chips shown above the composer before send (filename + size, x to remove). Same type/size validation as `AddProperty.jsx` (200 MB video cap, image MIME check, PDF MIME check).
- [ ] 4.4 Live draft sidebar (right column): shows the current draft state (condo, every extracted field, image count, video filename, poster filename) updating reactively as tools fire. Lets the operator see what the agent has built so far without scrolling the transcript.
- [ ] 4.5 Preview card (renders when `showPreviewCard === true`): a card overlaying the chat with all fields editable inline, image thumbnails, and two buttons — "Save property" (primary) and "Keep editing" (ghost). Save runs the same upload+`properties:add` sequence as `AddProperty.jsx`. Cancel re-enters the chat with a synthetic user message "operator wants to keep editing".

## 5. Multimodal handling

- [ ] 5.1 When the operator attaches images to a composer message, downsample each (≤ 1024px JPEG, 0.82 quality, reusing `src/poster/encode.js`'s `resizeImageToJpeg` and `blobToBase64`) and include up to 4 of them as inline parts in the `chat.turn` call. Cite this image count in the synthetic user-message summary.
- [ ] 5.2 Video and PDF attachments do not stream to Gemini — they're recorded in the draft and described textually in the message ("user attached a 45 MB MP4 walk-through; not viewable to you, but it'll be uploaded on save").

## 6. Verification

- [ ] 6.1 Smoke test the happy path: paste a WhatsApp message with rent + condo + PG URL → confirm Gemini calls setCondo, setDetail, extractFromPropertyGuruUrl → confirm the draft sidebar populates → click Save on the preview card → confirm `properties` row exists with the expected fields.
- [ ] 6.2 Smoke test the no-PG-URL path: paste prose only ("Normanton Park 1BR rent 2800 ready July") → confirm Gemini calls setCondo + setDetail without invoking the extractor.
- [ ] 6.3 Smoke test the multimodal path: attach 3 images + a video + a brief text → confirm the inline images get described, the video gets recorded in the draft but not sent to Gemini, and save produces a row with all attachments.
- [ ] 6.4 Smoke test the runaway-loop guard: force a tool to return an error on every call (e.g. wrong key for setDetail) and verify the loop stops at step 8 with a clear system message.
- [ ] 6.5 Smoke test refresh persistence: send two messages, attach an image, refresh → confirm messages restore, the image is dropped, and the operator sees the "attached files cleared" notice.
- [ ] 6.6 Parity test: save one property via `/add` and one via `/add/chat` with identical inputs, then diff the resulting `properties` rows — they MUST be field-by-field equivalent except `_id` and `createdAt`.

## 7. Build + tests + docs

- [ ] 7.1 `npm run build` must pass without new warnings.
- [ ] 7.2 `npm run test` must still pass 33/33 (chat code is integration-tested manually for beta; no new unit tests required).
- [ ] 7.3 Document the beta toggle in the README or a short note in `convex/chat.ts`'s file header: how to enable `VITE_ENABLE_CHAT_INTAKE` locally, what `GEMINI_CHAT_MODEL` does, and the kill-switch story.
