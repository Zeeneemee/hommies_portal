import React from 'react'
import { useMutation, useQuery } from 'convex/react'
import { useNavigate } from 'react-router-dom'
import { Icon, Pill } from './ui.jsx'
import ManualResponseForm from './ManualResponseModal.jsx'

// Summarise a client's assignment history into counts + recency. Tombstones
// (unpinnedAt set) are excluded — they belong in audit, not in the chip.
export function engagementFor(responseId, assignments) {
  let pinnedCount = 0
  let sentCount = 0
  let latestAt = 0
  for (const a of assignments || []) {
    if (a.responseId !== responseId) continue
    if (a.unpinnedAt !== undefined) continue
    if (a.status === 'pinned') pinnedCount += 1
    else if (a.status === 'sent') sentCount += 1
    const at = Math.max(a.pinnedAt || 0, a.sentAt || 0)
    if (at > latestAt) latestAt = at
  }
  return { pinnedCount, sentCount, latestAt }
}

function relativeTime(ms) {
  if (!ms) return ''
  const diff = Date.now() - ms
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const d = Math.floor(hr / 24)
  if (d < 14) return `${d}d ago`
  return new Date(ms).toLocaleDateString('en-SG', { month: 'short', day: 'numeric' })
}

// Screen 5 — every customer / form response laid out as a card. Click a
// card to open the per-customer detail page (`/customers/:id`) where the
// operator marks which properties have been sent to that customer.

const SCHOOL_FILTERS = ['All', 'NUS', 'NTU', 'SMU', 'OTHER']
const SOURCE_FILTERS = ['All', 'csv', 'manual', 'form']
const ROOMMATE_OPTIONS = [
  { key: 'all', label: 'Any' },
  { key: 'wants', label: 'Wants roommate' },
  { key: 'group', label: 'Has group' },
  { key: 'solo', label: 'Solo' },
]
const BUDGET_TIERS = [
  { key: 'all', label: 'Any' },
  { key: 'le800', label: '≤ $800', max: 800 },
  { key: 'le1200', label: '≤ $1.2k', max: 1200 },
  { key: 'le1500', label: '≤ $1.5k', max: 1500 },
  { key: 'le2000', label: '≤ $2k', max: 2000 },
  { key: 'gt2000', label: '$2k+', min: 2000 },
]
const COMMUTE_TIERS = [
  { key: 'all', label: 'Any' },
  { key: 'le30', label: '≤ 30m', max: 30 },
  { key: 'le45', label: '≤ 45m', max: 45 },
  { key: 'le60', label: '≤ 60m', max: 60 },
]

function parseDateMs(v) {
  if (!v) return null
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}

export default function CustomersScreen({ toast, responses, properties = [] }) {
  const navigate = useNavigate()
  const addResponse = useMutation('responses:add')
  const removeResponse = useMutation('responses:remove')
  const updateResponse = useMutation('responses:update')
  const assignments = useQuery('assignments:list', {}) ?? []
  const [showAdd, setShowAdd] = React.useState(false)
  const [editingId, setEditingId] = React.useState(null)
  const editing = editingId ? responses.find((r) => r._id === editingId) : null
  const [school, setSchool] = React.useState('All')
  const [source, setSource] = React.useState('All')
  const [search, setSearch] = React.useState('')
  const [budgetTier, setBudgetTier] = React.useState('all')
  const [commuteTier, setCommuteTier] = React.useState('all')
  const [roommate, setRoommate] = React.useState('all')
  const [moveFrom, setMoveFrom] = React.useState('')
  const [moveTo, setMoveTo] = React.useState('')

  const refineActiveCount =
    (budgetTier !== 'all' ? 1 : 0) +
    (commuteTier !== 'all' ? 1 : 0) +
    (roommate !== 'all' ? 1 : 0) +
    (moveFrom || moveTo ? 1 : 0)

  function resetRefine() {
    setBudgetTier('all')
    setCommuteTier('all')
    setRoommate('all')
    setMoveFrom('')
    setMoveTo('')
  }

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    const budget = BUDGET_TIERS.find((b) => b.key === budgetTier)
    const commute = COMMUTE_TIERS.find((c) => c.key === commuteTier)
    const moveFromMs = parseDateMs(moveFrom)
    const moveToMs = parseDateMs(moveTo)
    return responses.filter((r) => {
      if (school !== 'All' && r.school !== school) return false
      if (source !== 'All' && (r.source || 'manual') !== source) return false
      if (q && !`${r.name} ${r.contact}`.toLowerCase().includes(q)) return false

      if (budget && budgetTier !== 'all') {
        const rmax = r.budget?.max ?? null
        if (rmax == null) return false
        if (budget.max != null && rmax > budget.max) return false
        if (budget.min != null && rmax <= budget.min) return false
      }

      if (commute && commuteTier !== 'all') {
        const c = r.commuteTolMins
        if (c == null) return false
        if (commute.max != null && c > commute.max) return false
      }

      if (roommate !== 'all') {
        const gs = r.groupSize ?? 1
        const wants = !!r.wantRoommate
        if (roommate === 'wants' && !wants) return false
        if (roommate === 'group' && gs <= 1) return false
        if (roommate === 'solo' && (wants || gs > 1)) return false
      }

      if (moveFromMs != null || moveToMs != null) {
        const ms = parseDateMs(r.moveIn)
        if (ms == null) return false
        if (moveFromMs != null && ms < moveFromMs) return false
        if (moveToMs != null && ms > moveToMs) return false
      }

      return true
    })
  }, [responses, school, source, search, budgetTier, commuteTier, roommate, moveFrom, moveTo])

  const counts = {
    total: responses.length,
    NUS: responses.filter((r) => r.school === 'NUS').length,
    NTU: responses.filter((r) => r.school === 'NTU').length,
    SMU: responses.filter((r) => r.school === 'SMU').length,
    OTHER: responses.filter((r) => r.school === 'OTHER').length,
  }

  // Portal-wide queued / sent totals (excluding tombstones).
  const { inFlightTotal, sentTotal, queuedByResponseId } = React.useMemo(() => {
    let q = 0
    let s = 0
    const byResp = new Map()
    for (const a of assignments) {
      if (a.unpinnedAt !== undefined) continue
      if (a.status === 'pinned') {
        q += 1
        byResp.set(a.responseId, (byResp.get(a.responseId) || 0) + 1)
      } else if (a.status === 'sent') {
        s += 1
      }
    }
    return { inFlightTotal: q, sentTotal: s, queuedByResponseId: byResp }
  }, [assignments])

  async function handleDelete(r, e) {
    e.stopPropagation()
    if (!confirm(`Remove ${r.name} from the customer database?`)) return
    await removeResponse({ id: r._id })
    toast?.(`Removed ${r.name}.`)
  }

  function scrollToFirstInFlight() {
    for (const r of filtered) {
      if ((queuedByResponseId.get(r._id) || 0) > 0) {
        const el = document.querySelector(`[data-customer-card="${r._id}"]`)
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' })
          return
        }
      }
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Customers</h1>
          <p className="page-sub">
            Everyone the portal can match a property to. Click a card to open the customer's page and mark which
            properties have been sent.
          </p>
        </div>
        <div className="customers-header-side">
          <div className="page-header-totals" role="group" aria-label="Portal-wide assignment totals">
            <button
              type="button"
              className="header-total header-total--inflight"
              onClick={scrollToFirstInFlight}
              title="Jump to the next customer with queued properties"
            >
              <span className="header-total-label">In flight</span>
              <span className="header-total-num">{inFlightTotal}</span>
            </button>
            <button
              type="button"
              className="header-total header-total--sent"
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              title="Scroll to top"
            >
              <span className="header-total-label">Sent</span>
              <span className="header-total-num">{sentTotal}</span>
            </button>
          </div>
          <button className="btn btn-nav-secondary" onClick={() => setShowAdd(true)}>
            <Icon name="plus" size={14} /> Add customer
          </button>
        </div>
      </div>

      <div className="customer-stats">
        <Stat label="Total customers" value={counts.total} />
        <Stat label="NUS" value={counts.NUS} accent="orange" />
        <Stat label="NTU" value={counts.NTU} />
        <Stat label="SMU" value={counts.SMU} />
        <Stat label="Other / Unknown" value={counts.OTHER} muted />
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-pad" style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center' }}>
          <div className="filter-chips">
            {SCHOOL_FILTERS.map((s) => (
              <button
                key={s}
                type="button"
                className={`filter-chip ${school === s ? 'on' : ''}`}
                onClick={() => setSchool(s)}
              >
                {s} ({s === 'All' ? counts.total : counts[s] ?? 0})
              </button>
            ))}
          </div>
          <div className="filter-chips" style={{ marginLeft: 'auto' }}>
            {SOURCE_FILTERS.map((s) => (
              <button
                key={s}
                type="button"
                className={`filter-chip ${source === s ? 'on' : ''}`}
                onClick={() => setSource(s)}
              >
                {s === 'All' ? 'Any source' : s}
              </button>
            ))}
          </div>
        </div>
        <div className="card-pad" style={{ paddingTop: 0 }}>
          <input
            className="input"
            placeholder="Search by name or contact handle…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="card-pad customer-refine" style={{ paddingTop: 0 }}>
          <RefineGroup label="Budget">
            {BUDGET_TIERS.map((b) => (
              <button
                key={b.key}
                type="button"
                className={`filter-chip ${budgetTier === b.key ? 'on' : ''}`}
                onClick={() => setBudgetTier(b.key)}
              >
                {b.label}
              </button>
            ))}
          </RefineGroup>
          <RefineGroup label="Commute">
            {COMMUTE_TIERS.map((c) => (
              <button
                key={c.key}
                type="button"
                className={`filter-chip ${commuteTier === c.key ? 'on' : ''}`}
                onClick={() => setCommuteTier(c.key)}
              >
                {c.label}
              </button>
            ))}
          </RefineGroup>
          <RefineGroup label="Roommate">
            {ROOMMATE_OPTIONS.map((o) => (
              <button
                key={o.key}
                type="button"
                className={`filter-chip ${roommate === o.key ? 'on' : ''}`}
                onClick={() => setRoommate(o.key)}
              >
                {o.label}
              </button>
            ))}
          </RefineGroup>
          <RefineGroup label="Move-in">
            <input
              type="date"
              className="input input-sm"
              value={moveFrom}
              onChange={(e) => setMoveFrom(e.target.value)}
              aria-label="Move-in from"
            />
            <span className="muted-suffix">→</span>
            <input
              type="date"
              className="input input-sm"
              value={moveTo}
              onChange={(e) => setMoveTo(e.target.value)}
              aria-label="Move-in to"
            />
          </RefineGroup>
          {refineActiveCount > 0 && (
            <button type="button" className="btn-link customer-refine-reset" onClick={resetRefine}>
              Clear refine ({refineActiveCount})
            </button>
          )}
        </div>
      </div>

      {responses.length === 0 ? (
        <div className="empty">
          <h4>No customers yet</h4>
          <p>
            Import a Google Form CSV from the Recommend screen, or add a walk-in here. Each saved customer becomes
            matchable against every property.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty">
          <h4>No customers match these filters</h4>
          <p>Adjust the filters above or clear the refine panel.</p>
        </div>
      ) : (
        <div className="customers-grid">
          {filtered.map((r) => (
            <CustomerCard
              key={r._id}
              response={r}
              engagement={engagementFor(r._id, assignments)}
              onOpen={() => navigate(`/customers/${r._id}`)}
              onEdit={(e) => {
                e.stopPropagation()
                setEditingId(r._id)
              }}
              onDelete={(e) => handleDelete(r, e)}
            />
          ))}
        </div>
      )}

      {showAdd && (
        <ManualResponseForm
          onClose={() => setShowAdd(false)}
          onSave={async (r) => {
            await addResponse(r)
            toast?.(`${r.name} added.`)
            setShowAdd(false)
          }}
        />
      )}

      {editing && (
        <ManualResponseForm
          initialValue={editing}
          onClose={() => setEditingId(null)}
          onSave={async (patch) => {
            try {
              await updateResponse({ id: editing._id, patch })
              toast?.(`${patch.name} updated.`)
              setEditingId(null)
            } catch (err) {
              toast?.(`Update failed: ${err.message || err}`)
            }
          }}
        />
      )}
    </div>
  )
}

function RefineGroup({ label, children }) {
  return (
    <div className="customer-refine-group">
      <div className="customer-refine-label">{label}</div>
      <div className="filter-chips customer-refine-chips">{children}</div>
    </div>
  )
}

function EngagementChip({ engagement }) {
  if (!engagement) return null
  const { pinnedCount, sentCount, latestAt } = engagement
  if (pinnedCount === 0 && sentCount === 0) {
    return <div className="engagement-chip engagement-chip--empty">no properties tracked yet</div>
  }
  const parts = []
  if (sentCount > 0) parts.push(`${sentCount} sent`)
  if (pinnedCount > 0) parts.push(`${pinnedCount} queued`)
  if (latestAt) parts.push(`latest ${relativeTime(latestAt)}`)
  return <div className="engagement-chip">{parts.join(' · ')}</div>
}

function Stat({ label, value, accent, muted }) {
  return (
    <div className={`customer-stat ${accent === 'orange' ? 'customer-stat--orange' : ''} ${muted ? 'customer-stat--muted' : ''}`}>
      <div className="customer-stat-num">{value}</div>
      <div className="customer-stat-label">{label}</div>
    </div>
  )
}

function initials(name) {
  const parts = String(name || '?')
    .split(/[\s/、]+/)
    .filter(Boolean)
  if (parts.length === 0) return '?'
  if (/[一-鿿]/.test(parts[0][0])) return parts[0][0]
  return parts
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase()
}

function fmtDate(d) {
  if (!d) return null
  const t = new Date(d).getTime()
  if (!Number.isFinite(t)) return d
  return new Date(t).toLocaleDateString('en-SG', { year: 'numeric', month: 'short', day: 'numeric' })
}

function CustomerCard({ response: r, engagement, onOpen, onEdit, onDelete }) {
  const ext = r.extras || {}
  const flags = []
  if (ext.petFriendly) flags.push('pet')
  if (ext.cookingAllowed) flags.push('cooks')
  if (ext.quiet) flags.push('quiet')
  if (ext.nearGym) flags.push('gym')
  const sourceLabel = r.source || 'manual'
  const sourceKind = sourceLabel === 'csv' ? 'navy' : sourceLabel === 'form' ? 'orange' : 'grey'

  function handleKey(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onOpen()
    }
  }

  return (
    <div
      className="customer-card customer-card--clickable"
      data-customer-card={r._id}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={handleKey}
      aria-label={`Open ${r.name}`}
    >
      <div className="customer-card-head">
        <div className="customer-avatar" aria-hidden="true">{initials(r.name)}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="customer-name" title={r.name}>{r.name}</div>
          <div className="customer-meta">
            <Pill kind={r.school === 'NUS' ? 'orange' : r.school === 'OTHER' ? 'grey' : 'navy'} dot>
              {r.school}
            </Pill>
            {r.gender && <Pill kind="grey">{r.gender}</Pill>}
            <Pill kind={sourceKind}>{sourceLabel}</Pill>
          </div>
        </div>
        <div className="customer-card-actions" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="customer-card-icon-btn"
            onClick={onEdit}
            aria-label={`Edit ${r.name}`}
            title="Edit customer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
            </svg>
          </button>
          <button
            type="button"
            className="customer-card-icon-btn customer-card-del"
            onClick={onDelete}
            aria-label={`Remove ${r.name}`}
            title="Remove from database"
          >
            <Icon name="trash" size={14} />
          </button>
        </div>
      </div>

      <div className="customer-channel">
        <Icon name="mail" size={12} />
        <span className="customer-channel-name">{r.channel || '—'}</span>
        {r.contact && <span className="customer-channel-handle">{r.contact}</span>}
      </div>

      <EngagementChip engagement={engagement} />

      <div className="customer-facts">
        <div>
          <div className="fact-label">Budget</div>
          <div className="fact-val">
            S${r.budget?.min ?? 0}–{r.budget?.max ?? 0}
            <span className="muted-suffix"> /mo</span>
          </div>
        </div>
        <div>
          <div className="fact-label">Housing</div>
          <div className="fact-val">
            {r.housingType || '—'}
            {r.buildingType && r.buildingType !== 'Any' && (
              <span className="muted-suffix"> · {r.buildingType}</span>
            )}
          </div>
        </div>
        <div>
          <div className="fact-label">Move-in</div>
          <div className="fact-val">{fmtDate(r.moveIn) || '—'}</div>
        </div>
        <div>
          <div className="fact-label">Commute ≤</div>
          <div className="fact-val">{r.commuteTolMins ? `${r.commuteTolMins} min` : '—'}</div>
        </div>
      </div>

      {(r.unitLayout?.length > 0 || flags.length > 0 || r.wantRoommate || (r.groupSize ?? 1) > 1) && (
        <div className="customer-tags">
          {r.unitLayout?.map((l) => (
            <span key={l} className="chip-mini chip-mini--layout">{l}</span>
          ))}
          {(r.groupSize ?? 1) > 1 && (
            <span className="chip-mini chip-mini--group">+{r.groupSize - 1} roommates</span>
          )}
          {r.wantRoommate && <span className="chip-mini chip-mini--flag">wants roommate</span>}
          {flags.map((f) => (
            <span key={f} className="chip-mini chip-mini--flag">{f}</span>
          ))}
        </div>
      )}

      {ext.note && (
        <div className="customer-note" title={ext.note}>
          “{ext.note}”
        </div>
      )}

      <div className="customer-foot">
        {r.leaseLength && <span>{r.leaseLength} lease</span>}
        <span className="customer-card-open-hint">
          Open <Icon name="arrow-right" size={12} />
        </span>
      </div>
    </div>
  )
}
