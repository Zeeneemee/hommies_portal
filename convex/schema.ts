// Convex schema — the live data model for the Hommies.sg portal.
//
// As of the simplify-add-property change: every detail field on `properties`
// is OPTIONAL — a property starts life as just a name + uploaded images and
// the rest is lifted from the Claude `/room-showcase-pdf` poster by the
// extraction action when the poster is attached.
import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  properties: defineTable({
    // Required entry inputs — what Add Property captures from a WhatsApp forward.
    condo: v.string(),
    images: v.optional(
      v.array(
        v.object({
          storageId: v.id('_storage'),
          name: v.string(),
          size: v.number(),
          contentType: v.optional(v.string()),
        }),
      ),
    ),

    // Lifted from the poster by `extraction:extractPosterDetails` after the
    // PDF is attached. All optional — a freshly-added property is valid
    // before extraction has run.
    buildingType: v.optional(v.union(v.literal('Condo'), v.literal('HDB'))),
    area: v.optional(v.string()),
    ageYears: v.optional(v.number()),
    unitType: v.optional(v.string()),
    rentSGD: v.optional(v.number()),
    housingType: v.optional(v.union(v.literal('Room'), v.literal('Whole Unit'))),
    fullAddress: v.optional(v.string()),
    commuteMins: v.optional(
      v.object({
        NUS: v.number(),
        NTU: v.number(),
        SMU: v.number(),
      }),
    ),

    // Pre-existing media shape from hommies-portal-go-live, kept for back-compat
    // with rows already in the database. Add Property no longer writes here.
    media: v.optional(
      v.object({
        photos: v.array(v.string()),
        links: v.array(v.string()),
        videos: v.array(v.string()),
      }),
    ),

    // Poster PDF in Convex file storage + extraction trace.
    posterStorageId: v.optional(v.id('_storage')),
    posterName: v.optional(v.string()),
    posterSize: v.optional(v.number()),
    posterAddedAt: v.optional(v.number()),
    posterExtractedAt: v.optional(v.number()),
    posterExtractionRaw: v.optional(v.string()),
    posterExtractionOk: v.optional(v.boolean()),

    status: v.union(
      v.literal('data_received'),
      v.literal('poster_attached'),
      v.literal('sent'),
    ),

    createdAt: v.number(),
  })
    .index('by_status', ['status'])
    .index('by_createdAt', ['createdAt']),

  responses: defineTable({
    name: v.string(),
    channel: v.string(),
    contact: v.string(),
    school: v.string(),
    moveIn: v.string(),
    leaseLength: v.string(),
    budget: v.object({ min: v.number(), max: v.number() }),
    buildingType: v.string(),
    housingType: v.union(v.literal('Room'), v.literal('Whole Unit')),
    unitLayout: v.array(v.string()),
    commuteTolMins: v.number(),
    wantRoommate: v.boolean(),
    extras: v.object({
      petFriendly: v.boolean(),
      cookingAllowed: v.boolean(),
      quiet: v.boolean(),
      nearGym: v.boolean(),
      note: v.string(),
    }),
    source: v.optional(v.string()),
    createdAt: v.number(),
  }).index('by_createdAt', ['createdAt']),
})
