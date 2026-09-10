---
name: sync-skills
description: Reconcile named skills, rules, templates and routing between explicit sources and destinations while preserving project adaptations and generated-source ownership.
metadata:
  source: udecode/dotai
  source-path: skills/sync-skills
---

# Sync Skills

Resolve exact sources, destinations, skill names and agent scope from the request and installation provenance. Read their governing instructions and source/generator metadata. Configuration identifies candidates, not permission to update every project.

For each named skill, inspect the source entrypoint, referenced method/helper files, templates, installed copy and relevant lock/installation record. Generated mirrors are evidence; edit their real rule or package source. Project-owned plan templates remain project-owned even when they started from generic seeds.

Classify each change as reusable method, project adaptation, obsolete shared behavior, vendor source or unresolved conflict. Merge useful common behavior, preserve domain commands/paths/publication/testing policy, remove superseded shared instructions and retain upstream provenance. Do not flatten a project fork with a fresh generic file or choose stricter wording without understanding its effect.

When the shared source is dotai, resolve its actual local path or named repository from the request/record. Edit that owner first. Never assume a personal checkout path. Full ownership promotion requires explicit scope; otherwise merge common behavior into existing project-owned sources without deleting them.

For dotai bundle installations, use the bundle's `setup-workflow` helper to preview and apply a verified source update. Its state owns copied files and rejects locally edited conflicts. Do not overwrite those same files through an unrelated installer or hand-edit its integrity record. For Skills CLI-managed destinations, use `skills-update` with explicit skills, sources, repositories and agents; read its dry run before apply.

Regenerate project mirrors with the actual generator after source edits. Seed only missing templates. Inspect discovery, relative links, provenance, helper behavior and the exact installed result. A conflict needs source-level reconciliation, not an overwrite flag.

Commit, push, publish, delete sources, install globally or update additional projects only when authorized. Finish with actual source-to-destination changes, preserved adaptations, proof, unresolved conflicts and named downstream suggestions. Never claim a source-only edit is installed everywhere.
