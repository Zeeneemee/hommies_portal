// Pure parser — takes the raw text of a /room-showcase-pdf poster and lifts
// the structured detail fields out of the labeled "Facts" block the brief
// asks Claude to include. No PDF / Node deps so this file can be unit-tested
// in vitest without the runtime.

export type ExtractedFields = {
  area?: string
  buildingType?: 'Condo' | 'HDB'
  housingType?: 'Room' | 'Whole Unit'
  ageYears?: number
  unitType?: string
  rentSGD?: number
  commuteMins?: { NUS: number; NTU: number; SMU: number }
}

const KNOWN_UNIT_TYPES = ['Common Room', 'Master Room', 'Studio', 'Whole Unit']

/**
 * Parse the labeled "Facts" block out of a poster's text. Every field is
 * best-effort — anything not matched is simply omitted. The caller never
 * overwrites existing values with `undefined`.
 */
export function parsePosterText(text: string): ExtractedFields {
  const out: ExtractedFields = {}
  if (!text) return out
  // Normalise whitespace and curly hyphens / dashes so a single regex set works.
  const t = text.replace(/–|—/g, '-').replace(/ /g, ' ')

  // Rent — tolerant of comma-grouping ("1,450") or space-grouping ("1 750").
  // Capture a digit-run that may include commas or spaces, then strip non-digits.
  const rent = first(t, /Monthly\s*rent[:\s]+S\$\s*(\d[\d, ]{0,12}\d|\d)/i)
  if (rent) {
    const n = Number(rent.replace(/[^\d]/g, ''))
    if (Number.isFinite(n) && n > 0) out.rentSGD = n
  }

  const area = first(t, /\bArea[:\s]+([^\n\r·|]+?)(?=\s{2,}|\n|\r|$)/i)
  if (area) out.area = area.trim()

  const building = first(t, /Building\s*type[:\s]+(Condo|HDB)\b/i)
  if (building) out.buildingType = building.toUpperCase() === 'HDB' ? 'HDB' : 'Condo'

  const housing = first(t, /Housing\s*type[:\s]+(Room|Whole\s*Unit)\b/i)
  if (housing) out.housingType = /whole/i.test(housing) ? 'Whole Unit' : 'Room'

  const age = first(t, /\bAge[:\s]+(\d{1,3})\s*year/i)
  if (age) out.ageYears = Number(age)

  // Match against the known unit types first, then fall through to the raw text.
  for (const ut of KNOWN_UNIT_TYPES) {
    const re = new RegExp(`Room\\s*type[:\\s]+(${ut.replace(/ /g, '\\s*')})\\b`, 'i')
    const m = t.match(re)
    if (m) {
      out.unitType = ut
      break
    }
  }
  if (!out.unitType) {
    const raw = first(t, /Room\s*type[:\s]+([A-Za-z][A-Za-z\s]{2,30}?)(?=\s*$|\n|\r|·|\|)/i)
    if (raw) out.unitType = raw.trim()
  }

  // Commute — two formats are tolerated:
  //
  //   1. The legacy "Property Facts" block (single labeled line):
  //        Commute: NUS 12 · NTU 38 · SMU 22
  //
  //   2. The visible "Commute to Your Campus" table from the
  //      /room-showcase-pdf poster, where each campus is on its own row with
  //      an approximate value:
  //        NUS  Lakeside MRT → … → Kent Ridge    ~45 min  View →
  //        ★ NTU Lakeside MRT → …                ~30 min  View →
  //        SMU  Lakeside MRT → …                 ~50 min  View →
  //
  // Try the fast single-line path first; if it doesn't yield all three,
  // fall back to per-campus zone parsing across the whole text.
  // The colon is intentional — it distinguishes the Property Facts line from
  // the visible "Commute to Your Campus" header (no colon), which would
  // otherwise be a first-match red herring.
  const factsLine = first(t, /Commute\s*:\s*([^\n\r]+?)(?=\n|\r|$)/i)
  if (factsLine) {
    const NUS = numAfter(factsLine, /NUS/i)
    const NTU = numAfter(factsLine, /NTU/i)
    const SMU = numAfter(factsLine, /SMU/i)
    if (NUS != null && NTU != null && SMU != null) {
      out.commuteMins = { NUS, NTU, SMU }
    }
  }
  if (!out.commuteMins) {
    const NUS = findCampusMins(t, 'NUS')
    const NTU = findCampusMins(t, 'NTU')
    const SMU = findCampusMins(t, 'SMU')
    if (NUS != null && NTU != null && SMU != null) {
      out.commuteMins = { NUS, NTU, SMU }
    }
  }

  return out
}

// Per-campus zone parser: find the campus label, then look for the next
// "~?<N> min" before the next campus label appears. The zone bound prevents
// one campus's minutes from being attributed to another when a row is
// missing or rearranged.
function findCampusMins(text: string, campus: 'NUS' | 'NTU' | 'SMU'): number | null {
  const campusRe = new RegExp(`\\b${campus}\\b`, 'i')
  const start = campusRe.exec(text)
  if (!start) return null
  const zoneStart = start.index + start[0].length

  const others = (['NUS', 'NTU', 'SMU'] as const).filter((c) => c !== campus)
  let zoneEnd = text.length
  for (const other of others) {
    const otherRe = new RegExp(`\\b${other}\\b`, 'gi')
    otherRe.lastIndex = zoneStart
    const m = otherRe.exec(text)
    if (m && m.index < zoneEnd) zoneEnd = m.index
  }

  const zone = text.slice(zoneStart, zoneEnd)
  const minMatch = zone.match(/~?\s*(\d{1,3})\s*min\b/i)
  return minMatch ? Number(minMatch[1]) : null
}

function first(text: string, re: RegExp): string {
  const m = text.match(re)
  return m ? m[1] : ''
}

function numAfter(text: string, marker: RegExp): number | null {
  const re = new RegExp(marker.source + '\\s*[:\\-]?\\s*(\\d{1,3})', marker.flags)
  const m = text.match(re)
  return m ? Number(m[1]) : null
}
