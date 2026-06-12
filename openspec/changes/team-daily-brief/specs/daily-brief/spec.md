## ADDED Requirements

### Requirement: Per-person daily to-do board
The system SHALL display a Daily Brief page showing, for each of the four teammates (Fu, Tt, Fred, Robert), the tasks targeted for the selected day, each with an assignee and a status of `todo`, `doing`, `done`, or `blocked`.

#### Scenario: View today's brief
- **WHEN** a user opens the Daily Brief page
- **THEN** the system displays one column or section per teammate showing that person's tasks for today, grouped or labeled by status

#### Scenario: Change the viewed day
- **WHEN** a user selects a different day (e.g. yesterday or a specific date)
- **THEN** the board shows each teammate's tasks targeted for that day

### Requirement: Create and assign tasks
The system SHALL allow any user to create a task and assign it to any teammate (central assignment), and SHALL allow a teammate to create a task for themselves (self assignment). Every task MUST carry an assignee, a title, a target day, and a status, and MAY carry an optional due date and an optional type tag (e.g. Work, Meeting, Personal, Admin, Follow-up).

#### Scenario: Assign a task to another teammate
- **WHEN** a user creates a task with title "Call landlord" assigned to Fred for today
- **THEN** the task appears under Fred's section for today with status `todo`

#### Scenario: Self-add a task
- **WHEN** Tt creates a task assigned to themselves
- **THEN** the task appears under Tt's section for the chosen day

#### Scenario: Set a due date and type on a task
- **WHEN** a user sets a due date and a type tag on a task
- **THEN** the task displays the due date and the colored type tag, and the values persist

### Requirement: Brief presents tasks and customer allocation as separate views
The system SHALL present the per-person tasks and standup separately from the customer-allocation view so the brief is split across two pages/tabs rather than one combined page.

#### Scenario: Switch between views
- **WHEN** a user switches from the tasks-and-standup view to the assigned-clients view
- **THEN** the system shows the customer allocation without the task board, and vice versa

### Requirement: Update task status
The system SHALL allow a user to change a task's status, and the change SHALL be reflected for all viewers in real time.

#### Scenario: Mark a task done
- **WHEN** a user sets a task's status to `done`
- **THEN** the task is shown as completed and any open viewer of the board sees the update without reloading

#### Scenario: Flag a task as blocked
- **WHEN** a user sets a task's status to `blocked`
- **THEN** the task is visually distinguished as blocked in the assignee's section

### Requirement: Customer allocation per salesperson
The system SHALL provide a customer-allocation section that assigns incoming customers (existing `responses` records) to a teammate to answer/follow up, reusing existing customer data rather than duplicating it. The brief SHALL show which customers each teammate currently owns. Allocation SHALL be user-driven: a teammate claims customers into their own list from a shared unallocated pool (rather than each customer carrying a who-owns-this picker), and SHALL be able to release a customer back to the pool.

#### Scenario: Claim a customer into your list
- **WHEN** Robert adds an unallocated customer to his own list
- **THEN** that customer appears in Robert's customer-allocation list and leaves the unallocated pool

#### Scenario: View unassigned customers
- **WHEN** there are customers (`responses`) with no allocated salesperson
- **THEN** the system surfaces them in a shared unallocated pool any teammate can claim from

#### Scenario: Release a customer back to the pool
- **WHEN** Robert releases a customer from his list
- **THEN** the customer returns to the unallocated pool, available for any teammate to claim
