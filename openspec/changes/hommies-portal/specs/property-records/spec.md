## ADDED Requirements

### Requirement: Create a structured property record

The Add Property screen SHALL let the admin enter a structured property record from an agent's WhatsApp forward, capturing condo/HDB name, area, building type (Condo/HDB), building age, room type, and monthly rent, and persist it through `store.js`.

#### Scenario: Admin saves a new property

- **WHEN** the admin fills in name, area, building type, building age, room type, and rent and submits
- **THEN** the portal saves the property record and it becomes available on the Status and Listings screens

#### Scenario: Required core fields are enforced

- **WHEN** the admin submits with a missing core field (name, area, building type, room type, or rent)
- **THEN** the portal blocks the save and indicates which field is missing

### Requirement: Record property media

A property record SHALL hold the media from the WhatsApp forward — photos, links (e.g. PropertyGuru), and a room-tour video URL — recorded cleanly against the property.

#### Scenario: Admin records links and video

- **WHEN** the admin adds a PropertyGuru link and a video URL to a property
- **THEN** both are stored on the property record and shown with it

#### Scenario: Image-only forward still produces a clean record

- **WHEN** the forward contained only images with no structured listing text
- **THEN** the admin can still complete the record by manually entering rent, address, and unit details into the form fields

### Requirement: Attach poster PDF to a property record

The Add Property screen SHALL accept the finished poster as a PDF file upload and store the PDF with the property record itself, not as an external link.

#### Scenario: Admin uploads a poster PDF

- **WHEN** the admin uploads a poster PDF to a property record
- **THEN** the PDF is persisted with that property and can be retrieved later from the record

#### Scenario: Non-PDF upload is rejected

- **WHEN** the admin attempts to attach a file that is not a PDF
- **THEN** the portal rejects the upload and explains that a PDF is required

### Requirement: Property progress status fields

Each property record SHALL carry a three-state status — Data received, Poster attached, Sent — that the portal updates as the property moves through the workflow.

#### Scenario: Saving a property marks data received

- **WHEN** a property record is first saved
- **THEN** its status shows Data received

#### Scenario: Attaching a poster advances status

- **WHEN** a poster PDF is attached to a property
- **THEN** its status advances to Poster attached
