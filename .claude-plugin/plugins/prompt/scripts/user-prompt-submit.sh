#!/usr/bin/env bash
# UserPromptSubmit hook - Inject custom prompts from .claude/prompt.json

set -euo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
PROMPT_FILE="$PROJECT_DIR/.claude/prompt.json"

# Use Node.js to handle both JSON parsing and output
# This ensures proper JSON escaping via JSON.stringify()
node -e "
const fs = require('fs');
const promptFile = '$PROMPT_FILE';

// Build debug log
let debugLog = \`[prompt-plugin] CLAUDE_PROJECT_DIR=\${process.env.CLAUDE_PROJECT_DIR || '(not set)'}
[prompt-plugin] CLAUDE_PLUGIN_ROOT=\${process.env.CLAUDE_PLUGIN_ROOT || '(not set)'}
[prompt-plugin] Prompt file: \${promptFile}
\`;

let context = '';

// Read and format prompt from JSON file (only if file exists)
if (fs.existsSync(promptFile)) {
  debugLog += '[prompt-plugin] Found prompt.json, parsing...\n\n';

  try {
    const data = JSON.parse(fs.readFileSync(promptFile, 'utf8'));
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

    if (output) {
      debugLog += '[prompt-plugin] Successfully formatted prompts\n\n';
      context = debugLog + output;
    } else {
      debugLog += '[prompt-plugin] No prompts configured in file';
      context = debugLog;
    }
  } catch (error) {
    debugLog += \`[prompt-plugin] ERROR parsing JSON: \${error.message}\`;
    context = debugLog;
  }
} else {
  debugLog += '[prompt-plugin] Prompt file not found, skipping injection';
  context = debugLog;
}

// Use JSON.stringify() for automatic and correct escaping
const output = {
  hookSpecificOutput: {
    hookEventName: 'UserPromptSubmit',
    additionalContext: context
  }
};

console.log(JSON.stringify(output, null, 2));
" 2>&1

exit 0
