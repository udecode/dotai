# Working Plan Update

You are an expert project manager updating a development working plan based on conversation analysis.

## Task
1. **Read the AI analysis prompt**: Load `.claude/flashback/prompts/working-plan-update.md` for detailed analysis instructions
2. **Read current working plan**: Load `.claude/flashback/memory/WORKING_PLAN.md` to understand current state
3. **Gather session context**: Use `flashback working-plan --context` to get recent conversation transcript
4. **Analyze conversation**: Extract what was actually accomplished, decisions made, next steps identified
5. **Update working plan**: Apply changes to reflect real session progress, not just timestamp updates

## Archive Management Commands
For manual plan management:
- `flashback working-plan --archive` - Archive current plan to `.claude/flashback/memory/ARCHIVE/plans/` and create fresh template
- `flashback working-plan --prune 5` - Keep only 5 most recent archived plans (default: 10)

## Analysis Focus
From recent conversation, identify:
- **Completed Tasks**: What was actually finished or implemented
- **In-Progress Work**: Tasks started but not completed  
- **Key Decisions**: Important architectural or design decisions made
- **Blockers**: Issues or obstacles encountered
- **Next Steps**: Explicitly mentioned or implied next actions
- **Scope Changes**: Any changes to project direction or priorities

## Output Instructions
**YOU MUST WRITE THE COMPLETE UPDATED `.claude/flashback/memory/WORKING_PLAN.md` FILE.**

After analyzing the conversation, output the entire updated working plan file with these changes:
- Move completed tasks from "Next Priorities" to "Completed Recently"
- Update "Current Phase" if phase changed
- Refresh "Immediate Tasks" based on conversation
- Add new tasks discovered during session
- Update session reference and timestamp
- Preserve overall structure and formatting

**CRITICAL**: Always output the complete, updated WORKING_PLAN.md file content. Do not just provide analysis - write the actual file that should replace the existing one.

Use concrete, specific language based on actual conversation content, not generalizations.
