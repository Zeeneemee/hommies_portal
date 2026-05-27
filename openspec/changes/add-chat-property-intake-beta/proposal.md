## Why

The existing Add Property screen is a long form: condo input, a PropertyGuru URL extractor card, an editable Property Details card, an image grid, a video picker, and a poster generator section. Real intake is messier than this — most often it's a **WhatsApp message blob** the operator received from an agent: unstructured prose mixing the condo name, rent, room type, availability, and sometimes a PG link, sometimes a few photo attachments. Today the operator manually parses that message and routes each piece into the right form field. A conversational interface where the operator pastes the whole WhatsApp message (and attaches whatever photos / video came with it) and Gemini decides what to do with it would match the way work actually arrives.

For beta we want a parallel route — operators can still use the form, but pick the chat screen when they want to test the new flow. Side-by-side comparison tells us whether chat actually beats the form before we replace anything.

## What Changes

- Add a new `/add/chat` route alongside `/add`, accessible from the sidebar with a "beta" pill. Same destination on save (Status screen). Same Convex mutations (`properties:add`, `properties:generateUploadUrl`, `extraction:extractPropertyGuruUrl`, etc.).
- Build a chat UI: message list + composer with attachments (images, video, PDF, plain text, PropertyGuru URLs). Operator and the agent take turns.
- Introduce a true **agentic loop**: Gemini is the planner. Each turn the agent looks at the transcript + the current draft state, decides what to do next (call a tool, ask the operator a question, or request save confirmation), and the loop continues until the agent decides it's done. This is not intent classification — Gemini owns the control flow.
- Add a new Convex action `chat:turn` that runs one step of the agent loop: it sends the conversation history + tool declarations to Gemini and returns Gemini's planned tool calls (and any text reply) for the frontend to execute. The frontend feeds results back and re-invokes `chat.turn` for the next agent step.
- Define the initial tool set the agent can call: `setCondo`, `setDetail`, `extractFromPropertyGuruUrl`, `attachImageUrls`, `generatePoster`, `requestSaveConfirmation`. The frontend dispatches each tool call against the existing draft + Convex actions, returns the result to the agent, and the loop continues until the agent stops calling tools (or hits the per-message step cap).
- Persist the chat **session-only** (React state + `sessionStorage`) for beta. No Convex schema changes for chat history; refresh clears the transcript.
- Saving always goes through an explicit "Save property" button on the preview card produced by `requestSaveConfirmation`. Gemini never writes directly; it builds a draft that the operator confirms.
- New environment variable hook: `VITE_ENABLE_CHAT_INTAKE` gates the beta nav item so we can flip it off without a deploy if Gemini starts running away with the budget.

## Capabilities

### New Capabilities
- `chat-property-intake`: conversational property intake driven by an **agentic** Gemini loop. The agent plans, calls tools, observes results, and iterates until it has enough to request save confirmation. Builds the same draft shape as the form-based Add Property, saves via the same Convex mutation, and stays alongside the form (not a replacement) for the beta period.

### Modified Capabilities
<!-- No `openspec/specs/` directory exists yet in this project; nothing to modify. -->

## Impact

- New Convex action: `convex/chat.ts` with `chat.turn` (the Gemini orchestration loop) — wraps existing actions (`extraction:extractPropertyGuruUrl`, `ai:generatePosterContent`, `extraction:fetchImagesAsData`) so the chat tool dispatcher calls them through one surface.
- New frontend route: `src/components/AddPropertyChat.jsx` (new), added to `App.jsx` routes + `NAV` array.
- Reuses `useAddPropertyDraft` from `App.jsx` — the chat screen and the form screen both build the same draft object so saving stays consistent. Adds a separate `useChatSession` hook for the message log + sessionStorage backing.
- No schema change. No new mutations. Saving uses existing `properties:add` and `properties:generateUploadUrl`.
- New env var: `GEMINI_CHAT_MODEL` (server-side Convex action; defaults to `gemini-2.5-flash`).
- New env var: `VITE_ENABLE_CHAT_INTAKE` (client-side feature flag for the nav item).
- Out of scope for this beta: persistent chat history, multi-turn streaming UI, voice input, mobile-optimized layout (desktop-first is fine for beta).
