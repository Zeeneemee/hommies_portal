// PropertyGuru URL helpers for the search flow. Pure — importable from any
// runtime and unit-testable. Mirrors extraction.ts's host check but adds a
// listing-path test so Firecrawl search results that point at agent pages,
// project pages, or the search index itself are filtered out.
import type { ParsedRequirement } from './requirementParse'

const PG_BASE = 'https://www.propertyguru.com.sg'

// Build a PropertyGuru rental search-results URL. Unlike a generic web search,
// PropertyGuru filters by bedroom count and price server-side via these query
// params, so scraping this page returns listings that actually match. `freetext`
// carries the location (school) + building type. Commute can't be expressed as
// a PG filter, so it only informs how broadly we set freetext (handled by the
// caller); proximity to the school is the best available proxy.
export function buildPropertyGuruSearchUrl(p: ParsedRequirement): string {
  const params = new URLSearchParams()
  params.set('market', 'residential')
  const free: string[] = []
  if (p.school && p.school !== 'OTHER') free.push(p.school)
  if (p.buildingType && p.buildingType !== 'Any') free.push(p.buildingType)
  if (free.length) params.set('freetext', free.join(' '))
  if (p.budget?.max && p.budget.max < 99999) params.set('maxprice', String(p.budget.max))
  if (p.budget?.min) params.set('minprice', String(p.budget.min))
  let qs = params.toString()
  // beds[] is a repeated/array param; URLSearchParams would encode it oddly, so
  // append it raw. Wrong/extra params are simply ignored by PropertyGuru.
  if (p.bedrooms) qs += `&beds%5B%5D=${p.bedrooms}`
  return `${PG_BASE}/property-for-rent?${qs}`
}

// Pull individual listing links out of a scraped PropertyGuru search-results
// page. De-duplicates by numeric listing id (the same listing can appear under
// several slug variants). Title is derived from the URL slug — search pages
// don't carry a clean per-card title we can rely on. Returns at most `limit`.
export function extractListingLinks(
  html: string,
  limit = 5,
): Array<{ url: string; title: string; snippet: string }> {
  const byId = new Map<string, { url: string; title: string; snippet: string }>()
  const re = /\/listing\/(\d+)([a-z0-9-]*)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const id = m[1]
    if (byId.has(id)) continue
    const slug = (m[2] || '').replace(/^-/, '').replace(/-/g, ' ').trim()
    const title = slug
      ? slug.replace(/\b\w/g, (c) => c.toUpperCase())
      : `Listing ${id}`
    byId.set(id, { url: `${PG_BASE}/listing/${id}${m[2] || ''}`, title, snippet: '' })
    if (byId.size >= limit) break
  }
  return [...byId.values()]
}

export function isPropertyGuruHost(url: string): boolean {
  try {
    const u = new URL(url)
    return /(^|\.)propertyguru\.com\.sg$/i.test(u.hostname)
  } catch {
    return false
  }
}

// A real rental listing has a /listing/<id> path. Project pages
// (/project/...), agent pages (/agent/...), and the search index
// (/property-for-rent) are not individual listings.
export function isPropertyGuruListing(url: string): boolean {
  if (!isPropertyGuruHost(url)) return false
  try {
    const u = new URL(url)
    return /\/listing\//i.test(u.pathname)
  } catch {
    return false
  }
}
