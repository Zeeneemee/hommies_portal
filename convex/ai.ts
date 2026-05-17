// AI poster-prompt generator — runs Gemini server-side in a Convex action so
// the API key never reaches the browser.
//
// Gemini Vision looks at the uploaded photos and writes the short kickoff
// message the admin pastes into a Claude chat to invoke their
// /room-showcase-pdf skill. The skill is opinionated and complete: it
// scrapes PropertyGuru / 99.co, downloads the listing photos, researches
// the project page, computes NUS / NTU / SMU routes, and runs its own
// generator script. Our message therefore deliberately does NOT repeat
// brand colors, layout rules, or the "four facts" — the skill has them.
//
// The message:
//   1. invokes /room-showcase-pdf
//   2. names the property
//   3. lists, in plain text, the things the admin needs to be ready to
//      supply when the skill asks (listing URL, target uni, client name,
//      optional video) — these are the inputs the portal does not capture
//   4. summarises what Gemini Vision sees in the attached photos
//   5. asks the skill to append a small labeled "Property Facts" block to
//      the PDF so this portal can lift the values back via text extraction
//
// No static-template fallback: if Gemini fails (missing key, rate limit,
// malformed response) the action returns an error envelope.
'use node'

import { action } from './_generated/server'
import { api } from './_generated/api'
import { v } from 'convex/values'
import { GoogleGenAI } from '@google/genai'

// The deployment's GEMINI_MODEL env var overrides this — useful when free-tier
// availability for one model vanishes (e.g. gemini-2.0-flash is `limit: 0` in
// some regions). `gemini-2.5-flash` is the current sensible default for
// vision + short-text generation and has wider regional availability.
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash'

// An image carried inline so Gemini Vision can look at it. `dataB64` is the
// raw base64 (no `data:...;base64,` prefix). `name` is metadata only — it
// MUST NOT appear in the generated message.
const imageInline = v.object({
  name: v.string(),
  mimeType: v.string(),
  dataB64: v.string(),
})

const propertyArg = v.object({
  condo: v.string(),
  images: v.optional(v.array(imageInline)),
})

const SYSTEM_INSTRUCTION = `You write the kickoff message a Hommies.sg admin pastes into a Claude chat to invoke the /room-showcase-pdf skill.

The skill is opinionated and complete — it scrapes the PropertyGuru / 99.co listing URL, downloads listing photos, researches the condo project page for facilities and transit, computes routes to NUS / NTU / SMU, and runs its own generator that already owns the Hommies.sg brand colors, fonts, layout, and the four-facts presentation. You do NOT need to teach it any of that.

Your output is the exact text the admin will paste. Output ONLY the message — no preamble, no commentary, no markdown code fences.

You MUST emit ALL SIX blocks below in order. Do not stop early. Do not collapse blocks. Each block needs its own visible heading line.

────────────────────────────────────────
BLOCK 1 — Invocation
The very first line must be exactly:
/room-showcase-pdf

BLOCK 2 — Property
One line naming the property (the condo / HDB name as given).

BLOCK 3 — Inputs you'll ask me for
A heading line "Inputs you'll ask me for" followed by FOUR bullet points, one per input, in this order:
- PropertyGuru or 99.co listing URL
- Target university — NUS, NTU, or SMU (the campus highlighted in orange on the poster)
- Client name (optional — leave blank for a generic poster)
- Video link — Google Drive URL for a room tour (optional)

BLOCK 4 — What's attached to this chat
A heading line "What's attached to this chat" followed by ONE bullet per photo category you can see in the attached images: e.g. "Room / unit interior photos", "Facilities photos (gym / pool / lounge)", "Floorplan", "Site plan / project map", "Exterior / lobby". Refer to photos collectively — DO NOT list filenames. Skip categories you don't see.

BLOCK 5 — What the photos show
A heading line "What the photos show" followed by 5–10 substantive bullets summarising specifically what is visible. Include where applicable:
- Room type observed (Common Room / Master Room / Studio / Whole Unit) and the cues (size of bed, presence of attached bathroom, kitchenette, etc.)
- Layout & space cues (approximate room size impression, ceiling height, window count, balcony / no balcony)
- Furnishing & condition (fully furnished, partly furnished, bare; condition impression: new / recently renovated / lived-in; era impression)
- Light & view (natural light level, what's visible out the window — greenery, road, MRT, other towers)
- Kitchen / bathroom condition if visible (gas vs induction, oven, dishwasher, rain shower, etc.)
- Facilities visible in the photos (pool, gym, BBQ pits, function room, tennis, lounge, co-working)
- Notable nearby cues (visible MRT exit, sheltered walkway, school next door)
Frame everything as observed-from-photos. If a value isn't visible, say "estimated — leave to the listing scrape" rather than inventing. Never invent rent, exact address, or unit number.

BLOCK 6 — Also, please append a Property Facts block
A heading line "Also, please append a Property Facts block" followed by an instruction to the skill to add a small LABELED TEXT BLOCK on the poster (real selectable text, not raster), then ON SEPARATE LINES, exactly these labels (the skill will fill in the values from the scrape):
    Monthly rent: S$<number>
    Area: <area>
    Building type: Condo | HDB
    Housing type: Room | Whole Unit
    Age: <number> years
    Room type: <Common Room | Master Room | Studio | Whole Unit>
    Commute: NUS <min> · NTU <min> · SMU <min>

────────────────────────────────────────
Style notes:
- Plain text. Use simple hyphens for bullets. No markdown headings (#), no bold (**), no code fences.
- Target length 350–500 words — substantial enough that the admin can scan what Gemini saw before pasting, but still scannable.
- Be specific, not generic. "Master Room with attached bathroom, queen bed, balcony view of pool deck" is better than "spacious bedroom".
- Be honest. "Estimated — leave to listing scrape" beats a fabricated number.`

export const generatePosterPrompt = action({
  args: { property: propertyArg },
  handler: async (_ctx, { property }) => {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return {
        prompt: null,
        source: 'error' as const,
        note: 'GEMINI_API_KEY is not set on the Convex deployment. Set it with `npx convex env set GEMINI_API_KEY <key>` and try again.',
      }
    }

    const photoCount = (property.images || []).length
    if (photoCount === 0) {
      return {
        prompt: null,
        source: 'error' as const,
        note: 'No photos attached — Vision needs at least one image to write the message.',
      }
    }

    const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL
    try {
      const ai = new GoogleGenAI({ apiKey })
      const parts: any[] = [{ text: describeProperty(property.condo, photoCount) }]
      for (const img of property.images || []) {
        parts.push({ inlineData: { mimeType: img.mimeType, data: img.dataB64 } })
      }
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts }],
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          temperature: 0.4,
          maxOutputTokens: 2000,
        },
      })
      const text = (response.text ?? '').trim()
      if (!text || !text.startsWith('/room-showcase-pdf')) {
        return {
          prompt: null,
          source: 'error' as const,
          note: `Gemini (${model}) returned an empty or malformed message — retry, or try another model via the GEMINI_MODEL env var.`,
        }
      }
      return {
        prompt: text,
        source: 'gemini' as const,
        note: `Generated with ${model} · vision (${photoCount} photo${photoCount === 1 ? '' : 's'} analysed).`,
      }
    } catch (err: any) {
      return {
        prompt: null,
        source: 'error' as const,
        note: explainGeminiError(err, model),
      }
    }
  },
})

// ─────────────────────────────────────────────────────────────────────────
// In-portal poster generation — Gemini decides copy + photo order, the React
// template owns layout. The action loads the property + image bytes, asks
// Gemini for structured JSON, validates and clamps it to a safe shape, and
// returns it for client-side rendering. No PDF is produced here — the
// browser handles that via html2pdf.js.

const POSTER_SYSTEM_INSTRUCTION = `You write the content for a Hommies.sg property poster — a 3-page A4 PDF a student-rental agent sends to clients in Singapore.

You will receive: the property's facts (condo, rent, address, room type) + the listing photos. Pages 1 + 2 + 3 of the poster need DIFFERENT data from you. You also classify each image so the template can place floorplans and site plans correctly.

Return ONLY a JSON object — no prose, no markdown fences. Use exactly this shape (omit any key you cannot fill confidently; never invent specific facility names you cannot verify from the photos OR provided facts):

{
  "headline": string,                  // 6-10 words. e.g. "1 Bedroom Studio (Type A2) — high floor, balcony". Lead with unit type and one observable cue.
  "subtitle": string,                  // The condo name on its own line, e.g. "Lake Grande"
  "availability": string,              // e.g. "Ready to move in" or "1 Jul 2026". Echo what's in the facts if available, else omit.
  "photoOrder": number[],              // indices into the provided photo list, 0-based. First index = hero. ONLY room/interior shots here, NOT floorplans or site plans.
  "floorplanIdx": number | null,       // STRICT: index of an image that is unambiguously a 2D floorplan diagram (top-down line drawing of room layout, often with measurements / room labels). If NO image is clearly a floorplan, return null. Never mark a normal room photo, balcony view, kitchen photo, or facility photo as the floorplan.
  "size": string,                      // e.g. "474 sqft" — echo from facts if present.
  "furnishing": string,                // 1-2 sentences describing what's furnished, drawn from the photos.
  "housemates": string,                // "N/A — entire unit is yours" for whole-unit; describe co-tenant setup if Room.
  "houseRules": string,                // short, friendly line about the living arrangement.
  "commute": {
    "NUS": { "route": string, "minutes": number },   // route like "Lakeside MRT (EW26) → Buona Vista (EW21) → Kent Ridge (CC24)". minutes is an honest estimate.
    "NTU": { "route": string, "minutes": number },
    "SMU": { "route": string, "minutes": number }
  },
  "sections": {
    "inCondo": string[],              // 6-10 short bullets of facilities IN the condo. Only include items you're confident this specific condo has.
    "food": string[],                 // 2-4 short bullets — nearby hawkers / food courts.
    "supermarkets": string[],         // 1-3 short bullets — FairPrice / Sheng Siong / Cold Storage with distance hint.
    "malls": string[]                 // 1-3 short bullets — JEM / Westgate / etc.
  },
  "mrt": [                             // 1-3 nearest MRT stations. code = line+number e.g. "EW26"; walkMin is honest estimate.
    { "code": string, "name": string, "walkMin": number }
  ],
  "bus": [                             // 0-3 useful bus services nearby.
    { "number": string, "route": string }
  ],
  "closing": string                    // 1-2 sentence warm CTA. Don't push hard.
}

Hard rules:
- Honesty over completeness: if you don't know the specific facilities for this condo, leave inCondo with generic-but-true items (e.g. "Swimming pool", "Gymnasium", "24-hour security") rather than invent specific named features.
- Commute minutes: be conservative. A 3-MRT-line trip is at least 30 min including walk. NTU from west-side condos is typically faster than NUS+SMU.
- MRT codes follow Singapore convention: EW (green), NS (red), NE (purple), CC (orange), DT (blue), TE (brown).
- Photo classification: when in doubt, return null for floorplanIdx/sitePlanIdx. A wrong classification (placing a room photo in the floorplan / site plan slot) is MUCH worse than missing those sections entirely. The template hides those sections cleanly when the indices are null. Only set an index when the image is OBVIOUSLY a technical diagram, not a photograph.`

function clampPhotoOrder(raw: any, n: number): number[] {
  if (!Array.isArray(raw)) return Array.from({ length: n }, (_, i) => i)
  const seen = new Set<number>()
  const out: number[] = []
  for (const v of raw) {
    const i = typeof v === 'number' ? Math.trunc(v) : Number(v)
    if (!Number.isFinite(i) || i < 0 || i >= n) continue
    if (seen.has(i)) continue
    seen.add(i)
    out.push(i)
  }
  if (out.length === 0) return Array.from({ length: n }, (_, i) => i)
  return out
}

function clampStringList(raw: any, max: number, perLen: number): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const v of raw) {
    if (typeof v !== 'string') continue
    const s = v.trim().slice(0, perLen)
    if (s) out.push(s)
    if (out.length >= max) break
  }
  return out
}

function clampOneLine(raw: any, max: number): string {
  if (typeof raw !== 'string') return ''
  return raw.replace(/^["'\s]+|["'\s.,;:!?]+$/g, '').slice(0, max)
}

const posterInlineImage = v.object({
  name: v.string(),
  mimeType: v.string(),
  dataB64: v.string(),
})
const posterPropertyArg = v.object({
  condo: v.string(),
  rentSGD: v.optional(v.number()),
  area: v.optional(v.string()),
  buildingType: v.optional(v.union(v.literal('Condo'), v.literal('HDB'))),
  housingType: v.optional(v.union(v.literal('Room'), v.literal('Whole Unit'))),
  unitType: v.optional(v.string()),
  ageYears: v.optional(v.number()),
  fullAddress: v.optional(v.string()),
  commuteMins: v.optional(
    v.object({ NUS: v.number(), NTU: v.number(), SMU: v.number() }),
  ),
  // Listing-page facts lifted by the URL extractor. Passed through so the
  // poster template can render verified values instead of asking Gemini to
  // re-derive them from photos.
  sizeSqft: v.optional(v.number()),
  bedrooms: v.optional(v.number()),
  bathrooms: v.optional(v.number()),
  furnishing: v.optional(v.string()),
  availability: v.optional(v.string()),
  listingTitle: v.optional(v.string()),
})

export const generatePosterContent = action({
  args: {
    property: posterPropertyArg,
    images: v.array(posterInlineImage),
    projectUrl: v.optional(v.string()),
    primaryUni: v.optional(v.union(v.literal('NUS'), v.literal('NTU'), v.literal('SMU'))),
  },
  handler: async (ctx, { property, images, projectUrl, primaryUni }) => {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return {
        ok: false as const,
        content: null,
        note: 'GEMINI_API_KEY is not set on the Convex deployment.',
      }
    }

    // Eligibility: rent + housingType + ≥ 1 image. We DON'T require
    // commuteMins here — the URL extractor doesn't return it, and the
    // <Poster> template hides the commute footer cleanly when absent. The
    // poster still has value without it.
    const eligible =
      typeof property.rentSGD === 'number' &&
      property.rentSGD > 0 &&
      !!property.housingType &&
      images.length >= 1
    if (!eligible) {
      return {
        ok: false as const,
        content: null,
        note: 'Need rent + housing type + at least one image to generate.',
      }
    }

    // Cap photos sent to Gemini. The template can still reference more than
    // this — Gemini just picks the hero + ordering from the first 8.
    const visibleCount = Math.min(images.length, 8)

    // Pull the PropertyGuru project page if we have a URL. This grounds the
    // facilities / nearby copy in real text rather than relying on the
    // model's prior knowledge of the condo. Failures are non-fatal — Gemini
    // falls back to general SG-property knowledge.
    let projectText = ''
    let projectNote = 'no projectUrl'
    if (projectUrl) {
      try {
        const r: any = await ctx.runAction(api.extraction.fetchProjectPageText, { url: projectUrl })
        if (r?.ok) {
          projectText = r.text || ''
          projectNote = `project page ok (${projectText.length} chars)`
        } else {
          projectNote = `project page failed: ${r?.note || 'unknown'}`
        }
      } catch (err: any) {
        projectNote = `project fetch threw: ${err?.message || err}`
      }
    }

    const parts: any[] = [
      { text: buildPosterUserPrompt(property, visibleCount, primaryUni, projectText) },
    ]
    for (let i = 0; i < visibleCount; i++) {
      const img = images[i]
      parts.push({ inlineData: { mimeType: img.mimeType, data: img.dataB64 } })
    }

    const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL
    try {
      const ai = new GoogleGenAI({ apiKey })
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts }],
        config: {
          systemInstruction: POSTER_SYSTEM_INSTRUCTION,
          temperature: 0.2,
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingBudget: 0 },
          maxOutputTokens: 4096,
        },
      })
      const text = (response.text || '').trim()
      let parsed: any
      try {
        parsed = JSON.parse(text)
      } catch {
        const fenced = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/i)
        if (fenced) {
          parsed = JSON.parse(fenced[1])
        } else {
          return {
            ok: false as const,
            content: null,
            note: `Gemini returned non-JSON: ${text.slice(0, 300)}`,
          }
        }
      }
      const idxOrNull = (raw: any) => {
        const i = typeof raw === 'number' ? Math.trunc(raw) : Number(raw)
        return Number.isFinite(i) && i >= 0 && i < images.length ? i : null
      }
      const oneOfRoute = (raw: any) => {
        if (!raw || typeof raw !== 'object') return undefined
        const route = clampOneLine(raw.route, 200)
        const minutes = Number(raw.minutes)
        if (!route && !Number.isFinite(minutes)) return undefined
        return {
          route: route || '—',
          minutes: Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : 0,
        }
      }
      const c = parsed || {}
      const content = {
        headline: clampOneLine(c.headline, 120) || `${property.condo} listing`,
        subtitle: clampOneLine(c.subtitle, 80) || property.condo,
        availability: clampOneLine(c.availability, 40),
        photoOrder: clampPhotoOrder(c.photoOrder, images.length),
        floorplanIdx: idxOrNull(c.floorplanIdx),
        size: clampOneLine(c.size, 40),
        furnishing: clampOneLine(c.furnishing, 300),
        housemates: clampOneLine(c.housemates, 200),
        houseRules: clampOneLine(c.houseRules, 300),
        commute: {
          NUS: oneOfRoute(c?.commute?.NUS),
          NTU: oneOfRoute(c?.commute?.NTU),
          SMU: oneOfRoute(c?.commute?.SMU),
        },
        sections: {
          inCondo: clampStringList(c?.sections?.inCondo, 12, 80),
          food: clampStringList(c?.sections?.food, 6, 80),
          supermarkets: clampStringList(c?.sections?.supermarkets, 4, 80),
          malls: clampStringList(c?.sections?.malls, 4, 80),
        },
        mrt: Array.isArray(c.mrt)
          ? c.mrt
              .filter((m: any) => m && typeof m === 'object' && typeof m.code === 'string' && typeof m.name === 'string')
              .slice(0, 3)
              .map((m: any) => ({
                code: clampOneLine(m.code, 8),
                name: clampOneLine(m.name, 40),
                walkMin: Number.isFinite(Number(m.walkMin)) ? Math.round(Number(m.walkMin)) : 0,
              }))
          : [],
        bus: Array.isArray(c.bus)
          ? c.bus
              .filter((b: any) => b && typeof b === 'object' && (b.number || b.route))
              .slice(0, 3)
              .map((b: any) => ({
                number: clampOneLine(b.number, 10),
                route: clampOneLine(b.route, 80),
              }))
          : [],
        closing: clampOneLine(c.closing, 400),
      }
      return {
        ok: true as const,
        content,
        note: `Generated with ${model} · ${visibleCount} photo${visibleCount === 1 ? '' : 's'} · ${projectNote}.`,
      }
    } catch (err: any) {
      return {
        ok: false as const,
        content: null,
        note: explainGeminiError(err, model),
      }
    }
  },
})

function buildPosterUserPrompt(
  property: any,
  photoCount: number,
  primaryUni: string | undefined,
  projectText: string,
): string {
  const facts = [
    `Property name: ${property.condo}`,
    property.listingTitle ? `Listing title (use as headline if good): ${property.listingTitle}` : '',
    typeof property.rentSGD === 'number' ? `Monthly rent: S$${property.rentSGD.toLocaleString('en-SG')}` : '',
    property.area ? `Area: ${property.area}` : '',
    property.buildingType ? `Building type: ${property.buildingType}` : '',
    property.housingType ? `Housing type: ${property.housingType}` : '',
    property.unitType ? `Room type: ${property.unitType}` : '',
    typeof property.bedrooms === 'number' ? `Bedrooms: ${property.bedrooms}` : '',
    typeof property.bathrooms === 'number' ? `Bathrooms: ${property.bathrooms}` : '',
    typeof property.sizeSqft === 'number' ? `Size: ${property.sizeSqft} sqft` : '',
    property.furnishing ? `Furnishing: ${property.furnishing}` : '',
    property.availability ? `Availability: ${property.availability}` : '',
    typeof property.ageYears === 'number' ? `Age: ${property.ageYears} years` : '',
    property.fullAddress ? `Address: ${property.fullAddress}` : '',
    primaryUni ? `Primary university (client target): ${primaryUni}` : '',
  ].filter(Boolean)

  // Cap the project text we send to ~25KB so we keep token budget for images.
  const projectBlock = projectText
    ? `\nPROJECT_PAGE (verified facilities + nearby for this condo — extract from this; do NOT invent extras):\n${projectText.slice(0, 25_000)}\n`
    : ''

  return [
    'Write the poster content for this property. Use the facts + the attached photos + the PROJECT_PAGE (if present) to make concrete, specific choices. Classify floorplan/site-plan images. Output JSON ONLY.',
    '',
    ...facts,
    projectBlock,
    `Photos attached: ${photoCount} (indices 0..${photoCount - 1}). Floorplan and site plan images may be among these — set floorplanIdx / sitePlanIdx and EXCLUDE those indices from photoOrder. Hero shot (photoOrder[0]) should be a clean room or notable view.`,
  ].join('\n')
}

function describeProperty(condo: string, photoCount: number): string {
  return [
    'Write the /room-showcase-pdf kickoff message for this property:',
    '',
    `Property name: ${condo}`,
    '',
    `Attached: ${photoCount} photo${photoCount === 1 ? '' : 's'} — look at them and weave what you observe into the "What the photos show" block. The user will attach these same photos to their own Claude chat from their device, so reference them only collectively (never by filename).`,
  ].join('\n')
}

// Surface the most common Gemini errors as a tight, action-oriented line so
// the warn-notice in PosterPromptCard tells the admin exactly what to do
// rather than dumping the raw JSON payload.
function explainGeminiError(err: any, model: string): string {
  const msg = String(err?.message || err || 'unknown error')

  // The "your project has zero free-tier quota" case — usually a regional
  // restriction (Singapore among others) rather than rate-limiting.
  if (msg.includes('limit: 0')) {
    return `Gemini (${model}) reports your project has no quota for this model (limit: 0 — a regional or free-tier restriction). Enable billing on the Google Cloud project that owns this key, or set the GEMINI_MODEL Convex env var to a model your project can call (e.g. gemini-1.5-flash, gemini-2.5-flash, gemini-flash-latest).`
  }
  // The "you used your daily allowance" case.
  if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
    return `Gemini (${model}) returned 429 (rate limit / quota). Wait a moment and retry, enable billing for a higher quota, or switch model via the GEMINI_MODEL Convex env var.`
  }
  // The "wrong / missing key" case.
  if (msg.includes('401') || msg.includes('API key') || msg.includes('invalid')) {
    return `Gemini (${model}) rejected the API key. Re-issue a key at aistudio.google.com/apikey and update it with: npx convex env set GEMINI_API_KEY <new-key>.`
  }
  // The "model not found / not enabled" case — common when swapping models.
  if (msg.includes('not found') || msg.includes('NOT_FOUND') || msg.includes('does not exist')) {
    return `Gemini reports model "${model}" is not available for your project. Check available models in AI Studio and set the GEMINI_MODEL Convex env var to a valid one.`
  }
  return `Gemini (${model}) call failed: ${msg}`
}
