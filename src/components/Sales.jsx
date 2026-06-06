import React from 'react'
import { useMutation } from 'convex/react'
import { useNavigate } from 'react-router-dom'
import { Icon, Pill } from './ui.jsx'

// Screen 7 — Sales ledger. Read-only summary of moved-in deals (the final
// stage in the leasing journey). Pipeline drives the stage progression; this
// screen lists what's been closed, with revenue + an undo for accidents.
//
// Backed by the `deals` table — a "closed" deal is `stage === 'moved_in'`
// with no `cancelledAt`. Reopen = `deals:advance` is forbidden backward, so
// instead we cancel the moved-in deal (drops customer back to Sent).

export default function SalesScreen({ toast, deals = [] }) {
  const navigate = useNavigate()
  const cancelDeal = useMutation('deals:cancel')
  const [busyId, setBusyId] = React.useState(null)
  const [showClosed, setShowClosed] = React.useState(false)
  const [search, setSearch] = React.useState('')

  const movedIn = deals.filter(
    (d) => d.stage === 'moved_in' && d.cancelledAt === undefined,
  )
  const reopened = deals.filter(
    (d) => d.stage === 'moved_in' && d.cancelledAt !== undefined,
  )

  const totalActiveRent = movedIn.reduce(
    (acc, d) => acc + (typeof d.finalRentSGD === 'number' ? d.finalRentSGD : 0),
    0,
  )

  const q = search.trim().toLowerCase()
  const matches = (d) =>
    !q ||
    d.customerName?.toLowerCase().includes(q) ||
    d.propertyCondo?.toLowerCase().includes(q)

  const visibleActive = movedIn.filter(matches)
  const visibleReopened = reopened.filter(matches)

  async function handleCancel(deal) {
    setBusyId(deal._id)
    try {
      await cancelDeal({ id: deal._id })
      toast?.(`Cancelled — ${deal.propertyCondo} → ${deal.customerName}.`)
    } catch (err) {
      toast?.(`Couldn't cancel — ${err?.message || 'try again'}.`)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="sales-screen">
      <div className="page-header">
        <div>
          <h1 className="page-title">Sales</h1>
          <p className="page-sub">
            Closed deals — every moved-in lease, plus the running monthly rent.
          </p>
        </div>
        <div className="sales-stats">
          <Stat label="Moved in" value={movedIn.length} kind="closed" />
          <Stat
            label="Monthly rent"
            value={totalActiveRent > 0 ? `S$${totalActiveRent.toLocaleString()}` : '—'}
            kind="revenue"
          />
        </div>
      </div>

      <div className="detail-toolbar" style={{ marginTop: 16 }}>
        <div className="detail-toolbar-controls" style={{ marginLeft: 'auto' }}>
          <input
            className="input detail-search"
            placeholder="Search by customer or property…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <label className="detail-toggle">
            <input
              type="checkbox"
              checked={showClosed}
              onChange={(e) => setShowClosed(e.target.checked)}
            />
            <span>Show cancelled</span>
          </label>
        </div>
      </div>

      {visibleActive.length === 0 ? (
        <div className="empty" style={{ marginTop: 16 }}>
          <h4>No closed deals yet</h4>
          <p>
            Advance a deal to <strong>Moved in</strong> on the Pipeline screen to log it here.
          </p>
        </div>
      ) : (
        <div className="sales-grid">
          {visibleActive.map((d) => (
            <DealCard
              key={d._id}
              deal={d}
              busy={busyId === d._id}
              onCancel={() => handleCancel(d)}
              onOpenCustomer={() => navigate(`/customers/${d.responseId}`)}
            />
          ))}
        </div>
      )}

      {showClosed && visibleReopened.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Cancelled</div>
          <div className="sales-grid">
            {visibleReopened.map((d) => (
              <DealCard
                key={d._id}
                deal={d}
                cancelled
                onOpenCustomer={() => navigate(`/customers/${d.responseId}`)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, kind }) {
  return (
    <div className={`hero-count hero-count--${kind}`}>
      <div className="hero-count-num">{value}</div>
      <div className="hero-count-label">{label}</div>
    </div>
  )
}

function DealCard({ deal, busy, cancelled, onCancel, onOpenCustomer }) {
  return (
    <div className={`sale-card ${cancelled ? 'sale-card--reopened' : ''}`}>
      <div className="sale-card-head">
        <div>
          <div className="eyebrow">Customer</div>
          <button type="button" className="sale-card-link" onClick={onOpenCustomer}>
            {deal.customerName}
          </button>
          {deal.customerSchool && (
            <span style={{ marginLeft: 8 }}>
              <Pill kind={deal.customerSchool === 'NUS' ? 'orange' : 'navy'} dot>
                {deal.customerSchool}
              </Pill>
            </span>
          )}
        </div>
        {cancelled ? (
          <span className="prop-mark-badge prop-mark-badge--queued">Cancelled</span>
        ) : (
          <span className="prop-mark-badge prop-mark-badge--sent">
            <Icon name="check" size={11} /> Moved in
          </span>
        )}
      </div>

      <div className="sale-card-body">
        <div>
          <div className="fact-label">Property</div>
          <div className="fact-val">{deal.propertyCondo}</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
            {[deal.propertyBuildingType, deal.propertyArea].filter(Boolean).join(' · ') || '—'}
          </div>
        </div>
        <div>
          <div className="fact-label">Final rent</div>
          <div className="fact-val">
            {typeof deal.finalRentSGD === 'number'
              ? `S$${deal.finalRentSGD.toLocaleString()}`
              : '—'}
            <span className="muted-suffix"> /mo</span>
          </div>
        </div>
        <div>
          <div className="fact-label">Moved in</div>
          <div className="fact-val">{fmtDate(deal.movedInAt)}</div>
        </div>
      </div>

      {!cancelled && (
        <button
          type="button"
          className="prop-mark-action prop-mark-action--ghost"
          onClick={onCancel}
          disabled={busy}
          style={{ alignSelf: 'flex-end' }}
        >
          {busy ? 'Saving…' : 'Cancel deal'}
        </button>
      )}
    </div>
  )
}

function fmtDate(ms) {
  if (!ms) return '—'
  return new Date(ms).toLocaleDateString('en-SG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}
