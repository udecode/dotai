---
name: changelog
description: Use when updating CHANGELOG.md. Enforces consistent formatting with bolded item names, dash separators, and specific section ordering.
---

# Changelog Writing Style

## Format

Based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## Entry Structure

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added/Changed/Fixed/Removed

- **`item-name`** - Description of change
  - Sub-bullet for additional details
  - Another detail if needed
```

## Rules

1. **Bold item names** - Always wrap in `**\`item-name\`\*\*` (backticks inside bold)
2. **Dash separator** - Use `-` between item name and description
3. **Sentence case** - Descriptions start with capital letter
4. **No periods** - End descriptions without periods
5. **Sub-bullets** - Indent with 2 spaces, use for details

## Section Order

1. Added
2. Changed
3. Fixed
4. Removed

Only include sections with content.

## Examples

Good:

```markdown
- **`debug plugin`** - Renamed skill: systematic-debugging → debug
- **`/workflows:plan` command** - Interactive Q&A refinement phase (#88)
  - After generating initial plan, now offers to refine with targeted questions
  - Asks up to 5 questions about ambiguous requirements
```

Bad:

```markdown
- debug plugin - renamed skill # missing bold/backticks
- **debug plugin**: renamed skill # colon instead of dash
- **`debug plugin`** - renamed skill. # has period
```

## Versioning

- Major (X.0.0) - Breaking changes, major removals
- Minor (X.Y.0) - New features, new plugins
- Patch (X.Y.Z) - Bug fixes, renames, documentation
