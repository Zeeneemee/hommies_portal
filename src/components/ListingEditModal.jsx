import React from 'react'
import { useMutation } from 'convex/react'
import { Icon, Field, Segment } from './ui.jsx'

const VIDEO_MAX_BYTES = 200 * 1024 * 1024
const VIDEO_MIME_TYPES = ['video/mp4', 'video/quicktime', 'video/webm']

// Edit modal for a single property. Descriptive fields go through
// properties:update, which strips undefined keys before patching. Video
// changes go through properties:setVideo — the canonical replace/clear
// path that also cleans up the previously stored blob.
export default function ListingEditModal({ property, onClose, onSave, toast }) {
  const generateUploadUrl = useMutation('properties:generateUploadUrl')
  const setVideo = useMutation('properties:setVideo')
  // Video state — three possible pending intents:
  //   { kind: 'keep' }    — leave the stored video as-is
  //   { kind: 'replace', file: File }
  //   { kind: 'clear' }   — clear the stored video on save
  const [videoIntent, setVideoIntent] = React.useState({ kind: 'keep' })
  const videoRef = React.useRef(null)
  const [pendingPreviewUrl, setPendingPreviewUrl] = React.useState(null)
  React.useEffect(() => {
    if (videoIntent.kind !== 'replace') {
      setPendingPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(videoIntent.file)
    setPendingPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [videoIntent])

  function handleVideoPicked(file) {
    if (!file) return
    const lower = file.name.toLowerCase()
    const isAllowedMime = VIDEO_MIME_TYPES.includes(file.type)
    const isAllowedExt = ['.mp4', '.mov', '.webm'].some((ext) => lower.endsWith(ext))
    if (!isAllowedMime && !isAllowedExt) {
      toast?.('Video must be an MP4, MOV, or WebM file.')
      if (videoRef.current) videoRef.current.value = ''
      return
    }
    if (file.size > VIDEO_MAX_BYTES) {
      toast?.(`Video is ${(file.size / 1024 / 1024).toFixed(0)} MB — keep it under 200 MB.`)
      if (videoRef.current) videoRef.current.value = ''
      return
    }
    setVideoIntent({ kind: 'replace', file })
  }

  async function commitVideoIntent() {
    if (videoIntent.kind === 'keep') return
    if (videoIntent.kind === 'clear') {
      await setVideo({ id: property._id, storageId: null })
      return
    }
    // replace
    const file = videoIntent.file
    const uploadUrl = await generateUploadUrl()
    const res = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    })
    if (!res.ok) throw new Error(`video upload failed (${res.status})`)
    const { storageId } = await res.json()
    await setVideo({
      id: property._id,
      storageId,
      name: file.name,
      size: file.size,
      contentType: file.type || undefined,
    })
  }

  const [f, setF] = React.useState({
    condo: property.condo || '',
    rentSGD: property.rentSGD ?? '',
    buildingType: property.buildingType || '',
    unitType: property.unitType || '',
    housingType: property.housingType || '',
    area: property.area || '',
    ageYears: property.ageYears ?? '',
    fullAddress: property.fullAddress || '',
    commuteNUS: property.commuteMins?.NUS ?? '',
    commuteNTU: property.commuteMins?.NTU ?? '',
    commuteSMU: property.commuteMins?.SMU ?? '',
  })
  const upd = (k, v) => setF((s) => ({ ...s, [k]: v }))
  const numOrUndef = (v) => {
    if (v === '' || v == null) return undefined
    const n = Number(v)
    return Number.isFinite(n) ? n : undefined
  }
  const strOrUndef = (v) => {
    const t = (v ?? '').toString().trim()
    return t.length ? t : undefined
  }

  const [busy, setBusy] = React.useState(false)
  async function handleSubmit(e) {
    e.preventDefault()
    if (!f.condo.trim()) return
    const patch = {
      condo: f.condo.trim(),
      rentSGD: numOrUndef(f.rentSGD),
      buildingType:
        f.buildingType === 'Condo' || f.buildingType === 'HDB' ? f.buildingType : undefined,
      unitType: strOrUndef(f.unitType),
      housingType:
        f.housingType === 'Room' || f.housingType === 'Whole Unit' ? f.housingType : undefined,
      area: strOrUndef(f.area),
      ageYears: numOrUndef(f.ageYears),
      fullAddress: strOrUndef(f.fullAddress),
    }
    const nus = numOrUndef(f.commuteNUS)
    const ntu = numOrUndef(f.commuteNTU)
    const smu = numOrUndef(f.commuteSMU)
    if (nus != null && ntu != null && smu != null) {
      patch.commuteMins = { NUS: nus, NTU: ntu, SMU: smu }
    }
    setBusy(true)
    try {
      // Run video change first so a failure surfaces before the descriptive
      // patch goes through — keeps the row + storage consistent.
      await commitVideoIntent()
      onSave(patch)
    } catch (err) {
      toast?.(`Video update failed: ${err.message || err}`)
      setBusy(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(4,31,96,0.4)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 200,
      }}
      onClick={onClose}
    >
      <form
        className="card"
        style={{ width: 640, maxHeight: '90vh', overflow: 'auto' }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div
          className="card-head"
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}
        >
          <div>
            <h3 className="card-title">Edit listing</h3>
            <p className="card-sub">
              Leave a field blank to keep its stored value. Status is changed via the card buttons,
              not here.
            </p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            <Icon name="x" size={14} />
          </button>
        </div>
        <div className="card-pad">
          <div className="form-grid">
            <Field label="Condo / HDB name" required span={12}>
              <input
                className="input"
                value={f.condo}
                onChange={(e) => upd('condo', e.target.value)}
                placeholder="e.g. Normanton Park"
              />
            </Field>

            <Field label="Rent (S$ / mo)" span={4}>
              <input
                className="input"
                inputMode="numeric"
                value={f.rentSGD}
                onChange={(e) => upd('rentSGD', e.target.value)}
                placeholder="e.g. 1800"
              />
            </Field>
            <Field label="Building type" span={4}>
              <select
                className="select"
                value={f.buildingType}
                onChange={(e) => upd('buildingType', e.target.value)}
              >
                <option value="">—</option>
                <option>Condo</option>
                <option>HDB</option>
              </select>
            </Field>
            <Field label="Age (yrs)" span={4}>
              <input
                className="input"
                inputMode="numeric"
                value={f.ageYears}
                onChange={(e) => upd('ageYears', e.target.value)}
                placeholder="e.g. 6"
              />
            </Field>

            <Field label="Room / unit type" span={6}>
              <input
                className="input"
                value={f.unitType}
                onChange={(e) => upd('unitType', e.target.value)}
                placeholder="e.g. 1 Bedroom / 1 Bathroom"
              />
            </Field>
            <Field label="Housing type" span={6}>
              <Segment
                options={['Room', 'Whole Unit']}
                value={f.housingType || 'Room'}
                onChange={(v) => upd('housingType', v)}
              />
            </Field>

            <Field label="Area" span={6}>
              <input
                className="input"
                value={f.area}
                onChange={(e) => upd('area', e.target.value)}
                placeholder="e.g. Kent Ridge"
              />
            </Field>
            <Field label="Full address" span={6}>
              <input
                className="input"
                value={f.fullAddress}
                onChange={(e) => upd('fullAddress', e.target.value)}
                placeholder="e.g. 1 Normanton Park, S119003"
              />
            </Field>

            <Field
              label="Commute (mins to NUS / NTU / SMU)"
              hint="All three needed for the recommend engine"
              span={12}
            >
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="input"
                  inputMode="numeric"
                  value={f.commuteNUS}
                  onChange={(e) => upd('commuteNUS', e.target.value)}
                  placeholder="NUS"
                />
                <input
                  className="input"
                  inputMode="numeric"
                  value={f.commuteNTU}
                  onChange={(e) => upd('commuteNTU', e.target.value)}
                  placeholder="NTU"
                />
                <input
                  className="input"
                  inputMode="numeric"
                  value={f.commuteSMU}
                  onChange={(e) => upd('commuteSMU', e.target.value)}
                  placeholder="SMU"
                />
              </div>
            </Field>
          </div>

          <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--hairline)' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', marginBottom: 8 }}>
              Walk-through video (optional)
            </div>
            <VideoEditor
              currentName={property.videoName}
              currentSize={property.videoSize}
              currentUrl={property.videoUrl}
              intent={videoIntent}
              pendingPreviewUrl={pendingPreviewUrl}
              onPick={() => videoRef.current?.click()}
              onClear={() => setVideoIntent({ kind: 'clear' })}
              onKeep={() => setVideoIntent({ kind: 'keep' })}
            />
            <input
              ref={videoRef}
              type="file"
              accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
              style={{ display: 'none' }}
              onChange={(e) => {
                handleVideoPicked(e.target.files?.[0])
                if (videoRef.current) videoRef.current.value = ''
              }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

function VideoEditor({ currentName, currentSize, currentUrl, intent, pendingPreviewUrl, onPick, onClear, onKeep }) {
  const hasCurrent = !!currentUrl
  if (intent.kind === 'replace') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
        <Icon name="play" size={14} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {intent.file.name}
          </div>
          <div style={{ color: 'var(--ink-mute)' }}>
            {(intent.file.size / 1024 / 1024).toFixed(1)} MB · uploads on Save
            {hasCurrent ? ' (replaces current video)' : ''}
          </div>
        </div>
        {pendingPreviewUrl && (
          <a
            href={pendingPreviewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-ghost btn-sm"
          >
            View
          </a>
        )}
        <button type="button" className="btn btn-ghost btn-sm" onClick={onKeep}>
          Undo
        </button>
      </div>
    )
  }
  if (intent.kind === 'clear') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: 'var(--ink-mute)' }}>
        <Icon name="trash" size={14} />
        <span style={{ flex: 1 }}>Video will be removed on Save.</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onKeep}>
          Undo
        </button>
      </div>
    )
  }
  if (!hasCurrent) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: 'var(--ink-mute)' }}>
        <Icon name="video" size={14} />
        <span style={{ flex: 1 }}>No video attached.</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onPick}>
          Upload video
        </button>
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
      <Icon name="play" size={14} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {currentName || 'Walk-through video'}
        </div>
        {typeof currentSize === 'number' && (
          <div style={{ color: 'var(--ink-mute)' }}>{(currentSize / 1024 / 1024).toFixed(1)} MB</div>
        )}
      </div>
      <a
        href={currentUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="btn btn-ghost btn-sm"
      >
        Open
      </a>
      <a
        href={currentUrl}
        download={currentName || ''}
        className="btn btn-ghost btn-sm"
      >
        Download
      </a>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onPick}>
        Replace
      </button>
      <button type="button" className="btn btn-ghost btn-sm btn-danger" onClick={onClear}>
        Remove
      </button>
    </div>
  )
}
