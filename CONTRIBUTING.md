# Contributing to dotai Plugins

- @README.md

## Development Setup

### Repository Structure

```
dotai/
└── .claude-plugin/              # Production (GitHub)
    ├── marketplace.json
    └── plugins/
        └── docs/                # Published plugins
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

## Local Development Workflow

### Creating and Testing Plugins

Develop and test plugins directly in `.claude-plugin/`:

```bash
# 1. Create plugin structure in .claude-plugin/plugins/my-plugin/
#    - .claude-plugin/plugin.json (required)
#    - README.md (recommended)
#    - commands/ (optional)
#    - agents/ (optional)
#
# 2. Add to .claude-plugin/marketplace.json:
#    {
#      "name": "my-plugin",
#      "source": "./.claude-plugin/plugins/my-plugin",
#      "description": "Brief description"
#    }
#
# 3. Enable in BOTH settings files:
#    - .claude/settings.json (local development):
#      "enabledPlugins": {
#        "my-plugin@dotai": true
#      }
#
# 4. Add to registry/dotai/settings.json (for production users):
#    "enabledPlugins": {
#      "my-plugin@dotai": true
#    }
#
# 5. Restart Claude Code to load the plugin
```

### Development vs. Production Plugins

**Production Plugins** (`.claude-plugin/plugins/`):

- Reusable across projects
- Published in marketplace
- Examples: `dotai`, `notification`, `fb`
- Must be self-contained and project-agnostic

**Development/Testing** (same location during development):

- Test plugins before publishing
- Develop new features locally
- Preview changes before release

**Project-Specific Commands** (`.claude/commands/`):

- Custom to this project only
- Not meant for reuse
- Examples: project-specific workflows, custom scripts
- Never published to marketplace

## Registry Items (shadcn Installable Components)

### Creating a New Registry Item

Registry items allow users to install files directly into their projects using the shadcn CLI.

**Structure:**

```
registry/
├── registry.json           # Registry definition
├── flashback/              # Registry item files
└── flashback.json          # Registry item definition (AUTO-GENERATED with "pnpm r")
```

**Steps to add a new registry item:**

1. **Create the item structure** in `registry/`:

   ```bash
   mkdir -p registry/my-item
   ```

2. **Add your files** to the item directory

3. **Update `registry/registry.json`**:

   ```json
   {
     "name": "my-item",
     "type": "registry:block",
     "title": "My Item",
     "description": "Description of what this item does",
     "dependencies": ["package1", "package2"], // Optional npm packages
     "files": [
       {
         "path": "registry/my-item/scripts/my-script.sh",
         "type": "registry:file",
         "target": ".claude/my-item/scripts/my-script.sh"
       }
     ]
   }
   ```

4. **Build the registry**:

   ```bash
   pnpm r
   ```

   This generates `registry/my-item.json` that users can install via shadcn CLI.

5. **Test the installation**:
   ```bash
   npx shadcn@latest add ./registry/my-item.json
   ```

**Available registry items:**

- `dotai` - Project initialization (CLAUDE.md, settings, docs templates, tree script)
- `flashback` - Session management system
- `ctx` - Context-aware AGENTS.md generator
- `all` - All registry items combined (dotai + flashback + ctx)

## Plugin Development Guidelines

### File Structure

```
my-plugin/
├── .claude-plugin/
│   └── plugin.json          # Required: metadata and env vars
├── commands/                 # Slash commands (optional)
│   └── *.md
├── agents/                   # Subagents (optional)
│   └── *.md
├── hooks/                    # Event handlers (optional)
│   └── hooks.json           # Hook definitions (NOT in plugin.json)
├── .mcp.json                # MCP servers (optional)
└── README.md                # Plugin documentation
```

**Important**: Hooks must be defined in `hooks/hooks.json`, NOT in `.claude-plugin/plugin.json`. The plugin.json should only contain metadata and environment variables.

### plugin.json Format

```json
{
  "name": "my-plugin",
  "version": "0.1.0",
  "description": "Brief description",
  "author": {
    "name": "zbeyens"
  },
  "env": {
    "MY_PLUGIN_SETTING": "default-value"
  }
}
```

### Environment Variables

**Available in plugin hooks and scripts:**

- **`${CLAUDE_PLUGIN_ROOT}`**: Absolute path to the plugin directory
- **`${CLAUDE_PROJECT_DIR}`**: Project root directory (same as for project hooks)

**Example usage in hooks:**

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/scripts/process.sh ${CLAUDE_PROJECT_DIR}"
          }
        ]
      }
    ]
  }
}
```

### Dynamic Environment Variables (No Restart Required)

To read environment variables from `.claude/settings.json` and `.claude/settings.local.json` dynamically (changes take effect immediately without restarting Claude Code), create a helper script:

**scripts/get-env.js:**
```javascript
#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const varName = process.argv[2];
const defaultValue = process.argv[3] || '';

if (!varName) {
  console.error('Usage: get-env.js <VAR_NAME> [default_value]');
  process.exit(1);
}

const projectDir = process.env.CLAUDE_PROJECT_DIR;
if (!projectDir) {
  console.log(defaultValue);
  process.exit(0);
}

const claudePath = path.join(projectDir, '.claude');
let env = {};

// Read settings.json
try {
  const settingsPath = path.join(claudePath, 'settings.json');
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  if (settings.env) {
    env = { ...env, ...settings.env };
  }
} catch (e) {}

// Read settings.local.json (overrides)
try {
  const localSettingsPath = path.join(claudePath, 'settings.local.json');
  const localSettings = JSON.parse(fs.readFileSync(localSettingsPath, 'utf8'));
  if (localSettings.env) {
    env = { ...env, ...localSettings.env };
  }
} catch (e) {}

console.log(env[varName] !== undefined ? env[varName] : defaultValue);
```

**Usage in hooks:**
```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "MY_VAR=$(node ${CLAUDE_PLUGIN_ROOT}/scripts/get-env.js MY_VAR default 2>/dev/null || echo 'default'); echo \"Value: $MY_VAR\""
          }
        ]
      }
    ]
  }
}
```

This approach:
- Reads from `settings.json` first
- Overlays `settings.local.json` (which overrides)
- Falls back to a default value if neither file has the variable
- Handles falsy values like `false` correctly
- Works immediately when settings change (no restart needed)
- Much cleaner and reusable across multiple hooks

### hooks.json Format

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "echo 'Prompt submitted'"
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "echo 'Response stopped'"
          }
        ]
      }
    ]
  }
}
```

### Command Format

```markdown
---
description: Brief command description
allowed-tools: Bash, Read, Write, Glob, Grep # Optional
---

<!-- content here -->
```

### Best Practices

1. **Self-contained** - Embed templates/data in commands (no external files)
2. **Clear descriptions** - Make commands discoverable in `/help`
3. **Project-agnostic** - Reference project files via `@` syntax
4. **DRY principle** - Use `strict: true` (default) to avoid duplicating metadata
5. **Documentation** - Include comprehensive README.md

### What NOT to Do

❌ Don't include absolute paths
❌ Don't copy files to user's project automatically
❌ Don't duplicate metadata between plugin.json and marketplace.json
❌ Don't forget to update version numbers

## Debugging

### Common Issues

**Plugin not loading:**

```bash
# Validate marketplace and plugin structure
claude plugin validate .
claude --debug  # See plugin loading details
```

**Commands not appearing:**

- Ensure `commands/` is at plugin root (not in `.claude-plugin/`)
- Restart Claude Code after installation
- Check plugin.json syntax

**References not working:**

- Use `@` for project files: `@package.json`
- Use `!` for shell commands: `!pwd`
- Project-relative paths work, plugin-relative don't
