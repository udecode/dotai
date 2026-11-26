---
name: migrate-t3
description: "Migrate a setup from Claude Desktop and Claude Code to T3 Code (Antigravity Gemini 4 Neon, T3 config, MCPs, skills, pstack plugin) and return a manual checklist for OAuth and UI steps. Use when the user asks to run migrate-t3 or onboard to T3 Code."
---

# Migrate to T3 Code

Run this end-to-end when invoked inside a T3 Code Antigravity (`gemini-4-neon`) thread (or Claude Code). Do every automatable step without stopping, then finish with the manual checklist below so the user can handle OAuth and UI-only clicks.

Let `<skill-dir>` be the directory holding this `SKILL.md`.

## Execute automatically

1. **Apply local config, T3 settings, and profile symlinks** from the current project checkout (or home directory outside a repo):
   ```sh
   node <skill-dir>/scripts/migrate.mjs --apply
   ```
   This idempotently:
   - Merges curated defaults from `<skill-dir>/assets/t3-defaults.json` into `~/.t3/userdata/settings.json` (Neon lead, Opus fallback, Hydrogen titles, favorites, hidden legacy models, worktree cleanup, semantic branches, device support) and `~/.t3/userdata/client-settings.json` (workflow defaults only), preserving local project UUIDs, microphones, browser profiles, and fonts.
   - Merges `mcpServers` from Claude Desktop (`claude_desktop_config.json`) and Claude Code (`~/.claude.json`, global plus current project) into `~/.gemini/config/mcp_config.json`, renaming HTTP/SSE `url` to `serverUrl` and dropping `type` without overwriting existing entries or printing secrets.
   - Adds `~/.agents/skills` (and `~/.claude/skills` when present) to `~/.gemini/config/skills.json`.
   - Copies `~/.claude/CLAUDE.md` to `~/.gemini/AGENTS.md` when missing or empty.
   - Writes `~/.gemini/config/pstack-models.md` (`gemini-4-neon @high`, `inherit` subagents, `ui, visual: opus @high`, 3-family panels) when missing.
   - Symlinks every `~/.t3/userdata/providers/antigravity/*/` profile to `~/.gemini/AGENTS.md` and `~/.gemini/config/{mcp_config.json,skills.json,pstack-models.md,plugins}` (plus `antigravity-acp/mcp_oauth_tokens.json` when present).
2. **Install or update the `pstack` Antigravity plugin** if step 1 reported a missing or stale `pstack` pin. Read the pinned tag from `.claude/settings.json` or `.agents/pstack.json` (default `main`), install globally, and re-run `--apply` so the T3 profile links `config/plugins`:
   ```sh
   git clone --depth 1 --branch <tag> https://github.com/michael-denyer/pstack-claude /tmp/pstack-claude
   agy plugin install /tmp/pstack-claude/plugins/pstack
   rm -rf /tmp/pstack-claude
   node <skill-dir>/scripts/migrate.mjs --apply
   ```
   Never symlink `.agents/plugins/pstack` inside a repo; `agy` ignores symlinked project plugins.
3. **Install shared global `ustack` skills** if missing (`start`, `cleanup`, `skill-audit`):
   ```sh
   npx --yes skills add udecode/ustack --skill start cleanup skill-audit --agent antigravity claude-code --global -y
   ```
4. **Verify**:
   - Run `node <skill-dir>/scripts/migrate.mjs --check` and resolve any remaining automatable `todo:` items (if a profile has a non-empty local file conflicting with a symlink, tell the user instead of overwriting it).
   - If the repo has `node .agents/rules/contributor-setup/scripts/doctor.mjs`, run it and apply any automatable `fix:` lines until it prints `ok:` (pass any human-only `fix:` lines into the final checklist).

## Reply with the manual checklist

End your reply with a brief list of what changed plus this exact checklist (trimmed only for items already verified complete, and filling in the real `<skill-dir>` path):

```markdown
### Manual checklist

- [ ] **Quit and reopen T3 Code, then start a fresh Antigravity thread** so linked MCPs, `pstack`, skills, `AGENTS.md`, and T3 settings load. If T3 overwrote `settings.json` on quit, close T3 and run `node <skill-dir>/scripts/migrate.mjs --apply --t3-only`, then reopen T3.
- [ ] **Sign in to Claude (`opus`) and Codex in T3 Code** so fallback, UI/visual delegation, and multi-family panels work.
- [ ] **Complete OAuth for remote MCPs** when prompted in your browser. If you relied on Claude.ai cloud connectors (Linear, Slack, Notion), tell me which ones and I will add their `serverUrl` entries to `~/.gemini/config/mcp_config.json`. If you log in via `agy` CLI, re-run `node <skill-dir>/scripts/migrate.mjs --apply` to link `mcp_oauth_tokens.json`.
- [ ] **Import signed-in Chrome profile into T3 Browser (macOS):** System Settings -> Privacy & Security -> Full Disk Access -> enable T3 Code -> quit Chrome (`Cmd+Q`) -> T3 Settings (`Cmd+,`) -> Browser -> Browser profiles -> `+ Add profile` -> Import from Chrome -> allow Keychain (disable Full Disk Access afterward if preferred).
- [ ] **Add issue tracker API keys** (such as Linear) in T3 Settings -> Source control & issues if used.
- [ ] **Optional CLIs:** install OpenCode `browse` (`~/.local/bin/browse`) for signed-in Chrome or native clipboard, and `cua-driver` (`~/.local/bin/cua-driver`) for native macOS apps.
- [ ] **Verify in the fresh thread:** run `node .agents/pstack/lead.mjs` (in a pstack repo) and confirm `gemini-4-neon @high`.
```

## Known T3 and agy limits

- **Profile isolation:** Adding another Antigravity account creates a new hash folder; re-run `migrate.mjs --apply`.
- **Size caps:** `agy` truncates rule files past 24,000 bytes and drops skills past ~16,000 description chars.
- **Large T3 MCP tools:** Tools with >1 KB schemas (`delegate_task`, `preview_open`, `preview_act`, `t3_thread_launch`, `create_threads`, `watch_pull_request`) run via `acp-mcp-call`.
- **Preview clipboard:** `preview_act` `Meta+c/v/a` does not drive native `<textarea>` clipboard; use `browse`.
- **Restart resume bug:** Resuming an old Antigravity thread after a T3 server restart can raise a false model-unavailable error; start a new thread or switch provider and back.
