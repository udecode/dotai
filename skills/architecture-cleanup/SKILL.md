---
name: architecture-cleanup
description: Simplify code ownership, abstractions and colocation while preserving the requested public behavior and complete caller contracts.
metadata:
  source: udecode/dotai
  source-path: skills/architecture-cleanup
---

# Architecture Cleanup

Choose delete, merge, inline, simplify, keep or defer from concrete ownership friction. File size, number of files and reuse counts are clues, not acceptance criteria.

1. Bound the requested owners and trace their complete consumers, mutable state and derived facts. Preserve domain meaning, human assignments, external contracts and settled product decisions.
2. Find shallow forwarding layers, duplicate decisions, shadow models, compatibility paths, pass-through types, needless component splits and hidden subscriptions.
3. Apply four questions: does deletion remove or spread complexity; how many owners must a reader visit for one behavior; how much interface must a caller learn; does the change preserve the current source of truth?
4. Prefer deep modules with small meaningful interfaces. Colocate one-owner behavior. Split for distinct state lifetime, subscription, measured render cost or real reuse, not merely length or hypothetical testability.
5. Migrate all internal callers, then remove obsolete entrypoints. Preserve independent hooks/state and side effects when merging. A public compatibility promise requires an explicit migration rather than an accidental break.
6. Run the narrowest relevant existing proof. Route a product behavior or contract change through `task` within actual authority. Do not weaken a check merely to make deletion pass.

Model mutually exclusive states as variants when useful; derive types from their owner; validate input at external boundaries. Keep error handling in the approved reporting/recovery owner. Avoid a generic utility library that merely relocates decisions.

Record material candidates, facts, decision, affected callers and proof in the current plan or short handoff. Keep reasons in comments only when they are non-obvious. No automatic new test, panel, unrelated rewrite or publication.
