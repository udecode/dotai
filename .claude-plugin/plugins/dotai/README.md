# Docs Plugin

Complete development toolkit for software projects. Combines documentation generation (PRDs, design docs, tech stack) with development workflows (debugging, PRs, planning).

## Features

### 📝 Product Requirements Documents (PRDs)

- **Quick PRD generation** - For simple, well-defined features
- **Interactive PRD creation** - With clarifying questions for complex features
- **PRD parsing** - Convert PRDs into actionable implementation checklists

### 🎨 Design Documentation

- **App design generation** - Comprehensive application design documents
- **Design updates** - Keep design docs in sync with codebase evolution

### 🔧 Technical Documentation

- **Tech stack generation** - Document your entire technical stack
- **Stack updates** - Track dependency changes and technical evolution

### ✂️ Code Snippets

- **Snippet generation** - Create reusable code templates from examples
- **Template variables** - Support for placeholder customization

### 📋 Cursor Rules

- **Rule creation** - Generate Cursor rule files with proper structure
- **Rule updates** - Maintain rules based on codebase evolution

### 📁 Project Structure

- **Feature documentation** - Comprehensive feature docs with code exploration
- **Structure updates** - Keep project structure documentation current

### 🐛 Debugging & Error Fixing

- **Advanced debugging** - Systematic bug investigation with logging
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

### PRD Commands

#### `/create-prd`

Generate a PRD quickly without questions for simple, well-defined features.

```
/create-prd user profile page with avatar upload
```

#### `/create-prd-interactive`

Generate a comprehensive PRD with interactive Q&A for complex features.

```
/create-prd-interactive user authentication system
```

#### `/parse-prd`

Convert a PRD into a structured implementation checklist with organized phases, task groups, and checkboxes.

```
/parse-prd user-authentication
```

Creates `.claude/docs/checklist-[feature-name].md`

### Design Documentation Commands

#### `/create-app-design`

Generate a comprehensive Application Design Document with interactive Q&A, project stage assessment, and automatic `CLAUDE.md` updates.

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

### Snippet Commands

#### `/create-snippet`

Generate a snippet template with instructions, placeholder variables, and validation requirements from selected code.

```
/create-snippet
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

#### `/update-project-structure`

Update project structure documentation by running the tree script.

```
/update-project-structure
```

### Debugging Commands

#### `/debug`

Systematic debugging workflow with comprehensive logging.

```
/debug User login failing with 401 error
```

**Workflow:** Reflects on possible sources → Distills to likely causes → Adds logs → Analyzes → Implements fix

#### `/fix`

Quickly fix errors visible in bash output.

```
/fix
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

#### `/c`

Quick command to start log monitoring.

```
/c
```

**Runs:** `pnpm app:log`, `pnpm backend:log`, `pnpm typecheck:watch`

## Documentation Workflow

```bash
# 1. Project Setup
/create-app-design
/create-tech-stack

# 2. Create Features
/create-prd-interactive "new feature name"
/parse-prd new-feature

# 3. Update Docs
/update-app-design
/update-tech-stack
```

**Output:** `.cursor/rules/` contains app-design-document.mdc, tech-stack.mdc, prd-[name].md, checklist-[name].md

## Best Practices

- Use `/create-prd` for simple features, `/create-prd-interactive` for complex ones
- Always parse PRDs into checklists before implementation
- Create design docs early, update after major changes
- Generate tech stack docs after initial setup, update when dependencies change
- Keep design docs business-focused (avoid implementation details)
- Document the "why" not just the "what"

## Troubleshooting

**Commands Not Appearing:** Restart Claude Code, verify with `/help`

## Development Workflow

### Typical Flow

1. **Start session:** `/c`
2. **Plan work:** `/how`
3. **Debug if needed:** `/debug`
4. **Fix errors:** `/fix`
5. **Create PR:** `/pr`

## Version History

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
