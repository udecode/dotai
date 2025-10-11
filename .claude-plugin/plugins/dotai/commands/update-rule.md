---
allowed-tools: Read, Glob, Grep, Write, MultiEdit, TodoWrite, Bash
description: Update existing Cursor rules based on new patterns or codebase evolution
---

# Update Cursor Rule

## Context

- **User Request:** $ARGUMENTS
- Rules directory: !`ls -la .cursor/rules/*.mdc | wc -l | xargs -I {} echo "{} total rules"`
- Rule guidelines: @.cursor/rules/cursor-rules.mdc

## Goal

Update an existing Cursor rule to reflect new patterns, codebase changes, or improved conventions. Maintain consistency with the rule structure while incorporating new learnings and examples.

## Process

### 1. Rule Analysis

- Read the existing rule thoroughly
- Understand current requirements
- Note the file patterns (globs)
- Review existing examples

### 2. Pattern Evolution Detection

**Think deeply about how code patterns have evolved since this rule was created.**

Analyze for:

- **New Patterns:** Better ways to implement the same concept
- **Framework Updates:** Changes due to library/framework evolution
- **Anti-patterns:** New problematic patterns discovered
- **Edge Cases:** Scenarios not covered by current rule
- **Related Changes:** Impact from other rule updates

### 3. Codebase Scanning

Search for:

- Current implementations of the pattern
- Violations of the existing rule
- New good examples to reference
- Emerging patterns that should be included

### 4. Interactive Update Session

Ask about:

- Specific patterns that need updating
- New edge cases discovered
- Framework or library changes
- Team feedback on the rule

### 5. Update Rule

Make targeted updates:

- Preserve valid existing content
- Update examples with current code
- Add new patterns or exceptions
- Update file references
- Revise related rules section

### 6. Save and Communicate

- Save updated rule
- Note what changed
- Update CLAUDE.md if rule significance changed
- Suggest reviewing affected code

## Update Questions Template

### 🔍 Pattern Evolution

**1. What prompted this rule update?**

a) **New patterns emerged** - Better ways to do things  
b) **Framework changes** - Library updates require new approach  
c) **Problems discovered** - Current rule has issues  
d) **Team feedback** - Developers suggested improvements  
e) **Codebase evolution** - Patterns have naturally changed

**2. Are there new GOOD patterns to add?**

Please describe or provide examples of patterns that should be encouraged.

**3. Have you discovered new ANTI-patterns?**

What problematic patterns have emerged that the rule should discourage?

### 📁 Scope Changes

**4. Should the rule apply to different files now?**

Current globs: [show from existing rule]

a) **Same scope** - No change to file patterns  
b) **Expand scope** - Apply to more files  
c) **Narrow scope** - Apply to fewer files  
d) **Different patterns** - Change glob patterns entirely

**5. Should alwaysApply setting change?**

Currently: [show from existing rule]

a) **Keep current setting**  
b) **Change to always apply**  
c) **Change to conditional**

### 🔗 Related Updates

**6. Have related rules changed?**

Review if updates to other rules affect this one.

**7. Are there new related rules to reference?**

List any newly created rules that relate to this one.

## Update Strategy

### Incremental Updates

````markdown
## Examples

### ✅ DO: [Good Pattern Name]

<!-- Existing example - still valid -->

```typescript
// Original good example
```
````

<!-- NEW: Added based on recent patterns -->

```typescript
// New pattern discovered in [file]
```

### ❌ DON'T: [Anti-pattern Name]

<!-- UPDATED: Better example -->

```typescript
// More relevant anti-pattern
```

````

### Version Notes

When framework/library updates affect rules:

```markdown
## Framework Compatibility

**React 18+**: Use the new pattern
**React 17**: Legacy pattern still acceptable

<!-- Show migration path -->
````

### Edge Case Documentation

```markdown
## Edge Cases

**NEW:** [Scenario discovered since last update]

- How to handle: [Approach]
- Example: [Code snippet]
```

## Execution Steps

### 1. Start with Analysis

```bash
# Find current implementations
rg -t ts -t tsx "[pattern from rule]" --glob "!node_modules"

# Check for violations
# Search for anti-patterns mentioned in rule

# Find new examples
# Look for files modified recently that might have new patterns
```

**Think deeply about:** "How has our understanding of this pattern evolved? What have we learned from using this rule? Are there better ways to achieve the same goal?"

### 2. Current State Review

- Read existing rule completely
- Check all file references still exist
- Verify examples are still current
- Test if globs match intended files

### 3. Interactive Q&A

- Present current rule state
- Ask about specific changes needed
- Gather new examples

### 4. Update Rule

Follow incremental approach:

- Mark sections that are updated
- Preserve good existing content
- Add new examples from current code
- Update stale file references

### 5. Save and Document

```markdown
<!-- At top of rule file -->
<!-- Last updated: [date] - [summary of changes] -->
```

## Key Principles

### DO:

- **Preserve Value:** Keep good existing examples
- **Real Updates:** Use actual current code
- **Clear Changes:** Note what's new or updated
- **Maintain Structure:** Follow established format
- **Test Globs:** Verify patterns still match correctly

### DON'T:

- **Complete Rewrite:** Unless fundamentally wrong
- **Break References:** Ensure linked files exist
- **Lose History:** Keep record of why changes were made
- **Theoretical Updates:** Use real examples
- **Overcomplicate:** Keep rule focused

## Common Update Scenarios

### Framework Version Updates

```markdown
## Requirements

- **React 18+:**
  - Use `useId()` for unique IDs
  - Prefer `startTransition` for non-urgent updates
- **React 17 (legacy):**
  - Continue using previous patterns
  - Plan migration to new patterns
```

### New Tool Adoption

```markdown
## Tools

**Previous:** ESLint + Prettier
**Current:** Biome (replaced both)

<!-- Update all configuration examples -->
```

### Pattern Evolution

````markdown
## Examples

### ✅ DO: Modern Async Pattern

```typescript
// NEW: Using async/await with proper error boundaries
const MyComponent = () => {
  const { data, error } = useSWR("/api/data", fetcher);

  if (error) return <ErrorBoundary error={error} />;
  if (!data) return <Skeleton />;

  return <DataDisplay data={data} />;
};
```
````

<!-- Replaced: useEffect + setState pattern -->

```

## Output

- **Format:** Markdown with `.mdc` extension
- **Location:** `.cursor/rules/`
- **Filename:** Same as existing rule
- **Backup:** Consider keeping version history

## Final Checklist

1. ✅ Read existing rule completely
2. ✅ Search for current pattern usage
3. ✅ Find new good examples
4. ✅ Identify new anti-patterns
5. ✅ Update with real code examples
6. ✅ Verify all file references exist
7. ✅ Test glob patterns still work
8. ✅ Update related rules section
9. ✅ Document what changed
10. ✅ Update CLAUDE.md if needed
11. ✅ Consider impact on existing code
```
