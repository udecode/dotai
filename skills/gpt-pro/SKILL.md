---
name: gpt-pro
description: "Prepare a self-contained, paste-ready prompt for GPT Pro, ChatGPT Pro or another external reviewer with no repository access: exact context, evidence, candidate directions and pointed questions that force a decision. Use for gpt-pro, an external or harsh review prompt, or asking another model."
argument-hint: '[topic | plan path | review target | prompt request]'
disable-model-invocation: true
metadata:
  source: udecode/dotai
  source-path: skills/gpt-pro
---

# GPT Pro

Handle $ARGUMENTS.

Write a paste-ready prompt for ChatGPT Pro, GPT Pro or another external reviewer. The reviewer has no repo, terminal, browser or file access, so the prompt carries enough current, source-backed context to reason independently. The output is a prompt, not a local plan or implementation; write it to a file only when the user names one, and otherwise paste it in chat, usually as a fenced markdown block after a short "Sources grounded from" list.

## Rules

- Assume zero local access. Never ask the reviewer to read a file, inspect the repo, run a benchmark or see a branch.
- Ground everything in live files first: the named plan, docs, source that owns the API or behavior, tests, examples, benchmark output and relevant sibling repos. Read a pasted old prompt or previous model answer only after that, as context rather than truth; the latest user intent wins.
- Label every fact `confirmed`, `benchmarked`, `inferred`, `stale` or `gap`. Prefer fresh benchmark or test output; when it is too expensive, say exactly which numbers are stale.
- Keep paths in the prompt so answers map back to the repo. Quote only the smallest decisive snippets, use tables for metrics and tradeoffs, and include source-backed contradictions such as stale docs against fresh benchmarks. Summarize sibling repos' behavior instead of pointing at them.
- Force a decision: ask for a harsh verdict, rejected alternatives, red flags, pass/fail gates and the evidence that would overturn the recommendation. State the direction the local analysis favors clearly enough to be challenged. A previous external answer goes in as "previous answer" to critique against the new state.

## Prompt contract

Adapt these sections to the task:

1. Role and review standard.
2. Decision to make, in one sentence.
3. Current repo state.
4. Source-backed API or architecture skeleton: public types, runtime flow, data model, extension points, source paths, proof ownership.
5. Evidence: benchmarks, tests, docs, examples, observed failures.
6. Prior decisions already accepted.
7. Constraints and non-goals.
8. Known gaps and red flags.
9. Candidate directions and the one currently favored.
10. Exact output requested: for architecture, API or performance, a harsh verdict, recommended decision, how to win the critical benchmark or quality lane, what to steal and reject from comparable systems, a risk table, a proof matrix, phases with hard gates, maintainer objections and answers, and the evidence that would change the decision.
11. Pointed review questions that force tradeoffs.

Before finalizing, check that the reviewer can answer without repo access, the prompt holds the current skeleton and not only goals, benchmarks carry dates, commands or paths, stale claims are marked, and the questions are sharp enough for a decision-grade answer.
