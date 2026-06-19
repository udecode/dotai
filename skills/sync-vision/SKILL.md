---
name: sync-vision
description: Sync root VISION.md from changed human and agent inputs; use when project taste, doctrine, or maintainer judgment should learn from recent plans, docs, skills, reviews, or repeated misses.
disable-model-invocation: true
---

# Sync Vision

Handle `$ARGUMENTS`.

`VISION.md` is living project taste. Treat it like the project doctrine layer:
learn from repeated human answers, agent misses, plans, docs, skills, research,
reviews, and handoffs, then ignore noise.

This skill is the incremental sync lane. It does not replace a `vision` router.
It keeps root `VISION.md` current by analyzing changed durable inputs since the
last synced commit. Root `VISION.md` is the mandatory essential read and single
project vision source.

## Autogoal Dependency

Use `autogoal` before mutable work. This is a derived autogoal workflow.

- Prefer a repo-owned `docs/plans/templates/sync-vision.md` when it exists.
- Otherwise use the `autogoal` `task` template with `agent-native` and `docs`
  packs when available.
- Default flow: one-shot sync.
- Preview flow: one-shot planning, no vision-doc patch and no baseline
  advancement.
- Required evidence: command, artifact, source audit, classification ledger,
  and N/A rows.
- `autogoal` owns lifecycle, first-checkpoint requirement extraction,
  completion semantics, output-budget discipline, and `check-complete.mjs`.
- `sync-vision` owns input-range accounting, candidate classification, root
  doctrine patch rules, status semantics, and baseline advancement.

Goal handle shape:

```txt
Sync vision; done when changed inputs are classified, VISION.md is patched or reaffirmed, baseline semantics are recorded, and checks pass; plan docs/plans/<path>.md.
```

## State

Durable state lives in:

```txt
docs/sync/vision/status.json
docs/sync/vision/runs/<date>-<base>-to-<target>/
```

`status.json` fields:

- `lastSyncedCommit`: every relevant committed input through this commit has
  been classified as `captured`, `reaffirmed`, `rejected`, `run-specific`,
  `owner-routed`, or `deferred-with-question`.
- `lastSyncedAt`: when the baseline was advanced.
- `lastRunDir`: latest run artifact directory.
- `lastTargetCommit`: latest target commit analyzed.
- `pendingRunDir`: run with unresolved decisions, or `null`.

Never advance `lastSyncedCommit` merely because artifacts were written. Advance
only after the committed range is fully accounted for. Working-tree overlays
are visible in artifacts but are not baselined until committed.

Working-tree overlays include relevant untracked files. New doctrine docs,
plans, rule files, and root docs must be visible in artifacts before commit,
but they are not baselined until committed.

## Optional Config

Projects may customize the helper with:

```txt
docs/sync/vision/config.json
```

Supported fields:

- `includePathspecs`: extra git pathspecs to collect.
- `exactInputFiles`: extra exact file paths.
- `inputPathPrefixes`: extra directory prefixes.
- `excludePathPrefixes`: extra excluded prefixes.
- `trackedExts`: extra text-like extensions.
- `patterns`: extra candidate regexes by category.

Keep config project-local. Do not put private URLs, account IDs, or temporary
branch state in dotai.

## Commands

- `status`: read `status.json`, current `HEAD`, committed diff count, and
  working-tree overlay count. No writes.
- `preview`: write run artifacts and recommendations. Do not patch `VISION.md`.
  Do not advance baseline.
- `sync`: default. Write artifacts, patch root `VISION.md` for
  high-confidence reusable decisions, route non-vision owners, and advance
  baseline only if all committed inputs are classified.
- `advance`: update `status.json` to current `HEAD` only after the active plan
  proves the range is fully accounted for.

Use the helper for accounting from the project root:

```bash
node .agents/skills/sync-vision/scripts/collect-vision-diff.mjs --status
node .agents/skills/sync-vision/scripts/collect-vision-diff.mjs --dry-run
node .agents/skills/sync-vision/scripts/collect-vision-diff.mjs
node .agents/skills/sync-vision/scripts/collect-vision-diff.mjs --advance --plan docs/plans/<plan>.md
```

The helper writes:

- `changed-files.tsv`
- `candidate-lines.tsv`
- `summary.md`
- `run.json`

## Default Input Scope

Analyze changed durable inputs, not the whole repo every time:

- `VISION.md`
- `AGENTS.md`
- `.agents/AGENTS.md`
- `.agents/rules/**`
- `skills/**` when the repo uses top-level source skills, as dotai does
- `docs/plans/**`
- `docs/sync/**` except `docs/sync/vision/runs/**`
- `docs/research/**`
- `docs/solutions/**`
- `content/docs/**`
- other Markdown-like root docs when they appear in the changed-file list

Generated `.agents/skills/**` mirrors are not primary input when a source rule
or top-level `skills/**` source exists. Use generated mirrors only for sync
audits.

## Classification

Every candidate line or theme becomes one of:

- `captured`: patch root `VISION.md` with a compact latest-state rule.
- `reaffirmed`: already covered by root; record the section.
- `rejected`: stale, one-off, contradicted, too narrow, or not project taste.
- `run-specific`: belongs in the active plan only.
- `owner-routed`: belongs in a skill/rule, research doc, benchmark target,
  package docs, product spec, behavior spec, or migration guide instead of
  `VISION.md`.
- `deferred-with-question`: missing taste; queue one concise question and do
  not advance the baseline unless the range can be safely accounted for without
  it.

Promote to root `VISION.md` when the rule is reusable project doctrine: global
taste, source order, cross-boundary law, public API doctrine, proof standards,
review attention, owner-specific doctrine, or supervisor stop conditions.

Do not promote:

- temporary command output;
- one-off route state;
- old branch summaries;
- raw issue bodies;
- generated mirror noise;
- artifact paths;
- broad history that does not change a future decision.

## Sync Workflow

1. Load `autogoal`, create or continue a `sync-vision` plan, and copy every
   user requirement into checkpoint zero.
2. Read root `VISION.md`.
3. Read `docs/sync/vision/status.json` if present.
4. Run the helper in `status` or collection mode.
5. Read `summary.md`, `candidate-lines.tsv`, and the changed source files that
   actually contain high-signal candidates.
6. Cluster candidates by reusable decision, not by file.
7. Classify each cluster.
8. Patch root `VISION.md` only for `captured`
   clusters. Write current-state doctrine, not changelog prose.
9. Route owner-specific misses to the owner:
    - skill/rule miss -> local skill source or installed shared skill owner;
    - behavior law -> product behavior/spec docs or owning plan skill;
    - automation miss -> owning supervisor skill;
    - research-system miss -> research owner;
    - migration miss -> migration owner;
    - benchmark truth -> benchmark target/script owner;
    - docs/API mismatch -> docs or package owner.
10. Record a decision ledger in the plan or run summary.
11. If agent rules or shared skills changed, run the repo's generation or skill
    validation command.
12. Run the active plan completion checker when available.
13. Advance `lastSyncedCommit` only when the committed range is fully
    classified.

## Baseline Advancement

Advance baseline when all are true:

- committed diff range was collected from prior `lastSyncedCommit` to target;
- every candidate cluster has a classification;
- root `VISION.md` was patched or explicitly reaffirmed for reusable taste;
- owner-routed items have concrete owners;
- deferred questions are listed with recommendations;
- generated mirrors are synced when source rules changed;
- the active plan passes its completion check when one exists.

Do not advance baseline when:

- the run is `status` or `preview`;
- a candidate changes product/API taste and no default can be inferred;
- a source rule changed but generated mirror sync failed;
- the helper reports a git/ref error;
- only uncommitted overlay input exists.

## Final Handoff

Include:

- base commit, target commit, and whether baseline advanced;
- changed input count and candidate count;
- root vision doc changes;
- reaffirmed existing sections;
- rejected/noise clusters;
- owner-routed follow-ups;
- deferred questions;
- changed files;
- commands run;
- next `sync-vision` command.

Keep it short. The run artifacts hold the detail.
