---
name: avoid-feature-creep
description: Challenge proposed scope additions against the actual user outcome, current acceptance and delivery constraints without shrinking already-authorized work.
metadata:
  source: udecode/dotai
  source-path: skills/avoid-feature-creep
---

# Avoid Feature Creep

Read the requested outcome and current acceptance before judging an addition. Complete authorized scope; do not use minimalism to omit required capabilities or substitute a starter kit for a complete setup.

For a proposed addition, name the user problem, evidence, relationship to current acceptance, full implementation/maintenance cost and proof of benefit. Prefer an existing owner or a smaller change when it delivers the same outcome. Reject an abstraction, dependency, setting or feature that only solves an imagined future requirement.

Keep necessary caller migration, failure handling, verification and setup dependencies inside the outcome they enable. They are not scope creep merely because the original prompt did not list every implementation step. Conversely, available tools and agent suggestions do not authorize unrelated product work.

If a new user request changes scope, incorporate it and retain earlier compatible constraints. Surface a real product/cost tradeoff with a recommendation. Do not invent a waiting period, extra approval gate, commit rule or separate backlog just to enforce this skill.

Record material accepted/deferred/rejected additions in the existing plan. Finish the full promised result and state any actual exclusions plainly.
