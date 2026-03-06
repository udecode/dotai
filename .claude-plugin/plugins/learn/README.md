# Learn Plugin

> Continuous learning system - extracts reusable knowledge from work sessions into Claude Code skills

## Overview

The Learn plugin provides a continuous learning system that extracts reusable knowledge from work sessions and codifies it into new Claude Code skills. This enables autonomous improvement over time.

## Features

### Skill Extraction

Extract valuable knowledge into reusable skills:

- **Non-obvious Solutions** - Debugging techniques, workarounds requiring investigation
- **Project-Specific Patterns** - Conventions and architectural decisions
- **Tool Integration** - API usage not covered well in documentation
- **Error Resolution** - Error messages → root causes → fixes

### TDD-Based Extraction

Follows Test-Driven Development discipline:

- **RED** - Problem already encountered during work
- **GREEN** - Write skill addressing that specific problem
- **REFACTOR** - Verify skill clarity, iterate if needed

### Claude Search Optimization (CSO)

Skills are optimized for discovery:

- Specific trigger conditions in descriptions
- Keyword coverage for searchability
- Token-efficient content

## Installation

```bash
/plugin install learn@dotai
# restart claude
```

## Skills

### learn

Auto-invoked skill that reviews session learnings and extracts reusable skills.

**Triggers:**

- `/learn` command to review session
- "save this as a skill" or "extract a skill"
- "what did we learn?"
- After non-obvious debugging or workarounds

## Skill Quality Criteria

Before extracting, verify:

- **Reusable** - Helps with future tasks
- **Non-trivial** - Requires discovery, not just docs
- **Specific** - Exact trigger conditions and solution
- **Verified** - Solution actually worked

## Skill Types

- **Technique** - Concrete method with steps (debugging patterns)
- **Pattern** - Mental model for problem-solving
- **Reference** - API docs, syntax guides
- **Error Resolution** - Error → cause → fix mapping

## Extraction Process

1. **Identify** - What was non-obvious about the solution?
2. **Research** - Search web for best practices when appropriate
3. **Structure** - Save to `.claude/skills/[skill-name].mdc` (if `.claude/skiller.toml` exists) or `.claude/skills/[skill-name]/SKILL.md` otherwise
4. **Optimize** - Write effective descriptions for discovery
5. **Deploy** - Run `npx skiller@latest apply`

## Skill Template

```markdown
---
name: skill-name-with-hyphens
description: |
  Use when [specific triggering conditions]. Triggers: (1) exact symptom,
  (2) error message, (3) scenario. [What problem this solves.]
---

# [Skill Name]

## Problem

[Clear description of the problem]

## Context / Trigger Conditions

[When should this skill be used?]

## Solution

[Step-by-step solution]

## Verification

[How to verify it worked]

## Notes

[Caveats, edge cases]

## References

[Links to documentation]
```

## Auto-Trigger Conditions

Invoke after completing a task when:

1. Solution required >10 min investigation
2. Error message was misleading
3. Found workaround through experimentation
4. Discovered project-specific setup
5. Tried multiple approaches before success

## Integration

Works seamlessly with other dotai plugins:

- **debug** - Extract debugging discoveries
- **test** - Document testing patterns
- **git** - Capture workflow insights

## Best Practices

1. **Be selective** - Not every task produces a skill
2. **Verify first** - Only extract what actually worked
3. **Optimize descriptions** - Include trigger conditions
4. **Research when appropriate** - Add web sources as references
5. **Keep skills focused** - One problem per skill

## Credits

Inspired by [Claudeception](https://github.com/blader/Claudeception).
