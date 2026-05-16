// Apps Script — sheet → Hommies portal sync.
//
// One-time setup:
//   1. Open the Google Sheet that backs the Housing Requirement Form.
//   2. Extensions → Apps Script. Paste this whole file into Code.gs.
//   3. Project Settings → Script properties → add two properties:
//        CONVEX_HTTP_URL   = https://<your-deployment>.convex.site
//        SHEET_SYNC_SECRET = a long random string (set the same value on Convex)
//   4. Set the Convex env:
//        npx convex env set SHEET_SYNC_SECRET <same value>
//      (re-deploy is automatic; the HTTP action picks it up on the next call).
//   5. Triggers → Add Trigger
//        - Function: onFormSubmitTrigger | Event: From spreadsheet | On form submit
//        - Function: onEditTrigger       | Event: From spreadsheet | On edit
//   6. From the editor, run `syncAll` once to backfill any existing rows. Grant
//      the prompted permissions (read sheet + external requests).
//
// Notes:
//   * Convex HTTP actions live on the .convex.site host, NOT .convex.cloud.
//   * Dedup is keyed on the Timestamp column — the Convex side skips any row
//     whose timestamp already exists, so resending is always safe.

function getConfig() {
  var props = PropertiesService.getScriptProperties()
  var url = props.getProperty('CONVEX_HTTP_URL')
  var secret = props.getProperty('SHEET_SYNC_SECRET')
  if (!url || !secret) {
    throw new Error('Set CONVEX_HTTP_URL and SHEET_SYNC_SECRET in Project Settings → Script properties.')
  }
  return { url: url.replace(/\/+$/, '') + '/sheet/sync', secret: secret }
}

function readActiveSheet() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0]
  var range = sheet.getDataRange()
  var values = range.getValues()
  if (values.length < 2) return { headers: [], rows: [] }
  var headers = values[0].map(function (h) { return String(h == null ? '' : h) })
  var rows = values.slice(1).filter(function (r) {
    return r.some(function (c) { return String(c == null ? '' : c).trim().length > 0 })
  })
  return { headers: headers, rows: rows }
}

function postRows(payload) {
  var cfg = getConfig()
  var body = {
    secret: cfg.secret,
    headers: payload.headers,
    rows: payload.rows.map(function (r) {
      return r.map(function (c) {
        if (c instanceof Date) {
          // Match the visible cell format Google Forms writes:
          //   "12/4/2026, 19:45:32" (en-GB-ish day/month order)
          return Utilities.formatDate(c, Session.getScriptTimeZone(), 'd/M/yyyy, H:mm:ss')
        }
        return c == null ? '' : String(c)
      })
    }),
  }
  var res = UrlFetchApp.fetch(cfg.url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  })
  var code = res.getResponseCode()
  var text = res.getContentText()
  Logger.log('POST ' + cfg.url + ' → ' + code + ' ' + text)
  if (code < 200 || code >= 300) {
    throw new Error('sync failed: ' + code + ' ' + text)
  }
  return JSON.parse(text)
}

// Backfill / manual sync — push the entire sheet.
function syncAll() {
  var payload = readActiveSheet()
  if (payload.rows.length === 0) {
    Logger.log('Nothing to sync.')
    return
  }
  var result = postRows(payload)
  Logger.log('syncAll: ' + JSON.stringify(result))
}

// Installable On-form-submit trigger.
function onFormSubmitTrigger(e) {
  // The submitted row is the last row of the sheet. Send only that row so
  // the request payload stays tiny. The Convex side dedups by timestamp,
  // so even a duplicate fire is harmless.
  var sheet = e && e.range ? e.range.getSheet() : SpreadsheetApp.getActiveSpreadsheet().getSheets()[0]
  var lastRow = sheet.getLastRow()
  if (lastRow < 2) return
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
  var row = sheet.getRange(lastRow, 1, 1, sheet.getLastColumn()).getValues()[0]
  postRows({ headers: headers, rows: [row] })
}

// Installable On-edit trigger. Manual edits to the sheet (e.g. an admin
// adding a walk-in by hand) push that one row. New rows that arrive via
// form submission are already covered by onFormSubmitTrigger.
function onEditTrigger(e) {
  if (!e || !e.range) return
  var sheet = e.range.getSheet()
  var row = e.range.getRow()
  if (row < 2) return
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
  var rowValues = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0]
  postRows({ headers: headers, rows: [rowValues] })
}
