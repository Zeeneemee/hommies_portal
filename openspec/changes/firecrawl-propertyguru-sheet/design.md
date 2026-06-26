## Context

The portal already scrapes a *known* PropertyGuru URL server-side (`convex/extraction.ts:firecrawlFetch` → Firecrawl `/v1/scrape`, with a ScrapingBee fallback and a 7-day `scrapeCache`) and parses customer requirements from spreadsheet rows (`convex/sheetSync.ts`). Two things this feature needs do **not** exist yet:

1. **Firecrawl search** — `extraction.ts` only ever calls `/v1/scrape`. There is no `/v1/search` wrapper. (The `add-firecrawl-pg-search` change proposed one but was never implemented.)
2. **A sheet write path** — `sheetSync.ts` only *reads* (an Apps Script POSTs rows to `/sheet/sync`).

Also confirmed by inspection: the shared spreadsheet's first tab is a property catalog ("Hommies.SG Room Tour"), not a client list. There is no clients tab today.

## Goals / Non-Goals

**Goals:**
- Paste a requirement → get PropertyGuru **links** (search only) → operator picks one → recorded against the client in a "Clients" tab as sent.
- Upsert the client by name + contact; accumulate sent links in one column.
- Service-account writes; every external dependency degrades gracefully.

**Non-Goals:**
- No full-page scrape/extraction of the listing (we store the link, not its details).
- No writes to the `responses` table — the sheet is the store for this feature.
- No change to the existing `/v1/scrape` pipeline, the read-side `/sheet/sync` import, or the property "Room Tour" tab.
- No automatic ranking/matching — the operator chooses which link to send.

## Decisions

### D1: Firecrawl is used for search, not scrape
Add `convex/pgSearch.ts` with a `searchListings` action calling `POST https://api.firecrawl.dev/v1/search` (Bearer `FIRECRAWL_API_KEY`), query scoped to PropertyGuru (e.g. append `site:propertyguru.com.sg`), `limit` small (≈5). Return `[{ url, title, snippet }]` filtered to PropertyGuru listing URLs. We do **not** pass `scrapeOptions` — links only keeps it cheap and fast and avoids Cloudflare-rendered page cost.
- *Alternative*: reuse `/v1/scrape` per result. Rejected — we don't need page contents, only the link.

### D2: Query built from parsed requirements, parsing reuses sheetSync
Parse the pasted message with the existing `sheetSync.ts` normalisers (budget/school/building/housing/layout) to derive both the client identity (name + contact) and the search terms. A Gemini (`@google/genai`, already a dependency) fallback fills fields the regexes miss. Query string composes building type + area/school + budget + housing type.

### D3: Google Sheets write via service-account JWT + REST (`convex/clientSheet.ts`)
Mint an OAuth2 token by signing a JWT (RS256 via Web Crypto `crypto.subtle`) from the service-account JSON and exchanging it at `oauth2.googleapis.com/token` for the `spreadsheets` scope, then call the Sheets REST API. No new npm dependency. Operations:
- **Ensure tab**: `spreadsheets.get` → if no "Clients" sheet, `batchUpdate addSheet` + write the header row.
- **Find client**: `spreadsheets.values.get` over the Clients range; match in code by `normaliseMatchKey(name, contact)` (reused from `sheetSync.ts`).
- **Update**: `spreadsheets.values.update` on the matched row (append link to the Sent cell).
- **Append**: `spreadsheets.values.append` for a new client.
- *Alternative*: Apps Script `doPost` webhook (mirrors the read path, no Google creds). Viable, but the operator chose the Sheets API.
- *Alternative*: `googleapis` npm package. Rejected — heavy for a few REST calls.

### D4: Clients tab schema
Fixed header, mirroring the `NormalisedResponse` shape so the existing read-side import stays compatible, plus a Sent column:
`Name | Contact | Channel | School | Move-In | Lease Length | Budget Min | Budget Max | Building Type | Housing Type | Unit Layout | Commute Tol (mins) | Want Roommate | Sent Listings | Last Updated`.
The "Sent Listings" cell accumulates links (newline- or comma-separated, de-duplicated).

### D5: Two-step UX, one client context
The screen runs the search (D1) and shows candidates; "Add as sent" calls `clientSheet:recordSent` with the parsed client + chosen link. Search results are transient; only the sheet persists. Matching for upsert is done against the **sheet** (per the requirement "check if you already have that client in the sheet"), not against any local table.

### D6: Configuration / secrets
New Convex env: `GOOGLE_SHEETS_SERVICE_ACCOUNT` (full JSON), `GOOGLE_SHEETS_SPREADSHEET_ID` (the provided sheet). Reuse `FIRECRAWL_API_KEY`. The sheet must be shared (editor) with the service-account email.

## Risks / Trade-offs

- **Firecrawl search returns non-listing/agent/search-page URLs** → noisy candidates. Mitigation: filter to PropertyGuru listing URL patterns (reuse `isPropertyGuruUrl`) and cap `limit`.
- **Sheet not shared with the service account** → 403 on write. Mitigation: detect and return an actionable message naming the service-account email.
- **Free-text parsing imperfect** → weak query / wrong client identity. Mitigation: show parsed fields in the UI for the operator to confirm before sending; name + contact drive the upsert key.
- **Concurrent writes** to the same client row → lost update on the Sent cell. Mitigation: read-modify-write per request; acceptable for a single-operator, low-frequency flow; note as a known limitation.
- **Service-account key in env** → secret handling. Mitigation: one env var holding the JSON, parsed lazily, never logged.

## Migration Plan

1. Create a Google service account; download its JSON key.
2. Set Convex env: `GOOGLE_SHEETS_SERVICE_ACCOUNT`, `GOOGLE_SHEETS_SPREADSHEET_ID` (+ confirm `FIRECRAWL_API_KEY`).
3. Share the target spreadsheet (editor) with the service-account email.
4. Deploy `convex/pgSearch.ts`, `convex/clientSheet.ts`, and the new screen/route. First write auto-creates the "Clients" tab.
5. Verify end-to-end with one message (links appear; "add as sent" creates/updates a client row with the link).
- **Rollback**: remove the nav entry/route; the new Convex functions are additive and unreferenced elsewhere.

## Open Questions

- Exact "area" term for the query when the message gives a school vs. an MRT/region (start with school/building type; refine after first runs).
- Sent-cell delimiter (newline vs. comma) and whether to also stamp a per-link date — current plan: newline-separated links + a single "Last Updated" column.
