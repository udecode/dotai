---
name: sync-pstack
description: "Set up pstack in a project and keep every managed project on one pinned tag and shared AGENTS.md overrides block. Use to install, sync, bump, compare, or audit pstack setups, change project review rules, or propagate a shared workflow lesson."
metadata:
  source: udecode/dotai
  source-path: skills/sync-pstack
---

# Sync pstack

Sets up `pstack@pstack-claude` in a project and keeps managed projects aligned with one pinned upstream tag and one shared overrides block. Project-only rules stay outside the block and never sync.

## Layers

| Layer | Lives in | Changed by |
| --- | --- | --- |
| Upstream | `pstack@pstack-claude` pinned tag in `.claude/settings.json`, `~/.claude/settings.json`, Codex marketplace, and `~/.gemini/config/plugins/pstack` | `sync --tag` and `user-pin`. Never edit upstream pstack. |
| Shared | [`assets/block.md`](assets/block.md) (between `pstack:begin`/`pstack:end` in `AGENTS.md`), `assets/pstack/*.mjs` -> `.agents/pstack/`, and `assets/pstack/rules/*.md` -> `.agents/pstack/rules/` | Edit in `udecode/dotai`, then sync |
| Project | `.agents/pstack.json`, `.agents/playbooks/*.md`, and project rules outside the block (which win over the block) | Project edits or setup |

## Commands

Run `node <skill>/scripts/sync-pstack.mjs <command>` from the `udecode/dotai` checkout when present (`assets/` is the source of truth):

| Command | Effect |
| --- | --- |
| `discover <project>` | JSON facts for setup interview. Read-only. |
| `status [project...]` | Latest upstream tag, user pins, and per-project pin/drift/source revision. Skips linked worktrees and `autoSync: false` projects unless named. Read-only. |
| `apply <project>` | Renders block, rules, helpers, and project pin from `.agents/pstack.json`. Supports `--tag <tag>`, `--dispositions <tsv>`, `--dry-run`, `--force`. Refuses main checkout of a `trunk` project with `pstack.delivery` set. |
| `check <project>` | Exits 1 if `apply` would change anything. Read-only. |
| `verify <project>` | Checks typed-command resolution (against `dropped`), dead skill links, retired skill mentions, block/rule anchor notes, and `check`. Read-only. |
| `sync --tag <tag> [project...]` | Runs `apply --tag` across managed (non-held) projects; refuses off-branch or dirty targets unless `--allow-dirty`. |
| `playbook <project> <name>` | Prints resolved steps for `.agents/playbooks/<name>.md` applied onto its base pstack playbook(s). Read-only. |
| `smoke <project> <prompt>...` | Runs read-only routing smoke (`--runtime claude|codex|both`). |
| `corpus [project...]` | Diffs installed vs local `decisions-check.mjs` across project ledgers and decision logs (`--session <id>`, `--installed <dir>`, `--out <dir>`). Read-only. |
| `user-pin --tag <tag>` | Updates user-scope pstack pin and prints refresh commands. |
| `latest` | Prints newest upstream tag. |

Also: `node <skill>/scripts/audit.mjs <project> [--json] [--min <score>]` reports skill drift, overlap, and size-budget bloat for [Audit](#audit). Anchor checks use `~/.cache/sync-pstack/` (override with `SYNC_PSTACK_UPSTREAM`).

## Modes

| Request | Mode |
| --- | --- |
| Set up or install pstack in a repo | [Setup](#setup) |
| Sync, bump, or update pstack | [Sync](#sync) |
| Compare setups or list drifted projects | [Compare](#compare) (read-only) |
| Audit skills for drift from pstack | [Audit](#audit) (read-only until owner picks) |
| Change which work auto-runs `architect`, panel, or arena | [Reviews](#reviews) |
| Propagate a shared workflow lesson or fix | [Lesson](#lesson) |
| Add or edit a project playbook | [Project playbooks](#project-playbooks) |

A shared-source change syncs only the active project (none when working directly in `dotai`) unless the owner names other projects.

## Setup

1. **Discover:** Run `discover <project>` and read `AGENTS.md` and routed workflow rules in full.
2. **Interview:** Follow [interview.md](references/interview.md); always confirm delivery mode, recommend defaults unless evidence argues otherwise, never re-ask settled answers.
3. **Record:** Write `.agents/pstack.json` with `tag` from `latest`.
4. **Adapt:** Follow [adapt.md](references/adapt.md): delete vendored pstack copies, settle overlapping skills/rules, keep formatters off synced files, wire routing and proof skill, regenerate skills if configured.
5. **Apply:** Run `apply <project> --dry-run`, inspect diff, then `apply <project>`.
6. **Verify:** Confirm `status <project>` user pins match (else run `user-pin`), models sheets exist (`.claude/pstack-models.md`, `~/.codex/pstack-models.md`, `~/.gemini/config/pstack-models.md`), run one routing smoke on a plain prompt (without naming the playbook or trigger words), run `lintFix`, and run `verify <project>`.
7. **Deliver:** Follow the project's delivery mode. For `trunk`, set `git config pstack.delivery push` locally only if direct-push was approved.

## Sync

1. Run `status`; pin only a tag printed by `latest`.
2. When bumping tags, read upstream `CHANGES.md` from `~/.cache/sync-pstack/` (`git -C <clone> show <tag>:CHANGES.md`). Judge each new/changed upstream skill or step per project: `already wired`, `wire it in`, `manual only`, or `nowhere`. Fold shared block updates through [Lesson](#lesson).
3. Run `sync --tag <tag> --dry-run` on projects in scope. Write a tab-separated dispositions file (`item`, `none|covered|noted|rewritten|dropped`, `reason`) for every printed diff hunk and count line, then run `sync --tag <tag> --dispositions <tsv>`.
4. Resolve refusals cleanly: move generic edits to `dotai` (Lesson) and project edits outside the block before `--force`; commit/push dirty `dotai` edits before syncing; rewrite broken upstream anchors.
5. Run `user-pin --tag <tag>` and its refresh commands before smoking.
6. Run `verify <project>` and smoke any changed playbook, gate, or rewritten/dropped disposition. Run [Audit](#audit) if upstream added/changed skills.
7. Deliver per project delivery mode (`trunk` in a worktree via `land.mjs`; `push` commits and pushes; `pr` pushes directly to `<branch>` with `[skip ci]` if workflow filters allow; `user` leaves for owner).

## Compare

Run `status`. For each unmanaged pstack project, map every override against the shared block (`covered`, `project adaptation`, `policy difference`, `drift`, `unresolved`), citing source paths and smallest reconciliation. Apply nothing without a request.

## Audit

1. Run `node <skill>/scripts/audit.mjs <project>` (usage counts, size-budget bloat, unmarked block rules, overlapping sentences).
2. Judge with [audit-brief.md](references/audit-brief.md): `cut`, `fold`, or `keep`, naming a working replacement for every cut.
3. Present options via `AskUserQuestion` with usage evidence and exact gate/rule impact.
4. Execute approved cuts with a disposition table (old rule -> new home or drop), add removed typed commands to `dropped`, update project workflow guides, and remove uninstalled skills via `npx --yes skills remove`.

## Reviews

`.agents/pstack.json`'s `reviews` array holds `{ "id": "<kebab-case>", "rule": "<one sentence>" }` entries naming work that auto-runs `architect`, `interrogate`, or `arena`.

1. Inspect upstream playbook calls at the project's pin; add/update/delete rows per project.
2. Cite `(reviews: <id>)` on matching project playbook lines and drop uncited tool calls.
3. Run `apply`, `verify`, and smoke one covered and one uncovered plain request.

## Lesson

Use when a lesson or fix applies to every managed project (project-only lessons go outside the project's block).

1. Fetch/fast-forward `udecode/dotai` on `main` and edit in place (never create branches or worktrees in `dotai`).
2. Edit `assets/block.md`, `assets/pstack/rules/*.md`, or `assets/pstack/*.mjs`:
   - Subtract before adding: remove dead rules, redundant validators, and overlapping prose first.
   - Guard system boundaries only (CLI args, config, git pushes, PR creation, external APIs), never internal agent notes.
   - When encoding a rule structurally (check, lint, type, hook), delete the prose rule it replaces.
   - Respect hard size budgets enforced by `scripts/validate-skills` (`block-budget.mjs` + `budget-check.mjs`).
   - Keep project-specific names/paths out (use `<!-- if key -->` and optional config fields).
3. Run `apply <project> --dry-run` (and `corpus` for ledger helper changes) on projects in scope.
4. Run writing passes (`deslop`/`no-comments` on helpers, `unslop` on prose), `node scripts/build-workflow.mjs`, and `scripts/validate-skills`.
5. Commit and push `dotai` (committing any other session's remaining edits in a second commit per `dotai/AGENTS.md`). Never amend or rebase a commit a project already synced from.
6. Sync each project in scope from the pushed commit, run `verify <project>`, reinstall any changed `dotai` skills, and deliver per Sync step 7.

## Project playbooks

Project playbooks live in `.agents/playbooks/<name>.md` with `extends` and `when` frontmatter plus anchored edits (`**Before**`, `**In**`, `**After**`, `**Replace**`). Optional `page-lead`, `page-pairs`, `page-require`, and `page-pr` frontmatter lists configure which review sections `plan-page.mjs --pr` includes. Run `playbook <project> <name>` after edits to inspect resolved steps.

## Template grammar

`assets/block.md` and `assets/pstack/rules/*.md` support line directives:

- `<!-- if key -->`, `<!-- if !key -->`, `<!-- if key=a|b -->`, `<!-- if key!=a -->`
- `<!-- section id -->` (omitted when `skip` includes `id`)
- `<!-- end -->` (closes innermost region; regions nest)
- `{{key}}` (required config value; missing fails render)
- `<!-- # overrides <path> "<text>" -->`, `<!-- # relies <path> "<text>" -->`, `<!-- # adds -->`: anchor notes verified against upstream pstack at the pinned tag; `verify` flags unnoted rules.
- Indented lines continue the list item above them.
