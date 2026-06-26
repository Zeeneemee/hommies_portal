// Free-text requirement parser. Turns a customer's pasted requirement message
// (e.g. forwarded from WhatsApp) into the structured shape we store in the
// Clients sheet + use to build a PropertyGuru search query.
//
// Pure — no Convex/Node imports — so it's safe to import from any runtime and
// to unit test directly. The keyword classifiers (school / building / housing /
// layout) are reused from sheetSync so prose and the sheet import stay aligned;
// budget / contact / name need prose-aware handling and live here.
import {
  parseSchool,
  parseBuildingType,
  parseHousingType,
  parseLayouts,
} from '../sheetSync'

export type ParsedRequirement = {
  name: string
  contact: string
  channel: string
  school: string
  moveIn: string
  leaseLength: string
  budget: { min: number; max: number }
  buildingType: string
  housingType: 'Room' | 'Whole Unit'
  unitLayout: string[]
  bedrooms?: number
  bathrooms?: number
  commuteTolMins: number
  wantRoommate: boolean
}

// A phone (local or +65) or email or @handle. Returned verbatim (trimmed) so it
// round-trips into the sheet; also used to scrub the text before budget parsing
// so phone digits never masquerade as a budget.
function extractContact(text: string): string {
  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)
  if (email) return email[0]
  const phone = text.match(/(\+?\d[\d\s-]{6,}\d)/)
  if (phone) return phone[0].replace(/\s+/g, ' ').trim()
  const handle = text.match(/(?:tele(?:gram)?|tg|ig|wechat|line)[:\s@]+([\w.@-]{3,})/i)
  if (handle) return handle[1]
  return ''
}

function extractName(text: string): string {
  const m = text.match(
    /(?:my name is|name is|i am|i'm|this is|name[:\s])\s*([A-Za-z一-鿿][A-Za-z .'一-鿿-]{0,40})/i,
  )
  if (m) return m[1].split(/[,\n;(]/)[0].trim()
  return ''
}

// Budget from prose. Handles "$2,500", "2500", "2.5k", "2k-3k", "under 3000",
// "budget 2000 to 2500". Scrubs an already-detected contact so its digits are
// never read as money. A lone number → treated as the ceiling (min = max-300,
// floored at 0) to mirror sheetSync.parseBudget's single-value behaviour.
function extractBudget(text: string, contact: string): { min: number; max: number } {
  let t = ` ${text} `
  if (contact) t = t.split(contact).join(' ')
  const nums: number[] = []
  const re = /(\d[\d,]*(?:\.\d+)?)\s*(k)?/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(t)) !== null) {
    const raw = Number(m[1].replace(/,/g, ''))
    if (!Number.isFinite(raw)) continue
    const val = m[2] ? raw * 1000 : raw
    // Plausible monthly rent in SGD. Excludes years, group sizes, stray digits.
    if (val >= 300 && val <= 30000) nums.push(Math.round(val))
  }
  if (nums.length === 0) return { min: 0, max: 99999 }
  if (nums.length === 1) return { min: Math.max(0, nums[0] - 300), max: nums[0] }
  const sorted = [...nums].sort((a, b) => a - b)
  return { min: sorted[0], max: sorted[sorted.length - 1] }
}

function extractCommute(text: string): number {
  const m = text.match(/(\d{1,3})\s*(?:min|mins|minute|minutes|分鐘|分钟)/i)
  return m ? Number(m[1]) : 30
}

function extractMoveIn(text: string): string {
  if (/\b(immediate|immediately|asap|now|move in now)\b|立即|馬上|马上/i.test(text)) return 'Immediate'
  const m = text.match(
    /(?:move[\s-]?in|available|from|入住)[:\s]*([A-Za-z0-9 ./-]{2,20})/i,
  )
  if (m) return m[1].split(/[,\n;]/)[0].trim()
  const month = text.match(
    /\b(\d{1,2}\s*)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i,
  )
  return month ? month[0].trim() : ''
}

function extractLease(text: string): string {
  const m = text.match(/(\d+)\s*(month|months|mo|year|years|yr|yrs)\b/i)
  if (m) return `${m[1]} ${m[2]}`
  if (/租约|租約/.test(text)) {
    const z = text.match(/(\d+)\s*(?:個月|个月|年)/)
    if (z) return z[0]
  }
  return ''
}

// Bedroom / bathroom counts. Handles the compact SG shorthand "2b1b" / "2br1ba"
// / "2bed1bath" (bed first, bath second) as well as the spelled-out
// "2 bedroom 1 bathroom", "2 bedder", "3br". `b` alone is too ambiguous to use
// outside the compact <n>b<n>b form.
function extractBedBath(text: string): { bedrooms?: number; bathrooms?: number } {
  const compact = text.match(
    /(\d+)\s*b(?:ed(?:room)?s?|edder|r)?\s*(\d+)\s*b(?:a(?:th(?:room)?s?)?)?\b/i,
  )
  if (compact) {
    return { bedrooms: Number(compact[1]), bathrooms: Number(compact[2]) }
  }
  const out: { bedrooms?: number; bathrooms?: number } = {}
  const bed = text.match(/(\d+)\s*(?:bed(?:room)?s?|bedder|br)\b/i)
  if (bed) out.bedrooms = Number(bed[1])
  const bath = text.match(/(\d+)\s*(?:bath(?:room)?s?|ba|toilet)\b/i)
  if (bath) out.bathrooms = Number(bath[1])
  return out
}

export function parseRequirementMessage(raw: string): ParsedRequirement {
  const text = String(raw ?? '')
  const contact = extractContact(text)
  const { bedrooms, bathrooms } = extractBedBath(text)
  return {
    name: extractName(text),
    contact,
    channel: 'Portal',
    school: parseSchool(text),
    moveIn: extractMoveIn(text),
    leaseLength: extractLease(text),
    budget: extractBudget(text, contact),
    buildingType: parseBuildingType(text),
    housingType: parseHousingType(text),
    unitLayout: parseLayouts(text),
    bedrooms,
    bathrooms,
    commuteTolMins: extractCommute(text),
    wantRoommate: /\b(roommate|flatmate|share|sharing|housemate)\b|室友|合租/i.test(text),
  }
}

// Compose a natural-language PropertyGuru search query from the parsed fields.
// The site: filter is added by the caller (pgSearch), not here, so this stays a
// plain human query that's easy to unit test.
export function buildSearchQuery(p: ParsedRequirement): string {
  const parts: string[] = []
  if (p.buildingType && p.buildingType !== 'Any') parts.push(p.buildingType.toLowerCase())
  // Bed/bath counts are the most specific signal — prefer them over the generic
  // room/whole-unit token. e.g. "2b1b" → "2 bedroom 1 bathroom".
  if (p.bedrooms) {
    parts.push(`${p.bedrooms} bedroom`)
    if (p.bathrooms) parts.push(`${p.bathrooms} bathroom`)
  } else if (p.unitLayout.length) {
    // Layout is more specific than housing type when present (e.g. "common room").
    parts.push(p.unitLayout[0].toLowerCase())
  } else {
    parts.push(p.housingType === 'Whole Unit' ? 'whole unit' : 'room')
  }
  parts.push('for rent')
  if (p.school && p.school !== 'OTHER') parts.push(`near ${p.school}`)
  if (p.budget.max && p.budget.max < 99999) parts.push(`under ${p.budget.max}`)
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}
