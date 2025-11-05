# Test Plugin

> Test-driven development workflow for writing tests before implementation

## Overview

The Test plugin provides a disciplined TDD approach for implementing complex logic with test coverage. It enforces the red-green-refactor cycle, ensuring tests actually verify behavior by requiring failure first.

## Features

### 🔴🟢♻️ Red-Green-Refactor Cycle

Classic TDD workflow:

- **Red** - Write failing test first
- **Green** - Write minimal code to pass
- **Refactor** - Improve code while keeping tests green

### 🎯 Smart Test Strategy

Automatic decision on when to test:

- **Write tests for:** Complex algorithms, business logic, data transformations
- **Skip tests for:** UI components, simple CRUD, straightforward mappings
- **Verification alternatives:** Typecheck, lint, manual testing

## Installation

```bash
/plugin install test@dotai
# restart claude
```

## Commands

### /test:tdd

Invoke test-driven development workflow.

```bash
/test:tdd
```

Enforces writing tests before implementation for complex logic.

## Skills

### Test-Driven Development

**When to use:**
- User explicitly requests tests
- Complex logic where bugs are likely
- Business logic with edge cases
- Data transformations
- Critical paths that could break silently

**When NOT to use:**
- ❌ UI components (React components, hooks)
- ❌ Simple CRUD operations
- ❌ Straightforward mappings
- ❌ Configuration files
- ❌ Throwaway prototypes

## The TDD Process

### 1. Write Failing Test

```typescript
test('calculates compound interest correctly', () => {
  const result = calculateCompoundInterest(1000, 0.05, 12, 2);
  expect(result).toBe(1104.94);
});
```

Run test → See failure → Confirms test is valid

### 2. Write Minimal Code

```typescript
function calculateCompoundInterest(principal, rate, n, t) {
  return principal * Math.pow(1 + rate / n, n * t);
}
```

Just enough to make test pass, no more.

### 3. Run Test Again

```bash
npm test
```

Test passes → Implementation correct

### 4. Refactor (Optional)

Improve code while keeping tests green:
- Extract constants
- Improve names
- Simplify logic
- Add edge case handling

### 5. Commit

```bash
git add .
git commit -m "feat: implement compound interest calculation with tests"
```

## Test Types

**Only write deterministic unit tests:**
- ✅ Pure functions
- ✅ Synchronous logic
- ✅ Data transformations
- ✅ Algorithms

**Avoid:**
- ❌ Integration tests
- ❌ End-to-end tests
- ❌ Complex mocking
- ❌ Async complexity
- ❌ Database tests

## Verification Without Tests

When skipping tests (UI, simple CRUD):

```bash
# TypeScript verification
npm run typecheck

# Linting
npm run lint

# Manual testing for UI
# Code review for confidence
```

## Core Principle

> If you didn't watch the test fail, you don't know if it tests the right thing.

**The rule:** NO CODE WITHOUT A FAILING TEST FIRST (when using TDD)

## Common Mistakes

❌ **Writing implementation first**
✅ Test first, always

❌ **Not watching test fail**
✅ Red phase is mandatory

❌ **Over-engineering initial solution**
✅ Minimal code to pass

❌ **Testing implementation details**
✅ Test behavior, not internals

❌ **Writing tests for everything**
✅ Only complex logic needs tests

## Integration

Works seamlessly with other dotai plugins:

- **debug** - Use systematic debugging when tests fail
- **plan** - Include TDD approach in implementation plans
- **agents** - Dispatch agents to write tests for different modules

## Best Practices

1. **Test behavior, not implementation** - Black box testing
2. **One assertion per test** - Clear failure messages
3. **Descriptive test names** - Document intent
4. **AAA pattern** - Arrange, Act, Assert
5. **Keep tests simple** - No logic in tests
6. **Fast tests only** - Milliseconds not seconds

## Examples

### Complex Algorithm (Needs Test)

```typescript
// 1. Write failing test
test('fibonacci returns correct sequence', () => {
  expect(fibonacci(0)).toBe(0);
  expect(fibonacci(1)).toBe(1);
  expect(fibonacci(5)).toBe(5);
  expect(fibonacci(10)).toBe(55);
});

// 2. See test fail
// Error: fibonacci is not defined

// 3. Write minimal implementation
function fibonacci(n: number): number {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

// 4. Test passes ✅
```

### Simple CRUD (Skip Test)

```typescript
// No test needed - verify with typecheck
async function getUser(id: string) {
  return db.users.findById(id);
}

// Verification: npm run typecheck
```

## Real-World Impact

- **Bug prevention:** Catches issues before deployment
- **Documentation:** Tests document expected behavior
- **Refactoring confidence:** Change code without fear
- **Design improvement:** TDD drives better API design
- **Time saved:** Less debugging, fewer regressions