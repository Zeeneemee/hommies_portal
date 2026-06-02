import React from 'react'
import { useMutation, useAction } from 'convex/react'
import { Icon, Field } from './ui.jsx'
import { renderPosterToBlob } from '../poster/generate.jsx'
import { resizeImageToJpeg, blobToBase64 } from '../poster/encode.js'

// Screen 1 — radically simplified.
//
// The admin captures only what is genuinely in a WhatsApp forward: a property
// name and a few photos. Below the form, the Generate poster prompt card
// builds a brief Claude's /room-showcase-pdf skill uses to produce the
// poster — Claude derives the physical details from the photos, prints a
// labeled Facts block, and the portal lifts those values back from the PDF
// via poster extraction. Optionally attach the finished poster pre-save so
// extraction runs on the very first save.

const IMAGE_CAP = 12
const VIDEO_MAX_BYTES = 200 * 1024 * 1024
const VIDEO_MIME_TYPES = ['video/mp4', 'video/quicktime', 'video/webm']

export default function AddProperty({ toast, onSaved, draft }) {
  const addProperty = useMutation('properties:add')
  const generateUploadUrl = useMutation('properties:generateUploadUrl')
  const extractPosterDetails = useAction('extraction:extractPosterDetails')
  const extractPropertyGuruUrl = useAction('extraction:extractPropertyGuruUrl')
  const fetchImagesAsData = useAction('extraction:fetchImagesAsData')
  const generatePosterContent = useAction('ai:generatePosterContent')

  // Form state is owned by App.jsx (via useAddPropertyDraft) so navigation
  // between sidebar tabs doesn't unmount it. draft.reset() wipes the form
  // and clears the localStorage-backed condo name.
  const {
    condo, setCondo,
    images, setImages,
    posterFile, setPosterFile,
    videoFile, setVideoFile,
    extracted, setExtracted,
    projectUrl, setProjectUrl,
  } = draft
  const [saving, setSaving] = React.useState(false)
  const [pgUrl, setPgUrl] = React.useState('')
  const [extracting, setExtracting] = React.useState(false)
  const [generatingPoster, setGeneratingPoster] = React.useState(false)
  // null = auto-highlight the campus with the lowest commute time.
  // The manual chips below still allow operator override.
  const [primaryUni, setPrimaryUni] = React.useState(null)
  const imagesRef = React.useRef(null)
  const posterRef = React.useRef(null)
  const videoRef = React.useRef(null)

  // Object URL kept in sync with posterFile so we can offer a "View" link
  // (and any future inline preview). Revoked on change to avoid leaking.
  const [posterPreviewUrl, setPosterPreviewUrl] = React.useState(null)
  React.useEffect(() => {
    if (!posterFile) {
      setPosterPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(posterFile)
    setPosterPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [posterFile])

  const [videoPreviewUrl, setVideoPreviewUrl] = React.useState(null)
  React.useEffect(() => {
    if (!videoFile) {
      setVideoPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(videoFile)
    setVideoPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [videoFile])

  // What we still need before we can call Gemini. The button stays clickable
  // either way; the handler turns the missing list into a clear toast and the
  // status line below the button surfaces it ahead of the click.
  const posterBlockers = React.useMemo(() => {
    const e = extracted || {}
    const missing = []
    if (condo.trim().length === 0) missing.push('condo name')
    if (!(typeof e.rentSGD === 'number' && e.rentSGD > 0)) missing.push('rent')
    if (!e.housingType) missing.push('housing type')
    if (images.length < 1) missing.push('at least one image')
    return missing
  }, [condo, extracted, images.length])
  const canGeneratePoster = posterBlockers.length === 0

  async function handleGeneratePoster() {
    console.group('[poster] generate')
    console.log('[poster] start', {
      condo: condo.trim(),
      imagesCount: images.length,
      hasExtracted: !!extracted,
      extractedKeys: extracted ? Object.keys(extracted) : [],
      canGeneratePoster,
    })
    if (!canGeneratePoster) {
      console.warn('[poster] aborted: canGeneratePoster=false')
      console.groupEnd()
      toast('Need a condo name, rent, housing type, and at least one image — extract from a link first.')
      return
    }
    setGeneratingPoster(true)
    try {
      // 1. Resize + base64 each local image (cap at 8 sent to Gemini).
      console.log('[poster] step 1: resizing images')
      const inline = []
      const resizeFailures = []
      for (let i = 0; i < Math.min(images.length, 8); i++) {
        const img = images[i]
        try {
          const resized = await resizeImageToJpeg(img.file, 1024, 0.82)
          const dataB64 = await blobToBase64(resized)
          inline.push({ name: img.name, mimeType: 'image/jpeg', dataB64 })
          console.log(`[poster]   img[${i}] ${img.name} → ${(resized.size / 1024).toFixed(0)}KB`)
        } catch (err) {
          resizeFailures.push({ idx: i, name: img.name, error: String(err?.message || err) })
          console.warn(`[poster]   img[${i}] resize failed:`, err)
        }
      }
      console.log('[poster] resize done', { ok: inline.length, failed: resizeFailures.length })
      if (inline.length === 0) {
        console.error('[poster] aborted: all image encodes failed', resizeFailures)
        console.groupEnd()
        toast('Could not encode any images for Gemini.')
        return
      }

      // 2. Build property arg, stripping undefined keys so Convex's v.optional
      // validators don't reject explicit undefined values.
      const propertyArg = { condo: condo.trim() }
      const e = extracted || {}
      if (typeof e.rentSGD === 'number') propertyArg.rentSGD = e.rentSGD
      if (e.area) propertyArg.area = e.area
      if (e.buildingType === 'Condo' || e.buildingType === 'HDB') propertyArg.buildingType = e.buildingType
      if (e.housingType === 'Room' || e.housingType === 'Whole Unit') propertyArg.housingType = e.housingType
      if (e.unitType) propertyArg.unitType = e.unitType
      if (typeof e.ageYears === 'number') propertyArg.ageYears = e.ageYears
      if (e.fullAddress) propertyArg.fullAddress = e.fullAddress
      if (e.commuteMins && typeof e.commuteMins === 'object') propertyArg.commuteMins = e.commuteMins
      // Listing-page facts the URL extractor lifts on top of the schema fields.
      if (typeof e.sizeSqft === 'number') propertyArg.sizeSqft = e.sizeSqft
      if (typeof e.bedrooms === 'number') propertyArg.bedrooms = e.bedrooms
      if (typeof e.bathrooms === 'number') propertyArg.bathrooms = e.bathrooms
      if (e.furnishing) propertyArg.furnishing = e.furnishing
      if (e.availability) propertyArg.availability = e.availability
      if (e.listingTitle) propertyArg.listingTitle = e.listingTitle
      console.log('[poster] step 2: calling generatePosterContent', {
        propertyArg,
        imageCount: inline.length,
        projectUrl,
        primaryUni,
      })

      const res = await generatePosterContent({
        property: propertyArg,
        images: inline,
        projectUrl: projectUrl || undefined,
        ...(primaryUni ? { primaryUni } : {}),
      })
      console.log('[poster] gemini response', res)
      if (!res?.ok || !res.content) {
        console.error('[poster] gemini returned not-ok', res)
        console.groupEnd()
        toast(`Poster generation failed: ${res?.note || 'no content'}`)
        return
      }

      // 3. Render the PDF in the browser.
      console.log('[poster] step 3: rendering PDF in browser', { primaryUni })
      const posterProperty = {
        ...propertyArg,
        images: images.map((i) => ({ previewUrl: i.previewUrl })),
        // Pasted PropertyGuru URL goes onto the poster as a footnote so
        // operators sharing the PDF on WhatsApp keep a path back to the
        // original listing. Skipped when the property was entered manually.
        listingUrl: pgUrl?.trim() || undefined,
      }
      const { blob, filename } = await renderPosterToBlob(posterProperty, res.content, primaryUni)
      console.log('[poster] render done', { filename, sizeKB: Math.round(blob.size / 1024), type: blob.type })

      // 4. Wrap the Blob as a File and slot it into posterFile.
      const file = new File([blob], filename, { type: 'application/pdf' })
      setPosterFile(file)
      console.log('[poster] posterFile set — will upload on Save')
      console.groupEnd()
      toast(`Poster generated (${(blob.size / 1024).toFixed(0)} KB) — saves with the property.`)
    } catch (err) {
      console.error('[poster] FAILED', err)
      console.groupEnd()
      toast(`Generate failed: ${err.message || err}`)
    } finally {
      setGeneratingPoster(false)
    }
  }

  async function handleExtractUrl() {
    const url = pgUrl.trim()
    if (!url) {
      toast('Paste a PropertyGuru listing URL first.')
      return
    }
    setExtracting(true)
    try {
      const res = await extractPropertyGuruUrl({ url })
      console.log('[extract] response', res)
      if (!res?.ok) {
        toast(res?.error || 'Nothing could be lifted from that link.')
        return
      }
      if (res.suggestedCondo && !condo.trim()) setCondo(res.suggestedCondo)
      setExtracted(res.fields || {})
      if (res.projectUrl) setProjectUrl(res.projectUrl)
      const lifted = Object.keys(res.fields || {})
      // If we got images but zero fields, the Gemini extraction call failed
      // (rate limit / model error) while the regex-only image scrape worked.
      // Surface the note so the operator knows to retry or switch models
      // instead of assuming the listing simply has no data.
      if (lifted.length === 0 && res.note) {
        console.warn('[extract] no fields lifted — note:', res.note)
        toast(`Field extraction failed: ${res.note.slice(0, 160)}`)
        return
      }

      // Pull images server-side (PG CDN isn't CORS-friendly) and merge them
      // into draft.images as Files. From there they participate in the same
      // grid, the poster prompt generator, and the save-time upload — no
      // parallel pipeline needed. We respect the IMAGE_CAP so manual uploads
      // and extracted images share the same 12-slot budget.
      let imageMsg = ''
      const remoteUrls = Array.isArray(res.imageUrls) ? res.imageUrls : []
      if (remoteUrls.length) {
        const room = IMAGE_CAP - images.length
        if (room <= 0) {
          imageMsg = ` Skipped ${remoteUrls.length} listing images — already at ${IMAGE_CAP}.`
        } else {
          const slice = remoteUrls.slice(0, room)
          try {
            const fetched = await fetchImagesAsData({ urls: slice })
            const next = (fetched.images || []).map((img, i) => {
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
            if (next.length) setImages((prev) => [...prev, ...next])
            const skipped = (fetched.skipped || []).length
            imageMsg = ` Pulled ${next.length} image${next.length === 1 ? '' : 's'}${skipped ? `, skipped ${skipped}` : ''}.`
          } catch (err) {
            imageMsg = ` Image fetch failed: ${err.message || err}`
          }
        }
      }

      toast(
        (lifted.length
          ? `Lifted ${lifted.length} field${lifted.length === 1 ? '' : 's'}.`
          : 'Got the condo name only.') + imageMsg,
      )
    } catch (err) {
      toast(`Extract failed: ${err.message || err}`)
    } finally {
      setExtracting(false)
    }
  }

  function handleImagesPicked(files) {
    if (!files?.length) return
    const room = IMAGE_CAP - images.length
    if (room <= 0) {
      toast(`You've already attached the maximum of ${IMAGE_CAP} images.`)
      return
    }
    const incoming = Array.from(files).slice(0, room)
    const skipped = files.length - incoming.length
    const nonImages = incoming.filter((f) => !f.type.startsWith('image/'))
    if (nonImages.length) {
      toast(`Skipped ${nonImages.length} file${nonImages.length === 1 ? '' : 's'} — images only.`)
    }
    const valid = incoming.filter((f) => f.type.startsWith('image/'))
    const next = valid.map((file) => ({
      file,
      name: file.name,
      size: file.size,
      contentType: file.type,
      previewUrl: URL.createObjectURL(file),
    }))
    setImages((prev) => [...prev, ...next])
    if (skipped > 0) toast(`Capped at ${IMAGE_CAP} images — ${skipped} not added.`)
    if (imagesRef.current) imagesRef.current.value = ''
  }

  function removeImage(idx) {
    setImages((prev) => {
      const copy = [...prev]
      const [removed] = copy.splice(idx, 1)
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl)
      return copy
    })
  }

  function handlePosterPicked(file) {
    if (!file) {
      setPosterFile(null)
      return
    }
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      toast('Poster must be a PDF — that is the /room-showcase-pdf output.')
      if (posterRef.current) posterRef.current.value = ''
      return
    }
    setPosterFile(file)
  }

  function handleVideoPicked(file) {
    if (!file) {
      setVideoFile(null)
      return
    }
    const lower = file.name.toLowerCase()
    const isAllowedMime = VIDEO_MIME_TYPES.includes(file.type)
    const isAllowedExt = ['.mp4', '.mov', '.webm'].some((ext) => lower.endsWith(ext))
    if (!isAllowedMime && !isAllowedExt) {
      toast('Video must be an MP4, MOV, or WebM file.')
      if (videoRef.current) videoRef.current.value = ''
      return
    }
    if (file.size > VIDEO_MAX_BYTES) {
      toast(`Video is ${(file.size / 1024 / 1024).toFixed(0)} MB — keep it under 200 MB.`)
      if (videoRef.current) videoRef.current.value = ''
      return
    }
    setVideoFile(file)
  }

  async function uploadBlob(file) {
    const uploadUrl = await generateUploadUrl()
    const res = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    })
    if (!res.ok) throw new Error(`upload failed (${res.status})`)
    const { storageId } = await res.json()
    return storageId
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!condo.trim()) {
      toast('Name the property to add.')
      return
    }
    if (images.length === 0 && !videoFile) {
      toast('Attach at least one image or a walk-through video.')
      return
    }
    setSaving(true)
    try {
      // 1. Upload every image.
      const uploadedImages = []
      for (const img of images) {
        const storageId = await uploadBlob(img.file)
        uploadedImages.push({ storageId, name: img.name, size: img.size, contentType: img.contentType })
      }

      // 2. Optionally upload the walk-through video (reference-only, never
      // referenced by the poster or extraction).
      let videoStorageId
      let videoName
      let videoSize
      let videoContentType
      if (videoFile) {
        videoStorageId = await uploadBlob(videoFile)
        videoName = videoFile.name
        videoSize = videoFile.size
        videoContentType = videoFile.type || undefined
      }

      // 3. Optionally upload the poster.
      let posterStorageId
      let posterName
      let posterSize
      if (posterFile) {
        posterStorageId = await uploadBlob(posterFile)
        posterName = posterFile.name
        posterSize = posterFile.size
      }

      // 4. Create the property record. Only the schema-accepted extracted
      // fields are spread; the URL extractor lifts more (sizeSqft, furnishing,
      // availability, etc.) but properties:add doesn't accept those yet —
      // they're poster-only for now.
      const SAVE_FIELDS = [
        'rentSGD', 'area', 'buildingType', 'housingType',
        'ageYears', 'unitType', 'fullAddress', 'commuteMins',
        'masterCount', 'commonCount',
      ]
      const savable = {}
      for (const k of SAVE_FIELDS) if (extracted?.[k] !== undefined) savable[k] = extracted[k]
      const id = await addProperty({
        condo: condo.trim(),
        images: uploadedImages,
        posterStorageId,
        posterName,
        posterSize,
        videoStorageId,
        videoName,
        videoSize,
        videoContentType,
        ...savable,
      })

      // 5. If a poster was attached, kick off extraction — it patches the
      // property with whatever it can lift from the PDF text.
      if (posterStorageId) {
        try {
          const result = await extractPosterDetails({ id })
          if (result?.ok) {
            toast(`${condo} added — poster extracted (${result.liftedFields.length} fields).`)
          } else {
            toast(`${condo} added — poster attached, extraction found no fields.`)
          }
        } catch (err) {
          toast(`${condo} added — extraction failed: ${err.message || err}`)
        }
      } else {
        toast(`${condo} added — make the poster in /room-showcase-pdf and attach it on Status.`)
      }

      // 6. Reset and route to Status. draft.reset() revokes preview URLs,
      // clears the in-memory File state, and removes the localStorage condo.
      draft.reset()
      if (imagesRef.current) imagesRef.current.value = ''
      if (posterRef.current) posterRef.current.value = ''
      if (videoRef.current) videoRef.current.value = ''
      onSaved?.()
    } catch (err) {
      toast(`Save failed: ${err.message || err}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="page-header">
        <div>
          <div className="eyebrow">Step 1 · Intake</div>
          <h1 className="page-title">Add a property</h1>
          <p className="page-sub">
            Drop the name and the photos in. Generate the brief for{' '}
            <strong style={{ color: 'var(--navy)' }}>/room-showcase-pdf</strong>, paste it into a Claude chat, and
            upload the poster back here — the rest of the property's details get lifted from the PDF for you.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => draft.reset()}
          >
            Clear
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-head">
          <h3 className="card-title">Have a PropertyGuru link?</h3>
          <p className="card-sub">
            Paste a listing URL — we'll fetch it and lift rent, area, building type, and the condo name. Some
            listings sit behind a Cloudflare challenge and will need manual entry instead.
          </p>
        </div>
        <div className="card-pad">
          <div style={{ display: 'flex', gap: 10, alignItems: 'stretch' }}>
            <input
              className="input"
              type="url"
              value={pgUrl}
              onChange={(e) => setPgUrl(e.target.value)}
              placeholder="https://www.propertyguru.com.sg/listing/…"
              style={{ flex: 1 }}
              disabled={extracting}
            />
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleExtractUrl}
              disabled={extracting || !pgUrl.trim()}
            >
              {extracting ? 'Extracting…' : 'Extract details'}
            </button>
          </div>
          {extracted && Object.keys(extracted).length > 0 && (
            <div
              style={{
                marginTop: 10,
                display: 'flex',
                flexWrap: 'wrap',
                gap: 6,
                fontSize: 12,
                color: 'var(--muted)',
              }}
            >
              <span style={{ alignSelf: 'center', fontWeight: 600, color: 'var(--ink)' }}>Lifted:</span>
              {Object.entries(extracted).map(([k, v]) => (
                <span
                  key={k}
                  style={{
                    background: 'var(--cream, #fff8ec)',
                    border: '1px solid var(--border, #e6e1d4)',
                    borderRadius: 999,
                    padding: '2px 10px',
                  }}
                >
                  {k}: {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                </span>
              ))}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setExtracted(null)}
              >
                Clear
              </button>
            </div>
          )}
        </div>
      </div>

      <PropertyDetailsCard
        condo={condo}
        extracted={extracted}
        setExtracted={setExtracted}
        toast={toast}
      />

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-head">
          <h3 className="card-title">Property</h3>
          <p className="card-sub">A name plus at least one photo or a walk-through video — that's the whole intake.</p>
        </div>
        <div className="card-pad">
          <div className="form-grid">
            <Field label="Condo / HDB name" required span={12}>
              <input
                className="input"
                value={condo}
                onChange={(e) => setCondo(e.target.value)}
                placeholder="e.g. Normanton Park"
              />
            </Field>
          </div>

          <div style={{ marginTop: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>
                Images <span style={{ color: 'var(--ink-mute)', fontWeight: 400 }}>(optional if a video is attached)</span>
              </div>
              <div className="field-hint">
                {images.length} of {IMAGE_CAP} attached
              </div>
            </div>

            <div className="image-grid">
              {images.map((img, i) => (
                <div key={img.previewUrl} className="image-tile">
                  <img src={img.previewUrl} alt={img.name} />
                  <button
                    type="button"
                    className="image-tile-remove"
                    onClick={() => removeImage(i)}
                    aria-label={`Remove ${img.name}`}
                  >
                    <Icon name="x" size={12} />
                  </button>
                  <div className="image-tile-meta" title={img.name}>
                    {img.name}
                  </div>
                </div>
              ))}
              {images.length < IMAGE_CAP && (
                <button
                  type="button"
                  className="image-tile image-tile-add"
                  onClick={() => imagesRef.current?.click()}
                >
                  <Icon name="upload" size={20} />
                  <span>{images.length === 0 ? 'Add photos' : 'Add more'}</span>
                </button>
              )}
            </div>
            <input
              ref={imagesRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => handleImagesPicked(e.target.files)}
            />
          </div>
        </div>
      </div>

<div className="card" style={{ marginBottom: 18 }}>
        <div className="card-head">
          <h3 className="card-title">Walk-through video (optional)</h3>
          <p className="card-sub">
            Reference-only — the video is not used in the poster. Stored alongside the listing so the
            team can re-watch the unit later. MP4 / MOV / WebM up to 200 MB.
          </p>
        </div>
        <div className="card-pad">
          <label className={`upload ${videoFile ? 'has-file' : ''}`}>
            <input
              ref={videoRef}
              type="file"
              accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
              style={{ display: 'none' }}
              onChange={(e) => handleVideoPicked(e.target.files?.[0])}
            />
            <div className="upload-icon">
              <Icon name={videoFile ? 'play' : 'upload'} size={20} />
            </div>
            <div className="upload-text" style={{ flex: 1 }}>
              {videoFile ? (
                <>
                  <strong>{videoFile.name}</strong>
                  <span>{(videoFile.size / 1024 / 1024).toFixed(1)} MB · ready to upload on save.</span>
                </>
              ) : (
                <>
                  <strong>Click to attach a walk-through video</strong>
                  <span>Or skip — videos are optional. Add or replace later from Listings.</span>
                </>
              )}
            </div>
            {videoFile && (
              <div style={{ display: 'flex', gap: 6 }}>
                {videoPreviewUrl && (
                  <a
                    href={videoPreviewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-ghost btn-sm"
                    onClick={(e) => e.stopPropagation()}
                    title="Open this video in a new tab"
                  >
                    View
                  </a>
                )}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={(e) => {
                    e.preventDefault()
                    handleVideoPicked(null)
                  }}
                >
                  Remove
                </button>
              </div>
            )}
          </label>
        </div>
      </div>

<div className="card">
        <div className="card-head">
          <h3 className="card-title">Poster PDF (optional on save)</h3>
          <p className="card-sub">
            Two paths: <strong style={{ color: 'var(--navy)' }}>Generate in-portal</strong> uses the extracted facts +
            Gemini to make a Hommies-branded PDF right here. Or attach the finished{' '}
            <strong style={{ color: 'var(--navy)' }}>/room-showcase-pdf</strong> output from Claude. Either way,
            extraction runs on save.
          </p>
        </div>
        <div className="card-pad">
          <div
            style={{
              display: 'flex',
              gap: 12,
              marginBottom: 12,
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleGeneratePoster}
              disabled={generatingPoster}
              title={
                canGeneratePoster
                  ? 'Use the extracted facts + Gemini to render a 3-page poster PDF in-portal'
                  : `Missing: ${posterBlockers.join(', ')}`
              }
            >
              <Icon name="sparkle" size={12} />
              {generatingPoster
                ? ' Generating poster…'
                : posterFile
                  ? ' Regenerate poster'
                  : ' Generate poster in-portal'}
            </button>
            {posterPreviewUrl && (
              <a
                href={posterPreviewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-ghost btn-sm"
                title="Open the current poster PDF in a new tab"
              >
                View poster ↗
              </a>
            )}
          </div>
          {!canGeneratePoster && !generatingPoster && (
            <div
              style={{
                fontSize: 12,
                color: 'var(--orange)',
                marginBottom: 10,
                padding: '6px 10px',
                background: 'var(--cream, #fff8ec)',
                border: '1px solid var(--orange)',
                borderRadius: 6,
              }}
            >
              Cannot generate yet — missing: <strong>{posterBlockers.join(', ')}</strong>. Paste a PropertyGuru link and click Extract first.
            </div>
          )}
          <label className={`upload ${posterFile ? 'has-file' : ''}`}>
            <input
              ref={posterRef}
              type="file"
              accept="application/pdf,.pdf"
              style={{ display: 'none' }}
              onChange={(e) => handlePosterPicked(e.target.files?.[0])}
            />
            <div className="upload-icon">
              <Icon name={posterFile ? 'pdf' : 'upload'} size={20} />
            </div>
            <div className="upload-text" style={{ flex: 1 }}>
              {posterFile ? (
                <>
                  <strong>{posterFile.name}</strong>
                  <span>{(posterFile.size / 1024).toFixed(0)} KB · ready to upload on save.</span>
                </>
              ) : (
                <>
                  <strong>Click to attach the poster PDF</strong>
                  <span>Or skip — you can attach it later from Status.</span>
                </>
              )}
            </div>
            {posterFile && (
              <div style={{ display: 'flex', gap: 6 }}>
                {posterPreviewUrl && (
                  <a
                    href={posterPreviewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-ghost btn-sm"
                    onClick={(e) => e.stopPropagation()}
                    title="Open this poster in a new tab"
                  >
                    View
                  </a>
                )}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={(e) => {
                    e.preventDefault()
                    handlePosterPicked(null)
                  }}
                >
                  Remove
                </button>
              </div>
            )}
          </label>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          marginTop: 18,
        }}
      >
        <button type="submit" className="btn btn-primary" disabled={saving}>
          <Icon name="plus" size={14} /> {saving ? 'Saving…' : 'Save property'}
        </button>
      </div>
    </form>
  )
}

// Editable Property Details card — sits between the PG-link card and the
// Property card. Inputs are bound to draft.extracted so the URL extractor and
// manual entry feed the same source of truth. Empty inputs delete the key
// rather than storing empty strings, so the poster generator's "field
// present?" checks stay simple.
function PropertyDetailsCard({ extracted, setExtracted }) {
  const e = extracted || {}
  const setField = React.useCallback(
    (key, value) => {
      setExtracted((prev) => {
        const next = { ...(prev || {}) }
        if (value === '' || value === null || value === undefined) delete next[key]
        else next[key] = value
        return next
      })
    },
    [setExtracted],
  )
  const setNumber = (key) => (ev) => {
    const v = ev.target.value
    if (v === '') return setField(key, undefined)
    const n = Number(v)
    setField(key, Number.isFinite(n) ? n : undefined)
  }
  const setString = (key) => (ev) => setField(key, ev.target.value || undefined)
  const setCommute = (uni) => (ev) => {
    const v = ev.target.value
    const n = v === '' ? undefined : Number(v)
    setExtracted((prev) => {
      const c = { ...(prev?.commuteMins || {}) }
      if (n == null || !Number.isFinite(n)) delete c[uni]
      else c[uni] = n
      const next = { ...(prev || {}) }
      if (c.NUS != null && c.NTU != null && c.SMU != null) next.commuteMins = c
      else delete next.commuteMins
      return next
    })
  }

  const filledCount = [
    'listingTitle', 'rentSGD', 'housingType', 'buildingType', 'area',
    'unitType', 'sizeSqft', 'bedrooms', 'bathrooms', 'furnishing',
    'availability', 'fullAddress', 'ageYears', 'commuteMins',
  ].filter((k) => e[k] !== undefined).length

  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div className="card-head">
        <h3 className="card-title">Property details</h3>
        <p className="card-sub">
          Auto-filled by the PropertyGuru extractor — edit anything wrong, or fill from scratch if you're not using a
          listing link. The poster generator reads these. <strong>{filledCount}</strong> field
          {filledCount === 1 ? '' : 's'} set.
        </p>
      </div>
      <div className="card-pad">
        <div className="form-grid">
          <Field label="Listing title (poster headline)" span={12}>
            <input
              className="input"
              value={e.listingTitle || ''}
              onChange={setString('listingTitle')}
              placeholder="e.g. 1 Bedroom Studio (Type A2) — high floor, balcony"
            />
          </Field>

          <Field label="Rent (S$ / month)" span={4}>
            <input
              className="input"
              type="number"
              min="0"
              value={e.rentSGD ?? ''}
              onChange={setNumber('rentSGD')}
              placeholder="e.g. 3300"
            />
          </Field>
          <Field label="Housing type" span={4}>
            <select
              className="input"
              value={e.housingType || ''}
              onChange={setString('housingType')}
            >
              <option value="">—</option>
              <option value="Room">Room</option>
              <option value="Whole Unit">Whole Unit</option>
            </select>
          </Field>
          <Field label="Building type" span={4}>
            <select
              className="input"
              value={e.buildingType || ''}
              onChange={setString('buildingType')}
            >
              <option value="">—</option>
              <option value="Condo">Condo</option>
              <option value="HDB">HDB</option>
            </select>
          </Field>

          <Field label="Area / neighbourhood" span={6}>
            <input
              className="input"
              value={e.area || ''}
              onChange={setString('area')}
              placeholder="e.g. Kent Ridge"
            />
          </Field>
          <Field label="Room / unit type" span={6}>
            <input
              className="input"
              value={e.unitType || ''}
              onChange={setString('unitType')}
              placeholder="e.g. Master Room / Studio"
            />
          </Field>

          <Field label="Size (sqft)" span={3}>
            <input
              className="input"
              type="number"
              min="0"
              value={e.sizeSqft ?? ''}
              onChange={setNumber('sizeSqft')}
              placeholder="474"
            />
          </Field>
          <Field label="Bedrooms" span={3}>
            <input
              className="input"
              type="number"
              min="0"
              value={e.bedrooms ?? ''}
              onChange={setNumber('bedrooms')}
              placeholder="1"
            />
          </Field>
          <Field label="Bathrooms" span={3}>
            <input
              className="input"
              type="number"
              min="0"
              value={e.bathrooms ?? ''}
              onChange={setNumber('bathrooms')}
              placeholder="1"
            />
          </Field>
          <Field label="Age (years)" span={3}>
            <input
              className="input"
              type="number"
              min="0"
              value={e.ageYears ?? ''}
              onChange={setNumber('ageYears')}
              placeholder="6"
            />
          </Field>

          <Field label="Furnishing" span={6}>
            <input
              className="input"
              value={e.furnishing || ''}
              onChange={setString('furnishing')}
              placeholder="e.g. Fully furnished — queen bed, sofa, full kitchen"
            />
          </Field>
          <Field label="Availability" span={6}>
            <input
              className="input"
              value={e.availability || ''}
              onChange={setString('availability')}
              placeholder="e.g. Ready to move in / 1 Jul 2026"
            />
          </Field>

          <Field label="Full address" span={12}>
            <input
              className="input"
              value={e.fullAddress || ''}
              onChange={setString('fullAddress')}
              placeholder="e.g. 51 Lakeside Drive, Singapore 648271"
            />
          </Field>

          <Field label="Commute to NUS (min)" span={4}>
            <input
              className="input"
              type="number"
              min="0"
              value={e.commuteMins?.NUS ?? ''}
              onChange={setCommute('NUS')}
              placeholder="45"
            />
          </Field>
          <Field label="Commute to NTU (min)" span={4}>
            <input
              className="input"
              type="number"
              min="0"
              value={e.commuteMins?.NTU ?? ''}
              onChange={setCommute('NTU')}
              placeholder="30"
            />
          </Field>
          <Field label="Commute to SMU (min)" span={4}>
            <input
              className="input"
              type="number"
              min="0"
              value={e.commuteMins?.SMU ?? ''}
              onChange={setCommute('SMU')}
              placeholder="50"
            />
          </Field>
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 8 }}>
          Tip: all three commute values are needed for the recommend engine to score this property. Empty fields are
          fine — the poster simply omits the section.
        </div>
      </div>
    </div>
  )
}
