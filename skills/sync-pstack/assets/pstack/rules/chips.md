<!-- # Shared rule file. sync-pstack renders it into each project's .agents/pstack/rules/; the grammar is in the skill's SKILL.md. -->
# Suggested tasks

This file says how the lead offers, records and cleans up suggested tasks. The pstack block in `AGENTS.md` points here. The `sync-pstack` skill renders this file from its shared source in `udecode/dotai`, so change it there.

- **Suggested tasks.** This rule applies when the runtime has a tool that offers the owner a task to start in a new session, such as Claude Code desktop's `spawn_task`. A suggested task holds only side work outside the run's target. A finding that pivots the run never becomes one, as the Autopilot rule says. A runtime without such a tool lists each task, with the same title, under the plan's `## Open work`. Each item names `owner:` the owner and `stop:` the owner starts or drops it, and the lead logs no `chip` row. The sweep below reads those items instead of running `chips`, checks them the same way, and rewrites or removes an item where it would log a row.
  - **Title.** The title reads `<tag>: <imperative phrase> (<effort>)`, such as `Now: Fix the stale README badge (high)`.
    - The tag is `Now` only when three things hold. The lead can name the paths the task will write. None of them is a path the run changed since its intake or one its open steps name. The task needs no result the run has not produced yet. The owner can then start it while the run goes on. Its brief lists the run's paths and says not to edit them.
    - Every other task is `After`, which the owner starts once the run closes. When unsure, the lead picks `After`.
    - At the close nothing is running, so a task offered then is `Now`.
    - The effort is `xhigh` when the task runs a whole poteto playbook with design judgment, such as an architecture, API or plan choice, a bug whose cause is unknown or a performance diagnosis. It is `high` when the task says exactly what to do, such as a named fix, a doc update or a check. The brief's first line repeats the effort.
  - **Ledger.** Each offer and each later change gets a `chip` row in the run's decision log, which the lead queues and appends like any other row.
    - The decision is `<task id> <title>`.
    - An offer's evidence names the paths or areas the task will change as `writes:`, and its result is `offered`.
    - A later row's result is `started` when the dismiss tool reports that the owner already started the task. Otherwise it is `dismissed` with one reason:
      - `done` when the tree already holds the fix;
      - `dup <task id>` when another offered task covers it;
      - `superseded` when the run removed its target;
      - `retagged <task id>` when it was replaced under another tag, whose offer the log holds first;
      - `gone` when the tool reports it already left the queue, dismissed by the owner or pushed out by newer tasks.
    - `decisions-check.mjs append` refuses any other shape, and a `started` or `dismissed` row for a task the log never offered. `node .agents/pstack/decisions-check.mjs chips <log>` prints every task still open.
  - **Sweep.** The lead runs `chips` on the log and checks each open task before it offers a new one, at each hand-back, after each compaction and at the close. For each task:
    - When the tree already holds its fix, the lead dismisses it with `done`.
    - When another task covers it, the lead offers one merged task, then dismisses both with `dup` and the merged task's id.
    - When the run removed its target, the lead dismisses it with `superseded`.
    - When the run now writes the paths of a `Now` task, the lead dismisses it. When the tool withdrew it, the lead offers the same task as `After` and logs that offer before the old task's `retagged` row. When the tool reports the owner already started it, the lead logs `started`.
  - **Limits.** The tool cannot rename a task, so every retag is a dismissal followed by a new offer. The dismiss tool reaches only tasks the owner has not acted on. An offer's result lists every task still pending, so the lead checks that list against `chips` after each offer.
  - **Close.** The close reply tells the owner that the run's `After` tasks are free to start.
