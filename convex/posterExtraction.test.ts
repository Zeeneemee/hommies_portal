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

  it('lifts commute from the visible "Commute to Your Campus" table', () => {
    // Mirrors the actual /room-showcase-pdf layout — each campus on its own
    // row, route text, then "~<N> min", with NTU decorated as the highlighted
    // campus. pdf-parse output is approximated with newline-separated cells.
    const tablePoster = `
LakeGrande · Whole Unit
Commute to Your Campus
Tap any row to open live Google Maps directions

University   Route                                                                       Total    Map
NUS          Lakeside MRT (EW26) → Buona Vista (EW21) → Kent Ridge (CC24)               ~45 min  View →
★ NTU        Lakeside MRT (EW26) → Boon Lay (EW27, 1 stop) → Bus 179/199 to NTU campus  ~30 min  View →
SMU          Lakeside MRT (EW26) → City Hall / Bras Basah area on East-West Line        ~50 min  View →
`
    expect(parsePosterText(tablePoster).commuteMins).toEqual({ NUS: 45, NTU: 30, SMU: 50 })
  })

  it('handles a table laid out with each cell on its own line (pdf-parse style)', () => {
    const tablePoster = `
Commute to Your Campus
NUS
Lakeside MRT → Buona Vista → Kent Ridge
~45 min
View →
NTU
Lakeside MRT → Boon Lay → NTU campus
~30 min
View →
SMU
Lakeside MRT → City Hall area
~50 min
View →
`
    expect(parsePosterText(tablePoster).commuteMins).toEqual({ NUS: 45, NTU: 30, SMU: 50 })
  })

  it('prefers the Property Facts block when both formats appear in the same poster', () => {
    const both = `
Commute to Your Campus
NUS  Lakeside MRT → …  ~99 min
NTU  Lakeside MRT → …  ~99 min
SMU  Lakeside MRT → …  ~99 min

Facts
Commute: NUS 12 · NTU 38 · SMU 22
`
    expect(parsePosterText(both).commuteMins).toEqual({ NUS: 12, NTU: 38, SMU: 22 })
  })

  it('skips table commute when one campus row has no minutes', () => {
    const partialTable = `
Commute to Your Campus
NUS  Lakeside MRT → …  ~45 min
NTU  Lakeside MRT → …  View →
SMU  Lakeside MRT → …  ~50 min
`
    expect(parsePosterText(partialTable).commuteMins).toBeUndefined()
  })

  it('does not confuse MRT line codes like (EW26) for commute minutes', () => {
    const t = `
Commute to Your Campus
NUS  Lakeside MRT (EW26) → Buona Vista (EW21) → Kent Ridge (CC24)  ~45 min
NTU  Lakeside MRT (EW26) → …  ~30 min
SMU  Lakeside MRT (EW26) → …  ~50 min
`
    expect(parsePosterText(t).commuteMins).toEqual({ NUS: 45, NTU: 30, SMU: 50 })
  })
})
