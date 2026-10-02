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
  claudeSession(home, cwd, 'f', 5, [
    ['user', 'fix the scroll bug'],
    ['assistant', 'Reading the scroll handler.'],
    { role: 'assistant', content: [{ type: 'tool_use', name: 'Read', input: { file_path: join(cwd, 'scroll.ts') } }] },
    { role: 'user', content: [{ type: 'tool_result', content: 'export function scroll() {}' }] },
  ]);
  const run = (...args) => spawnSync(process.execPath, [SCRIPT, '--from', 'claude', ...args], { cwd, encoding: 'utf8', env: { ...process.env, HOME: home } });
  return { run };
}

test('with no plan, it lists finished sessions newest first, never one awaiting the user or still running tools, and a picked id shows that session', () => {
  const { run } = fixture();
  const listed = run();
  assert.equal(listed.status, 3, listed.stderr);
  assert.deepEqual([...listed.stdout.matchAll(/^\d\. (\w+) \| ([^|]+) \|/gmu)].map((match) => `${match[1]} ${match[2].trim()}`), [
    'd no plan',
    'c docs/plans/c.md',
    'b no plan',
    'a docs/plans/a.md',
  ]);
  const picked = run('--pick', 'a');
  assert.equal(picked.status, 0, picked.stderr);
  assert.match(picked.stdout, /make the toolbar keyboard friendly/);
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
