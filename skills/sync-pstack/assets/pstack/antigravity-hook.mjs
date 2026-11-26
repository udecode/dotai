#!/usr/bin/env node
// Installed by the sync-pstack skill.
// Translates Antigravity hooks.json events (camelCase stdin/stdout) to pstack's
// Claude-format guard and lifecycle scripts, with optional project script flags.
// Usage: node .agents/pstack/antigravity-hook.mjs <SessionStart|PreInvocation|PreToolUse|Stop>
//   [--pre-tool <script>]... [--pre-tool-bash <script>]...
//   [--pre-invocation-reset <script>]... [--session-start <script>]... [--stop <script>]...

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [, , event = '', ...rest] = process.argv;

function multiFlag(argv, name) {
  const values = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === name && argv[i + 1]) {
      values.push(argv[i + 1]);
      i += 1;
    }
  }
  return values;
}

let payload = {};
try {
  const raw = readFileSync(0, 'utf8').trim();
  if (raw) payload = JSON.parse(raw);
} catch {
  // Malformed stdin: fail open for non-destructive lifecycle hooks.
}

const cwd =
  typeof payload.cwd === 'string' && payload.cwd.length > 0
    ? payload.cwd
    : ROOT;
const env = { ...process.env, CLAUDE_PROJECT_DIR: ROOT };

function runScript(spec, extraArgs = [], stdinObj = null, timeout = 15_000) {
  const [relPath, ...specArgs] = spec.split(/\s+/u).filter(Boolean);
  const fullPath = join(ROOT, relPath);
  if (!existsSync(fullPath)) return null;
  return spawnSync(process.execPath, [fullPath, ...specArgs, ...extraArgs], {
    cwd,
    env,
    encoding: 'utf8',
    input: stdinObj === null ? undefined : JSON.stringify(stdinObj),
    timeout,
  });
}

function parseDeny(run) {
  if (!run?.stdout) return null;
  const text = run.stdout.trim();
  if (!text) return null;
  try {
    const out = JSON.parse(text);
    if (out?.hookSpecificOutput?.permissionDecision === 'deny') {
      return (
        out.hookSpecificOutput.permissionDecisionReason ||
        'Blocked by pstack hook guard.'
      );
    }
  } catch {
    // Non-JSON informational output is not a denial.
  }
  return null;
}

function mapToolCall(toolCall) {
  if (!toolCall || typeof toolCall !== 'object') return null;
  const name = String(toolCall.name ?? '');
  const args =
    toolCall.args && typeof toolCall.args === 'object' ? toolCall.args : {};

  switch (name) {
    case 'run_command':
      return {
        tool_name: 'Bash',
        tool_input: { command: String(args.CommandLine ?? '') },
      };
    case 'edit_file':
      return {
        tool_name: 'Edit',
        tool_input: {
          file_path: String(args.Path ?? ''),
          old_string: String(args.Target ?? ''),
          new_string: String(args.Replacement ?? ''),
        },
      };
    case 'write_file':
      return {
        tool_name: 'Write',
        tool_input: {
          file_path: String(args.Path ?? ''),
          content: String(args.Content ?? ''),
        },
      };
    case 'read_file':
      return {
        tool_name: 'Read',
        tool_input: { file_path: String(args.Path ?? '') },
      };
    case 'invoke_subagent':
      return {
        tool_name: 'Agent',
        tool_input: args,
      };
    default:
      return null;
  }
}

if (event === 'PreToolUse') {
  const mapped = mapToolCall(payload.toolCall);
  if (!mapped) {
    process.stdout.write('{"decision":"allow"}\n');
    process.exit(0);
  }

  const claudeEvent = {
    cwd,
    session_id: payload.conversationId ?? '',
    tool_name: mapped.tool_name,
    tool_input: mapped.tool_input,
  };

  const guards = [];
  if (
    mapped.tool_name === 'Bash' ||
    mapped.tool_name === 'Edit' ||
    mapped.tool_name === 'Write'
  ) {
    guards.push('.agents/pstack/guard.mjs');
  }
  if (mapped.tool_name === 'Bash') {
    guards.push(...multiFlag(rest, '--pre-tool-bash'));
  }
  guards.push(...multiFlag(rest, '--pre-tool'));

  for (const script of guards) {
    const reason = parseDeny(runScript(script, [], claudeEvent, 10_000));
    if (reason) {
      process.stdout.write(
        `${JSON.stringify({ decision: 'deny', reason })}\n`
      );
      process.exit(0);
    }
  }

  process.stdout.write('{"decision":"allow"}\n');
  process.exit(0);
}

if (event === 'PreInvocation') {
  if (payload.invocationNum === 1 && payload.conversationId) {
    for (const script of multiFlag(rest, '--pre-invocation-reset')) {
      runScript(
        script,
        ['--reset'],
        { cwd, session_id: payload.conversationId },
        5_000
      );
    }
  }
  process.stdout.write('{}\n');
  process.exit(0);
}

if (event === 'SessionStart') {
  const notes = [];
  runScript('.agents/pstack/head.mjs', [], null, 15_000);
  for (const script of multiFlag(rest, '--session-start')) {
    const run = runScript(script, [], { cwd }, 30_000);
    if (run?.stdout?.trim()) notes.push(run.stdout.trim());
  }
  if (notes.length > 0) {
    process.stdout.write(
      `${JSON.stringify({
        injectSteps: [{ systemMessage: { systemMessage: notes.join('\n') } }],
      })}\n`
    );
  } else {
    process.stdout.write('{}\n');
  }
  process.exit(0);
}

if (event === 'Stop') {
  for (const script of multiFlag(rest, '--stop')) {
    runScript(script, [], { cwd }, 25_000);
  }
  process.stdout.write('{}\n');
  process.exit(0);
}

process.stdout.write('{}\n');
