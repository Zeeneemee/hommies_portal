## Context

The portal exists as a working prototype: a Vite + React SPA with a framework-agnostic logic core, an IndexedDB `store.js`, seeded mock data, and a static poster-prompt template. The team then iterated the real design in Claude Design and exported the "Hommies Portal" handoff bundle — a navy-sidebar layout, Fraunces/Inter type, richer screens, and a richer `decision.js`.

This change takes the portal live. Three things change at once and they are coupled: the backend (Convex replacing IndexedDB), the AI step (Gemini replacing the static template), and the UI (rebuilt to the handoff design). All three sit on a shared data model, so they are best done as one coordinated change rather than three.

Constraints, confirmed with the owner:
- **Convex** is the backend — provisioned fresh in this change (`npx convex dev`).
- **Gemini** generates the `/room-showcase-pdf` prompt **server-side in a Convex action**, with the design's static template as the fallback.
- **No auth** in v1 — single-admin, ungated; access control is the privacy of the Convex deployment URL.
- Brand stays non-negotiable: orange `#fd6925`, navy `#041f60`, cream `#fff5ec`, "we are not agents" everywhere.

## Goals / Non-Goals

**Goals:**
- A live portal with no mock data — empty on first run, only real records ever shown.
- Convex as the system of record: typed schema, reactive reads, poster PDFs in Convex file storage.
- A Gemini-written poster brief that is genuinely tailored to each property, with a reliable fallback.
- The four screens and shell rebuilt to match "Hommies Portal" pixel-intent: sidebar, Fraunces/Inter, criteria chips, modal, fact cards.
- The logic core stays pure and Vitest-tested; Convex functions stay thin.

**Non-Goals:**
- Authentication or multi-user access control.
- Frontend static hosting/deployment (Convex hosts the backend; deploying the SPA is a follow-up).
- In-portal poster generation, PropertyGuru scraping, automated Line/Instagram sending — unchanged from v1 scope.

## Decisions

### 1. Convex as the backend, behind thin functions
A `convex/` directory holds `schema.ts` (tables `properties`, `responses`), `properties.ts` and `responses.ts` (queries + mutations), and `ai.ts` (the Gemini action). The React app uses Convex's reactive `useQuery`/`useMutation` hooks directly — the custom `window.useStore` subscription model and `store.js` are deleted. **Why:** Convex gives reactive reads, a typed schema, and file storage with almost no backend code; the prototype's `store.js` was always designed as a swap point. **Alternative considered:** a REST API on a separate server — rejected as far more infrastructure for a single-admin tool.

### 2. Poster PDFs in Convex file storage
The Add Property poster upload sends the PDF to Convex file storage via an upload URL; the property record stores `posterStorageId`, `posterName`, `posterSize`. The UI resolves a served URL on demand. **Why:** keeps the poster *with* the record (the v1 principle — no link rot) while staying within Convex. **Alternative considered:** base64 in a document field — rejected, documents are not meant for blob payloads.

### 3. Gemini runs in a Convex action, never the client
`ai.ts` exposes a `generatePosterPrompt` action: it takes a property id (or the form payload), calls Gemini with a system prompt that embeds the brand rules and the exact `/room-showcase-pdf` brief structure, and returns the generated prompt text. The `GEMINI_API_KEY` is a Convex environment variable. **Why:** actions can call external APIs and run npm packages; the key never reaches the browser. **Alternative considered:** client-side Gemini call — rejected, it exposes the key (and the owner chose the action approach).

### 4. Gemini with a deterministic template fallback
If the action errors, times out, or the key is unset, it returns the design's `buildPosterPrompt(form)` output instead, flagged as `source: 'template'`. The UI shows which path produced the prompt. **Why:** the Add Property workflow must never be blocked by an AI outage; the static template is already a correct, usable brief.

### 5. Adopt the handoff design's data model verbatim
Properties: `condo`, `buildingType`, `area`, `ageYears`, `unitType`, `rentSGD`, `housingType`, `fullAddress`, `commuteMins.{NUS,NTU,SMU}`, `media.{photos[],links[],videos[]}`, `posterStorageId/Name/Size`, and a single `status` enum — `data_received` → `poster_attached` → `sent`. Responses: `name`, `channel`, `contact`, `school`, `moveIn`, `leaseLength`, `budget.{min,max}`, `buildingType`, `housingType`, `unitLayout[]`, `commuteTolMins`, `wantRoommate`, `extras.{petFriendly,cookingAllowed,quiet,nearGym,note}`. **Why:** the design's screens, `decision.js`, and `store.js` are all written against this shape; matching it keeps the UI rebuild a port rather than a redesign. This replaces the v1 prototype's field names and its `{dataReceived,posterAttached,sent}` status object.

### 6. Adopt the handoff design's decision logic
`decisionLogic.js` is rewritten to match `decision.js`: weights 30/22/20/12/9/7, **send threshold 58**, budget soft overshoot of an absolute S$200, commute soft-over of 15 minutes, hard blockers `over_budget` / `housing_mismatch` / `commute_too_far`, and per-factor `criteria` entries each carrying a `pass` / `soft` / `fail` level plus a detail string. `recommendRecipients(property, responses)` returns ranked `send` and `hold` buckets; `draftMessage` returns the EN ──── ZH bilingual draft; `parseGoogleFormCSV` does tolerant bilingual header detection. **Why:** this is the logic the team validated in the design tool; the v1 engine's binary-only output and percentage-based thresholds are superseded.

### 7. Logic core stays pure and Vitest-tested
`decisionLogic.js` and the CSV parser keep zero React/Convex imports. Convex functions call into them or stay trivial. Unit tests are rewritten against the new model, criteria levels, threshold 58, and blocker types. **Why:** the matching logic is the heart of the product and must be testable without a backend or a browser.

### 8. UI rebuilt to the sidebar design
The shell becomes a navy left **sidebar** (brand mark, numbered workflow nav with counts, "we are not agents" footer) plus a main column with a footer strip and a `Toast`. Type system is **Fraunces** (display) + **Inter** (sans); `theme.js` / CSS custom properties adopt the design's full token set (navy-2/3, green, grey, hairline, ink/ink-soft/ink-mute, danger, radii, shadow). Shared primitives (`Icon`, `Pill`, `Field`, `Segment`, `ChipInput`, `StageTrack`, `StatusPill`, `Toast`) and the four screens are ported from the handoff `.jsx` files into the React app. **Why:** the handoff is the agreed design; the README's instruction is to recreate it faithfully in the target stack.

### 9. No mock data, real empty states
`seedData.js` and `seedIfEmpty` are deleted. The design already specifies empty states for every screen ("Nothing in the pipeline yet", "No properties yet", etc.) — those carry the first-run experience.

## Risks / Trade-offs

- **Convex provisioning needs an interactive `npx convex dev` login** → A dedicated setup task; the owner runs it once to create and link the deployment. Until then the app can't read/write — sequence the Convex setup before the UI wiring.
- **Gemini latency, cost, or outage blocks the poster step** → The action has a short timeout and always falls back to the static template; the card stays usable and labels which path ran.
- **Gemini may produce an off-brand or malformed brief** → The system prompt pins the brand rules, the four mandatory facts, the A4 format, and the exact section structure; the template fallback is the safety net; the admin reviews the prompt before pasting it anyway.
- **Data-model rename churn across every file** → Done as a clean rebuild to the design's shape, not incremental patching — old field names are removed wholesale so nothing half-migrated lingers.
- **No auth on a live backend** → Accepted by the owner for v1; the only control is keeping the Convex deployment URL private. Flagged for a v2 revisit.
- **CSV export format drift** → The bilingual header-substring parser is tolerant, and the `ManualResponseModal` is the always-available fallback for any row that won't parse.

## Migration Plan

Greenfield go-live — there is no real data to migrate (the prototype only held seed data). Steps, in order: add the `convex` dependency and `convex/` schema + functions; run `npx convex dev` to provision and link the deployment; set `GEMINI_API_KEY` as a Convex env var; rebuild the design system and shell; port the four screens onto Convex hooks; delete `store.js` and `seedData.js`; rewrite the logic core and its tests to the new model. Rollback is simply not deploying — the prototype remains in git history. There is no destructive data step.

## Open Questions

- Exact Gemini model id (assumed a current fast Gemini model) — to confirm against what the owner's key has access to.
- Frontend static hosting — out of scope here; to be picked up as a follow-up once the Convex-backed app is verified.
- Whether the bilingual Google Form CSV ever needs the v1 `formSchema.js` 13-field richness, or the design's leaner `parseGoogleFormCSV` is sufficient — proceeding with the design's parser, revisit if a real export breaks it.
