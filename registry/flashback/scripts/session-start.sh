#!/bin/bash

# Flashback Session Start Hook
# This script is called by Claude Code when a new session starts
# It restores the previous session state if available

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Use nvm default node version
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm use default &> /dev/null

# Find the flashback binary
FLASHBACK_BIN=""

# Try different locations
if command -v flashback &> /dev/null; then
    FLASHBACK_BIN="flashback"
elif [ -f "$HOME/.claude/flashbacker/lib/cli.js" ]; then
    # Try to use node directly without nvm
    if command -v node &> /dev/null; then
        FLASHBACK_BIN="node $HOME/.claude/flashbacker/lib/cli.js"
    else
        echo "Error: Node.js not found in PATH" >&2
        exit 1
    fi
else
    echo "Error: Could not find flashback binary" >&2
    exit 1
fi

# Get project directory (usually the current working directory)
PROJECT_DIR="${PWD}"

# Validate PROJECT_DIR doesn't contain dangerous characters
if [[ "$PROJECT_DIR" =~ [\;\|\&\$\`] ]]; then
    echo "Error: PROJECT_DIR contains unsafe characters" >&2
    exit 1
fi

# Call the flashback session-start command to gather context
exec "$FLASHBACK_BIN" session-start --context