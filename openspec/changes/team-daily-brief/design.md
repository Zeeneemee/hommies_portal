## Context

The portal is a React 18 + Vite SPA backed by Convex (real-time DB + serverless functions). Routes are declared in `src/App.jsx`; pages are components in `src/components/*.jsx` that read with `useQuery('module:fn')` and write with `useMutation('module:fn')`. The data model lives in `convex/schema.ts`; the only existing HTTP route is `/sheet/sync` in `convex/http.ts`, which already establishes the pattern of a secret-guarded `httpAction` that runs an internal mutation.

There is no auth and no user/identity concept today. Customers are `responses` rows (fed from a Google Form via `/sheet/sync`). This change adds the first notion of a "team member" (the four named teammates) and a Telegram-driven write path into Convex.

## Goals / Non-Goals

**Goals:**
- One Daily Brief page showing today's per-person to-do board, customer allocations, and standup notes, all real-time.
- An editable week/month phase plan scoped by period.
- A command-based, two-way Telegram bot mapped to the four teammates, writing the same Convex data the portal reads.
- Reuse the existing Convex/httpAction pattern — no new infrastructure or npm dependencies.

**Non-Goals:**
- General user authentication / login for the portal (still internal, trusted).
- Rich Telegram UX (inline keyboards, conversation state machines) — slash/text commands only in v1.
- Notifications/reminders pushed proactively by the bot (read-only summaries can come later).
- Replacing the existing Pipeline/Customers screens; allocation reuses `responses`, it does not fork it.

## Decisions

### Data model (new tables in `convex/schema.ts`)
- `teamMembers`: `{ key: 'fu'|'tt'|'fred'|'robert', name, telegramUserId: number, telegramUsername: string, active }` indexed `by_telegramUserId`, `by_username`, and `by_key`. Seeded once (mutation or dashboard). This is the identity source for both UI columns and bot authorization. `telegramUsername` (without the `@`) is how teammates are addressed in cross-assignment commands.
- `teamTasks`: `{ assigneeKey, title, status: 'todo'|'doing'|'done'|'blocked', day: 'YYYY-MM-DD', dueDate?, type?, createdByKey?, source: 'portal'|'telegram', createdAt, doneAt? }` indexed `by_day` and `by_assignee_day`. `day` is a date string in Asia/Singapore so "today" is unambiguous and queryable. `dueDate` (a date string) and `type` (a free tag — Work/Meeting/Personal/Admin/Follow-up) are optional, surfaced as a Notion-style list row.
- `phasePlans`: `{ granularity: 'week'|'month', periodKey, items: { text, done }[], updatedByKey?, updatedAt }` indexed `by_period` (`[granularity, periodKey]`). `periodKey` = ISO week (`2026-W24`) or month (`2026-06`). The plan is a tick-off checklist; a legacy `content` string (from before the checklist change) is migrated into items on first read/write.
- Customer allocation: add `convex/customerAllocations.ts` writing an optional `assigneeKey` allocation. **Decision: a separate `customerAllocations` table** keyed `by_response`, rather than adding a field to `responses` — because `responses` is upserted from the sheet by `responses:upsertFromSheet` and we don't want sheet re-syncs to clobber allocations. Allocation row: `{ responseId, assigneeKey, allocatedByKey?, allocatedAt }`.

Alternative considered: a single field on `responses`. Rejected — risks being overwritten by `/sheet/sync` upserts and couples allocation lifecycle to form ingestion.

### Date / period keys
Compute `day` and `periodKey` server-side using a fixed `Asia/Singapore` offset so all four teammates and the bot agree on "today" and "this week". ISO-week for week granularity, `YYYY-MM` for month. Helper in `convex/lib/dates.ts`.

### Telegram integration (`convex/http.ts` + `convex/telegram.ts`)
- Add `POST /telegram/webhook` as an `httpAction`, mirroring `/sheet/sync`: validate a `TELEGRAM_WEBHOOK_SECRET` (passed via Telegram's `secret_token` header `X-Telegram-Bot-Api-Secret-Token`) before doing anything.
- Parse the update, resolve the sender's `telegramUserId` → `teamMembers` row. Unknown sender → ignore (200, no-op) so Telegram doesn't retry.
- Command router (plain text/slash):
  - `/add <title>` → add to self for today; `/add @username <title>` → assign to the named teammate (cross-assignment), resolved via `by_username`.
  - `/today` → your tasks for today; `/today @username` → view that teammate's tasks (read-only peek).
  - `/done <n>` → mark your own task #n done (n is the index from your last `/today`).
  - `/standup <text>` → upsert your standup for today.
  - Each maps to an internal mutation/query already used by the UI, then the action replies via the Telegram `sendMessage` API using `fetch` (allowed; no new dep). An unknown `@username` → friendly error reply, no write.
- Bot token stored as `TELEGRAM_BOT_TOKEN` env var. Webhook registered once via Telegram `setWebhook` with the `.convex.site` URL + secret.

Alternative considered: a separate Vercel serverless function. Rejected per the chosen approach — keeping it in Convex gives real-time writes to the portal with one backend and reuses the existing secret-guarded action pattern.

### Frontend (`src/components/DailyBrief.jsx`)
- New route `/brief` + nav entry in `src/App.jsx` (follow the `Pipeline.jsx` component shape).
- Split into two in-page tabs: **Tasks** and **Assigned Clients** (one sidebar item, lighter than two routes).
- Tasks tab: (1) phase-plan **checklist** with week/month toggle + period navigation; (2) per-person task columns rendered as Notion-style rows — a round done-checkbox, title, an inline due-date chip, a type tag, and a status select. A shared `Checklist` component backs the phase plan.
- Assigned Clients tab: customer allocation panel listing `responses` grouped by `assigneeKey` plus an unallocated bucket.
- All reads via `useQuery`, all writes via `useMutation`; Convex reactivity covers bot-originated updates with no extra wiring.

## Risks / Trade-offs

- **No auth means anyone with the bot token region can spoof a teammate** → Mitigate with the webhook secret header + `telegramUserId` allowlist; only the four mapped IDs can write. Acceptable for an internal tool.
- **Timezone drift on "today"** → Centralize date math in one Singapore-fixed helper; never derive `day` on the client.
- **Sheet re-sync clobbering allocations** → Avoided by the separate `customerAllocations` table (not a `responses` field).
- **Telegram retries on slow/failed webhook** → Return 200 quickly; keep command handlers thin; reply best-effort after the mutation.
- **Command parsing ambiguity (`/done <n>` indexing)** → `/today` returns a stable numbered list for the day; `/done <n>` resolves against that ordering. Document in the reply.

## Migration Plan

1. Add tables + indexes to `convex/schema.ts` (additive; no migration of existing rows).
2. Add Convex modules: `dailyBrief.ts`, `phasePlan.ts`, `customerAllocations.ts`, `telegram.ts`, `lib/dates.ts`.
3. Seed `teamMembers` with the four teammates' Telegram user IDs.
4. Set env vars `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`; register the webhook via `setWebhook`.
5. Ship `DailyBrief.jsx` + route/nav; verify real-time updates between bot and portal.
- **Rollback**: remove the route/nav and the `/telegram/webhook` route; the new tables are inert if unused. No existing behavior changes, so rollback is low-risk.

## Open Questions

- Exact Telegram user IDs for Fu, Tt, Fred, Robert (needed to seed `teamMembers`).
- Should `/today` and allocations show only the current day, or carry over unfinished tasks from prior days? (Default v1: show today; unfinished past tasks are not auto-rolled.)
- Phase plan format — plain text vs. markdown rendering in the portal (default: store markdown, render lightly).
