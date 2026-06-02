import React from 'react'
import { useMutation, useQuery } from 'convex/react'
import { useNavigate, useParams } from 'react-router-dom'
import { Icon, Pill } from './ui.jsx'

// Screen 5b — per-customer detail page. Reached by clicking a card on
// /customers. Lists every property as a card; the operator marks which ones
// have been sent. A "Mark sent" click handles pin+markSent in one step —
// the operator doesn't think about the assignments ledger; just sent/not.

const SCHOOLS_TO_COMMUTE_KEY = { NUS: 'NUS', NTU: 'NTU', SMU: 'SMU' }

export default function CustomerDetail({ toast, responses = [], properties = [] }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const assignments = useQuery('assignments:list', { responseId: id }) ?? []
  const pin = useMutation('assignments:pin')
  const markSent = useMutation('assignments:markSent')

  const response = responses.find((r) => r._id === id)

  const [search, setSearch] = React.useState('')
  const [hideSent, setHideSent] = React.useState(false)
  const [busyId, setBusyId] = React.useState(null)

  // Build a lookup of this customer's active assignments by propertyId.
  const activeByProp = React.useMemo(() => {
    const m = new Map()
    for (const a of assignments) {
      if (a.unpinnedAt !== undefined) continue
      m.set(a.propertyId, a)
    }
    return m
  }, [assignments])

  const decorated = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = properties
      .map((p) => {
        const a = activeByProp.get(p._id)
        const state = a ? a.status : 'idle'
        return { property: p, assignment: a, state }
      })
      .filter(({ property, state }) => {
        if (hideSent && state === 'sent') return false
        if (q && !(property.condo || '').toLowerCase().includes(q)) return false
        return true
      })
    // Sent first (so the operator sees what's done), then queued, then idle.
    // Within each, sort by condo name for predictability.
    const rank = { sent: 0, pinned: 1, idle: 2 }
    return list.sort((a, b) => {
      const r = rank[a.state] - rank[b.state]
      if (r !== 0) return r
      return (a.property.condo || '').localeCompare(b.property.condo || '')
    })
  }, [properties, activeByProp, search, hideSent])

  const counts = React.useMemo(() => {
    let sent = 0
    let queued = 0
    for (const a of assignments) {
      if (a.unpinnedAt !== undefined) continue
      if (a.status === 'sent') sent += 1
      else if (a.status === 'pinned') queued += 1
    }
    return { sent, queued, total: properties.length }
  }, [assignments, properties])

  if (!response) {
    return (
      <div>
        <BackLink onClick={() => navigate('/customers')} />
        <div className="empty" style={{ marginTop: 16 }}>
          <h4>Customer not found</h4>
          <p>This customer may have been removed. Go back to the list.</p>
        </div>
      </div>
    )
  }

  async function handleMarkSent(property, existing) {
    setBusyId(property._id)
    try {
      let assignmentId = existing?._id
      if (!assignmentId) {
        assignmentId = await pin({
          propertyId: property._id,
          responseId: response._id,
          pinnedScore: 0,
          pinnedReason: 'manual-from-customer-detail',
        })
      } else if (existing.status === 'sent') {
        return
      }
      const sentVia = response.channel || 'manual'
      await markSent({ id: assignmentId, sentVia })
      toast?.(`${property.condo} marked sent to ${response.name}.`)
    } catch (err) {
      toast?.(`Couldn't mark sent — ${err?.message || 'try again'}.`)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="customer-detail">
      <BackLink onClick={() => navigate('/customers')} />

      <CustomerHero response={response} counts={counts} />

      <div className="detail-toolbar">
        <div className="detail-toolbar-title">
          <div className="eyebrow">Mark sent</div>
          <h2 className="detail-toolbar-h">
            Properties for <span className="ink-orange">{response.name.split(' ')[0]}</span>
          </h2>
        </div>
        <div className="detail-toolbar-controls">
          <input
            className="input detail-search"
            placeholder="Search properties by condo name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <label className="detail-toggle">
            <input
              type="checkbox"
              checked={hideSent}
              onChange={(e) => setHideSent(e.target.checked)}
            />
            <span>Hide sent</span>
          </label>
        </div>
      </div>

      {properties.length === 0 ? (
        <div className="empty">
          <h4>No properties in the database</h4>
          <p>Add a property in Step 1, then come back here to mark it sent.</p>
        </div>
      ) : decorated.length === 0 ? (
        <div className="empty">
          <h4>Nothing to show</h4>
          <p>Adjust the search or turn off “Hide sent” to see all properties.</p>
        </div>
      ) : (
        <div className="detail-properties-grid">
          {decorated.map(({ property, assignment, state }) => (
            <PropertyMarkCard
              key={property._id}
              property={property}
              assignment={assignment}
              state={state}
              busy={busyId === property._id}
              schoolKey={SCHOOLS_TO_COMMUTE_KEY[response.school]}
              onMarkSent={() => handleMarkSent(property, assignment)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function BackLink({ onClick }) {
  return (
    <button type="button" className="detail-back" onClick={onClick}>
      <Icon name="arrow-right" size={12} />
      <span style={{ marginLeft: 4 }}>Back to customers</span>
    </button>
  )
}

function CustomerHero({ response: r, counts }) {
  const sourceLabel = r.source || 'manual'
  return (
    <div className="customer-hero">
      <div className="customer-hero-main">
        <div className="customer-hero-avatar" aria-hidden="true">
          {initials(r.name)}
        </div>
        <div className="customer-hero-text">
          <div className="eyebrow">Customer</div>
          <h1 className="customer-hero-name">{r.name}</h1>
          <div className="customer-hero-pills">
            <Pill kind={r.school === 'NUS' ? 'orange' : r.school === 'OTHER' ? 'grey' : 'navy'} dot>
              {r.school}
            </Pill>
            <Pill kind={sourceLabel === 'csv' ? 'navy' : sourceLabel === 'form' ? 'orange' : 'grey'}>
              {sourceLabel}
            </Pill>
            {(r.groupSize ?? 1) > 1 ? (
              <Pill kind="navy">Group of {r.groupSize}</Pill>
            ) : (
              <Pill kind="grey">Solo</Pill>
            )}
            {r.channel && (
              <span className="customer-hero-channel">
                <Icon name="mail" size={11} /> {r.channel}
                {r.contact && <span className="muted-suffix"> · {r.contact}</span>}
              </span>
            )}
          </div>
          <div className="customer-hero-facts">
            <HeroFact label="Budget">
              S${r.budget?.min ?? 0}–{r.budget?.max ?? 0}
              <span className="muted-suffix"> /mo</span>
            </HeroFact>
            <HeroFact label="Housing">
              {r.housingType || '—'}
              {r.buildingType && r.buildingType !== 'Any' && (
                <span className="muted-suffix"> · {r.buildingType}</span>
              )}
            </HeroFact>
            <HeroFact label="Move-in">{fmtDate(r.moveIn) || '—'}</HeroFact>
            <HeroFact label="Commute ≤">
              {r.commuteTolMins ? `${r.commuteTolMins} min` : '—'}
            </HeroFact>
          </div>
        </div>
      </div>
      <div className="customer-hero-counts">
        <HeroCount label="Sent" value={counts.sent} kind="sent" />
        <HeroCount label="Queued" value={counts.queued} kind="queued" />
        <HeroCount label="Properties" value={counts.total} kind="total" />
      </div>
    </div>
  )
}

function HeroFact({ label, children }) {
  return (
    <div className="hero-fact">
      <div className="fact-label">{label}</div>
      <div className="fact-val">{children}</div>
    </div>
  )
}

function HeroCount({ label, value, kind }) {
  return (
    <div className={`hero-count hero-count--${kind}`}>
      <div className="hero-count-num">{value}</div>
      <div className="hero-count-label">{label}</div>
    </div>
  )
}

function PropertyMarkCard({ property: p, assignment, state, busy, schoolKey, onMarkSent }) {
  const commute = p.commuteMins?.[schoolKey]
  const isSent = state === 'sent'
  const isQueued = state === 'pinned'
  const hero = p.images?.[0]
  const photoCount = p.images?.length || 0

  return (
    <div
      className={`prop-mark-card prop-mark-card--${state}`}
      data-property-card={p._id}
    >
      <div className="prop-mark-card-hero">
        {hero?.url ? (
          <img src={hero.url} alt={hero.name || p.condo} loading="lazy" />
        ) : p.videoUrl ? (
          <video src={p.videoUrl} preload="metadata" muted playsInline />
        ) : (
          <div className="prop-mark-card-hero-empty">
            <Icon name="photo" size={20} />
            <span>No media yet</span>
          </div>
        )}
        {photoCount > 1 && (
          <span className="prop-mark-card-hero-count">
            <Icon name="photo" size={10} /> {photoCount}
          </span>
        )}
        {isSent && (
          <span className="prop-mark-card-hero-badge prop-mark-card-hero-badge--sent">
            <Icon name="check" size={10} /> Sent
          </span>
        )}
        {isQueued && (
          <span className="prop-mark-card-hero-badge prop-mark-card-hero-badge--queued">
            Queued
          </span>
        )}
      </div>
      <div className="prop-mark-card-top">
        <div className="prop-mark-card-titles">
          <div className="prop-mark-card-condo" title={p.condo}>{p.condo}</div>
          <div className="prop-mark-card-sub">
            {[p.buildingType, p.area, p.unitType].filter(Boolean).join(' · ') || '—'}
          </div>
        </div>
      </div>

      <div className="prop-mark-card-facts">
        <div>
          <div className="fact-label">Rent</div>
          <div className="fact-val">
            {typeof p.rentSGD === 'number' ? `S$${p.rentSGD.toLocaleString()}` : '—'}
            <span className="muted-suffix"> /mo</span>
          </div>
        </div>
        <div>
          <div className="fact-label">Commute</div>
          <div className="fact-val">
            {typeof commute === 'number' ? `${commute} min` : '—'}
            {schoolKey && <span className="muted-suffix"> to {schoolKey}</span>}
          </div>
        </div>
        <div>
          <div className="fact-label">Poster</div>
          <div className="fact-val">
            {p.posterStorageId ? 'Attached' : <span className="muted">Not yet</span>}
          </div>
        </div>
      </div>

      {!isSent && (
        <button
          type="button"
          className={`prop-mark-action ${isQueued ? 'prop-mark-action--queued' : ''}`}
          onClick={onMarkSent}
          disabled={busy}
        >
          {busy ? (
            'Saving…'
          ) : (
            <>
              <Icon name="send" size={12} />
              <span>Mark sent</span>
            </>
          )}
        </button>
      )}
      {isSent && assignment?.sentAt && (
        <div className="prop-mark-sent-meta">
          Sent {fmtShortDate(assignment.sentAt)}
          {assignment.sentVia && (
            <span className="muted-suffix"> · via {assignment.sentVia}</span>
          )}
        </div>
      )}
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

function fmtShortDate(ms) {
  if (!ms) return ''
  return new Date(ms).toLocaleDateString('en-SG', { day: '2-digit', month: 'short' })
}
