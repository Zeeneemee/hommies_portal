import React from 'react'
import { useMutation, useAction } from 'convex/react'
import { Link } from 'react-router-dom'
import { Icon, Field } from './ui.jsx'
import { renderPosterToBlob } from '../poster/generate.jsx'
import { resizeImageToJpeg, blobToBase64 } from '../poster/encode.js'

// Batch Add Property — paste many PropertyGuru URLs, get a row per link with
// streamed extraction, edit inline, then generate & save posters one at a
// time or all at once. Reuses the same Convex actions and poster pipeline as
// the single-URL Add Property screen.

const IMAGE_CAP = 12
const MAX_ROWS = 30
const SAVE_FIELDS = [
  'rentSGD', 'area', 'buildingType', 'housingType',
  'ageYears', 'unitType', 'fullAddress', 'commuteMins',
  'masterCount', 'commonCount', 'bedrooms', 'bathrooms', 'tags',
]

const STATUS_LABEL = {
  queued: 'Queued',
  extracting: 'Extracting…',
  fetching_images: 'Fetching images…',
  ready: 'Ready',
  failed: 'Extract failed',
  generating_poster: 'Generating poster…',
  saving: 'Saving…',
  saved: 'Saved',
  save_failed: 'Save failed',
  skipped: 'Skipped',
}
const STATUS_TONE = {
  queued: { bg: '#eef2f6', fg: '#5a6878' },
  extracting: { bg: '#e9f1ff', fg: '#1e57c4' },
  fetching_images: { bg: '#e9f1ff', fg: '#1e57c4' },
  ready: { bg: '#e7f6ec', fg: '#1f7a3f' },
  failed: { bg: '#fdecec', fg: '#a82323' },
  generating_poster: { bg: '#fff4e3', fg: '#b06600' },
  saving: { bg: '#e9f1ff', fg: '#1e57c4' },
  saved: { bg: '#dff5e0', fg: '#16713a' },
  save_failed: { bg: '#fdecec', fg: '#a82323' },
  skipped: { bg: '#f4ecd7', fg: '#7a5500' },
}

function StatusPill({ status }) {
  const tone = STATUS_TONE[status] || STATUS_TONE.queued
  return (
    <span
      style={{
        display: 'inline-block',
        fontSize: 11,
        fontWeight: 600,
        padding: '2px 8px',
        borderRadius: 999,
        background: tone.bg,
        color: tone.fg,
        whiteSpace: 'nowrap',
      }}
    >
      {STATUS_LABEL[status] || status}
    </span>
  )
}

function isValidUrl(s) {
  if (typeof s !== 'string') return false
  const t = s.trim()
  if (!/^https?:\/\//i.test(t)) return false
  try { new URL(t); return true } catch { return false }
}

function makeId() {
  return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function newRow(url) {
  return {
    id: makeId(),
    url: url.trim(),
    status: 'queued',
    extracted: null,
    condo: '',
    images: [],
    posterFile: null,
    posterPreviewUrl: null,
    projectUrl: null,
    primaryUni: null,
    savedPropertyId: null,
    error: null,
    skippedReason: null,
    lastEditedAt: 0,
    posterGeneratedAt: 0,
    isExpanded: false,
  }
}

function posterBlockersFor(row) {
  const e = row.extracted || {}
  const missing = []
  if (!row.condo.trim()) missing.push('condo name')
  if (!(typeof e.rentSGD === 'number' && e.rentSGD > 0)) missing.push('rent')
  if (!e.housingType) missing.push('housing type')
  if (row.images.length < 1) missing.push('at least one image')
  return missing
}

export default function BatchAddProperty({ toast, draft, embedded = false }) {
  const { rows, setRows, urlInput, setUrlInput, maxParallel, setMaxParallel, reset } = draft

  const addProperty = useMutation('properties:add')
  const generateUploadUrl = useMutation('properties:generateUploadUrl')
  const extractPropertyGuruUrl = useAction('extraction:extractPropertyGuruUrl')
  const fetchImagesAsData = useAction('extraction:fetchImagesAsData')
  const generatePosterContent = useAction('ai:generatePosterContent')
  const extractPosterDetails = useAction('extraction:extractPosterDetails')

  // Worker pool — refs so the loop sees the latest state without re-render
  // churn. `inflight` is the set of row ids currently being extracted.
  const inflightRef = React.useRef(new Set())
  const rowsRef = React.useRef(rows)
  const maxParallelRef = React.useRef(maxParallel)
  const pausedRef = React.useRef(false)
  const [paused, setPaused] = React.useState(false)
  React.useEffect(() => { rowsRef.current = rows }, [rows])
  React.useEffect(() => { maxParallelRef.current = maxParallel }, [maxParallel])
  React.useEffect(() => { pausedRef.current = paused }, [paused])

  const updateRow = React.useCallback((id, patch) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...(typeof patch === 'function' ? patch(r) : patch) } : r)))
  }, [setRows])

  // Drive the extraction queue. Called whenever the row set changes — picks
  // up new queued rows, respecting `maxParallel`. Each row's extraction is
  // a self-contained async fn; failures land on the row, not the queue.
  React.useEffect(() => {
    async function extractRow(row) {
      try {
        updateRow(row.id, { status: 'extracting', error: null })
        const res = await extractPropertyGuruUrl({ url: row.url })
        if (!res?.ok) {
          updateRow(row.id, {
            status: 'failed',
            error: res?.error || res?.note || 'Extractor returned not-ok.',
          })
          return
        }
        const fields = res.fields || {}
        const suggestedCondo = res.suggestedCondo || ''
        updateRow(row.id, (r) => ({
          extracted: fields,
          condo: r.condo || suggestedCondo,
          projectUrl: res.projectUrl || r.projectUrl,
          status: 'fetching_images',
        }))

        const remoteUrls = Array.isArray(res.imageUrls) ? res.imageUrls : []
        let images = []
        if (remoteUrls.length) {
          try {
            const fetched = await fetchImagesAsData({ urls: remoteUrls.slice(0, IMAGE_CAP) })
            images = (fetched.images || []).map((img, i) => {
              const bytes = Uint8Array.from(atob(img.dataB64), (c) => c.charCodeAt(0))
              const blob = new Blob([bytes], { type: img.contentType || 'image/jpeg' })
              const file = new File([blob], img.name || `pg-image-${i + 1}.jpg`, {
                type: img.contentType || 'image/jpeg',
              })
              return {
                file,
                name: file.name,
                size: file.size,
                contentType: file.type,
                previewUrl: URL.createObjectURL(file),
              }
            })
          } catch (err) {
            // Image fetch failure is non-fatal — the row can still be saved
            // manually or with later attachments.
            console.warn('[batch] image fetch failed', err)
          }
        }
        updateRow(row.id, { images, status: 'ready' })
      } catch (err) {
        updateRow(row.id, { status: 'failed', error: String(err?.message || err) })
      } finally {
        inflightRef.current.delete(row.id)
        // After a row finishes, kick the queue again to start the next one.
        setTimeout(tick, maxParallelRef.current === 1 ? 750 : 0)
      }
    }

    function tick() {
      if (pausedRef.current) return
      const inflight = inflightRef.current
      const current = rowsRef.current
      while (inflight.size < maxParallelRef.current) {
        const next = current.find((r) => r.status === 'queued' && !inflight.has(r.id))
        if (!next) break
        inflight.add(next.id)
        extractRow(next)
      }
    }

    tick()
  }, [rows, maxParallel, paused, updateRow, extractPropertyGuruUrl, fetchImagesAsData])

  function handleAddUrls() {
    const tokens = urlInput.split(/\s+/).map((s) => s.trim()).filter(Boolean)
    if (tokens.length === 0) {
      toast('Paste at least one URL.')
      return
    }
    const existing = new Set(rows.map((r) => r.url))
    const seen = new Set()
    const valid = []
    let invalid = 0
    let dup = 0
    for (const t of tokens) {
      if (!isValidUrl(t)) { invalid++; continue }
      if (seen.has(t) || existing.has(t)) { dup++; continue }
      seen.add(t)
      valid.push(t)
    }
    const room = MAX_ROWS - rows.length
    const trimmed = valid.length > room ? valid.length - room : 0
    const accepted = valid.slice(0, Math.max(0, room))
    if (accepted.length) setRows((prev) => [...prev, ...accepted.map(newRow)])
    setUrlInput('')
    const bits = []
    if (accepted.length) bits.push(`Added ${accepted.length}`)
    if (dup) bits.push(`${dup} duplicate${dup === 1 ? '' : 's'} skipped`)
    if (invalid) bits.push(`${invalid} invalid skipped`)
    if (trimmed) bits.push(`${trimmed} trimmed (cap ${MAX_ROWS})`)
    toast(bits.join(' · ') || 'Nothing added.')
  }

  function setField(rowId, key, value) {
    updateRow(rowId, (r) => {
      const next = { ...(r.extracted || {}) }
      if (value === '' || value === null || value === undefined) delete next[key]
      else next[key] = value
      return { extracted: next, lastEditedAt: Date.now() }
    })
  }
  function setCommute(rowId, uni, value) {
    updateRow(rowId, (r) => {
      const e = { ...(r.extracted || {}) }
      const c = { ...(e.commuteMins || {}) }
      const n = value === '' || value == null ? undefined : Number(value)
      if (n == null || !Number.isFinite(n)) delete c[uni]
      else c[uni] = n
      if (c.NUS != null && c.NTU != null && c.SMU != null) e.commuteMins = c
      else delete e.commuteMins
      return { extracted: e, lastEditedAt: Date.now() }
    })
  }

  function removeRow(rowId) {
    setRows((prev) => {
      const target = prev.find((r) => r.id === rowId)
      if (target) {
        target.images?.forEach((i) => i.previewUrl && URL.revokeObjectURL(i.previewUrl))
        if (target.posterPreviewUrl) URL.revokeObjectURL(target.posterPreviewUrl)
      }
      return prev.filter((r) => r.id !== rowId)
    })
  }

  async function uploadBlob(file) {
    const url = await generateUploadUrl()
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    })
    if (!res.ok) throw new Error(`upload failed (${res.status})`)
    const { storageId } = await res.json()
    return storageId
  }

  async function generateRowPoster(rowId) {
    const row = rowsRef.current.find((r) => r.id === rowId)
    if (!row) return
    const missing = posterBlockersFor(row)
    if (missing.length) {
      toast(`Cannot generate — missing: ${missing.join(', ')}`)
      return
    }
    updateRow(rowId, { status: 'generating_poster', error: null })
    try {
      const inline = []
      for (let i = 0; i < Math.min(row.images.length, 8); i++) {
        const img = row.images[i]
        try {
          const resized = await resizeImageToJpeg(img.file, 1024, 0.82)
          const dataB64 = await blobToBase64(resized)
          inline.push({ name: img.name, mimeType: 'image/jpeg', dataB64 })
        } catch (err) {
          console.warn('[batch poster] resize failed', err)
        }
      }
      if (inline.length === 0) {
        updateRow(rowId, { status: 'ready', error: 'No images could be encoded.' })
        return
      }
      const propertyArg = { condo: row.condo.trim() }
      const e = row.extracted || {}
      if (typeof e.rentSGD === 'number') propertyArg.rentSGD = e.rentSGD
      if (e.area) propertyArg.area = e.area
      if (e.buildingType === 'Condo' || e.buildingType === 'HDB') propertyArg.buildingType = e.buildingType
      if (e.housingType === 'Room' || e.housingType === 'Whole Unit') propertyArg.housingType = e.housingType
      if (e.unitType) propertyArg.unitType = e.unitType
      if (typeof e.ageYears === 'number') propertyArg.ageYears = e.ageYears
      if (e.fullAddress) propertyArg.fullAddress = e.fullAddress
      if (e.commuteMins && typeof e.commuteMins === 'object') propertyArg.commuteMins = e.commuteMins
      if (typeof e.sizeSqft === 'number') propertyArg.sizeSqft = e.sizeSqft
      if (typeof e.bedrooms === 'number') propertyArg.bedrooms = e.bedrooms
      if (typeof e.bathrooms === 'number') propertyArg.bathrooms = e.bathrooms
      if (e.furnishing) propertyArg.furnishing = e.furnishing
      if (e.availability) propertyArg.availability = e.availability
      if (e.listingTitle) propertyArg.listingTitle = e.listingTitle

      const res = await generatePosterContent({
        property: propertyArg,
        images: inline,
        projectUrl: row.projectUrl || undefined,
        ...(row.primaryUni ? { primaryUni: row.primaryUni } : {}),
      })
      if (!res?.ok || !res.content) {
        updateRow(rowId, { status: 'ready', error: `Poster gen failed: ${res?.note || 'no content'}` })
        return
      }
      const posterProperty = {
        ...propertyArg,
        images: row.images.map((i) => ({ previewUrl: i.previewUrl })),
        listingUrl: row.url,
      }
      const { blob, filename } = await renderPosterToBlob(posterProperty, res.content, row.primaryUni)
      const file = new File([blob], filename, { type: 'application/pdf' })
      const previewUrl = URL.createObjectURL(file)
      updateRow(rowId, (r) => {
        if (r.posterPreviewUrl) URL.revokeObjectURL(r.posterPreviewUrl)
        return {
          posterFile: file,
          posterPreviewUrl: previewUrl,
          status: 'ready',
          posterGeneratedAt: Date.now(),
          error: null,
        }
      })
    } catch (err) {
      updateRow(rowId, { status: 'ready', error: `Poster gen failed: ${err.message || err}` })
    }
  }

  async function generateAllPosters() {
    const snapshot = rowsRef.current
    let made = 0
    let skipped = 0
    let failed = 0
    for (const r of snapshot) {
      if (r.status === 'saved') continue
      if (r.status !== 'ready' && r.status !== 'failed') continue
      const missing = posterBlockersFor(r)
      if (missing.length) {
        updateRow(r.id, { skippedReason: `Missing: ${missing.join(', ')}` })
        skipped++
        continue
      }
      const beforeErr = rowsRef.current.find((x) => x.id === r.id)?.error
      await generateRowPoster(r.id)
      const after = rowsRef.current.find((x) => x.id === r.id)
      if (after?.posterFile && after.error !== beforeErr && !after.error) made++
      else if (after?.posterFile) made++
      else failed++
    }
    toast(`Posters: ${made} made · ${skipped} skipped · ${failed} failed`)
  }

  async function saveRow(rowId) {
    const row = rowsRef.current.find((r) => r.id === rowId)
    if (!row) return null
    if (!row.condo.trim()) {
      toast('Name the property to save.')
      return null
    }
    if (row.images.length === 0 && !row.posterFile) {
      toast('Attach at least one image or a poster.')
      return null
    }
    updateRow(rowId, { status: 'saving', error: null })
    try {
      const uploadedImages = []
      for (const img of row.images) {
        const storageId = await uploadBlob(img.file)
        uploadedImages.push({ storageId, name: img.name, size: img.size, contentType: img.contentType })
      }
      let posterStorageId, posterName, posterSize
      if (row.posterFile) {
        posterStorageId = await uploadBlob(row.posterFile)
        posterName = row.posterFile.name
        posterSize = row.posterFile.size
      }
      const savable = {}
      const e = row.extracted || {}
      for (const k of SAVE_FIELDS) if (e[k] !== undefined) savable[k] = e[k]
      const id = await addProperty({
        condo: row.condo.trim(),
        images: uploadedImages,
        posterStorageId,
        posterName,
        posterSize,
        ...savable,
      })
      if (posterStorageId) {
        try { await extractPosterDetails({ id }) } catch (err) {
          console.warn('[batch save] poster extraction failed', err)
        }
      }
      updateRow(rowId, { status: 'saved', savedPropertyId: id })
      return id
    } catch (err) {
      updateRow(rowId, { status: 'save_failed', error: `Save failed: ${err.message || err}` })
      return null
    }
  }

  async function saveAll() {
    const snapshot = rowsRef.current
    let saved = 0, skipped = 0, failed = 0
    for (const r of snapshot) {
      if (r.status === 'saved') { skipped++; continue }
      if (r.status === 'extracting' || r.status === 'fetching_images' ||
          r.status === 'generating_poster' || r.status === 'saving') { skipped++; continue }
      if (!r.condo.trim() || (r.images.length === 0 && !r.posterFile)) { skipped++; continue }
      const id = await saveRow(r.id)
      if (id) saved++
      else failed++
    }
    toast(`Saved ${saved} · skipped ${skipped} · failed ${failed}`)
  }

  function handleClear() {
    if (rows.length === 0 && !urlInput) {
      reset()
      return
    }
    const ok = window.confirm(`Clear ${rows.length} row${rows.length === 1 ? '' : 's'} from this batch?`)
    if (!ok) return
    // Revoke object URLs before drop.
    rows.forEach((r) => {
      r.images?.forEach((i) => i.previewUrl && URL.revokeObjectURL(i.previewUrl))
      if (r.posterPreviewUrl) URL.revokeObjectURL(r.posterPreviewUrl)
    })
    reset()
    toast('Batch cleared.')
  }

  const counts = React.useMemo(() => {
    const c = { total: rows.length, ready: 0, saved: 0, failed: 0 }
    for (const r of rows) {
      if (r.status === 'ready') c.ready++
      if (r.status === 'saved') c.saved++
      if (r.status === 'failed' || r.status === 'save_failed') c.failed++
    }
    return c
  }, [rows])

  return (
    <div>
      {!embedded && (
        <div className="page-header">
          <div>
            <h1 className="page-title">Batch add properties</h1>
            <p className="page-sub">
              Paste a stack of PropertyGuru links. We'll extract each, stream the rows into the table, and let you
              edit, generate posters, and save — one at a time or all at once.
            </p>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'flex-end', marginBottom: 10 }}>
        <label style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
          Concurrency
          <select
            className="input"
            style={{ marginLeft: 6, padding: '4px 8px', fontSize: 12 }}
            value={maxParallel}
            onChange={(e) => setMaxParallel(Number(e.target.value))}
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
          </select>
        </label>
        <button
          type="button"
          className={`btn ${paused ? 'btn-secondary' : 'btn-ghost'}`}
          onClick={() => setPaused((p) => !p)}
          title={paused ? 'Resume — new queued rows will start extracting' : 'Stop — no new rows will start; in-flight ones finish on their own'}
        >
          {paused ? 'Resume scrape' : 'Stop scrape'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={handleClear}>Clear batch</button>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-pad" style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <Counter label="Total" value={counts.total} />
          <Counter label="Ready" value={counts.ready} tone="green" />
          <Counter label="Saved" value={counts.saved} tone="green" />
          <Counter label="Failed" value={counts.failed} tone="red" />
          <div style={{ flex: 1 }} />
          <button
            type="button"
            className="btn btn-secondary"
            onClick={generateAllPosters}
            disabled={counts.total === 0}
          >
            <Icon name="sparkle" size={12} /> Generate all posters
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={saveAll}
            disabled={counts.total === 0}
          >
            <Icon name="check" size={12} /> Save all
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-pad" style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <textarea
            className="input"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder={`Paste PropertyGuru URLs (one per line, up to ${MAX_ROWS})`}
            rows={2}
            style={{ flex: 1, fontFamily: 'inherit', resize: 'vertical' }}
          />
          <button type="button" className="btn btn-secondary" onClick={handleAddUrls} style={{ whiteSpace: 'nowrap' }}>
            <Icon name="plus" size={12} /> Add to batch
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="card">
          <div className="card-pad" style={{ textAlign: 'center', padding: '32px 22px', color: 'var(--ink-soft)' }}>
            <Icon name="list" size={28} />
            <div style={{ marginTop: 8, fontWeight: 600, color: 'var(--ink)' }}>No rows yet</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>
              Paste PropertyGuru URLs above. Each link becomes one row — extraction begins automatically.
              Up to {MAX_ROWS} rows per batch. Image and poster files live in memory only — a refresh clears them.
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map((row) => (
            <RowCard
              key={row.id}
              row={row}
              onToggle={() => updateRow(row.id, (r) => ({ isExpanded: !r.isExpanded }))}
              onSetCondo={(v) => updateRow(row.id, { condo: v, lastEditedAt: Date.now() })}
              onSetPrimaryUni={(v) => updateRow(row.id, { primaryUni: v, lastEditedAt: Date.now() })}
              onSetField={(k, v) => setField(row.id, k, v)}
              onSetCommute={(uni, v) => setCommute(row.id, uni, v)}
              onGeneratePoster={() => generateRowPoster(row.id)}
              onSave={() => saveRow(row.id)}
              onRemove={() => removeRow(row.id)}
              onRequeue={() => updateRow(row.id, { status: 'queued', error: null })}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function Counter({ label, value, tone }) {
  const color = tone === 'green' ? '#16713a' : tone === 'red' ? '#a82323' : 'var(--ink)'
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
      <span style={{ fontSize: 22, fontWeight: 700, color }}>{value}</span>
      <span style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--ink-mute)', letterSpacing: '0.08em' }}>{label}</span>
    </div>
  )
}

function Fact({ label, value }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--ink-mute)', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 13, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={value || ''}>
        {value || <span style={{ color: 'var(--ink-mute)' }}>—</span>}
      </div>
    </div>
  )
}

function RowCard({
  row, onToggle, onSetCondo, onSetPrimaryUni, onSetField, onSetCommute,
  onGeneratePoster, onSave, onRemove, onRequeue,
}) {
  const e = row.extracted || {}
  const blockers = posterBlockersFor(row)
  const isLocked = row.status === 'saved'
  const isBusy = row.status === 'extracting' || row.status === 'fetching_images' ||
                 row.status === 'generating_poster' || row.status === 'saving'
  const fieldsStaleVsPoster = row.posterGeneratedAt > 0 && row.lastEditedAt > row.posterGeneratedAt
  const bdba = e.bedrooms != null || e.bathrooms != null ? `${e.bedrooms ?? '?'} / ${e.bathrooms ?? '?'}` : null

  return (
    <div className="card" style={{ padding: 0, background: isLocked ? '#fafdf7' : '#fff', overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px 10px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
            <StatusPill status={row.status} />
            <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: 15 }}>
              {row.condo || <span style={{ color: 'var(--ink-mute)', fontWeight: 500 }}>(no name)</span>}
            </div>
            {typeof e.rentSGD === 'number' && (
              <div style={{ fontWeight: 700, color: 'var(--ink)', fontSize: 14 }}>S${e.rentSGD}/mo</div>
            )}
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={e.listingTitle || row.url}>
            {e.listingTitle || (
              <a href={row.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--ink-soft)' }}>{row.url}</a>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {!isLocked && (
            <>
              <button type="button" className="btn btn-ghost btn-sm" onClick={onToggle} disabled={isBusy}>
                {row.isExpanded ? 'Hide' : 'Edit'}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={onGeneratePoster}
                disabled={isBusy || blockers.length > 0}
                title={blockers.length ? `Missing: ${blockers.join(', ')}` : 'Generate poster'}
              >
                Poster
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={onSave}
                disabled={isBusy || !row.condo.trim() || (row.images.length === 0 && !row.posterFile)}
              >
                Save
              </button>
            </>
          )}
          {isLocked && row.savedPropertyId && (
            <Link to="/status" className="btn btn-ghost btn-sm">View on Status</Link>
          )}
          {row.status === 'failed' && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onRequeue}>Retry</button>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onRemove}
            disabled={isBusy}
            title="Remove from batch"
          >
            <Icon name="trash" size={12} />
          </button>
        </div>
      </div>

      {row.images.length > 0 && (
        <div style={{
          display: 'flex',
          gap: 6,
          padding: '0 16px 10px',
          overflowX: 'auto',
        }}>
          {row.images.slice(0, 8).map((img) => (
            <img
              key={img.previewUrl}
              src={img.previewUrl}
              alt={img.name}
              style={{
                width: 96,
                height: 72,
                objectFit: 'cover',
                borderRadius: 4,
                border: '1px solid var(--hairline)',
                flexShrink: 0,
              }}
            />
          ))}
          {row.images.length > 8 && (
            <div style={{
              width: 96, height: 72, borderRadius: 4, border: '1px dashed var(--hairline)',
              display: 'grid', placeItems: 'center', fontSize: 12, color: 'var(--ink-soft)', flexShrink: 0,
            }}>
              +{row.images.length - 8} more
            </div>
          )}
        </div>
      )}

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
        gap: 10,
        padding: '0 16px 12px',
      }}>
        <Fact label="Type" value={[e.housingType, e.buildingType].filter(Boolean).join(' · ') || (e.unitType || '')} />
        <Fact label="Area" value={e.area} />
        <Fact label="Bd / Ba" value={bdba} />
        <Fact label="Size" value={typeof e.sizeSqft === 'number' ? `${e.sizeSqft} sqft` : null} />
        <Fact label="Age" value={typeof e.ageYears === 'number' ? `${e.ageYears} yr` : null} />
        <Fact label="Furnishing" value={e.furnishing} />
        <Fact label="Availability" value={e.availability} />
        <Fact label="Commute (NUS/NTU/SMU)" value={e.commuteMins ? `${e.commuteMins.NUS ?? '?'} / ${e.commuteMins.NTU ?? '?'} / ${e.commuteMins.SMU ?? '?'}` : null} />
        <Fact label="Images" value={row.images.length ? `${row.images.length}` : null} />
        <Fact label="Poster" value={row.posterFile ? 'attached' : null} />
      </div>

      {row.posterPreviewUrl && (
        <div style={{ padding: '0 16px 10px', fontSize: 12 }}>
          <a href={row.posterPreviewUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--navy)' }}>
            <Icon name="pdf" size={11} /> View poster PDF ↗
          </a>
        </div>
      )}

      {(row.error || row.skippedReason || fieldsStaleVsPoster) && (
        <div style={{
          padding: '8px 16px',
          background: row.error ? '#fff5f5' : '#fffaeb',
          borderTop: '1px solid var(--hairline)',
          fontSize: 12,
          color: row.error ? '#a82323' : '#7a5500',
        }}>
          {row.error && <div>⚠ {row.error}</div>}
          {row.skippedReason && <div>⏭ {row.skippedReason}</div>}
          {fieldsStaleVsPoster && (
            <div>⟳ Fields changed since poster was generated — consider regenerating.</div>
          )}
        </div>
      )}

      {row.isExpanded && !isLocked && (
        <div style={{ padding: '12px 16px 18px', borderTop: '1px solid var(--hairline)', background: '#fafaf7' }}>
          <div style={{ marginBottom: 10, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
              Source: <a href={row.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--navy)' }}>{row.url}</a>
            </span>
            <label style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
              Primary uni
              <select
                className="input"
                style={{ marginLeft: 6, padding: '4px 8px', fontSize: 12 }}
                value={row.primaryUni || ''}
                onChange={(ev) => onSetPrimaryUni(ev.target.value || null)}
              >
                <option value="">Auto</option>
                <option value="NUS">NUS</option>
                <option value="NTU">NTU</option>
                <option value="SMU">SMU</option>
              </select>
            </label>
          </div>
          <div className="form-grid">
            <Field label="Condo / HDB name" span={6} required>
              <input className="input" value={row.condo} onChange={(ev) => onSetCondo(ev.target.value)} />
            </Field>
            <Field label="Listing title" span={6}>
              <input className="input" value={e.listingTitle || ''} onChange={(ev) => onSetField('listingTitle', ev.target.value || undefined)} />
            </Field>
            <Field label="Rent (S$/mo)" span={3}>
              <input className="input" type="number" min="0" value={e.rentSGD ?? ''} onChange={(ev) => onSetField('rentSGD', ev.target.value === '' ? undefined : Number(ev.target.value))} />
            </Field>
            <Field label="Housing" span={3}>
              <select className="input" value={e.housingType || ''} onChange={(ev) => onSetField('housingType', ev.target.value || undefined)}>
                <option value="">—</option>
                <option value="Room">Room</option>
                <option value="Whole Unit">Whole Unit</option>
              </select>
            </Field>
            <Field label="Building" span={3}>
              <select className="input" value={e.buildingType || ''} onChange={(ev) => onSetField('buildingType', ev.target.value || undefined)}>
                <option value="">—</option>
                <option value="Condo">Condo</option>
                <option value="HDB">HDB</option>
              </select>
            </Field>
            <Field label="Area" span={3}>
              <input className="input" value={e.area || ''} onChange={(ev) => onSetField('area', ev.target.value || undefined)} />
            </Field>
            <Field label="Unit type" span={3}>
              <input className="input" value={e.unitType || ''} onChange={(ev) => onSetField('unitType', ev.target.value || undefined)} />
            </Field>
            <Field label="Size (sqft)" span={3}>
              <input className="input" type="number" min="0" value={e.sizeSqft ?? ''} onChange={(ev) => onSetField('sizeSqft', ev.target.value === '' ? undefined : Number(ev.target.value))} />
            </Field>
            <Field label="Bedrooms" span={3}>
              <input className="input" type="number" min="0" value={e.bedrooms ?? ''} onChange={(ev) => onSetField('bedrooms', ev.target.value === '' ? undefined : Number(ev.target.value))} />
            </Field>
            <Field label="Bathrooms" span={3}>
              <input className="input" type="number" min="0" value={e.bathrooms ?? ''} onChange={(ev) => onSetField('bathrooms', ev.target.value === '' ? undefined : Number(ev.target.value))} />
            </Field>
            <Field label="Age (years)" span={3}>
              <input className="input" type="number" min="0" value={e.ageYears ?? ''} onChange={(ev) => onSetField('ageYears', ev.target.value === '' ? undefined : Number(ev.target.value))} />
            </Field>
            <Field label="Furnishing" span={6}>
              <input className="input" value={e.furnishing || ''} onChange={(ev) => onSetField('furnishing', ev.target.value || undefined)} />
            </Field>
            <Field label="Availability" span={6}>
              <input className="input" value={e.availability || ''} onChange={(ev) => onSetField('availability', ev.target.value || undefined)} />
            </Field>
            <Field label="Full address" span={12}>
              <input className="input" value={e.fullAddress || ''} onChange={(ev) => onSetField('fullAddress', ev.target.value || undefined)} />
            </Field>
            <Field label="Commute NUS (min)" span={4}>
              <input className="input" type="number" min="0" value={e.commuteMins?.NUS ?? ''} onChange={(ev) => onSetCommute('NUS', ev.target.value)} />
            </Field>
            <Field label="Commute NTU (min)" span={4}>
              <input className="input" type="number" min="0" value={e.commuteMins?.NTU ?? ''} onChange={(ev) => onSetCommute('NTU', ev.target.value)} />
            </Field>
            <Field label="Commute SMU (min)" span={4}>
              <input className="input" type="number" min="0" value={e.commuteMins?.SMU ?? ''} onChange={(ev) => onSetCommute('SMU', ev.target.value)} />
            </Field>
          </div>
          {blockers.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--orange)' }}>
              Poster blockers: <strong>{blockers.join(', ')}</strong>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
