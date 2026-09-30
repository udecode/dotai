---
name: install-skill-dotai-project
description: "Create or update a custom skill in the shared Dotai source and install it only in the current project for Codex and Claude Code. Use for a project-scoped Dotai-owned skill; do not use for global, Skiller-owned or already-published catalog skills."
---

# Install a Dotai skill for one project

Keep Dotai as the canonical source. Treat the installed project copies as
generated destinations.

1. Resolve the user-selected Dotai checkout. Use an existing sibling
   `../dotai` only when it is the intended source. Read its instructions and
   inspect any existing skill with the requested name.
2. Create or update `skills/<name>/SKILL.md` and only the resources the skill
   needs. Keep reusable guidance generic. Never edit an installed copy as the
   source.
3. Add a new skill to Dotai's catalog generator in the fitting category. Update
   bundle-count prose owned outside generated files, then run Dotai's skill
   validator, catalog build and catalog check. Repair failures before install.
4. From the target project, install the named skill with Dotai's supported
   Skills CLI version:

   ```sh
   npx --yes skills@<version> add '<absolute-dotai-path>' --skill '<name>' --agent codex claude-code -y
   ```

   Do not pass `-g`, `--all` or wildcard agents. Do not invoke Skiller.
5. Verify `.agents/skills/<name>` and `.claude/skills/<name>` in the target
   project, compare their contents with Dotai and confirm the project-scoped
   Skills CLI listing names both agents.

Report the canonical source, generated Dotai files, exact project destinations
and verification. Do not commit or publish without separate authorization.
