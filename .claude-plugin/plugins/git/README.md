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

### create-pr

Create or update PR with comprehensive descriptions and meaningful commits.

**When to use:** Creating or updating pull requests with comprehensive descriptions

**Triggers:** PR creation, feature complete, ready to merge

**Key Features:**
- Branch management and switching
- Conventional commit messages
- Update comment templates
- PR description generation

### draft-pr

Create or update draft PR without code review for work-in-progress.

**When to use:** Creating work-in-progress PRs without review

**Triggers:** WIP changes, early feedback needed, progressive development

**Key Features:**
- Draft PR management
- Update comment templates
- No automatic reviews
- Ready for review workflow

### review-pr

Review pull request with comprehensive code analysis and constructive feedback.

**When to use:** Reviewing pull requests with comprehensive code analysis

**Triggers:** PR needs review, code quality check, post-merge review

**Key Features:**
- Full or incremental review options
- Severity-based issue classification
- Review checklist and principles
- GitHub review integration
- Structured review templates

## Workflow Examples

### Creating a PR

```bash
# 1. Make changes on feature branch
# 2. Use command
create-pr
# 3. Automatically:
#    - Stages all changes
#    - Creates meaningful commit
#    - Pushes to remote
#    - Creates PR with description
```

### Reviewing a PR

```bash
# 1. Identify PR to review
# 2. Use command
review-pr
# 3. Choose review type:
#    - Full review of entire PR
#    - Incremental review of latest changes
# 4. Review posts with:
#    - Issue classification by severity
#    - Constructive feedback
#    - GitHub status update
```

### Creating a Draft PR

```bash
# 1. Make WIP changes
# 2. Use command
draft-pr
# 3. Automatically:
#    - Stages changes
#    - Commits with conventional message
#    - Creates draft PR
#    - No review performed
```

### Updating Existing PR

```bash
# 1. Make additional changes
# 2. Use same command
create-pr  # or draft-pr
# 3. Automatically:
#    - Commits new changes
#    - Pushes to existing PR
#    - Adds update comment
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
create-pr
```

### Bug Fix

```bash
# 1. Debug issue
/debug:debug

# 2. Fix bug
# ... apply fix ...

# 3. Create PR
create-pr
```

### Progressive Development

```bash
# 1. Start with draft
draft-pr

# 2. Keep updating
# ... make changes ...
draft-pr  # adds update

# 3. Mark ready
gh pr ready

# 4. Request review
review-pr
```

### Code Review Workflow

```bash
# 1. Find PR to review
gh pr list

# 2. Review the PR
review-pr

# 3. Follow up on changes
# ... after author updates ...
review-pr  # incremental review
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