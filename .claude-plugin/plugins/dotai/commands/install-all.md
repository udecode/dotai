---
description: Install all dotai registry items in one command
allowed-tools: Bash
---

# Install All

Install all dotai registry items (dotai, flashback, prompt) in one command:

```bash
npx shadcn@latest add https://raw.githubusercontent.com/udecode/dotai/main/registry/all.json
```

After installation, add ruler postinstall to your `package.json` to auto-generate agent instructions:

```json
{
  "scripts": {
    "postinstall": "ruler apply"
  }
}
```
