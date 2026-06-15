## ADDED Requirements

### Requirement: Scraped pages are cached server-side by normalized URL

The system SHALL maintain a server-side cache of scraped page HTML keyed by a normalized URL (host + path, with `www.`, query string, and fragment removed, lower-cased). Both the listing-extraction scrape and the project-page scrape SHALL consult this cache before calling the proxy, and SHALL store the result on a miss.

#### Scenario: Cache hit avoids a proxy call

- **WHEN** a URL whose normalized key has a non-expired cache entry is scraped
- **THEN** the stored HTML is returned without calling Firecrawl or ScrapingBee
- **AND** no scraping credits are consumed

#### Scenario: Cache miss scrapes and stores

- **WHEN** a URL with no (or expired) cache entry is scraped and the scrape succeeds
- **THEN** the proxy is called once and the result is written to the cache under the normalized key

#### Scenario: URL variants share one entry

- **WHEN** the same listing is scraped via two trivially different URLs (e.g. trailing slash, tracking query params, `www.` vs not)
- **THEN** both resolve to the same cache key and the second is served from cache

### Requirement: Cache entries expire after the TTL

A cache entry SHALL be considered valid only within 7 days of when it was fetched. An entry older than the TTL SHALL be treated as a miss and re-scraped.

#### Scenario: Fresh entry is reused

- **WHEN** a cache entry was fetched 2 days ago
- **THEN** it is served from cache

#### Scenario: Stale entry is re-scraped

- **WHEN** a cache entry was fetched 8 days ago
- **THEN** it is treated as a miss, re-scraped, and the entry is overwritten

### Requirement: Only successful scrapes are cached

The cache SHALL store only successful scrapes — non-empty HTML with a status below 400. Blocked, errored, or out-of-credits (e.g. HTTP 402/403) responses SHALL NOT be cached.

#### Scenario: Failed scrape is not cached

- **WHEN** a scrape returns empty HTML or a status >= 400
- **THEN** nothing is written to the cache
- **AND** a later attempt for the same URL scrapes again rather than returning a cached failure

### Requirement: Force-refresh bypasses the cache

The extraction action SHALL accept an optional `force` flag. When set, the scrape SHALL bypass any cached entry, call the proxy, and overwrite the cache entry with the fresh result.

#### Scenario: Force-refresh re-scrapes

- **WHEN** extraction is invoked with `force: true` for a URL that has a valid cache entry
- **THEN** the proxy is called and the cache entry is replaced with the new result

#### Scenario: Default does not force

- **WHEN** extraction is invoked without `force`
- **THEN** a valid cache entry is used and no proxy call is made
