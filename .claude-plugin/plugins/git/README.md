# Git Plugin

> Git and GitHub workflow automation for streamlined PR management

## Overview

The Git plugin provides comprehensive tools for managing Git workflows and GitHub pull requests. It streamlines the PR creation process, code review workflows, draft PR management, and standardized commit practices.

## Features

### 🔀 Pull Request Creation

Full PR workflow with comprehensive descriptions:

- **Branch management** - Conventional branch naming and switching
- **Smart staging** - Analyze and stage changes appropriately
- **Meaningful commits** - Conventional commit messages
- **Update comments** - Preserve original PR description
- **Ready for review** - PRs created in review-ready state

### 📝 Draft PR Management

Efficient draft PR workflow without reviews:

- **Work-in-progress** - Create drafts for ongoing work
- **Progressive updates** - Keep pushing to the same draft
- **Ready for review** - Mark as ready when complete
- **No auto-review** - Reviews only when requested

### 🔍 Code Review

Comprehensive PR review capabilities:

- **Full or incremental** - Review entire PR or just latest changes
- **Severity ratings** - Critical, Major, Minor, Suggestion classifications
- **Constructive feedback** - Specific, actionable recommendations
- **Review templates** - Structured review comments with clear formatting
- **GitHub integration** - Approve, request changes, or comment only

## Installation

```bash
/plugin install git@dotai
# restart claude
```

## Skills

### pr

Unified PR management with three core operations: create regular PRs, create draft PRs, and review PRs.

**When to use:** Any PR workflow - creating, drafting, or reviewing pull requests

**Triggers:** "create a PR", "make a draft PR", "review PR", or any PR-related task

**Operations:**

1. **Create PR** - Regular PRs with comprehensive descriptions
   - Branch management and switching
   - Conventional commit messages
   - Update comment templates
   - PR description generation

2. **Draft PR** - Work-in-progress PRs without automatic review
   - Draft PR management
   - Progressive updates
   - No automatic reviews
   - Ready for review workflow

3. **Review PR** - Code analysis with severity ratings
   - Quick reviews for simple feedback
   - Comprehensive reviews via `/workflows:review` (multi-agent analysis)
   - Severity-based classifications
   - GitHub review integration

**Architecture:**
- Core workflow in `SKILL.md` with navigation
- Detailed instructions in `references/` (create.md, draft.md, review.md)
- Progressive disclosure for token efficiency

## Workflow Examples

### Creating a PR

```bash
# Simply ask Claude
"Create a PR for these changes"

# Claude automatically:
# - Determines it's a regular PR (not draft)
# - Loads references/create.md
# - Stages all changes
# - Creates meaningful commit
# - Pushes to remote
# - Creates PR with description
```

### Reviewing a PR

```bash
# For quick review
"Review PR #123"

# For comprehensive review
"Do a thorough review of PR #123"
# → Delegates to /workflows:review for multi-agent analysis

# Claude automatically:
# - Loads references/review.md
# - Gathers PR context
# - Analyzes changes
# - Posts structured review
```

### Creating a Draft PR

```bash
# Simply ask Claude
"Create a draft PR for this WIP"

# Claude automatically:
# - Determines it's a draft PR
# - Loads references/draft.md
# - Stages changes
# - Commits with conventional message
# - Creates draft PR
# - No review performed
```

### Updating Existing PR

```bash
# Make changes, then:
"Update the PR"

# Claude automatically:
# - Detects existing PR
# - Commits new changes
# - Pushes to existing branch
# - Adds update comment (preserves description)
```

## Commit Message Conventions

The plugin follows conventional commit format:

- `feat:` - New features
- `fix:` - Bug fixes
- `refactor:` - Code refactoring
- `docs:` - Documentation changes
- `test:` - Test additions/modifications
- `chore:` - Maintenance tasks
- `style:` - Formatting changes

## Branch Naming Conventions

- `feature/description` - New features
- `fix/bug-description` - Bug fixes
- `refactor/component-name` - Code refactoring
- `docs/update-readme` - Documentation updates
- `test/add-unit-tests` - Test additions

## Review Principles

When using review-pr, reviews follow these principles:

1. **Pull existing comments** - Don't repeat feedback
2. **Focus on new changes** - Incremental reviews when appropriate
3. **Be constructive** - Specific, actionable feedback
4. **Rate severity** - Critical, Major, Minor, Suggestion
5. **Professional emoji** - ✅ ⚠️ 🚨 💡 used sparingly

## Update Comment Templates

Both commands use update comments to preserve original PR descriptions:

### PR Update
- Changes made
- Impact analysis
- Testing instructions
- Next steps

### Critical Fix
- Issue addressed
- Solution approach
- Verification steps
- Risk assessment

### Feature Enhancement
- Enhancement details
- Technical implementation
- User experience impact
- Testing strategy

## Best Practices

1. **Single commit per push** - Due to Husky hooks
2. **Stage all changes** - Use `git add .`
3. **Preserve PR descriptions** - Use update comments
4. **Clear commit messages** - Follow conventions
5. **Branch naming** - Use standard prefixes
6. **Draft for WIP** - Use draft-pr for ongoing work
7. **Ready for review** - Convert draft when complete
8. **Separate reviews** - Use review-pr for code review

## GitHub CLI Integration

The plugin uses GitHub CLI (`gh`) for all GitHub operations:

```bash
# Required: GitHub CLI installed and authenticated
gh auth status  # Check authentication
```

## Integration

Works seamlessly with other dotai plugins:

- **dotai** - Use after implementing features
- **debug** - Fix issues before creating PRs
- **test** - Ensure tests pass before PR

## Common Workflows

### Feature Development

```bash
# 1. Implement feature
# ... make changes ...

# 2. Create PR
"Create a PR"
```

### Bug Fix

```bash
# 1. Debug issue
/debug

# 2. Fix bug
# ... apply fix ...

# 3. Create PR
"Create a PR for the bug fix"
```

### Progressive Development

```bash
# 1. Start with draft
"Create a draft PR"

# 2. Keep updating
# ... make changes ...
"Update the draft PR"

# 3. Mark ready
gh pr ready

# 4. Request comprehensive review
"Do a thorough review"  # → uses /workflows:review
```

### Code Review Workflow

```bash
# 1. Find PR to review
gh pr list

# 2. Quick review
"Review PR #123"

# 3. Or comprehensive review
"Thoroughly review PR #123"  # → uses /workflows:review

# 4. Follow up on changes
"Review the latest changes on PR #123"  # incremental
```

## Troubleshooting

### PR Not Creating

- Check branch: Not on main/master
- Check auth: `gh auth status`
- Check remote: `git remote -v`

### Review Not Posting

- Check PR exists: `gh pr view <number>`
- Verify GitHub auth: `gh auth status`
- Check PR permissions

### Update Comment Missing

- Check PR number: `gh pr view`
- Verify changes pushed
- Check comment permissions