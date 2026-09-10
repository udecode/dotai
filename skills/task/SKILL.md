---
name: task
description: Carry an engineering request through source investigation, implementation, proportionate verification, and authorized delivery; also supports explicit plan-only and PRD work.
metadata:
  source: udecode/dotai
  source-path: skills/task
---

# Task

Own the requested outcome from intake to its actual completion threshold. Task is the lifecycle; other skills supply a method for a particular decision. Use the current project's instructions and optional `.agents/workflow.md` adapter for commands, environments, source authority, testing and publication. Missing adapters do not prevent ordinary work: inspect the owning files and existing commands.

## Select the outcome

| Request | Behavior |
| --- | --- |
| Ordinary edit, fix, implementation | Investigate the owner, make the authorized change, verify and finish. |
| `plan` / plan-only | Resolve scope, source facts, approach and proof; stop before implementation. |
| Read-only audit / review | Execute the inspection and report the complete requested denominator; do not repair product code. |
| `prd` | Use `to-prd`; stop at a buildable document and any explicitly requested publication. |
| `full` | Continue through planning if needed, implementation and requested proof/delivery. This word alone does not authorize publishing, a new checkout or external messages. |
| `clean` | Use `architecture-cleanup` for behavior-preserving simplification. |
| Issue, milestone, PR | Read the actual source artifact and current state. Use the corresponding planning or delivery owner within the request's authority. |

For a question or small wording-only edit, answer or edit directly. Do not create a plan, goal, reviewer or browser artifact just to follow this skill.

## Execute

1. Identify the outcome, source owner, complete affected callers, acceptance and proof surface. Preserve current user corrections, exact human assignments, settled decisions and explicit non-goals. Prior evidence is context, not new authority.
2. Use an accepted plan or known pattern directly. `how` resolves unclear source flow; `architect` or `arena` resolves a consequential unsettled design; `why` investigates missing rationale; `blast-radius` investigates consequential assumptions; `interrogate` challenges a contested design. Load the selected method once, not every linked skill.
3. For substantial work, keep one plan with outcome, boundaries, source-linked acceptance, decisions, evidence and next action. Read [planning](references/planning.md). Apply `autogoal` only for a direct or applicable standing goal request; tool availability alone is not permission. A file plan works when native goals are unavailable.
4. For a bug or a contradicted completion claim, read [diagnosis](references/diagnosis.md), then use `diagnosing-bugs` for a hard investigation. Establish the reported failure on its real surface before changing its owner.
5. Implement coherent batches sharing an owner and proof surface. Preserve every acceptance ID; a finding is not a separate lifecycle. Migrate coupled callers before deleting old paths. Do not add compatibility wrappers without a real compatibility requirement.
6. Choose the narrowest honest existing proof under [verification](references/verification.md). `verify-app` owns real operation and artifact evidence. A source check, test, runtime observation and deployed result prove different facts.
7. When Git, trackers, deployments or provider writes are in scope, follow [delivery](references/delivery.md). A local patch cannot close a named deployed repair whose publication was authorized. Do not invent publication authority from a task's size.
8. Reconcile every original acceptance item. Report what changed, what passed, the exact completion environment, and any remaining blocker. Continue independently actionable work until the requested outcome is achieved or a real blocker prevents it.

## Maintain continuity

Read [coordination](references/coordination.md) for resume, delegation or access trouble. On a direct pause, immediately persist `Status: Paused` and the saved next step in the existing plan, then stop. Automatic continuation does not resume paused work.

Repair in-scope fixture, verifier and tool friction through its existing owner. Use `maintain-workflow` for reusable workflow defects and `atlas` for an existing scene inventory. Do not start another project-wide audit, controller or goal merely to unblock the current operation.

Keep updates concise and useful: findings, changed assumptions, remaining uncertainty and the next discriminating check. Never claim an unperformed check, independent review, external write or received artifact succeeded.
