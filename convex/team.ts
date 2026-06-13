// The four internal teammates. `teamMembers` is the identity source for both
// the Daily Brief UI and Telegram bot authorisation. Seed once with team:seed
// (idempotent), then fill in real Telegram values with team:setTelegram.

import { mutation, query } from './_generated/server'
import { v } from 'convex/values'
import type { Doc } from './_generated/dataModel'

export const MEMBER_KEY = v.union(
  v.literal('fu'),
  v.literal('tt'),
  v.literal('fred'),
  v.literal('robert'),
)

const SEED: { key: 'fu' | 'tt' | 'fred' | 'robert'; name: string }[] = [
  { key: 'fu', name: 'Fu' },
  { key: 'tt', name: 'Tt' },
  { key: 'fred', name: 'Fred' },
  { key: 'robert', name: 'Robert' },
]

export const list = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query('teamMembers').collect()
    // Stable display order matching the seed (fu, tt, fred, robert).
    const order = SEED.map((s) => s.key)
    return rows.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
  },
})

// Idempotent seed — inserts any of the four members not already present.
export const seed = mutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query('teamMembers').collect()
    const have = new Set(existing.map((m) => m.key))
    let inserted = 0
    for (const m of SEED) {
      if (have.has(m.key)) continue
      await ctx.db.insert('teamMembers', {
        key: m.key,
        name: m.name,
        active: true,
      })
      inserted += 1
    }
    return { inserted, total: SEED.length }
  },
})

// Fill in (or update) a teammate's Telegram identity. Pass the numeric user id
// (from @userinfobot) and their @username without the '@'.
export const setTelegram = mutation({
  args: {
    key: MEMBER_KEY,
    telegramUserId: v.number(),
    telegramUsername: v.string(),
  },
  handler: async (ctx, { key, telegramUserId, telegramUsername }) => {
    const row = await ctx.db
      .query('teamMembers')
      .withIndex('by_key', (q) => q.eq('key', key))
      .unique()
    if (!row) throw new Error(`No teamMember with key ${key} — run team:seed first.`)
    await ctx.db.patch(row._id, {
      telegramUserId,
      telegramUsername: telegramUsername.replace(/^@/, '').toLowerCase(),
    })
    return row._id
  },
})

// Set (or update) just a teammate's Telegram @username, without needing the
// numeric user id. Stored normalised: no leading '@', lowercased.
export const setUsername = mutation({
  args: {
    key: MEMBER_KEY,
    telegramUsername: v.string(),
  },
  handler: async (ctx, { key, telegramUsername }) => {
    const row = await ctx.db
      .query('teamMembers')
      .withIndex('by_key', (q) => q.eq('key', key))
      .unique()
    if (!row) throw new Error(`No teamMember with key ${key} — run team:seed first.`)
    await ctx.db.patch(row._id, {
      telegramUsername: telegramUsername.replace(/^@/, '').toLowerCase(),
    })
    return row._id
  },
})

// --- internal lookups, shared by the Telegram handler -------------------
export async function memberByTelegramUserId(
  ctx: any,
  telegramUserId: number,
): Promise<Doc<'teamMembers'> | null> {
  const row = await ctx.db
    .query('teamMembers')
    .withIndex('by_telegramUserId', (q: any) => q.eq('telegramUserId', telegramUserId))
    .unique()
  return row ?? null
}

export async function memberByUsername(
  ctx: any,
  username: string,
): Promise<Doc<'teamMembers'> | null> {
  const clean = username.replace(/^@/, '').toLowerCase()
  const row = await ctx.db
    .query('teamMembers')
    .withIndex('by_username', (q: any) => q.eq('telegramUsername', clean))
    .unique()
  return row ?? null
}
