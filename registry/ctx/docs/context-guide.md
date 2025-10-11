# Context System - Quick Reference

> **TL;DR**: Prevent context bloat by loading only relevant docs for your task

## Quick Commands

```bash
# 🤖 AI-Powered (Claude Code only)
/ctx                     # Type in Claude Code chat
                         # Claude analyzes task + chooses preset
                         # Reads: .claude/commands/ctx.md

# 📝 Manual Selection
pnpm ctx                 # Interactive menu
pnpm ctx ui              # UI work
pnpm ctx backend         # Backend work
pnpm ctx app             # Full-stack
pnpm ctx --clear         # Remove generated files
```

## How It Works

```
┌───────────────────────────────────────────────────────────────┐
│                    Context Generation Flow                     │
└───────────────────────────────────────────────────────────────┘

Option A: AI-Powered (Claude Code)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Developer: Types /ctx in Claude Code chat
           "I need to build a modal component"
    ↓
Claude Code: Reads .claude/commands/ctx.md
           Analyzes task + .claude/context.json
    ↓
Claude Code: Runs pnpm ctx ui
    ↓
AGENTS.md + CLAUDE.local.md generated
    ↓
AI has focused UI context

Option B: Manual Selection
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Developer: pnpm ctx ui
    ↓
Script reads .claude/context.json
    ↓
Generates AGENTS.md + CLAUDE.local.md
    ↓
AI has focused UI context

Files Generated:
• AGENTS.md - Full docs for Codex (don't edit)
• CLAUDE.local.md - File refs for Claude Code (don't edit)
```

## Context Quality Impact

```
Preset      Quality     Reason
────────────────────────────────────────────────────────
ui          ⭐⭐⭐⭐⭐   Focused UI patterns only
backend     ⭐⭐⭐⭐⭐   Focused backend patterns only
app         ⭐⭐⭐      All patterns (diluted focus)

Problem: More context = More noise = Less accurate responses
Solution: Use the smallest preset that covers your needs
```

## Configuration Structure

### context.json Schema

```json
{
  "rules": [
    {
      "name": "rule-name",
      "path": ".cursor/rules/rule-file.mdc",
      "description": "What this rule covers",
      "globs": ["file/pattern/*.tsx"],
      "alwaysApply": false
    }
  ],
  "presets": {
    "preset-name": ["rule1", "rule2", "rule3"]
  }
}
```

### Rule Properties

| Property      | Type       | Required | Description                                      |
| ------------- | ---------- | -------- | ------------------------------------------------ |
| `name`        | string     | ✅       | Unique identifier for the rule                   |
| `path`        | string     | ✅       | Relative path to rule file                       |
| `description` | string     | ✅       | Human-readable description                       |
| `globs`       | string[]   | ❌       | File patterns that auto-trigger this rule        |
| `alwaysApply` | boolean    | ❌       | Include in every context generation (default: false) |

### Preset Properties

| Property | Type     | Description                          |
| -------- | -------- | ------------------------------------ |
| `name`   | string   | Unique preset identifier             |
| `rules`  | string[] | Array of rule names to include       |

## Managing Rules

### Adding a New Rule

```json
{
  "rules": [
    // ... existing rules
    {
      "name": "payments",
      "path": ".cursor/rules/payments.mdc",
      "description": "Stripe payment integration patterns",
      "globs": ["**/payments/**", "**/billing/**"],
      "alwaysApply": false
    }
  ]
}
```

### Rule Naming Conventions

- **Technology**: `react`, `nextjs`, `typescript`
- **Feature Area**: `auth`, `payments`, `analytics`
- **Architectural**: `api`, `database`, `services`
- **Cross-cutting**: `testing`, `logging`, `error-handling`

### File Glob Patterns

```json
{
  "globs": [
    "*.tsx",                    // All TSX files
    "src/components/**/*.tsx",  // Components only
    "app/**/page.tsx",          // Next.js pages
    "api/**",                   // All API files
    "**/payments/**"            // Payment-related files
  ]
}
```

### Always-Apply Rules

Use `alwaysApply: true` for foundational documentation:

```json
{
  "rules": [
    {
      "name": "project-status",
      "path": ".cursor/rules/project-status.mdc",
      "description": "Current project state and priorities",
      "alwaysApply": true
    },
    {
      "name": "tech-stack",
      "path": ".cursor/rules/tech-stack.mdc",
      "description": "Technology stack and dependencies",
      "alwaysApply": true
    }
  ]
}
```

## Managing Presets

### Creating a Preset

```json
{
  "presets": {
    "frontend": ["react", "nextjs", "styling", "state-management"],
    "backend": ["api", "database", "auth", "services"],
    "payments": ["frontend", "api", "payments", "stripe"],
    "app": ["frontend", "backend"]
  }
}
```

### Preset Best Practices

1. **Focused Presets** - Include only related rules
   ```json
   "ui": ["react", "styling", "components"]  // ✅ Good
   "ui": ["react", "database", "auth"]       // ❌ Too broad
   ```

2. **Hierarchical Presets** - Can reference other presets
   ```json
   "frontend": ["react", "nextjs"],
   "fullstack": ["frontend", "api", "database"]
   ```

3. **Domain-Specific Presets** - Group by feature area
   ```json
   "ecommerce": ["products", "cart", "checkout", "payments"],
   "analytics": ["tracking", "metrics", "dashboards"]
   ```

### Common Preset Patterns

```json
{
  "presets": {
    // By layer
    "frontend": ["react", "nextjs", "styling"],
    "backend": ["api", "database", "services"],
    "infrastructure": ["deployment", "monitoring", "security"],

    // By feature
    "auth-feature": ["frontend", "api", "auth", "session"],
    "payments-feature": ["frontend", "api", "payments", "webhooks"],

    // By scope
    "minimal": ["react", "styling"],
    "standard": ["frontend", "api"],
    "full": ["frontend", "backend", "infrastructure"]
  }
}
```

## Decision Tree for AI

When user asks to add/modify context.json:

```
1. Is this a new rule or preset?
   ├─ New Rule
   │  ├─ Ask for rule details (name, description, file path)
   │  ├─ Suggest appropriate globs based on patterns
   │  └─ Add to rules array
   │
   └─ New Preset
      ├─ Ask which rules should be included
      ├─ Check if rules exist in context.json
      └─ Add to presets object

2. Should this rule alwaysApply?
   ├─ YES → Project-wide documentation (status, architecture, tech stack)
   └─ NO  → Task-specific patterns (features, technologies, components)

3. What globs should be used?
   ├─ Technology-specific: *.tsx, *.py, *.rs
   ├─ Feature-specific: **/auth/**, **/payments/**
   ├─ Layer-specific: api/**, components/**, lib/**
   └─ None: No automatic triggering
```

## File Globs (For `/ctx` AI Selection)

When using `/ctx` in Claude Code, rules automatically apply based on file patterns:

| Rule Type  | Globs Example             | Use Case                |
| ---------- | ------------------------- | ----------------------- |
| React      | `*.tsx`, `*.jsx`          | React components        |
| Next.js    | `**/page.tsx`             | Next.js pages           |
| API        | `api/**`, `**/route.ts`   | API endpoints           |
| Database   | `**/schema.ts`, `db/**`   | Database schemas        |
| Components | `components/**/*.tsx`     | Reusable components     |
| Features   | `**/[feature-name]/**`    | Feature-specific files  |

## Benefits

### Without Context System

- ❌ All docs loaded every time
- ❌ AI overwhelmed by unrelated patterns
- ❌ Less accurate responses (too much noise)
- ❌ AI confused by conflicting guidance

### With Context System

- ✅ Only relevant docs loaded
- ✅ AI focused on task-specific patterns
- ✅ More accurate responses (less noise)
- ✅ Clear, consistent guidance

### Claude Code Bonus

- 🤖 AI analyzes task automatically
- 🎯 Chooses optimal preset
- 📚 Zero manual configuration

## Troubleshooting

**AI giving unfocused/irrelevant suggestions?**
→ Context too broad - use more specific preset (`ui` instead of `app`)

**AI doesn't know about specific patterns?**
→ Regenerate with correct preset: `pnpm ctx <preset>`

**AI seems confused by conflicting patterns?**
→ Too much context loaded - use narrower preset

**Changes to rules not reflected?**
→ Regenerate: `pnpm ctx <preset>`

**Need help choosing preset?**
→ Use interactive: `pnpm ctx`

## Example Modifications

### Add a New Technology Rule

```json
{
  "rules": [
    {
      "name": "prisma",
      "path": ".cursor/rules/prisma.mdc",
      "description": "Prisma ORM patterns and best practices",
      "globs": ["**/prisma/**", "**/*.prisma"],
      "alwaysApply": false
    }
  ]
}
```

### Create a Feature Preset

```json
{
  "presets": {
    "user-management": ["react", "api", "auth", "database", "email"]
  }
}
```

### Update Existing Preset

```json
{
  "presets": {
    "frontend": ["react", "nextjs", "styling", "state-management", "routing"]
    //                                                              ^^^^^^^^^ added
  }
}
```

## Configuration Files

**Rules:** `.claude/context.json`
**AI Decision Logic:** `.claude/commands/ctx.md`
**Generator Script:** `.claude/scripts/generate-agents.ts`
**This Guide:** `.claude/docs/context-guide.md`
