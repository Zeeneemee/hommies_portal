// One-shot seed mutations for the cohort UI demo. Safe to delete after the
// demo property + customers have been inspected.
//
//   npx convex run demo:seedCohortDemo     — inserts 1 whole-unit property + 3 customers
//   npx convex run demo:clearCohortDemo    — removes them (matches by `source: 'cohort-demo'`)

import { internalMutation } from './_generated/server'
import { v } from 'convex/values'

// Idempotent: re-running won't double up. Returns the property id you can
// open at http://localhost:5173/recommend?property=<id>.
export const seedCohortDemo = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()

    // 1. Whole-unit property — 1 master + 2 common @ S$4,500.
    const existingProp = await ctx.db
      .query('properties')
      .filter((q) => q.eq(q.field('condo'), 'Cohort Demo · Normanton Park 1M+2C'))
      .first()
    const propertyId =
      existingProp?._id ??
      (await ctx.db.insert('properties', {
        condo: 'Cohort Demo · Normanton Park 1M+2C',
        buildingType: 'Condo',
        area: 'Kent Ridge',
        ageYears: 3,
        unitType: 'Whole Unit',
        rentSGD: 4500,
        housingType: 'Whole Unit',
        masterCount: 1,
        commonCount: 2,
        fullAddress: '1 Normanton Park, S119003',
        commuteMins: { NUS: 12, NTU: 38, SMU: 22 },
        status: 'poster_attached',
        createdAt: now,
      }))

    // 2. Three eligible solo customers — Wei, Arjun, Mei (the worked-trace fixture).
    const baseResp = (over: Record<string, unknown>) => ({
      name: 'Demo',
      channel: 'Demo',
      contact: 'demo',
      school: 'NUS',
      moveIn: '2026-08-05',
      leaseLength: '12 months',
      budget: { min: 1200, max: 1500 },
      buildingType: 'Condo' as const,
      housingType: 'Room' as const,
      unitLayout: ['Common Room'],
      commuteTolMins: 20,
      wantRoommate: true,
      groupSize: 1,
      extras: { petFriendly: false, cookingAllowed: false, quiet: false, nearGym: false, note: '' },
      source: 'cohort-demo',
      createdAt: now,
      ...over,
    })

    // All three share an identical move-in (0d span) and a 12mo lease so their
    // pair-fits saturate at 100 and beat any pre-existing pool member in the
    // seed tie-breaker (tightest move-in span). Budgets are intentionally
    // stratified so only Mei can comfortably take the master at S$1,800.
    const fixtures = [
      baseResp({ name: 'Wei (demo)', contact: '@wei-demo', budget: { min: 1200, max: 1500 }, moveIn: '2026-08-01', extras: { petFriendly: false, cookingAllowed: true, quiet: true, nearGym: false, note: 'Prefer non-smoker' } }),
      baseResp({ name: 'Arjun (demo)', contact: '@arjun-demo', budget: { min: 1300, max: 1600 }, moveIn: '2026-08-01', commuteTolMins: 25, extras: { petFriendly: false, cookingAllowed: false, quiet: true, nearGym: false, note: '' } }),
      baseResp({ name: 'Mei (demo)', contact: '@mei-demo', budget: { min: 1700, max: 2200 }, moveIn: '2026-08-01', extras: { petFriendly: false, cookingAllowed: true, quiet: false, nearGym: false, note: '' } }),
    ]

    const insertedResponses: string[] = []
    for (const fx of fixtures) {
      const existing = await ctx.db
        .query('responses')
        .filter((q) => q.and(q.eq(q.field('source'), 'cohort-demo'), q.eq(q.field('name'), fx.name)))
        .first()
      if (existing) continue
      insertedResponses.push(await ctx.db.insert('responses', fx as any))
    }

    return {
      propertyId,
      openUrl: `http://localhost:5173/recommend?property=${propertyId}`,
      insertedResponses,
      message: 'Open the URL, click "Suggest cohort", and the trio should render.',
    }
  },
})

export const clearCohortDemo = internalMutation({
  args: {},
  handler: async (ctx) => {
    const props = await ctx.db
      .query('properties')
      .filter((q) => q.eq(q.field('condo'), 'Cohort Demo · Normanton Park 1M+2C'))
      .collect()
    for (const p of props) await ctx.db.delete(p._id)
    const resps = await ctx.db
      .query('responses')
      .filter((q) => q.eq(q.field('source'), 'cohort-demo'))
      .collect()
    for (const r of resps) await ctx.db.delete(r._id)
    return { deletedProperties: props.length, deletedResponses: resps.length }
  },
})
