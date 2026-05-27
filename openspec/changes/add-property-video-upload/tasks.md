## 1. Convex schema + storage

- [x] 1.1 Add `videoStorageId`, `videoName`, `videoSize`, `videoContentType`, `videoAddedAt` as optional fields on the `properties` table in `convex/schema.ts`.
- [ ] 1.2 Run `npx convex dev` once locally to confirm the schema migration applies without warnings against existing rows. **(deferred — needs interactive Convex auth; user must run)**

## 2. Convex functions

- [x] 2.1 Extend `properties:add` args in `convex/properties.ts` to accept the five new video fields (all optional) and persist them on insert.
- [x] 2.2 Add `properties:setVideo` mutation modeled on `setPoster`: accepts `{ id, storageId: v.union(v.id('_storage'), v.null()), name?, size?, contentType? }`, deletes any previous `videoStorageId` blob, and writes the new fields or clears all five.
- [x] 2.3 Update `properties:remove` to call `ctx.storage.delete(p.videoStorageId)` (best-effort) before deleting the row.
- [x] 2.4 Update `properties:list` and `properties:get` to resolve `videoUrl` via `ctx.storage.getUrl(videoStorageId)` (or `null`) alongside the existing `posterUrl` resolution.
- [x] 2.5 Update the `properties:update` patch validator to accept the five video fields so the existing edit modal save path stays functional (note: `setVideo` is the canonical replace/clear path; `update` is for non-blob field edits — but the validator must not reject these keys if present).

## 3. Add Property form — draft state

- [x] 3.1 Extend `useAddPropertyDraft` (in `src/App.jsx`) with `videoFile`, `setVideoFile`, and a managed `videoPreviewUrl` (object URL created via `useEffect` mirror of `posterFile`).
- [x] 3.2 Include the video preview URL in `draft.reset()`'s revoke pass; ensure `setVideoFile(null)` is called on reset.

## 4. Add Property form — UI

- [x] 4.1 In `src/components/AddProperty.jsx`, render a new card "Video (optional)" between the Images and Poster cards: a file picker accepting `video/mp4,video/quicktime,video/webm`, a 200 MB size cap, an inline filename + size readout, and a "View" link using the preview URL.
- [x] 4.2 Add a `handleVideoPicked(file)` handler that rejects non-video types and >200 MB files with a toast and clears the picker.
- [x] 4.3 In `handleSubmit`, after image upload and before poster upload, call `uploadBlob(videoFile)` when present and pass `videoStorageId`, `videoName`, `videoSize`, `videoContentType` into the `addProperty(...)` call.
- [x] 4.4 Reset the video file input ref in the post-save cleanup alongside `imagesRef` and `posterRef`.

## 5. Listings card UI

- [x] 5.1 In `src/components/Listings.jsx`, add a small action overlay on every image tile (hero + each thumb) with two buttons: "Open" (`<a target="_blank" rel="noopener noreferrer">`) and "Download" (`<a download={img.name}>`).
- [x] 5.2 Ensure the action buttons call `event.stopPropagation()` so clicks don't bubble to any card-level click target.
- [x] 5.3 Add a video slot to the card: when `p.videoUrl` is set, render a video tile showing the filename, an Open action, and a Download action. When `p.videoUrl` is `null`, render a muted "No video" indicator in the same slot.
- [x] 5.4 Update the existing delete confirmation copy in `handleDelete` to mention the video alongside the poster (`"… removes the property, its poster, and its video from storage."`).

## 6. Listings edit modal

- [x] 6.1 In `src/components/ListingEditModal.jsx`, add a Video section: shows current filename + size if present, with Open and Download links; a "Replace" button opens a hidden file input with the same type/size validation as Add Property; a "Remove video" button (visible only when present) clears the local state.
- [x] 6.2 Wire the modal's save flow to call `properties:setVideo({ id, storageId, name, size, contentType })` for a replacement upload, or `properties:setVideo({ id, storageId: null })` for a clear. Keep the existing `properties:update` call for non-blob field edits.

## 7. Tests + smoke checks

- [ ] 7.1 Manually verify the Add Property happy path: pick condo + image + video → save → confirm row in Convex dashboard has all five video fields and that the blob exists. **(deferred — needs running dev env + browser)**
- [ ] 7.2 Manually verify replace: from the Listings edit modal, upload a second video → confirm the old `videoStorageId`'s blob is no longer present in Convex storage. **(deferred — needs running dev env + browser)**
- [ ] 7.3 Manually verify clear: from the edit modal, click "Remove video" → confirm row no longer has the five video fields and the blob is gone. **(deferred — needs running dev env + browser)**
- [ ] 7.4 Manually verify delete: delete a property that has a video → confirm both row and blob are gone. **(deferred — needs running dev env + browser)**
- [ ] 7.5 Manually verify Listings card: Open + Download on an image and on the video work, neither triggers the card's edit modal, and the "No video" indicator renders for legacy rows. **(deferred — needs running dev env + browser)**

## 8. Cleanup

- [x] 8.1 Lint the changed files (`npm run lint` or the project's equivalent) and resolve any new warnings. **(no `lint` script in this repo — substituted `vite build` (clean) and `vitest run` (33/33 passing))**
- [x] 8.2 Update any CLAUDE.md or feature notes that enumerate property assets so the video is mentioned alongside images and the poster. **(no CLAUDE.md or asset-enumerating doc found in the repo — N/A)**
