---
allowed-tools: Read, Write, Bash, Glob, Grep, TodoWrite
description: Parse a PRD into a structured implementation checklist
---

# Parse PRD into Implementation Checklist

## Context

- **User Request:** $ARGUMENTS
- **Current directory:** !`pwd`
- **PRD files:** !`ls -la .claude/docs/prd*.md 2>/dev/null || echo "No PRD files found"`
- **PRD Template:** @.claude/docs/example_prd.md

## Goal

Parse a Product Requirements Document (PRD) into a structured markdown implementation checklist. This creates an actionable task list that developers can follow and check off as they build the feature.

## Process

### 1. Determine PRD Location

**Identify which PRD file to parse:**

Check for:
- Explicit PRD path in `$ARGUMENTS`
- Tag-specific PRD: `.claude/docs/prd-[feature-name].md`
- Default PRD location: `.claude/docs/prd.md`

### 2. Read and Analyze PRD

Read the PRD file and extract:
- Core features and requirements
- Technical architecture components
- Development roadmap phases
- Logical dependency chain
- Key implementation details

### 3. Generate Implementation Checklist

Create a structured markdown file with:

```markdown
# [Feature Name] Implementation Checklist

Generated from: [PRD filename]
Date: [Current date]

## Overview
[Brief summary from PRD]

## Prerequisites
- [ ] Requirement 1
- [ ] Requirement 2

## Phase 1: Foundation
### Task Group 1
- [ ] Subtask 1.1
- [ ] Subtask 1.2

### Task Group 2
- [ ] Subtask 2.1
- [ ] Subtask 2.2

## Phase 2: Core Features
[Continue with implementation steps...]

## Phase 3: Polish & Testing
- [ ] Testing tasks
- [ ] Documentation tasks

## Notes
- Key technical decisions
- Important considerations
- Risk mitigations
```

### 4. Save Checklist

Save the generated checklist to:
- `.claude/docs/checklist-[feature-name].md`

## Execution Steps

### Step 1: Read the PRD

```markdown
1. **Locate the PRD file**
   - Use provided path or search for PRD files
   - Verify file exists

2. **Read PRD content**
   - Extract all sections
   - Note key requirements and dependencies
```

### Step 2: Extract Implementation Tasks

```markdown
1. **Analyze Development Roadmap section**
   - Break down into phases (MVP, enhancements, etc.)
   - Identify atomic tasks

2. **Review Logical Dependency Chain**
   - Order tasks by dependencies
   - Group related tasks

3. **Process Technical Architecture**
   - Extract component implementation tasks
   - Note data model requirements
   - Identify API/integration work
```

### Step 3: Structure the Checklist

```markdown
1. **Create hierarchical task structure**
   - Use phases/groups for organization
   - Add checkbox format for tracking
   - Include context/notes where helpful

2. **Add metadata**
   - Source PRD reference
   - Generation date
   - Feature overview
```

### Step 4: Generate and Save

```markdown
1. **Write checklist file**
   - Save to `.claude/docs/checklist-[name].md`
   - Use clean markdown formatting

2. **Confirm success**
   - Show file location
   - Display summary of task count
   - Suggest next steps
```

## Output Format

The generated checklist should follow this structure:

```markdown
# [Feature Name] Implementation Checklist

**Source PRD:** `.claude/docs/prd-[feature-name].md`
**Generated:** [Date]
**Status:** Not Started

## 📋 Overview

[Brief description of the feature and its goals]

## ✅ Prerequisites

Essential setup before starting implementation:
- [ ] Review project structure
- [ ] Understand existing patterns
- [ ] Set up development environment
- [ ] [Other prerequisites from PRD]

## 🏗️ Phase 1: Foundation

### Database & Models
- [ ] Define data models
- [ ] Create database schema
- [ ] Set up migrations
- [ ] [Other data tasks]

### Core Infrastructure
- [ ] Set up API routes
- [ ] Configure authentication
- [ ] [Other infrastructure]

## 🎨 Phase 2: Core Features

### Feature Component 1
- [ ] Implement UI components
- [ ] Add business logic
- [ ] Connect to APIs
- [ ] [Other tasks]

### Feature Component 2
- [ ] [Implementation tasks]

## 🔍 Phase 3: Testing & Polish

### Testing
- [ ] Manual testing scenarios
- [ ] Edge case validation
- [ ] Security review
- [ ] [Other testing]

### Documentation
- [ ] Update README if needed
- [ ] Add inline code comments
- [ ] Document API changes
- [ ] [Other docs]

## 📝 Notes

### Technical Decisions
- [Key architectural choices]
- [Library selections]

### Risks & Mitigations
- [Known risks from PRD]
- [Mitigation strategies]

### Future Enhancements
- [Post-MVP features]
- [Nice-to-have improvements]

---

**Progress:** 0/[total] tasks completed
```

## Best Practices

### DO:
- **Extract all phases** from the PRD's Development Roadmap
- **Respect dependency order** from Logical Dependency Chain
- **Break down complex tasks** into smaller, actionable items
- **Include context** from PRD where it helps clarity
- **Use clear, action-oriented language** for each task

### DON'T:
- **Create generic tasks** - be specific about what needs to be built
- **Lose PRD context** - reference important decisions and rationale
- **Ignore dependencies** - maintain logical implementation order
- **Over-simplify** - include enough detail for implementation

## Example Usage

```bash
# Parse specific PRD file
/parse-prd prd-user-authentication.md

# Parse with full path
/parse-prd .claude/docs/prd-payments.md

# Parse default PRD
/parse-prd
```

## Natural Language Examples

```
"Parse my authentication PRD into a checklist"
"Convert the payments PRD into implementation tasks"
"Create a checklist from prd-dashboard.md"
```

## Next Steps

After generating the checklist:

1. **Review the checklist** - Open `.claude/docs/checklist-[name].md`
2. **Refine if needed** - Add or adjust tasks based on your understanding
3. **Start implementation** - Begin with Phase 1 tasks
4. **Track progress** - Check off tasks as you complete them
5. **Update as needed** - Adjust the checklist as implementation evolves

## Integration with Workflow

The generated checklist integrates with your development workflow:

1. **PRD Creation** → Use `/create-prd` or `/create-prd-interactive`
2. **PRD Parsing** → Use `/parse-prd` (this command)
3. **Implementation** → Follow the generated checklist
4. **Progress Tracking** → Check off tasks in the markdown file

You can also copy relevant checklist items into Claude Code's todo list using the TodoWrite tool during active development sessions.

## Example Output Summary

After parsing, show:

```
✅ Successfully parsed PRD: prd-user-authentication.md

📄 Generated checklist: .claude/docs/checklist-user-authentication.md

📊 Summary:
   - 3 phases
   - 15 task groups
   - 47 total tasks

🎯 Next Steps:
   1. Review the checklist: .claude/docs/checklist-user-authentication.md
   2. Start with Phase 1: Foundation tasks
   3. Use `/create-snippet` for reusable code patterns
```
