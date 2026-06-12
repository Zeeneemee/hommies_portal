## ADDED Requirements

### Requirement: Teammate identity mapping
The system SHALL map each of the four teammates (Fu, Tt, Fred, Robert) to a Telegram user ID and a Telegram `@username`, and SHALL only act on bot commands from a recognized teammate's user ID. The `@username` is used to address a teammate in cross-assignment and view commands.

#### Scenario: Recognized teammate
- **WHEN** the bot receives a command from a Telegram user ID mapped to Fred
- **THEN** the system processes the command on behalf of Fred

#### Scenario: Unrecognized sender
- **WHEN** the bot receives a command from a Telegram user ID not mapped to any teammate
- **THEN** the system ignores or rejects the command and does not modify any data

### Requirement: Webhook endpoint
The system SHALL expose a Telegram webhook endpoint on the existing Convex backend that validates a configured secret before processing updates.

#### Scenario: Valid update
- **WHEN** Telegram posts an update to the webhook with the correct secret
- **THEN** the system parses the update and dispatches the command

#### Scenario: Invalid or missing secret
- **WHEN** a request arrives at the webhook without the correct secret
- **THEN** the system rejects it without processing

### Requirement: Two-way task commands
The system SHALL support command-based interactions that let a teammate add a task to themselves or to another teammate, list their own or another teammate's tasks for today, and mark their own task done, with all changes written to the same data shown in the portal. Teammates SHALL be addressed by their Telegram `@username`.

#### Scenario: Add a task to self via bot
- **WHEN** a recognized teammate sends an add command with a title and no target username
- **THEN** the system creates a task assigned to that teammate for today and confirms via a bot reply

#### Scenario: Add a task to another teammate via bot
- **WHEN** a recognized teammate sends an add command targeting another teammate's `@username` with a title
- **THEN** the system creates a task assigned to the named teammate for today and confirms via a bot reply

#### Scenario: Unknown target username
- **WHEN** an add command targets a `@username` that maps to no teammate
- **THEN** the system does not create a task and replies with an error

#### Scenario: List own tasks via bot
- **WHEN** a recognized teammate sends the list command with no target
- **THEN** the bot replies with that teammate's tasks for today and their statuses

#### Scenario: View another teammate's tasks via bot
- **WHEN** a recognized teammate sends the list command targeting another teammate's `@username`
- **THEN** the bot replies with the named teammate's tasks for today (read-only)

#### Scenario: Complete a task via bot
- **WHEN** a recognized teammate sends a command to mark one of their own tasks done
- **THEN** the system sets that task's status to `done` and the portal reflects the change in real time
