## 1. Config & secrets

- [ ] 1.1 Create a Google service account, download its JSON key  _(operator — needs Google Cloud console)_
- [ ] 1.2 Set Convex env: `GOOGLE_SHEETS_SERVICE_ACCOUNT` (JSON), `GOOGLE_SHEETS_SPREADSHEET_ID` (`1FGkYRUp-LnBqs_I1iHsyy02r9D7CaDLDDYfLa_nbNiE`); confirm `FIRECRAWL_API_KEY`  _(operator)_
- [ ] 1.3 Share the spreadsheet (editor) with the service-account email  _(operator)_
- [x] 1.4 Document the env vars + sharing step in deploy/README notes → `docs/find-and-send-setup.md`

## 2. Firecrawl search (`convex/pgSearch.ts`)

- [x] 2.1 Add `searchListings` action calling `POST /v1/search` with Bearer `FIRECRAWL_API_KEY`, query scoped to `site:propertyguru.com.sg`, small `limit`
- [x] 2.2 Filter results to PropertyGuru listing URLs (`lib/pgUrl.ts`) and return `[{ url, title, snippet }]`
- [x] 2.3 Handle the unconfigured key + no-results cases with clear statuses
- [x] 2.4 Unit-test query construction (`requirementParse.test.ts`) and result filtering (`pgUrl.test.ts`)

## 3. Requirement parsing

- [x] 3.1 Parse the message into client identity (name + contact) + search fields, reusing `sheetSync.ts` keyword classifiers (`lib/requirementParse.ts`)
- [x] 3.2 Add a Gemini (`@google/genai`) fallback that fills only fields the regex parser missed (`pgSearch.ts:geminiAugment`)
- [x] 3.3 Build the PropertyGuru query string from the parsed fields (`buildSearchQuery`)
- [x] 3.4 Unit-test the parser on representative free-text messages (`requirementParse.test.ts`)

## 4. Google Sheets write layer (`convex/clientSheet.ts`)

- [x] 4.1 Implement service-account JWT signing (RS256 via `node:crypto`) + token exchange at `oauth2.googleapis.com/token` for the `spreadsheets` scope
- [x] 4.2 Ensure the "Clients" tab exists (`spreadsheets.get` → `batchUpdate addSheet` + header row if missing); never touch the "Room Tour" tab
- [x] 4.3 Define the fixed Clients header/column order constant (`lib/clientsSheet.ts`, incl. "Sent Listings", "Last Updated")
- [x] 4.4 Find the client row via `values.get` + `normaliseMatchKey(name, contact)`; never collapse empty-key rows
- [x] 4.5 `recordSent` action: update the matched row's Sent cell (append + de-dupe link) or append a new client row
- [x] 4.6 Map missing env → "not_configured" status, and a 403 → actionable "share the sheet with <service-account email>" error
- [x] 4.7 Unit-test the upsert (match→update, no-match→append) and Sent-cell accumulation/de-dupe (`clientsSheet.test.ts`)

## 5. Portal UI (`src/components/RequirementSearch.jsx`)

- [x] 5.1 Add the screen: requirement textarea + "Search" button + pending/error states
- [x] 5.2 Show parsed client fields + candidate links (URL + title); allow selecting a link
- [x] 5.3 "Add as sent" wires the parsed client + chosen link to `clientSheet:recordSent`; show the write status (created/updated/skipped)
- [x] 5.4 Add the route (`/find-send`) + a top-nav entry consistent with existing screens

## 6. Verification

- [x] 6.1 Run `npm test`; new + existing tests pass (167 passed) + `npm run build` clean
- [ ] 6.2 E2E: paste a sample message → PropertyGuru links appear → "add as sent" creates a new client row in the auto-created Clients tab with the link  _(needs configured deployment + shared sheet)_
- [ ] 6.3 E2E: send a second link to the same client → link appends to the Sent cell, no duplicate row  _(needs configured deployment)_
- [ ] 6.4 Verify graceful paths: Firecrawl key missing, no results, sheet not configured, sheet not shared  _(needs configured deployment)_
