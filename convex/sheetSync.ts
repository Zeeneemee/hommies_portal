// Pure normalisation helpers for /sheet/sync — takes the raw 2-D shape that
// Apps Script ships (header row + data rows) and produces objects that match
// the `responses` table validator. Mirrors src/decisionLogic.js's
// parseGoogleFormCSV so the in-app CSV import and the sheet-trigger import
// produce identical records.

// Match-key normaliser shared between upsertFromSheet's tier-2 dedupe and the
// one-shot mergeDuplicates cleanup mutation. Empty key means "anonymous" and
// must never collapse rows together.
export function normaliseMatchKey(input: { name: unknown; contact: unknown }): string {
  const norm = (s: unknown) =>
    String(s ?? '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
  const n = norm(input.name)
  const c = norm(input.contact)
  if (!n && !c) return ''
  return `${n}|${c}`
}

export type NormalisedResponse = {
  name: string
  channel: string
  contact: string
  school: string
  moveIn: string
  leaseLength: string
  budget: { min: number; max: number }
  buildingType: string
  housingType: 'Room' | 'Whole Unit'
  unitLayout: string[]
  commuteTolMins: number
  wantRoommate: boolean
  groupSize?: number
  extras: {
    petFriendly: boolean
    cookingAllowed: boolean
    quiet: boolean
    nearGym: boolean
    note: string
  }
  source?: string
  sheetTimestamp?: string
}

function findCol(headers: string[], ...needles: string[]): number {
  for (let i = 0; i < headers.length; i++) {
    const h = (headers[i] || '').toLowerCase()
    if (needles.some((n) => h.includes(String(n).toLowerCase()))) return i
  }
  return -1
}

function parseBudget(s: unknown): { min: number; max: number } {
  const text = String(s ?? '').replace(/,/g, '')
  const nums = (text.match(/\d{3,5}/g) || []).map(Number)
  if (nums.length === 0) return { min: 0, max: 99999 }
  if (nums.length === 1) return { min: Math.max(0, nums[0] - 200), max: nums[0] }
  const sorted = [...nums].sort((a, b) => a - b)
  return { min: sorted[0], max: sorted[sorted.length - 1] }
}

function parseSchool(s: unknown): string {
  const u = String(s ?? '').toUpperCase()
  if (u.includes('NUS')) return 'NUS'
  if (u.includes('NTU')) return 'NTU'
  if (u.includes('SMU')) return 'SMU'
  return 'OTHER'
}

function parseBuildingType(s: unknown): string {
  const u = String(s ?? '').toLowerCase()
  if (u.includes('hdb') || u.includes('組屋') || u.includes('组屋')) return 'HDB'
  if (u.includes('condo') || u.includes('公寓')) return 'Condo'
  return 'Any'
}

function parseHousingType(s: unknown): 'Room' | 'Whole Unit' {
  const u = String(s ?? '').toLowerCase()
  if (u.includes('whole') || u.includes('整層') || u.includes('整间') || u.includes('整套')) {
    return 'Whole Unit'
  }
  return 'Room'
}

function parseLayouts(s: unknown): string[] {
  const u = String(s ?? '')
  const out: string[] = []
  if (/common/i.test(u) || /普通/.test(u)) out.push('Common Room')
  if (/master/i.test(u) || /主臥|主卧/.test(u)) out.push('Master Room')
  if (/studio/i.test(u) || /套房/.test(u)) out.push('Studio')
  if (/whole/i.test(u) || /整層|整间|整套/.test(u)) out.push('Whole Unit')
  return out
}

function parseCommute(s: unknown): number {
  const m = String(s ?? '').match(/(\d{1,3})/)
  return m ? +m[1] : 30
}

// "3", "3 people", "我们三个" → 3; "couple"/"一對"/"一对" → 2. Empty or
// unparseable → undefined (engine treats absence as solo, no hardcoded default).
export function parseGroupSize(s: unknown): number | undefined {
  const text = String(s ?? '').trim()
  if (!text) return undefined
  if (/^(couple|情侶|情侣|一對|一对)/i.test(text)) return 2
  const m = text.match(/(\d{1,2})/)
  if (!m) return undefined
  const n = Number(m[1])
  if (!Number.isFinite(n) || n < 1) return undefined
  return Math.floor(n)
}

export function normaliseSheetRows(headers: string[], rows: unknown[][]): NormalisedResponse[] {
  const col = {
    timestamp: findCol(headers, 'timestamp', 'ประทับเวลา', '時間戳記', '時間', '时间'),
    name: findCol(headers, '姓名', 'full name', 'name'),
    channel: findCol(headers, '管道', 'channel'),
    // Be specific — channel header also contains "contact" via "Preferred Contact Channel".
    contact: findCol(headers, '聯繫方式', '聯絡方式', 'contact details', 'details'),
    school: findCol(headers, '學校', '学校', 'school', 'university'),
    moveIn: findCol(headers, '入住', 'move-in', 'move in'),
    lease: findCol(headers, '租約', '租约', 'lease'),
    budget: findCol(headers, '預算', '预算', 'budget'),
    building: findCol(headers, '房屋類型', '房屋类型', 'building'),
    housing: findCol(headers, '偏好房型', 'housing'),
    layout: findCol(headers, '單位格局', '单位格局', 'layout'),
    commute: findCol(headers, '通勤', 'commute'),
    roommate: findCol(headers, '室友', 'roommate'),
    groupSize: findCol(headers, 'group size', 'party size', 'how many', '人數', '人数', '组数', '組數'),
    extras: findCol(headers, '其他需求', '特殊需求', 'extras', 'requirements'),
  }

  const cell = (r: unknown[], i: number) => (i >= 0 ? String(r[i] ?? '').trim() : '')

  return rows
    .map<NormalisedResponse | null>((r) => {
      const name = cell(r, col.name) || 'Unnamed'
      const contact = cell(r, col.contact)
      if (name === 'Unnamed' && !contact) return null
      const extrasText = cell(r, col.extras)
      return {
        name,
        channel: cell(r, col.channel) || 'Form',
        contact,
        school: parseSchool(r[col.school]),
        moveIn: cell(r, col.moveIn),
        leaseLength: cell(r, col.lease),
        budget: parseBudget(r[col.budget]),
        buildingType: parseBuildingType(r[col.building]),
        housingType: parseHousingType(r[col.housing]),
        unitLayout: parseLayouts(r[col.layout]),
        commuteTolMins: parseCommute(r[col.commute]),
        wantRoommate: /yes|是|想|要|true/i.test(cell(r, col.roommate)),
        groupSize: parseGroupSize(r[col.groupSize]),
        extras: {
          petFriendly: /pet|寵物|宠物/i.test(extrasText),
          cookingAllowed: /cook|煮|開伙|开伙|下廚|下厨/i.test(extrasText),
          quiet: /quiet|安靜|安静/i.test(extrasText),
          nearGym: /gym|健身/i.test(extrasText),
          note: extrasText,
        },
        source: 'sheet',
        sheetTimestamp: cell(r, col.timestamp) || undefined,
      }
    })
    .filter((r): r is NormalisedResponse => r !== null)
}
