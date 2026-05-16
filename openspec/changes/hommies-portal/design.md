## Context

Hommies.sg operations currently runs on WhatsApp forwards and eyeballed matching. This change builds the first internal tool: a single-admin, locally-run portal that turns each forward into a structured property record and applies consistent Send / Don't-send logic against Google Form responses.

Current state: empty repository with OpenSpec scaffolding only. The proposal describes `formSchema.js` and `decisionLogic.js` as "built", but no source exists yet — per the change owner, the logic core is built **within this change** to the spec described in the proposal.

Constraints:
- Single admin, runs offline on one laptop. No backend, no auth, no public deployment in v1.
- Brand is non-negotiable and must match the `room-showcase-pdf` skill verbatim (orange `#FD6925`, navy `#041F60`, cream `#FFF5EC`).
- Posters are produced outside the portal (Claude chat app); the portal only stores the finished PDF.
- The persistence layer must be swappable for a real backend in v2 without UI changes.

## Goals / Non-Goals

**Goals:**
- A working four-screen Vite React SPA whose navigation order *is* the workflow: Add Property → Status → Recommend → Listings.
- A framework-agnostic logic core (`formSchema.js`, `decisionLogic.js`) that is unit-testable without the UI.
- Binary Send / Don't-send verdicts with a human-readable reason for every recipient, ranked by an internal 0–100 score.
- Local persistence isolated behind a single `store.js` module — the only seam v2 needs to touch.
- Poster PDFs stored *with* the property record, not as fragile external links.

**Non-Goals:**
- In-portal poster generation, PropertyGuru scraping, or OCR of image-only forwards.
- Real authentication, multi-user access, or any student-facing surface.
- Automated Line/Instagram sending — the portal drafts and tracks; the human sends.
- A production backend or hosted deployment.

## Decisions

### 1. Vite + React SPA, no backend (v1)
Single-page React app built with Vite. All state lives client-side. **Why:** single admin, offline-capable, zero infra to operate; fastest path to a working tool. **Alternative considered:** Next.js + a database — rejected as premature; v2 can add a backend behind the store seam.

### 2. `store.js` is the persistence seam
All reads/writes go through a single `store.js` module exposing a small async CRUD API (`listProperties`, `saveProperty`, `listResponses`, `saveResponse`, etc.). No component touches storage directly. **Why:** the proposal mandates a swappable persistence layer; concentrating it in one module means v2 swaps `store.js` for a REST client with the UI untouched. **Alternative considered:** scattering `localStorage` calls in components — rejected, it would leak storage into every screen.

### 3. IndexedDB for v1 persistence (not `localStorage`)
`store.js` v1 backs onto IndexedDB. **Why:** poster PDFs are stored as blobs alongside the property record; `localStorage`'s ~5 MB string-only quota would not survive a handful of posters. IndexedDB handles blobs natively with a far larger quota. The async store API is shaped for IndexedDB from day one so v2's REST swap is also async — no signature churn.

### 4. Logic core is plain, framework-agnostic JS
`formSchema.js` and `decisionLogic.js` are pure modules with no React imports. `formSchema.js` parses the 13 bilingual Google Form columns into clean records; `decisionLogic.js` exposes a per-pair verdict function and a `recommendRecipients()` that splits the database into ranked Send and explained Hold lists. **Why:** the matching logic is the heart of the product and must be testable in isolation and portable to a future backend.

### 5. Binary verdict on the surface, numeric score underneath
`decisionLogic.js` computes a 0–100 weighted score (Budget 30, School 22, Commute 20, Housing type 12, Unit layout 9, Building type 7) but the UI only ever shows **Send** or **Don't send** plus a reason. The score is used solely to rank the Send list. Hard blockers (over budget, Room/Whole-Unit mismatch) cap the verdict at Don't send regardless of score; two or more stacked mismatches or a generally weak fit also yield Don't send. **Why:** the proposal's "we do not blast" principle — a clean binary decision with an explained Hold, never STRONG/MEDIUM/WEAK noise.

### 6. Poster handoff via PDF file upload, stored with the record
The Add Property screen accepts a PDF file upload; the blob is persisted in the property record via `store.js`. **Why:** the proposal explicitly rejects external Drive links that "move or rot" and rejects in-portal generation. The portal is a system of record, not a generator.

### 7. Brand tokens centralized in `theme.js`
A single `theme.js` holds the colour tokens and is the only source of brand truth, copied verbatim from the `room-showcase-pdf` skill. **Why:** the proposal calls brand "non-negotiable" and wants zero drift between the poster and the portal.

### 8. Data model
Two core entities, both owned by `store.js`:
- **Property**: name (condo/HDB), area, buildingType (Condo/HDB), buildingAgeYears, roomType, rentPerMonth, media (photos[], links[], videoUrl), posterPdf (blob + filename), and a status object `{ dataReceived, posterAttached, sent }`.
- **FormResponse**: the 13 parsed fields from `formSchema.js` (name, channel, contact, school, moveIn, leaseLength, budget {min,max}, buildingType, housingType, unitLayout[], commuteTolMins, wantRoommate, extras {flags, note}), plus a `source` marker (csv | manual).

## Risks / Trade-offs

- **IndexedDB quota / many large posters** → Store only the finished PDF per property; surface a clear error if a write is rejected; v2 backend removes the ceiling entirely.
- **Google Form CSV format drift** (column reorder/rename, locale quirks) → `formSchema.js` matches columns by recognised 中/EN headers rather than position; manual single-response entry is the always-available fallback.
- **Bilingual parsing edge cases** (school names, multi-select layouts, free-text extras) → `formSchema.js` recognises both 中 and EN values and degrades free-text into an `extras.note` rather than failing the whole row.
- **Logic core correctness is high-stakes** (a wrong Don't-send loses a match silently) → `decisionLogic.js` is built as a pure module with unit tests covering each weight, every hard blocker, and the stacked-mismatch path before the Recommend screen is wired.
- **No auth / local-only** → Accepted for v1 by scope; data lives on one laptop, so loss risk is real — note for v2, no mitigation in v1 beyond the swappable store.
- **Single-page state with no backend** → A browser/profile reset wipes data; acceptable for v1, and the `store.js` seam is the planned exit.

## Migration Plan

This is a greenfield build — no data migration. Deployment is `npm run build` producing a static bundle the admin runs locally (or `npm run dev`). The forward path to v2: replace `store.js`'s IndexedDB implementation with a REST client against a real backend; the async store API and all four screens stay unchanged.

## Open Questions

- Exact Google Form CSV column header strings (中/EN) — to be confirmed against a real export when wiring `formSchema.js`; until then the parser keys off the 13 questions named in the proposal.
- Per-campus commute numbers (NUS/NTU/SMU) — where the door-to-door minutes come from per property (manual entry on the property record is assumed for v1).
