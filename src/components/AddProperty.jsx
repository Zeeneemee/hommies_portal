import React from 'react'
import { useMutation, useAction } from 'convex/react'
import { Icon, Field } from './ui.jsx'
import PosterPromptCard from './PosterPromptCard.jsx'

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

export default function AddProperty({ toast, onSaved, draft }) {
  const addProperty = useMutation('properties:add')
  const generateUploadUrl = useMutation('properties:generateUploadUrl')
  const extractPosterDetails = useAction('extraction:extractPosterDetails')

  // Form state is owned by App.jsx (via useAddPropertyDraft) so navigation
  // between sidebar tabs doesn't unmount it. draft.reset() wipes the form
  // and clears the localStorage-backed condo name.
  const { condo, setCondo, images, setImages, posterFile, setPosterFile } = draft
  const [saving, setSaving] = React.useState(false)
  const imagesRef = React.useRef(null)
  const posterRef = React.useRef(null)

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
    if (images.length === 0) {
      toast('Attach at least one image to add.')
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

      // 2. Optionally upload the poster.
      let posterStorageId
      let posterName
      let posterSize
      if (posterFile) {
        posterStorageId = await uploadBlob(posterFile)
        posterName = posterFile.name
        posterSize = posterFile.size
      }

      // 3. Create the property record.
      const id = await addProperty({
        condo: condo.trim(),
        images: uploadedImages,
        posterStorageId,
        posterName,
        posterSize,
      })

      // 4. If a poster was attached, kick off extraction — it patches the
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

      // 5. Reset and route to Status. draft.reset() revokes preview URLs,
      // clears the in-memory File state, and removes the localStorage condo.
      draft.reset()
      if (imagesRef.current) imagesRef.current.value = ''
      if (posterRef.current) posterRef.current.value = ''
      onSaved?.()
    } catch (err) {
      toast(`Save failed: ${err.message || err}`)
    } finally {
      setSaving(false)
    }
  }

  // The PosterPromptCard base64-encodes each image's File and ships it to
  // the Gemini Vision action — so we pass the actual File blobs (with metadata)
  // rather than just names. Pre-save state; no Convex storage involvement here.
  const promptForm = React.useMemo(
    () => ({
      condo,
      images: images.map((i) => ({
        name: i.name,
        size: i.size,
        contentType: i.contentType,
        file: i.file,
      })),
    }),
    [condo, images],
  )

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
          <h3 className="card-title">Property</h3>
          <p className="card-sub">A name and at least one photo — that's the whole intake.</p>
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
                Images <span style={{ color: 'var(--orange)' }}>*</span>
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

      <PosterPromptCard form={promptForm} toast={toast} />

      <div className="card">
        <div className="card-head">
          <h3 className="card-title">Poster PDF (optional on save)</h3>
          <p className="card-sub">
            Attach the finished <strong style={{ color: 'var(--navy)' }}>/room-showcase-pdf</strong> output now if you
            have it — extraction runs on save and the property's details land in Listings. Otherwise add the property
            now and attach the poster on Status when it's ready.
          </p>
        </div>
        <div className="card-pad">
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
