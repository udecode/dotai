---
name: worktree-workspace
description: "Open every git worktree of a project in one VS Code window, each folder labeled by its agent session's title. Use for /worktree-workspace, reviewing worktrees in VS Code, or seeing which worktree holds which task."
argument-hint: '[--all]'
---

# Worktree workspace

Run `node <this skill>/scripts/workspace.mjs --repo <checkout> --open` from any folder. It writes `<checkout parent>/<repo>-worktrees.code-workspace` and opens it in VS Code.

The script labels folders and never moves them, because the app tracks a session by its working folder, and a title changes at every stage.

- The main checkout comes first, labeled `<repo> · <branch>`.
- A worktree a session works in shows that session's latest title, with `(archived)` when it is archived.
- A worktree with no session of its own, such as one a session made from inside another folder, shows its folder name and last commit subject.
- A label two folders share gets ` · <folder>` appended.
- The script lists only worktrees under `<checkout>/.claude/worktrees`. `--all` adds the rest, such as scratch proof worktrees.

Titles come from `--sessions <file>`, a JSON array with each session's `cwd` and `title` (Claude Code desktop's `list_sessions` output works), or else from the Claude desktop app's session store. The store's format is private, so the script stops with an error when it changes instead of writing unlabeled folders.

Rerun the command to refresh labels; VS Code reloads an open workspace file when it changes. Report the path and the label list it prints.
