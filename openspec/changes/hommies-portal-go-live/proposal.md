## Why

The portal works locally but isn't live: data sits in one browser's IndexedDB, the screens are seeded with mock properties and responses, and the poster-prompt step is a fixed string template. To run the real operation it needs a real backend (so room and client data survive and are shared), no fake data, an AI step that writes a genuinely tailored `/room-showcase-pdf` brief instead of a canned one, and the polished four-screen experience the team actually designed in Claude Design ("Hommies Portal"). This change takes the portal from prototype to live.

## What Changes

- **Remove all mock data** — delete the seeded properties and responses; the portal starts empty and only ever shows real records.
- **Convex backend** — replace the local IndexedDB `store.js` with Convex: a typed schema for properties and responses, queries/mutations/actions, and Convex file storage for the uploaded poster PDFs. The UI reads live, reactive data.
- **Gemini-powered poster prompt** — the "Generate poster prompt" card on Add Property calls a Convex **action** that runs Gemini server-side (key kept secret as a Convex env var) to write a tailored `/room-showcase-pdf` brief from the property record. The design's static template becomes the fallback when Gemini is unavailable.
- **Rebuild the UI to the Claude design** ("Hommies Portal.html") — navy left **sidebar** shell with the brand mark, numbered workflow nav, and "we are not agents" footer; **Fraunces + Inter** type system and the design's full token set; redesigned Add Property (detail/commute/media/poster-prompt/poster-PDF cards, segment + chip inputs), Status (stage-stat cards + lifecycle table), Recommend (property picker + Send/Hold buckets + match cards with pass/soft/fail criteria chips + bilingual draft + `ManualResponseModal`), and Listings (Condo/HDB filter + fact cards).
- **Adopt the design's data model** — `condo`, `unitType`, `rentSGD`, `ageYears`, `fullAddress`, `housingType`, `media.{photos,links,videos}`, and a single 3-state `status` enum (`data_received` → `poster_attached` → `sent`).
- **Adopt the design's decision logic** — six weighted factors (30/22/20/12/9/7), **send threshold 58**, hard blockers for over-budget / housing mismatch / commute-too-far, per-factor criteria with `pass`/`soft`/`fail` levels, ranked Send/Hold buckets, bilingual draft messages, and tolerant bilingual Google Form CSV parsing.
- **No auth in v1** — the portal stays single-admin and ungated; access relies on the Convex deployment URL staying private.

This change supersedes the unarchived `hommies-portal` change — it is the go-live replacement of that prototype.

## Capabilities

### New Capabilities
- `convex-backend`: the Convex persistence layer — schema for properties and responses, queries/mutations/actions, poster-PDF file storage, and reactive reads; replaces local IndexedDB and removes all seed data.
- `ai-poster-prompt`: Gemini-powered generation of the `/room-showcase-pdf` brief, run server-side in a Convex action with the static template as a fallback.
- `portal-redesign`: the four-screen portal rebuilt to the Claude "Hommies Portal" design — navy sidebar shell, Fraunces/Inter design system, and the redesigned Add Property / Status / Recommend / Listings screens and shared UI primitives, on the design's data model.
- `match-decision-engine`: the recommendation logic from the design's `decision.js` — weighted six-factor scoring with `pass`/`soft`/`fail` criteria, send threshold 58, hard blockers, ranked Send/Hold buckets, bilingual draft messages, and bilingual CSV parsing.

### Modified Capabilities
<!-- None recorded in openspec/specs/ — the prior `hommies-portal` change is not archived, so this change declares its capabilities fresh and supersedes it. -->

## Impact

- **New dependency: Convex** — adds `convex/` (schema + server functions), the `convex` npm package, `npx convex dev` for local development, and `VITE_CONVEX_URL` for the frontend.
- **New dependency: Gemini** — the Gemini SDK used inside a Convex action; requires a `GEMINI_API_KEY` set as a Convex environment variable (never shipped to the client).
- **Removed**: `src/store.js` (IndexedDB), `src/seedData.js`, `seedIfEmpty`, and the `fake-indexeddb` test setup; `src/workflow.integration.test.js` is rewritten against the new model.
- **Reworked**: every component and the logic core — data-model field renames (`name`→`condo`, `roomType`→`unitType`, `rentPerMonth`→`rentSGD`, `buildingAgeYears`→`ageYears`, status object → enum string, `media.videoUrl` → `media.videos[]`); shell layout changes from top-bar to sidebar; fonts change from Nunito to Fraunces + Inter.
- **Logic-core tests** updated to the new model, criteria levels, threshold 58, and blocker types; remain framework-agnostic and runnable under Vitest.
- **Out of scope (v1)**: authentication / multi-user access, frontend static hosting (Convex hosts the backend; the SPA can be deployed separately as a follow-up), in-portal poster generation, and automated Line/Instagram sending.
