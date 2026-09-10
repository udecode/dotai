---
name: setup-workflow
description: Install the complete generic dotai workflow for an explicit agent and project or user scope, preserve existing instructions, adapt project commands and verify discovery.
metadata:
  source: udecode/dotai
  source-path: skills/setup-workflow
---

# Setup Workflow

Set up the complete distribution, not a starter subset. Read the [runtime adapter](references/runtime.md). The package manifest includes 49 bundled and 29 remote skills and is the complete install denominator; optional external tools are capability requirements, not silently omitted skills.

## Resolve the destination

Use the agent and scope named by the request. In Codex, a request to set up this project selects project-local Codex. A request to install for all projects selects global Codex; do not add another agent merely because its application is installed. If the user explicitly names another supported agent, use its destination. Missing scope that materially changes where files are written needs a concise question.

Locate the complete unpacked bundle or shared dotai checkout containing `workflow-manifest.json`, `SETUP.md` and `scripts/setup-workflow.mjs`. Use the user's supplied archive first. Do not fetch an older public revision over unpublished local source. If this skill was installed alone, retrieve the complete bundle from its recorded source; do not mistake the single skill for the complete setup.

Read the destination's actual global/project instructions, generated-source ownership and installation records. Resolve an active `AGENTS.override.md` and custom `CODEX_HOME` before selecting the instructions file. Do not hand-edit a generated mirror. Supply the actual owned instruction path with `--instructions` when needed, regenerate through its owner and verify the effective result.

## Install and verify

Use Node.js 18 or newer, npm/npx, Git and network access. The local helper defaults to dry-run and prints the exact upstream installation commands:

```sh
node <bundle>/scripts/setup-workflow.mjs --target <absolute-project-path> --scope project --agent codex
node <bundle>/scripts/setup-workflow.mjs --target <absolute-project-path> --scope project --agent codex --apply
node <bundle>/scripts/setup-workflow.mjs --target <absolute-project-path> --scope project --agent codex --verify
```

For user scope, use `--scope global --target <home-directory>`. For Claude Code, use `--agent claude-code`; agent selection is explicit and one destination is handled per invocation. Do not install both global and project copies for the same agent unless requested.

Inspect the preview's target, skill count, instructions file, changes and conflicts, then apply under the existing setup authorization. There is no second approval ceremony. Conflicts block the whole apply before writes: reconcile their actual source through `sync-skills`, preserve user edits, then retry. Never erase a collision or edit the integrity record to force success.

The helper copies only dotai-maintained or substantively adapted skills, adds one bounded routing block while preserving surrounding instructions, seeds a missing project adapter, records file hashes and reads the result back. After applying the local phase, run each printed `npx skills add` command for missing upstream skills from the selected destination. Commands pin the source revision and name the exact skill/agent; global flags appear only for global scope. Compatible already-installed upstream skills are reused. Do not vendor unchanged source or create a local wrapper just to route it. The root runtime adapter supplies that policy.

Then rerun `--verify`: it checks all 78 skills, including upstream file hashes, and fails while any remote dependency is missing. A successful local phase alone is not a complete setup. Remote CLI failures can leave a partial remote install; report it and retry only missing skills after inspecting the actual state. Repeat runs must make no changes. Setup does not change model settings, permissions, credentials, trackers or project dependencies.

## Adapt the project

Within an explicitly selected project, finish the user-owned `.agents/workflow.md` adapter. Inspect the real package manifest/lockfile, build and check commands, app entrypoints, existing proof skill/catalog, source/generator ownership, plan locations and delivery policy. Record observed commands and unknowns. Do not run a development server, database setup or every test merely to discover commands.

Global setup includes discovery of an existing project adapter; if the request also names a project, create/adapt that project file without installing duplicate skills. Read its instructions before mutation. Respect existing content and name unresolved decisions instead of filling in another product's defaults.

Use the current runtime's skill inventory or supported diagnostics to confirm skill discovery and instruction loading. At minimum confirm `task`, `autogoal`, `autoreview`, `verify-app`, `maintain-workflow` and this skill; compare the entire installed manifest count as well. If the current session cannot reload, verify filesystem integrity and report native discovery pending; a new session/restart may be required.

Smoke-check routing: a simple question stays simple; a requested task uses its owner and proof; a read-only audit does not repair; a pause persists and stops; a missing tool remains a capability gap. Do not invoke live provider actions or a paid model merely to test setup.

Report exact installed scope/count, adapted files, verification and tool gaps. Update via the same reviewed bundle/installer; `maintain-workflow` owns method changes and `sync-skills` owns adaptations. No automatic publication, scheduled jobs or other-project refreshes.
