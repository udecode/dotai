---
name: session-transfer
description: Export the Claude desktop app's Code-tab sessions before switching accounts, and import them back into the new account so they reappear in the sidebar with their worktree, branch, PR and history. Use when the user switches Claude accounts, asks to export, back up, move or import sessions, or finds their sessions missing after a switch.
---

# session-transfer

The desktop app keeps one JSON record per Code session in `~/Library/Application Support/Claude/claude-code-sessions/<a>/<b>/local_<id>.json`, one `<a>/<b>` folder per account. The sidebar shows only the signed-in account's folder, so after a switch the sessions look gone. Everything else a session needs is shared by the macOS user, not the account: its conversation (`~/.claude/projects/<cwd>/<cliSessionId>.jsonl`), its worktree and branch on disk, and the worktree registry (`git-worktrees.json`, leased by session id). Copying the records into the new account's folder brings the sessions back as they were.

`<skill>` is this skill's base directory. The script is `python3 <skill>/scripts/session_transfer.py`; below it is `st`.

## Modes

### export (before switching)

1. Preview: `st export --dry-run`. By default it takes only recently active sessions: unarchived, active in the last 2 days, with their worktree or folder still on disk, and not no-folder (scratch) sessions. Widen with `--since-days N`, `--all` (no time window), `--include-gone` (worktree deleted), `--include-archived`, `--include-scratch`; narrow with `--repo NAME` (repeatable).
2. Run the same command without `--dry-run`. It writes `~/.claude/session-exports/<timestamp>/` (mode 700) with `records/`, `manifest.json` and a readable `index.md`. Records are small, tens of MB in all.
3. `--with-transcripts` also copies the conversations into the export. They are several GB and stay in `~/.claude/projects` across a switch, so use it only when that folder might be cleaned or the export leaves this Mac.
4. Tell the user the export path and the session count.

### import (after switching)

1. Run it from any Code session in the new account; that session's record is what marks the signed-in folder. `st folders` lists the folders and marks it.
2. Preview: `st import --dry-run` takes the latest export; pass an export folder to choose another. It refuses when the signed-in folder is the export's own source, which means the switch has not happened.
3. Run `st import`. It adds each record the target lacks, resets the account-bound connector fields (`remoteMcpServersConfig`, `connectorKeyHolders`), restores any transcript missing from `~/.claude/projects` when the export holds one, and counts sessions whose folder no longer exists (`--verbose` lists them, and every session).
4. Records already in the target are skipped. `--force` replaces them and backs the old ones up in the export folder under `import-backup-<time>/`.
5. It writes `imported.json` in the export folder: the sessions that can run, which excludes those whose folder is gone. Tell the user to quit and reopen the Claude app; the sidebar reloads the records on start. When they are back, check with `list_sessions` that those sessions appear.

## Limits

- Connectors and published artifacts belong to the old account. Re-add connectors in the new one; artifact links in a session may not open.
- No-folder (scratch) sessions live under a folder named for the old account, so they are excluded by default.
- If a record does not come back, the fallback is a new session in the same worktree: start one with `cwd` set to the record's `cwd`, and brief it from `index.md` and the old transcript.
