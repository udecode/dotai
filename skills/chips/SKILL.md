---
name: chips
description: "Run the project's suggested-task ledger, the chips: show the board, offer a finding, sweep the Do list, review stale and split tasks, start a carded task or drop one. Use for /chips, /chips offer, sweep, review, start or drop, \"what chips are open\", \"suggest a task for X\", \"clean up the chips\", \"which chips are stale\", and whenever pstack would file a tracked issue, a follow-up, a reflect Backlog item or an out-of-band PR."
argument-hint: '[offer <finding> | sweep | review | start <id> | drop <id>]'
---

# Chips

Chips are a project's suggested tasks, the side work outside a run's target that the owner can start in a new session. They live as rows in one ledger per project, and a card in a suggest tool is only a view of one. The law is `.agents/pstack/rules/chips.md`, which sync-pstack renders into every project. Read it in full before this session's first ledger write. This skill runs its modes; it adds no rule of its own.

Every command below is `node .agents/pstack/decisions-check.mjs <command>`, run from the project root. Get this session's id from the runtime's session tool, such as Claude Code desktop's `get_session` with `self`, and pass `--session <id>` to every board read. A runtime with no session tool reads the board without it.

| Mode | Use it to |
| --- | --- |
| [Board](#board) | see what can start, what runs, what waits and on what, and the next Do pass; writes nothing |
| [Offer](#offer) | add a finding, the one way new work enters the ledger |
| [Sweep](#sweep) | apply the Do list pass by pass and card what can start |
| [Review](#review) | find stale tasks and one question split across topics, and propose the rows that settle them |
| [Start](#start) | begin a task a card opened, in the card's session |
| [Drop](#drop) | record the owner's word to drop a task |

pstack calls these modes too. Where a pstack step files a tracked issue, a follow-up or a reflect Backlog item, or puts an out-of-band fix in its own PR, the lead runs Offer instead. At each hand-back, after each compaction and at the close, it runs Sweep. A "what's next" over side work runs the Board.

## Board

1. Run `chips --session <id>`.
2. Tell the owner in plain words what can start now and whether it has a card, what is started, what waits and on what, grouped by the thing waited on, and the Do list's pass. Name each task by id and title.

## Offer

1. Run the board first, and read the brief of each open task whose topic or title touches the finding with `chips brief <id>`.
2. Pick the row as chips.md's Offer says:
   - When the finding belongs to an offered task's question and that task holds no card, log a `folded` row on it with what the finding adds.
   - When it belongs to the question of a started task or of one that holds a card, offer a new task in that topic with `waits: task:<id>`. `chips` merges it into a carded task once the card is withdrawn.
   - Otherwise offer a new task with an id from `chips id`, a plain imperative title, `(xhigh)` when it needs design judgment, and its `writes:`, `topic:`, `kind:`, `waits:` and `owns:`. Reuse a topic the board lists when the finding answers its question. A new topic names one owner question, never an area.
3. Append it with `append <plans>/suggested-tasks.decisions.tsv chip "<id> <title>" "<finding>" "<tokens>" <result>`. When `append` refuses the row, its message names the route; follow it.
4. Leave the card to Sweep's card pass.

## Sweep

1. Run `chips --session <id>`.
2. Apply the pass the Do list shows, together with the run's own rows that chips.md's Sweep lists, in one `append --from <file>` batch:
   - Withdrawal pass: call the dismiss tool on each card it names, then log the row the tool's report decides, as each item says.
   - Ledger pass: log each row it names.
   - Card pass: offer each card with the prompt from `chips brief <id>` and the effort its first line shows, while the suggest tool's last result lists fewer than 20 pending cards, then log `carded` with `card:` and `session:`.
   - Check items: look the named session up with the session tool, and log `uncarded` with the item's `card:` when the tool reports it archived or gone.
3. Run `chips --session <id>` again and repeat until the Do list holds no item you can apply. When `append` refuses a batch, fix or drop the refused row as its message says and append the rest.
4. A runtime with no suggest tool lists each Ready task in the plan's `## Open work` instead, as chips.md's Limits says.

## Review

Review proposes and the owner decides. It writes rows only after the owner's "go".

1. Run `chips stale`, which lists each open task with its age, the paths it writes that are gone, the commits on its paths since its offer, its closed PR waits and its card, the likeliest stale first. Run the board too.
2. Judge each task from its brief, those facts and the code:
   - When the tree already holds its fix, propose `dismissed done`, citing the commit.
   - When its target is gone, propose `dismissed superseded`. When a path only moved, propose `updated` with the new `writes:`.
   - When a PR it waits on closed without merging, propose `updated` with the waits it has now.
   - For a started task, ask the owner whether its session still runs, and propose `dismissed stopped` only on their word.
   - When two open tasks answer one question under different topics, propose moving the later one into the earlier one's topic with `updated topic:`, then `dismissed dup` into the earliest design question, or the earliest task when none is one. When the keeper holds a card or is started, propose `waits: task:<keeper>` on the other instead.
   - When a card's session is gone, propose `uncarded` with its `card:`.
3. Write the proposals to `<plans>/artifacts/chips-review-<date>.md` as one table: task, fact, proposed row and why. Show the owner the table.
4. On the owner's "go", append the rows they accepted in one batch, then run Sweep.

## Start

A session a card opened runs this before it writes anything, as chips.md's Sweep says.

1. Run `chips brief <id>` and work from what it prints, not from the card's prompt.
2. Run `chips`. When the task is neither Ready nor Started, tell the owner what it waits on and stop.
3. Log `started` with `writes:` naming any path the brief lacks, then run `chips brief <id>` again, because the task could change until that row.
4. Before writing a path the task does not list, log another `started` row with it. When `append` refuses that row because another started task writes the path, leave the path alone and tell the owner.

## Drop

1. When the task holds a card this session offered, call the dismiss tool on it. When the tool reports the owner started it, log `started` and tell the owner. Otherwise log `dismissed declined` with its `card:`, in place of `uncarded`, so no merge lands between the two.
2. When another session holds its card, log `dismissed declined` with that `card:`.
3. When it holds no card, log `dismissed declined`.
