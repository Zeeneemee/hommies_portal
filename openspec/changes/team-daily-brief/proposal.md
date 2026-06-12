## Why

The Hommies team (Fu, Tt, Fred, Robert) has no shared place to see what each person is working on today or how the week/month is tracking against a bigger plan. Work and progress live in heads and chats, so it is hard to stay aligned and accountable. A single daily brief in the portal — readable and updatable from both the web and the Hommies Telegram bot — keeps everyone on the same page.

## What Changes

- Add a new **Daily Brief** page to the portal showing today's to-do list per teammate (Fu, Tt, Fred, Robert), each item with status (todo / doing / done / blocked).
- Tasks support **central + self assignment**: anyone can add a task to anyone, and each person can add their own. Every task carries an assignee and a due/target day.
- Add a **Customer Allocation** section to each person's brief: assign incoming customers (existing `responses`) to a salesperson to answer/follow up, so the brief shows who owns which customers today. Reuses the existing customer/pipeline data rather than duplicating it.
- Add a **Phase Plan** section on the same page: a free-form, editable plan for the current week or month, scoped by a selectable phase period. The team can read and write the plan in place.
- Connect the **Hommies Telegram bot** as a command-based, two-way channel. Each of the 4 teammates is mapped by Telegram user ID; they add, complete, and review tasks and post their daily standup via bot commands, which write back to the portal in real time.
- Wire a Telegram webhook endpoint into the existing Convex backend (no new infrastructure).

## Capabilities

### New Capabilities
- `daily-brief`: Per-person daily to-do board with assignment, status, optional due date + type tag, and a customer-allocation section (assign `responses` to a salesperson to answer).
- `phase-plan`: Editable week/month phase plan scoped by a selectable phase period, read/written by the whole team.
- `telegram-standup`: Telegram bot integration mapping the 4 teammates by user ID, with commands to add/complete/list tasks and post standups that sync to the portal.

### Modified Capabilities
<!-- None — this is greenfield functionality; no existing requirement-level behavior changes. -->

## Impact

- **Frontend**: New `src/components/DailyBrief.jsx`; new route + nav entry in `src/App.jsx`; styles in `src/styles.css`.
- **Backend (Convex)**: New tables in `convex/schema.ts` (`teamTasks`, `standups`, `phasePlans`, `teamMembers`) and a customer-allocation link (assignee on `responses`, via a new field or `customerAllocations` table); new query/mutation modules (e.g. `convex/dailyBrief.ts`, `convex/phasePlan.ts`); new Telegram webhook `httpAction` in `convex/http.ts`.
- **Dependencies / config**: Telegram bot token + webhook secret as Convex environment variables; outbound calls to the Telegram Bot API. No new npm dependencies required (uses `fetch`).
- **Users**: Introduces a lightweight team-member concept (the 4 named teammates keyed by Telegram user ID); portal remains internal with no end-user auth.
