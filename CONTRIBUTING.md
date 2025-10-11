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
#    - registry/dotai/settings.json (production/registry):
#      "enabledPlugins": {
#        "my-plugin@dotai": true
#      }
#
# 4. Restart Claude Code to load the plugin
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
│   └── plugin.json          # Required
├── commands/                 # Slash commands (optional)
│   └── *.md
├── agents/                   # Subagents (optional)
│   └── *.md
├── hooks/                    # Event handlers (optional)
│   └── hooks.json
├── .mcp.json                # MCP servers (optional)
└── README.md                # Plugin documentation
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
