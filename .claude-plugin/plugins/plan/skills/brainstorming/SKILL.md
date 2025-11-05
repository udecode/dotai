---
name: brainstorming
description: Use when creating or developing, before writing code or implementation plans - refines rough ideas into fully-formed designs through collaborative questioning, alternative exploration, and incremental validation. Don't use during clear 'mechanical' processes
---

# Brainstorming Ideas Into Designs

## Overview

Help turn ideas into fully formed designs and specs through natural collaborative dialogue.

Start by understanding the current project context, then ask multiple related questions together (up to 4 at once) to efficiently refine the idea. Once you understand what you're building, present the design in small sections (200-300 words), checking after each section whether it looks right so far.

## The Process

**Understanding the idea:**

- Check out the current project state first (files, docs, recent commits)
- Ask multiple related questions together using the AskUserQuestion tool (up to 4 per call)
- **CRITICAL**: Always use the AskUserQuestion tool for ALL questions - NEVER output questions as plain text
- Prefer multiple choice questions when possible (the tool supports multiSelect when needed)
- Group related questions together for efficiency (e.g., scope + timeline + constraints in one call)
- Focus on understanding: purpose, constraints, success criteria
- After each round of answers, ask follow-up questions to drill deeper into areas that need clarification

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

## After the Design

**Documentation:**

- Write the validated design to `.claude/docs/plans/YYYY-MM-DD-<topic>-design.md`
- **CRITICAL: When refining designs, ALWAYS UPDATE THE PLAN FILE DIRECTLY using Edit tool**
- Never just output refinements in chat - the plan file is the single source of truth
- Each refinement iteration should be reflected in the plan file immediately
- Use elements-of-style:writing-clearly-and-concisely skill if available

**Plan File Updates During Brainstorming:**

Example workflow:

1. Initial design → Write to `.claude/docs/plans/YYYY-MM-DD-<topic>-design.md`
2. User: "Can we refine the input parameters?"
3. Assistant: Discusses refinements AND uses Edit tool to update the plan file
4. User: "What about error handling?"
5. Assistant: Adds error handling section using Edit tool on the existing plan file

The plan file should always reflect the current state of the design

**Implementation (if continuing):**

- Use AskUserQuestion tool: "Ready to set up for implementation?" with options: ["Yes, create implementation plan", "No, refine design more", "No, just save the design"]
- Use writing-plan skill (if available) to create detailed implementation plan if user is ready

## Key Principles

- **Use AskUserQuestion tool** - ALWAYS use the tool for questions, never plain text
- **Ask multiple questions** - Group related questions together (up to 4) for efficiency
- **Multiple choice preferred** - The tool makes it easy for users to select from options
- **YAGNI ruthlessly** - Remove unnecessary features from all designs
- **Explore alternatives** - Always propose 2-3 approaches before settling
- **Incremental validation** - Present design in sections, validate each with AskUserQuestion
- **Be flexible** - Go back and clarify when something doesn't make sense
