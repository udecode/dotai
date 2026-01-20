```
██████╗  ██████╗ ████████╗ █████╗ ██╗
██╔══██╗██╔═══██╗╚══██╔══╝██╔══██╗██║
██║  ██║██║   ██║   ██║   ███████║██║
██║  ██║██║   ██║   ██║   ██╔══██║██║
██████╔╝╚██████╔╝   ██║   ██║  ██║██║
╚═════╝  ╚═════╝    ╚═╝   ╚═╝  ╚═╝╚═╝
```

## Agent Instructions

Uses [skiller](https://github.com/udecode/skiller) to apply the same rules to all coding agents. Instructions and skills in `.claude/rules/`. `npx skiller@latest apply` generates `CLAUDE.md`/`AGENTS.md`, Skills and MCP configurations.

## Quick Start

### Fastest Setup

```bash
npx shadcn@latest add https://raw.githubusercontent.com/udecode/dotai/main/registry/all.json
```

Then, restart `claude`.

This installs all project files and configures Claude Code to auto-install the marketplace and plugins.

### Manual Setup

Add marketplace and plugins (interactive):

```bash
/plugin marketplace add udecode/dotai
```

Restart Claude Code, then install all plugin files:

```bash
/dotai:install-all
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

- **Documentation** - Generate and maintain app design and tech stack docs
- **PR Management** - Full PR creation with reviews and draft mode
- **Planning** - Implementation planning and log monitoring

**Key Commands:**

```bash
/dotai:create-app-design       # Generate design documentation
/dotai:opus <prompt>           # Run task with Opus model
```

[Full Plugin Documentation →](./.claude-plugin/plugins/dotai/README.md)

### 🎓 skills

Meta-skills for finding, using, and writing Agent Skills - enforces skill usage protocols and provides skill authoring guidance.

**Installation:**

```bash
/plugin install skills@dotai
# restart claude
```

**Features:**

- **Using Skills** - Mandatory protocols for skill discovery and usage
- **Writing Skills** - TDD approach to skill authoring
- **No Rationalization** - Prevents common excuses for skipping skills

**Key Command:**

```bash
/skills:skills   # Enforce skill usage protocols
```

**Skills (auto-invoked):**

- `using-skills` - Mandatory workflows for finding and using skills

[Full Plugin Documentation →](./.claude-plugin/plugins/skills/README.md)

### 📋 plan

Planning and brainstorming workflows for software development - helps refine ideas into designs and create detailed implementation plans.

**Installation:**

```bash
/plugin install plan@dotai
# restart claude
```

**Features:**

- **Brainstorming** - Transform rough ideas into fully-formed designs
- **Writing Plans** - Create comprehensive implementation plans with TDD approach
- **Executing Plans** - Batch execution with review checkpoints

**Key Commands:**

```bash
/plan:brainstorm      # Interactive design refinement (Opus)
/plan:write-plan     # Create implementation plan (Opus)
/plan:execute-plan   # Execute plan with checkpoints
```

**Skills (auto-invoked):**

- `brainstorming` - Refine ideas through collaborative questioning
- `writing-plans` - Create detailed task breakdowns
- `executing-plans` - Execute plans in controlled batches

[Full Plugin Documentation →](./.claude-plugin/plugins/plan/README.md)

### ✅ prompt

Dynamic prompt injection system with before-start and before-complete checklists.

**Installation:**

The prompt system is automatically installed with the dotai registry (included in Quick Start setup). If you need to install it separately:

```bash
npx shadcn@latest add https://raw.githubusercontent.com/udecode/dotai/main/registry/prompt.json
```

This installs:

- `.claude/prompt.yml` - Configuration file
- `.claude/scripts/user-prompt-submit.sh` - Hook script for before-start/before-complete
- `.claude/scripts/post-compact.sh` - Hook script for post-compact recovery
- `.claude/scripts/session-start.sh` - Hook script for session start events

The hooks are automatically configured in `.claude/settings.json` when you install the dotai registry.

**Features:**

- **Before-Start Checklists** - Enforce reminders before Claude responds
- **Before-Complete Checklists** - Verification items before claiming completion
- **Post-Compact Recovery** - Restore context after compaction with afterCompact instructions
- **Session Start** - Load skills at session start (startup, resume, clear, compact)
- **Project-Specific** - Configure different prompts per project

**Configuration:**

Edit `.claude/prompt.yml`:

```yaml
beforeStart:
  - tag: MANDATORY-FIRST-RESPONSE
    header: 🚨 STOP - FIRST TOOL CALL MUST BE TodoWrite
    instructions:
      - DO NOT analyze. DO NOT read files. DO NOT edit.
      - "FIRST ACTION: TodoWrite with todo below as in_progress"
      - Condition NO → mark completed → proceed
    todos:
      - |
        Skill analysis (SKIP if 'quick' in message):
        (1) List ALL available skills
        (2) For EACH: YES/MIGHT/MAYBE = ✓
        (3) Skill(...) for ALL ✓ IN ONE PARALLEL CALL

beforeComplete:
  - tag: VERIFICATION-CHECKLIST
    header: 🔒 VERIFICATION REQUIRED
    instructions:
      - TodoWrite with ALL todos below
      - Condition NO → mark completed and skip
    todos:
      - "Typecheck (IF updated .ts files): Bash `bun typecheck`"
      - "Lint: Bash `bun lint:fix`"

afterCompact:
  - tag: POST-COMPACT-RECOVERY
    header: 🚨 CONTEXT WIPED - MANDATORY SKILL RELOAD
    instructions:
      - Context compaction DELETED all skills
      - DO NOT proceed until skill reload complete
    todos:
      - |
        Skill reload (MANDATORY):
        (1) List ALL available skills
        (2) Skill(...) for ALL applicable
```

**Structure:**

- `tag` - Section identifier
- `header` - Bold header shown at top of section
- `instructions` - Operation guidelines (bulleted list)
- `todos` - TodoWrite checklist items with conditional execution
- `afterCompact` - Instructions after context compaction

### 🚀 agents

Agent orchestration patterns for parallel debugging and investigation - dispatch multiple Claude agents to solve independent problems concurrently.

**Installation:**

```bash
/plugin install agents@dotai
# restart claude
```

**Features:**

- **Parallel Dispatch** - Multiple agents work concurrently on independent problems
- **Focused Scope** - Each agent has narrow domain to investigate
- **Speed** - Solve multiple problems in time of one

**Key Command:**

```bash
/agents:parallel   # Dispatch agents for parallel investigation
```

**Skills (auto-invoked):**

- `dispatching-parallel-agents` - Orchestrate multiple agents for concurrent problem-solving

[Full Plugin Documentation →](./.claude-plugin/plugins/agents/README.md)

### 🔍 debug

Systematic debugging and root cause analysis framework - four-phase investigation process ensuring understanding before fixes.

**Installation:**

```bash
/plugin install debug@dotai
# restart claude
```

**Features:**

- **Systematic Debugging** - Four-phase framework (investigate, analyze, test, implement)
- **Root Cause Tracing** - Trace bugs backward through call stack
- **Defense-in-Depth** - Add validation at multiple layers

**Key Command:**

```bash
/debug:debug   # Invoke systematic debugging framework
```

**Skills (auto-invoked):**

- `systematic-debugging` - Four-phase debugging process
- `root-cause-tracing` - Trace backward to find original trigger

[Full Plugin Documentation →](./.claude-plugin/plugins/debug/README.md)

### 🧪 test

Test-driven development workflow for writing tests before implementation - red-green-refactor cycle with deterministic unit tests.

**Installation:**

```bash
/plugin install test@dotai
# restart claude
```

**Features:**

- **Red-Green-Refactor** - Classic TDD workflow
- **Smart Test Strategy** - Auto-decide when to test based on complexity
- **Deterministic Tests** - Only unit tests, no complex mocking

**Key Command:**

```bash
/test:tdd   # Test-driven development workflow
```

**Skills (auto-invoked):**

- `test-driven-development` - Write test first, watch it fail, make it pass

[Full Plugin Documentation →](./.claude-plugin/plugins/test/README.md)

### 🔀 git

Git and GitHub workflow automation - streamlined PR creation, draft management, and code review workflows.

**Installation:**

```bash
/plugin install git@dotai
# restart claude
```

**Features:**

- **Pull Request Creation** - Full PR workflow with automatic incremental reviews
- **Draft PR Management** - Efficient draft workflow without reviews
- **Smart Commits** - Conventional commit messages and branch naming

**Key Commands:**

```bash
/git:create-pr   # Create PR with automatic code review
/git:draft-pr    # Create draft PR for work-in-progress
```

**Skills (auto-invoked):**

- `creating-pr` - PR creation with automatic incremental reviews
- `drafting-pr` - Draft PR management without reviews

[Full Plugin Documentation →](./.claude-plugin/plugins/git/README.md)

### 🔔 notification

macOS notifications for Claude Code events.

**Installation:**

```bash
/plugin install notification@dotai
# restart claude
```

**Features:**

- Get notified when Claude finishes responding
- Ping on compact events

[Full Plugin Documentation →](./.claude-plugin/plugins/notification/README.md)

### 🎵 media

Auto-play/pause media on prompt submit/stop.

**Installation:**

```bash
brew install media-control  # Required
/plugin install media@dotai
# restart claude
```

**Features:**

- Auto-play media when submitting prompts
- Auto-pause media when stopping responses
- Works with Spotify, Apple Music, YouTube, etc.

[Full Plugin Documentation →](./.claude-plugin/plugins/media/README.md)

## Workflows

### 1. Initial Setup

After Quick Start, create foundational docs:

```bash
# Create foundational docs
/dotai:create-app-design
/dotai:create-tech-stack
```

### 2. Daily Workflow

```bash
# Plan feature implementation with Opus
/plan:brainstorm      # Refine ideas into designs
/plan:write-plan      # Create implementation plan

/clear

# Start monitoring logs/errors
/watch

# Execute plan with checkpoints with Sonnet
/plan:execute-plan

# Work on features...
# Skills auto-load based on task context

# Create PR
/git:create-pr
```

## Development

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT
