# Changelog

## [1.0.0]

### Removed

- **`plan plugin`** - Removed entirely (write-plan, execute-plan, brainstorm commands and skills)
- **`agents plugin`** - Removed entirely (parallel dispatch skill)
- **`skills plugin`** - Replaced by learn plugin
- **`dotai commands`** - Removed opus, fix, create-snippet commands
- **`watch.md`** - Removed from registry
- **`git commands`** - Removed commands, now skills only
- **`debug commands`** - Removed commands, now skills only
- **`test commands`** - Removed commands, now skills only

### Added

- **`learn plugin`** - Continuous learning system for extracting reusable knowledge from work sessions into Claude Code skills

### Changed

- **`git plugin`** - Renamed skills: drafting-pr → draft-pr, creating-pr → create-pr, reviewing-pr → review-pr
- **`gh-docs plugin`** - Renamed to dig plugin
- **`test plugin`** - Renamed skill: test-driven-development → tdd
- **`debug plugin`** - Renamed skills: systematic-debugging → debug, root-cause-tracing → trace
- Updated all plugin integrations to remove plan/agents/skills references
- Simplified README.md documentation
- Updated CONTRIBUTING.md skill examples (debug/test/git instead of plan skills)
