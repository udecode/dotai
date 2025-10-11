# Context (ctx) Plugin

Smart context management for Claude Code with task-specific rule selection and AGENTS.md generation.

> **TL;DR**: Prevent context bloat by loading only relevant docs for your task

## Quick Commands

```bash
# 🤖 AI-Powered (Claude Code only)
/ctx                     # Type in Claude Code chat
                         # Claude analyzes task + chooses preset
                         # Example: "I need to build a modal component"

# 📝 Manual Selection
pnpm ctx                 # Interactive menu
pnpm ctx ui              # UI work
pnpm ctx backend         # Backend work
pnpm ctx app             # Full-stack
pnpm ctx --clear         # Remove generated files
```

## Features

### 🎯 Task-Specific Context
- **AI-Powered Selection** - `/ctx` command lets Claude analyze your task and choose optimal preset
- **Manual Selection** - `pnpm ctx <preset>` for direct control
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

### Context Generation Flow

```
┌─────────────────────────────────────────────────────────┐
│              Context Generation Flow                     │
└─────────────────────────────────────────────────────────┘

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

### Decision Tree

**Choose your approach:**

```
Are you using Claude Code?
├─ YES → Type: /ctx
│         Then describe your task
│         Claude analyzes + chooses preset
│
└─ NO  → What are you working on?
          ├─ UI/Components  → pnpm ctx frontend
          ├─ API/Backend    → pnpm ctx backend
          ├─ Both/Full      → pnpm ctx app
          └─ Not sure       → pnpm ctx (interactive)
```

### Rule Selection

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

## Context Quality Impact

Understanding why focused context matters:

**Without Context System:**
- ❌ All docs loaded every time
- ❌ AI overwhelmed by unrelated patterns
- ❌ Less accurate responses (too much noise)
- ❌ AI confused by conflicting guidance

**With Context System:**
- ✅ Only relevant docs loaded
- ✅ AI focused on task-specific patterns
- ✅ More accurate responses (less noise)
- ✅ Clear, consistent guidance

**Quality by Preset:**

| Preset     | Quality | Reason                        |
| ---------- | ------- | ----------------------------- |
| `frontend` | ⭐⭐⭐⭐⭐ | Focused frontend patterns only |
| `backend`  | ⭐⭐⭐⭐⭐ | Focused backend patterns only  |
| `app`      | ⭐⭐⭐   | All patterns (diluted focus)   |

**Rule of thumb:** Use the smallest preset that covers your needs.

## Benefits

- **Faster Responses** - Smaller context = faster processing
- **Better Focus** - AI only sees relevant patterns
- **Token Efficiency** - Include only necessary rules
- **Task-Specific** - Custom context per task
- **Always Include Essentials** - Global docs auto-included
- **AI-Powered Option** - Claude Code analyzes and chooses for you

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

**AI giving unfocused/irrelevant suggestions?**
- Context too broad - use more specific preset (`frontend` instead of `app`)
- Try: `pnpm ctx <specific-preset>` then `/clear` in Claude

**AI doesn't know about specific patterns?**
- Regenerate with correct preset: `pnpm ctx <preset>`
- Check if rule exists in `.claude/context.json`

**AI seems confused by conflicting patterns?**
- Too much context loaded - use narrower preset
- Avoid `app` preset unless working on full-stack feature

**Changes to rules not reflected?**
- Regenerate: `pnpm ctx <preset>` then `/clear` in Claude

**Command not found:**
- Ensure plugin is installed: `/plugin list`
- Check dependencies installed: `pnpm install`

**AGENTS.md not updating:**
- Script must be executable: `chmod +x .claude/scripts/generate-agents.ts`
- Check for errors: `pnpm ctx <rules>` (look for output)

**Rules not appearing:**
- Verify rule paths in context.json
- Check rule files exist at specified paths

**Need help choosing preset?**
- Use interactive: `pnpm ctx`
- Or ask in Claude Code: `/ctx` then describe your task

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
