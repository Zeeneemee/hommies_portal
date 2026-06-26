## Why

When a prospective tenant sends their housing requirements as a free-text message, an operator today has to leave the portal, search PropertyGuru in a browser, copy a link, then hand-record what was sent to which client in a spreadsheet. This change does that from inside the portal: paste the requirement, get matching PropertyGuru **links** (via Firecrawl search), and — once the operator picks one — record it against that client in the shared Google Sheet as "sent", creating the client row if it doesn't exist yet.

## What Changes

- Add a **portal screen** where an operator pastes a client's free-text requirement message and runs a search.
- **Build a PropertyGuru search from the requirements and call Firecrawl's search API (`/v1/search`)** to return candidate listing **links** (URL + title/snippet). No full-page scrape — links only.
- Show the candidate links on the portal; the operator picks the one(s) to send.
- **Write to a new "Clients" tab** in the shared Google Sheet via the Google Sheets API: look the client up by **name + contact**; if the row exists, **append the chosen link to that client's "Sent Listings" column**; otherwise append a new client row carrying the parsed requirement data plus the sent link.
- Add `GOOGLE_SHEETS_SERVICE_ACCOUNT` + `GOOGLE_SHEETS_SPREADSHEET_ID` as Convex env config; document the service-account share step.

## Capabilities

### New Capabilities
- `propertyguru-link-search`: from a client's free-text requirements, build and run a Firecrawl search of PropertyGuru and surface candidate listing links in the portal.
- `client-sheet-sync`: upsert a client (matched by name + contact) into a "Clients" tab of the shared Google Sheet and append a chosen listing link to that client's "Sent" column.

### Modified Capabilities
<!-- None. The existing /v1/scrape pipeline and read-side sheetSync import are untouched. -->

## Impact

- **UI**: new `src/components/RequirementSearch.jsx` screen + route + nav entry.
- **Convex**:
  - New `convex/pgSearch.ts` action wrapping Firecrawl `/v1/search` (this endpoint is NOT used anywhere today — `extraction.ts` only calls `/v1/scrape`).
  - New `convex/clientSheet.ts` action: Sheets API read (find client) + append/update (service-account JWT via Web Crypto).
  - Reuses `sheetSync.ts` parsing helpers for budget/school/housing/etc. to populate the client row.
- **Env / secrets**: `GOOGLE_SHEETS_SERVICE_ACCOUNT` (JSON), `GOOGLE_SHEETS_SPREADSHEET_ID` (`1FGkYRUp-LnBqs_I1iHsyy02r9D7CaDLDDYfLa_nbNiE`), existing `FIRECRAWL_API_KEY`.
- **External**: outbound calls to `api.firecrawl.dev` (search), `sheets.googleapis.com` + `oauth2.googleapis.com` (token). The sheet must be shared (editor) with the service-account email.
- **Out of scope**: no listing scrape/extraction, no `responses`-table writes, no change to the existing property "Room Tour" tab. The shared sheet currently has no client tab — a new "Clients" tab is created.
