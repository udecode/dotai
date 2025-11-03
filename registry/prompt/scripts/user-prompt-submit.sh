#!/usr/bin/env bash
# UserPromptSubmit hook - Combined skills enforcement and verification checklist

set -euo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
PROMPT_FILE="$PROJECT_DIR/.claude/prompt.json"

# Read and format prompt from JSON file (only if file exists)
if [ -f "$PROMPT_FILE" ]; then
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

          // Format rules as instructions
          if (section.rules && Array.isArray(section.rules)) {
            output += \`**Protocol:**\n\`;
            section.rules.forEach(rule => {
              output += \`• \${rule}\n\`;
            });
            output += \`\n\`;
          }

          // Format todos as checklist
          if (section.todos && Array.isArray(section.todos)) {
            output += \`**TodoWrite Checklist:**\n\`;
            section.todos.forEach(todo => {
              output += \`☐ \${todo}\n\`;
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

          // Format rules as instructions
          if (section.rules && Array.isArray(section.rules)) {
            output += \`**Protocol:**\n\`;
            section.rules.forEach(rule => {
              output += \`• \${rule}\n\`;
            });
            output += \`\n\`;
          }

          // Format todos as checklist
          if (section.todos && Array.isArray(section.todos)) {
            output += \`**TodoWrite Verification:**\n\`;
            section.todos.forEach(todo => {
              output += \`- [ ] \${todo}\n\`;
            });
          }

          output += \`\nNO completion claims without FRESH verification evidence.\`;
          output += \`</\${section.tag}>\`;
        });
      }

      console.log(output);
    } catch (error) {
      // Silently fail on parse errors
    }
  " 2>&1)
else
  FORMATTED_OUTPUT=""
fi

# Only output JSON if FORMATTED_OUTPUT is non-empty
if [ -n "$FORMATTED_OUTPUT" ]; then
  cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "$FORMATTED_OUTPUT"
  }
}
EOF
fi

exit 0
