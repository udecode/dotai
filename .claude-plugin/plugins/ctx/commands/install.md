---
description: Install ctx registry files and dependencies
allowed-tools: Bash
---

# Install Context Management

Install the ctx registry files using shadcn CLI:

```bash
npx shadcn@latest add https://raw.githubusercontent.com/udecode/dotai/main/registry/ctx.json
```

After installation, add the ctx script to your `package.json`:

```json
{
  "scripts": {
    "ctx": "tsx .claude/scripts/generate-agents.ts"
  }
}
```
