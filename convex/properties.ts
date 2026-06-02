// Convex functions for properties.
// All persistence flows through this file — no UI component touches storage
// directly.

import { mutation, query } from './_generated/server'
import { v } from 'convex/values'

const imageSchema = v.object({
  storageId: v.id('_storage'),
  name: v.string(),
  size: v.number(),
  contentType: v.optional(v.string()),
})

// Detail fields are optional — Add Property may save just `{condo, images}`,
// with the rest lifted from the poster by extraction. Callers that already
// have the values (e.g. tests, a future power-form) can still supply them.
const propertyAddArgs = {
  condo: v.string(),
  images: v.optional(v.array(imageSchema)),
  buildingType: v.optional(v.union(v.literal('Condo'), v.literal('HDB'))),
  area: v.optional(v.string()),
  ageYears: v.optional(v.number()),
  unitType: v.optional(v.string()),
  rentSGD: v.optional(v.number()),
  housingType: v.optional(v.union(v.literal('Room'), v.literal('Whole Unit'))),
  masterCount: v.optional(v.number()),
  commonCount: v.optional(v.number()),
  fullAddress: v.optional(v.string()),
  commuteMins: v.optional(
    v.object({ NUS: v.number(), NTU: v.number(), SMU: v.number() }),
  ),
  posterStorageId: v.optional(v.id('_storage')),
  posterName: v.optional(v.string()),
  posterSize: v.optional(v.number()),
  // Optional walk-through video uploaded at Add Property time.
  videoStorageId: v.optional(v.id('_storage')),
  videoName: v.optional(v.string()),
  videoSize: v.optional(v.number()),
  videoContentType: v.optional(v.string()),
}

async function resolveImages(ctx: any, images: any[] | undefined) {
  if (!images?.length) return []
  return Promise.all(
    images.map(async (img) => ({
      ...img,
      url: await ctx.storage.getUrl(img.storageId),
    })),
  )
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query('properties').withIndex('by_createdAt').order('desc').collect()
    return Promise.all(
      rows.map(async (p) => ({
        ...p,
        images: await resolveImages(ctx, p.images),
        posterUrl: p.posterStorageId ? await ctx.storage.getUrl(p.posterStorageId) : null,
        videoUrl: p.videoStorageId ? await ctx.storage.getUrl(p.videoStorageId) : null,
      })),
    )
  },
})

export const get = query({
  args: { id: v.id('properties') },
  handler: async (ctx, { id }) => {
    const p = await ctx.db.get(id)
    if (!p) return null
    return {
      ...p,
      images: await resolveImages(ctx, p.images),
      posterUrl: p.posterStorageId ? await ctx.storage.getUrl(p.posterStorageId) : null,
      videoUrl: p.videoStorageId ? await ctx.storage.getUrl(p.videoStorageId) : null,
    }
  },
})

export const add = mutation({
  args: propertyAddArgs,
  handler: async (ctx, args) => {
    const now = Date.now()
    const {
      posterStorageId,
      posterName,
      posterSize,
      videoStorageId,
      videoName,
      videoSize,
      videoContentType,
      ...rest
    } = args
    return ctx.db.insert('properties', {
      ...rest,
      posterStorageId,
      posterName,
      posterSize,
      posterAddedAt: posterStorageId ? now : undefined,
      videoStorageId,
      videoName,
      videoSize,
      videoContentType,
      videoAddedAt: videoStorageId ? now : undefined,
      status: posterStorageId ? 'poster_attached' : 'data_received',
      createdAt: now,
    })
  },
})

export const attachImages = mutation({
  args: { id: v.id('properties'), images: v.array(imageSchema) },
  handler: async (ctx, { id, images }) => {
    const p = await ctx.db.get(id)
    if (!p) throw new Error('Property not found')
    const next = [...(p.images || []), ...images]
    await ctx.db.patch(id, { images: next })
    return next
  },
})

export const removeImage = mutation({
  args: { id: v.id('properties'), storageId: v.id('_storage') },
  handler: async (ctx, { id, storageId }) => {
    const p = await ctx.db.get(id)
    if (!p) throw new Error('Property not found')
    const next = (p.images || []).filter((img) => img.storageId !== storageId)
    await ctx.db.patch(id, { images: next })
    try {
      await ctx.storage.delete(storageId)
    } catch {
      /* best-effort cleanup */
    }
  },
})

// Patch any subset of property fields — used by the extraction action and by
// any future power-form. Existing values are not overwritten with `undefined`.
export const update = mutation({
  args: {
    id: v.id('properties'),
    patch: v.object({
      condo: v.optional(v.string()),
      buildingType: v.optional(v.union(v.literal('Condo'), v.literal('HDB'))),
      area: v.optional(v.string()),
      ageYears: v.optional(v.number()),
      unitType: v.optional(v.string()),
      rentSGD: v.optional(v.number()),
      housingType: v.optional(v.union(v.literal('Room'), v.literal('Whole Unit'))),
      masterCount: v.optional(v.number()),
      commonCount: v.optional(v.number()),
      fullAddress: v.optional(v.string()),
      commuteMins: v.optional(
        v.object({ NUS: v.number(), NTU: v.number(), SMU: v.number() }),
      ),
      posterExtractedAt: v.optional(v.number()),
      posterExtractionRaw: v.optional(v.string()),
      posterExtractionOk: v.optional(v.boolean()),
      // Video fields are normally written via setVideo, but the patch
      // validator accepts them so a future power-form can edit metadata
      // (e.g. rename) without going through setVideo.
      videoStorageId: v.optional(v.id('_storage')),
      videoName: v.optional(v.string()),
      videoSize: v.optional(v.number()),
      videoContentType: v.optional(v.string()),
      videoAddedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const clean: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) clean[k] = v
    if (Object.keys(clean).length > 0) await ctx.db.patch(id, clean)
  },
})

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => ctx.storage.generateUploadUrl(),
})

export const setPoster = mutation({
  args: {
    id: v.id('properties'),
    storageId: v.union(v.id('_storage'), v.null()),
    name: v.optional(v.string()),
    size: v.optional(v.number()),
  },
  handler: async (ctx, { id, storageId, name, size }) => {
    const property = await ctx.db.get(id)
    if (!property) throw new Error('Property not found')

    if (property.posterStorageId && property.posterStorageId !== storageId) {
      try {
        await ctx.storage.delete(property.posterStorageId)
      } catch {
        /* ignore */
      }
    }

    if (!storageId) {
      await ctx.db.patch(id, {
        posterStorageId: undefined,
        posterName: undefined,
        posterSize: undefined,
        posterAddedAt: undefined,
        posterExtractedAt: undefined,
        posterExtractionRaw: undefined,
        posterExtractionOk: undefined,
        status: property.status === 'sent' ? 'sent' : 'data_received',
      })
      return
    }

    await ctx.db.patch(id, {
      posterStorageId: storageId,
      posterName: name,
      posterSize: size,
      posterAddedAt: Date.now(),
      // Reset extraction metadata — a new poster gets a fresh run.
      posterExtractedAt: undefined,
      posterExtractionRaw: undefined,
      posterExtractionOk: undefined,
      status: property.status === 'data_received' ? 'poster_attached' : property.status,
    })
  },
})

// Replace or clear the per-property walk-through video. Mirrors setPoster:
// passing storageId: null clears the five video fields; passing a new
// storageId deletes any previously attached blob before patching the row.
export const setVideo = mutation({
  args: {
    id: v.id('properties'),
    storageId: v.union(v.id('_storage'), v.null()),
    name: v.optional(v.string()),
    size: v.optional(v.number()),
    contentType: v.optional(v.string()),
  },
  handler: async (ctx, { id, storageId, name, size, contentType }) => {
    const property = await ctx.db.get(id)
    if (!property) throw new Error('Property not found')

    if (property.videoStorageId && property.videoStorageId !== storageId) {
      try {
        await ctx.storage.delete(property.videoStorageId)
      } catch {
        /* ignore */
      }
    }

    if (!storageId) {
      await ctx.db.patch(id, {
        videoStorageId: undefined,
        videoName: undefined,
        videoSize: undefined,
        videoContentType: undefined,
        videoAddedAt: undefined,
      })
      return
    }

    await ctx.db.patch(id, {
      videoStorageId: storageId,
      videoName: name,
      videoSize: size,
      videoContentType: contentType,
      videoAddedAt: Date.now(),
    })
  },
})

export const advanceStatus = mutation({
  args: { id: v.id('properties') },
  handler: async (ctx, { id }) => {
    const p = await ctx.db.get(id)
    if (!p) throw new Error('Property not found')
    if (p.status === 'data_received') {
      if (!p.posterStorageId) throw new Error('Attach a poster PDF before advancing')
      await ctx.db.patch(id, { status: 'poster_attached' })
    } else if (p.status === 'poster_attached') {
      await ctx.db.patch(id, { status: 'sent' })
    } else if (p.status === 'sent') {
      await ctx.db.patch(id, { status: 'poster_attached' })
    }
  },
})

export const remove = mutation({
  args: { id: v.id('properties') },
  handler: async (ctx, { id }) => {
    const p = await ctx.db.get(id)
    if (p?.posterStorageId) {
      try {
        await ctx.storage.delete(p.posterStorageId)
      } catch {
        /* ignore */
      }
    }
    if (p?.videoStorageId) {
      try {
        await ctx.storage.delete(p.videoStorageId)
      } catch {
        /* ignore */
      }
    }
    for (const img of p?.images || []) {
      try {
        await ctx.storage.delete(img.storageId)
      } catch {
        /* ignore */
      }
    }
    await ctx.db.delete(id)
  },
})
