import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ENV, git, helper, HELPERS, split, trunk } from './test-trunk.mjs';

test('guard blocks force-push/delete on main/next, direct push to next, gh pr create into next, workflow approval, and base-branch sync', () => {
  const { clone } = trunk();
  const guard = (command) => {
    const run = spawnSync(process.execPath, [join(clone, '.agents/pstack/guard.mjs')], {
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: clone }),
      encoding: 'utf8',
      env: ENV,
    });
    assert.equal(run.status, 0, run.stderr);
    return run.stdout ? JSON.parse(run.stdout).hookSpecificOutput : null;
  };
  const denied = [
    ['git push --force origin next', /force-push/u],
    ['git push -f origin HEAD:main', /force-push/u],
    ['git push --force-with-lease origin HEAD:refs/heads/next', /force-push/u],
    ['git push origin +HEAD:next', /force-push/u],
    ['git push -uf origin next', /force-push/u],
    ['cd x && timeout 60 git -C . push origin next --force', /force-push/u],
    ['git push origin --delete next', /delete/u],
    ['git push origin :main', /delete/u],
    ['git push --force origin :', /force-push/u],
    ["git push --force origin 'refs/heads/n*:refs/heads/n*'", /force-push/u],
    ['git push origin HEAD:next', /only through `node \.agents\/pstack\/land\.mjs`/u],
    ['git push origin task:refs/heads/next', /only through `node \.agents\/pstack\/land\.mjs`/u],
    ['git push --all origin', /only through `node \.agents\/pstack\/land\.mjs`/u],
    ['cd x && git -C . push origin next', /only through `node \.agents\/pstack\/land\.mjs`/u],
    ['gh pr create --base next --fill', /node \.agents\/pstack\/land\.mjs/u],
    ['gh pr create', /node \.agents\/pstack\/land\.mjs/u],
    ['gh pr new -B next', /node \.agents\/pstack\/land\.mjs/u],
    ['cd x && GH_REPO=a/b gh pr create -Bnext', /node \.agents\/pstack\/land\.mjs/u],
    ['gh api -X POST repos/a/b/actions/runs/123/approve', /agents never approve a workflow run/u],
    ['curl -sSd \'{"state":"approved"}\' https://api.github.com/repos/a/b/actions/runs/123/pending_deployments', /agents never approve a workflow run/u],
  ];
  for (const [command, reason] of denied) {
    const decision = guard(command);
    assert.equal(decision?.permissionDecision, 'deny', command);
    assert.match(decision.permissionDecisionReason, reason, command);
  }
  const passed = [
    'git push -f origin task',
    'git push --force origin HEAD',
    "git commit -m 'never git push -f origin next'",
    "git push --force origin 'refs/tags/*:refs/tags/*'",
    'git push origin HEAD',
    'git push --dry-run origin HEAD:next',
    'PSTACK_RELEASE=1 git push origin next',
    'git push origin --tags',
    'gh pr create --base someone-branch',
    'gh pr edit 7 --body-file b.md',
    'gh pr create --help',
    'gh api repos/a/b/actions/runs/123',
    'gh pr review 7 --approve',
  ];
  for (const command of passed) assert.equal(guard(command), null, command);

  git(clone, 'switch', '--quiet', 'next');
  assert.equal(guard('git push -f')?.permissionDecision, 'deny');
  assert.equal(guard('git push')?.permissionDecision, 'deny');
  assert.equal(guard('git push origin --tags'), null);
});

test('guard blocks destructive companion commands and passes safe ones', () => {
  const fixture = trunk();
  const { dir, clone } = fixture;
  const old = git(clone, 'rev-parse', 'HEAD');
  split(fixture);
  const plain = join(dir, 'plain');
  git(clone, 'worktree', 'add', '--quiet', '--detach', plain);
  const guard = (command, cwd = clone) => {
    const run = spawnSync(process.execPath, [join(clone, '.agents/pstack/guard.mjs')], {
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd }),
      encoding: 'utf8',
      env: ENV,
    });
    assert.equal(run.status, 0, run.stderr);
    return run.stdout ? JSON.parse(run.stdout).hookSpecificOutput : null;
  };
  for (const [command, reason] of Object.entries({
    'git clean -fdx': /git clean -x or -X/u,
    'git clean -fX': /git clean -x or -X/u,
    'git --git-dir=.git-private --work-tree=. clean -fd': /deletes public files/u,
    [`git checkout ${old}`]: /has no \.gitprivate/u,
    [`git switch --detach ${old}`]: /has no \.gitprivate/u,
    [`git reset --hard ${old}`]: /has no \.gitprivate/u,
    [`git rebase ${old}`]: /has no \.gitprivate/u,
  })) {
    const decision = guard(command);
    assert.equal(decision?.permissionDecision, 'deny', command);
    assert.match(decision.permissionDecisionReason, reason, command);
  }
  for (const command of ['git clean -fd', 'git clean -ndx', 'git switch --detach origin/next', `git checkout ${old} -- a.txt`, 'git reset --hard HEAD', 'git --git-dir=.git-private --work-tree=. status', `cd ${plain} && git clean -fdx`]) {
    assert.equal(guard(command), null, command);
  }
  assert.equal(guard('git clean -fdx', plain), null);
});

test('guard denies edits in main checkout on next/main/detached, allows artifacts/worktrees/task branches, and fails open on conflict markers', () => {
  const { dir, clone } = trunk();
  const tree = join(clone, '.claude/worktrees/task');
  git(clone, 'worktree', 'add', '--quiet', '--detach', tree, 'origin/next');
  const edit = (tool_name, path, { from = clone, cwd = clone } = {}) => {
    const run = spawnSync(process.execPath, [join(from, '.agents/pstack/guard.mjs')], {
      input: JSON.stringify({ tool_name, tool_input: tool_name === 'NotebookEdit' ? { notebook_path: path } : { file_path: path }, cwd }),
      encoding: 'utf8',
      env: ENV,
    });
    assert.equal(run.status, 0, run.stderr);
    return run.stdout ? JSON.parse(run.stdout).hookSpecificOutput : null;
  };
  const alias = join(dir, 'alias.txt');
  symlinkSync(join(clone, 'a.txt'), alias);
  mkdirSync(join(clone, 'docs/plans/artifacts/run'), { recursive: true });
  git(clone, 'switch', '--quiet', 'next');
  for (const [tool, path] of [['Edit', 'a.txt'], ['Write', join(clone, 'src/new/b.ts')], ['NotebookEdit', 'c.ipynb'], ['Write', alias], ['Edit', join(clone, '.git/HEAD')]]) {
    const decision = edit(tool, path);
    assert.equal(decision?.permissionDecision, 'deny', path);
    assert.match(decision.permissionDecisionReason, /agents never edit the main checkout/u);
  }
  assert.equal(edit('Write', join(clone, 'docs/plans/x.md'), { from: tree, cwd: tree })?.permissionDecision, 'deny');
  for (const path of ['docs/plans/artifacts/run/log.txt', join(tree, 'a.txt')]) assert.equal(edit('Write', path), null, path);
  for (const args of [['switch', '--quiet', 'main'], ['switch', '--quiet', '--detach']]) {
    git(clone, ...args);
    assert.equal(edit('Edit', 'a.txt')?.permissionDecision, 'deny');
  }
  git(clone, 'switch', '--quiet', 'task');
  assert.equal(edit('Edit', 'a.txt'), null);
  git(clone, 'switch', '--quiet', 'next');
  writeFileSync(join(clone, '.agents/pstack.json'), '<<<<<<< HEAD\n{"branch":"next"}\n=======\n{"branch":"next"}\n>>>>>>> next\n');
  assert.equal(edit('Edit', '.agents/pstack.json'), null);
});

test('setup copies env files, installs once (even with existing node_modules), reruns on --installs removal or failure, and honors --hook', () => {
  const { dir, clone } = trunk();
  mkdirSync(join(clone, 'apps/web'), { recursive: true });
  writeFileSync(join(clone, 'apps/web/keep.txt'), 'x\n');
  git(clone, 'add', '--all');
  git(clone, 'commit', '--quiet', '-m', 'app');
  writeFileSync(join(clone, '.env'), 'A=1\n');
  writeFileSync(join(clone, 'apps/web/.env.local'), 'B=2\n');

  const tree = join(dir, 'tree');
  git(clone, 'worktree', 'add', '--quiet', '--detach', tree);
  mkdirSync(join(tree, 'node_modules'));
  const install = ['--install', 'mkdir -p node_modules && touch node_modules/ok', '--installs', 'node_modules'];
  const first = helper('setup.mjs', tree, install);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /copied \.env, apps\/web\/\.env\.local from /);
  assert.equal(readFileSync(join(tree, 'apps/web/.env.local'), 'utf8'), 'B=2\n');
  assert.ok(existsSync(join(tree, 'node_modules/ok')));
  assert.equal(helper('setup.mjs', tree, ['--install', 'false', '--installs', 'node_modules']).stdout, '');
  rmSync(join(tree, 'node_modules'), { recursive: true });
  assert.match(helper('setup.mjs', tree, install).stdout, /ran mkdir -p node_modules/);

  const failing = join(dir, 'failing');
  git(clone, 'worktree', 'add', '--quiet', '--detach', failing);
  const failed = helper('setup.mjs', failing, ['--install', 'false']);
  assert.equal(failed.status, 1);
  assert.match(failed.stdout, /false failed \(exit 1\)/);
  assert.match(helper('setup.mjs', failing, ['--install', 'touch ran']).stdout, /ran touch ran/);

  // --hook runs in the payload worktree only, never in another repo or main checkout, and exits 0 on install failure.
  const hooked = join(dir, 'hooked');
  git(clone, 'worktree', 'add', '--quiet', '--detach', hooked);
  mkdirSync(join(hooked, 'sub'));
  const other = join(dir, 'other');
  mkdirSync(other);
  git(other, 'init', '--quiet');
  const hook = (cwd, cmd = 'touch ran') =>
    spawnSync(process.execPath, [join(HELPERS, 'setup.mjs'), '--hook', '--install', cmd], { cwd: clone, encoding: 'utf8', env: ENV, input: JSON.stringify({ cwd }) });
  assert.equal(hook(other).status, 0);
  assert.ok(!existsSync(join(other, 'ran')));
  const hookFail = hook(join(hooked, 'sub'), 'false');
  assert.equal(hookFail.status, 0);
  assert.match(hookFail.stdout, /copied \.env, apps\/web\/\.env\.local from /);
  assert.match(hook(join(hooked, 'sub')).stdout, /ran touch ran/);
  assert.ok(existsSync(join(hooked, 'ran')) && !existsSync(join(clone, 'ran')));
});

test('setup fast-forwards main checkout safely, saving unstaged edits to deleted files and refusing staged/conflicting/ignored overlaps', () => {
  const { dir, remote, clone } = trunk();
  git(clone, 'switch', '--quiet', 'next');
  for (const name of ['[id].txt', 'i.txt', 'note.txt']) writeFileSync(join(clone, name), 'one\n');
  git(clone, 'add', ':(literal)[id].txt', 'i.txt', 'note.txt');
  git(clone, 'commit', '--quiet', '-m', 'more files');
  git(clone, 'push', '--quiet', 'origin', 'HEAD:next');
  const other = join(dir, 'other');
  git(dir, 'clone', '--quiet', '--branch', 'next', remote, other);
  git(other, 'rm', '--quiet', 'a.txt', 'b.txt', ':(literal)[id].txt', 'note.txt');
  mkdirSync(join(other, 'b.txt'));
  writeFileSync(join(other, 'b.txt/x'), 'x\n');
  writeFileSync(join(other, 'NOTE.txt'), 'theirs\n');
  writeFileSync(join(other, 'draft.txt'), 'theirs\n');
  git(other, 'add', '--all');
  git(other, 'commit', '--quiet', '-m', 'delete four and add draft');
  git(other, 'push', '--quiet', 'origin', 'HEAD:next');
  const deletes = git(other, 'rev-parse', 'HEAD');

  const edited = ['[id].txt', 'a.txt', 'b.txt', 'i.txt', 'note.txt'];
  for (const name of edited) writeFileSync(join(clone, name), `local ${name}\n`);
  writeFileSync(join(clone, '.git/info/exclude'), 'draft.txt\nscratch.txt\n');
  writeFileSync(join(clone, 'draft.txt'), 'mine\n');
  writeFileSync(join(clone, 'scratch.txt'), 'mine\n');

  // Staged edit blocks pull.
  git(clone, 'add', 'a.txt');
  assert.match(helper('setup.mjs', clone).stdout, /not pulled, because local edits touch a\.txt\n/);
  git(clone, 'restore', '--staged', 'a.txt');

  // Ignored file at incoming path blocks pull and keeps all local edits.
  assert.match(helper('setup.mjs', clone).stdout, /fast-forward failed/);
  assert.equal(readFileSync(join(clone, 'draft.txt'), 'utf8'), 'mine\n');
  for (const name of edited) assert.equal(readFileSync(join(clone, name), 'utf8'), `local ${name}\n`);
  rmSync(join(clone, 'draft.txt'));

  const out = helper('setup.mjs', clone).stdout;
  const kept = join(clone, '.git/pstack-kept');
  const [saved] = readdirSync(kept).map((name) => join(kept, name));
  assert.ok(saved && out.includes(saved), out);
  assert.equal(git(clone, 'rev-parse', 'HEAD'), deletes);
  for (const name of ['[id].txt', 'a.txt', 'b.txt', 'note.txt']) assert.equal(readFileSync(join(saved, name), 'utf8'), `local ${name}\n`);
  assert.equal(readFileSync(join(clone, 'b.txt/x'), 'utf8'), 'x\n');
  assert.equal(readFileSync(join(clone, 'i.txt'), 'utf8'), 'local i.txt\n');
  assert.equal(readFileSync(join(clone, 'scratch.txt'), 'utf8'), 'mine\n');
});
