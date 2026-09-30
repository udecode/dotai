# Complete generic workflow

44 skills: 36 maintained or adapted in dotai, plus 8 unchanged upstream skills installed with named npx skills add commands. Upstream sources are not duplicated here. Methods load only when relevant; tool access is separate from installation.

## Execution and coordination (5)

| Skill | Purpose |
| --- | --- |
| [task](skills/task/SKILL.md) | Complete an engineering request through investigation, implementation, proportionate proof and authorized delivery. |
| [autoclosure](skills/autoclosure/SKILL.md) | Take an existing pull request or local candidate from candid assessment through authorized repair, cleanup, proof, and an honest merge-ready handoff. Use when asked to perfect, finish, or fully close a candidate; use review skills for read-only feedback, PR monitoring for status-only work, and shipping for merge-only work. |
| [autogoal](skills/autogoal/SKILL.md) | Manage native Codex goals under a direct or standing user request, with durable acceptance and completion evidence. |
| [improve](skills/improve/SKILL.md) | Audit and repair a project’s evidenced improvement opportunities under one evolving scope and acceptance record. |
| [orchestrator](skills/orchestrator/SKILL.md) | Coordinate explicitly delegated work through durable tasks with exclusive ownership and consumed proof. |

## Architecture, diagnosis and review (9)

| Skill | Purpose |
| --- | --- |
| [architecture-cleanup](skills/architecture-cleanup/SKILL.md) | Simplify code ownership, abstractions and colocation while preserving public behavior and complete caller contracts. |
| [best-api-review](skills/best-api-review/SKILL.md) | Judge whether a proposed API or architecture direction merits pursuit before detailed design or implementation. |
| [autoreview](skills/autoreview/SKILL.md) | Review an explicit code candidate or actual PR closeout with actionable findings and bounded correction rounds. |
| [agent-native-reviewer](skills/agent-native-reviewer/SKILL.md) | Audit changed agent workflows for usable discovery, tool routes, source ownership and reproducible proof. |
| [hard-cut](skills/hard-cut/SKILL.md) | Remove a named feature completely, including callers, exports, tests, docs and compatibility paths. |
| [diagnosing-bugs](https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/diagnosing-bugs/SKILL.md) | Diagnosis loop for hard bugs and performance regressions. Use when the user says "diagnose"/"debug this", or reports something broken/throwing/failing/slow. |
| [ai-slop-cleaner](https://github.com/yeachan-heo/oh-my-claudecode/blob/4820f5641828cb980b7eb488a3c187f3d01459c3/skills/ai-slop-cleaner/SKILL.md) | Clean AI-generated code slop with a regression-safe, deletion-first workflow and optional reviewer-only mode |
| [security-triage](skills/security-triage/SKILL.md) | Triage GHSA, CVE or vulnerability reports against shipped behavior before closing or fixing them. |
| [oracle](skills/oracle/SKILL.md) | Run an explicitly requested second-model review through Oracle CLI with a scoped file bundle and resumable session. |

## Product, planning and design (8)

| Skill | Purpose |
| --- | --- |
| [grill-with-vision](skills/grill-with-vision/SKILL.md) | Resolve unsettled product, domain or source decisions against current user intent and product vision. |
| [to-prd](skills/to-prd/SKILL.md) | Turn settled product scope into a buildable PRD with acceptance, dependencies and proof boundaries. |
| [to-milestone](skills/to-milestone/SKILL.md) | Build or maintain an evidence-backed milestone map and ordered PRD ladder for a product outcome. |
| [to-issues](skills/to-issues/SKILL.md) | Turn settled scope into the fewest complete delivery issues; publish only within tracker authority. |
| [design](skills/design/SKILL.md) | Create or improve UI composition, interactions and design standards using the product’s component system. |
| [prototype](https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/prototype/SKILL.md) | Build a throwaway prototype to answer a design question. Use when the user wants to sanity-check whether a state model or logic feels right, or explore what a UI should look like. |
| [avoid-feature-creep](skills/avoid-feature-creep/SKILL.md) | Evaluate proposed scope additions against the requested outcome without shrinking authorized work. |
| [sync-vision](skills/sync-vision/SKILL.md) | Update VISION.md when attributable evidence changes product doctrine, taste or maintainer judgment. |

## Verification and delivery (5)

| Skill | Purpose |
| --- | --- |
| [verify-app](skills/verify-app/SKILL.md) | Prove requested runtime operations, journeys or review scenes against the actual candidate and environment. |
| [atlas](skills/atlas/SKILL.md) | Maintain an existing application review catalog when routes, states, fixtures or access requirements change. |
| [resolve-pr-feedback](skills/resolve-pr-feedback/SKILL.md) | Resolve GitHub PR review feedback through source-backed triage, fixes, focused proof and authorized replies. |
| [resolving-merge-conflicts](https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/resolving-merge-conflicts/SKILL.md) | Use when you need to resolve an in-progress git merge/rebase conflict. |
| [linear-backlog](skills/linear-backlog/SKILL.md) | Execute an explicitly scoped Linear backlog in dependency-ready batches with durable coordination and per-issue proof. |

## Understanding and communication (5)

| Skill | Purpose |
| --- | --- |
| [restate](skills/restate/SKILL.md) | Restate the user's goals and underlying problem in your own words. Use when the user asks what you think they are trying to achieve or solve, asks you to confirm or reframe your understanding of their request, or explicitly invokes $restate. |
| [agent-session-resume](https://github.com/hacktivist123/agent-session-resume/blob/76b025634ddc99b3ee3428fb4464af1c467da291/skills/agent-session-resume/SKILL.md) | Use when continuing, resuming, locating, reading, inspecting, auditing, or reviewing a previous AI coding-agent session, handoff transcript, chat log, exported conversation, saved artifact set, or session summary, on any platform (Claude Code, Codex, Cursor, Antigravity, OpenCode) or across several platforms in one ask, such as reviewing threads across Claude and Codex. |
| [show-me](https://github.com/humanlayer/skills/blob/3c2629142c5d437428269b1b722b08c0b87f574d/plugins/show-me/skills/show-me/SKILL.md) | Help the user understand the current topic visually with concise diagrams, code-shape sketches, and focused HTML artifacts. |
| [walkthrough](skills/walkthrough/SKILL.md) | Present final screenshots or rendered artifacts as an annotated walkthrough when visual evidence is requested. |
| [video-transcripts](skills/video-transcripts/SKILL.md) | Transcribe a supplied local or linked video with Gemini Files API when its contents are needed as evidence. |

## Setup and maintenance (12)

| Skill | Purpose |
| --- | --- |
| [setup-workflow](skills/setup-workflow/SKILL.md) | Install the complete Dotai workflow into explicitly selected project or global agent destinations. |
| [install-skill-dotai-project](skills/install-skill-dotai-project/SKILL.md) | Create or update a custom skill in the shared Dotai source and install it only in the current project for Codex and Claude Code. Use for a project-scoped Dotai-owned skill; do not use for global, Skiller-owned or already-published catalog skills. |
| [install-skill-dotai-global](skills/install-skill-dotai-global/SKILL.md) | Create or update a custom skill in the shared Dotai source and install it globally for Codex and Claude Code. Use for a user-wide Dotai-owned skill; do not use for project-only, Skiller-owned or already-published catalog skills. |
| [install-skill-skiller-project](skills/install-skill-skiller-project/SKILL.md) | Create or update a custom project-owned skill and generate its Codex and Claude Code copies with Skiller. Use when the skill belongs only to the current project and must not be added to Dotai or installed from a published catalog. |
| [install-skill-catalog-project](skills/install-skill-catalog-project/SKILL.md) | Install an already-published skills.sh skill only in the current project for Codex and Claude Code. Use when the skill already exists in the catalog; do not use to author a custom skill, modify Dotai or install globally. |
| [install-skill-catalog-global](skills/install-skill-catalog-global/SKILL.md) | Install an already-published skills.sh skill globally for Codex and Claude Code. Use when the catalog skill should be available user-wide; do not use to author a custom skill, modify Dotai or install only one project. |
| [maintain-workflow](skills/maintain-workflow/SKILL.md) | Maintain reusable workflow rules; compare project methodology or sync named sources when requested. |
| [sync-skills](skills/sync-skills/SKILL.md) | Reconcile named skills and rules between explicit sources and destinations, preserving project adaptations. |
| [skills-update](skills/skills-update/SKILL.md) | Refresh a named skill or configured set with source provenance and explicit project and agent destinations. |
| [find-skills](https://github.com/vercel-labs/skills/blob/80feb48868972d518436f26711509bc78595b5cb/skills/find-skills/SKILL.md) | Helps users discover and install agent skills when they ask questions like "how do I do X", "find a skill for X", "is there a skill that can...", or express interest in extending capabilities. This skill should be used when the user is looking for functionality that might exist as an installable skill. |
| [skill-cleaner](https://github.com/steipete/agent-scripts/blob/15bcfe33f59795ce2421cf7f5a5465094dfbff09/skills/skill-cleaner/SKILL.md) | Codex/OpenClaw skill audit: live budget, usage, duplicates, compact descriptions. |
| [openclaw-sync](skills/openclaw-sync/SKILL.md) | Compare named OpenClaw sources with current agent workflows and classify or apply authorized reusable improvements. |

## Engineering principles (0)

| Skill | Purpose |
| --- | --- |

## Unchanged upstream installation

The setup helper prints exact commands for the selected agent and scope. For project-local Codex, run these from the project directory; use `--global` only for an explicitly requested user-wide installation. Skip a skill whose pinned contents already match.

```sh
npx --yes skills@1.5.25 add https://github.com/hacktivist123/agent-session-resume/tree/76b025634ddc99b3ee3428fb4464af1c467da291 --skill agent-session-resume --agent codex -y
npx --yes skills@1.5.25 add https://github.com/yeachan-heo/oh-my-claudecode/tree/4820f5641828cb980b7eb488a3c187f3d01459c3 --skill ai-slop-cleaner --agent codex -y
npx --yes skills@1.5.25 add https://github.com/mattpocock/skills/tree/3cca18b368ae95cdbdebbff572ccafa662551015 --skill diagnosing-bugs --agent codex -y
npx --yes skills@1.5.25 add https://github.com/vercel-labs/skills/tree/80feb48868972d518436f26711509bc78595b5cb --skill find-skills --agent codex -y
npx --yes skills@1.5.25 add https://github.com/mattpocock/skills/tree/3cca18b368ae95cdbdebbff572ccafa662551015 --skill prototype --agent codex -y
npx --yes skills@1.5.25 add https://github.com/mattpocock/skills/tree/3cca18b368ae95cdbdebbff572ccafa662551015 --skill resolving-merge-conflicts --agent codex -y
npx --yes skills@1.5.25 add https://github.com/humanlayer/skills/tree/3c2629142c5d437428269b1b722b08c0b87f574d --skill show-me --agent codex -y
npx --yes skills@1.5.25 add https://github.com/steipete/agent-scripts/tree/15bcfe33f59795ce2421cf7f5a5465094dfbff09 --skill skill-cleaner --agent codex -y
```

Load the distribution runtime adapter when a selected method needs platform mapping or delegation. Project rules govern testing, native tools and publication; do not fork an unchanged method just to add a routing sentence.

## Capability requirements

These skills remain installed when a tool is absent. Setup reports the missing capability; it never marks an unavailable live action or independent review as passed.

- **agent-session-resume:** Python 3 for helpers; scoped native history or supplied transcript.
- **atlas:** Existing project scene catalog and its fixture/check owners.
- **autogoal:** Native goal tools for native goals; otherwise a file plan.
- **autoreview:** Native or project review helper for structured independent review; direct inspection otherwise.
- **linear-backlog:** Connected Linear tools and project Git/delivery tooling.
- **openclaw-sync:** Node.js, Git and an explicitly selected local reference checkout.
- **oracle:** Oracle CLI and explicitly authorized engine/model access.
- **orchestrator:** Native durable task/project tools.
- **resolve-pr-feedback:** GitHub CLI, jq and authorized repository access.
- **security-triage:** Access to the actual advisory and shipped artifact.
- **skill-cleaner:** Node.js with TypeScript stripping for its analyzer; optional native prompt diagnostics.
- **to-issues:** Connected tracker only for requested publication.
- **to-milestone:** Connected tracker only for requested publication.
- **to-prd:** Connected document/tracker only for requested publication.
- **verify-app:** Project runtime, sanctioned fixtures and relevant browser/native/provider tools.
- **video-transcripts:** ffmpeg, curl, jq and authorized Gemini credentials.
- **walkthrough:** Real final-state captures, Node.js and the configured annotation tool.

## Deliberate boundaries

The bundle includes the generic engineering, product-planning, verification, review, communication and workflow-maintenance methods. It excludes product-specific database schemas, routes, fixtures, domain/provider adapters, release environments and personal configuration. Their generic behavior is owned by Task, Verify App, Atlas, Design and the project adaptation.

Framework packages (React, Next.js, Prisma, tRPC, AI SDK, authentication, Inngest, Sentry, UI registries and game engines) are stack-specific extensions, not required generic workflow dependencies. Use Find Skills for the actual project and install named official packages through the selected agent after source review. No framework dependency is installed merely because it existed on the original author's machine.

Payment, banking, shopping, domain registration, personal health, private session repair, native document/media plugins and account integrations are separate capabilities. This archive contains no accounts, credentials, personal histories, connector configuration or paid-model entitlement. Native skill creation/installation and documentation tools remain supplied by the host agent when available.
