// Read/write side of the server-side scrape cache (see schema.ts:scrapeCache).
// Internal-only: the extraction action consults these from `proxiedFetch`.
// TTL is enforced by the caller so the query stays a plain index lookup.
import { internalMutation, internalQuery } from './_generated/server'
import { v } from 'convex/values'

export const getCached = internalQuery({
  args: { urlKey: v.string() },
  handler: async (ctx, { urlKey }) => {
    return ctx.db
      .query('scrapeCache')
      .withIndex('by_urlKey', (q) => q.eq('urlKey', urlKey))
      .unique()
  },
})

// Upsert by urlKey, stamping fetchedAt = now. One row per normalized URL.
export const putCached = internalMutation({
  args: { urlKey: v.string(), html: v.string(), status: v.number() },
  handler: async (ctx, { urlKey, html, status }) => {
    const existing = await ctx.db
      .query('scrapeCache')
      .withIndex('by_urlKey', (q) => q.eq('urlKey', urlKey))
      .unique()
    const fetchedAt = Date.now()
    if (existing) {
      await ctx.db.patch(existing._id, { html, status, fetchedAt })
    } else {
      await ctx.db.insert('scrapeCache', { urlKey, html, status, fetchedAt })
    }
  },
})
