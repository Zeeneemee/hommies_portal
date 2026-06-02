// Closed-deal ledger. A `sale` row maps one customer (responseId) to one
// property (propertyId) at the moment the operator confirms a signed lease.
// Active rows have no unclosedAt; "undo close" sets the tombstone so the
// historical event is preserved.

import { mutation, query } from './_generated/server'
import { v } from 'convex/values'

export const list = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query('sales').withIndex('by_closedAt').order('desc').collect()
    return Promise.all(
      rows.map(async (s) => {
        const response = await ctx.db.get(s.responseId)
        const property = await ctx.db.get(s.propertyId)
        return {
          ...s,
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
      .query('sales')
      .withIndex('by_response', (q) => q.eq('responseId', responseId))
      .collect()
  },
})

export const close = mutation({
  args: {
    responseId: v.id('responses'),
    propertyId: v.id('properties'),
    finalRentSGD: v.optional(v.number()),
  },
  handler: async (ctx, { responseId, propertyId, finalRentSGD }) => {
    const existing = await ctx.db
      .query('sales')
      .withIndex('by_response', (q) => q.eq('responseId', responseId))
      .collect()
    const active = existing.find(
      (s) => s.propertyId === propertyId && s.unclosedAt === undefined,
    )
    if (active) return active._id
    return ctx.db.insert('sales', {
      responseId,
      propertyId,
      finalRentSGD,
      closedAt: Date.now(),
    })
  },
})

export const unclose = mutation({
  args: { id: v.id('sales') },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id)
    if (!row) return
    if (row.unclosedAt !== undefined) return
    await ctx.db.patch(id, { unclosedAt: Date.now() })
  },
})
