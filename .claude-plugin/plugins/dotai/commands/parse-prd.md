---
allowed-tools: Read, Write, Bash, Glob, Grep, TodoWrite
description: Parse a PRD into a structured implementation checklist
---

# Parse PRD into Implementation Checklist

## Context

- **User Request:** $ARGUMENTS
- **Current directory:** !`pwd`
- **PRD files:** !`ls -la .claude/docs/prd*.md 2>/dev/null || echo "No PRD files found"`

## Goal

Parse a Product Requirements Document (PRD) into atomic, AI-optimized implementation tasks following ai-dev-tasks methodology. Creates actionable tasks with clear deliverables, acceptance criteria, and dependencies.

## CRITICAL: Task Quality Standards

### Atomic Task Requirements

Every task must have:

- **Single Deliverable**: Each task produces one specific, measurable output
- **Clear Acceptance Criteria**: Obvious definition of "done" with verification steps
- **Dependency Clarity**: Explicit dependencies on previous tasks
- **Action-Oriented**: Clear verb + specific outcome (not vague descriptions)
- **Atomic Scope**: Task should be completable in one focused work session

### 🚫 Task Generation Anti-Patterns (NEVER CREATE THESE)

- **No Placeholder Tasks**: Never create tasks like "create placeholder files" or "add TODO comments"
- **No Speculative Tasks**: Tasks must have immediate, clear deliverable value (not "research everything about X")
- **No E2E Test Tasks**: Don't create comprehensive testing tasks for incomplete features
- **No File Explosion Tasks**: Avoid tasks that generate dozens of similar files without purpose
- **No Generic Tasks**: Be specific ("implement user authentication" → "create User model with email/password fields")
- **No Research-Only Tasks**: Keep research focused and actionable with concrete output

### Quality Gates

- Tasks without clear acceptance criteria → REJECT
- Tasks that are too large or complex → SPLIT into smaller atomic tasks
- Tasks with vague deliverables → REWRITE with specific outputs
- Tasks with no dependencies specified → ANALYZE and add dependencies
- Generic/template-only tasks → ENHANCE with actual implementation details

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

### 3. Generate Implementation Tasks

Create atomic tasks with this enhanced format:

```markdown
# [Feature Name] Implementation Tasks

**Source PRD:** `.claude/docs/prd-[feature-name].md`
**Generated:** [Date]
**Status:** Not Started

## Overview

[Brief summary from PRD]

## Progress Dashboard

- **Total Tasks**: 0
- **Completed**: 0
- **In Progress**: 0
- **Progress**: 0% □□□□□□□□□□

## Phase 1: Foundation

### 1.1 Task Category Name

**Deliverable**: Specific output this task produces
**Acceptance Criteria**: How to verify completion
**Dependencies**: None (or list prerequisite tasks)

- [ ] 1.1.1 Atomic subtask with clear deliverable
- [ ] 1.1.2 Next step building on 1.1.1
- [ ] 1.1.3 Verification/testing step

### 1.2 Next Task Category

**Deliverable**: Another specific output
**Acceptance Criteria**: Verification steps
**Dependencies**: 1.1 (Task Category Name)

- [ ] 1.2.1 Specific implementation step
- [ ] 1.2.2 Next atomic step

## Phase 2: Core Features

[Continue with same format...]

## Notes

- Key technical decisions
- Implementation guidance
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

## Enhanced Task Format

Use this structure for maximum AI effectiveness:

```markdown
# [Feature Name] Implementation Tasks

**Source PRD:** `.claude/docs/prd-[feature-name].md`
**Generated:** [Date]
**Total Tasks**: [calculated from all phases]

## 📋 Overview

[Brief description from PRD - what problem this solves and key goals]

## 📊 Progress Dashboard

- **Phase 1 (Foundation)**: 0/X tasks □□□□□
- **Phase 2 (Core Features)**: 0/X tasks □□□□□
- **Phase 3 (Polish)**: 0/X tasks □□□□□
- **Overall Progress**: 0% □□□□□□□□□□

## 🏗️ Phase 1: Foundation

### 1.1 Data Models & Schema

**Deliverable**: Complete data models with validation and relationships
**Acceptance Criteria**:
- All models have proper TypeScript types
- Validation rules defined with Zod schemas
- Relationships correctly configured
**Dependencies**: None

- [ ] 1.1.1 Define User model with email, password, profile fields
- [ ] 1.1.2 Create Zod validation schemas for User model
- [ ] 1.1.3 Set up database migrations for User table
- [ ] 1.1.4 Test model creation and validation

### 1.2 API Routes & Authentication

**Deliverable**: Functional API endpoints with auth middleware
**Acceptance Criteria**:
- Routes respond with correct status codes
- Authentication middleware validates tokens
- Error handling returns meaningful messages
**Dependencies**: 1.1 (Data Models)

- [ ] 1.2.1 Create /api/auth/register endpoint
- [ ] 1.2.2 Create /api/auth/login endpoint with JWT
- [ ] 1.2.3 Implement auth middleware for protected routes
- [ ] 1.2.4 Test authentication flow with Postman/curl

## 🎨 Phase 2: Core Features

### 2.1 UI Components

**Deliverable**: Reusable React components for feature
**Acceptance Criteria**:
- Components render without errors
- Props are properly typed
- Basic styling matches design
**Dependencies**: 1.2 (API Routes)

- [ ] 2.1.1 Create LoginForm component with email/password inputs
- [ ] 2.1.2 Add form validation and error display
- [ ] 2.1.3 Connect form to /api/auth/login endpoint
- [ ] 2.1.4 Handle success/error states with user feedback

### 2.2 Business Logic Integration

**Deliverable**: Complete feature workflow from UI to database
**Acceptance Criteria**:
- User actions trigger correct API calls
- Data persists to database
- UI updates reflect backend state
**Dependencies**: 2.1 (UI Components)

- [ ] 2.2.1 Implement user registration flow
- [ ] 2.2.2 Add session management with cookies/localStorage
- [ ] 2.2.3 Create protected route wrapper component
- [ ] 2.2.4 Test complete user journey from signup to authenticated access

## 🔍 Phase 3: Testing & Polish

### 3.1 Manual Testing & Edge Cases

**Deliverable**: Verified feature works across scenarios
**Acceptance Criteria**:
- All happy paths work
- Edge cases handled gracefully
- Error messages are helpful
**Dependencies**: 2.2 (Business Logic)

- [ ] 3.1.1 Test with invalid credentials
- [ ] 3.1.2 Test with missing required fields
- [ ] 3.1.3 Test session expiration handling
- [ ] 3.1.4 Verify security (SQL injection, XSS prevention)

### 3.2 Documentation

**Deliverable**: Updated documentation for feature
**Acceptance Criteria**:
- Code has inline comments for complex logic
- API endpoints documented
- README updated if needed
**Dependencies**: 3.1 (Testing)

- [ ] 3.2.1 Add JSDoc comments to key functions
- [ ] 3.2.2 Document API endpoints in API.md
- [ ] 3.2.3 Update README with authentication setup

## 📝 Implementation Notes

### Technical Decisions

- Using JWT for stateless authentication
- Zod for runtime validation
- bcrypt for password hashing

### Risks & Mitigations

- **Risk**: Session token exposure → **Mitigation**: Use httpOnly cookies
- **Risk**: Brute force attacks → **Mitigation**: Implement rate limiting

### Future Enhancements

- OAuth integration (Google, GitHub)
- Two-factor authentication
- Password reset flow

---

**Progress Tracking**: Check off tasks as completed. Update dashboard percentages manually or use TodoWrite tool during active sessions.
```

## Task Generation Best Practices

### DO:

- **Create atomic tasks** - Each task = 1 specific deliverable with clear scope
- **Specify acceptance criteria** - Clear "done" definition for every task
- **Map dependencies** - Explicitly state which tasks must complete first
- **Extract all phases** from PRD's Development Roadmap with proper sequencing
- **Be specific** - "Create User model with email/password fields" NOT "set up models"
- **Include verification** - Every task group should end with a test/verification step
- **Preserve PRD context** - Reference technical decisions and rationale from PRD

### DON'T:

- **Create placeholder tasks** - No "add TODO comments" or "create empty files"
- **Make generic tasks** - Avoid vague tasks like "implement authentication" without breakdown
- **Ignore dependencies** - Always specify what must be complete before each task
- **Skip acceptance criteria** - Every task needs a clear definition of "done"
- **Create file explosion** - Don't generate 50 nearly-identical component files
- **Add E2E tests prematurely** - Wait until features are actually implemented
- **Lose PRD context** - Include technical decisions from PRD in notes

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
