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
- **Project Structure:** !`bash ~/.claude/plugins/marketplaces/dotai/.claude-plugin/plugins/dotai/scripts/tree.sh`
- **Tech Stack:** @.cursor/rules/tech-stack.mdc

## Goal

Create a strategic, implementation-ready PRD with clear problem statements, architecture requirements, and success metrics. Focus on actionable specifications that can be directly converted into atomic tasks.

## CRITICAL: PRD Quality Standards

### Problem-Driven Thinking

Every PRD must start with strategic thinking:

- **Challenge**: What specific problem are we solving? (Not just "add feature X")
- **Context**: Why now? What's the current situation and pain points?
- **Impact**: What happens if we don't build this? What value does it deliver?
- **User Value**: How does this improve the user experience measurably?

### Architecture Requirements

Categorize requirements for clarity:

- **Mandatory Requirements**: Must-have technical requirements with acceptance criteria
- **Performance Requirements**: Measurable performance targets (response time, throughput, etc.)
- **Recommended Requirements**: Nice-to-have features and future considerations

### Success Metrics

Define how success will be measured:

- **Primary Goals**: Key measurable outcomes
- **Quality Gates**: Non-negotiable quality criteria
- **User Metrics**: How will users benefit (measurable improvements)

### 🚫 PRD Anti-Patterns (NEVER CREATE THESE)

- **No Feature Laundry Lists**: Don't just list features without explaining WHY and FOR WHOM
- **No Vague PRDs**: Avoid "improve UX" or "enhance performance" without specifics
- **No Solution-First PRDs**: Start with the problem, not the solution
- **No Missing Context**: Every PRD needs clear problem statement and user value
- **No Unmeasurable Goals**: Success must be verifiable (not "make it better")
- **No Dependency Ignorance**: Map out what needs to exist before this can be built

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

The PRD must follow the exact structure shown in the "PRD Template" section below:

### `<context>` Section

1. **Overview:** High-level overview of the product/feature, what problem it solves, who it's for, and why it's valuable
2. **Project Context:** Include the standard project status information. CRITICAL: DO NOT forget this section. Read the mentioned files if needed.
3. **Core Features:** List and describe the main features, including what each does, why it's important, and how it works at a high level
4. **User Experience:** Describe user personas, key user flows, and UI/UX considerations

### `<PRD>` Section

1. **Problem Statement:** Challenge, Context, Impact, User Value - strategic framing of why this matters
2. **Architecture Requirements:** Mandatory, Performance, and Recommended requirements with acceptance criteria
3. **Technical Architecture:** System components, data models, APIs and integrations, infrastructure
4. **Development Roadmap:** Phases with deliverables, acceptance criteria, and dependencies
5. **Success Metrics:** Primary goals, quality gates, user-facing improvements (measurable)
6. **Logical Dependency Chain:** Build order, getting to usable MVP quickly, proper feature pacing
7. **Risks and Mitigations:** Technical challenges, MVP scope, resource constraints
8. **Appendix:** Research findings, technical specifications

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
/create-prd user profile page with avatar upload
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

For complex features, use `/create-prd-interactive` for the full interactive process.

## PRD Template

Use this exact structure for all PRDs:

```markdown
<context>
# Project Context

**Project Status: Pre-MVP**

- Read this file: `.cursor/rules/app-design-document.mdc` - App design document
- Read this file: `.cursor/rules/tech-stack.mdc` - Tech stack, architecture
- DO NOT care about breaking changes. We didn't deploy yet.
- DO NOT care about unit testing, accessibility, visual testing (Storybook), and performance optimization unless asked.
- Care about security, zod validation, authorization, rate limiting, and other production-level concerns. In general, you can see how it's done in the other features.

# Overview

[Provide a high-level overview of the feature/product]

## Problem Statement

**Challenge**: [What specific problem are we solving? What pain point exists?]

**Context**: [Why now? What's the current situation that makes this necessary?]

**Impact**: [What happens if we don't build this? What value does it deliver?]

**User Value**: [How does this improve the user experience? Be specific and measurable.]

# Core Features

[List and describe the main features. For each feature, include:

- **What it does**: Functional description
- **Why it's important**: User value and business impact
- **How it works**: High-level interaction flow]

# User Experience

[Describe the user journey and experience:

- **User Personas**: Who will use this feature
- **Key User Flows**: Step-by-step user interactions
- **UI/UX Considerations**: Interface design principles and patterns]

</context>
<PRD>

# Architecture Requirements

## Mandatory Requirements (MUST HAVE)

- **[Requirement 1]**: [Specific technical requirement with clear acceptance criteria]
- **[Requirement 2]**: [Another must-have requirement]

## Performance Requirements (MEASURABLE)

- **[Performance Target 1]**: [Specific metric - e.g., "API response time <200ms"]
- **[Performance Target 2]**: [Another measurable target]

## Recommended Requirements (NICE TO HAVE)

- **[Optional Feature 1]**: [Nice-to-have enhancement]
- **[Future Consideration]**: [Extensibility and scalability thought]

# Technical Architecture

[Outline technical implementation:

- **System Components**: Core technical pieces
- **Data Models**: Database schema, types, relationships
- **APIs and Integrations**: External services, endpoints
- **Infrastructure**: Hosting, deployment, scaling considerations]

# Development Roadmap

## Phase 1: Foundation

**Deliverables**:

- [Specific deliverable 1]
- [Specific deliverable 2]

**Acceptance Criteria**:

- [How to verify this phase is complete]
- [Measurable completion criteria]

**Dependencies**: [What must exist before starting this phase]

## Phase 2: Core Features

**Deliverables**:

- [Main feature implementations]

**Acceptance Criteria**:

- [Verification steps]

**Dependencies**: Phase 1 completion

## Phase 3: Polish & Future

**Deliverables**:

- [Testing, refinement, enhancements]

**Acceptance Criteria**:

- [Quality gates and success criteria]

**Dependencies**: Phase 2 completion

# Success Metrics

## Primary Goals

- **[Goal 1]**: [Specific, measurable outcome]
- **[Goal 2]**: [Another key metric]

## Quality Gates

- **[Non-negotiable criterion 1]**: [Must be met before launch]
- **[Non-negotiable criterion 2]**: [Quality threshold]

## User-Facing Improvements

- **[User benefit 1]**: [How users benefit, measured]
- **[User benefit 2]**: [Another measurable improvement]

# Logical Dependency Chain

[Define build order:

1. **Foundation First**: [What core infrastructure must exist - auth, data models, etc.]
2. **Minimal Viable Flow**: [Fastest path to working, visible feature]
3. **Feature Pacing**: [How each feature builds upon previous work]
4. **Iteration Points**: [Where we can pause, test, and course-correct]]

# Risks and Mitigations

## Technical Challenges

- **[Risk 1]**: [Technical challenge] → **Mitigation**: [How to address]
- **[Risk 2]**: [Another risk] → **Mitigation**: [Strategy to handle]

## MVP Scope

- **[Scope Risk]**: [Complexity concern] → **Mitigation**: [How to keep scope manageable]

## Resource Constraints

- **[Constraint]**: [Time/skill limitation] → **Mitigation**: [Workaround or simplification]

# Appendix

## Research Findings

[Relevant research, competitor analysis, technical discoveries]

## Technical Specifications

[Detailed technical specs, API contracts, data schemas]

</PRD>
```
