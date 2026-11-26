---
name: skill-audit
description: "Audit custom skills, playbooks, AGENTS.md rules, sync-pstack assets, and pstack overrides for drift, overlap, dead routes, and size-budget bloat across any project or dotai itself."
metadata:
  source: udecode/dotai
  source-path: skills/skill-audit
---

# Skill audit

Keep skills, playbooks, rules, and pstack overrides tight and non-overlapping. A skill or rule stays only when it holds domain knowledge pstack cannot have, or does a job pstack does not do.

Stay read-only until the owner approves cuts, unless the request explicitly asks to apply them.

## Run the scanner

```sh
node <skill>/scripts/audit.mjs <target> [--json] [--min <score>]
```

Works on a pstack-managed project, a plain repo with custom skills or playbooks, or `udecode/dotai` itself. It reports project and user-scope skill inventory, typed counts, route counts, stale dotai copies, size budgets, unmarked block rules, and candidate overlaps.

## Surfaces

Audit every surface present in `<target>`:

1. **Custom project skills and rules:** `.agents/rules/*.mdc` plus `.agents/rules/<name>/`, `.agents/skills/*`, and workflow guides named in `AGENTS.md` (judge each guide as a restatement of the block, like a skill that copies it).
2. **Project playbooks:** `.agents/playbooks/*.md` against upstream pstack base playbooks (`poteto-mode/playbooks/*.md`).
3. **pstack overrides:** the `AGENTS.md` `pstack:begin`/`pstack:end` block, `.agents/pstack/rules/*.md`, unmarked rules missing `<!-- # overrides -->`, `<!-- # relies -->`, or `<!-- # adds -->`, and drift from the pinned tag.
4. **`sync-pstack` and `dotai`:** when auditing `udecode/dotai`, inspect `skills/*/SKILL.md`, `skills/sync-pstack/assets/block.md`, `assets/pstack/rules/*.md`, and `assets/pstack/*.mjs`; check `block-budget.mjs`, `budget-check.mjs`, and cross-skill overlap.

## Verdicts

Read each skill's source (`.agents/rules/<name>.mdc` and its references, not generated `.agents/skills/` mirrors) and the closest pstack skill or playbook, then assign one verdict:

- **cut:** pstack, the block, or another kept skill already does the job, or nothing uses it. Name the working replacement, every typed command or route that loses its target (record dropped typed commands under `dropped` in `.agents/pstack.json`), and where each kept rule lands.
- **fold:** domain knowledge stays, but process text owned by pstack or the block goes. Quote each duplicated sentence beside the text that owns it and state whether every copy agrees; send any conflicting copy to the owner as a ruling before offering the fold.
- **encode:** a recurring prose rule belongs in a lint, hook, type, or script. Move enforcement into code and delete the prose rule it replaces.
- **keep:** holds domain knowledge pstack cannot have or does a job pstack does not do. Name that knowledge.

## Rules and safety

- Record for each verdict which files were read in full and which were only searched.
- Treat overlap lines as candidates, not verdicts: a sentence can repeat pstack on purpose as a project override.
- Every unmarked block or rule entry is a finding: state whether it overrides pstack or adds to it.
- Check every typed count and playbook route before calling a skill unused, because a playbook can load a skill nobody types.
- Never propose editing a skill installed from another repository; judge it `keep` or `uninstall` (`npx --yes skills remove`).
- Treat a waiver or gate label that names a retired tool as an owner policy question, not a rename.
- When proposing a `/correct` run, list mistakes that reached a commit apart from those an existing check caught.

## Size budgets

Flag every file or folder over cap; trim duplicated prose, encode rules into checks, or split references before adding text:

- **Project targets:** 14,000 B per playbook or `.mdc` rule, 70,000 B total `.agents/playbooks`, 20,000 B per `SKILL.md`, 40,000 B per skill folder excluding `scripts/`.
- **`dotai` target:** 16,384 B per `skills/*/SKILL.md`, 100,000 B total skills, 8,192 B per `assets/pstack/rules/*.md`, 80,000 B total rules, 18,200 B max rendered `assets/block.md`, 18 helper `.mjs` files.

## Apply and verify

1. Present candidates via `AskUserQuestion` (or numbered options in Codex) with typed counts, route counts, and exact rule or gate impact.
2. Execute approved cuts with a disposition table (old rule -> new home or `dropped`), add removed typed commands to `.agents/pstack.json` `dropped`, update `AGENTS.md` and project workflow guides, and remove dropped external skills via `npx --yes skills remove`.
3. Verify with `sync-pstack` `verify <project>` on pstack projects, `scripts/validate-skills --all` on `dotai`, and the project's own skill regeneration and check commands.
