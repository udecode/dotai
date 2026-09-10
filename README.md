# dotai

The complete generic workflow for coding agents: task completion, product planning, implementation, verification, review, communication and skill maintenance.

Start with [SETUP.md](SETUP.md). Share its GitHub link or the complete zip/folder and use its one-prompt setup. The setup installs 49 maintained/adapted skills from dotai and 29 unchanged skills directly from their pinned upstream sources using `npx skills add`. It preserves existing instructions and verifies every installed skill. Node.js 18+, npm/npx, Git and network access are required for the complete setup.

Read [SKILLS.md](SKILLS.md) for the complete generated inventory, dependencies and capability limits. Skills are discovered individually and loaded when relevant; the whole collection is not one giant prompt.

## Ownership

- `skills/` owns reusable methods. Keep product names, private paths, credentials, release environments and infrastructure assumptions out of shared instructions.
- `setup-workflow` owns installation and first-run project adaptation. `task` owns engineering execution. `maintain-workflow` maintains reusable methods; `sync-skills` reconciles project adaptations.
- Project instructions and `.agents/workflow.md` own project commands, source/fixture/verification owners and publication policy. Shared plan templates seed missing files only.
- Native tools, browser access, provider connections, paid models and host-provided skills are separate capabilities. Installing a method does not supply them.

The 19 adapted pstack methods retain Lauren Tan's MIT-licensed source, complete references/playbooks, licenses and exact adaptation records at commit `93b00b89ef425a9c1bac0d0b317dfc49c930ac99`. Read their Codex runtime adapter for platform mapping. The 21 unmodified pstack methods and eight other unchanged upstream skills are declared in `upstream-skills.json`; their source is not copied into dotai. Runtime policy belongs in the shared adapter and routing instructions, not a duplicate wrapper skill.

## Installation and updates

Use Setup Workflow for the complete bundle. It supports project or user scope and explicit Codex or Claude Code destinations. Preview first, apply under the setup request, then verify. It stops on local conflicts instead of overwriting them. It never changes model/security settings, copies credentials or publishes work. The agent runs the printed named `npx skills add` commands for missing upstream skills, then verifies the complete manifest.

For a selected skill in an existing Skills CLI-managed setup, use the CLI's named source/skill/agent installation path and include its required skill dependencies. Do not mix that installer with files owned by a dotai bundle record. Global scope and other projects require their own authorization.

When starting from a GitHub setup link, download the complete repository at that link's revision. The setup page alone does not contain the installer or skills.

## Validate and package

```sh
scripts/validate-skills
python3 scripts/check-pstack-preservation.py
node scripts/build-workflow.mjs
node scripts/build-workflow.mjs --check
python3 scripts/package-workflow.py --output /absolute/path/to/dotai-workflow.zip
```

`build-workflow.mjs` accounts for bundled and remote skills, rejects duplicate ownership, resolves dependencies and records file checksums/modes. `--forbid '<pattern>'` optionally scans all shipped content for project/private vocabulary before packaging. The archive uses an explicit manifest allowlist: it never includes the surrounding checkout, Git history, local plans, private configuration or temporary files.

For installer changes, exercise a clean temporary install, repeat run, local-edit conflict, instruction preservation, update and read-back. Static skill validation alone cannot prove these behaviors. Preserve upstream methods and use existing validators; do not add application suites for instruction changes.
