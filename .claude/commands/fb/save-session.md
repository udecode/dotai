# Save Session

**Create a beautifully formatted session summary document** in this conversation capturing meaningful insights.

## Task Workflow

1. **Check for Existing Session**: First check if there's an existing session file to archive
2. **Archive Previous Session**: If found, save it to archive before creating new summary
3. **Gather Context**: Run `flashback save-session --context` to get comprehensive session data
4. **Analyze Session**: Extract real accomplishments, file changes, and decisions made
5. **Update Working Plan**: Follow the working plan update process from @.claude/commands/fb/working-plan.md
6. **Create New Summary**: Output polished session documentation **directly in this conversation**
7. **Save Session Record**: Write the formatted summary to `.claude/flashback/memory/CURRENT_SESSION.md`

## Session File Management

**Before creating the new session summary:**

1. **Check for existing session**: Use Read tool to check if `.claude/flashback/memory/CURRENT_SESSION.md` exists
2. **Archive if found**: If file exists, copy it to `.claude/flashback/memory/ARCHIVE/sessions/session-[timestamp].md`
3. **Clean old archives**: Keep only the 10 most recent archived sessions (delete older ones)

**After creating the session summary:**

- Save the formatted document to `.claude/flashback/memory/CURRENT_SESSION.md` for future archiving

## Working Plan Update Process

**During session analysis, also update the working plan:**

1. **Read Current Plan**: Load @.claude/flashback/memory/WORKING_PLAN.md to understand current state
2. **Analyze Accomplishments**: Extract what was actually completed, decisions made, next steps identified
3. **Update Plan**: Apply changes to reflect real session progress:
   - Move completed tasks from "Next Priorities" to "Completed Recently"
   - Update "Current Phase" if phase changed
   - Refresh "Immediate Tasks" based on conversation
   - Add new tasks discovered during session
   - Update session reference and timestamp
4. **Write Updated Plan**: Output the complete updated WORKING_PLAN.md file content

**CRITICAL**: Always output the complete, updated WORKING_PLAN.md file content. Use concrete, specific language based on actual conversation content, not generalizations.

## Manual Commands (Alternative)

If the built-in archiving above fails, you can use:

- `flashback save-session --archive` - Manually archive session files
- `flashback save-session --prune 5` - Manually prune old archived sessions

**Note**: The primary workflow handles archiving automatically in the prompt above.

## Context Gathering

```bash
flashback save-session --context
```

Provides comprehensive session data:

- **Enhanced Analysis Prompt**: Detailed instructions for creating beautiful documentation
- **Project Context**: Memory and working plan for background
- **Conversation Logs**: Complete session transcript with tool calls
- **Git Analysis**: Actual file changes and repository state
- **Tool Usage Tracking**: All Edit, Write, Bash, and other tool calls made

## Required Output Structure

**You MUST create a complete session document** using this exact format:

```markdown
# 📋 Session Summary - [Month Day, Year]

## 🎯 Session Overview

[2-3 sentences describing main focus and outcomes]

## 📁 Files Modified

### Code Changes

- **`src/file.ts`** - [Detailed description with technical context]

### Documentation Updates

- **`README.md`** - [Specific documentation changes]

## ⚒️ Tool Calls & Operations

### File Operations

- **Edit**: `file.ts:45-67` - [What was edited and why]
- **Write**: `newfile.md` - [What was created]

### System Commands

- **Bash**: `npm run build` - [Command purpose and result]

## ✅ Key Accomplishments

- **[Specific Feature]**: [Implementation details and impact]

## 🔧 Problems Solved

- **Issue**: [Problem description]
  - **Solution**: [Technical solution with details]
  - **Verification**: [How solution was validated]

## 💡 Technical Decisions

- **Decision**: [What was decided with rationale]

## 🔄 Next Steps

- **Immediate**: [Next session priorities]

## 🧠 Learning & Insights

- **Technical Patterns**: [Architectural insights discovered]

## 📊 Session Metrics

- **Tool Calls**: [Number of tool calls made]
- **Files Changed**: [Number of files modified]

## 🌳 Git Repository State

- **Status**: [Current repository state]
```

## Quality Standards

- **Professional Formatting**: Use emojis, proper structure, and clean markdown
- **Specific Details**: Include exact file paths, line numbers, technical specifics
- **Complete Documentation**: Cover all aspects of the session comprehensively
- **Actionable Content**: Focus on concrete changes and decisions made

## CRITICAL REMINDERS

- **Dual Output**: Create session document **both in conversation AND save to file**
- **Working Plan Update**: Always update the working plan based on session accomplishments
- **Complete Workflow**: Follow the full archive → analyze → update plan → save process
- **Automatic Archiving**: Handle existing session files before creating new ones
- **Professional Quality**: Make it beautiful, comprehensive, and actionable
- **File Persistence**: Save both `CURRENT_SESSION.md` and `WORKING_PLAN.md` for future session continuity

Usage: `/fb:save-session`
