// Poster-detail extraction — loads the attached poster PDF, pulls its text,
// parses the labeled "Facts" block, and patches the property record with
// whatever fields it could lift. Tolerant: missing values just stay absent.
'use node'

import { action } from './_generated/server'
import { internal } from './_generated/api'
import { v } from 'convex/values'
import { parsePosterText } from './posterExtraction'
import { GoogleGenAI } from '@google/genai'

const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash'

// Gemini vision fallback — call when regex parsing missed one of the
// matchability fields (rent / housingType / commuteMins). The PDF is sent
// inline; gemini-2.5-flash supports application/pdf natively at ~258
// tokens per page, so a typical poster costs a fraction of a cent.
async function extractWithGemini(pdfBytes: Uint8Array): Promise<{
  fields: Record<string, unknown>
  note?: string
}> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return { fields: {}, note: 'GEMINI_API_KEY not set' }

  const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL
  const ai = new GoogleGenAI({ apiKey })
  // btoa expects a latin-1 string; build it byte by byte.
  let bin = ''
  for (let i = 0; i < pdfBytes.length; i++) bin += String.fromCharCode(pdfBytes[i])
  const dataB64 = btoa(bin)

  const SYSTEM = `You read a Hommies.sg property poster PDF and extract structured facts.

Return ONLY a JSON object — no prose, no markdown fences, no commentary. Use these exact keys; omit any key you cannot confidently determine. Do not invent values.

{
  "rentSGD": number,                       // monthly rent in S$, integer
  "area": string,                          // neighbourhood, e.g. "Kent Ridge"
  "buildingType": "Condo" | "HDB",
  "housingType": "Room" | "Whole Unit",
  "ageYears": number,                      // building age in years, integer
  "unitType": "Common Room" | "Master Room" | "Studio" | "Whole Unit",
  "fullAddress": string,                   // full street address if shown
  "commuteMins": { "NUS": number, "NTU": number, "SMU": number }  // all three required as integers; omit the whole object if any is missing
}

Strip "~" from approximate commute values. Strip currency symbols and commas from rent.`

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [
            { text: 'Extract the structured facts from this poster.' },
            { inlineData: { mimeType: 'application/pdf', data: dataB64 } },
          ],
        },
      ],
      config: {
        systemInstruction: SYSTEM,
        temperature: 0.0,
        responseMimeType: 'application/json',
        // Thinking mode (default-on for gemini-2.5-flash) eats the output
        // budget before the JSON starts. Disable it — extraction is mechanical.
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: 2048,
      },
    })
    const text = (response.text || '').trim()
    let parsed: any
    try {
      parsed = JSON.parse(text)
    } catch {
      // Some models wrap JSON in ```json fences despite responseMimeType.
      const fenced = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/i)
      if (fenced) parsed = JSON.parse(fenced[1])
      else throw new Error(`non-JSON response: ${text.slice(0, 300)}`)
    }
    const fields = sanitiseGeminiFields(parsed)
    const note = `raw=${text.slice(0, 500)} | sanitised-keys=${Object.keys(fields).join(',') || '(none)'}`
    return { fields, note }
  } catch (err: any) {
    return { fields: {}, note: `Gemini extraction failed: ${err?.message || err}` }
  }
}

// Trust-but-validate — Gemini occasionally returns strings for numeric
// fields or invalid union values. Drop anything that doesn't fit the
// schema rather than letting bad data reach Convex's validators.
function sanitiseGeminiFields(raw: any): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, unknown> = {}
  const num = (x: any) => {
    if (typeof x === 'number' && Number.isFinite(x)) return x
    if (typeof x === 'string') {
      const n = Number(x.replace(/[^\d.]/g, ''))
      return Number.isFinite(n) ? n : undefined
    }
    return undefined
  }
  if (num(raw.rentSGD) != null && num(raw.rentSGD)! > 0) out.rentSGD = num(raw.rentSGD)
  if (typeof raw.area === 'string' && raw.area.trim()) out.area = raw.area.trim()
  if (raw.buildingType === 'Condo' || raw.buildingType === 'HDB') out.buildingType = raw.buildingType
  if (raw.housingType === 'Room' || raw.housingType === 'Whole Unit') out.housingType = raw.housingType
  if (num(raw.ageYears) != null && num(raw.ageYears)! >= 0) out.ageYears = num(raw.ageYears)
  if (typeof raw.unitType === 'string' && raw.unitType.trim()) out.unitType = raw.unitType.trim()
  if (typeof raw.fullAddress === 'string' && raw.fullAddress.trim()) out.fullAddress = raw.fullAddress.trim()
  const c = raw.commuteMins
  if (c && typeof c === 'object') {
    const NUS = num(c.NUS), NTU = num(c.NTU), SMU = num(c.SMU)
    if (NUS != null && NTU != null && SMU != null) out.commuteMins = { NUS, NTU, SMU }
  }
  return out
}

// True when the regex pass missed one of the three fields the recommend
// engine needs to mark a property as matchable.
function missingMatchability(fields: Record<string, unknown>): boolean {
  return (
    typeof fields.rentSGD !== 'number' ||
    !fields.housingType ||
    !fields.commuteMins
  )
}

// pdf-parse v2 wraps pdfjs-dist, which references DOM globals (DOMMatrix,
// ImageData, Path2D) at module load. Convex's V8 runtime doesn't expose
// those, so we (a) install minimal stubs on the global before importing
// pdf-parse, and (b) defer the import to the handler via dynamic import
// to keep the deploy-time module analyzer from evaluating pdfjs.
function installPdfjsPolyfills() {
  const g = globalThis as any
  if (typeof g.DOMMatrix === 'undefined') {
    g.DOMMatrix = class {
      a = 1; b = 0; c = 0; d = 1; e = 0; f = 0
      constructor() {}
      multiply() { return this }
      translate() { return this }
      scale() { return this }
    }
  }
  if (typeof g.ImageData === 'undefined') {
    g.ImageData = class {
      constructor(public data?: unknown, public width?: number, public height?: number) {}
    }
  }
  if (typeof g.Path2D === 'undefined') {
    g.Path2D = class {
      constructor() {}
      moveTo() {}
      lineTo() {}
    }
  }
}

export const extractPosterDetails = action({
  args: { id: v.id('properties') },
  handler: async (ctx, { id }) => {
    const property: any = await ctx.runQuery(internal.properties.get, { id })
    if (!property) throw new Error('Property not found')
    if (!property.posterStorageId) throw new Error('No poster attached on this property')

    const blob = await ctx.storage.get(property.posterStorageId)
    if (!blob) throw new Error('Poster blob missing from storage')

    // pdf-parse / pdfjs-dist depend on a worker module that the Convex Node
    // runtime can't resolve, so the regex path has never produced text in
    // production. Gemini reads the PDF natively and is now the only path.
    const pdfBytes = new Uint8Array(await blob.arrayBuffer())
    const gemini = await extractWithGemini(pdfBytes)
    const geminiFields = gemini.fields
    const geminiNote = gemini.note
    const usedGemini = true
    const raw = ''
    const fields: Record<string, unknown> = { ...geminiFields }
    // ...but if regex left a matchability field undefined and Gemini got it,
    // take Gemini's value. The spread above already does this because regex
    // omits undefined keys.

    const patch: Record<string, unknown> = {
      posterExtractedAt: Date.now(),
      posterExtractionRaw: raw.slice(0, 8000),
      posterExtractionOk: Object.keys(fields).length > 0,
    }
    if (usedGemini) patch.posterExtractionRaw = `${patch.posterExtractionRaw}\n\n[gemini] ${geminiNote || '(no note)'}`
    for (const [k, v] of Object.entries(fields)) if (v !== undefined) patch[k] = v

    await ctx.runMutation(internal.properties.update, { id, patch: patch as any })

    return {
      ok: patch.posterExtractionOk,
      liftedFields: Object.keys(fields),
      rawLen: raw.length,
      usedGemini,
    }
  },
})
