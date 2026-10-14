<!-- # Shared rule file. sync-pstack renders it into each project's .agents/pstack/rules/; the grammar is in the skill's SKILL.md. -->
# Suggested tasks

This file says how the lead offers, records and cleans up suggested tasks. The pstack block in `AGENTS.md` points here. The `sync-pstack` skill renders this file from its shared source in `udecode/dotai`, so change it there.

- **Suggested tasks.** Every runtime follows this rule. A suggested task is side work outside the run's target that the owner can start in a new session, offered with a tool such as Claude Code desktop's `spawn_task` where the runtime has one. A finding that pivots the run never becomes one, as the Autopilot rule says. Sessions started from these tasks are the owner's own work in this checkout, so overlap with them is this rule's subject, not something the Other sessions rule dismisses.
  - **Title.** The title reads `<tag>: <imperative phrase> (<effort>)`, such as `Now: Fix the stale README badge (high)`.
    - The tag is `Now` only when all of these hold. The lead can name the paths the task will write. None of them is a path the run changed since its intake or a path its open steps name. None of them is a path an open `Now` task or a `started` task in the ledger writes. The task also needs no result the run has not produced yet. Its brief lists the paths it must not edit.
    - Every other task is `After`. Its offer's why names what it waits for: this run, another open run such as a paused one, or a started task. When unsure, the lead picks `After`.
    - At the close this run is over, so a task offered then is `Now` unless it waits for another open run or a started task. The lead does not retag open `After` tasks at the close, because the plan's Close names which are free.
    - The effort is `xhigh` when the task runs a whole poteto playbook with design judgment, such as an architecture, API or plan choice, a bug whose cause is unknown or a performance diagnosis. It is `high` when the task says exactly what to do, such as a named fix, a doc update or a check. The brief's first line repeats the effort. A project rule that caps effort wins.
  - **Ledger.** Every suggested task, from any run, lives in the project's ledger `<plans>/suggested-tasks.decisions.tsv`, because a task outlives the run that offered it. The lead queues and appends its rows like any other decision-log row, with phase `chip`, and never in a run's own log.
    - The decision is `<task id> <title>`, repeated unchanged on every later row. A runtime without a suggest tool uses a local id such as `local-20261014-1` and lists the task in the plan's `## Open work` too, so the owner sees it.
    - An offer's evidence lists the paths the task will write as `writes: <path>, <path>`, each a repository path or directory, or an absolute path in another checkout. Its result is `offered`.
    - A later row's result is `started` when the dismiss tool reports that the owner already started the task, or when the owner says so. It is `landed` once the tree holds a started task's change. Otherwise it is `dismissed` with one reason:
      - `done` when the tree already holds the fix;
      - `dup <task id>` when another offered or started task covers it;
      - `superseded` when the run removed its target;
      - `replaced <task id>` when a new offer took its place, such as under another tag. The new offer's row comes before this row in the ledger, whatever order the tools ran in;
      - `gone` when the tool reports it already left the queue, dismissed by the owner or pushed out by newer tasks.
    - `decisions-check.mjs append` refuses a chip row in a run's log and a row of any other shape. It also refuses a second offer of one id, a `Now` offer that writes a path an open `Now` task or a started task writes, and a later row that skips its task's state or names a closed replacement. `node .agents/pstack/decisions-check.mjs chips` prints every task still offered or started, with its paths.
  - **Sweep.** The lead runs `chips` and checks each open task before it offers a new one, at each hand-back, after each compaction and at the close.
    - When the tree already holds an offered task's fix, the lead dismisses it with `done`. When it holds a started task's change, the lead logs `landed`.
    - When another task covers it, the lead offers one merged task, then dismisses both with `dup` and the merged task's id.
    - When the run removed its target, the lead dismisses it with `superseded`.
    - Before the run writes a path an open `Now` task writes, the lead dismisses that task. When the tool withdrew it, the lead offers the same task as `After` and logs `replaced`. When the tool reports the owner already started it, the lead logs `started`.
    - Before the run writes a path a started task writes, it waits for that task to land or leaves that path to it. The lead runs both checks whenever the run is about to widen what it writes, not only at a sweep.
  - **Limits.** The tool cannot rename a task, so every retag is a dismissal followed by a new offer. The dismiss tool reaches only tasks the owner has not acted on. An offer's result lists every task still pending, so the lead checks that list against `chips` after each offer. A runtime without the tool learns that a task started only from the owner.
  - **Close.** The plan's `## Close` names the `After` tasks that waited only for this run as free to start, and says what each other open task still waits for.
