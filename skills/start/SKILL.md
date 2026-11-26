---
name: start
description: "Launch one or more standalone top-level T3 Code worktree threads (`t3_thread_launch` / `create_threads`) from a short prompt or the current chat's agreed plan. Use for /start, /start <task>, or spinning off independent work."
argument-hint: '[<task> | <task1; task2; ...>]'
---

# Start

Launch standalone top-level T3 Code worktree threads.

## Forms
- `/start <task>`: launch one thread with `t3_thread_launch` (`acp-mcp-call` when lazy).
- `/start`: distill this chat's agreed plan or next step into a self-contained brief and launch one thread.
- `/start <a; b; c>`: batch independent tasks with `create_threads`.

## Worktree defaults
- Run `node .agents/pstack/head.mjs` first if present in a trunk project.
- Pass `workspaceStrategy: { type: "worktree", baseRef: "origin/<default>", startFromOrigin: true }` (`origin/next` in Plate, `origin/main` otherwise; local base + `startFromOrigin: false` only for unpublished local commits). Never put checkout or worktree setup in the child prompt.
- Inherit project, provider, model, and modes unless asked for another model or effort.
- Title: `🥔 <2-4 words>` for pstack runs, plans, or audits; `<2-4 words>` for casual work.

## Boundaries and reply
- Use `/start` only for standalone user-facing threads that outlive this chat; keep parent-owned subtasks on `invoke_subagent` or `delegate_task`.
- Return each thread's clickable `link` verbatim in one short list without repeating its prompt.
