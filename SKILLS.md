# Complete generic workflow

78 skills: 49 maintained or adapted in dotai, plus 29 unchanged upstream skills installed with named npx skills add commands. Upstream sources are not duplicated here. Methods load only when relevant; tool access is separate from installation.

## Execution and coordination (9)

| Skill | Purpose |
| --- | --- |
| [task](skills/task/SKILL.md) | Carry an engineering request through source investigation, implementation, proportionate verification, and authorized delivery; also supports explicit plan-only and PRD work. |
| [autogoal](skills/autogoal/SKILL.md) | Manage native Codex goals requested directly or through an explicit standing user instruction, with measurable completion evidence. |
| [improve](skills/improve/SKILL.md) | Audit and repair the current project's strongest evidenced improvement opportunities with one evolving scope, acceptance ledger and verification plan. |
| [orchestrator](skills/orchestrator/SKILL.md) | Turn the current Codex thread into a coordination thread that routes explicitly delegated work to durable reusable child tasks with the project's checkout, proof and delivery policy. |
| [poteto-mode](skills/poteto-mode/SKILL.md) | poteto's agent style for concise, detailed responses, deliberate subagents, unslopped prose, simple code, and verified work. Use for poteto, /poteto-mode, or requests to work in this style. |
| [figure-it-out](https://github.com/cursor/plugins/blob/93b00b89ef425a9c1bac0d0b317dfc49c930ac99/pstack/skills/figure-it-out/SKILL.md) | Design an auditable playbook when no narrower one fits: a large migration, an ambitious multi-part change, or work a human reviews after stepping away. Scales rigor to the task, runs a hypothesis loop, and logs decisions via show-me-your-work. Use for /figure-it-out, 'figure it out', a large migration, or when no narrower playbook applies. |
| [arena](skills/arena/SKILL.md) | Spawn N parallel candidates at the same task, pick a base, graft the strongest parts of the losers into it. Use for /arena, 'arena this', 'throw it in the arena', or when one attempt at a non-trivial artifact would lock in the wrong shape. |
| [swarm](skills/swarm/SKILL.md) | Fan out N parallel workers, drain them, and return one report. Use for /swarm, 'swarm this', or parallel coverage, races, gauntlets, and exploration. |
| [setup-pstack](skills/setup-pstack/SKILL.md) | Configure which models pstack uses per role. Detects your available models and writes the project role configuration that overrides the skill defaults. Use for /setup-pstack, "configure pstack models", or changing pstack's model choices. |

## Architecture, diagnosis and review (14)

| Skill | Purpose |
| --- | --- |
| [architect](skills/architect/SKILL.md) | Sketch types, signatures, and module structure before code, then stay in the loop while implementation fills in. Use for /architect, 'architect this', 'design this', or non-trivial work where jumping to code would lock in the wrong shape. |
| [architecture-cleanup](skills/architecture-cleanup/SKILL.md) | Simplify code ownership, abstractions and colocation while preserving the requested public behavior and complete caller contracts. |
| [best-api-review](skills/best-api-review/SKILL.md) | Judge whether an API or architecture change is worth pursuing, including new primitives and breaking redesigns beyond today's API. Give harsh, source-backed stop, pursue, or defer feedback before detailed design or implementation. |
| [blast-radius](skills/blast-radius/SKILL.md) | Find what a change could break somewhere else before it ships, beyond the diff, and prove the one fact it's safe because of by running real code instead of writing it up. Use for 'blast radius of X', 'what could this break', or reviewing a small diff you don't trust. |
| [interrogate](skills/interrogate/SKILL.md) | Use for \"interrogate\", \"adversarial review\", \"multi-model review\", \"challenge this\", \"stress test this code\", \"find blind spots\", or \"tear this apart\". Multiple LLM reviewers challenge changes from independent angles. |
| [autoreview](skills/autoreview/SKILL.md) | Review an explicit code candidate or an actual PR closeout with actionable findings, bounded correction rounds and source-backed adjudication. |
| [agent-native-reviewer](skills/agent-native-reviewer/SKILL.md) | Audit changed agent workflows for usable routes, source ownership, discovery, and reproducible proof. |
| [hard-cut](skills/hard-cut/SKILL.md) | Remove a feature completely with no backward compatibility; delete surfaces, callers, tests, docs, fallbacks, stubs, and dead exports. |
| [no-comments](skills/no-comments/SKILL.md) | Spawn Comment Sicko, fix accepted findings, and offer encodings for claimed constraints. |
| [reflect](skills/reflect/SKILL.md) | Spawn three parallel review subagents over the active transcript, surface learnings, and route each to a concrete edit on an existing skill. Use when the user says reflect. |
| [diagnosing-bugs](https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/diagnosing-bugs/SKILL.md) | Diagnosis loop for hard bugs and performance regressions. Use when the user says "diagnose"/"debug this", or reports something broken/throwing/failing/slow. |
| [ai-slop-cleaner](https://github.com/yeachan-heo/oh-my-claudecode/blob/4820f5641828cb980b7eb488a3c187f3d01459c3/skills/ai-slop-cleaner/SKILL.md) | Clean AI-generated code slop with a regression-safe, deletion-first workflow and optional reviewer-only mode |
| [security-triage](skills/security-triage/SKILL.md) | Triage GHSA, CVE, security advisory, and vulnerability reports with shipped-state proof before closing or fixing. |
| [oracle](skills/oracle/SKILL.md) | Obtain an explicitly requested second-model review through the Oracle CLI using a minimal reviewed file bundle, capability checks and resumable sessions. |

## Product, planning and design (8)

| Skill | Purpose |
| --- | --- |
| [grill-with-vision](skills/grill-with-vision/SKILL.md) | Resolve unsettled product, domain or source decisions against current user intent and product vision before implementation planning. |
| [to-prd](skills/to-prd/SKILL.md) | Turn settled product scope into a buildable PRD with source-backed acceptance, dependency ownership and explicit proof and publication boundaries. |
| [to-milestone](skills/to-milestone/SKILL.md) | Build or maintain an evidence-backed milestone map and ordered PRD ladder for a coherent product outcome. |
| [to-issues](skills/to-issues/SKILL.md) | Slice a settled PRD or plan into the fewest self-contained delivery issues and publish them only within explicit tracker authority. |
| [design](skills/design/SKILL.md) | Create or improve production UI composition, interactions and design standards using the current product and its actual component system. |
| [prototype](https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/prototype/SKILL.md) | Build a throwaway prototype to answer a design question. Use when the user wants to sanity-check whether a state model or logic feels right, or explore what a UI should look like. |
| [avoid-feature-creep](skills/avoid-feature-creep/SKILL.md) | Challenge proposed scope additions against the actual user outcome, current acceptance and delivery constraints without shrinking already-authorized work. |
| [sync-vision](skills/sync-vision/SKILL.md) | Sync root VISION.md from changed human and agent inputs; use when project taste, doctrine, or maintainer judgment should learn from recent plans, docs, skills, reviews, or repeated misses. |

## Verification and delivery (8)

| Skill | Purpose |
| --- | --- |
| [verify-app](skills/verify-app/SKILL.md) | Verify real runtime operations, user journeys, copy/design, capability coverage or catalog scenes with evidence bound to the candidate and environment. |
| [atlas](skills/atlas/SKILL.md) | Maintain an existing review catalog of real application scenes, flows, access prerequisites, fixtures and honest readiness alongside changed product behavior. |
| [create-verification-skill](skills/create-verification-skill/SKILL.md) | Generate a project-local verification skill that drives your app the way a user does — any language, framework, or platform. Use for /create-verification-skill, \"make a control skill for this repo\", or when a project has no scripted way to prove UI/CLI/service behavior. |
| [maintain-verification-skill](skills/maintain-verification-skill/SKILL.md) | Periodic pass that keeps a project's verification skill and feature map honest: parallel source readers per feature, one live session driving every feature, at most one PR of proven corrections. Use for /maintain-verification-skill or \"audit the verify skill\". |
| [tdd](skills/tdd/SKILL.md) | Test-driven development with red-green-refactor loop. Use when user wants to build features or fix bugs using TDD, mentions "red-green-refactor", wants integration tests, or asks for test-first development. |
| [resolve-pr-feedback](skills/resolve-pr-feedback/SKILL.md) | Resolve GitHub PR review feedback with source-backed triage, fixes, a scoped feedback ledger, focused proof, replies, and thread resolution. |
| [resolving-merge-conflicts](https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/resolving-merge-conflicts/SKILL.md) | Use when you need to resolve an in-progress git merge/rebase conflict. |
| [linear-backlog](skills/linear-backlog/SKILL.md) | Run a scoped Linear backlog autonomously as a sequence of maximal safe parallel batches by composing orchestrator, autogoal, and task. Use when the user wants Codex to execute ordered Linear issues without prompting for each next batch while parallelizing every dependency-ready ticket that lacks a hard conflict. |

## Understanding and communication (10)

| Skill | Purpose |
| --- | --- |
| [how](skills/how/SKILL.md) | Use for \"how does X work\", code walkthroughs before changing something, and placement / ownership / layering questions (\"where should this live\", \"which package owns this\", \"is this the right layer\"). Explains subsystem architecture, runtime flow, onboarding mental models. Can critique architecture. Use why for motivation. |
| [why](skills/why/SKILL.md) | Use for 'why does X work this way', 'why we picked Y', design rationale, regressions, postmortems, or data-backed thresholds. Discovers available MCPs and queries each evidence category (source control, issue tracker, long-form docs, real-time chat, infrastructure observability, error tracking, product analytics warehouse) in parallel, then returns a cited read on decisions and tradeoffs. Use how for runtime behavior. |
| [teach](skills/teach/SKILL.md) | Explain a body of work plainly so a person actually understands it. Runs the `how` and `why` skills and weaves what they find into one clear explanation. Use for 'teach me this', 'help me really understand X', 'explain this change or subsystem to me'. |
| [recall](skills/recall/SKILL.md) | Reconstruct your recent working context from your own chat history, live state, and the shared record (user reports, prior fixes, incidents), then hand back a tight current-state brief. Use for 'recall my work on X', 'catch me up', 'what have I been working on', 'where did I leave off', before starting or resuming work. |
| [agent-session-resume](https://github.com/hacktivist123/agent-session-resume/blob/76b025634ddc99b3ee3428fb4464af1c467da291/skills/agent-session-resume/SKILL.md) | Use when continuing, resuming, locating, reading, inspecting, auditing, or reviewing a previous AI coding-agent session, handoff transcript, chat log, exported conversation, saved artifact set, or session summary, on any platform (Claude Code, Codex, Cursor, Antigravity, OpenCode) or across several platforms in one ask, such as reviewing threads across Claude and Codex. |
| [technical-writing](skills/technical-writing/SKILL.md) | Write, edit, and audit clear prose while preserving facts and house style. Use for docs, RFCs, READMEs, PR descriptions, commit messages, prose cleanup, and writing reviews. Includes document structure, anti-slop editing, and preservation checks. |
| [show-me](https://github.com/humanlayer/skills/blob/3c2629142c5d437428269b1b722b08c0b87f574d/plugins/show-me/skills/show-me/SKILL.md) | Help the user understand the current topic visually with concise diagrams, code-shape sketches, and focused HTML artifacts. |
| [show-me-your-work](skills/show-me-your-work/SKILL.md) | Keep a reviewable decision trail for long-running or unattended work: a TSV log with one row per decision (what, why, evidence, result). Local by default; commit it when a reviewer needs the trail to trust the result. Use for /show-me-your-work, autonomous or multi-phase runs, or work a human reviews after stepping away. |
| [walkthrough](skills/walkthrough/SKILL.md) | Create a short annotated visual walkthrough from real final-state screenshots or rendered artifacts. Use when a user asks for demo screenshots or a caller requires visual evidence after UI or rendered-output changes. |
| [video-transcripts](skills/video-transcripts/SKILL.md) | Generate structured video transcripts from local files or video URLs using Gemini Files API. Use when a GitHub or Linear tracker item, comment, or attachment includes a screen recording, .mov, .mp4, or tracker-hosted video and you need a <video-transcripts> block instead of hand-written notes. |

## Setup and maintenance (8)

| Skill | Purpose |
| --- | --- |
| [setup-workflow](skills/setup-workflow/SKILL.md) | Install the complete generic dotai workflow for an explicit agent and project or user scope, preserve existing instructions, adapt project commands and verify discovery. |
| [maintain-workflow](skills/maintain-workflow/SKILL.md) | Maintain reusable agent workflows and compare methodology across projects. Use compare for instruction and execution drift, excluding product-specific differences; use sync to read upstream sources and apply relevant diffs through owned sources and current-project installs. Skip ordinary product edits and wording-only corrections. |
| [sync-skills](skills/sync-skills/SKILL.md) | Reconcile named skills, rules, templates and routing between explicit sources and destinations while preserving project adaptations and generated-source ownership. |
| [skills-update](skills/skills-update/SKILL.md) | Refresh a named skill or explicitly requested configured set using dry-run preflight, source provenance and explicit repository and agent destinations. |
| [find-skills](https://github.com/vercel-labs/skills/blob/80feb48868972d518436f26711509bc78595b5cb/skills/find-skills/SKILL.md) | Helps users discover and install agent skills when they ask questions like "how do I do X", "find a skill for X", "is there a skill that can...", or express interest in extending capabilities. This skill should be used when the user is looking for functionality that might exist as an installable skill. |
| [skill-cleaner](https://github.com/steipete/agent-scripts/blob/15bcfe33f59795ce2421cf7f5a5465094dfbff09/skills/skill-cleaner/SKILL.md) | Codex/OpenClaw skill audit: live budget, usage, duplicates, compact descriptions. |
| [openclaw-sync](skills/openclaw-sync/SKILL.md) | Analyze local OpenClaw repos to sync agent setup into our own skills, AGENTS docs, VISION docs, templates, and workflow rules. Use when asked to pull lessons from ../openclaw, compare current agent setup with latest OpenClaw, or classify potential imports as new, smart-merge, or reject. |
| [typescript-best-practices](skills/typescript-best-practices/SKILL.md) | TypeScript best practices. Use when reading or editing any .ts or .tsx file. |

## Engineering principles (21)

| Skill | Purpose |
| --- | --- |
| [principle-boundary-discipline](https://github.com/cursor/plugins/blob/93b00b89ef425a9c1bac0d0b317dfc49c930ac99/pstack/skills/principle-boundary-discipline/SKILL.md) | Apply when wiring validation, error handling, or framework adapters. Concentrate guards at system boundaries (CLI, config, network, external APIs); trust internal types and keep business logic in pure functions. |
| [principle-build-the-lever](https://github.com/cursor/plugins/blob/93b00b89ef425a9c1bac0d0b317dfc49c930ac99/pstack/skills/principle-build-the-lever/SKILL.md) | Apply to any non-trivial work, not just bulk work: edits, migrations, analyses, checks. Build the tool that does it or proves it (codemod, script, generator, or a skill your subagents follow) instead of working by hand. The tool is the artifact a reviewer can rerun. |
| [principle-encode-lessons-in-structure](https://github.com/cursor/plugins/blob/93b00b89ef425a9c1bac0d0b317dfc49c930ac99/pstack/skills/principle-encode-lessons-in-structure/SKILL.md) | Apply when you catch yourself writing the same instruction a second time, or notice a recurring correction. Encode the rule as a lint, metadata flag, runtime check, or script instead of more text. |
| [principle-exhaust-the-design-space](https://github.com/cursor/plugins/blob/93b00b89ef425a9c1bac0d0b317dfc49c930ac99/pstack/skills/principle-exhaust-the-design-space/SKILL.md) | Apply when facing a novel UI interaction or architectural decision with no precedent in the codebase. Build 2-3 competing prototypes and compare side by side before committing. |
| [principle-experience-first](https://github.com/cursor/plugins/blob/93b00b89ef425a9c1bac0d0b317dfc49c930ac99/pstack/skills/principle-experience-first/SKILL.md) | Apply when product, UX, or feature-scope tradeoffs come up. Choose user delight over implementation convenience; ship fewer polished features over more rough ones. |
| [principle-fix-root-causes](https://github.com/cursor/plugins/blob/93b00b89ef425a9c1bac0d0b317dfc49c930ac99/pstack/skills/principle-fix-root-causes/SKILL.md) | Apply when debugging. Trace each symptom to its root cause and fix it there; reproduce first, ask why until you reach it, resist nil-check guards that silence crashes. |
| [principle-foundational-thinking](https://github.com/cursor/plugins/blob/93b00b89ef425a9c1bac0d0b317dfc49c930ac99/pstack/skills/principle-foundational-thinking/SKILL.md) | Apply before writing logic: choosing core types and data structures, sequencing scaffold-vs-feature work, asking what concurrent actors share. Get the data structures right so downstream code becomes obvious. |
| [principle-guard-the-context-window](https://github.com/cursor/plugins/blob/93b00b89ef425a9c1bac0d0b317dfc49c930ac99/pstack/skills/principle-guard-the-context-window/SKILL.md) | Apply when context is filling up: large outputs, long files, repeated reads, fan-out planning. Route bulk to subagents; keep summaries in the main thread, not raw payloads. |
| [principle-laziness-protocol](https://github.com/cursor/plugins/blob/93b00b89ef425a9c1bac0d0b317dfc49c930ac99/pstack/skills/principle-laziness-protocol/SKILL.md) | Apply when refactoring, evaluating diff size, or tempted to add abstractions, layers, or signal threading. Bias toward deletion and the smallest change that solves the problem. |
| [principle-make-operations-idempotent](https://github.com/cursor/plugins/blob/93b00b89ef425a9c1bac0d0b317dfc49c930ac99/pstack/skills/principle-make-operations-idempotent/SKILL.md) | Apply when designing commands, lifecycle steps, or processing loops that run amid crashes, restarts, and retries. Converge to the same end state regardless of partial prior runs. |
| [principle-migrate-callers-then-delete-legacy-apis](https://github.com/cursor/plugins/blob/93b00b89ef425a9c1bac0d0b317dfc49c930ac99/pstack/skills/principle-migrate-callers-then-delete-legacy-apis/SKILL.md) | Apply when introducing a new internal API while old callers still exist. Migrate callers and delete the old API in the same wave instead of preserving compatibility layers. |
| [principle-minimize-reader-load](https://github.com/cursor/plugins/blob/93b00b89ef425a9c1bac0d0b317dfc49c930ac99/pstack/skills/principle-minimize-reader-load/SKILL.md) | Apply when reviewing or shaping code that's hard to trace. Count layers between question and answer, and hidden state in the reader's head; collapse one-caller wrappers and shrink mutable scope. |
| [principle-model-the-domain](https://github.com/cursor/plugins/blob/93b00b89ef425a9c1bac0d0b317dfc49c930ac99/pstack/skills/principle-model-the-domain/SKILL.md) | Apply when writing stateful logic, or when code branches a lot or repeats a shape assumption across files. Encode the domain in a structure instead of scattered conditionals. |
| [principle-never-block-on-the-human](https://github.com/cursor/plugins/blob/93b00b89ef425a9c1bac0d0b317dfc49c930ac99/pstack/skills/principle-never-block-on-the-human/SKILL.md) | Apply when tempted to ask 'should I do X?' on reversible work. Proceed, present the result, let the human course-correct after the fact; reserve confirmation for irreversible actions. |
| [principle-outcome-oriented-execution](https://github.com/cursor/plugins/blob/93b00b89ef425a9c1bac0d0b317dfc49c930ac99/pstack/skills/principle-outcome-oriented-execution/SKILL.md) | Apply during planned rewrites and migrations with explicit phase boundaries. Converge on the target architecture; don't preserve smooth intermediate states with throwaway compatibility code. |
| [principle-prove-it-works](https://github.com/cursor/plugins/blob/93b00b89ef425a9c1bac0d0b317dfc49c930ac99/pstack/skills/principle-prove-it-works/SKILL.md) | Apply after completing a task, before declaring done. Verify against the real artifact (run the feature, read the actual value, inspect the diff), not a proxy, self-report, or 'it compiles.' |
| [principle-redesign-from-first-principles](https://github.com/cursor/plugins/blob/93b00b89ef425a9c1bac0d0b317dfc49c930ac99/pstack/skills/principle-redesign-from-first-principles/SKILL.md) | Apply when integrating a new requirement into an existing design. Redesign as if the requirement had been a foundational assumption from day one, instead of bolting it on. |
| [principle-separate-before-serializing-shared-state](https://github.com/cursor/plugins/blob/93b00b89ef425a9c1bac0d0b317dfc49c930ac99/pstack/skills/principle-separate-before-serializing-shared-state/SKILL.md) | Apply when concurrent actors might write to the same file, branch, key, or state object. Eliminate the sharing first; serialize structurally only when one shared writer is a real invariant. |
| [principle-sequence-verifiable-units](https://github.com/cursor/plugins/blob/93b00b89ef425a9c1bac0d0b317dfc49c930ac99/pstack/skills/principle-sequence-verifiable-units/SKILL.md) | Apply to multi-step work (sweeps, migrations, runs of similar edits) and to how you stack commits and PRs. Break work into small units that each end in a verifiable state, check each before the next, and order delivery so the sequence proves itself to a reviewer. |
| [principle-subtract-before-you-add](https://github.com/cursor/plugins/blob/93b00b89ef425a9c1bac0d0b317dfc49c930ac99/pstack/skills/principle-subtract-before-you-add/SKILL.md) | Apply when sequencing an addition, refactor, or rewrite. Remove dead weight, redundant validators, and stub references first, then build on the simpler base. |
| [principle-type-system-discipline](skills/principle-type-system-discipline/SKILL.md) | Apply when designing types, reviewing a function signature, or writing code in any statically-typed language. Make illegal states unrepresentable, brand semantic primitives, parse external data at boundaries, refuse to lie to the compiler, exhaust variants, derive from authoritative schemas. |

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
npx --yes skills@1.5.25 add https://github.com/cursor/plugins/tree/93b00b89ef425a9c1bac0d0b317dfc49c930ac99/pstack --skill figure-it-out --agent codex -y
npx --yes skills@1.5.25 add https://github.com/cursor/plugins/tree/93b00b89ef425a9c1bac0d0b317dfc49c930ac99/pstack --skill principle-boundary-discipline --agent codex -y
npx --yes skills@1.5.25 add https://github.com/cursor/plugins/tree/93b00b89ef425a9c1bac0d0b317dfc49c930ac99/pstack --skill principle-build-the-lever --agent codex -y
npx --yes skills@1.5.25 add https://github.com/cursor/plugins/tree/93b00b89ef425a9c1bac0d0b317dfc49c930ac99/pstack --skill principle-encode-lessons-in-structure --agent codex -y
npx --yes skills@1.5.25 add https://github.com/cursor/plugins/tree/93b00b89ef425a9c1bac0d0b317dfc49c930ac99/pstack --skill principle-exhaust-the-design-space --agent codex -y
npx --yes skills@1.5.25 add https://github.com/cursor/plugins/tree/93b00b89ef425a9c1bac0d0b317dfc49c930ac99/pstack --skill principle-experience-first --agent codex -y
npx --yes skills@1.5.25 add https://github.com/cursor/plugins/tree/93b00b89ef425a9c1bac0d0b317dfc49c930ac99/pstack --skill principle-fix-root-causes --agent codex -y
npx --yes skills@1.5.25 add https://github.com/cursor/plugins/tree/93b00b89ef425a9c1bac0d0b317dfc49c930ac99/pstack --skill principle-foundational-thinking --agent codex -y
npx --yes skills@1.5.25 add https://github.com/cursor/plugins/tree/93b00b89ef425a9c1bac0d0b317dfc49c930ac99/pstack --skill principle-guard-the-context-window --agent codex -y
npx --yes skills@1.5.25 add https://github.com/cursor/plugins/tree/93b00b89ef425a9c1bac0d0b317dfc49c930ac99/pstack --skill principle-laziness-protocol --agent codex -y
npx --yes skills@1.5.25 add https://github.com/cursor/plugins/tree/93b00b89ef425a9c1bac0d0b317dfc49c930ac99/pstack --skill principle-make-operations-idempotent --agent codex -y
npx --yes skills@1.5.25 add https://github.com/cursor/plugins/tree/93b00b89ef425a9c1bac0d0b317dfc49c930ac99/pstack --skill principle-migrate-callers-then-delete-legacy-apis --agent codex -y
npx --yes skills@1.5.25 add https://github.com/cursor/plugins/tree/93b00b89ef425a9c1bac0d0b317dfc49c930ac99/pstack --skill principle-minimize-reader-load --agent codex -y
npx --yes skills@1.5.25 add https://github.com/cursor/plugins/tree/93b00b89ef425a9c1bac0d0b317dfc49c930ac99/pstack --skill principle-model-the-domain --agent codex -y
npx --yes skills@1.5.25 add https://github.com/cursor/plugins/tree/93b00b89ef425a9c1bac0d0b317dfc49c930ac99/pstack --skill principle-never-block-on-the-human --agent codex -y
npx --yes skills@1.5.25 add https://github.com/cursor/plugins/tree/93b00b89ef425a9c1bac0d0b317dfc49c930ac99/pstack --skill principle-outcome-oriented-execution --agent codex -y
npx --yes skills@1.5.25 add https://github.com/cursor/plugins/tree/93b00b89ef425a9c1bac0d0b317dfc49c930ac99/pstack --skill principle-prove-it-works --agent codex -y
npx --yes skills@1.5.25 add https://github.com/cursor/plugins/tree/93b00b89ef425a9c1bac0d0b317dfc49c930ac99/pstack --skill principle-redesign-from-first-principles --agent codex -y
npx --yes skills@1.5.25 add https://github.com/cursor/plugins/tree/93b00b89ef425a9c1bac0d0b317dfc49c930ac99/pstack --skill principle-separate-before-serializing-shared-state --agent codex -y
npx --yes skills@1.5.25 add https://github.com/cursor/plugins/tree/93b00b89ef425a9c1bac0d0b317dfc49c930ac99/pstack --skill principle-sequence-verifiable-units --agent codex -y
npx --yes skills@1.5.25 add https://github.com/cursor/plugins/tree/93b00b89ef425a9c1bac0d0b317dfc49c930ac99/pstack --skill principle-subtract-before-you-add --agent codex -y
```

Read the distribution runtime adapter before applying these upstream methods. Project rules govern testing, native tools and publication; do not fork an unchanged method just to add a routing sentence.

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
