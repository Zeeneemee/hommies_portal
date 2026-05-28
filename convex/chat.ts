// Agentic chat intake for property add — one step of the agent loop.
//
// The frontend (src/components/AddPropertyChat.jsx) drives a loop:
//   user types → chat.turn → Gemini returns text + tool calls → frontend
//   executes the tool calls (against existing portal actions + the draft) →
//   results fed back into chat.turn → repeat until Gemini stops calling tools.
//
// This file is one step of that loop: it owns the Gemini call only. Tool
// dispatch lives in the browser so tools that touch the draft (File blobs,
// object URLs) don't need a server round-trip.
//
// Local dev:
//   - Enable the route in the browser: VITE_ENABLE_CHAT_INTAKE=true in .env.local
//   - Optionally override the chat model: npx convex env set GEMINI_CHAT_MODEL gemini-2.5-pro
//   - GEMINI_API_KEY is the same Convex env var the rest of the portal uses.
'use node'

import { action } from './_generated/server'
import { v } from 'convex/values'
import { GoogleGenAI, Type, FunctionCallingConfigMode } from '@google/genai'

const DEFAULT_CHAT_MODEL = 'gemini-2.5-flash'

// Each transcript entry is one chat turn. The frontend owns IDs / timestamps;
// the action only cares about role + payload so it can rebuild SDK `contents`.
const messageArg = v.object({
  role: v.union(
    v.literal('user'),
    v.literal('model'),
    v.literal('function'),
  ),
  text: v.optional(v.string()),
  // For role: 'model' with function calls
  functionCalls: v.optional(
    v.array(
      v.object({
        name: v.string(),
        args: v.any(),
      }),
    ),
  ),
  // For role: 'function' — the result the frontend got after dispatching
  functionResponse: v.optional(
    v.object({
      name: v.string(),
      response: v.any(),
    }),
  ),
})

const draftSnapshotArg = v.object({
  condo: v.optional(v.string()),
  extracted: v.optional(v.any()),
  imagesMeta: v.optional(
    v.array(v.object({ name: v.string(), size: v.number() })),
  ),
  videoMeta: v.optional(
    v.object({ name: v.string(), size: v.number() }),
  ),
  posterMeta: v.optional(
    v.object({ name: v.string(), size: v.number() }),
  ),
})

const inlineImageArg = v.object({
  name: v.string(),
  mimeType: v.string(),
  dataB64: v.string(),
})

// ─────────────────────────────────────────────────────────────────────────
// Tool declarations
//
// The exact six-tool surface from the design doc. Names + arg shapes are the
// contract the spec enforces; the frontend dispatcher matches on `name`.
// ─────────────────────────────────────────────────────────────────────────
const DETAIL_KEYS = [
  'rentSGD', 'area', 'buildingType', 'housingType', 'ageYears', 'unitType',
  'sizeSqft', 'bedrooms', 'bathrooms', 'furnishing', 'availability',
  'fullAddress', 'listingTitle', 'commuteNUS', 'commuteNTU', 'commuteSMU',
]

const FUNCTION_DECLARATIONS = [
  {
    name: 'setCondo',
    description:
      "Set the property's condo / HDB / development name. Call this whenever the user names the property.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: 'Condo / HDB / development name, e.g. "Normanton Park"' },
      },
      required: ['name'],
    },
  },
  {
    name: 'setDetail',
    description: `Set one detail field on the draft. Use this for any single fact you can extract from the operator's message. Allowed keys: ${DETAIL_KEYS.join(', ')}. For currency keys (rentSGD), strip "S$" / "$" / commas. For commute keys (commuteNUS / commuteNTU / commuteSMU), value is minutes (number).`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        key: {
          type: Type.STRING,
          description: 'Detail field name. One of the allowed keys.',
          enum: DETAIL_KEYS,
        },
        value: {
          // Gemini's schema doesn't support a true union — describe in text.
          // The frontend coerces strings to numbers for known-numeric keys.
          type: Type.STRING,
          description: 'Value to set. Numbers may be passed as strings; the frontend coerces.',
        },
      },
      required: ['key', 'value'],
    },
  },
  {
    name: 'extractFromPropertyGuruUrl',
    description:
      "Fetch a PropertyGuru listing URL and lift its structured facts (rent, area, building type, unit type, size, etc.) plus image URLs. Call this whenever the operator pastes a propertyguru.com.sg listing link. The returned image URLs are auto-attached to the draft when there's room.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        url: { type: Type.STRING, description: 'Full PropertyGuru listing URL.' },
      },
      required: ['url'],
    },
  },
  {
    name: 'attachImageUrls',
    description:
      "Fetch one or more remote image URLs (e.g. from a listing page or a Google Drive direct link) and attach them to the draft. Do NOT call this for PropertyGuru URLs — extractFromPropertyGuruUrl already attaches the images itself.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        urls: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'List of fully-qualified image URLs.',
        },
      },
      required: ['urls'],
    },
  },
  {
    name: 'generatePoster',
    description:
      "Render the Hommies-branded 3-page poster PDF for the current draft. Requires condo, rent, housing type, and at least one image already on the draft. Call this only when the operator explicitly asks for a poster, or right before requestSaveConfirmation if a poster has not yet been generated.",
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: 'requestSaveConfirmation',
    description:
      "Render the save preview card for the operator to confirm. Call this when you believe the draft has enough to save (at minimum: condo, and at least one image or a video). The operator clicks Save explicitly — you must never assume the property is saved.",
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
]

// ─────────────────────────────────────────────────────────────────────────
// System prompt
//
// The agent's job + tool semantics + WhatsApp-blob examples. The "EXAMPLES"
// block teaches Gemini the concrete tool-call sequence on common inputs.
// ─────────────────────────────────────────────────────────────────────────
const SYSTEM_INSTRUCTION = `You are the property-intake agent inside the Hommies.sg internal portal. Hommies is a Singapore student-housing service — operators feed you messy WhatsApp messages from agents, PropertyGuru links, photos, and walk-through videos, and you build a property record together with the operator.

YOUR JOB
- Read the operator's messages and decide which tool to call next. You drive the loop.
- Extract every fact you can from text. WhatsApp message blobs are the dominant input.
- For each fact, call setCondo or setDetail to record it on the draft.
- When the operator pastes a propertyguru.com.sg URL, call extractFromPropertyGuruUrl — it lifts structured facts AND attaches the listing images automatically.
- When a remote image URL appears (Google Drive, CDN, etc.) that is NOT a PropertyGuru URL, call attachImageUrls.
- When the draft has condo + at least one image or video, call requestSaveConfirmation. The operator will confirm in the UI; you must NEVER claim the property has been saved.
- Talk to the operator only when you need clarification or to confirm progress. Be terse — one short sentence per assistant turn.

DRAFT STATE
At every turn you'll see a JSON-serialised snapshot of the current draft so you know what's already captured. Don't re-set fields that already match. If a field is wrong, you can overwrite it by calling setDetail with the corrected value.

ALLOWED setDetail KEYS
${DETAIL_KEYS.join(', ')}
- rentSGD: integer S$ per month. Strip "S$", "$", commas.
- buildingType: "Condo" or "HDB".
- housingType: "Room" or "Whole Unit".
- commute*: minutes, integer.

EXAMPLES

1. Operator pastes a WhatsApp blob:
   "Lakeville Studio 🏙️ $3.3k / mo, ready 1 Jul, near Lakeside MRT. https://www.propertyguru.com.sg/listing/123"

   Your tool plan (across one or more turns):
   - setCondo("Lakeville")
   - setDetail("rentSGD", 3300)
   - setDetail("availability", "1 Jul")
   - setDetail("unitType", "Studio")
   - setDetail("housingType", "Whole Unit")
   - extractFromPropertyGuruUrl("https://www.propertyguru.com.sg/listing/123")
   Then a short reply like: "Got it. Lakeville studio, $3.3k, extracting the PG link for the rest."

2. Operator pastes prose only (no link):
   "Normanton Park 1BR, 2800, ready July"

   - setCondo("Normanton Park")
   - setDetail("rentSGD", 2800)
   - setDetail("unitType", "1 Bedroom")
   - setDetail("housingType", "Whole Unit")
   - setDetail("availability", "July")
   Then ask: "Got it. Got any photos or a walk-through video to attach?"

3. Operator says "save it":
   - If the draft has condo + (image OR video), call requestSaveConfirmation.
   - If not, ask what's missing (e.g. "Need at least one photo or video first — can you share?").

RULES
- One short assistant message per turn. The operator is busy.
- Never invent values. If a field isn't in the input, skip it.
- Never call requestSaveConfirmation without condo set.
- Never claim the save happened — only the operator can confirm.
- When in doubt, ask.`

interface PlainPart {
  text?: string
  inlineData?: { mimeType: string; data: string }
  functionCall?: { name: string; args: Record<string, unknown> }
  functionResponse?: { name: string; response: Record<string, unknown> }
}

function transcriptToContents(
  transcript: any[],
  latestUserText: string | undefined,
  inlineImages: any[] | undefined,
): Array<{ role: 'user' | 'model' | 'function'; parts: PlainPart[] }> {
  const contents: Array<{ role: 'user' | 'model' | 'function'; parts: PlainPart[] }> = []
  for (const m of transcript) {
    if (m.role === 'user') {
      const parts: PlainPart[] = []
      if (m.text) parts.push({ text: m.text })
      if (parts.length > 0) contents.push({ role: 'user', parts })
    } else if (m.role === 'model') {
      const parts: PlainPart[] = []
      if (m.text) parts.push({ text: m.text })
      for (const fc of m.functionCalls || []) {
        parts.push({ functionCall: { name: fc.name, args: fc.args || {} } })
      }
      if (parts.length > 0) contents.push({ role: 'model', parts })
    } else if (m.role === 'function' && m.functionResponse) {
      contents.push({
        role: 'function',
        parts: [
          {
            functionResponse: {
              name: m.functionResponse.name,
              response: m.functionResponse.response || {},
            },
          },
        ],
      })
    }
  }
  // Append the latest user turn (with optional inline images) if the caller
  // gave it separately. We accept this as a convenience for the initial turn
  // where the frontend hasn't yet pushed the message into the transcript.
  if (latestUserText || (inlineImages && inlineImages.length > 0)) {
    const parts: PlainPart[] = []
    if (latestUserText) parts.push({ text: latestUserText })
    for (const img of inlineImages || []) {
      parts.push({ inlineData: { mimeType: img.mimeType, data: img.dataB64 } })
    }
    contents.push({ role: 'user', parts })
  }
  return contents
}

function explainGeminiError(err: any, model: string): string {
  const msg = String(err?.message || err || 'unknown error')
  if (msg.includes('limit: 0')) {
    return `Gemini (${model}) has zero quota for this project (regional or free-tier restriction). Enable billing or set GEMINI_CHAT_MODEL to a model your project can call.`
  }
  if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
    return `Gemini (${model}) returned 429 (rate limit / quota). Wait a moment and retry, or switch model via GEMINI_CHAT_MODEL.`
  }
  if (msg.includes('401') || msg.includes('API key') || msg.includes('invalid')) {
    return `Gemini (${model}) rejected the API key. Re-issue at aistudio.google.com/apikey and update with: npx convex env set GEMINI_API_KEY <new-key>.`
  }
  if (msg.includes('not found') || msg.includes('NOT_FOUND') || msg.includes('does not exist')) {
    return `Gemini reports model "${model}" is unavailable. Set GEMINI_CHAT_MODEL to a valid model.`
  }
  return `Gemini (${model}) call failed: ${msg}`
}

export const turn = action({
  args: {
    transcript: v.array(messageArg),
    draft: draftSnapshotArg,
    latestUserText: v.optional(v.string()),
    inlineImages: v.optional(v.array(inlineImageArg)),
  },
  handler: async (
    _ctx,
    { transcript, draft, latestUserText, inlineImages },
  ): Promise<{
    ok: boolean
    text?: string
    functionCalls?: Array<{ name: string; args: Record<string, unknown> }>
    finishReason?: string
    note?: string
  }> => {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return {
        ok: false,
        note: 'GEMINI_API_KEY is not set on this Convex deployment. Run `npx convex env set GEMINI_API_KEY <key>` to enable chat intake.',
      }
    }

    const model = process.env.GEMINI_CHAT_MODEL || DEFAULT_CHAT_MODEL
    const ai = new GoogleGenAI({ apiKey })

    // The draft snapshot rides with the latest user message as a hidden
    // preamble so Gemini always sees what's already on the draft and won't
    // re-call setDetail for keys it has already filled.
    const draftPreamble = `[DRAFT STATE]\n${JSON.stringify(draft || {}, null, 2)}\n[/DRAFT STATE]`
    const userTextWithDraft = latestUserText
      ? `${draftPreamble}\n\n${latestUserText}`
      : draftPreamble

    try {
      const response: any = await ai.models.generateContent({
        model,
        contents: transcriptToContents(transcript, userTextWithDraft, inlineImages),
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          temperature: 0.2,
          thinkingConfig: { thinkingBudget: 0 },
          maxOutputTokens: 8192,
          tools: [{ functionDeclarations: FUNCTION_DECLARATIONS as any }],
          toolConfig: {
            functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO },
          },
        },
      })

      const finishReason = response?.candidates?.[0]?.finishReason

      // Collect function calls + the text reply (if any) from the model turn.
      // The SDK exposes both `response.text` and the raw candidate parts.
      const text: string = (response?.text || '').trim()
      const callsRaw: any[] = Array.isArray(response?.functionCalls)
        ? response.functionCalls
        : []
      const functionCalls = callsRaw.map((fc) => ({
        name: String(fc?.name || ''),
        args: (fc?.args || {}) as Record<string, unknown>,
      }))

      return {
        ok: true,
        text: text || undefined,
        functionCalls: functionCalls.length ? functionCalls : undefined,
        finishReason,
      }
    } catch (err: any) {
      return {
        ok: false,
        note: explainGeminiError(err, model),
      }
    }
  },
})
