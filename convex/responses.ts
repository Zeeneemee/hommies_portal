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

// One-shot pipeline join — returns every response with its computed funnel
// stage plus the cached numbers / linked-property pointers the Pipeline screen
// needs to render a row without follow-up queries. Stage priority:
//   moved_in > ta_issued > loi_signed > loi_sent > sent > not_contacted
// Cancelled deals don't contribute; the customer falls back to `sent` if any
// sent assignment exists, otherwise `not_contacted`.
export const listWithPipelineStatus = query({
  args: {},
  handler: async (ctx) => {
    const [responses, assignments, deals] = await Promise.all([
      ctx.db.query('responses').withIndex('by_createdAt').order('desc').collect(),
      ctx.db.query('assignments').collect(),
      ctx.db.query('deals').collect(),
    ])

    // Aggregate assignment + deal state per response in one pass each.
    const sentByResponse = new Map<
      string,
      { count: number; lastSentAt: number; lastSentPropertyId: Id<'properties'> | null }
    >()
    for (const a of assignments) {
      if (a.status !== 'sent') continue
      if (a.unpinnedAt !== undefined) continue
      const at = a.sentAt ?? 0
      const cur = sentByResponse.get(a.responseId)
      if (!cur) {
        sentByResponse.set(a.responseId, {
          count: 1,
          lastSentAt: at,
          lastSentPropertyId: a.propertyId,
        })
      } else {
        cur.count += 1
        if (at > cur.lastSentAt) {
          cur.lastSentAt = at
          cur.lastSentPropertyId = a.propertyId
        }
      }
    }

    const activeDealByResponse = new Map<string, typeof deals[number]>()
    const movedInByResponse = new Map<string, typeof deals[number]>()
    for (const d of deals) {
      if (d.cancelledAt !== undefined) continue
      // A customer has at most one active deal (enforced by deals:start), so
      // first-write-wins is safe. We also separately track any moved_in deal
      // because that wins regardless of whether there's a parallel active row
      // from a botched migration.
      if (d.stage === 'moved_in') {
        movedInByResponse.set(d.responseId, d)
      }
      if (!activeDealByResponse.has(d.responseId)) {
        activeDealByResponse.set(d.responseId, d)
      }
    }

    // Build a tiny propertyId → condo lookup so the row meta can render the
    // linked property's name without the client doing a second query.
    const propertyIds = new Set<string>()
    for (const a of assignments) propertyIds.add(a.propertyId)
    for (const d of deals) propertyIds.add(d.propertyId)
    const propertyNames = new Map<string, string>()
    for (const pid of propertyIds) {
      const p = await ctx.db.get(pid as Id<'properties'>)
      if (p) propertyNames.set(pid, p.condo)
    }

    return responses.map((r) => {
      const sent = sentByResponse.get(r._id)
      const movedIn = movedInByResponse.get(r._id)
      const active = movedIn ?? activeDealByResponse.get(r._id)
      const stage: PipelineStage = movedIn
        ? 'moved_in'
        : active
        ? (active.stage as PipelineStage)
        : sent
        ? 'sent'
        : 'not_contacted'
      return {
        ...r,
        stage,
        sentCount: sent?.count ?? 0,
        lastSentAt: sent?.lastSentAt ?? null,
        lastSentPropertyId: sent?.lastSentPropertyId ?? null,
        lastSentPropertyCondo: sent?.lastSentPropertyId
          ? propertyNames.get(sent.lastSentPropertyId) ?? null
          : null,
        activeDeal: active
          ? {
              _id: active._id,
              propertyId: active.propertyId,
              propertyCondo: propertyNames.get(active.propertyId) ?? null,
              stage: active.stage,
              loiSentAt: active.loiSentAt,
              loiSignedAt: active.loiSignedAt,
              taIssuedAt: active.taIssuedAt,
              movedInAt: active.movedInAt,
              finalRentSGD: active.finalRentSGD,
            }
          : null,
      }
    })
  },
})

type PipelineStage =
  | 'not_contacted'
  | 'sent'
  | 'loi_sent'
  | 'loi_signed'
  | 'ta_issued'
  | 'moved_in'

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

// Operator edit for a customer / form response. Only the supplied fields are
// patched — leaves createdAt, sheetTimestamp, and source untouched unless the
// caller explicitly overrides them, so a portal edit never accidentally drops
// the original ingestion provenance.
export const update = mutation({
  args: {
    id: v.id('responses'),
    patch: v.object({
      name: v.optional(v.string()),
      channel: v.optional(v.string()),
      contact: v.optional(v.string()),
      school: v.optional(v.string()),
      moveIn: v.optional(v.string()),
      leaseLength: v.optional(v.string()),
      budget: v.optional(v.object({ min: v.number(), max: v.number() })),
      buildingType: v.optional(v.string()),
      housingType: v.optional(v.union(v.literal('Room'), v.literal('Whole Unit'))),
      unitLayout: v.optional(v.array(v.string())),
      commuteTolMins: v.optional(v.number()),
      wantRoommate: v.optional(v.boolean()),
      groupSize: v.optional(v.number()),
      extras: v.optional(
        v.object({
          petFriendly: v.boolean(),
          cookingAllowed: v.boolean(),
          quiet: v.boolean(),
          nearGym: v.boolean(),
          note: v.string(),
        }),
      ),
      source: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await ctx.db.patch(id, patch)
  },
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
