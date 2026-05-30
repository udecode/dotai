# dotai

Shared skills for coding agents.

Skills are the main routing layer. This repo is the canonical source for reusable udecode workflows; downstream repos should link to these skills instead of copying long `SKILL.md` files around.

## Included Skills

- `autogoal`: durable goal lifecycle and reusable plan templates.
  - Deps: Codex goal tools (`get_goal`, `create_goal`, `update_goal`); optional `orchestrator` when `$orchestrator on` is active.
- `debug`: root-cause debugging workflow.
  - Deps: optional `tdd` for complex business-logic fixes that need test coverage.
- `hard-cut`: delete-first repo cleanup workflow.
- `orchestrator`: route branch work to reusable child threads.
  - Deps: durable Codex thread tools.
- `tdd`: test-first development loop.

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
