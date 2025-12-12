# Agents Plugin

> Agent orchestration patterns for parallel debugging and investigation

## Overview

The Agents plugin provides specialized skills for dispatching and coordinating multiple Claude agents to solve independent problems concurrently, dramatically reducing debugging and investigation time.

## Features

### 🚀 Parallel Agent Dispatch

Dispatch multiple Claude agents to investigate and fix independent problems simultaneously.

- **Parallel execution** - Multiple investigations happen concurrently
- **Focused scope** - Each agent has narrow domain, less context to track
- **Independence** - Agents don't interfere with each other
- **Speed** - Multiple problems solved in time of one

## Installation

```bash
/plugin install agent@dotai
# restart claude
```

## Commands

### /agents:parallel

Dispatch multiple agents to solve independent problems concurrently.

```bash
/agents:parallel
```

Invokes the dispatching-parallel-agents skill for orchestrating parallel investigations.

## Skills

### Dispatching Parallel Agents

**When to use:** Facing 3+ independent failures that can be investigated without shared state or dependencies

**Triggers:** Multiple test failures, independent subsystem errors, parallel debugging needed

**Core Pattern:**
1. Identify independent problem domains
2. Create focused agent tasks
3. Dispatch in parallel using Task tool
4. Review and integrate results

## Usage Examples

### Multiple Test Failures

When you have test failures across different files with independent root causes:

```typescript
// Dispatch agents to fix each test file independently
Task("Fix agent-tool-abort.test.ts failures");
Task("Fix batch-completion-behavior.test.ts failures");
Task("Fix tool-approval-race-conditions.test.ts failures");
// All three run concurrently
```

### Subsystem Debugging

When multiple subsystems fail independently:

```
Agent 1 → Debug authentication system
Agent 2 → Fix database connection issues
Agent 3 → Resolve API rate limiting
```

## When to Use

✅ **Use when:**
- 3+ test files failing with different root causes
- Multiple subsystems broken independently
- Each problem can be understood without context from others
- No shared state between investigations

❌ **Don't use when:**
- Failures are related (fix one might fix others)
- Need to understand full system state
- Agents would interfere with each other
- Shared resources or files being edited

## Agent Prompt Best Practices

Good agent prompts are:

1. **Focused** - One clear problem domain
2. **Self-contained** - All context needed to understand the problem
3. **Specific about output** - What should the agent return?
4. **Constrained** - Clear boundaries on what to change

### Example Agent Prompt

```markdown
Fix the 3 failing tests in src/agents/agent-tool-abort.test.ts:

1. "should abort tool with partial output capture" - expects 'interrupted at' in message
2. "should handle mixed completed and aborted tools" - fast tool aborted instead of completed
3. "should properly track pendingToolCount" - expects 3 results but gets 0

These are timing/race condition issues. Your task:

1. Read the test file and understand what each test verifies
2. Identify root cause - timing issues or actual bugs?
3. Fix by:
   - Replacing arbitrary timeouts with event-based waiting
   - Fixing bugs in abort implementation if found
   - Adjusting test expectations if testing changed behavior

Do NOT just increase timeouts - find the real issue.

Return: Summary of what you found and what you fixed.
```

## Verification After Dispatch

After agents return:

1. **Review each summary** - Understand what changed
2. **Check for conflicts** - Did agents edit same code?
3. **Run full suite** - Verify all fixes work together
4. **Spot check** - Agents can make systematic errors

## Real-World Impact

From actual debugging sessions:
- 6 failures across 3 files
- 3 agents dispatched in parallel
- All investigations completed concurrently
- All fixes integrated successfully
- Zero conflicts between agent changes
- **Time saved: ~66%** (3 problems in time of 1)

## Integration

Works seamlessly with other dotai plugins:

- **plan** - Use with executing-plans for structured implementation
- **dotai** - Combine with debugging workflows for comprehensive fixes
- **fb** - Session continuity across parallel agent investigations

## Best Practices

1. **Group by independence** - Only dispatch agents for truly independent problems
2. **Clear constraints** - Tell agents what NOT to change
3. **Specific output** - Request summaries of findings and changes
4. **Verify integration** - Always check that parallel fixes work together
5. **Use for 3+ problems** - Overhead not worth it for just 2 issues