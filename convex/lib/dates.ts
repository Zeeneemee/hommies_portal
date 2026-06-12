// Asia/Singapore date helpers. Singapore is a fixed UTC+8 with no DST, so a
// constant offset is exact — we never want "today" to drift between the four
// teammates or the Telegram bot. Always derive `day` / period keys here,
// never on the client.

const SG_OFFSET_MS = 8 * 60 * 60 * 1000

function sgDate(now: number = Date.now()): Date {
  // Shift the epoch so the UTC fields of the resulting Date read as SGT.
  return new Date(now + SG_OFFSET_MS)
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

// 'YYYY-MM-DD' for the current Singapore calendar day.
export function today(now: number = Date.now()): string {
  const d = sgDate(now)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

// 'YYYY-MM' for the current Singapore month.
export function monthKey(now: number = Date.now()): string {
  const d = sgDate(now)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`
}

// ISO-8601 week key 'YYYY-Www' (weeks start Monday; week 1 contains Jan 4th).
export function weekKey(now: number = Date.now()): string {
  const d = sgDate(now)
  // Work on a copy at UTC midnight of the SGT day.
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  // ISO weekday: Mon=1..Sun=7. Shift to the Thursday of this week.
  const dayNum = date.getUTCDay() === 0 ? 7 : date.getUTCDay()
  date.setUTCDate(date.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${date.getUTCFullYear()}-W${pad(week)}`
}

// periodKey for a given granularity at a given instant.
export function periodKeyFor(granularity: 'week' | 'month', now: number = Date.now()): string {
  return granularity === 'week' ? weekKey(now) : monthKey(now)
}
