import React from 'react'
import { useAction } from 'convex/react'
import { Icon } from './ui.jsx'

// Generate poster prompt card — base64-encodes the uploaded images in the
// browser and ships them to the Gemini Convex action, which uses Vision to
// look at the photos and write a brief informed by what it actually sees.
// No static-template fallback: if Gemini fails, the card surfaces the error
// note and Copy stays disabled until a real prompt is produced.

const MAX_INLINE_TOTAL = 14 * 1024 * 1024 // ~14 MB inline budget per request

export default function PosterPromptCard({ form, toast }) {
  const generate = useAction('ai:generatePosterPrompt')
  const [open, setOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState(null) // { prompt, source, note }

  const condo = form.condo?.trim() || ''
  const images = Array.isArray(form.images) ? form.images : []
  const totalBytes = images.reduce((s, i) => s + (i.size || 0), 0)
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
      const overBudget = totalBytes > MAX_INLINE_TOTAL
      if (overBudget) {
        toast?.(`Images total ${(totalBytes / 1024 / 1024).toFixed(1)} MB — shrink to under ~14 MB and try again.`)
        return
      }
      const encoded = await Promise.all(
        images.map((img) => fileToInline(img.file, img.name, img.contentType)),
      )
      const r = await generate({
        property: { condo, images: encoded },
      })
      setResult(r)
      // Only auto-open the preview when there's an actual prompt to look at.
      setOpen(!!r?.prompt)
    } catch (err) {
      toast?.(`Could not reach the prompt generator: ${err.message || err}`)
    } finally {
      setBusy(false)
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
            Gemini Vision looks at your photos and writes a brief for the{' '}
            <strong style={{ color: 'var(--navy)' }}>/room-showcase-pdf</strong> skill — informed by what's actually
            in the images and demanding a labeled Facts block the portal can lift back.
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
              'Analysing photos…'
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
            title={result?.prompt ? 'Copy the brief to clipboard' : 'Generate first, then copy'}
          >
            <Icon name="copy" size={12} /> Copy prompt
          </button>
        </div>
      </div>

      {!ready && (
        <div className="card-pad" style={{ paddingTop: 14 }}>
          <div className="empty" style={{ padding: 18, textAlign: 'left' }}>
            <h4 style={{ marginBottom: 2 }}>Name the property and attach at least one photo</h4>
            <p style={{ margin: 0 }}>That's all Gemini Vision needs to write the brief.</p>
          </div>
        </div>
      )}

      {ready && (
        <div className="card-pad" style={{ paddingTop: 14 }}>
          <div className="prompt-summary">
            <PromptChip label="Property" value={condo} />
            <PromptChip label="Images" value={String(images.length)} />
            <PromptChip label="Total" value={`${(totalBytes / 1024 / 1024).toFixed(1)} MB`} />
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

// Convert a File to { name, mimeType, dataB64 } — the inline shape Gemini
// Vision (via the Convex action) expects.
function fileToInline(file, name, contentType) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error(`No file blob available for ${name}`))
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      // FileReader.readAsDataURL → "data:image/jpeg;base64,<b64>"
      const idx = result.indexOf(',')
      const dataB64 = idx === -1 ? result : result.slice(idx + 1)
      resolve({
        name,
        mimeType: contentType || file.type || 'image/jpeg',
        dataB64,
      })
    }
    reader.onerror = () => reject(reader.error || new Error('FileReader failed'))
    reader.readAsDataURL(file)
  })
}
