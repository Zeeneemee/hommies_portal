// Leasing-journey ledger. Each row tracks one (customer, property) deal as
// it moves from LOI through to move-in. Replaces the previous `sales` table —
// the old table is preserved in the schema until `migrateFromSales` has run,
// then it (and `convex/sales.ts`) can be removed.
//
// A customer can have at most one active (`!cancelledAt`) deal at a time.
// Stage progression is strictly forward; correction is `cancel` + re-`start`.

import { internalMutation, mutation, query } from './_generated/server'
import { v } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'

export const STAGES = ['loi_sent', 'loi_signed', 'ta_issued', 'moved_in'] as const
export type Stage = (typeof STAGES)[number]

const STAGE_INDEX: Record<Stage, number> = {
  loi_sent: 0,
  loi_signed: 1,
  ta_issued: 2,
  moved_in: 3,
}

const STAGE_VALIDATOR = v.union(
  v.literal('loi_sent'),
  v.literal('loi_signed'),
  v.literal('ta_issued'),
  v.literal('moved_in'),
)

// Pure helper — used both by `Recommend.jsx` (to filter the candidate pool)
// and by `responses:listWithPipelineStatus` (to classify the bucket). A
// customer is "moved in" if there exists a deals row at that stage with no
// cancelledAt tombstone.
export function hasMovedInDeal(
  responseId: Id<'responses'>,
  deals: Pick<Doc<'deals'>, 'responseId' | 'stage' | 'cancelledAt'>[],
): boolean {
  for (const d of deals) {
    if (d.responseId !== responseId) continue
    if (d.stage !== 'moved_in') continue
    if (d.cancelledAt !== undefined) continue
    return true
  }
  return false
}

// Find the single active deal for a response, if any. "Active" = no cancelledAt.
async function findActiveDeal(ctx: any, responseId: Id<'responses'>) {
  const rows = await ctx.db
    .query('deals')
    .withIndex('by_response', (q: any) => q.eq('responseId', responseId))
    .collect()
  return rows.find((d: Doc<'deals'>) => d.cancelledAt === undefined) ?? null
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query('deals').collect()
    return Promise.all(
      rows.map(async (d) => {
        const response = await ctx.db.get(d.responseId)
        const property = await ctx.db.get(d.propertyId)
        return {
          ...d,
          customerName: response?.name ?? '(removed)',
          customerSchool: response?.school ?? null,
          propertyCondo: property?.condo ?? '(removed)',
          propertyArea: property?.area ?? null,
          propertyBuildingType: property?.buildingType ?? null,
        }
      }),
    )
  },
})

export const byResponse = query({
  args: { responseId: v.id('responses') },
  handler: async (ctx, { responseId }) => {
    return ctx.db
      .query('deals')
      .withIndex('by_response', (q) => q.eq('responseId', responseId))
      .collect()
  },
})

// Start a deal at stage `loi_sent`. Rejects if an active deal already exists
// for this customer — to switch property mid-deal, cancel the current one
// first.
export const start = mutation({
  args: {
    responseId: v.id('responses'),
    propertyId: v.id('properties'),
  },
  handler: async (ctx, { responseId, propertyId }) => {
    const active = await findActiveDeal(ctx, responseId)
    if (active) {
      throw new Error(
        'Customer already has an active deal — cancel it before starting a new one.',
      )
    }
    return ctx.db.insert('deals', {
      responseId,
      propertyId,
      stage: 'loi_sent',
      loiSentAt: Date.now(),
    })
  },
})

// Advance a deal forward. Backward transitions are rejected; skipping forward
// is allowed and sets every visited stage timestamp to the same `now()`.
export const advance = mutation({
  args: {
    id: v.id('deals'),
    to: STAGE_VALIDATOR,
  },
  handler: async (ctx, { id, to }) => {
    const row = await ctx.db.get(id)
    if (!row) throw new Error('Deal not found.')
    if (row.cancelledAt !== undefined) {
      throw new Error('Cannot advance a cancelled deal.')
    }
    const fromIdx = STAGE_INDEX[row.stage as Stage]
    const toIdx = STAGE_INDEX[to]
    if (toIdx <= fromIdx) {
      throw new Error(
        `Cannot move backward from ${row.stage} to ${to} — cancel and restart instead.`,
      )
    }
    const now = Date.now()
    const patch: Partial<Doc<'deals'>> = { stage: to }
    // Set the timestamp for every stage visited in the skip.
    for (let i = fromIdx + 1; i <= toIdx; i++) {
      const stage = STAGES[i]
      if (stage === 'loi_signed') patch.loiSignedAt = now
      else if (stage === 'ta_issued') patch.taIssuedAt = now
      else if (stage === 'moved_in') patch.movedInAt = now
    }
    await ctx.db.patch(id, patch)
    return id
  },
})

export const cancel = mutation({
  args: { id: v.id('deals') },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id)
    if (!row) throw new Error('Deal not found.')
    if (row.cancelledAt !== undefined) return id
    await ctx.db.patch(id, { cancelledAt: Date.now() })
    return id
  },
})

// Optional — record a final rent on a deal (e.g. after the lease is signed).
export const setFinalRent = mutation({
  args: { id: v.id('deals'), finalRentSGD: v.optional(v.number()) },
  handler: async (ctx, { id, finalRentSGD }) => {
    const row = await ctx.db.get(id)
    if (!row) throw new Error('Deal not found.')
    await ctx.db.patch(id, { finalRentSGD })
    return id
  },
})

// Undo cancel — clears `cancelledAt` if no newer active deal exists for the
// same customer. Used by the "Reopen" affordance on the Pipeline screen.
export const uncancel = mutation({
  args: { id: v.id('deals') },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id)
    if (!row) throw new Error('Deal not found.')
    if (row.cancelledAt === undefined) return id
    const active = await findActiveDeal(ctx, row.responseId)
    if (active) {
      throw new Error(
        'Customer has another active deal — cancel it first before reopening this one.',
      )
    }
    await ctx.db.patch(id, { cancelledAt: undefined })
    return id
  },
})

// One-shot migration. Run via `npx convex run deals:migrateFromSales` after
// the new schema is deployed. Idempotent: skips any sales row whose
// (responseId, propertyId, movedInAt) already exists as a deals row.
export const migrateFromSales = internalMutation({
  args: {},
  handler: async (ctx) => {
    const sales = await ctx.db.query('sales').collect()
    const existingDeals = await ctx.db.query('deals').collect()
    const key = (responseId: Id<'responses'>, propertyId: Id<'properties'>, ts: number) =>
      `${responseId}:${propertyId}:${ts}`
    const seen = new Set<string>()
    for (const d of existingDeals) {
      if (d.movedInAt !== undefined) {
        seen.add(key(d.responseId, d.propertyId, d.movedInAt))
      }
    }
    let migrated = 0
    let skipped = 0
    for (const s of sales) {
      const k = key(s.responseId, s.propertyId, s.closedAt)
      if (seen.has(k)) {
        skipped += 1
        continue
      }
      await ctx.db.insert('deals', {
        responseId: s.responseId,
        propertyId: s.propertyId,
        stage: 'moved_in',
        loiSentAt: s.closedAt,
        loiSignedAt: s.closedAt,
        taIssuedAt: s.closedAt,
        movedInAt: s.closedAt,
        finalRentSGD: s.finalRentSGD,
        cancelledAt: s.unclosedAt,
      })
      seen.add(k)
      migrated += 1
    }
    return { migrated, skipped, totalSales: sales.length }
  },
})
