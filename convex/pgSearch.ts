// PropertyGuru link search — turns a customer's free-text requirement message
// into a small list of candidate PropertyGuru *listing links* via Firecrawl's
// search API (`/v1/search`). Links only: we do NOT scrape the pages here (that
// is extraction.ts's job for a known URL). The operator picks a link, then
// clientSheet:recordSent records it against the customer.
'use node'

import { action } from './_generated/server'
import { v } from 'convex/values'
import { GoogleGenAI } from '@google/genai'
import { parseGeminiJson, proxiedFetch } from './extraction'
import { parseRequirementMessage, buildSearchQuery } from './lib/requirementParse'
import type { ParsedRequirement } from './lib/requirementParse'
import {
  isPropertyGuruListing,
  buildPropertyGuruSearchUrl,
  extractListingLinks,
} from './lib/pgUrl'

const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash'

// The shape returned to the client for each candidate + the parsed customer so
// the frontend can hand the same object back to recordSent without re-parsing.
const candidateValidator = v.object({
  url: v.string(),
  title: v.string(),
  snippet: v.string(),
})

// When the regex parser leaves key fields at their defaults, ask Gemini to fill
// only the gaps. Best-effort: any failure (no key, rate limit, bad JSON) leaves
// the regex result untouched. Merges conservatively — Gemini never overwrites a
// field the regex already found.
async function geminiAugment(
  message: string,
  base: ParsedRequirement,
): Promise<ParsedRequirement> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return base
  const weak =
    !base.name ||
    !base.contact ||
    base.school === 'OTHER' ||
    (base.budget.min === 0 && base.budget.max === 99999)
  if (!weak) return base
  try {
    const ai = new GoogleGenAI({ apiKey })
    const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL
    const prompt =
      'Extract housing-search fields from this customer message. Reply with ONLY ' +
      'a JSON object with keys: name (string), contact (phone/email/handle string), ' +
      'school (one of NUS, NTU, SMU, OTHER), moveIn (string), leaseLength (string), ' +
      'budgetMin (number SGD/month), budgetMax (number SGD/month), ' +
      'buildingType (Condo, HDB, or Any), housingType (Room or Whole Unit), ' +
      'unitLayout (array of: Common Room, Master Room, Studio, Whole Unit), ' +
      'bedrooms (number, e.g. "2b1b" = 2), bathrooms (number, e.g. "2b1b" = 1), ' +
      'commuteTolMins (number), wantRoommate (boolean). Use empty string / 0 / ' +
      '[] when unknown.\n\nMessage:\n' +
      message
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: { responseMimeType: 'application/json' },
    })
    const g = parseGeminiJson(
      response.text ?? '',
      response.candidates?.[0]?.finishReason,
    ) as Record<string, unknown>
    const str = (x: unknown) => (typeof x === 'string' ? x.trim() : '')
    const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0)
    const merged: ParsedRequirement = { ...base }
    if (!merged.name && str(g.name)) merged.name = str(g.name)
    if (!merged.contact && str(g.contact)) merged.contact = str(g.contact)
    if (merged.school === 'OTHER' && /^(NUS|NTU|SMU)$/.test(str(g.school)))
      merged.school = str(g.school)
    if (!merged.moveIn && str(g.moveIn)) merged.moveIn = str(g.moveIn)
    if (!merged.leaseLength && str(g.leaseLength)) merged.leaseLength = str(g.leaseLength)
    if (merged.budget.min === 0 && merged.budget.max === 99999) {
      const mn = num(g.budgetMin)
      const mx = num(g.budgetMax)
      if (mx > 0) merged.budget = { min: mn > 0 ? mn : Math.max(0, mx - 300), max: mx }
    }
    if (!merged.bedrooms && num(g.bedrooms) > 0) merged.bedrooms = num(g.bedrooms)
    if (!merged.bathrooms && num(g.bathrooms) > 0) merged.bathrooms = num(g.bathrooms)
    return merged
  } catch {
    return base
  }
}

// Call Firecrawl /v1/search and return the raw result rows. Returns null when
// no key is configured so the caller can signal "not configured".
async function firecrawlSearch(query: string, limit: number): Promise<any[] | null> {
  const apiKey = process.env.FIRECRAWL_API_KEY
  if (!apiKey) return null
  const res = await fetch('https://api.firecrawl.dev/v1/search', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, limit }),
  })
  if (!res.ok) throw new Error(`Firecrawl search failed (HTTP ${res.status})`)
  const payload = (await res.json()) as any
  // Firecrawl has returned both `data: [...]` and `data: { web: [...] }`.
  const data = payload?.data
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.web)) return data.web
  return []
}

export const searchListings = action({
  args: { message: v.string(), name: v.optional(v.string()) },
  returns: v.object({
    ok: v.boolean(),
    note: v.string(),
    query: v.string(),
    parsed: v.any(),
    candidates: v.array(candidateValidator),
  }),
  handler: async (ctx, { message, name }) => {
    const text = String(message ?? '').trim()
    if (!text) {
      return { ok: false, note: 'Enter the requirement first.', query: '', parsed: null, candidates: [] }
    }

    const parsed = await geminiAugment(text, parseRequirementMessage(text))
    // An explicit customer name from the form always wins over what the parser
    // guessed from the message.
    const explicitName = String(name ?? '').trim()
    if (explicitName) parsed.name = explicitName
    // A human-readable description of what we searched, incl. commute (which
    // PropertyGuru can't filter on — proximity to the school is the proxy).
    const desc =
      buildSearchQuery(parsed) +
      (parsed.commuteTolMins && parsed.commuteTolMins !== 30
        ? ` · commute ≤ ${parsed.commuteTolMins}min`
        : '')

    // 1) Primary: scrape PropertyGuru's own search-results page. PG filters by
    // bedroom count + price server-side, so this honours "2b1b" and the budget.
    const searchUrl = buildPropertyGuruSearchUrl(parsed)
    try {
      const res = await proxiedFetch(ctx, searchUrl, { force: true })
      if (res.html && res.status < 400) {
        const candidates = extractListingLinks(res.html, 10)
        if (candidates.length > 0) {
          return { ok: true, note: 'ok', query: desc, parsed, candidates }
        }
      }
    } catch {
      /* fall through to the web-search fallback below */
    }

    // 2) Fallback: Firecrawl web search scoped to PropertyGuru. Less precise on
    // bedroom count, but recovers links when the results page is challenged.
    const webQuery = `${buildSearchQuery(parsed)} site:propertyguru.com.sg`.trim()
    let rows: any[] | null
    try {
      rows = await firecrawlSearch(webQuery, 10)
    } catch (err: any) {
      return { ok: false, note: err?.message || 'Search failed.', query: desc, parsed, candidates: [] }
    }
    if (rows === null) {
      return {
        ok: false,
        note: 'FIRECRAWL_API_KEY is not set on the Convex deployment — set it with `npx convex env set FIRECRAWL_API_KEY <key>`.',
        query: desc,
        parsed,
        candidates: [],
      }
    }

    const seen = new Set<string>()
    const candidates = rows
      .map((r) => ({
        url: String(r?.url ?? ''),
        title: String(r?.title ?? r?.metadata?.title ?? ''),
        snippet: String(r?.description ?? r?.snippet ?? ''),
      }))
      .filter((c) => isPropertyGuruListing(c.url))
      .filter((c) => (seen.has(c.url) ? false : (seen.add(c.url), true)))
      .slice(0, 10)

    if (candidates.length === 0) {
      return { ok: true, note: 'No matching PropertyGuru listings — refine the message and search again.', query: desc, parsed, candidates: [] }
    }
    return { ok: true, note: 'ok', query: desc, parsed, candidates }
  },
})
