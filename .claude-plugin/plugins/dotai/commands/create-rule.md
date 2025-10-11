---
allowed-tools: Read, Glob, Grep, Write, MultiEdit, TodoWrite, Bash
description: Create a new Cursor rule file with proper structure and conventions
---

# Create Cursor Rule

**User Request:** $ARGUMENTS

## Context

- Rules directory: !`ls -la .cursor/rules/*.mdc 2>/dev/null | wc -l | xargs -I {} echo "{} existing rules"`
- Existing rules: !`ls -1 .cursor/rules/*.mdc 2>/dev/null | sed 's/.*\///' | head -10 || echo "No rules yet"`
- Rule guidelines: @.cursor/rules/cursor-rules.mdc

## Goal

Create a new Cursor rule file that follows the established conventions and structure. The rule should be actionable, well-documented, and reference actual code patterns from the codebase.

## Process

### 1. Analyze Rule Request

**Think deeply about what patterns or conventions this rule should enforce.**

Consider:

- What problem does this rule solve?
- What patterns should it enforce?
- What anti-patterns should it prevent?
- Which files or areas of code does it apply to?
- Are there existing examples in the codebase?

### 2. Search for Patterns

Search the codebase for:

- Existing implementations to reference
- Common patterns that need standardization
- Anti-patterns to discourage
- Related code that demonstrates the rule

### 3. Interactive Rule Design

Ask clarifying questions about:

- Specific file patterns (globs)
- When the rule should apply
- Exceptions or edge cases
- Related existing rules

### 4. Generate Rule File

Create comprehensive rule following the standard structure:

- YAML frontmatter
- Clear description
- Actionable requirements
- Code examples
- File references

### 5. Save and Cross-Reference

- Save to `.cursor/rules/[rule-name].mdc`
- Update related rules if needed
- Update CLAUDE.md to reference new rule in Core Rules section
- Suggest next steps

## Rule Creation Questions

### 📋 Rule Definition

**1. What is the primary purpose of this rule?**

Please describe what convention, pattern, or standard this rule should enforce.

**2. Which files should this rule apply to?**

a) **Specific file types** - `*.ts`, `*.tsx`, etc.  
b) **Directory patterns** - `src/components/**/*`, `app/**/*`  
c) **Framework files** - Route handlers, API endpoints, etc.  
d) **Configuration files** - `*.config.ts`, setup files  
e) **All files** - Universal convention

**3. Should this rule always apply or conditionally?**

a) **Always apply** - Enforced on every matching file  
b) **Conditional** - Only when certain patterns exist  
c) **Opt-in** - Developers choose when to apply

### 🔍 Pattern Examples

**4. Can you provide examples of GOOD patterns to follow?**

Share code snippets or describe the correct implementation.

**5. What are BAD patterns to avoid?**

Share anti-patterns or common mistakes this rule should prevent.

**6. Are there existing files that demonstrate this pattern well?**

List files that already follow this convention correctly.

### 🔗 Related Rules

**7. Does this rule relate to any existing conventions?**

a) **Extends existing rule** - Builds on another rule  
b) **Complements rule** - Works alongside another  
c) **Replaces rule** - Supersedes an outdated rule  
d) **Standalone** - Independent convention

## Rule Structure Template

````markdown
---
description: [Clear, one-line description of what the rule enforces]
globs: [path/to/files/*.ext, other/path/**/*]
alwaysApply: [true/false]
---

# [Rule Title]

## Overview

[Brief explanation of why this rule exists and what problem it solves]

## Requirements

- **[Requirement Category]:**
  - [Specific requirement]
  - [Another requirement]
  - [Edge cases or exceptions]

## Examples

### ✅ DO: [Good Pattern Name]

```[language]
// Example of correct implementation
[code example]
```
````

**Why:** [Explanation of why this is the right approach]

### ❌ DON'T: [Anti-pattern Name]

```[language]
// Example of what to avoid
[code example]
```

**Why:** [Explanation of why this should be avoided]

## File References

- Good examples: [component.tsx](mdc:src/components/example/component.tsx)
- Pattern usage: [api-handler.ts](mdc:app/api/example/route.ts)

## Related Rules

- [other-rule.mdc](mdc:.cursor/rules/other-rule.mdc) - [How it relates]
- [another-rule.mdc](mdc:.cursor/rules/another-rule.mdc) - [How it relates]

## Migration Guide

[If applicable, how to migrate existing code to follow this rule]

1. [Step 1]
2. [Step 2]
3. [Step 3]

````

## Execution Steps

### 1. Initial Analysis

```bash
# Search for relevant patterns
rg -t ts -t tsx "[pattern]" --glob "!node_modules"

# Find files that might need this rule
find . -name "*.tsx" -path "*/components/*" | head -20
````

**Think deeply about:** "What patterns in the codebase would benefit from standardization? What mistakes do developers commonly make that this rule could prevent?"

### 2. Pattern Discovery

- Use Grep to find existing patterns
- Use Read to examine good examples
- Identify variations that need standardization

### 3. Interactive Design

- Ask clarifying questions
- Get specific examples
- Understand edge cases

### 4. Rule Generation

- Follow the template structure
- Include real code examples
- Reference actual files
- Connect to related rules

### 5. Save and Integrate

```bash
# Create rule file
# Save to .cursor/rules/[rule-name].mdc

# Show related rules
ls -la .cursor/rules/*.mdc | grep -E "(related|similar)"
```

## Best Practices

### DO:

- **Real Examples:** Use actual code from the project
- **Clear Globs:** Specific file patterns, not overly broad
- **Actionable:** Developers should know exactly what to do
- **Justification:** Explain WHY not just WHAT
- **Cross-Reference:** Link to related rules and examples

### DON'T:

- **Theoretical:** Avoid hypothetical examples
- **Vague:** Don't use unclear descriptions
- **Overly Broad:** Don't apply to all files unless necessary
- **Redundant:** Don't duplicate existing rules
- **Complex:** Keep rules focused on one concept

## Output

- **Format:** Markdown with `.mdc` extension
- **Location:** `.cursor/rules/`
- **Filename:** `[descriptive-name].mdc`

## Example Usage

```
/project:rules:create component naming conventions

/project:rules:create API error handling patterns
```

## Next Steps

After creating the rule:

1. Review existing code for compliance
2. Update non-compliant code if needed
3. Add to code review checklist
4. Update CLAUDE.md Core Rules section to reference the new rule
5. Share with team
