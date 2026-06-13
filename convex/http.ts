// Convex HTTP routes. Currently exposes a single endpoint, /sheet/sync, used
// by the Apps Script bound to the Google-Form responses sheet to push new and
// changed rows into the responses table. The endpoint URL is on the
// .convex.site host (not the .convex.cloud query/mutation host).
import { httpRouter } from 'convex/server'
import { httpAction } from './_generated/server'
import { internal } from './_generated/api'
import { normaliseSheetRows } from './sheetSync'
import { sendMessage } from './telegram'

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

// Telegram bot webhook. Telegram echoes the secret we set via setWebhook in
// the `X-Telegram-Bot-Api-Secret-Token` header — validate it before touching
// anything. The command logic + db writes live in telegram:handleCommand
// (a mutation, which returns the reply text); we send that reply best-effort.
// Always return 200 quickly so Telegram doesn't retry.
http.route({
  path: '/telegram/webhook',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const expected = process.env.TELEGRAM_WEBHOOK_SECRET
    const got = request.headers.get('X-Telegram-Bot-Api-Secret-Token')
    if (!expected || got !== expected) {
      return new Response('unauthorised', { status: 401 })
    }

    let update: any
    try {
      update = await request.json()
    } catch {
      return new Response('ok', { status: 200 })
    }

    const message = update?.message ?? update?.edited_message
    const text: string | undefined = message?.text
    const fromUserId: number | undefined = message?.from?.id
    const fromUsername: string | undefined = message?.from?.username
    const chatId: number | undefined = message?.chat?.id

    // Only act on text messages from a user we can identify a chat to reply to.
    if (text && typeof fromUserId === 'number' && typeof chatId === 'number') {
      const reply = await ctx.runMutation(internal.telegram.handleCommand, {
        fromUserId,
        fromUsername,
        text,
      })
      if (reply) {
        try {
          await sendMessage(chatId, reply)
        } catch {
          /* best-effort — never fail the webhook on a send error */
        }
      }
    }

    return new Response('ok', { status: 200 })
  }),
})

export default http
