## Context

`convex/extraction.ts` scrapes pages through `proxiedFetch(targetUrl)` → Firecrawl (`firecrawlFetch`) with a ScrapingBee fallback (`scrapingBeeFetch`). Two call sites hit it:
- `extractListingUrl` → scrapes the **listing** page (once per extraction; re-runs on requeue/re-paste).
- `fetchProjectPageText` (called by `ai.ts:generatePosterContent` when a `projectUrl` is set) → scrapes the **project** page on **every** poster generation, and once per listing of the same development.

PG/99.co are Cloudflare-fronted, so each scrape costs several proxy credits. Nothing is cached, so identical scrapes are paid for repeatedly — this is what drained the Firecrawl plan. `proxiedFetch` is a plain async function inside a `'use node'` action; it currently takes no `ctx`.

## Goals / Non-Goals

**Goals:**
- A URL-keyed server cache so any page is proxy-fetched at most once per 7-day window.
- Both scrape paths share it (extraction + project page).
- Success-only caching; force-refresh escape hatch.
- Zero behavioral change to the add flows beyond fewer credits spent.

**Non-Goals:**
- Caching the downloaded image bytes (`fetchImagesAsData`) — separate concern, and 99.co images are blocked anyway.
- A hard daily credit budget / counter (worth doing as a follow-up backstop, but out of scope here).
- Cache-management UI (view/evict entries). Force-refresh is the only operator control.
- Caching Gemini results.

## Decisions

**1. Storage: a `scrapeCache` Convex table.**
`{ urlKey: string, html: string, status: number, fetchedAt: number }`, indexed `by_urlKey`. One row per normalized URL; `putCached` upserts (delete-then-insert or patch existing). HTML for a distilled listing/project page is well within Convex document limits.

**2. Key: normalized URL.**
Reuse the `normalizeListingUrl` logic (host + path, drop `www.`/query/fragment, lower-case). The frontend version lives in `src/listingUrl.js`; add a Convex-side copy (small pure function in `convex/lib/` or inline in `extraction.ts`) so both sides agree. Dropping query params is what makes PG share-links and 99.co tracking params collapse to one entry.

**3. Cache I/O via internal functions, threaded through `ctx`.**
`proxiedFetch` becomes `proxiedFetch(ctx, targetUrl, { force })`. Flow:
```
key = normalize(targetUrl)
if (!force) {
  cached = ctx.runQuery(internal.scrapeCache.get, { urlKey: key })
  if (cached && now - cached.fetchedAt < TTL) return { status: cached.status, html: cached.html }
}
res = firecrawl → scrapingBee fallback  (existing logic)
if (res.html && res.status < 400) ctx.runMutation(internal.scrapeCache.put, { urlKey: key, html: res.html, status: res.status })
return res
```
`getCached`/`putCached` are `internalQuery`/`internalMutation` (in a new `convex/scrapeCache.ts`).

**4. TTL = 7 days**, as a module constant. Stale → miss → re-scrape → overwrite.

**5. Success-only.** Only cache `html` non-empty and `status < 400`. This means a 402 (Firecrawl out of credits) is never cached, so once credits return, scrapes resume normally without a poisoned cache.

**6. Force-refresh.** `extractListingUrl` gains `args.force?: boolean`, passed into `proxiedFetch`. The poster-generation path (`fetchProjectPageText`) always uses the cache (no force) — regeneration should be free; an operator who wants fresh facilities can re-extract the listing with force, or we expose force there later.

## Risks / Trade-offs

- **Staleness.** A cached listing won't reflect a rent/availability change for up to 7 days. Mitigation: force-refresh, success-only caching, and a TTL chosen for how rarely listings change. Acceptable for an internal tool.
- **`html` size in Convex.** Distilled/raw listing HTML is large but within limits; if a page is unusually huge we could store the distilled text instead of raw HTML. Start with raw HTML to keep `distillHtml`/`extractImageUrls` working unchanged downstream.
- **Threading `ctx` into `proxiedFetch`.** Touches the signature and both call sites (`extractListingUrl`, `fetchProjectPageText`). Mechanical but must update all callers.
- **Normalizer drift.** Two copies of `normalizeListingUrl` (frontend + Convex) could diverge. Mitigation: keep the Convex copy tiny and comment it as mirroring `src/listingUrl.js`; only the cache correctness depends on it, not user-facing behavior.
- **Unbounded table growth.** One row per unique URL, ~30/batch — small. A later cleanup (evict entries older than TTL) is optional; stale rows are simply ignored.
