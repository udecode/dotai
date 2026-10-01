# Adapt an existing workflow

After the interview and before `apply`, reshape the project so its own rules and the block do not contradict each other. The project's rules outside the block win over it, so a leftover local rule silently cancels a shared one.

## Remove vendored pstack copies

`discover` lists `pstack.vendored`: local skills that carry a plugin skill's name. Both copies load (`how` and `pstack:how`), and the local one never receives upstream changes.

- A copy the Skills CLI installed has an entry in `skills-lock.json`. Remove it from the project root with `npx --yes skills remove <name>... -y`, which deletes `.agents/skills/<name>` and each agent's link to it.
- The Skills CLI can also delete tracked links outside the skill directories, such as a root directory of skill links. Afterwards read `git status` outside `.agents/skills` and `.claude/skills`, and restore what the project still needs.
- A copy generated from a project rule (a matching `.agents/rules/<name>.mdc`) is a project fork, not a vendored copy. Interview question 8 decides whether it carries project behavior. If it does not, delete the rule and regenerate.
- Afterwards `discover` reports an empty `vendored` list, and `find -L .claude/skills -type l` prints no dangling link.

## Skills orphaned by dotai cuts

`dotaiOrphans` lists skills installed from dotai that dotai no longer ships, so they never update again. Interview question 8 settles each one. Either remove it, or keep it as a project-owned skill by moving its source into the project's rules and dropping its lock entry.

## autoreview

The block's Review rule runs openclaw's autoreview at `.agents/skills/autoreview/scripts/autoreview`. When the review section is kept and `discover.autoreview` is missing or names another source, such as `../dotai`, remove that copy and install upstream from the project root with `npx --yes skills add openclaw/agent-skills --skill autoreview --agent claude-code codex -y`. When the review section is skipped, leave the installed copy alone. The block passes `--model gpt-6.1-sol`, which needs a Codex CLI that knows that model; 0.159.2 does and 0.147.0 does not.

## Keep formatters off the synced files

Every sync compares the block and the helpers byte for byte, so a formatter that rewrites them makes the next sync refuse them as edited. When `lintFix` formats Markdown or `.mjs` files, add `AGENTS.md` and `.agents/pstack/` to its ignore list. The config and `.claude/settings.json` are compared as parsed JSON, so formatting them is harmless.

## Rewrite the rules around the block

Walk `AGENTS.md` and each workflow rule, using the interview's classification.

- **A rule the block now states.** Delete the project's copy. The block covers the lead writing code, messages and shared resources, tests, review mechanics, plans and trails, long runs, the todo and close discipline, writing passes, commit and PR text, reflection and agent files. A duplicate drifts, and the project copy wins.
- **A rule that contradicts the block.** Resolve it in the interview's direction. For example, a ban on any new checkout blocks the block's detached worktree for tree-sensitive tools, so narrow the ban. List each contradiction you keep in the setup summary.
- **A rule kept as project policy.** Keep it outside the block when its section is skipped or the local rule is deliberately stricter. Word it as the project's override so a reader sees which rule applies.
- **A local controller** that question 2 retired or narrowed. Remove its routing from `AGENTS.md`, or reduce it to a typed entry point that hands work to poteto-mode and keeps only the project's specifics, such as source authority, law stacks and proof owners. Every typed command keeps working.
- **A lifecycle skill**, one that orders work (plan, then execute, then close; reproduce, then fix) rather than holding knowledge. Move its steps into a [project playbook](../SKILL.md#project-playbooks) on the pstack playbook it shadows, keep its knowledge in the skill, and leave its typed command as an entry point naming the playbook. A plain request never loads a user-only skill, so its rules miss routed work until they move.
- **A reference to a removed skill**, by path (such as `.agents/skills/principle-*/SKILL.md`) or by name. Point it at the plugin skill by name, such as `pstack:principle-redesign-from-first-principles`, or at the block's rule.
- **A hook**, such as a Stop hook that stages paths. Keep it, and make sure the delivery answer describes what it does.
- **A domain rule.** Leave its method as it is: setup only repoints its references to retired skills, templates and controllers. Never trim it on a reviewer's estimate; trimming is a separate measured pass.
- **The routing table** from interview question 9. Write it outside the block as the project's Routing section, one owner per row, naming the skill by its invocable name.
- **A public skill**, one the project's docs tell users to install (`skills add`). It must not depend on the project's own workflow files (`.agents/pstack/`, poteto-mode, `AGENTS.md`, the plans directory), because downstream apps have none of them; keep its run state in its own directory.

A retired policy is often repeated far from `AGENTS.md`. Search the whole repository for each retired phrase, controller name and removed skill path: rule references, plan templates, team docs and vision or design docs. Fix every hit.

After editing rules, run the project's own regeneration, such as its `prepare` script or `bunx skiller@latest apply`, and never hand-edit a generated `SKILL.md`.

## Team setup notes

When the project documents agent setup for teammates, such as in a developer-skills or contributing doc, replace its pstack install steps with a pointer to the block's install bullet, so the tag lives in one place.
