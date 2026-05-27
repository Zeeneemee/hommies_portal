## ADDED Requirements

### Requirement: Property record stores a single optional video reference

The `properties` table SHALL accept an optional video reference comprising `videoStorageId` (Convex `_storage` ID), `videoName` (string), `videoSize` (number, bytes), `videoContentType` (string, MIME), and `videoAddedAt` (number, epoch ms). All five fields MUST be optional; a property without a video is valid. When `videoStorageId` is present, `videoName`, `videoSize`, `videoContentType`, and `videoAddedAt` MUST also be present.

#### Scenario: Property saved without a video

- **WHEN** Add Property submits with no video picked
- **THEN** the inserted row has `videoStorageId === undefined` and no other video field is set
- **AND** the property is otherwise valid (status, createdAt, images all unaffected)

#### Scenario: Property saved with a video

- **WHEN** Add Property submits with a video file picked
- **THEN** the file is uploaded to Convex storage and the inserted row has all five video fields populated
- **AND** `videoAddedAt` equals the insert timestamp

### Requirement: Video upload uses the existing Convex storage upload-URL flow

Video bytes SHALL be uploaded to Convex `_storage` via `properties:generateUploadUrl` followed by a direct `POST` to the returned URL with the file's content-type header. No new mutation is required to obtain the upload URL.

#### Scenario: Picked video uploads successfully

- **WHEN** the form handler calls `generateUploadUrl()` and then `POST`s the video blob to the returned URL
- **THEN** the response includes `{ storageId }` and that storageId is used in the subsequent `properties:add` or `properties:setVideo` call

### Requirement: setVideo mutation manages replacement and clearing

The Convex `properties:setVideo` mutation SHALL accept `{ id, storageId, name?, size?, contentType? }` where `storageId` is either a `_storage` ID or `null`. When called with a `storageId` and the property already has a `videoStorageId`, the previous blob SHALL be deleted from Convex storage before the row is patched. When called with `storageId: null`, all five video fields SHALL be cleared and the previously stored blob SHALL be deleted.

#### Scenario: Replacing an existing video

- **GIVEN** a property with `videoStorageId = A`
- **WHEN** `setVideo({ id, storageId: B, name, size, contentType })` is called
- **THEN** blob A is deleted from Convex storage
- **AND** the row is patched with the new five video fields and `videoAddedAt = Date.now()`

#### Scenario: Clearing a video

- **GIVEN** a property with `videoStorageId = A`
- **WHEN** `setVideo({ id, storageId: null })` is called
- **THEN** blob A is deleted from Convex storage
- **AND** `videoStorageId`, `videoName`, `videoSize`, `videoContentType`, `videoAddedAt` are all set to `undefined`

#### Scenario: Setting a video on a property that has none

- **GIVEN** a property with `videoStorageId === undefined`
- **WHEN** `setVideo({ id, storageId: B, name, size, contentType })` is called
- **THEN** no storage delete is attempted
- **AND** the row is patched with the five video fields

### Requirement: Property delete cleans up any attached video blob

The `properties:remove` mutation SHALL delete the property's video blob from Convex storage (best-effort, mirroring the image and poster cleanup pattern) before deleting the row.

#### Scenario: Removing a property with a video

- **GIVEN** a property with `videoStorageId = A`
- **WHEN** `properties:remove({ id })` is called
- **THEN** Convex storage delete is invoked on A
- **AND** the property row is deleted
- **AND** a failure to delete the blob does NOT prevent the row deletion

### Requirement: Listings query exposes a resolved video URL

The `properties:list` and `properties:get` queries SHALL include a `videoUrl` field on each returned property — the result of `ctx.storage.getUrl(videoStorageId)` when `videoStorageId` is set, or `null` otherwise. Resolution MUST happen alongside the existing image and poster URL resolution.

#### Scenario: Property with a video

- **WHEN** the client calls `properties:list`
- **THEN** the row's `videoUrl` is a signed URL string and `videoName`, `videoSize`, `videoContentType` are present

#### Scenario: Property without a video

- **WHEN** the client calls `properties:list`
- **THEN** the row's `videoUrl` is `null` (the other video fields are absent)

### Requirement: Add Property form accepts an optional video

The Add Property screen SHALL provide a file picker that accepts video files (`video/mp4`, `video/quicktime`, `video/webm`), enforces a 200 MB maximum, and uploads the picked file as part of the save flow. The picker MUST be optional — submitting without a video MUST NOT block save.

#### Scenario: Picking an oversized video

- **WHEN** the operator picks a 250 MB video
- **THEN** the form rejects the file with a toast naming the 200 MB cap
- **AND** no upload is initiated

#### Scenario: Picking a non-video file

- **WHEN** the operator picks a `.pdf` in the video picker
- **THEN** the form rejects the file with a toast explaining the accepted types
- **AND** the picker is cleared

#### Scenario: Submitting with a video attached

- **WHEN** the operator clicks Save with `condo`, at least one image, and a video attached
- **THEN** images upload, then the video uploads, then `properties:add` runs with all five video fields populated
- **AND** the toast confirms the property was added

### Requirement: Listings edit modal allows replacing or clearing the video

The `ListingEditModal` for an existing property SHALL allow the operator to (a) view the current video (open in new tab + download), (b) pick a new file to replace it (firing `properties:setVideo` with the new storage ID), or (c) clear it (firing `properties:setVideo` with `storageId: null`).

#### Scenario: Replacing the video from the edit modal

- **GIVEN** a property already has a video
- **WHEN** the operator picks a new video file and saves
- **THEN** the new file uploads, `properties:setVideo` is called with the new storage ID, and the old blob is deleted

#### Scenario: Clearing the video from the edit modal

- **GIVEN** a property already has a video
- **WHEN** the operator clicks "Remove video" and saves
- **THEN** `properties:setVideo` is called with `storageId: null` and the row's five video fields are cleared

### Requirement: Add Property draft state persists the picked video across navigation

The `useAddPropertyDraft` hook SHALL track `videoFile`, `setVideoFile`, and a `videoPreviewUrl` (object URL). Navigating between sidebar tabs MUST NOT drop the picked video. `draft.reset()` MUST revoke the `videoPreviewUrl` and set `videoFile` to `null`.

#### Scenario: Switching tabs after picking a video

- **WHEN** the operator picks a video, navigates to Status, then returns to Add Property
- **THEN** the video filename and preview are still present in the form

#### Scenario: Resetting the draft

- **WHEN** `draft.reset()` is called
- **THEN** `videoFile` is `null`
- **AND** the previously held `videoPreviewUrl` is revoked via `URL.revokeObjectURL`
