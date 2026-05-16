// Convex functions for the (property, client) assignment ledger.
//
// Pin = "the operator commits to sending this property to this client."
// Sent = "the outreach actually went out." Sent rows are immutable audit;
// unpin sets a tombstone (`unpinnedAt`) instead of deleting so a fresh pin
// for the same pair can coexist with the withdrawn one.
//
// See openspec/changes/descriptive-property-assignments for the design.
import { mutation, query } from './_generated/server'
import { v } from 'convex/values'

// Listing — optionally narrow by property or response. Sorted newest-first.
// The view layer composes this with properties:list / responses:list to
// derive Must-send / Sent / Suggestions, orphan flags, and engagement chips.
export const list = query({
  args: {
    propertyId: v.optional(v.id('properties')),
    responseId: v.optional(v.id('responses')),
  },
  handler: async (ctx, { propertyId, responseId }) => {
    let rows
    if (propertyId) {
      rows = await ctx.db
        .query('assignments')
        .withIndex('by_property', (q) => q.eq('propertyId', propertyId))
        .collect()
    } else if (responseId) {
      rows = await ctx.db
        .query('assignments')
        .withIndex('by_response', (q) => q.eq('responseId', responseId))
        .collect()
    } else {
      rows = await ctx.db.query('assignments').collect()
    }
    return rows.sort((a, b) => b.pinnedAt - a.pinnedAt)
  },
})

// Pin: idempotent on an existing ACTIVE row for the same pair. An active
// row is one whose `unpinnedAt` is unset (covers both pinned and sent
// statuses — a sent row blocks new pins for that pair, which is what we
// want: don't double-send).
export const pin = mutation({
  args: {
    propertyId: v.id('properties'),
    responseId: v.id('responses'),
    pinnedScore: v.number(),
    pinnedReason: v.optional(v.string()),
  },
  handler: async (ctx, { propertyId, responseId, pinnedScore, pinnedReason }) => {
    const existing = await ctx.db
      .query('assignments')
      .withIndex('by_property', (q) => q.eq('propertyId', propertyId))
      .collect()
    const active = existing.find(
      (a) => a.responseId === responseId && a.unpinnedAt === undefined,
    )
    if (active) return active._id
    return ctx.db.insert('assignments', {
      propertyId,
      responseId,
      status: 'pinned',
      pinnedAt: Date.now(),
      pinnedScore,
      pinnedReason,
    })
  },
})

// Unpin: stamps `unpinnedAt`. Rejects sent rows — sent is the audit trail
// and must remain visible in the Sent section forever.
export const unpin = mutation({
  args: { id: v.id('assignments') },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id)
    if (!row) throw new Error('Assignment not found.')
    if (row.sentAt !== undefined) {
      throw new Error(
        'Sent assignments are immutable — they remain in the audit trail and cannot be unpinned.',
      )
    }
    if (row.unpinnedAt !== undefined) return id
    await ctx.db.patch(id, { unpinnedAt: Date.now() })
    return id
  },
})

// Mark-sent: transitions pinned → sent and stamps the time and channel.
// Rejects rows that are already sent or that were unpinned.
export const markSent = mutation({
  args: {
    id: v.id('assignments'),
    sentVia: v.optional(v.string()),
  },
  handler: async (ctx, { id, sentVia }) => {
    const row = await ctx.db.get(id)
    if (!row) throw new Error('Assignment not found.')
    if (row.sentAt !== undefined) {
      throw new Error('Assignment is already marked sent.')
    }
    if (row.unpinnedAt !== undefined) {
      throw new Error('Cannot mark an unpinned assignment as sent.')
    }
    await ctx.db.patch(id, {
      status: 'sent',
      sentAt: Date.now(),
      sentVia,
    })
    return id
  },
})
