## Context

The Hommies portal stores property assets in Convex's built-in file storage (`_storage`). Today, two kinds of binary assets live on a property row: a multi-image array (`images: [{storageId, name, size, contentType}]`) and a single poster PDF (`posterStorageId`, `posterName`, `posterSize`, `posterAddedAt`). Both flow through `properties:generateUploadUrl` → direct `POST` to the signed Convex URL → mutation that persists the `storageId`. The Listings screen renders images via resolved `ctx.storage.getUrl(...)` outputs but currently has no per-asset download/open-in-new-tab UI — the image is just an `<img>` hero and a thumb strip.

The operator team has asked for one optional walk-through video per property. The video is reference-only: not used by the poster generator, not consumed by extraction, not scored by the recommend engine. It must be uploadable on Add Property, replaceable later from the Listings edit modal, and visible on the Listings card with a one-click "open in new tab" and a download action. The same affordances are wanted for the existing images on the card.

The user specifically asked for a "bucket" dedicated to video. Convex's storage is a single flat keyspace — there are no native multi-bucket primitives — so this design treats the "bucket" as a logical namespace: dedicated schema fields (`videoStorageId`, etc.), dedicated mutations (`setVideo`, mirror of `setPoster`), and a strict 1:1 cardinality (one video per property, replace-or-clear semantics) that keeps video bytes isolated from images and posters.

## Goals / Non-Goals

**Goals:**
- One optional MP4/QuickTime/WebM video per property, ≤ 200 MB.
- Upload at Add Property time without blocking save when omitted.
- Replace / clear the video from the Listings edit modal.
- Listings card surfaces the video (open-in-new-tab + download) and the existing image hero/thumbs gain matching open + download affordances.
- Storage cleanup on replace and on property delete — no orphaned video blobs in Convex storage.

**Non-Goals:**
- In-page video playback (autoplay, scrubbing, custom controls). The browser handles playback in the new tab via the native `<video>` HTML element from the signed URL.
- Multiple videos per property. The product ask is one walk-through; multiple would shape into a `videos: []` array later if needed.
- Transcoding, thumbnail extraction, or HLS streaming. Convex serves the original blob via signed URL — adequate for ≤ 200 MB clips an admin watches.
- Video metadata on the poster, the extraction pipeline, or the recommend engine. Video is reference-only.
- Switching the storage backend to S3 / Vercel Blob. Convex storage stays canonical for now; the "bucket" is a schema-level namespace.

## Decisions

### 1. Convex storage with dedicated schema fields, not a separate backend
**Choice:** Add `videoStorageId`, `videoName`, `videoSize`, `videoContentType`, `videoAddedAt` to the `properties` table. Reuse `properties:generateUploadUrl` (it's content-type agnostic).

**Alternatives considered:**
- *Vercel Blob*: introduces a second storage backend, second URL signing path, and a second deletion code path. No payoff for a reference-only asset that the operator team watches once.
- *A `videos: []` array (like `images`)*: premature. The user said "this video" (singular). Adding plurality later is a small migration; reverting from plural-to-singular when unused is wasted complexity.
- *An external S3 bucket with presigned URLs*: same overhead as Vercel Blob, plus we'd hand-roll cleanup. Convex's `ctx.storage.delete` is already wired into `properties:remove` for images and posters.

**Rationale:** Same code path as existing image/poster uploads, same cleanup story, same signed-URL retrieval. Treating the "bucket" as a dedicated set of schema fields gives video its own lifecycle without diverging from the rest of the storage code.

### 2. One video per property (replace, don't accumulate)
**Choice:** Singular `videoStorageId` field. `setVideo` mirrors `setPoster` — uploading a new video deletes the previous blob from Convex storage before patching the row.

**Rationale:** The product ask is one walk-through. A replace-or-clear surface is mentally simpler than managing a list (no reorder, no remove-one-of-many). The mirror of `setPoster` keeps the convex code symmetric and reviewable.

### 3. Client-side type + size validation; no server-side gating beyond Convex defaults
**Choice:** In `AddProperty.jsx` / `ListingEditModal.jsx`, reject files whose `type` is not in `['video/mp4', 'video/quicktime', 'video/webm']` and whose `size` exceeds 200 MB. No server-side check.

**Alternatives considered:**
- *Server-side mutation validation*: the bytes arrive at Convex storage via the signed URL **before** the mutation runs, so a server check inside `setVideo` rejects the metadata but doesn't reclaim the bytes. Cleanup-on-reject is extra complexity for an internal tool with a trusted operator UI.

**Rationale:** Validation lives where it can actually prevent the upload — in the file picker handler before we generate the upload URL. We trust the admin UI for size/type policy.

### 4. Listings media actions: native `<a download>` and `target="_blank"`
**Choice:** Each image tile on the Listings card gets a small overlay with two icon buttons — "Open" (`<a target="_blank">`) and "Download" (`<a download={img.name}>`). The video gets a play-icon tile with the same two actions plus a Replace/Remove control behind the edit modal.

**Alternatives considered:**
- *Custom download proxy via Convex HTTP action*: needed only if cross-origin blocks the `download` attribute. Convex signed URLs are same-origin to the file server, so the native attribute works.
- *Inline `<video>` element on the card*: heavier (browser starts buffering on render of every card) and the team only wants to watch on demand.

**Rationale:** Cheapest possible UI, native browser behavior, no extra backend code.

### 5. Form draft scope: extend `useAddPropertyDraft`
**Choice:** Add `videoFile`, `setVideoFile`, and a `videoPreviewUrl` (object URL) to the existing draft hook so navigating away and back during Add Property doesn't drop the picked video. Include the object URL in `reset()`'s revoke pass to avoid leaks.

**Rationale:** Matches the established pattern for `posterFile` and image previews. Keeps `AddProperty.jsx` from owning yet another piece of standalone state.

## Risks / Trade-offs

- **Large uploads block the admin's tab** → 200 MB cap + a clear "uploading…" state on save; same UX as the existing image upload loop. If 200 MB feels small, we'll revisit with a real upload-progress indicator before raising the cap.
- **Convex storage costs grow per-video** → acceptable: the team curates inventory manually and orphan rows get pruned in the existing `properties:remove` flow. Video cleanup is wired into that path.
- **Browser auto-plays muted video in new tab** → harmless. The page is just `<video controls>` on a signed URL; no autoplay attribute. Operator presses play.
- **Operator forgets a video is attached when deleting a property** → the existing delete confirmation says "removes the property and its poster from storage." Extend the message to mention the video, too, so the side-effect is explicit.
- **`videoUrl` is a short-lived signed URL** → fine for the actions card because the URL is re-resolved on every Listings query reactively. We do not embed `videoUrl` into long-term snapshots.

## Migration Plan

- No data migration: every new field on `properties` is optional. Existing rows have `videoStorageId === undefined` and render with the "No video" affordance on the card.
- No removal of fields. The legacy `media.videos: string[]` field (from `hommies-portal-go-live`) is left untouched — it's already write-orphaned in `AddProperty.jsx`. Documenting separately would just clutter this change.
- Deploy order: ship the Convex schema + `properties.ts` changes first (additive — safe under Convex's rolling deploys), then ship the UI. No coordinated cutover required.
