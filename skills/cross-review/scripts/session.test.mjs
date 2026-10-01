import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'session.mjs');

function claudeSession(home, cwd, id, records) {
  const dir = join(home, '.claude/projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(dir, { recursive: true });
  const lines = records.map(([role, text], index) =>
    JSON.stringify({
      type: role,
      cwd,
      sessionId: id,
      timestamp: new Date(Date.UTC(2026, 9, 1, 10, index)).toISOString(),
      message: { role, content: role === 'user' ? text : [{ type: 'text', text }] },
    }),
  );
  writeFileSync(join(dir, `${id}.jsonl`), `${lines.join('\n')}\n`);
}

function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'cross-review-home-'));
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'cross-review-repo-')));
  claudeSession(home, cwd, 'a', [
    ['user', 'make the toolbar keyboard friendly'],
    ['assistant', 'Plan written.\n\n$cross-review docs/plans/a.md'],
  ]);
  claudeSession(home, cwd, 'b', [
    ['user', 'rename the export'],
    ['assistant', 'Still working on it.'],
  ]);
  claudeSession(home, cwd, 'c', [
    ['user', 'fix the paste bug'],
    ['assistant', 'Fixed in 4682b1696 fix(paste): keep marks.\n\n$cross-review docs/plans/c.md'],
  ]);
  const run = (...args) => spawnSync(process.execPath, [SCRIPT, '--from', 'claude', ...args], { cwd, encoding: 'utf8', env: { ...process.env, HOME: home } });
  return { home, cwd, run };
}

test('with several sessions waiting and no plan, it lists only the waiting ones and asks for a pick', () => {
  const { run } = fixture();
  const listed = run();
  assert.equal(listed.status, 3, listed.stderr);
  assert.match(listed.stdout, /docs\/plans\/a\.md/);
  assert.match(listed.stdout, /docs\/plans\/c\.md/);
  assert.doesNotMatch(listed.stdout, /rename the export/);
});

test('a plan path picks the session that handed it off, with its asks, last reply and commits', () => {
  const { run } = fixture();
  const shown = run('--plan', 'docs/plans/c.md');
  assert.equal(shown.status, 0, shown.stderr);
  assert.match(shown.stdout, /fix the paste bug/);
  assert.match(shown.stdout, /## Commit lines seen in the session[^\n]*\n- 4682b1696 fix\(paste\): keep marks\./);
  assert.doesNotMatch(shown.stdout, /make the toolbar keyboard friendly/);
});
