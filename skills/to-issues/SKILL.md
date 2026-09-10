---
name: to-issues
description: Slice a settled PRD or plan into the fewest self-contained delivery issues and publish them only within explicit tracker authority.
metadata:
  source: udecode/dotai
  source-path: skills/to-issues
---

# To Issues

Read the complete source PRD/plan, current milestone, existing issues and human assignments. Resolve unsettled product decisions through their planning owner before slicing.

Prefer one issue when it can deliver the outcome. Split only for independently useful behavior or a real security, risky migration, incident, data or external-authority boundary. Technical independence and available workers alone do not justify more issues.

Each issue must stand alone:

- Title/opening names the beneficiary, resulting behavior, consequence and intended proof environment.
- Body contains the full promised behavior and acceptance IDs, important failure/access states and required proof.
- Links identify the source PRD/plan, actual project/milestone, dependencies and completion owner.
- Internal implementation phases stay inside acceptance or subtasks by default.
- Settled design is linked and honored; implementation removes temporary fixtures.

Exactly one delivery issue owns final reconciliation of the PRD when several issues contribute. Preserve human-assigned work without duplicating it. Consolidate overlap before creating another issue.

Without publication authority, return reviewable slices. With it, resolve the real tracker project and destination document first. Create/update one issue, read back body/project/milestone/parent/state, then proceed to the next. A tool's write acknowledgment alone is not read-back. Use the native state field for status, not a comment.

Use full-body external PRD documents when recipients lack repo access. Never claim completed implementation or deployment from issue creation. Report verified issue links and unresolved slicing/readiness gaps.
