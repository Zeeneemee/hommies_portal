import { describe, it, expect } from 'vitest'
import {
  decide,
  recommendRecipients,
  draftMessage,
  parseGoogleFormCSV,
  splitRent,
  parseMoveInDate,
  parseLeaseMonths,
  pairFitForProperty,
  assembleCohort,
  cohortMoveInSpan,
  COHORT_TIE_BREAKERS,
  W,
  SEND_THRESHOLD,
  BUDGET_SOFT_OVERSHOOT,
  COMMUTE_SOFT_OVER,
  MASTER_PREMIUM,
  PAIR_WEIGHTS,
  MOVEIN_BLOCKER_DAYS,
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

// --- splitRent (rent split for whole-unit listings) -----------------------

describe('splitRent — Option A (master 1.2× of average, commons absorb remainder)', () => {
  it('1 master + 1 common at S$4,300 → 2580 / 1720, sums to 4300', () => {
    const r = splitRent({ rentSGD: 4300, masterCount: 1, commonCount: 1 })
    expect(r.master).toBeCloseTo(2580, 6)
    expect(r.common).toBeCloseTo(1720, 6)
    expect(r.perRoomAvg).toBeCloseTo(2150, 6)
    expect(1 * r.master + 1 * r.common).toBeCloseTo(4300, 6)
  })

  it('1 master + 2 common at S$4,300 → master×1.2×avg, commons absorb, total conserved', () => {
    const r = splitRent({ rentSGD: 4300, masterCount: 1, commonCount: 2 })
    const avg = 4300 / 3
    expect(r.master).toBeCloseTo(avg * MASTER_PREMIUM, 6)
    expect(r.common).toBeCloseTo((4300 - 1 * r.master) / 2, 6)
    expect(1 * r.master + 2 * r.common).toBeCloseTo(4300, 6)
  })

  it('all masters (no commons) → each master pays an equal share, no premium', () => {
    const r = splitRent({ rentSGD: 4000, masterCount: 2, commonCount: 0 })
    expect(r.master).toBeCloseTo(2000, 6)
    expect(r.common).toBeNull()
    expect(r.perRoomAvg).toBeCloseTo(2000, 6)
  })

  it('all commons (no master) → each common pays an equal share', () => {
    const r = splitRent({ rentSGD: 3000, masterCount: 0, commonCount: 3 })
    expect(r.master).toBeNull()
    expect(r.common).toBeCloseTo(1000, 6)
    expect(r.perRoomAvg).toBeCloseTo(1000, 6)
  })

  it('missing counts → null', () => {
    expect(splitRent({ rentSGD: 4300, masterCount: 0, commonCount: 0 })).toBeNull()
    expect(splitRent({ rentSGD: 4300, masterCount: 1 })).toBeNull()
    expect(splitRent({ rentSGD: 4300, commonCount: 1 })).toBeNull()
    expect(splitRent({ rentSGD: 4300 })).toBeNull()
    expect(splitRent({ masterCount: 1, commonCount: 2 })).toBeNull()
  })
})

// --- group-aware decide() -------------------------------------------------

describe('decide() group-aware split scoring', () => {
  const wholeUnit_1M_2C = {
    condo: 'Normanton Park',
    buildingType: 'Condo',
    area: 'Kent Ridge',
    ageYears: 3,
    unitType: 'Whole Unit',
    rentSGD: 4300,
    housingType: 'Whole Unit',
    masterCount: 1,
    commonCount: 2,
    fullAddress: '1 Normanton Park',
    commuteMins: { NUS: 12, NTU: 38, SMU: 22 },
  }
  const groupResponse = (over = {}) => ({
    name: 'Trio',
    channel: 'Line',
    contact: '@trio',
    school: 'NUS',
    moveIn: '2026-08-01',
    leaseLength: '12 months',
    budget: { min: 1000, max: 1500 },
    buildingType: 'Condo',
    housingType: 'Whole Unit',
    unitLayout: ['Whole Unit'],
    commuteTolMins: 20,
    wantRoommate: true,
    groupSize: 3,
    extras: { petFriendly: false, cookingAllowed: false, quiet: false, nearGym: false, note: '' },
    ...over,
  })

  it('group=3 budget S$1,000–1,500 on a S$4,300 1M+2C unit → common-room rent fits, no over_budget', () => {
    const r = decide(groupResponse(), wholeUnit_1M_2C)
    expect(r.blockers).not.toContain('over_budget')
    expect(r.blockers).not.toContain('over_layout')
    expect(r.groupContext).toBeTruthy()
    expect(r.groupContext.roomKind).toBe('common')
    // per-person rent ~ S$1290, well within 1000-1500
    expect(r.groupContext.perPersonRent).toBeGreaterThan(1200)
    expect(r.groupContext.perPersonRent).toBeLessThan(1400)
  })

  it('solo customer on the same whole unit → compares full S$4,300 against budget (no split)', () => {
    const r = decide(groupResponse({ groupSize: 1 }), wholeUnit_1M_2C)
    expect(r.groupContext).toBeNull()
    expect(r.blockers).toContain('over_budget') // 4300 ≫ 1500
  })

  it('groupSize absent on the response → split path skipped', () => {
    const resp = groupResponse()
    delete resp.groupSize
    const r = decide(resp, wholeUnit_1M_2C)
    expect(r.groupContext).toBeNull()
    expect(r.blockers).toContain('over_budget')
  })

  it('whole unit without master/common counts → group response falls back to full rent', () => {
    const propNoCounts = { ...wholeUnit_1M_2C }
    delete propNoCounts.masterCount
    delete propNoCounts.commonCount
    const r = decide(groupResponse(), propNoCounts)
    expect(r.groupContext).toBeNull()
    expect(r.blockers).toContain('over_budget')
  })

  it('over_layout: group of 4 on a 1M+2C unit → hard blocker, hold verdict', () => {
    const r = decide(groupResponse({ groupSize: 4 }), wholeUnit_1M_2C)
    expect(r.blockers).toContain('over_layout')
    expect(r.verdict).toBe('hold')
    expect(r.reason).toMatch(/fits|group/i)
  })

  it('group exactly equals room count → over_layout does NOT trigger', () => {
    const r = decide(groupResponse({ groupSize: 3 }), wholeUnit_1M_2C)
    expect(r.blockers).not.toContain('over_layout')
  })

  it('budget criterion detail labels the rent as per-person when split is active', () => {
    const r = decide(groupResponse(), wholeUnit_1M_2C)
    const budget = r.criteria.find((c) => c.label.startsWith('Budget'))
    expect(budget.detail).toMatch(/per-person/i)
  })

  it('group of 2 on a "Room" listing → split path skipped (Room listings price per-person already)', () => {
    const roomProp = { ...wholeUnit_1M_2C, housingType: 'Room', unitType: 'Common Room', rentSGD: 1450 }
    // Even though we set masterCount/commonCount on the Room listing for sanity,
    // the engine should skip the split path because housingType !== "Whole Unit".
    const resp = groupResponse({ groupSize: 2, housingType: 'Room' })
    const r = decide(resp, roomProp)
    expect(r.groupContext).toBeNull()
    // Per-person budget gate uses full 1450 against 1000-1500 → in range → pass.
    expect(r.blockers).not.toContain('over_budget')
  })

  it('decision.groupContext exposes split + chosen room kind + groupSize', () => {
    const r = decide(groupResponse(), wholeUnit_1M_2C)
    expect(r.groupContext).toMatchObject({
      roomKind: 'common',
      groupSize: 3,
    })
    expect(r.groupContext.split).toMatchObject({
      master: expect.any(Number),
      common: expect.any(Number),
      perRoomAvg: expect.any(Number),
    })
    // Total conserves rent.
    const { split } = r.groupContext
    expect(1 * split.master + 2 * split.common).toBeCloseTo(4300, 6)
  })

  it('group on a whole unit with all masters (no commons) → master rent is the budget input', () => {
    const allMaster = { ...wholeUnit_1M_2C, masterCount: 2, commonCount: 0, rentSGD: 4000 }
    const r = decide(groupResponse({ groupSize: 2, budget: { min: 1500, max: 2500 } }), allMaster)
    expect(r.groupContext.roomKind).toBe('master')
    // 4000 / 2 = 2000 per person → inside 1500-2500
    expect(r.blockers).not.toContain('over_budget')
  })

  it('2M + 1C layout → common is still cheaper, used as the budget input', () => {
    // 2M+1C @ 4300: avg=1433, master=1720, common=4300-2*1720=860
    const twoMasterOneCommon = { ...wholeUnit_1M_2C, masterCount: 2, commonCount: 1 }
    const r = decide(groupResponse({ groupSize: 3, budget: { min: 700, max: 1000 } }), twoMasterOneCommon)
    expect(r.groupContext.roomKind).toBe('common')
    expect(r.groupContext.perPersonRent).toBeCloseTo(860, 0)
    expect(r.blockers).not.toContain('over_budget')
  })
})

// --- parseMoveInDate ------------------------------------------------------

describe('parseMoveInDate', () => {
  it('accepts ISO date', () => {
    const d = parseMoveInDate('2026-08-01')
    expect(d).toBeInstanceOf(Date)
    expect(d.getUTCFullYear()).toBe(2026)
    expect(d.getUTCMonth()).toBe(7) // August (0-indexed)
    expect(d.getUTCDate()).toBe(1)
  })

  it('accepts "Aug 2026"', () => {
    const d = parseMoveInDate('Aug 2026')
    expect(d).toBeInstanceOf(Date)
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(7)
  })

  it('accepts "1 Aug 2026"', () => {
    const d = parseMoveInDate('1 Aug 2026')
    expect(d).toBeInstanceOf(Date)
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(7)
    expect(d.getDate()).toBe(1)
  })

  it('extracts ISO substring from noisy text', () => {
    const d = parseMoveInDate('on 2026-08-01')
    expect(d).toBeInstanceOf(Date)
    expect(d.getUTCFullYear()).toBe(2026)
  })

  it('rejects sentinel words', () => {
    expect(parseMoveInDate('Immediate')).toBeNull()
    expect(parseMoveInDate('immediate')).toBeNull()
    expect(parseMoveInDate('ASAP')).toBeNull()
    expect(parseMoveInDate('flexible')).toBeNull()
    expect(parseMoveInDate('TBD')).toBeNull()
  })

  it('rejects blank / nullish', () => {
    expect(parseMoveInDate('')).toBeNull()
    expect(parseMoveInDate('   ')).toBeNull()
    expect(parseMoveInDate(null)).toBeNull()
    expect(parseMoveInDate(undefined)).toBeNull()
  })

  it('rejects nonsense', () => {
    expect(parseMoveInDate('not a date')).toBeNull()
  })
})

// --- parseLeaseMonths -----------------------------------------------------

describe('parseLeaseMonths', () => {
  it('normalises common English variants to integer months', () => {
    expect(parseLeaseMonths('12 months')).toBe(12)
    expect(parseLeaseMonths('1 year')).toBe(12)
    expect(parseLeaseMonths('12mo')).toBe(12)
    expect(parseLeaseMonths('6 month')).toBe(6)
    expect(parseLeaseMonths('2 years')).toBe(24)
  })

  it('accepts bare integer', () => {
    expect(parseLeaseMonths('12')).toBe(12)
    expect(parseLeaseMonths('6')).toBe(6)
  })

  it('handles "6+6" renewable pattern', () => {
    expect(parseLeaseMonths('6+6')).toBe(12)
    expect(parseLeaseMonths('6 + 6')).toBe(12)
  })

  it('accepts Chinese variants', () => {
    expect(parseLeaseMonths('半年')).toBe(6)
    expect(parseLeaseMonths('一年')).toBe(12)
    expect(parseLeaseMonths('兩年')).toBe(24)
    expect(parseLeaseMonths('两年')).toBe(24)
  })

  it('rejects blank / sentinel', () => {
    expect(parseLeaseMonths('')).toBeNull()
    expect(parseLeaseMonths(null)).toBeNull()
    expect(parseLeaseMonths(undefined)).toBeNull()
    expect(parseLeaseMonths('flexible')).toBeNull()
    expect(parseLeaseMonths('negotiable')).toBeNull()
    expect(parseLeaseMonths('tbd')).toBeNull()
  })
})

// --- pairFitForProperty ---------------------------------------------------

describe('pairFitForProperty — fixtures from the worked trace', () => {
  const normantonPark = {
    _id: 'p1',
    condo: 'Normanton Park',
    area: 'Kent Ridge',
    buildingType: 'Condo',
    housingType: 'Whole Unit',
    masterCount: 1,
    commonCount: 2,
    rentSGD: 4500,
    commuteMins: { NUS: 12, NTU: 38, SMU: 22 },
  }

  const baseResp = (over = {}) => ({
    _id: 'r-default',
    name: 'Default',
    channel: 'Line',
    contact: '@x',
    school: 'NUS',
    moveIn: '2026-08-05',
    leaseLength: '12 months',
    budget: { min: 1200, max: 1500 },
    buildingType: 'Condo',
    housingType: 'Room',
    unitLayout: ['Common Room'],
    commuteTolMins: 20,
    wantRoommate: true,
    groupSize: 1,
    extras: { petFriendly: false, cookingAllowed: false, quiet: false, nearGym: false, note: '' },
    ...over,
  })

  const wei = baseResp({
    _id: 'r-wei', name: 'Wei',
    budget: { min: 1200, max: 1500 }, moveIn: '2026-08-01', commuteTolMins: 20,
    extras: { quiet: true, cooking: true, petFriendly: false, nearGym: false, note: 'Prefer non-smoker' },
  })
  const arjun = baseResp({
    _id: 'r-arjun', name: 'Arjun',
    budget: { min: 1300, max: 1600 }, moveIn: '2026-08-10', commuteTolMins: 25,
    extras: { quiet: true, cooking: false, petFriendly: false, nearGym: false, note: '' },
  })
  const mei = baseResp({
    _id: 'r-mei', name: 'Mei',
    budget: { min: 1600, max: 2000 }, moveIn: '2026-08-05', commuteTolMins: 20,
    extras: { quiet: false, cooking: true, petFriendly: false, nearGym: false, note: '' },
  })

  it('Wei × Arjun on 1M+2C @ S$4,500 → 100/100, both common, no blockers', () => {
    const r = pairFitForProperty(wei, arjun, normantonPark)
    expect(r).not.toBeNull()
    expect(r.verdict).toBe('fit')
    expect(r.blockers).toEqual([])
    expect(r.score).toBe(100)
    expect(r.perPersonRent['r-wei']).toEqual({ rent: 1350, roomKind: 'common' })
    expect(r.perPersonRent['r-arjun']).toEqual({ rent: 1350, roomKind: 'common' })
  })

  it('Wei × Mei → fit, Wei→common Mei→master, no blockers', () => {
    const r = pairFitForProperty(wei, mei, normantonPark)
    expect(r).not.toBeNull()
    expect(r.verdict).toBe('fit')
    expect(r.blockers).toEqual([])
    expect(r.perPersonRent['r-wei']).toEqual({ rent: 1350, roomKind: 'common' })
    expect(r.perPersonRent['r-mei']).toEqual({ rent: 1800, roomKind: 'master' })
  })

  it('Variant A — Wei moveIn 2026-06-01 → movein_too_far blocker', () => {
    const weiEarly = { ...wei, moveIn: '2026-06-01' }
    const r = pairFitForProperty(weiEarly, mei, normantonPark)
    expect(r.blockers).toContain('movein_too_far')
    expect(r.verdict).toBe('unfit')
  })

  it('Variant B — lease 12 vs 6 → lease_mismatch blocker', () => {
    const meiShort = { ...mei, leaseLength: '6 months' }
    const r = pairFitForProperty(arjun, meiShort, normantonPark)
    expect(r.blockers).toContain('lease_mismatch')
    expect(r.verdict).toBe('unfit')
  })

  it('Variant C — wantRoommate=false → consent_missing blocker', () => {
    const weiOpts = { ...wei, wantRoommate: false }
    const r = pairFitForProperty(weiOpts, arjun, normantonPark)
    expect(r.blockers).toContain('consent_missing')
    expect(r.verdict).toBe('unfit')
  })

  it('Variant D — budget.max=1000 (cannot afford common 1350 even +soft 200) → budget_unaffordable', () => {
    const broke = { ...wei, budget: { min: 800, max: 1000 } }
    const r = pairFitForProperty(broke, arjun, normantonPark)
    expect(r.blockers).toContain('budget_unaffordable')
    expect(r.verdict).toBe('unfit')
  })

  it('Same object reference → null', () => {
    expect(pairFitForProperty(wei, wei, normantonPark)).toBeNull()
  })

  it('Same _id on different objects → null', () => {
    const weiClone = { ...wei }
    expect(pairFitForProperty(wei, weiClone, normantonPark)).toBeNull()
  })

  it('Either side has groupSize > 1 → null', () => {
    const trio = { ...wei, _id: 'r-trio', groupSize: 3 }
    expect(pairFitForProperty(trio, arjun, normantonPark)).toBeNull()
    expect(pairFitForProperty(wei, trio, normantonPark)).toBeNull()
  })

  it('Lease equality via different strings ("12 months" vs "1 year") → no blocker', () => {
    const arjunYear = { ...arjun, leaseLength: '1 year' }
    const r = pairFitForProperty(wei, arjunYear, normantonPark)
    expect(r.blockers).not.toContain('lease_mismatch')
  })

  it('Lease unparseable on one side → soft + warning note, no blocker', () => {
    const flex = { ...arjun, leaseLength: 'flexible' }
    const r = pairFitForProperty(wei, flex, normantonPark)
    expect(r.blockers).not.toContain('lease_mismatch')
    expect(r.notes.some((n) => /unparseable.*lease/i.test(n))).toBe(true)
  })

  it('Asymmetric quiet preference → score unchanged from matching case, note emitted', () => {
    // Build two responses that match on EVERY factor; only quiet differs.
    const quietA = baseResp({ _id: 'rA', name: 'A', extras: { quiet: true, cooking: false, petFriendly: false, nearGym: false, note: '' } })
    const quietB = baseResp({ _id: 'rB', name: 'B', extras: { quiet: true, cooking: false, petFriendly: false, nearGym: false, note: '' } })
    const loudB = { ...quietB, extras: { ...quietB.extras, quiet: false } }
    const matching = pairFitForProperty(quietA, quietB, normantonPark)
    const asymmetric = pairFitForProperty(quietA, loudB, normantonPark)
    expect(asymmetric.score).toBe(matching.score)
    expect(asymmetric.notes.some((n) => /quiet/i.test(n))).toBe(true)
    expect(matching.notes.some((n) => /quiet/i.test(n))).toBe(false)
  })

  it('Free-text extras.note emitted as a prefixed note', () => {
    // Wei has note "Prefer non-smoker". Arjun has empty note.
    const r = pairFitForProperty(wei, arjun, normantonPark)
    expect(r.notes.some((n) => n.includes('Wei') && n.includes('non-smoker'))).toBe(true)
  })

  it('Property with commonCount=0 + both sides only afford common → budget_unaffordable', () => {
    const onlyMaster = { ...normantonPark, commonCount: 0, masterCount: 2, rentSGD: 3600 } // master = 1800 each
    // Both Wei/Arjun max <= 1600, can't afford 1800 + soft margin → unaffordable
    const r = pairFitForProperty(wei, arjun, onlyMaster)
    expect(r.blockers).toContain('budget_unaffordable')
  })

  it('Property with masterCount=1 only + both sides only afford master → budget_unaffordable', () => {
    const oneMaster = { ...normantonPark, masterCount: 1, commonCount: 0, rentSGD: 1800 } // single master @ 1800
    // Two people, one room — assignment search yields no valid pair.
    const richA = baseResp({ _id: 'rA', name: 'A', budget: { min: 1500, max: 2200 } })
    const richB = baseResp({ _id: 'rB', name: 'B', budget: { min: 1500, max: 2200 } })
    const r = pairFitForProperty(richA, richB, oneMaster)
    expect(r.blockers).toContain('budget_unaffordable')
  })

  it('exposes weight constants summing to 100', () => {
    expect(PAIR_WEIGHTS.budget + PAIR_WEIGHTS.commute + PAIR_WEIGHTS.movein).toBe(100)
    expect(MOVEIN_BLOCKER_DAYS).toBe(30)
  })
})

// --- cohortMoveInSpan + COHORT_TIE_BREAKERS -------------------------------

describe('cohortMoveInSpan', () => {
  it('returns the day span across 3 parseable move-ins', () => {
    const cohort = [
      { moveIn: '2026-08-01' },
      { moveIn: '2026-08-05' },
      { moveIn: '2026-08-10' },
    ]
    expect(cohortMoveInSpan(cohort)).toBe(9)
  })

  it('returns null when fewer than 2 parse', () => {
    expect(cohortMoveInSpan([{ moveIn: 'Immediate' }, { moveIn: '' }, { moveIn: 'TBD' }])).toBeNull()
    expect(cohortMoveInSpan([{ moveIn: '2026-08-01' }, { moveIn: 'flexible' }])).toBeNull()
    expect(cohortMoveInSpan([])).toBeNull()
  })
})

describe('COHORT_TIE_BREAKERS', () => {
  it('is the canonical frozen ordering', () => {
    expect(COHORT_TIE_BREAKERS).toEqual(['sum_pair_fits', 'movein_span', 'budget_spread'])
    expect(Object.isFrozen(COHORT_TIE_BREAKERS)).toBe(true)
  })
})

// --- assembleCohort -------------------------------------------------------

describe('assembleCohort — happy paths', () => {
  const normantonPark = {
    _id: 'p1',
    condo: 'Normanton Park',
    housingType: 'Whole Unit',
    masterCount: 1,
    commonCount: 2,
    rentSGD: 4500,
    commuteMins: { NUS: 12, NTU: 38, SMU: 22 },
  }

  const baseResp = (over = {}) => ({
    name: 'Default',
    channel: 'Line',
    contact: '@x',
    school: 'NUS',
    moveIn: '2026-08-05',
    leaseLength: '12 months',
    budget: { min: 1200, max: 1500 },
    buildingType: 'Condo',
    housingType: 'Room',
    unitLayout: ['Common Room'],
    commuteTolMins: 20,
    wantRoommate: true,
    groupSize: 1,
    extras: { petFriendly: false, cookingAllowed: false, quiet: false, nearGym: false, note: '' },
    ...over,
  })

  const wei = baseResp({ _id: 'r-wei', name: 'Wei', budget: { min: 1200, max: 1500 }, moveIn: '2026-08-01', commuteTolMins: 20 })
  const arjun = baseResp({ _id: 'r-arjun', name: 'Arjun', budget: { min: 1300, max: 1600 }, moveIn: '2026-08-10', commuteTolMins: 25 })
  const mei = baseResp({ _id: 'r-mei', name: 'Mei', budget: { min: 1600, max: 2000 }, moveIn: '2026-08-05', commuteTolMins: 20 })

  it('Wei × Arjun × Mei trio assembles, all three included', () => {
    const r = assembleCohort(normantonPark, [wei, arjun, mei])
    expect(r.cohort).not.toBeNull()
    expect(r.cohort).toHaveLength(3)
    expect(r.cohort.map((m) => m._id).sort()).toEqual(['r-arjun', 'r-mei', 'r-wei'])
    expect(r.reason).toBeNull()
  })

  it('Mei assigned master at S$1,800; Wei and Arjun assigned common at S$1,350', () => {
    const r = assembleCohort(normantonPark, [wei, arjun, mei])
    expect(r.roomAssignments['r-mei']).toEqual({ rent: 1800, roomKind: 'master' })
    expect(r.roomAssignments['r-wei']).toEqual({ rent: 1350, roomKind: 'common' })
    expect(r.roomAssignments['r-arjun']).toEqual({ rent: 1350, roomKind: 'common' })
  })

  it('cohort rents conserve to the unit rent', () => {
    const r = assembleCohort(normantonPark, [wei, arjun, mei])
    const total = Object.values(r.roomAssignments).reduce((s, v) => s + v.rent, 0)
    expect(total).toBe(4500)
  })

  it('cohortScore is the mean of intra-cohort pair-fits', () => {
    const r = assembleCohort(normantonPark, [wei, arjun, mei])
    const sum = r.pairFits.reduce((s, p) => s + p.score, 0)
    expect(r.cohortScore).toBe(Math.round(sum / r.pairFits.length))
  })

  it('exposes 3 intra-cohort pair-fits for a trio', () => {
    const r = assembleCohort(normantonPark, [wei, arjun, mei])
    expect(r.pairFits).toHaveLength(3)
    for (const p of r.pairFits) {
      expect(p).toMatchObject({ a: expect.any(String), b: expect.any(String), score: expect.any(Number) })
    }
  })

  it('notes[0] is the structural room-assignment note mentioning the master taker', () => {
    const r = assembleCohort(normantonPark, [wei, arjun, mei])
    expect(r.notes[0]).toMatch(/Mei/)
    expect(r.notes[0]).toMatch(/master/i)
  })
})

describe('assembleCohort — failure modes', () => {
  const baseResp = (over = {}) => ({
    _id: 'r', name: 'X', school: 'NUS', moveIn: '2026-08-05', leaseLength: '12 months',
    budget: { min: 1200, max: 1500 }, buildingType: 'Condo', housingType: 'Room',
    unitLayout: [], commuteTolMins: 20, wantRoommate: true, groupSize: 1, extras: {}, ...over,
  })

  const wholeUnit = {
    _id: 'p1', housingType: 'Whole Unit', masterCount: 1, commonCount: 2, rentSGD: 4500,
    commuteMins: { NUS: 12, NTU: 38, SMU: 22 },
  }

  it("property_not_splittable — housingType is 'Room'", () => {
    const r = assembleCohort({ ...wholeUnit, housingType: 'Room' }, [baseResp()])
    expect(r).toEqual({ cohort: null, reason: 'property_not_splittable' })
  })

  it('property_not_splittable — counts undefined', () => {
    const r = assembleCohort({ ...wholeUnit, masterCount: undefined, commonCount: undefined }, [baseResp()])
    expect(r).toEqual({ cohort: null, reason: 'property_not_splittable' })
  })

  it('pool_too_small — fewer eligible than target rooms', () => {
    const r = assembleCohort(wholeUnit, [baseResp({ _id: 'a' }), baseResp({ _id: 'b' })])
    expect(r).toEqual({ cohort: null, reason: 'pool_too_small' })
  })

  it('no_eligible_candidates — everyone opted out', () => {
    const r = assembleCohort(wholeUnit, [
      baseResp({ _id: 'a', wantRoommate: false }),
      baseResp({ _id: 'b', wantRoommate: false }),
      baseResp({ _id: 'c', wantRoommate: false }),
    ])
    expect(r).toEqual({ cohort: null, reason: 'no_eligible_candidates' })
  })

  it("cohort_incomplete — one member has lease 6mo (everyone else 12mo) so seed pair exists but cohort can't grow", () => {
    const wei = baseResp({ _id: 'r-wei', name: 'Wei', budget: { min: 1200, max: 1500 }, moveIn: '2026-08-01' })
    const arjun = baseResp({ _id: 'r-arjun', name: 'Arjun', budget: { min: 1300, max: 1600 }, moveIn: '2026-08-10' })
    const mei6 = baseResp({ _id: 'r-mei', name: 'Mei', budget: { min: 1600, max: 2000 }, moveIn: '2026-08-05', leaseLength: '6 months' })
    const r = assembleCohort(wholeUnit, [wei, arjun, mei6])
    expect(r).toEqual({ cohort: null, reason: 'cohort_incomplete' })
  })

  it("no_fit_pair — every pair has movein_too_far blocker", () => {
    const a = baseResp({ _id: 'a', moveIn: '2026-06-01' })
    const b = baseResp({ _id: 'b', moveIn: '2026-08-01' })
    const c = baseResp({ _id: 'c', moveIn: '2026-10-01' })
    const r = assembleCohort(wholeUnit, [a, b, c])
    expect(r).toEqual({ cohort: null, reason: 'no_fit_pair' })
  })
})

describe('assembleCohort — eligibility filter', () => {
  const wholeUnit = {
    _id: 'p1', housingType: 'Whole Unit', masterCount: 1, commonCount: 2, rentSGD: 4500,
    commuteMins: { NUS: 12, NTU: 38, SMU: 22 },
  }
  const baseResp = (over = {}) => ({
    _id: 'r', name: 'X', school: 'NUS', moveIn: '2026-08-05', leaseLength: '12 months',
    budget: { min: 1200, max: 1500 }, buildingType: 'Condo', housingType: 'Room',
    unitLayout: [], commuteTolMins: 20, wantRoommate: true, groupSize: 1, extras: {}, ...over,
  })

  it('opted-out customers are excluded from the cohort', () => {
    const A = baseResp({ _id: 'A', name: 'A', moveIn: '2026-08-01' })
    const B = baseResp({ _id: 'B', name: 'B', wantRoommate: false, budget: { min: 1700, max: 2200 } })
    const C = baseResp({ _id: 'C', name: 'C', moveIn: '2026-08-05' })
    const D = baseResp({ _id: 'D', name: 'D', moveIn: '2026-08-10', budget: { min: 1700, max: 2200 } })
    const r = assembleCohort(wholeUnit, [A, B, C, D])
    expect(r.cohort).not.toBeNull()
    expect(r.cohort.map((m) => m._id)).not.toContain('B')
  })

  it('groupSize > 1 members are excluded', () => {
    const trio = baseResp({ _id: 'trio', groupSize: 3 })
    const A = baseResp({ _id: 'A', moveIn: '2026-08-01' })
    const B = baseResp({ _id: 'B', moveIn: '2026-08-05' })
    const C = baseResp({ _id: 'C', moveIn: '2026-08-10', budget: { min: 1700, max: 2200 } })
    const r = assembleCohort(wholeUnit, [trio, A, B, C])
    expect(r.cohort).not.toBeNull()
    expect(r.cohort.map((m) => m._id)).not.toContain('trio')
  })

  it("'Whole Unit' preference members are excluded", () => {
    const wholePref = baseResp({ _id: 'wholePref', housingType: 'Whole Unit' })
    const A = baseResp({ _id: 'A', moveIn: '2026-08-01' })
    const B = baseResp({ _id: 'B', moveIn: '2026-08-05' })
    const C = baseResp({ _id: 'C', moveIn: '2026-08-10', budget: { min: 1700, max: 2200 } })
    const r = assembleCohort(wholeUnit, [wholePref, A, B, C])
    expect(r.cohort).not.toBeNull()
    expect(r.cohort.map((m) => m._id)).not.toContain('wholePref')
  })
})

describe('assembleCohort — anti-fragile grow + tie-breakers', () => {
  const wholeUnit = {
    _id: 'p1', housingType: 'Whole Unit', masterCount: 1, commonCount: 2, rentSGD: 4500,
    commuteMins: { NUS: 12, NTU: 38, SMU: 22 },
  }
  const baseResp = (over = {}) => ({
    _id: 'r', name: 'X', school: 'NUS', moveIn: '2026-08-05', leaseLength: '12 months',
    budget: { min: 1200, max: 1500 }, buildingType: 'Condo', housingType: 'Room',
    unitLayout: [], commuteTolMins: 20, wantRoommate: true, groupSize: 1, extras: {}, ...over,
  })

  it('grow prefers candidate with higher min pair-fit to current cohort', () => {
    // Seed pair (A, B) is perfect. C has a soft move-in with B (15-30d); D has a
    // soft move-in with both A and B. C's min pair-fit (with B) is lower than
    // D's min (both A and B are soft but equal). Expected: D wins.
    const A = baseResp({ _id: 'A', name: 'A', moveIn: '2026-08-01', budget: { min: 1700, max: 2200 } })
    const B = baseResp({ _id: 'B', name: 'B', moveIn: '2026-08-02' })
    // C has perfect move-in vs A, but BAD vs B (large soft delta).
    const C = baseResp({ _id: 'C', name: 'C', moveIn: '2026-08-20' })
    // D has equal soft delta vs both A and B (~15d either way).
    const D = baseResp({ _id: 'D', name: 'D', moveIn: '2026-08-12' })
    const r = assembleCohort(wholeUnit, [A, B, C, D])
    expect(r.cohort).not.toBeNull()
    const ids = r.cohort.map((m) => m._id)
    expect(ids).toContain('A')
    expect(ids).toContain('B')
    // Either C or D is added — the one with the higher min pair-fit. C's min is
    // pair(C,B) where C is 18d from B; D's min is the smaller of pair(D,A)=10d
    // and pair(D,B)=10d. The score-bearing factor (movein) is the same magnitude
    // either way, so the grow step uses score ordering. With C-B at 18d (soft)
    // vs D-A at 10d (still pass) and D-B at 10d (pass), D's pair-fits to both
    // are PASS while C-B is SOFT — D has a strictly higher min. Expect D.
    expect(ids).toContain('D')
  })

  it("seed tie broken by tightest move-in span among equally-scoring pairs", () => {
    // Four customers, all NUS, all 12mo lease. Move-ins:
    //   A = Aug 1  (high budget — can take master)
    //   B = Aug 4  → A-B span 3d  (PASS, score 100)
    //   D = Aug 18 → A-D span 17d (SOFT, score 82); B-D span 14d (PASS, 100)
    //   C = Aug 22 → A-C span 21d (SOFT, 82); B-C span 18d (SOFT, 82); D-C span 4d (PASS, 100)
    // 100-scoring pairs are A-B (3d), B-D (14d), D-C (4d). Tightest is A-B.
    // Seed should therefore be (A,B). Grow picks D (min pair-fit to {A,B} =
    // min(82,100)=82, sum=182) over C (min(82,82)=82, sum=164).
    const A = baseResp({ _id: 'A', name: 'A', moveIn: '2026-08-01', budget: { min: 1700, max: 2200 } })
    const B = baseResp({ _id: 'B', name: 'B', moveIn: '2026-08-04' })
    const D = baseResp({ _id: 'D', name: 'D', moveIn: '2026-08-18' })
    const C = baseResp({ _id: 'C', name: 'C', moveIn: '2026-08-22' })
    const r = assembleCohort(wholeUnit, [A, B, D, C])
    expect(r.cohort).not.toBeNull()
    const ids = r.cohort.map((m) => m._id)
    expect(ids).toContain('A')
    expect(ids).toContain('B')
  })

  it("unfit pair to current cohort excludes an otherwise-strong candidate", () => {
    // Seed (A, B) is fit. C is fit with A but has lease_mismatch with B → unfit
    // pair (C, B). D is fit with both. Expect D in cohort, not C.
    const A = baseResp({ _id: 'A', name: 'A', moveIn: '2026-08-01', budget: { min: 1700, max: 2200 } })
    const B = baseResp({ _id: 'B', name: 'B', moveIn: '2026-08-02' })
    const C = baseResp({ _id: 'C', name: 'C', moveIn: '2026-08-03', leaseLength: '6 months' })
    const D = baseResp({ _id: 'D', name: 'D', moveIn: '2026-08-04' })
    const r = assembleCohort(wholeUnit, [A, B, C, D])
    expect(r.cohort).not.toBeNull()
    const ids = r.cohort.map((m) => m._id)
    expect(ids).toContain('D')
    expect(ids).not.toContain('C')
  })
})

describe('assembleCohort — layout variants', () => {
  const baseResp = (over = {}) => ({
    _id: 'r', name: 'X', school: 'NUS', moveIn: '2026-08-05', leaseLength: '12 months',
    budget: { min: 1200, max: 1500 }, buildingType: 'Condo', housingType: 'Room',
    unitLayout: [], commuteTolMins: 20, wantRoommate: true, groupSize: 1, extras: {}, ...over,
  })

  it('all-common layout (0M + 3C @ S$3,900) assigns every member common at S$1,300', () => {
    const prop = {
      _id: 'p', housingType: 'Whole Unit', masterCount: 0, commonCount: 3, rentSGD: 3900,
      commuteMins: { NUS: 12, NTU: 38, SMU: 22 },
    }
    const A = baseResp({ _id: 'A', moveIn: '2026-08-01', budget: { min: 1200, max: 1400 } })
    const B = baseResp({ _id: 'B', moveIn: '2026-08-05', budget: { min: 1200, max: 1400 } })
    const C = baseResp({ _id: 'C', moveIn: '2026-08-10', budget: { min: 1200, max: 1400 } })
    const r = assembleCohort(prop, [A, B, C])
    expect(r.cohort).not.toBeNull()
    expect(r.roomAssignments['A']).toEqual({ rent: 1300, roomKind: 'common' })
    expect(r.roomAssignments['B']).toEqual({ rent: 1300, roomKind: 'common' })
    expect(r.roomAssignments['C']).toEqual({ rent: 1300, roomKind: 'common' })
    expect(r.notes[0]).toMatch(/split commons/i)
  })

  it('all-master layout (2M + 0C @ S$3,600) assigns both members master at S$1,800', () => {
    const prop = {
      _id: 'p', housingType: 'Whole Unit', masterCount: 2, commonCount: 0, rentSGD: 3600,
      commuteMins: { NUS: 12, NTU: 38, SMU: 22 },
    }
    const A = baseResp({ _id: 'A', moveIn: '2026-08-01', budget: { min: 1700, max: 2000 } })
    const B = baseResp({ _id: 'B', moveIn: '2026-08-05', budget: { min: 1700, max: 2000 } })
    const r = assembleCohort(prop, [A, B])
    expect(r.cohort).not.toBeNull()
    expect(r.roomAssignments['A']).toEqual({ rent: 1800, roomKind: 'master' })
    expect(r.roomAssignments['B']).toEqual({ rent: 1800, roomKind: 'master' })
    expect(r.notes[0]).toMatch(/all 2 members take master/i)
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
