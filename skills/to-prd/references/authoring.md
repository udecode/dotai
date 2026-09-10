# PRD contract

Use an existing project template where it preserves these facts. Do not add duplicate sections merely to match headings.

1. **Problem and consequence:** who is affected, what fails today, why the outcome matters.
2. **Chosen behavior:** representative actor operations and final persisted/received outcomes.
3. **Milestone fit:** governing launch thesis, current evidence, related work and why this is the next coherent unit.
4. **Source and domain:** canonical owners, meaningful terms, invariants, effective-time/missing-data semantics where relevant, evidence for externally sourced claims.
5. **Scope and exclusions:** complete promised behavior, exact human assignments, deferred capabilities and compatibility constraints.
6. **Design:** settled interaction/data contracts, actual implementation status, temporary fixtures and their removal owner; not applicable when no UI is involved.
7. **Acceptance:** stable IDs naming observable behavior and proof, including important failure/access states. Preserve the complete denominator.
8. **Dependencies and readiness:** supported, missing, blocked or explicitly waived, with evidence and the exact next owner/action. A prerequisite's narrow blocker must not absorb independent scope.
9. **Verification:** the highest honest existing operation boundary; relevant runtime, artifact, performance, security or migration proof. No new test unless project policy and a named regression justify it.
10. **Delivery and issue slicing:** the fewest independently useful outcomes, real external/security/data boundaries, exact completion environment and one overall completion owner.
11. **Decisions and open questions:** actual choices with reasons and unresolved facts; no abandoned attempts posing as requirements.

A useful diagram can explain actors, state or ownership; it does not replace the contract. Avoid a PRD made solely of implementation filenames. A technical boundary deserves a separate outcome only when it has an independent user, operational, security or migration consequence.

Before closing, reconcile against the latest source and related PRDs, confirm every required acceptance is represented and distinguish a buildable plan from implemented behavior. Refresh the existing milestone ladder without creating duplicate tracker work.
