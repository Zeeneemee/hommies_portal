// Convex HTTP routes. Currently exposes a single endpoint, /sheet/sync, used
// by the Apps Script bound to the Google-Form responses sheet to push new and
// changed rows into the responses table. The endpoint URL is on the
// .convex.site host (not the .convex.cloud query/mutation host).
import { httpRouter } from 'convex/server'
import { httpAction } from './_generated/server'
import { internal } from './_generated/api'
import { normaliseSheetRows } from './sheetSync'

const http = httpRouter()

http.route({
  path: '/sheet/sync',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const expected = process.env.SHEET_SYNC_SECRET
    if (!expected) {
      return new Response(JSON.stringify({ error: 'SHEET_SYNC_SECRET not set on deployment' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    let body: { secret?: string; headers?: string[]; rows?: unknown[][] }
    try {
      body = await request.json()
    } catch {
      return new Response(JSON.stringify({ error: 'invalid JSON body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (!body.secret || body.secret !== expected) {
      return new Response(JSON.stringify({ error: 'unauthorised' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (!Array.isArray(body.headers) || !Array.isArray(body.rows)) {
      return new Response(JSON.stringify({ error: 'headers[] and rows[][] required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const normalised = normaliseSheetRows(body.headers, body.rows)
    const result = await ctx.runMutation(internal.responses.upsertFromSheet, {
      responses: normalised,
    })

    return new Response(
      JSON.stringify({ ok: true, parsed: normalised.length, ...result }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }),
})

// Lightweight liveness probe — useful when wiring up the Apps Script.
http.route({
  path: '/sheet/sync',
  method: 'GET',
  handler: httpAction(async () =>
    new Response(JSON.stringify({ ok: true, endpoint: '/sheet/sync' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  ),
})

export default http
