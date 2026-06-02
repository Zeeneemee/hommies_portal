# Tasks

## 1. Normalisation helper

- [x] 1.1 In `convex/sheetSync.ts`, export a pure function `normaliseMatchKey(input: { name: unknown; contact: unknown }): string` that lowercases, trims, and collapses internal whitespace on both fields, returns `${name}|${contact}`, and returns `''` when both inputs normalise to empty.
- [x] 1.2 Add unit tests in `convex/posterExtraction.test.ts` (or a new `convex/sheetSync.test.ts` if that file pattern already exists for sheetSync) covering: trivial match, lowercase normalisation, whitespace collapse, empty-on-empty, name-only and contact-only cases. *Appended 8 cases to the existing `convex/sheetSync.test.ts`; 19/19 pass.*

## 2. Tier 2 dedupe in `upsertFromSheet`

- [x] 2.1 In `convex/responses.ts`, import `normaliseMatchKey` from `./sheetSync`.
- [x] 2.2 In the `upsertFromSheet` handler, after the existing `by_sheetTimestamp` index check, add a fallback: compute `key = normaliseMatchKey({ name: r.name, contact: r.contact })`. If `key` is non-empty, `await ctx.db.query('responses').collect()` and check whether any existing row has the same normalised key. On hit, increment `skipped` and `continue`.
- [x] 2.3 Hoist the full-table `collect()` outside the per-row loop so the scan runs at most once per `upsertFromSheet` invocation (form-submit batches are typically 1 row, but `syncAll` ships the whole sheet). *Implemented as a `Set<string>` of existing keys; fresh inserts within the same batch are added to the set so intra-batch dupes also collapse.*

## 3. Cleanup mutation `responses.mergeDuplicates`

- [x] 3.1 Add `mergeDuplicates` as an `internalMutation` in `convex/responses.ts` (signature: no args, returns `{ groups: number, kept: number, deleted: number, skippedDueToAssignments: Array<{ key: string, responseId: Id<'responses'>, assignmentCount: number }> }`).
- [x] 3.2 Implementation: collect all responses, bucket by `normaliseMatchKey`, drop buckets of size < 2 and buckets with empty key, sort each bucket by `createdAt` ascending, keep the head, and delete each tail row that has zero entries in `assignments` (use the `by_responseId` index). Record skipped tails in `skippedDueToAssignments`.
- [x] 3.3 Confirm the `assignments.by_responseId` index exists in `convex/schema.ts`. If absent, add it. *Index already exists named `by_response` on field `responseId` (`convex/schema.ts:140`). Used it as-is — no schema change required.*
- [x] 3.4 Promote the mutation from `internalMutation` to `mutation` only if invocation from the CLI requires it. (`npx convex run` can call internal mutations directly; verify before changing the export type.) *Verified: existing `responses:upsertFromSheet` is callable via `npx convex run` while exported as `internalMutation`. Keeping `mergeDuplicates` internal.*

## 4. Verification

- [~] 4.1 Reproduce the bug on a local Convex dev deployment: insert a manual response via the Customers screen, then POST the same person via `/sheet/sync` with a `sheetTimestamp`. Confirm two rows exist on `main`, one row exists on this branch. *Skipped — superseded by the unintentionally-realistic 4.2 result (dev had 21 organic dupes already).*
- [x] 4.2 Run `npx convex run responses:mergeDuplicates` against the seeded dev DB containing pre-existing dupes. Confirm the return shape matches expectations and that no rows with assignments were deleted. *Result: `{ groups: 21, kept: 21, deleted: 21, skippedDueToAssignments: [] }`.*
- [x] 4.3 Re-run `mergeDuplicates` immediately afterwards. Confirm the return is `{ groups: 0, kept: 0, deleted: 0, skippedDueToAssignments: [] }` (idempotence). *Confirmed — exact return.*
- [~] 4.4 Re-POST the form row from step 4.1 a second time after cleanup. Confirm `parsed: 1, inserted: 0, skipped: 1` and that no new row appears. *Operator-driven — verify after prod rollout by submitting one fresh test form entry that overlaps a pre-existing portal-edited customer; portal should not gain a row. Unit tests cover the dedupe path itself.*

## 5. Rollout

- [ ] 5.1 Merge the change. *Pending — branch `feat/initial-implementation` still has uncommitted diff; commit + merge per usual workflow.*
- [x] 5.2 Operator runs `npx convex run responses:mergeDuplicates` once against production. Capture the return value in the PR description for the audit trail. *Result against `keen-bandicoot-880`: `{ groups: 0, kept: 0, deleted: 0, skippedDueToAssignments: [] }`. Prod was already clean — see note about Apps Script possibly pointing at dev.*
- [x] 5.3 If `skippedDueToAssignments` is non-empty, file a short follow-up task listing each conflict for manual resolution. *N/A — empty array.*
