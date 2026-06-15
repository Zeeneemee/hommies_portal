// Listing-URL normalization for the scrape cache. Mirrors the frontend's
// src/listingUrl.js: collapse trivial variants (trailing slash, query/tracking
// params, fragment, `www.`, http-vs-https) to one stable key so the same page
// isn't scraped twice. Pure — safe to import from Convex actions.
export function normalizeListingUrl(raw: string): string {
  if (typeof raw !== 'string') return ''
  const t = raw.trim()
  if (!t) return ''
  try {
    const u = new URL(t)
    const host = u.hostname.toLowerCase().replace(/^www\./, '')
    const path = u.pathname.replace(/\/+$/, '')
    return `${host}${path}`.toLowerCase()
  } catch {
    return t.toLowerCase()
  }
}
