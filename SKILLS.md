# dotai skills

15 skills: 15 maintained in dotai, plus 0 unchanged upstream skills installed with named npx skills add commands. The engineering method (poteto-mode, its playbooks, the principle skills and pstack's review skills) comes from the pstack plugin, not from dotai. Methods load only when relevant; tool access is separate from installation.

## Review (1)

| Skill | Purpose |
| --- | --- |
| [test-audit](skills/test-audit/SKILL.md) | Audit existing tests for low-value, duplicated or implementation-coupled cases and prune or rewrite them on evidence (/test-audit full also lists unguarded public contracts). Not for writing new tests. |

## Communication (4)

| Skill | Purpose |
| --- | --- |
| [clip](skills/clip/SKILL.md) | Record, check and render demo clips or stacked before-and-after images/clips for chat, team posts, social posts, or bug repros. Use before recording any app clip or attaching before/after screenshots. |
| [walkthrough](skills/walkthrough/SKILL.md) | Present final screenshots or rendered artifacts as an annotated walkthrough when visual evidence is requested. |
| [video-transcripts](skills/video-transcripts/SKILL.md) | Transcribe a supplied local or linked video from one frame per second with Gemini 4 Neon through agy, or with a Claude subagent when agy fails, and check the transcript against the frames, when a recording's contents are needed as evidence, such as a bug recording on an issue, PR or comment, or a question about what a video shows. |
| [plan-page](skills/plan-page/SKILL.md) | Write, check, repair and publish plan pages and topic files rendered by .agents/pstack/plan-page.mjs (local HTML + PR bodies/comments). Use before editing plans/topics, at page-work hand-backs, or when a plan page fails to render. |

## Workflow (3)

| Skill | Purpose |
| --- | --- |
| [chips](skills/chips/SKILL.md) | Run the project's suggested-task ledger: /chips, /chips all, /chips sync, offer, start, drop, merge duplicates, or settle stale tasks. Use for suggested tasks, open chips, and whenever pstack would file a follow-up or out-of-band PR. |
| [passwords](skills/passwords/SKILL.md) | Set up unattended 1Password access on a Mac or sign in to websites and apps without repeated human approvals. Use for new-device setup, passwords, authenticator codes, email or SMS verification, passkey alternatives, and blocked logins. |
| [redo](skills/redo/SKILL.md) | Redo a prior pstack run at a higher effort or stronger model, treating its plan as a draft and rerunning only units below target. Use for \"redo <plan, page or PR>\" or a Babysit levels failure. |

## Maintenance (3)

| Skill | Purpose |
| --- | --- |
| [cleanup](skills/cleanup/SKILL.md) | Audit disk usage and remove idle git worktrees, Next.js caches, test Postgres DBs, and unused Bun/npx/uv/Docker caches while preserving active checkouts. Use for /cleanup, /cleanup disk, or freeing worktree/build disk space. |
| [sync-pstack](skills/sync-pstack/SKILL.md) | Set up the pstack plugin in a project through an interview, and keep every pstack project on one pinned tag and one shared AGENTS.md overrides block. Use to set up or install pstack in a repo, sync, bump or update pstack everywhere, list which projects use pstack or have drifted, compare setups, audit a project's skills for drift from pstack (which to cut, fold or keep), change which work runs a panel, architect or an arena without asking (\"from now on X runs architect\"), or move a workflow lesson, including a plan page shape change, into every project. Not for choosing pstack's per-role models, which setup-pstack owns. |
| [worktree-workspace](skills/worktree-workspace/SKILL.md) | Open every git worktree of a project in one VS Code window, each folder labeled by its agent session's title. Use for /worktree-workspace, reviewing worktrees in VS Code, or seeing which worktree holds which task. |

## Monitoring (4)

| Skill | Purpose |
| --- | --- |
| [mac-watchdog](skills/mac-watchdog/SKILL.md) | Keep a Mac from freezing under agent workloads. A user launchd job records memory every 10 seconds, per process and per Claude Code session, and stops any process that grows past 40% of RAM, and a root job restarts fseventsd when its memory leak passes 1 GB. Use to install, check or remove them, after a Mac freezes, swaps hard or logs the user out, when fseventsd holds GBs of memory, or to find which session or process used the memory. |
| [pstack-doctor](skills/pstack-doctor/SKILL.md) | Check every running agent session for a stuck or endless loop, find the pstack rule, override or project playbook that drives it, and propose a steer message and a rule fix. Use for /pstack-doctor, "is any session stuck or endless?", "are my sessions making progress?", a session that has run more than a day, a stop the doctor's Stop hook blocked, and the owner's regular sanity check. |
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
- **mac-watchdog:** macOS with launchd, Node.js and the Xcode command line tools for cc; the Claude desktop app to name sessions; sudo once for the fseventsd watchdog.
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
