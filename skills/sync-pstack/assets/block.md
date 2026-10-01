<!-- # Shared block template. sync-pstack renders it into each project's AGENTS.md; the grammar is in the skill's SKILL.md. -->
## How work runs

- pstack's `poteto-mode` is the engineering method. The `pstack@pstack-claude` plugin is pinned to GitHub tag `{{tag}}` in `.claude/settings.json`, and each person's Codex marketplace pins the same tag. Its session hook routes multi-file, design and unexplained-bug work into poteto-mode, which picks the playbook. Questions, small edits and one-file changes work directly and are verified on the real artifact.
<!-- if projectPlaybooks -->
- Project playbooks in `.agents/playbooks/` build on pstack's. When poteto-mode matches a pstack playbook one of them extends, or the work fits one listed below, open that file as well. Copy the pstack steps into the todo list verbatim, then apply each change at the step its quoted text names, and stop where it says to stop.
{{projectPlaybooks}}
<!-- end -->
- If no `pstack:*` skills are available, stop and ask the user to install the plugin before engineering work. In Claude Code they trust the folder and run `claude plugin install pstack@pstack-claude --scope project`. In Codex they run `codex plugin marketplace add michael-denyer/pstack-claude --ref {{tag}}` and `codex plugin add pstack@pstack-claude` from their home directory, then trust the session hook in `/hooks`.
- The latest user correction wins over every rule. This file's rules outside this block win over the overrides inside it, and those win over pstack. pstack's hook itself says project instructions take precedence.
- Two models only. Claude Code runs every pstack role and panel entry on `opus`, per `~/.claude/pstack-models.md`, and never dispatches fable, sonnet or haiku; a panel is three independent Opus runs. Codex runs `gpt-6.1-sol`, and every role there inherits it, per `~/.codex/pstack-models.md`. Plans, designs and first drafts start in Claude Code. Codex reviews plans and finished execution for gaps, completeness and contradictions, because a long Claude Code session loses context.
- Be concise, plain and candid, in English. Comments document non-obvious reasons only.
<!-- if glossary -->
  Use the words in `{{glossary}}`.
<!-- end -->
- pstack is never edited here; an override changes its behavior. The `sync-pstack` skill renders this block from its shared source in `udecode/dotai`, replaces it on every sync, and moves every pin to a new tag together after reading pstack's changelog, so never bump a `ref` by hand. The next sync refuses an edit made inside this block. A lesson that changes a rule in this block goes to the shared source; a lesson for this repository alone goes outside the block.

## pstack overrides

<!-- # Each "overrides" note names pstack text an override replaces; sync-pstack refuses a bump that drops it. -->
<!-- # overrides poteto-mode/playbooks/feature.md "Run **Opening a PR**" -->
<!-- if delivery=push -->
- **Delivery.** A completed task runs its writing passes, then `{{lintFix}}` as its last check, then commits and pushes `{{branch}}`. When `git status --short` lists anything the task did not write, stage only the task's own paths; `git add -A` is only for a checkout that holds nothing else. No PR, merge or force-push unless the user asks. pstack's Opening a PR, Babysit and Shipping playbooks apply only to a requested PR, and their "worktree off main" step never applies.
<!-- end -->
<!-- if delivery=pr -->
- **Delivery.** A completed task runs its writing passes, then `{{lintFix}}` as its last check, then commits on a topic branch cut from `{{branch}}` in the current checkout and opens a PR into `{{branch}}` through pstack's Opening a PR playbook, whose worktree step never applies. Babysit and Shipping run when the user asks. Never push `{{branch}}` directly, merge or force-push unless the user asks. Record each commit SHA this run creates in its todo list or decision log as it lands.
<!-- end -->
<!-- if delivery=user -->
- **Delivery.** The user owns commits. A completed task runs its writing passes, then `{{lintFix}}` as its last check, and leaves its changes in the working tree. Commit, push or open a PR only when the user's own message asks for it. Approving an agent's plan is not commit authority, and no plan or step list proposes a commit.
<!-- end -->
  When `git status` shows work the task did not write, run `{{lintFix}}` on the task's code paths only, because a repository-wide run reformats other sessions' files; a change with no lintable file skips it. Run it again after any later repair. When a change alters what an operation promises, search the plans and agent instructions for the old promise, fix this task's own docs, and flag the rest in the reply. Production deploys and releases need an explicit request.
<!-- if protected -->
  Never push `{{protected}}` unless the user asks.
<!-- end -->
<!-- if delivery=push -->
- **Shared checkout.** Other sessions may edit this checkout without notice, and every session commits as the same user. Stage nothing before the commit itself. Delete a tracked file with `rm`, not `git rm`, and commit with an explicit pathspec (`git commit -- <paths>`), because another session's plain `git commit` sweeps in whatever is staged. Record each commit SHA this run creates in its todo list or decision log as it lands, and decide which commits are this run's from that list, never from memory or the author field. In a multi-batch pass, push each verified batch as it lands, staging only that batch's files; mid-batch states stay local. Pull only after a rejected push, with `git pull --rebase --autostash`; that autostash is the one exception to the no-stash rule under Git. If it does not re-apply cleanly, or `git stash list` still shows an autostash entry afterwards, restore that session's files from it and stop. Stop and report a conflict or hook failure. After a rebase that changes agent instructions, re-read them before the next step.
<!-- end -->
- **Git.** Before a nontrivial edit, check only `git branch --show-current`.
<!-- if protected -->
  Never edit from `{{protected}}`.
<!-- end -->
<!-- if delivery=push|user -->
  The checkout stays on `{{branch}}`. Do not create or switch checkouts because work is large, names an issue or asks for a PR.
<!-- end -->
  Ignore unrelated diffs and never pause to ask about them. Never stash, reset or discard work this run did not write. Run a tree-sensitive tool, such as a review that refuses a changing tree or a check at `HEAD`, from a detached worktree (`git worktree add --detach <path> <sha>`, then `git worktree remove --force <path>`). Never overwrite a tracked file in this checkout to test or measure `HEAD`, even for a moment; use the worktree.
<!-- # overrides poteto-mode/playbooks/feature.md "Delegate code-writing to a subagent" -->
<!-- # overrides poteto-mode/playbooks/bug-fix.md "Delegate implementation to a subagent" -->
- **The lead writes the code.** The lead agent edits the current checkout and verifies on the running artifact. Subagents do research, review and read-only fan-out. No per-delegate worktrees unless the user asks. This replaces the mandatory delegation in pstack's Feature and Bug fix playbooks.
<!-- if proof -->
  The `{{proof}}` skill is pstack's driver skill here. Bug fixes reproduce and verify through it, and its proof replaces the swarm lanes of pstack's Multi-phase plan.
<!-- end -->
<!-- # overrides poteto-mode/SKILL.md "Reversible work and external actions" -->
- **Cross-model review.** The user picks the reviewer and relays it by hand. When a plan is ready, and when an execution finishes, the lead ends its reply with one line and stops: `$cross-review <plan path>` for Codex or `/cross-review <plan path>` for Claude Code, bare when the work has no plan. The reviewer finds the session from that line and reads the user's typed asks from its transcript, so the plan never copies them. For a plan still in planning, the reviewer fixes the gaps in the file, logs one decision-log row per change and leaves the edits uncommitted; when it disagrees with a decision the user made, it reports instead of editing. An execution or a PR gets findings only. When the user returns, the lead re-reads the plan and the reviewer's rows, keeps or reverts each edit and applies or rejects each finding, each with a reason, before it builds or closes. Only a round with a P0 or P1 finding earns another hand-off, and a re-review checks only what changed. After two rounds, the lead lays out any P0 or P1 that remains for the user, with the reviewer's position, its own and its pick, instead of handing off again. A user with only one runtime gets the review on the session's own model, labeled same-family. `node .agents/pstack/cross.mjs` runs the hand-off itself only when the user asks for that.
- **Messages and shared resources.** Never send a message to another person, such as a chat message, an email, an SMS, an issue, PR or tracker comment addressed to someone, or a send to customers, without explicit authorization for that message. A "can we X?" question gets a measured answer and a proposal, not the action. An action that spends a shared resource, such as a migration on a shared environment, paid quota or another person's access, needs the user's go-ahead for that target, and neither a context summary nor "continue without asking" is that go-ahead. An access grant is approved per target and runs as its own command; never widen an approved grant to a new target. pstack's "external actions proceed without asking" does not apply to messages, shared resources or access.
<!-- section tests -->
- **Tests.** Every test must fail for a named, plausible defect and pass only once it is fixed. Add nothing when an existing test, type, lint rule, static check or direct runtime proof already catches the defect; skills, PRDs or issues that prescribe broad testing do not override this. A bug fix with a cheap test path writes the test first and runs it to see it fail for the named defect, then lands it together with the fix, never as a failing commit of its own. When the test would be expensive, integration-heavy or unclear, skip it and prove the fix at runtime. A refactor pins behavior only where no existing test or type covers it. One regression usually gets one public-boundary test, and more cases need distinct failure modes. Test public behavior. Never test source text, copy or labels, constants, fixture construction, mock returns, implementation order, library behavior or another test's boundary, and never recompute the implementation in the assertion. Cut duplicate and lower-signal tests instead of porting them. No exhaustive matrices, snapshots, broad smoke suites or speculative cases; a static invariant belongs in lint or a check script. Assertions live inside tests, and committed code has no `.only` or `.skip`. During iteration run only the narrowest affected check. Run `{{check}}` once for the settled change when its blast radius justifies it, and attribute each failing step to its files before calling it someone else's. Call a failure pre-existing only when the same check fails the same way at `HEAD` in a detached worktree; a failure your change joined or made worse is yours.
<!-- end -->
<!-- section review -->
<!-- if risk -->
- **Review.** Run the `autoreview` skill on a high-risk change before it is pushed, opened as a PR or handed back. High risk means {{risk}}. Judge risk by what the code gates, not by what the diff touches. A fix for an unintended write, invite or send counts as that write, invite or send, even when the diff only changes rendering. Never run it for docs, agent instructions, skills, copy or other low-risk changes.
<!-- end -->
<!-- if !risk -->
<!-- if reviewPr -->
- **Review.** Run the `autoreview` skill before opening any PR, and otherwise only when the user asks for a review.
<!-- end -->
<!-- if !reviewPr -->
- **Review.** Run the `autoreview` skill only when the user asks for a review.
<!-- end -->
<!-- end -->
<!-- if risk -->
<!-- if reviewPr -->
  Run it before opening any PR as well, whatever the risk.
<!-- end -->
<!-- end -->
<!-- if delivery=push -->
  Another session's push ships every local commit, so a reviewed change reaches `{{branch}}` only once its review is clean. Save its diff, commit it in a detached worktree at `HEAD`, review that commit there with `--mode commit --commit <sha>`, and fix and recommit until clean. Then revert this run's own uncommitted edits to those paths, keeping any other session's, and `git cherry-pick` the reviewed commit onto `{{branch}}`.
<!-- end -->
<!-- if delivery=pr -->
  Review the PR branch with `--mode branch --base <base>`, or with `--mode local --base <merge-base>` while it has uncommitted work.
<!-- end -->
<!-- if delivery=user -->
  Review the working tree with `--mode local`.
<!-- end -->
<!-- if reviewPr -->
<!-- if delivery!=pr -->
  Review a PR's branch with `--mode branch --base <base>`, or with `--mode local --base <merge-base>` while it has uncommitted work.
<!-- end -->
<!-- end -->
  The command is `.agents/skills/autoreview/scripts/autoreview --engine codex --model gpt-6.1-sol --thinking high --max-priority P1` from Claude Code, or the same with `--engine claude --model opus` from Codex, plus that mode, so the review always runs on the other model. In commit or branch mode, pass each caller or entry-point file whose behavior the change can break as `--source-context <path>`, such as every wrapper of a changed shared primitive; local mode takes no source context. The `--prompt` states the invariant that must hold and the entry points or callers to attack, never the author's conclusion that they are safe. A verdict that says something cannot be verified leaves that concern unreviewed. Rerun with its files as source context in commit or branch mode, or prove it at runtime, before calling it fixed. Verify each P0 and P1 finding against the code, fix the real ones, and rerun. Stop when no P0 or P1 remains or every remaining one is dismissed with a concrete reason; P2 and lower never block. When `/pstack:interrogate` runs on a diff, this review is its cross-model reviewer. On a plan, verdict or design, its cross-model reviewer is the hand-off in the Cross-model review rule. A design that changes after its last interrogate or review, including cuts the user approved, runs `/pstack:interrogate` again before it ships; an approval covers only what the user saw.
<!-- end -->
<!-- section plans -->
<!-- # overrides poteto-mode/playbooks/multi-phase-plan.md "Unless the operator names a path, write the file under the agent store" -->
- **Plans and trails.** When work spans sessions, runs unattended, touches another person's area or goes into a PR, keep its plan in the repository as `{{plans}}/<date>-<slug>.md` and its show-me-your-work decision log beside it as `{{plans}}/<date>-<slug>.decisions.tsv`, so teammates can read the reasoning later. Every new decision-log row starts its result with a status word (fixed, partial, verified, open, gap and the rest `node .agents/pstack/decisions-check.mjs <log>` enforces). A fixed, verified or proven row puts `scope:` in its evidence, naming what the proof covered. That check passes before the log is committed. Append rows with `node .agents/pstack/decisions-check.mjs append <log> <phase> <decision> <why> <evidence> <result>`, which writes only a row that passes the check. A plan is marked Done only after `node .agents/pstack/plan-open.mjs <plan>` passes: no unchecked box or TODO, TBD or FIXME is left, every box closed since the last commit names the artifact that closed it (a path, command, commit or link) or `skip: <reason>`, and every deferred or open finding names its `owner:` and where it is tracked. A count, absence or impossibility claim in a plan, record, README or log row names the check that could falsify it, or says it is inferred. A count, verdict or advice keyed to a new derived label holds only after the raw evidence of the first real items it marks has been opened, because a passing test shows only that the code matches its own definition. When a later proof replaces or narrows an earlier one, append a `superseded` row naming the earlier one and fix every plan step that cites it. Ordinary fixes rely on their commit body. Other decision logs and all pause checkpoints stay local. Screenshots and run artifacts are never committed.
<!-- end -->
<!-- section long-runs -->
- **Long runs.** Use pstack's Autonomous run playbook with a checkable exit condition. Claude Code keeps going with `/loop`; Codex uses its native `/goal`. On "pause", run pstack's Pause safely playbook; automatic continuation or compaction never resumes paused work. "go" after a plan, or after a review that proposes one, runs every remaining slice without pausing between slices; it adds no commit, message or shared-resource authority. Report each reversible call with the word that reverses it.
<!-- end -->
- **Todo list and close.** Where pstack opens a todo list, add after the playbook steps one todo per explicit user ask, quoted, and one per gate this file makes the work trigger, such as proof, the writing passes, then review, then the last check and delivery. Each todo closes with the artifact that proves it, such as the skill invocation, test run, path or commit, or `skip: <reason>`; a gate is never ticked before that artifact exists. Close in this order: proofs, writing passes, the decision-trail review, then immutable records such as ledger records, attestations and proven decision-log rows, then `/pstack:reflect` once the trail review has returned, so its reviewers see the findings. Each parallel subagent brief names its own scratch directory, which also holds that subagent's fallback todo list. Before every final reply, reread this run's user messages, corrections included; add any ask that has no todo, then finish it or skip it with a reason. A reply that closes more than ten items states how many are done, skipped, blocked and open, and those counts add up to the total. A resume prompt handed to another session carries the goal, the gate and the plan path, never commands, because other sessions change shared state before it is pasted and the plan's next action is the one place that gets corrected.
<!-- if delivery=push|pr -->
  The closing reread also walks the run's commit ledger, so every commit the run created has its proof and, where a decision log is kept, a row.
<!-- end -->
- **Writing passes.** pstack triggers four separate writing passes; run one per kind of change. Product code gets `deslop`, then `no-comments`, before any review and before it is committed or handed back. Docs, plans, agent files, commit bodies and PR text get one `unslop` pass after drafting. Run the writing passes and review fixes before an expensive runtime proof; a finding that changes behavior reopens the proof it touches, or the claim narrows to the bytes actually proven. `technical-writing` is a reference for plans, PRDs and RFCs, not a required pass. Replies are written clean as drafted, with no separate pass.
<!-- section commits -->
- **Commit and PR text.** Commits use Conventional Commits, `type(scope): subject`. The type is one of `feat`, `fix`, `docs`, `refactor`, `test`, `chore` or `perf`, and the scope is the changed area. The subject is short and imperative, names a real symbol when one carries the change, and has no trailing period. The body explains why in a short paragraph and describes the final behavior; it never restates the subject or lists intermediate attempts. A PR targets `{{branch}}` and opens ready, not as a draft, and never while `{{check}}` fails unless the user says so.
<!-- if protected -->
  It never targets `{{protected}}`.
<!-- end -->
  Its body links its plan first, then uses `## Why`, `## Scope`, `## Tradeoffs`, `## Blast Radius` and `## Verification`, in that order, and drops any with nothing to say. Scope names real symbols and paths, and both sides of a rename. Attach screenshots or video when they prove a claim. No `## Summary` or `## Test plan` boilerplate, SHAs or file-by-file checklists.
<!-- end -->
<!-- # overrides poteto-mode/SKILL.md "In your reply, name each principle that shaped a decision" -->
- **Principles in replies.** pstack's principle skills still apply. Read the leaf skill for any principle a decision rests on, as poteto-mode's Principles list says. Only the rule to name each principle in the reply is dropped; name one only when it explains a choice the reader would otherwise question.
<!-- # overrides show-me-your-work/SKILL.md "spawn a subagent on a different model family" -->
- **Decision-trail review.** show-me-your-work asks for a reviewer from another model family. Use a fresh-context subagent instead, Opus in Claude Code and the session's model in Codex, and label the review same-family in the reply; the cross-model hand-off at the end of the execution brings in the other family.
- **Blocked.** For an unclear tool or access failure, allow two informed attempts or ten minutes, whichever comes first. Then finish a bounded repair, ask once for the exact human action, or move to other ready work. Never claim a skipped or unavailable proof passed.
- **Improve the workflow mid-task.** When a skill, rule, script or helper gets in the way, fix it then, separately from the task's change, and keep working. When applying a lesson, reread the destination section for a rule the new text contradicts and resolve it in the same edit. After an Autonomous run, an audit, or any session where the user corrected the workflow, run `/pstack:reflect` before the final reply and apply its accepted lessons. A lesson that changes a rule in this block goes to its shared source through the `sync-pstack` skill; without that skill, write it outside the block for the owner to upstream.
- **Agent files.** Before cutting or folding a skill, command or plugin, count the user's typed invocations over all history, not load counts. Keep every typed command and every working integration as an entry point, and count a replacement only once it works in this setup. Never edit a vendor skill installed from another repository; override it in this file or a project rule instead.
<!-- if skiller -->
<!-- if regen -->
  After editing a rule in `.agents/rules`, run `{{regen}}` and check the generated `.agents/skills/<name>/SKILL.md`; never edit a generated skill.
<!-- end -->
<!-- if !regen -->
  After editing a rule in `.agents/rules`, run `bunx skiller@latest apply` and check the generated `.agents/skills/<name>/SKILL.md`; never edit a generated skill.
<!-- end -->
<!-- end -->
  Run user-scope `claude plugin` commands from the home directory; from the repository they rewrite `.claude/settings.json`. After any plugin command, check `git diff .claude/settings.json`. Changes to agent instructions, plugin settings or the skill set reach every teammate and runtime on the next pull. When the run keeps a decision trail, a new shared script or check gets its decision-trail review before it is pushed to a shared source or proposed upstream, including one built from `/pstack:reflect` lessons after the run's first review. Before sharing one, run a fresh read-only session in each runtime (`sync-pstack smoke` runs both) with a plain fake request that does not name the answer to confirm routing, and state which runtimes and people gain or lose what, in the commit body or, when the user owns commits, in the reply.
