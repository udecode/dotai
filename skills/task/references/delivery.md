# Authorized delivery

Read current user and project policy before Git, issue, deployment or provider writes. Inspect the requested target and its actual state. Do not infer a branch name, remote, tracker project, release status or deployment environment from another repository.

Use the existing checkout unless the user or governing workflow selects another. Preserve unrelated work. Respect project staging policy; do not silently include or exclude unrelated files against it. A skill install or generic setup is never itself permission to commit, push, publish, change security settings or send messages.

Distinguish source edited, checks passed, committed, pushed, PR opened, merged, deployed and live verified. Only report the states established by read-back. If the request includes repairing a named live target and publication is authorized, carry the change through that target's native apply/deployment and final proof. Otherwise state the local or PR boundary.

For an actual PR, use `autoreview` once for the candidate and at most once for accepted corrections within its shared budget. Review never grants push authority. Write the final problem and resulting behavior, meaningful tradeoffs and validation; omit abandoned attempts. Resolve feedback through `resolve-pr-feedback` when requested.

For tracker publication, resolve the actual workspace/project, milestone and existing artifact before creating another. Use `to-issues`, `to-prd` or `to-milestone`. Full documents belong in the destination body, not a pointer to a local file the reader cannot access. Read back body and required metadata after each consequential write before reporting success.

Do not use an issue comment as a state change, a push as deployment proof, or a provider acceptance response as received-delivery proof. Missing access is an explicit delivery gap. Keep independently authorized work moving without fabricating completion.
