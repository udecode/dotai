# Skills Plugin

> Meta-skills for finding, using, and writing Agent Skills

## Overview

The Skills plugin provides meta-level skills that help Claude properly discover, use, and author Agent Skills. It enforces mandatory skill usage protocols and provides comprehensive skill authoring guidance using TDD principles.

## Features

### 🎯 Using Skills

Mandatory workflows for finding and using skills:

- **Skill discovery** - Check for relevant skills before ANY task
- **Mandatory usage** - If a skill applies (even 1% chance), MUST use it
- **TodoWrite tracking** - Create todos for every checklist item
- **No rationalization** - Prevents common excuses for skipping skills

### ✍️ Writing Skills

TDD approach to skill authoring:

- **RED phase** - Identify failure patterns agents naturally exhibit
- **GREEN phase** - Write skill addressing those patterns
- **REFACTOR phase** - Close loopholes through application
- **Validation** - Test skills on real scenarios before deployment

## Installation

```bash
/plugin install skills@dotai
# restart claude
```

## Commands

### /skills:skills

Invoke the using-skills protocol for mandatory skill discovery and usage.

```bash
/skills:skills
```

Enforces checking for and using relevant skills before any task.

## Skills

### Using Skills

**When to use:** Starting any conversation or task

**Triggers:** Any new request, task, or action

**Mandatory Protocol:**
1. List available skills
2. Check if ANY skill matches request
3. Use Skill tool to load matching skills
4. Announce which skill you're using
5. Follow the skill exactly

**Critical Rules:**
- If skill exists → MUST use it (not optional)
- Skills with checklists → TodoWrite for EACH item
- No rationalizations ("simple task", "overkill") allowed

### Writing Skills

**When to use:** Creating new skills, editing existing skills, or verifying skills work

**Triggers:** Skill authoring, skill improvement, skill validation

**TDD Process for Skills:**
1. **Identify failure patterns** - What do agents naturally do wrong?
2. **Write skill** - Address those specific patterns
3. **Test application** - Run skill on real scenarios
4. **Close loopholes** - Refactor based on failures

**Core Principle:** If you didn't identify what agents do wrong, you don't know if the skill prevents the right failures.

## Common Anti-Patterns to Avoid

❌ **"This is just a simple question"**
✅ Questions are tasks. Check for skills.

❌ **"Let me gather information first"**
✅ Skills tell you HOW to gather information.

❌ **"This doesn't need a formal skill"**
✅ If a skill exists for it, use it.

❌ **"The skill is overkill for this"**
✅ Skills exist because simple things become complex.

❌ **"I'll just do this one thing first"**
✅ Check for skills BEFORE doing anything.

## Skill Structure

```
skill-name/
├── SKILL.md           # Required: skill instructions
├── scripts/           # Optional: executable code
├── references/        # Optional: documentation
└── examples/          # Optional: usage examples
```

### SKILL.md Format

```yaml
---
name: skill-name
description: What this skill does and when to use it
---

# Skill Name

## Overview
Core principle and purpose

## When to Use
Specific triggers and scenarios

## Instructions
Step-by-step guidance
```

## Writing Effective Skills

### 1. Focus on Failure Prevention

Don't write generic instructions. Identify specific failure patterns:

```markdown
# BAD: Generic instruction
"Handle errors appropriately"

# GOOD: Specific failure prevention
"NEVER fix just where error appears. Trace back through call chain:
1. Find immediate cause
2. Ask: What called this?
3. Keep tracing up
4. Fix at source, not symptom"
```

### 2. Make Discovery Easy

Write clear descriptions with trigger words:

```yaml
# BAD: Vague description
description: Helps with debugging

# GOOD: Specific triggers
description: Use when errors occur deep in execution and you need to trace back to find the original trigger - systematically traces bugs backward through call stack
```

### 3. Enforce Discipline

Skills should prevent shortcuts:

```markdown
## The Iron Law
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST

If you haven't completed Phase 1, you cannot propose fixes.
```

### 4. Include Verification

Add checkpoints and verification steps:

```markdown
## Verification After Each Phase
- [ ] Read error messages completely
- [ ] Can reproduce consistently?
- [ ] Checked recent changes?
- [ ] Added instrumentation?
- [ ] Traced data flow to source?
```

## Integration

Works seamlessly with other dotai plugins:

- **plan** - Use skills during brainstorming and planning
- **debug** - Skills guide systematic debugging
- **test** - Apply TDD principles from both domains
- **agents** - Dispatch agents with specific skills

## Best Practices

1. **Always check for skills first** - Before ANY task
2. **Use TodoWrite for checklists** - Track every item
3. **No rationalization** - If skill exists, use it
4. **Test skills before deployment** - Run on real scenarios
5. **Focus on failure patterns** - Prevent known issues
6. **Make skills discoverable** - Clear names and descriptions

## Real-World Impact

- **Consistency** - Same approach every time
- **Quality** - Proven techniques applied reliably
- **Speed** - No reinventing solutions
- **Learning** - Skills capture organizational knowledge
- **Onboarding** - New team members productive faster

## Examples

### Checking for Skills (using-skills)

```
Starting task: "Fix the authentication bug"

1. ☐ List available skills
   - systematic-debugging ✓
   - root-cause-tracing ✓
   - test-driven-development ✗

2. Use Skill tool to load:
   - systematic-debugging
   - root-cause-tracing

3. Announce: "Using systematic-debugging and root-cause-tracing skills"

4. Follow skills exactly
```

### Writing a New Skill

```
Task: Create skill for API error handling

1. RED - Identify failures:
   - Agents fix symptoms not causes
   - Skip error investigation
   - Don't check response codes

2. GREEN - Write skill addressing patterns:
   - Enforce error investigation first
   - Require tracing to source
   - Mandate response code checking

3. REFACTOR - Test and improve:
   - Run on real API errors
   - Close loopholes found
   - Add verification steps
```