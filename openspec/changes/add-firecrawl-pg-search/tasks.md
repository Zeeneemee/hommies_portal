## 1. Env + config

- [ ] 1.1 Add `FIRECRAWL_API_KEY` to local Convex dev env (`npx convex env set FIRECRAWL_API_KEY ...`) and document it in the deploy notes
- [ ] 1.2 Set `FIRECRAWL_API_KEY` on the production Convex deployment

## 2. Convex action

- [ ] 2.1 In `convex/extraction.ts`, add a `searchPropertyGuru` action with `args: { query: v.string() }` and a typed return shape `{ ok: true, results: Array<{ url, title, snippet }> } | { ok: false, error: string }`
- [ ] 2.2 Short-circuit with `{ ok: false, error: 'Firecrawl not configured' }` when `FIRECRAWL_API_KEY` is missing
- [ ] 2.3 Short-circuit with `{ ok: false, error: 'Query is empty' }` when the trimmed query is empty
- [ ] 2.4 Call Firecrawl `/v1/search` via plain `fetch` with `query = "site:propertyguru.com.sg/listing " + userQuery` and `limit = 10`
- [ ] 2.5 Map common HTTP errors to friendly strings: 429 → "rate-limited", 401/403 → "Firecrawl auth failed", else → "Search failed"
- [ ] 2.6 Filter the returned URLs through the existing `isPropertyGuruUrl` helper and require the path to contain `/listing/`; drop everything else
- [ ] 2.7 Cap the response array length at 10

## 3. Add Property UI

- [ ] 3.1 In `src/components/AddProperty.jsx`, add `useAction('extraction:searchPropertyGuru')` alongside the existing extraction hooks
- [ ] 3.2 Add local state for `searchQuery`, `searchResults`, `searching`, `searchError`, and `firecrawlConfigured` (default true; flip to false on the first `'Firecrawl not configured'` response)
- [ ] 3.3 Render a search input + Search button immediately above the PropertyGuru URL field; hide the whole block when `firecrawlConfigured === false`
- [ ] 3.4 On submit: disable the input, show "Searching PropertyGuru…", call the action, then either set `searchResults` or toast the error
- [ ] 3.5 Render each result as a clickable card showing title + snippet + the URL host/path; "No PropertyGuru listings found" when results are empty
- [ ] 3.6 Clicking a card sets `pgUrl` to the result URL and invokes the existing extract handler immediately (same code path as pressing the Extract button)

## 4. Verification

- [ ] 4.1 Manually run the search with a known condo name in dev and confirm the candidate list is PG-only and clickable
- [ ] 4.2 Unset `FIRECRAWL_API_KEY` locally and confirm the search block hides itself with no console errors
- [ ] 4.3 Confirm clicking a card runs `extractPropertyGuruUrl` and fills the form just like pasting the URL did before
- [ ] 4.4 Confirm 429 / network failure paths surface as toast text, not raw error objects
