import React from 'react'
import { useMutation, useQuery } from 'convex/react'
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

// Screen 5 — every customer / form response laid out as a card. The
// recipient database the Recommend engine matches against, visible on its
// own page so the operator can scan who's in the funnel, filter by school
// or channel, search by name, and add walk-ins inline.
//
// Edits aren't supported in v1 — delete and re-add via the manual modal.

const SCHOOL_FILTERS = ['All', 'NUS', 'NTU', 'SMU', 'OTHER']
const SOURCE_FILTERS = ['All', 'csv', 'manual', 'form']

export default function CustomersScreen({ toast, responses }) {
  const addResponse = useMutation('responses:add')
  const removeResponse = useMutation('responses:remove')
  const assignments = useQuery('assignments:list', {}) ?? []
  const [showAdd, setShowAdd] = React.useState(false)
  const [school, setSchool] = React.useState('All')
  const [source, setSource] = React.useState('All')
  const [search, setSearch] = React.useState('')

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    return responses.filter((r) => {
      if (school !== 'All' && r.school !== school) return false
      if (source !== 'All' && (r.source || 'manual') !== source) return false
      if (q && !`${r.name} ${r.contact}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [responses, school, source, search])

  const counts = {
    total: responses.length,
    NUS: responses.filter((r) => r.school === 'NUS').length,
    NTU: responses.filter((r) => r.school === 'NTU').length,
    SMU: responses.filter((r) => r.school === 'SMU').length,
    OTHER: responses.filter((r) => r.school === 'OTHER').length,
  }

  async function handleDelete(r) {
    if (!confirm(`Remove ${r.name} from the customer database?`)) return
    await removeResponse({ id: r._id })
    toast?.(`Removed ${r.name}.`)
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="eyebrow">Step 5 · People</div>
          <h1 className="page-title">Customers</h1>
          <p className="page-sub">
            Everyone the portal can match a property to — laid out so you can scan, filter, and add walk-ins inline.
            Each card carries the budget, school, housing preference, and any notes the form picked up.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
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
          <p>Adjust the school / source / search above.</p>
        </div>
      ) : (
        <div className="customers-grid">
          {filtered.map((r) => (
            <CustomerCard
              key={r._id}
              response={r}
              engagement={engagementFor(r._id, assignments)}
              onDelete={() => handleDelete(r)}
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
    </div>
  )
}

function EngagementChip({ engagement }) {
  if (!engagement) return null
  const { pinnedCount, sentCount, latestAt } = engagement
  if (pinnedCount === 0 && sentCount === 0) {
    return <div className="engagement-chip engagement-chip--empty">no engagement yet</div>
  }
  const parts = []
  if (pinnedCount > 0) parts.push(`${pinnedCount} pinned`)
  if (sentCount > 0) parts.push(`${sentCount} sent`)
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
  // Prefer Chinese first character if the name starts Chinese; otherwise initials.
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

function CustomerCard({ response: r, engagement, onDelete }) {
  const ext = r.extras || {}
  const flags = []
  if (ext.petFriendly) flags.push('pet')
  if (ext.cookingAllowed) flags.push('cooks')
  if (ext.quiet) flags.push('quiet')
  if (ext.nearGym) flags.push('gym')
  const sourceLabel = r.source || 'manual'
  const sourceKind = sourceLabel === 'csv' ? 'navy' : sourceLabel === 'form' ? 'orange' : 'grey'

  return (
    <div className="customer-card">
      <div className="customer-card-head">
        <div className="customer-avatar" aria-hidden="true">{initials(r.name)}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="customer-name" title={r.name}>{r.name}</div>
          <div className="customer-meta">
            <Pill kind={r.school === 'NUS' ? 'orange' : r.school === 'OTHER' ? 'grey' : 'navy'} dot>
              {r.school}
            </Pill>
            <Pill kind={sourceKind}>{sourceLabel}</Pill>
          </div>
        </div>
        <button
          type="button"
          className="customer-card-del"
          onClick={onDelete}
          aria-label={`Remove ${r.name}`}
          title="Remove from database"
        >
          <Icon name="trash" size={14} />
        </button>
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

      {(r.unitLayout?.length > 0 || flags.length > 0 || r.wantRoommate) && (
        <div className="customer-tags">
          {r.unitLayout?.map((l) => (
            <span key={l} className="chip-mini chip-mini--layout">{l}</span>
          ))}
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
        {r.createdAt && (
          <span style={{ marginLeft: 'auto' }}>
            Added {fmtDate(r.createdAt)}
          </span>
        )}
      </div>
    </div>
  )
}
