---
name: migrate-t3
description: "Migrate a setup from Claude Desktop and Claude Code to T3 Code (Antigravity Gemini 4 Neon, T3 config, MCPs, skills, pstack plugin, browse, cua-driver) and return a manual checklist for OAuth, permissions, and UI steps. Use when the user asks to run migrate-t3 or onboard to T3 Code."
---

# Migrate to T3 Code

Run this end-to-end when invoked inside a T3 Code Antigravity (`gemini-4-neon`) thread (or Claude Code). Do every automatable step without stopping, then finish with the manual checklist below so the user handles only OAuth, permissions, extension pairing, and UI clicks.

Let `<skill-dir>` be the directory holding this `SKILL.md`.

## Execute automatically

1. **Apply local config, T3 settings, and profile symlinks** from the current project checkout (or home directory outside a repo):
   ```sh
   node <skill-dir>/scripts/migrate.mjs --apply
   ```
   This idempotently:
   - Merges curated defaults from `<skill-dir>/assets/t3-defaults.json` into `~/.t3/userdata/settings.json` (Neon lead, Opus fallback, Hydrogen titles, favorites, hidden legacy models, worktree cleanup, semantic branches, device support) and `~/.t3/userdata/client-settings.json` (workflow defaults only), preserving local project UUIDs, microphones, browser profiles, fonts, and existing `providerInstances` `displayName` and `environment` entries.
   - Ensures every `driver: "antigravity"` instance in `providerInstances` sets `AGY_CLI_FORCE_FILE_TOKEN_STORAGE=1`, preserving existing env entries and flagging instances that set `AGY_ACP_FORCE_FILE_STORAGE` without `AGY_CLI_FORCE_FILE_TOKEN_STORAGE`.
   - Merges global `mcpServers` from Claude Desktop (`claude_desktop_config.json`) and global Claude Code (`~/.claude.json`, never per-project `projects[cwd].mcpServers`) into `~/.gemini/config/mcp_config.json`, skipping `@playwright/mcp` and `playwright` (T3 uses `preview_*`, `browse`, and Playwright CLI), renaming HTTP/SSE `url` to `serverUrl`, and dropping `type` without overwriting existing entries or printing secrets.
   - Adds `~/.agents/skills` (and `~/.claude/skills` when present) to `~/.gemini/config/skills.json`.
   - Copies `~/.claude/CLAUDE.md` to `~/.gemini/AGENTS.md` when missing or empty.
   - Writes `~/.gemini/config/pstack-models.md` (`gemini-4-neon @high`, `inherit` subagents, `ui, visual: opus @high`, `medium` routine lanes, 3-family panels with no Opus fallback for Sol) when missing.
   - Symlinks every `~/.t3/userdata/providers/antigravity/*/` profile to `~/.gemini/AGENTS.md` and `~/.gemini/config/{mcp_config.json,skills.json,pstack-models.md,plugins}` (plus `antigravity-acp/mcp_oauth_tokens.json` when present).
   - Strips `~/.gemini/config/plugins/pstack/agents/` (custom agent files like `comment-sicko.md` and `poteto-agent.md`) so Antigravity 1.5.17+ sessions never trigger the 4x custom-agent quota multiplier.
2. **Install or update the `pstack` Antigravity plugin** if step 1 reported a missing or stale `pstack` pin. Read the pinned tag from `.claude/settings.json` or `.agents/pstack.json` (default `main`), install globally, strip its `agents/` folder, and re-run `--apply` so the T3 profile links `config/plugins`:
   ```sh
   git clone --depth 1 --branch <tag> https://github.com/michael-denyer/pstack-claude /tmp/pstack-claude
   agy plugin install /tmp/pstack-claude/plugins/pstack
   rm -rf /tmp/pstack-claude ~/.gemini/config/plugins/pstack/agents
   node <skill-dir>/scripts/migrate.mjs --apply
   ```
   Never symlink `.agents/plugins/pstack` inside a repo; `agy` ignores symlinked project plugins.
3. **Install shared global `ustack` skills** if missing (`start`, `cleanup`, `skill-audit`, `resume-failed`):
   ```sh
   npx --yes skills add udecode/ustack --skill start cleanup skill-audit resume-failed --agent antigravity claude-code --global -y
   ```
4. **Install required companion CLIs** if step 1 reported either missing:
   - OpenCode `browse` (required for signed-in Chrome and native clipboard):
     ```sh
     curl -fsSL https://opencode.ai/browse/install | bash
     ```
   - `cua-driver` on macOS (required for native macOS app control):
     ```sh
     curl -fsSL https://cua.ai/driver/install.sh | bash
     ```
5. **Verify**:
   - Run `node <skill-dir>/scripts/migrate.mjs --check` and resolve any remaining automatable `todo:` items (if a profile has a non-empty local file conflicting with a symlink, tell the user instead of overwriting it).
   - If the repo has `node .agents/rules/contributor-setup/scripts/doctor.mjs`, run it and apply any automatable `fix:` lines until it prints `ok:` (carry any human-only `fix:` lines, such as `mac-watchdog` `sudo` install, into the final checklist).

## Project-only MCPs

Keep `~/.gemini/config/mcp_config.json` limited to tools needed in every repository. Scope project-only MCPs (for example Linear or ReUI) in a workspace plugin at `<repo>/.agents/plugins/<name>/` so their tool schemas load only in that repository and do not bloat every other project's prompt prefix:

- `<repo>/.agents/plugins/<name>/plugin.json`:
  ```json
  {
    "name": "<name>",
    "version": "1.0.0",
    "description": "Project-scoped MCP servers for <name>"
  }
  ```
- `<repo>/.agents/plugins/<name>/mcp_config.json`:
  ```json
  {
    "mcpServers": {
      "linear": {
        "serverUrl": "https://mcp.linear.app/mcp"
      }
    }
  }
  ```

## Reply with the manual checklist

End your reply with a brief list of what changed plus this exact checklist (omit only items `migrate.mjs --check` already verified complete, and fill in the real `<skill-dir>` path):

```markdown
### Manual checklist

- [ ] **Quit and reopen T3 Code, then start a fresh Antigravity thread** so linked MCPs, `pstack`, skills, `AGENTS.md`, and T3 settings load. If T3 overwrote `settings.json` on quit, close T3 and run `node <skill-dir>/scripts/migrate.mjs --apply --t3-only`, then reopen T3.
- [ ] **Ensure `AGY_CLI_FORCE_FILE_TOKEN_STORAGE=1` is set on every Antigravity provider instance before signing in, then sign in once per account:** Antigravity ignores T3's `AGY_ACP_FORCE_FILE_STORAGE`, so multiple accounts share one macOS Keychain slot and clobber each other without `AGY_CLI_FORCE_FILE_TOKEN_STORAGE=1`. After restarting T3 Code with that env var set on every Antigravity account, sign in once per account so each writes its own `antigravity-oauth-token` file.
- [ ] **Sign in to Claude (`opus`) and Codex in T3 Code** so fallback, UI/visual delegation, and multi-family panels work.
- [ ] **Pair the OpenCode `browse` Chrome extension** (for signed-in Chrome and native clipboard): install from https://chromewebstore.google.com/detail/mfnicocicmmlkpjnaffgihfjhdgjkdjg, run `browse pair`, and paste the pairing code in the extension until `browse status` shows `Extension: connected`.
- [ ] **Grant `cua-driver` macOS permissions** (for native macOS apps): run `cua-driver permissions grant` and approve Accessibility and Screen Recording for `CuaDriver.app` until `cua-driver permissions status` reports both `true`.
- [ ] **Import signed-in Chrome profile into T3 Browser (macOS):** System Settings -> Privacy & Security -> Full Disk Access -> enable T3 Code -> quit Chrome (`Cmd+Q`) -> T3 Settings (`Cmd+,`) -> Browser -> Browser profiles -> `+ Add profile` -> Import from Chrome -> allow Keychain (disable Full Disk Access afterward if preferred).
- [ ] **Complete OAuth for remote MCPs and add connectors:** finish browser OAuth when prompted. Put global connectors in `~/.gemini/config/mcp_config.json` as `{"serverUrl": "..."}`, and put project-only MCPs (such as Linear or ReUI) in `<repo>/.agents/plugins/<name>/{plugin.json,mcp_config.json}`. If you log in via `agy` CLI, re-run `node <skill-dir>/scripts/migrate.mjs --apply` to link `mcp_oauth_tokens.json`.
- [ ] **Add issue tracker API keys** (such as Linear) in T3 Settings -> Source control & issues.
- [ ] **Verify in the fresh thread:** run `node .agents/pstack/lead.mjs` (in a pstack repo) and confirm `gemini-4-neon @high`.
```

## Known T3 and agy limits

- **Multi-account token storage:** Antigravity ignores T3's `AGY_ACP_FORCE_FILE_STORAGE` env var, so multiple Antigravity accounts share one macOS Keychain slot and clobber each other unless every `driver: "antigravity"` instance sets `AGY_CLI_FORCE_FILE_TOKEN_STORAGE=1` before signing in. After adding it, sign in once per account so each writes its own `antigravity-oauth-token` file.
- **Profile isolation:** Adding another Antigravity account creates a new hash folder; re-run `migrate.mjs --apply` so the new instance gets `AGY_CLI_FORCE_FILE_TOKEN_STORAGE=1` and profile symlinks.
- **Size caps:** `agy` truncates rule files past 24,000 bytes and drops skills past ~16,000 description chars.
- **Large T3 MCP tools:** Tools with >1 KB schemas (`delegate_task`, `preview_open`, `preview_act`, `t3_thread_launch`, `create_threads`, `watch_pull_request`) run via `acp-mcp-call`.
- **Preview clipboard:** `preview_act` `Meta+c/v/a` does not drive native `<textarea>` clipboard; use `browse`.
- **Restart resume bug:** Resuming an old Antigravity thread after a T3 server restart can raise a false model-unavailable error; start a new thread or switch provider and back.
