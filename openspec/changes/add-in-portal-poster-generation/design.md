## Context

The portal already runs Gemini Flash from a Convex action (`ai:generatePosterPrompt`) and now also extracts structured fields from PropertyGuru listings (`extraction:extractPropertyGuruUrl`). The one thing that still forces a chat-app context switch is the rendered PDF: today it is produced by Claude's `/room-showcase-pdf` skill from a kickoff brief the operator copies out of the portal.

The skill encapsulates five jobs: research, brand assets, photo curation, copywriting, and PDF rendering. Research is already done in-portal (URL scraping + extraction). The remaining four are what this change replaces.

Convex's V8 runtime cannot host Chromium, so PDF rendering must happen either browser-side or in a separate service. The Add-Property image cap (12) means a poster will see ≤ 12 photos.

## Goals / Non-Goals

**Goals:**
- One-click poster generation on Status rows that already have the matchability fields and at least one image.
- The generated PDF is byte-for-byte equivalent in role to a manual `/room-showcase-pdf` upload — same storage field, same downstream extraction trigger, same `posterStorageId` lifecycle.
- All work happens in the portal: Convex for the Gemini call, browser for layout + PDF, Convex Storage for the result.
- Coexists with `PosterPromptCard` for one release. Operators can fall back to the Claude path while we tune the template.
- Brand sourcing is local: `src/theme.js` plus any small assets we add under `public/`. We do not port from the Claude skill.

**Non-Goals:**
- Matching the Claude skill's stylistic variety. The portal poster is templated — same layout per listing, only content + photos change.
- Generating posters before a property has the matchability fields. We require rent + housingType + commuteMins to be present.
- Server-side rendering of the PDF. No Vercel function, no Chromium, no Browserless.
- Watermarking, multi-page posters, A/B layouts. Single-page A4 portrait, one design.
- Removing the Claude flow in this change. That happens in a follow-up.

## Decisions

### 1. PDF rendering: `html2pdf.js` in the browser

**What:** Generate the PDF client-side from a hidden React element via `html2pdf.js` (which wraps `html2canvas` + `jsPDF`). The resulting Blob is uploaded through the existing `properties:generateUploadUrl` + `properties:setPoster` mutation.

**Why:**
- Zero infrastructure cost. No new endpoint, no Chromium binary.
- Convex cannot host headless Chrome. The alternatives all add a new service (Vercel function w/ `@sparticuz/chromium`, Browserless, PDFShift). For an internal tool with 1–2 operators, those are over-built.
- `html2pdf.js` handles the 95% case (text + images + flexbox + custom fonts via `@font-face`) acceptably.

**Alternatives considered:**
- `react-pdf` (Khan Academy / Diego Muracciole): pure JS PDF, vector text, no rasterization. **Rejected** because it uses a different layout model than CSS — we'd write the template twice (once for screen preview, once for PDF), and the brand styling in `theme.js` wouldn't translate.
- Vercel function + Playwright + `@sparticuz/chromium`: highest fidelity. **Rejected for now** as scope creep; on file as the upgrade path if `html2pdf` quality is unacceptable.
- Browserless.io: hosted Chrome. **Rejected** to avoid another external dependency and per-page cost.

**Trade-off accepted:** `html2pdf` rasterizes to canvas before producing the PDF, so text in the output is bitmap, not vector. At 2x scale (`html2pdf({html2canvas:{scale:2}})`) this is indistinguishable on screen and prints sharply at A4 size. We accept this for v1; if any consumer needs selectable text in the poster, we revisit.

### 2. Trigger lives on Status, not AddProperty

**What:** The "Generate in-portal" button appears on the Status screen, on rows that satisfy:
- `rentSGD != null && housingType != null && commuteMins != null` (matchability)
- `images.length >= 1`
- `!posterStorageId` (otherwise show "Re-generate" instead of "Generate")

**Why:**
- After a row has been extracted, all the inputs the poster needs are present. Generating pre-save means Gemini sees fewer facts (no commute data yet) and the operator has no chance to review what was lifted.
- Status is already the "operate on existing properties" surface — Re-extract, advance, delete all live here.
- Keeps AddProperty focused on intake.

**Alternative considered:** Trigger on AddProperty (between Extract and Save). Rejected because the order would be paste link → extract → wait → save → status → generate poster — same number of clicks but more friction, since the operator must commit to saving before they see the poster.

### 3. Coexist with `PosterPromptCard` for one release

**What:** Keep the existing `PosterPromptCard` and `ai:generatePosterPrompt` action in place. Add the new path alongside. The Status row gets two buttons: "Attach poster PDF" (existing manual upload, used after a Claude chat) and "Generate in-portal" (new).

**Why:**
- The Claude skill has been tuned over time and produces high-quality posters. We don't yet know how the in-portal template compares at the operator's bar.
- A one-release coexist period lets the operator A/B in production with no risk: if the in-portal output is unacceptable for a particular listing, fall back to Claude.

**Removal trigger:** After one full release cycle where the operator has used both paths and confirmed the in-portal version is good enough. Tracked as a follow-up change `remove-claude-poster-flow`.

### 4. Gemini does copy + photo ordering, the template does layout

**What:** `ai:generatePosterContent` returns:
```ts
{
  headline: string,            // 4–7 words, e.g. "Quiet master room near NUS"
  tagline: string,             // 8–15 words, the why-care line
  photoOrder: number[],        // indices into property.images, in display order
  accent: string,              // hex color override, picks from a brand palette
  vibeTags: string[],          // 2–4 short tags, e.g. ["walk to NUS", "high floor"]
}
```

**Why:**
- The template owns layout invariants (grid sizes, typography, brand colors). The LLM owns choices that need taste (headline, photo order).
- Structured JSON over free-form HTML keeps Gemini cheap and predictable — no markdown fences to strip, no CSS injection risk, deterministic schema we can validate.

**Photo ordering rationale:** Operators upload photos in upload order, not narrative order. Gemini sees them all in a single multimodal call and picks the hero shot + supporting shots. This is the highest-leverage call Gemini makes for poster quality.

**Accent palette:** Gemini picks from `theme.js`'s defined palette (cream / navy / orange / and 1–2 more). It cannot return arbitrary hex. We sanitize.

### 5. Brand sourcing: `src/theme.js`, no port from the skill

**What:** Use the colors and typography already defined in `src/theme.js`. Add a brand mark from `public/` (favicon source). No attempt to reverse-engineer the skill's template.

**Why:**
- The skill is opaque to the portal codebase — porting would require reading skill internals and re-implementing their CSS.
- The portal already has a coherent visual language (used in Listings, Recommend cards). A poster that matches the portal's own aesthetic is more on-brand for an internal tool than one that mimics a closed skill.
- The skill can keep evolving independently — we don't fork its design.

**Trade-off:** Operators familiar with the skill's poster look will notice the difference. Acceptable because the coexist period (Decision 3) lets them keep the old look when it matters.

## Risks / Trade-offs

- **Photo licensing on scraped images** → operators are already manually pasting PG links and uploading images today; we are not changing the data we hold, only how we render it. No new exposure.
- **`html2pdf.js` font fidelity on iOS Safari** → the operator works on macOS Safari + desktop Chrome. iOS is not in scope.
- **Gemini returning nonsense `photoOrder` (out-of-range indices, duplicates)** → validate the returned array against `property.images.length`, drop invalid entries, fall back to the upload order if validation removes everything.
- **Large bundle from `html2pdf.js`** (~250KB gzipped) → loaded only on Status, not on the public-facing pages (there are none — portal is internal). Acceptable.
- **PDF size from rasterized images** → cap scale at 2x and use JPEG output (`html2pdf({jsPDF:{compress:true}, image:{type:'jpeg', quality:0.85}})`). Target ≤ 1.5MB per poster.
- **Extraction loop on the generated PDF** → the existing extraction action runs on every newly-attached poster. Since we *generated* the poster from data we already have, the extraction will overwrite with… the same data. Harmless but wasteful. v2 could skip extraction when poster was self-generated by setting a marker on the property record. Out of scope for this change.

## Migration Plan

1. Land this change behind no flag — the existing Claude flow remains the default visually (it is what the AddProperty card guides toward; the new button on Status is presented as the alternative).
2. Use it for ~20 properties over one release cycle. If output quality is acceptable, open follow-up change `remove-claude-poster-flow` to retire `PosterPromptCard` and `ai:generatePosterPrompt`.
3. No data migration. The output PDF flows through the same `posterStorageId` field; existing rows are untouched.

**Rollback:** revert the change. Existing posters and the Claude path are unaffected.

## Open Questions

- The accent palette in `theme.js` is currently defined for screen UI, not print. Print-safe palette may need a small extension. Defer to implementation — we'll add `theme.posterPalette` if the screen colors look weak on paper.
- Should the Generate button live in the row action menu or as a top-line CTA? Defer to the operator's preference — pick whichever the existing Status row layout supports cleanly.
