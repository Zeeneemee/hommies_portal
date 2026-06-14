import React from 'react'
import { useMutation, useQuery } from 'convex/react'
import { useNavigate, useParams } from 'react-router-dom'
import { Icon, Pill } from './ui.jsx'
import ManualResponseModal from './ManualResponseModal.jsx'
import ListingPreviewModal from './ListingPreviewModal.jsx'

// Screen 5b — per-customer detail page. Reached by clicking a card on
// /customers. Lists every property as a card; the operator marks which ones
// have been sent. A "Mark sent" click handles pin+markSent in one step —
// the operator doesn't think about the assignments ledger; just sent/not.

const SCHOOLS_TO_COMMUTE_KEY = { NUS: 'NUS', NTU: 'NTU', SMU: 'SMU' }

export default function CustomerDetail({ toast, responses = [], properties = [] }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const assignments = useQuery('assignments:list', { responseId: id }) ?? []
  const deals = useQuery('deals:byResponse', { responseId: id }) ?? []
  const pin = useMutation('assignments:pin')
  const markSent = useMutation('assignments:markSent')
  const undoSent = useMutation('assignments:undoSent')
  const startDeal = useMutation('deals:start')
  const advanceDeal = useMutation('deals:advance')
  const cancelDeal = useMutation('deals:cancel')
  const setFinalRent = useMutation('deals:setFinalRent')
  const updateResponse = useMutation('responses:update')

  const response = responses.find((r) => r._id === id)

  const [search, setSearch] = React.useState('')
  const [hideSent, setHideSent] = React.useState(false)
  const [busyId, setBusyId] = React.useState(null)
  const [editingCustomer, setEditingCustomer] = React.useState(false)
  // Read-only listing preview opened from a property card on this page.
  const [previewProperty, setPreviewProperty] = React.useState(null)

  // Build a lookup of this customer's active assignments by propertyId.
  const activeByProp = React.useMemo(() => {
    const m = new Map()
    for (const a of assignments) {
      if (a.unpinnedAt !== undefined) continue
      m.set(a.propertyId, a)
    }
    return m
  }, [assignments])

  // Active deal lookup by propertyId — a moved-in deal overrides 'sent';
  // any other active stage decorates the row as 'deal'.
  const dealByProp = React.useMemo(() => {
    const m = new Map()
    for (const d of deals) {
      if (d.cancelledAt !== undefined) continue
      m.set(d.propertyId, d)
    }
    return m
  }, [deals])

  const decorated = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = properties
      .map((p) => {
        const deal = dealByProp.get(p._id)
        const a = activeByProp.get(p._id)
        let state = 'idle'
        if (deal?.stage === 'moved_in') state = 'closed'
        else if (deal) state = 'deal'
        else if (a) state = a.status
        return { property: p, assignment: a, deal, state }
      })
      .filter(({ property, state }) => {
        if (hideSent && (state === 'sent' || state === 'closed' || state === 'deal')) return false
        if (q && !(property.condo || '').toLowerCase().includes(q)) return false
        return true
      })
    // Closed first (the win), then in-deal, sent, queued, idle.
    const rank = { closed: -1, deal: 0, sent: 1, pinned: 2, idle: 3 }
    return list.sort((a, b) => {
      const r = rank[a.state] - rank[b.state]
      if (r !== 0) return r
      return (a.property.condo || '').localeCompare(b.property.condo || '')
    })
  }, [properties, activeByProp, dealByProp, search, hideSent])

  const counts = React.useMemo(() => {
    let sent = 0
    let queued = 0
    for (const a of assignments) {
      if (a.unpinnedAt !== undefined) continue
      if (a.status === 'sent') sent += 1
      else if (a.status === 'pinned') queued += 1
    }
    let closed = 0
    for (const d of dealByProp.values()) if (d.stage === 'moved_in') closed += 1
    return { sent, queued, closed, total: properties.length }
  }, [assignments, dealByProp, properties])

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

  async function handleCloseSale(property, finalRentSGD) {
    setBusyId(property._id)
    try {
      // Start (or reuse) the deal and skip straight to moved_in. Final rent
      // is stamped separately so the operator can capture it at close-time.
      const existingDeal = dealByProp.get(property._id)
      let dealId = existingDeal?._id
      if (!dealId) {
        dealId = await startDeal({
          responseId: response._id,
          propertyId: property._id,
        })
      }
      if (existingDeal?.stage !== 'moved_in') {
        await advanceDeal({ id: dealId, to: 'moved_in' })
      }
      if (Number.isFinite(finalRentSGD)) {
        await setFinalRent({ id: dealId, finalRentSGD })
      }
      toast?.(`Closed — ${property.condo} → ${response.name}.`)
    } catch (err) {
      toast?.(`Couldn't close — ${err?.message || 'try again'}.`)
    } finally {
      setBusyId(null)
    }
  }

  async function handleUndoSent(property, existing) {
    if (!existing?._id) return
    setBusyId(property._id)
    try {
      await undoSent({ id: existing._id })
      toast?.(`${property.condo} reverted to queued.`)
    } catch (err) {
      toast?.(`Couldn't undo sent — ${err?.message || 'try again'}.`)
    } finally {
      setBusyId(null)
    }
  }

  async function handleUnclose(deal, property) {
    setBusyId(property._id)
    try {
      // Backward stage transitions aren't allowed; cancel the moved-in deal
      // instead. The customer drops back to Sent in the pipeline.
      await cancelDeal({ id: deal._id })
      toast?.(`Cancelled — ${property.condo} is back to sent.`)
    } catch (err) {
      toast?.(`Couldn't cancel — ${err?.message || 'try again'}.`)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="customer-detail">
      <BackLink onClick={() => navigate('/customers')} />

      <CustomerHero
        response={response}
        counts={counts}
        onEdit={() => setEditingCustomer(true)}
      />

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
          {decorated.map(({ property, assignment, deal, state }) => (
            <PropertyMarkCard
              key={property._id}
              property={property}
              assignment={assignment}
              deal={deal}
              state={state}
              busy={busyId === property._id}
              schoolKey={SCHOOLS_TO_COMMUTE_KEY[response.school]}
              onMarkSent={() => handleMarkSent(property, assignment)}
              onUndoSent={() => handleUndoSent(property, assignment)}
              onCloseSale={(rent) => handleCloseSale(property, rent)}
              onUnclose={() => deal && handleUnclose(deal, property)}
              onPreview={() => setPreviewProperty(property)}
            />
          ))}
        </div>
      )}

      {editingCustomer && (
        <ManualResponseModal
          initialValue={response}
          onClose={() => setEditingCustomer(false)}
          onSave={async (patch) => {
            try {
              await updateResponse({ id: response._id, patch })
              toast?.(`${patch.name} updated.`)
              setEditingCustomer(false)
            } catch (err) {
              toast?.(`Update failed: ${err.message || err}`)
            }
          }}
        />
      )}

      {previewProperty && (
        <ListingPreviewModal property={previewProperty} onClose={() => setPreviewProperty(null)} />
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

function CustomerHero({ response: r, counts, onEdit }) {
  const sourceLabel = r.source || 'manual'
  return (
    <div className="customer-hero">
      <div className="customer-hero-main">
        <div className="customer-hero-avatar" aria-hidden="true">
          {initials(r.name)}
        </div>
        <div className="customer-hero-text">
          <div className="customer-hero-eyebrow-row">
            <div className="eyebrow">Customer</div>
            {onEdit && (
              <button
                type="button"
                className="customer-hero-edit"
                onClick={onEdit}
                aria-label={`Edit ${r.name}`}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                </svg>
                <span>Edit</span>
              </button>
            )}
          </div>
          <h1 className="customer-hero-name">{r.name}</h1>
          <div className="customer-hero-pills">
            <Pill kind={r.school === 'NUS' ? 'orange' : r.school === 'OTHER' ? 'grey' : 'navy'} dot>
              {r.school}
            </Pill>
            {r.gender && <Pill kind="grey">{r.gender}</Pill>}
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
        <HeroCount label="Closed" value={counts.closed} kind="closed" />
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

function PropertyMarkCard({ property: p, assignment, deal, state, busy, schoolKey, onMarkSent, onUndoSent, onCloseSale, onUnclose, onPreview }) {
  const commute = p.commuteMins?.[schoolKey]
  const isSent = state === 'sent'
  const isQueued = state === 'pinned'
  const isClosed = state === 'closed'
  const isInDeal = state === 'deal'
  const DEAL_LABELS = { loi_sent: 'LOI sent', loi_signed: 'LOI signed', ta_issued: 'TA issued' }
  const hero = p.images?.[0]
  const photoCount = p.images?.length || 0
  const [showCloseForm, setShowCloseForm] = React.useState(false)
  const [rentDraft, setRentDraft] = React.useState(
    typeof p.rentSGD === 'number' ? String(p.rentSGD) : '',
  )

  function submitClose(e) {
    e?.preventDefault?.()
    const parsed = Number(rentDraft)
    onCloseSale?.(Number.isFinite(parsed) && parsed > 0 ? parsed : undefined)
    setShowCloseForm(false)
  }

  return (
    <div
      className={`prop-mark-card prop-mark-card--${state}`}
      data-property-card={p._id}
    >
      <div
        className="prop-mark-card-hero"
        onClick={onPreview}
        role={onPreview ? 'button' : undefined}
        tabIndex={onPreview ? 0 : undefined}
        onKeyDown={onPreview ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPreview() } } : undefined}
        title={onPreview ? 'View listing details' : undefined}
        style={onPreview ? { cursor: 'pointer' } : undefined}
      >
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
        {isClosed && (
          <span className="prop-mark-card-hero-badge prop-mark-card-hero-badge--closed">
            <Icon name="check" size={10} /> Closed
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
        {isInDeal && deal && (
          <span className="prop-mark-card-hero-badge prop-mark-card-hero-badge--sent">
            <Icon name="send" size={10} /> {DEAL_LABELS[deal.stage] || deal.stage}
          </span>
        )}
      </div>
      <div className="prop-mark-card-top">
        <div className="prop-mark-card-titles">
          {onPreview ? (
            <button
              type="button"
              className="prop-mark-card-condo prop-mark-card-condo--link"
              title={`View ${p.condo} listing`}
              onClick={onPreview}
            >
              {p.condo}
            </button>
          ) : (
            <div className="prop-mark-card-condo" title={p.condo}>{p.condo}</div>
          )}
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

      {!isSent && !isClosed && !isInDeal && (
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
      {isInDeal && deal && (
        <div className="prop-mark-sent-meta">
          <span>
            Deal at {DEAL_LABELS[deal.stage] || deal.stage} — advance from{' '}
            <strong>Pipeline</strong>.
          </span>
        </div>
      )}
      {isSent && !showCloseForm && (
        <div className="prop-mark-sent-meta">
          {assignment?.sentAt && (
            <span>
              Sent {fmtShortDate(assignment.sentAt)}
              {assignment.sentVia && (
                <span className="muted-suffix"> · via {assignment.sentVia}</span>
              )}
            </span>
          )}
          <div className="prop-mark-sent-actions">
            <button
              type="button"
              className="prop-mark-action prop-mark-action--ghost"
              onClick={onUndoSent}
              disabled={busy}
              title="Revert to queued — clears sentAt/sentVia"
            >
              {busy ? 'Saving…' : 'Undo sent'}
            </button>
            <button
              type="button"
              className="prop-mark-action prop-mark-action--close"
              onClick={() => setShowCloseForm(true)}
              disabled={busy}
            >
              <Icon name="check" size={12} />
              <span>Mark closed</span>
            </button>
          </div>
        </div>
      )}
      {isSent && showCloseForm && (
        <form className="prop-mark-close-form" onSubmit={submitClose}>
          <label className="fact-label">Final rent (S$/mo)</label>
          <div className="prop-mark-close-row">
            <input
              type="number"
              className="input"
              min="0"
              step="50"
              autoFocus
              value={rentDraft}
              onChange={(e) => setRentDraft(e.target.value)}
              placeholder="e.g. 1700"
            />
            <button type="submit" className="prop-mark-action prop-mark-action--close" disabled={busy}>
              {busy ? 'Saving…' : 'Confirm close'}
            </button>
            <button
              type="button"
              className="prop-mark-action prop-mark-action--ghost"
              onClick={() => setShowCloseForm(false)}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {isClosed && (
        <div className="prop-mark-closed-meta">
          <div>
            <span className="fact-label">Moved in</span>
            <span className="prop-mark-closed-val">
              {deal?.movedInAt ? fmtShortDate(deal.movedInAt) : '—'}
              {typeof deal?.finalRentSGD === 'number' && (
                <span className="muted-suffix">
                  {' · '}S${deal.finalRentSGD.toLocaleString()}/mo
                </span>
              )}
            </span>
          </div>
          <button
            type="button"
            className="prop-mark-action prop-mark-action--ghost"
            onClick={onUnclose}
            disabled={busy}
          >
            {busy ? 'Saving…' : 'Cancel deal'}
          </button>
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
