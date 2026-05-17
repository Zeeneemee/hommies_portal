## Why

Admins currently can only paste a known PropertyGuru listing URL into Add Property. When they only know a condo name or area, they have to leave the portal, search PropertyGuru in a browser, copy the URL back, and paste it. Firecrawl gives us a reliable, server-side way to run that search from inside the portal — fewer tab switches, faster intake, and no Cloudflare 403s.

## What Changes

- Add a new Convex action `extraction:searchPropertyGuru` that calls Firecrawl's search API server-side using `FIRECRAWL_API_KEY` and returns a list of PropertyGuru listing candidates (URL, title, snippet, optional thumbnail).
- Add a search input + results list to `AddProperty.jsx`, positioned near the existing PropertyGuru URL field. Clicking a result populates the URL field and (optionally) triggers the existing `extractPropertyGuruUrl` extraction.
- Document `FIRECRAWL_API_KEY` as a required Convex env var in deployment config.

## Capabilities

### New Capabilities
- `propertyguru-search`: server-side search of PropertyGuru listings via Firecrawl, surfaced as a candidate picker in the Add Property flow.

### Modified Capabilities
<!-- none — no existing OpenSpec specs in repo to delta against -->

## Impact

- New file: `convex/firecrawl.ts` (or new exports in `convex/extraction.ts`) wrapping Firecrawl's search endpoint.
- Modified: `src/components/AddProperty.jsx` — new search UI block, wired to the new action.
- New env var: `FIRECRAWL_API_KEY` (Convex deployment env). Update `convex.json` / deploy docs as needed.
- New runtime dependency: HTTP calls to `api.firecrawl.dev`. No new npm package required if we call the REST endpoint via `fetch`; otherwise `@mendable/firecrawl-js`.
- No schema changes — search results are transient, not persisted.
