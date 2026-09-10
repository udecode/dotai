---
name: security-triage
description: Triage GHSA, CVE, security advisory, and vulnerability reports with shipped-state proof before closing or fixing.
metadata:
  source: udecode/dotai
  source-path: skills/security-triage
---

# Security Triage

Read the [distribution runtime adapter](../setup-workflow/references/runtime.md). Triage does not authorize advisory closure, publication, external messages or product repairs; perform only the lane actually requested. Project test policy controls regression proof.

Use when reviewing a security advisory, GHSA, CVE, vulnerability report, SECURITY.md scope question, or draft security response.

Goal: high-confidence maintainer triage without over-closing real issues or shipping unnecessary regressions.

## Close Bar

Close only if one of these is proven:

- duplicate of an existing advisory or already-fixed issue
- invalid against shipped behavior
- outside the repo's documented `SECURITY.md` trust boundary
- fixed before any affected release, tag, registry package, or deployable artifact

Do not close just because `main` is fixed. If the latest shipped package, tag, app release, or hosted production behavior is affected, keep it open until the right shipped status exists.

## Required Reads

Before answering:

1. Read `SECURITY.md` when present.
2. Read the full advisory/report body, comments, labels, affected versions, and current status.
3. For GitHub private advisories, prefer the repo-scoped endpoint:

   ```bash
   gh api "repos/<owner>/<repo>/security-advisories/<GHSA>"
   ```

   Use public advisory endpoints only as fallback/public context, not as the repo truth.
4. Inspect the exact implicated code paths, tests, docs, package exports, and runtime boundary.
5. Verify shipped state with the right artifact source for the repo, for example:

   ```bash
   git tag --sort=-creatordate | head -n 20
   git tag --contains <fix-commit>
   git show <tag>:<path>
   npm view <package> version --userconfig "$(mktemp)"
   gh release list --repo <owner>/<repo> --limit 20
   ```

6. Search for canonical overlap: existing advisories, older fixed bugs, SECURITY.md scope text, duplicate issues/PRs, and release notes when relevant.

## Review Method

For each report, decide one of:

- `close`
- `keep open`
- `keep open but narrow`
- `fix now`

Check in this order:

1. Trust model
   - Is the prerequisite already inside trusted host, local user, plugin, maintainer, admin, or operator state?
   - Does `SECURITY.md` call the class out as out of scope or hardening-only?
2. Shipped behavior
   - Is the bug present in the latest shipped artifact?
   - Was it fixed before any affected artifact became public?
3. Exploit path
   - Does the report show a real boundary bypass, not just prompt injection, trusted local-state control, same-user process control, or helper-level semantics?
   - If data only moves inside trusted local/workspace/operator state documented by `SECURITY.md`, do not treat marker injection alone as a security bug.
4. Functional tradeoff
   - If a hardening change would break intended workflows, call that out before proposing it.
   - Prefer fixes that preserve user workflows over deny-by-default regressions unless the security boundary demands it.
5. Hardening separation
   - Separate "not a vulnerability" from "still worth hardening".
   - Recommend hardening only when it is concrete, low-risk, and preserves the documented trust boundary.

## Fix Lane

If the report is valid in a package or app repo, move from triage to the normal fix lane:

1. Reproduce or construct the smallest proof of the exploit path.
2. Patch the owning boundary, not just the symptom.
3. Add a regression test or advisory-specific proof.
4. Verify the package/app artifact that users receive.
5. Add release/changelog/advisory artifacts only when that repo's workflow requires them, and run public wording hygiene before publication.
6. Sync the advisory/issue/PR with a concise public-safe status.

## Public Wording Hygiene

- Treat every draft advisory as too detailed until proven otherwise.
- Before recommending publication or drafting public advisory text, redraft it down to what users need: affected products and versions, impact category, severity, high-level prerequisites, patched versions, mitigations, credits, and safe upgrade or detection guidance.
- Strip reproduction steps, payloads, exploit chains, exploit optimization advice, bypass variants, vulnerable code locations, patch diffs, raw commit hashes, PR numbers, branch names, and patch mechanics unless the maintainer explicitly asks for a private note.
- Keep enough technical context for defenders to judge exposure. If a detail mainly helps exploitation, keep it private.
- Prefer patched version and affected version fields over implementation narratives.
- Keep internal proof in local notes, plans, or PR evidence.
- For no-publish or hardening-only outcomes, thank the reporter, preserve credit when appropriate, state the trust boundary, and say clearly whether the report closes without publication.

## Response Format

For a maintainer-facing triage response:

1. Link or name the advisory/report.
2. Give the verdict.
3. State the trust boundary and shipped-state facts.
4. Cite exact code/docs/tests internally; public wording must be narrower when details would aid exploitation.
5. Separate optional hardening from vulnerability status.
6. If publication is in scope, include a public-safe redraft or explicitly say the existing wording is safe.
7. Name the next action: close, keep open, narrow scope, fix, publish, or release.

Keep tone firm, specific, and non-defensive.

## Decision Notes

- "Fixed on main, unreleased" is not enough to close a shipped vulnerability.
- "Attacker must already control trusted local state" is usually out of scope.
- "Same-host same-user process can already read/write the state" is usually out of scope.
- "Helper behaves differently than a config option" is usually a product bug, not automatically a vulnerability.
- If only the severity is wrong but the bug is real, keep it open and narrow the impact.
