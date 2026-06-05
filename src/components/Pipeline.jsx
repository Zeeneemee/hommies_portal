import React from 'react'
import { useMutation, useQuery } from 'convex/react'
import { useNavigate } from 'react-router-dom'
import { Icon, Pill } from './ui.jsx'
import ManualMatchModal from './ManualMatchModal.jsx'

// Screen — Pipeline. One funnel view over every customer, bucketed by the
// stage computed server-side in responses:listWithPipelineStatus. Each row
// surfaces the next-step action so the operator never has to bounce out to
// CustomerDetail to advance a deal.

const BUCKETS = [
  { key: 'not_contacted', label: 'Not contacted', tone: 'grey' },
  { key: 'sent', label: 'Sent', tone: 'navy' },
  { key: 'loi_sent', label: 'LOI sent', tone: 'orange' },
  { key: 'loi_signed', label: 'LOI signed', tone: 'orange' },
  { key: 'ta_issued', label: 'TA issued', tone: 'orange' },
  { key: 'moved_in', label: 'Moved in', tone: 'green' },
]

const STAGE_LABELS = {
  loi_sent: 'LOI sent',
  loi_signed: 'LOI signed',
  ta_issued: 'TA issued',
  moved_in: 'Moved in',
}

const NEXT_STAGE = {
  loi_sent: 'loi_signed',
  loi_signed: 'ta_issued',
  ta_issued: 'moved_in',
}

const FORWARD_STAGES = ['loi_signed', 'ta_issued', 'moved_in']

export default function Pipeline({ toast, properties = [] }) {
  const rows = useQuery('responses:listWithPipelineStatus') ?? []
  const startDeal = useMutation('deals:start')
  const advanceDeal = useMutation('deals:advance')
  const cancelDeal = useMutation('deals:cancel')

  const navigate = useNavigate()
  const [search, setSearch] = React.useState('')
  const [busyId, setBusyId] = React.useState(null)
  const [manualFor, setManualFor] = React.useState(null) // { responseId, mode } | null

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) =>
      `${r.name || ''} ${r.contact || ''} ${r.school || ''}`.toLowerCase().includes(q),
    )
  }, [rows, search])

  const grouped = React.useMemo(() => {
    const out = {}
    for (const b of BUCKETS) out[b.key] = []
    for (const r of filtered) {
      ;(out[r.stage] || out.not_contacted).push(r)
    }
    return out
  }, [filtered])

  const total = rows.length
  const counts = React.useMemo(() => {
    const c = {}
    for (const b of BUCKETS) c[b.key] = grouped[b.key].length
    return c
  }, [grouped])

  async function withBusy(rowId, fn, successMsg) {
    setBusyId(rowId)
    try {
      await fn()
      if (successMsg) toast?.(successMsg)
    } catch (err) {
      toast?.(`Could not update — ${err?.message || 'try again'}.`)
    } finally {
      setBusyId(null)
    }
  }

  async function handleStart(row, propertyId) {
    if (!propertyId) {
      toast?.('Pick a property first.')
      return
    }
    await withBusy(
      row._id,
      () => startDeal({ responseId: row._id, propertyId }),
      `Deal started for ${row.name}.`,
    )
  }

  async function handleAdvance(row, to) {
    if (!row.activeDeal) return
    await withBusy(
      row._id,
      () => advanceDeal({ id: row.activeDeal._id, to }),
      `Advanced to ${STAGE_LABELS[to]}.`,
    )
  }

  async function handleCancel(row) {
    if (!row.activeDeal) return
    if (!window.confirm(`Cancel ${row.name}'s deal? They'll drop back to Sent.`)) return
    await withBusy(row._id, () => cancelDeal({ id: row.activeDeal._id }), 'Deal cancelled.')
  }

  return (
    <div className="pipeline-screen">
      <div className="page-header">
        <div>
          <div className="eyebrow">Pipeline</div>
          <h1 className="page-title">Customer pipeline</h1>
          <p className="page-sub">
            Where each customer sits in the funnel — from first contact through move-in. Advance a
            deal directly from its row; closed customers drop out of Recommend automatically.
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}>
          <input
            className="input"
            placeholder="Search name, contact, school…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ minWidth: 280 }}
          />
          <button
            className="btn btn-nav-secondary"
            onClick={() => setManualFor({ mode: 'single' })}
          >
            <Icon name="plus" size={14} /> Manual match
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => setManualFor({ mode: 'cohort' })}
          >
            <Icon name="check" size={14} /> Manual cohort
          </button>
        </div>
      </div>

      <div className="pipeline-counts">
        {BUCKETS.map((b) => (
          <div key={b.key} className={`hero-count hero-count--${b.tone}`}>
            <div className="hero-count-num">{counts[b.key]}</div>
            <div className="hero-count-label">{b.label}</div>
          </div>
        ))}
        <div className="hero-count hero-count--total">
          <div className="hero-count-num">{total}</div>
          <div className="hero-count-label">Total</div>
        </div>
      </div>

      {BUCKETS.map((b) => (
        <BucketSection
          key={b.key}
          bucket={b}
          rows={grouped[b.key]}
          properties={properties}
          busyId={busyId}
          onStart={handleStart}
          onAdvance={handleAdvance}
          onCancel={handleCancel}
          onView={(id) => navigate(`/customers/${id}`)}
          onManualMatch={(responseId) => setManualFor({ mode: 'single', responseId })}
        />
      ))}

      {manualFor && (
        <ManualMatchModal
          mode={manualFor.mode}
          initialResponseId={manualFor.responseId || null}
          properties={properties}
          rows={rows}
          toast={toast}
          onClose={() => setManualFor(null)}
        />
      )}
    </div>
  )
}

function BucketSection({ bucket, rows, properties, busyId, onStart, onAdvance, onCancel, onView, onManualMatch }) {
  return (
    <div className={`assignment-section assignment-section--${bucket.tone}`} style={{ marginTop: 18 }}>
      <div className="assignment-section-head">
        <span className="assignment-section-title">{bucket.label}</span>
        <span className="assignment-section-count">{rows.length}</span>
        <span className="assignment-section-sub">{subtitleFor(bucket.key)}</span>
      </div>
      <div className="assignment-section-body">
        {rows.length === 0 ? (
          <div className="assignment-section-empty">{emptyFor(bucket.key)}</div>
        ) : (
          rows.map((r) => (
            <PipelineRow
              key={r._id}
              row={r}
              properties={properties}
              busy={busyId === r._id}
              onStart={onStart}
              onAdvance={onAdvance}
              onCancel={onCancel}
              onView={onView}
              onManualMatch={onManualMatch}
            />
          ))
        )}
      </div>
    </div>
  )
}

function subtitleFor(key) {
  switch (key) {
    case 'not_contacted':
      return 'No outreach sent yet — match them with a property to begin.'
    case 'sent':
      return 'Listings have been sent. Start a deal once an LOI goes out.'
    case 'loi_sent':
      return 'Waiting on the customer / landlord to sign the LOI.'
    case 'loi_signed':
      return 'Issue the tenancy agreement next.'
    case 'ta_issued':
      return 'TA out — confirm move-in to close the deal.'
    case 'moved_in':
      return 'Lease is live. Excluded from Recommend.'
    default:
      return ''
  }
}

function emptyFor(key) {
  switch (key) {
    case 'not_contacted':
      return 'Everyone has been touched. Nice.'
    case 'sent':
      return 'No one is sitting on a listing without a deal yet.'
    case 'loi_sent':
    case 'loi_signed':
    case 'ta_issued':
      return 'No deals at this stage right now.'
    case 'moved_in':
      return 'No closed leases yet.'
    default:
      return 'No rows.'
  }
}

function PipelineRow({ row, properties, busy, onStart, onAdvance, onCancel, onView, onManualMatch }) {
  const hasDeal = !!row.activeDeal
  const stage = row.stage
  const next = hasDeal ? NEXT_STAGE[row.activeDeal.stage] : null
  const stageTs = hasDeal ? stageTimestamp(row.activeDeal) : null

  // For Sent-bucket rows we let the operator start a deal against any of
  // their sent properties — pick the most recent by default.
  const [startTarget, setStartTarget] = React.useState(row.lastSentPropertyId || '')

  return (
    <div className="match-card">
      <div className="match-rank">
        <Icon name={iconFor(stage)} size={20} />
        <span className="small">{stageShort(stage)}</span>
      </div>
      <div className="match-body">
        <div className="top">
          <span className="name">{row.name}</span>
          <span className="meta">
            · {row.school} · {row.channel}
            {row.contact && ` · ${row.contact}`}
          </span>
        </div>
        <div className="meta">
          Budget S${row.budget?.min}–{row.budget?.max} · {row.housingType || '—'}
          {row.moveIn ? ` · Move-in ${row.moveIn}` : ''}
        </div>
        {row.sentCount > 0 && (
          <div className="meta">
            {row.sentCount} sent
            {row.lastSentPropertyCondo
              ? ` · last: ${row.lastSentPropertyCondo}`
              : ''}
            {row.lastSentAt ? ` · ${relativeTime(row.lastSentAt)}` : ''}
          </div>
        )}
        {hasDeal && (
          <div className="reason" style={{ marginTop: 4 }}>
            <Pill kind="orange" dot>
              {STAGE_LABELS[row.activeDeal.stage]}
            </Pill>
            <span style={{ marginLeft: 8 }}>
              {row.activeDeal.propertyCondo || '(property removed)'}
              {stageTs ? ` · ${relativeTime(stageTs)}` : ''}
            </span>
          </div>
        )}
      </div>
      <div className="match-actions">
        {stage === 'not_contacted' && (
          <>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => onManualMatch(row._id)}
              disabled={busy}
            >
              <Icon name="plus" size={12} /> Manual match
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => onView(row._id)}>
              View
            </button>
          </>
        )}

        {stage === 'sent' && (
          <>
            <select
              className="input"
              value={startTarget}
              onChange={(e) => setStartTarget(e.target.value)}
              disabled={busy}
              style={{ maxWidth: 200 }}
            >
              <option value="">Pick property…</option>
              {properties.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.condo}
                </option>
              ))}
            </select>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => onStart(row, startTarget)}
              disabled={busy || !startTarget}
            >
              <Icon name="send" size={12} /> Start deal
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => onView(row._id)}>
              View
            </button>
          </>
        )}

        {hasDeal && stage !== 'moved_in' && (
          <>
            {next && (
              <button
                className="btn btn-primary btn-sm"
                onClick={() => onAdvance(row, next)}
                disabled={busy}
              >
                <Icon name="check" size={12} /> Mark {STAGE_LABELS[next]}
              </button>
            )}
            <SkipToDropdown
              currentStage={row.activeDeal.stage}
              disabled={busy}
              onPick={(to) => onAdvance(row, to)}
            />
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => onCancel(row)}
              disabled={busy}
            >
              Cancel deal
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => onView(row._id)}>
              View
            </button>
          </>
        )}

        {stage === 'moved_in' && (
          <>
            <Pill kind="green" dot>
              Closed
            </Pill>
            <button className="btn btn-ghost btn-sm" onClick={() => onView(row._id)}>
              View
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function SkipToDropdown({ currentStage, disabled, onPick }) {
  const options = FORWARD_STAGES.filter(
    (s) => s !== NEXT_STAGE[currentStage] && stageIsAfter(s, currentStage),
  )
  if (options.length === 0) return null
  return (
    <select
      className="input"
      disabled={disabled}
      value=""
      onChange={(e) => {
        if (e.target.value) onPick(e.target.value)
      }}
      style={{ maxWidth: 160 }}
      title="Skip forward to a later stage"
    >
      <option value="">Skip to…</option>
      {options.map((s) => (
        <option key={s} value={s}>
          {STAGE_LABELS[s]}
        </option>
      ))}
    </select>
  )
}

function stageIsAfter(a, b) {
  const order = ['loi_sent', 'loi_signed', 'ta_issued', 'moved_in']
  return order.indexOf(a) > order.indexOf(b)
}

function iconFor(stage) {
  switch (stage) {
    case 'not_contacted':
      return 'user'
    case 'sent':
      return 'mail'
    case 'loi_sent':
    case 'loi_signed':
    case 'ta_issued':
      return 'send'
    case 'moved_in':
      return 'check'
    default:
      return 'user'
  }
}

function stageShort(stage) {
  switch (stage) {
    case 'not_contacted':
      return 'New'
    case 'sent':
      return 'Sent'
    case 'loi_sent':
      return 'LOI'
    case 'loi_signed':
      return 'Signed'
    case 'ta_issued':
      return 'TA'
    case 'moved_in':
      return 'Moved'
    default:
      return ''
  }
}

function stageTimestamp(deal) {
  switch (deal.stage) {
    case 'loi_sent':
      return deal.loiSentAt
    case 'loi_signed':
      return deal.loiSignedAt
    case 'ta_issued':
      return deal.taIssuedAt
    case 'moved_in':
      return deal.movedInAt
    default:
      return null
  }
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
