---
name: install-skill-skiller-project
description: "Create or update a custom project-owned skill and generate its Codex and Claude Code copies with Skiller. Use when the skill belongs only to the current project and must not be added to Dotai or installed from a published catalog."
---

# Install a project skill with Skiller

Keep the project's Skiller input as the canonical source. Treat
`.agents/skills` and `.claude/skills` as generated destinations.

1. Read the project instructions and `.agents/skiller.toml` or its configured
   equivalent. Inspect the existing source and generated copies for the
   requested name.
2. Create or update the project's owned rule source. Default to
   `.agents/rules/<name>.mdc` only when the project has no more specific
   owner. Do not add the skill to Dotai and do not hand-edit generated
   `SKILL.md` files.
3. Preview and apply from the project root while explicitly limiting the
   destinations:

   ```sh
   bun x skiller@latest apply --project-root '<absolute-project-path>' --agents codex,claude-code --local-only --dry-run
   bun x skiller@latest apply --project-root '<absolute-project-path>' --agents codex,claude-code --local-only
   ```

   Preserve the project's pinned Skiller command when it has one. Do not select
   wildcard or additional agents.
4. Verify `.agents/skills/<name>` and `.claude/skills/<name>`, including
   their Skiller source metadata and their agreement with the canonical rule.
   Run the project's existing workflow validator when one covers generated
   agent files.

Report the source, both generated destinations and verification. Do not commit
or publish without separate authorization.
