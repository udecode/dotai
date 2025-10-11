# dotai

> Plugin marketplace for AI-powered development workflows with Claude Code

## Quick Start

### 1. Add Marketplace & Install Plugins

```bash
/plugin marketplace add udecode/dotai
/plugin install dotai@dotai
/plugin install notification@dotai
/plugin install fb@dotai
/plugin install ctx@dotai
```

### 2. Restart Claude Code

After installing plugins, **restart Claude Code** to activate them.

### 3. Initialize Project Files

```bash
/dotai:install-all  # Installs all project files (dotai + flashback + ctx)
```

### 4. Configure Context Management

Add this to your `package.json`:

```json
{
  "scripts": {
    "ctx": "tsx .claude/scripts/generate-agents.ts"
  }
}
```

## Available Plugins

### 🛠️ dotai

Complete development toolkit - documentation, PRDs, debugging, PR workflows, and planning.

**Installation:**

```bash
/plugin install dotai@dotai
# restart claude
/dotai:install
```

**What gets installed:**

- `CLAUDE.md` - Base project context
- `.claude/settings.json` - Claude Code configuration
- `.claude/scripts/tree.sh` - Project structure generator
- `.cursor/rules/app-design-document.mdc` - Design doc template
- `.cursor/rules/project-status.mdc` - Project status template
- `.cursor/rules/tech-stack.mdc` - Tech stack template

**Features:**

- **PRD Creation** - Quick and interactive modes for Product Requirements Documents
- **PRD Parsing** - Convert PRDs into actionable implementation checklists
- **App Design Docs** - Generate and maintain application design documentation
- **Tech Stack Docs** - Document and track technical stack evolution
- **Debugging** - Systematic bug investigation with logging
- **PR Workflows** - Full PR creation with reviews and draft mode
- **Planning** - Implementation planning and log monitoring

**Commands:**

- `/dotai:install` - Initialize project setup files
- `/dotai:install-all` - Install all project files (dotai + flashback + ctx)
- `/dotai:create-prd` - Quick PRD for simple features
- `/dotai:create-prd-interactive` - Interactive PRD with clarifying questions
- `/dotai:parse-prd` - Convert PRD to implementation checklist
- `/dotai:create-app-design` - Generate app design document
- `/dotai:update-app-design` - Update app design based on changes
- `/dotai:create-tech-stack` - Generate tech stack documentation
- `/dotai:update-tech-stack` - Update tech stack documentation
- `/dotai:create-rule` - Create new Cursor rule file
- `/dotai:update-rule` - Update existing Cursor rule
- `/dotai:create-snippet` - Generate code snippet templates
- `/dotai:create-doc` - Enter documentation mode for features
- `/dotai:update-project-structure` - Update project structure docs
- `/dotai:debug` - Systematic debugging workflow
- `/dotai:fix` - Quick error fixing from bash output
- `/dotai:pr` - Create PR with full review workflow
- `/dotai:draft-pr` - Create draft PR without review
- `/dotai:how` - Plan implementation before coding
- `/dotai:c` - Start log monitoring

[Full Plugin Documentation →](./.claude-plugin/plugins/dotai/README.md)

### 🔔 notification

macOS notifications for Claude Code events.

**Installation:**

```bash
/plugin install notification@dotai
# restart claude
```

**Prerequisites:**

- Requires [terminal-notifier](https://github.com/julienXX/terminal-notifier): `brew install terminal-notifier`

**Features:**

- **Stop Notifications** - Get notified when Claude finishes responding
- **PreCompact Notifications** - Alert before conversation history compaction
- **Dynamic Titles** - Shows conversation summary in notification title
- **Custom Sounds** - Different sounds for different events (Ping, Bottle, etc.)

[Full Plugin Documentation →](./.claude-plugin/plugins/notification/README.md)

### 🎯 fb

Session management and continuity for Claude Code with automatic memory tracking.

**Installation:**

```bash
/plugin install fb@dotai
# restart claude
/fb:install
```

**What gets installed:**

- `.claude/flashback/scripts/session-start.sh` - Session initialization
- `.claude/flashback/prompts/` - Summary and plan update templates
- `.claude/flashback/config/flashback.json` - Configuration
- `.claude/flashback/memory/WORKING_PLAN.md` - Working plan tracker

**Features:**

- **Session Start** - Restore context from previous sessions
- **Session Saving** - Create comprehensive session summaries
- **Working Plan Tracking** - Maintain development priorities across sessions
- **Project Memory** - Store important project information
- **Automatic Archiving** - Keep session history organized

**Commands:**

- `/fb:install` - Install flashback CLI and registry files
- `/fb:session-start` - Initialize session with context restoration
- `/fb:save-session` - Create session summary and update plan
- `/fb:working-plan` - Update development working plan
- `/fb:remember` - Add important information to project memory

[Full Plugin Documentation →](./.claude-plugin/plugins/fb/README.md)

### 🎯 ctx

Context-aware AGENTS.md generator for task-specific rule selection.

**Installation:**

```bash
/plugin install ctx@dotai
# restart claude
/ctx:install
pnpm install  # Install dependencies: commander, prompts, zod
```

Then add this script to your `package.json`:

```json
{
  "scripts": {
    "ctx": "tsx .claude/scripts/generate-agents.ts"
  }
}
```

**What gets installed:**

- `.claude/context.json` - Rule definitions and presets
- `.claude/scripts/generate-agents.ts` - Context generator script

**Features:**

- **Task-Specific Context** - Include only relevant rules for your work
- **Token Optimization** - Smaller context = faster AI responses
- **Better Focus** - AI sees only patterns relevant to current task
- **Preset Support** - Use predefined rule combinations (frontend, backend, etc.)
- **Always-Apply Rules** - Global docs automatically included

**How It Works:**

**Single source of truth:** Write your documentation once in modular files, maintain them in `.claude/context.json`, then combine them automatically:

```bash
pnpm ctx frontend  # Working on UI? Combine only frontend docs
pnpm ctx backend   # Switching to API? Combine only backend docs
pnpm ctx app       # E2E feature? Combine everything
```

**Why this matters:**

- ✅ **DRY** - Write docs once, use everywhere (no duplicating CLAUDE.md → AGENTS.md)
- ✅ **Modular** - Split docs into focused files (react.mdc, database.mdc, auth.mdc)
- ✅ **Composable** - Mix and match rules per task
- ✅ **Focused** - AI gets only relevant context = faster, better responses

**What you maintain:**

- `CLAUDE.md` - Base project context (shared by all CLIs)
- `.claude/context.json` - Rule definitions and presets

**What gets generated:**

- `AGENTS.md` - Combined full context for Codex
- `CLAUDE.local.md` - @ references for Claude Code

**Context Files by CLI:**

| CLI         | Context Files                                    | Hooks Support                            |
| ----------- | ------------------------------------------------ | ---------------------------------------- |
| Claude Code | `CLAUDE.md` + `CLAUDE.local.md` (auto-generated) | ✅ SessionStart (Flashbacker auto-loads) |
| Codex       | `AGENTS.md` (auto-generated)                     | ❌ No hooks (manual Flashbacker)         |
| Both        | Generated by `pnpm ctx` from context.json        | Reload: `/clear` or `/new`               |

**Commands:**

- `/ctx:install` - Install ctx registry files and dependencies

**Usage:**

After installation and adding the script to package.json, use `pnpm ctx` to generate context:

```bash
pnpm ctx frontend        # Use frontend preset
pnpm ctx backend         # Use backend preset
pnpm ctx react database  # Specific rules
pnpm ctx --init          # Initialize with all rules
pnpm ctx --clear         # Remove generated files
```

[Full Plugin Documentation →](./.claude-plugin/plugins/ctx/README.md)

## Complete Setup Workflow

### 1. Initial Setup

```bash
# Add marketplace
/plugin marketplace add udecode/dotai

# Install plugins
/plugin install dotai@dotai
/plugin install notification@dotai
/plugin install fb@dotai
/plugin install ctx@dotai
# restart claude

# Install all project files (dotai + flashback + ctx)
/dotai:install-all

# Add "ctx": "tsx .claude/scripts/generate-agents.ts" to package.json scripts

# Generate initial context
pnpm ctx --init

# Create foundational docs
/dotai:create-app-design
/dotai:create-tech-stack
```

### 2. Daily Workflow

```bash
# Start session with context
/fb:session-start

# Plan work
/dotai:how

# Load specific context
pnpm ctx frontend api

# Start monitoring
/dotai:c

# Work on features...

# Debug if needed
/dotai:debug

# Fix errors
/dotai:fix

# Create PR
/dotai:pr

# Save session
/fb:save-session
```

### 3. Context Switching

```bash
# Generate new context for task
pnpm ctx backend

# Reload Claude Code
/clear
```

## Architecture

**Plugins** (.claude-plugin/plugins/):

- Reusable, project-agnostic slash commands and agents
- Installed via `/plugin install`
- Provide workflows and automation

**Registry Items** (registry/):

- Installable file collections via shadcn CLI
- Provide project setup and configuration files
- Installed via commands or manual shadcn CLI

**How They Work Together:**

1. Plugins provide commands → 2. Commands install registry items → 3. Registry items provide files → 4. Plugins operate on those files

## Use Cases

### PRD to Implementation

```bash
# Create PRD with questions
/dotai:create-prd-interactive "user authentication"

# Parse into checklist
/dotai:parse-prd user-authentication

# Plan approach
/dotai:how

# Work through checklist...

# Update docs
/dotai:update-app-design
/dotai:update-tech-stack
```

### Session Continuity

```bash
# Start session
/fb:session-start

# Work...

# Add learnings
/fb:remember "API uses JWT tokens in Authorization header"

# Update plan
/fb:working-plan

# End session
/fb:save-session
```

### Debugging Workflow

```bash
# Start debugging
/dotai:debug "login failing with 401"

# Claude adds logs, analyzes, implements fix

# Fix remaining errors
/dotai:fix
```

## Choosing Your AI Tool

dotai works with multiple AI development tools. Choose based on your workflow:

| Tool            | Best For                                    | Limitations                                    |
| --------------- | ------------------------------------------- | ---------------------------------------------- |
| **Claude Code** | Quick iterations, UI, general coding        | Requires `/clear` after context updates        |
| **Codex**       | Long-running tasks, backend, deep debugging | Worst CLI UX, no hooks, manual session saves   |
| **Cursor**      | Manual code review with visual diffs        | Most expensive, slower with long conversations |

### Multi-CLI Workflow

Use both Claude Code and Codex in parallel:

```bash
# Terminal 1: Claude Code (Sonnet 4.5)
claude

# Terminal 2: Codex
codex
```

**Work distribution:**

- Claude Code: Quick iterations, UI work, continuous dev
- Codex: Long-running tasks, backend, deep debugging

**Context switching:**

```bash
# 1. Generate new context for a task
pnpm ctx frontend  # or: backend, app, custom rules

# 2. Reload both CLIs
# Claude Code: /clear
# Codex: /new
```

## Pricing

### [Claude Max](https://www.claude.com/pricing/max)

- **Max 5x** ($100/month) - Best value for continuous development

### [Codex](https://developers.openai.com/codex/pricing) (ChatGPT)

- **Plus** ($20/month) - Good for occasional use
- **Pro** ($200/month) - For continuous development alongside Claude

### [Cursor](https://cursor.com/pricing)

- **Pro** ($20/month) - Manual coding with [Tab](https://cursor.com/docs/tab/overview)

## Development

See [CONTRIBUTING.md](./CONTRIBUTING.md) for:

- Plugin development guidelines
- Registry item creation
- Local testing workflow
- Publishing process

## License

MIT
