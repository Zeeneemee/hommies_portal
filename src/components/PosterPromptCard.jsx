import React from 'react'
import { useAction } from 'convex/react'
import { Icon } from './ui.jsx'

// Generate poster prompt card — resizes the uploaded images down to a
// Vision-appropriate size (max 1280 px wide, JPEG quality 0.82) before
// base64-encoding and shipping to the Gemini Convex action. Phone photos
// are typically 3–6 MB raw; resized they land around 100–300 KB each,
// well under Convex's 5 MiB Node-action argument limit.
//
// No static-template fallback: if Gemini fails, the card surfaces the
// error note and Copy stays disabled until a real prompt is produced.

// Convex Node actions cap arguments at 5 MiB total. Stay safely below that
// after base64 inflates the payload by ~33 %.
const MAX_INLINE_TOTAL = 4.5 * 1024 * 1024

const RESIZE_MAX_WIDTH = 1280
const RESIZE_QUALITY = 0.82

export default function PosterPromptCard({ form, toast }) {
  const generate = useAction('ai:generatePosterPrompt')
  const [open, setOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [busyLabel, setBusyLabel] = React.useState('Analysing photos…')
  const [result, setResult] = React.useState(null) // { prompt, source, note }

  const condo = form.condo?.trim() || ''
  const images = Array.isArray(form.images) ? form.images : []
  const ready = !!condo && images.length > 0

  // Reset the prompt when the inputs change — the displayed prompt would
  // no longer match the form otherwise.
  const formKey = `${condo}|${images.map((i) => `${i.name}-${i.size}`).join('|')}`
  React.useEffect(() => {
    setResult(null)
    setOpen(false)
  }, [formKey])

  async function handleGenerate() {
    if (!ready || busy) return
    setBusy(true)
    try {
      setBusyLabel('Resizing photos…')
      const encoded = []
      let total = 0
      for (let i = 0; i < images.length; i++) {
        const img = images[i]
        if (!img.file) throw new Error(`No file blob available for ${img.name}`)
        const resized = await resizeImageToJpeg(img.file, RESIZE_MAX_WIDTH, RESIZE_QUALITY)
        const dataB64 = await blobToBase64(resized)
        const inlineBytes = Math.ceil((dataB64.length * 3) / 4)
        total += inlineBytes
        if (total > MAX_INLINE_TOTAL) {
          toast?.(
            `Resized photos still exceed ~4.5 MB at image ${i + 1} of ${images.length}. Reduce the photo count or shoot at a lower resolution.`,
          )
          return
        }
        encoded.push({
          name: img.name,
          mimeType: 'image/jpeg',
          dataB64,
        })
      }
      setBusyLabel('Asking Gemini Vision…')
      const r = await generate({
        property: { condo, images: encoded },
      })
      setResult(r)
      setOpen(!!r?.prompt)
    } catch (err) {
      toast?.(`Could not reach the prompt generator: ${err.message || err}`)
    } finally {
      setBusy(false)
      setBusyLabel('Analysing photos…')
    }
  }

  function copy() {
    if (!result?.prompt) return
    navigator.clipboard?.writeText(result.prompt)
    toast?.('Poster prompt copied — paste into your room-showcase-pdf chat.')
  }

  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div
        className="card-head"
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}
      >
        <div>
          <h3 className="card-title">Generate poster prompt</h3>
          <p className="card-sub">
            Gemini Vision looks at your photos and writes a short kickoff message for the{' '}
            <strong style={{ color: 'var(--navy)' }}>/room-showcase-pdf</strong> skill — the message names what the
            skill will ask you for and summarises what it sees in the photos.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          {result?.prompt && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen((o) => !o)}>
              {open ? 'Hide' : 'Preview'}
            </button>
          )}
          <button
            type="button"
            className={result?.prompt ? 'btn btn-ghost btn-sm' : 'btn btn-primary btn-sm'}
            onClick={handleGenerate}
            disabled={!ready || busy}
          >
            {busy ? (
              busyLabel
            ) : (
              <>
                <Icon name="sparkle" size={12} /> {result?.prompt ? 'Re-generate' : 'Generate'}
              </>
            )}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={copy}
            disabled={!result?.prompt || busy}
            title={result?.prompt ? 'Copy the message to clipboard' : 'Generate first, then copy'}
          >
            <Icon name="copy" size={12} /> Copy prompt
          </button>
        </div>
      </div>

      {!ready && (
        <div className="card-pad" style={{ paddingTop: 14 }}>
          <div className="empty" style={{ padding: 18, textAlign: 'left' }}>
            <h4 style={{ marginBottom: 2 }}>Name the property and attach at least one photo</h4>
            <p style={{ margin: 0 }}>That's all Gemini Vision needs to write the message.</p>
          </div>
        </div>
      )}

      {ready && (
        <div className="card-pad" style={{ paddingTop: 14 }}>
          <div className="prompt-summary">
            <PromptChip label="Property" value={condo} />
            <PromptChip label="Images" value={`${images.length} (resized for Vision)`} />
          </div>

          {result?.prompt && (
            <div
              style={{
                fontSize: 11,
                color: 'var(--green)',
                fontWeight: 600,
                margin: '12px 0 6px',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                flexWrap: 'wrap',
              }}
            >
              <Icon name="sparkle" size={11} />
              Written by Gemini Vision
              {result.note && (
                <span style={{ color: 'var(--ink-mute)', fontWeight: 400, marginLeft: 4 }}>· {result.note}</span>
              )}
            </div>
          )}

          {result && !result.prompt && (
            <div className="notice notice--warn" style={{ marginTop: 12 }}>
              <strong>Couldn't generate the prompt.</strong>
              <div style={{ fontWeight: 400, marginTop: 4 }}>{result.note || 'No detail provided.'}</div>
            </div>
          )}

          {result?.prompt && open && <pre className="prompt-block">{result.prompt}</pre>}

          <div className="prompt-steps">
            <div className="step">
              <span className="n">1</span> {result ? 'Copy' : 'Generate'} the prompt
            </div>
            <Icon name="arrow-right" size={14} stroke={1.8} />
            <div className="step">
              <span className="n">2</span> Paste into a Claude chat with <code>/room-showcase-pdf</code>, attach the same images
            </div>
            <Icon name="arrow-right" size={14} stroke={1.8} />
            <div className="step">
              <span className="n">3</span> Upload the returned PDF below — extraction lifts the details
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PromptChip({ label, value }) {
  return (
    <div className="p-chip">
      <span className="p-chip-l">{label}</span>
      <span className="p-chip-v">{value || '—'}</span>
    </div>
  )
}

// Resize an image File to a JPEG Blob with a max width and quality cap.
// Original aspect ratio preserved. EXIF orientation NOT handled (Gemini
// Vision tolerates rotated photos for observation extraction).
function resizeImageToJpeg(file, maxWidth, quality) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      try {
        const scale = Math.min(1, maxWidth / img.naturalWidth)
        const w = Math.max(1, Math.round(img.naturalWidth * scale))
        const h = Math.max(1, Math.round(img.naturalHeight * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          URL.revokeObjectURL(url)
          reject(new Error('canvas 2d context unavailable'))
          return
        }
        ctx.drawImage(img, 0, 0, w, h)
        canvas.toBlob(
          (blob) => {
            URL.revokeObjectURL(url)
            if (!blob) reject(new Error('canvas.toBlob returned null'))
            else resolve(blob)
          },
          'image/jpeg',
          quality,
        )
      } catch (err) {
        URL.revokeObjectURL(url)
        reject(err)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('image decode failed'))
    }
    img.src = url
  })
}

// Read a Blob into a base64 string (no `data:...;base64,` prefix).
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      const idx = result.indexOf(',')
      resolve(idx === -1 ? result : result.slice(idx + 1))
    }
    reader.onerror = () => reject(reader.error || new Error('FileReader failed'))
    reader.readAsDataURL(blob)
  })
}
