# ustack skills

14 skills: 14 maintained in ustack, plus 0 unchanged upstream skills installed with named npx skills add commands. The engineering method (poteto-mode, its playbooks, the principle skills and pstack's review skills) comes from the pstack plugin, not from ustack. Methods load only when relevant; tool access is separate from installation.

## Review (2)

| Skill | Purpose |
| --- | --- |
| [skill-audit](skills/skill-audit/SKILL.md) | Audit custom skills, playbooks, AGENTS.md rules, sync-pstack assets, and pstack overrides for drift, overlap, dead routes, and size-budget bloat across any project or ustack itself. |
| [test-audit](skills/test-audit/SKILL.md) | Prune low-value, internal, flaky, slow or duplicated tests and bloated CI checks in coherent batches while keeping E2E, public boundary and invariant coverage intact. Not for writing new tests. |

## Communication (2)

| Skill | Purpose |
| --- | --- |
| [clip](skills/clip/SKILL.md) | Record, check and render demo clips or stacked before-and-after images/clips for chat, team posts, social posts, or bug repros. Use before recording any app clip or attaching before/after screenshots. |
| [video-transcripts](skills/video-transcripts/SKILL.md) | Transcribe a supplied local or linked video from one frame per second with Gemini 4 Neon through agy, or with a Claude subagent when agy fails, and check the transcript against the frames, when a recording's contents are needed as evidence, such as a bug recording on an issue, PR or comment, or a question about what a video shows. |

## Workflow (3)

| Skill | Purpose |
| --- | --- |
| [passwords](skills/passwords/SKILL.md) | Set up unattended 1Password access on a Mac or sign in to websites and apps without repeated human approvals. Use for new-device setup, passwords, authenticator codes, email or SMS verification, passkey alternatives, and blocked logins. |
| [redo](skills/redo/SKILL.md) | Redo a prior pstack run at a higher effort or stronger model, treating its plan as a draft and rerunning only units below target. Use for \"redo <plan, page or PR>\" or a Babysit levels failure. |
| [start](skills/start/SKILL.md) | Launch one or more standalone top-level T3 Code worktree threads (`t3_thread_launch` / `create_threads`) from a short prompt or the current chat's agreed plan. Use for /start, /start <task>, or spinning off independent work. |

## Maintenance (3)

| Skill | Purpose |
| --- | --- |
| [cleanup](skills/cleanup/SKILL.md) | Audit disk usage and remove idle git worktrees, Next.js caches, test Postgres DBs, and unused Bun/npx/uv/Docker caches while preserving active checkouts. Use for /cleanup, /cleanup disk, or freeing worktree/build disk space. |
| [migrate-t3](skills/migrate-t3/SKILL.md) | Migrate a setup from Claude Desktop and Claude Code to T3 Code (Antigravity Gemini 4 Neon, T3 config, MCPs, skills, pstack plugin, browse, cua-driver) and return a manual checklist for OAuth, permissions, and UI steps. Use when the user asks to run migrate-t3 or onboard to T3 Code. |
| [sync-pstack](skills/sync-pstack/SKILL.md) | Set up pstack in a project and keep every managed project on one pinned tag and shared AGENTS.md overrides block. Use to install, sync, bump, or compare pstack setups, change project review rules, or propagate a shared workflow lesson. |

## Monitoring (4)

| Skill | Purpose |
| --- | --- |
| [mac-watchdog](skills/mac-watchdog/SKILL.md) | Keep a Mac from freezing under agent workloads. A user launchd job records memory every 10 seconds, per process and per Claude Code session, and stops any process that grows past 40% of RAM, and a root job restarts fseventsd when its memory leak passes 1 GB. Use to install, check or remove them, after a Mac freezes, swaps hard or logs the user out, when fseventsd holds GBs of memory, or to find which session or process used the memory. |
| [pstack-doctor](skills/pstack-doctor/SKILL.md) | Check every running agent session for a stuck or endless loop, find the pstack rule, override or project playbook that drives it, and propose a steer message and a rule fix. Use for /pstack-doctor, "is any session stuck or endless?", "are my sessions making progress?", a session that has run more than a day, a stop the doctor's Stop hook blocked, and the owner's regular sanity check. |
| [pstack-pulse](skills/pstack-pulse/SKILL.md) | Show Claude Code and Codex pstack sessions on the iPhone lock screen through ActivitySmith and in the Mac menubar, with each plan's pipeline, and buzz when a session needs you, ships or fails. |
| [rca](skills/rca/SKILL.md) | Turn Remote Control on for every non-archived Claude Code session in the Claude desktop app. |

## Unchanged upstream installation

For a project-local install, run these from the project directory and name each agent; use `--global` only for an explicitly requested user-wide install. Skip a skill whose pinned contents already match.

```sh
```

Project rules govern testing, native tools and publication; do not fork an unchanged method just to add a routing sentence.

## Capability requirements

These skills remain installed when a tool is absent; an unavailable live action or independent review is reported, never marked as passed.

- **cleanup:** Node.js 22+, Git and lsof; a session tool that lists sessions with their folders, or a one-day wait before a worktree counts as unused.
- **clip:** Bun, ffmpeg and ffprobe; Chromium for playwright-core, which the skill installs on first use.
- **mac-watchdog:** macOS with launchd, Node.js and the Xcode command line tools for cc; the Claude desktop app to name sessions; sudo once for the fseventsd watchdog.
- **migrate-t3:** Node.js 22+, T3 Code, the agy (Antigravity) CLI, OpenCode browse (Chrome extension) and cua-driver (macOS); Claude Code and Codex CLIs for UI slices and multi-family panels.
- **passwords:** macOS login Keychain, 1Password CLI and an account with service-account access; authorized browser or native-app controls that can consume credentials without exposing them.
- **pstack-doctor:** Node.js 22+, Git and ripgrep; pstack-pulse for live session state, Antigravity ACP transcripts for Gemini 4 Neon sessions, and a session tool that lists sessions for the rest.
- **pstack-pulse:** macOS with launchd and the Keychain, Node.js 22+ and sqlite3; an ActivitySmith account and key; Tailscale Funnel for the session list.
- **rca:** A Code session in the Claude desktop app, which alone has its session tools.
- **skill-audit:** Node.js 22+.
- **start:** A T3 Code session with the t3-code MCP tools (`t3_thread_launch` and `create_threads`, directly or via `acp-mcp-call`).
- **sync-pstack:** Node.js 22+ and Git; the Claude Code and Codex CLIs for plugin pins and smoke tests.
- **video-transcripts:** ffmpeg, curl, jq and a signed-in agy (Antigravity CLI).

## Deliberate boundaries

ustack holds shared methods that pstack does not cover. It excludes product-specific schemas, routes, fixtures, provider adapters, release environments and personal configuration; those belong to each project. Framework packages (React, Next.js, Prisma, tRPC and the like) are stack-specific: install named official packages with the Skills CLI after source review. The skills contain no accounts, credentials, personal histories or connector configuration.
