---
allowed-tools: Bash, Read, Write, Glob, Grep, Task, TodoWrite
description: Generate a PRD interactively with clarifying questions for complex features
---

# Generate a Product Requirements Document (PRD)

## Context

- **User Request:** $ARGUMENTS
- **Project Root:** !`pwd`
- **Existing PRDs:** !`ls -la .claude/docs/prd-*.md 2>/dev/null || echo "No existing PRDs found"`
- **Project Status:** @CLAUDE.md#project-status
- **Tech Stack:** @.claude/docs/tech-stack.md
- **Project Structure:** !`bash .claude/scripts/tree.sh`
- **PRD Template:** @.claude/docs/example_prd.md

## Goal

To create a detailed Product Requirements Document (PRD) in Markdown format. The PRD should be clear, actionable, and suitable for a junior developer to understand and implement.

## Process

1. **Analyze Feature Request:** Think deeply about the user's feature request and its implications for the codebase.

2. **Codebase Analysis:**

   - Search for relevant existing code patterns
   - Review components that might be affected
   - Identify potential integration points
   - Consider architectural impacts

3. **Ask Clarifying Questions:**

   - Ask 4-6 targeted questions based on codebase analysis
   - Provide lettered/numbered options for easy response
   - Focus on understanding the "what" and "why", not the "how"

4. **Generate PRD:**

   - Follow the example PRD structure exactly
   - Include all required sections from the template
   - Ensure clarity for junior developers

5. **Save and Next Steps:**
   - Save as `prd-[feature-name].md` in `.claude/docs/`
   - Suggest running parse command

## Clarifying Questions Framework

Adapt questions based on the specific feature request provided above. Consider these areas:

- **Problem/Goal:** "What problem does this feature solve for the user?" or "What is the main goal we want to achieve with this feature?"
- **Target User:** "Who is the primary user of this feature?"
- **Core Functionality:** "Can you describe the key actions a user should be able to perform with this feature?"
- **User Stories:** "Could you provide a few user stories? (e.g., As a [type of user], I want to [perform an action] so that [benefit].)"
- **User Experience:** "Describe the user journey and key user flows for this feature"
- **Scope/Boundaries:** "Are there any specific things this feature _should not_ do (non-goals)?"
- **Technical Integration:** "What existing systems or components should this integrate with?"
- **Data Requirements:** "What kind of data does this feature need to display or manipulate?"
- **Design/UI:** "Are there any existing design patterns or UI guidelines to follow?" or "Can you describe the desired look and feel?"
- **Development Phases:** "Should this be built in phases? What's the MVP vs future enhancements?"
- **Dependencies:** "What needs to be built first? Are there logical dependencies?"
- **Success Criteria:** "How will we know when this feature is successfully implemented?"
- **Edge Cases:** "Are there any potential risks or technical challenges we should consider?"

## PRD Structure Requirements

The PRD must follow the exact structure from @.claude/docs/example_prd.md:

### `<context>` Section

1. **Overview:** High-level overview of the product/feature, what problem it solves, who it's for, and why it's valuable
2. **Project Context:** Include the standard project status information. CRITICIAL: DO NOT forget this section. Read the mentioned files if needed.
3. **Core Features:** List and describe the main features, including what each does, why it's important, and how it works at a high level
4. **User Experience:** Describe user personas, key user flows, and UI/UX considerations

### `<PRD>` Section

1. **Technical Architecture:** System components, data models, APIs and integrations, infrastructure requirements
2. **Development Roadmap:** Break down into phases (MVP requirements, future enhancements) focusing on scope and detailing exactly what needs to be built
3. **Logical Dependency Chain:** Define the logical order of development, which features need to be built first, getting quickly to something usable/visible, properly pacing and scoping each feature
4. **Risks and Mitigations:** Technical challenges, figuring out the MVP that can be built upon, resource constraints
5. **Appendix:** Research findings, technical specifications, additional information

## Target Audience

Assume the primary reader of the PRD is a **junior developer**. Therefore, requirements should be explicit, unambiguous, and avoid jargon where possible. Provide enough detail for them to understand the feature's purpose and core logic.

## Output

- **Format:** Markdown (`.md`)
- **Location:** `.claude/docs/`
- **Filename:** `prd-[feature-name].md`

## Final Instructions

1. **Think deeply** about the feature request and its architectural implications
2. **Do NOT start implementing** - only create the PRD document
3. **Ask clarifying questions** with lettered/numbered options
4. **Generate complete PRD** following the template structure exactly
5. **Save the PRD** to `.claude/docs/prd-[feature-name].md`
6. **Suggest next step:** "Use `/parse-prd [feature-name]` to convert this PRD into tasks"

## Example Usage

```
/project:prd user authentication system
```

This will:

1. Analyze the codebase for existing auth patterns
2. Ask questions about auth requirements
3. Generate a comprehensive PRD
4. Save it as `prd-user-authentication.md`
