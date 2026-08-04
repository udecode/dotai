---
name: walkthrough
description: Create a short annotated visual walkthrough from real final-state screenshots or rendered artifacts. Use when a user asks for demo screenshots or a caller requires visual evidence after UI or rendered-output changes.
---

# Walkthrough

Explain a completed change with a few annotated visuals. Run this after final
verification. A walkthrough explains proof; it does not replace proof.

## Honor The Caller Contract

The caller decides whether the walkthrough is required. Follow the stricter
repo rule when one exists.

For UI-gated workflows, treat app pages, websites, components, styles, visual
content, and generated or rendered output as UI changes. If the packet changed
one of those surfaces, run the walkthrough in the final handoff.

When the caller requires a walkthrough and it cannot be produced, block
closeout with the exact missing tool, access, or artifact. Do not waive it
silently.

When the caller requires a diff check and no relevant UI or rendered-output
change exists, record:

```txt
Walkthrough: N/A — no UI or rendered-output change in this packet.
```

## Record A Diff Baseline

For a diff-gated workflow, capture the baseline before the first file mutation,
including plan creation:

```bash
node .agents/skills/walkthrough/scripts/diff-baseline.mjs capture \
  --output tmp/walkthrough/<slug>/baseline.json
```

At closeout, compare the final checkout with that baseline:

```bash
node .agents/skills/walkthrough/scripts/diff-baseline.mjs compare \
  --baseline tmp/walkthrough/<slug>/baseline.json \
  --output tmp/walkthrough/<slug>/diff-receipt.json
```

Use `producedFileDiff` for the file-diff gate. Use `changedPaths` and the final
diff to decide whether UI or rendered output changed. The receipt detects
committed clean-tree changes, tracked working changes, executable-bit changes,
symlink changes, and untracked files without `git status`.

Keep receipts local. Do not publish file hashes. If an older packet has no
baseline, reconstruct it from the recorded starting commit or base ref and the
packet's changed-file ledger. Mark the receipt as reconstructed. New packets
must capture the baseline before mutation. The helper excludes its own baseline
and receipt paths from the comparison, but the output directory should still be
ignored by the repo.

## Read The Minimum Evidence

Read only what explains the completed result:

- the latest request and acceptance criteria;
- the baseline, diff receipt, and final diff;
- final screenshots or rendered proof already captured;
- the final route, role, data fixture, viewport, theme, or source artifact.

Reuse valid final-state screenshots. Do not rerun an expensive flow only to
capture the same state.

## Pick The Shortest Story

Use one to four frames. Each frame should explain one point:

1. where the user acts;
2. what changed or became possible;
3. what consequence appears;
4. what proves the result.

Prefer the shortest sequence a non-developer can understand in under one
minute. Do not turn every field or test into a callout.

## Capture The Real Artifact

For UI or rendered-output changes:

- capture the real final affected surface in its verified state;
- preserve the correct role, data, viewport, theme, and open or selected state;
- use the repo-required browser or capture tool;
- reuse existing final proof when it shows the required state.

For an explicit walkthrough of non-UI work, render the real final source, diff,
report, document, CLI result, or provider read-back. Never invent a product
screen to make backend or workflow work look visual.

Prefer light mode when both themes are equally truthful. Keep the verified
theme when the change concerns dark mode or switching would misrepresent the
result.

Save originals and annotated copies under a repo-approved ignored directory.
Default to:

```txt
tmp/walkthrough/<slug>/
```

Use paired names:

```txt
01-<step>-original.png
01-<step>-annotated.png
```

## Annotate Without Rewriting

Inspect each source image first. Use `imagegen`, or the repo-approved image
editor, to add only:

- numbered callouts in free margins or calm empty areas;
- short plain-English labels;
- thin arrows that land on the exact control, value, or consequence;
- a compact title when the frame needs context.

Keep labels to one sentence. Use product language, not implementation terms.

Never add, remove, rewrite, beautify, or simulate product content. Compare the
annotated result with the original. If product text, values, layout, or state
changed, discard it and regenerate. The original is proof. The annotation is
explanation.

## Protect Sensitive Data

- Do not send credentials, tokens, private URLs, customer data, personal data,
  health data, or other repo-restricted content to an image tool.
- Use deterministic sanitized fixtures or crop and redact before annotation.
- Do not present a mockup, recreated HTML, or synthetic screen as completed
  product work.
- Do not claim the annotation itself proves runtime behavior.

## Write Plain Technical Prose

Apply these rules to annotation labels, captions, and the final handoff:

- Lead with the outcome. Give the reason before implementation details.
- Prefer common words and one project term per concept.
- Use active voice and short, single-topic paragraphs.
- Cover objective, owner, chosen fix, invariant, alternatives, blast radius,
  verification, and remaining risk when they apply.
- Never make the reader inspect the diff to understand why the result is
  correct and safe.

## Final Handoff

Show every annotated image inline with an absolute local path. Give each image
one short caption stating what to notice. Name the related test, browser,
external, or source proof.

When a PR or tracker needs images, follow the owning repo's upload policy and
replace local paths with hosted URLs there.

Close only when:

- the caller's applicability rule was classified correctly;
- the baseline and receipt exist when the caller uses a diff gate;
- the frames cover the user action and consequence;
- originals and annotated copies are saved;
- every annotation matches its original;
- annotated images appear inline in the final response;
- the owning proof is named.
