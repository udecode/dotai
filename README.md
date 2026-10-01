# dotai

Shared skills that the pstack plugin does not cover: long-running goals, cross-model review (a second model's review of a plan, its execution or a PR, and prompts for an external model), visual communication, and pstack setup and sync. Independent code review comes from openclaw's `autoreview` (`openclaw/agent-skills`), installed per project.

The engineering method comes from the pstack plugin, `pstack@pstack-claude` from `michael-denyer/pstack-claude`, pinned per project: poteto-mode, its playbooks, the principle skills, how, why, architect, arena, interrogate, swarm, reflect, show-me-your-work, tdd, deslop and the rest. dotai does not vendor them.

Read [SKILLS.md](SKILLS.md) for the generated inventory, capability limits and pinned install commands for the unchanged upstream skills listed in `upstream-skills.json`. Their source is not copied here.

## Ownership

- `skills/` owns reusable methods. Keep product names, private paths, credentials, release environments and infrastructure assumptions out of shared instructions.
- `sync-pstack` sets pstack up in a project through an interview and keeps every pstack project on one plugin tag and one shared overrides block. Its `assets/block.md` is the shared override source; project-only rules stay in each project.
- Each project's instructions own its commands, source and verification owners, and publication policy.
- Native tools, browser access, provider connections, paid models and host-provided skills are separate capabilities. Installing a method does not supply them.

## Install

Install a skill with the Skills CLI, naming the skill and each agent, for example `npx skills add udecode/dotai --skill autogoal --agent codex claude-code`. Project scope is the default; use `--global` only for a user-wide install.

## Validate

```sh
scripts/validate-skills
node scripts/build-workflow.mjs
node scripts/build-workflow.mjs --check
```

`build-workflow.mjs` regenerates `SKILLS.md` and `workflow-manifest.json`, rejects duplicate ownership, resolves dependencies and local Markdown references, and records file checksums and modes. `--forbid '<pattern>'` optionally scans shipped content for project or private vocabulary.
