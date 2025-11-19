---
name: brainstorming
description: Use when creating or developing, before writing code or implementation plans - refines rough ideas into fully-formed designs through collaborative questioning, alternative exploration, and incremental validation. Don't use during clear 'mechanical' processes
---

# Brainstorming Ideas Into Designs

## Overview

Help turn ideas into fully formed designs and specs through natural collaborative dialogue.

**🚨 CRITICAL REQUIREMENT**: Create the plan file `.claude/docs/plans/<topic>-design.md` BEFORE asking questions, then update it incrementally after EACH answer. Do NOT wait until the end to write everything at once.

Start by understanding the current project context, then ask multiple related questions together (up to 4 at once) to efficiently refine the idea. Once you understand what you're building, present the design in small sections (200-300 words), checking after each section whether it looks right so far.

## The Process

**CRITICAL FIRST STEP - Create Plan File Immediately:**

- **Before asking ANY questions, create `.claude/docs/plans/<topic>-design.md` using Write tool**
- Write initial context: problem statement, initial understanding (even if incomplete)
- Structure: Use headings like "Goals", "Requirements", "Architecture", "Open Questions"
- This file is your working document - update it continuously throughout brainstorming
- **DO NOT wait until the end** - write first, refine continuously

**Understanding the idea:**

- Check out the current project state first (files, docs, recent commits)
- **After EACH round of answers, immediately update the plan file using Edit tool**
- Ask multiple related questions together using the AskUserQuestion tool (up to 4 per call)
- **CRITICAL**: Always use the AskUserQuestion tool for ALL questions - NEVER output questions as plain text
- Prefer multiple choice questions when possible (the tool supports multiSelect when needed)
- Group related questions together for efficiency (e.g., scope + timeline + constraints in one call)
- Focus on understanding: purpose, constraints, success criteria
- After each round of answers, ask follow-up questions to drill deeper into areas that need clarification
- **Pattern: Question → Answer → Update plan file → Next question**

**Exploring approaches:**

- Propose 2-3 different approaches with trade-offs
- Present options conversationally with your recommendation and reasoning
- Lead with your recommended option and explain why

**Presenting the design:**

- Once you believe you understand what you're building, present the design
- Break it into sections of 200-300 words
- Use AskUserQuestion tool after each section to confirm it looks right (e.g., "Does this architecture look right?")
- Cover: architecture, components, data flow, error handling, testing
- Be ready to go back and clarify if something doesn't make sense

## Design vs Implementation Boundaries

**THIS SKILL IS FOR DESIGN ONLY.** If you find yourself writing implementation details, STOP - you're crossing into writing-plans territory.

**DESIGN (this skill) - High-level, conceptual:**
- Architecture decisions and trade-offs (e.g., "Use React Query for server state")
- Component responsibilities (conceptual) (e.g., "FilterSidebar handles job title filtering")
- Data flow approach (e.g., "Server actions → React Query → UI")
- Technology choices with reasoning (e.g., "shadcn/ui for component library")
- Open questions and assumptions

**IMPLEMENTATION (writing-plans skill) - Detailed, executable:**
- Exact file paths (e.g., "src/app/(protected)/training-videos/page.tsx")
- Numbered implementation phases/steps (e.g., "Phase 1: Sidebar Setup")
- "Files to modify" and "Files to create" lists
- Complete code examples and snippets
- Git commit instructions
- Task breakdown with dependencies

**Red Flags - STOP Immediately:**
- Writing "Phase 1: Setup", "Phase 2: Components" → That's writing-plans
- Listing "Files to modify: src/exact/path.tsx" → That's writing-plans
- Creating "File Change Summary" section → That's writing-plans
- Writing "Implementation Plan" header → That's writing-plans
- Providing exact directory structures with file paths → That's writing-plans

**If you catch yourself doing any of the above, immediately:**
1. Delete the implementation content
2. Ask user if ready to transition to writing-plans skill
3. Use writing-plans skill to create proper implementation plan

## After the Design

**Documentation:**

- The plan file `.claude/docs/plans/<topic>-design.md` should already exist and be complete
- **You should have been updating it throughout the entire brainstorming process**
- If you haven't been updating it incrementally, you made a mistake - fix it now
- Final pass: Review for clarity, completeness, and consistency
- Use elements-of-style:writing-clearly-and-concisely skill if available for polish

**Incremental Writing Pattern (THE CORRECT WAY):**

```
WRONG ❌:
1. Ask all questions
2. Get all answers
3. Write entire plan at the end

CORRECT ✅:
1. Write initial plan file with problem statement
2. Ask question batch 1
3. Immediately update plan file with answers
4. Ask question batch 2
5. Immediately update plan file with answers
6. Present design section by section
7. Update plan file with any refinements
8. Final review and polish
```

Example workflow:

1. **Start**: Write `.claude/docs/plans/2025-11-05-pcc-sync-design.md` with initial understanding
2. **Question 1**: Ask about goals → User answers → Edit plan file "Goals" section
3. **Question 2**: Ask about technical constraints → User answers → Edit plan file "Requirements" section
4. **Question 3**: Ask about data types → User answers → Edit plan file "Data Types" section
5. **Design**: Present architecture → User approves → Edit plan file "Architecture" section
6. **Refinement**: User asks about error handling → Edit plan file to add "Error Handling" section
7. **Complete**: Plan file reflects entire conversation

The plan file is your **working document**, not a final deliverable to write at the end

**Implementation (if continuing):**

- Use AskUserQuestion tool: "Ready to set up for implementation?" with options: ["Yes, create implementation plan", "No, refine design more", "No, just save the design"]
- **MANDATORY NEXT STEP if user chooses "Yes":** Use writing-plans skill to create detailed implementation plan

## Key Principles

- **Use AskUserQuestion tool** - ALWAYS use the tool for questions, never plain text
- **Ask multiple questions** - Group related questions together (up to 4) for efficiency
- **Multiple choice preferred** - The tool makes it easy for users to select from options
- **YAGNI ruthlessly** - Remove unnecessary features from all designs
- **Explore alternatives** - Always propose 2-3 approaches before settling
- **Incremental validation** - Present design in sections, validate each with AskUserQuestion
- **Be flexible** - Go back and clarify when something doesn't make sense
