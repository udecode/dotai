---
name: sync-pstack
description: "Set up the pstack plugin in a project through an interview, and keep every pstack project on one pinned tag and one shared AGENTS.md overrides block. Use to set up or install pstack in a repo, sync, bump or update pstack everywhere, list which projects use pstack or have drifted, compare setups, audit a project's skills for drift from pstack (which to cut, fold or keep), move a workflow lesson into every project, or change the plan page shape. Not for choosing pstack's per-role models, which setup-pstack owns."
metadata:
  source: udecode/dotai
  source-path: skills/sync-pstack
---

# Sync pstack

One skill sets pstack up in a project and keeps every set-up project in step with upstream pstack and with one shared set of overrides. Project-only rules never sync.

Setup brings the shared layer: the plugin pin, the overrides block, its helpers, typed entry points kept for retired controllers, a routing table and a proof skill. It does not bring a project's own knowledge, such as its source authority, domain laws or review scenes; those stay the project's work, and the domain skills come through setup untouched.

## Layers

| Layer | Lives in | Changed by |
| --- | --- | --- |
| Upstream | The `pstack@pstack-claude` plugin at a pinned tag, in each project's `.claude/settings.json`, the user's `~/.claude/settings.json` and the user's Codex marketplace | `sync --tag` and `user-pin`. pstack itself is never edited. |
| Shared | [`assets/block.md`](assets/block.md), rendered between the `pstack:begin` and `pstack:end` markers of each project's `AGENTS.md`, plus the helpers in `assets/pstack/`, copied to `.agents/pstack/` | An edit to this skill's source in the dotai checkout, then a sync |
| Project | `.agents/pstack.json`, which holds the interview's answers, the [project playbooks](#project-playbooks) in `.agents/playbooks/`, which the block lists, and every rule outside the block, which wins over it | The project, by hand or through setup |

## Run the script

Run `node <skill>/scripts/sync-pstack.mjs <command>` from any directory.

| Command | Effect |
| --- | --- |
| `discover <project>` | Prints the facts the interview needs as JSON. Read-only. |
| `status [project...]` | Shows the latest upstream tag (and an upstream VERSION that runs ahead of it), the user pins, and each project's pin, drift, vendored copies and last source revision. Without project paths it finds the local pstack projects from the repository sets in `~/.agents/config.json`, their parent directories and each `--root <dir>`. Read-only. |
| `apply <project>` | Writes the block, the helpers and the project pin from the project's config. `--tag` pins a tag first, prints pstack's diff between the two tags for every file an override or a project playbook anchors on, and refuses the tag when pstack no longer has text one of them quotes. `--dry-run` shows the block diff and lists the other writes. `--force` overwrites an edited block or helper, or renders from a source older than the project's last sync; it never skips an anchor. |
| `check <project>` | Exits 1 when `apply` would change anything. Read-only. |
| `verify <project>` | Exits 1 when a command or argument-hint mode typed in this project's history no longer resolves (unless `dropped` lists it), a project skill has a dead link into the skill tree, a rule names a retired skill, a skill the docs tell users to install depends on this project's workflow files, `check` would change anything, or pstack at the pinned tag lacks text an override or a project playbook anchors on. Read-only; it reads chat history only when a skill or a mode was cut since `HEAD`, which takes minutes, so run it once, in the background with its output in a file, after the last `apply`. |
| `sync --tag <tag> [project...]` | Runs `apply --tag` on the named projects, or on every managed project when none are named, and lists the unmanaged ones. It refuses a checkout that is off the project's branch or has uncommitted edits to the files it writes, unless `--allow-dirty`, and keeps going when one project fails. |
| `playbook <project> <name>` | Prints the numbered steps of every pstack playbook that `.agents/playbooks/<name>.md` extends, at the project's pin, with its changes applied in order. Text outside the steps, such as the Reply line, is left out. Read-only. |
| `smoke <project> <prompt>...` | Runs each prompt in a read-only Claude Code session on Opus and a read-only Codex session on gpt-6.1-sol from the project root, in parallel, and prints each runtime's final answer. |
| `user-pin --tag <tag>` | Pins the user-scope Claude Code marketplace and prints the refresh commands for both runtimes. |
| `latest` | Prints the newest upstream tag. |

`node <skill>/scripts/audit.mjs <project> [--json] [--min <score>]` prints the facts the [Audit](#audit) mode judges; `--min` sets the overlap score a sentence pair needs, 0.5 by default. Read-only.

Anchor checks read pstack from a bare clone that the script makes in `~/.cache/sync-pstack/` on first use; `SYNC_PSTACK_UPSTREAM` points them at another clone or URL. Run the copy in the dotai checkout when one exists, the checkout whose `origin` is `udecode/dotai`. Its `assets/` are the source of truth. `apply` and `sync` print the source they render from, and record in `synced.source` the shared commit they rendered. With that record, a refusal shows exactly what the project edited, and a copy older than a project's last sync refuses to overwrite it.

## Choose the mode

| Request | Mode |
| --- | --- |
| Set up pstack in a project, or install pstack here | [Setup](#setup) |
| Sync, bump or update pstack, here or everywhere | [Sync](#sync) |
| Compare setups, or list which projects use pstack or have drifted | [Compare](#compare), read-only |
| Audit a project's skills for drift from pstack, or which skills to cut | [Audit](#audit), read-only until the owner picks |
| A lesson or correction that changes a shared rule | [Lesson](#lesson) |
| Add or change a project's own playbook | [Project playbooks](#project-playbooks) |

Change only the projects the request names, or every managed project when it asks for all of them. The repository sets in `~/.agents/config.json` name candidates, not authorization.

## Setup

1. **Discover.** Run `discover <project>`, then read `AGENTS.md` and the workflow rules it routes through, in full. Nothing is written yet.
2. **Interview.** This is the first step the user sees. Follow [the interview](references/interview.md): prepare from evidence, always ask about delivery, recommend the reference answers unless the project's evidence argues otherwise, and never re-ask a settled answer.
3. **Record** the answers in `.agents/pstack.json`, with `tag` from `latest`.
4. **Adapt** the project per [adapt](references/adapt.md). Remove vendored pstack copies, settle orphaned skills and rule forks, keep the formatter off the synced files, rewrite project rules that duplicate or contradict the block, repoint references to removed skills, write the confirmed routing table, create the proof skill when there is none, and regenerate skills from rules.
5. **Apply.** Run `apply <project> --dry-run`, read the diff, then run `apply <project>`.
6. **Verify.**
   - `discover` reports no vendored copies, and `status <project>` shows the user pins at the tag. Otherwise run `user-pin` and its commands.
   - Smoke-test both runtimes with `smoke <project> "<prompt>"`, using a plain request that names a real feature: "Fake task, do not edit anything or run commands that write: <feature> resets after <action>. Walk me through what you would do, in order, in at most ten short lines: first the todo items you would open, then how the finished work lands." Judge what each runtime would do, not only which playbook it names. Check first that the fixture is in the state the prompt implies, for example that a plan you say is approved is not Done. Expect poteto-mode's Bug fix playbook (and the project playbook that extends it), no worktree, and the delivery answer. A difference between the runtimes, or a conflict an answer flags, is a failure: fix it and smoke the failing runtime again. Ask which model subagents run on in a second prompt. Never name the playbook, the stop or the step in the prompt, because then the run proves lookup, not routing. To test a new or changed gate, such as a review, send a plain request big enough to trigger it, ask only for the todo list and the reply that hands the work back, and count the smoke passed only when the gate shows up unprompted. The runs fire the project's hooks, so a Stop hook that stages files stages the setup's changes too.
   - Run the project's `lintFix` over the changed code files, then run `verify <project>` last, so a cut typed command, a dead link, a retired name, a coupled public skill or a formatter rewrite of a synced file shows up now. Fix every problem it lists before delivering.
7. **Deliver** by the project's delivery answer. When it commits, the commit body says which runtimes and people gain or lose what; in `user` mode the reply says it, for the owner's commit. Close with the answers, the settled defaults applied, the skills removed and kept, and the verification output.

## Sync

1. Run `status` to see the managed projects, their pins, drift and last source, and the latest tag. Pin only a tag `latest` prints. A merged VERSION bump is not a release until its tag is pushed, and `status` says when upstream's VERSION runs ahead of its newest tag.
2. When a newer tag exists, read pstack-claude's `CHANGES.md` at the new tag (`gh api 'repos/michael-denyer/pstack-claude/contents/CHANGES.md?ref=<tag>' -H 'Accept: application/vnd.github.raw'`) from the pinned tag up. Check each change against the block: a playbook step, skill, principle or hook that an override names. Upstream may now do what an override did; propose dropping that override. It may have changed the text an override contradicts; propose the rewrite. Show each proposal to the user and apply it through [Lesson](#lesson) only on their word.
3. Run `sync --tag <tag> --dry-run` with the projects in scope and read the pstack diff it prints for every file the block or a project playbook anchors on, because a step can change while its quoted text survives. Then run it without `--dry-run`. Omit the project list only when the request covers every managed project. Offer Setup for each unmanaged project it lists.
4. Resolve each refusal.
   - **Edited block or helper.** The refusal shows the project's edit. Move a generic edit into the template through Lesson and a project-only edit outside the block. Nothing is lost then, so rerun with `--force`. Without moving it, use `--force` only when the owner says the edit can go.
   - **Off branch or uncommitted edits.** Switch to the project's branch, or wait for the owner's commit. Use `--allow-dirty` only when the uncommitted edits are this run's own.
   - **Older source.** Update the dotai checkout and rerun from it; with uncommitted edits, follow [Lesson](#lesson) step 2.
   - **Uncommitted shared edits.** The project was last synced from shared edits nobody committed, and a clean source would drop them. Commit them in the dotai checkout, then rerun; use `--force` only when the owner says they can go.
   - **pstack anchors.** pstack at the new tag no longer has text the block or a project playbook builds on, and the refusal shows pstack's diff. Rewrite the override through Lesson, or the playbook's change in its project, against the new text, then rerun. Drop the change when upstream now does what it did.
   - **Error.** A config the template cannot render. Fix the config, then rerun that project.
5. Run `user-pin --tag <tag>`, then the printed commands from the home directory. Codex asks to trust the pstack hook again when its file changed.
6. Verify each synced project with `verify`, and smoke-test one project per delivery mode in use, judged as in Setup step 6. Smoke one plain prompt for each playbook whose `when` or steps changed, one for each cut entry point and one for each new or changed gate, not a fixed set.
7. Deliver each project on its branch by its own delivery answer, committing only the files the sync wrote. A `push` project commits and pushes the sync, a `user` project leaves the change for its owner, and a `pr` project opens a PR.

## Compare

Run `status`. For each unmanaged project that uses pstack, read its instructions and map every override to the block as covered, a project adaptation, an explicit policy difference, drift, or unresolved. Call a rule lost only after reading the project's `AGENTS.md` outside the block and its setup plan's disposition table, and after searching for the behavior in more than one phrasing, because setup moves and rewords rules. Report each difference with both behaviors, their source paths and the smallest reconciliation. Suggest setup or sync, and apply nothing without a request.

## Audit

Skills drift from pstack when they copy law that pstack or the block already owns, or keep a job pstack now does. This mode finds that drift so the owner can cut it.

1. Run `node <skill>/scripts/audit.mjs <project>`, from the dotai checkout when one exists. It prints:
   - each project and user-scope skill's source, typed count, inbound routes and stale installed copy;
   - the block rules that carry no `overrides` note or `adds` marker;
   - sentences that repeat pstack, the block, or another file in the project.
   A typed count includes only what a person wrote: it skips agent, task-notification and headless records and pasted blocks, and it ignores a hit past the first 200 characters of a request longer than 2,000. A user-scope skill's count spans every project's sessions.
2. Run `/pstack:interrogate` on that report with [the audit brief](references/audit-brief.md) as the intent and its cut, fold or keep rubric. Each skill gets one verdict: cut when pstack or the block already does its job or nothing uses it; fold when its domain knowledge stays but its process text goes; keep when it holds domain knowledge pstack cannot have. Every cut names what replaces it.
3. Hand the verdict table to the owner with `AskUserQuestion`, cuts grouped by project, recommended ones first. A typed command loses its entry point only when the owner picks its cut, and that cut lists it under `dropped` in the project's config.
4. Carry out the picks as a plan under the block's Plans and trails and Panel review rules.

## Lesson

A lesson from `/pstack:reflect`, or a correction in one project, changes the shared layer only when it holds for every project. A lesson for one project goes outside that project's block. A change to the plan page shape is a lesson on `assets/pstack/plan-page.mjs`: render one real plan from each managed project before and after, in every mode the renderer branches on, using a scratch copy with its `Status:` flipped when no live subject is in a mode, and publish both so the owner compares them. A section only one project writes goes in that project's `pageLead`, never in the renderer.

1. Open a todo list with each of the user's asks quoted word for word, then these gates, in order, after the last behavior edit: `deslop` and `no-comments` on helpers, `unslop` on block and skill prose, the tests and corpus, the decision-trail review, `apply`, `verify` and the smoke. A design restated back to the user keeps the user's own word for each state or trigger.
2. Fetch and fast-forward the dotai checkout before the first edit and again before `apply`, because other sessions push the shared source and sync projects mid-run. When this run's uncommitted edits block the fast-forward, save `git diff HEAD -- <files>` and copy any new untracked file aside, run `git restore --source=HEAD --staged --worktree <files>`, then `git merge --ff-only`, `git apply -3` the patch and put the copied files back, resolve the conflicts and run `git restore --staged <files>`, because `apply -3` writes the index; rerun the checks and name each upstream commit that rides into a synced project.
3. Edit `assets/block.md` or a helper in the dotai checkout. Keep project names, paths and commands out. A value that differs per project becomes a config field and a placeholder. Prefer an optional field used inside `<!-- if key -->`, because a new required field fails the render for every config that lacks it until the interview adds it. Block text that says a helper refuses something names the exact predicate it checks and what it skips.
4. Preview with `apply <project> --dry-run` on each managed project. A helper or check change also runs the old and new copies over every artifact it judges in each managed project and diffs the failures; for a renderer, it diffs the rendered bodies too. Before the dotai commit, the lead also opens the changed region of each managed project's real rendered page, because an exit status and a printed path show nothing about the content. A finding that names a real artifact closes only with a check on that artifact, never on a fixture alone. It runs on each template filled to the state it gates, so it can pass. For each predicate that refuses, it runs a near-miss that must pass, a near-miss that must refuse and the reverse transition, such as a reopened plan. A run with failures, or with no instance of the state a new check gates, is logged `partial` or `gap`, never `verified`. A newly failing file that another session holds uncommitted stays failing and is flagged with its owner, per the block's Delivery rule. Re-read a file right before logging any claim about it. The commit body gives the newly failing count per project.
5. In dotai, run `node --test skills/sync-pstack/scripts/sync-pstack.test.mjs`, `scripts/validate-skills` and `node scripts/build-workflow.mjs`, then commit and push by dotai's rules.
6. Sync the projects the request covers, rerunning the old and new corpus on each project's live tree right before its `apply`, because sessions add files mid-run. Then run Sync steps 6 and 7 for each of them, so every project gets `verify` and every delivery mode gets a smoke before its delivery.

## Project playbooks

A project adds its lifecycle on top of pstack's playbooks instead of in skills only the user can invoke, so plain requests reach it through poteto-mode. Each `.agents/playbooks/<name>.md` holds:

- Frontmatter with `extends`, the pstack playbook stems it builds on (`bug-fix`, or `feature, refactoring`), and `when`, one sentence naming the requests it serves. The block lists each playbook with that sentence, so adding or editing one makes `check` fail until `apply` renders the block again.
- Changes as list items that start with `**After**`, `**Before**`, `**Replace**` or `**In**` and a quoted run of the pstack step's own words, such as `- **After** "Reproduce it yourself": …`. Quote enough words to name one step; the check collapses whitespace before it matches, and fails a change that uses one of these verbs without a straight-quoted run. An item without one of these verbs adds a step where it says.
- Its stop points, when it stops where the pstack playbook does not.

`**In**` adds work inside a step, `**Replace**` swaps a step the project has already settled, and `**Before**` runs ahead of the step, so a change that implements belongs **In** the base's implementation step, never **Before** a design or pin step. `**In**`, `**Before**` and `**After**` add lines and keep every word of the base step, so a step whose words contradict the block or a project rule (delegate, commit, snapshot, an extra writing pass) needs `**Replace**`. A rule that limits later steps, such as who may commit, push or reply, goes `**Before**` the first step it limits, because agents copy the rendered steps into their todo list in order. The anchor check matches text, not order. After each edit, run `playbook <project> <name>`, which prints every base's steps with the changes applied in order, and read it. A playbook that extends two bases restates each change for each base.

Keep project knowledge in skills and the project's rules; a playbook only orders the work. A typed command that used to run the lifecycle stays as an entry point that names the playbook.

## Template grammar

`assets/block.md` is Markdown with line directives.

- `<!-- if key -->`, `<!-- if !key -->`, `<!-- if key=a|b -->` and `<!-- if key!=a -->` open a region that renders when the condition holds on the project config.
- `<!-- section id -->` opens a region that is dropped when the config lists `id` under `skip`.
- `<!-- end -->` closes the innermost region. Regions nest.
- `{{key}}` inserts a config value. A rendered line whose value is missing fails the render, and so does a `skip` entry that names no section.
- A line starting with `<!-- #` is a template note and never renders. A note `<!-- # overrides <path> "<text>" -->` names pstack text the next override replaces, with `<path>` relative to pstack's `plugins/pstack/skills/`; `apply --tag` and `verify` fail when that text is gone. An override carries one note per pstack step it replaces, so widening its scope adds a note for every step it newly covers. A rule that only adds to pstack carries `<!-- # adds -->` instead, and `verify` flags a rule with neither.
- An indented line continues the list item above it, so a conditional sentence can join a rule.

## Boundaries

- Never edit pstack's own files. Change its behavior through the block or a project rule.
- Never overwrite a refused block or helper without the owner's word, unless its edit has moved to the template or outside the block.
- Setup and sync deliver only by the project's delivery answer. They never push a protected branch, force-push or open a PR that answer does not call for.
- The interview's settled answers belong to the owner. Ask again only when a project's evidence contradicts one.
- Setup and sync never trim, merge or rewrite a domain skill's method. Trimming is its own measured pass: measure the overlap between files before cutting, and keep any rule that has no other owner.

## Resources

- [Interview](references/interview.md): the questions, their evidence and recommendations, and the config fields.
- [Adapt](references/adapt.md): vendored copies, orphaned skills, rule forks, Codex seats, formatters, and rewriting project rules around the block.
- [`assets/block.md`](assets/block.md): the shared block.
- `assets/pstack/`: the plan and decision-log helpers the Plans rule runs, and `cross.mjs`, which runs a prompt read-only in the other runtime on a named model and effort, for a panel's other-family seats and `smoke`.
- `scripts/sync-pstack.mjs`, with its tests in `scripts/sync-pstack.test.mjs`.
