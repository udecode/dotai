---
name: linear-backlog
description: Run a scoped Linear backlog autonomously one issue at a time by composing orchestrator, autogoal, and task. Use when the user wants Codex to keep selecting, implementing, verifying, merging, and closing ordered Linear issues without prompting for each next item.
---

# Linear Backlog

Run a serial pull loop over a frozen Linear queue. Keep the parent thread as the
controller; send each implementation issue through `orchestrator`, `autogoal`,
and the repo's `task` skill.

## Required Capabilities

Require all of these before mutation:

- Linear issue read and write tools.
- `$orchestrator` with durable Codex child-thread tools.
- `$autogoal` and its goal tools.
- The destination repo's `$task` skill and AGENTS instructions.
- Git and the repo's normal PR and merge tooling.

If a capability is missing, report the exact missing dependency. Never replace
durable child threads with hidden sub-agents or fake Linear state transitions
with comments.

## Commands

- `$linear-backlog run <scope>`: execute the scoped queue serially.
- `$linear-backlog status`: report counts, active issue, blocked issues, and the
  next eligible issue.
- `$linear-backlog stop`: stop after parking the active issue safely and
  recording resumable state.

Scope may be a Linear project, cycle, label, saved view, or explicit issue list.
If the prompt and current context do not identify exactly one scope, ask one
short question before mutation.

## Non-Negotiable Contract

- Keep at most one code-mutating issue active at a time.
- Do not implement product code in the parent thread.
- Do not ask the user to say `continue` between eligible issues.
- Do not widen an issue beyond its Linear description, acceptance criteria,
  linked source, and repo policy.
- Re-read Linear after every issue reaches a queue-terminal state.
- Never select the next issue from a stale startup snapshot.
- Freeze queue membership at startup unless the user explicitly asks for
  continuous intake. State, dependencies, and ordering may still change.
- Never invent missing issues, acceptance criteria, or product decisions.

Queue-terminal means one of:

- merged, verified, and moved to the team's completed state;
- canceled by an authorized source;
- blocked with evidence, an owner or missing decision, and a concrete next
  action.

Opening a PR, passing tests, or finishing a plan is not queue-terminal by
itself.

## Start The Parent Run

1. Turn `$orchestrator on` and record the mode in parent status.
2. Use `$autogoal` to create one parent goal for the frozen queue.
3. Define the parent completion threshold as:
   - every frozen issue id is queue-terminal;
   - no child is still mutating code;
   - every completed issue has verified merge and Linear state evidence;
   - blocked count is zero.
   If blocked items remain after all eligible work is exhausted, close the loop
   as blocked under `$autogoal`; do not call the queue complete.
4. Create a queue ledger in the parent plan or status:

```md
| Order | Issue | State | Dependency | Child | Branch / PR | Proof | Blocker / owner | Next |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
```

5. Record total, completed, blocked, active, and remaining counts after every
   transition.

The parent goal owns queue completion. Each child thread owns a separate
issue-scoped autogoal.

## Build The Queue

1. Resolve the Linear team and its real workflow states.
2. Query the requested scope and read every candidate issue in full, including
   description, priority, project or cycle, state, labels, links, parent-child
   relationships, and blocking dependencies.
3. Exclude completed and canceled issues from runnable work, but keep them in
   the frozen ledger as already terminal.
4. Preserve explicit Linear ordering when the tool exposes it.
5. If no explicit order is available, select dependency-ready issues first,
   then priority, then oldest creation time. Record this fallback ordering once.
6. Keep unresolved dependency chains visible. If a blocker is inside the frozen
   scope, process that dependency before its dependent issue.
7. Never treat a broad project description as issue-level acceptance criteria
   unless the issue explicitly adopts it.

## Serial Issue Loop

Repeat until no eligible frozen issue remains:

1. Refresh every non-terminal issue from Linear.
2. Recover any already-active child, branch, or PR before selecting new work.
3. Select the first dependency-ready issue in the recorded ordering.
4. Read the destination repo's current AGENTS instructions and the issue's full
   source before dispatch.
5. Confirm the issue has an implementable outcome and auditable proof surface.
   If not, record an issue-local blocker and continue to the next eligible item.
6. Create or reuse one durable child thread and assign its disposable worktree,
   short-lived branch from `main`, PR target `main`, runtime owner, port, data
   strategy, and cleanup rule through `$orchestrator`.
7. Move the Linear issue to the team's active state with a Linear issue-update
   tool. Never represent state by posting a comment.
8. Send the child this contract:

```md
Run `$task` for <ISSUE-ID>.

Use `$autogoal` in one-shot execution mode before implementation. The child goal
ends only when the issue acceptance criteria, repo-required checks, relevant
runtime proof, PR body, push state, and task closeout are complete.

Stay inside the assigned worktree and issue scope. Follow AGENTS. Target `main`.
Report the goal state, changed files, checks, proof, PR URL/state, merge blocker,
Linear handoff, and exact next owner.
```

9. Supervise that child until it reaches a queue-terminal result. Do not start
   another code-mutating child while it is implementing, testing, reviewing, or
   repairing its PR.
10. When the PR is ready, obey repo policy for review and merge. Never mark the
    issue complete before merge and required proof.
11. Move the issue through the team's real review and completed states using
    Linear mutations. Add one concise evidence comment only when repo policy
    expects it.
12. Verify the merge, completed Linear state, and child-goal closure from fresh
    reads.
13. Copy the child's closeout into the parent ledger, remove the disposable
    worktree, archive the finished child, and release the slot.
14. Refresh Linear and continue automatically.

## Blocker Policy

Classify blockers instead of turning every snag into a user interruption:

- `dependency-local`: process the blocking issue first when it is in scope.
- `issue-local`: record evidence and next action, update the issue to a real
  blocked state when one exists, then continue with the next eligible issue.
- `external-owner`: record the person, system, approval, or unavailable tool
  that owns the next action; park the issue and continue when independent work
  remains.
- `scope-authority`: stop only when the missing decision changes the meaning or
  safety of the whole queue. Ask one precise question.
- `repo-wide`: stop when checks, credentials, branch policy, infrastructure, or
  missing durable tools make every remaining issue unsafe or impossible.

Never silently skip a blocked issue. Never mark blocked work completed.

## Linear Discipline

- Resolve state ids or names from the issue's team before updating.
- Preserve the issue's team, project, cycle, labels, and parent relationships.
- Use issue mutations for state, assignment, and project changes.
- Use comments only for evidence, blockers, and handoff context.
- Re-read the issue after every mutation that controls routing or completion.
- Do not move an issue to completed merely because a branch exists or CI is
  green.
- Do not start implementation for an issue already owned by another active
  agent or human unless the user explicitly authorizes takeover.

## Resume Safely

On restart or compaction:

1. Read the parent goal and ledger.
2. Re-read the frozen Linear issue ids.
3. Inspect durable child threads, branches, and PRs.
4. Finish or park the active issue before selecting another.
5. Reconcile conflicting local and Linear state in favor of fresh verifiable
   evidence, then continue the serial loop.

Never create a duplicate child, branch, PR, or goal because context was lost.

## Stop And Complete

Finish the serial loop when every frozen issue is queue-terminal and no child
is still mutating code.

Complete the parent autogoal only when:

- every frozen issue is completed or canceled;
- every completed issue has verified merge and completed-state evidence;
- blocked count is zero;
- no code-mutating child remains active;
- the final queue counts reconcile with the frozen issue list.

If blocked issues remain, preserve their evidence, owner or missing decision,
and next action, then keep or mark the goal blocked according to `$autogoal`'s
tool contract. Never convert a partial queue into a completed goal.

Final handoff must report:

- scope and frozen issue count;
- completed, canceled, blocked, and remaining counts;
- merged PRs;
- blocked issues with owner and next action;
- whether the queue goal completed or remains blocked.

Do not stop after one successful issue while another eligible frozen issue
remains. That defeats the entire point of the skill.
