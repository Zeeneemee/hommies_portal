// Convex functions for form responses (the recipient database).
import { internalMutation, mutation, query } from './_generated/server'
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
  sheetTimestamp: v.optional(v.string()),
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

// Internal upsert called by the /sheet/sync HTTP action. Rows must already
// be normalised to the responses shape (the HTTP handler does that). Each
// row is keyed by sheetTimestamp — if a response with the same timestamp
// already exists, the row is skipped; otherwise it is inserted.
export const upsertFromSheet = internalMutation({
  args: { responses: v.array(v.object(responseFields)) },
  handler: async (ctx, { responses }) => {
    const now = Date.now()
    let inserted = 0
    let skipped = 0
    for (const r of responses) {
      const ts = r.sheetTimestamp
      if (ts) {
        const existing = await ctx.db
          .query('responses')
          .withIndex('by_sheetTimestamp', (q) => q.eq('sheetTimestamp', ts))
          .first()
        if (existing) {
          skipped += 1
          continue
        }
      }
      await ctx.db.insert('responses', { ...r, source: r.source ?? 'sheet', createdAt: now })
      inserted += 1
    }
    return { inserted, skipped }
  },
})
