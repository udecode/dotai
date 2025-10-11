# Context (ctx) Plugin

Smart context management for Claude Code with task-specific rule selection and AGENTS.md generation.

## Features

### 🎯 Task-Specific Context
- **Intelligent Rule Selection** - Include only relevant rules for your task
- **Token Optimization** - Smaller context = faster AI responses
- **Better Focus** - AI sees only patterns relevant to current work

### 📋 AGENTS.md Generation
- **Auto-generated Context** - Dynamically create AGENTS.md from rules
- **Preset Support** - Use predefined rule combinations (frontend, backend, etc.)
- **Always-Apply Rules** - Global docs automatically included

## Installation

### Quick Installation

```bash
/plugin install ctx@dotai
/ctx:install
```

### Manual Installation

If you prefer manual installation:

```bash
# 1. Install plugin
/plugin install ctx@dotai

# 2. Install registry files
npx shadcn@latest add https://raw.githubusercontent.com/udecode/dotai/main/registry/ctx.json

# 3. Install dependencies
pnpm install
```

This creates:
- `.claude/context.json` - Rule definitions and presets
- `.claude/scripts/generate-agents.ts` - Context generator script

And adds dependencies: `commander`, `prompts`, `zod`

## Commands

### `/ctx:install`

Install ctx registry files and dependencies.

```
/ctx:install
```

This runs:
1. `npx shadcn@latest add` - Installs context.json and generate-agents.ts
2. `pnpm install` - Installs required dependencies (commander, prompts, zod)

## Using `pnpm ctx`

After installation, generate task-specific AGENTS.md with `pnpm ctx`:

**Before running:** Analyze your task to determine which rules are needed.

#### Usage

```bash
pnpm ctx <rule1> <rule2> <rule3>
```

#### Examples

**Frontend work:**
```bash
pnpm ctx frontend  # Uses frontend preset (react, styling, etc.)
```

**Backend API:**
```bash
pnpm ctx backend  # Uses backend preset (api, database, etc.)
```

**Mixed work:**
```bash
pnpm ctx frontend payments  # Preset + specific rule
```

**Specific rules:**
```bash
pnpm ctx react database auth  # Individual rules
```

**Initialize context:**
```bash
pnpm ctx --init  # Create initial AGENTS.md with all rules
```

## How It Works

### 1. Task Analysis

Before running `pnpm ctx`, analyze:
- **Files you'll modify** - Match file globs in context.json
- **Technologies involved** - React, TypeScript, database, etc.
- **Features implementing** - Auth, UI, API endpoints, etc.

### 2. Rule Selection

Rules in `.claude/context.json` have:
- `name` - Identifier (use in command)
- `path` - File location
- `description` - What the rule covers
- `globs` - File patterns (e.g., `*.tsx`, `api/**`)
- `alwaysApply` - Auto-include in every context

**Selection principles:**
- ✅ Use presets when all preset rules are needed
- ✅ Include rules matching file globs
- ✅ Include rules with relevant tech/patterns
- ❌ Exclude unrelated rules
- ❌ Don't list individual rules when preset covers them

### 3. Context Generation

`pnpm ctx <rules>` → Generates `AGENTS.md` with:
- Always-apply rules (global docs)
- Selected rules from your command
- Focused context for current task

## Configuration

Edit `.claude/context.json` to add/modify rules:

```json
{
  "rules": [
    {
      "name": "my-rule",
      "path": ".cursor/rules/my-rule.mdc",
      "description": "My custom rule",
      "globs": ["src/my-feature/**"],
      "alwaysApply": false
    }
  ],
  "presets": {
    "my-preset": ["rule1", "rule2", "my-rule"]
  }
}
```

## Workflow

### Starting New Task

1. **Analyze task** - What files/tech/features?
2. **Select rules** - Match to context.json
3. **Generate context** - `pnpm ctx <rules>`
4. **Reload Claude** - `/clear` to use new context

### Switching Tasks

```bash
# Was working on frontend
pnpm ctx frontend

# Now switching to backend
pnpm ctx backend
/clear  # Reload Claude with new context
```

## Benefits

- **Faster Responses** - Smaller context = faster processing
- **Better Focus** - AI only sees relevant patterns
- **Token Efficiency** - Include only necessary rules
- **Task-Specific** - Custom context per task
- **Always Include Essentials** - Global docs auto-included

## Examples

### Example 1: Building UI Component

```bash
# Task: "Build a React modal component"
# Files: src/components/modals/ExampleModal.tsx
# Analysis: All UI rules needed (react, styling, state)
# ✅ Use preset that covers all needed rules
pnpm ctx ui
```

### Example 2: Database Optimization

```bash
# Task: "Optimize database search queries"
# Files: lib/search.ts, db/schema.ts
# Analysis: Backend with search + performance focus
pnpm ctx database search performance
```

### Example 3: Authentication

```bash
# Task: "Implement user authentication"
# Files: api/auth.ts, lib/session.ts
# Analysis: Backend API with auth patterns
pnpm ctx api auth
```

### Example 4: Payment Integration

```bash
# Task: "Add payment integration"
# Files: src/app/billing/page.tsx, api/payments.ts
# Analysis: Frontend + specific payment patterns
# ✅ Use preset, add specific rule
pnpm ctx frontend payments
```

## Best Practices

1. **Prefer presets** when all rules are needed
2. **Minimal selection** - Only include what you'll use
3. **Review context.json** - Understand available rules
4. **Reload after changes** - Use `/clear` in Claude
5. **Update rules** - Add project-specific patterns to context.json

## Troubleshooting

**Command not found:**
- Ensure plugin is installed: `/plugin list`
- Check dependencies installed: `pnpm install`

**AGENTS.md not updating:**
- Script must be executable: `chmod +x .claude/scripts/generate-agents.ts`
- Check for errors: `pnpm ctx <rules>` (look for output)

**Rules not appearing:**
- Verify rule paths in context.json
- Check rule files exist at specified paths

## Version History

### 1.0.0

- Initial release
- Task-specific context generation
- Preset support
- Always-apply rules
- Token optimization

## License

MIT

## Author

zbeyens
