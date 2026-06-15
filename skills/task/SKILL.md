---
name: task
description: Work a repo task end-to-end with issue intake, harsh pre-solution review, implementation, verification, and closeout.
---

# Task

Use this for normal repo work: bug fixes, public issue handling, small features,
docs updates, tooling fixes, and other concrete tasks that should end with
verified changes or an honest hard stop.

## Core Rules

- Read the real source of truth before solving: issue body, comments,
  screenshots, linked PRs, failing logs, specs, files, and current code.
- Prefer the best long-term fix over the nearest patch. If the real fix is an
  API, abstraction, or behavior contract change, do that.
- Keep the work scoped to the request and the surrounding ownership boundary.
- Do not trust a reporter's proposed fix until you have reproduced or disproved
  the underlying behavior.
- Be blunt in the analysis. Friendly is fine; fake certainty and soft-pedaled
  bad assumptions are not.
- If the task is not reproduced, invalid, out of scope, or not worth fixing,
  stop and report that clearly instead of manufacturing work.

## Intake

1. Identify the task shape:
   - public issue or bug report
   - PR feedback
   - direct code change
   - docs or agent workflow update
   - planning/research request
2. Load the governing repo instructions and any explicitly named skill.
3. Fetch linked issues, PRs, comments, images, logs, and videos before changing
   files.
4. Search the codebase for the reported surface, adjacent working examples, and
   previous tests.
5. If the task has a measurable outcome and the repo requires durable goals,
   create or update the repo-approved goal/plan before implementation.

## Public Issue Challenge Gate

For issues filed by other people, run this autoreview-style gate before
starting the solution. This is mandatory.

1. Restate the exact claim in falsifiable terms.
2. Separate observed behavior from reporter interpretation and suggested fix.
3. Reproduce the behavior through the lowest reliable layer first:
   - focused unit/package/source test or direct harness
   - existing repo-owned browser or integration test, such as Playwright, when
     the bug is user-visible and cannot be proven at source level
   - the repo-approved Browser tool, such as
     `[@Browser](plugin://browser@openai-bundled)`, against the real route or
     local app when tests cannot reproduce it
   - Browser screenshot or visual/native-state proof when screenshots, layout,
     selection, clipboard, drag/drop, IME, focus, or platform behavior matters
4. If no existing test can reproduce it, create the smallest honest repro test
   or harness before fixing.
5. If tests still cannot reproduce a browser-native claim, escalate to the real
   browser surface before deciding.
6. If the real browser surface still cannot reproduce it, hard stop and report
   the issue as not reproduced, with exact attempts and evidence.
7. If the issue is invalid or wont-fix, hard stop and explain why.
8. If the issue is partially valid, discard the weak suggested fix and pivot to
   the absolute best long-term fix for the valid behavior.

Do not continue into implementation until this gate has a clear outcome:
`reproduced`, `partially valid`, `invalid`, `wont-fix`, or `not reproduced`.

## Choosing The Fix

Before editing, decide what layer owns the bug.

- User-facing behavior bug: fix the product behavior and add proof at the
  user-visible surface when practical.
- Public API bug: fix the API contract, types, docs, and release metadata
  required by the repo.
- Internal logic bug: fix the source of the bad state, not the line where it
  happens to explode.
- Test-only failure: prove whether the product behavior is wrong or the test is
  stale before changing either.
- Docs bug: update reference docs for the latest state only; avoid changelog
  narration unless the repo asks for it.
- Agent workflow bug: update the source instruction/rule/template and any
  generated mirrors required by the repo.

If the correct fix is larger than the issue suggested, say so and do the larger
correct fix unless it violates scope.

## Execution

1. Make the smallest coherent change at the owning layer.
2. Add or update tests where they protect behavior, API contracts, or past
   regressions.
3. Avoid dead-code tests that only assert old code is gone.
4. Use existing helpers, patterns, and package boundaries.
5. Update docs, generated files, lockfiles, barrels, or changesets only when
   the repo rules require them.
6. Keep unrelated cleanup out unless it is necessary to make the fix correct.

## Verification

Run the cheapest proof that genuinely covers the risk, then escalate only as
needed.

- Focused repro test first.
- Package or touched-surface typecheck/lint next.
- Repo check only when the repo requires it or the blast radius justifies it.
- Browser proof for user-visible UI, native browser, selection, clipboard,
  drag/drop, focus, IME, or route behavior.
- External/provider proof when the visible output leaves the repo.

If verification is blocked, report the exact blocker and the highest evidence
you did obtain. Do not imply unrun checks passed.

## Review Gate

Before finalizing, review the diff as if you are trying to reject it.
Run the repo-approved autoreview skill/tool when available.

- Does it fix the reproduced claim, not just the proposed patch?
- Is the ownership layer right?
- Did it introduce a narrower special case where a general contract was needed?
- Are tests proving behavior through public surfaces where possible?
- Are docs and generated mirrors consistent with source?
- Is the final answer honest about remaining risk?

If the answer is bad, keep working. If the task is invalid or not reproduced,
close with that instead of coding.

## Final Handoff

Be concise and concrete:

- what changed
- what evidence proves it
- what could not be verified, if anything
- PR/commit/issue links when created by the active workflow

For public issues, include the challenge-gate outcome. If the issue was not
reproduced, invalid, or wont-fix, lead with that.
