# Docs Plugin

Complete development toolkit for software projects. Combines documentation generation (design docs, tech stack) with development workflows (PRs, planning).

## Features

### 🎨 Design Documentation

- **App design generation** - Comprehensive application design documents
- **Design updates** - Keep design docs in sync with codebase evolution

### 🔧 Technical Documentation

- **Tech stack generation** - Document your entire technical stack
- **Stack updates** - Track dependency changes and technical evolution

### 📋 Cursor Rules

- **Rule creation** - Generate Cursor rule files with proper structure
- **Rule updates** - Maintain rules based on codebase evolution

### 📁 Project Structure

- **Feature documentation** - Comprehensive feature docs with code exploration
- **Structure updates** - Keep project structure documentation current

### 🔧 Error Fixing

- **Quick fixes** - Fix errors from bash output

### 🔀 Git & PR Workflows

- **PR creation** - Full pull request workflow with reviews
- **Draft PRs** - Quick draft PR creation without overhead

### 🧠 Planning

- **Implementation planning** - Structured planning before coding
- **Log monitoring** - Quick access to logs

## Installation

Run `/docs:install` to install prerequisites, or manually:

```bash
npx shadcn@latest add https://raw.githubusercontent.com/udecode/dotai/main/registry/main.json
```

## Commands

### Design Documentation Commands

#### `/create-app-design`

Generate a comprehensive Application Design Document with interactive Q&A, project stage assessment.

```
/create-app-design
```

#### `/update-app-design`

Update existing app design document to reflect codebase changes and project evolution.

```
/update-app-design
```

### Tech Stack Commands

#### `/create-tech-stack`

Generate comprehensive technical stack documentation with exact versions, configurations, and architecture patterns.

```
/create-tech-stack
```

#### `/update-tech-stack`

Update tech stack documentation based on dependency changes and technical evolution.

```
/update-tech-stack
```

### Cursor Rules Commands

#### `/create-rule`

Create a new Cursor rule file with proper structure, conventions, and real codebase examples.

```
/create-rule component naming conventions
```

#### `/update-rule`

Update existing Cursor rules based on new patterns or codebase evolution.

```
/update-rule
```

### Project Structure Commands

#### `/create-doc`

Enter "Documentation Mode" to generate comprehensive feature documentation with code exploration and pattern analysis.

```
/create-doc authentication feature
```

### Git & PR Commands

#### `/pr`

Create pull request with full workflow and code review.

```
/pr
```

**Features:** Comprehensive PR description, test plan, code review process, Claude Code attribution

#### `/draft-pr`

Create draft pull requests quickly without review overhead.

```
/draft-pr
```

**Best for:** WIP, quick sharing, early feedback

### Planning Commands

#### `/how`

Implementation planning prompt - align on approach before coding.

```
/how
```

**Prompts for:** Clear understanding, step-by-step plan, file changes, potential issues, success criteria

**Critical:** Waits for approval before implementation

## Documentation Workflow

```bash
# 1. Project Setup
/create-app-design
/create-tech-stack

# 2. Update Docs
/update-app-design
/update-tech-stack
```

**Output:** `.claude/skills/` contains 1-app-design-document.mdc, 2-tech-stack.mdc

## Best Practices

- Create design docs early, update after major changes
- Generate tech stack docs after initial setup, update when dependencies change
- Keep design docs business-focused (avoid implementation details)
- Document the "why" not just the "what"

## Troubleshooting

**Commands Not Appearing:** Restart Claude Code, verify with `/help`

## Version History

### 4.0.0

- Removed ctx plugin in favor of ruler

### 3.0.0

- Moved PRD workflows to separate plugin
- Moved debugging workflows to debug plugin
- Streamlined to core documentation commands
- Focus on design docs, tech stack, and PR workflows

### 2.0.0

- Merged dev plugin into docs
- 19 total commands
- Added debugging workflows
- Added PR creation workflows
- Added planning commands
- Moved context management to ctx plugin

### 1.0.0

- Initial release
- 13 documentation commands
- PRD workflows
- App design and tech stack management
- Cursor rules and snippets

## License

MIT

## Author

zbeyens
