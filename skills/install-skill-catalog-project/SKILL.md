---
name: install-skill-catalog-project
description: "Install an already-published skills.sh skill only in the current project for Codex and Claude Code. Use when the skill already exists in the catalog; do not use to author a custom skill, modify Dotai or install globally."
---

# Install a catalog skill for one project

Use the published package as the source. Do not copy it into Dotai or create a
Skiller rule.

1. Resolve the exact package source and skill name from the user's supplied
   skills.sh link or package identifier. If the package contains several skills,
   list them and select only the requested one. Inspect the selected skill
   before installation.
2. From the target project, preserve a repository-pinned Skills CLI version when
   one exists; otherwise use the current CLI:

   ```sh
   npx --yes skills add '<package-source>' --skill '<name>' --agent codex claude-code -y
   ```

   Do not pass `-g`, `--all` or wildcard agents.
3. Verify `.agents/skills/<name>` and `.claude/skills/<name>`, then confirm
   the project-scoped Skills CLI listing identifies the skill for both agents.
   Read back the installed skill instead of treating command success as proof.

Report the resolved source, exact project destinations and verification.
