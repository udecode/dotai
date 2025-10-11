---
description: Install all dotai registry items in one command
allowed-tools: Bash
---

# Install All

Install all dotai registry items (dotai, flashback, ctx) in one command:

```bash
npx shadcn@latest add https://raw.githubusercontent.com/udecode/dotai/main/registry/all.json
```

After installation, add the ctx script to your `package.json`:

```json
{
  "scripts": {
    "ctx": "tsx .claude/scripts/generate-agents.ts"
  }
}
```
