---
name: skills-update
description: Refresh a named skill or explicitly requested configured set using dry-run preflight, source provenance and explicit repository and agent destinations.
metadata:
  source: udecode/dotai
  source-path: skills/skills-update
---

# Skills Update

Identify which installer owns the destination before updating. A dotai bundle installation records `.agents/dotai-project-install-<agent>.json` or `.agents/dotai-global-install-<agent>.json`. Use `setup-workflow` with the new reviewed bundle; it verifies hashes and preserves user edits. Do not write these files through the Skills CLI helper.

For existing Skills CLI-managed repositories, use the bundled `scripts/update-skill.mjs` relative to this skill directory. Configuration is `~/.agents/config.json` under `syncedRepositories`, or an explicit `--config` file. It owns repository sets, sources and a nonempty `agents` allowlist. Do not invent configuration or infer agents from installed applications.

```sh
node <skill-directory>/scripts/update-skill.mjs <skill-name> --config <config-file>
node <skill-directory>/scripts/update-skill.mjs <skill-name> --config <config-file> --apply
```

The first invocation is dry-run. Inspect every source, skill, destination and agent, then apply within the existing request. A full configured refresh requires explicit scope and `--all`; no-argument invocation fails. `--set <name>` selects a configured set. Global scope is separate and is not supported by this repository helper.

The helper uses targeted `skills add` only, with a named skill and explicit agent list. Never substitute unscoped `skills update`, `skills upgrade`, wildcard agents or broad add/remove flags for a named refresh. Preserve source-specific risk settings as explicit user configuration, not assumed consent.

Respect project-owned rules/templates and local modifications. Use `sync-skills` for source-level conflicts before refreshing. Read back the installed files and CLI lock after apply; tool exit alone does not establish the intended skill contents or runtime capabilities.

When changing the helper, run its existing focused tests and a dry-run against a temporary explicit config. Report mode, named targets, actual read-back and failures. No automatic commits or other-project refreshes.
