// Phase plan — the big-picture week/month plan, now a tick-off checklist the
// team reads and writes. One row per (granularity, periodKey). periodKey is an
// ISO week ('2026-W24') or a month ('2026-06'), computed by the UI.
//
// `content` (a free-text plan from before the checklist change) is migrated
// into checklist items on first read/write.

import { mutation, query } from './_generated/server'
import { v } from 'convex/values'

const GRANULARITY = v.union(v.literal('week'), v.literal('month'))

type PlanItem = { text: string; done: boolean }

function legacyItems(row: { items?: PlanItem[]; content?: string } | null): PlanItem[] {
  if (!row) return []
  if (row.items) return row.items
  if (row.content) {
    return row.content
      .split('\n')
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => ({ text: t, done: false }))
  }
  return []
}

export const getPlan = query({
  args: { granularity: GRANULARITY, periodKey: v.string() },
  handler: async (ctx, { granularity, periodKey }) => {
    const row = await ctx.db
      .query('phasePlans')
      .withIndex('by_period', (q) =>
        q.eq('granularity', granularity).eq('periodKey', periodKey),
      )
      .unique()
    return { items: legacyItems(row), updatedAt: row?.updatedAt ?? null }
  },
})

async function ensurePlan(
  ctx: any,
  granularity: 'week' | 'month',
  periodKey: string,
): Promise<{ _id: any; items: PlanItem[] }> {
  const existing = await ctx.db
    .query('phasePlans')
    .withIndex('by_period', (q: any) =>
      q.eq('granularity', granularity).eq('periodKey', periodKey),
    )
    .unique()
  if (existing) return { _id: existing._id, items: legacyItems(existing) }
  const id = await ctx.db.insert('phasePlans', {
    granularity,
    periodKey,
    items: [],
    updatedAt: Date.now(),
  })
  return { _id: id, items: [] }
}

export const addPlanItem = mutation({
  args: {
    granularity: GRANULARITY,
    periodKey: v.string(),
    text: v.string(),
    updatedByKey: v.optional(v.string()),
  },
  handler: async (ctx, { granularity, periodKey, text, updatedByKey }) => {
    const trimmed = text.trim()
    if (!trimmed) throw new Error('Plan item text is required.')
    const row = await ensurePlan(ctx, granularity, periodKey)
    await ctx.db.patch(row._id, {
      items: [...row.items, { text: trimmed, done: false }],
      content: undefined, // drop migrated legacy free-text
      updatedByKey,
      updatedAt: Date.now(),
    })
    return row._id
  },
})

export const togglePlanItem = mutation({
  args: {
    granularity: GRANULARITY,
    periodKey: v.string(),
    index: v.number(),
    done: v.optional(v.boolean()),
  },
  handler: async (ctx, { granularity, periodKey, index, done }) => {
    const existing = await ctx.db
      .query('phasePlans')
      .withIndex('by_period', (q) =>
        q.eq('granularity', granularity).eq('periodKey', periodKey),
      )
      .unique()
    if (!existing) return null
    const current = legacyItems(existing)
    if (!current[index]) return null
    const items = current.map((it, i) =>
      i === index ? { ...it, done: done ?? !it.done } : it,
    )
    await ctx.db.patch(existing._id, { items, content: undefined, updatedAt: Date.now() })
    return existing._id
  },
})

export const removePlanItem = mutation({
  args: { granularity: GRANULARITY, periodKey: v.string(), index: v.number() },
  handler: async (ctx, { granularity, periodKey, index }) => {
    const existing = await ctx.db
      .query('phasePlans')
      .withIndex('by_period', (q) =>
        q.eq('granularity', granularity).eq('periodKey', periodKey),
      )
      .unique()
    if (!existing) return null
    const current = legacyItems(existing)
    if (!current[index]) return null
    const items = current.filter((_, i) => i !== index)
    await ctx.db.patch(existing._id, { items, content: undefined, updatedAt: Date.now() })
    return existing._id
  },
})
