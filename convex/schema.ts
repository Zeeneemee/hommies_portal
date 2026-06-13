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
    // Whole-unit room composition — drives the per-person rent split for
    // group customers. Both fields are optional; absent counts opt the
    // listing out of split-aware recommend behaviour. Operator-confirmed
    // (Gemini drafts in extraction, operator edits in ListingEditModal).
    masterCount: v.optional(v.number()),
    commonCount: v.optional(v.number()),
    bedrooms: v.optional(v.number()),
    bathrooms: v.optional(v.number()),
    // Normalized, filterable label set. The first tag kind is a bedroom tag
    // ("Studio" / "<n>BR") derived from the bedroom count by
    // lib/bedroomTags:deriveBedroomTag; the array is designed to hold other
    // kinds later (furnishing, area, housing type).
    tags: v.optional(v.array(v.string())),
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

    // Optional walk-through video for internal reference + the Listings card.
    // Reference-only: not used by the poster generator, the extraction
    // pipeline, or the recommend engine. One video per property — replace by
    // calling properties:setVideo, which deletes the previous blob.
    videoStorageId: v.optional(v.id('_storage')),
    videoName: v.optional(v.string()),
    videoSize: v.optional(v.number()),
    videoContentType: v.optional(v.string()),
    videoAddedAt: v.optional(v.number()),

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
    // Party size including the responding customer. Absent = solo;
    // > 1 unlocks group-aware split scoring in decide().
    groupSize: v.optional(v.number()),
    extras: v.object({
      petFriendly: v.boolean(),
      cookingAllowed: v.boolean(),
      quiet: v.boolean(),
      nearGym: v.boolean(),
      note: v.string(),
    }),
    source: v.optional(v.string()),
    // Google-Sheet submission timestamp — used as the natural dedup key
    // by the /sheet/sync HTTP action so re-runs of the Apps Script trigger
    // never insert the same form submission twice.
    sheetTimestamp: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_createdAt', ['createdAt'])
    .index('by_sheetTimestamp', ['sheetTimestamp']),

  // Operator-driven (property, client) commitments — the "must send" ledger
  // layered on top of the live decide() engine. Pin = "I commit to sending
  // this property to this client"; sent = "the outreach actually went out".
  // Sent rows are immutable (audit trail); unpin sets unpinnedAt as a
  // tombstone so a fresh pin for the same pair can coexist with the
  // withdrawn one. See openspec/changes/descriptive-property-assignments.
  assignments: defineTable({
    propertyId: v.id('properties'),
    responseId: v.id('responses'),
    status: v.union(v.literal('pinned'), v.literal('sent')),
    pinnedAt: v.number(),
    pinnedScore: v.number(),
    pinnedReason: v.optional(v.string()),
    sentAt: v.optional(v.number()),
    sentVia: v.optional(v.string()),
    unpinnedAt: v.optional(v.number()),
  })
    .index('by_property', ['propertyId'])
    .index('by_response', ['responseId'])
    .index('by_status', ['status']),

  // Legacy closed-deal ledger — superseded by `deals`. Kept in the schema so
  // the one-shot migration (`deals:migrateFromSales`) can read from it. Once
  // the migration has been run and verified, this table and `convex/sales.ts`
  // can be removed.
  sales: defineTable({
    responseId: v.id('responses'),
    propertyId: v.id('properties'),
    finalRentSGD: v.optional(v.number()),
    closedAt: v.number(),
    unclosedAt: v.optional(v.number()),
  })
    .index('by_property', ['propertyId'])
    .index('by_response', ['responseId'])
    .index('by_closedAt', ['closedAt']),

  // Leasing-journey ledger. One row per (customer, property) deal that has
  // started moving from listing-sent into the formal leasing flow. A customer
  // may have at most one active (`!cancelledAt`) row at a time. Stage advances
  // are strictly forward — `loi_sent → loi_signed → ta_issued → moved_in`.
  // Skipping forward is allowed; backward transitions are not (use `cancel`
  // and restart instead). `cancelledAt` is a tombstone, not a delete.
  deals: defineTable({
    responseId: v.id('responses'),
    propertyId: v.id('properties'),
    stage: v.union(
      v.literal('loi_sent'),
      v.literal('loi_signed'),
      v.literal('ta_issued'),
      v.literal('moved_in'),
    ),
    loiSentAt: v.optional(v.number()),
    loiSignedAt: v.optional(v.number()),
    taIssuedAt: v.optional(v.number()),
    movedInAt: v.optional(v.number()),
    finalRentSGD: v.optional(v.number()),
    cancelledAt: v.optional(v.number()),
  })
    .index('by_property', ['propertyId'])
    .index('by_response', ['responseId'])
    .index('by_stage', ['stage']),

  // --- team-daily-brief ---------------------------------------------------
  // The four internal teammates. The single identity source for both the
  // Daily Brief UI columns and Telegram bot authorisation. `telegramUserId`
  // gates who may write via the bot; `telegramUsername` (without the @) is how
  // teammates are addressed in cross-assignment / view commands. Seeded once
  // via team:seed; real Telegram values filled in by team:setTelegram.
  teamMembers: defineTable({
    key: v.union(
      v.literal('fu'),
      v.literal('tt'),
      v.literal('fred'),
      v.literal('robert'),
    ),
    name: v.string(),
    telegramUserId: v.optional(v.number()),
    telegramUsername: v.optional(v.string()),
    active: v.boolean(),
  })
    .index('by_key', ['key'])
    .index('by_telegramUserId', ['telegramUserId'])
    .index('by_username', ['telegramUsername']),

  // One row per to-do item. `day` is a Asia/Singapore 'YYYY-MM-DD' string so
  // "today" is unambiguous and directly queryable across portal + bot.
  teamTasks: defineTable({
    assigneeKey: v.union(
      v.literal('fu'),
      v.literal('tt'),
      v.literal('fred'),
      v.literal('robert'),
    ),
    title: v.string(),
    status: v.union(
      v.literal('todo'),
      v.literal('doing'),
      v.literal('done'),
      v.literal('blocked'),
    ),
    day: v.string(),
    // Notion-style list extras. `dueDate` is a 'YYYY-MM-DD' string; `type` is a
    // free tag (Work / Meeting / Personal / Admin / Follow-up). Both optional.
    dueDate: v.optional(v.string()),
    type: v.optional(v.string()),
    createdByKey: v.optional(v.string()),
    source: v.union(v.literal('portal'), v.literal('telegram')),
    createdAt: v.number(),
    doneAt: v.optional(v.number()),
  })
    .index('by_day', ['day'])
    .index('by_assignee_day', ['assigneeKey', 'day']),

  // DEPRECATED — standups were removed from the Daily Brief (tasks-only now).
  // Kept so any rows written before removal still validate on push; drop this
  // table (and its data) once cleared. No code reads or writes it anymore.
  standups: defineTable({
    memberKey: v.union(
      v.literal('fu'),
      v.literal('tt'),
      v.literal('fred'),
      v.literal('robert'),
    ),
    day: v.string(),
    items: v.optional(v.array(v.object({ text: v.string(), done: v.boolean() }))),
    text: v.optional(v.string()),
    updatedAt: v.number(),
    source: v.optional(v.union(v.literal('portal'), v.literal('telegram'))),
  }).index('by_member_day', ['memberKey', 'day']),

  // The big-picture phase plan — a tick-off checklist per period. One row per
  // (granularity, periodKey); periodKey is an ISO week ('2026-W24') or a month
  // ('2026-06'). `items` is the checklist; `content` is kept optional for
  // back-compat with rows written before the checklist change (migrated on
  // first read/write, see phasePlan:legacyItems).
  phasePlans: defineTable({
    granularity: v.union(v.literal('week'), v.literal('month')),
    periodKey: v.string(),
    items: v.optional(v.array(v.object({ text: v.string(), done: v.boolean() }))),
    content: v.optional(v.string()),
    updatedByKey: v.optional(v.string()),
    updatedAt: v.number(),
  }).index('by_period', ['granularity', 'periodKey']),

  // Links an existing customer (responses) to a salesperson to answer/follow
  // up. Kept separate from `responses` so /sheet/sync upserts never clobber
  // an allocation. At most one row per (responseId).
  customerAllocations: defineTable({
    responseId: v.id('responses'),
    assigneeKey: v.union(
      v.literal('fu'),
      v.literal('tt'),
      v.literal('fred'),
      v.literal('robert'),
    ),
    allocatedByKey: v.optional(v.string()),
    allocatedAt: v.number(),
  })
    .index('by_response', ['responseId'])
    .index('by_assignee', ['assigneeKey']),
})
