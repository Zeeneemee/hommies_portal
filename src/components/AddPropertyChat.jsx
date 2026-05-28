// Beta: chat-based property intake.
//
// Companion to AddProperty.jsx. Same draft hook (useAddPropertyDraft from
// App.jsx — passed in via the `draft` prop), same save path
// (properties:add + per-blob uploads). The agent loop is driven by Gemini
// function calling — see convex/chat.ts for the server side.
//
// Reactive flow per user message:
//   1. operator types / attaches → appendUserMessage → runAgentLoop
//   2. runAgentLoop calls chat.turn → gets {text?, functionCalls?}
//   3. dispatches each functionCall via toolDispatcher
//   4. appends each tool result as a function-role transcript entry
//   5. re-calls chat.turn until no more functionCalls (or step cap hit)
//
// Persistence: transcript + lightweight references are JSON-serialised to
// sessionStorage. File blobs (images, video, poster) live only in the
// in-memory draft and drop on refresh — operator sees a one-time notice.

import React from 'react'
import { useAction, useMutation } from 'convex/react'
import { Icon, Field } from './ui.jsx'
import { renderPosterToBlob } from '../poster/generate.jsx'
import { resizeImageToJpeg, blobToBase64 } from '../poster/encode.js'

const IMAGE_CAP = 12
const VIDEO_MAX_BYTES = 200 * 1024 * 1024
const VIDEO_MIME_TYPES = ['video/mp4', 'video/quicktime', 'video/webm']
const MAX_AGENT_STEPS = 8
const TRANSCRIPT_STORAGE_KEY = 'hommies.addChat.transcript'
const NOTICE_SHOWN_KEY = 'hommies.addChat.refreshNoticeShown'

// Detail keys the agent is allowed to set. Mirror of the server-side list
// in convex/chat.ts. Numeric keys get coerced from string to number here.
const DETAIL_KEYS = new Set([
  'rentSGD', 'area', 'buildingType', 'housingType', 'ageYears', 'unitType',
  'sizeSqft', 'bedrooms', 'bathrooms', 'furnishing', 'availability',
  'fullAddress', 'listingTitle', 'commuteNUS', 'commuteNTU', 'commuteSMU',
])
const NUMERIC_DETAIL_KEYS = new Set([
  'rentSGD', 'ageYears', 'sizeSqft', 'bedrooms', 'bathrooms',
  'commuteNUS', 'commuteNTU', 'commuteSMU',
])

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// Reduce the in-memory draft to the structural shape Gemini needs to plan.
// Blob bytes never travel; only metadata (filenames + sizes).
function draftToSnapshot(draft, posterFile, videoFile) {
  return {
    condo: draft.condo || undefined,
    extracted: draft.extracted || {},
    imagesMeta: (draft.images || []).map((i) => ({ name: i.name, size: i.size })),
    videoMeta: videoFile ? { name: videoFile.name, size: videoFile.size } : undefined,
    posterMeta: posterFile ? { name: posterFile.name, size: posterFile.size } : undefined,
  }
}

// Boil a transcript message down to the wire shape the Convex action expects.
function messageToWire(m) {
  if (m.role === 'user') return { role: 'user', text: m.text }
  if (m.role === 'assistant') {
    return {
      role: 'model',
      text: m.text || undefined,
      functionCalls: m.functionCalls && m.functionCalls.length ? m.functionCalls : undefined,
    }
  }
  if (m.role === 'function') {
    return {
      role: 'function',
      functionResponse: { name: m.functionResponse.name, response: m.functionResponse.response },
    }
  }
  return null // system messages don't go to Gemini
}

export default function AddPropertyChat({ toast, onSaved, draft }) {
  // Existing convex actions reused via the dispatcher.
  const chatTurn = useAction('chat:turn')
  const extractPropertyGuruUrl = useAction('extraction:extractPropertyGuruUrl')
  const fetchImagesAsData = useAction('extraction:fetchImagesAsData')
  const generatePosterContent = useAction('ai:generatePosterContent')
  const generateUploadUrl = useMutation('properties:generateUploadUrl')
  const addProperty = useMutation('properties:add')
  const extractPosterDetails = useAction('extraction:extractPosterDetails')

  const { condo, setCondo, images, setImages, posterFile, setPosterFile,
    videoFile, setVideoFile, extracted, setExtracted } = draft

  // Transcript: array of {id, role, text?, functionCalls?, functionResponse?, attachments?, attachmentsDropped?}
  const [transcript, setTranscript] = React.useState([])
  const [pending, setPending] = React.useState(false)
  const [composerText, setComposerText] = React.useState('')
  const [pendingAttachments, setPendingAttachments] = React.useState([])
  const [showPreviewCard, setShowPreviewCard] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const fileInputRef = React.useRef(null)
  const transcriptEndRef = React.useRef(null)
  const textareaRef = React.useRef(null)

  // Restore transcript from sessionStorage once on mount. File-blob refs are
  // dropped — surface a one-time notice when that happens.
  React.useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(TRANSCRIPT_STORAGE_KEY)
      if (!raw) return
      const restored = JSON.parse(raw)
      if (!Array.isArray(restored)) return
      const sanitised = restored.map((m) =>
        m.attachments?.length ? { ...m, attachmentsDropped: true, attachments: [] } : m,
      )
      const hadAttachments = sanitised.some((m) => m.attachmentsDropped)
      setTranscript(sanitised)
      if (hadAttachments) {
        const seen = window.sessionStorage.getItem(NOTICE_SHOWN_KEY)
        if (!seen) {
          toast?.('Session restored. Attached files were dropped on refresh — please re-attach.')
          window.sessionStorage.setItem(NOTICE_SHOWN_KEY, '1')
        }
      }
    } catch {
      /* sessionStorage may be unavailable */
    }
  }, [toast])

  // Persist transcript JSON whenever it changes. File blobs aren't in the
  // transcript itself (only metadata), so this is safe.
  React.useEffect(() => {
    try {
      window.sessionStorage.setItem(TRANSCRIPT_STORAGE_KEY, JSON.stringify(transcript))
    } catch {
      /* quota exceeded — ignore */
    }
  }, [transcript])

  // Auto-scroll to the latest message.
  React.useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [transcript, pending])

  // ─────────────────────────────────────────────────────────────────────
  // Tool dispatcher — maps a model functionCall to a portal effect.
  // Returns the JSON response Gemini sees on the next turn.
  // ─────────────────────────────────────────────────────────────────────
  const dispatch = React.useCallback(
    async (name, args) => {
      try {
        switch (name) {
          case 'setCondo': {
            const n = String(args?.name || '').trim()
            if (!n) return { ok: false, error: 'name is empty' }
            setCondo(n)
            return { ok: true, condo: n }
          }

          case 'setDetail': {
            const key = String(args?.key || '')
            if (!DETAIL_KEYS.has(key)) {
              return { ok: false, error: `unsupported detail key: ${key}` }
            }
            let value = args?.value
            if (NUMERIC_DETAIL_KEYS.has(key)) {
              const cleaned = String(value).replace(/[^\d.-]/g, '')
              const num = Number(cleaned)
              if (!Number.isFinite(num)) return { ok: false, error: `value for ${key} is not a number` }
              value = num
            }
            // commute* keys live inside the commuteMins object; everything else
            // is a flat field on extracted.
            if (key === 'commuteNUS' || key === 'commuteNTU' || key === 'commuteSMU') {
              const uni = key.replace('commute', '')
              setExtracted((prev) => {
                const next = { ...(prev || {}) }
                const c = { ...(next.commuteMins || {}) }
                c[uni] = value
                next.commuteMins = c
                return next
              })
              return { ok: true, key, value }
            }
            setExtracted((prev) => ({ ...(prev || {}), [key]: value }))
            return { ok: true, key, value }
          }

          case 'extractFromPropertyGuruUrl': {
            const url = String(args?.url || '').trim()
            if (!url) return { ok: false, error: 'url is empty' }
            const res = await extractPropertyGuruUrl({ url })
            if (!res?.ok) return { ok: false, error: res?.error || res?.note || 'extraction failed' }
            // Merge lifted fields into draft.extracted.
            if (res.fields && typeof res.fields === 'object') {
              setExtracted((prev) => ({ ...(prev || {}), ...res.fields }))
            }
            if (res.suggestedCondo && !condo.trim()) setCondo(res.suggestedCondo)
            // Auto-attach images (PG CDN isn't CORS-friendly; we go via Convex).
            let imagesPulled = 0
            const remoteUrls = Array.isArray(res.imageUrls) ? res.imageUrls : []
            if (remoteUrls.length) {
              const room = IMAGE_CAP - images.length
              if (room > 0) {
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
                  imagesPulled = next.length
                } catch (err) {
                  return { ok: true, lifted: Object.keys(res.fields || {}), imagesPulled: 0, imageError: String(err?.message || err) }
                }
              }
            }
            return {
              ok: true,
              lifted: Object.keys(res.fields || {}),
              suggestedCondo: res.suggestedCondo,
              imagesPulled,
            }
          }

          case 'attachImageUrls': {
            const urls = Array.isArray(args?.urls) ? args.urls.filter((u) => typeof u === 'string') : []
            if (urls.length === 0) return { ok: false, error: 'urls is empty' }
            const room = IMAGE_CAP - images.length
            if (room <= 0) return { ok: false, error: `image cap reached (${IMAGE_CAP})` }
            const slice = urls.slice(0, room)
            const fetched = await fetchImagesAsData({ urls: slice })
            const next = (fetched.images || []).map((img, i) => {
              const bytes = Uint8Array.from(atob(img.dataB64), (c) => c.charCodeAt(0))
              const blob = new Blob([bytes], { type: img.contentType || 'image/jpeg' })
              const file = new File([blob], img.name || `attached-${i + 1}.jpg`, {
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
            return { ok: true, attached: next.length, skipped: (fetched.skipped || []).length }
          }

          case 'generatePoster': {
            const e = extracted || {}
            if (!condo.trim()) return { ok: false, error: 'condo missing' }
            if (!(typeof e.rentSGD === 'number' && e.rentSGD > 0)) return { ok: false, error: 'rentSGD missing' }
            if (!e.housingType) return { ok: false, error: 'housingType missing' }
            if (images.length < 1) return { ok: false, error: 'no images attached' }
            const inline = []
            for (let i = 0; i < Math.min(images.length, 8); i++) {
              try {
                const resized = await resizeImageToJpeg(images[i].file, 1024, 0.82)
                const dataB64 = await blobToBase64(resized)
                inline.push({ name: images[i].name, mimeType: 'image/jpeg', dataB64 })
              } catch {
                /* skip this image */
              }
            }
            if (inline.length === 0) return { ok: false, error: 'image encode failed' }
            const propArg = { condo: condo.trim() }
            for (const k of ['rentSGD','area','buildingType','housingType','unitType','ageYears','fullAddress','commuteMins','sizeSqft','bedrooms','bathrooms','furnishing','availability','listingTitle']) {
              if (e[k] !== undefined) propArg[k] = e[k]
            }
            const res = await generatePosterContent({ property: propArg, images: inline })
            if (!res?.ok || !res.content) return { ok: false, error: res?.note || 'poster generation failed' }
            const posterProperty = {
              ...propArg,
              images: images.map((i) => ({ previewUrl: i.previewUrl })),
            }
            const { blob, filename } = await renderPosterToBlob(posterProperty, res.content, null)
            const file = new File([blob], filename, { type: 'application/pdf' })
            setPosterFile(file)
            return { ok: true, filename, sizeKB: Math.round(blob.size / 1024) }
          }

          case 'requestSaveConfirmation': {
            if (!condo.trim()) return { ok: false, error: 'condo missing — cannot request save yet' }
            if (images.length === 0 && !videoFile) {
              return { ok: false, error: 'no media attached — need at least one image or a video' }
            }
            setShowPreviewCard(true)
            return { ok: true, message: 'preview card rendered; awaiting operator confirmation' }
          }

          default:
            return { ok: false, error: `unknown tool: ${name}` }
        }
      } catch (err) {
        return { ok: false, error: String(err?.message || err) }
      }
    },
    [condo, images, videoFile, extracted, setCondo, setExtracted, setImages, setPosterFile,
      extractPropertyGuruUrl, fetchImagesAsData, generatePosterContent],
  )

  // ─────────────────────────────────────────────────────────────────────
  // Agent loop — drive chat.turn calls until Gemini stops calling tools or
  // we hit the per-message step cap.
  // ─────────────────────────────────────────────────────────────────────
  const runAgentLoop = React.useCallback(
    async (initialTranscript, latestUserText, inlineImages) => {
      let workingTranscript = initialTranscript
      let stepCount = 0
      let userTextForFirstTurn = latestUserText
      let imagesForFirstTurn = inlineImages

      while (stepCount < MAX_AGENT_STEPS) {
        const wire = workingTranscript.map(messageToWire).filter(Boolean)
        const snapshot = draftToSnapshot(draft, posterFile, videoFile)
        const res = await chatTurn({
          transcript: wire,
          draft: snapshot,
          latestUserText: userTextForFirstTurn,
          inlineImages: imagesForFirstTurn,
        })
        // After the first turn, the user message already lives in the transcript.
        userTextForFirstTurn = undefined
        imagesForFirstTurn = undefined

        if (!res?.ok) {
          const sysMsg = {
            id: newId(),
            role: 'system',
            text: res?.note || 'chat.turn failed without a note',
          }
          workingTranscript = [...workingTranscript, sysMsg]
          setTranscript(workingTranscript)
          return
        }

        const assistantMsg = {
          id: newId(),
          role: 'assistant',
          text: res.text,
          functionCalls: res.functionCalls || [],
        }
        workingTranscript = [...workingTranscript, assistantMsg]
        setTranscript(workingTranscript)

        if (!res.functionCalls || res.functionCalls.length === 0) {
          return // model is done with this user message
        }

        // Execute each tool call sequentially; append the function-role
        // result so the next chat.turn sees what happened.
        for (const fc of res.functionCalls) {
          const response = await dispatch(fc.name, fc.args || {})
          const fnMsg = {
            id: newId(),
            role: 'function',
            functionResponse: { name: fc.name, response },
          }
          workingTranscript = [...workingTranscript, fnMsg]
          setTranscript(workingTranscript)
        }

        stepCount += 1
      }

      // Runaway guard.
      const sysMsg = {
        id: newId(),
        role: 'system',
        text: 'Model kept calling tools — paused. Send another message to continue.',
      }
      setTranscript((t) => [...t, sysMsg])
    },
    [chatTurn, dispatch, draft, posterFile, videoFile],
  )

  // ─────────────────────────────────────────────────────────────────────
  // Composer — attachments + send
  // ─────────────────────────────────────────────────────────────────────
  function handleFilesPicked(files) {
    if (!files?.length) return
    const next = [...pendingAttachments]
    for (const f of files) {
      if (f.type.startsWith('image/')) {
        next.push({ kind: 'image', file: f, name: f.name, size: f.size })
        continue
      }
      if (f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')) {
        if (next.some((a) => a.kind === 'pdf')) {
          toast?.('Already have a PDF queued — replace it instead.')
          continue
        }
        next.push({ kind: 'pdf', file: f, name: f.name, size: f.size })
        continue
      }
      const isVideoMime = VIDEO_MIME_TYPES.includes(f.type)
      const isVideoExt = ['.mp4', '.mov', '.webm'].some((ext) => f.name.toLowerCase().endsWith(ext))
      if (isVideoMime || isVideoExt) {
        if (f.size > VIDEO_MAX_BYTES) {
          toast?.(`Video is ${(f.size / 1024 / 1024).toFixed(0)} MB — keep under 200 MB.`)
          continue
        }
        if (next.some((a) => a.kind === 'video')) {
          toast?.('Already have a video queued — replace it instead.')
          continue
        }
        next.push({ kind: 'video', file: f, name: f.name, size: f.size })
        continue
      }
      toast?.(`Skipped ${f.name} — not an image, video, or PDF.`)
    }
    setPendingAttachments(next)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function removeAttachment(idx) {
    setPendingAttachments((prev) => prev.filter((_, i) => i !== idx))
  }

  async function handleSend() {
    const text = composerText.trim()
    const hasAttachments = pendingAttachments.length > 0
    if (!text && !hasAttachments) return
    if (pending) return

    setPending(true)
    try {
      // Materialise attachments into the draft + into the user message's
      // textual summary that Gemini sees.
      const summaryBits = []
      const imagesForDraft = []
      let videoForDraft = null
      let posterForDraft = null
      for (const a of pendingAttachments) {
        if (a.kind === 'image') {
          imagesForDraft.push({
            file: a.file,
            name: a.name,
            size: a.size,
            contentType: a.file.type,
            previewUrl: URL.createObjectURL(a.file),
          })
        } else if (a.kind === 'video') {
          videoForDraft = a.file
        } else if (a.kind === 'pdf') {
          posterForDraft = a.file
        }
      }
      if (imagesForDraft.length) {
        const room = IMAGE_CAP - images.length
        const taken = imagesForDraft.slice(0, Math.max(0, room))
        if (taken.length) setImages((prev) => [...prev, ...taken])
        summaryBits.push(`${taken.length} image${taken.length === 1 ? '' : 's'}`)
      }
      if (videoForDraft) {
        setVideoFile(videoForDraft)
        summaryBits.push(`a ${(videoForDraft.size / 1024 / 1024).toFixed(1)} MB video walk-through (${videoForDraft.name})`)
      }
      if (posterForDraft) {
        setPosterFile(posterForDraft)
        summaryBits.push(`a poster PDF (${posterForDraft.name})`)
      }

      // Downsample up to 4 image attachments and send them as inline parts
      // so Gemini Vision can describe what it sees.
      const inlineForGemini = []
      const imagesToSend = pendingAttachments.filter((a) => a.kind === 'image').slice(0, 4)
      for (const a of imagesToSend) {
        try {
          const resized = await resizeImageToJpeg(a.file, 1024, 0.82)
          const dataB64 = await blobToBase64(resized)
          inlineForGemini.push({ name: a.name, mimeType: 'image/jpeg', dataB64 })
        } catch {
          /* skip */
        }
      }

      // Build the user message that goes into the transcript + sent text.
      let composedText = text
      if (hasAttachments) {
        const attachmentLine = `[operator attached: ${summaryBits.join(', ')}]`
        composedText = text ? `${text}\n\n${attachmentLine}` : attachmentLine
      }

      const userMsg = {
        id: newId(),
        role: 'user',
        text: composedText,
        attachments: pendingAttachments.map((a) => ({ kind: a.kind, name: a.name, size: a.size })),
      }
      const nextTranscript = [...transcript, userMsg]
      setTranscript(nextTranscript)
      setComposerText('')
      setPendingAttachments([])

      await runAgentLoop(nextTranscript, composedText, inlineForGemini)
    } catch (err) {
      const sysMsg = { id: newId(), role: 'system', text: `Send failed: ${err?.message || err}` }
      setTranscript((t) => [...t, sysMsg])
    } finally {
      setPending(false)
    }
  }

  function onComposerKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Save — mirrors AddProperty.jsx's handleSubmit
  // ─────────────────────────────────────────────────────────────────────
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

  async function handleSaveProperty() {
    if (saving) return
    if (!condo.trim()) {
      toast?.('Need a condo name first.')
      return
    }
    if (images.length === 0 && !videoFile) {
      toast?.('Attach at least one image or a video.')
      return
    }
    setSaving(true)
    try {
      const uploadedImages = []
      for (const img of images) {
        const storageId = await uploadBlob(img.file)
        uploadedImages.push({ storageId, name: img.name, size: img.size, contentType: img.contentType })
      }
      let videoStorageId, videoName, videoSize, videoContentType
      if (videoFile) {
        videoStorageId = await uploadBlob(videoFile)
        videoName = videoFile.name
        videoSize = videoFile.size
        videoContentType = videoFile.type || undefined
      }
      let posterStorageId, posterName, posterSize
      if (posterFile) {
        posterStorageId = await uploadBlob(posterFile)
        posterName = posterFile.name
        posterSize = posterFile.size
      }
      const SAVE_FIELDS = ['rentSGD', 'area', 'buildingType', 'housingType', 'ageYears', 'unitType', 'fullAddress', 'commuteMins']
      const savable = {}
      for (const k of SAVE_FIELDS) if (extracted?.[k] !== undefined) savable[k] = extracted[k]
      const id = await addProperty({
        condo: condo.trim(),
        images: uploadedImages,
        posterStorageId, posterName, posterSize,
        videoStorageId, videoName, videoSize, videoContentType,
        ...savable,
      })
      if (posterStorageId) {
        try {
          const result = await extractPosterDetails({ id })
          toast?.(result?.ok ? `${condo} added — poster extracted (${result.liftedFields.length} fields).` : `${condo} added.`)
        } catch (err) {
          toast?.(`${condo} added — extraction failed: ${err.message || err}`)
        }
      } else {
        toast?.(`${condo} added.`)
      }
      try { window.sessionStorage.removeItem(TRANSCRIPT_STORAGE_KEY) } catch {}
      try { window.sessionStorage.removeItem(NOTICE_SHOWN_KEY) } catch {}
      draft.reset()
      setTranscript([])
      setShowPreviewCard(false)
      onSaved?.()
    } catch (err) {
      toast?.(`Save failed: ${err.message || err}`)
    } finally {
      setSaving(false)
    }
  }

  function handleKeepEditing() {
    setShowPreviewCard(false)
    const sysMsg = {
      id: newId(),
      role: 'user',
      text: '[operator cancelled save; wants to keep editing]',
    }
    const nextTranscript = [...transcript, sysMsg]
    setTranscript(nextTranscript)
    runAgentLoop(nextTranscript, sysMsg.text, undefined)
  }

  function handleClearChat() {
    if (!window.confirm('Clear the chat and reset the draft?')) return
    setTranscript([])
    setPendingAttachments([])
    setShowPreviewCard(false)
    draft.reset()
    try { window.sessionStorage.removeItem(TRANSCRIPT_STORAGE_KEY) } catch {}
    try { window.sessionStorage.removeItem(NOTICE_SHOWN_KEY) } catch {}
  }

  // ─────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────
  return (
    <div className="chat-screen">
      <div className="page-header">
        <div>
          <div className="eyebrow">Beta · Chat intake</div>
          <h1 className="page-title">Add a property (chat)</h1>
          <p className="page-sub">
            Paste a WhatsApp message, drop a PropertyGuru link, attach photos or a walk-through video.
            The agent extracts fields, asks follow-ups, and produces a preview card you confirm before saving.
          </p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={handleClearChat}>Clear</button>
      </div>

      <div className="chat-layout">
        <div className="chat-main">
          <div className="chat-transcript">
            {transcript.length === 0 && !pending && (
              <div className="chat-empty">
                <Icon name="sparkle" size={20} />
                <div>Start by pasting a WhatsApp message, a PG link, or attaching photos.</div>
              </div>
            )}
            {transcript.map((m) => <ChatMessage key={m.id} message={m} />)}
            {pending && <ChatPendingDots />}
            <div ref={transcriptEndRef} />
          </div>

          {pendingAttachments.length > 0 && (
            <div className="chat-attachments">
              {pendingAttachments.map((a, i) => (
                <span key={i} className={`chat-chip chip-${a.kind}`}>
                  <Icon name={a.kind === 'video' ? 'play' : a.kind === 'pdf' ? 'pdf' : 'photo'} size={12} />
                  <span className="chip-name" title={a.name}>{a.name}</span>
                  <span className="chip-size">{(a.size / 1024).toFixed(0)} KB</span>
                  <button
                    type="button"
                    className="chip-x"
                    onClick={() => removeAttachment(i)}
                    aria-label={`Remove ${a.name}`}
                  >
                    <Icon name="x" size={10} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="chat-composer">
            <button
              type="button"
              className="chat-attach-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={pending}
              title="Attach images, video, or a PDF"
            >
              <Icon name="upload" size={16} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/mp4,video/quicktime,video/webm,application/pdf,.pdf,.mp4,.mov,.webm"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => handleFilesPicked(e.target.files)}
            />
            <textarea
              ref={textareaRef}
              className="chat-textarea"
              placeholder="Paste a WhatsApp message, drop a PG link, ask the agent to save…"
              value={composerText}
              onChange={(e) => setComposerText(e.target.value)}
              onKeyDown={onComposerKeyDown}
              rows={2}
              disabled={pending}
            />
            <button
              type="button"
              className="btn btn-primary chat-send-btn"
              onClick={handleSend}
              disabled={pending || (!composerText.trim() && pendingAttachments.length === 0)}
            >
              <Icon name="send" size={14} />
            </button>
          </div>
        </div>

        <DraftSidebar
          condo={condo}
          extracted={extracted || {}}
          images={images}
          videoFile={videoFile}
          posterFile={posterFile}
        />
      </div>

      {showPreviewCard && (
        <PreviewCard
          condo={condo}
          extracted={extracted || {}}
          setExtracted={setExtracted}
          setCondo={setCondo}
          images={images}
          videoFile={videoFile}
          posterFile={posterFile}
          saving={saving}
          onSave={handleSaveProperty}
          onCancel={handleKeepEditing}
        />
      )}
    </div>
  )
}

function ChatMessage({ message }) {
  const m = message
  if (m.role === 'user') {
    return (
      <div className="chat-bubble chat-bubble-user">
        <div className="chat-bubble-text">{m.text}</div>
        {m.attachmentsDropped && (
          <div className="chat-bubble-meta">(attached files were dropped on refresh)</div>
        )}
      </div>
    )
  }
  if (m.role === 'assistant') {
    return (
      <div className="chat-bubble chat-bubble-assistant">
        {m.text && <div className="chat-bubble-text">{m.text}</div>}
        {m.functionCalls?.length > 0 && (
          <div className="chat-bubble-tools">
            {m.functionCalls.map((fc, i) => (
              <span key={i} className="chat-tool-tag">
                <Icon name="sparkle" size={10} /> {fc.name}
              </span>
            ))}
          </div>
        )}
      </div>
    )
  }
  if (m.role === 'function') {
    const fr = m.functionResponse || {}
    const ok = fr.response?.ok
    const summary = summariseToolResponse(fr.name, fr.response)
    return (
      <div className={`chat-tool-line ${ok ? '' : 'failed'}`}>
        <Icon name={ok ? 'check' : 'x'} size={11} />
        <span>{fr.name} → {summary}</span>
      </div>
    )
  }
  if (m.role === 'system') {
    return <div className="chat-system">{m.text}</div>
  }
  return null
}

function summariseToolResponse(name, response) {
  if (!response) return '(no response)'
  if (!response.ok) return `error: ${response.error || 'failed'}`
  switch (name) {
    case 'setCondo': return `condo set to "${response.condo}"`
    case 'setDetail': return `${response.key} = ${response.value}`
    case 'extractFromPropertyGuruUrl':
      return `lifted ${response.lifted?.length || 0} field(s); pulled ${response.imagesPulled || 0} image(s)`
    case 'attachImageUrls':
      return `attached ${response.attached || 0} image(s)`
    case 'generatePoster':
      return `rendered ${response.filename} (${response.sizeKB} KB)`
    case 'requestSaveConfirmation':
      return 'preview card shown'
    default:
      return 'ok'
  }
}

function ChatPendingDots() {
  return (
    <div className="chat-bubble chat-bubble-assistant">
      <span className="chat-dots"><i /><i /><i /></span>
    </div>
  )
}

function DraftSidebar({ condo, extracted, images, videoFile, posterFile }) {
  const e = extracted || {}
  const fieldRow = (label, val) =>
    val !== undefined && val !== '' && val !== null ? (
      <div className="draft-row" key={label}>
        <span className="draft-label">{label}</span>
        <span className="draft-value">{typeof val === 'object' ? JSON.stringify(val) : String(val)}</span>
      </div>
    ) : null
  return (
    <aside className="chat-sidebar">
      <div className="card">
        <div className="card-head">
          <h3 className="card-title" style={{ fontSize: 14 }}>Current draft</h3>
          <p className="card-sub">Updated live as the agent calls tools.</p>
        </div>
        <div className="card-pad">
          {fieldRow('Condo', condo)}
          {fieldRow('Rent', e.rentSGD ? `S$${e.rentSGD}` : undefined)}
          {fieldRow('Housing', e.housingType)}
          {fieldRow('Building', e.buildingType)}
          {fieldRow('Unit', e.unitType)}
          {fieldRow('Area', e.area)}
          {fieldRow('Address', e.fullAddress)}
          {fieldRow('Age', e.ageYears ? `${e.ageYears} yrs` : undefined)}
          {fieldRow('Size', e.sizeSqft ? `${e.sizeSqft} sqft` : undefined)}
          {fieldRow('Beds', e.bedrooms)}
          {fieldRow('Baths', e.bathrooms)}
          {fieldRow('Furnishing', e.furnishing)}
          {fieldRow('Availability', e.availability)}
          {fieldRow('Title', e.listingTitle)}
          {e.commuteMins && fieldRow('Commute', `NUS ${e.commuteMins.NUS ?? '—'} · NTU ${e.commuteMins.NTU ?? '—'} · SMU ${e.commuteMins.SMU ?? '—'}`)}
          <div className="draft-row" style={{ borderTop: '1px dashed var(--hairline)', marginTop: 8, paddingTop: 8 }}>
            <span className="draft-label">Images</span>
            <span className="draft-value">{images.length}</span>
          </div>
          <div className="draft-row">
            <span className="draft-label">Video</span>
            <span className="draft-value">{videoFile ? videoFile.name : '—'}</span>
          </div>
          <div className="draft-row">
            <span className="draft-label">Poster</span>
            <span className="draft-value">{posterFile ? posterFile.name : '—'}</span>
          </div>
        </div>
      </div>
    </aside>
  )
}

function PreviewCard({ condo, extracted, setExtracted, setCondo, images, videoFile, posterFile, saving, onSave, onCancel }) {
  const e = extracted || {}
  const setField = (key) => (ev) => {
    const v = ev.target.value
    setExtracted((prev) => {
      const next = { ...(prev || {}) }
      if (v === '' || v == null) delete next[key]
      else next[key] = v
      return next
    })
  }
  const setNumField = (key) => (ev) => {
    const v = ev.target.value
    setExtracted((prev) => {
      const next = { ...(prev || {}) }
      if (v === '') delete next[key]
      else next[key] = Number(v)
      return next
    })
  }
  return (
    <div className="preview-overlay" onClick={onCancel}>
      <div className="card preview-card" onClick={(e) => e.stopPropagation()}>
        <div className="card-head">
          <h3 className="card-title">Confirm and save</h3>
          <p className="card-sub">Edit any field then click Save. Cancel returns you to the chat.</p>
        </div>
        <div className="card-pad">
          <div className="form-grid">
            <Field label="Condo / HDB name" required span={12}>
              <input className="input" value={condo} onChange={(ev) => setCondo(ev.target.value)} />
            </Field>
            <Field label="Rent (S$ / mo)" span={4}>
              <input className="input" type="number" value={e.rentSGD ?? ''} onChange={setNumField('rentSGD')} />
            </Field>
            <Field label="Housing type" span={4}>
              <select className="input" value={e.housingType || ''} onChange={setField('housingType')}>
                <option value="">—</option>
                <option value="Room">Room</option>
                <option value="Whole Unit">Whole Unit</option>
              </select>
            </Field>
            <Field label="Building type" span={4}>
              <select className="input" value={e.buildingType || ''} onChange={setField('buildingType')}>
                <option value="">—</option>
                <option value="Condo">Condo</option>
                <option value="HDB">HDB</option>
              </select>
            </Field>
            <Field label="Area" span={6}>
              <input className="input" value={e.area || ''} onChange={setField('area')} />
            </Field>
            <Field label="Unit type" span={6}>
              <input className="input" value={e.unitType || ''} onChange={setField('unitType')} />
            </Field>
            <Field label="Full address" span={12}>
              <input className="input" value={e.fullAddress || ''} onChange={setField('fullAddress')} />
            </Field>
          </div>

          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Images ({images.length})</div>
            <div className="image-grid">
              {images.map((img) => (
                <div key={img.previewUrl} className="image-tile">
                  <img src={img.previewUrl} alt={img.name} />
                  <div className="image-tile-meta" title={img.name}>{img.name}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 8 }}>
              {videoFile ? <>Video: <strong>{videoFile.name}</strong> · {(videoFile.size / 1024 / 1024).toFixed(1)} MB. </> : 'No video. '}
              {posterFile ? <>Poster: <strong>{posterFile.name}</strong>.</> : 'No poster.'}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
            <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>Keep editing</button>
            <button type="button" className="btn btn-primary" onClick={onSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save property'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
