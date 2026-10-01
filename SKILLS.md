# dotai skills

9 skills: 6 maintained in dotai, plus 3 unchanged upstream skills installed with named npx skills add commands. The engineering method (poteto-mode, its playbooks, the principle skills and pstack's review skills) comes from the pstack plugin, not from dotai. Methods load only when relevant; tool access is separate from installation.

## Execution (1)

| Skill | Purpose |
| --- | --- |
| [autogoal](skills/autogoal/SKILL.md) | Manage native Codex goals under a direct or standing user request, with durable acceptance and completion evidence. |

## Review and design (3)

| Skill | Purpose |
| --- | --- |
| [gpt-pro](skills/gpt-pro/SKILL.md) | Prepare a self-contained, paste-ready prompt for GPT Pro, ChatGPT Pro or another external reviewer with no repository access: exact context, evidence, candidate directions and pointed questions that force a decision. Use for gpt-pro, an external or harsh review prompt, or asking another model. |
| [cross-review](skills/cross-review/SKILL.md) | Review another agent session's plan or finished work, or a contributor's PR, for gaps, missing cases, unproven claims and contradictions, read-only. Use for cross-review, $cross-review <plan>, /cross-review, a cross-model review hand-off, or a second opinion on a PR. |
| [prototype](https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/prototype/SKILL.md) | Build a throwaway prototype to answer a design question. Use when the user wants to sanity-check whether a state model or logic feels right, or explore what a UI should look like. |

## Communication (3)

| Skill | Purpose |
| --- | --- |
| [show-me](https://github.com/humanlayer/skills/blob/3c2629142c5d437428269b1b722b08c0b87f574d/plugins/show-me/skills/show-me/SKILL.md) | Help the user understand the current topic visually with concise diagrams, code-shape sketches, and focused HTML artifacts. |
| [walkthrough](skills/walkthrough/SKILL.md) | Present final screenshots or rendered artifacts as an annotated walkthrough when visual evidence is requested. |
| [video-transcripts](skills/video-transcripts/SKILL.md) | Transcribe a supplied local or linked video with Gemini Files API when its contents are needed as evidence. |

## Maintenance (2)

| Skill | Purpose |
| --- | --- |
| [sync-pstack](skills/sync-pstack/SKILL.md) | Set up the pstack plugin in a project through an interview, and keep every pstack project on one pinned tag and one shared AGENTS.md overrides block. Use to set up or install pstack in a repo, sync, bump or update pstack everywhere, list which projects use pstack or have drifted, compare setups, or move a workflow lesson into every project. Not for choosing pstack's per-role models, which setup-pstack owns. |
| [find-skills](https://github.com/vercel-labs/skills/blob/80feb48868972d518436f26711509bc78595b5cb/skills/find-skills/SKILL.md) | Helps users discover and install agent skills when they ask questions like "how do I do X", "find a skill for X", "is there a skill that can...", or express interest in extending capabilities. This skill should be used when the user is looking for functionality that might exist as an installable skill. |

## Unchanged upstream installation

For a project-local install, run these from the project directory and name each agent; use `--global` only for an explicitly requested user-wide install. Skip a skill whose pinned contents already match.

```sh
npx --yes skills@1.5.25 add https://github.com/vercel-labs/skills/tree/80feb48868972d518436f26711509bc78595b5cb --skill find-skills --agent codex -y
npx --yes skills@1.5.25 add https://github.com/mattpocock/skills/tree/3cca18b368ae95cdbdebbff572ccafa662551015 --skill prototype --agent codex -y
npx --yes skills@1.5.25 add https://github.com/humanlayer/skills/tree/3c2629142c5d437428269b1b722b08c0b87f574d --skill show-me --agent codex -y
```

Project rules govern testing, native tools and publication; do not fork an unchanged method just to add a routing sentence.

## Capability requirements

These skills remain installed when a tool is absent; an unavailable live action or independent review is reported, never marked as passed.

- **autogoal:** Native goal tools for native goals; otherwise a file plan.
- **cross-review:** Node.js 18+ and Git; gh with network for a PR, otherwise a locally fetched PR ref.
- **sync-pstack:** Node.js 18+ and Git; the Claude Code and Codex CLIs for plugin pins and smoke tests.
- **video-transcripts:** ffmpeg, curl, jq and authorized Gemini credentials.
- **walkthrough:** Real final-state captures, Node.js and the configured annotation tool.

## Deliberate boundaries

dotai holds shared methods that pstack does not cover. It excludes product-specific schemas, routes, fixtures, provider adapters, release environments and personal configuration; those belong to each project. Framework packages (React, Next.js, Prisma, tRPC and the like) are stack-specific: use Find Skills and install named official packages after source review. The skills contain no accounts, credentials, personal histories or connector configuration.
