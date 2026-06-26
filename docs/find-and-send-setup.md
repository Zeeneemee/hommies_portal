# Find & Send — setup

The **Find & Send** screen (`/find-send`) parses a customer's free-text
requirement message, searches PropertyGuru for matching listing **links** via
Firecrawl, and — when the operator picks one — records it against that customer
in a **Clients** tab of the shared Google Sheet ("sent").

- Search: `convex/pgSearch.ts` → Firecrawl `/v1/search` (links only, no scrape).
- Sheet write: `convex/clientSheet.ts` → Google Sheets API (service account).
- Parsing: `convex/lib/requirementParse.ts` (regex; optional Gemini fallback).

## Required Convex environment variables

Set these on the Convex deployment (`npx convex env set <NAME> <value>`):

| Variable | Purpose |
| --- | --- |
| `FIRECRAWL_API_KEY` | PropertyGuru search (already used by listing scrape). |
| `GOOGLE_SHEETS_SERVICE_ACCOUNT` | Full service-account JSON key (one line). |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | Target sheet id — `1FGkYRUp-LnBqs_I1iHsyy02r9D7CaDLDDYfLa_nbNiE`. |
| `GEMINI_API_KEY` | Optional — fills requirement fields the regex parser misses. |

## One-time Google setup

1. In Google Cloud, create a **service account** and download its JSON key.
   Enable the **Google Sheets API** for that project.
2. Store the whole JSON as the `GOOGLE_SHEETS_SERVICE_ACCOUNT` env var:
   `npx convex env set GOOGLE_SHEETS_SERVICE_ACCOUNT "$(cat key.json)"`.
3. **Share the spreadsheet** with the service-account email (the `client_email`
   in the JSON) as **Editor**. Without this, writes fail with a 403 and the UI
   shows an actionable "share … with <email>" message.

## Behaviour notes

- The **Clients** tab is created automatically on first write (with a header
  row); the existing "Room Tour" property tab is never touched.
- Customers are matched by normalised **name + contact**. A match updates that
  row's **Sent Listings** cell (links accumulate, de-duplicated, newline-
  separated); no match appends a new row.
- If Sheets env vars are missing the action returns a "not configured" status —
  it does not crash the portal.
