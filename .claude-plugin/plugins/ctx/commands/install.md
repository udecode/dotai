---
description: Install ctx registry files and dependencies
allowed-tools: Bash
---

# Install Context Management

Install the ctx registry files using shadcn CLI:

```bash
npx shadcn@latest add https://raw.githubusercontent.com/udecode/dotai/main/registry/ctx.json
```

Then install the required dependencies:

```bash
pnpm install
```

This installs:
- `.claude/context.json` - Rule definitions and presets
- `.claude/scripts/generate-agents.ts` - Context generator script

And adds dependencies: `commander`, `prompts`, `zod`
