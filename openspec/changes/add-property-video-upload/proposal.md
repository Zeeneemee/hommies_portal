## Why

Operators often receive walk-through videos for a property alongside the photos, but the portal only accepts images and a poster PDF today. The video isn't needed for the poster (which is image-only), but the team wants it stored for internal reference and visible on the Listings inventory so they can re-watch the unit before sending it to a candidate. They also want a quick way to download or open every media asset (existing images + the new video) in a new tab from the Listings screen.

## What Changes

- Add a single optional video file per property captured at Add Property time (and editable later). One video per property — replace, don't accumulate.
- Add a new "bucket" namespace dedicated to video in Convex file storage. Convex doesn't have multi-bucket primitives — we model the bucket as a dedicated set of schema fields (`videoStorageId`, `videoName`, `videoSize`, `videoContentType`, `videoAddedAt`) so video bytes are isolated from images/poster and have their own lifecycle (replace, remove, cleanup).
- Add video upload UI to the Add Property form (below the images grid, above the poster section) — accept common video MIME types, cap size, show inline preview of the picked file before save.
- Show the video on each Listings card: an inline thumbnail/play button that opens the video in a new tab, plus a download action. Images on the same card gain matching "open in new tab" and "download" affordances.
- Surface video metadata in the Listings query response (`videoUrl`, `videoName`, `videoSize`) alongside the existing `posterUrl` and `images[].url` so the UI can render links without extra round-trips.
- Wire video cleanup into `properties:remove` and into the video-replace path so storage doesn't leak orphaned blobs.
- Edit modal (`ListingEditModal`) gains a control to replace or clear the video on existing properties.

## Capabilities

### New Capabilities
- `property-video`: per-property video upload, storage, retrieval, replacement, and removal — including the dedicated Convex storage namespace.
- `listing-media-actions`: download + open-in-new-tab actions for property media (images and video) on the Listings screen.

### Modified Capabilities
<!-- No existing `openspec/specs/` directory in this project, so there are no modified capabilities yet. -->

## Impact

- Schema: `convex/schema.ts` — add `videoStorageId`, `videoName`, `videoSize`, `videoContentType`, `videoAddedAt` to the `properties` table.
- Convex functions: `convex/properties.ts` — extend `add`, add `setVideo` mutation (mirror of `setPoster`), include video cleanup in `remove`, expose `videoUrl` in `list`/`get`, accept video fields in `update` patch.
- Frontend: `src/components/AddProperty.jsx` — new video picker + state in `useAddPropertyDraft`; upload on save; preview before save.
- Frontend: `src/components/Listings.jsx` — render the video thumbnail/play action on each card and add download / open-in-new-tab affordances for images + video.
- Frontend: `src/components/ListingEditModal.jsx` — replace/clear video control for existing properties.
- Form draft state: `useAddPropertyDraft` (likely in `App.jsx`) gains `videoFile`/`setVideoFile` and includes it in `reset()` (object URL revocation).
- No change to: poster generation, extraction pipeline, recommend engine, or assignments ledger. Video is reference-only.
