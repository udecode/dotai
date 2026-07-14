---
name: linear-backlog
description: Run a scoped Linear backlog autonomously as a sequence of maximal safe parallel batches by composing orchestrator, autogoal, and task. Use when the user wants Codex to execute ordered Linear issues without prompting for each next batch while parallelizing every dependency-ready ticket that lacks a hard conflict.
---

# Linear Backlog

Run a frozen Linear queue as serial batches with parallel execution inside each
batch. Keep the parent as controller; send every implementation issue through
`orchestrator`, `autogoal`, and the repo's `task` skill.

## Required Capabilities

Require all of these before mutation:

- Linear issue read and write tools.
- `$orchestrator` with durable Codex child-thread tools.
- `$autogoal` and its goal tools.
- The destination repo's `$task` skill and AGENTS instructions.
- Git and the repo's normal PR and merge tooling.

If a capability is missing, report the exact dependency. Never replace durable
child threads with hidden sub-agents or fake Linear state transitions with
comments.

## Commands

- `$linear-backlog run <scope>`: execute the queue in maximal safe parallel
  batches.
- `$linear-backlog status`: report counts, active batch and lanes, conflict
  groups, blocked issues, and the next candidate batch.
- `$linear-backlog stop`: stop after parking every active lane safely and
  recording resumable state.

Scope may be a Linear project, cycle, label, saved view, or explicit issue list.
If the prompt and current context do not identify exactly one scope, ask one
short question before mutation.

## Non-Negotiable Contract

- Keep exactly one batch active at a time.
- Run every safe lane in that batch concurrently.
- Do not start the next batch until every lane in the current batch is
  queue-terminal and the batch join is recorded.
- Make each batch inclusion-maximal: no remaining dependency-ready issue may be
  added without a hard conflict or exceeding proven safe capacity.
- Never impose an arbitrary lane cap.
- Treat minor file overlap or an expected small merge conflict as a conflict
  group, not an automatic reason to serialize.
- Do not implement product code in the parent.
- Do not ask the user to say `continue` between batches.
- Do not widen an issue beyond its Linear description, acceptance criteria,
  linked source, and repo policy.
- Freeze queue membership at startup unless the user explicitly asks for
  continuous intake. State, dependencies, and ordering may still change.
- Re-read Linear after every issue transition and before planning each batch.
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
   - every batch has joined;
   - no child is still mutating code;
   - every completed issue has verified merge and Linear state evidence;
   - blocked count is zero.
   If blocked items remain after all eligible work is exhausted, close the loop
   as blocked under `$autogoal`; do not call the queue complete.
4. Create a queue ledger:

```md
| Batch | Order | Issue | State | Dependencies | Conflict group | Child | Branch / PR | Proof | Blocker / owner | Next |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
```

5. Record total, completed, blocked, active, and remaining counts after every
   transition.

The parent goal owns queue and batch completion. Each child owns a separate
issue-scoped autogoal.

## Build The Queue

1. Resolve the Linear team and its real workflow states.
2. Query the requested scope and read every candidate issue in full, including
   description, priority, project or cycle, state, labels, links, parent-child
   relationships, and blocking dependencies.
3. Exclude completed and canceled issues from runnable work, but keep them in
   the frozen ledger as already terminal.
4. Preserve explicit Linear ordering when exposed.
5. If no explicit order is available, sort dependency-ready issues by priority,
   then oldest creation time. Record this fallback once.
6. Keep dependency chains visible. A dependency and its dependent issue can
   never share a batch.
7. Never treat a broad project description as issue acceptance criteria unless
   the issue explicitly adopts it.

## Plan A Maximal Safe Batch

Build a fresh conflict graph from every dependency-ready, non-terminal issue.
Use issue source, likely owners, repo structure, current branches, runtime and
data requirements, and prior batch evidence. Lexical file guesses alone are
not proof.

Create a hard-conflict edge only when concurrent execution would be unsafe or
would invalidate proof, such as:

- a dependency relation;
- the same migration, schema contract, generated artifact, or exclusive config
  owner;
- overlapping destructive or proof-breaking writes to the same data;
- the same exclusive runtime, port, environment, credential, or deployment
  surface when it cannot be isolated;
- the same security or authorization policy mutation;
- source-backed evidence that both tickets must change the same unmergeable
  lines or API contract in incompatible ways.

Do not create a hard-conflict edge merely because tickets:

- belong to the same product area or package;
- touch adjacent components;
- may both update a barrel, lockfile, docs index, or generated summary;
- may produce a small normal merge conflict;
- use the same read-only service or test suite;
- have vague keyword overlap without source-backed ownership evidence.

Select the batch:

1. Start with candidates in recorded backlog order.
2. Add every candidate that has no hard-conflict edge with a selected issue and
   has a safe worktree, child thread, runtime, data strategy, and proof path.
3. Record soft overlaps in conflict groups for merge arbitration.
4. Revisit every excluded candidate. If the exclusion is only caution, minor
   overlap, or expected merge work, include it.
5. Stop only when no excluded dependency-ready candidate can be added safely.

A one-ticket batch is valid only when hard conflicts, dependencies, or real
capacity constraints force it. Record the reason.

## Batched Execution Loop

Repeat until no eligible frozen issue remains:

1. Refresh every non-terminal issue from Linear.
2. Recover and finish or park any already-active batch before planning another.
3. Plan the next maximal safe batch and record its lanes and conflict groups.
4. Read current AGENTS instructions and every selected issue's full source.
5. Remove and block only issues lacking an implementable outcome or auditable
   proof surface, then refill the batch from remaining safe candidates.
6. Through `$orchestrator`, create or reuse one durable child per issue and
   assign separate disposable worktrees, short-lived branches from `main`, PR
   target `main`, runtime owners, ports, data strategies, and cleanup rules.
7. Move every selected Linear issue to the team's active state with issue-update
   tools. Never represent state by posting comments.
8. Dispatch all batch children without waiting for one lane to finish before
   starting the next. Send each child:

```md
Run `$task` for <ISSUE-ID> as lane <LANE> of batch <BATCH>.

Use `$autogoal` in one-shot execution mode before implementation. The child goal
ends only when acceptance criteria, repo-required checks, relevant runtime
proof, PR body, push state, and task closeout are complete.

Stay inside the assigned worktree and issue scope. Follow AGENTS. Target `main`.
Respect the assigned runtime, data strategy, and conflict group. Report goal
state, changed files, checks, proof, PR URL/state, merge blocker, Linear
handoff, conflict risk, and exact next owner.
```

9. Supervise all lanes concurrently. Route new evidence to the owning child and
   let independent lanes continue when another lane blocks.
10. Do not plan the next batch while any current lane is implementing, testing,
    reviewing, repairing, merging, or still lacks a queue-terminal blocker
    packet.
11. When PRs are ready, choose a merge order from dependencies and actual
    conflicts. Serialize merges, not implementation.
12. Before each merge, integrate current `origin/main` into that lane using repo
    policy, rerun affected checks and proof, and never force push.
13. After each merge, tell unmerged sibling lanes to integrate the new `main`
    when relevant and rerun affected proof. Resolve only real conflicts.
14. Move each issue through the team's real review and completed states using
    Linear mutations. Verify merge, completed state, and child-goal closure from
    fresh reads.
15. Copy each closeout into the parent ledger, remove disposable worktrees, and
    archive finished children when their lane is terminal.
16. Mark the batch joined only when every lane is queue-terminal and all merge
    arbitration is resolved.
17. Refresh Linear, recompute the conflict graph, and start the next maximal
    safe batch automatically.

## Blocker Policy

Classify blockers instead of turning every snag into a user interruption:

- `dependency-local`: schedule the blocking issue in the earliest safe batch
  when it is in scope.
- `lane-local`: record evidence and next action, update the issue to a real
  blocked state when one exists, and let sibling lanes finish.
- `external-owner`: record the person, system, approval, or unavailable tool
  owning the next action; park the lane and continue the batch.
- `scope-authority`: stop the run only when the missing decision changes the
  meaning or safety of the whole queue. Ask one precise question.
- `repo-wide`: stop when checks, credentials, branch policy, infrastructure, or
  missing durable tools make every remaining issue unsafe or impossible.

Never silently skip a blocked issue. Never mark blocked work completed.

## Linear Discipline

- Resolve state ids or names from each issue's team before updating.
- Preserve team, project, cycle, labels, and parent relationships.
- Use issue mutations for state, assignment, and project changes.
- Use comments only for evidence, blockers, and handoff context.
- Re-read an issue after every mutation controlling routing or completion.
- Do not move an issue to completed merely because a branch exists or CI is
  green.
- Do not start an issue already owned by another active agent or human unless
  the user explicitly authorizes takeover.

## Resume Safely

On restart or compaction:

1. Read the parent goal and ledger.
2. Re-read the frozen Linear issue ids.
3. Inspect durable children, worktrees, branches, and PRs.
4. Reconstruct the active batch and its conflict groups.
5. Finish or park every active lane and record the batch join before selecting
   another batch.
6. Reconcile conflicting local and Linear state using fresh verifiable evidence,
   then continue the batch loop.

Never duplicate a child, worktree, branch, PR, or goal because context was lost.

## Stop And Complete

Finish the batch loop when every frozen issue is queue-terminal and every batch
has joined.

Complete the parent autogoal only when:

- every frozen issue is completed or canceled;
- every completed issue has verified merge and completed-state evidence;
- blocked count is zero;
- no code-mutating child remains active;
- every batch join is recorded;
- final counts reconcile with the frozen issue list.

If blocked issues remain, preserve evidence, owner or missing decision, and next
action, then keep or mark the goal blocked according to `$autogoal`'s tool
contract. Never convert a partial queue into a completed goal.

Final handoff must report:

- scope and frozen issue count;
- batch count and peak parallel lanes;
- completed, canceled, blocked, and remaining counts;
- merged PRs and merge order;
- blocked issues with owner and next action;
- whether the queue goal completed or remains blocked.

Do not stop after one successful batch while another eligible frozen issue
remains. That defeats the entire point of the skill.
