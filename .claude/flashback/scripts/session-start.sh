#!/bin/bash

# Flashback Session Start Hook
# This script is called by Claude Code when a new session starts
# It restores the previous session state if available

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Find the flashback binary
FLASHBACK_BIN=""

# Try different locations
if command -v flashback &> /dev/null; then
    FLASHBACK_BIN="flashback"
elif [ -f "${SCRIPT_DIR}/../../bin/flashback" ]; then
    FLASHBACK_BIN="${SCRIPT_DIR}/../../bin/flashback"
elif [ -f "${SCRIPT_DIR}/../../lib/cli.js" ]; then
    FLASHBACK_BIN="node ${SCRIPT_DIR}/../../lib/cli.js"
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