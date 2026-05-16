// AI poster-prompt generator — runs Gemini server-side in a Convex action so
// the API key never reaches the browser. Falls back to a deterministic static
// template if Gemini is unavailable.
//
// When the client supplies the actual image bytes (inline base64), the action
// sends them to Gemini's multimodal Vision model so the brief is informed by
// what's *in* the photos (room type, layout cues, condition, view, building
// era, notable features). When images aren't supplied — or Gemini is
// unavailable — the static template is returned and labelled accordingly.
'use node'

import { action } from './_generated/server'
import { v } from 'convex/values'
import { GoogleGenAI } from '@google/genai'
import { buildPosterPrompt, type PropertyForPrompt } from './posterPrompt'

const GEMINI_MODEL = 'gemini-2.0-flash'

// An image carried inline so Gemini Vision can look at it. `dataB64` is the
// raw base64 (no `data:...;base64,` prefix).
const imageInline = v.object({
  name: v.string(),
  mimeType: v.string(),
  dataB64: v.string(),
})

const propertyArg = v.object({
  condo: v.string(),
  images: v.optional(v.array(imageInline)),
})

const SYSTEM_INSTRUCTION = `You write briefs for the user's Claude skill /room-showcase-pdf, which produces a single-page A4 PDF poster for a rental property in Singapore.

Your only job is to output the brief — no preamble, no markdown fences, no explanation. The brief MUST:

1. Start its first line with exactly: /room-showcase-pdf
2. State the Hommies.sg brand non-negotiables: primary orange #fd6925, primary navy #041f60, warm cream #fff5ec background. Tone is warm and family-first — "housemates becoming homies" — never corporate.
3. Require the disclaimer footer on every poster: "We connect students with authorized agents — we are not agents."
4. Name the property and reference the attached images.

5. LOOK AT THE PHOTOS (if any are attached). Describe — concisely, in a short "What the photos show" section inside the brief — what you actually observe: visible room type (Common Room / Master Room / Studio / Whole Unit), layout cues, condition/age impression, view/light, any notable features (gym, pool, MRT visible nearby, kitchen condition, balcony, etc.). Do not invent details you cannot see; if a value can only be guessed, say "estimated".

6. From those observations, DERIVE the physical facts the poster needs — building type (Condo or HDB), housing type (Room or Whole Unit), room type, approximate age in years, area / neighbourhood guess, a sensible monthly rent for that combination in Singapore. Label each derived value as observed-from-photos or as estimated.

7. Require an upright "Facts" sidebar on the poster, rendered as REAL TEXT (not an image raster), with one value per line using these exact labels — the portal lifts these back from the PDF text and the values must be the ones you derived above:
     Monthly rent: S$<number>
     Area: <area>
     Building type: Condo | HDB
     Housing type: Room | Whole Unit
     Age: <number> years
     Room type: <Common Room | Master Room | Studio | Whole Unit>
     Commute: NUS <min> · NTU <min> · SMU <min>
   Skipping this block means the portal cannot populate the property record.

8. Specify A4 portrait, single page. The four facts that MUST be unmissable at a glance are: 1. Room type   2. Location & area   3. Condo or HDB   4. Age of the building. Rent large and orange; commute row beneath; photos in a grid; Hommies wordmark top-left; disclaimer footer.

9. End by asking for the finished PDF back so it can be uploaded to the internal portal.

Be specific to the photos and the property name. Do not invent precise specifics you cannot see — say "estimated" instead.`

export const generatePosterPrompt = action({
  args: { property: propertyArg },
  handler: async (_ctx, { property }) => {
    const promptInputs: PropertyForPrompt = {
      condo: property.condo,
      images: (property.images || []).map((i) => ({ name: i.name })),
    }
    const fallback = buildPosterPrompt(promptInputs)
    const hasImages = (property.images || []).length > 0
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return {
        prompt: fallback,
        source: 'template' as const,
        note: 'GEMINI_API_KEY not set on the Convex deployment — using the static template.',
      }
    }
    try {
      const ai = new GoogleGenAI({ apiKey })
      const userText = describeProperty(promptInputs, hasImages)
      const parts: any[] = [{ text: userText }]
      for (const img of property.images || []) {
        parts.push({ inlineData: { mimeType: img.mimeType, data: img.dataB64 } })
      }
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: [{ role: 'user', parts }],
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          temperature: 0.4,
          maxOutputTokens: 1500,
        },
      })
      const text = (response.text ?? '').trim()
      if (!text || !text.startsWith('/room-showcase-pdf')) {
        return {
          prompt: fallback,
          source: 'template' as const,
          note: 'Gemini returned an empty or malformed brief — using the static template.',
        }
      }
      return {
        prompt: text,
        source: 'gemini' as const,
        note: hasImages
          ? `Generated with ${GEMINI_MODEL} · vision (${(property.images || []).length} image${(property.images || []).length === 1 ? '' : 's'} analysed).`
          : `Generated with ${GEMINI_MODEL} · text only.`,
      }
    } catch (err: any) {
      return {
        prompt: fallback,
        source: 'template' as const,
        note: `Gemini call failed (${err?.message || 'unknown error'}) — using the static template.`,
      }
    }
  },
})

function describeProperty(p: PropertyForPrompt, hasImages: boolean): string {
  const lines: string[] = []
  lines.push('Write the /room-showcase-pdf brief for this property:')
  lines.push('')
  lines.push(`Name: ${p.condo}`)
  const images = p.images || []
  if (hasImages) {
    lines.push('')
    lines.push(`Attached: ${images.length} photo${images.length === 1 ? '' : 's'} (look at them and weave your observations into the brief).`)
    images.forEach((img) => lines.push(`  • ${img.name}`))
  } else {
    lines.push('No photos attached yet — write a brief that asks Claude to use textured placeholders and label what each frame should show.')
  }
  return lines.join('\n')
}
