# dotai

Shared skills for coding agents.

Skills are the main routing layer. This repo is the canonical source for reusable udecode workflows; downstream repos should link to these skills instead of copying long `SKILL.md` files around.

## Included Skills

- `autogoal`: durable goal lifecycle and seeded plan templates.
  - Deps: Codex goal tools (`get_goal`, `create_goal`, `update_goal`); optional `orchestrator` when `$orchestrator on` is active.
- `agent-native-reviewer`: review whether agents can discover, perform, and
  verify the same meaningful actions as maintainers/users across skills,
  prompts, commands, generated mirrors, repo workflows, and product actions.
  - Deps: optional `autogoal`, `sync-skills`, `sync-vision`,
    `resolve-pr-feedback`, `hard-cut`, `tdd`, and `diagnosing-bugs` for routed
    follow-up work.
- `hard-cut`: delete-first repo cleanup workflow.
- `orchestrator`: route branch work to reusable child threads.
  - Deps: durable Codex thread tools.
- `resolve-pr-feedback`: GitHub PR review feedback closure with source-backed
  triage, proof, replies, and thread resolution.
  - Deps: `gh`, `jq`; optional project-owned `docs/plans/templates/resolve-pr-feedback.md`.
- `sync-vision`: keep project root `VISION.md` current from changed
  human/agent inputs.
  - Deps: `autogoal`; optional project-owned `docs/plans/templates/sync-vision.md`.
- `tdd`: test-first development loop.
- `video-transcripts`: generate XML transcripts for tracker video evidence.
  - Deps: `GEMINI_API_KEY` or `GOOGLE_API_KEY`; `curl`, `jq`, and `file`; optional `gh` for private GitHub attachments.

## Quick Start

Install with the `skills` CLI:

```sh
npx skills add udecode/dotai
```

## Validate

Run after edits:

```sh
scripts/validate-skills
```

## Editing Rules

- Keep descriptions short and useful for routing.
- Keep skill bodies operational, not essay-like.
- Prefer helper scripts for repeatable command logic.
- Do not include secrets, private hostnames, private account IDs, or private URLs.
