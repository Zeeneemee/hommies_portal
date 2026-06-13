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
//
// Unknown senders (Telegram user id not in teamMembers) are ignored.

import { internalMutation } from './_generated/server'
import { v } from 'convex/values'
import { today } from './lib/dates'
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

// Returns the reply text, or null to stay silent (unknown sender). All db
// writes happen here so the webhook can be a thin parse-and-reply shell.
export const handleCommand = internalMutation({
  args: {
    fromUserId: v.number(),
    text: v.string(),
  },
  handler: async (ctx, { fromUserId, text }): Promise<string | null> => {
    const member = await memberByTelegramUserId(ctx, fromUserId)
    if (!member) return null // ignore unrecognised senders — no write, no reply

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
        ].join('\n')

      default:
        return 'Unknown command. Send /help for the list.'
    }
  },
})
