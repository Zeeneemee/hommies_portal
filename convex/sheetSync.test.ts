import { describe, it, expect } from 'vitest'
import { normaliseMatchKey, normaliseSheetRows, parseGroupSize } from './sheetSync'

describe('parseGroupSize', () => {
  it('plain integer string', () => {
    expect(parseGroupSize('3')).toBe(3)
    expect(parseGroupSize('1')).toBe(1)
    expect(parseGroupSize('  4  ')).toBe(4)
  })

  it('integer with surrounding text', () => {
    expect(parseGroupSize('3 people')).toBe(3)
    expect(parseGroupSize('我们三个 3 人')).toBe(3)
    expect(parseGroupSize('a group of 2')).toBe(2)
  })

  it('"couple" variants map to 2', () => {
    expect(parseGroupSize('couple')).toBe(2)
    expect(parseGroupSize('Couple')).toBe(2)
    expect(parseGroupSize('情侶')).toBe(2)
    expect(parseGroupSize('情侣')).toBe(2)
    expect(parseGroupSize('一對')).toBe(2)
    expect(parseGroupSize('一对')).toBe(2)
  })

  it('blank / unparseable → undefined', () => {
    expect(parseGroupSize('')).toBeUndefined()
    expect(parseGroupSize('   ')).toBeUndefined()
    expect(parseGroupSize(null)).toBeUndefined()
    expect(parseGroupSize(undefined)).toBeUndefined()
    expect(parseGroupSize('alone')).toBeUndefined()
    expect(parseGroupSize('-')).toBeUndefined()
  })

  it('non-string inputs', () => {
    expect(parseGroupSize(3)).toBe(3)
    expect(parseGroupSize(0)).toBeUndefined() // groupSize must be >= 1
  })

  it('decimals get floored', () => {
    expect(parseGroupSize('3.7')).toBe(3)
  })
})

describe('normaliseSheetRows — groupSize column wiring', () => {
  const baseHeaders = [
    'Timestamp', 'Name', 'Channel', 'Contact Details', 'School', 'Move-in',
    'Lease', 'Budget', 'Building', 'Housing', 'Layout', 'Commute', 'Roommate',
    'Extras',
  ]

  const baseRow = [
    '2026/05/01', '陳維琳', 'Line', '@weilin', 'NUS', '2026-08-01',
    '12 months', 'S$1200-1500', 'Condo', 'Whole Unit',
    'Whole Unit', '20', 'Yes', 'Prefer quiet',
  ]

  it('picks up "Group Size" column header', () => {
    const headers = [...baseHeaders, 'Group Size']
    const rows = [[...baseRow, '3']]
    const out = normaliseSheetRows(headers, rows)
    expect(out[0].groupSize).toBe(3)
  })

  it('picks up "Party Size" column header', () => {
    const headers = [...baseHeaders, 'Party Size']
    const rows = [[...baseRow, '2']]
    const out = normaliseSheetRows(headers, rows)
    expect(out[0].groupSize).toBe(2)
  })

  it('picks up "人數" Chinese header', () => {
    const headers = [...baseHeaders, '人數']
    const rows = [[...baseRow, 'couple']]
    const out = normaliseSheetRows(headers, rows)
    expect(out[0].groupSize).toBe(2)
  })

  it('omits groupSize when no group column present (back-compat)', () => {
    const out = normaliseSheetRows(baseHeaders, [baseRow])
    expect(out[0].groupSize).toBeUndefined()
    // The rest of the record should still parse correctly.
    expect(out[0].name).toBe('陳維琳')
    expect(out[0].housingType).toBe('Whole Unit')
    expect(out[0].budget).toEqual({ min: 1200, max: 1500 })
  })

  it('omits groupSize when the cell is blank', () => {
    const headers = [...baseHeaders, 'Group Size']
    const rows = [[...baseRow, '']]
    const out = normaliseSheetRows(headers, rows)
    expect(out[0].groupSize).toBeUndefined()
  })
})

describe('normaliseMatchKey', () => {
  it('produces a stable key for trivially identical inputs', () => {
    expect(normaliseMatchKey({ name: 'Tan Wei Ming', contact: 'tan@example.com' })).toBe(
      'tan wei ming|tan@example.com',
    )
  })

  it('is case-insensitive on both fields', () => {
    const a = normaliseMatchKey({ name: 'Tan Wei Ming', contact: 'Tan@Example.com' })
    const b = normaliseMatchKey({ name: 'tan wei ming', contact: 'tan@example.com' })
    expect(a).toBe(b)
  })

  it('trims and collapses internal whitespace', () => {
    const a = normaliseMatchKey({ name: '  Tan   Wei  Ming  ', contact: ' tan@example.com ' })
    const b = normaliseMatchKey({ name: 'Tan Wei Ming', contact: 'tan@example.com' })
    expect(a).toBe(b)
  })

  it('returns "" when both name and contact normalise to empty', () => {
    expect(normaliseMatchKey({ name: '', contact: '' })).toBe('')
    expect(normaliseMatchKey({ name: '   ', contact: null })).toBe('')
    expect(normaliseMatchKey({ name: undefined, contact: undefined })).toBe('')
  })

  it('returns a non-empty key when only name is present', () => {
    expect(normaliseMatchKey({ name: 'Tan Wei Ming', contact: '' })).toBe('tan wei ming|')
  })

  it('returns a non-empty key when only contact is present', () => {
    expect(normaliseMatchKey({ name: '', contact: 'tan@example.com' })).toBe('|tan@example.com')
  })

  it('keeps distinct people distinct', () => {
    const a = normaliseMatchKey({ name: 'Tan Wei Ming', contact: 'tan@example.com' })
    const b = normaliseMatchKey({ name: 'Lim Hui Min', contact: 'lim@example.com' })
    expect(a).not.toBe(b)
  })

  it('does NOT normalise phone-format differences (documented limitation)', () => {
    const a = normaliseMatchKey({ name: 'Tan', contact: '+65 9123 4567' })
    const b = normaliseMatchKey({ name: 'Tan', contact: '+6591234567' })
    expect(a).not.toBe(b)
  })
})
