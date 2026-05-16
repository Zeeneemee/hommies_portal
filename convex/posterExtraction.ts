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

  // Commute — match all three campus minutes off one line:
  //   "Commute: NUS 12 · NTU 38 · SMU 22" (separators tolerated: ·, |, ,)
  const commuteLine = first(
    t,
    /Commute[:\s]+([^\n\r]+?)(?=\n|\r|$)/i,
  )
  if (commuteLine) {
    const NUS = numAfter(commuteLine, /NUS/i)
    const NTU = numAfter(commuteLine, /NTU/i)
    const SMU = numAfter(commuteLine, /SMU/i)
    if (NUS != null && NTU != null && SMU != null) {
      out.commuteMins = { NUS, NTU, SMU }
    }
  }

  return out
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
