## 1. Data model & helpers

- [x] 1.1 Add `teamMembers` table to `convex/schema.ts` (`key`, `name`, `telegramUserId`, `telegramUsername`, `active`) with `by_telegramUserId`, `by_username`, and `by_key` indexes
- [x] 1.2 Add `teamTasks` table (`assigneeKey`, `title`, `status`, `day`, `createdByKey?`, `source`, `createdAt`, `doneAt?`) with `by_day` and `by_assignee_day` indexes
- [x] 1.3 Add `standups` table (`memberKey`, `day`, `items: {text, done}[]`, `updatedAt`) with `by_member_day` index
- [x] 1.4 Add `phasePlans` table (`granularity`, `periodKey`, `content`, `updatedByKey?`, `updatedAt`) with `by_period` index
- [x] 1.5 Add `customerAllocations` table (`responseId`, `assigneeKey`, `allocatedByKey?`, `allocatedAt`) with `by_response` index
- [x] 1.6 Add `convex/lib/dates.ts` with Asia/Singapore helpers: `today()` → `YYYY-MM-DD`, `weekKey()` → `YYYY-Www`, `monthKey()` → `YYYY-MM`
- [x] 1.7 Add a seed mutation to insert the four `teamMembers` (Fu, Tt, Fred, Robert); telegramUserId + telegramUsername placeholders until real values are known

## 2. Convex queries & mutations — daily brief

- [x] 2.1 `convex/dailyBrief.ts`: query `boardForDay(day)` returning tasks grouped by `assigneeKey` joined with member names
- [x] 2.2 `dailyBrief.ts`: mutation `addTask({ assigneeKey, title, day, createdByKey?, source })`
- [x] 2.3 `dailyBrief.ts`: mutation `setTaskStatus({ taskId, status })` (sets `doneAt` when status becomes `done`)
- [x] 2.4 ~~Standup query/mutations~~ — removed; the brief is tasks-only. The `standups` table stays (deprecated) so legacy rows still validate.
- [x] 2.5 `convex/customerAllocations.ts`: query `listAllocations()` (allocated grouped by assignee + unallocated `responses`) and mutations `allocate({ responseId, assigneeKey })` / `unallocate({ responseId })`

## 3. Convex queries & mutations — phase plan

- [x] 3.1 `convex/phasePlan.ts`: query `getPlan({ granularity, periodKey })` returning the period's checklist items
- [x] 3.2 `phasePlan.ts`: checklist mutations `addPlanItem` / `togglePlanItem` / `removePlanItem` (one checklist per period; legacy `content` migrated to items)

## 4. Telegram bot integration

- [x] 4.1 Add `convex/telegram.ts` with a `sendMessage(chatId, text)` helper using `fetch` to the Bot API with `TELEGRAM_BOT_TOKEN`
- [x] 4.2 `telegram.ts`: internal helper to resolve a Telegram `userId` → `teamMembers` row (returns null for unknown)
- [x] 4.3 `telegram.ts`: command router — `/add <title>` (self) and `/add @username <title>` (cross-assign), `/today` (self) and `/today @username` (view other), `/done <n>` (own task by `/today` index), `/standup <text>`; resolve `@username` via `by_username`, error reply on unknown
- [x] 4.4 Add `POST /telegram/webhook` httpAction in `convex/http.ts` validating `X-Telegram-Bot-Api-Secret-Token` against `TELEGRAM_WEBHOOK_SECRET`, ignoring unknown senders, replying best-effort
- [ ] 4.5 Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` env vars on the Convex deployment and register the webhook via `setWebhook`

## 5. Frontend — Daily Brief page

- [x] 5.1 Create `src/components/DailyBrief.jsx` following the `Pipeline.jsx` pattern (Convex hooks, `ui.jsx` components)
- [x] 5.2 Per-person task columns as Notion-style rows: done-checkbox, title, inline due-date chip, type tag, status select (todo/doing/done/blocked)
- [x] 5.3 Day selector defaulting to today; board re-queries on change
- [x] 5.4 Customer allocation panel: list `responses` grouped by assignee + unallocated bucket, with allocate/reassign/unallocate controls
- [x] 5.5 ~~Standup checklist per teammate~~ — removed; tasks-only board
- [x] 5.6 Phase plan checklist: week/month toggle, period navigation, add/toggle/remove items
- [x] 5.7 Add `/brief` route and nav entry in `src/App.jsx`
- [x] 5.8 Split the page into two tabs (Tasks & Standup, Assigned Clients) + styles in `src/styles.css`

## 6. Verification

- [ ] 6.1 Verify task create/assign/status flows in the portal update in real time across two browser tabs
- [ ] 6.2 Verify customer allocation reassignment moves the customer between assignees and survives a `/sheet/sync` re-run
- [ ] 6.3 Verify phase plan saves and loads independently per week and per month period
- [ ] 6.4 Verify Telegram `/add`, `/today`, `/done` from a mapped user write to the portal, and an unmapped user is ignored
- [ ] 6.5 Verify task due date + type tag persist and display, and the Tasks / Assigned Clients tabs switch correctly
