import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'session.mjs');

function claudeSession(home, cwd, id, minutesAgo, records) {
  const dir = join(home, '.claude/projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(dir, { recursive: true });
  const lines = records.map((record, index) => {
    const [role, content] = Array.isArray(record) ? record : [record.role, record.content];
    return JSON.stringify({
      type: role,
      cwd,
      sessionId: id,
      timestamp: new Date(Date.UTC(2026, 9, 1, 10, index)).toISOString(),
      message: { role, content: role === 'assistant' && typeof content === 'string' ? [{ type: 'text', text: content }] : content },
    });
  });
  const path = join(dir, `${id}.jsonl`);
  writeFileSync(path, `${lines.join('\n')}\n`);
  const when = new Date(Date.now() - minutesAgo * 60000);
  utimesSync(path, when, when);
}

function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'cross-review-home-'));
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'cross-review-repo-')));
  claudeSession(home, cwd, 'a', 50, [
    ['user', 'make the toolbar keyboard friendly'],
    ['assistant', 'Plan written.\n\n`$cross-review docs/plans/a.md`'],
  ]);
  claudeSession(home, cwd, 'b', 40, [
    ['user', 'rename the export'],
    ['assistant', 'Still working on it.'],
  ]);
  claudeSession(home, cwd, 'c', 30, [
    ['user', '<command-name>/fix</command-name>\n<command-args>the paste bug</command-args>'],
    { role: 'assistant', content: [{ type: 'tool_use', name: 'Write', input: { file_path: join(cwd, 'docs/plans/c.md'), content: '# Paste' } }] },
    ['assistant', 'Fixed in 4682b1696 fix(paste): keep marks.\n\n$cross-review docs/plans/c.md'],
  ]);
  claudeSession(home, cwd, 'd', 20, [
    ['user', 'check the tree'],
    { role: 'user', content: [{ type: 'tool_result', content: ' M docs/plans/c.md\n M docs/plans/d.md' }] },
    ['assistant', 'Clean enough.'],
  ]);
  claudeSession(home, cwd, 'e', 10, [
    ['user', 'draft the table plan'],
    ['assistant', 'Plan written.\n\n$cross-review docs/plans/e.md'],
    ['user', 'also cover merged cells'],
  ]);
  const run = (...args) => spawnSync(process.execPath, [SCRIPT, '--from', 'claude', ...args], { cwd, encoding: 'utf8', env: { ...process.env, HOME: home } });
  return { run };
}

test('with no plan, it lists every finished session, hand-off or not, and a picked id shows that session', () => {
  const { run } = fixture();
  const listed = run();
  assert.equal(listed.status, 3, listed.stderr);
  assert.match(listed.stdout, /^\d\. a \| docs\/plans\/a\.md \|/m);
  assert.match(listed.stdout, /^\d\. c \| docs\/plans\/c\.md \|/m);
  assert.match(listed.stdout, /^\d\. b \| no plan \|/m);
  assert.doesNotMatch(listed.stdout, /docs\/plans\/e\.md|draft the table plan/);
  const picked = run('--pick', 'a');
  assert.equal(picked.status, 0, picked.stderr);
  assert.match(picked.stdout, /make the toolbar keyboard friendly/);
});

test('with no hand-off line anywhere, it lists the finished sessions newest first, never one still running tools', () => {
  const home = mkdtempSync(join(tmpdir(), 'cross-review-home-'));
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'cross-review-repo-')));
  claudeSession(home, cwd, 'b', 40, [['user', 'rename the export'], ['assistant', 'Renamed and verified.']]);
  claudeSession(home, cwd, 'd', 20, [['user', 'seat codex in the panels'], ['assistant', 'Panel review done.']]);
  claudeSession(home, cwd, 'e', 10, [['user', 'draft the table plan'], ['assistant', 'Plan written.'], ['user', 'also cover merged cells']]);
  claudeSession(home, cwd, 'f', 5, [
    ['user', 'fix the paste bug'],
    ['assistant', 'Reading the clipboard handler.'],
    { role: 'assistant', content: [{ type: 'tool_use', name: 'Read', input: { file_path: join(cwd, 'paste.ts') } }] },
    { role: 'user', content: [{ type: 'tool_result', content: 'export function paste() {}' }] },
  ]);
  const listed = spawnSync(process.execPath, [SCRIPT, '--from', 'claude'], { cwd, encoding: 'utf8', env: { ...process.env, HOME: home } });
  assert.equal(listed.status, 3, listed.stderr);
  assert.match(listed.stdout, /^1\. d \|/m);
  assert.match(listed.stdout, /^2\. b \|/m);
  assert.doesNotMatch(listed.stdout, /draft the table plan|fix the paste bug/);
});

test('a plan path picks the session that wrote and handed it off, not one that only saw it in tool output', () => {
  const { run } = fixture();
  const shown = run('--plan', 'docs/plans/c.md');
  assert.equal(shown.status, 0, shown.stderr);
  assert.match(shown.stdout, /^1\. \(\S+\) \/fix the paste bug$/m);
  assert.match(shown.stdout, /## Commit lines seen in the session[^\n]*\n- 4682b1696 fix\(paste\): keep marks\./);
  assert.doesNotMatch(shown.stdout, /check the tree/);
  assert.equal(run('--plan', 'docs/plans/d.md').status, 1, 'a path seen only in tool output names no session');
});
