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

const SCHOOL_CAMPUSES = ['NUS', 'NTU', 'SMU']

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

  // BUDGET ──────────────────────────────────────────────────────────────
  const rent = prop.rentSGD
  const { min = 0, max = 0 } = resp.budget || {}
  if (rent >= min && rent <= max) {
    score += W.budget
    crit.push({
      label: `Budget S$${min}–${max}`,
      level: 'pass',
      detail: `Rent S$${rent} sits inside range.`,
    })
  } else if (rent > max && rent <= max + BUDGET_SOFT_OVERSHOOT) {
    score += W.budget * 0.45
    crit.push({
      label: `Budget S$${min}–${max}`,
      level: 'soft',
      detail: `Rent S$${rent} is S$${rent - max} over — small overshoot.`,
    })
  } else if (rent < min) {
    score += W.budget * 0.7
    crit.push({
      label: `Budget S$${min}–${max}`,
      level: 'soft',
      detail: `Rent S$${rent} is below their minimum — usually fine, but flag.`,
    })
  } else {
    blockers.push('over_budget')
    crit.push({
      label: `Budget S$${min}–${max}`,
      level: 'fail',
      detail: `Rent S$${rent} is S$${rent - max} over budget. Hard blocker.`,
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

  if (blockers.includes('over_budget')) {
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

  return { verdict, score: finalScore, reason, criteria: crit, blockers }
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
