---
name: openclaw-sync
description: Analyze local OpenClaw repos to sync agent setup into our own skills, AGENTS docs, VISION docs, templates, and workflow rules. Use when asked to pull lessons from ../openclaw, compare current agent setup with latest OpenClaw, or classify potential imports as new, smart-merge, or reject.
metadata:
  source: udecode/dotai
  source-path: skills/openclaw-sync
---

# OpenClaw Sync

Use this to treat `the explicitly selected OpenClaw checkout` as a reference corpus for
agent setup. The job is not to copy OpenClaw. The job is to extract better
maintainer loops, proof contracts, skill boundaries, VISION/AGENTS patterns,
review gates, and automation ergonomics into our setup.

Read the [distribution runtime adapter](../setup-workflow/references/runtime.md) before applying this method. Respect compare-only scope; classify candidate improvements without applying them when the request is read-only. Resolve the script relative to this skill directory.

## Command

Run this first from the repo you want to improve:

```bash
node "$HOME/.agents/skills/openclaw-sync/scripts/openclaw-sync-report.mjs" \
  --openclaw-root "$HOME/git/openclaw" \
  --target "$PWD" \
  --global-skills "$HOME/.agents/skills" \
  --out .tmp/openclaw-sync/report.md \
  --json .tmp/openclaw-sync/report.json
```

Use `--refresh` only when the user authorized refreshing the local source clones with
`git pull --ff-only` before comparison. Drop it when offline or when you need a
stable snapshot.

Use `--max 300` for a broad review. Keep console output capped; inspect the
JSON/Markdown artifacts for the full matrix.

The report applies `docs/sync/openclaw/decisions.json` by default when that
file exists. Use `--decisions <path>` for a different ledger.

## Workflow

1. Run the report command.
2. Read the summary counts first.
3. Open the strongest `new` and `smart-merge` rows by source path.
   Public maintainer-input files are always high-signal enough to inspect even
   when the raw report scores them as low reusable-agent signal:
   `CONTRIBUTING.md`, `SECURITY.md`, `.github/PULL_REQUEST_TEMPLATE.md`,
   `.github/ISSUE_TEMPLATE/**`, `VISION.md`, `AGENTS.md`,
   `docs/automation/standing-orders.md`, heartbeat/automation runbooks, and
   maintainer/security intake docs.
4. For each candidate, inspect source, not just title/description.
5. Classify with the rules below.
6. For source-backed pure improvements, patch our own setup without asking the
   user first.
7. Ask the user only when the candidate differs from root `VISION.md`, changes
   product/editor taste, alters human authority boundaries, or creates a risky
   public/API/skill-topology fork.
8. Record the decision in `docs/sync/openclaw/decisions.json` when the row is
   accepted, already covered, quarantined, or rejected after source review.
9. Produce an owner-patch queue before handoff: group accepted or likely
   accepted rows by destination owner, name the exact local files to patch,
   and mark each as `patch-now`, `ask-user`, `quarantine`, or `reject`.
10. Validate with the destination repo's sync/validation command.

If the target repo uses generated skills, patch the source rule or package
source, then regenerate. Do not hand-edit generated `SKILL.md` mirrors.

## Classification

`new` means OpenClaw has a reusable owner we do not have.

Accept only when all are true:
- the problem recurs in our repos;
- the skill/rule is generic enough after removing OpenClaw product names;
- the destination owner is clear: global skill, repo-local rule, template,
  `VISION.md`, `.agents/AGENTS.md`, or docs;
- the first run can be verified without cloud-only infra.

Scoring override:

- Do not reject public intake, maintainer-runbook, security-policy, PR-template,
  issue-template, standing-order, heartbeat, AGENTS, or VISION docs from the
  table score alone. These files often contain the strongest agent-maintenance
  invariants while looking like low generic signal to a filename scanner.
- Inspect the source and import the mechanism when it improves local
  maintainer loops, proof gates, authority boundaries, handoff fields, or
  contributor intake.
- Still reject product-specific plumbing after source read: crabbox/cloud
  workers, channel bots, release channels, hosted runtime assumptions, and
  repo-specific team/process details.

`smart-merge` means we already have a local owner, but OpenClaw has a stronger
rule, checkpoint, command, proof gate, or handoff shape.

Auto-merge at section level when it is a pure improvement:
- keep our repo commands, package manager, branch policy, browser policy,
  release policy, and product vocabulary;
- import the invariant, not the prose;
- prefer stricter proof and clearer stop conditions;
- remove stale local text if the OpenClaw rule supersedes it.

Pure improvements do not need user consent. Examples:
- stricter evidence gates;
- clearer stop conditions;
- better handoff fields;
- less ambiguous checkpoint wording;
- stronger source-audit or generated-mirror checks;
- removal of duplicated or stale local guidance when the current `VISION.md`
  already implies the better rule.
- deterministic maintainer queue/run ledgers that reduce duplicate work while
  preserving local-only authority boundaries.

Ask the user before merging when the candidate:
- conflicts with or meaningfully extends root `VISION.md`;
- changes public API, release, security, contributor, or product taste;
- changes what agents may do without human approval;
- creates, renames, deletes, or merges skills in a way that could alter routing;
- depends on OpenClaw-only cloud/runtime assumptions;
- is better in one repo but would weaken project boundaries.

`reject` means no import.

Reject when any is true:
- product-specific OpenClaw plumbing: crabbox, Discord/Telegram bots, release
  channels, Feishu/QQ, OpenClaw app/runtime internals;
- cloud/orchestrator assumptions we cannot run locally;
- weaker than our existing skill;
- duplicates a loaded global/plugin skill;
- conflicts with current repo taste or `VISION.md`;
- useful idea, wrong owner. Record the better owner instead of importing.

Already-covered rows are `reject`, not backlog. Do not create work to rename
equivalent things.

Decision ledger statuses:

- `accepted`: local owner changed or should own the imported invariant.
- `covered`: current local owner already covers the invariant; no patch needed.
- `quarantine`: useful lead, but owner/source/infra/user authority is not ready.
- `reject`: no import.

Only write a ledger row after reading the source and naming the local owner or
reject reason. Do not bulk-mark rows just to make the report quieter.

## Skill Topology Authority

This skill may update existing skills and may create a new skill, but only after
source-backed classification.

Default order:

1. Patch the existing owner.
2. Add a section to the existing owner if the invariant is related but missing.
3. Create a new skill only when no current owner fits, the workflow recurs
   locally, and the first verification command can run without OpenClaw-only
   cloud/runtime services.

For every proposed skill topology change, record:

- OpenClaw source path and reusable mechanism.
- Local owner considered and why it did or did not fit.
- Destination: global skill, repo-local source rule, AGENTS, VISION, plan
  template, docs, or scratch artifact.
- Trigger sentence, non-goals, first validation command, and expected handoff.
- Merge/reject/quarantine decision for overlapping local skills.

Never create a wrapper skill that only renames an existing local skill. Merge or
delete overlap instead. If the target repo uses generated skills, patch the
source rule and regenerate. If the target is a global hand-written skill under
`~/.agents/skills`, edit that skill directly and keep the change generic.

## Destination Owners

- Global reusable workflow: `the selected global skill source`
  plus scripts only when deterministic comparison or validation is repeated.
- project local workflow: `.agents/rules/**` source files, then
  the project's actual generator to sync discovery mirrors.
- Shared cross-repo behavior: use `sync-skills` dotai mode when the change
  belongs in `the resolved dotai shared checkout` before downstream repos.
- Public contributor fit: root `VISION.md`.
- Agent execution taste: local `vision` skill/rule when the repo has one.
- Plan/checkpoint shape: `docs/plans/templates/**`.
- One-time research: docs/research or a scratch artifact, not a skill.

## Review Standard

For each accepted row, answer:

- What OpenClaw source proves the pattern?
- What local owner should change?
- Is this `new` or `smart-merge`?
- What exact local text/script/test changes?
- What command proves the destination still works?
- What did we reject and why?

For broad sync requests, also produce:

- owner group;
- source rows included;
- local files to patch;
- validation command;
- authority or VISION conflict;
- `patch-now`, `ask-user`, `quarantine`, or `reject` decision.

Never patch from a row title alone. Read the file and extract the reusable
mechanism.

## Handoff

Report:

- command and artifact paths;
- `new`, `smart-merge`, `reject`, and already-covered counts;
- accepted candidates with source path and destination owner;
- owner-patch queue with files and validation commands;
- rejected candidates with concrete reason;
- files changed;
- validation commands;
- next OpenClaw sync checkpoint.
