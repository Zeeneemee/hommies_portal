## Why

Listing extraction and poster generation each scrape a page through Firecrawl (with a ScrapingBee fallback), and PropertyGuru/99.co sit behind Cloudflare so every scrape costs several proxy credits. The batch flow multiplies this badly: a row scrapes the **listing** page at extraction and the **project** page at every poster generation, the same development's project page is re-scraped once per listing, and requeue / re-paste / regenerate all re-scrape from scratch. One ~30-row batch exhausted the Firecrawl plan. There is no caching anywhere, so identical scrapes are paid for repeatedly.

## What Changes

- Add a server-side **scrape cache** so a given URL is fetched through the proxy at most once per TTL window. Both scrape paths — `extractListingUrl` (listing page) and `fetchProjectPageText` (project page) — read the cache first and write on a miss.
- Cache key is the **normalized URL** (reuse `normalizeListingUrl` semantics: host + path, drop query/fragment/`www`) so trivial URL variants collapse to one entry.
- **TTL = 7 days.** Entries older than the TTL are treated as a miss and re-scraped.
- Only **successful** scrapes are cached (non-empty HTML, status < 400) — errors/blocks/402 are never cached, so a failed scrape doesn't get stuck.
- A **force-refresh** path: extraction accepts an optional `force` flag that bypasses the cache and overwrites the entry, for when an operator needs fresh data.
- No UI changes required for the savings; the existing batch/single/chat flows benefit automatically. (Optional: a small "cached" indicator and a force-refresh control can come later.)

## Capabilities

### New Capabilities
- `scrape-cache`: How scraped listing/project pages are cached server-side — the URL-normalized key, the 7-day TTL, success-only caching, shared use by both scrape paths, and the force-refresh bypass.

### Modified Capabilities
<!-- None — no archived spec files to amend; this layers under the existing extraction actions. -->

## Impact

- `convex/schema.ts` — new `scrapeCache` table: `{ urlKey, html, status, fetchedAt }` with a `by_urlKey` index.
- `convex/extraction.ts` — `proxiedFetch` (or its callers) consults/writes the cache via small internal query + mutation (it runs in a `'use node'` action, so cache I/O goes through `ctx.runQuery`/`ctx.runMutation`); thread `ctx` into the fetch path. `extractListingUrl` gains an optional `force` arg.
- `convex/properties.ts` (or a new `convex/scrapeCache.ts`) — `internalQuery getCached(urlKey)` and `internalMutation putCached(urlKey, html, status)`.
- No frontend changes for the core savings; the batch/single/chat add flows are unaffected functionally.
- A normalizer shared with the frontend's `src/listingUrl.js` (mirror its logic in a Convex-importable helper, or duplicate the small function in `convex/`).
