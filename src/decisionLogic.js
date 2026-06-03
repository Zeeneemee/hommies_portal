// decisionLogic.js — pure matching logic. No React, no Convex, no DOM.
//
// Adopted from the "Hommies Portal" handoff design (decision.js): six weighted
// factors, criteria carrying pass/soft/fail levels, send threshold 58, hard
// blockers, ranked Send / Hold buckets, bilingual outreach drafts, and a
// tolerant bilingual Google Form CSV parser.

/** Factor weights — sum to 100. */
export const W = { budget: 30, school: 22, commute: 20, housing: 12, layout: 9, building: 7 }
/** Score floor for a "send" verdict when there is no hard blocker. */
export const SEND_THRESHOLD = 58
/** Rent overshoot of the budget ceiling that is forgiven (soft, not blocker). */
export const BUDGET_SOFT_OVERSHOOT = 200 // S$
/** Commute minutes over tolerance that are forgiven (soft, not blocker). */
export const COMMUTE_SOFT_OVER = 15
/** Premium a master bedroom pays over the per-room average. Commons absorb the
 *  remainder so the split always sums to the unit rent. */
export const MASTER_PREMIUM = 1.20

const SCHOOL_CAMPUSES = ['NUS', 'NTU', 'SMU']

/**
 * Split a whole-unit listing's rent across its bedrooms (Option A).
 * Returns null when the inputs don't describe a splittable layout.
 *
 *   - both counts present + at least one > 0: master pays avg × 1.20,
 *     commons absorb the remainder so master×masterCount + common×commonCount === rent.
 *   - commonCount === 0: each master pays rent / masterCount (no premium —
 *     no commons to absorb the discount).
 *   - masterCount === 0: each common pays rent / commonCount.
 *
 * @param {{rentSGD?:number, masterCount?:number, commonCount?:number}} prop
 * @returns {{master:number|null, common:number|null, perRoomAvg:number}|null}
 */
export function splitRent(prop) {
  const rent = prop?.rentSGD
  const mc = prop?.masterCount
  const cc = prop?.commonCount
  if (typeof rent !== 'number' || rent <= 0) return null
  if (typeof mc !== 'number' || typeof cc !== 'number') return null
  const rooms = mc + cc
  if (rooms <= 0) return null
  const perRoomAvg = rent / rooms
  if (cc === 0) return { master: rent / mc, common: null, perRoomAvg }
  if (mc === 0) return { master: null, common: rent / cc, perRoomAvg }
  const master = perRoomAvg * MASTER_PREMIUM
  const common = (rent - mc * master) / cc
  return { master, common, perRoomAvg }
}

// True when the response is a group large enough to trigger the split path,
// AND the property has a splittable whole-unit layout.
function isGroupSplitActive(resp, prop) {
  return (
    prop?.housingType === 'Whole Unit' &&
    typeof prop?.masterCount === 'number' &&
    typeof prop?.commonCount === 'number' &&
    (prop.masterCount + prop.commonCount) > 0 &&
    typeof resp?.groupSize === 'number' &&
    resp.groupSize > 1
  )
}

// ── Cohort pair-fit primitive ────────────────────────────────────────────
// pairFitForProperty(a, b, prop) — answers "could these two solo customers
// share this whole-unit listing?" Three scored factors (budget 45, commute
// 25, move-in 30 — sum 100), one hard equality gate (lease length), four
// hard blockers, and a notes[] channel for lifestyle that never affects
// score. Headless: no UI, no convex, no side effects.

/** Move-in date difference (days) considered a hard blocker. */
export const MOVEIN_BLOCKER_DAYS = 30
/** Move-in date difference (days) within which the schedule factor passes full. */
export const MOVEIN_SOFT_DAYS = 14
/** Three-factor weights for pairFitForProperty. Sum to 100. */
export const PAIR_WEIGHTS = { budget: 45, commute: 25, movein: 30 }

/**
 * Parse a free-text move-in string into a Date.
 *
 * Accepts ISO ("2026-08-01"), month-year ("Aug 2026"), day-month-year
 * ("1 Aug 2026"), and prose containing an ISO substring ("on 2026-08-01").
 * Returns null for blank, null, undefined, or sentinel words that signal
 * "no specific date" — "immediate", "asap", "flexible", "tbd", "tba",
 * "negotiable".
 *
 * @param {unknown} s
 * @returns {Date|null}
 */
export function parseMoveInDate(s) {
  if (s == null) return null
  const text = String(s).trim()
  if (!text) return null
  if (/^(immediate|asap|flexible|tbd|tba|negotiable)\b/i.test(text)) return null
  const direct = new Date(text)
  if (!Number.isNaN(direct.getTime())) return direct
  const iso = text.match(/\d{4}-\d{2}-\d{2}/)
  if (iso) {
    const d = new Date(iso[0])
    if (!Number.isNaN(d.getTime())) return d
  }
  return null
}

/**
 * Parse a free-text lease-length string into integer months.
 *
 * Accepts "12 months", "1 year"/"2 years" (multiplied by 12), "12mo",
 * Chinese variants ("半年" → 6, "一年" → 12, "兩年"/"两年" → 24),
 * "6+6" (renewable pattern → sum), and bare integers up to two digits.
 * Returns null for blank, null, undefined, or sentinel words like
 * "flexible", "negotiable", "tbd", "tba".
 *
 * @param {unknown} s
 * @returns {number|null}
 */
export function parseLeaseMonths(s) {
  if (s == null) return null
  const text = String(s).trim()
  if (!text) return null
  if (/^(flexible|negotiable|tbd|tba)\b/i.test(text)) return null
  if (/半年/.test(text)) return 6
  if (/兩年|两年/.test(text)) return 24
  if (/一年/.test(text)) return 12
  const plus = text.match(/(\d{1,2})\s*\+\s*(\d{1,2})/)
  if (plus) return Number(plus[1]) + Number(plus[2])
  const yr = text.match(/(\d{1,2})\s*(?:year|yr)s?/i)
  if (yr) return Number(yr[1]) * 12
  const mo = text.match(/(\d{1,2})\s*(?:month|mo)s?/i)
  if (mo) return Number(mo[1])
  const bare = text.match(/^(\d{1,2})$/)
  if (bare) return Number(bare[1])
  return null
}

// Internal: enumerate every distinct (room_a, room_b) assignment and pick
// the one that minimises soft-overshoots, then under-min preferences, then
// max(rent). Returns null when no feasible assignment exists.
function pickRoomAssignment(rooms, a, b) {
  if (rooms.length < 2) return null
  const aMax = a?.budget?.max ?? 0
  const aMin = a?.budget?.min ?? 0
  const bMax = b?.budget?.max ?? 0
  const bMin = b?.budget?.min ?? 0
  let best = null
  for (let i = 0; i < rooms.length; i++) {
    const ra = rooms[i].rent
    if (ra > aMax + BUDGET_SOFT_OVERSHOOT) continue
    const aSoft = ra > aMax ? 1 : 0
    const aUnder = ra < aMin ? 1 : 0
    for (let j = 0; j < rooms.length; j++) {
      if (i === j) continue
      const rb = rooms[j].rent
      if (rb > bMax + BUDGET_SOFT_OVERSHOOT) continue
      const bSoft = rb > bMax ? 1 : 0
      const bUnder = rb < bMin ? 1 : 0
      const softCount = aSoft + bSoft
      const underCount = aUnder + bUnder
      const maxRent = Math.max(ra, rb)
      const candidate = { i, j, softCount, underCount, maxRent, aRoom: rooms[i], bRoom: rooms[j] }
      if (
        !best ||
        softCount < best.softCount ||
        (softCount === best.softCount && underCount < best.underCount) ||
        (softCount === best.softCount && underCount === best.underCount && maxRent < best.maxRent)
      ) {
        best = candidate
      }
    }
  }
  return best
}

/**
 * Score two solo customers as potential housemates on a target whole-unit
 * listing. Returns null for nonsensical comparisons (same identity, or
 * either side is part of a pre-formed group). Otherwise returns a
 * structured decision.
 *
 * @param {object} a — response record
 * @param {object} b — response record
 * @param {object} prop — property record (must have rentSGD + masterCount + commonCount + commuteMins)
 * @returns {null | {
 *   score: number,
 *   verdict: 'fit'|'unfit',
 *   reason: string,
 *   criteria: Array<{label:string, level:'pass'|'soft'|'fail', detail:string}>,
 *   blockers: string[],
 *   notes: string[],
 *   perPersonRent: Record<string, {rent:number, roomKind:'master'|'common'}> | null
 * }}
 */
export function pairFitForProperty(a, b, prop) {
  // Sentinel-null cases — these are "doesn't make sense", not "unfit".
  if (a === b) return null
  if (a?._id && b?._id && a._id === b._id) return null
  if ((a?.groupSize ?? 1) > 1) return null
  if ((b?.groupSize ?? 1) > 1) return null

  const crit = []
  const blockers = []
  const lifestyleNotes = []
  const freeTextNotes = []
  const warningNotes = []
  let score = 0

  const keyA = a?._id ?? 'a'
  const keyB = b?._id ?? 'b'
  const nameA = a?.name || 'A'
  const nameB = b?.name || 'B'

  // Consent — wantRoommate=false is a hard opt-out.
  if (a?.wantRoommate === false || b?.wantRoommate === false) {
    blockers.push('consent_missing')
    const who = a?.wantRoommate === false ? nameA : nameB
    crit.push({
      label: 'Roommate consent',
      level: 'fail',
      detail: `${who} did not opt in to roommates.`,
    })
  }

  // Budget — property-conditioned. Build the list of rooms with positive
  // count, then pick the assignment that minimises soft-overshoot, then
  // under-budget side count, then max(rent).
  let perPersonRent = null
  const split = splitRent(prop)
  if (!split) {
    blockers.push('budget_unaffordable')
    crit.push({
      label: 'Budget',
      level: 'fail',
      detail: 'Property has no splittable room composition.',
    })
  } else {
    const rooms = []
    if ((prop.masterCount || 0) > 0 && split.master != null) {
      for (let i = 0; i < prop.masterCount; i++) rooms.push({ kind: 'master', rent: split.master })
    }
    if ((prop.commonCount || 0) > 0 && split.common != null) {
      for (let i = 0; i < prop.commonCount; i++) rooms.push({ kind: 'common', rent: split.common })
    }
    const best = pickRoomAssignment(rooms, a, b)
    if (!best) {
      blockers.push('budget_unaffordable')
      crit.push({
        label: 'Budget',
        level: 'fail',
        detail: 'No room assignment fits both within budget (incl. soft margin).',
      })
    } else {
      perPersonRent = {
        [keyA]: { rent: Math.round(best.aRoom.rent), roomKind: best.aRoom.kind },
        [keyB]: { rent: Math.round(best.bRoom.rent), roomKind: best.bRoom.kind },
      }
      if (best.softCount === 0) {
        score += PAIR_WEIGHTS.budget
        crit.push({
          label: 'Budget',
          level: 'pass',
          detail: `${nameA}→${best.aRoom.kind} S$${perPersonRent[keyA].rent}, ${nameB}→${best.bRoom.kind} S$${perPersonRent[keyB].rent}.`,
        })
      } else {
        score += PAIR_WEIGHTS.budget * 0.45
        crit.push({
          label: 'Budget',
          level: 'soft',
          detail: `${best.softCount} side(s) fit only via soft overshoot (≤ S$${BUDGET_SOFT_OVERSHOOT}).`,
        })
      }
    }
  }

  // Commute — each side gets their own commute number from prop.commuteMins.
  const aCommute = a?.school ? prop?.commuteMins?.[a.school] ?? null : null
  const bCommute = b?.school ? prop?.commuteMins?.[b.school] ?? null : null
  const aTol = a?.commuteTolMins ?? 30
  const bTol = b?.commuteTolMins ?? 30
  if (aCommute == null || bCommute == null) {
    score += PAIR_WEIGHTS.commute * 0.4
    crit.push({
      label: 'Commute',
      level: 'soft',
      detail: 'No commute number for one of the schools.',
    })
  } else {
    const aOver = Math.max(0, aCommute - aTol)
    const bOver = Math.max(0, bCommute - bTol)
    if (aOver === 0 && bOver === 0) {
      score += PAIR_WEIGHTS.commute
      crit.push({
        label: 'Commute',
        level: 'pass',
        detail: `${nameA}: ${aCommute}min ≤ ${aTol}min · ${nameB}: ${bCommute}min ≤ ${bTol}min.`,
      })
    } else if (aOver <= COMMUTE_SOFT_OVER && bOver <= COMMUTE_SOFT_OVER) {
      score += PAIR_WEIGHTS.commute * 0.4
      crit.push({
        label: 'Commute',
        level: 'soft',
        detail: `Over tolerance by ${Math.max(aOver, bOver)}min on one side — within soft margin.`,
      })
    } else {
      crit.push({
        label: 'Commute',
        level: 'fail',
        detail: `Commute too far for ${aOver > COMMUTE_SOFT_OVER ? nameA : nameB}.`,
      })
    }
  }

  // Move-in window.
  const aDate = parseMoveInDate(a?.moveIn)
  const bDate = parseMoveInDate(b?.moveIn)
  if (!aDate || !bDate) {
    score += PAIR_WEIGHTS.movein * 0.4
    crit.push({
      label: 'Move-in',
      level: 'soft',
      detail: 'Move-in date unparseable on at least one side.',
    })
    if (!aDate) warningNotes.push(`Unparseable move-in for ${nameA}: "${a?.moveIn ?? ''}". Operator to verify.`)
    if (!bDate) warningNotes.push(`Unparseable move-in for ${nameB}: "${b?.moveIn ?? ''}". Operator to verify.`)
  } else {
    const days = Math.abs((aDate.getTime() - bDate.getTime()) / 86400000)
    if (days > MOVEIN_BLOCKER_DAYS) {
      // No blocker — move-in only contributes to the score, never gates the
      // pair. Wide move-in gaps mean the lease will need to absorb whoever
      // arrives later (or the cohort coordinates a single move-in date).
      crit.push({
        label: 'Move-in',
        level: 'fail',
        detail: `${Math.round(days)}d apart — no schedule alignment, but co-tenancy still viable.`,
      })
    } else if (days <= MOVEIN_SOFT_DAYS) {
      score += PAIR_WEIGHTS.movein
      crit.push({
        label: 'Move-in',
        level: 'pass',
        detail: `${Math.round(days)}d apart.`,
      })
    } else {
      score += PAIR_WEIGHTS.movein * 0.4
      crit.push({
        label: 'Move-in',
        level: 'soft',
        detail: `${Math.round(days)}d apart — within ${MOVEIN_BLOCKER_DAYS}d window but not tight.`,
      })
    }
  }

  // Lease length — exact equality gate. Unparseable on either side is a
  // soft warning, not a blocker (the strings might still be equivalent).
  const aLease = parseLeaseMonths(a?.leaseLength)
  const bLease = parseLeaseMonths(b?.leaseLength)
  if (aLease != null && bLease != null) {
    if (aLease !== bLease) {
      blockers.push('lease_mismatch')
      crit.push({
        label: 'Lease length',
        level: 'fail',
        detail: `${aLease}mo vs ${bLease}mo — must match to co-sign one lease.`,
      })
    } else {
      crit.push({
        label: 'Lease length',
        level: 'pass',
        detail: `Both ${aLease}mo.`,
      })
    }
  } else {
    crit.push({
      label: 'Lease length',
      level: 'soft',
      detail: 'Lease length unparseable on at least one side.',
    })
    if (aLease == null) warningNotes.push(`Unparseable lease length for ${nameA}: "${a?.leaseLength ?? ''}". Operator to verify.`)
    if (bLease == null) warningNotes.push(`Unparseable lease length for ${nameB}: "${b?.leaseLength ?? ''}". Operator to verify.`)
  }

  // Lifestyle observations — surfaced as notes only, never scored.
  const ax = a?.extras || {}
  const bx = b?.extras || {}
  if (ax.quiet !== bx.quiet) {
    const who = ax.quiet ? nameA : nameB
    const other = ax.quiet ? nameB : nameA
    lifestyleNotes.push(`${who} prefers quiet; ${other} does not — mention in intro.`)
  }
  if (ax.cooking !== bx.cooking) {
    const who = ax.cooking ? nameA : nameB
    const other = ax.cooking ? nameB : nameA
    lifestyleNotes.push(`${who} wants to cook; ${other} does not — align kitchen norms.`)
  }
  if (ax.petFriendly !== bx.petFriendly) {
    const who = ax.petFriendly ? nameA : nameB
    const other = ax.petFriendly ? nameB : nameA
    lifestyleNotes.push(`${who} wants pet-friendly; ${other} does not — flag.`)
  }
  if (typeof ax.note === 'string' && ax.note.trim()) {
    freeTextNotes.push(`${nameA}'s note: "${ax.note.trim()}"`)
  }
  if (typeof bx.note === 'string' && bx.note.trim()) {
    freeTextNotes.push(`${nameB}'s note: "${bx.note.trim()}"`)
  }

  const notes = [...lifestyleNotes, ...freeTextNotes, ...warningNotes]
  const finalScore = Math.round(score)
  const verdict = blockers.length > 0 ? 'unfit' : 'fit'

  let reason
  if (blockers.includes('consent_missing')) reason = 'One side did not opt in to roommates.'
  else if (blockers.includes('budget_unaffordable')) reason = 'No room on this property fits both budgets.'
  else if (blockers.includes('lease_mismatch')) reason = `Lease lengths differ (${aLease}mo vs ${bLease}mo).`
  else if (finalScore === 100) reason = 'Strong fit — budget, commute, and schedule all aligned.'
  else reason = `Fit with caveats (${100 - finalScore} pts on soft signals).`

  return { score: finalScore, verdict, reason, criteria: crit, blockers, notes, perPersonRent }
}

// ── Cohort assembler ────────────────────────────────────────────────────
// assembleCohort(prop, pool) — given a whole-unit property and a pool of
// response records, build a complete cohort whose pairwise compatibility
// is mutually high. Greedy: seed by best fit pair (tie-break by tightest
// move-in span), grow by candidate with highest *min* pair-fit to all
// cohort members already in. Returns either a structured cohort or
// { cohort: null, reason } when assembly fails.

/** Canonical tie-breaker ordering when ranking multiple complete cohorts.
 *  External callers (e.g. UI explanations) consume this. The assembler
 *  itself applies these at different decision points (seed vs grow). */
export const COHORT_TIE_BREAKERS = Object.freeze([
  'sum_pair_fits',
  'movein_span',
  'budget_spread',
])

/** Days between the latest and earliest parseable move-in across the
 *  cohort. Returns null when fewer than 2 members have parseable moveIn. */
export function cohortMoveInSpan(cohort) {
  const dates = (cohort || [])
    .map((m) => parseMoveInDate(m?.moveIn))
    .filter((d) => d instanceof Date)
  if (dates.length < 2) return null
  const ms = dates.map((d) => d.getTime())
  return Math.round((Math.max(...ms) - Math.min(...ms)) / 86400000)
}

function isEligibleForCohort(resp) {
  return (
    resp?.wantRoommate === true &&
    resp?.housingType === 'Room' &&
    (resp?.groupSize ?? 1) === 1
  )
}

function isPropertyAssemblable(prop) {
  return (
    prop?.housingType === 'Whole Unit' &&
    typeof prop?.masterCount === 'number' &&
    typeof prop?.commonCount === 'number' &&
    prop.masterCount + prop.commonCount > 0
  )
}

/**
 * Assemble a cohort of solo customers to share a whole-unit listing.
 *
 * @param {object} prop — must be Whole Unit with masterCount + commonCount defined
 * @param {object[]} pool — array of response records
 * @param {object} [_options] — reserved for forward-compat; ignored in v1
 * @returns {{
 *   cohort: object[]|null,
 *   cohortScore?: number,
 *   roomAssignments?: Record<string, {rent:number, roomKind:'master'|'common'}>,
 *   notes?: string[],
 *   pairFits?: Array<{a:string, b:string, score:number}>,
 *   reason: string|null
 * }}
 */
export function assembleCohort(prop, pool, _options) {
  if (!isPropertyAssemblable(prop)) {
    return { cohort: null, reason: 'property_not_splittable' }
  }
  const eligible = (Array.isArray(pool) ? pool : []).filter(isEligibleForCohort)
  if (eligible.length === 0) {
    return { cohort: null, reason: 'no_eligible_candidates' }
  }
  const target = prop.masterCount + prop.commonCount
  if (eligible.length < target) {
    return { cohort: null, reason: 'pool_too_small' }
  }

  // Memo every distinct pair-fit by index (deterministic key).
  const memo = new Map()
  const pairFitAt = (i, j) => {
    const lo = Math.min(i, j)
    const hi = Math.max(i, j)
    const key = `${lo}:${hi}`
    if (!memo.has(key)) memo.set(key, pairFitForProperty(eligible[lo], eligible[hi], prop))
    return memo.get(key)
  }

  // Seed: find best 'fit' pair, ties broken by tightest move-in span across the pair.
  const fitPairs = []
  for (let i = 0; i < eligible.length; i++) {
    for (let j = i + 1; j < eligible.length; j++) {
      const fit = pairFitAt(i, j)
      if (!fit || fit.verdict !== 'fit') continue
      fitPairs.push({ i, j, score: fit.score })
    }
  }
  if (fitPairs.length === 0) {
    return { cohort: null, reason: 'no_fit_pair' }
  }
  fitPairs.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score
    const spanA = cohortMoveInSpan([eligible[a.i], eligible[a.j]])
    const spanB = cohortMoveInSpan([eligible[b.i], eligible[b.j]])
    if (spanA == null && spanB == null) return 0
    if (spanA == null) return 1
    if (spanB == null) return -1
    if (spanA !== spanB) return spanA - spanB
    return (a.i - b.i) || (a.j - b.j)
  })
  const seed = fitPairs[0]
  const cohortIdx = [seed.i, seed.j]

  // Grow: maximise min(pair-fit to current cohort). Ties → sum, then input order.
  while (cohortIdx.length < target) {
    let best = null
    for (let c = 0; c < eligible.length; c++) {
      if (cohortIdx.includes(c)) continue
      let minScore = Infinity
      let sumScore = 0
      let blocked = false
      for (const m of cohortIdx) {
        const fit = pairFitAt(c, m)
        if (!fit || fit.verdict !== 'fit') {
          blocked = true
          break
        }
        if (fit.score < minScore) minScore = fit.score
        sumScore += fit.score
      }
      if (blocked) continue
      if (
        !best ||
        minScore > best.minScore ||
        (minScore === best.minScore && sumScore > best.sumScore) ||
        (minScore === best.minScore && sumScore === best.sumScore && c < best.c)
      ) {
        best = { c, minScore, sumScore }
      }
    }
    if (!best) {
      return { cohort: null, reason: 'cohort_incomplete' }
    }
    cohortIdx.push(best.c)
  }

  const cohort = cohortIdx.map((i) => eligible[i])
  const split = splitRent(prop)
  if (!split) {
    // Defensive — isPropertyAssemblable should have caught this.
    return { cohort: null, reason: 'no_valid_room_assignment' }
  }
  const masterRent = split.master ?? 0
  const commonRent = split.common ?? 0
  const { masterCount } = prop

  // Sort cohort by budget.max desc (stable on positional index). Top masterCount → master.
  const ranked = cohort.map((m, idx) => ({ m, idx, max: m?.budget?.max ?? 0 }))
  ranked.sort((a, b) => (b.max - a.max) || (a.idx - b.idx))
  const slots = ranked.map((r, rank) => ({
    member: r.m,
    cohortIdx: r.idx,
    roomKind: rank < masterCount ? 'master' : 'common',
    rent: rank < masterCount ? masterRent : commonRent,
  }))
  const canAfford = (m, rent) => rent <= (m?.budget?.max ?? 0) + BUDGET_SOFT_OVERSHOOT

  // Swap step: any master-slot member who can't afford master tries to swap
  // with a common-slot member who can.
  for (let i = 0; i < masterCount; i++) {
    if (canAfford(slots[i].member, masterRent)) continue
    let swapped = false
    for (let j = masterCount; j < slots.length; j++) {
      if (canAfford(slots[j].member, masterRent) && canAfford(slots[i].member, commonRent)) {
        const tmpMember = slots[i].member
        const tmpIdx = slots[i].cohortIdx
        slots[i].member = slots[j].member
        slots[i].cohortIdx = slots[j].cohortIdx
        slots[j].member = tmpMember
        slots[j].cohortIdx = tmpIdx
        swapped = true
        break
      }
    }
    if (!swapped) {
      return { cohort: null, reason: 'no_valid_room_assignment' }
    }
  }
  // Verify commons (they almost always can — common ≤ master under Option A).
  for (let i = masterCount; i < slots.length; i++) {
    if (!canAfford(slots[i].member, commonRent)) {
      return { cohort: null, reason: 'no_valid_room_assignment' }
    }
  }

  const keyOf = (m, idx) => m?._id ?? `m${idx}`
  const roomAssignments = {}
  for (const s of slots) {
    roomAssignments[keyOf(s.member, s.cohortIdx)] = {
      rent: Math.round(s.rent),
      roomKind: s.roomKind,
    }
  }

  // Intra-cohort pair-fits for score + UI consumption.
  const pairFits = []
  let scoreSum = 0
  for (let i = 0; i < cohortIdx.length; i++) {
    for (let j = i + 1; j < cohortIdx.length; j++) {
      const fit = pairFitAt(cohortIdx[i], cohortIdx[j])
      pairFits.push({
        a: keyOf(cohort[i], i),
        b: keyOf(cohort[j], j),
        score: fit.score,
      })
      scoreSum += fit.score
    }
  }
  const cohortScore = Math.round(scoreSum / pairFits.length)

  // Structural assignment note — three cases.
  let structuralNote
  if (prop.masterCount === 0) {
    structuralNote = `${cohort.length} members split commons equally at S$${Math.round(commonRent)} each.`
  } else if (prop.commonCount === 0) {
    structuralNote = `All ${cohort.length} members take master at S$${Math.round(masterRent)} each.`
  } else {
    const firstMaster = slots.find((s) => s.roomKind === 'master')
    const name = firstMaster?.member?.name || 'A cohort member'
    structuralNote = `${name} takes master at S$${Math.round(masterRent)} — assigned by highest budget.`
  }
  const notes = [structuralNote]
  const seen = new Set([structuralNote])
  for (let i = 0; i < cohortIdx.length; i++) {
    for (let j = i + 1; j < cohortIdx.length; j++) {
      const fit = pairFitAt(cohortIdx[i], cohortIdx[j])
      for (const n of fit?.notes || []) {
        if (!seen.has(n)) {
          seen.add(n)
          notes.push(n)
        }
      }
    }
  }

  return { cohort, cohortScore, roomAssignments, notes, pairFits, reason: null }
}

/**
 * Evaluate one response against one property.
 * @returns {{verdict:'send'|'hold', score:number, reason:string,
 *            criteria:Array<{label:string, level:'pass'|'soft'|'fail', detail:string}>,
 *            blockers:string[]}}
 */
export function decide(resp, prop) {
  const crit = []
  const blockers = []
  let score = 0

  // GROUP-AWARE SPLIT ──────────────────────────────────────────────────
  // When the customer is a group of >1 AND the listing is a whole unit
  // with master/common counts, score the lowest available room price
  // against budget instead of the full unit rent. Otherwise the rest of
  // decide() runs unchanged.
  let groupContext = null
  if (isGroupSplitActive(resp, prop)) {
    const split = splitRent(prop)
    const perPersonRent = prop.commonCount > 0 ? split.common : split.master
    const roomKind = prop.commonCount > 0 ? 'common' : 'master'
    groupContext = { split, perPersonRent, roomKind, groupSize: resp.groupSize }
    if (resp.groupSize > prop.masterCount + prop.commonCount) {
      blockers.push('over_layout')
      crit.push({
        label: `Layout fits ${prop.masterCount + prop.commonCount} (need ${resp.groupSize})`,
        level: 'fail',
        detail: `Unit has ${prop.masterCount} master + ${prop.commonCount} common = ${prop.masterCount + prop.commonCount} rooms; group of ${resp.groupSize} won't fit. Hard blocker.`,
      })
    }
  }

  // BUDGET ──────────────────────────────────────────────────────────────
  const rent = groupContext ? Math.round(groupContext.perPersonRent) : prop.rentSGD
  const rentLabel = groupContext ? `Per-person rent S$${rent} (${groupContext.roomKind})` : `Rent S$${rent}`
  const { min = 0, max = 0 } = resp.budget || {}
  if (rent >= min && rent <= max) {
    score += W.budget
    crit.push({
      label: `Budget S$${min}–${max}`,
      level: 'pass',
      detail: `${rentLabel} sits inside range.`,
    })
  } else if (rent > max && rent <= max + BUDGET_SOFT_OVERSHOOT) {
    score += W.budget * 0.45
    crit.push({
      label: `Budget S$${min}–${max}`,
      level: 'soft',
      detail: `${rentLabel} is S$${rent - max} over — small overshoot.`,
    })
  } else if (rent < min) {
    score += W.budget * 0.7
    crit.push({
      label: `Budget S$${min}–${max}`,
      level: 'soft',
      detail: `${rentLabel} is below their minimum — usually fine, but flag.`,
    })
  } else {
    blockers.push('over_budget')
    crit.push({
      label: `Budget S$${min}–${max}`,
      level: 'fail',
      detail: `${rentLabel} is S$${rent - max} over budget. Hard blocker.`,
    })
  }

  // SCHOOL ─────────────────────────────────────────────────────────────
  const schoolOk = SCHOOL_CAMPUSES.includes(resp.school)
  if (schoolOk) {
    score += W.school
    crit.push({
      label: `School ${resp.school}`,
      level: 'pass',
      detail: `Recognised — commute number for ${resp.school} unlocked.`,
    })
  } else {
    crit.push({
      label: 'School',
      level: 'soft',
      detail: `School "${resp.school}" not recognised — can't compute commute fit.`,
    })
  }

  // COMMUTE ────────────────────────────────────────────────────────────
  const commuteMins = schoolOk ? prop.commuteMins?.[resp.school] ?? null : null
  const tol = resp.commuteTolMins ?? 30
  if (commuteMins == null) {
    crit.push({ label: 'Commute', level: 'soft', detail: 'No commute number for this school.' })
  } else if (commuteMins <= tol) {
    score += W.commute
    crit.push({
      label: `Commute ${commuteMins}min → ${resp.school}`,
      level: 'pass',
      detail: `Within their ${tol}min tolerance.`,
    })
  } else if (commuteMins <= tol + COMMUTE_SOFT_OVER) {
    score += W.commute * 0.4
    crit.push({
      label: `Commute ${commuteMins}min → ${resp.school}`,
      level: 'soft',
      detail: `${commuteMins - tol}min over tolerance — name it honestly in the message.`,
    })
  } else {
    blockers.push('commute_too_far')
    crit.push({
      label: `Commute ${commuteMins}min → ${resp.school}`,
      level: 'fail',
      detail: `${commuteMins - tol}min beyond tolerance. Blocker.`,
    })
  }

  // HOUSING TYPE ───────────────────────────────────────────────────────
  if (resp.housingType === prop.housingType) {
    score += W.housing
    crit.push({ label: `Housing ${prop.housingType}`, level: 'pass', detail: 'Match.' })
  } else {
    blockers.push('housing_mismatch')
    crit.push({
      label: `Wants ${resp.housingType}, this is ${prop.housingType}`,
      level: 'fail',
      detail: 'Hard blocker — Room vs Whole Unit mismatch.',
    })
  }

  // UNIT LAYOUT ────────────────────────────────────────────────────────
  const layouts = Array.isArray(resp.unitLayout) ? resp.unitLayout : []
  if (layouts.length === 0 || layouts.includes(prop.unitType)) {
    score += W.layout
    crit.push({
      label: `Layout ${prop.unitType}`,
      level: 'pass',
      detail: layouts.length ? 'Listed in their preferences.' : 'No preference given.',
    })
  } else {
    score += W.layout * 0.2
    crit.push({
      label: `Layout ${prop.unitType}`,
      level: 'soft',
      detail: `They prefer ${layouts.join(', ')}.`,
    })
  }

  // BUILDING TYPE ──────────────────────────────────────────────────────
  if (resp.buildingType === 'Any' || resp.buildingType === prop.buildingType) {
    score += W.building
    crit.push({
      label: prop.buildingType,
      level: 'pass',
      detail: resp.buildingType === 'Any' ? 'Open to either.' : 'Match.',
    })
  } else {
    score += W.building * 0.1
    crit.push({
      label: `${prop.buildingType} (wants ${resp.buildingType})`,
      level: 'soft',
      detail: 'Building type mismatch — minor.',
    })
  }

  // VERDICT ────────────────────────────────────────────────────────────
  const finalScore = Math.round(score)
  let verdict = 'send'
  let reason = ''

  if (blockers.includes('over_layout')) {
    verdict = 'hold'
    reason = `Unit fits ${prop.masterCount + prop.commonCount} (group of ${resp.groupSize}).`
  } else if (blockers.includes('over_budget')) {
    verdict = 'hold'
    reason = `Over their budget by S$${rent - max}.`
  } else if (blockers.includes('housing_mismatch')) {
    verdict = 'hold'
    reason = `They want ${resp.housingType}; this is ${prop.housingType}.`
  } else if (blockers.length >= 2) {
    verdict = 'hold'
    reason = 'Two blockers stack — held back.'
  } else if (blockers.includes('commute_too_far')) {
    verdict = 'hold'
    reason = 'Commute too far for their tolerance.'
  } else if (finalScore < SEND_THRESHOLD) {
    verdict = 'hold'
    reason = `Score ${finalScore}/100 below send threshold (${SEND_THRESHOLD}).`
  } else {
    const softs = crit.filter((c) => c.level === 'soft' && !c.label.startsWith('School'))
    reason =
      softs.length === 0
        ? 'Strong match — budget, commute and layout all line up.'
        : `Match with one caveat: ${softs[0].label.toLowerCase()}.`
  }

  return { verdict, score: finalScore, reason, criteria: crit, blockers, groupContext }
}

/**
 * Run every response against one property. Returns ranked Send and Hold
 * buckets — every response lands in exactly one bucket.
 */
export function recommendRecipients(property, allResponses) {
  const decisions = (allResponses || []).map((r) => ({ response: r, decision: decide(r, property) }))
  const send = decisions
    .filter((d) => d.decision.verdict === 'send')
    .sort((a, b) => b.decision.score - a.decision.score)
  const hold = decisions
    .filter((d) => d.decision.verdict === 'hold')
    .sort((a, b) => b.decision.score - a.decision.score)
  return { send, hold }
}

/** Warm, family-first bilingual (EN + 中) outreach draft. */
export function draftMessage(resp, prop, decision) {
  const firstName =
    (resp.name || '').split(/[/、]/)[0].trim().split(/\s+/)[0] || 'there'
  const commute = prop.commuteMins?.[resp.school]
  const softCaveats = (decision?.criteria || []).filter((c) => c.level === 'soft')
  const caveat = softCaveats.length ? softCaveats[0].detail : ''

  const en =
    `Hi ${firstName}! It's Hommies 🏠\n\n` +
    `We found one we think fits — ${prop.condo} in ${prop.area}, a ${(prop.unitType || '').toLowerCase()} at S$${prop.rentSGD}/mo. ${commute != null ? `Commute is about ${commute}min to ${resp.school}.` : ''} Building is ${prop.buildingType}, around ${prop.ageYears} years old.\n` +
    (caveat ? `\nOne honest note: ${caveat}\n` : '') +
    `\nThe poster + photos are attached. The agent is authorised — we're just the matchmaker; you'd lease directly with them.\n\n` +
    `Let us know if you'd like a viewing 👋`

  const zh =
    `${firstName} 你好！我是 Hommies 🏠\n\n` +
    `幫你配到一間覺得很合的房：${prop.condo}（${prop.area}），${prop.unitType}，月租 S$${prop.rentSGD}。${commute != null ? `到${resp.school}通勤約 ${commute} 分鐘。` : ''}建物類型 ${prop.buildingType}，屋齡約 ${prop.ageYears} 年。\n` +
    (caveat ? `\n誠實提一點：${caveat}\n` : '') +
    `\n海報跟照片附上了。這位仲介是合法授權的——我們只是幫忙媒合，租約是你直接跟他簽。\n\n` +
    `想看房的話跟我說一聲 👋`

  return en + '\n\n────────\n\n' + zh
}

// ── Bilingual Google Form CSV parsing ──────────────────────────────────

/** Parse a Google Form CSV export into normalised response records. */
export function parseGoogleFormCSV(text) {
  const records = parseCSV(text || '')
  if (records.length < 2) return []
  const headers = records[0]
  const rows = records.slice(1).filter((r) => r.some((c) => (c || '').trim().length > 0))

  const findCol = (...needles) => {
    for (let i = 0; i < headers.length; i++) {
      const h = headers[i].toLowerCase()
      if (needles.some((n) => h.includes(String(n).toLowerCase()))) return i
    }
    return -1
  }
  const col = {
    name: findCol('姓名', 'name'),
    channel: findCol('管道', 'channel'),
    // Be specific: the channel header also contains the word "contact"
    // ("Preferred Contact Channel"), so a plain 'contact' needle would
    // grab that column instead of the actual contact-details one.
    contact: findCol('聯繫方式', '聯絡方式', 'contact details', 'details'),
    school: findCol('學校', '学校', 'school'),
    moveIn: findCol('入住', 'move-in', 'move in'),
    lease: findCol('租約', '租约', 'lease'),
    budget: findCol('預算', '预算', 'budget'),
    building: findCol('房屋類型', '房屋类型', 'building'),
    housing: findCol('偏好房型', 'housing'),
    layout: findCol('單位格局', '单位格局', 'layout'),
    commute: findCol('通勤', 'commute'),
    roommate: findCol('室友', 'roommate'),
    extras: findCol('其他需求', '特殊需求', 'extras', 'requirements'),
  }

  return rows
    .map((r) => ({
      name: (r[col.name] || '').trim() || 'Unnamed',
      channel: (r[col.channel] || 'Form').trim(),
      contact: (r[col.contact] || '').trim(),
      school: parseSchool(r[col.school]),
      moveIn: (r[col.moveIn] || '').trim(),
      leaseLength: (r[col.lease] || '').trim(),
      budget: parseBudget(r[col.budget]),
      buildingType: parseBuildingType(r[col.building]),
      housingType: parseHousingType(r[col.housing]),
      unitLayout: parseLayouts(r[col.layout]),
      commuteTolMins: parseCommute(r[col.commute]),
      wantRoommate: /yes|是|想|要|true/i.test(r[col.roommate] || ''),
      extras: {
        petFriendly: /pet|寵物|宠物/i.test(r[col.extras] || ''),
        cookingAllowed: /cook|煮|開伙|开伙|下廚|下厨/i.test(r[col.extras] || ''),
        quiet: /quiet|安靜|安静/i.test(r[col.extras] || ''),
        nearGym: /gym|健身/i.test(r[col.extras] || ''),
        note: (r[col.extras] || '').trim(),
      },
      source: 'csv',
    }))
    .filter((r) => r.name !== 'Unnamed' || r.contact)
}

function parseBudget(s) {
  // Pull every number ≥ 3 digits out of the cell and use the min / max —
  // tolerant of "S$1200 - S$1500", "1,200 to 1,500", "上限 1500", etc.
  const nums = ((s || '').replace(/,/g, '').match(/\d{3,5}/g) || []).map(Number)
  if (nums.length === 0) return { min: 0, max: 99999 }
  if (nums.length === 1) return { min: nums[0] - 200, max: nums[0] }
  const sorted = [...nums].sort((a, b) => a - b)
  return { min: sorted[0], max: sorted[sorted.length - 1] }
}

function parseSchool(s) {
  const u = (s || '').toUpperCase()
  if (u.includes('NUS')) return 'NUS'
  if (u.includes('NTU')) return 'NTU'
  if (u.includes('SMU')) return 'SMU'
  return 'OTHER'
}

function parseBuildingType(s) {
  const u = (s || '').toLowerCase()
  if (u.includes('hdb') || u.includes('組屋') || u.includes('组屋')) return 'HDB'
  if (u.includes('condo') || u.includes('公寓')) return 'Condo'
  return 'Any'
}

function parseHousingType(s) {
  const u = (s || '').toLowerCase()
  if (u.includes('whole') || u.includes('整層') || u.includes('整间') || u.includes('整套'))
    return 'Whole Unit'
  return 'Room'
}

function parseLayouts(s) {
  const out = []
  const u = s || ''
  if (/common/i.test(u) || /普通/.test(u)) out.push('Common Room')
  if (/master/i.test(u) || /主臥|主卧/.test(u)) out.push('Master Room')
  if (/studio/i.test(u) || /套房/.test(u)) out.push('Studio')
  if (/whole/i.test(u) || /整層|整间|整套/.test(u)) out.push('Whole Unit')
  return out
}

function parseCommute(s) {
  const m = (s || '').match(/(\d{1,3})/)
  return m ? +m[1] : 30
}

// RFC-4180-ish CSV tokenizer: quote-aware across newlines, supports "" escapes,
// handles CRLF / LF / bare CR. Returns an array of rows (each row an array of
// cells). Empty trailing newlines are dropped.
function parseCSV(text) {
  const rows = []
  let row = []
  let cell = ''
  let inQ = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          inQ = false
        }
      } else {
        cell += c
      }
      continue
    }
    if (c === '"') {
      inQ = true
      continue
    }
    if (c === ',') {
      row.push(cell)
      cell = ''
      continue
    }
    if (c === '\r' || c === '\n') {
      // Consume CRLF as one separator.
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      continue
    }
    cell += c
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}
