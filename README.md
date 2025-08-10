# dotai

AI-powered development template with Claude Code, Task Master, and Cursor integration.

## What is this?

A project template that combines three powerful AI development tools:

- [**Claude Code**](https://docs.anthropic.com/en/docs/claude-code/overview) - Anthropic's CLI for Claude
- [**Task Master**](https://github.com/eyaltoledano/claude-task-master) - Tagged task management system
- [**Cursor**](https://www.cursor.com/) - AI-powered IDE for precise code review workflows (optional)

## Getting Started

### Prerequisites

**Install [Flashbacker](https://github.com/agentsea/flashbacker)** (once per machine):

```bash
bash .claude/flashback/scripts/install-flashbacker.sh && source ~/.zshrc
```

Note: The SessionStart hook is already configured in `.claude/settings.json` for automatic session restoration.

### Quick Start

1. **Launch Claude Code**

   ```bash
   claude
   ```

2. **Follow the workflow:**
   - `/create-app-design` - Explain your app
   - `/create-tech-stack` - Choose technologies
   - `/create-prd-interactive` - Write feature requirements
   - `/parse-prd` - Convert to tasks
   - `/next` - Start coding

## How It Works

Claude Code understands your project through:

- **CLAUDE.md** - Auto-loaded project context and rules
- **Task Master** - Manages tasks through MCP integration
- **Natural language** - Just describe what you want to do

You don't need to memorize commands. Simply ask Claude to:

- "Create a new feature tag for authentication"
- "Show me the next task"
- "Mark this task as complete"
- "What tasks are left in this feature?"

## Commands

### Quick Reference

| Command                     | Description                                                                 | Category |
| --------------------------- | --------------------------------------------------------------------------- | -------- |
| `/create-app-design`        | Generate comprehensive app design document with project stage assessment    | Docs     |
| `/update-app-design`        | Update existing app design document based on codebase changes               | Docs     |
| `/create-tech-stack`        | Generate comprehensive technical stack documentation from codebase analysis | Docs     |
| `/update-tech-stack`        | Update tech stack documentation based on dependency changes                 | Docs     |
| `/create-prd-interactive`   | Generate a PRD interactively with clarifying questions for complex features | Docs     |
| `/create-prd`               | Generate a PRD directly without questions for simple, well-defined features | Docs     |
| `/parse-prd`                | Parse a PRD into Task Master tasks with optional tag creation               | Docs     |
| `/create-rule`              | Create a new Cursor rule file with proper structure and conventions         | Docs     |
| `/update-rule`              | Update existing Cursor rules based on new patterns or codebase evolution    | Docs     |
| `/update-project-structure` | Update project structure documentation by running tree script               | Docs     |
| `/next`                     | Get next task and start implementing it immediately                         | Tasks    |
| `/done`                     | Mark task as complete and optionally get next task                          | Tasks    |
| `/show`                     | Show specific task details                                                  | Tasks    |
| `/list`                     | List all tasks in current tag                                               | Tasks    |
| `/add`                      | Add one or more tasks to the current tag                                    | Tasks    |
| `/add-interactive`          | Add tasks interactively with clarifying questions                           | Tasks    |
| `/update-task`              | Update tasks based on implementation changes                                | Tasks    |
| `/update-task-interactive`  | Update tasks interactively with clarifying questions                        | Tasks    |
| `/expand`                   | Break down tasks into subtasks                                              | Tasks    |
| `/move`                     | Reorganize task structure                                                   | Tasks    |
| `/research`                 | Research best practices and update tasks                                    | Tasks    |
| `/task`                     | Research best practices and update tasks                                    | Research |
| `/tech`                     | Research technologies, frameworks, and tools                                | Research |
| `/security`                 | Research security best practices and vulnerabilities                        | Research |
| `/architecture`             | Research architectural patterns and best practices                          | Research |
| `/create-snippet`           | Create a reusable code snippet                                              | Snippets |
| `/debug`                    | Systematic debugging process for complex issues                             | Support  |

### Command Details

All commands follow a pattern of analyzing your project context and providing intelligent assistance. Documentation commands typically ask clarifying questions to ensure accurate output. Task commands work within your current tag context. Research commands leverage web search for up-to-date information beyond the knowledge cutoff.

## Tips

### Claude Code vs Cursor

**Use Claude Code by default** for most development work:

✅ **Better for:**

- Long-term project understanding and context retention
- All Task Master AI commands
- Parallel development
- Cheapest plan for extensive usage of Claude Opus

❌ **Limitations:**

- No chat history persistence between sessions
- Less granular control over individual file changes

**Switch to Cursor when you need:**

✅ **Granular code review control:**

- Accept/reject specific diffs on a file-by-file basis
- Visual diff review with inline code navigation
- Restore points and easy change reversal
- Complex refactoring requiring careful code inspection

❌ **Limitations:**

- Becomes slow and unstable with long conversations
- Only supports non-AI Task Master commands
- Project context management is less efficient than in Claude Code
- Requires creating new chats frequently

**Recommended Plans:**

**Claude Max ($100/month)**

- Start with Pro plan ($20/month) for basic usage
- Upgrade to **Max 5x** ($100/month) for serious projects: much higher usage limits, unlocks Claude Opus model for deeper research
- Upgrade to **Max 20x** ($200/month) if you hit limits frequently. Best value for extensive usage of Claude Opus.

**Cursor Pro ($20/month)**

- Optional, but essential for granular code review workflows
- Visual diff management and restore points
- Complements Claude Code perfectly for precision editing

### Context Management

- **Claude Code**: Use `/clear` between different tasks to maintain focus
- **Claude Code**: Automatically reads `CLAUDE.md` for project context
- **Both tools**: Task Master state is preserved across sessions

### Quick Commands

- "What's next?" - Get the next task
- "Show task 2.1" - View specific task details
- "Mark as done" - Complete current task
- "Create auth feature tag" - New feature context
- "Switch to payments tag" - Change context

### Creating Custom Commands

Create your own slash commands by adding them to `.claude/commands/`

### Multi-task and Multi-feature Development

Work on multiple tasks within the same feature or across different features:

```bash
# Multi-task development (same feature)
"Show me all tasks in the current tag"
"Show task 2.1" - Review specific task
"Mark as done" - Complete task and move to next

# Multi-feature development
"Switch to the payments tag and show me what's next"
"Create a new tag for mobile development"
"Show me all tags with their progress"
```

### Parallel Development with Git Worktrees

```bash
# Create worktrees for parallel development
git worktree add ../project-api feature/api
git worktree add ../project-components feature/components

# Run Claude Code in each worktree with different tags
cd ../project-api && claude    # Terminal 1: API work
cd ../project-components && claude     # Terminal 2: Components work
```

### Troubleshooting

```bash
# Check current tag
"What tag am I on?"

# Fix task file sync
"Regenerate task files"

# Configure AI models
task-master models --setup
```

## Key Files & Project Structure

### Core Files

- `.taskmaster/tasks/tasks.json` - Tagged task database (auto-managed)
- `.taskmaster/state.json` - Current tag context
- `.taskmaster/config.json` - AI model configuration
- `.taskmaster/docs/prd-<tag>.md` - Product Requirements Documents per tag
- `.taskmaster/tasks/*.md` - Individual task files (auto-generated)

### Claude Code Integration Files

- `CLAUDE.md` - Auto-loaded context for Claude Code
- `.claude/settings.json` - Claude Code tool allowlist and preferences
- `.claude/commands/` - Custom slash commands for repeated workflows
- `.mcp.json` - MCP server configuration

### Directory Structure

```
project/
├── .taskmaster/
│   ├── tasks/              # Tagged task files
│   │   ├── tasks.json      # Task database
│   │   ├── task-1.md      # Individual tasks
│   │   └── task-2.md
│   ├── docs/              # Documentation
│   │   ├── app-design-document.md
│   │   ├── tech-stack.md
│   │   └── prd-<tag>.md
│   ├── reports/           # Analysis reports
│   ├── templates/         # PRD templates
│   ├── state.json         # Current tag context
│   └── config.json        # AI models config
├── .claude/
│   ├── settings.json      # Claude Code config
│   └── commands/         # Custom commands
├── .cursor/              # Cursor IDE rules
│   └── rules/           # Coding standards
├── .mcp.json            # MCP configuration
└── CLAUDE.md            # Project context
```

## Flashbacker Integration

Minimal session continuity for Claude Code - no amnesia after auto-compacts.

### How You Actually Use It

After auto-compact wipes your context, Flashbacker brings it back:

```bash
# Session Management (What You'll Use Daily)
/fb:working-plan                    # Update development priorities with AI
/fb:save-session                    # Capture insights before breaks
/fb:how "implement auth"            # Validate Claude understands before coding

# Code Quality Analysis
/fb:debt-hunter                     # Hunt TODOs, FIXMEs, duplicate functions
/fb:hallucination-hunter            # Detect broken AI-generated code
```

### What Happens Automatically

**SessionStart Hook**: When you open the project OR after auto-compaction:

1. Loads `WORKING_PLAN.md` into context
2. Claude remembers what you were working on
3. No manual reloading needed

### Your Daily Flow

```bash
1. Open project - Auto-loads plan (SessionStart hook)
2. Work normally...
3. Update progress - /fb:working-plan
4. Context fills - Auto-compact - Auto-reloads plan
5. Before break - /fb:save-session
```

### Available Commands

**Session Continuity:**

- `/fb:working-plan` - AI analyzes progress, updates development roadmap
- `/fb:save-session` - Extracts key insights from current session
- `/fb:session-start` - Manual reload (rarely needed, hook handles it)

**Code Quality:**

- `/fb:how "request"` - Get implementation plan BEFORE Claude codes
- `/fb:debt-hunter` - CLI scans for technical debt across 6 languages
- `/fb:hallucination-hunter` - AI validates generated code actually works

### Behind the Scenes

When you run `/fb:working-plan`:

1. **CLI gathers context**: Loads current plan + conversation history
2. **AI analyzes progress**: Updates priorities based on what you've done
3. **You get**: Updated roadmap that survives compactions

**The Magic**: Computer handles files, AI handles intelligence

## License

MIT
