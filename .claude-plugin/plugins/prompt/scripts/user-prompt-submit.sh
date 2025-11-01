#!/usr/bin/env bash
# UserPromptSubmit hook - Combined skills enforcement and verification checklist

set -euo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
PROMPT_FILE="$PROJECT_DIR/.claude/prompt.json"

# Build debug log
DEBUG_LOG="[prompt-plugin] CLAUDE_PROJECT_DIR=${CLAUDE_PROJECT_DIR:-(not set)}
[prompt-plugin] CLAUDE_PLUGIN_ROOT=${CLAUDE_PLUGIN_ROOT:-(not set)}
[prompt-plugin] Prompt file: $PROMPT_FILE
"

# Read and format prompt from JSON file (only if file exists)
if [ -f "$PROMPT_FILE" ]; then
  DEBUG_LOG+="[prompt-plugin] Found prompt.json, parsing...

"

  # Use Node.js to parse JSON and format output
  FORMATTED_OUTPUT=$(node -e "
    try {
      const data = require('$PROMPT_FILE');
      let output = '';

      // Format beforeStart sections
      if (data.beforeStart && Array.isArray(data.beforeStart) && data.beforeStart.length > 0) {
        data.beforeStart.forEach(section => {
          output += \`<\${section.tag}>\n\`;
          output += \`BEFORE responding to ANY user message:\n\n\`;

          if (section.items && Array.isArray(section.items)) {
            section.items.forEach(item => {
              output += \`☐ \${item}\n\`;
            });
          }

          output += \`\n</\${section.tag}>\n\n\`;
        });
      }

      // Format beforeComplete sections
      if (data.beforeComplete && Array.isArray(data.beforeComplete) && data.beforeComplete.length > 0) {
        data.beforeComplete.forEach(section => {
          output += \`<\${section.tag}>\n\`;
          output += \`Before claiming work is complete, fixed, or passing:\n\n\`;

          if (section.items && Array.isArray(section.items)) {
            section.items.forEach(item => {
              output += \`- [ ] \${item}\n\`;
            });
          }

          output += \`\nNO completion claims without FRESH verification evidence.\`;
          output += \`</\${section.tag}>\`;
        });
      }

      console.log(output);
    } catch (error) {
      console.error('Parse error:', error.message);
    }
  " 2>&1)

  if [ -n "$FORMATTED_OUTPUT" ]; then
    DEBUG_LOG+="[prompt-plugin] Successfully injected prompts

"
    CONTEXT="$DEBUG_LOG$FORMATTED_OUTPUT"
  else
    DEBUG_LOG+="[prompt-plugin] ERROR: Empty output from parser"
    CONTEXT="$DEBUG_LOG"
  fi
else
  DEBUG_LOG+="[prompt-plugin] Prompt file not found, skipping injection"
  CONTEXT="$DEBUG_LOG"
fi

# Escape content for JSON (like superpowers plugin does)
CONTEXT_ESCAPED=$(echo "$CONTEXT" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g' | awk '{printf "%s\\n", $0}')

# Always output JSON with properly escaped context
cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "${CONTEXT_ESCAPED}"
  }
}
EOF

exit 0
