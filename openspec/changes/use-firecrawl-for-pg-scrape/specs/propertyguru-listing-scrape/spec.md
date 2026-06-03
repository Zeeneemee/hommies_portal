## ADDED Requirements

### Requirement: Scrape PropertyGuru listing HTML server-side

The system SHALL fetch the HTML of any `propertyguru.com.sg/listing/...` URL via a single Convex action helper (`proxiedFetch` in `convex/extraction.ts`) so that downstream extractors receive a `{ status, html }` tuple regardless of how the fetch is performed.

#### Scenario: Successful scrape of a public PG listing

- **WHEN** `proxiedFetch` is called with a valid `propertyguru.com.sg/listing/...` URL
- **AND** `FIRECRAWL_API_KEY` is set in the Convex environment
- **THEN** the action SHALL POST to `https://api.firecrawl.dev/v1/scrape` with `{ url, formats: ['html'], onlyMainContent: false }` and bearer auth
- **AND** SHALL return `{ status: 200, html: '<full listing HTML>' }`

#### Scenario: Cloudflare challenge page is treated as blocked

- **WHEN** Firecrawl returns HTML containing Cloudflare challenge markers (`cf-chl`, `just a moment`, `verifying you are human`)
- **THEN** the existing `looksBlocked()` helper SHALL classify the response as blocked and the caller SHALL surface a "blocked" error to the operator

#### Scenario: Missing API key produces a clear error

- **WHEN** `proxiedFetch` is called and `FIRECRAWL_API_KEY` is not set
- **THEN** the action SHALL NOT fall through to a direct fetch
- **AND** SHALL return `{ status: 500, html: '' }` (or throw a clearly-named error) so that the operator sees a configuration error rather than an opaque 403

#### Scenario: JS rendering is always on

- **WHEN** `proxiedFetch` calls Firecrawl
- **THEN** the scrape SHALL be JS-rendered (Firecrawl `/v1/scrape` v1 has no clean toggle to disable rendering, and JS-on is required for lazy-loaded gallery images to appear in the returned HTML)

### Requirement: Single scrape vendor

The scrape path SHALL depend on exactly one external vendor (Firecrawl) and one environment variable (`FIRECRAWL_API_KEY`).

#### Scenario: No legacy proxy env vars are read

- **WHEN** `SCRAPEDO_API_KEY`, `SCRAPER_API_KEY`, `SCRAPINGBEE_API_KEY`, `PG_PREMIUM`, or `PG_RENDER_JS` are set in the Convex environment
- **THEN** `proxiedFetch` SHALL ignore them
- **AND** the source file SHALL contain no `process.env` reads for those names
