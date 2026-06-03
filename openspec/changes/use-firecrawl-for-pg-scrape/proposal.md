## Why

`convex/extraction.ts`'s `proxiedFetch` currently tries three datacenter-proxy vendors in order (`SCRAPEDO_API_KEY`, `SCRAPER_API_KEY`, `SCRAPINGBEE_API_KEY`) and falls through to a direct fetch if none is set. Production has none of these set — only `FIRECRAWL_API_KEY` — so every PropertyGuru scrape has been making a direct, unproxied request that PropertyGuru's Cloudflare layer 403s intermittently. The portal already pays for Firecrawl, the key is already in Convex env, and Firecrawl's `/v1/scrape` handles Cloudflare + JS rendering natively. Wire the fetch through Firecrawl and delete the three unused vendor branches.

## What Changes

- Replace the three proxy branches in `proxiedFetch` with a single Firecrawl `/v1/scrape` call.
- Delete `SCRAPEDO_API_KEY`, `SCRAPER_API_KEY`, `SCRAPINGBEE_API_KEY` reads. Document `FIRECRAWL_API_KEY` as the single required scrape env var.
- Drop `PG_PREMIUM` and `PG_RENDER_JS` — Firecrawl handles tier selection and JS rendering internally; both flags were already no-ops in prod (no proxy key was set) and Firecrawl v1 has no clean toggle to disable JS render anyway.
- Surface a clear error when `FIRECRAWL_API_KEY` is missing instead of silently falling through to a direct fetch.

## Capabilities

### New Capabilities
- `propertyguru-listing-scrape`: server-side fetch of a PropertyGuru listing HTML page via Firecrawl, used by every downstream extractor (`extractPropertyGuruUrl`, `fetchProjectPageText`, etc.).

### Modified Capabilities
<!-- none — no existing OpenSpec specs covered the prior proxy-based scrape -->

## Impact

- Modified: `convex/extraction.ts` — `proxiedFetch` body, related comments. No signature change (still returns `{ status, html }`), so call sites (`extractPropertyGuruUrl`, `fetchProjectPageText`) are untouched.
- Removed: env reads for `SCRAPEDO_API_KEY` / `SCRAPER_API_KEY` / `SCRAPINGBEE_API_KEY` / `PG_PREMIUM` / `PG_RENDER_JS`. These keys can be unset in Convex without breaking anything.
- Kept: `FIRECRAWL_API_KEY` (already set in prod) — single env var the scrape path depends on.
- No schema changes. No frontend changes. No new npm dependency — Firecrawl is called via `fetch` like Gemini already is.
- Search feature (the existing `add-firecrawl-pg-search` proposal) is **out of scope** — that change stays separate and can ship later.
