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
- Examples: `dotai`, `notification`
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
├── registry.json           # Registry definition (EDIT THIS)
├── my-item/                # Registry item files
└── my-item.json            # Registry item definition (AUTO-GENERATED - NEVER EDIT)
```

**⚠️ IMPORTANT:**

- **NEVER manually edit** generated JSON files (dotai.json, etc.)
- **ONLY edit** registry/registry.json
- **ALWAYS run** `pnpm r` after changes to regenerate all registry item JSON files

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

   This auto-generates `registry/my-item.json` that users can install via shadcn CLI.

   **⚠️ Never manually edit the generated JSON files!** Always edit `registry/registry.json` and run `pnpm r`.

5. **Test the installation**:
   ```bash
   npx shadcn@latest add ./registry/my-item.json
   ```

**Available registry items:**

- `dotai` - Project initialization (AGENTS.md, settings, ruler config)
- `prompt` - Prompt injection system with before-start/before-complete checklists
- `all` - All registry items combined (dotai + prompt)

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
├── skills/                   # Agent Skills (optional)
│   └── skill-name/
│       ├── SKILL.md          # Required: skill instructions
│       ├── reference.md      # Optional: documentation
│       └── scripts/          # Optional: utility scripts
├── hooks/                    # Event handlers (optional)
│   └── hooks.json           # Hook definitions (NOT in plugin.json)
├── .mcp.json                # MCP servers (optional)
└── README.md                # Plugin documentation
```

**Important**: Hooks must be defined in `hooks/hooks.json`, NOT in `.claude-plugin/plugin.json`. The plugin.json should only contain metadata and environment variables.

### plugin.json Format

**Valid Fields Only:**

```json
{
  "name": "my-plugin",
  "version": "0.1.0",
  "description": "Brief description",
  "author": {
    "name": "zbeyens"
  },
  "keywords": ["keyword1", "keyword2"],
  "env": {
    "MY_PLUGIN_SETTING": "default-value"
  }
}
```

**Supported Fields:**

- `name` (required): Plugin identifier
- `version` (required): Semantic version string
- `description` (required): Brief plugin description
- `author` (optional): Author information with `name` field
- `keywords` (optional): Array of searchable keywords
- `env` (optional): Default environment variables

**Invalid Fields:**

- Any other undocumented fields will cause validation errors

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

const fs = require("fs");
const path = require("path");

const varName = process.argv[2];
const defaultValue = process.argv[3] || "";

if (!varName) {
  process.exit(1);
}

// Use current working directory
const projectDir = process.cwd();
const claudePath = path.join(projectDir, ".claude");
let env = {};

// Read settings.json
try {
  const settingsPath = path.join(claudePath, "settings.json");
  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  if (settings.env) {
    env = { ...env, ...settings.env };
  }
} catch (e) {
  // Ignore if file doesn't exist or is invalid
}

// Read settings.local.json (overrides)
try {
  const localSettingsPath = path.join(claudePath, "settings.local.json");
  const localSettings = JSON.parse(fs.readFileSync(localSettingsPath, "utf8"));
  if (localSettings.env) {
    env = { ...env, ...localSettings.env };
  }
} catch (e) {
  // Ignore if file doesn't exist or is invalid
}

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
- Uses `process.cwd()` to find the project directory
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

### Add Skills to Your Plugin

Plugins can include Agent Skills to extend Claude's capabilities. Skills are model-invoked—Claude autonomously uses them based on the task context.

To add Skills to your plugin, create a `skills/` directory at your plugin root and add Skill folders with SKILL.md files. Plugin Skills are automatically available when the plugin is installed.

**Skill Structure:**

```
skills/
├── brainstorming/
│   └── SKILL.md
├── executing-plans/
│   └── SKILL.md
└── writing-plans/
    ├── SKILL.md
    └── scripts/
        └── helper.py
```

**SKILL.md Format:**

```yaml
---
name: your-skill-name
description: Brief description of what this skill does and when to use it
---

# Your Skill Name

## Instructions
Provide clear, step-by-step guidance for Claude.

## Examples
Show concrete examples of using this skill.
```

**Field requirements:**

- `name`: Must use lowercase letters, numbers, and hyphens only (max 64 characters)
- `description`: Brief description of what the skill does and when to use it (max 1024 characters)

The `description` field is critical for Claude to discover when to use your Skill. It should include both what the Skill does and when Claude should use it.

### Best Practices

1. **Self-contained** - Embed templates/data in commands (no external files)
2. **Clear descriptions** - Make commands discoverable in `/help`
3. **Project-agnostic** - Reference project files via `@` syntax
4. **DRY principle** - Use `strict: true` (default) to avoid duplicating metadata
5. **Documentation** - Include comprehensive README.md
6. **Focused Skills** - One skill should address one capability
7. **Clear skill descriptions** - Help Claude discover when to use Skills by including specific triggers

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
