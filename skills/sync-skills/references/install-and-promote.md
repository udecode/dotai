# Install, promote and verify named skills

Use this reference for an actual installation, source promotion or project-template sync. A comparison without mutation uses the entrypoint directly.

## Inventory the contract

For each named source and destination, inspect the governing instructions and generator configuration. Relevant paths commonly include:

- `.agents/rules/<skill>.mdc` and `.agents/rules/<skill>/` for local rules and supporting files.
- A package-owned skill directory identified by project instructions or generated metadata.
- `skills/<skill>/` in the actual shared checkout.
- `.agents/skills/<skill>/` and `.claude/skills/<skill>/` for installed/generated evidence.
- `docs/plans/templates/<skill>.md` and its supporting directory for project-owned templates.
- `skills-lock.json`, user installation records or the bundle's state for installer ownership.

A generated mirror does not outrank a real rule or package source. Missing source metadata is a source conflict to resolve, not permission to overwrite the mirror.

## Merge or promote

When a destination already owns a local rule or project template, default to merging common changes at matching sections. Preserve its commands, browser/runtime policy, release/tracker rules, fixture cases, exclusions and handoff format. Generic templates seed missing files only; never use `init-templates.mjs --force` as a substitute for reconciling project-owned templates.

Full ownership promotion requires the requested scope to cover it. Prepare the complete shared method and required helpers first. Resolve source references to the installed owner, install and verify the named skill, then remove superseded local rule sources and regenerate mirrors. Keep project templates local. Do not delete an owner before its replacement and callers are ready; a local staging area may be used to resolve an installer conflict.

For a shared-source update, inspect configured repository sets only to resolve explicitly authorized destinations. Edit the actual shared checkout, validate its source and affected helpers, then use that current source for local installation. Publication is separate authority; an unpublished local change must not be overwritten by an old remote revision.

## Use the owning installer

For Dotai bundle-managed files, use `setup-workflow` and its saved integrity state. Preview, reconcile conflicts at source, apply and read back. Do not mix Skills CLI writes into the same owned paths or hand-edit the integrity record.

For Skills CLI-managed destinations, follow `skills-update` and its current supported helper. Its configured-set shape is:

```sh
node '<installed-skills-update>/scripts/update-skill.mjs' '<skill-name>' --set '<set-name>'
node '<installed-skills-update>/scripts/update-skill.mjs' '<skill-name>' --set '<set-name>' --apply
```

Inspect each printed source, repository, skill and agent before applying. Use the current local source override when publishing has not been authorized. For one explicit destination, the named CLI shape is:

```sh
npx skills add '<source>' --skill '<skill-name>' --agent codex claude-code -y
npx skills remove '<skill-name>' --agent codex claude-code -y
```

Replace the example agent list with that destination's actual configured allowlist. Use global flags only for an authorized global destination. Agent identifiers can share a physical `.agents/skills` directory; inspect exact paths before removal. Quote names and patterns. Use the pinned/current supported CLI version from the owning installation record.

Avoid unscoped `skills update`/`upgrade`, wildcard agents and `--all` for a named sync. Some installed versions ignore trailing filters even on update help; inspect the supported version through its owning helper instead. If a lock source has an unfamiliar skill path, use that source's `skills add ... --list` before choosing a name. Let the owning CLI update its lock; do not forge lock entries.

## Regenerate and read back

Use the destination's documented generator, including a package-source pass before Skiller when required. Commands such as `bun install`, `pnpm install` or a named sync script are project choices, not interchangeable defaults.

Check the resulting source metadata, expected Codex/Claude paths, references and moved helper calls. When deletion was authorized, confirm obsolete generated copies and references are gone. Inspect lock/state changes and verify no unselected agent destination appeared. Validate changed helper syntax and exercise behavior when relevant; prose needs no application suite.

Report the actual source-to-destination change, preserved forks, installer/generator commands, proof and any unresolved conflict. Include publication evidence only if publication occurred. Source-only work is not an installed update.
