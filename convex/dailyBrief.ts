// Daily Brief — per-person to-do board + standup notes for a given day.
// `day` is an Asia/Singapore 'YYYY-MM-DD' string (see lib/dates). Tasks are
// pinned to the day they were set; nothing auto-rolls to the next day.

import { mutation, query } from './_generated/server'
import { v } from 'convex/values'
import { today } from './lib/dates'
import { MEMBER_KEY } from './team'

const STATUS = v.union(
  v.literal('todo'),
  v.literal('doing'),
  v.literal('done'),
  v.literal('blocked'),
)

// All tasks for a day, grouped by assignee key. Returns a map keyed by member
// so the UI can render one column per teammate without a second query.
export const boardForDay = query({
  args: { day: v.optional(v.string()) },
  handler: async (ctx, { day }) => {
    const d = day ?? today()
    const tasks = await ctx.db
      .query('teamTasks')
      .withIndex('by_day', (q) => q.eq('day', d))
      .collect()
    // Newest first within a column.
    tasks.sort((a, b) => b.createdAt - a.createdAt)
    const byAssignee: Record<string, typeof tasks> = { fu: [], tt: [], fred: [], robert: [] }
    for (const t of tasks) {
      ;(byAssignee[t.assigneeKey] ||= []).push(t)
    }
    return { day: d, byAssignee }
  },
})

export const addTask = mutation({
  args: {
    assigneeKey: MEMBER_KEY,
    title: v.string(),
    day: v.optional(v.string()),
    dueDate: v.optional(v.string()),
    type: v.optional(v.string()),
    createdByKey: v.optional(v.string()),
    source: v.optional(v.union(v.literal('portal'), v.literal('telegram'))),
  },
  handler: async (ctx, { assigneeKey, title, day, dueDate, type, createdByKey, source }) => {
    const trimmed = title.trim()
    if (!trimmed) throw new Error('Task title is required.')
    return ctx.db.insert('teamTasks', {
      assigneeKey,
      title: trimmed,
      status: 'todo',
      day: day ?? today(),
      dueDate: dueDate || undefined,
      type: type || undefined,
      createdByKey,
      source: source ?? 'portal',
      createdAt: Date.now(),
    })
  },
})

export const setTaskStatus = mutation({
  args: { taskId: v.id('teamTasks'), status: STATUS },
  handler: async (ctx, { taskId, status }) => {
    const row = await ctx.db.get(taskId)
    if (!row) throw new Error('Task not found.')
    await ctx.db.patch(taskId, {
      status,
      doneAt: status === 'done' ? Date.now() : undefined,
    })
    return taskId
  },
})

// Mark every not-yet-done task for a teammate on a day as done. Returns the
// number of tasks changed.
export const markAllDone = mutation({
  args: { assigneeKey: MEMBER_KEY, day: v.optional(v.string()) },
  handler: async (ctx, { assigneeKey, day }) => {
    const d = day ?? today()
    const rows = await ctx.db
      .query('teamTasks')
      .withIndex('by_assignee_day', (q) => q.eq('assigneeKey', assigneeKey).eq('day', d))
      .collect()
    let changed = 0
    for (const t of rows) {
      if (t.status !== 'done') {
        await ctx.db.patch(t._id, { status: 'done', doneAt: Date.now() })
        changed += 1
      }
    }
    return changed
  },
})

// Edit a task's title, due date, or type tag in place. Pass null to clear a
// field; omit it to leave it unchanged.
export const updateTask = mutation({
  args: {
    taskId: v.id('teamTasks'),
    title: v.optional(v.string()),
    dueDate: v.optional(v.union(v.string(), v.null())),
    type: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, { taskId, title, dueDate, type }) => {
    const row = await ctx.db.get(taskId)
    if (!row) throw new Error('Task not found.')
    const patch: Record<string, unknown> = {}
    if (title !== undefined) {
      const t = title.trim()
      if (!t) throw new Error('Task title is required.')
      patch.title = t
    }
    if (dueDate !== undefined) patch.dueDate = dueDate || undefined
    if (type !== undefined) patch.type = type || undefined
    await ctx.db.patch(taskId, patch)
    return taskId
  },
})

export const removeTask = mutation({
  args: { taskId: v.id('teamTasks') },
  handler: async (ctx, { taskId }) => {
    await ctx.db.delete(taskId)
    return taskId
  },
})

// Standups were removed from the Daily Brief — the page now shows tasks only.
// The `standups` table remains in the schema (deprecated) so rows written
// before removal still validate; it can be dropped once the data is cleared.
