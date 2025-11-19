---
name: writing-plans
description: Use when design is complete and you need detailed implementation tasks for engineers with zero codebase context - creates comprehensive implementation plans with exact file paths, complete code examples, and verification steps assuming engineer has minimal domain knowledge
---

# Writing Plans

## Overview

Write comprehensive implementation plans assuming the engineer has zero context for our codebase and questionable taste. Document everything they need to know: which files to touch for each task, code, testing, docs they might need to check, how to test it. Give them the whole plan as bite-sized tasks. DRY. YAGNI. TDD. Frequent commits.

Assume they are a skilled developer, but know almost nothing about our toolset or problem domain. Assume they don't know good test design very well.

**Announce at start:** "I'm using the writing-plans skill to create the implementation plan."

**Save plans to:** `.claude/docs/plans/<feature-name>-plan.md`

**Testing Strategy:** Auto-decide whether unit tests are needed based on complexity:

- **Include tests for**: Complex algorithms, business logic, data transformations where bugs are likely
- **Skip tests for**: Simple CRUD, UI components, straightforward mappings, anything you're 100% certain is bug-free
- **Test type**: Only deterministic unit tests - no integration tests, no complex mocking, no async complexity
- Tests should verify logic, not implementation details

## Bite-Sized Task Granularity

**Each step is one action (2-5 minutes):**

**If tests are included (for complex behavior):**

- "Write the failing test" - step
- "Run it to make sure it fails" - step
- "Implement the minimal code to make the test pass" - step
- "Run the tests and make sure they pass" - step
- "Commit" - step

**If no tests (for simple changes):**

- "Implement the code" - step
- "Verify with typecheck/lint" - step
- "Commit" - step

## Plan Document Header

**Every plan MUST start with this header:**

```markdown
# [Feature Name] Implementation Plan

**Goal:** [One sentence describing what this builds]

**Architecture:** [2-3 sentences about approach]

**Tech Stack:** [Key technologies/libraries]

**Testing Approach:** [If tests included: "TDD with deterministic unit tests for complex logic (Tasks X, Y, Z)" | If no tests: "Code review and typecheck verification - logic is straightforward and bug-free"]

---
```

## Task Structure

### With Tests (Complex Behavior)

````markdown
### Task N: [Component Name]

**Files:**

- Create: `exact/path/to/file.ts`
- Modify: `exact/path/to/existing.ts:123-145`
- Test: `tests/exact/path/to/test.spec.ts`

**Step 1: Write the failing test**

```typescript
describe('specific behavior', () => {
  it('should return expected result', () => {
    const result = function(input);
    expect(result).toBe(expected);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- test.spec.ts`
Expected: FAIL with "function is not defined"

**Step 3: Write minimal implementation**

```typescript
export function function(input: InputType): ReturnType {
  return expected;
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test -- test.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/path/test.spec.ts src/path/file.ts
git commit -m "feat: add specific feature"
```
````

### Without Tests (Simple Changes)

````markdown
### Task N: [Component Name]

**Files:**

- Create: `exact/path/to/file.ts`
- Modify: `exact/path/to/existing.ts:123-145`

**Step 1: Implement the code**

```typescript
export function function(input: InputType): ReturnType {
  return expected;
}
```

**Step 2: Verify with typecheck**

Run: `npm run typecheck`
Expected: No errors

**Step 3: Verify with lint**

Run: `npm run lint`
Expected: No errors

**Step 4: Commit**

```bash
git add src/path/file.ts
git commit -m "feat: add specific feature"
```
````

## Remember

- Auto-decide on unit tests - only for complex logic where bugs are likely
- Only deterministic unit tests - no integration/async/complex mocking
- Exact file paths always
- Complete code in plan (not "add validation")
- Exact commands with expected output
- Reference relevant skills with @ syntax
- DRY, YAGNI, frequent commits
- TypeScript syntax for all examples

## Git Commit Guidance

**IMPORTANT: Plans include commit steps, but executing-plans will handle commit approval.**

**During Execution (not plan writing):**

- **NEVER auto-commit** - Even if plan includes commit commands, agent must ask user first
- **When to suggest commits:**
  - After completing batch where agent verified tests pass
  - Leverage existing pause points (batch completion, not extra pauses)
  - Only when agent can verify the work (tests, typecheck, lint)
- **When NOT to suggest commits:**
  - Tests are user's responsibility (agent can't verify)
  - No natural pause point exists
  - Manual verification required

**In this skill (plan writing):**

- Include commit steps in tasks as part of the plan
- Commit commands show what should be committed, not when
- executing-plans skill handles actual commit timing and user approval

## Execution Handoff

After saving the plan, offer execution choice:

**"Plan complete and saved to `.claude/docs/plans/<filename>.md`. Two execution options:**

**1. This Session (default)** - Execute tasks iteratively in this session, reviewing and adjusting between tasks

**2. Parallel Session** - Open new session with executing-plans skill for batch execution with checkpoints

**Which approach? (Press Enter for option 1)"**

**If This Session (default):**

- Use the superpowers executing-plans skill in this session
- Execute in batches (default: first 3 tasks)
- Review and iterate between batches
- Adjust plan if needed based on learnings

**If Parallel Session chosen:**

- Guide them to open new session
- **REQUIRED SUB-SKILL:** New session uses superpowers executing-plans
- Load the plan file and execute in batches
