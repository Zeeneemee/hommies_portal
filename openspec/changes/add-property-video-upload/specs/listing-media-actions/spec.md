## ADDED Requirements

### Requirement: Each Listings card exposes open-in-new-tab and download actions for every image

On the Listings inventory card, every image (hero + each thumb) SHALL provide two operator-visible actions: "Open" (loads the image in a new browser tab) and "Download" (saves the file to the operator's machine using the original filename). The actions MUST use the resolved Convex signed URL from the existing `images[].url` field — no new network round-trip is required to enable them.

#### Scenario: Operator opens an image in a new tab

- **WHEN** the operator clicks the "Open" action on any image tile
- **THEN** the browser opens the signed URL in a new tab
- **AND** the original tab is unaffected

#### Scenario: Operator downloads an image

- **WHEN** the operator clicks the "Download" action on any image tile
- **THEN** the browser saves the file using the image's `name` field as the suggested filename

#### Scenario: A card with no images

- **WHEN** a property has zero images
- **THEN** the card renders the existing "No photos yet" placeholder
- **AND** no Open/Download actions are visible

### Requirement: Each Listings card exposes the video with open-in-new-tab and download actions

When a property has a video, the Listings card SHALL render a video affordance (icon tile or row) showing the filename and offering "Open" (new tab) and "Download" (using the video's `name` field) actions. When the property has no video, the card SHALL show a muted "No video" indicator in the same slot — never silently omit the slot, so the operator can see at a glance which properties lack a video.

#### Scenario: Card for a property with a video

- **WHEN** the property has `videoUrl !== null`
- **THEN** the card renders a video tile showing the filename, an Open action, and a Download action

#### Scenario: Card for a property without a video

- **WHEN** the property has `videoUrl === null`
- **THEN** the card renders a muted "No video" indicator in the same slot the video tile would occupy

#### Scenario: Operator opens a video

- **WHEN** the operator clicks "Open" on the video tile
- **THEN** the browser opens the signed video URL in a new tab and renders the native `<video controls>` player

#### Scenario: Operator downloads a video

- **WHEN** the operator clicks "Download" on the video tile
- **THEN** the browser saves the file using the video's `name` field as the suggested filename

### Requirement: Media actions must not interfere with existing card click targets

Adding the Open/Download actions SHALL NOT regress the existing Listings card click handlers (Edit, Advance status, Delete, Open in Recommend). The actions MUST be implemented as nested links/buttons that stop propagation so a click on "Open" does not also trigger the card's edit handler.

#### Scenario: Click on Download does not open the edit modal

- **WHEN** the operator clicks Download on an image tile inside a card with a clickable surface
- **THEN** the file downloads
- **AND** the edit modal does NOT open
