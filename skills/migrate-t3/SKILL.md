---
name: migrate-t3
description: "Migrate a setup from Claude Desktop and Claude Code to T3 Code with Antigravity (Gemini 4 Neon) plus Claude and Codex. Use for /migrate-t3, onboarding a teammate to T3 Code, or fixing missing MCPs, skills, plugins, or Chrome profiles in T3."
---

# Migrate to T3 Code

Move a local Claude Desktop and Claude Code setup into T3 Code with Antigravity (`gemini-4-neon @high`) as the default lead and Claude and Codex kept ready for UI work and multi-family panels.

## Prerequisites

1. Install T3 Code and the `agy` CLI, and sign in to Antigravity.
2. Start one Antigravity thread in T3 Code once so T3 creates `~/.t3/userdata/providers/antigravity/<hash>/`.

## 1. Audit and apply local wiring

Run the idempotent helper from the user's main project checkout (or home directory outside a repo). Replace `<skill-dir>` with the directory holding this file:

```sh
node <skill-dir>/scripts/migrate.mjs --check
node <skill-dir>/scripts/migrate.mjs --apply
```

`--apply` makes safe changes without overwriting non-empty user files or printing secret values:
- Merges `mcpServers` from Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json`) and Claude Code (`~/.claude.json`, global and current project) into `~/.gemini/config/mcp_config.json`, renaming HTTP/SSE `url` to `serverUrl` and dropping `type`.
- Adds `~/.agents/skills` (and `~/.claude/skills` when present) to `~/.gemini/config/skills.json`.
- Copies `~/.claude/CLAUDE.md` to `~/.gemini/AGENTS.md` when `~/.gemini/AGENTS.md` is absent or empty.
- Writes `~/.gemini/config/pstack-models.md` with `gemini-4-neon @high`, `inherit` subagents, `ui, visual: opus @high`, and 3-family panel defaults when absent.
- Symlinks each T3 profile under `~/.t3/userdata/providers/antigravity/*/` to `~/.gemini/AGENTS.md` and `~/.gemini/config/{mcp_config.json,skills.json,pstack-models.md,plugins}` (plus `antigravity-acp/mcp_oauth_tokens.json` when present).

Ask which Claude.ai cloud connectors the user relied on in Claude Desktop (such as Linear, Slack, or Notion). Cloud connectors are not in `claude_desktop_config.json`, so add their `{"serverUrl": "https://..."}` entries to `~/.gemini/config/mcp_config.json` when wanted.

## 2. Install or update the pstack Antigravity plugin

When `--check` reports a missing or stale `pstack` plugin, read the repo's pinned tag from `.claude/settings.json` or `.agents/pstack.json` and install it globally:

```sh
git clone --depth 1 --branch <tag> https://github.com/michael-denyer/pstack-claude /tmp/pstack-claude
agy plugin install /tmp/pstack-claude/plugins/pstack
rm -rf /tmp/pstack-claude
node <skill-dir>/scripts/migrate.mjs --apply
```

Never symlink `.agents/plugins/pstack` inside a repo; `agy` ignores symlinked project plugins.

## 3. Install shared global skills (optional)

```sh
npx --yes skills add udecode/dotai --skill start cleanup skill-audit --agent antigravity claude-code --global -y
```

## 4. Manual clicks for the user

1. **Default model:** Pick Antigravity `gemini-4-neon` (`high`) as the T3 default lead; keep Claude (`opus`) and Codex signed in for UI slices and panels.
2. **Import signed-in Chrome profile (macOS):** System Settings -> Privacy & Security -> Full Disk Access -> enable T3 Code -> quit Chrome (`Cmd+Q`) -> T3 Settings (`Cmd+,`) -> Browser -> Browser profiles -> `+ Add profile` -> Import from Chrome -> allow Keychain. Disable Full Disk Access afterward if preferred.
3. **OAuth MCPs and issue tracker:** Finish browser OAuth for remote MCPs; if done in `agy` CLI, re-run `migrate.mjs --apply` to link `mcp_oauth_tokens.json`. Add tracker keys (such as Linear) in T3 Settings -> Source control & issues if used.
4. **Optional CLIs:** Install OpenCode `browse` (`~/.local/bin/browse`) for signed-in Chrome or native clipboard, and `cua-driver` (`~/.local/bin/cua-driver`) for native macOS apps.

## 5. Verify and restart

1. Run `node <skill-dir>/scripts/migrate.mjs --check` until zero `todo:` lines remain.
2. Run the repo's setup doctor if it has one (for example `node .agents/rules/contributor-setup/scripts/doctor.mjs`) until `ok:`.
3. Open a fresh T3 Antigravity thread so linked MCPs, plugins, skills, and `AGENTS.md` load, then confirm `node .agents/pstack/lead.mjs` (in a pstack repo) prints `gemini-4-neon @high`.

## Known T3 and agy limits

- **Profile isolation:** Adding another Antigravity account creates a new hash folder; re-run `migrate.mjs --apply`.
- **Size caps:** `agy` truncates single rule files past 24,000 bytes and drops skills when total descriptions pass ~16,000 chars.
- **Large T3 MCP tools:** Tools with >1 KB schemas (`delegate_task`, `preview_open`, `preview_act`, `t3_thread_launch`, `create_threads`, `watch_pull_request`) run via `acp-mcp-call`.
- **Preview clipboard:** `preview_act` shortcuts (`Meta+c/v/a`) do not drive native `<textarea>` clipboard; use `browse` instead.
- **Restart resume bug:** Resuming an old Antigravity thread after a T3 server restart can raise a false model-unavailable error; start a new thread or switch provider and back.
