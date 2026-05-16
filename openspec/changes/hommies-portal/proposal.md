## Why

Hommies.sg is the trusted third party between international students and authorized leasing agents, but the judgement that matches a student to a home lives in one person's head and across scattered tools. Two frictions slow the operation: property data arrives as an unstructured WhatsApp mess that gets re-read every time, and deciding who should receive which listing is done by eye — risking either blasting everyone (which erodes trust) or missing the student it was perfect for. A focused internal portal turns each WhatsApp forward into a clean, reusable property record and applies consistent decision logic to say — per property — exactly who to send it to and who to hold back.

## What Changes

- New single-admin, locally-run React (Vite) web portal — four screens in workflow order: **Add Property → Status → Recommend → Listings**. No student-facing surface, no public deployment in v1.
- **Add Property** screen: capture a structured property record (condo/HDB name, area, building type, age, room type, rent) from an agent's WhatsApp forward, recording photos, links, and video against it.
- **Form intake**: ingest the bilingual (中/EN) 13-question Google Form two ways — CSV export upload and manual single-response entry — parsing every response into one clean record (`formSchema.js`).
- **Recommendation engine** (`decisionLogic.js`): run every form response against a chosen property and return a **binary Send / Don't-send verdict with a reason**, using weighted six-factor scoring with hard blockers; split the database into a ranked Send list and an explained Hold list; draft a warm bilingual Line/Instagram message for each Send recipient.
- **Status** screen: a three-step progress tracker per property — Data received → Poster attached → Sent.
- **Listings** screen: card-based inventory showing room type, location/area, Condo/HDB, and building age — filterable, with poster and dispatch status.
- **Poster handoff**: posters are produced outside the portal (Claude chat app via the `room-showcase-pdf` skill); the portal accepts the finished poster as a **PDF file upload** attached to the property record — no generation engine, no API calls.
- Local persistence isolated behind a `store.js` seam so a real backend can be added in v2 without touching the UI; brand tokens pulled verbatim from the `room-showcase-pdf` skill.

## Capabilities

### New Capabilities
- `portal-shell`: the Vite React SPA shell — four-screen navigation in workflow order, the brand system (orange/navy/cream tokens, Hommies logo), and the isolated local persistence layer (`store.js`) that v2 can swap for a backend.
- `property-records`: the property data model and the Add Property screen — structured entry from a WhatsApp forward, recording of photos/links/video, and attachment of the poster PDF by file upload.
- `form-intake`: parsing the 13 bilingual Google Form fields into clean response records (`formSchema.js`), via CSV export upload or manual single-response entry.
- `recommendation-engine`: the Send / Don't-send decision engine (`decisionLogic.js`) — binary verdict with reason, weighted six-factor scoring, hard blockers, ranked Send list plus explained Hold list, and a drafted bilingual message per Send recipient.
- `status-tracking`: the per-property three-step progress tracker (Data received → Poster attached → Sent).
- `listings-inventory`: the card-based property inventory with the four key facts, filters, and poster/dispatch status.

### Modified Capabilities
<!-- None — this is the initial build; openspec/specs/ is empty. -->

## Impact

- **New codebase**: Vite single-page React app, no backend in v1; runs offline on a single admin laptop.
- **New modules**: `formSchema.js`, `decisionLogic.js` (logic core — built in this change per the proposal spec), `theme.js` (brand tokens), `store.js` (local persistence seam), `components/` (the four screens + CSV importer).
- **Depends on** the `room-showcase-pdf` skill — for the brand system (copied verbatim so nothing drifts) and as the external place posters are produced; the portal records the result rather than reproducing the capability.
- **Out of scope (v1)**: in-portal poster generation, real auth/multi-user, automated Line/Instagram sending, any student-facing surface or public deployment, live PropertyGuru scraping, and optical extraction of rent/address from image-only forwards.
