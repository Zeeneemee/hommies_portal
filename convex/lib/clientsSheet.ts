// Pure logic for the Clients tab: column order, the row shape, and the
// upsert/append decision. Kept free of Convex/Node/HTTP so the matching and
// Sent-cell accumulation are unit-testable; convex/clientSheet.ts does the
// Google Sheets I/O around these helpers.
import { normaliseMatchKey } from '../sheetSync'
import type { ParsedRequirement } from './requirementParse'

// Fixed header — mirrors NormalisedResponse field order so the existing
// read-side import stays compatible, plus the two write-only columns.
export const CLIENTS_SHEET = 'Clients'
export const CLIENTS_HEADER = [
  'Name',
  'Contact',
  'Channel',
  'School',
  'Move-In',
  'Lease Length',
  'Budget Min',
  'Budget Max',
  'Building Type',
  'Housing Type',
  'Unit Layout',
  'Commute Tol (mins)',
  'Want Roommate',
  'Sent Listings',
  'Last Updated',
] as const

export const SENT_COL = CLIENTS_HEADER.indexOf('Sent Listings')
export const UPDATED_COL = CLIENTS_HEADER.indexOf('Last Updated')

// Append a link to an existing newline-separated Sent cell, de-duplicating so
// re-sending the same listing doesn't pile up. Order preserved, newest last.
export function addSentLink(existing: string, link: string): string {
  const l = String(link ?? '').trim()
  const lines = String(existing ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
  if (l && !lines.includes(l)) lines.push(l)
  return lines.join('\n')
}

// One full row in CLIENTS_HEADER order.
export function clientToRow(
  client: ParsedRequirement,
  sentListings: string,
  lastUpdated: string,
): string[] {
  return [
    client.name || '',
    client.contact || '',
    client.channel || '',
    client.school || '',
    client.moveIn || '',
    client.leaseLength || '',
    client.budget?.min != null ? String(client.budget.min) : '',
    client.budget?.max != null ? String(client.budget.max) : '',
    client.buildingType || '',
    client.housingType || '',
    (client.unitLayout || []).join(', '),
    client.commuteTolMins != null ? String(client.commuteTolMins) : '',
    client.wantRoommate ? 'Yes' : 'No',
    sentListings,
    lastUpdated,
  ]
}

export type UpsertResult = {
  rows: string[][]
  status: 'created' | 'updated'
  rowIndex: number // 0-based index into the data rows (excludes header)
  row: string[]
}

// Decide update-vs-append against the in-memory data rows (header excluded).
// Matches by normalised name + contact; an empty key (no name AND no contact)
// never collapses with other empty-key rows — it always appends.
export function upsertClientRows(
  dataRows: string[][],
  client: ParsedRequirement,
  link: string,
  now: string,
): UpsertResult {
  const rows = dataRows.map((r) => [...r])
  const key = normaliseMatchKey({ name: client.name, contact: client.contact })

  const matchIndex =
    key === ''
      ? -1
      : rows.findIndex(
          (r) => normaliseMatchKey({ name: r[0], contact: r[1] }) === key,
        )

  if (matchIndex >= 0) {
    const row = rows[matchIndex]
    // Pad short rows so column writes land in the right place.
    while (row.length < CLIENTS_HEADER.length) row.push('')
    row[SENT_COL] = addSentLink(row[SENT_COL], link)
    row[UPDATED_COL] = now
    rows[matchIndex] = row
    return { rows, status: 'updated', rowIndex: matchIndex, row }
  }

  const row = clientToRow(client, addSentLink('', link), now)
  rows.push(row)
  return { rows, status: 'created', rowIndex: rows.length - 1, row }
}
