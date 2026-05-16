// Poster-detail extraction — loads the attached poster PDF, pulls its text,
// parses the labeled "Facts" block, and patches the property record with
// whatever fields it could lift. Tolerant: missing values just stay absent.
'use node'

import { action } from './_generated/server'
import { internal } from './_generated/api'
import { v } from 'convex/values'
import { parsePosterText } from './posterExtraction'

// pdf-parse v2 wraps pdfjs-dist, which references DOM globals (DOMMatrix,
// ImageData, Path2D) at module load. Convex's V8 runtime doesn't expose
// those, so we (a) install minimal stubs on the global before importing
// pdf-parse, and (b) defer the import to the handler via dynamic import
// to keep the deploy-time module analyzer from evaluating pdfjs.
function installPdfjsPolyfills() {
  const g = globalThis as any
  if (typeof g.DOMMatrix === 'undefined') {
    g.DOMMatrix = class {
      a = 1; b = 0; c = 0; d = 1; e = 0; f = 0
      constructor() {}
      multiply() { return this }
      translate() { return this }
      scale() { return this }
    }
  }
  if (typeof g.ImageData === 'undefined') {
    g.ImageData = class {
      constructor(public data?: unknown, public width?: number, public height?: number) {}
    }
  }
  if (typeof g.Path2D === 'undefined') {
    g.Path2D = class {
      constructor() {}
      moveTo() {}
      lineTo() {}
    }
  }
}

export const extractPosterDetails = action({
  args: { id: v.id('properties') },
  handler: async (ctx, { id }) => {
    const property: any = await ctx.runQuery(internal.properties.get, { id })
    if (!property) throw new Error('Property not found')
    if (!property.posterStorageId) throw new Error('No poster attached on this property')

    const blob = await ctx.storage.get(property.posterStorageId)
    if (!blob) throw new Error('Poster blob missing from storage')

    let raw = ''
    let ok = false
    try {
      installPdfjsPolyfills()
      // Dynamic import — keeps the heavy pdfjs load off the deploy-time analyzer.
      const { PDFParse } = await import('pdf-parse')
      const data = new Uint8Array(await blob.arrayBuffer())
      const parser = new PDFParse({ data })
      try {
        const result = await parser.getText()
        raw = result.text || ''
        ok = raw.trim().length > 0
      } finally {
        try { await parser.destroy() } catch { /* ignore */ }
      }
    } catch (err: any) {
      raw = `PDF parse failed: ${err?.message || 'unknown error'}`
      ok = false
    }

    const fields = ok ? parsePosterText(raw) : {}

    // Build a patch — never overwrite existing values with `undefined`, and
    // always record the extraction metadata regardless of outcome.
    const patch: Record<string, unknown> = {
      posterExtractedAt: Date.now(),
      posterExtractionRaw: raw.slice(0, 8000),
      posterExtractionOk: ok && Object.keys(fields).length > 0,
    }
    for (const [k, v] of Object.entries(fields)) if (v !== undefined) patch[k] = v

    await ctx.runMutation(internal.properties.update, { id, patch: patch as any })

    return {
      ok: patch.posterExtractionOk,
      liftedFields: Object.keys(fields),
      rawLen: raw.length,
    }
  },
})
