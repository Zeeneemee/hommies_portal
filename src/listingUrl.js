// Listing-URL normalization for duplicate detection.
//
// Batch Add dedups pasted PropertyGuru links against each other and against
// already-saved properties. A raw string compare misses trivial variants of the
// same listing (trailing slash, query/tracking params, fragment, `www.`, or
// http-vs-https), so we collapse a URL to a stable key before comparing.
//
// PropertyGuru listing IDs live in the path, so we drop the query and fragment
// entirely. Anything that doesn't parse as a URL falls back to a trimmed,
// lower-cased string so it still dedups against an identical paste.
export function normalizeListingUrl(raw) {
  if (typeof raw !== 'string') return ''
  const t = raw.trim()
  if (!t) return ''
  try {
    const u = new URL(t)
    const host = u.hostname.toLowerCase().replace(/^www\./, '')
    const path = u.pathname.replace(/\/+$/, '') // drop trailing slash(es)
    return `${host}${path}`.toLowerCase()
  } catch {
    return t.toLowerCase()
  }
}
