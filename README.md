# dotai

> Plugin marketplace for AI-powered development workflows with Claude Code

## Quick Start

### Fastest Setup

```bash
npx shadcn@latest add https://raw.githubusercontent.com/udecode/dotai/main/registry/all.json
```

Then, restart `claude`.

This installs all project files and configures Claude Code to auto-install the marketplace and plugins.

**Note:** If you already have `.claude/settings.json`, manually add this configuration:

```json
{
  "extraKnownMarketplaces": {
    "dotai": {
      "source": {
        "source": "github",
        "path": "udecode/dotai"
      }
    }
  },
  "enabledPlugins": {
    "ctx@dotai": true,
    "dotai@dotai": true,
    "fb@dotai": true,
    "notification@dotai": true
  }
}
```

### Configure Context Management

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

**Features:**

- **PRD Workflows** - Create and parse Product Requirements Documents
- **Documentation** - Generate and maintain app design and tech stack docs
- **Debugging** - Systematic bug investigation with logging
- **PR Management** - Full PR creation with reviews and draft mode
- **Planning** - Implementation planning and log monitoring

**Key Commands:**

```bash
/dotai:create-prd-interactive  # Create PRD with AI questions
/dotai:create-app-design       # Generate design documentation
/dotai:debug                   # Start debugging workflow
/dotai:pr                      # Create PR with review
/dotai:how                     # Plan before coding
```

[Full Plugin Documentation →](./.claude-plugin/plugins/dotai/README.md)

### 🎯 ctx

Context manager for Claude Code and Codex. Use the smallest preset that covers your needs.

> **TL;DR**: Prevent context bloat by loading only relevant docs for your task

**Installation:**

```bash
/plugin install ctx@dotai
# restart claude
/ctx:install
```

**Features:**

- **AI-Powered** - `/ctx` in Claude Code analyzes your task and chooses preset
- **Manual Control** - `pnpm ctx <preset>` for direct preset selection
- **Quality Impact** - Focused presets (⭐⭐⭐⭐⭐) vs diluted all-presets (⭐⭐⭐)

**Quick Start:**

```bash
# AI chooses for you (Claude Code)
/ctx "Build a modal component"

# Manual selection
pnpm ctx frontend  # UI work
pnpm ctx backend   # API work
pnpm ctx app       # Full-stack
```

[Full Plugin Documentation →](./.claude-plugin/plugins/ctx/README.md)

### 🧠 fb

Session memory and continuity for Claude Code.

**Installation:**

```bash
/plugin install fb@dotai
# restart claude
/fb:install
```

**Features:**

- **Session Continuity** - Restore context from previous sessions
- **Working Plan** - Track development priorities across sessions
- **Project Memory** - Store important learnings
- **Auto-Archiving** - Organized session history

**Key Commands:**

```bash
/fb:session-start   # Restore previous context
/fb:save-session    # Save session summary
/fb:remember        # Store important info
```

[Full Plugin Documentation →](./.claude-plugin/plugins/fb/README.md)

### 🔔 notification

macOS notifications for Claude Code events.

**Installation:**

```bash
/plugin install notification@dotai
# restart claude
```

**Features:**

- Get notified when Claude finishes responding
- Alert before conversation history compaction
- Shows conversation summary in notification
- Custom sounds for different events

[Full Plugin Documentation →](./.claude-plugin/plugins/notification/README.md)

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

## Recommended Plans

### [Claude Max](https://www.claude.com/pricing/max)

- **Max 5x** ($100/month) - Best value for continuous development

### [Codex](https://developers.openai.com/codex/pricing) (ChatGPT)

- **Plus** ($20/month) - Good for occasional use
- **Pro** ($200/month) - For continuous development alongside Claude

### [Cursor](https://cursor.com/pricing)

- **Pro** ($20/month) - Manual coding with [Tab](https://cursor.com/docs/tab/overview)

## Development

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT
