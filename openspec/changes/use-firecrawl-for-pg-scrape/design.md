## Context

`convex/extraction.ts:277` `proxiedFetch(targetUrl) → { status, html }` is the single chokepoint every PropertyGuru scrape goes through. Today it inspects three env vars in order and falls back to direct fetch:

```
if (SCRAPEDO_API_KEY)     → api.scrape.do (residential, super=true)
else if (SCRAPER_API_KEY) → api.scraperapi.com (premium/ultra tiers)
else if (SCRAPINGBEE_API_KEY) → app.scrapingbee.com (premium_proxy + optional stealth)
else                       → direct GET to propertyguru.com.sg with a Safari UA
```

Production has none of the three keys set — only `FIRECRAWL_API_KEY`. That means every prod scrape has been the direct-fetch branch, which works some of the time (Cloudflare's mood) and 403s the rest. The recent regression the operator noticed is almost certainly Cloudflare tightening, not anything the latest commits changed.

Firecrawl `/v1/scrape` already handles Cloudflare bypass + JS rendering + retries internally, the key is already provisioned, and the portal already pays for it. This is the cheapest path to a stable scrape.

## Goals / Non-Goals

**Goals:**
- One scrape vendor, one env var, one code path.
- No regression for `extractPropertyGuruUrl`, `fetchProjectPageText`, or any other caller of `proxiedFetch`.
- Clear error when `FIRECRAWL_API_KEY` is missing — no silent direct-fetch fallback that 403s mysteriously.

**Non-Goals:**
- Search (`add-firecrawl-pg-search` proposal stays untouched).
- Caching of scrape results.
- Supporting any non-PropertyGuru target host.
- Keeping the scrape.do / scraperapi / scrapingbee branches as a fallback.

## Decisions

**1. Replace, don't layer.**
Option B (Firecrawl primary, proxies as fallback) keeps three unused vendor branches alive forever. None of those keys have ever been set in this project's prod or dev Convex env. Dead code is worse than no fallback. If Firecrawl goes down, the operator sees a clear error and we can hot-swap by adding a branch back — that's a 10-line change when needed, not a permanent code tax.

**2. Call Firecrawl via plain `fetch`, not `@mendable/firecrawl-js`.**
Same reasoning as the search proposal: one endpoint, known shape, matches the existing Gemini-via-fetch pattern in `extraction.ts`. Keeps the Convex bundle small.

**3. Endpoint: `POST https://api.firecrawl.dev/v1/scrape` with `{ url, formats: ['html'], onlyMainContent: false }`.**
- `formats: ['html']` returns the raw HTML, which is what the downstream `distillHtml` / JSON-LD extraction needs. Firecrawl can also return markdown, but the existing extractor reads `<script type="application/ld+json">` and meta tags out of the raw HTML.
- `onlyMainContent: false` — listing pages have key facts (price, beds, address) in headers/sidebars that Firecrawl's main-content filter sometimes drops.
- **No JS render flag.** Firecrawl `/v1/scrape` v1 renders JS by default and does not expose a clean toggle to disable it. The previous `PG_RENDER_JS` env var is dropped entirely — keeping it as a hook would be a no-op. JS-on is what we want anyway, since lazy-loaded gallery images need it.

**4. Map Firecrawl response → `{ status, html }`.**
Firecrawl returns `{ success, data: { html, metadata: { statusCode, ... } } }`. We return:
```ts
{ status: data.metadata.statusCode ?? (success ? 200 : 502), html: data.html ?? '' }
```
That keeps the existing `looksBlocked()` check in `extraction.ts:340` working as-is (it inspects `status` and HTML for Cloudflare strings).

**5. Missing `FIRECRAWL_API_KEY` is an error, not a fallback.**
Return `{ status: 500, html: '' }` and let the caller's existing error path surface it, or throw a clearly-named error. Either way: no silent direct fetch. The current silent fallback is exactly what caused this whole investigation.

**6. Delete the proxy comment block too.**
The 20+ lines of comments explaining the proxy ladder are no longer accurate once the ladder is gone. Replace with a 3-line comment pointing at Firecrawl + the `FIRECRAWL_API_KEY` env var.

## Risks / Trade-offs

- **Firecrawl outage = scrape down across the portal.** Mitigation: surface the error clearly in the UI; document the manual fallback (set `SCRAPEDO_API_KEY` and revert the commit) in the deploy notes. Same single-point-of-failure profile as Gemini today.
- **Firecrawl quota surprise.** Mitigation: the existing `extractPropertyGuruUrl` is invoked one URL at a time by an operator. Batch flows (`batch-scrape-posters`) already cap concurrency. Firecrawl bills per scrape; for the portal's volume this is well inside the existing plan.
- **Firecrawl response shape drift.** Mitigation: defensive read of `data?.html` and `data?.metadata?.statusCode`; treat missing fields as a 502.
- **No way to disable JS rendering.** Firecrawl v1 always renders. Cost is slightly higher per scrape than a no-render fetch, but the portal's volume is low and we wanted JS-on anyway for lazy-loaded gallery images.

## Migration Plan

1. Confirm `FIRECRAWL_API_KEY` is set on both `npx convex env list` and `--prod`. It already is on prod; set on dev.
2. Land the code change. Existing prod env vars for `SCRAPEDO_*` / `SCRAPER_*` / `SCRAPINGBEE_*` / `PG_PREMIUM` can stay set or be deleted — code no longer reads them.
3. Smoke test: open Add Property in dev, paste a known-good PG listing URL, confirm extraction completes. Repeat on a Cloudflare-difficult listing (a fresh one).
4. Deploy to prod via existing Convex deploy flow.
5. Rollback = `git revert` of the change commit. Restoring proxy keys is the manual escape hatch.

## Open Questions

- ~~Should `PG_RENDER_JS=0` actually disable Firecrawl's JS render, or is "always render" cleaner?~~ **Resolved during implementation:** Firecrawl v1 has no clean JS-off toggle, so the flag was dropped entirely and JS-render is always on.
- Do we want a Firecrawl-specific timeout (Firecrawl supports a `timeout` arg in ms)? Convex actions already have their own ceiling; leaving Firecrawl on its default unless we see slow scrapes in practice.
