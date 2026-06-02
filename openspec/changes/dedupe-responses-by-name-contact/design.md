# Design — dedupe responses by name+contact

## Context

Sheet-sync writes rows into the `responses` table via `internal.responses.upsertFromSheet`. Today's dedupe (convex/responses.ts:69-80) is keyed on `sheetTimestamp` only:

```
for each incoming row r:
  if r.sheetTimestamp:
    if responses.by_sheetTimestamp.eq(r.sheetTimestamp).first() exists:
      skipped += 1
      continue
  insert(r)
```

That covers: re-runs of `syncAll`, replays of `onFormSubmitTrigger`, replays of `onEditTrigger`. It does **not** cover the realistic overlap with rows that were created manually in the portal (`source: 'manual'`) or imported via CSV (`source: 'csv'`) before the Apps Script was installed — those rows have no `sheetTimestamp`, so the index returns nothing for any incoming row, and the form-sync row is inserted as a duplicate.

This was observed in production on 2026-06-03: after the first successful `syncAll`, the Customers screen showed several customers twice (manual + sheet copies).

## Design

### Two-tier dedupe in `upsertFromSheet`

```
for each incoming row r:
  # tier 1 — existing index lookup
  if r.sheetTimestamp:
    if responses.by_sheetTimestamp.eq(r.sheetTimestamp).first() exists:
      skipped += 1
      continue
  # tier 2 — name+contact fallback
  key = normaliseMatchKey({ name: r.name, contact: r.contact })
  if key:
    # full collect + filter, no index — see "Why no index" below
    if responses.collect().some(x => normaliseMatchKey(x) === key):
      skipped += 1
      continue
  insert(r)
```

Tier 2 only runs when tier 1 misses, so steady-state cost on form submission is one index lookup + one full-table scan of `responses`. Today the table is < 100 rows; this is fine. If the table grows past a few thousand, add a `by_matchKey` index — the helper is already pure, so the index just stores the precomputed key.

### Normalisation helper

```typescript
// convex/sheetSync.ts
export function normaliseMatchKey(input: { name: unknown; contact: unknown }): string {
  const norm = (s: unknown) =>
    String(s ?? '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
  const n = norm(input.name)
  const c = norm(input.contact)
  if (!n && !c) return ''
  return `${n}|${c}`
}
```

Conservative on purpose:
- Lowercase + trim catches the common case (operator typed `Tan Wei Ming` once and `tan wei ming` another time).
- Whitespace collapse catches double-spaces and the leading/trailing spaces operators paste from chat apps.
- **No** phone normalisation — `+65 9123 4567` vs `+6591234567` will still dupe. Reason: contact field is freeform (could be email, IG handle, WhatsApp link, phone). A digits-only normaliser would collapse different emails to the same key. Operators handle the contact-format edge case manually; if it becomes common, follow up with a `normaliseContact` that branches on detected format.
- Empty `name` *and* empty `contact` → empty key → no match attempted (we never want to collapse anonymous rows into each other).

### On-match policy (decision: skip the form row)

Picked by the operator. Two consequences worth flagging:

1. **Re-submissions are dropped.** A customer who changes their budget and re-submits the form will have the new values discarded — the manual/CSV row stays as-is. Acceptable because re-submissions in practice are rare in this portal; operators are already in the habit of editing customer details directly in the Customers screen.
2. **The existing row never gets `sheetTimestamp` written.** That means tier 1 dedupe will continue to miss for that row forever, and every future form re-push will fall through to tier 2. This is fine — tier 2 is cheap at current table size, and not stamping the existing row avoids changing the source-of-truth `source` field. If we later want to flip the row's provenance to `'sheet'`, we can revisit.

Alternatives considered:
- **Replace** the manual row with form contents → loses any portal edits operators made (e.g. corrected contact, added notes). Rejected.
- **Per-field merge** → too surprising; operators won't be able to predict which field wins. Rejected.

### Cleanup mutation contract

```typescript
// convex/responses.ts
export const mergeDuplicates = internalMutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query('responses').collect()
    const groups = new Map<string, Doc<'responses'>[]>()
    for (const r of all) {
      const key = normaliseMatchKey(r)
      if (!key) continue                   // anonymous rows never merge
      const bucket = groups.get(key) ?? []
      bucket.push(r)
      groups.set(key, bucket)
    }
    let kept = 0, deleted = 0
    const skippedDueToAssignments: Array<{ key: string; responseId: Id<'responses'>; assignmentCount: number }> = []
    for (const [key, bucket] of groups) {
      if (bucket.length < 2) continue
      bucket.sort((a, b) => a.createdAt - b.createdAt)   // oldest first
      const keeper = bucket[0]
      kept += 1
      for (const dup of bucket.slice(1)) {
        const refs = await ctx.db
          .query('assignments')
          .withIndex('by_responseId', (q) => q.eq('responseId', dup._id))
          .collect()
        if (refs.length > 0) {
          skippedDueToAssignments.push({ key, responseId: dup._id, assignmentCount: refs.length })
          continue
        }
        await ctx.db.delete(dup._id)
        deleted += 1
      }
    }
    return { groups: groups.size, kept, deleted, skippedDueToAssignments }
  },
})
```

Policy:
- Keeps the **oldest** `createdAt` in each group — that's most likely the original manual entry, which holds operator-curated context.
- **Never deletes a row that has assignments.** If the newer (form) row already has assignments attached (operator started routing properties to it), the cleanup reports the conflict instead of silently nuking links. Operator resolves by hand: either re-point assignments to the keeper, then re-run the mutation; or delete the older row manually if it's truly the stale one.
- Idempotent: running it again after a clean state returns `{ groups: 0, kept: 0, deleted: 0, skippedDueToAssignments: [] }`.

Assumes an `assignments.by_responseId` index exists (used elsewhere in the codebase — confirmed during implementation). If not, the index is trivially small and can be added in the same change.

### Operator workflow

1. Ship the change.
2. Operator runs `npx convex run responses:mergeDuplicates` from the repo. Expected output for the current state: roughly `{ groups: G, kept: G, deleted: D, skippedDueToAssignments: [] }` where `G` is the number of overlapping customers and `D = G` (assuming no assignments on the form-side dupes yet).
3. If `skippedDueToAssignments` is non-empty: operator inspects each entry in the Convex dashboard, decides whether to reroute assignments or delete the older row, then re-runs.
4. Future form submissions self-dedupe via tier 2; no recurring action needed.

## Risks

- **False positives from name collisions.** Two distinct customers named "John Tan" with the same contact placeholder (e.g. both left contact blank) could collapse. Mitigated: empty key skips matching. If both filled with the same email but are different people, that's a contact-data problem upstream.
- **Cleanup blast radius.** A bug in `normaliseMatchKey` could collapse unrelated rows. Mitigated: keeper is always the oldest; deletions skip any row with assignments; mutation returns a delta the operator can sanity-check before relying on it.
- **Drift between tier 2 dedupe at write time and `mergeDuplicates`.** Both use the same `normaliseMatchKey` import, so they cannot drift.

## Open questions

None blocking.
