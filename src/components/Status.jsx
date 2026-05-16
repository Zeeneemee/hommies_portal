import React from 'react'
import { useMutation, useAction } from 'convex/react'
import { StageTrack, StatusPill, Icon } from './ui.jsx'

// Screen 2 — every property as a row on the data_received → poster_attached
// → sent track. The context action advances the lifecycle; for properties
// still at data_received, it opens a file picker so a finished PDF can be
// uploaded straight to Convex storage, attached, and run through the
// poster-detail extraction action. A per-row "Re-extract" button reruns
// extraction against the currently-attached poster (useful after the skill's
// generator is updated to include the Facts block, or to retry after a
// transient pdf-parse error).
export default function StatusScreen({ toast, properties }) {
  const advanceStatus = useMutation('properties:advanceStatus')
  const updateStatus = useMutation('properties:advanceStatus') // used to drop sent → poster_attached
  const setPoster = useMutation('properties:setPoster')
  const generateUploadUrl = useMutation('properties:generateUploadUrl')
  const extractPosterDetails = useAction('extraction:extractPosterDetails')
  const fileRefs = React.useRef({})
  const [extracting, setExtracting] = React.useState(() => new Set())

  function markExtracting(id, on) {
    setExtracting((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const counts = {
    data_received: properties.filter((p) => p.status === 'data_received').length,
    poster_attached: properties.filter((p) => p.status === 'poster_attached').length,
    sent: properties.filter((p) => p.status === 'sent').length,
  }

  async function attachPosterFor(property, file) {
    if (!file) return
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      toast('Poster must be a PDF.')
      return
    }
    try {
      const uploadUrl = await generateUploadUrl()
      const res = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/pdf' },
        body: file,
      })
      if (!res.ok) throw new Error('upload failed')
      const { storageId } = await res.json()
      await setPoster({ id: property._id, storageId, name: file.name, size: file.size })
      markExtracting(property._id, true)
      try {
        const result = await extractPosterDetails({ id: property._id })
        if (result?.ok) {
          toast(`Poster attached — extracted ${result.liftedFields.length} field${result.liftedFields.length === 1 ? '' : 's'}.`)
        } else {
          toast('Poster attached — extraction found no fields.')
        }
      } catch (err) {
        toast(`Poster attached — extraction failed: ${err.message || err}`)
      } finally {
        markExtracting(property._id, false)
      }
    } catch (err) {
      toast(`Could not attach: ${err.message || err}`)
    }
  }

  async function reExtract(p) {
    if (!p.posterStorageId) {
      toast('Attach a poster PDF first.')
      return
    }
    markExtracting(p._id, true)
    try {
      const result = await extractPosterDetails({ id: p._id })
      if (result?.ok) {
        toast(`Re-extracted ${result.liftedFields.length} field${result.liftedFields.length === 1 ? '' : 's'}.`)
      } else {
        toast('Re-extract finished — found 0 fields in the PDF.')
      }
    } catch (err) {
      toast(`Extraction failed: ${err.message || err}`)
    } finally {
      markExtracting(p._id, false)
    }
  }

  async function handleAction(p) {
    if (p.status === 'data_received') {
      fileRefs.current[p._id]?.click()
      return
    }
    if (p.status === 'poster_attached') {
      await advanceStatus({ id: p._id })
      toast('Marked as sent. Trust earned.')
      return
    }
    if (p.status === 'sent') {
      await updateStatus({ id: p._id })
      toast('Reopened for redispatch.')
    }
  }

  const actionLabel = (p) =>
    p.status === 'data_received' ? 'Attach poster' : p.status === 'poster_attached' ? 'Mark sent' : 'Reopen'

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="eyebrow">Step 2 · Pipeline</div>
          <h1 className="page-title">Status</h1>
          <p className="page-sub">
            Every property moves through three stages. No surprises — the same track for every unit, every agent.
          </p>
        </div>
      </div>

      <div className="stage-stats">
        <div className="stage-stat">
          <div className="stage-stat-num">{counts.data_received}</div>
          <div className="stage-stat-meta">
            <span className="stage-stat-label">Stage 1</span>
            <span className="stage-stat-name">Data received</span>
          </div>
        </div>
        <div className="stage-stat">
          <div className="stage-stat-num">{counts.poster_attached}</div>
          <div className="stage-stat-meta">
            <span className="stage-stat-label">Stage 2</span>
            <span className="stage-stat-name">Poster attached</span>
          </div>
        </div>
        <div className="stage-stat">
          <div className="stage-stat-num">{counts.sent}</div>
          <div className="stage-stat-meta">
            <span className="stage-stat-label">Stage 3</span>
            <span className="stage-stat-name">Sent to students</span>
          </div>
        </div>
      </div>

      <div className="status-table">
        <div className="status-row head">
          <div>Property</div>
          <div>Room type</div>
          <div>Area</div>
          <div>Progress</div>
          <div>Status</div>
          <div></div>
        </div>
        {properties.length === 0 && (
          <div className="empty" style={{ margin: 18 }}>
            <h4>Nothing in the pipeline yet</h4>
            <p>Add a property to get going.</p>
          </div>
        )}
        {properties.map((p) => {
          const isExtracting = extracting.has(p._id)
          return (
            <div className="status-row" key={p._id}>
              <div className="row-name">
                <span className="n">{p.condo}</span>
                <span className="a">
                  {p.buildingType || '—'} · {(p.fullAddress || '').split(',')[0] || 'address pending'}
                </span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>{p.unitType || '—'}</div>
              <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>{p.area || '—'}</div>
              <div>
                <StageTrack status={p.status} />
              </div>
              <div>
                <StatusPill status={p.status} />
                {p.posterStorageId && (
                  <ExtractionMeta property={p} extracting={isExtracting} />
                )}
              </div>
              <div className="row-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => handleAction(p)}>
                  {actionLabel(p)}
                </button>
                {p.posterStorageId && (
                  <button
                    className="btn btn-ghost btn-sm row-actions__extract"
                    onClick={() => reExtract(p)}
                    disabled={isExtracting}
                    title="Re-run PDF text extraction against the attached poster"
                  >
                    <Icon name="sparkle" size={11} />
                    {isExtracting ? ' Extracting…' : ' Re-extract'}
                  </button>
                )}
                <input
                  ref={(el) => {
                    fileRefs.current[p._id] = el
                  }}
                  type="file"
                  accept="application/pdf,.pdf"
                  style={{ display: 'none' }}
                  onChange={(e) => attachPosterFor(p, e.target.files?.[0])}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ExtractionMeta({ property: p, extracting }) {
  if (extracting) {
    return <div className="extract-meta extract-meta--busy">Extracting…</div>
  }
  if (!p.posterExtractedAt) {
    return <div className="extract-meta extract-meta--pending">Not extracted yet</div>
  }
  const liftedCount = countLiftedFields(p)
  if (p.posterExtractionOk && liftedCount > 0) {
    return (
      <div className="extract-meta extract-meta--ok" title={`Last extracted ${relativeTime(p.posterExtractedAt)}`}>
        ✓ {liftedCount} field{liftedCount === 1 ? '' : 's'}
      </div>
    )
  }
  return (
    <div className="extract-meta extract-meta--empty" title={`Last extracted ${relativeTime(p.posterExtractedAt)}`}>
      0 fields — try Re-extract
    </div>
  )
}

// Count how many of the seven extractable fields are present on the property
// (kept here, not on the engine, because it's a presentation concern).
function countLiftedFields(p) {
  let n = 0
  if (typeof p.rentSGD === 'number') n++
  if (p.area) n++
  if (p.buildingType) n++
  if (p.housingType) n++
  if (typeof p.ageYears === 'number' && p.ageYears > 0) n++
  if (p.unitType) n++
  if (p.commuteMins) n++
  return n
}

function relativeTime(ms) {
  const diff = Date.now() - ms
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`
  const d = Math.floor(h / 24)
  return `${d} day${d === 1 ? '' : 's'} ago`
}
