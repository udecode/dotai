---
allowed-tools: Bash, Read, Write, Glob, Grep, Task, TodoWrite
description: Generate a PRD directly without questions for simple, well-defined features
---

# Generate a Quick Product Requirements Document (PRD)

## Context

- **User Request:** $ARGUMENTS
- **Project Root:** !`pwd`
- **Existing PRDs:** !`ls -la .claude/docs/prd-*.md 2>/dev/null || echo "No existing PRDs found"`
- **Project Status:** @CLAUDE.md#project-status
- **Project Structure:** !`bash .claude/scripts/tree.sh`
- **Tech Stack:** @.claude/docs/tech-stack.md
- **PRD Template:** @.claude/docs/example_prd.md

## Goal

To quickly create a Product Requirements Document (PRD) without asking clarifying questions. Best suited for simple, well-defined features where requirements are clear.

## Process

1. **Analyze Feature Request:**

   - Think deeply about the user's feature request
   - Make reasonable assumptions based on common patterns
   - Review existing codebase for context

2. **Codebase Analysis:**

   - Search for relevant existing code patterns
   - Review components that might be affected
   - Identify potential integration points
   - Consider architectural impacts

3. **Generate PRD Immediately:**

   - Follow the example PRD structure exactly
   - Include all required sections from the template
   - Make reasonable assumptions for unclear requirements
   - Document assumptions clearly in the PRD

4. **Save and Next Steps:**
   - Save as `prd-[feature-name].md` in `.claude/docs/`
   - Suggest running parse command

## PRD Structure Requirements

The PRD must follow the exact structure from @.claude/docs/example_prd.md:

### `<context>` Section

1. **Overview:** High-level overview of the product/feature, what problem it solves, who it's for, and why it's valuable
2. **Project Context:** Include the standard project status information. CRITICAL: DO NOT forget this section. Read the mentioned files if needed.
3. **Core Features:** List and describe the main features, including what each does, why it's important, and how it works at a high level
4. **User Experience:** Describe user personas, key user flows, and UI/UX considerations

### `<PRD>` Section

1. **Technical Architecture:** System components, data models, APIs and integrations, infrastructure requirements
2. **Development Roadmap:** Break down into phases (MVP requirements, future enhancements) focusing on scope and detailing exactly what needs to be built
3. **Logical Dependency Chain:** Define the logical order of development, which features need to be built first, getting quickly to something usable/visible, properly pacing and scoping each feature
4. **Risks and Mitigations:** Technical challenges, figuring out the MVP that can be built upon, resource constraints
5. **Appendix:** Research findings, technical specifications, additional information

## Assumptions Section

When using quick mode, include an "Assumptions" section at the beginning of the PRD documenting:

- Key assumptions made about requirements
- Default choices for ambiguous features
- Suggested areas that may need refinement

## Final Instructions

1. **Think deeply** about the feature request and make intelligent assumptions
2. **Do NOT ask questions** - proceed directly to PRD generation
3. **Document assumptions** clearly in the PRD
4. **Generate complete PRD** following the template structure exactly
5. **Save the PRD** to `.claude/docs/prd-[feature-name].md`
6. **Suggest next step:** "Use `/parse-prd [feature-name]` to convert this PRD into tasks"

## Example Usage

```
/project:prd-quick user profile page with avatar upload
```

This will:

1. Analyze the codebase for existing user/profile patterns
2. Make assumptions about profile fields and avatar requirements
3. Generate a comprehensive PRD immediately
4. Save it as `prd-user-profile-page.md`
5. Document all assumptions made

## When to Use Quick Mode

✅ **Good for:**

- Simple CRUD features
- Standard UI components
- Well-defined integrations
- Features with clear precedent in codebase

❌ **Avoid for:**

- Complex architectural changes
- Features with many unknowns
- Security-critical features
- Features affecting multiple systems

For complex features, use `/project:prd` for the full interactive process.
