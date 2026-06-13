// Telegram bot — command-based, two-way channel into the same teamTasks /
// standups the Daily Brief reads. The webhook (convex/http.ts) parses the
// update, calls handleCommand (a mutation, so it has db access and returns the
// reply text), then sends that reply via sendMessage (fetch, action runtime).
//
// Commands:
//   /add <title>             add a todo to yourself for today
//   /add @user <title>       assign a todo to a teammate for today
//   /add_tasks [@user]       bulk add — one task per bulleted line (newline/•/;)
//   /today                   list your tasks for today (numbered)
//   /today @user             peek at a teammate's tasks for today
//   /done <n>                mark your own task #n (from /today) done
//   /done 1 3 5              mark several tasks done at once
//   /done all                mark all your open tasks done
//   /delete <n>              delete your task #n (also /delete 1 3 5)
//   /clear                   remove all your done tasks for today
//   /goals [month]           list the team goals (phase plan) for the period
//   /goal [month] <text>     add a goal; /goaldone <n> toggles; /goaldel <n> removes
//   /iam <key>               self-register: link this account to fu/tt/fred/robert
//
// Unknown senders (Telegram user id not in teamMembers) are ignored, except
// /iam (self-registration) and /start /help (which hint at /iam).

import { internalMutation } from './_generated/server'
import { v } from 'convex/values'
import { today, weekKey, monthKey } from './lib/dates'
import { memberByTelegramUserId, memberByUsername } from './team'
import type { Doc } from './_generated/dataModel'

// Plain helper — runs in the action runtime (fetch allowed). No-op if the bot
// token isn't configured so a missing env var never throws inside the webhook.
export async function sendMessage(chatId: number, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  })
}

const STATUS_MARK: Record<string, string> = {
  todo: '[ ]',
  doing: '[~]',
  done: '[x]',
  blocked: '[!]',
}

async function tasksForToday(ctx: any, assigneeKey: string): Promise<Doc<'teamTasks'>[]> {
  const d = today()
  const rows = await ctx.db
    .query('teamTasks')
    .withIndex('by_assignee_day', (q: any) => q.eq('assigneeKey', assigneeKey).eq('day', d))
    .collect()
  // Stable ascending order so the numbering in /today matches /done <n>.
  return rows.sort((a: Doc<'teamTasks'>, b: Doc<'teamTasks'>) => a.createdAt - b.createdAt)
}

function renderList(name: string, tasks: Doc<'teamTasks'>[]): string {
  if (tasks.length === 0) return `${name} has no tasks for today.`
  const lines = tasks.map((t, i) => `${i + 1}. ${STATUS_MARK[t.status] || '[ ]'} ${t.title}`)
  return `${name} — today:\n${lines.join('\n')}`
}

// Split a bulleted block into individual task titles. Tasks may be separated by
// newlines, bullet dots (•), or semicolons; a leading list marker (-, *, –, ·)
// on each line is stripped. Hyphenated words are left intact.
function parseTaskLines(block: string): string[] {
  return block
    .split(/\r?\n|•|;/)
    .map((s) => s.replace(/^\s*[-*–·]\s+/, '').trim())
    .filter(Boolean)
}

// --- goals (phase plan) helpers -----------------------------------------
type PlanItem = { text: string; done: boolean }

// Parse an optional leading week|month token (default week) off a goal command.
function parseGran(s: string): { gran: 'week' | 'month'; rest: string } {
  const m = s.match(/^(week|month)\b\s*([\s\S]*)$/i)
  if (m) return { gran: m[1].toLowerCase() as 'week' | 'month', rest: m[2].trim() }
  return { gran: 'week', rest: s.trim() }
}

function planItems(row: { items?: PlanItem[]; content?: string } | null): PlanItem[] {
  if (!row) return []
  if (row.items) return row.items
  if (row.content) {
    return row.content
      .split('\n')
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => ({ text: t, done: false }))
  }
  return []
}

async function planRow(ctx: any, gran: 'week' | 'month', periodKey: string) {
  return ctx.db
    .query('phasePlans')
    .withIndex('by_period', (q: any) => q.eq('granularity', gran).eq('periodKey', periodKey))
    .unique()
}

// Returns the reply text, or null to stay silent (unknown sender). All db
// writes happen here so the webhook can be a thin parse-and-reply shell.
export const handleCommand = internalMutation({
  args: {
    fromUserId: v.number(),
    fromUsername: v.optional(v.string()),
    text: v.string(),
  },
  handler: async (ctx, { fromUserId, fromUsername, text }): Promise<string | null> => {
    const member = await memberByTelegramUserId(ctx, fromUserId)

    const raw = text.trim()
    // Split off the command token on the FIRST whitespace (space OR newline) so
    // multi-line bulleted input is preserved. Strip any @botname suffix that
    // Telegram appends to commands in group chats (e.g. /add@hommiesSG_bot).
    const cmdMatch = raw.match(/^(\S+)([\s\S]*)$/)
    const cmd = (cmdMatch ? cmdMatch[1] : raw).toLowerCase().replace(/@.*$/, '')
    let rest = (cmdMatch ? cmdMatch[2] : '').trim()

    // Optional leading @username target.
    let target: Doc<'teamMembers'> | null = null
    let targetName: string | null = null
    if (rest.startsWith('@')) {
      const m = rest.match(/^@(\S+)([\s\S]*)$/)
      if (m) {
        targetName = m[1]
        rest = (m[2] || '').trim()
        target = await memberByUsername(ctx, m[1])
      }
    }

    // Self-registration — links this Telegram account to a teammate key. Works
    // for not-yet-known senders (this is how they get recognised). Captures the
    // sender's numeric id + @username automatically.
    if (cmd === '/iam' || cmd === '/register') {
      const key = rest.trim().toLowerCase().split(/\s+/)[0]
      if (!['fu', 'tt', 'fred', 'robert'].includes(key)) {
        return 'Usage: /iam <fu|tt|fred|robert> — links this Telegram account to that teammate.'
      }
      const row = await ctx.db
        .query('teamMembers')
        .withIndex('by_key', (q) => q.eq('key', key))
        .unique()
      if (!row) return 'Team not set up yet. Ask an admin to run team:seed.'
      if (row.telegramUserId !== undefined && row.telegramUserId !== fromUserId) {
        return `${row.name} is already linked to another account. Ask an admin if that's wrong.`
      }
      await ctx.db.patch(row._id, {
        telegramUserId: fromUserId,
        telegramUsername: fromUsername
          ? fromUsername.replace(/^@/, '').toLowerCase()
          : row.telegramUsername,
      })
      const uname = fromUsername ? ` (@${fromUsername})` : ''
      return `Linked — you are ${row.name}${uname}. Try /today or /help.`
    }

    // Every other command requires a recognised sender.
    if (!member) {
      if (cmd === '/start' || cmd === '/help') {
        return "Hi! This account isn't linked yet. Send: /iam <your name> (fu, tt, fred, or robert) to register."
      }
      return null
    }

    switch (cmd) {
      case '/add': {
        if (targetName && !target) {
          return `No teammate with username @${targetName}. Try fu, tt, fred, or robert's @username.`
        }
        const assignee = target ?? member
        if (!rest) return 'Usage: /add <task> or /add @username <task>'
        await ctx.db.insert('teamTasks', {
          assigneeKey: assignee.key,
          title: rest,
          status: 'todo',
          day: today(),
          createdByKey: member.key,
          source: 'telegram',
          createdAt: Date.now(),
        })
        return assignee.key === member.key
          ? `Added: ${rest}`
          : `Added for ${assignee.name}: ${rest}`
      }

      // Bulk add — one task per bullet/line. With @username assigns all to that
      // teammate; without, all to the sender.
      case '/add_tasks':
      case '/addtasks': {
        if (targetName && !target) {
          return `No teammate with username @${targetName}. Try fu, tt, fred, or robert's @username.`
        }
        const assignee = target ?? member
        const titles = parseTaskLines(rest)
        if (titles.length === 0) {
          return 'Usage:\n/add_tasks @username\n- first task\n- second task\n(omit @username to add to yourself)'
        }
        const now = Date.now()
        for (const title of titles) {
          await ctx.db.insert('teamTasks', {
            assigneeKey: assignee.key,
            title,
            status: 'todo',
            day: today(),
            createdByKey: member.key,
            source: 'telegram',
            createdAt: now,
          })
        }
        const who = assignee.key === member.key ? '' : ` for ${assignee.name}`
        const lines = titles.map((t) => `- ${t}`).join('\n')
        return `Added ${titles.length} task${titles.length > 1 ? 's' : ''}${who}:\n${lines}`
      }

      case '/today': {
        if (targetName && !target) {
          return `No teammate with username @${targetName}.`
        }
        const who = target ?? member
        const tasks = await tasksForToday(ctx, who.key)
        return renderList(who.name, tasks)
      }

      case '/done': {
        const tasks = await tasksForToday(ctx, member.key)
        // "/done all" marks every open task done.
        if (rest.trim().toLowerCase() === 'all') {
          let changed = 0
          for (const t of tasks) {
            if (t.status !== 'done') {
              await ctx.db.patch(t._id, { status: 'done', doneAt: Date.now() })
              changed += 1
            }
          }
          return changed
            ? `Marked ${changed} task${changed > 1 ? 's' : ''} done.`
            : 'No open tasks to mark done.'
        }
        // "/done 1 3 5" or "/done 1,3,5" — mark several at once.
        const nums = (rest.match(/\d+/g) || []).map(Number).filter((n) => n >= 1)
        if (nums.length === 0) {
          return 'Usage: /done <number>, /done 1 3 5, or /done all (numbers from /today).'
        }
        const doneTitles: string[] = []
        const missing: number[] = []
        // Resolve all indices first (against the same /today ordering), then patch.
        for (const n of [...new Set(nums)]) {
          const task = tasks[n - 1]
          if (!task) {
            missing.push(n)
          } else {
            if (task.status !== 'done') {
              await ctx.db.patch(task._id, { status: 'done', doneAt: Date.now() })
            }
            doneTitles.push(task.title)
          }
        }
        if (doneTitles.length === 0) {
          return `No task${missing.length > 1 ? 's' : ''} #${missing.join(', ')} in your list today. Send /today to check.`
        }
        const body = doneTitles.map((t) => `- ${t}`).join('\n')
        const tail = missing.length ? `\n(no #${missing.join(', ')})` : ''
        return `Done ${doneTitles.length} task${doneTitles.length > 1 ? 's' : ''}:\n${body}${tail}`
      }

      // Delete one or more of your own tasks by number, e.g. /delete 2  or  /delete 1 3.
      case '/delete':
      case '/del': {
        const tasks = await tasksForToday(ctx, member.key)
        const nums = (rest.match(/\d+/g) || []).map(Number).filter((n) => n >= 1)
        if (nums.length === 0) return 'Usage: /delete <number> (numbers from /today).'
        const deleted: string[] = []
        const missing: number[] = []
        // Resolve all indices against the same /today ordering before deleting.
        const toDelete = [...new Set(nums)].map((n) => ({ n, task: tasks[n - 1] }))
        for (const { n, task } of toDelete) {
          if (!task) missing.push(n)
          else {
            await ctx.db.delete(task._id)
            deleted.push(task.title)
          }
        }
        if (deleted.length === 0) {
          return `No task${missing.length > 1 ? 's' : ''} #${missing.join(', ')} in your list today.`
        }
        const body = deleted.map((t) => `- ${t}`).join('\n')
        const tail = missing.length ? `\n(no #${missing.join(', ')})` : ''
        return `Deleted ${deleted.length} task${deleted.length > 1 ? 's' : ''}:\n${body}${tail}`
      }

      // Remove all your done tasks for today.
      case '/clear':
      case '/cleardone': {
        const tasks = await tasksForToday(ctx, member.key)
        let removed = 0
        for (const t of tasks) {
          if (t.status === 'done') {
            await ctx.db.delete(t._id)
            removed += 1
          }
        }
        return removed
          ? `Cleared ${removed} done task${removed > 1 ? 's' : ''}.`
          : 'No done tasks to clear.'
      }

      // --- goals (the team phase plan) -----------------------------------
      // READ: /goals [month]
      case '/goals': {
        const { gran } = parseGran(rest)
        const periodKey = gran === 'month' ? monthKey() : weekKey()
        const items = planItems(await planRow(ctx, gran, periodKey))
        const label = `${gran === 'month' ? 'This month' : 'This week'} (${periodKey})`
        if (items.length === 0) {
          return `No goals for ${label} yet. Add one with /goal <text>.`
        }
        const lines = items.map((g, i) => `${i + 1}. ${g.done ? '[x]' : '[ ]'} ${g.text}`)
        return `${label} goals:\n${lines.join('\n')}`
      }

      // WRITE: /goal <text>  (or /goal month <text>)
      case '/goal':
      case '/addgoal': {
        const { gran, rest: body } = parseGran(rest)
        if (!body) return 'Usage: /goal <text>  (or /goal month <text> for the monthly plan)'
        const periodKey = gran === 'month' ? monthKey() : weekKey()
        const existing = await planRow(ctx, gran, periodKey)
        if (existing) {
          await ctx.db.patch(existing._id, {
            items: [...planItems(existing), { text: body, done: false }],
            content: undefined,
            updatedByKey: member.key,
            updatedAt: Date.now(),
          })
        } else {
          await ctx.db.insert('phasePlans', {
            granularity: gran,
            periodKey,
            items: [{ text: body, done: false }],
            updatedByKey: member.key,
            updatedAt: Date.now(),
          })
        }
        return `Goal added (${gran}): ${body}`
      }

      // UPDATE: /goaldone <n> [n…] toggles a goal's done flag.
      case '/goaldone': {
        const { gran, rest: body } = parseGran(rest)
        const periodKey = gran === 'month' ? monthKey() : weekKey()
        const row = await planRow(ctx, gran, periodKey)
        const items = planItems(row)
        const nums = (body.match(/\d+/g) || []).map(Number).filter((n) => n >= 1)
        if (!row || nums.length === 0) {
          return 'Usage: /goaldone <n> (numbers from /goals; add "month" for the monthly plan).'
        }
        const touched: string[] = []
        for (const n of [...new Set(nums)]) {
          if (items[n - 1]) {
            items[n - 1] = { ...items[n - 1], done: !items[n - 1].done }
            touched.push(`${items[n - 1].done ? '[x]' : '[ ]'} ${items[n - 1].text}`)
          }
        }
        if (touched.length === 0) return 'No matching goal — send /goals to check the numbers.'
        await ctx.db.patch(row._id, { items, content: undefined, updatedAt: Date.now() })
        return `Updated:\n${touched.map((t) => `- ${t}`).join('\n')}`
      }

      // DELETE: /goaldel <n> [n…]
      case '/goaldel':
      case '/delgoal': {
        const { gran, rest: body } = parseGran(rest)
        const periodKey = gran === 'month' ? monthKey() : weekKey()
        const row = await planRow(ctx, gran, periodKey)
        const items = planItems(row)
        const nums = (body.match(/\d+/g) || []).map(Number).filter((n) => n >= 1)
        if (!row || nums.length === 0) {
          return 'Usage: /goaldel <n> (numbers from /goals; add "month" for the monthly plan).'
        }
        const keep: PlanItem[] = []
        const removed: string[] = []
        const drop = new Set([...new Set(nums)].map((n) => n - 1))
        items.forEach((g, i) => (drop.has(i) ? removed.push(g.text) : keep.push(g)))
        if (removed.length === 0) return 'No matching goal — send /goals to check the numbers.'
        await ctx.db.patch(row._id, { items: keep, content: undefined, updatedAt: Date.now() })
        return `Deleted ${removed.length} goal${removed.length > 1 ? 's' : ''}:\n${removed.map((t) => `- ${t}`).join('\n')}`
      }

      case '/start':
      case '/help':
        return [
          `Hi ${member.name}! Commands:`,
          '/add <task> — add a todo to yourself',
          '/add @username <task> — assign to a teammate',
          '/add_tasks [@username] then bulleted lines — add many at once',
          '/today — your tasks (numbered)',
          '/today @username — a teammate\'s tasks',
          '/done <n> — mark your task #n done',
          '/done 1 3 5 — mark several done',
          '/done all — mark all your tasks done',
          '/delete <n> — delete task #n (or 1 3 5)',
          '/clear — remove all your done tasks',
          '',
          'Goals (team phase plan):',
          '/goals — this week\'s goals (/goals month for monthly)',
          '/goal <text> — add a goal (/goal month <text>)',
          '/goaldone <n> — tick a goal done',
          '/goaldel <n> — delete a goal',
          '',
          '/iam <name> — re-link this account (fu/tt/fred/robert)',
        ].join('\n')

      default:
        return 'Unknown command. Send /help for the list.'
    }
  },
})
