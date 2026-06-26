// Google Sheets write-back for the customer flow. Upserts a customer into a
// "Clients" tab (created on first use) and records a chosen PropertyGuru link in
// that customer's "Sent Listings" column. Authenticated with a service account
// (no per-user OAuth) — the target spreadsheet must be shared (editor) with the
// service-account email.
//
// The pure decision logic (column order, match, Sent accumulation) lives in
// lib/clientsSheet.ts; this file is the Google I/O around it.
'use node'

import { action } from './_generated/server'
import { v } from 'convex/values'
import { createSign } from 'node:crypto'
import {
  CLIENTS_SHEET,
  CLIENTS_HEADER,
  upsertClientRows,
} from './lib/clientsSheet'
import type { ParsedRequirement } from './lib/requirementParse'

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'

// Convex-validator mirror of ParsedRequirement (what the search action returns
// and the frontend hands back).
const clientValidator = v.object({
  name: v.string(),
  contact: v.string(),
  channel: v.string(),
  school: v.string(),
  moveIn: v.string(),
  leaseLength: v.string(),
  budget: v.object({ min: v.number(), max: v.number() }),
  buildingType: v.string(),
  housingType: v.string(),
  unitLayout: v.array(v.string()),
  commuteTolMins: v.number(),
  wantRoommate: v.boolean(),
})

type ServiceAccount = { client_email: string; private_key: string }

function loadServiceAccount(): ServiceAccount | null {
  const raw = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT
  if (!raw) return null
  try {
    const j = JSON.parse(raw) as ServiceAccount
    if (!j.client_email || !j.private_key) return null
    // Tolerate keys stored with escaped newlines.
    j.private_key = j.private_key.replace(/\\n/g, '\n')
    return j
  } catch {
    return null
  }
}

// A permission failure we map to an actionable message naming the SA email.
class SheetPermissionError extends Error {}

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const unsigned = `${b64(header)}.${b64(claim)}`
  const signer = createSign('RSA-SHA256')
  signer.update(unsigned)
  signer.end()
  const sig = signer.sign(sa.private_key).toString('base64url')
  const assertion = `${unsigned}.${sig}`

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Google token exchange failed (HTTP ${res.status}): ${body.slice(0, 200)}`)
  }
  const j = (await res.json()) as { access_token?: string }
  if (!j.access_token) throw new Error('Google token exchange returned no access_token')
  return j.access_token
}

async function sheetsFetch(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<any> {
  const res = await fetch(`${SHEETS_API}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  })
  if (res.status === 403 || res.status === 404) {
    throw new SheetPermissionError(await res.text())
  }
  if (!res.ok) {
    throw new Error(`Sheets API ${res.status}: ${(await res.text()).slice(0, 200)}`)
  }
  return res.status === 204 ? {} : res.json()
}

// Create the Clients tab + header row if absent. No-op (and never touches other
// tabs) when it already exists.
async function ensureClientsTab(token: string, spreadsheetId: string): Promise<void> {
  const meta = await sheetsFetch(token, `${spreadsheetId}?fields=sheets.properties.title`)
  const titles: string[] = (meta.sheets || []).map((s: any) => s?.properties?.title)
  if (titles.includes(CLIENTS_SHEET)) return
  await sheetsFetch(token, `${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: CLIENTS_SHEET } } }] }),
  })
  await sheetsFetch(
    token,
    `${spreadsheetId}/values/${CLIENTS_SHEET}!A1?valueInputOption=RAW`,
    { method: 'PUT', body: JSON.stringify({ values: [CLIENTS_HEADER] }) },
  )
}

export const recordSent = action({
  args: { client: clientValidator, link: v.string() },
  returns: v.object({
    ok: v.boolean(),
    status: v.string(), // 'created' | 'updated' | 'not_configured' | 'error'
    note: v.string(),
  }),
  handler: async (_ctx, { client, link }) => {
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID
    const sa = loadServiceAccount()
    if (!sa || !spreadsheetId) {
      return {
        ok: false,
        status: 'not_configured',
        note: 'Sheets not configured — set GOOGLE_SHEETS_SERVICE_ACCOUNT and GOOGLE_SHEETS_SPREADSHEET_ID in Convex env.',
      }
    }
    const trimmedLink = String(link ?? '').trim()
    if (!trimmedLink) {
      return { ok: false, status: 'error', note: 'No link to record.' }
    }

    try {
      const token = await getAccessToken(sa)
      await ensureClientsTab(token, spreadsheetId)

      const range = `${CLIENTS_SHEET}!A2:O`
      const read = await sheetsFetch(token, `${spreadsheetId}/values/${range}`)
      const dataRows: string[][] = (read.values || []).map((r: unknown[]) =>
        (r || []).map((c) => String(c ?? '')),
      )

      const now = new Date().toISOString()
      const { status, rowIndex, row } = upsertClientRows(
        dataRows,
        client as ParsedRequirement,
        trimmedLink,
        now,
      )

      if (status === 'updated') {
        const a1 = `${CLIENTS_SHEET}!A${rowIndex + 2}`
        await sheetsFetch(
          token,
          `${spreadsheetId}/values/${a1}?valueInputOption=RAW`,
          { method: 'PUT', body: JSON.stringify({ values: [row] }) },
        )
      } else {
        await sheetsFetch(
          token,
          `${spreadsheetId}/values/${CLIENTS_SHEET}!A:O:append?valueInputOption=RAW`,
          { method: 'POST', body: JSON.stringify({ values: [row] }) },
        )
      }

      return {
        ok: true,
        status,
        note: status === 'updated' ? 'Link added to existing client.' : 'New client row created.',
      }
    } catch (err: any) {
      if (err instanceof SheetPermissionError) {
        return {
          ok: false,
          status: 'error',
          note: `Cannot access the sheet — share spreadsheet ${spreadsheetId} (Editor) with the service account: ${sa.client_email}`,
        }
      }
      return { ok: false, status: 'error', note: err?.message || 'Sheet write failed.' }
    }
  },
})
