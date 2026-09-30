# Reproduction and contradicted evidence

Translate a bug report into a falsifiable operation: actor, route or entrypoint, fixture, input, action, expected result and observed wrong result. Separate the reporter's observation from their theory and proposed fix.

Reproduce through the smallest honest layer. A public function/CLI harness can prove a logic failure. A user-visible form, download, print, clipboard or native permission failure requires the real browser/OS surface. A delivery failure requires the received inbox, exported file or provider-native result. A database row cannot prove what a recipient saw.

Retain baseline evidence before editing. If the current candidate already changed, recover a safe baseline or temporary harness without destroying user work. Otherwise mark pre-fix proof missing. Do not disguise post-fix success as a reproduced failure.

Classify the report as valid, partially valid, not reproduced, invalid, won't fix or platform limitation. If it is partially valid, solve the valid behavior at its owner. If no honest reproduction is available, report the specific missing proof; preventative or diagnostic changes require scope that actually authorizes them.

For a hard bug, use `diagnosing-bugs` to construct a discriminating feedback loop, minimize, test ranked hypotheses, fix the cause and rerun the operation. Project test policy controls whether the temporary proof should become a permanent test. Do not retain payloads or private data in public artifacts.

When the user says a claimed fix still fails, read the prior claim and new evidence before patching again. In the existing plan record the prior claim, missed case, failed oracle and suspected owner. Repair the oracle when it checked the wrong route, actor, fixture, environment or layer. Compare a reportedly working reference at the caller, effective configuration, validation, request, response and received/persisted result.

An unsuccessful request proves that attempt failed; it does not prove the whole account, integration or environment unusable. Check supported alternatives and current configuration within existing authority. Keep the original failure distinct from its inferred explanation.

After correction, rerun the exact contradiction and original acceptance. State what was overclaimed, why the proof missed it, what changed and what now proves the result. Do not increase the completion claim beyond the observed evidence.
