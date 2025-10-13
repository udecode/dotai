# Flashback Plugin

Session management and continuity system for Claude Code. Provides automatic memory management, working plan tracking, and session restoration to maintain context across conversations.

## Features

### 📋 Session Management

- **Session start** - Restore context from previous sessions
- **Session saving** - Create comprehensive session summaries
- **Automatic archiving** - Keep session history organized

### 🧠 Memory System

- **Project memory** - Store important project information
- **Working plan tracking** - Maintain development priorities
- **Context restoration** - Seamless session continuity

### 🔄 Plan Management

- **Working plan updates** - Track progress and priorities
- **Task completion tracking** - Move tasks through workflow
- **Session-aware planning** - Context-based plan updates

## Installation

### 1. Install Flashback CLI

```bash
curl -fsSL https://raw.githubusercontent.com/zbeyens/flashbacker/main/scripts/install.sh | bash
```

### 2. Install Registry Files

```bash
npx shadcn@latest add https://raw.githubusercontent.com/udecode/dotai/main/registry/flashback.json
```

This creates:

- `.claude/flashback/prompts/session-summary.md` - Summary template
- `.claude/flashback/prompts/working-plan-update.md` - Plan update template
- `.claude/flashback/config/flashback.json` - Configuration
- `.claude/flashback/memory/WORKING_PLAN.md` - Working plan tracker

### 3. Configure Session Hook

Add this hook to your `.claude/settings.json` to automatically run session start:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "if command -v flashback &> /dev/null; then flashback session-start --context; elif [ -f \"$HOME/.claude/flashbacker/lib/cli.js\" ]; then node \"$HOME/.claude/flashbacker/lib/cli.js\" session-start --context; fi"
          }
        ]
      }
    ]
  }
}
```

This hook is automatically included when installing via the dotai Quick Start.

## Commands

### `/fb:install`

Install flashback CLI and registry files.

```
/fb:install
```

### `/fb:session-start`

Initialize new session with context restoration from previous conversations.

```
/fb:session-start
```

Gathers:

- Project memory and key learnings
- Current working plan
- Previous conversation history
- Session restoration context

### `/fb:save-session`

Create comprehensive session summary and update working plan.

```
/fb:save-session
```

Produces:

- Formatted session documentation
- File change tracking
- Tool usage analysis
- Updated working plan
- Automatic archiving

### `/fb:working-plan`

Update development working plan based on conversation analysis.

```
/fb:working-plan
```

Updates:

- Completed tasks
- Current phase
- Immediate priorities
- Next steps
- Session timestamps

### `/fb:remember`

Add important information to project long-term memory.

```
/fb:remember [information]
```

Categorizes into:

- Project overview
- Architecture patterns
- Development setup
- Conventions
- Important constraints
- Key dependencies
- Lessons learned

## Workflow

### Starting a Session

```bash
# 1. Start new session with context
/fb:session-start

# 2. Work on tasks...

# 3. Save session before ending
/fb:save-session
```

### Managing Memory

```bash
# Add important project information
/fb:remember "API requires authentication token in X-Auth header"

# Update working plan during session
/fb:working-plan
```

## File Structure

After installation, flashback creates:

```
.claude/flashback/
├── prompts/
│   ├── session-summary.md     # Summary template
│   └── working-plan-update.md # Plan update template
├── config/
│   └── flashback.json         # Configuration
└── memory/
    ├── WORKING_PLAN.md        # Current working plan
    ├── REMEMBER.md            # Project memory
    ├── CURRENT_SESSION.md     # Latest session
    └── ARCHIVE/               # Historical sessions and plans
        ├── sessions/
        └── plans/
```

## Best Practices

- Use `/fb:session-start` at the beginning of each session
- Run `/fb:save-session` before ending work
- Add important learnings to memory with `/fb:remember`
- Update working plan regularly to track progress
- Review archived sessions for project history

## Integration

Flashback works with:

- **Hooks** - Automatic session management via hooks.json
- **CLI** - External flashback CLI for context gathering
- **Registry** - Shadcn-installable file structure
- **Claude Code** - Native slash commands

## Version History

### 1.0.0

- Initial release
- 5 session management commands
- Working plan tracking
- Project memory system
- Automatic session archiving
- CLI integration for context gathering

## License

MIT

## Author

zbeyens
