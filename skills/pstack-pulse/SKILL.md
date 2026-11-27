---
name: pstack-pulse
description: Show Claude Code and Codex pstack sessions on the iPhone lock screen through ActivitySmith and in the Mac menubar, with each plan's pipeline, and buzz when a session needs you, ships or fails.
argument-hint: install [--auto-update] | update | doctor | status | menubar | uninstall
disable-model-invocation: true
---

# pstack pulse

Mac daemon turning Claude Code and Codex hook events for pstack-titled sessions (starting with a pstack state emoji) into an ActivitySmith Live Activity summary card and a Mac menubar menu. Every command runs `node <skill>/scripts/pulse.mjs <command>`.

## Behavior

- **Summary card (iPhone):** One card across all active projects (shows up to 7 sessions + overflow, ordered needs-you -> failed -> working -> to-resume; finished `⚪` or bare-title sessions drop off). Groups repos by git origin.
- **Push notifications:** Sent only when blocked on owner (question, plan approval, unanswered ~6s permission prompt, API error, or dead working process) and away from Mac for 3+ minutes; cleared silently when resolved (ActivitySmith >=1.17.0). Never shows panel seats, smoke runs, headless `-p` runs, subagents, Codex exec/review threads, or `PSTACK_PULSE_OFF=1` sessions.
- **Check state:** A failing required check at turn stop marks the session red (no push) when run as a direct command (not chained or piped). Active background shells/subagents/servers keep a session in working state.

## Install & update

Install with `npx --yes skills add udecode/ustack --skill pstack-pulse --agent claude-code --global -y`.

1. Run `install` (add `--auto-update` for daily updates). Prints hook files, `daemon: started`, `menubar: started`, and session list URL.
2. Owner completes the 3 printed setup commands: Keychain ActivitySmith key (`security add-generic-password`), read-only `tailscale funnel`, and trusting Codex `/hooks`.
3. Allow macOS notification permission for menubar banners.
4. Run `doctor` until every line is `ok` or `warn`.

`update` runs `npx --yes skills update pstack-pulse --global --yes`; the daemon detects skill changes every 30s, refreshes hooks/menubar, and lets launchd restart it.

## Operations

- `status`: lists live sessions, phone cards, and badge count.
- `doctor`: checks Keychain key, daemon, menubar, hooks, Node >=22, session registry, and list secret.
- `menubar`: rebuilds and restarts `~/.pstack-pulse/PstackPulse.app` (`dev.pstack.pulse.menu`, compiled via `swiftc`). Supports `--dump` and `--test-banner`. Posts Mac banners when Claude needs you, dies, or finishes with no background work (suppressed while that session is focused).
- `pet`: optional floating desktop pet (`--snapshot` saves screenshots to `~/.pstack-pulse/`).
- `uninstall`: stops daemon/menubar, removes LaunchAgents and `--owner=pstack-pulse` hook entries, clears phone cards/badge, preserves `~/.pstack-pulse/`.
- Logs: `~/Library/Logs/pstack-pulse.log`, `~/Library/Logs/pstack-pulse-menu.log`, state in `~/.pstack-pulse/` (bad inbox events move to `inbox/bad/`).

## Tests

`node --test <skill>/scripts/pulse.test.mjs`
