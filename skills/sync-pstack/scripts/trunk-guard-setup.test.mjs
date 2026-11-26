import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { test } from 'node:test';
import { ENV, ghArgs, ghLines, git, GOOD, helper, HELPERS, isAlive, NO_WAIT, PR, split, stubGh, trunk, until } from './test-trunk.mjs';

test('guard denies an agent force-push or delete of next or main and passes every other command', () => {
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
    'git push --force origin next',
    'git push -f origin HEAD:main',
    'git push --force-with-lease origin HEAD:refs/heads/next',
    'git push origin +HEAD:next',
    'git push -uf origin next',
    'cd x && timeout 60 git -C . push origin next --force',
    'git push origin --delete next',
    'git push origin :main',
    'git push --force origin :',
    "git push --force origin 'refs/heads/n*:refs/heads/n*'",
  ];
  for (const command of denied) {
    const decision = guard(command);
    assert.equal(decision?.permissionDecision, 'deny', command);
    assert.ok(decision.permissionDecisionReason.includes(command), `the reason quotes the command for the owner: ${command}`);
  }
  const passed = [
    'git push -f origin task',
    'git push --force origin HEAD',
    "git commit -m 'never git push -f origin next'",
    "git push --force origin 'refs/tags/*:refs/tags/*'",
  ];
  for (const command of passed) assert.equal(guard(command), null, command);
  git(clone, 'switch', '--quiet', 'next');
  assert.equal(guard('git push -f')?.permissionDecision, 'deny', 'a push with no refspec targets the current branch');
});

test("guard denies an agent's plain push to next, which only land.mjs makes, and passes a dry run, tags and a release push", () => {
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
  for (const command of ['git push origin HEAD:next', 'git push origin task:refs/heads/next', 'git push --all origin', 'cd x && git -C . push origin next']) {
    const decision = guard(command);
    assert.equal(decision?.permissionDecision, 'deny', command);
    assert.match(decision.permissionDecisionReason, /only through `node \.agents\/pstack\/land\.mjs`/u, command);
    assert.ok(decision.permissionDecisionReason.includes(command), `the reason quotes the command for the owner: ${command}`);
  }
  const passed = ['git push origin HEAD', 'git push -u origin task', 'git push --dry-run origin HEAD:next', 'git push -n origin HEAD:next', 'PSTACK_RELEASE=1 git push origin next', 'git push origin --tags'];
  for (const command of passed) assert.equal(guard(command), null, command);
  git(clone, 'switch', '--quiet', 'next');
  assert.equal(guard('git push')?.permissionDecision, 'deny', 'a push with no refspec targets the current branch');
  assert.equal(guard('git push origin --tags'), null, 'a tags push with no refspec targets no branch');
});

test('guard denies an agent gh pr create into next or with no base, and passes a stacked PR and other gh commands', () => {
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
    'gh pr create --base next --fill',
    'gh pr create',
    'gh pr new -B next',
    'gh pr create --base=refs/heads/next',
    'cd x && GH_REPO=a/b gh pr create -Bnext',
  ];
  for (const command of denied) {
    const decision = guard(command);
    assert.equal(decision?.permissionDecision, 'deny', command);
    assert.match(decision.permissionDecisionReason, /node \.agents\/pstack\/land\.mjs/u, command);
  }
  const passed = [
    'gh pr create --base someone-branch',
    'gh pr edit 7 --body-file b.md',
    'gh pr comment 7 --body x',
    'git push origin HEAD:someone-branch',
    'node .agents/pstack/land.mjs --message m.txt',
    'gh pr create --help',
    'gh pr new -h',
  ];
  for (const command of passed) assert.equal(guard(command), null, command);
});

test("guard denies an agent's approval of a workflow run and passes reads of other run paths", () => {
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
    'gh api -X POST repos/a/b/actions/runs/123/approve',
    'curl -sSd \'{"state":"approved"}\' https://api.github.com/repos/a/b/actions/runs/123/pending_deployments',
    "gh api -X POST repos/a/b/actions/runs/'123'/approve",
  ];
  for (const command of denied) {
    const decision = guard(command);
    assert.equal(decision?.permissionDecision, 'deny', command);
    assert.match(decision.permissionDecisionReason, /agents never approve a workflow run/u, command);
  }
  const passed = [
    'gh api repos/a/b/actions/runs/123',
    'gh run view 123 --log-failed',
    'gh pr review 7 --approve',
    'gh api repos/a/b/actions/runs/123/jobs',
  ];
  for (const command of passed) assert.equal(guard(command), null, command);
});

test('guard denies a command that would delete or overwrite the companion files, and passes the rest', () => {
  const fixture = trunk();
  const { dir, clone } = fixture;
  const old = git(clone, 'rev-parse', 'HEAD');
  split(fixture);
  const plain = join(dir, 'plain');
  git(clone, 'worktree', 'add', '--quiet', '--detach', plain);
  const guard = (command, cwd = clone, env = ENV) => {
    const run = spawnSync(process.execPath, [join(clone, '.agents/pstack/guard.mjs')], {
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd }),
      encoding: 'utf8',
      env,
    });
    assert.equal(run.status, 0, run.stderr);
    return run.stdout ? JSON.parse(run.stdout).hookSpecificOutput : null;
  };
  const denied = {
    'git clean -fdx': /git clean -x or -X/u,
    'git clean -fX': /git clean -x or -X/u,
    'git --git-dir=.git-private --work-tree=. clean -fd': /deletes public files/u,
    [`git checkout ${old}`]: /has no \.gitprivate/u,
    [`git switch --detach ${old}`]: /has no \.gitprivate/u,
    [`git reset --hard ${old}`]: /has no \.gitprivate/u,
    [`git rebase ${old}`]: /has no \.gitprivate/u,
  };
  for (const [command, reason] of Object.entries(denied)) {
    const decision = guard(command);
    assert.equal(decision?.permissionDecision, 'deny', command);
    assert.match(decision.permissionDecisionReason, reason, command);
  }
  const passed = [
    'git clean -fd',
    'git clean -ndx',
    'git switch --detach origin/next',
    `git checkout ${old} -- a.txt`,
    'git reset --hard HEAD',
    'git --git-dir=.git-private --work-tree=. status',
    `cd ${plain} && git clean -fdx`,
  ];
  for (const command of passed) assert.equal(guard(command), null, command);
  assert.equal(guard('git clean -fdx', plain), null);
});

test("guard denies the app's base-branch sync with the rebase to run instead, and passes other tools", () => {
  const { clone } = trunk();
  const hook = (tool_name) => {
    const run = spawnSync(process.execPath, [join(clone, '.agents/pstack/guard.mjs')], {
      input: JSON.stringify({ tool_name, tool_input: {}, cwd: clone }),
      encoding: 'utf8',
      env: ENV,
    });
    assert.equal(run.status, 0, run.stderr);
    return run.stdout ? JSON.parse(run.stdout).hookSpecificOutput : null;
  };
  const denied = hook('mcp__ccd_host__sync_with_base_branch');
  assert.equal(denied?.permissionDecision, 'deny');
  assert.match(denied.permissionDecisionReason, /git fetch origin next && git rebase origin\/next/u);
  assert.equal(hook('mcp__ccd_host__get_storage_usage'), null);
});

test('guard denies an edit in the main checkout on next or main, except artifacts, passes a worktree or task branch, and fails open on conflicted config', () => {
  const { dir, clone } = trunk();
  const tree = join(clone, '.claude/worktrees/task');
  git(clone, 'worktree', 'add', '--quiet', '--detach', tree, 'origin/next');
  const edit = (tool_name, path, { from = clone, cwd = clone, env = {} } = {}) => {
    const run = spawnSync(process.execPath, [join(from, '.agents/pstack/guard.mjs')], {
      input: JSON.stringify({ tool_name, tool_input: tool_name === 'NotebookEdit' ? { notebook_path: path } : { file_path: path }, cwd }),
      encoding: 'utf8',
      env: { ...ENV, ...env },
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
  for (const path of ['docs/plans/artifacts/run/log.txt', join(tree, 'a.txt')]) {
    assert.equal(edit('Write', path), null, path);
  }
  git(clone, 'switch', '--quiet', 'main');
  assert.equal(edit('Edit', 'a.txt')?.permissionDecision, 'deny');
  git(clone, 'switch', '--quiet', '--detach');
  assert.equal(edit('Edit', 'a.txt')?.permissionDecision, 'deny');
  git(clone, 'switch', '--quiet', 'task');
  assert.equal(edit('Edit', 'a.txt'), null);
  git(clone, 'switch', '--quiet', 'next');
  writeFileSync(join(clone, '.agents/pstack.json'), '<<<<<<< HEAD\n{"branch":"next"}\n=======\n{"branch":"next"}\n>>>>>>> next\n');
  assert.equal(edit('Edit', '.agents/pstack.json'), null, 'conflicted config fails open so rebase resolution never deadlocks');
});

test('setup copies env files and installs dependencies in a new worktree, once', () => {
  const { dir, clone } = trunk();
  mkdirSync(join(clone, 'apps/web'), { recursive: true });
  writeFileSync(join(clone, 'apps/web/keep.txt'), 'x\n');
  git(clone, 'add', '--all');
  git(clone, 'commit', '--quiet', '-m', 'app');
  writeFileSync(join(clone, '.env'), 'A=1\n');
  writeFileSync(join(clone, 'apps/web/.env.local'), 'B=2\n');
  const tree = join(dir, 'tree');
  git(clone, 'worktree', 'add', '--quiet', '--detach', tree);

  const first = helper('setup.mjs', tree, ['--install', 'mkdir node_modules && touch node_modules/ok']);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /copied \.env, apps\/web\/\.env\.local from /);
  assert.equal(readFileSync(join(tree, 'apps/web/.env.local'), 'utf8'), 'B=2\n');
  assert.ok(existsSync(join(tree, 'node_modules/ok')), 'the install command ran');
  assert.equal(helper('setup.mjs', tree, ['--install', 'false']).stdout, '', 'a set-up worktree copies and installs nothing');
});

test('setup --hook started in the main checkout sets up the worktree the payload names', () => {
  const { dir, clone } = trunk();
  writeFileSync(join(clone, '.env'), 'A=1\n');
  const tree = join(dir, 'tree');
  git(clone, 'worktree', 'add', '--quiet', '--detach', tree);
  mkdirSync(join(tree, 'sub'));
  const other = join(dir, 'other');
  mkdirSync(other);
  git(other, 'init', '--quiet');
  const hook = (cwd) => spawnSync(process.execPath, [join(HELPERS, 'setup.mjs'), '--hook', '--install', 'touch ran'], { cwd: clone, encoding: 'utf8', env: ENV, input: JSON.stringify({ cwd }) });

  const elsewhere = hook(other);
  assert.equal(elsewhere.status, 0, elsewhere.stderr);
  assert.ok(!existsSync(join(tree, 'ran')) && !existsSync(join(other, 'ran')), 'a session cwd in another repository sets up nothing there');
  const started = hook(join(tree, 'sub'));
  assert.equal(started.status, 0, started.stderr);
  assert.match(started.stdout, /copied \.env from /);
  assert.ok(existsSync(join(tree, 'ran')), 'the install ran in the worktree');
  assert.ok(!existsSync(join(clone, 'ran')), 'the main checkout installs nothing');
});

test('setup installs once in a worktree that arrives with node_modules, because copied modules ran no install script', () => {
  const { dir, clone } = trunk();
  const tree = join(dir, 'tree');
  git(clone, 'worktree', 'add', '--quiet', '--detach', tree);
  mkdirSync(join(tree, 'node_modules'));
  const first = helper('setup.mjs', tree, ['--install', 'touch node_modules/ran']);
  assert.equal(first.status, 0, first.stderr);
  assert.ok(existsSync(join(tree, 'node_modules/ran')), 'the install ran although node_modules existed');
  assert.equal(helper('setup.mjs', tree, ['--install', 'false']).stdout, '', 'the next session start installs nothing');
  const failing = join(dir, 'failing');
  git(clone, 'worktree', 'add', '--quiet', '--detach', failing);
  const failed = helper('setup.mjs', failing, ['--install', 'false']);
  assert.match(failed.stdout, /false failed \(exit 1\)/);
  assert.equal(failed.status, 1, 'a failed install run by hand exits 1, so a chained command stops');
  assert.match(helper('setup.mjs', failing, ['--install', 'touch ran']).stdout, /ran touch ran/, 'a failed install runs again at the next start');
  const hooked = join(dir, 'hooked');
  git(clone, 'worktree', 'add', '--quiet', '--detach', hooked);
  const started = spawnSync(process.execPath, [join(HELPERS, 'setup.mjs'), '--hook', '--install', 'false'], { cwd: clone, encoding: 'utf8', env: ENV, input: JSON.stringify({ cwd: hooked }) });
  assert.match(started.stdout, /false failed \(exit 1\)/);
  assert.equal(started.status, 0, 'a hook exits 0 after a failed install, so the session sees the failure line');
});

test('setup --installs installs again in a reused worktree whose installed path is gone', () => {
  const { dir, clone } = trunk();
  const tree = join(dir, 'tree');
  git(clone, 'worktree', 'add', '--quiet', '--detach', tree);
  const install = ['--install', 'mkdir node_modules && touch ran', '--installs', 'node_modules'];
  assert.equal(helper('setup.mjs', tree, install).status, 0);
  rmSync(join(tree, 'ran'));
  assert.equal(helper('setup.mjs', tree, install).stdout, '', 'the installed path is there, so nothing installs');
  rmSync(join(tree, 'node_modules'), { recursive: true });
  assert.match(helper('setup.mjs', tree, install).stdout, /ran mkdir node_modules/, 'the next session start installs again');
  assert.ok(existsSync(join(tree, 'ran')));
});

test('setup fast-forwards the main checkout only when no local edit touches an incoming path', () => {
  const { clone, elsewhere } = trunk();
  git(clone, 'switch', '--quiet', 'next');
  git(elsewhere('a.txt', 'theirs\n', 'fix(a): land elsewhere'), 'push', '--quiet', 'origin', 'HEAD:next');
  const head = git(clone, 'rev-parse', 'HEAD');
  writeFileSync(join(clone, 'a.txt'), 'local\n');

  assert.match(helper('setup.mjs', clone).stdout, /1 commit\(s\) on origin\/next not pulled, because local edits touch a\.txt/);
  assert.equal(git(clone, 'rev-parse', 'HEAD'), head);

  git(clone, 'checkout', '--', 'a.txt');
  writeFileSync(join(clone, 'b.txt'), 'staged\n');
  git(clone, 'add', 'b.txt');
  writeFileSync(join(clone, 'z.txt'), 'untracked\n');
  assert.match(helper('setup.mjs', clone).stdout, /fast-forwarded next by 1 commit/);
  assert.equal(readFileSync(join(clone, 'a.txt'), 'utf8'), 'theirs\n');
  assert.equal(git(clone, 'status', '--porcelain'), 'M  b.txt\n?? z.txt');
});

test('setup saves an unstaged edit to a file the incoming commits delete, then fast-forwards to the commit it checked, and pulls nothing past a staged edit', () => {
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
  writeFileSync(join(other, 'new.txt'), 'new\n');
  git(other, 'add', '--all');
  git(other, 'commit', '--quiet', '-m', 'delete four files');
  git(other, 'push', '--quiet', 'origin', 'HEAD:next');
  const deletes = git(other, 'rev-parse', 'HEAD');
  writeFileSync(join(other, 'later.txt'), 'later\n');
  git(other, 'add', 'later.txt');
  git(other, 'commit', '--quiet', '-m', 'a later commit');
  git(other, 'push', '--quiet', 'origin', 'HEAD:later');
  const edited = ['[id].txt', 'a.txt', 'b.txt', 'i.txt', 'note.txt'];
  for (const name of edited) writeFileSync(join(clone, name), `local ${name}\n`);
  git(clone, 'add', 'a.txt');
  assert.match(helper('setup.mjs', clone).stdout, /not pulled, because local edits touch a\.txt\n/, 'a staged edit blocks the pull, because saving the worktree would lose its staged text');
  git(clone, 'restore', '--staged', 'a.txt');
  const betweenSaveAndPull = (body) => writeFileSync(join(clone, '.git/hooks/post-index-change'), `#!/bin/sh\n[ "$(cat note.txt 2>/dev/null)" = one ] || exit 0\n${body}\n`, { mode: 0o755 });
  betweenSaveAndPull('echo blocker > new.txt');
  assert.match(helper('setup.mjs', clone).stdout, /fast-forward failed/);
  rmSync(join(clone, 'new.txt'));
  for (const name of edited) assert.equal(readFileSync(join(clone, name), 'utf8'), `local ${name}\n`, `a failed pull puts back the edit to ${name}`);
  const kept = join(clone, '.git/pstack-kept');
  const folders = () => (existsSync(kept) ? readdirSync(kept).map((name) => join(kept, name)) : []);
  assert.deepEqual(folders(), [], 'and keeps no saved copy');
  betweenSaveAndPull('echo blocker > new.txt; echo second > note.txt');
  const raced = helper('setup.mjs', clone).stdout;
  rmSync(join(clone, 'new.txt'));
  const [held] = folders();
  assert.ok(held && raced.includes(held), raced);
  assert.match(raced, /fast-forward failed: .*; the local edits to \[id\]\.txt, a\.txt, b\.txt, note\.txt in .* were not all put back/su);
  assert.equal(readFileSync(join(clone, 'note.txt'), 'utf8'), 'second\n', 'a failed pull keeps an edit made after the save');
  assert.equal(readFileSync(join(held, 'note.txt'), 'utf8'), 'local note.txt\n', 'and keeps the saved one in the folder it names');
  for (const name of ['[id].txt', 'a.txt', 'b.txt']) assert.equal(readFileSync(join(clone, name), 'utf8'), `local ${name}\n`, `and puts back the edit to ${name}`);
  writeFileSync(join(clone, 'note.txt'), 'local note.txt\n');
  rmSync(held, { recursive: true });
  betweenSaveAndPull(`git -C '${remote}' update-ref refs/heads/next refs/heads/later && git fetch --quiet origin +refs/heads/next:refs/remotes/origin/next`);
  writeFileSync(join(clone, '.git/hooks/post-merge'), '#!/bin/sh\nkill -TERM "$PPID"\n', { mode: 0o755 });
  const out = helper('setup.mjs', clone).stdout;
  const [saved] = folders();
  assert.ok(saved && out.includes(saved), out);
  assert.match(out, /fast-forwarded next by 1 commit\(s\), saving the local edits to \[id\]\.txt, a\.txt, b\.txt, note\.txt in .*, because those commits delete them/su);
  assert.equal(git(clone, 'rev-parse', 'HEAD'), deletes, 'it merges the commit it checked, though a fetch moved origin/next meanwhile');
  for (const name of ['[id].txt', 'a.txt', 'b.txt', 'note.txt']) assert.equal(readFileSync(join(saved, name), 'utf8'), `local ${name}\n`, `the bytes of ${name} survive, though upstream puts a folder at b.txt and NOTE.txt where note.txt was`);
  assert.equal(readFileSync(join(clone, 'b.txt/x'), 'utf8'), 'x\n');
  assert.equal(readFileSync(join(clone, 'i.txt'), 'utf8'), 'local i.txt\n', 'i.txt, which [id].txt matches as a glob, keeps its own edit');
});

test('setup pulls nothing over an ignored local file that the incoming commits add', () => {
  const { dir, remote, clone } = trunk();
  git(clone, 'switch', '--quiet', 'next');
  const other = join(dir, 'other');
  git(dir, 'clone', '--quiet', '--branch', 'next', remote, other);
  writeFileSync(join(other, 'draft.txt'), 'theirs\n');
  git(other, 'add', 'draft.txt');
  git(other, 'commit', '--quiet', '-m', 'add draft.txt');
  git(other, 'push', '--quiet', 'origin', 'HEAD:next');
  writeFileSync(join(clone, '.git/info/exclude'), 'draft.txt\nscratch.txt\n');
  writeFileSync(join(clone, 'draft.txt'), 'mine\n');
  writeFileSync(join(clone, 'scratch.txt'), 'mine\n');
  const head = git(clone, 'rev-parse', 'HEAD');
  assert.match(helper('setup.mjs', clone).stdout, /fast-forward failed/);
  assert.equal(readFileSync(join(clone, 'draft.txt'), 'utf8'), 'mine\n', 'the ignored file keeps its bytes');
  assert.equal(git(clone, 'rev-parse', 'HEAD'), head);
  rmSync(join(clone, 'draft.txt'));
  assert.match(helper('setup.mjs', clone).stdout, /fast-forwarded next by 1 commit/, 'an ignored file at a path the pull leaves alone does not block it');
  assert.equal(readFileSync(join(clone, 'scratch.txt'), 'utf8'), 'mine\n');
});

