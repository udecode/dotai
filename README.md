# dotai

## Install

### New `.claude/settings.json` file

```bash
npx shadcn@latest add https://raw.githubusercontent.com/udecode/dotai/main/registry/all.json
```

### Existing `.claude/settings.json` file

Dotai:

```bash
/plugin marketplace add https://github.com/udecode/dotai
/plugin install dotai notification debug test learn dig git
```

Claude Plugins Official:

```bash
/plugin install ralph-loop@@claude-plugins-official
/plugin install frontend-design@@claude-plugins-official
```

Compound Engineering:

```bash
/plugin marketplace add https://github.com/kieranklaassen/compound-engineering-plugin
/plugin install compound-engineering
```

## Components

| Component | Count |
| --------- | ----- |
| Plugins   | 9     |
| Commands  | 5     |
| Skills    | 8     |

## Plugins

| Plugin         | Description                               |
| -------------- | ----------------------------------------- |
| `dotai`        | Development toolkit - docs, PRs, planning |
| `debug`        | Four-phase debugging framework            |
| `test`         | TDD workflow - red-green-refactor         |
| `git`          | PR creation, drafts, reviews              |
| `learn`        | Extract knowledge into skills             |
| `dig`          | Clone and explore library source          |
| `notification` | macOS notifications                       |
| `media`        | Auto-play/pause media                     |
| `codex`        | MCP servers for Codex                     |

## Commands

### Documentation

| Command                    | Description                       |
| -------------------------- | --------------------------------- |
| `/dotai:create-app-design` | Generate app design documentation |
| `/dotai:update-app-design` | Update existing app design docs   |
| `/dotai:create-tech-stack` | Generate tech stack documentation |
| `/dotai:update-tech-stack` | Update existing tech stack docs   |
| `/dotai:install`           | Install plugin files              |

## Skills

Skills are auto-invoked based on context.

### Debugging

| Skill   | Plugin | Description                                                             |
| ------- | ------ | ----------------------------------------------------------------------- |
| `debug` | debug  | Four-phase debugging process (investigate → analyze → test → implement) |
| `trace` | debug  | Trace backward through call stack to find root cause                    |

### Testing

| Skill | Plugin | Description                                                       |
| ----- | ------ | ----------------------------------------------------------------- |
| `tdd` | test   | Test-driven development - write test first, watch fail, make pass |

### Git & PRs

| Skill | Plugin | Description                                                                                                   |
| ----- | ------ | ------------------------------------------------------------------------------------------------------------- |
| `pr`  | git    | Unified PR management - create regular/draft PRs, review with severity ratings (delegates to /workflows:review for comprehensive analysis) |

### Learning

| Skill   | Plugin | Description                                          |
| ------- | ------ | ---------------------------------------------------- |
| `learn` | learn  | Extract reusable knowledge from sessions into skills |

### Research

| Skill | Plugin | Description                                              |
| ----- | ------ | -------------------------------------------------------- |
| `dig` | dig    | Clone and explore library source to answer API questions |

## Prompt System

Dynamic prompt injection via `.claude/prompt.yml`:

| Hook             | Description                                   |
| ---------------- | --------------------------------------------- |
| `beforeStart`    | Checklist before Claude responds              |
| `beforeComplete` | Verification items before claiming completion |
| `afterCompact`   | Context recovery after compaction             |

**Example configuration:**

```yaml
beforeStart:
  - tag: SKILL-ANALYSIS
    header: 🎯 Skill Check
    todos:
      - "List available skills, invoke applicable ones"

beforeComplete:
  - tag: VERIFICATION
    header: 🔒 Verify
    todos:
      - "Typecheck: bun typecheck"
      - "Lint: bun lint:fix"
```

## Compound Engineering

### Workflow Commands

| Command                 | Description                                                            |
| ----------------------- | ---------------------------------------------------------------------- |
| `/workflows:lfg`        | Full autonomous workflow (plan → work → review → test browser → video) |
| `/workflows:brainstorm` | Explore requirements before planning                                   |
| `/workflows:plan`       | Create implementation plans                                            |
| `/workflows:review`     | Run comprehensive code reviews                                         |
| `/workflows:work`       | Execute work items systematically                                      |
| `/workflows:compound`   | Document solved problems                                               |

### Agents (27)

- **Review (14)**: agent-native-reviewer, architecture-strategist, code-simplicity-reviewer, data-integrity-guardian, deployment-verification-agent, dhh-rails-reviewer, kieran-rails-reviewer, kieran-python-reviewer, kieran-typescript-reviewer, pattern-recognition-specialist, performance-oracle, security-sentinel, julik-frontend-races-reviewer, data-migration-expert
- **Research (4)**: best-practices-researcher, framework-docs-researcher, git-history-analyzer, repo-research-analyst
- **Design (3)**: design-implementation-reviewer, design-iterator, figma-design-sync
- **Workflow (5)**: bug-reproduction-validator, every-style-editor, lint, pr-comment-resolver, spec-flow-analyzer
- **Docs (1)**: ankane-readme-writer

### Skills (14)

agent-native-architecture, andrew-kane-gem-writer, compound-docs, create-agent-skills, dhh-rails-style, dspy-ruby, frontend-design, skill-creator, every-style-editor, file-todos, git-worktree, rclone, agent-browser, gemini-imagegen

### MCP Server

context7 - Framework documentation lookup (Rails, React, Next.js, Vue, Django, Laravel, etc.)

## Development

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT
