<!-- # Shared block template. sync-pstack renders it into each project's AGENTS.md; the grammar is in the skill's SKILL.md. -->
## How work runs

- pstack's `poteto-mode` is the engineering method. The `pstack@pstack-claude` plugin is pinned to GitHub tag `{{tag}}` in `.claude/settings.json`, and each person's Codex marketplace pins the same tag. Its session hook routes multi-file, design and unexplained-bug work into poteto-mode, which picks the playbook. Questions, small edits and one-file changes work directly and are verified on the real artifact. A small edit is one whose every changed line the lead can write down before it starts, and that keeps every signature other files call. A typo, a wording fix and the same one-line fix in several files are small edits. A small edit works directly at any file count, so it follows no playbook.
<!-- if projectPlaybooks -->
- Project playbooks in `.agents/playbooks/` build on pstack's, as poteto-mode's Project playbooks paragraph describes. `check-playbooks.mjs` ships with pstack, not the project. After a project playbook changes and before one applies, run `node <plugin>/skills/poteto-mode/scripts/check-playbooks.mjs` from the project root, where `<plugin>` is the directory above `skills/` in the base directory a pstack skill prints. This project's playbooks are:
{{projectPlaybooks}}
<!-- end -->
- If no `pstack:*` skills are available, stop and ask the user to install the plugin before engineering work. In Claude Code they trust the folder and run `claude plugin install pstack@pstack-claude --scope project`. In Codex they run `codex plugin marketplace add michael-denyer/pstack-claude --ref {{tag}}` and `codex plugin add pstack@pstack-claude` from their home directory, then trust the session hook in `/hooks`. Codex loads only the first 32 KiB of `AGENTS.md` by default, and this file is longer, so they also put `project_doc_max_bytes = 131072` above the first table in `~/.codex/config.toml`.
<!-- # relies ../hooks/session-start-context.md "User instructions (CLAUDE.md, AGENTS.md, direct requests) take precedence." -->
- The latest user correction wins over every rule. This file's rules outside this block win over the overrides inside it, and those win over pstack. pstack's hook itself says project instructions take precedence.
- Three lead runtimes, with Antigravity in T3 Code (`gemini-4-neon @high`) as the default across all projects, alongside Claude Code (`opus`) and Codex (`gpt-6.2-sol`). In Antigravity / T3 Code, Neon leads at `high` (escalating to `xhigh` only for `arena` runners, stuck hard debugging after `high` fails, or deep architectural pivots), native `invoke_subagent` always uses `Model: "inherit"` (never `pro`, `flash`, or `flash_lite`), `Agent` maps to `delegate_task`/`invoke_subagent`, `TodoWrite` to `update_steps`, `AskUserQuestion` to `ask_question`, and any >1 KB T3 MCP tool omitted from native declarations (`delegate_task`, `preview_open`, `preview_act`, `preview_navigate`, `html_render`, `schedule_task`, `t3_thread_launch`, `create_threads`, `request_secret`, `watch_pull_request`) runs via `acp-mcp-call`. Claude Code runs every pstack role on `opus` except `strongest judgment`, which runs on `fable`, per the project's models sheet @.claude/pstack-models.md (replacing `~/.claude/pstack-models.md`), and never dispatches `sonnet` or `haiku`. Codex runs `gpt-6.2-sol` and inherits it per `~/.codex/pstack-models.md`.
<!-- if delivery!=trunk -->
  The exception is a panel seat or an arena runner, which runs on its named model for model diversity; in Claude Code, a Codex worker the Codex workers rule starts is another.
<!-- end -->
<!-- if delivery=trunk -->
  The exception is a panel seat or an arena runner, which runs on its named model for model diversity. The role lines of a person's own `.claude/pstack-models.local.md` in the main checkout, which git ignores, replace that sheet's line for each role they name and add each role it lacks, for that person. The session-start hook prints them, and the helpers that read the sheet read them too.
<!-- end -->
<!-- if maxEffort -->
<!-- # adds -->
- **Effort cap.** No role, seat or suggested-task card runs above `{{maxEffort}}`, the `maxEffort` in `.agents/pstack.json`. `cross.mjs` caps every run it starts and `chips brief` prints each card's capped effort.
<!-- end -->
<!-- # overrides poteto-mode/SKILL.md "The role's `@level`, or the sheet's `default effort` line, sets its starting level" -->
<!-- # overrides poteto-mode/SKILL.md "lower it one step for judgment, and two or more steps for routine work" -->
<!-- # overrides poteto-mode/references/codex-tools.md "Apply poteto-mode's task adjustment to that starting level" -->
<!-- # overrides poteto-mode/references/codex-tools.md "ask for an explicit role or `default effort` level before dispatching" -->
<!-- # relies poteto-mode/references/codex-tools.md "scripts/codex-session-effort.mjs" -->
- **Helper effort.** Each helper starts at the lead session's effort, capped by `maxEffort` when `.agents/pstack.json` sets one (Antigravity defaults to `high`; Claude Code reads `node .agents/pstack/lead.mjs`; Codex reads `codex-session-effort.mjs` then `lead.mjs`; fallback is `maxEffort` or `high`, never ask). Pass effort explicitly on Claude `Agent` (`effort`) and Codex `spawn_agent` (`reasoning_effort`). Swarm workers, panel seats, code delegates and arena runners use their models-sheet level (Codex seats keep their capped sheet or project-rule level); other helpers may run lower for routine work.
<!-- if glossary -->
- Use the words in `{{glossary}}`.
<!-- end -->
- pstack is never edited here; an override changes its behavior. The `sync-pstack` skill renders this block from its shared source in `udecode/dotai`, replaces it on every sync, and moves every pin to a new tag together after reading pstack's changelog, so never bump a `ref` by hand. The next sync refuses an edit made inside this block. A lesson that changes a rule in this block goes to the shared source; a lesson for this repository alone goes outside the block.

## pstack overrides

<!-- # Each "overrides" note names pstack text an override replaces; sync-pstack refuses a bump that drops it. -->
<!-- # overrides poteto-mode/playbooks/feature.md "Run **Opening a PR**" -->
<!-- # overrides poteto-mode/playbooks/opening-a-pr.md "Work from a git worktree off trunk" -->
<!-- if delivery=push -->
- **Delivery.** A completed task runs its writing passes, then `{{lintFix}}` as its last check that edits code, then commits and pushes `{{branch}}`. No PR, merge or force-push unless the user asks. pstack's Opening a PR, Babysit and Shipping playbooks apply only to a requested PR, and their "worktree off main" step never applies.
<!-- end -->
<!-- if delivery=pr -->
- **Delivery.** A completed task runs its writing passes, then `{{lintFix}}` as its last check that edits code, then commits on a topic branch cut from `{{branch}}` in the checkout or worktree it works in and opens a PR into `{{branch}}` through pstack's Opening a PR playbook, whose worktree step never applies. Babysit and Shipping run when the user asks. Never push `{{branch}}` directly, merge or force-push unless the user asks. Record each commit SHA this run creates in its todo list or decision log as it lands.
<!-- end -->
<!-- if delivery=trunk -->
- **Delivery.** Each task works in its own worktree cut from `origin/{{branch}}` and lands only through `node .agents/pstack/land.mjs`. Before the first edit, or the first write to the forge such as opening a PR, posting a comment, approving a CI run or pushing, read `.agents/pstack/rules/land.md` in full.
<!-- end -->
<!-- if delivery=user -->
<!-- if !pushBranches -->
- **Delivery.** The user owns commits. A completed task runs its writing passes, then `{{lintFix}}` as its last check that edits code, and leaves its changes in the working tree. Commit, push or open a PR only when the user's own message asks for it. Approving an agent's plan is not commit authority, and no plan or step list proposes a commit.
<!-- end -->
<!-- if pushBranches -->
- **Delivery.** The user owns commits on `{{branch}}`. A completed task runs its writing passes, then `{{lintFix}}` as its last check that edits code, and leaves its changes on `{{branch}}` in the working tree; commit or push `{{branch}}` only when the user's own message asks for it. Approving an agent's plan is not commit authority, and no plan or step list proposes a commit on `{{branch}}`. On every other branch the lead commits and pushes its work without asking, another person's PR head branch included. It keeps the description of a PR it opened true to the pushed diff. On another person's PR it leaves their description alone and keeps its latest comment about its own commits true instead, as the `plan-page` skill's PR section says. A runtime whose own instructions refuse to post that comment leaves it as a draft under the page's Needs you. When maintainer edits on a PR's head branch are not allowed, it opens a PR stacked on that branch instead; any other PR waits for the user's word. Merging, closing, other comments, reviews and CI approval need the user's word.
<!-- end -->
<!-- end -->
<!-- if delivery!=trunk -->
  When `git status` shows work the task did not write, run `{{lintFix}}` on the task's code paths only, because a repository-wide run reformats other sessions' files; a change with no lintable file skips it. Run it again after any later repair.
<!-- end -->
  When a change alters what an operation promises, search the plans and agent instructions for the old promise, fix this task's own docs, and flag the rest on the page. Production deploys and releases need an explicit request.
<!-- if protected -->
  Never push `{{protected}}` unless the user asks.
<!-- end -->
<!-- if delivery=push -->
<!-- # adds -->
- **Shared checkout.** Before you stage, commit, delete a tracked file, pull or push, read `.agents/pstack/rules/shared.md` in full.
<!-- end -->
<!-- # adds -->
- **Git.** Before a nontrivial edit, check only `git branch --show-current`.
<!-- if protected -->
  Never edit from `{{protected}}`.
<!-- end -->
  Read `.agents/pstack/rules/git.md` in full before editing a branch, adding or removing a worktree, or resetting a proof case; it holds the worktree, `origin/HEAD`, setup and unrelated-diff rules.
<!-- if delivery!=trunk -->
<!-- # adds -->
- **Other sessions.** Other agent sessions may edit this checkout, the shared source and the projects it syncs at any time. Never plan, review or build around a conflict with them that has not happened: a plan adds no lock, mirror, carry or race step for other sessions, and a panel finding whose only trigger is another agent session editing these files is dismissed with this rule as its reason. Concurrency inside the product, such as two users saving one record, is not this rule's subject. Another repository's rules for its own sessions, such as how they commit, are how to work there, never an invariant a plan or panel attacks. Act only when a conflict blocks the work, such as a refused fast-forward or push, a merge conflict, or a file this run is editing that changed under it. When the blocking change has already landed, rebase or merge onto it, resolve any conflict in this run's own hunks, rerun the checks and retry. When a conflicting hunk is another session's uncommitted work, run `git rebase --abort` first. A hook failure is fixed like any failing check. While it is still uncommitted in another session, pause only that part, keep going on other ready work, and resume once it lands. A block that still holds after an hour goes under Needs you, and the run keeps going.
<!-- # overrides poteto-mode/playbooks/feature.md "Delegate code-writing to a subagent" -->
<!-- # overrides poteto-mode/playbooks/bug-fix.md "Delegate implementation to a subagent" -->
<!-- # overrides poteto-mode/playbooks/refactoring.md "Delegate the mechanical edits to a subagent" -->
<!-- # overrides poteto-mode/playbooks/perf-issue.md "Delegate implementation to a subagent" -->
<!-- # overrides poteto-mode/playbooks/hillclimb.md "Hand the change to a subagent" -->
<!-- # overrides no-comments/SKILL.md "Inspect its report and diff." -->
<!-- # relies ../agents/comment-sicko.md "Report only." -->
- **The lead writes the code.** The lead agent edits the current checkout and verifies on the running artifact. Subagents do research, review and read-only fan-out; a Codex worker the Codex workers rule starts also writes. That covers comment-sicko in `no-comments`: its brief forbids every edit and asks for each verdict with its exact replacement text, and the lead applies the ones it accepts. No per-delegate worktrees unless the user asks. This replaces every pstack playbook step that delegates implementation or attempts to a subagent or gives a delegate its own worktree, as in Feature, Bug fix, Refactoring, Perf issue and Hillclimb.
<!-- if proof -->
<!-- # relies poteto-mode/playbooks/multi-phase-plan.md "Each live box drives the real surface through the driver skill" -->
  The `{{proof}}` skill is pstack's driver skill here. Bug fixes reproduce and verify through it.
<!-- end -->
<!-- end -->
<!-- if delivery=trunk -->
<!-- if proof -->
<!-- # relies poteto-mode/playbooks/multi-phase-plan.md "Each live box drives the real surface through the driver skill" -->
- **Proof.** The `{{proof}}` skill is pstack's driver skill here. Bug fixes reproduce and verify through it.
<!-- end -->
<!-- end -->
<!-- # adds -->
- **Calls.** Each call the lead makes re-reads the session's whole context, so in a long session the number of calls, not their size, sets the cost. Read several files or line ranges in one command, or as parallel calls in one message, instead of one small read per call. A session that another session started reads `.agents/pstack/rules/linked.md` in full before its first step, and a lead reads it before it starts a session its run waits on.
<!-- if delivery!=trunk -->
  Bookkeeping never takes a call of its own: a retitle, a todo update, a decision-log append, a page publish or a plan-page render goes out in the same message as the next working call, a rename that ends the turn, such as to 🟠 or 👀, as the Session title rule says, and several decision rows go in one `decisions-check.mjs append <log> --from <rows.tsv>` call (owner's word, 2026-10-17).
<!-- end -->
<!-- if delivery=trunk -->
  Bookkeeping never takes a call of its own: a retitle, a todo update, a decision-log append, a page publish or a plan-page render goes out in the same message as the next working call, a rename that ends the turn, such as to 🟠 or 👀, as the Session title rule says, and several decision rows go in one append (owner's word, 2026-10-17).
<!-- end -->
<!-- # overrides arena/SKILL.md "The judge is never from the parent's family" -->
<!-- # overrides setup-pstack/SKILL.md "An `inherit-parent` or `auto` value never judges." -->
<!-- # relies how/SKILL.md "that explores and explains in one pass" -->
- **Extraction.** The session's own model keeps every judgment: plans, design calls, code, synthesis, `how` explainers, judges (except an arena's cross-judge pool), second readers and reflect decisions. Pure evidence lookups run in an evidence subagent (`invoke_subagent`/`delegate_task` in T3 Code; `Agent` on `opus` in Claude Code); signed-in site drives use OpenCode `browse` (`~/.local/bin/browse`) in Chrome, T3's Chrome-imported `preview_*` browser or Claude in Chrome. Verify each evidence seat covered every requested source (rerun once on gaps, report any remaining gap), confirm call sites with `git grep`, and read modified functions and breakable callers in full.
<!-- if delivery!=trunk -->
<!-- # adds -->
- **Codex workers.** Read `.agents/pstack/rules/codex.md` in full before you write a planned change of more than a few lines or one that needs its own test loop. Read it too before a long run's mechanical slice that a command proves done, such as a codemod, a benchmark protocol run or a fix loop that ends when typecheck or lint passes, and whenever the owner says to have Codex do it. It says when Codex writes the code instead of you.
<!-- end -->
<!-- # overrides arena/SKILL.md "If the `Agent` tool rejects a slug, use the nearest valid slug of the same family or drop the seat" -->
<!-- # overrides arena/SKILL.md "Give each candidate its own output location" -->
<!-- # overrides arena/SKILL.md "Spawn all N subagents in one message with `run_in_background: true`" -->
<!-- # overrides arena/SKILL.md "If a candidate produces no output, proceed with N-1 and note the dropout." -->
<!-- # relies interrogate/SKILL.md "- **Findings**: for each verified finding, the command, its output, how it breaks the intent, and the adversaries that found it." -->
<!-- # overrides interrogate/SKILL.md "Report the findings. Do not apply fixes." -->
<!-- # overrides interrogate/SKILL.md "Copy the scope's uncommitted changes into each worktree." -->
<!-- # overrides interrogate/SKILL.md "Spawn each adversary as `general-purpose`." -->
<!-- # overrides interrogate/SKILL.md "Leave out anything you did not run." -->
<!-- # overrides interrogate/SKILL.md "Keep repros in your own worktree." -->
<!-- # overrides interrogate/SKILL.md "That covers style, naming, structure, and risks that need a future change to matter." -->
<!-- # overrides interrogate/SKILL.md "Keep a finding when the output shows the failure and the failure breaks the intent. Drop the rest." -->
<!-- # overrides arena/SKILL.md "the judge scores each candidate, by path label" -->
<!-- # overrides arena/SKILL.md "If the candidates converge on one shape, that is strong agreement." -->
<!-- # overrides poteto-mode/SKILL.md "Contested design → **interrogate**." -->
<!-- # relies poteto-mode/playbooks/feature.md "`architect` for the shape." -->
<!-- # overrides poteto-mode/playbooks/feature.md "If the design is contested, `interrogate` before shipping." -->
<!-- # overrides blast-radius/SKILL.md "For a big or wide change, run it as an `arena`." -->
<!-- # relies figure-it-out/SKILL.md "For one-way-door design decisions, run the **architect** skill (it runs **arena**)." -->
<!-- # overrides babysit/SKILL.md "Use `interrogate` before opening if the diff is contested" -->
<!-- # overrides architect/SKILL.md "For a large or contested design, run the **arena** skill instead of sketching alone." -->
<!-- # relies poteto-mode/playbooks/bug-fix.md "Skip those skills and step 3's `architect`, even across a function boundary, only when all of these hold:" -->
<!-- # relies principle-attack-the-premise/SKILL.md "Write the premise down and test it directly before you write another fix that assumes it." -->
- **Panel review.** A pstack panel, `/pstack:interrogate` with the configured seats, runs without asking for the work this project's reviews list names and wherever a pstack playbook step or skill calls for it, such as a contested design. An arena runs the same way. `architect` is pstack's own sketch, and a large or contested design runs an arena. A change to agent prose alone gets none of them, except as `.agents/pstack/rules/panel.md` says. On the user's word, "panel" runs a panel on the current plan or diff, "arena" runs an arena bakeoff of the current artifact, and "full" runs `architect`, then a panel on the plan and another on the diff. Before you launch any panel or arena seat, or log a panel row, read `.agents/pstack/rules/panel.md` in full; it holds the Panel review and Review rules.
<!-- if reviewList -->
  The reviews list, each row named by its id:
{{reviewList}}
<!-- end -->
<!-- if !reviewList -->
  This project's reviews list is empty, so panels run only where a pstack step calls for them or on the user's word.
<!-- end -->
<!-- # overrides poteto-mode/SKILL.md "Reversible work and external actions" -->
- **Messages and shared resources.** A "can we X?" question gets a measured answer and a proposal, not the action. Before you send or draft a message another person can read, such as an email, a chat message, or a comment, review, label or close on an issue or PR, before you spend shared quota, and before you run an access grant, read `.agents/pstack/rules/messages.md` in full.
<!-- # overrides poteto-mode/playbooks/babysit.md "dismiss noise with a concrete disproof" -->
<!-- section tests -->
<!-- # overrides poteto-mode/playbooks/bug-fix.md "Stage the commits so the failing repro lands before the fix in git history." -->
- **Tests.** Before you write, change or cut a test, read `.agents/pstack/rules/tests.md` in full.
<!-- end -->
<!-- section browser -->
<!-- # adds -->
- **Browser drives.** Before you type into a page through a browser tool, or judge anything on it that scrolls, animates or loads lazily, read `.agents/pstack/rules/browser.md` in full; it holds how each runtime's browser delivers keys, draws frames and handles the clipboard.
<!-- end -->
<!-- section plans -->
<!-- # overrides show-me-your-work/SKILL.md "Use the helper `scripts/log.sh" -->
<!-- # overrides poteto-mode/playbooks/autopilot-full.md "write the full program objective into `notes.md` in the program's store under `~/.claude/orchestrate/<slug>/`" -->
<!-- # overrides poteto-mode/playbooks/autopilot-full.md "the objective in the store's `notes.md`" -->
<!-- # overrides poteto-mode/playbooks/autopilot-full.md "start a decision trail in the program's store under `~/.claude/orchestrate/<slug>/`" -->
- **Plans and trails.** Before you draft or write a plan, in plan mode or a plan file, or write a decision-log row or a proof log, read `.agents/pstack/rules/trails.md` in full.
<!-- # overrides poteto-mode/playbooks/multi-phase-plan.md "Hand back the plan path and stop." -->
<!-- # overrides poteto-mode/playbooks/multi-phase-plan.md "Write the plan file. Open with what changes" -->
- **Plan pages.** Before you draft or change a plan, in plan mode or a plan file, and before the reply that hands back playbook work, planned or not, read `.agents/pstack/rules/pages.md` in full; it holds which work gets a page, what that page holds and what the hand-back reply holds.
<!-- # overrides poteto-mode/playbooks/prototype.md "let the user pick directions before building" -->
<!-- # overrides poteto-mode/playbooks/worktree-cleanup.md "`wip`, `untracked`, `ignored`, `reflog`, locked, and in-use pause" -->
<!-- # overrides poteto-mode/SKILL.md "Fall back to the role's line or default, then the calling skill's fallback, then the closest valid slug of the same family, then omit `model`." -->
<!-- # overrides poteto-mode/playbooks/multi-phase-plan.md "A PR that changes an interaction waits for the operator's review before merge." -->
- **Autopilot.** Work runs to its close without waiting for the owner, stopping only for production deploys/releases, pushing `main`, force-pushing a shared branch, deleting non-run data, a missing product sign-in, a blocked models-sheet model, or a third plan on one topic. Before taking a reversible default, pivoting a design, or stopping on an open question, read `.agents/pstack/rules/autopilot.md` in full.
<!-- if delivery!=trunk -->
<!-- # overrides poteto-mode/playbooks/babysit.md "Declare the mode in your first line, before any poll." -->
- **Babysit levels.** Before Babysit's first step on a PR (unless read-only review), check each linked plan log's `lead` and `seats` rows against the current session level and models sheet; if any unit ran below target, run `redo` first.
<!-- end -->
<!-- # adds -->
<!-- # overrides poteto-mode/SKILL.md "A correctness or data gap gets a tracked issue" -->
<!-- # overrides poteto-mode/playbooks/autonomous-run.md "Put out-of-band fixes in their own PR." -->
<!-- # overrides reflect/SKILL.md "What a lint, script or check could enforce goes to the backlog, not into prose." -->
<!-- # overrides poteto-mode/playbooks/autopilot-full.md "everything else goes in a follow-up" -->
- **Suggested tasks.** The `chips` skill and `.agents/pstack/rules/chips.md` own the suggested-task ledger (the project's tracker, replacing pstack's tracked issues, follow-ups, reflect Backlog items and out-of-band PRs). Load `chips` before offering, dropping or closing suggested tasks; a card session logs only its own rows and runs no sweep. Fix blocking discoveries and workflow friction in-run; list other side findings in Open work or offer a chip per `chips.md`.
<!-- end -->
<!-- section fast -->
<!-- # overrides poteto-mode/SKILL.md "Route bulk to subagents, keep summaries in the main thread." -->
<!-- # overrides poteto-mode/playbooks/feature.md "`architect` for the shape." -->
<!-- # overrides poteto-mode/playbooks/feature.md "If the design is contested, `interrogate` before shipping." -->
<!-- # overrides poteto-mode/playbooks/bug-fix.md "Delegate investigation and the fix to subagents, stay in the lead." -->
<!-- # overrides poteto-mode/playbooks/bug-fix.md "If it crosses a function boundary, `architect` first." -->
<!-- # overrides poteto-mode/playbooks/perf-issue.md "If it crosses a function boundary, `architect` first." -->
<!-- # overrides no-comments/SKILL.md "Spawn comment-sicko. Act on accepted findings." -->
<!-- # overrides show-me-your-work/SKILL.md "spawn a subagent on a model from another family" -->
- **Fast.** The owner's word "fast", or a suggested task whose card title ends in "(fast)", runs the request on the main lane, with no subagent or seat. Before you run one that way, read `.agents/pstack/rules/fast.md` in full.
<!-- end -->
<!-- section long-runs -->
<!-- # overrides poteto-mode/playbooks/pause-safely.md "Commit uncommitted edits as one clear `wip:` commit on the current branch so nothing is lost." -->
- **Long runs.** Before a multi-slice build after "go", `/loop`, `/goal`, a pause or a resume, and after every compaction, read `.agents/pstack/rules/long-runs.md` in full.
<!-- end -->
<!-- # adds -->
- **Time budget.** No command or proof that a run starts takes more than an hour, except a stress run, and nothing waits for the host's load to drop (owner's word). Read `.agents/pstack/rules/time.md` in full before you start one that may run long, such as a proof or a benchmark protocol, after a gate fails under load, and before you offer a measurement that cannot fit the hour.
<!-- # adds -->
<!-- # overrides show-me-your-work/SKILL.md "spawn a subagent on a model from another family" -->
<!-- # overrides show-me-your-work/SKILL.md "Every reply for a run that produced a trail ends with" -->
<!-- # overrides poteto-mode/SKILL.md "keep an uncommitted `todo.md` Markdown checklist in the work dir, next to the decision trail" -->
- **Todo list and close.** Add one quoted todo per explicit user ask (including mid-run messages) and per triggered gate (proof, writing passes, review, final check, delivery); keep `<slug>.todo.md` in the run directory. Keep standing user preferences (e.g. reply language) open as constraint todos until close. Before every final reply, reread all user messages and corrections, add any missed ask, and finish or skip it with a reason.
<!-- if delivery!=trunk -->
  Before you close planned or unattended work, or brief, wait on or save a subagent, read `.agents/pstack/rules/close.md` in full; it holds the close order and the Decision-trail review rule.
<!-- end -->
<!-- # adds -->
- **Session title.** When the runtime has a tool that renames the current session, read `.agents/pstack/rules/title.md` before the run's first step and after a compaction or a resume, and retitle the session whenever that file says to.
<!-- # overrides poteto-mode/SKILL.md "Open each subagent brief, PR `## Why`, and final report with the goal." -->
<!-- # relies bro/SKILL.md "like one human talking to another" -->
<!-- # relies unslop/SKILL.md "Rule numbers are stable ids that other skills cite." -->
- **Writing.** Read `.agents/pstack/rules/writing.md` in full before a session's first reply and after a compaction. Everything you write follows it.
<!-- # overrides poteto-mode/SKILL.md "Docs, PR descriptions, commit messages → **technical-writing**, on top of **unslop**." -->
- **Writing passes.** Run `deslop` then `no-comments` once per batch of product code before review or hand-back, and `unslop` once over docs, plans, agent files, commit bodies and PR text; `technical-writing` is a reference only, and replies need no separate pass. Read `.agents/pstack/rules/writing.md` for full pass rules and panel-round `writing` rows.
<!-- section commits -->
<!-- if delivery!=trunk -->
<!-- # overrides poteto-mode/playbooks/opening-a-pr.md "Body: a one-minute briefing under 40 lines with these `##` headings in order" -->
<!-- # relies poteto-mode/playbooks/opening-a-pr.md "Title: `type(scope): subject`, naming a real symbol when one carries the change." -->
- **Commit and PR text.** Commits use Conventional Commits, `type(scope): subject`, with the type, scope and subject Opening a PR gives a PR title. The body explains why in a short paragraph and describes the final behavior; it never restates the subject or lists intermediate attempts. A PR targets `{{branch}}` and opens ready, not as a draft, and never while `{{check}}` fails unless the user says so.
<!-- if protected -->
  It never targets `{{protected}}`.
<!-- end -->
  Its body is the page of the PR's plan, written with the `plan-page` skill's PR mode. That plan is the one plan that covers the whole diff, or a PR plan that lists the plans it carries.
<!-- end -->
<!-- end -->
<!-- # overrides poteto-mode/references/merge-safety.md "A queue or automatic request may outlive its admission revision." -->
- **Auto-merge.** Each PR an agent opens anywhere gets `gh pr merge <url> --auto` with a method its base allows; report a refusal (owner's word, 2026-11-12).
<!-- # overrides poteto-mode/SKILL.md "In your reply, name each principle that shaped a decision" -->
- **Principles in replies.** pstack's principle skills still apply. Read the leaf skill for any principle a decision rests on, as poteto-mode's Principles list says. Only the rule to name each principle in the reply is dropped; name one only when it explains a choice the reader would otherwise question.
<!-- # adds -->
- **Blocked.** For an unclear tool or access failure, allow two informed attempts or ten minutes, whichever comes first. Then finish a bounded repair, ask once for the exact human action under the page's Needs you, or move to other ready work.
<!-- # overrides reflect/SKILL.md "prints the first path whose opening typed prompt carries the fragment" -->
<!-- # overrides reflect/SKILL.md "and wait for approval before editing any skill." -->
<!-- # overrides reflect/SKILL.md "After approval, copy the skill folder there and edit the copy." -->
<!-- # overrides reflect/SKILL.md "Never open a PR or push." -->
<!-- # overrides correct/SKILL.md "fix the most frequent classes now, one commit each" -->
- **Improve the workflow mid-task.** When a skill, rule, script or helper gets in the way, fix it then, separately from the task's change, and keep working. A card session fixes friction it worked around once its task lands, as chips.md's Landing says. When the user corrects the same mistake a second time, in code or in a shell or tool command a rule already forbade, run `/pstack:correct` on that class, which fixes it with architecture, types or a check before any rule text.
  Run `/pstack:reflect` only when the owner asks for it, as pstack does (owner's word, 2026-11-20).
  Before `/pstack:reflect`, `/pstack:correct`, a new or changed check, or an edit to an agent file such as a skill, a rule or `AGENTS.md`, read `.agents/pstack/rules/reflect.md` in full; it holds the rest of this rule and the Corrections and Agent files rules.
