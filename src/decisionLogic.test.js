import { describe, it, expect } from 'vitest'
import {
  decide,
  recommendRecipients,
  draftMessage,
  parseGoogleFormCSV,
  W,
  SEND_THRESHOLD,
  BUDGET_SOFT_OVERSHOOT,
  COMMUTE_SOFT_OVER,
} from './decisionLogic.js'

// --- fixtures ---------------------------------------------------------------

const condoRoom = {
  condo: 'Normanton Park',
  buildingType: 'Condo',
  area: 'Kent Ridge',
  ageYears: 3,
  unitType: 'Common Room',
  rentSGD: 1450,
  housingType: 'Room',
  fullAddress: '1 Normanton Park',
  commuteMins: { NUS: 12, NTU: 38, SMU: 22 },
}

function perfectFitResponse(over = {}) {
  return {
    name: 'Wei Lin / 陳維琳',
    channel: 'Line',
    contact: '@weilin',
    school: 'NUS',
    moveIn: '2026-08-01',
    leaseLength: '12 months',
    budget: { min: 1200, max: 1500 },
    buildingType: 'Condo',
    housingType: 'Room',
    unitLayout: ['Common Room'],
    commuteTolMins: 20,
    wantRoommate: true,
    extras: { petFriendly: false, cookingAllowed: true, quiet: true, nearGym: false, note: '' },
    ...over,
  }
}

const findCrit = (result, labelStarts) =>
  result.criteria.find((c) => c.label.toLowerCase().startsWith(labelStarts.toLowerCase()))

// --- weights & scoring ------------------------------------------------------

describe('weighted six-factor scoring', () => {
  it('weights sum to 100 and a perfect fit scores 100', () => {
    expect(Object.values(W).reduce((a, b) => a + b, 0)).toBe(100)
    expect(decide(perfectFitResponse(), condoRoom).score).toBe(100)
  })

  it('budget within range is `pass`; soft overshoot is `soft`', () => {
    const within = decide(perfectFitResponse(), condoRoom)
    expect(findCrit(within, 'budget').level).toBe('pass')

    // rent 1450, max 1300 → 150 over → within S$200 soft margin
    const soft = decide(perfectFitResponse({ budget: { min: 1100, max: 1300 } }), condoRoom)
    expect(findCrit(soft, 'budget').level).toBe('soft')
    expect(soft.blockers).not.toContain('over_budget')
  })

  it('commute within tolerance is `pass`; well over tolerance is `fail` + blocker', () => {
    const ok = decide(perfectFitResponse({ commuteTolMins: 20 }), condoRoom)
    expect(findCrit(ok, 'commute').level).toBe('pass')

    // commute 12, tolerance 0 → 12 over, > 0 + 15 soft margin? 12 <= 0+15 = soft, not blocker.
    // Need commute - tol > COMMUTE_SOFT_OVER (15). condoRoom has NUS 12. Set tol to -5 not realistic; use NTU 38 with low tol.
    const fail = decide(perfectFitResponse({ school: 'NTU', commuteTolMins: 10 }), condoRoom)
    expect(findCrit(fail, 'commute').level).toBe('fail')
    expect(fail.blockers).toContain('commute_too_far')
  })

  it('school NUS/NTU/SMU is `pass`; OTHER is `soft`', () => {
    expect(findCrit(decide(perfectFitResponse({ school: 'NTU' }), condoRoom), 'school').level).toBe('pass')
    expect(findCrit(decide(perfectFitResponse({ school: 'OTHER' }), condoRoom), 'school').level).toBe('soft')
  })

  it('unit-layout match is `pass`; no overlap is `soft`', () => {
    expect(findCrit(decide(perfectFitResponse({ unitLayout: ['Common Room'] }), condoRoom), 'layout').level).toBe('pass')
    expect(
      findCrit(decide(perfectFitResponse({ unitLayout: ['Master Room'] }), condoRoom), 'layout').level,
    ).toBe('soft')
  })

  it('building type Any or match is `pass`; mismatch is `soft` (not blocker)', () => {
    expect(findCrit(decide(perfectFitResponse({ buildingType: 'Any' }), condoRoom), condoRoom.buildingType).level).toBe('pass')
    const mismatch = decide(perfectFitResponse({ buildingType: 'HDB' }), condoRoom)
    const buildCrit = mismatch.criteria.find((c) => c.label.includes(condoRoom.buildingType))
    expect(buildCrit.level).toBe('soft')
  })

  it('soft commute overshoot scores partial commute weight but no blocker', () => {
    // tolerance 5 vs NUS 12 → 7 over, within 15 soft margin → soft
    const r = decide(perfectFitResponse({ commuteTolMins: 5 }), condoRoom)
    expect(findCrit(r, 'commute').level).toBe('soft')
    expect(r.blockers).not.toContain('commute_too_far')
  })

  it('exposes the documented soft-margin constants', () => {
    expect(BUDGET_SOFT_OVERSHOOT).toBe(200)
    expect(COMMUTE_SOFT_OVER).toBe(15)
  })
})

// --- hard blockers ----------------------------------------------------------

describe('hard blockers and verdict', () => {
  it('over-budget (more than S$200 over max) forces a hold', () => {
    const r = decide(perfectFitResponse({ budget: { min: 800, max: 1100 } }), condoRoom)
    expect(r.blockers).toContain('over_budget')
    expect(r.verdict).toBe('hold')
    expect(r.reason).toMatch(/over.*budget/i)
  })

  it('housing-type mismatch forces a hold', () => {
    const r = decide(perfectFitResponse({ housingType: 'Whole Unit' }), condoRoom)
    expect(r.blockers).toContain('housing_mismatch')
    expect(r.verdict).toBe('hold')
    expect(r.reason).toMatch(/whole unit/i)
  })

  it('commute far beyond tolerance forces a hold', () => {
    const r = decide(perfectFitResponse({ school: 'NTU', commuteTolMins: 5 }), condoRoom)
    expect(r.blockers).toContain('commute_too_far')
    expect(r.verdict).toBe('hold')
  })

  it('a hard blocker overrides an otherwise high score', () => {
    const r = decide(perfectFitResponse({ housingType: 'Whole Unit' }), condoRoom)
    expect(r.score).toBeGreaterThanOrEqual(SEND_THRESHOLD)
    expect(r.verdict).toBe('hold')
  })
})

// --- threshold and verdict reason -----------------------------------------

describe('send threshold 58', () => {
  it('score below 58 with no blocker holds, naming the threshold', () => {
    // Construct a low-but-non-blocked response:
    // school OTHER (school 0 + commute neutral 0), housing match (12),
    // budget perfect (30), layout no-pref (9), building Any (7) → ~58.
    // Push it under by using a small budget soft-overshoot.
    const weak = perfectFitResponse({
      school: 'OTHER',
      budget: { min: 1100, max: 1300 }, // soft overshoot → ratio 0.45
      unitLayout: ['Master Room'], // mismatch → layout soft (0.2)
      buildingType: 'HDB', // building mismatch soft (0.1)
      commuteTolMins: 100,
    })
    const r = decide(weak, condoRoom)
    expect(r.blockers).toHaveLength(0)
    expect(r.score).toBeLessThan(SEND_THRESHOLD)
    expect(r.verdict).toBe('hold')
    expect(r.reason).toMatch(/threshold/i)
  })

  it('exposes SEND_THRESHOLD as 58', () => {
    expect(SEND_THRESHOLD).toBe(58)
  })

  it('every hold verdict carries a non-empty reason', () => {
    const r = decide(perfectFitResponse({ budget: { min: 200, max: 400 } }), condoRoom)
    expect(r.verdict).toBe('hold')
    expect(r.reason.trim().length).toBeGreaterThan(0)
  })
})

// --- recommendRecipients ----------------------------------------------------

describe('recommendRecipients', () => {
  it('ranks Send by descending score and never drops a response', () => {
    const top = perfectFitResponse() // 100
    const lower = perfectFitResponse({ commuteTolMins: 0 }) // soft commute → lower score
    const blocked = perfectFitResponse({ housingType: 'Whole Unit' }) // hold
    const { send, hold } = recommendRecipients(condoRoom, [lower, top, blocked])
    expect(send[0].decision.score).toBeGreaterThanOrEqual(send[1].decision.score)
    expect(send.length + hold.length).toBe(3)
  })

  it('handles an empty response database', () => {
    expect(recommendRecipients(condoRoom, [])).toEqual({ send: [], hold: [] })
  })
})

// --- draftMessage ----------------------------------------------------------

describe('draftMessage', () => {
  it('is bilingual, names the property and rent, and includes the not-agents framing', () => {
    const resp = perfectFitResponse({ name: 'Mei / 陳美' })
    const result = decide(resp, condoRoom)
    const msg = draftMessage(resp, condoRoom, result)
    expect(msg).toContain('Mei')
    expect(msg).toContain('Normanton Park')
    expect(msg).toContain('1450')
    expect(msg).toMatch(/[一-鿿]/) // contains Chinese
    expect(msg).toMatch(/[A-Za-z]/) // contains Latin
    expect(msg).toMatch(/authorised|matchmaker/i)
  })

  it('surfaces a soft caveat honestly when present', () => {
    const resp = perfectFitResponse({ commuteTolMins: 5 }) // soft commute
    const result = decide(resp, condoRoom)
    const msg = draftMessage(resp, condoRoom, result)
    expect(msg).toMatch(/honest|誠實/)
  })
})

// --- parseGoogleFormCSV ----------------------------------------------------

describe('parseGoogleFormCSV', () => {
  it('matches columns by bilingual headers regardless of order, parses budget range, school, layouts', () => {
    const csv =
      '"Timestamp","其他特殊需求 / Additional Requirements","姓名 / Name","學校 / School","每月預算範圍 / Budget","通勤時間 / Commute","偏好房型 / Housing","單位格局 / Layout","房屋類型 / Building","協助媒合室友 / Roommate","聯絡管道 / Channel","聯繫方式 / Contact","入住日期 / Move-in","租約長度 / Lease"\n' +
      '"2026/05/01","Prefer quiet","陳維琳","NUS","S$1200 - S$1500","20","Room","Common Room, Master Room","Condo","Yes","Line","@weilin","2026-08-01","12 months"'
    const rows = parseGoogleFormCSV(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('陳維琳')
    expect(rows[0].school).toBe('NUS')
    expect(rows[0].budget).toEqual({ min: 1200, max: 1500 })
    expect(rows[0].housingType).toBe('Room')
    expect(rows[0].unitLayout).toEqual(['Common Room', 'Master Room'])
    expect(rows[0].buildingType).toBe('Condo')
    expect(rows[0].commuteTolMins).toBe(20)
    expect(rows[0].wantRoommate).toBe(true)
    expect(rows[0].source).toBe('csv')
  })

  it('returns [] for an empty or single-line CSV', () => {
    expect(parseGoogleFormCSV('')).toEqual([])
    expect(parseGoogleFormCSV('only,one,header,row')).toEqual([])
  })

  it('flags free-text extras into recognised boolean flags', () => {
    const csv =
      '"姓名","其他需求"\n"Alex","Loves to cook and needs a gym, prefer quiet flatmates"'
    const rows = parseGoogleFormCSV(csv)
    expect(rows[0].extras.cookingAllowed).toBe(true)
    expect(rows[0].extras.nearGym).toBe(true)
    expect(rows[0].extras.quiet).toBe(true)
    expect(rows[0].extras.petFriendly).toBe(false)
  })
})
