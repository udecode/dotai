# codex Plugin

MCP servers for Codex integration with Claude Code.

## Overview

This plugin provides MCP (Model Context Protocol) servers that enable Claude Code to invoke Codex for complex tasks. This allows you to leverage different AI models within your Claude Code workflow.

## Installation

```bash
/plugin install codex@dotai
```

Then restart Claude Code.

## Features

### GPT MCP Server

Provides access to GPT-5 with high reasoning effort for general-purpose tasks:

```bash
mcp__gpt__codex
```

### Codex MCP Server

Provides access to GPT-5-Codex with high reasoning effort for coding tasks:

```bash
mcp__codex__codex
```

## Prerequisites

You must have the `codex` CLI tool installed and configured:

```bash
# Install codex
npm install -g @openai/codex-cli
```

## Usage

Once the plugin is installed and Claude Code is restarted, the MCP servers will be available as tools in Claude Code's toolkit. Claude will automatically use these servers when appropriate for complex tasks.

### Example Use Cases

- **GPT Server**: General problem-solving, analysis, research
- **Codex Server**: Code generation, debugging, refactoring

## Configuration

The plugin uses the following default configuration:

- **Model**: `gpt-5` (GPT) / `gpt-5-codex` (Codex)
- **Reasoning Effort**: `high`
- **Protocol**: stdio (standard input/output)

These settings are optimized for quality output and can be modified in [.mcp.json](./.mcp.json) if needed.

## Troubleshooting

**MCP servers not appearing:**

- Ensure codex CLI is installed: `which codex`
- Verify API key is configured: `codex config list`
- Restart Claude Code after installation

**Permission errors:**

- Make sure codex is executable: `chmod +x $(which codex)`
- Check that your OpenAI API key has proper permissions

## License

MIT
