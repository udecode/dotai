# dotai skills

16 skills: 16 maintained in dotai, plus 0 unchanged upstream skills installed with named npx skills add commands. The engineering method (poteto-mode, its playbooks, the principle skills and pstack's review skills) comes from the pstack plugin, not from dotai. Methods load only when relevant; tool access is separate from installation.

## Review (1)

| Skill | Purpose |
| --- | --- |
| [test-audit](skills/test-audit/SKILL.md) | Audit existing tests for low-value, duplicated or implementation-coupled cases and the test-only code they keep alive, then remove or rewrite them on evidence. /test-audit full covers the whole suite and also lists public contracts no test guards. Use for test-audit, /test-audit <scope>, /test-audit full, a test sweep, or pruning tests. Not for writing a new test; the project's Tests rule gates that. |

## Communication (4)

| Skill | Purpose |
| --- | --- |
| [clip](skills/clip/SKILL.md) | Record, check and render a demo clip of a web page, one before-and-after clip or image of a change, or a bug clip for an issue, for a chat message, a team post, a social post or an issue. Use before recording any clip of an app, including a bug's repro for an issue, before attaching before and after screenshots of a change (one stacked before-and-after clip or image replaces them), when a clip looks robotic, shaky, rushed or too polished, and when the owner changes how clips look, move or read. |
| [walkthrough](skills/walkthrough/SKILL.md) | Present final screenshots or rendered artifacts as an annotated walkthrough when visual evidence is requested. |
| [video-transcripts](skills/video-transcripts/SKILL.md) | Transcribe a supplied local or linked video from one frame per second with Gemini 4 Neon through agy, or with a Claude subagent when agy fails, and check the transcript against the frames, when a recording's contents are needed as evidence, such as a bug recording on an issue, PR or comment, or a question about what a video shows. |
| [plan-page](skills/plan-page/SKILL.md) | Write, check, repair and publish a plan page: a project's plans and subject files under its plans directory, rendered by .agents/pstack/plan-page.mjs and rendered as one local HTML page per subject with a local index of every subject, and published to claude.ai at each hand-back of page work, such as an architecture or API adoption plan, for comments and feedback. Use before writing or changing a plan, a subject file in <plans>/topics or its page; at every stop that hands back page work, such as a plan written or a playbook's close; before writing or updating a PR body, which renders from the PR's plan, or a comment about your commits on someone else's PR; when a plan page or its claude.ai artifact looks wrong or refuses to render; to republish a page; or to change the page shape or a playbook's page sections. |

## Workflow (3)

| Skill | Purpose |
| --- | --- |
| [chips](skills/chips/SKILL.md) | Run the project's suggested-task ledger, the chips. /chips alone brings this session's open tasks up to date: it applies what the ledger helper says, settles stale and split tasks, cards what can start and reports the board, and /chips all also takes the ship-list tasks and the ones no live session owns, and merges duplicate tasks across the board. /chips sync runs the same sweep but offers no card, and it moves the waits on plans idle for a week to a fresh verdict. Use for /chips, /chips sync, /chips offer, start or drop, \"update the chips without new cards\", \"what chips are open\", \"suggest a task for X\", \"update the chips\", \"clean up the chips\", \"which chips are stale\", \"is this chip still worth doing\", \"merge duplicate chips\", at the last hand-back of a run that offered a task, and whenever pstack would file a tracked issue, a follow-up, a reflect Backlog item or an out-of-band PR. |
| [passwords](skills/passwords/SKILL.md) | Set up unattended 1Password access on a Mac or sign in to websites and apps without repeated human approvals. Use for new-device setup, passwords, authenticator codes, email or SMS verification, passkey alternatives, and blocked logins. |
| [redo](skills/redo/SKILL.md) | Redo a prior pstack run at the current session's higher effort or stronger model, treating its plan as a draft: rerun only the plan, design, subagent and seat lanes, code and review judgments that ran below the current level, and reuse the rest. Use for \"redo <plan, page or PR>\", \"run poteto again on it at this effort\", \"treat this plan as a draft\", a teammate's run made at a lower effort, or a Babysit whose levels check finds a unit below target. |

## Maintenance (4)

| Skill | Purpose |
| --- | --- |
| [cleanup](skills/cleanup/SKILL.md) | Find where a disk's space goes, and free disk in a project by removing the git worktrees, Next.js cache folders, local Docker Postgres test databases, idle Bun, npx and uv cache entries and unused anonymous Docker volumes nothing uses, keeping every worktree a session or process works in and every cache a running server holds. Use for /cleanup, /cleanup disk, \"clean up worktrees\", \"free disk space\", \"what's using my disk\", \"where did my disk space go\", \"what is idle\", \"delete unused worktrees or builds\", or when a session-start hint counts old cleanup candidates. |
| [fseventsd-watchdog](skills/fseventsd-watchdog/SKILL.md) | Restart macOS fseventsd when its memory leak passes 1 GB, from a root launchd job. Use when fseventsd holds GBs of memory, a Mac with many worktrees swaps or freezes, or to install, check or remove the watchdog. |
| [sync-pstack](skills/sync-pstack/SKILL.md) | Set up the pstack plugin in a project through an interview, and keep every pstack project on one pinned tag and one shared AGENTS.md overrides block. Use to set up or install pstack in a repo, sync, bump or update pstack everywhere, list which projects use pstack or have drifted, compare setups, audit a project's skills for drift from pstack (which to cut, fold or keep), change which work runs a panel, architect or an arena without asking (\"from now on X runs architect\"), or move a workflow lesson, including a plan page shape change, into every project. Not for choosing pstack's per-role models, which setup-pstack owns. |
| [worktree-workspace](skills/worktree-workspace/SKILL.md) | Open every git worktree of a project in one VS Code window, each folder labeled by its agent session's title. Use for /worktree-workspace, reviewing worktrees in VS Code, or seeing which worktree holds which task. |

## Monitoring (4)

| Skill | Purpose |
| --- | --- |
| [mem-log](skills/mem-log/SKILL.md) | Record a Mac's memory every 10 seconds, per process and per Claude Code session, from a user launchd job, so the next freeze leaves a record of what used the memory. Use to install, check or remove the recorder, after a Mac freezes or swaps hard, or to find which session or process used the memory. |
| [pstack-doctor](skills/pstack-doctor/SKILL.md) | Check every running agent session for a stuck or endless loop, find the pstack rule, override or project playbook that drives it, and propose a steer message and a rule fix. Use for /pstack-doctor, "is any session stuck or endless?", "are my sessions making progress?", a session that has run more than a day, and the owner's regular sanity check. |
| [pstack-pulse](skills/pstack-pulse/SKILL.md) | Show every Claude Code and Codex session on the iPhone lock screen through ActivitySmith and in the Mac menubar, with each plan page's pipeline, and buzz when a session needs you, ships or fails. |
| [rca](skills/rca/SKILL.md) | Turn Remote Control on for every non-archived Claude Code session in the Claude desktop app. |

## Unchanged upstream installation

For a project-local install, run these from the project directory and name each agent; use `--global` only for an explicitly requested user-wide install. Skip a skill whose pinned contents already match.

```sh
```

Project rules govern testing, native tools and publication; do not fork an unchanged method just to add a routing sentence.

## Capability requirements

These skills remain installed when a tool is absent; an unavailable live action or independent review is reported, never marked as passed.

- **chips:** Node.js 22+ and Git; the ledger helpers and chips.md rule that sync-pstack installs in .agents/pstack; a suggest tool for cards, with the fallback chips.md gives without one.
- **cleanup:** Node.js 22+, Git and lsof; a session tool that lists sessions with their folders, or a one-day wait before a worktree counts as unused.
- **clip:** Bun, ffmpeg and ffprobe; Chromium for playwright-core, which the skill installs on first use.
- **fseventsd-watchdog:** macOS with launchd, and the user running the installer with sudo once.
- **mem-log:** macOS with launchd, Node.js and the Xcode command line tools for cc; the Claude desktop app to name sessions.
- **passwords:** macOS login Keychain, 1Password CLI and an account with service-account access; authorized browser or native-app controls that can consume credentials without exposing them.
- **plan-page:** Node.js 22+ and Git; the renderer that sync-pstack installs in .agents/pstack; the Artifact tool to publish.
- **pstack-doctor:** Node.js 22+, Git and ripgrep; pstack-pulse for live session state, and a session tool that lists sessions for the rest.
- **pstack-pulse:** macOS with launchd and the Keychain, Node.js 22+ and sqlite3; an ActivitySmith account and key; Tailscale Funnel for the session list.
- **rca:** A Code session in the Claude desktop app, which alone has its session tools.
- **sync-pstack:** Node.js 22+ and Git; the Claude Code and Codex CLIs for plugin pins and smoke tests.
- **video-transcripts:** ffmpeg, curl, jq and a signed-in agy (Antigravity CLI).
- **walkthrough:** Real final-state captures, Node.js and the configured annotation tool.
- **worktree-workspace:** Node.js 22+, Git and the VS Code `code` command; session titles from a sessions file or the Claude desktop app on macOS.

## Deliberate boundaries

dotai holds shared methods that pstack does not cover. It excludes product-specific schemas, routes, fixtures, provider adapters, release environments and personal configuration; those belong to each project. Framework packages (React, Next.js, Prisma, tRPC and the like) are stack-specific: install named official packages with the Skills CLI after source review. The skills contain no accounts, credentials, personal histories or connector configuration.
