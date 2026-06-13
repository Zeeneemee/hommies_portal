// Poster-detail extraction — loads the attached poster PDF, pulls its text,
// parses the labeled "Facts" block, and patches the property record with
// whatever fields it could lift. Tolerant: missing values just stay absent.
'use node'

import { action, internalAction } from './_generated/server'
import { api, internal } from './_generated/api'
import { v } from 'convex/values'
import { parsePosterText } from './posterExtraction'
import { deriveBedroomTag, mergeBedroomTag } from './lib/bedroomTags'
import { GoogleGenAI } from '@google/genai'

const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash'

// Robust JSON parse for Gemini responses. `responseMimeType: 'application/json'`
// usually produces pure JSON, but in the wild we still see (a) markdown
// fences, (b) trailing prose appended after the JSON object, and (c) silent
// truncation at maxOutputTokens that leaves the JSON unterminated. Try four
// strategies in order; the last is a brace-balanced scan that recovers any
// well-formed `{...}` substring, surviving both leading and trailing garbage.
// finishReason is surfaced in the error so MAX_TOKENS truncation is obvious.
export function parseGeminiJson(
  text: string,
  finishReason?: string,
): unknown {
  const trimmed = (text || '').trim()
  if (!trimmed) {
    throw new Error(
      `empty response${finishReason ? ` (finishReason=${finishReason})` : ''}`,
    )
  }
  try {
    return JSON.parse(trimmed)
  } catch {}
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]+?)\s*```/i)
  if (fenced) {
    try {
      return JSON.parse(fenced[1])
    } catch {}
  }
  // Brace-balanced scan: find the first '{' and walk forward tracking nesting
  // depth + string state. Returns the slice from that '{' through the matching
  // '}'. Tolerates leading and trailing non-JSON content. If the scan never
  // closes the object (truncated mid-write), throw with finishReason.
  const start = trimmed.indexOf('{')
  if (start !== -1) {
    let depth = 0
    let inStr = false
    let escape = false
    for (let i = start; i < trimmed.length; i++) {
      const ch = trimmed[i]
      if (inStr) {
        if (escape) escape = false
        else if (ch === '\\') escape = true
        else if (ch === '"') inStr = false
        continue
      }
      if (ch === '"') {
        inStr = true
        continue
      }
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          try {
            return JSON.parse(trimmed.slice(start, i + 1))
          } catch {
            break
          }
        }
      }
    }
  }
  const truncationHint =
    finishReason === 'MAX_TOKENS'
      ? ' (response was truncated at maxOutputTokens — raise the cap)'
      : finishReason
        ? ` (finishReason=${finishReason})`
        : ''
  throw new Error(
    `non-JSON response${truncationHint}: ${trimmed.slice(0, 300)}`,
  )
}

function pickFinishReason(response: any): string | undefined {
  return response?.candidates?.[0]?.finishReason
}

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
  "commuteMins": { "NUS": number, "NTU": number, "SMU": number },  // all three required as integers; omit the whole object if any is missing
  "bedrooms": number,                      // total bedroom count for whole-unit listings. Used by the sanitiser to infer master/common when the poster doesn't name them explicitly. Omit for room rentals.
  "masterCount": number,                   // number of master bedrooms (whole-unit listings only). Omit if poster does not say.
  "commonCount": number                    // number of common bedrooms (whole-unit listings only). Omit if poster does not say.
}

Strip "~" from approximate commute values. Strip currency symbols and commas from rent. For whole-unit listings, count master and common bedrooms separately when the poster names them — otherwise return just "bedrooms" and the system will fall back to the SG convention (1 master + remainder common).`

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
    let parsed: any = parseGeminiJson(text, pickFinishReason(response))
    if (Array.isArray(parsed)) {
      const first = parsed.find((v) => v && typeof v === 'object' && !Array.isArray(v))
      if (first) parsed = first
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
  // Be forgiving on the union fields — Gemini sometimes emits "condo" / "Hdb"
  // / "whole unit" with off-casing. Normalise to the literal values the
  // schema accepts.
  if (typeof raw.buildingType === 'string') {
    const bt = raw.buildingType.trim().toLowerCase()
    if (bt === 'condo' || bt === 'condominium') out.buildingType = 'Condo'
    else if (bt === 'hdb') out.buildingType = 'HDB'
  }
  if (typeof raw.housingType === 'string') {
    const ht = raw.housingType.trim().toLowerCase()
    if (ht === 'room' || ht === 'single room') out.housingType = 'Room'
    else if (ht === 'whole unit' || ht === 'entire unit' || ht === 'whole-unit') out.housingType = 'Whole Unit'
  }
  if (num(raw.ageYears) != null && num(raw.ageYears)! >= 0) out.ageYears = num(raw.ageYears)
  if (typeof raw.unitType === 'string' && raw.unitType.trim()) out.unitType = raw.unitType.trim()
  if (typeof raw.fullAddress === 'string' && raw.fullAddress.trim()) out.fullAddress = raw.fullAddress.trim()
  if (num(raw.sizeSqft) != null && num(raw.sizeSqft)! > 0) out.sizeSqft = num(raw.sizeSqft)
  if (num(raw.bedrooms) != null && num(raw.bedrooms)! > 0) out.bedrooms = num(raw.bedrooms)
  if (num(raw.bathrooms) != null && num(raw.bathrooms)! > 0) out.bathrooms = num(raw.bathrooms)
  const mc = num(raw.masterCount)
  if (mc != null && mc >= 0 && Number.isInteger(mc)) out.masterCount = mc
  const cc = num(raw.commonCount)
  if (cc != null && cc >= 0 && Number.isInteger(cc)) out.commonCount = cc
  // PropertyGuru almost never breaks bedrooms into master/common. If we have
  // a total bedroom count but no breakdown, assume the SG convention: one
  // master, the rest common. The operator can still override in the edit
  // modal. (Studios → bedrooms=1 still produces master=1, common=0, which
  // matches how they're shared in practice.)
  if (typeof out.bedrooms === 'number' && out.bedrooms >= 1) {
    if (out.masterCount === undefined) out.masterCount = 1
    if (out.commonCount === undefined) out.commonCount = Math.max(0, out.bedrooms - 1)
  }
  if (typeof raw.furnishing === 'string' && raw.furnishing.trim()) out.furnishing = raw.furnishing.trim()
  if (typeof raw.availability === 'string' && raw.availability.trim()) out.availability = raw.availability.trim()
  if (typeof raw.listingTitle === 'string' && raw.listingTitle.trim()) out.listingTitle = raw.listingTitle.trim()
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

// PropertyGuru listing URL → structured fields, mirroring the poster schema.
//
// Approach: fetch the HTML server-side with a real browser User-Agent, strip
// scripts/styles (but keep JSON-LD), trim to a token-safe size, and let Gemini
// extract the same fields the poster path produces. We do NOT persist anything
// here — the client uses the returned fields to prefill the Add Property form.
//
// Caveat: PropertyGuru sits behind Cloudflare. A plain server fetch works for
// many listings but can be challenged. When that happens we return a clear
// error so the operator falls back to manual entry.
function isPropertyGuruUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return /(^|\.)propertyguru\.com\.sg$/i.test(u.hostname)
  } catch {
    return false
  }
}

// Scrape PropertyGuru listings via Firecrawl `/v1/scrape`. Requires
// FIRECRAWL_API_KEY in Convex env. Firecrawl bypasses Cloudflare and
// JS-renders by default, so lazy-loaded gallery images appear in the HTML.
async function proxiedFetch(targetUrl: string): Promise<{ status: number; html: string }> {
  const apiKey = process.env.FIRECRAWL_API_KEY
  if (!apiKey) {
    return { status: 500, html: '' }
  }

  const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: targetUrl,
      formats: ['html'],
      onlyMainContent: false,
    }),
  })

  if (!res.ok) {
    return { status: res.status, html: '' }
  }

  const payload = (await res.json()) as {
    success?: boolean
    data?: { html?: string; metadata?: { statusCode?: number } }
  }
  const status = payload.data?.metadata?.statusCode ?? (payload.success ? 200 : 502)
  const html = payload.data?.html ?? ''
  return { status, html }
}

function looksBlocked(html: string, status: number): string | null {
  if (status === 403 || status === 429) return `blocked (HTTP ${status})`
  if (status >= 400) return `HTTP ${status}`
  const head = html.slice(0, 4000).toLowerCase()
  if (head.includes('just a moment') || head.includes('cf-chl') || head.includes('cloudflare')) {
    if (head.includes('challenge') || head.includes('verifying you are human')) {
      return 'Cloudflare challenge page'
    }
  }
  return null
}

// Keep meta tags + JSON-LD (gold for extraction) and visible text; drop
// scripts/styles/svg to shrink the payload Gemini sees.
function distillHtml(html: string): string {
  const ldJson: string[] = []
  html.replace(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi, (_, body) => {
    ldJson.push(body.trim())
    return ''
  })
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
  const metas: string[] = []
  stripped.replace(/<meta[^>]+>/gi, (m) => { metas.push(m); return '' })
  const titleMatch = stripped.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const bodyMatch = stripped.match(/<body[\s\S]*<\/body>/i)
  const body = bodyMatch ? bodyMatch[0] : stripped
  const text = body
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const parts = [
    titleMatch ? `TITLE: ${titleMatch[1].trim()}` : '',
    metas.length ? `META:\n${metas.join('\n')}` : '',
    ldJson.length ? `JSON_LD:\n${ldJson.join('\n---\n')}` : '',
    `BODY_TEXT:\n${text}`,
  ].filter(Boolean)
  const joined = parts.join('\n\n')
  return joined.length > 60_000 ? joined.slice(0, 60_000) : joined
}

// Pull every plausible listing image URL out of the HTML. PG renders the hero
// in og:image and the full gallery in JSON-LD; we union both and dedupe.
// Conservative — every URL must end in an image extension. Anything broader
// ended up sweeping listing links and breaking the download step.
function extractImageUrls(html: string): string[] {
  const urls = new Set<string>()
  // JSON-unescape so URLs inside script blobs (`\/`) are reachable.
  const unescaped = html.replace(/\\\//g, '/')
  const add = (raw: any) => {
    if (typeof raw !== 'string') return
    const u = raw.trim().replace(/\\\//g, '/')
    if (!u) return
    if (!/^https?:\/\//i.test(u)) return
    if (!/\.(?:jpg|jpeg|png|webp)(?:\?|$|#)/i.test(u)) return
    if (/avatar|placeholder|sprite|favicon|logo|icon[-_]/i.test(u)) return
    urls.add(u)
  }
  // og:image / twitter:image — both attribute orders.
  for (const m of unescaped.matchAll(
    /<meta[^>]+(?:property|name)=["'](?:og:image|og:image:secure_url|twitter:image)["'][^>]*content=["']([^"']+)["']/gi,
  )) add(m[1])
  for (const m of unescaped.matchAll(
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|og:image:secure_url|twitter:image)["']/gi,
  )) add(m[1])
  // JSON-LD image fields (string | string[] | {url}[]).
  const walk = (data: any) => {
    if (!data) return
    if (Array.isArray(data)) { data.forEach(walk); return }
    if (typeof data !== 'object') return
    if ('image' in data) {
      const img = (data as any).image
      if (typeof img === 'string') add(img)
      else if (Array.isArray(img)) for (const i of img) {
        if (typeof i === 'string') add(i)
        else if (i && typeof i === 'object') add((i as any).url || (i as any).contentUrl)
      }
      else if (img && typeof img === 'object') add(img.url || img.contentUrl)
    }
    for (const k in data) walk((data as any)[k])
  }
  for (const m of html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try { walk(JSON.parse(m[1])) } catch { /* skip malformed */ }
  }
  // Sweep the unescaped HTML for any image URL on a known PG CDN.
  for (const m of unescaped.matchAll(
    /https?:\/\/[^\s"'<>\\]+\.(?:jpg|jpeg|png|webp)(?:\?[^\s"'<>\\]*)?/gi,
  )) {
    const u = m[0]
    if (/(pgimgs|propertyguru|guruimages|sg-prdcms|sg\.production\.urbanc|cloudfront)/i.test(u)) {
      add(u)
    }
  }
  return Array.from(urls).slice(0, 20)
}

// PropertyGuru listings link back to the development's project page, which
// has the official facilities + nearby amenities list. Pull the first
// `/project/<slug>` URL we see in the HTML so the client can ask us to scrape
// it for verified facilities (see fetchProjectPageText below).
function extractProjectUrl(html: string): string | undefined {
  const unescaped = html.replace(/\\\//g, '/')
  const m = unescaped.match(/https?:\/\/(?:www\.)?propertyguru\.com\.sg\/project\/[a-z0-9-]+/i)
  if (m) return m[0]
  // Sometimes only the relative path is in the HTML.
  const rel = unescaped.match(/\/project\/[a-z0-9-]+/i)
  if (rel) return `https://www.propertyguru.com.sg${rel[0]}`
  return undefined
}

async function extractUrlWithGemini(distilled: string): Promise<{
  fields: Record<string, unknown>
  suggestedCondo?: string
  note?: string
}> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return { fields: {}, note: 'GEMINI_API_KEY not set' }
  const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL
  const ai = new GoogleGenAI({ apiKey })

  const SYSTEM = `You read the distilled HTML of a PropertyGuru Singapore listing page and extract structured facts.

Return ONLY a single JSON object (NOT an array, NOT wrapped in [...]) — no prose, no markdown fences. The response must start with { and end with }. Use these exact keys; omit any key you cannot confidently determine from the page content. Do not invent values.

{
  "condo": string,                         // development / building name, e.g. "Normanton Park"
  "rentSGD": number,                       // monthly rent in S$, integer
  "area": string,                          // neighbourhood / district, e.g. "Kent Ridge"
  "buildingType": "Condo" | "HDB",
  "housingType": "Room" | "Whole Unit",    // "Room" if it's a single room rental, otherwise "Whole Unit"
  "ageYears": number,                      // building age in years if visible
  "unitType": "Common Room" | "Master Room" | "Studio" | "Whole Unit",
  "fullAddress": string,                   // full street address if shown
  "sizeSqft": number,                      // floor area in square feet, integer (just the number)
  "bedrooms": number,                      // number of bedrooms in the unit
  "bathrooms": number,                     // number of bathrooms in the unit
  "masterCount": number,                   // number of master bedrooms (whole-unit listings only). Omit if the listing does not say.
  "commonCount": number,                   // number of common bedrooms (whole-unit listings only). Omit if the listing does not say.
  "furnishing": string,                    // e.g. "Fully furnished", "Partially furnished", "Unfurnished"
  "availability": string,                  // when the unit is available, e.g. "Ready to move in", "1 Jul 2026"
  "listingTitle": string                   // the listing's headline as written, e.g. "1 Bedroom Studio (Type A2) — high floor, balcony"
}

Strip "S$", "$", commas from numeric values. If the listing says "Studio" use unitType "Studio" and housingType "Whole Unit". If unsure between Condo and HDB, omit buildingType. For sizeSqft, prefer the value shown in the property details table over anything in the description.`

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [{ text: `Extract the structured facts from this listing.\n\n${distilled}` }],
        },
      ],
      config: {
        systemInstruction: SYSTEM,
        temperature: 0.0,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget: 0 },
        // 4096 (up from 2048) so the 14-field schema has comfortable margin
        // when the listing has long fullAddress / listingTitle values.
        maxOutputTokens: 4096,
      },
    })
    const text = (response.text || '').trim()
    let parsed = parseGeminiJson(text, pickFinishReason(response)) as any
    // Gemini sometimes wraps the result in [...] despite responseMimeType +
    // an explicit "single object, not an array" hint in the system prompt.
    // Treat a single-element array of objects as the same shape.
    if (Array.isArray(parsed)) {
      const first = parsed.find((v) => v && typeof v === 'object' && !Array.isArray(v))
      if (!first) {
        return { fields: {}, note: `Gemini returned an array with no object inside: ${text.slice(0, 300)}` }
      }
      parsed = first
    }
    const fields = sanitiseGeminiFields(parsed)
    // Derive the bedroom tag from the sanitised count so the client persists it
    // on save (no prior server-side tags exist on this not-yet-saved listing).
    const bedroomTag = deriveBedroomTag({
      bedrooms: fields.bedrooms as number | undefined,
      unitType: fields.unitType as string | undefined,
    })
    if (bedroomTag) fields.tags = mergeBedroomTag(undefined, bedroomTag)
    const suggestedCondo =
      typeof parsed?.condo === 'string' && parsed.condo.trim() ? parsed.condo.trim() : undefined
    const note = `raw=${text.slice(0, 500)} | keys=${Object.keys(fields).join(',') || '(none)'}`
    return { fields, suggestedCondo, note }
  } catch (err: any) {
    return { fields: {}, note: `Gemini extraction failed: ${err?.message || err}` }
  }
}

export const extractPropertyGuruUrl = action({
  args: { url: v.string() },
  handler: async (_ctx, { url }) => {
    if (!isPropertyGuruUrl(url)) {
      return {
        ok: false,
        fields: {},
        suggestedCondo: undefined as string | undefined,
        error: 'URL must be on propertyguru.com.sg',
      }
    }

    let html = ''
    let status = 0
    try {
      const res = await proxiedFetch(url)
      status = res.status
      html = res.html
    } catch (err: any) {
      return {
        ok: false,
        fields: {},
        suggestedCondo: undefined as string | undefined,
        error: `Fetch failed: ${err?.message || err}`,
      }
    }

    const blocked = looksBlocked(html, status)
    if (blocked) {
      const hasProxy = !!(process.env.SCRAPEDO_API_KEY || process.env.SCRAPER_API_KEY || process.env.SCRAPINGBEE_API_KEY)
      const head = html.slice(0, 500).toLowerCase()
      const quotaHit =
        head.includes('exhausted the api credits') ||
        head.includes('exhausted your') ||
        head.includes('monthly cycle') ||
        head.includes('credit limit')
      const hint = quotaHit
        ? 'Scraping proxy is out of credits. Upgrade the plan, enable overages, or wait for the next billing cycle.'
        : hasProxy
        ? 'The proxy returned a block. Some listings need premium proxy / JS rendering — enable those flags or try a different listing.'
        : 'Set SCRAPER_API_KEY or SCRAPINGBEE_API_KEY in Convex env to route through a residential proxy.'
      return {
        ok: false,
        fields: {},
        suggestedCondo: undefined as string | undefined,
        error: `PropertyGuru ${blocked}. ${hint}`,
      }
    }

    const distilled = distillHtml(html)
    const imageUrls = extractImageUrls(html)
    const projectUrl = extractProjectUrl(html)
    const { fields, suggestedCondo, note } = await extractUrlWithGemini(distilled)
    return {
      ok: Object.keys(fields).length > 0 || !!suggestedCondo || imageUrls.length > 0,
      fields,
      suggestedCondo,
      imageUrls,
      projectUrl,
      note,
    }
  },
})

// Fetch + distill a PropertyGuru project page (the development-level URL
// like `propertyguru.com.sg/project/<slug>`). The project page carries the
// official facilities list + nearby amenities that listing pages do not.
// The poster generator calls this to ground Gemini in real data so it does
// not fabricate facilities for unknown condos.
export const fetchProjectPageText = action({
  args: { url: v.string() },
  handler: async (_ctx, { url }) => {
    if (!isPropertyGuruUrl(url)) {
      return { ok: false as const, text: '', note: 'Not a PropertyGuru URL' }
    }
    try {
      const res = await proxiedFetch(url)
      const blocked = looksBlocked(res.html, res.status)
      if (blocked) {
        return { ok: false as const, text: '', note: `Project page ${blocked}` }
      }
      return { ok: true as const, text: distillHtml(res.html), note: 'ok' }
    } catch (err: any) {
      return { ok: false as const, text: '', note: err?.message || String(err) }
    }
  },
})

// Fetch remote image URLs server-side (PG images aren't CORS-friendly from
// the browser) and return their bytes as base64 so the client can wrap each
// in a File and add it to the same images array as user uploads. From there
// the existing save flow uploads them to Convex storage and the poster prompt
// generator picks them up automatically — no parallel image pipeline needed.
//
// Cap at 8 images / ~6MB total: Convex action responses are bounded and PG
// hero images are already ~150-300KB each. Failed URLs are reported in
// `skipped` rather than aborting the whole batch.
export const fetchImagesAsData = action({
  args: { urls: v.array(v.string()) },
  handler: async (_ctx, { urls }) => {
    const images: Array<{ name: string; contentType: string; size: number; dataB64: string }> = []
    const skipped: Array<{ url: string; reason: string }> = []
    let totalBytes = 0
    const BYTE_BUDGET = 10 * 1024 * 1024
    for (const url of urls.slice(0, 12)) {
      try {
        const res = await fetch(url, {
          redirect: 'follow',
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
            Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
            Referer: 'https://www.propertyguru.com.sg/',
          },
        })
        if (!res.ok) {
          skipped.push({ url, reason: `HTTP ${res.status}` })
          continue
        }
        const buf = new Uint8Array(await res.arrayBuffer())
        if (buf.length === 0) { skipped.push({ url, reason: 'empty body' }); continue }
        if (totalBytes + buf.length > BYTE_BUDGET) { skipped.push({ url, reason: 'byte budget exceeded' }); continue }
        totalBytes += buf.length
        let bin = ''
        for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i])
        const dataB64 = btoa(bin)
        const contentType = res.headers.get('content-type') || 'image/jpeg'
        let name = 'pg-image.jpg'
        try {
          const parsed = new URL(url)
          const seg = parsed.pathname.split('/').pop() || ''
          if (seg && /\.(jpg|jpeg|png|webp)$/i.test(seg)) name = seg
        } catch { /* ignore */ }
        images.push({ name, contentType, size: buf.length, dataB64 })
      } catch (err: any) {
        skipped.push({ url, reason: err?.message || 'fetch failed' })
      }
    }
    return { images, skipped }
  },
})

// One-shot backfill — re-extracts poster-bearing properties so existing prod
// rows recover their bedroom count and get the derived bedroom tag. Processes a
// bounded `batchSize` of rows per invocation (each poster is a Gemini call, and
// a single Convex action can't run long enough to do all of them) then
// self-schedules the next batch via `offset` until the inventory is exhausted.
// Kick it off with `convex run extraction:backfillBedroomTags`; the chain
// finishes in the background. Each row is re-extracted in its own try/catch so
// one bad PDF can't abort the batch, and extractPosterDetails commits per-row,
// so progress survives even if a batch dies. Rows whose poster yields no
// bedroom count are left untagged (the operator can set the count in the edit
// modal). Returns this batch's tally plus how many rows remain.
export const backfillBedroomTags = internalAction({
  args: { offset: v.optional(v.number()), batchSize: v.optional(v.number()) },
  handler: async (
    ctx,
    args,
  ): Promise<{
    totalPosterRows: number
    offset: number
    processed: number
    tagged: number
    skipped: number
    failed: number
    remaining: number
  }> => {
    const offset = args.offset ?? 0
    const batchSize = args.batchSize ?? 15
    const posterRows = (await ctx.runQuery(internal.properties.listForBackfill, {})).filter(
      (r) => r.hasPoster,
    )
    const batch = posterRows.slice(offset, offset + batchSize)
    let tagged = 0
    let skipped = 0
    let failed = 0
    for (const row of batch) {
      try {
        const res = await ctx.runAction(api.extraction.extractPosterDetails, { id: row._id })
        if (res?.bedroomTag) tagged++
        else skipped++
      } catch (err) {
        console.warn(`[backfillBedroomTags] ${row._id} failed:`, err)
        failed++
      }
    }
    const nextOffset = offset + batch.length
    const remaining = Math.max(0, posterRows.length - nextOffset)
    // Driven batch-by-batch from the CLI (no in-Convex self-scheduling) so a
    // transient platform error fails one batch instead of silently breaking a
    // chain. The caller advances `offset` until `remaining` is 0.
    console.log(
      `[backfillBedroomTags] offset=${offset} processed=${batch.length} tagged=${tagged} skipped=${skipped} failed=${failed} remaining=${remaining}`,
    )
    return {
      totalPosterRows: posterRows.length,
      offset,
      processed: batch.length,
      tagged,
      skipped,
      failed,
      remaining,
    }
  },
})

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
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined) continue
      patch[k] = v
    }

    // Bedroom tag: derive from the freshly-lifted count and merge into the
    // property's existing tags, replacing any prior bedroom tag (idempotent on
    // re-extraction) while preserving non-bedroom tags.
    const bedroomTag = deriveBedroomTag({
      bedrooms: fields.bedrooms as number | undefined,
      unitType: (fields.unitType ?? property.unitType) as string | undefined,
    })
    if (bedroomTag) patch.tags = mergeBedroomTag(property.tags, bedroomTag)

    await ctx.runMutation(internal.properties.update, { id, patch: patch as any })

    return {
      ok: patch.posterExtractionOk,
      liftedFields: Object.keys(fields),
      bedroomTag: bedroomTag ?? null,
      rawLen: raw.length,
      usedGemini,
    }
  },
})
