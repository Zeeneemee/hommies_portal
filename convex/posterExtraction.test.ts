import { describe, it, expect } from 'vitest'
import { parsePosterText } from './posterExtraction'

const FULL_POSTER = `
NORMANTON PARK · Common Room
Hommies.sg · we connect students with authorized agents — we are not agents.

S$1,450 / mo

Facts
Monthly rent: S$1,450
Area: Kent Ridge
Building type: Condo
Housing type: Room
Age: 3 years
Room type: Common Room
Commute: NUS 12 · NTU 38 · SMU 22

[photos grid]
`

describe('parsePosterText', () => {
  it('lifts every labeled field from a well-formed poster', () => {
    expect(parsePosterText(FULL_POSTER)).toEqual({
      rentSGD: 1450,
      area: 'Kent Ridge',
      buildingType: 'Condo',
      housingType: 'Room',
      ageYears: 3,
      unitType: 'Common Room',
      commuteMins: { NUS: 12, NTU: 38, SMU: 22 },
    })
  })

  it('returns only fields that matched (missing labels are absent)', () => {
    const partial = `
      Monthly rent: S$2,200
      Building type: HDB
    `
    const out = parsePosterText(partial)
    expect(out.rentSGD).toBe(2200)
    expect(out.buildingType).toBe('HDB')
    expect('area' in out).toBe(false)
    expect('housingType' in out).toBe(false)
    expect('commuteMins' in out).toBe(false)
  })

  it('handles a Whole Unit housing type', () => {
    expect(parsePosterText('Housing type: Whole Unit')).toEqual({ housingType: 'Whole Unit' })
  })

  it('skips commute when only some campuses appear', () => {
    expect(parsePosterText('Commute: NUS 12 · NTU 38').commuteMins).toBeUndefined()
  })

  it('returns {} for empty or garbage input', () => {
    expect(parsePosterText('')).toEqual({})
    expect(parsePosterText('the brown fox')).toEqual({})
  })

  it('tolerates en-dashes, non-breaking spaces, and capitalised label variations', () => {
    const fancy = `MONTHLY RENT: S$ 1 750\nAREA: Pasir Panjang\nBUILDING TYPE: Condo`
    const out = parsePosterText(fancy)
    expect(out.rentSGD).toBe(1750)
    expect(out.area).toBe('Pasir Panjang')
    expect(out.buildingType).toBe('Condo')
  })
})
