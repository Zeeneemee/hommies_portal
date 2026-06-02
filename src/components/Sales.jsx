import React from 'react'
import { useMutation } from 'convex/react'
import { useNavigate } from 'react-router-dom'
import { Icon, Pill } from './ui.jsx'

// Screen 6 — Sales ledger. Read-only summary of closed deals. The close
// action lives on the customer detail page (one click on a sent property);
// this screen lists what's been closed, with revenue + an undo for accidents.

export default function SalesScreen({ toast, sales = [] }) {
  const navigate = useNavigate()
  const uncloseSale = useMutation('sales:unclose')
  const [busyId, setBusyId] = React.useState(null)
  const [showClosed, setShowClosed] = React.useState(false)
  const [search, setSearch] = React.useState('')

  const active = sales.filter((s) => s.unclosedAt === undefined)
  const reopened = sales.filter((s) => s.unclosedAt !== undefined)

  const totalActiveRent = active.reduce(
    (acc, s) => acc + (typeof s.finalRentSGD === 'number' ? s.finalRentSGD : 0),
    0,
  )

  const q = search.trim().toLowerCase()
  const matches = (s) =>
    !q ||
    s.customerName?.toLowerCase().includes(q) ||
    s.propertyCondo?.toLowerCase().includes(q)

  const visibleActive = active.filter(matches)
  const visibleReopened = reopened.filter(matches)

  async function handleUnclose(sale) {
    setBusyId(sale._id)
    try {
      await uncloseSale({ id: sale._id })
      toast?.(`Reopened — ${sale.propertyCondo} → ${sale.customerName}.`)
    } catch (err) {
      toast?.(`Couldn't reopen — ${err?.message || 'try again'}.`)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="sales-screen">
      <div className="page-head">
        <div>
          <div className="eyebrow">Step 6</div>
          <h1 className="page-title">Sales</h1>
          <p className="muted">
            Closed deals — every confirmed lease maps a customer to the property they took.
          </p>
        </div>
        <div className="sales-stats">
          <Stat label="Closed" value={active.length} kind="closed" />
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
            <span>Show reopened</span>
          </label>
        </div>
      </div>

      {visibleActive.length === 0 ? (
        <div className="empty" style={{ marginTop: 16 }}>
          <h4>No closed deals yet</h4>
          <p>
            From a customer's detail page, click <strong>Mark closed</strong> on a sent
            property to log the deal here.
          </p>
        </div>
      ) : (
        <div className="sales-grid">
          {visibleActive.map((s) => (
            <SaleCard
              key={s._id}
              sale={s}
              busy={busyId === s._id}
              onUnclose={() => handleUnclose(s)}
              onOpenCustomer={() => navigate(`/customers/${s.responseId}`)}
            />
          ))}
        </div>
      )}

      {showClosed && visibleReopened.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Reopened</div>
          <div className="sales-grid">
            {visibleReopened.map((s) => (
              <SaleCard
                key={s._id}
                sale={s}
                reopened
                onOpenCustomer={() => navigate(`/customers/${s.responseId}`)}
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

function SaleCard({ sale, busy, reopened, onUnclose, onOpenCustomer }) {
  return (
    <div className={`sale-card ${reopened ? 'sale-card--reopened' : ''}`}>
      <div className="sale-card-head">
        <div>
          <div className="eyebrow">Customer</div>
          <button type="button" className="sale-card-link" onClick={onOpenCustomer}>
            {sale.customerName}
          </button>
          {sale.customerSchool && (
            <span style={{ marginLeft: 8 }}>
              <Pill
                kind={sale.customerSchool === 'NUS' ? 'orange' : 'navy'}
                dot
              >
                {sale.customerSchool}
              </Pill>
            </span>
          )}
        </div>
        {reopened ? (
          <span className="prop-mark-badge prop-mark-badge--queued">Reopened</span>
        ) : (
          <span className="prop-mark-badge prop-mark-badge--sent">
            <Icon name="check" size={11} /> Closed
          </span>
        )}
      </div>

      <div className="sale-card-body">
        <div>
          <div className="fact-label">Property</div>
          <div className="fact-val">{sale.propertyCondo}</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
            {[sale.propertyBuildingType, sale.propertyArea].filter(Boolean).join(' · ') || '—'}
          </div>
        </div>
        <div>
          <div className="fact-label">Final rent</div>
          <div className="fact-val">
            {typeof sale.finalRentSGD === 'number'
              ? `S$${sale.finalRentSGD.toLocaleString()}`
              : '—'}
            <span className="muted-suffix"> /mo</span>
          </div>
        </div>
        <div>
          <div className="fact-label">Closed</div>
          <div className="fact-val">{fmtDate(sale.closedAt)}</div>
        </div>
      </div>

      {!reopened && (
        <button
          type="button"
          className="prop-mark-action prop-mark-action--ghost"
          onClick={onUnclose}
          disabled={busy}
          style={{ alignSelf: 'flex-end' }}
        >
          {busy ? 'Saving…' : 'Undo close'}
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
