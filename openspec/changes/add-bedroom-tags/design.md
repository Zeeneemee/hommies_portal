## Context

`properties` already has `bedrooms: v.optional(v.number())`, populated by the two extraction paths in `convex/extraction.ts`:
- `extractPropertyGuruUrl` (URL → distilled HTML → Gemini → `sanitiseGeminiFields`), returned to the client to prefill Add Property; persisted on save by `AddProperty.jsx` / `BatchAddProperty.jsx`.
- `extractPosterDetails` (poster PDF → Gemini → `sanitiseGeminiFields`), which patches the property directly via `internal.properties.update`.

`sanitiseGeminiFields` already normalizes `bedrooms`/`masterCount`/`commonCount` and applies the SG "1 master + rest common" convention. The sibling change `add-bedroom-bathroom-filters` filters on the raw `bedrooms` number via `matchesCount`. The gap: many prod rows predate reliable bedroom extraction, so `bedrooms` is absent and they vanish from any bedroom filter. The user wants a normalized, backfillable `tags` array (bedroom tags first) and re-extraction to populate existing prod rows.

## Goals / Non-Goals

**Goals:**
- Add `tags: string[]` to `properties` — a normalized, extensible label set.
- One deterministic helper that maps a bedroom count → one bedroom tag, shared by extraction, backfill, and manual edit.
- Attach the bedroom tag on both extraction paths, idempotently (replace prior bedroom tag, keep non-bedroom tags).
- A one-shot backfill that re-extracts existing prod rows to recover `bedrooms` and write the tag.
- Filter by bedroom tag on a property-search surface, reusing existing filter machinery.

**Non-Goals:**
- A general tag-management UI (create/rename/colour arbitrary tags). Tags are derived, not hand-authored, in this change.
- Non-bedroom tag kinds (furnishing, area, housing type) — the array is designed to hold them later, but none are introduced now.
- Changing the existing `bedrooms` number filter from `add-bedroom-bathroom-filters`; the tag filter is additive.
- Indexing tags in Convex — the property set is small enough to filter client-side, matching the existing filter surfaces.

## Decisions

**1. `tags` is a free `v.optional(v.array(v.string()))`, not a union/enum.**
Extensibility is the whole point (the user chose "generic tags[] array"). Validation/normalization happens in code (the derivation helper), not the schema, mirroring how `sanitiseGeminiFields` already guards union fields rather than relying on Convex validators alone.

**2. Bedroom-tag vocabulary: `"Studio"` and `"<n>BR"`.**
Derivation `deriveBedroomTag({ bedrooms, unitType })`:
- `unitType === 'Studio'` (or bedrooms resolves to a studio) → `"Studio"`.
- integer `bedrooms >= 1` → `` `${bedrooms}BR` `` (`"1BR"`, `"2BR"`, …).
- otherwise → no tag.
Tags are namespaced by a regex so re-derivation can strip only bedroom tags: `BEDROOM_TAG_RE = /^(\d+BR|Studio)$/`. A `mergeBedroomTag(existing, newTag)` helper drops any element matching that regex, then appends `newTag` if present, then de-dups — this is the single source of idempotency used by all three writers.

**3. Both extraction paths reuse one merge.**
- `extractPropertyGuruUrl`: after `sanitiseGeminiFields`, compute the bedroom tag and return `tags` in `fields` (no prior tags exist server-side here — the client owns persistence). `AddProperty.jsx` / `BatchAddProperty.jsx` copy `fields.tags` onto the property arg on save, the same way they already copy `bedrooms`.
- `extractPosterDetails`: the property already exists, so read its current `tags`, `mergeBedroomTag(current, derived)`, and include `tags` in the patch sent to `internal.properties.update`.

**4. Backfill = re-extraction, as an internal action iterating all properties.**
`convex/properties.ts` (or a small `migrations.ts`) gets an internal action `backfillBedroomTags` that pages through every property and, for each, calls the existing `extractPosterDetails` when a poster is attached. Re-using `extractPosterDetails` means the tag write goes through the exact same code path as live extraction (no parallel logic to drift). Rows without a recoverable count are left untagged and logged; failures are caught per-row so one bad PDF doesn't abort the run. It is invoked once from the Convex dashboard/CLI against prod. Gemini cost ≈ one call per property with a poster.

**5. `properties.update` validator gains `tags: v.optional(v.array(v.string()))`** so both the patch from extraction and the edit modal can write it.

**6. Edit modal recompute.** `ListingEditModal.jsx` already edits `bedrooms`; on save it computes `mergeBedroomTag(property.tags, deriveBedroomTag(form))` so a manual bedroom change keeps the tag correct.

**7. Filter UI.** Add a bedroom-tag filter to `Listings.jsx`, modelled on the existing chip/range filter pattern (active-state + Clear-filters integration). Predicate: when the filter is set, keep `p` iff `p.tags?.includes(selectedTag)`. Recommend.jsx is optional follow-on; the spec only requires "a property-search surface."

## Risks / Trade-offs

- **Tag/number divergence.** `tags` (string) and `bedrooms` (number) can disagree if one is edited without the other. Mitigation: every bedroom write site (extraction, backfill, edit modal) recomputes the tag from the count via the shared helper — there is no path that sets `bedrooms` without re-deriving.
- **Backfill cost & blocking.** Re-extraction spends a Gemini call per property and PropertyGuru/Cloudflare may block URL-sourced rows. Mitigation: backfill leans on the poster path (no Cloudflare), processes per-row with try/catch, and skips unrecoverable rows rather than failing the batch. It is a one-shot manual run, not a scheduled job.
- **Studio ambiguity.** A studio is one bedroom; `"Studio"` vs `"1BR"` could surprise filtering. Decision: prefer `"Studio"` when `unitType` says studio, else `"1BR"`. Documented in the derivation so the filter UI can offer both.
- **Free-string tags invite drift** (`"2BR"` vs `"2 BR"`). Mitigation: the only writer of bedroom tags is `deriveBedroomTag`; no free-text tag entry is exposed in this change.
