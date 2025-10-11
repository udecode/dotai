You are helping add important information to the project's long-term memory system.

## Context
The user wants to add this information to `.claude/flashback/memory/REMEMBER.md`: "$ARGUMENTS"

## Current REMEMBER.md Content
```
{{CURRENT_MEMORY}}
```

## Task
Analyze the user's input and add it to the appropriate section in `.claude/flashback/memory/REMEMBER.md`. The information should be:

1. **Categorized correctly** - Place it in the most relevant section:
   - 📋 Project Overview - For high-level project description
   - 🏗️ Architecture & Patterns - For design decisions and architectural info
   - 🔧 Development Setup - For setup, dependencies, configuration
   - 📝 Conventions & Standards - For code style and project standards
   - 🚨 Important Constraints - For limitations, requirements, things to avoid
   - 🔗 Key Dependencies - For important libraries, frameworks, services
   - 📁 Directory Structure - For file locations and organizational patterns
   - 🧠 Lessons Learned - For insights, gotchas, knowledge gained
   - 🎯 Current Goals - For high-level objectives and current work

2. **Well-formatted** - Use consistent formatting with existing content
3. **Concise but complete** - Capture the essential information clearly
4. **Actionable** - Make it useful for future sessions

If the input doesn't clearly fit existing sections, add it to "🧠 Lessons Learned" as the default.

Please output the complete updated `.claude/flashback/memory/REMEMBER.md` file with the new information properly integrated.