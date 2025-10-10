# Context-Aware AGENTS.md Generation

Regenerate `AGENTS.md` with task-specific rules to reduce token usage and improve AI agent focus.

## Before Running the Command

**CRITICAL: Analyze the user's task to determine which rules are relevant.**

### Step 1: Understand the Task

Carefully read the user's prompt and identify:

- What files will be modified? (e.g., `src/components/...`, `api/...`, `lib/...`)
- What technologies are involved? (e.g., React, TypeScript, database, API)
- What features are being implemented? (e.g., authentication, UI components, API endpoints)

### Step 2: Match Rules to Task

Review @.claude/context.json to find relevant rules based on:

1. **File globs**: Match the files you'll be working with
   - Example: Working on `src/components/ui/button.tsx` → matches `react` (globs: `*.tsx`)
   - Example: Working on `api/users.ts` → matches `api` (globs: `api/**`)

2. **Description keywords**: Match the task description
   - Example: "implement authentication" → look for rules mentioning "auth", "security", "session"
   - Example: "optimize database queries" → look for rules mentioning "performance", "optimize", "database"

3. **Always-apply rules**: Automatically included, you don't need to include them manually.

### Step 3: Select Minimal Set

**Only include rules you will actually need.** More rules = larger context = slower responses.

**Good selection principles:**

- ✅ **Prefer presets** when all preset rules are needed (e.g., `pnpm ctx frontend` instead of listing all individual rules)
- ✅ Include rules matching file globs
- ✅ Include rules with relevant technology/patterns
- ⚠️ Consider dependent rules (e.g., if using a database ORM, include related database rules)
- ❌ Exclude unrelated rules (e.g., don't include `backend` rules if only working on frontend)
- ❌ Don't list individual rules when a preset covers them all

## Usage

```bash
pnpm ctx <rule1> <rule2> <rule3> ...
```

**Parameters:** Space-separated rule names from `.claude/context.json` (use `--config <path>` to specify a different config file)

### Examples

**Example 1: "I'll work on user authentication"**

```bash
# Analysis: Working on authentication in backend
# Files: api/auth.ts, lib/session.ts
# Relevant rules: api (core patterns), auth (specific patterns)
pnpm ctx api auth
```

**Example 2: "Build a React modal component"**

```bash
# Analysis: Building UI component with React
# Files: src/components/modals/ExampleModal.tsx
# Relevant rules: All UI rules needed (react, styling, state management)
# ✅ PREFER: Use preset when all rules are covered
pnpm ctx ui
```

**Example 3: "Optimize database search queries"**

```bash
# Analysis: Backend optimization with search functionality
# Files: lib/search.ts, db/schema.ts
# Relevant rules: database (core), search (search patterns), performance (optimization)
pnpm ctx database search performance
```

**Example 4: "Add payment integration"**

```bash
# Analysis: Frontend + backend for payments
# Files: src/app/billing/page.tsx, api/payments.ts
# Relevant rules: Frontend (UI + API client) + specific payment patterns
# ✅ PREFER: Use frontend preset, add only the specific additional rule
pnpm ctx frontend payments
```

**Example 5: "Update database schema with new relationships"**

```bash
# Analysis: Schema design with entity relationships
# Files: db/schema.ts
# Relevant rules: database (core), relations (relationships)
pnpm ctx database relations
```

## Configuration Structure

Rules are defined in `.claude/context.json` with:

- `name`: Identifier for the rule (use this in command)
- `path`: File location
- `description`: What the rule covers
- `globs`: File patterns this rule applies to (e.g., `*.tsx`, `api/**`)
- `alwaysApply`: If true, automatically included in every context

## Decision Tree

```
User task → Analyze files/tech → Review .claude/context.json
                                           ↓
                                  Match globs + descriptions
                                           ↓
                                  Select minimal rule set
                                           ↓
                                  pnpm ctx <rule1> <rule2> ...
                                           ↓
                                  AGENTS.md regenerated with focused context
```

## Benefits

✅ **Faster Responses** - Smaller context = faster AI processing
✅ **Better Focus** - AI only sees relevant patterns
✅ **Token Efficiency** - Include only necessary rules
✅ **Task-Specific** - Custom context for each task
✅ **Always Include Essentials** - Global docs auto-included (`alwaysApply: true`)

## Notes

- `AGENTS.md` is auto-generated (don't edit directly)
- Always-apply rules (with `alwaysApply: true`) are automatically included
- Rules are centralized in `.claude/context.json`
- After running, the context is ready for the current task
