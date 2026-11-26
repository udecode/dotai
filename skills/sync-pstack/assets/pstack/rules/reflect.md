<!-- # Shared rule file. sync-pstack renders it into each project's .agents/pstack/rules/; the grammar is in the skill's SKILL.md. -->
# Improve the workflow, Corrections and Agent files

This file says how reflect applies lessons, how `/pstack:correct` encodes rules structurally, and how agent files change. The pstack block in `AGENTS.md` points here. Edit its shared source in `udecode/ustack`.

- **Improve the workflow mid-task.** Fix any skill, rule, script, or helper that blocks the current task immediately in a separate commit. Run `/pstack:reflect` only when the owner asks.
  - **Subtract before you add.** Before adding a rule, guard, or script, delete dead rules, redundant validators, and overlapping instructions first. Keep prose budgets shrinking, never growing.
  - **Guard boundaries only.** Put runtime checks at real system boundaries (config files, CLI args, git pushes, PR creation, external APIs). Never build internal bureaucracy parsers or multi-hundred-line regex DSLs over agent notes.
  - **Structural fix replaces prose.** When a fix is structural (architecture, types, lint, or a check script), delete the prose rule it replaces instead of keeping both. Keep prose only for judgment that cannot be encoded structurally.
  - **Reflect scope.** Read the scoped transcript directly (starting at the triggering message, ending right before the reflect call, skipping other interleaved processes). Apply without waiting only crash/false-refusal fixes on existing helpers and zero-behavior-change rewordings that add no net words; send everything else to Backlog with `owner:` and `stop:`. Shared lessons go through `sync-pstack` in `udecode/ustack`.
<!-- # relies correct/SKILL.md "## Fix each class at the highest level that works" -->
<!-- # overrides correct/SKILL.md "Exceptions go on the offending line with a reason, an expiry date, and a human's approval." -->
<!-- # relies correct/SKILL.md "keep a table in the agent instruction file that pairs each rule with what enforces it." -->
<!-- # relies correct/SKILL.md "If the pattern is already common, fail only when a change adds more." -->
- **Corrections.** Fix recurring mistake classes at the highest level that works: architecture, types, lint/check wired into the blocking gate, then test, then prose last. For shell/tool mistakes, prefer a helper that removes the need over a deny hook over prose. Prove each new check fails on a real past mistake (not a synthetic fixture) and passes on the fixed version. Never raise a budget limit or quarantine a failing test to turn a red gate green. In the rules table, pair each rule with its enforcer and delete replaced prose in the same commit; a lint checks an exception's reason and expiry while the owner reviews config/baseline diffs.
<!-- # overrides reflect/SKILL.md "After approval, copy the skill folder there and edit the copy." -->
<!-- # overrides reflect/SKILL.md "Never open a PR or push." -->
- **Agent files.** Before cutting or folding a skill or command, check typed invocation history and verify its replacement works end-to-end. Never edit vendor skills installed from other repositories; override them outside the pstack block in `AGENTS.md` or in a project rule. Shared edits go to `udecode/ustack` via `sync-pstack` and are tested with `sync-pstack smoke` on a plain fake prompt before sharing.
<!-- if skiller -->
<!-- if regen -->
  After editing `.agents/rules/`, run `{{regen}}` and verify generated skills; never edit generated skills by hand.
<!-- end -->
<!-- if !regen -->
  After editing `.agents/rules/`, run `bunx skiller@latest apply` and verify generated skills; never edit generated skills by hand.
<!-- end -->
<!-- end -->
  Run user-scope `claude plugin` commands from the home directory so they do not rewrite `.claude/settings.json`.
