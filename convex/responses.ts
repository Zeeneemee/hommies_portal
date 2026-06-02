// Convex functions for form responses (the recipient database).
import { internalMutation, mutation, query } from './_generated/server'
import { v } from 'convex/values'
import { normaliseMatchKey } from './sheetSync'
import type { Id } from './_generated/dataModel'

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
  groupSize: v.optional(v.number()),
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
// be normalised to the responses shape (the HTTP handler does that).
//
// Two-tier dedupe:
//   1. by_sheetTimestamp index — catches re-runs of syncAll and replays of
//      the onFormSubmitTrigger.
//   2. normaliseMatchKey(name, contact) — catches overlap with pre-existing
//      manual / CSV rows that have no sheetTimestamp. Anonymous rows
//      (empty key) never collapse into each other.
// On either match the incoming form row is skipped; the existing row is
// untouched so portal edits and the original source label survive.
export const upsertFromSheet = internalMutation({
  args: { responses: v.array(v.object(responseFields)) },
  handler: async (ctx, { responses }) => {
    const now = Date.now()
    let inserted = 0
    let skipped = 0

    // Build the tier-2 lookup set once per invocation — `syncAll` ships the
    // whole sheet, so doing the scan per-row would be N² over the table.
    const existingKeys = new Set<string>()
    const all = await ctx.db.query('responses').collect()
    for (const row of all) {
      const key = normaliseMatchKey(row)
      if (key) existingKeys.add(key)
    }

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
      const key = normaliseMatchKey(r)
      if (key && existingKeys.has(key)) {
        skipped += 1
        continue
      }
      await ctx.db.insert('responses', { ...r, source: r.source ?? 'sheet', createdAt: now })
      inserted += 1
      // Subsequent rows in the same batch must dedupe against this fresh insert too.
      if (key) existingKeys.add(key)
    }
    return { inserted, skipped }
  },
})

// One-shot cleanup mutation. Run via `npx convex run responses:mergeDuplicates`
// to collapse rows that pre-date the tier-2 dedupe (e.g. a manual entry plus a
// form-synced row for the same person). Keeps the OLDEST createdAt in each
// group; never deletes a row that has any referencing assignment, even a
// tombstoned (unpinned) one — those are reported in `skippedDueToAssignments`
// for manual resolution. Idempotent: a clean table returns zeros.
export const mergeDuplicates = internalMutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query('responses').collect()
    const groups = new Map<string, typeof all>()
    for (const r of all) {
      const key = normaliseMatchKey(r)
      if (!key) continue
      const bucket = groups.get(key) ?? []
      bucket.push(r)
      groups.set(key, bucket)
    }

    let kept = 0
    let deleted = 0
    const skippedDueToAssignments: Array<{
      key: string
      responseId: Id<'responses'>
      assignmentCount: number
    }> = []
    let dupeGroupCount = 0

    for (const [key, bucket] of groups) {
      if (bucket.length < 2) continue
      dupeGroupCount += 1
      bucket.sort((a, b) => a.createdAt - b.createdAt)
      kept += 1
      for (const dup of bucket.slice(1)) {
        const refs = await ctx.db
          .query('assignments')
          .withIndex('by_response', (q) => q.eq('responseId', dup._id))
          .collect()
        if (refs.length > 0) {
          skippedDueToAssignments.push({
            key,
            responseId: dup._id,
            assignmentCount: refs.length,
          })
          continue
        }
        await ctx.db.delete(dup._id)
        deleted += 1
      }
    }

    return { groups: dupeGroupCount, kept, deleted, skippedDueToAssignments }
  },
})
