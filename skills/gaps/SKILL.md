---
name: gaps
description: "Review a plan, or the execution of one, for gaps, missing cases, unproven claims and contradictions, read-only. Use for gaps <plan path>, a cross-model review hand-off, or a request to check a plan or finished work for completeness."
argument-hint: '<plan path>'
disable-model-invocation: true
metadata:
  source: udecode/dotai
  source-path: skills/gaps
---

# Gaps

Review $ARGUMENTS read-only: never edit, stage, commit or push, and never message anyone.

You are the second model on this work. The model that wrote it loses context over a long session, so check the work against what the user asked and what the files show, not against the plan's own account of itself.

## Read

1. The plan. Its `Asks` section quotes the user's requests verbatim, and its `Claims` section lists what the work claims and how each claim was established. Its `Status:` line picks the review: `planning` reviews the plan; `executing` or `done` reviews the execution against it. A plan without an `Asks` section is your first finding, because completeness then cannot be checked against the user's words.
2. The decision log beside it (`<plan>.decisions.tsv`), and every file, command and commit the plan or the log names.
3. For an execution, the commits the plan or the log lists (`git show --stat <sha>`, then each diff), or `git diff` of the paths the plan names when nothing is committed yet. The checkout may be shared, so changes to paths the plan does not name are not part of the review.
4. The project's agent instructions (`AGENTS.md` or `CLAUDE.md`), so each finding follows the project's own rules.

## Look for

- An ask with no step, or a step that answers a different ask.
- A step without proof, a proof that cannot falsify its claim, or a box closed without the artifact it names.
- A claim presented as measured that no command in the files supports. Recount it when a read-only command can.
- A contract, law or rule the work removes, weakens or contradicts, and anything that still depends on it: callers, tests, scripts, docs, CI and generated files.
- A rename or removal the steps would miss. Run `git grep` for each old name.
- A contradiction between the plan, the log, the instructions and the files.
- A step order that leaves the repository broken between steps.
- A case the plan never mentions but the code reaches: an input, a state or a path.

Rerun a cheap read-only check when it can settle a finding. Report findings; do not redesign the plan.

## Report

At most ten numbered findings, most severe first. Each names its severity (blocker, should-fix or note), the file and line or the command that shows it, and one sentence on what to change. Stay under 500 words. When there are none, say "no findings" and name what you checked.
