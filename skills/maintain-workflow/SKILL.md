---
name: maintain-workflow
description: Maintain reusable agent workflows and compare methodology across projects. Use compare for instruction and execution drift, excluding product-specific differences; use sync to read upstream sources and apply relevant diffs through owned sources and current-project installs. Skip ordinary product edits and wording-only corrections.
metadata:
  source: udecode/dotai
  source-path: skills/maintain-workflow
---

# Maintain Workflow

Keep one reusable source for a general workflow, with explicit project adaptations.
Apply this skill during a workflow change; it is not a background watcher or another task controller.

For an ordinary change, inspect the affected instruction chain and its consumers, repair the authorized owners, and suggest any relevant downstream sync. Process the change once. Do not turn every edit into a catalog audit, new plan, review panel, or completion gate.

## Invocation

| Request | Action |
| --- | --- |
| `$maintain-workflow` | Maintain the affected workflow using the current task's scope. |
| `$maintain-workflow compare <projects>` | Compare the current project with named projects, or the explicitly supplied pair, without changing them. Follow [references/compare.md](references/compare.md). |
| `$maintain-workflow sync` | Read all upstream workflow sources in scope, reconcile relevant changes, and apply them through their owned sources and current-project installations. Follow [references/sync.md](references/sync.md). |
| `$maintain-workflow sync <source-or-skill>` | Run the same sync narrowed to the named source or skill and its required dependencies. |

These are skill modes, not shell commands. Requests such as “do these projects use the same methodology?” select `compare` even without the mode name. Comparison reports findings and proposed syncs; it does not apply them. Other automatic selection uses ordinary maintenance and never starts a full upstream sync on its own. An explicit read-only or plan-only request keeps sync read-only.

For an explicitly requested full audit or model/upstream migration, also read [references/audit.md](references/audit.md).

## Find the real owners

Read applicable instructions and inspect the changed skill, its loaded references, helpers, templates, and installation metadata. A generated `SKILL.md` is a discovery surface; its rule or package source owns the edit. Follow symlinks and lock/provenance records before assuming an installed copy is editable.

Classify the behavior before changing it:

| Kind | Owner and action |
| --- | --- |
| Reusable method | Maintain the established shared source within the authorized scope. Keep product names, paths, release rules, and infrastructure out of it. |
| Project adaptation | Keep domain mechanics, commands, fixtures, proof targets, and publication rules in the project-owned adapter. |
| Upstream/vendor method | Preserve the upstream method and its provenance. Use the established port or adapter; do not rewrite a protected installed copy. |
| Duplicate or obsolete rule | Migrate its useful behavior to the canonical owner, update callers, then remove the duplicate. |
| Unclear ownership | Trace the source before mutation. Keep any unresolved source/access conflict explicit. |

An instruction change in one project is evidence for a reusable improvement, not proof that every project should adopt it. Prefer the existing shared owner; do not create a generic wrapper around every local rule. If the task is local-only, keep shared-source changes as concrete proposals.

## Maintain behavior, not just file size

State the intended behavior change and the behavior that must survive. Read enough of the actual loading path to detect competing instructions: global/project rules, master skill, matched method, references, and relevant leaves.

Preserve useful upstream procedures, examples, and failure recovery. For pstack, compare complete skills and their referenced playbooks/principles with the project's pinned source and adaptation diffs. A short rewrite is not equivalent to reuse.

Remove contradictory ownership, repeated lifecycle instructions, stale tool mappings, and unnecessary mandatory work. Split a reference only when a real condition lets callers skip it; moving always-loaded text into another file does not reduce the work.

For throughput repairs, check the entry rules as well as the specialist method: conditional loading must survive every caller. Separate per-claim acceptance from execution batches; related operations may share one settled implementation/proof/delivery cycle within existing authority. Keep one canonical record per claim and update the existing checkpoint instead of adding parallel ledgers or command chronology. Reuse complete captures while their relevant bindings hold; require a named invalidating change before repeating passed proof. Follow the owning scheduler's explicit diagnostic bound and eligible-owner traversal; new information alone must not renew an exhausted investigation or repeatedly expand a blocked batch. Defer evidenced human-assisted prerequisites immediately with one help queue and a changed-state retry condition, keeping queued agent work unverified. Preserve the acceptance denominator, permission boundaries, required environments and truthful failure states.

Use the current runtime's tools, model availability, and authority rules. A model upgrade does not authorize a new goal, delegation, publishing, broader testing, or extra approval pauses. Keep explicit user preferences over generic upstream defaults.

Repair repeated execution friction at its existing owner. Missing fixture preparation, stale receipts, or a tool's inability to inspect a state are actionable workflow findings, not automatic human blockers. Inspect supported alternatives, preserve the original failed observation, and record the smallest authorized repair and its proof in the current plan. An assignment protects the exact attributed decision or change, not every technical caller of that owner. Do not infer a person's assignment from a module name. A paused or planning-only task permits the requested plan/workflow repair, but does not resume dependent implementation, provider writes, or publication; record unexecuted remedies as pending.

When repairing a premature blocker, fix the rule loaded by ordinary diagnosis or provider work, not only this maintenance skill. Require comparison with any reportedly working reference and separate observed failure from inferred limitation. Keep that method project-neutral; concrete systems, settings, receipts and corrected blocker states belong in the affected task plan or project adaptation.

Carry an authorized reusable change through its shared source and current-project adapter. Regenerate discovery mirrors with the project's actual generator; use its named installation path for shared skills. Preserve unrelated changes and protected packages. An unavailable shared checkout is a source blocker, not a reason to create a competing local implementation.

## Verify the affected workflow

When repairing recurring shell, search or artifact-query failures, use [command execution](references/commands.md).

Use existing skill/source validators and inspect generated discovery metadata, references, and helper behavior affected by the change. Check the actual rule path for the intended request and a plausible adjacent request that should remain outside scope. Exercise a changed helper when its behavior matters; frontmatter validation alone cannot prove it works.

Keep proof proportional to the change. Do not add source-text tests, run application suites for prose, or claim behavioral proof from a word count. Record concrete limitations, including untested live actions and unavailable tools. Use the existing task's evidence or plan when one exists; a small maintenance edit can close with a short receipt.

## Suggest propagation

Discover candidate projects from the user's configured repository sets and existing installation records. If `~/.agents/config.json` exists, inspect `syncedRepositories` for sources, named sets, repositories, and explicit agent destinations. Configuration identifies candidates; it does not authorize updating all of them. Do not crawl unrelated directories to manufacture a larger list.

For each materially affected candidate, suggest the named skill/rule, the verified source and target, and the relevant adaptation or conflict. Distinguish source-only changes from changes actually installed in a destination. A configured project is not confirmed current until inspected.

When propagation is authorized, reuse available `sync-skills` for source-aware reconciliation and `skills-update` for named configured refreshes. Read their current instructions. Preserve project forks and explicit agent destinations; inspect the dry run before applying. Never substitute an unscoped `skills update`, wildcard install, or all-project refresh. Do not fetch an old remote revision over an unpublished local source change.

Global installation is a separate destination and must be in scope. Preserve existing user/global instructions while adding only the routing needed for discovery. Ordinary maintenance does not create an automation, commit, push, or publish anything.

Close with what changed, what was verified, where it is installed, and any useful named sync suggestions. If there is no reusable delta or affected destination, say so briefly and stop.
