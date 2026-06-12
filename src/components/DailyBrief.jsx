import React from 'react'
import { useMutation, useQuery } from 'convex/react'
import { Icon } from './ui.jsx'

// Screen — Daily Brief. Two tabs:
//   • Tasks & Standup — phase-plan checklist, the 4-person to-do board
//     (Notion-style rows with due date + type tag), and a standup checklist
//     per teammate.
//   • Assigned Clients — allocate incoming `responses` to a salesperson.
// Everything reads/writes Convex, so Telegram-bot and other-tab edits appear
// live.

// --- Asia/Singapore date helpers (mirror convex/lib/dates.ts) ------------
const SG_OFFSET_MS = 8 * 60 * 60 * 1000
const sg = (ms) => new Date(ms + SG_OFFSET_MS)
const pad = (n) => (n < 10 ? `0${n}` : `${n}`)
function dayStr(ms) {
  const d = sg(ms)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}
function monthKey(ms) {
  const d = sg(ms)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`
}
function weekKey(ms) {
  const d = sg(ms)
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dayNum = date.getUTCDay() === 0 ? 7 : date.getUTCDay()
  date.setUTCDate(date.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${date.getUTCFullYear()}-W${pad(week)}`
}
function periodKeyFor(granularity, ms) {
  return granularity === 'week' ? weekKey(ms) : monthKey(ms)
}
function shiftPeriod(ms, granularity, dir) {
  if (granularity === 'week') return ms + dir * 7 * 86400000
  const d = sg(ms)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + dir, 15) - SG_OFFSET_MS
}
function prettyDay(day) {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-SG', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}
function dueChip(due) {
  if (!due) return ''
  const [y, m, d] = due.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-SG', {
    day: 'numeric',
    month: 'short',
  })
}

const STATUSES = ['todo', 'doing', 'done', 'blocked']
const STATUS_META = {
  todo: { label: 'To-do', tone: 'grey' },
  doing: { label: 'Doing', tone: 'orange' },
  done: { label: 'Done', tone: 'green' },
  blocked: { label: 'Blocked', tone: 'red' },
}
const TASK_TYPES = ['Work', 'Meeting', 'Personal', 'Admin', 'Follow-up']
const TYPE_TONE = {
  Work: 'navy',
  Meeting: 'orange',
  Personal: 'green',
  Admin: 'grey',
  'Follow-up': 'red',
}

export default function DailyBrief({ toast }) {
  const members = useQuery('team:list') ?? []
  const seed = useMutation('team:seed')
  const [tab, setTab] = React.useState('tasks')

  const [dayMs, setDayMs] = React.useState(() => Date.now())
  const day = dayStr(dayMs)
  const isToday = day === dayStr(Date.now())

  const board = useQuery('dailyBrief:boardForDay', { day }) ?? { day, byAssignee: {} }

  const addTask = useMutation('dailyBrief:addTask')
  const setTaskStatus = useMutation('dailyBrief:setTaskStatus')
  const updateTask = useMutation('dailyBrief:updateTask')
  const removeTask = useMutation('dailyBrief:removeTask')
  const markAllDone = useMutation('dailyBrief:markAllDone')

  async function run(fn, ok) {
    try {
      await fn()
      if (ok) toast?.(ok)
    } catch (err) {
      toast?.(`Could not save — ${err?.message || 'try again'}.`)
    }
  }

  const needsSeed = members.length === 0

  return (
    <div className="brief-screen">
      <div className="page-header">
        <div>
          <div className="eyebrow">Daily brief</div>
          <h1 className="page-title">Team daily brief</h1>
          <p className="page-sub">
            Today's tasks per teammate, plus who's answering which customer. Updates from the
            Telegram bot show up here live.
          </p>
        </div>
        {tab === 'tasks' && (
          <div className="brief-daynav">
            <button className="btn btn-ghost btn-sm" onClick={() => setDayMs((m) => m - 86400000)}>
              ‹ Prev
            </button>
            <span className="brief-day-label">
              {prettyDay(day)}
              {isToday && <span className="brief-today-badge">Today</span>}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={() => setDayMs((m) => m + 86400000)}>
              Next ›
            </button>
            {!isToday && (
              <button className="btn btn-ghost btn-sm" onClick={() => setDayMs(Date.now())}>
                Today
              </button>
            )}
          </div>
        )}
      </div>

      <div className="brief-tabs">
        <button
          className={`brief-tab ${tab === 'tasks' ? 'on' : ''}`}
          onClick={() => setTab('tasks')}
        >
          <Icon name="list" size={15} /> Tasks
        </button>
        <button
          className={`brief-tab ${tab === 'clients' ? 'on' : ''}`}
          onClick={() => setTab('clients')}
        >
          <Icon name="mail" size={15} /> Assigned Clients
        </button>
      </div>

      {needsSeed ? (
        <div className="brief-seed">
          <p className="muted">No team members yet.</p>
          <button className="btn btn-primary" onClick={() => run(() => seed(), 'Team seeded.')}>
            <Icon name="plus" size={14} /> Seed team (Fu, Tt, Fred, Robert)
          </button>
        </div>
      ) : tab === 'tasks' ? (
        <>
          <div className="brief-rise" style={{ animationDelay: '40ms' }}>
            <PhasePlan toast={toast} dayMs={dayMs} />
          </div>

          <div className="brief-board">
            {members.map((m, i) => (
              <MemberColumn
                key={m.key}
                member={m}
                index={i}
                tasks={board.byAssignee?.[m.key] ?? []}
                onAdd={(title) =>
                  run(() => addTask({ assigneeKey: m.key, title, day, source: 'portal' }))
                }
                onStatus={(taskId, status) => run(() => setTaskStatus({ taskId, status }))}
                onUpdate={(taskId, patch) => run(() => updateTask({ taskId, ...patch }))}
                onRemove={(taskId) => run(() => removeTask({ taskId }))}
                onDoneAll={() => run(() => markAllDone({ assigneeKey: m.key, day }))}
              />
            ))}
          </div>
        </>
      ) : (
        <div className="brief-rise">
          <CustomerAllocation toast={toast} members={members} />
        </div>
      )}
    </div>
  )
}

// --- reusable tick-off checklist (standup + phase plan) ------------------
function Checklist({ items, onAdd, onToggle, onRemove, placeholder }) {
  const [draft, setDraft] = React.useState('')
  const submit = () => {
    const t = draft.trim()
    if (!t) return
    onAdd(t)
    setDraft('')
  }
  return (
    <div className="brief-checklist">
      {items.map((it, i) => (
        <div className={`brief-check-row ${it.done ? 'is-done' : ''}`} key={i}>
          <button
            type="button"
            className={`brief-check ${it.done ? 'on' : ''}`}
            onClick={() => onToggle(i)}
            aria-label={it.done ? 'mark not done' : 'mark done'}
          >
            {it.done && <Icon name="check" size={11} />}
          </button>
          <span className="brief-check-text">{it.text}</span>
          <button
            type="button"
            className="brief-row-x"
            onClick={() => onRemove(i)}
            aria-label="remove"
          >
            <Icon name="x" size={11} />
          </button>
        </div>
      ))}
      <div className="brief-check-add">
        <span className="brief-check brief-check--ghost">
          <Icon name="plus" size={11} />
        </span>
        <input
          className="brief-inline-input"
          placeholder={placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submit()
            }
          }}
        />
      </div>
    </div>
  )
}

function MemberColumn({ member, index = 0, tasks, onAdd, onStatus, onUpdate, onRemove, onDoneAll }) {
  const [draft, setDraft] = React.useState('')
  const submit = () => {
    const t = draft.trim()
    if (!t) return
    onAdd(t)
    setDraft('')
  }
  const open = tasks.filter((t) => t.status !== 'done').length
  const total = tasks.length
  const doneCount = total - open

  return (
    <div
      className={`brief-col brief-col--${member.key} brief-rise`}
      style={{ animationDelay: `${100 + index * 70}ms` }}
    >
      <div className="brief-col-head">
        <span className={`brief-avatar brief-avatar--${member.key}`} aria-hidden="true">
          {member.name.slice(0, 2)}
        </span>
        <span className="brief-col-name">{member.name}</span>
        {open > 0 ? (
          <button
            className="brief-doneall"
            onClick={onDoneAll}
            title={`Mark all ${open} done`}
          >
            <Icon name="check" size={11} /> Done all
          </button>
        ) : (
          <span className="brief-col-count">{total === 0 ? '—' : 'all done'}</span>
        )}
      </div>
      {total > 0 && (
        <div className="brief-col-bar" aria-hidden="true">
          <span style={{ width: `${(doneCount / total) * 100}%` }} />
        </div>
      )}

      <div className="brief-tasks">
        {tasks.map((t) => (
          <TaskRow key={t._id} task={t} onStatus={onStatus} onUpdate={onUpdate} onRemove={onRemove} />
        ))}
        <div className="brief-check-add">
          <span className="brief-check brief-check--ghost">
            <Icon name="plus" size={11} />
          </span>
          <input
            className="brief-inline-input"
            placeholder="Add a task…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                submit()
              }
            }}
          />
        </div>
      </div>
    </div>
  )
}

function TaskRow({ task, onStatus, onUpdate, onRemove }) {
  const done = task.status === 'done'
  const [editingDue, setEditingDue] = React.useState(false)
  const meta = STATUS_META[task.status]

  return (
    <div className={`brief-task-row brief-task-row--${meta.tone}`}>
      <div className="brief-task-main">
        <button
          type="button"
          className={`brief-check ${done ? 'on' : ''}`}
          onClick={() => onStatus(task._id, done ? 'todo' : 'done')}
          aria-label={done ? 'mark not done' : 'mark done'}
        >
          {done && <Icon name="check" size={11} />}
        </button>
        <span className={`brief-task-name ${done ? 'is-done' : ''}`}>{task.title}</span>
        <button
          type="button"
          className="brief-row-x"
          onClick={() => onRemove(task._id)}
          aria-label="delete task"
        >
          <Icon name="x" size={11} />
        </button>
      </div>

      <div className="brief-task-meta">
        {/* Due date */}
        {editingDue ? (
          <input
            type="date"
            autoFocus
            className="brief-due-input"
            defaultValue={task.dueDate || ''}
            onBlur={(e) => {
              setEditingDue(false)
              if ((e.target.value || '') !== (task.dueDate || '')) {
                onUpdate(task._id, { dueDate: e.target.value || null })
              }
            }}
          />
        ) : (
          <button className="brief-meta-chip" onClick={() => setEditingDue(true)}>
            <Icon name="list" size={11} />
            {task.dueDate ? dueChip(task.dueDate) : 'Due'}
          </button>
        )}

        {/* Type tag */}
        <select
          className={`brief-type-select ${task.type ? `brief-type--${TYPE_TONE[task.type] || 'grey'}` : ''}`}
          value={task.type || ''}
          onChange={(e) => onUpdate(task._id, { type: e.target.value || null })}
        >
          <option value="">Type</option>
          {TASK_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        {/* Status (doing / blocked beyond the checkbox) */}
        <select
          className={`brief-status-select brief-type--${meta.tone}`}
          value={task.status}
          onChange={(e) => onStatus(task._id, e.target.value)}
          title="Status"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_META[s].label}
            </option>
          ))}
        </select>

        {task.source === 'telegram' && <span className="brief-src">via Telegram</span>}
      </div>
    </div>
  )
}

function PhasePlan({ toast, dayMs }) {
  const [granularity, setGranularity] = React.useState('week')
  const [anchorMs, setAnchorMs] = React.useState(dayMs)
  const periodKey = periodKeyFor(granularity, anchorMs)

  const plan = useQuery('phasePlan:getPlan', { granularity, periodKey })
  const items = plan?.items ?? []
  const addPlanItem = useMutation('phasePlan:addPlanItem')
  const togglePlanItem = useMutation('phasePlan:togglePlanItem')
  const removePlanItem = useMutation('phasePlan:removePlanItem')

  async function run(fn) {
    try {
      await fn()
    } catch (err) {
      toast?.(`Could not save — ${err?.message || 'try again'}.`)
    }
  }

  const doneCount = items.filter((i) => i.done).length

  return (
    <div className="brief-phase">
      <div className="brief-phase-head">
        <div>
          <div className="eyebrow">Phase plan</div>
          <h2 className="brief-phase-title">
            Big-picture plan
            {items.length > 0 && (
              <span className="brief-phase-progress">
                {doneCount}/{items.length}
              </span>
            )}
          </h2>
        </div>
        <div className="brief-phase-controls">
          <div className="segment">
            {['week', 'month'].map((g) => (
              <button
                key={g}
                type="button"
                className={granularity === g ? 'on' : ''}
                onClick={() => setGranularity(g)}
              >
                {g === 'week' ? 'Week' : 'Month'}
              </button>
            ))}
          </div>
          <div className="brief-period">
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setAnchorMs((m) => shiftPeriod(m, granularity, -1))}
            >
              ‹
            </button>
            <span className="brief-period-key">{periodKey}</span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setAnchorMs((m) => shiftPeriod(m, granularity, 1))}
            >
              ›
            </button>
          </div>
        </div>
      </div>

      <Checklist
        items={items}
        onAdd={(text) => run(() => addPlanItem({ granularity, periodKey, text }))}
        onToggle={(index) => run(() => togglePlanItem({ granularity, periodKey, index }))}
        onRemove={(index) => run(() => removePlanItem({ granularity, periodKey, index }))}
        placeholder={`Add a goal for ${periodKey}…`}
      />
    </div>
  )
}

function CustomerAllocation({ toast, members }) {
  const rows = useQuery('customerAllocations:listAllocations') ?? []
  const allocate = useMutation('customerAllocations:allocate')
  const unallocate = useMutation('customerAllocations:unallocate')

  async function assign(responseId, assigneeKey) {
    try {
      await allocate({ responseId, assigneeKey })
    } catch (err) {
      toast?.(`Could not allocate — ${err?.message || 'try again'}.`)
    }
  }
  async function release(responseId) {
    try {
      await unallocate({ responseId })
    } catch (err) {
      toast?.(`Could not release — ${err?.message || 'try again'}.`)
    }
  }

  const unallocated = rows.filter((r) => !r.assigneeKey)
  const byMember = {}
  for (const m of members) byMember[m.key] = rows.filter((r) => r.assigneeKey === m.key)

  return (
    <div className="brief-alloc">
      <div className="brief-phase-head">
        <div>
          <div className="eyebrow">Customer allocation</div>
          <h2 className="brief-phase-title">Pick the customers you'll answer</h2>
        </div>
        <span className="muted small">{unallocated.length} unallocated</span>
      </div>

      <div className="brief-alloc-grid">
        <UnallocatedPool rows={unallocated} members={members} onAssign={assign} />
        {members.map((m, i) => (
          <MemberClients
            key={m.key}
            member={m}
            index={i}
            rows={byMember[m.key]}
            pool={unallocated}
            onAssign={assign}
            onRelease={release}
          />
        ))}
      </div>
    </div>
  )
}

// The shared pool of customers nobody has claimed yet. Read-only here — you
// claim from your own column. A quick per-member chip is offered as a shortcut.
function UnallocatedPool({ rows, members, onAssign }) {
  return (
    <div className="brief-alloc-col brief-alloc-col--pool">
      <div className="brief-col-head">
        <span className="brief-col-name">Unallocated</span>
        <span className="brief-col-count">{rows.length}</span>
      </div>
      <div className="brief-alloc-list">
        {rows.length === 0 ? (
          <div className="brief-empty">Everyone's claimed. Nice.</div>
        ) : (
          rows.map((r) => (
            <div className="brief-alloc-row" key={r.responseId}>
              <div className="brief-alloc-info">
                <span className="brief-alloc-name">{r.name}</span>
                <span className="muted small">
                  {r.school}
                  {r.channel ? ` · ${r.channel}` : ''}
                </span>
              </div>
              <div className="brief-claim-chips">
                {members.map((m) => (
                  <button
                    key={m.key}
                    className={`brief-claim-chip brief-claim-chip--${m.key}`}
                    onClick={() => onAssign(r.responseId, m.key)}
                    title={`Give to ${m.name}`}
                  >
                    {m.name.slice(0, 2)}
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// A teammate's own client list. They add clients to themselves from the
// unallocated pool (user-maps-client), and release any back to the pool.
function MemberClients({ member, index = 0, rows, pool, onAssign, onRelease }) {
  return (
    <div className={`brief-alloc-col brief-alloc-col--${member.key}`}>
      <div className="brief-col-head">
        <span className={`brief-avatar brief-avatar--${member.key}`} aria-hidden="true">
          {member.name.slice(0, 2)}
        </span>
        <span className="brief-col-name">{member.name}</span>
        <span className="brief-col-count">{rows.length}</span>
      </div>

      <select
        className="brief-claim-add"
        value=""
        onChange={(e) => {
          if (e.target.value) onAssign(e.target.value, member.key)
        }}
        disabled={pool.length === 0}
      >
        <option value="">
          {pool.length === 0 ? 'No unallocated customers' : `+ Add a customer (${pool.length})…`}
        </option>
        {pool.map((r) => (
          <option key={r.responseId} value={r.responseId}>
            {r.name}
            {r.school ? ` · ${r.school}` : ''}
          </option>
        ))}
      </select>

      <div className="brief-alloc-list">
        {rows.length === 0 ? (
          <div className="brief-empty">No customers yet — add from above.</div>
        ) : (
          rows.map((r) => (
            <div className="brief-alloc-row" key={r.responseId}>
              <div className="brief-alloc-info">
                <span className="brief-alloc-name">{r.name}</span>
                <span className="muted small">
                  {r.school}
                  {r.channel ? ` · ${r.channel}` : ''}
                </span>
              </div>
              <button
                className="brief-row-x"
                onClick={() => onRelease(r.responseId)}
                aria-label="release customer"
                title="Release back to unallocated"
              >
                <Icon name="x" size={12} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
