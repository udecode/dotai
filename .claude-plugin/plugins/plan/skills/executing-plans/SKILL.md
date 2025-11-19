---
name: executing-plans
description: Use when partner provides a complete implementation plan to execute in controlled batches with review checkpoints - loads plan, reviews critically, executes tasks in batches, reports for review between batches
---

# Executing Plans

## Overview

Load plan, review critically, execute tasks in batches, report for review between batches.

**Core principle:** Batch execution with checkpoints for architect review.

**Announce at start:** "I'm using the executing-plans skill to implement this plan."

## The Process

### Step 1: Load and Review Plan

1. Read plan file
2. Review critically - identify any questions or concerns about the plan
3. If concerns: Raise them with your human partner before starting
4. If no concerns: Create TodoWrite and proceed

### Step 2: Execute Batch

**Default: First 3 tasks**

For each task:

1. Mark as in_progress
2. Follow each step exactly (plan has bite-sized steps)
3. Run verifications as specified (tests if included, typecheck/lint if not)
4. Mark as completed

**Note on tests**: Only some tasks will have tests (complex logic only). Follow the plan's testing approach - don't add tests where the plan doesn't specify them.

### Step 3: Report and Commit Check

When batch complete:

- Show what was implemented
- Show verification output
- **Check if commit should be suggested:**
  - If you verified tests/typecheck/lint passed AND plan includes commit steps → Ask: "Batch complete. Create commit for these changes?"
  - If tests are user's responsibility OR you couldn't verify → Skip commit suggestion, just report
- Say: "Ready for feedback."

### Step 4: Continue

Based on feedback:

- Apply changes if needed
- Execute next batch
- Repeat until complete

### Step 5: Complete Development

After all tasks complete and verified:

- Run final verification: `npm run typecheck && npm run lint`
- Report completion summary showing all implemented tasks
- **Final commit check using AskUserQuestion tool:**
  - If no commits created during batches → Ask: "All tasks complete. Create a git commit?"
  - If already committed during batches → Ask: "All tasks complete. Run additional verification or move on?"

## When to Stop and Ask for Help

**STOP executing immediately when:**

- Hit a blocker mid-batch (missing dependency, test fails, instruction unclear)
- Plan has critical gaps preventing starting
- You don't understand an instruction
- Verification fails repeatedly

**Ask for clarification rather than guessing.**

## When to Revisit Earlier Steps

**Return to Review (Step 1) when:**

- Partner updates the plan based on your feedback
- Fundamental approach needs rethinking

**Don't force through blockers** - stop and ask.

## Remember

- Review plan critically first
- Follow plan steps exactly
- Don't skip verifications
- Reference skills when plan says to
- Between batches: report, check commit opportunity, wait for feedback
- **Never auto-commit** - Always ask user first, even if plan includes commit commands
- Leverage batch pauses for commit suggestions (don't create extra pauses)
- Stop when blocked, don't guess
