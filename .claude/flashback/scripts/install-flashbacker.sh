#!/bin/bash

# Flashbacker Installation Script
# Installs or updates Flashbacker globally and sets up the alias

set -e  # Exit on error

# Save current directory to return to it later
ORIGINAL_DIR="${PWD}"

echo "🚀 Installing Flashbacker..."

# Clone or update Flashbacker
if [ -d ~/.claude/flashbacker ]; then
    echo "📦 Updating existing Flashbacker installation..."
    cd ~/.claude/flashbacker
    git pull --quiet
else
    echo "📦 Cloning Flashbacker repository..."
    git clone https://github.com/agentsea/flashbacker.git ~/.claude/flashbacker
    cd ~/.claude/flashbacker
fi

# Install dependencies and build
echo "📦 Installing dependencies..."
npm install --silent

echo "🔨 Building Flashbacker..."
npm run build --silent

echo "🔗 Creating npm link..."
npm link --silent

# Add alias to shell config if not already present
SHELL_CONFIG=""
if [ -f ~/.zshrc ]; then
    SHELL_CONFIG=~/.zshrc
elif [ -f ~/.bashrc ]; then
    SHELL_CONFIG=~/.bashrc
else
    echo "⚠️  Could not find .zshrc or .bashrc - please add alias manually:"
    echo "    alias flashback=\"node ~/.claude/flashbacker/lib/cli.js\""
    cd "${ORIGINAL_DIR}"
    exit 1
fi

if ! grep -q 'alias flashback=' "$SHELL_CONFIG"; then
    echo "✏️  Adding flashback alias to $SHELL_CONFIG..."
    echo 'alias flashback="node ~/.claude/flashbacker/lib/cli.js"' >> "$SHELL_CONFIG"
    echo "📝 Alias added. Run 'source $SHELL_CONFIG' to activate it."
else
    echo "✅ Alias already exists in $SHELL_CONFIG"
fi

# Return to original directory
cd "${ORIGINAL_DIR}"

# Verify installation
if [ -f ~/.claude/flashbacker/lib/cli.js ]; then
    VERSION=$(node ~/.claude/flashbacker/lib/cli.js --version 2>/dev/null || echo "unknown")
    echo "✅ Flashbacker v${VERSION} installed successfully!"
    echo ""
    echo "🎯 Next steps:"
    echo "   1. Run: source $SHELL_CONFIG"
    echo "   2. Verify: flashback --version"
else
    echo "❌ Installation failed - cli.js not found"
    exit 1
fi