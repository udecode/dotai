import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { buildWorkspace } from './workspace.mjs';

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { cwd, stdio: 'ignore' });

test('labels each agent worktree by its latest session, adds the id only to clashing labels, and leaves out scratch worktrees', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'worktree-workspace-')));
  const main = join(root, 'repo');
  git(root, 'init', '-q', '-b', 'next', main);
  writeFileSync(join(main, 'a.txt'), 'a\n');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'base');
  const add = (path, branch) => git(main, 'worktree', 'add', '-q', '-b', branch, path);
  const agents = join(main, '.claude', 'worktrees');
  add(join(agents, 'calm-one'), 'one');
  add(join(agents, 'calm-two'), 'two');
  add(join(agents, 'agent-a65a1b07548ae78a7'), 'agent');
  add(join(root, 'scratch'), 'scratch');
  git(join(agents, 'agent-a65a1b07548ae78a7'), 'commit', '-q', '--allow-empty', '-m', 'wip: slash cut');

  const sessions = [
    { cwd: join(agents, 'calm-one'), title: 'old title', lastActivityAt: 1 },
    { cwd: join(agents, 'calm-one'), title: 'table delete', lastActivityAt: 3 },
    { cwd: join(agents, 'calm-two'), title: 'table delete', isArchived: false, lastActivityAt: 2 },
    { cwd: join(root, 'scratch'), title: 'proof', lastActivityAt: 4 },
  ];
  const names = buildWorkspace({ repo: main, sessions }).workspace.folders.map((f) => f.name);

  assert.deepEqual(names, ['repo · next', 'table delete · calm-one', 'table delete · calm-two', 'agent-a65a1b — wip: slash cut']);
});
