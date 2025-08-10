# Hallucination Hunter

Ruthlessly hunt down AI-generated code that doesn't actually work - the bullshit implementations, fake functionality, and hallucinated features that look plausible but fail in reality.

## Description

Uses the existing code-critic persona (Linus Torvalds style) to intelligently analyze code for hallucinations that require semantic understanding to detect. Optional technical debt context provides additional intel but intelligence does the heavy lifting.

**Hybrid Intelligence Pattern**: CLI provides supporting context, AI subagent performs intelligent hallucination detection.

## What We Hunt

- **Fake implementations** - Functions that claim to do X but actually do Y (or nothing)
- **Non-existent APIs** - Code using libraries/methods that don't exist
- **Impossible logic** - Code that looks right but can't possibly work
- **Placeholder behavior** - Functions that return fake data or throw "not implemented"
- **Copy-paste artifacts** - Code copied from different contexts that doesn't fit
- **Overcomplicated bullshit** - Unnecessarily complex implementations hiding bugs
- **Missing error handling** - Code that ignores failure cases entirely

## Target Patterns (Intelligence Required)

- Functions with names that don't match their behavior
- API calls that look correct but use wrong parameters
- Logic flows that seem reasonable but have fundamental flaws
- Data transformations that lose critical information
- Error handling that catches everything and does nothing
- Configurations that reference non-existent resources

## Usage

```bash
/fb:hallucination-hunter
```

**What happens:**

1. Gathers technical debt context as supporting intel
2. Spawns code-critic subagent for intelligent analysis
3. Provides ruthless assessment of hallucinated code
4. Explains findings and asks for implementation confirmation

---

## Gather Supporting Context

The technical debt scan provides additional intel that may reveal suspicious areas worth investigating for hallucinations.

!`flashback debt-hunter --context`

## Spawn Intelligent Hallucination Hunter

Now launching code-critic subagent to hunt for AI-generated bullshit that actually doesn't work...

!`CLAUDE_USE_SUBAGENT=true Task "{\"description\": \"Hunt AI hallucinations\", \"prompt\": \"You are the code-critic persona with Linus Torvalds personality from .claude/flashback/personas/code-critic.md. Your mission: ruthlessly hunt down AI-generated code that doesn't actually work.\\n\\nFirst, read your persona definition from .claude/flashback/personas/code-critic.md to understand your identity, principles, and communication style.\\n\\nFocus on SEMANTIC HALLUCINATIONS that require intelligence to detect:\\n- Functions that claim to do X but actually do Y (or nothing)\\n- API calls that look plausible but use non-existent methods\\n- Logic that seems reasonable but has fundamental flaws\\n- Fake implementations hiding behind complex-looking code\\n- Copy-paste code that doesn't fit the actual context\\n- Missing error handling in critical paths\\n\\nThe provided technical debt context gives you ADDITIONAL INTEL about suspicious areas, but don't limit yourself to those patterns. Use your intelligence to examine the codebase for semantic correctness and identify code that looks like it works but doesn't.\\n\\nBe ruthlessly direct about what's broken and why. Provide specific file locations and concrete examples of the hallucinated behavior. Focus on code that will definitely fail in production.\\n\\nOutput your findings in the standard code-critic format with critical issues, quality problems, and specific fixes.\", \"subagent_type\": \"general-purpose\"}\"`

## Analysis & Implementation Planning

After receiving the code-critic analysis, I will:

1. **Summarize the findings** - Explain what hallucinations were discovered
2. **Prioritize critical issues** - Focus on code that will definitely break in production
3. **Explain the implementation approach** - How we'll systematically fix the identified hallucinations

Then ask: **"How will you go about implementing a fix for this?"** and wait for your confirmation before continuing with any code changes.

**Note**: This is not just another technical debt scan - we're hunting for AI-generated code that fundamentally doesn't work as intended, which requires semantic understanding that only intelligence can provide.
