// Convex functions for form responses (the recipient database).
import { mutation, query } from './_generated/server'
import { v } from 'convex/values'

const responseFields = {
  name: v.string(),
  channel: v.string(),
  contact: v.string(),
  school: v.string(),
  moveIn: v.string(),
  leaseLength: v.string(),
  budget: v.object({ min: v.number(), max: v.number() }),
  buildingType: v.string(),
  housingType: v.union(v.literal('Room'), v.literal('Whole Unit')),
  unitLayout: v.array(v.string()),
  commuteTolMins: v.number(),
  wantRoommate: v.boolean(),
  extras: v.object({
    petFriendly: v.boolean(),
    cookingAllowed: v.boolean(),
    quiet: v.boolean(),
    nearGym: v.boolean(),
    note: v.string(),
  }),
  source: v.optional(v.string()),
}

export const list = query({
  args: {},
  handler: async (ctx) =>
    ctx.db.query('responses').withIndex('by_createdAt').order('desc').collect(),
})

export const add = mutation({
  args: responseFields,
  handler: async (ctx, args) =>
    ctx.db.insert('responses', { ...args, createdAt: Date.now() }),
})

export const addMany = mutation({
  args: { responses: v.array(v.object(responseFields)) },
  handler: async (ctx, { responses }) => {
    const now = Date.now()
    const ids = []
    for (const r of responses) {
      ids.push(await ctx.db.insert('responses', { ...r, createdAt: now }))
    }
    return ids
  },
})

export const remove = mutation({
  args: { id: v.id('responses') },
  handler: async (ctx, { id }) => ctx.db.delete(id),
})
