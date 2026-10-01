---
name: sync-pstack
description: "Set up the pstack plugin in a project through an interview, and keep every pstack project on one pinned tag and one shared AGENTS.md overrides block. Use to set up or install pstack in a repo, sync, bump or update pstack everywhere, list which projects use pstack or have drifted, compare setups, or move a workflow lesson into every project. Not for choosing pstack's per-role models, which setup-pstack owns."
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
| Project | `.agents/pstack.json`, which holds the interview's answers, and every rule outside the block, which wins over it | The project, by hand or through setup |

## Run the script

Run `node <skill>/scripts/sync-pstack.mjs <command>` from any directory.

| Command | Effect |
| --- | --- |
| `discover <project>` | Prints the facts the interview needs as JSON. Read-only. |
| `status [project...]` | Shows the latest upstream tag, the user pins, and each project's pin, drift, vendored copies and last source revision. Without project paths it finds the local pstack projects from the repository sets in `~/.agents/config.json`, their parent directories and each `--root <dir>`. Read-only. |
| `apply <project>` | Writes the block, the helpers and the project pin from the project's config. `--tag` pins a tag first. `--dry-run` shows the block diff and lists the other writes. `--force` overwrites an edited block or helper, or renders from a source older than the project's last sync. |
| `check <project>` | Exits 1 when `apply` would change anything. Read-only. |
| `verify <project>` | Exits 1 when a command typed in this project's history no longer resolves (unless `dropped` lists it), a project skill has a dead link into the skill tree, a rule names a retired skill, a skill the docs tell users to install depends on this project's workflow files, or `check` would change anything. Read-only; it reads chat history only when a skill was retired since `HEAD`. |
| `sync --tag <tag> [project...]` | Runs `apply --tag` on the named projects, or on every managed project when none are named, and lists the unmanaged ones. It refuses a checkout that is off the project's branch or has uncommitted edits to the files it writes, unless `--allow-dirty`, and keeps going when one project fails. |
| `user-pin --tag <tag>` | Pins the user-scope Claude Code marketplace and prints the refresh commands for both runtimes. |
| `latest` | Prints the newest upstream tag. |

Run the copy in the dotai checkout when one exists, the checkout whose `origin` is `udecode/dotai`. Its `assets/` are the source of truth. `apply` and `sync` print the source they render from, and record in `synced.source` the shared commit they rendered. With that record, a refusal shows exactly what the project edited, and a copy older than a project's last sync refuses to overwrite it.

## Choose the mode

| Request | Mode |
| --- | --- |
| Set up pstack in a project, or install pstack here | [Setup](#setup) |
| Sync, bump or update pstack, here or everywhere | [Sync](#sync) |
| Compare setups, or list which projects use pstack or have drifted | [Compare](#compare), read-only |
| A lesson or correction that changes a shared rule | [Lesson](#lesson) |

Change only the projects the request names, or every managed project when it asks for all of them. The repository sets in `~/.agents/config.json` name candidates, not authorization.

## Setup

1. **Discover.** Run `discover <project>`, then read `AGENTS.md` and the workflow rules it routes through, in full. Nothing is written yet.
2. **Interview.** This is the first step the user sees. Follow [the interview](references/interview.md): prepare from evidence, always ask about delivery, recommend the reference answers unless the project's evidence argues otherwise, and never re-ask a settled answer.
3. **Record** the answers in `.agents/pstack.json`, with `tag` from `latest`.
4. **Adapt** the project per [adapt](references/adapt.md). Remove vendored pstack copies, settle orphaned skills and rule forks, install upstream autoreview when the review section is kept, keep the formatter off the synced files, rewrite project rules that duplicate or contradict the block, repoint references to removed skills, write the confirmed routing table, create the proof skill when there is none, and regenerate skills from rules.
5. **Apply.** Run `apply <project> --dry-run`, read the diff, then run `apply <project>`.
6. **Verify.**
   - `discover` reports no vendored copies, and `status <project>` shows the user pins at the tag. Otherwise run `user-pin` and its commands.
   - Smoke-test both runtimes from the project root with a fake task that names a real feature: `env -u CLAUDECODE claude -p --permission-mode plan "<task>"` and `command codex exec --sandbox read-only "<task>"`. `env -u CLAUDECODE` lets the run start inside another Claude Code session, and `command` skips a shell alias that adds flags. The runs fire the project's hooks, so a Stop hook that stages files stages the setup's changes too. Use "Fake task, do not edit anything: fix a bug where <feature> resets after <action>. Which pstack skill and playbook do you use, which model do subagents run on, do you create a worktree, and how does the finished work land? Four lines." Expect poteto-mode's Bug fix playbook, Opus in Claude Code or the session model in Codex, no worktree, and the delivery answer.
   - Run the project's `lintFix` over the changed code files, then run `verify <project>` last, so a cut typed command, a dead link, a retired name, a coupled public skill or a formatter rewrite of a synced file shows up now. Fix every problem it lists before delivering.
7. **Deliver** by the project's delivery answer. When it commits, the commit body says which runtimes and people gain or lose what; in `user` mode the reply says it, for the owner's commit. Close with the answers, the settled defaults applied, the skills removed and kept, and the verification output.

## Sync

1. Run `status` to see the managed projects, their pins, drift and last source, and the latest tag.
2. When a newer tag exists, read pstack-claude's `CHANGES.md` at the new tag (`gh api 'repos/michael-denyer/pstack-claude/contents/CHANGES.md?ref=<tag>' -H 'Accept: application/vnd.github.raw'`) from the pinned tag up. Check each change against the block: a playbook step, skill, principle or hook that an override names. Fix the template first through [Lesson](#lesson) when a change makes an override stale or redundant.
3. Run `sync --tag <tag> --dry-run` with the projects in scope, then without `--dry-run`. Omit the project list only when the request covers every managed project. Offer Setup for each unmanaged project it lists.
4. Resolve each refusal.
   - **Edited block or helper.** The refusal shows the project's edit. Move a generic edit into the template through Lesson and a project-only edit outside the block. Nothing is lost then, so rerun with `--force`. Without moving it, use `--force` only when the owner says the edit can go.
   - **Off branch or uncommitted edits.** Switch to the project's branch, or wait for the owner's commit. Use `--allow-dirty` only when the uncommitted edits are this run's own.
   - **Older source.** Update the dotai checkout and rerun from it.
   - **Error.** A config the template cannot render. Fix the config, then rerun that project.
5. Run `user-pin --tag <tag>`, then the printed commands from the home directory. Codex asks to trust the pstack hook again when its file changed.
6. Verify each synced project with `verify`, and smoke-test one project per delivery mode in use.
7. Deliver each project on its branch by its own delivery answer, committing only the files the sync wrote. A `push` project commits and pushes the sync, a `user` project leaves the change for its owner, and a `pr` project opens a PR.

## Compare

Run `status`. For each unmanaged project that uses pstack, read its instructions and map every override to the block as covered, a project adaptation, an explicit policy difference, drift, or unresolved. Report each difference with both behaviors, their source paths and the smallest reconciliation. Suggest setup or sync, and apply nothing without a request.

## Lesson

A lesson from `/pstack:reflect`, or a correction in one project, changes the shared layer only when it holds for every project. A lesson for one project goes outside that project's block.

1. Edit `assets/block.md` or a helper in the dotai checkout. Keep project names, paths and commands out. A value that differs per project becomes a config field and a placeholder. Prefer an optional field used inside `<!-- if key -->`, because a new required field fails the render for every config that lacks it until the interview adds it.
2. Preview with `apply <project> --dry-run` on each managed project.
3. In dotai, run `node --test skills/sync-pstack/scripts/sync-pstack.test.mjs`, `scripts/validate-skills` and `node scripts/build-workflow.mjs`, then commit and push by dotai's rules.
4. Sync the projects the request covers.

## Template grammar

`assets/block.md` is Markdown with line directives.

- `<!-- if key -->`, `<!-- if !key -->`, `<!-- if key=a|b -->` and `<!-- if key!=a -->` open a region that renders when the condition holds on the project config.
- `<!-- section id -->` opens a region that is dropped when the config lists `id` under `skip`.
- `<!-- end -->` closes the innermost region. Regions nest.
- `{{key}}` inserts a config value. A rendered line whose value is missing fails the render, and so does a `skip` entry that names no section.
- A line starting with `<!-- #` is a template note and never renders.
- An indented line continues the list item above it, so a conditional sentence can join a rule.

## Boundaries

- Never edit pstack's own files. Change its behavior through the block or a project rule.
- Never overwrite a refused block or helper without the owner's word, unless its edit has moved to the template or outside the block.
- Setup and sync deliver only by the project's delivery answer. They never push a protected branch, force-push or open a PR that answer does not call for.
- The interview's settled answers belong to the owner. Ask again only when a project's evidence contradicts one.
- Setup and sync never trim, merge or rewrite a domain skill's method. Trimming is its own measured pass: measure the overlap between files before cutting, and keep any rule that has no other owner.

## Resources

- [Interview](references/interview.md): the questions, their evidence and recommendations, and the config fields.
- [Adapt](references/adapt.md): vendored copies, orphaned skills, rule forks, autoreview, formatters, and rewriting project rules around the block.
- [`assets/block.md`](assets/block.md): the shared block.
- `assets/pstack/`: the plan and decision-log helpers the Plans rule runs.
- `scripts/sync-pstack.mjs`, with its tests in `scripts/sync-pstack.test.mjs`.
