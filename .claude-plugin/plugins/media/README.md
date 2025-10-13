# Media Plugin

Automatically control media playback based on Claude Code interaction:
- **Submit**: Plays media when you submit a prompt
- **Stop**: Pauses media when you stop Claude's response

## Requirements

- macOS
- [media-control](https://github.com/autopilot/media-control) CLI tool

Install media-control:
```bash
brew install media-control
```

## Installation

```bash
# Install the plugin
/plugin install media@dotai

# Or add to .claude/settings.json
{
  "enabledPlugins": {
    "media@dotai": true
  }
}
```

## Configuration

### Environment Variables

**`CLAUDE_MEDIA_DISABLED`** (default: `"false"`)
- `"false"`: Plugin is active
- `"true"`: Completely disable the plugin (no play/pause on any events)

**`CLAUDE_MEDIA_AUTO_START`** (default: `"true"`)
- `"true"`: Auto-play media when submitting a prompt
- `"false"`: Don't play media on prompt submit

**`CLAUDE_MEDIA_AUTO_PAUSE`** (default: `"true"`)
- `"true"`: Auto-pause media when stopping Claude's response
- `"false"`: Don't pause media on stop

Add to `.claude/settings.json` or `.claude/settings.local.json` (overrides):
```json
{
  "env": {
    "CLAUDE_MEDIA_DISABLED": "false",
    "CLAUDE_MEDIA_AUTO_START": "true",
    "CLAUDE_MEDIA_AUTO_PAUSE": "false"
  }
}
```

**Note**: Changes take effect immediately without restarting Claude Code. Settings in `settings.local.json` override those in `settings.json`.

## How It Works

1. **UserPromptSubmit Hook**: Sends `media-control play` command
2. **Stop Hook**: Sends `media-control pause` command (if AUTO_PAUSE is enabled)

The plugin works with any media player supported by macOS media controls (Spotify, Apple Music, YouTube in browsers, etc.).

## Examples

**Default behavior** (all features enabled):
- Submit prompt → Music plays
- Stop response → Music pauses

**Only pause, no auto-start**:
```json
{
  "env": {
    "CLAUDE_MEDIA_AUTO_START": "false",
    "CLAUDE_MEDIA_AUTO_PAUSE": "true"
  }
}
```
- Submit prompt → Music keeps playing
- Stop response → Music pauses

**Only auto-start, no pause**:
```json
{
  "env": {
    "CLAUDE_MEDIA_AUTO_START": "true",
    "CLAUDE_MEDIA_AUTO_PAUSE": "false"
  }
}
```
- Submit prompt → Music plays
- Stop response → Music keeps playing

**Completely disable**:
```json
{
  "env": {
    "CLAUDE_MEDIA_DISABLED": "true"
  }
}
```
- No media control at all

## Troubleshooting

**Media not controlling:**
- Ensure `media-control` is installed: `which media-control`
- Test manually: `media-control play` / `media-control pause`
- Check if media player is running

**Plugin not loading:**
- Restart Claude Code after installation
- Verify plugin is enabled in settings
- Check `.claude/settings.json` syntax
