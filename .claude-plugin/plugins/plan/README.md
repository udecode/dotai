# Plan Plugin

> Planning and brainstorming workflows for software development

## Overview

The Plan plugin provides specialized Agent Skills for transforming ideas into well-designed software implementations through structured planning workflows.

## Features

### 🧠 Brainstorming

Transform rough ideas into fully-formed designs through collaborative questioning, alternative exploration, and incremental validation.

- **Collaborative refinement** - Ask multiple related questions together
- **Alternative exploration** - Propose 2-3 approaches with trade-offs
- **Incremental validation** - Present design in sections with checkpoints
- **Documentation** - Save validated designs to `.claude/docs/plans/`

### 📝 Writing Plans

Create comprehensive implementation plans assuming the engineer has zero context for the codebase.

- **Bite-sized tasks** - Each step is one action (2-5 minutes)
- **Complete code examples** - Full code in plan, not "add validation"
- **TDD approach** - Auto-decide on unit tests based on complexity
- **Exact paths** - Always include exact file paths and line numbers

### ⚡ Executing Plans

Load plan, review critically, execute tasks in batches, report for review between batches.

- **Batch execution** - Default 3 tasks per batch with checkpoints
- **Critical review** - Identify concerns before starting
- **Verification** - Run tests/typecheck/lint as specified
- **Feedback loops** - Apply changes between batches

## Installation

```bash
/plugin install plan@dotai
# restart claude
```

## Commands

The plugin provides three slash commands for quick access to planning workflows:

### /plan:brainstorm

Interactive design refinement using Socratic method with AskUserQuestion tool. Uses Opus model for enhanced creativity.

```bash
/plan:brainstorm
```

### /plan:execute-plan

Execute plan in batches with review checkpoints.

```bash
/plan:execute-plan
```

### /plan:write-plan

Create detailed implementation plan with bite-sized tasks. Uses Opus model for comprehensive planning.

```bash
/plan:write-plan
```

## Skills

The plugin provides three specialized Agent Skills that Claude will automatically use based on task context:

### Brainstorming

**When to use:** Before writing code or implementation plans, when refining rough ideas into fully-formed designs

**Triggers:** "brainstorm", "design", "refine idea", "explore approaches"

### Writing Plans

**When to use:** When design is complete and you need detailed implementation tasks

**Triggers:** "write plan", "implementation plan", "task breakdown", "TDD approach"

### Executing Plans

**When to use:** When you have a complete implementation plan to execute

**Triggers:** "execute plan", "implement tasks", "follow plan", "batch execution"

## Workflow Examples

### Idea to Implementation

```
1. User: "I want to build a notification system"
2. Claude: Uses brainstorming skill to refine the idea
3. Design validated and saved to `.claude/docs/plans/`
4. Claude: Uses writing-plans skill to create implementation tasks
5. Claude: Uses executing-plans skill to implement in batches
```

### Plan Execution

```
1. User: "Execute the plan in `.claude/docs/plans/2024-01-15-auth-system.md`"
2. Claude: Uses executing-plans skill
3. Executes first 3 tasks
4. Reports for review
5. Continues with next batch based on feedback
```

## Configuration

Skills are automatically discovered and used by Claude based on task context. No configuration required.

## Best Practices

1. **Start with brainstorming** for new features to ensure clear design
2. **Review plans critically** before execution - identify gaps early
3. **Use batch execution** for complex implementations with checkpoints
4. **Document designs** in `.claude/docs/plans/` for future reference
5. **Prefer TDD** for complex logic, skip tests for simple CRUD

## Integration

Works seamlessly with other dotai plugins:

- **dotai** - Use with `/dotai:create-prd` for requirements → design → implementation flow
- **fb** - Session continuity across planning and implementation phases
