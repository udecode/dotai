# Plugins

> Extend Claude Code with custom commands, agents, hooks, and MCP servers through the plugin system.

<Tip>
  For complete technical specifications and schemas, see [Plugins reference](/en/docs/claude-code/plugins-reference). For marketplace management, see [Plugin marketplaces](/en/docs/claude-code/plugin-marketplaces).
</Tip>

Plugins let you extend Claude Code with custom functionality that can be shared across projects and teams. Install plugins from [marketplaces](/en/docs/claude-code/plugin-marketplaces) to add pre-built commands, agents, hooks, and MCP servers, or create your own to automate your workflows.

## Quickstart

Let's create a simple greeting plugin to get you familiar with the plugin system. We'll build a working plugin that adds a custom command, test it locally, and understand the core concepts.

### Prerequisites

- Claude Code installed on your machine
- Basic familiarity with command-line tools

### Create your first plugin

<Steps>
  <Step title="Create the marketplace structure">
    ```bash  theme={null}
    mkdir test-marketplace
    cd test-marketplace
    ```
  </Step>

  <Step title="Create the plugin directory">
    ```bash  theme={null}
    mkdir my-first-plugin
    cd my-first-plugin
    ```
  </Step>

  <Step title="Create the plugin manifest">
    ```bash Create .claude-plugin/plugin.json theme={null}
    mkdir .claude-plugin
    cat > .claude-plugin/plugin.json << 'EOF'
    {
    "name": "my-first-plugin",
    "description": "A simple greeting plugin to learn the basics",
    "version": "1.0.0",
    "author": {
    "name": "Your Name"
    }
    }
    EOF
    ```
  </Step>

  <Step title="Add a custom command">
    ```bash Create commands/hello.md theme={null}
    mkdir commands
    cat > commands/hello.md << 'EOF'
    ---
    description: Greet the user with a personalized message
    ---

    # Hello Command

    Greet the user warmly and ask how you can help them today. Make the greeting personal and encouraging.
    EOF
    ```

  </Step>

  <Step title="Create the marketplace manifest">
    ```bash Create marketplace.json theme={null}
    cd ..
    mkdir .claude-plugin
    cat > .claude-plugin/marketplace.json << 'EOF'
    {
    "name": "test-marketplace",
    "owner": {
    "name": "Test User"
    },
    "plugins": [
    {
      "name": "my-first-plugin",
      "source": "./my-first-plugin",
      "description": "My first test plugin"
    }
    ]
    }
    EOF
    ```
  </Step>

  <Step title="Install and test your plugin">
    ```bash Start Claude Code from parent directory theme={null}
    cd ..
    claude
    ```

    ```shell Add the test marketplace theme={null}
    /plugin marketplace add ./test-marketplace
    ```

    ```shell Install your plugin theme={null}
    /plugin install my-first-plugin@test-marketplace
    ```

    Select "Install now". You'll then need to restart Claude Code in order to use the new plugin.

    ```shell Try your new command theme={null}
    /hello
    ```

    You'll see Claude use your greeting command! Check `/help` to see your new command listed.

  </Step>
</Steps>

You've successfully created and tested a plugin with these key components:

- **Plugin manifest** (`.claude-plugin/plugin.json`) - Describes your plugin's metadata
- **Commands directory** (`commands/`) - Contains your custom slash commands
- **Test marketplace** - Allows you to test your plugin locally

### Plugin structure overview

Your plugin follows this basic structure:

```
my-first-plugin/
├── .claude-plugin/
│   └── plugin.json          # Plugin metadata
├── commands/                 # Custom slash commands (optional)
│   └── hello.md
├── agents/                   # Custom agents (optional)
│   └── helper.md
└── hooks/                    # Event handlers (optional)
    └── hooks.json
```

**Additional components you can add:**

- **Commands**: Create markdown files in `commands/` directory
- **Agents**: Create agent definitions in `agents/` directory
- **Hooks**: Create `hooks/hooks.json` for event handling
- **MCP servers**: Create `.mcp.json` for external tool integration

<Note>
  **Next steps**: Ready to add more features? Jump to [Develop more complex plugins](#develop-more-complex-plugins) to add agents, hooks, and MCP servers. For complete technical specifications of all plugin components, see [Plugins reference](/en/docs/claude-code/plugins-reference).
</Note>

---

## Install and manage plugins

Learn how to discover, install, and manage plugins to extend your Claude Code capabilities.

### Prerequisites

- Claude Code installed and running
- Basic familiarity with command-line interfaces

### Add marketplaces

Marketplaces are catalogs of available plugins. Add them to discover and install plugins:

```shell Add a marketplace theme={null}
/plugin marketplace add your-org/claude-plugins
```

```shell Browse available plugins theme={null}
/plugin
```

For detailed marketplace management including Git repositories, local development, and team distribution, see [Plugin marketplaces](/en/docs/claude-code/plugin-marketplaces).

### Install plugins

#### Via interactive menu (recommended for discovery)

```shell Open the plugin management interface theme={null}
/plugin
```

Select "Browse Plugins" to see available options with descriptions, features, and installation options.

#### Via direct commands (for quick installation)

```shell Install a specific plugin theme={null}
/plugin install formatter@your-org
```

```shell Enable a disabled plugin theme={null}
/plugin enable plugin-name@marketplace-name
```

```shell Disable without uninstalling theme={null}
/plugin disable plugin-name@marketplace-name
```

```shell Completely remove a plugin theme={null}
/plugin uninstall plugin-name@marketplace-name
```

### Verify installation

After installing a plugin:

1. **Check available commands**: Run `/help` to see new commands
2. **Test plugin features**: Try the plugin's commands and features
3. **Review plugin details**: Use `/plugin` → "Manage Plugins" to see what the plugin provides

## Set up team plugin workflows

Configure plugins at the repository level to ensure consistent tooling across your team. When team members trust your repository folder, Claude Code automatically installs specified marketplaces and plugins.

**To set up team plugins:**

1. Add marketplace and plugin configuration to your repository's `.claude/settings.json`
2. Team members trust the repository folder
3. Plugins install automatically for all team members

For complete instructions including configuration examples, marketplace setup, and rollout best practices, see [Configure team marketplaces](/en/docs/claude-code/plugin-marketplaces#how-to-configure-team-marketplaces).

---

## Develop more complex plugins

Once you're comfortable with basic plugins, you can create more sophisticated extensions.

### Organize complex plugins

For plugins with many components, organize your directory structure by functionality. For complete directory layouts and organization patterns, see [Plugin directory structure](/en/docs/claude-code/plugins-reference#plugin-directory-structure).

### Test your plugins locally

When developing plugins, use a local marketplace to test changes iteratively. This workflow builds on the quickstart pattern and works for plugins of any complexity.

<Steps>
  <Step title="Set up your development structure">
    Organize your plugin and marketplace for testing:

    ```bash Create directory structure theme={null}
    mkdir dev-marketplace
    cd dev-marketplace
    mkdir my-plugin
    ```

    This creates:

    ```
    dev-marketplace/
    ├── .claude-plugin/marketplace.json  (you'll create this)
    └── my-plugin/                        (your plugin under development)
        ├── .claude-plugin/plugin.json
        ├── commands/
        ├── agents/
        └── hooks/
    ```

  </Step>

  <Step title="Create the marketplace manifest">
    ```bash Create marketplace.json theme={null}
    mkdir .claude-plugin
    cat > .claude-plugin/marketplace.json << 'EOF'
    {
    "name": "dev-marketplace",
    "owner": {
    "name": "Developer"
    },
    "plugins": [
    {
      "name": "my-plugin",
      "source": "./my-plugin",
      "description": "Plugin under development"
    }
    ]
    }
    EOF
    ```
  </Step>

  <Step title="Install and test">
    ```bash Start Claude Code from parent directory theme={null}
    cd ..
    claude
    ```

    ```shell Add your development marketplace theme={null}
    /plugin marketplace add ./dev-marketplace
    ```

    ```shell Install your plugin theme={null}
    /plugin install my-plugin@dev-marketplace
    ```

    Test your plugin components:

    * Try your commands with `/command-name`
    * Check that agents appear in `/agents`
    * Verify hooks work as expected

  </Step>

  <Step title="Iterate on your plugin">
    After making changes to your plugin code:

    ```shell Uninstall the current version theme={null}
    /plugin uninstall my-plugin@dev-marketplace
    ```

    ```shell Reinstall to test changes theme={null}
    /plugin install my-plugin@dev-marketplace
    ```

    Repeat this cycle as you develop and refine your plugin.

  </Step>
</Steps>

<Note>
  **For multiple plugins**: Organize plugins in subdirectories like `./plugins/plugin-name` and update your marketplace.json accordingly. See [Plugin sources](/en/docs/claude-code/plugin-marketplaces#plugin-sources) for organization patterns.
</Note>

### Debug plugin issues

If your plugin isn't working as expected:

1. **Check the structure**: Ensure your directories are at the plugin root, not inside `.claude-plugin/`
2. **Test components individually**: Check each command, agent, and hook separately
3. **Use validation and debugging tools**: See [Debugging and development tools](/en/docs/claude-code/plugins-reference#debugging-and-development-tools) for CLI commands and troubleshooting techniques

### Share your plugins

When your plugin is ready to share:

1. **Add documentation**: Include a README.md with installation and usage instructions
2. **Version your plugin**: Use semantic versioning in your `plugin.json`
3. **Create or use a marketplace**: Distribute through plugin marketplaces for easy installation
4. **Test with others**: Have team members test the plugin before wider distribution

<Note>
  For complete technical specifications, debugging techniques, and distribution strategies, see [Plugins reference](/en/docs/claude-code/plugins-reference).
</Note>

---

## Next steps

Now that you understand Claude Code's plugin system, here are suggested paths for different goals:

### For plugin users

- **Discover plugins**: Browse community marketplaces for useful tools
- **Team adoption**: Set up repository-level plugins for your projects
- **Marketplace management**: Learn to manage multiple plugin sources
- **Advanced usage**: Explore plugin combinations and workflows

### For plugin developers

- **Create your first marketplace**: [Plugin marketplaces guide](/en/docs/claude-code/plugin-marketplaces)
- **Advanced components**: Dive deeper into specific plugin components:
  - [Slash commands](/en/docs/claude-code/slash-commands) - Command development details
  - [Subagents](/en/docs/claude-code/sub-agents) - Agent configuration and capabilities
  - [Hooks](/en/docs/claude-code/hooks) - Event handling and automation
  - [MCP](/en/docs/claude-code/mcp) - External tool integration
- **Distribution strategies**: Package and share your plugins effectively
- **Community contribution**: Consider contributing to community plugin collections

### For team leads and administrators

- **Repository configuration**: Set up automatic plugin installation for team projects
- **Plugin governance**: Establish guidelines for plugin approval and security review
- **Marketplace maintenance**: Create and maintain organization-specific plugin catalogs
- **Training and documentation**: Help team members adopt plugin workflows effectively

## See also

- [Plugin marketplaces](/en/docs/claude-code/plugin-marketplaces) - Creating and managing plugin catalogs
- [Slash commands](/en/docs/claude-code/slash-commands) - Understanding custom commands
- [Subagents](/en/docs/claude-code/sub-agents) - Creating and using specialized agents
- [Hooks](/en/docs/claude-code/hooks) - Automating workflows with event handlers
- [MCP](/en/docs/claude-code/mcp) - Connecting to external tools and services
- [Settings](/en/docs/claude-code/settings) - Configuration options for plugins

# Plugins reference

> Complete technical reference for Claude Code plugin system, including schemas, CLI commands, and component specifications.

<Tip>
  For hands-on tutorials and practical usage, see [Plugins](/en/docs/claude-code/plugins). For plugin management across teams and communities, see [Plugin marketplaces](/en/docs/claude-code/plugin-marketplaces).
</Tip>

This reference provides complete technical specifications for the Claude Code plugin system, including component schemas, CLI commands, and development tools.

## Plugin components reference

This section documents the four types of components that plugins can provide.

### Commands

Plugins add custom slash commands that integrate seamlessly with Claude Code's command system.

**Location**: `commands/` directory in plugin root

**File format**: Markdown files with frontmatter

For complete details on plugin command structure, invocation patterns, and features, see [Plugin commands](/en/docs/claude-code/slash-commands#plugin-commands).

### Agents

Plugins can provide specialized subagents for specific tasks that Claude can invoke automatically when appropriate.

**Location**: `agents/` directory in plugin root

**File format**: Markdown files describing agent capabilities

**Agent structure**:

```markdown theme={null}
---
description: What this agent specializes in
capabilities: ["task1", "task2", "task3"]
---

# Agent Name

Detailed description of the agent's role, expertise, and when Claude should invoke it.

## Capabilities

- Specific task the agent excels at
- Another specialized capability
- When to use this agent vs others

## Context and examples

Provide examples of when this agent should be used and what kinds of problems it solves.
```

**Integration points**:

- Agents appear in the `/agents` interface
- Claude can invoke agents automatically based on task context
- Agents can be invoked manually by users
- Plugin agents work alongside built-in Claude agents

### Hooks

Plugins can provide event handlers that respond to Claude Code events automatically.

**Location**: `hooks/hooks.json` in plugin root, or inline in plugin.json

**Format**: JSON configuration with event matchers and actions

**Hook configuration**:

```json theme={null}
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/scripts/format-code.sh"
          }
        ]
      }
    ]
  }
}
```

**Available events**:

- `PreToolUse`: Before Claude uses any tool
- `PostToolUse`: After Claude uses any tool
- `UserPromptSubmit`: When user submits a prompt
- `Notification`: When Claude Code sends notifications
- `Stop`: When Claude attempts to stop
- `SubagentStop`: When a subagent attempts to stop
- `SessionStart`: At the beginning of sessions
- `SessionEnd`: At the end of sessions
- `PreCompact`: Before conversation history is compacted

**Hook types**:

- `command`: Execute shell commands or scripts
- `validation`: Validate file contents or project state
- `notification`: Send alerts or status updates

### MCP servers

Plugins can bundle Model Context Protocol (MCP) servers to connect Claude Code with external tools and services.

**Location**: `.mcp.json` in plugin root, or inline in plugin.json

**Format**: Standard MCP server configuration

**MCP server configuration**:

```json theme={null}
{
  "mcpServers": {
    "plugin-database": {
      "command": "${CLAUDE_PLUGIN_ROOT}/servers/db-server",
      "args": ["--config", "${CLAUDE_PLUGIN_ROOT}/config.json"],
      "env": {
        "DB_PATH": "${CLAUDE_PLUGIN_ROOT}/data"
      }
    },
    "plugin-api-client": {
      "command": "npx",
      "args": ["@company/mcp-server", "--plugin-mode"],
      "cwd": "${CLAUDE_PLUGIN_ROOT}"
    }
  }
}
```

**Integration behavior**:

- Plugin MCP servers start automatically when the plugin is enabled
- Servers appear as standard MCP tools in Claude's toolkit
- Server capabilities integrate seamlessly with Claude's existing tools
- Plugin servers can be configured independently of user MCP servers

---

## Plugin manifest schema

The `plugin.json` file defines your plugin's metadata and configuration. This section documents all supported fields and options.

### Complete schema

```json theme={null}
{
  "name": "plugin-name",
  "version": "1.2.0",
  "description": "Brief plugin description",
  "author": {
    "name": "Author Name",
    "email": "author@example.com",
    "url": "https://github.com/author"
  },
  "homepage": "https://docs.example.com/plugin",
  "repository": "https://github.com/author/plugin",
  "license": "MIT",
  "keywords": ["keyword1", "keyword2"],
  "commands": ["./custom/commands/special.md"],
  "agents": "./custom/agents/",
  "hooks": "./config/hooks.json",
  "mcpServers": "./mcp-config.json"
}
```

### Required fields

| Field  | Type   | Description                               | Example              |
| :----- | :----- | :---------------------------------------- | :------------------- |
| `name` | string | Unique identifier (kebab-case, no spaces) | `"deployment-tools"` |

### Metadata fields

| Field         | Type   | Description                         | Example                                            |
| :------------ | :----- | :---------------------------------- | :------------------------------------------------- |
| `version`     | string | Semantic version                    | `"2.1.0"`                                          |
| `description` | string | Brief explanation of plugin purpose | `"Deployment automation tools"`                    |
| `author`      | object | Author information                  | `{"name": "Dev Team", "email": "dev@company.com"}` |
| `homepage`    | string | Documentation URL                   | `"https://docs.example.com"`                       |
| `repository`  | string | Source code URL                     | `"https://github.com/user/plugin"`                 |
| `license`     | string | License identifier                  | `"MIT"`, `"Apache-2.0"`                            |
| `keywords`    | array  | Discovery tags                      | `["deployment", "ci-cd"]`                          |

### Component path fields

| Field        | Type           | Description                          | Example                                |
| :----------- | :------------- | :----------------------------------- | :------------------------------------- |
| `commands`   | string\|array  | Additional command files/directories | `"./custom/cmd.md"` or `["./cmd1.md"]` |
| `agents`     | string\|array  | Additional agent files               | `"./custom/agents/"`                   |
| `hooks`      | string\|object | Hook config path or inline config    | `"./hooks.json"`                       |
| `mcpServers` | string\|object | MCP config path or inline config     | `"./mcp.json"`                         |

### Path behavior rules

**Important**: Custom paths supplement default directories - they don't replace them.

- If `commands/` exists, it's loaded in addition to custom command paths
- All paths must be relative to plugin root and start with `./`
- Commands from custom paths use the same naming and namespacing rules
- Multiple paths can be specified as arrays for flexibility

**Path examples**:

```json theme={null}
{
  "commands": ["./specialized/deploy.md", "./utilities/batch-process.md"],
  "agents": ["./custom-agents/reviewer.md", "./custom-agents/tester.md"]
}
```

### Environment variables

**`${CLAUDE_PLUGIN_ROOT}`**: Contains the absolute path to your plugin directory. Use this in hooks, MCP servers, and scripts to ensure correct paths regardless of installation location.

```json theme={null}
{
  "hooks": {
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/scripts/process.sh"
          }
        ]
      }
    ]
  }
}
```

---

## Plugin directory structure

### Standard plugin layout

A complete plugin follows this structure:

```
enterprise-plugin/
├── .claude-plugin/           # Metadata directory
│   └── plugin.json          # Required: plugin manifest
├── commands/                 # Default command location
│   ├── status.md
│   └──  logs.md
├── agents/                   # Default agent location
│   ├── security-reviewer.md
│   ├── performance-tester.md
│   └── compliance-checker.md
├── hooks/                    # Hook configurations
│   ├── hooks.json           # Main hook config
│   └── security-hooks.json  # Additional hooks
├── .mcp.json                # MCP server definitions
├── scripts/                 # Hook and utility scripts
│   ├── security-scan.sh
│   ├── format-code.py
│   └── deploy.js
├── LICENSE                  # License file
└── CHANGELOG.md             # Version history
```

<Warning>
  The `.claude-plugin/` directory contains the `plugin.json` file. All other directories (commands/, agents/, hooks/) must be at the plugin root, not inside `.claude-plugin/`.
</Warning>

### File locations reference

| Component       | Default Location             | Purpose                      |
| :-------------- | :--------------------------- | :--------------------------- |
| **Manifest**    | `.claude-plugin/plugin.json` | Required metadata file       |
| **Commands**    | `commands/`                  | Slash command markdown files |
| **Agents**      | `agents/`                    | Subagent markdown files      |
| **Hooks**       | `hooks/hooks.json`           | Hook configuration           |
| **MCP servers** | `.mcp.json`                  | MCP server definitions       |

---

## Debugging and development tools

### Debugging commands

Use `claude --debug` to see plugin loading details:

```bash theme={null}
claude --debug
```

This shows:

- Which plugins are being loaded
- Any errors in plugin manifests
- Command, agent, and hook registration
- MCP server initialization

### Common issues

| Issue                  | Cause                           | Solution                                             |
| :--------------------- | :------------------------------ | :--------------------------------------------------- |
| Plugin not loading     | Invalid `plugin.json`           | Validate JSON syntax                                 |
| Commands not appearing | Wrong directory structure       | Ensure `commands/` at root, not in `.claude-plugin/` |
| Hooks not firing       | Script not executable           | Run `chmod +x script.sh`                             |
| MCP server fails       | Missing `${CLAUDE_PLUGIN_ROOT}` | Use variable for all plugin paths                    |
| Path errors            | Absolute paths used             | All paths must be relative and start with `./`       |

---

## Distribution and versioning reference

### Version management

Follow semantic versioning for plugin releases:

```json theme={null}

## See also

- [Plugins](/en/docs/claude-code/plugins) - Tutorials and practical usage
- [Plugin marketplaces](/en/docs/claude-code/plugin-marketplaces) - Creating and managing marketplaces
- [Slash commands](/en/docs/claude-code/slash-commands) - Command development details
- [Subagents](/en/docs/claude-code/sub-agents) - Agent configuration and capabilities
- [Hooks](/en/docs/claude-code/hooks) - Event handling and automation
- [MCP](/en/docs/claude-code/mcp) - External tool integration
- [Settings](/en/docs/claude-code/settings) - Configuration options for plugins
```

# Plugin marketplaces

> Create and manage plugin marketplaces to distribute Claude Code extensions across teams and communities.

Plugin marketplaces are catalogs of available plugins that make it easy to discover, install, and manage Claude Code extensions. This guide shows you how to use existing marketplaces and create your own for team distribution.

## Overview

A marketplace is a JSON file that lists available plugins and describes where to find them. Marketplaces provide:

- **Centralized discovery**: Browse plugins from multiple sources in one place
- **Version management**: Track and update plugin versions automatically
- **Team distribution**: Share required plugins across your organization
- **Flexible sources**: Support for git repositories, GitHub repos, local paths, and package managers

### Prerequisites

- Claude Code installed and running
- Basic familiarity with JSON file format
- For creating marketplaces: Git repository or local development environment

## Add and use marketplaces

Add marketplaces using the `/plugin marketplace` commands to access plugins from different sources:

### Add GitHub marketplaces

```shell Add a GitHub repository containing .claude-plugin/marketplace.json theme={null}
/plugin marketplace add owner/repo
```

### Add Git repositories

```shell Add any git repository theme={null}
/plugin marketplace add https://gitlab.com/company/plugins.git
```

### Add local marketplaces for development

```shell Add local directory containing .claude-plugin/marketplace.json theme={null}
/plugin marketplace add ./my-marketplace
```

```shell Add direct path to marketplace.json file theme={null}
/plugin marketplace add ./path/to/marketplace.json
```

```shell Add remote marketplace.json via URL theme={null}
/plugin marketplace add https://url.of/marketplace.json
```

### Install plugins from marketplaces

Once you've added marketplaces, install plugins directly:

```shell Install from any known marketplace theme={null}
/plugin install plugin-name@marketplace-name
```

```shell Browse available plugins interactively theme={null}
/plugin
```

### Verify marketplace installation

After adding a marketplace:

1. **List marketplaces**: Run `/plugin marketplace list` to confirm it's added
2. **Browse plugins**: Use `/plugin` to see available plugins from your marketplace
3. **Test installation**: Try installing a plugin to verify the marketplace works correctly

## Configure team marketplaces

Set up automatic marketplace installation for team projects by specifying required marketplaces in `.claude/settings.json`:

```json theme={null}
{
  "extraKnownMarketplaces": {
    "team-tools": {
      "source": {
        "source": "github",
        "repo": "your-org/claude-plugins"
      }
    },
    "project-specific": {
      "source": {
        "source": "git",
        "url": "https://git.company.com/project-plugins.git"
      }
    }
  }
}
```

When team members trust the repository folder, Claude Code automatically installs these marketplaces and any plugins specified in the `enabledPlugins` field.

---

## Create your own marketplace

Build and distribute custom plugin collections for your team or community.

### Prerequisites for marketplace creation

- Git repository (GitHub, GitLab, or other git hosting)
- Understanding of JSON file format
- One or more plugins to distribute

### Create the marketplace file

Create `.claude-plugin/marketplace.json` in your repository root:

```json theme={null}
{
  "name": "company-tools",
  "owner": {
    "name": "DevTools Team",
    "email": "devtools@company.com"
  },
  "plugins": [
    {
      "name": "code-formatter",
      "source": "./plugins/formatter",
      "description": "Automatic code formatting on save",
      "version": "2.1.0",
      "author": {
        "name": "DevTools Team"
      }
    },
    {
      "name": "deployment-tools",
      "source": {
        "source": "github",
        "repo": "company/deploy-plugin"
      },
      "description": "Deployment automation tools"
    }
  ]
}
```

### Marketplace schema

#### Required fields

| Field     | Type   | Description                                    |
| :-------- | :----- | :--------------------------------------------- |
| `name`    | string | Marketplace identifier (kebab-case, no spaces) |
| `owner`   | object | Marketplace maintainer information             |
| `plugins` | array  | List of available plugins                      |

#### Optional metadata

| Field                  | Type   | Description                           |
| :--------------------- | :----- | :------------------------------------ |
| `metadata.description` | string | Brief marketplace description         |
| `metadata.version`     | string | Marketplace version                   |
| `metadata.pluginRoot`  | string | Base path for relative plugin sources |

### Plugin entries

<Note>
  Plugin entries are based on the *plugin manifest schema* (with all fields made optional) plus marketplace-specific fields (`source`, `category`, `tags`, `strict`), with `name` being required.
</Note>

**Required fields:**

| Field    | Type           | Description                               |
| :------- | :------------- | :---------------------------------------- |
| `name`   | string         | Plugin identifier (kebab-case, no spaces) |
| `source` | string\|object | Where to fetch the plugin from            |

#### Optional plugin fields

**Standard metadata fields:**

| Field         | Type    | Description                                                       |
| :------------ | :------ | :---------------------------------------------------------------- |
| `description` | string  | Brief plugin description                                          |
| `version`     | string  | Plugin version                                                    |
| `author`      | object  | Plugin author information                                         |
| `homepage`    | string  | Plugin homepage or documentation URL                              |
| `repository`  | string  | Source code repository URL                                        |
| `license`     | string  | SPDX license identifier (e.g., MIT, Apache-2.0)                   |
| `keywords`    | array   | Tags for plugin discovery and categorization                      |
| `category`    | string  | Plugin category for organization                                  |
| `tags`        | array   | Tags for searchability                                            |
| `strict`      | boolean | Require plugin.json in plugin folder (default: true) <sup>1</sup> |

**Component configuration fields:**

| Field        | Type           | Description                                      |
| :----------- | :------------- | :----------------------------------------------- |
| `commands`   | string\|array  | Custom paths to command files or directories     |
| `agents`     | string\|array  | Custom paths to agent files                      |
| `hooks`      | string\|object | Custom hooks configuration or path to hooks file |
| `mcpServers` | string\|object | MCP server configurations or path to MCP config  |

_<sup>1 - When `strict: true` (default), the plugin must include a `plugin.json` manifest file, and marketplace fields supplement those values. When `strict: false`, the plugin.json is optional. If it's missing, the marketplace entry serves as the complete plugin manifest.</sup>_

### Plugin sources

#### Relative paths

For plugins in the same repository:

```json theme={null}
{
  "name": "my-plugin",
  "source": "./plugins/my-plugin"
}
```

#### GitHub repositories

```json theme={null}
{
  "name": "github-plugin",
  "source": {
    "source": "github",
    "repo": "owner/plugin-repo"
  }
}
```

#### Git repositories

```json theme={null}
{
  "name": "git-plugin",
  "source": {
    "source": "url",
    "url": "https://gitlab.com/team/plugin.git"
  }
}
```

#### Advanced plugin entries

Plugin entries can override default component locations and provide additional metadata. Note that `${CLAUDE_PLUGIN_ROOT}` is an environment variable that resolves to the plugin's installation directory (for details see [Environment variables](/en/docs/claude-code/plugins-reference#environment-variables)):

```json theme={null}
{
  "name": "enterprise-tools",
  "source": {
    "source": "github",
    "repo": "company/enterprise-plugin"
  },
  "description": "Enterprise workflow automation tools",
  "version": "2.1.0",
  "author": {
    "name": "Enterprise Team",
    "email": "enterprise@company.com"
  },
  "homepage": "https://docs.company.com/plugins/enterprise-tools",
  "repository": "https://github.com/company/enterprise-plugin",
  "license": "MIT",
  "keywords": ["enterprise", "workflow", "automation"],
  "category": "productivity",
  "commands": [
    "./commands/core/",
    "./commands/enterprise/",
    "./commands/experimental/preview.md"
  ],
  "agents": ["./agents/security-reviewer.md", "./agents/compliance-checker.md"],
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/scripts/validate.sh"
          }
        ]
      }
    ]
  },
  "mcpServers": {
    "enterprise-db": {
      "command": "${CLAUDE_PLUGIN_ROOT}/servers/db-server",
      "args": ["--config", "${CLAUDE_PLUGIN_ROOT}/config.json"]
    }
  },
  "strict": false
}
```

<Note>
  **Schema relationship**: Plugin entries use the plugin manifest schema with all fields made optional, plus marketplace-specific fields (`source`, `strict`, `category`, `tags`). This means any field valid in a `plugin.json` file can also be used in a marketplace entry. When `strict: false`, the marketplace entry serves as the complete plugin manifest if no `plugin.json` exists. When `strict: true` (default), marketplace fields supplement the plugin's own manifest file.
</Note>

---

## Host and distribute marketplaces

Choose the best hosting strategy for your plugin distribution needs.

### Host on GitHub (recommended)

GitHub provides the easiest distribution method:

1. **Create a repository**: Set up a new repository for your marketplace
2. **Add marketplace file**: Create `.claude-plugin/marketplace.json` with your plugin definitions
3. **Share with teams**: Team members add with `/plugin marketplace add owner/repo`

**Benefits**: Built-in version control, issue tracking, and team collaboration features.

### Host on other git services

Any git hosting service works for marketplace distribution, using a URL to an arbitrary git repository.

For example, using GitLab:

```shell theme={null}
/plugin marketplace add https://gitlab.com/company/plugins.git
```

### Use local marketplaces for development

Test your marketplace locally before distribution:

```shell Add local marketplace for testing theme={null}
/plugin marketplace add ./my-local-marketplace
```

```shell Test plugin installation theme={null}
/plugin install test-plugin@my-local-marketplace
```

## Manage marketplace operations

### List known marketplaces

```shell List all configured marketplaces theme={null}
/plugin marketplace list
```

Shows all configured marketplaces with their sources and status.

### Update marketplace metadata

```shell Refresh marketplace metadata theme={null}
/plugin marketplace update marketplace-name
```

Refreshes plugin listings and metadata from the marketplace source.

### Remove a marketplace

```shell Remove a marketplace theme={null}
/plugin marketplace remove marketplace-name
```

Removes the marketplace from your configuration.

<Warning>
  Removing a marketplace will uninstall any plugins you installed from it.
</Warning>

---

## Troubleshooting marketplaces

### Common marketplace issues

#### Marketplace not loading

**Symptoms**: Can't add marketplace or see plugins from it

**Solutions**:

- Verify the marketplace URL is accessible
- Check that `.claude-plugin/marketplace.json` exists at the specified path
- Ensure JSON syntax is valid using `claude plugin validate`
- For private repositories, confirm you have access permissions

#### Plugin installation failures

**Symptoms**: Marketplace appears but plugin installation fails

**Solutions**:

- Verify plugin source URLs are accessible
- Check that plugin directories contain required files
- For GitHub sources, ensure repositories are public or you have access
- Test plugin sources manually by cloning/downloading

### Validation and testing

Test your marketplace before sharing:

```bash Validate marketplace JSON syntax theme={null}
claude plugin validate .
```

```shell Add marketplace for testing theme={null}
/plugin marketplace add ./path/to/marketplace
```

```shell Install test plugin theme={null}
/plugin install test-plugin@marketplace-name
```

For complete plugin testing workflows, see [Test your plugins locally](/en/docs/claude-code/plugins#test-your-plugins-locally). For technical troubleshooting, see [Plugins reference](/en/docs/claude-code/plugins-reference).

---

## Next steps

### For marketplace users

- **Discover community marketplaces**: Search GitHub for Claude Code plugin collections
- **Contribute feedback**: Report issues and suggest improvements to marketplace maintainers
- **Share useful marketplaces**: Help your team discover valuable plugin collections

### For marketplace creators

- **Build plugin collections**: Create themed marketplace around specific use cases
- **Establish versioning**: Implement clear versioning and update policies
- **Community engagement**: Gather feedback and maintain active marketplace communities
- **Documentation**: Provide clear README files explaining your marketplace contents

### For organizations

- **Private marketplaces**: Set up internal marketplaces for proprietary tools
- **Governance policies**: Establish guidelines for plugin approval and security review
- **Training resources**: Help teams discover and adopt useful plugins effectively

## See also

- [Plugins](/en/docs/claude-code/plugins) - Installing and using plugins
- [Plugins reference](/en/docs/claude-code/plugins-reference) - Complete technical specifications and schemas
- [Plugin development](/en/docs/claude-code/plugins#develop-more-complex-plugins) - Creating your own plugins
- [Settings](/en/docs/claude-code/settings#plugin-configuration) - Plugin configuration options

## Plugin configuration

Claude Code supports a plugin system that lets you extend functionality with custom commands, agents, hooks, and MCP servers. Plugins are distributed through marketplaces and can be configured at both user and repository levels.

### Plugin settings

Plugin-related settings in `settings.json`:

```json theme={null}
{
  "enabledPlugins": {
    "formatter@company-tools": true,
    "deployer@company-tools": true,
    "analyzer@security-plugins": false
  },
  "extraKnownMarketplaces": {
    "company-tools": {
      "source": "github",
      "repo": "company/claude-plugins"
    }
  }
}
```

#### `enabledPlugins`

Controls which plugins are enabled. Format: `"plugin-name@marketplace-name": true/false`

**Scopes**:

- **User settings** (`~/.claude/settings.json`): Personal plugin preferences
- **Project settings** (`.claude/settings.json`): Project-specific plugins shared with team
- **Local settings** (`.claude/settings.local.json`): Per-machine overrides (not committed)

**Example**:

```json theme={null}
{
  "enabledPlugins": {
    "code-formatter@team-tools": true,
    "deployment-tools@team-tools": true,
    "experimental-features@personal": false
  }
}
```

#### `extraKnownMarketplaces`

Defines additional marketplaces that should be made available for the repository. Typically used in repository-level settings to ensure team members have access to required plugin sources.

**When a repository includes `extraKnownMarketplaces`**:

1. Team members are prompted to install the marketplace when they trust the folder
2. Team members are then prompted to install plugins from that marketplace
3. Users can skip unwanted marketplaces or plugins (stored in user settings)
4. Installation respects trust boundaries and requires explicit consent

**Example**:

```json theme={null}
{
  "extraKnownMarketplaces": {
    "company-tools": {
      "source": {
        "source": "github",
        "repo": "company-org/claude-plugins"
      }
    },
    "security-plugins": {
      "source": {
        "source": "git",
        "url": "https://git.company.com/security/plugins.git"
      }
    }
  }
}
```

**Marketplace source types**:

- `github`: GitHub repository (uses `repo`)
- `git`: Any git URL (uses `url`)
- `directory`: Local filesystem path (uses `path`, for development only)

### Managing plugins

Use the `/plugin` command to manage plugins interactively:

- Browse available plugins from marketplaces
- Install/uninstall plugins
- Enable/disable plugins
- View plugin details (commands, agents, hooks provided)
- Add/remove marketplaces

Learn more about the plugin system in the [plugins documentation](/en/docs/claude-code/plugins).
