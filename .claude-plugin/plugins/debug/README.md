# Debug Plugin

> Systematic debugging and root cause analysis framework

## Overview

The Debug plugin provides battle-tested debugging methodologies that prevent random fixes and ensure understanding before attempting solutions. It enforces a disciplined four-phase approach to finding and fixing root causes.

## Features

### 🔍 Systematic Debugging

Four-phase framework ensuring understanding before fixes:

- **Root Cause Investigation** - Read errors, reproduce, gather evidence
- **Pattern Analysis** - Compare working vs broken, understand dependencies
- **Hypothesis Testing** - Scientific method, minimal changes, verify
- **Implementation** - Fix root cause not symptom, appropriate testing

### 🔄 Root Cause Tracing

Trace bugs backward through call stack to find original trigger:

- **Backward tracing** - Follow data flow up the call chain
- **Stack instrumentation** - Add logging to identify failure points
- **Defense-in-depth** - Add validation at multiple layers
- **Never fix symptoms** - Always trace to source

## Installation

```bash
/plugin install debug@dotai
# restart claude
```

## Commands

### /debug:debug

Invoke systematic four-phase debugging framework.

```bash
/debug:debug
```

Enforces disciplined investigation before fixes.

## Skills

### Systematic Debugging

**When to use:** Any bug, test failure, or unexpected behavior

**Triggers:** Error messages, test failures, unexpected behavior, performance issues

**The Four Phases:**
1. **Root Cause Investigation** - BEFORE attempting ANY fix
2. **Pattern Analysis** - Find working examples, compare
3. **Hypothesis Testing** - Scientific method, one change at a time
4. **Implementation** - Fix root cause, appropriate testing

**Iron Law:** NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST

### Root Cause Tracing

**When to use:** Errors occur deep in execution, need to trace back to trigger

**Triggers:** Deep stack traces, unclear data origin, git init in wrong dir

**Process:**
1. Observe the symptom
2. Find immediate cause
3. Ask: What called this?
4. Keep tracing up
5. Find original trigger
6. Fix at source + defense-in-depth

## Common Anti-Patterns to Avoid

❌ **"Quick fix for now, investigate later"**
✅ Systematic investigation is faster than thrashing

❌ **"Just try changing X and see if it works"**
✅ Form hypothesis, test minimally, verify

❌ **"Add multiple changes, run tests"**
✅ One variable at a time

❌ **"I see the problem, let me fix it"**
✅ Seeing symptoms ≠ understanding root cause

❌ **"One more fix attempt" (after 2+ failures)**
✅ 3+ failures = architectural problem

## When to Stop and Reassess

**If 3+ fixes failed:**
- Each fix reveals new problem in different place
- Fixes require massive refactoring
- Each fix creates new symptoms elsewhere

**STOP and question fundamentals:**
- Is this pattern fundamentally sound?
- Should we refactor architecture vs continue fixing?
- Discuss with human partner before more fixes

## Real-World Impact

From debugging sessions:
- **Systematic approach:** 15-30 minutes to fix
- **Random fixes:** 2-3 hours of thrashing
- **First-time fix rate:** 95% vs 40%
- **New bugs introduced:** Near zero vs common

## Integration

Works seamlessly with other dotai plugins:

- **agents** - Dispatch parallel agents after root cause identified
- **plan** - Use systematic debugging in implementation plans
- **test** - Write appropriate tests based on complexity

## Best Practices

1. **Always complete Phase 1** - No fixes without understanding
2. **Add instrumentation** - Log at component boundaries
3. **Trace backwards** - From symptom to source
4. **Test minimally** - One change at a time
5. **Question architecture** - After 3 failed fixes
6. **Defense-in-depth** - Add validation at multiple layers

## Debugging Checklist

Before proposing ANY fix:
- [ ] Read error messages completely
- [ ] Can reproduce consistently?
- [ ] Checked recent changes?
- [ ] Added instrumentation if multi-component?
- [ ] Traced data flow to source?
- [ ] Found working example to compare?
- [ ] Formed single hypothesis?
- [ ] Will test with minimal change?

## Examples

### Multi-Layer System Debugging

```bash
# Layer 1: Workflow
echo "=== Secrets available in workflow: ==="
echo "IDENTITY: ${IDENTITY:+SET}${IDENTITY:-UNSET}"

# Layer 2: Build script
echo "=== Env vars in build script: ==="
env | grep IDENTITY || echo "IDENTITY not in environment"

# Layer 3: Signing script
echo "=== Keychain state: ==="
security list-keychains
security find-identity -v
```

### Stack Trace Instrumentation

```typescript
async function problematicOperation(directory: string) {
  const stack = new Error().stack;
  console.error("DEBUG operation:", {
    directory,
    cwd: process.cwd(),
    nodeEnv: process.env.NODE_ENV,
    stack,
  });

  // Operation that's failing
  await execFileAsync("git", ["init"], { cwd: directory });
}
```