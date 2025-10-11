# Notification Plugin

macOS notifications for Claude Code events.

## Features

Displays native macOS notifications for:

- **Stop** - Shows "Claude finished responding" when Claude stops
- **PreCompact** - Shows "Compacting conversation..." before context compaction
- **Notification** - (Disabled by default) Shows system notifications

## Prerequisites

Requires [terminal-notifier](https://github.com/julienXX/terminal-notifier) to be installed:

```bash
brew install terminal-notifier
```

## Installation

```bash
/plugin marketplace add udecode/dotai
/plugin install notification@dotai
```

Restart Claude Code to activate the hooks.

## What You'll See

- 🔔 **Ping sound** - When Claude finishes responding
- 🍾 **Bottle sound** - When compacting conversation history
- 📝 **Dynamic titles** - Shows the conversation summary as notification title

## How It Works

The plugin uses hooks to intercept Claude Code events and displays notifications with:

- **Title**: Extracted from conversation transcript summary
- **Message**: Event-specific message
- **Sound**: Different sounds for different events

## Customization

Edit `.claude-plugin/plugins/notification/hooks/hooks.json` to:

- Change notification sounds (`Ping`, `Bottle`, `Glass`, `Submarine`, etc.)
- Modify messages
- Enable/disable specific notifications
- Adjust matcher patterns

## Troubleshooting

**Notifications not appearing:**

1. Check terminal-notifier is installed: `which terminal-notifier`
2. Enable notifications for Terminal/iTerm in System Settings → Notifications
3. Verify plugin is enabled: `/plugin`

**Want to disable:**

```bash
/plugin disable notification@dotai
```

## License

MIT
