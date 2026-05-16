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
import { v } from 'convex/values'
import { GoogleGenAI } from '@google/genai'

const GEMINI_MODEL = 'gemini-2.0-flash'

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

const SYSTEM_INSTRUCTION = `You write a short, focused kickoff message that invokes the user's Claude skill /room-showcase-pdf.

That skill is opinionated and complete — it scrapes the listing URL on PropertyGuru / 99.co, downloads the listing photos, researches the condo project page for facilities and transit, computes the routes to NUS / NTU / SMU, and runs its own generator that already handles the Hommies.sg brand colors, fonts, layout, and the "four facts" presentation. You do NOT need to teach the skill any of that.

Your output is the exact text the user will paste into their Claude chat. Output ONLY the message — no preamble, no commentary, no markdown fences.

The message MUST follow this structure:

1. First line — exactly: /room-showcase-pdf
2. One short line naming the property.
3. A short block titled "Inputs you'll ask me for" listing — as plain bullet points — the four inputs the skill needs that this portal does not capture, so the user (the admin in the chat) is prepared when the skill prompts:
     • PropertyGuru or 99.co listing URL
     • Target university — NUS, NTU, or SMU (the campus highlighted in orange on the poster)
     • Client name (optional — leave blank for a generic poster)
     • Video link — Google Drive URL for a room tour (optional)
4. A short block titled "What's attached to this chat" — one line per photo category you can see (room / unit photos, facilities photos, floorplan, site plan, etc.) — DO NOT list filenames. Refer to the photos collectively. The same photos the user will drop into their Claude chat.
5. A short block titled "What the photos show" with your concise observations from looking at the attached photos: visible room type (Common Room / Master Room / Studio / Whole Unit), layout cues, condition / era impression, view / light, notable features (gym, pool, MRT nearby, kitchen condition, balcony). Frame each as observed-from-photos. When a value isn't visible, say "estimated" or "leave to the listing scrape" — never invent specifics.
6. A final short block titled "Also, please append a Property Facts block" — ask the skill to add a tiny LABELED TEXT BLOCK to the poster (actual text, not raster) with these exact lines so this portal can extract them back from the PDF:
     Monthly rent: S$<number>
     Area: <area>
     Building type: Condo | HDB
     Housing type: Room | Whole Unit
     Age: <number> years
     Room type: <Common Room | Master Room | Studio | Whole Unit>
     Commute: NUS <min> · NTU <min> · SMU <min>

Keep the whole message short and scannable — under ~250 words. Use plain hyphens or bullets, not heavy markdown. Be honest about what you can and can't see; do not invent precise rent or address values.`

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

    try {
      const ai = new GoogleGenAI({ apiKey })
      const parts: any[] = [{ text: describeProperty(property.condo, photoCount) }]
      for (const img of property.images || []) {
        parts.push({ inlineData: { mimeType: img.mimeType, data: img.dataB64 } })
      }
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: [{ role: 'user', parts }],
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          temperature: 0.4,
          maxOutputTokens: 800,
        },
      })
      const text = (response.text ?? '').trim()
      if (!text || !text.startsWith('/room-showcase-pdf')) {
        return {
          prompt: null,
          source: 'error' as const,
          note: 'Gemini returned an empty or malformed message — retry, or check the model output.',
        }
      }
      return {
        prompt: text,
        source: 'gemini' as const,
        note: `Generated with ${GEMINI_MODEL} · vision (${photoCount} photo${photoCount === 1 ? '' : 's'} analysed).`,
      }
    } catch (err: any) {
      return {
        prompt: null,
        source: 'error' as const,
        note: `Gemini call failed: ${err?.message || 'unknown error'}`,
      }
    }
  },
})

function describeProperty(condo: string, photoCount: number): string {
  return [
    'Write the /room-showcase-pdf kickoff message for this property:',
    '',
    `Property name: ${condo}`,
    '',
    `Attached: ${photoCount} photo${photoCount === 1 ? '' : 's'} — look at them and weave what you observe into the "What the photos show" block. The user will attach these same photos to their own Claude chat from their device, so reference them only collectively (never by filename).`,
  ].join('\n')
}
