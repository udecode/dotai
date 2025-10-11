# CLAUDE.md

## Project Overview

[Describe your project here - what it does, who it's for, and what problem it solves]

## Development

### Critical Rules

- Always run type checking before ending a task
- Never git commit/push without approval

### Commands

- `pnpm typecheck` - Run TypeScript type checking (must pass without errors) on each task end. Do not run this unless you can't see it in Background Bash Shells.
- `pnpm lint:fix` - Run ESLint and fix linting errors on precommit (not on each task end)
- **NEVER make git commits unless explicitly asked by the user.**

DO NOT run the following commands unless asked with `/c`. Read the output when checking app and typecheck errors:

- `pnpm dev` - Start development server
- `pnpm build` - Build for production
- `pnpm app:log` - Watch App logs.
- `pnpm backend:log` - Watch Backend logs.
- `pnpm typecheck:watch` - Watch TypeScript type checking.
