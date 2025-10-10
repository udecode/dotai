# Session Start

Manual session recovery after compaction or when starting fresh. Uses the hybrid AI+Computer approach for reliable context gathering.

## Task

1. **Gather Context**: Run `flashback working-plan --context` to get:
   - Current working plan from WORKING_PLAN.md
   - **Previous session** conversation history (not empty current session)
   - Current session information

2. **Load Context**: Use `flashback session-start --context` to get recent conversation transcript
3. Understand what you work working on from the conversation transcript, and WORKING_PLAN.md:
   - What you were working on (from WORKING_PLAN.md)
   - What happened in the last session (from conversation log)

4. **Welcome User**: After loading context, provide a brief summary of what you understand about the project and ask "What would you like to work on now?"

## Context Gathering Command

The CLI command handles all file reading and context formatting consistently:

```bash
flashback working-plan --context && flashback session-start --context
```

This outputs structured context including:

- Project memory and key learnings
- Current development plan and priorities
- Previous conversation history for continuity
- Session restoration instructions

## Usage Notes

This command is used manually when:

- Starting work after auto-compact (no PostCompact hook exists)
- Beginning a fresh session and need project context
- Hook didn't trigger properly and need manual context restoration

**CRITICAL**: Gets **previous meaningful conversation**, not empty current session context.

Usage: `/fb:session-start`
