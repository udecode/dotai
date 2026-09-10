# Bind proof to the requested result

Choose proof from the operation and risk, using the project's actual commands. Existing types, lint, focused checks, source inspection, real runtime actions, artifacts and deployment read-back are different evidence classes.

Default to no new test. Add the smallest public-behavior test only for one named, plausible, costly regression that existing checks or direct proof do not adequately protect. Do not add source-text assertions, copy/constant tests, implementation mirrors or a speculative matrix. Explicit TDD selects `tdd` for mechanics within the user's testing request.

During iteration, run the narrow affected checks. Broader required checks run once on the settled candidate. Repeat a passed check only when a changed dependency, environment, fixture, permission, state, artifact or uncertain binding invalidates it.

| Changed claim | Required kind of proof |
| --- | --- |
| UI, copy, navigation, access | Real route and state, meaningful narrow/mobile composition, action and persisted consequence through `verify-app`. |
| Backend or authorization | Actual public boundary, permitted/denied cases and relevant isolation; a screenshot alone is insufficient. |
| Data migration | Project-sanctioned rehearsal, recovery plan, integrity and actual persistence. Production data changes require their own authority. |
| Performance | Comparable baseline and candidate for the complete user operation: budget, warm p95, cold duration, payload and query/fan-out where relevant. Preserve correctness and workload. |
| Delivery/export | The final received/rendered artifact, not only a queued job or provider payload. |
| Agent workflow/helper | Source ownership, linked references, discovery, tool/capability routing and exercised helper behavior. No application suite merely for prose. |

Do not add caches, pooling, indexes or pagination without measurements naming the owner. Use the project's privacy-safe telemetry owner for runtime alerts; exclude synthetic canaries from breach claims. Telemetry does not authorize recurring monitoring or external messages.

For reference-product parity, inventory requirements independently of the replacement's routes. Map complete actor journeys, retained states, permission behavior and artifacts. Keep operation, interface, copy-owner and scene denominators separate. A nearby blocked policy decision does not park independent technical coverage.

Keep the existing scene inventory current through `atlas` when it exists. `walkthrough` presents final evidence and reuses captures; it does not add another browser sweep. Static design evidence never claims a runtime pass.
