// Bedroom-tag derivation — the single source of truth for the normalized
// bedroom label on a property's `tags` array. Shared by the extraction action,
// the prod backfill, the listing edit modal, and the Listings filter so the
// vocabulary never drifts (e.g. "2BR" vs "2 BR"). Pure — no node/react deps —
// so both the Convex bundle and the Vite frontend can import it.

// A property's `tags` array can hold many kinds of label; only these match the
// bedroom namespace. Re-derivation strips anything matching this before writing
// the fresh bedroom tag, leaving non-bedroom tags untouched.
export const BEDROOM_TAG_RE = /^(?:\d+BR|Studio)$/

// Map an extracted bedroom count (and optional unit type) to one bedroom tag.
// Studios win over a numeric count — a studio is one bedroom but operators
// filter it distinctly. Returns undefined when no count is known.
export function deriveBedroomTag(input: {
  bedrooms?: number | null
  unitType?: string | null
}): string | undefined {
  const unitType = (input.unitType ?? '').toString().toLowerCase()
  if (unitType.includes('studio')) return 'Studio'
  const n = input.bedrooms
  if (typeof n === 'number' && Number.isInteger(n) && n >= 1) return `${n}BR`
  return undefined
}

// Replace any prior bedroom tag in `existing` with `tag` (idempotent), keep all
// non-bedroom tags, and de-dup. Passing tag=undefined just strips bedroom tags.
export function mergeBedroomTag(
  existing: string[] | undefined,
  tag: string | undefined,
): string[] {
  const kept = (existing ?? []).filter((t) => !BEDROOM_TAG_RE.test(t))
  if (tag) kept.push(tag)
  return Array.from(new Set(kept))
}
