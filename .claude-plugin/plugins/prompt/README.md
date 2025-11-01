# Prompt Plugin

Dynamic prompt injection system that enforces custom checklists and workflows before Claude responds and before claiming completion.

## Features

- **Before-Start Checklists**: Automatically inject reminders that Claude must follow before responding to any user message
- **Before-Complete Checklists**: Verification items that must be checked before claiming work is complete
- **Project-Specific**: Configure different prompts per project via `.claude/prompt.json`

## Installation

### Via Registry (Recommended)

Install the prompt config file:

```bash
npx shadcn@latest add https://raw.githubusercontent.com/udecode/dotai/main/registry/prompt.json
```

This installs `.claude/prompt.json` with default configuration.

### Manual Setup

1. Create `.claude/prompt.json` in your project:

```json
{
  "beforeStart": [
    {
      "tag": "MANDATORY-FIRST-RESPONSE",
      "items": [
        "List available skills matching user request",
        "If ANY skill matches: Use Skill tool FIRST, announce usage, then respond",
        "No rationalizations: 'simple task', 'I know this', 'just checking files' = WRONG"
      ]
    }
  ],
  "beforeComplete": [
    {
      "tag": "VERIFICATION-CHECKLIST",
      "items": [
        "NEVER use TypeScript `any`. If a situation seems to require `any`, pause and ask the user for explicit approval before proceeding",
        "NEVER make git commits unless explicitly asked by the user"
      ]
    }
  ]
}
```

2. The plugin will automatically inject these prompts on every user message

## Configuration

### prompt.json Format

```json
{
  "beforeStart": [
    {
      "tag": "CUSTOM-TAG-NAME",
      "items": [
        "Checklist item 1",
        "Checklist item 2"
      ]
    }
  ],
  "beforeComplete": [
    {
      "tag": "VERIFICATION-TAG",
      "items": [
        "Verification item 1",
        "Verification item 2"
      ]
    }
  ]
}
```

### Fields

- **beforeStart**: Array of checklist sections shown before Claude responds
  - **tag**: XML-style tag name for the section
  - **items**: Array of checklist items
- **beforeComplete**: Array of verification sections shown before claiming completion
  - **tag**: XML-style tag name for the section
  - **items**: Array of verification items

## Use Cases

1. **Skills Enforcement**: Ensure Claude checks for available skills before responding
2. **Code Quality**: Enforce TypeScript strict mode, avoid `any` types
3. **Git Workflow**: Prevent unauthorized commits
4. **Custom Workflows**: Add project-specific reminders and verification steps
5. **Team Standards**: Share consistent development practices across team

## How It Works

The plugin uses a `UserPromptSubmit` hook that:

1. Reads `.claude/prompt.json` on every user message
2. Formats checklist sections as XML tags
3. Injects formatted prompts into Claude's context

## How It Works

The plugin provides a `UserPromptSubmit` hook that references a script installed in your project by the registry.

**Plugin provides:**
- Hook configuration in `hooks/hooks.json`
- References `${CLAUDE_PROJECT_DIR}/.claude/scripts/user-prompt-submit.sh`

**Registry installs:**
- `.claude/prompt.json` - Configuration file
- `.claude/scripts/user-prompt-submit.sh` - Hook script

The script uses Node.js to parse JSON and format output.

### File Structure

**Plugin** (`.claude-plugin/plugins/prompt/`):
```
prompt/
├── .claude-plugin/
│   └── plugin.json          # Plugin metadata
├── hooks/
│   └── hooks.json           # Hook configuration
└── README.md                # This file
```

**Registry** (`registry/prompt/`):
```
prompt/
├── config/
│   └── prompt.json          # Default config
└── scripts/
    └── user-prompt-submit.sh # Hook script
```

## License

MIT
