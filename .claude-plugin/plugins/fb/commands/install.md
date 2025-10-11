---
description: Install Flashback session management system
allowed-tools: Bash
---

# Install Flashback

Install `flashback` CLI:

```bash
curl -fsSL https://raw.githubusercontent.com/zbeyens/flashbacker/main/scripts/install.sh | bash
```

Then install the flashback files with shadcn CLI:

```bash
npx shadcn@latest add https://raw.githubusercontent.com/udecode/dotai/main/registry/flashback.json
```
