# dotai skills

5 skills: 5 maintained in dotai, plus 0 unchanged upstream skills installed with named npx skills add commands. The engineering method (poteto-mode, its playbooks, the principle skills and pstack's review skills) comes from the pstack plugin, not from dotai. Methods load only when relevant; tool access is separate from installation.

## Review (2)

| Skill | Purpose |
| --- | --- |
| [cross-review](skills/cross-review/SKILL.md) | Review another agent session's plan or finished work, or a contributor's PR, with a /pstack:interrogate panel briefed from that session's own asks. Fixes a plan still in planning in place; reviews verdicts, executions and PRs read-only. Use for cross-review, $cross-review <plan>, /cross-review, a cross-model review hand-off, or a second opinion on a PR. |
| [test-audit](skills/test-audit/SKILL.md) | Audit existing tests for low-value, duplicated or implementation-coupled cases and the test-only code they keep alive, then remove or rewrite them on evidence. Use for test-audit, /test-audit <scope>, a test sweep, or pruning tests. Not for writing a new test; the project's Tests rule gates that. |

## Communication (2)

| Skill | Purpose |
| --- | --- |
| [walkthrough](skills/walkthrough/SKILL.md) | Present final screenshots or rendered artifacts as an annotated walkthrough when visual evidence is requested. |
| [video-transcripts](skills/video-transcripts/SKILL.md) | Transcribe a supplied local or linked video with Gemini Files API when its contents are needed as evidence. |

## Maintenance (1)

| Skill | Purpose |
| --- | --- |
| [sync-pstack](skills/sync-pstack/SKILL.md) | Set up the pstack plugin in a project through an interview, and keep every pstack project on one pinned tag and one shared AGENTS.md overrides block. Use to set up or install pstack in a repo, sync, bump or update pstack everywhere, list which projects use pstack or have drifted, compare setups, audit a project's skills for drift from pstack (which to cut, fold or keep), move a workflow lesson into every project, or change the plan page shape. Not for choosing pstack's per-role models, which setup-pstack owns. |

## Unchanged upstream installation

For a project-local install, run these from the project directory and name each agent; use `--global` only for an explicitly requested user-wide install. Skip a skill whose pinned contents already match.

```sh
```

Project rules govern testing, native tools and publication; do not fork an unchanged method just to add a routing sentence.

## Capability requirements

These skills remain installed when a tool is absent; an unavailable live action or independent review is reported, never marked as passed.

- **cross-review:** Node.js 18+ and Git; gh with network for a PR, otherwise a locally fetched PR ref.
- **sync-pstack:** Node.js 22+ and Git; the Claude Code and Codex CLIs for plugin pins and smoke tests.
- **video-transcripts:** ffmpeg, curl, jq and authorized Gemini credentials.
- **walkthrough:** Real final-state captures, Node.js and the configured annotation tool.

## Deliberate boundaries

dotai holds shared methods that pstack does not cover. It excludes product-specific schemas, routes, fixtures, provider adapters, release environments and personal configuration; those belong to each project. Framework packages (React, Next.js, Prisma, tRPC and the like) are stack-specific: install named official packages with the Skills CLI after source review. The skills contain no accounts, credentials, personal histories or connector configuration.
