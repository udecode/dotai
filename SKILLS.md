# dotai skills

6 skills: 6 maintained in dotai, plus 0 unchanged upstream skills installed with named npx skills add commands. The engineering method (poteto-mode, its playbooks, the principle skills and pstack's review skills) comes from the pstack plugin, not from dotai. Methods load only when relevant; tool access is separate from installation.

## Review (1)

| Skill | Purpose |
| --- | --- |
| [test-audit](skills/test-audit/SKILL.md) | Audit existing tests for low-value, duplicated or implementation-coupled cases and the test-only code they keep alive, then remove or rewrite them on evidence. Use for test-audit, /test-audit <scope>, a test sweep, or pruning tests. Not for writing a new test; the project's Tests rule gates that. |

## Communication (3)

| Skill | Purpose |
| --- | --- |
| [walkthrough](skills/walkthrough/SKILL.md) | Present final screenshots or rendered artifacts as an annotated walkthrough when visual evidence is requested. |
| [video-transcripts](skills/video-transcripts/SKILL.md) | Transcribe a supplied local or linked video with Gemini Files API when its contents are needed as evidence. |
| [plan-page](skills/plan-page/SKILL.md) | Write, check, repair and publish a plan page: a project's plans and subject files under its plans directory, rendered by .agents/pstack/plan-page.mjs and rendered as one local HTML page per subject with a local index of every subject, and published to claude.ai at each hand-back for comments and feedback. The page is how work hands back to the user. Use before writing or changing a plan, a subject file in <plans>/topics or its page; at every stop that hands work back, such as a review verdict other than a review-only panel's, a next answer or a playbook's close; when a plan page or its claude.ai artifact looks wrong or refuses to render; to republish a page; or to change the page shape or a playbook's page sections. |

## Maintenance (1)

| Skill | Purpose |
| --- | --- |
| [sync-pstack](skills/sync-pstack/SKILL.md) | Set up the pstack plugin in a project through an interview, and keep every pstack project on one pinned tag and one shared AGENTS.md overrides block. Use to set up or install pstack in a repo, sync, bump or update pstack everywhere, list which projects use pstack or have drifted, compare setups, audit a project's skills for drift from pstack (which to cut, fold or keep), change which work runs a panel, architect or an arena without asking (\"from now on X runs architect\"), or move a workflow lesson, including a plan page shape change, into every project. Not for choosing pstack's per-role models, which setup-pstack owns. |

## Monitoring (1)

| Skill | Purpose |
| --- | --- |
| [pstack-pulse](skills/pstack-pulse/SKILL.md) | Show every Claude Code and Codex session on the iPhone lock screen through ActivitySmith, with each plan page's pipeline, and buzz when a session needs you, ships or fails. |

## Unchanged upstream installation

For a project-local install, run these from the project directory and name each agent; use `--global` only for an explicitly requested user-wide install. Skip a skill whose pinned contents already match.

```sh
```

Project rules govern testing, native tools and publication; do not fork an unchanged method just to add a routing sentence.

## Capability requirements

These skills remain installed when a tool is absent; an unavailable live action or independent review is reported, never marked as passed.

- **plan-page:** Node.js 22+ and Git; the renderer that sync-pstack installs in .agents/pstack; the Artifact tool to publish.
- **pstack-pulse:** macOS with launchd and the Keychain, Node.js 22+ and sqlite3; an ActivitySmith account and key; Tailscale Funnel for the session list.
- **sync-pstack:** Node.js 22+ and Git; the Claude Code and Codex CLIs for plugin pins and smoke tests.
- **video-transcripts:** ffmpeg, curl, jq and authorized Gemini credentials.
- **walkthrough:** Real final-state captures, Node.js and the configured annotation tool.

## Deliberate boundaries

dotai holds shared methods that pstack does not cover. It excludes product-specific schemas, routes, fixtures, provider adapters, release environments and personal configuration; those belong to each project. Framework packages (React, Next.js, Prisma, tRPC and the like) are stack-specific: install named official packages with the Skills CLI after source review. The skills contain no accounts, credentials, personal histories or connector configuration.
