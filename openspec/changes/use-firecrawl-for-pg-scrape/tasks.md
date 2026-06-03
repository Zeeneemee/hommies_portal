## 1. Env (operator-run)

- [ ] 1.1 Confirm `FIRECRAWL_API_KEY` is set on the prod Convex deployment (`npx convex env list --prod`)
- [ ] 1.2 Set `FIRECRAWL_API_KEY` on the dev Convex deployment (`npx convex env set FIRECRAWL_API_KEY ...`)
- [ ] 1.3 (Optional) Unset `SCRAPEDO_API_KEY` / `SCRAPER_API_KEY` / `SCRAPINGBEE_API_KEY` / `PG_PREMIUM` / `PG_RENDER_JS` on prod once the new code is verified

## 2. Replace `proxiedFetch` body in `convex/extraction.ts`

- [x] 2.1 Delete the three `if (scrapeDo) / else if (scraperApi) / else if (scrapingBee)` branches and the trailing direct-fetch fallback
- [x] 2.2 Add a single Firecrawl `/v1/scrape` POST: `https://api.firecrawl.dev/v1/scrape` with `Authorization: Bearer ${FIRECRAWL_API_KEY}`, body `{ url: targetUrl, formats: ['html'], onlyMainContent: false }`
- [x] 2.3 **Drop `PG_RENDER_JS` entirely.** Firecrawl `/v1/scrape` v1 does not expose a clean "skip JS rendering" toggle — JS is rendered by default and that's what we want for lazy-loaded gallery images. Keeping the flag as a hook would be a dead no-op
- [x] 2.4 Map response → `{ status: data?.metadata?.statusCode ?? (success ? 200 : 502), html: data?.html ?? '' }`
- [x] 2.5 If `process.env.FIRECRAWL_API_KEY` is missing, return `{ status: 500, html: '' }` so the operator sees HTTP 500 via the existing `looksBlocked()` path
- [x] 2.6 Replace the ~20-line proxy comment block with a 3-line note about Firecrawl + `FIRECRAWL_API_KEY`
- [x] 2.7 Remove `PG_PREMIUM` references entirely

## 3. Sanity check call sites

- [x] 3.1 Confirm `extractPropertyGuruUrl` and `fetchProjectPageText` still type-check (no signature change — `proxiedFetch` still returns `{ status, html }`)
- [x] 3.2 Confirm `looksBlocked()` still triggers correctly: untouched function, handles non-200 + Cloudflare strings as before; Firecrawl errors return `status >= 400` which maps to `HTTP <code>`

## 4. Verification

- [ ] 4.1 Local: `npm run dev`, paste a known PG listing URL in Add Property, confirm extraction completes
- [ ] 4.2 Local: paste a fresh / Cloudflare-difficult PG listing URL, confirm it now succeeds (this was the regression)
- [ ] 4.3 Local: unset `FIRECRAWL_API_KEY` in dev (`npx convex env remove FIRECRAWL_API_KEY`), confirm Add Property surfaces a clear error (HTTP 500) instead of silently failing. Re-set after
- [ ] 4.4 Prod: deploy, smoke-test one URL end-to-end (extract → save)
- [x] 4.5 `npm test` → 3 files, 119 tests, all green (`convex/posterExtraction.test.ts`, `convex/sheetSync.test.ts`, `src/decisionLogic.test.js`)
