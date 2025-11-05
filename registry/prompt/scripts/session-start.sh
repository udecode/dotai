#!/usr/bin/env bash
# SessionStart hook - loads using-skills for all session events (startup, resume, clear, compact)

set -euo pipefail

# Get project directory
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
SKILLS_DIR="$PROJECT_DIR/.claude/skills"
USING_SKILLS_FILE="$SKILLS_DIR/using-skills/SKILL.md"

# Read using-skills content
using_skills_content=""
if [ -f "$USING_SKILLS_FILE" ]; then
    using_skills_content=$(cat "$USING_SKILLS_FILE" 2>&1 || echo "Error reading using-skills skill")
fi

# Escape output for JSON
using_skills_escaped=$(echo "$using_skills_content" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g' | awk '{printf "%s\\n", $0}')

# Output context injection as JSON
if [ -n "$using_skills_content" ]; then
  cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "<EXTREMELY_IMPORTANT>\nYou have many skills.\n\n**Below is the full content of your 'using-skills' skill - your introduction to using skills. For all other skills, use the 'Skill' tool:**\n\n${using_skills_escaped}\n</EXTREMELY_IMPORTANT>"
  }
}
EOF
fi

exit 0