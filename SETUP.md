# Set up the complete workflow

Give this GitHub page, folder or zip to your coding agent. It provides our maintained/adapted skills, references, helpers, licenses and complete inventory; unchanged upstream skills are installed directly with `npx skills add`. No account or provider connection is included.

## One prompt

Open your project in Codex, attach this page's link or the unpacked `dotai-workflow` folder, and send:

> Read the SETUP.md link or dotai-workflow folder I supplied and use its setup-workflow skill. Install the complete generic workflow for Codex globally, preserve my existing instructions and skills, and adapt the current project from its actual source and commands. I want native goals for long-running work when available, unless I opt out. Download the complete repository at the same revision as the setup link if needed. Preview the installation, install our adapted skills and use the printed npx skills add commands for unchanged remote skills without duplicating them, verify the entire manifest and native discovery, and report any tools that still need connecting. Do not publish anything or change my model, permissions or credentials.

This is one user prompt; the agent performs the setup steps. For a project-only installation, replace “globally” with “only in this project.” For Claude Code, name Claude Code explicitly. Ordinary chat without local filesystem execution cannot run this installer.

## Instructions for the agent

Read [Setup Workflow](skills/setup-workflow/SKILL.md), then inspect the destination's actual instructions and source ownership. Use the supplied bundle or download the complete repository archive at the same revision as the GitHub SETUP.md link. Do not fetch only this Markdown file or substitute the default branch for a pinned revision.

Use Node.js 18+, npm/npx, Git and network access. Preview and apply the local phase, run the printed named remote installation commands, then verify with the same destination arguments:

```sh
node /absolute/path/to/dotai-workflow/scripts/setup-workflow.mjs --target /absolute/path/to/project --scope project --agent codex --standing-goals
node /absolute/path/to/dotai-workflow/scripts/setup-workflow.mjs --target /absolute/path/to/project --scope project --agent codex --standing-goals --apply
# Run the printed npx skills add commands before final verification.
node /absolute/path/to/dotai-workflow/scripts/setup-workflow.mjs --target /absolute/path/to/project --scope project --agent codex --verify
```

For global installation, use the actual home directory as target and `--scope global`. Use `--standing-goals` only when the user requested that saved preference, as in the prompt above. Native goal use remains limited by the host's tool contracts.

The helper detects an active Codex `AGENTS.override.md` and respects `CODEX_HOME`. Use `--instructions /absolute/owned/source.md` for a custom or generated instruction owner, then run its actual generator and verify effective loading. The helper deliberately refuses to guess how to edit generated files.

Global setup does not copy project skills a second time. For the project named in the prompt, finish its `.agents/workflow.md` adaptation from real source: commands, source/generator owners, verification surfaces, plan locations and delivery policy. Preserve existing content. A project-local install seeds this file when absent; global setup leaves project adaptation to the agent.

Existing differing skills or edited managed routing block the apply before any writes. Reconcile through Sync Skills; never delete the friend's setup or force-overwrite it. Matching complete files can be adopted. The local helper installs 49 skills; 29 unchanged upstream skills come from their original repositories through the Skills CLI. A complete rerun is idempotent. User-owned instruction text around the managed block and existing project adapters/templates are preserved.

## Verify and use

Read [the full skill inventory](SKILLS.md). Verify the manifest count and hashes, then confirm skills and instructions in the active agent's discovery surface. Filesystem verification proves installation integrity; it does not prove native goals, browser access, an independent model or provider credentials. If the session does not refresh, open a fresh session/restart and check again.

Try a small real request: “Use Task to inspect this project's check command and explain how you would verify a small change. Do not edit or run the application.” A direct question should stay small; an actual implementation request should retain acceptance and finish its required proof. Do not run paid reviews, send messages or modify a database as an installation smoke test.

You can then ask normally, or invoke `task`, `improve`, `to-prd`, `verify-app`, `autoreview`, `maintain-workflow` and the other skills by name. Maintain Workflow changes reusable methods; Sync Skills reconciles adaptations; rerun this installer from a reviewed new bundle for updates. Keep the bundle somewhere you can find it again.

## Discovery references

Codex's documented repository and user skill directories are `.agents/skills` and `~/.agents/skills`; global instructions live in the active Codex home. See [skill discovery](https://learn.chatgpt.com/docs/build-skills) and [instruction precedence](https://learn.chatgpt.com/docs/agent-configuration/agents-md). This installer also supports explicit Claude Code `.claude/skills` destinations; native capability checks still run in that agent.
