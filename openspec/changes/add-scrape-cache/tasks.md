## 1. Schema & cache functions

- [x] 1.1 Added `scrapeCache` table to `convex/schema.ts` (`urlKey`/`html`/`status`/`fetchedAt`, `by_urlKey` index).
- [x] 1.2 Added `convex/scrapeCache.ts` — `getCached` (internalQuery) + `putCached` (internalMutation, upsert by `urlKey`, stamps `fetchedAt`).
- [x] 1.3 Added `convex/lib/listingUrl.ts` — Convex-side `normalizeListingUrl` mirroring `src/listingUrl.js`.

## 2. Wire the cache into the scrape path

- [x] 2.1 `proxiedFetch(ctx, targetUrl, { force })` reads `getCached` and returns it when `Date.now() - fetchedAt < SCRAPE_CACHE_TTL_MS` (7 days).
- [x] 2.2 On miss/force, runs Firecrawl → ScrapingBee; caches via `putCached` only when `html` non-empty and `status < 400`.
- [x] 2.3 Both call sites pass `ctx`: `listingExtractionHandler` (with `force`) and `fetchProjectPageText` (no force).

## 3. Force-refresh arg

- [x] 3.1 Added `force: v.optional(v.boolean())` to `extractListingUrl` and the `extractPropertyGuruUrl` alias; threaded into `proxiedFetch`.

## 4. Verify

- [x] 4.1 `npx convex codegen` (TypeScript clean) + `npx vitest run` (151 passed).
- [ ] 4.2 Manual prod check (needs deploy): extract a listing twice → 2nd is a cache hit (no credits); generate its poster twice → project page scraped once; two listings of one development → project page fetched once.
- [ ] 4.3 Manual prod check (needs deploy): force-refresh re-scrapes + overwrites; a failed scrape (402) is not cached.
