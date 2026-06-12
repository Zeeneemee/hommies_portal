// Customer allocation — assigns an incoming customer (responses row) to a
// salesperson to answer / follow up. Stored in its own table (not a field on
// responses) so /sheet/sync upserts can never clobber an allocation.

import { mutation, query } from './_generated/server'
import { v } from 'convex/values'
import { MEMBER_KEY } from './team'
import type { Doc, Id } from './_generated/dataModel'

// Every customer plus their current allocation (if any). The UI groups by
// assignee and surfaces an "unallocated" bucket for the rest.
export const listAllocations = query({
  args: {},
  handler: async (ctx) => {
    const allocations = await ctx.db.query('customerAllocations').collect()
    const byResponse = new Map<Id<'responses'>, Doc<'customerAllocations'>>()
    for (const a of allocations) byResponse.set(a.responseId, a)

    const responses = await ctx.db.query('responses').collect()
    return responses
      .map((r) => {
        const a = byResponse.get(r._id)
        return {
          responseId: r._id,
          name: r.name,
          school: r.school,
          contact: r.contact,
          channel: r.channel,
          createdAt: r.createdAt,
          assigneeKey: a?.assigneeKey ?? null,
          allocatedAt: a?.allocatedAt ?? null,
        }
      })
      .sort((a, b) => b.createdAt - a.createdAt)
  },
})

// Allocate / reassign — upsert one row per response.
export const allocate = mutation({
  args: {
    responseId: v.id('responses'),
    assigneeKey: MEMBER_KEY,
    allocatedByKey: v.optional(v.string()),
  },
  handler: async (ctx, { responseId, assigneeKey, allocatedByKey }) => {
    const existing = await ctx.db
      .query('customerAllocations')
      .withIndex('by_response', (q) => q.eq('responseId', responseId))
      .unique()
    if (existing) {
      await ctx.db.patch(existing._id, { assigneeKey, allocatedByKey, allocatedAt: Date.now() })
      return existing._id
    }
    return ctx.db.insert('customerAllocations', {
      responseId,
      assigneeKey,
      allocatedByKey,
      allocatedAt: Date.now(),
    })
  },
})

export const unallocate = mutation({
  args: { responseId: v.id('responses') },
  handler: async (ctx, { responseId }) => {
    const existing = await ctx.db
      .query('customerAllocations')
      .withIndex('by_response', (q) => q.eq('responseId', responseId))
      .unique()
    if (existing) await ctx.db.delete(existing._id)
    return responseId
  },
})
