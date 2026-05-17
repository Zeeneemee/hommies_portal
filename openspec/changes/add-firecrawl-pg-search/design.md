## Context

`AddProperty.jsx` already calls `extraction:extractPropertyGuruUrl` to turn a known listing URL into structured fields. That action lives in `convex/extraction.ts` and depends on a custom fetch path with a real-browser User-Agent + Referer because PropertyGuru sits behind Cloudflare (see `extraction.ts:182-195`). What's missing is a way to *find* the URL: admins handle WhatsApp forwards that mention a condo by name only, so they currently leave the portal to search PropertyGuru in another tab.

Firecrawl exposes a hosted `/v1/search` endpoint that performs a search and returns ranked results (title, URL, snippet, optional markdown). It bypasses Cloudflare for us, lets us scope queries by site, and is callable server-side with an API key.

## Goals / Non-Goals

**Goals:**
- Admin types a query in Add Property → sees up to ~10 PropertyGuru listing candidates → clicks one → URL field populates and existing extraction runs.
- Search runs server-side from a Convex action; API key never reaches the browser.
- Failures (rate limit, missing key, network) surface as plain toast text, not stack traces.

**Non-Goals:**
- Persisting search history or results to the Convex DB.
- Re-implementing the existing `extractPropertyGuruUrl` flow — search produces a URL, extraction stays unchanged.
- Bulk import / multi-select. One pick per search.
- Searching anything other than `propertyguru.com.sg` (no other portals in scope).

## Decisions

**1. Call Firecrawl over plain `fetch` instead of installing `@mendable/firecrawl-js`.**
The SDK adds a dependency for a single endpoint we already know the shape of. A ~30-line `fetch` wrapper in `convex/extraction.ts` (or a new `convex/firecrawl.ts`) keeps Convex bundle size small and matches how `extraction.ts` already calls Gemini directly.

**2. Constrain the query to PropertyGuru via Firecrawl's site-scope, not by URL filtering after the fact.**
Firecrawl's search supports a query like `site:propertyguru.com.sg/listing <user query>` or an explicit allowlist param. Server-side we still validate every returned URL with the existing `isPropertyGuruUrl` helper and drop anything else, so bad results from Firecrawl can't pollute the picker.

**3. New Convex action `extraction:searchPropertyGuru` rather than a new file.**
`convex/extraction.ts` already owns PropertyGuru-related logic (URL validation, fetch headers, image filters). Keeping search next to extraction means future tweaks to PG-specific quirks live in one file. If the file grows past ~700 lines we can split later.

**4. UI: search input + result list inline in `AddProperty.jsx`, above the existing PG URL field.**
Admins are already on this screen with the form open. A dedicated tab would add navigation cost for a sub-step of one workflow. The result list is a vertical stack of clickable cards (title + condo + price snippet); clicking sets `pgUrl` and triggers the existing extract handler. Empty/loading/error states reuse the same plain-text patterns already in this component.

**5. No caching in v1.**
Search results change too quickly to be worth a cache layer, and admins typically run 1–2 searches per intake session. If volume grows we can add a short-lived in-memory cache keyed by normalized query inside the action.

## Risks / Trade-offs

- **Firecrawl quota / billing surprise** → Mitigation: cap results at 10 per call; document the env var and quota in the deploy notes; toast `quota exceeded` cleanly when Firecrawl returns 429.
- **Firecrawl returns non-listing URLs (project pages, agent pages, search results)** → Mitigation: server-side filter to URLs matching `/listing/` paths on `propertyguru.com.sg`. Drop everything else before returning to the client.
- **Cloudflare changes break extraction even when search succeeds** → Out of scope here; same risk exists today for `extractPropertyGuruUrl`. Surface the existing extraction error as-is when the user clicks a result.
- **API key leak** → Mitigation: action only; never expose to the client. Same pattern as `GEMINI_API_KEY` / Anthropic key.
- **Long latency (2–5s) makes the UI feel stuck** → Mitigation: a spinner + "Searching PropertyGuru…" status line on the search input. Disable the input while in-flight.

## Migration Plan

1. Add `FIRECRAWL_API_KEY` to Convex dev + prod env vars (`npx convex env set FIRECRAWL_API_KEY ...`).
2. Ship the action behind no flag — if the env var is missing, the action returns `{ ok: false, error: 'Firecrawl not configured' }` and the UI hides the search block.
3. No rollback steps needed beyond reverting the commit; nothing is persisted.

## Open Questions

- Should clicking a result auto-trigger extraction, or just fill the URL field and let the admin press the existing Extract button? Default: auto-trigger, since that's the path of least clicks. Revisit if it surprises users.
