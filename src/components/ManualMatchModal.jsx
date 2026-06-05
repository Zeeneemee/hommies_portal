import React from 'react'
import { useMutation } from 'convex/react'
import { Icon, Pill } from './ui.jsx'
import { decide } from '../decisionLogic.js'

// Manual match — bypass the auto-ranked Suggestion list and pin an arbitrary
// (customer, property) pair, or pin N customers as a manual roommate cohort
// against a whole-unit property. Both flows route through the existing
// assignments ledger so the Must-send → Mark-sent path is unchanged.
//
// Mode 'single' = one customer + one property → assignments:pin
// Mode 'cohort' = whole-unit property + N customers (exact room count) →
//                 assignments:pinMany

export default function ManualMatchModal({
  mode = 'single',
  initialResponseId = null,
  properties = [],
  rows = [],
  toast,
  onClose,
}) {
  const pin = useMutation('assignments:pin')
  const pinMany = useMutation('assignments:pinMany')

  // Pipeline rows carry .stage — exclude moved-in customers from the picker
  // per the spec.
  const candidates = React.useMemo(
    () => rows.filter((r) => r.stage !== 'moved_in'),
    [rows],
  )

  const [tab, setTab] = React.useState(mode)
  const [search, setSearch] = React.useState('')
  const [propertyId, setPropertyId] = React.useState('')
  const [singleResponseId, setSingleResponseId] = React.useState(initialResponseId || '')
  const [cohortIds, setCohortIds] = React.useState(new Set())
  const [busy, setBusy] = React.useState(false)

  const property = properties.find((p) => p._id === propertyId) || null

  const filteredCandidates = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return candidates
    return candidates.filter((r) =>
      `${r.name || ''} ${r.contact || ''} ${r.school || ''}`.toLowerCase().includes(q),
    )
  }, [candidates, search])

  // Cohort gating per the spec.
  const cohortRoomTotal =
    property && property.housingType === 'Whole Unit'
      ? (property.masterCount || 0) + (property.commonCount || 0)
      : 0
  const cohortReady =
    tab === 'cohort' &&
    property &&
    property.housingType === 'Whole Unit' &&
    cohortRoomTotal > 0 &&
    cohortIds.size === cohortRoomTotal

  function toggleCohort(id) {
    setCohortIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function submitSingle() {
    if (!propertyId || !singleResponseId) {
      toast?.('Pick a customer and a property.')
      return
    }
    const client = candidates.find((r) => r._id === singleResponseId)
    let pinnedScore = 0
    if (client && propertyIsMatchable(property)) {
      try {
        const decision = decide(client, property)
        pinnedScore = decision?.score ?? 0
      } catch {
        pinnedScore = 0
      }
    }
    setBusy(true)
    try {
      await pin({
        propertyId,
        responseId: singleResponseId,
        pinnedScore,
        pinnedReason: 'manual-match',
      })
      toast?.(`Pinned ${client?.name || 'customer'} → ${property?.condo || 'property'}.`)
      onClose?.()
    } catch (err) {
      toast?.(`Could not pin — ${err?.message || 'try again'}.`)
    } finally {
      setBusy(false)
    }
  }

  async function submitCohort() {
    if (!cohortReady) return
    const members = Array.from(cohortIds).map((id) => {
      const client = candidates.find((r) => r._id === id)
      let pinnedScore = 0
      if (client && propertyIsMatchable(property)) {
        try {
          const decision = decide(client, property)
          pinnedScore = decision?.score ?? 0
        } catch {
          pinnedScore = 0
        }
      }
      return { responseId: id, pinnedScore }
    })
    setBusy(true)
    try {
      await pinMany({
        propertyId,
        members,
        pinnedReason: 'manual-cohort',
      })
      toast?.(`Pinned cohort of ${members.length} → ${property.condo}.`)
      onClose?.()
    } catch (err) {
      toast?.(`Could not pin cohort — ${err?.message || 'try again'}.`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => e.target === e.currentTarget && onClose?.()}
      style={modalBackdropStyle}
    >
      <div className="card" style={modalCardStyle}>
        <div className="card-head" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <div>
            <div className="eyebrow">Manual match</div>
            <h3 className="card-title">Pin a customer to a property</h3>
            <p className="card-sub">
              Bypass the auto-ranked Suggestion list. Manual pins are tagged{' '}
              <code>manual-match</code> / <code>manual-cohort</code> in audit.
            </p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
            <Icon name="x" size={14} />
          </button>
        </div>

        <div className="view-toggle" role="tablist" style={{ margin: '10px 16px 0' }}>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'single'}
            className={tab === 'single' ? 'on' : ''}
            onClick={() => setTab('single')}
          >
            <Icon name="user" size={12} /> Single
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'cohort'}
            className={tab === 'cohort' ? 'on' : ''}
            onClick={() => setTab('cohort')}
          >
            <Icon name="check" size={12} /> Cohort
          </button>
        </div>

        <div className="card-pad" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <div className="fact-label">Property</div>
            <select
              className="input"
              value={propertyId}
              onChange={(e) => setPropertyId(e.target.value)}
              style={{ width: '100%', marginTop: 6 }}
            >
              <option value="">Pick a property…</option>
              {properties.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.condo}
                  {p.housingType ? ` — ${p.housingType}` : ''}
                  {p.area ? ` · ${p.area}` : ''}
                </option>
              ))}
            </select>
            {property && (
              <div style={{ marginTop: 10, fontSize: 12, color: 'var(--ink-mute)' }}>
                {property.unitType || '—'}
                {typeof property.rentSGD === 'number' && ` · S$${property.rentSGD}/mo`}
                {property.housingType === 'Whole Unit' &&
                  typeof property.masterCount === 'number' &&
                  typeof property.commonCount === 'number' && (
                    <>
                      <br />
                      {property.masterCount}M + {property.commonCount}C ({cohortRoomTotal} rooms)
                    </>
                  )}
              </div>
            )}
            {tab === 'cohort' && property && property.housingType !== 'Whole Unit' && (
              <div style={{ marginTop: 10, color: 'var(--danger, #b03a2e)', fontSize: 12 }}>
                Cohort mode only works on whole-unit listings.
              </div>
            )}
          </div>

          <div>
            <div className="fact-label">
              {tab === 'single'
                ? 'Customer'
                : `Customers (${cohortIds.size}${cohortRoomTotal ? ` / ${cohortRoomTotal}` : ''})`}
            </div>
            <input
              className="input"
              placeholder="Search customer…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ marginTop: 6, width: '100%' }}
            />
            <div
              className="property-picker-list"
              style={{ maxHeight: 280, overflowY: 'auto', marginTop: 8 }}
            >
              {filteredCandidates.length === 0 ? (
                <div className="muted" style={{ padding: 12, fontSize: 13 }}>
                  No customers match.
                </div>
              ) : (
                filteredCandidates.map((c) => {
                  const selected =
                    tab === 'single'
                      ? singleResponseId === c._id
                      : cohortIds.has(c._id)
                  return (
                    <button
                      key={c._id}
                      type="button"
                      className={`property-pick ${selected ? 'on' : ''}`}
                      onClick={() =>
                        tab === 'single'
                          ? setSingleResponseId(c._id)
                          : toggleCohort(c._id)
                      }
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'flex-start',
                          gap: 8,
                        }}
                      >
                        <span className="pp-name">{c.name}</span>
                        <Pill
                          kind={
                            c.school === 'NUS'
                              ? 'orange'
                              : c.school === 'OTHER'
                              ? 'grey'
                              : 'navy'
                          }
                        >
                          {c.school}
                        </Pill>
                      </div>
                      <span className="pp-meta">
                        {c.housingType} · S${c.budget?.min}–{c.budget?.max} ·{' '}
                        {c.stage.replace('_', ' ')}
                        {tab === 'cohort' && c.wantRoommate === false && (
                          <span style={{ color: 'var(--warn, #b88500)', marginLeft: 8 }}>
                            ⚠ not seeking roommates
                          </span>
                        )}
                      </span>
                    </button>
                  )
                })
              )}
            </div>
          </div>
        </div>

        <div
          className="card-pad"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderTop: '1px solid var(--hairline)',
            paddingTop: 14,
          }}
        >
          <span className="muted" style={{ fontSize: 12 }}>
            {tab === 'cohort' && property && cohortRoomTotal > 0
              ? `Need ${cohortRoomTotal} customers; selected ${cohortIds.size}.`
              : 'Manual pins are independent of decide() scores.'}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            {tab === 'single' ? (
              <button
                className="btn btn-primary"
                onClick={submitSingle}
                disabled={busy || !propertyId || !singleResponseId}
              >
                {busy ? 'Pinning…' : 'Pin'}
              </button>
            ) : (
              <button
                className="btn btn-primary"
                onClick={submitCohort}
                disabled={busy || !cohortReady}
              >
                {busy ? 'Pinning…' : 'Pin cohort'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function propertyIsMatchable(p) {
  return (
    !!p &&
    typeof p.rentSGD === 'number' &&
    !!p.housingType &&
    !!p.commuteMins &&
    typeof p.commuteMins.NUS === 'number'
  )
}

const modalBackdropStyle = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(10, 14, 32, 0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
  padding: 24,
}

const modalCardStyle = {
  width: 'min(880px, 100%)',
  maxHeight: '90vh',
  overflow: 'auto',
  background: 'var(--surface, #fff)',
  borderRadius: 10,
  boxShadow: '0 24px 60px rgba(10, 14, 32, 0.25)',
}
