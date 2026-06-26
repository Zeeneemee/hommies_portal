import { describe, it, expect } from 'vitest'
import {
  CLIENTS_HEADER,
  SENT_COL,
  addSentLink,
  clientToRow,
  upsertClientRows,
} from './lib/clientsSheet'
import type { ParsedRequirement } from './lib/requirementParse'

const client = (over: Partial<ParsedRequirement> = {}): ParsedRequirement => ({
  name: 'Alex Tan',
  contact: '91234567',
  channel: 'Portal',
  school: 'NUS',
  moveIn: 'Immediate',
  leaseLength: '12 months',
  budget: { min: 2200, max: 2500 },
  buildingType: 'Condo',
  housingType: 'Room',
  unitLayout: ['Common Room'],
  commuteTolMins: 30,
  wantRoommate: false,
  ...over,
})

const L1 = 'https://www.propertyguru.com.sg/listing/111'
const L2 = 'https://www.propertyguru.com.sg/listing/222'

describe('addSentLink', () => {
  it('appends and de-duplicates, newline-separated', () => {
    expect(addSentLink('', L1)).toBe(L1)
    expect(addSentLink(L1, L2)).toBe(`${L1}\n${L2}`)
    expect(addSentLink(`${L1}\n${L2}`, L1)).toBe(`${L1}\n${L2}`)
  })
})

describe('clientToRow', () => {
  it('produces a row matching the header width and order', () => {
    const row = clientToRow(client(), L1, '2026-06-17')
    expect(row).toHaveLength(CLIENTS_HEADER.length)
    expect(row[0]).toBe('Alex Tan')
    expect(row[1]).toBe('91234567')
    expect(row[SENT_COL]).toBe(L1)
  })
})

describe('upsertClientRows', () => {
  it('appends a new client when no match', () => {
    const res = upsertClientRows([], client(), L1, 'now')
    expect(res.status).toBe('created')
    expect(res.rows).toHaveLength(1)
    expect(res.rows[0][SENT_COL]).toBe(L1)
  })

  it('updates the matched client and accumulates links', () => {
    const first = upsertClientRows([], client(), L1, 't1')
    const second = upsertClientRows(first.rows, client(), L2, 't2')
    expect(second.status).toBe('updated')
    expect(second.rows).toHaveLength(1)
    expect(second.rows[0][SENT_COL]).toBe(`${L1}\n${L2}`)
  })

  it('matches case/spacing-insensitively on name + contact', () => {
    const first = upsertClientRows([], client(), L1, 't1')
    const res = upsertClientRows(first.rows, client({ name: '  alex   tan ' }), L2, 't2')
    expect(res.status).toBe('updated')
    expect(res.rows).toHaveLength(1)
  })

  it('never collapses anonymous (empty key) rows', () => {
    const anon = client({ name: '', contact: '' })
    const first = upsertClientRows([], anon, L1, 't1')
    const res = upsertClientRows(first.rows, anon, L2, 't2')
    expect(res.status).toBe('created')
    expect(res.rows).toHaveLength(2)
  })
})
