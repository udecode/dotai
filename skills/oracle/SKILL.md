---
name: oracle
description: Obtain an explicitly requested second-model review through the Oracle CLI using a minimal reviewed file bundle, capability checks and resumable sessions.
metadata:
  source: udecode/dotai
  source-path: skills/oracle
---

# Oracle

Use an installed Oracle CLI for a requested second-model investigation. Verify its current `oracle --help`, supported engines/models and available access before selecting commands. The skill does not install the CLI, provide credentials, grant a paid model or authorize uploading project data merely by being installed.

1. Define the exact question, required independent perspective and outcome. Read the current source and previous attempts. Use the smallest file set that contains the actual owner, callers and proof.
2. Write a self-contained briefing: project stack and commands, relevant file map, symptom and redacted exact error, what was tried, constraints and desired output. The reviewer has no implicit project context.
3. Preview the prompt/file bundle with the CLI's supported dry-run and files-report options. Inspect token/cost information and remove credentials, environment files, private payloads and unrelated content before transmission.
4. Select an actually available engine and model within user authority. A different name is not proof of independent model-family review. Do not infer current defaults from old examples or silently downgrade a requested model.
5. Run once and retain its session ID. A timeout does not mean a failed model run; use supported status/session commands to reconnect instead of paying for a duplicate.
6. Verify returned findings against real code, dependency contracts and applicable proof. Apply only authorized corrections through Task. Keep unsupported suggestions advisory.

If no compatible CLI/access is available, report the exact missing capability and preserve a reviewable prompt/file manifest. Do not call a direct inspection an Oracle review. The project's shared PR review budget still applies; this skill does not add a nested review or publication step.
