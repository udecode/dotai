import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HELPERS = join(dirname(fileURLToPath(import.meta.url)), '../assets/pstack');
const ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
  GIT_EDITOR: 'true',
  CLAUDE_CODE_HOST_SESSION_ID: '',
  CLAUDE_CODE_SESSION_ID: '',
  CODEX_SESSION_ID: '',
  PSTACK_SLOT: '1',
};
const GOOD = 'feat(a): change a\n\nWhy a changes.\n\nBeyond the ask: none';
const PR = 'feat(a): change a\n\n## Why\n\nWhy a changes.\n\n## Verification\n\n- a.txt reads two.\n\nBeyond the ask: none';

const git = (cwd, ...args) => {
  const run = spawnSync('git', args, { cwd, encoding: 'utf8', env: ENV });
  assert.equal(run.status, 0, `git ${args.join(' ')}: ${run.stderr}`);
  return run.stdout.trim();
};
const helper = (name, cwd, args = [], env = {}) =>
  spawnSync(process.execPath, [join(HELPERS, name), ...args], { cwd, encoding: 'utf8', env: { ...ENV, ...env } });

// A bare remote whose next and main hold one base commit, and a clone on a
// task branch cut from origin/next, as a session's worktree would be. With
// `lint`, the config's lintFix uppercases each file it is given.
function trunk({ lint = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sync-pstack-trunk-'));
  const remote = join(dir, 'remote.git');
  const clone = join(dir, 'clone');
  git(dir, 'init', '--quiet', '--bare', '--initial-branch=main', remote);
  // A push starts a detached `git maintenance` that repacks the objects a later local clone hardlinks.
  git(remote, 'config', 'receive.autogc', 'false');
  git(dir, 'clone', '--quiet', remote, clone);
  mkdirSync(join(clone, '.agents/pstack'), { recursive: true });
  cpSync(join(HELPERS, 'guard.mjs'), join(clone, '.agents/pstack/guard.mjs'));
  const fix = join(dir, 'fix.mjs');
  writeFileSync(fix, "import { readFileSync, writeFileSync } from 'node:fs';\nfor (const file of process.argv.slice(2)) writeFileSync(file, readFileSync(file, 'utf8').toUpperCase());\n");
  const config = { branch: 'next', protected: 'main', plans: 'docs/plans', ...(lint ? { lintFix: `node ${fix}` } : {}) };
  writeFileSync(join(clone, '.agents/pstack.json'), JSON.stringify(config));
  writeFileSync(join(clone, '.gitignore'), '.env\n.env.local\nnode_modules\n');
  writeFileSync(join(clone, 'a.txt'), 'one\n');
  writeFileSync(join(clone, 'b.txt'), 'one\n');
  git(clone, 'add', '--all');
  git(clone, 'commit', '--quiet', '-m', 'base');
  git(clone, 'push', '--quiet', 'origin', 'HEAD:main', 'HEAD:next');
  git(clone, 'fetch', '--quiet', 'origin');
  git(clone, 'switch', '--quiet', '-c', 'task', 'origin/next');
  const message = (text) => {
    const file = join(dir, `message-${Math.random().toString(36).slice(2)}`);
    writeFileSync(file, text);
    return file;
  };
  // Lands a commit on origin/next from a second clone, as another session would.
  const elsewhere = (path, text, subject) => {
    const other = join(dir, `other-${Math.random().toString(36).slice(2)}`);
    git(dir, 'clone', '--quiet', '--branch', 'next', remote, other);
    writeFileSync(join(other, path), text);
    git(other, 'add', '--all');
    git(other, 'commit', '--quiet', '-m', subject);
    return other;
  };
  return { dir, remote, clone, base: git(remote, 'rev-parse', 'next'), message, elsewhere };
}

test('land squashes the task, lints its changed files and pushes next as one commit in push mode', () => {
  const { remote, clone, base, message } = trunk({ lint: true });
  git(clone, 'config', 'pstack.delivery', 'push');
  writeFileSync(join(clone, 'a.txt'), 'two\n');
  git(clone, 'commit', '--quiet', '-am', 'wip one');
  writeFileSync(join(clone, 'e.txt'), 'more\n');
  git(clone, 'add', 'e.txt');
  git(clone, 'commit', '--quiet', '-m', 'wip two');
  writeFileSync(join(clone, 'c.txt'), 'new\n');

  const run = helper('land.mjs', clone, ['--message', message(GOOD), '--check', 'test -f c.txt']);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(git(remote, 'rev-list', '--count', `${base}..next`), '1', 'two commits and an untracked file land as one commit');
  assert.equal(git(remote, 'log', '-1', '--format=%B', 'next'), GOOD);
  assert.equal(git(remote, 'show', 'next:a.txt'), 'TWO', 'the lint fix of a changed file lands in the commit');
  assert.equal(git(remote, 'show', 'next:e.txt'), 'MORE');
  assert.equal(git(remote, 'show', 'next:c.txt'), 'NEW');
  assert.equal(git(remote, 'show', 'next:b.txt'), 'one', 'an unchanged file is not linted');
  assert.equal(git(remote, 'rev-parse', 'main'), base, 'main never moves');
  assert.equal(git(clone, 'status', '--porcelain'), '');
});

// Splits the trunk: next gains .gitprivate, which the clone's git ignores
// through core.excludesFile, and the companion repository .git-private, with
// its own bare remote, tracks a.spec from its first commit.
function split(fixture) {
  const { dir, clone } = fixture;
  writeFileSync(join(clone, '.gitprivate'), '*.spec\n');
  writeFileSync(join(clone, '.gitignore'), '.env\n.env.local\nnode_modules\n/.git-private\n');
  const config = JSON.parse(readFileSync(join(clone, '.agents/pstack.json'), 'utf8'));
  config.companion = { dir: '.git-private', list: '.gitprivate', migrate: 'node migrate.mjs', detach: 'node detach.mjs' };
  writeFileSync(join(clone, '.agents/pstack.json'), JSON.stringify(config));
  git(clone, 'add', '--all');
  git(clone, 'commit', '--quiet', '-m', 'split');
  git(clone, 'push', '--quiet', 'origin', 'HEAD:next');
  git(clone, 'fetch', '--quiet', 'origin');
  git(clone, 'config', 'core.excludesFile', join(clone, '.gitprivate'));
  const remote = join(dir, 'companion.git');
  git(dir, 'init', '--quiet', '--bare', '--initial-branch=next', remote);
  git(clone, 'init', '--quiet', '--bare', '.git-private');
  const side = (...args) => git(clone, '--git-dir=.git-private', '--work-tree=.', ...args);
  side('config', 'core.bare', 'false');
  side('remote', 'add', 'origin', remote);
  writeFileSync(join(clone, 'a.spec'), 'one\n');
  side('add', '--force', 'a.spec');
  side('commit', '--quiet', '-m', 'start');
  side('push', '--quiet', 'origin', 'HEAD:next');
  side('fetch', '--quiet', 'origin');
  return { companion: remote, side };
}

test('land commits, checks and pushes the companion half after the first, and a companion-only task lands alone', () => {
  const fixture = trunk();
  const { remote, clone, message } = fixture;
  const { companion, side } = split(fixture);
  git(clone, 'config', 'pstack.delivery', 'push');
  writeFileSync(join(clone, 'a.txt'), 'two\n');
  writeFileSync(join(clone, 'a.spec'), 'two\n');
  writeFileSync(join(clone, 'b.spec'), 'new\n');

  const run = helper('land.mjs', clone, ['--message', message(GOOD), '--check', 'test "$(cat b.spec)" = new']);
  assert.equal(run.status, 0, run.stderr);
  const landed = git(remote, 'rev-parse', 'next');
  assert.equal(git(remote, 'show', 'next:a.txt'), 'two');
  assert.equal(git(remote, 'ls-tree', '--name-only', 'next', '--', 'a.spec', 'b.spec'), '', 'no companion file lands here');
  assert.equal(git(companion, 'show', 'next:a.spec'), 'two');
  assert.equal(git(companion, 'show', 'next:b.spec'), 'new', 'a new file the list names lands in the companion');
  assert.equal(git(companion, 'log', '-1', '--format=%B', 'next'), `${GOOD}\nLands-With: ${landed}`);
  assert.equal(side('status', '--porcelain', '--untracked-files=no'), '');

  writeFileSync(join(clone, 'a.spec'), 'three\n');
  const alone = helper('land.mjs', clone, ['--message', message(GOOD)]);
  assert.equal(alone.status, 0, alone.stderr);
  assert.equal(git(remote, 'rev-parse', 'next'), landed, 'a companion-only task adds nothing here');
  assert.equal(git(companion, 'show', 'next:a.spec'), 'three');
  assert.match(git(companion, 'log', '-1', '--format=%B', 'next'), new RegExp(`Lands-With: ${landed}$`, 'u'));
});

test('land pushes a refused companion commit first on its next run', () => {
  const fixture = trunk();
  const { remote, clone, message } = fixture;
  const { companion } = split(fixture);
  git(clone, 'config', 'pstack.delivery', 'push');
  const hook = join(companion, 'hooks/pre-receive');
  writeFileSync(hook, '#!/bin/sh\nexit 1\n');
  chmodSync(hook, 0o755);
  writeFileSync(join(clone, 'a.txt'), 'two\n');
  writeFileSync(join(clone, 'a.spec'), 'two\n');

  const refused = helper('land.mjs', clone, ['--message', message(GOOD)]);
  assert.equal(refused.status, 75, refused.stderr);
  const landed = git(remote, 'rev-parse', 'next');
  assert.equal(git(remote, 'show', 'next:a.txt'), 'two', 'the first commit lands before the companion push');
  writeFileSync(hook, '#!/bin/sh\nexit 0\n');

  const rerun = helper('land.mjs', clone);
  assert.equal(rerun.status, 0, rerun.stderr);
  assert.equal(git(remote, 'rev-parse', 'next'), landed, 'the rerun lands nothing new here');
  assert.equal(git(companion, 'show', 'next:a.spec'), 'two');
});

test('land stops a branch cut before the companion list existed and names the migrate command', () => {
  const fixture = trunk();
  const { clone, message } = fixture;
  git(clone, 'branch', 'old');
  split(fixture);
  git(clone, 'config', 'pstack.delivery', 'push');
  git(clone, '--git-dir=.git', 'switch', '--quiet', 'old');
  writeFileSync(join(clone, 'a.txt'), 'two\n');

  const run = helper('land.mjs', clone, ['--message', message(GOOD)]);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /cut before \.gitprivate existed on origin\/next.*Run `node migrate\.mjs`/su);
});

test('land rebases, checks again and pushes when next moves while its checks run', () => {
  const { dir, remote, clone, message, elsewhere } = trunk();
  git(clone, 'config', 'pstack.delivery', 'push');
  const ran = join(dir, 'ran');
  const other = elsewhere('d.txt', 'theirs\n', 'docs(d): land elsewhere');
  writeFileSync(join(clone, 'a.txt'), 'two\n');

  const run = helper('land.mjs', clone, ['--message', message(GOOD), '--check', `echo run >> ${ran} && git -C ${other} push --quiet origin HEAD:next`]);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /origin\/next moved; rebasing and pushing again \(retry 1 of 3\)/);
  assert.equal(readFileSync(ran, 'utf8').trim().split('\n').length, 2, 'the rebased commit is checked before it is pushed');
  assert.deepEqual(git(remote, 'log', '--format=%s', 'main..next').split('\n'), ['feat(a): change a', 'docs(d): land elsewhere']);
});

test('land keeps a rebased commit local and unrecorded when the commit next gained while its checks ran breaks them', () => {
  const { dir, remote, clone, message, elsewhere } = trunk();
  git(clone, 'config', 'pstack.delivery', 'push');
  const ran = join(dir, 'ran');
  const runs = () => readFileSync(ran, 'utf8').trim().split('\n').length;
  const other = elsewhere('d.txt', 'theirs\n', 'docs(d): land elsewhere');
  const check = ['--check', `echo run >> ${ran} && git -C ${other} push --quiet origin HEAD:next && ! { test -e c.txt && test -e d.txt; }`];
  writeFileSync(join(clone, 'c.txt'), 'mine\n');

  const run = helper('land.mjs', clone, ['--message', message(GOOD), ...check]);
  assert.equal(run.status, 1, 'c.txt passes the check alone and fails it beside d.txt');
  assert.match(run.stdout, /origin\/next moved; rebasing and pushing again/);
  assert.match(run.stderr, /check failed: .*; the squashed commit stays local/);
  assert.deepEqual(git(remote, 'log', '--format=%s', 'main..next').split('\n'), ['docs(d): land elsewhere']);
  assert.equal(git(clone, 'rev-parse', 'HEAD^'), git(remote, 'rev-parse', 'next'), 'the commit stays rebased onto the new next');

  assert.equal(helper('land.mjs', clone, check).status, 1);
  assert.equal(runs(), 3, 'the failed recheck recorded nothing, so a rerun checks again');
  assert.deepEqual(git(remote, 'log', '--format=%s', 'main..next').split('\n'), ['docs(d): land elsewhere']);
});

test('land checks again and pushes nothing when a check fails on the tree an earlier run recorded', () => {
  const { remote, clone, message } = trunk({ lint: true });
  git(clone, 'config', 'pstack.delivery', 'push');
  const check = ['--check', 'test -z "$FAIL"'];
  declinePushes(remote, 1, ['', 'Pushes are paused.']);
  writeFileSync(join(clone, 'a.txt'), 'two\n');
  assert.equal(helper('land.mjs', clone, ['--message', message(GOOD), ...check]).status, 1, 'the push is declined after the checks pass and land.mjs records the commit');

  writeFileSync(join(clone, 'a.txt'), 'two\n');
  assert.equal(helper('land.mjs', clone, check, { FAIL: '1' }).status, 1, 'the lint fix turns the edit back into the recorded tree, where the check now fails');
  const rerun = helper('land.mjs', clone, check, { FAIL: '1' });
  assert.equal(rerun.status, 1, 'the failed check left no record that lets a rerun skip it');
  assert.match(rerun.stderr, /check failed: test -z "\$FAIL"/);
  assert.equal(git(remote, 'log', '-1', '--format=%s', 'next'), 'base');
});

// GitHub's empty GH006 is the GH006 line followed by a bare `remote: error:` line.
function declinePushes(remote, count, reasons = ['']) {
  const hook = join(remote, 'hooks', 'pre-receive');
  const lines = reasons.map((reason) => `echo "error: ${reason}" >&2\n`).join('');
  writeFileSync(
    hook,
    `#!/bin/sh\ncount=$(cat "$GIT_DIR/declines" 2>/dev/null || echo 0)\n[ "$count" -gt 0 ] || exit 0\necho $((count - 1)) > "$GIT_DIR/declines"\necho "error: GH006: Protected branch update failed for refs/heads/next." >&2\n${lines}exit 1\n`
  );
  chmodSync(hook, 0o755);
  writeFileSync(join(remote, 'declines'), `${count}\n`);
}
const NO_WAIT = { PSTACK_LAND_WAIT_SCALE: '0' };

test('land pushes again when GitHub declines with an empty GH006, and fails at once on a GH006 that gives a reason', () => {
  const { remote, clone, base, message } = trunk();
  git(clone, 'config', 'pstack.delivery', 'push');
  for (const scale of ['', 'Infinity', '-1']) {
    assert.equal(helper('land.mjs', clone, [], { PSTACK_LAND_WAIT_SCALE: scale }).status, 2, `the wait scale "${scale}" is refused`);
  }
  declinePushes(remote, 2);
  writeFileSync(join(clone, 'a.txt'), 'two\n');

  const run = helper('land.mjs', clone, ['--message', message(GOOD)], NO_WAIT);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /empty GH006; pushing again in 1 min \(retry 1 of 5\)[\s\S]*\(retry 2 of 5\)/);
  assert.equal(git(remote, 'log', '-1', '--format=%s', 'next'), 'feat(a): change a');

  declinePushes(remote, 1, ['', 'Changes must be made through a pull request.']);
  writeFileSync(join(clone, 'a.txt'), 'three\n');
  const refused = helper('land.mjs', clone, ['--message', message('feat(a): change a again\n\nWhy.\n\nBeyond the ask: none')], NO_WAIT);
  assert.equal(refused.status, 1);
  assert.doesNotMatch(refused.stdout, /pushing again/, 'a reason after a blank error line is still a reason, so it is not retried');
  assert.match(refused.stderr, /Changes must be made through a pull request/);
  assert.equal(git(remote, 'rev-list', '--count', `${base}..next`), '1');
});

test('land stops pushing again once another wait would end past 55 minutes into the run', () => {
  const { dir, remote, clone, base, message } = trunk();
  git(clone, 'config', 'pstack.delivery', 'push');
  const late = join(dir, 'late.mjs');
  writeFileSync(late, 'const now = performance.now.bind(performance);\nperformance.now = () => now() + 56 * 60_000;\n');
  declinePushes(remote, 1);
  writeFileSync(join(clone, 'a.txt'), 'two\n');

  const run = helper('land.mjs', clone, ['--message', message(GOOD)], { ...NO_WAIT, NODE_OPTIONS: `--import ${late}` });
  assert.equal(run.status, 75, run.stderr);
  assert.doesNotMatch(run.stdout, /pushing again/);
  assert.match(run.stderr, /declined the push to next with an empty GH006 once, over the 56 minutes land\.mjs has run[\s\S]*run land\.mjs again with the same --check options and no --message/);
  assert.equal(git(remote, 'rev-parse', 'next'), base);
});

test('land exits 75 with the commit local when checking a rebased commit again would end past 55 minutes into the run', () => {
  const { dir, remote, clone, message, elsewhere } = trunk();
  git(clone, 'config', 'pstack.delivery', 'push');
  const startsBeforeDeadline = 10_000;
  const checkSeconds = 6;
  const late = join(dir, 'late.mjs');
  writeFileSync(late, `const now = performance.now.bind(performance);\nperformance.now = () => now() + 55 * 60_000 - ${startsBeforeDeadline};\n`);
  const ran = join(dir, 'ran');
  const other = elsewhere('d.txt', 'theirs\n', 'docs(d): land elsewhere');
  writeFileSync(join(clone, 'a.txt'), 'two\n');

  const check = `echo run >> ${ran} && git -C ${other} push --quiet origin HEAD:next && sleep ${checkSeconds}`;
  const run = helper('land.mjs', clone, ['--message', message(GOOD), '--check', check], { NODE_OPTIONS: `--import ${late}` });
  assert.equal(run.status, 75, run.stderr);
  assert.match(run.stderr, /origin\/next moved, and checking the rebased commit again would end past 55 minutes into the run[\s\S]*run land\.mjs again with the same --check options and no --message/);
  assert.equal(readFileSync(ran, 'utf8').trim().split('\n').length, 1, 'the rebased commit is not checked');
  assert.deepEqual(git(remote, 'log', '--format=%s', 'main..next').split('\n'), ['docs(d): land elsewhere']);
});

test('a rerun after every push was declined skips the checks only while it would push the same tree, parent and message', () => {
  const { dir, remote, clone, base, message } = trunk();
  git(clone, 'config', 'pstack.delivery', 'push');
  const ran = join(dir, 'ran');
  const check = ['--check', `echo run >> ${ran}`];
  const runs = () => readFileSync(ran, 'utf8').trim().split('\n').length;
  declinePushes(remote, 99);
  writeFileSync(join(clone, 'a.txt'), 'two\n');

  const first = helper('land.mjs', clone, ['--message', message(GOOD), ...check], NO_WAIT);
  assert.equal(first.status, 75, first.stderr);
  assert.match(first.stderr, /declined the push to next with an empty GH006 6 times[\s\S]*skips the checks unless origin\/next has moved since this run last rebased onto it/);
  assert.equal(git(remote, 'rev-parse', 'next'), base, 'nothing lands while GitHub declines');

  assert.equal(helper('land.mjs', clone, ['--message', message('feat(a): change a differently\n\nWhy.\n\nBeyond the ask: none'), ...check], NO_WAIT).status, 75);
  assert.equal(runs(), 2, 'a new message runs the checks again');
  writeFileSync(join(clone, 'a.txt'), 'three\n');
  assert.equal(helper('land.mjs', clone, check, NO_WAIT).status, 75);
  assert.equal(runs(), 3, 'a changed tree runs the checks again');

  declinePushes(remote, 0);
  const rerun = helper('land.mjs', clone, check, NO_WAIT);
  assert.equal(rerun.status, 0, rerun.stderr);
  assert.match(rerun.stdout, /pushes without running the checks again/);
  assert.equal(runs(), 3, 'the unchanged commit lands without its checks');
  assert.equal(git(remote, 'show', 'next:a.txt'), 'three');
});

test('a rerun runs the checks again when next moved under an unchanged tree', () => {
  const { remote, clone, message, elsewhere } = trunk();
  git(clone, 'config', 'pstack.delivery', 'push');
  const check = ['--check', 'git diff --quiet origin/next -- a.txt'];
  declinePushes(remote, 99);
  writeFileSync(join(clone, 'b.txt'), 'two\n');
  assert.equal(helper('land.mjs', clone, ['--message', message(GOOD), ...check], NO_WAIT).status, 75);

  declinePushes(remote, 0);
  git(elsewhere('a.txt', 'two\n', 'fix(a): land elsewhere'), 'push', '--quiet', 'origin', 'HEAD:next');
  declinePushes(remote, 99);
  git(clone, 'fetch', '--quiet', 'origin');
  git(clone, 'rebase', '--quiet', 'origin/next');
  writeFileSync(join(clone, 'a.txt'), 'one\n');
  git(clone, 'commit', '--quiet', '-am', 'put a back');

  const rerun = helper('land.mjs', clone, ['--message', message(GOOD), ...check], NO_WAIT);
  assert.equal(rerun.status, 1, 'the same tree and message on a new parent is checked again, and this check now fails');
  assert.match(rerun.stderr, /check failed: git diff --quiet origin\/next -- a\.txt/);
  assert.equal(git(remote, 'log', '-1', '--format=%s', 'next'), 'fix(a): land elsewhere');
});

test('a rerun after next moved and every push was declined pushes the checked rebased commit without its checks', () => {
  const { dir, remote, clone, message, elsewhere } = trunk();
  git(clone, 'config', 'pstack.delivery', 'push');
  const ran = join(dir, 'ran');
  const other = elsewhere('d.txt', 'theirs\n', 'docs(d): land elsewhere');
  const landOther = `git -C ${other} push --quiet origin HEAD:next`;
  const startDeclining = `echo 99 > ${join(remote, 'declines')}`;
  const check = ['--check', `echo run >> ${ran} && ${landOther} && ${startDeclining}`];
  declinePushes(remote, 0);
  writeFileSync(join(clone, 'a.txt'), 'two\n');

  const first = helper('land.mjs', clone, ['--message', message(GOOD), ...check], NO_WAIT);
  assert.equal(first.status, 75, first.stderr);
  assert.match(first.stdout, /origin\/next moved; rebasing and pushing again/);

  declinePushes(remote, 0);
  const rerun = helper('land.mjs', clone, check, NO_WAIT);
  assert.equal(rerun.status, 0, rerun.stderr);
  assert.match(rerun.stdout, /pushes without running the checks again/);
  assert.equal(readFileSync(ran, 'utf8').trim().split('\n').length, 2, 'the first run checks before and after its rebase, and the rerun checks nothing');
  assert.deepEqual(git(remote, 'log', '--format=%s', 'main..next').split('\n'), ['feat(a): change a', 'docs(d): land elsewhere']);
});

test('land stops on a rebase conflict with the conflicting paths, and reruns without --message once it is resolved', () => {
  const { remote, clone, message, elsewhere } = trunk();
  const session = { CLAUDE_CODE_HOST_SESSION_ID: 'local_s1' };
  git(clone, 'config', 'pstack.delivery', 'push');
  git(elsewhere('a.txt', 'theirs\n', 'fix(a): land elsewhere'), 'push', '--quiet', 'origin', 'HEAD:next');
  writeFileSync(join(clone, 'a.txt'), 'mine\n');

  const stopped = helper('land.mjs', clone, ['--message', message(GOOD)], session);
  assert.equal(stopped.status, 1);
  assert.match(stopped.stderr, /conflicts in:\n {2}a\.txt\n/);
  assert.equal(git(remote, 'show', 'next:a.txt'), 'theirs');
  assert.match(helper('land.mjs', clone).stderr, /a rebase, merge or revert is in progress/);

  writeFileSync(join(clone, 'a.txt'), 'both\n');
  git(clone, 'add', 'a.txt');
  git(clone, 'rebase', '--continue');
  const landed = helper('land.mjs', clone, [], session);
  assert.equal(landed.status, 0, landed.stderr);
  assert.equal(git(remote, 'log', '-1', '--format=%B', 'next'), `${GOOD}\n\nSession: local_s1`, 'the rerun keeps one Session: line');
  assert.equal(git(remote, 'show', 'next:a.txt'), 'both');
});

function seedGeneratedConflict(fixture, command = 'node gen.mjs') {
  const { clone } = fixture;
  git(clone, 'config', 'pstack.delivery', 'push');
  writeFileSync(join(clone, 'gen.mjs'), "import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';\nmkdirSync('gen', { recursive: true });\nwriteFileSync('gen/out.txt', ['a.txt', 'b.txt'].map((file) => readFileSync(file, 'utf8')).join(''));\n");
  const config = JSON.parse(readFileSync(join(clone, '.agents/pstack.json'), 'utf8'));
  config.generated = [{ paths: ['gen/**'], command }];
  writeFileSync(join(clone, '.agents/pstack.json'), JSON.stringify(config));
  const edit = (dir, path, text) => {
    writeFileSync(join(dir, path), text);
    assert.equal(spawnSync(process.execPath, ['gen.mjs'], { cwd: dir }).status, 0);
  };
  edit(clone, 'a.txt', 'one\n');
  git(clone, 'add', '--all');
  git(clone, 'commit', '--quiet', '-m', 'generate');
  git(clone, 'push', '--quiet', 'origin', 'HEAD:next');
  git(clone, 'fetch', '--quiet', 'origin');
  const other = join(fixture.dir, 'other-generated');
  git(fixture.dir, 'clone', '--quiet', '--branch', 'next', fixture.remote, other);
  edit(other, 'a.txt', 'two\n');
  git(other, 'commit', '--quiet', '-am', 'fix(a): land elsewhere');
  git(other, 'push', '--quiet', 'origin', 'HEAD:next');
  return edit;
}

test('land rebuilds generated output when a rebase conflicts only there, and lands both sides of its sources', () => {
  const fixture = trunk();
  const { remote, clone, message } = fixture;
  const edit = seedGeneratedConflict(fixture);
  edit(clone, 'b.txt', 'three\n');

  const run = helper('land.mjs', clone, ['--message', message(GOOD)]);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /takes origin\/next's side of them and rebuilds them/);
  assert.equal(git(remote, 'show', 'next:gen/out.txt'), 'two\nthree', 'the output holds both sides');
  assert.deepEqual(git(remote, 'log', '--format=%s', '-2', 'next').split('\n'), ['feat(a): change a', 'fix(a): land elsewhere']);
});

test('land stops without rebuilding when a source conflicts beside the generated output, and says how to rebuild it', () => {
  const fixture = trunk();
  const { remote, clone, message } = fixture;
  const edit = seedGeneratedConflict(fixture);
  edit(clone, 'a.txt', 'mine\n');

  const stopped = helper('land.mjs', clone, ['--message', message(GOOD)]);
  assert.equal(stopped.status, 1);
  assert.match(stopped.stderr, /conflicts in:\n {2}a\.txt\n {2}gen\/out\.txt\n/);
  assert.match(stopped.stderr, /gen\/out\.txt is generated: .*`node gen\.mjs`/);
  assert.match(git(clone, 'diff', '--name-only', '--diff-filter=U'), /gen\/out\.txt/, 'the output stays unresolved for the lead');
  assert.equal(git(remote, 'show', 'next:gen/out.txt'), 'two\none');
});

test('land stops when the rebuild changes a file outside the generated paths, even one the command staged', () => {
  const fixture = trunk();
  const { remote, clone, message } = fixture;
  const edit = seedGeneratedConflict(fixture, 'node gen.mjs && echo stray > stray.txt && git add stray.txt');
  edit(clone, 'b.txt', 'three\n');

  const stopped = helper('land.mjs', clone, ['--message', message(GOOD)]);
  assert.equal(stopped.status, 1);
  assert.match(stopped.stderr, /also changed files outside its generated paths:\n {2}stray\.txt\n/);
  assert.equal(git(remote, 'show', 'next:gen/out.txt'), 'two\none');
});

test('land puts the conflicts back when the rebuild command fails', () => {
  const fixture = trunk();
  const { clone, message } = fixture;
  const edit = seedGeneratedConflict(fixture, 'node gen.mjs && exit 3');
  edit(clone, 'b.txt', 'three\n');

  const stopped = helper('land.mjs', clone, ['--message', message(GOOD)]);
  assert.equal(stopped.status, 1);
  assert.match(stopped.stderr, /failed, so land\.mjs put the conflicts back/);
  assert.match(git(clone, 'diff', '--name-only', '--diff-filter=U'), /gen\/out\.txt/, 'a lead who continues cannot land the stale side by accident');
});

test('land names the one dated plan the task changes, and no plan when it changes two or only a subject file', () => {
  const { remote, clone, message } = trunk();
  git(clone, 'config', 'pstack.delivery', 'push');
  mkdirSync(join(clone, 'docs/plans/topics'), { recursive: true });
  writeFileSync(join(clone, 'docs/plans/2026-10-18-x.md'), '# X\n');
  writeFileSync(join(clone, 'docs/plans/2026-10-18-x.decisions.tsv'), 'row\n');
  writeFileSync(join(clone, 'docs/plans/topics/x.md'), '# X\n');
  assert.equal(helper('land.mjs', clone, ['--message', message(GOOD)]).status, 0);
  assert.equal(git(remote, 'log', '-1', '--format=%B', 'next'), `${GOOD}\n\nPlan: docs/plans/2026-10-18-x.md`);

  writeFileSync(join(clone, 'docs/plans/topics/x.md'), '# X again\n');
  assert.equal(helper('land.mjs', clone, ['--message', message(GOOD)]).status, 0);
  assert.equal(git(remote, 'log', '-1', '--format=%B', 'next'), GOOD, 'a subject file alone names no plan');

  writeFileSync(join(clone, 'docs/plans/2026-10-18-x.md'), '# X closed\n');
  writeFileSync(join(clone, 'docs/plans/2026-10-18-y.md'), '# Y\n');
  assert.equal(helper('land.mjs', clone, ['--message', message(GOOD)]).status, 0);
  assert.equal(git(remote, 'log', '-1', '--format=%B', 'next'), GOOD, 'two plans name none');
});

// A gh on PATH that records its arguments and the body file, then prints a PR URL.
function stubGh(dir) {
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(
    join(bin, 'gh'),
    [
      '#!/bin/sh',
      'case "$1 $2" in',
      `  "pr create") printf '%s\\n' "$@" > '${dir}/gh-args'; cp "\${10}" '${dir}/gh-body'; echo https://example.test/pull/7 ;;`,
      `  "pr merge") printf '%s\\n' "$@" > '${dir}/gh-merge' ;;`,
      `  "api "*) cat '${dir}/gh-rules' 2>/dev/null || echo '[]' ;;`,
      'esac',
      '',
    ].join('\n')
  );
  chmodSync(join(bin, 'gh'), 0o755);
  return { PATH: `${bin}:${process.env.PATH}` };
}
const ghLines = (dir, file) => readFileSync(join(dir, file), 'utf8').trim().split('\n');
const ghArgs = (dir) => ghLines(dir, 'gh-args');

test('land pushes a topic branch and opens a PR into next when the clone has no push setting', () => {
  const { dir, remote, clone, base, message } = trunk();
  writeFileSync(join(clone, 'a.txt'), 'two\n');

  const run = helper('land.mjs', clone, ['--message', message(PR)], stubGh(dir));
  assert.equal(run.status, 0, run.stderr);
  assert.equal(git(remote, 'rev-parse', 'next'), base, 'next does not move in PR mode');
  assert.equal(git(remote, 'log', '-1', '--format=%B', 'task'), PR, 'the commit keeps its section headings');
  assert.equal(git(remote, 'log', '-1', '--format=%s', 'task'), 'feat(a): change a');
  assert.deepEqual(ghArgs(dir).slice(0, 9), ['pr', 'create', '--base', 'next', '--head', 'task', '--title', 'feat(a): change a', '--body-file']);
  assert.equal(ghArgs(dir).length, 10, 'a direct clone names no other repository');
  assert.equal(readFileSync(join(dir, 'gh-body'), 'utf8'), `${PR.split('\n').slice(2).join('\n')}\n`);
  assert.match(run.stdout, /https:\/\/example\.test\/pull\/7/);
  assert.match(run.stdout, /Auto-merge stays off: next's rules require no approval/);
  assert.equal(existsSync(join(dir, 'gh-merge')), false, 'a branch without a required approval gets no auto-merge');
});

test('land arms auto-merge only where an approval of the latest push gates the merge, with a method the rules allow', () => {
  const land = (rules) => {
    const { dir, clone, message } = trunk();
    writeFileSync(join(clone, 'a.txt'), 'two\n');
    writeFileSync(join(dir, 'gh-rules'), JSON.stringify(rules));
    const run = helper('land.mjs', clone, ['--message', message(PR)], stubGh(dir));
    assert.equal(run.status, 0, run.stderr);
    return { run, merge: existsSync(join(dir, 'gh-merge')) ? ghLines(dir, 'gh-merge') : null };
  };
  const review = (parameters) => ({ type: 'pull_request', parameters: { required_approving_review_count: 1, ...parameters } });

  const gated = land([{ type: 'deletion' }, review({ dismiss_stale_reviews_on_push: true, allowed_merge_methods: ['merge'] })]);
  assert.deepEqual(gated.merge, ['pr', 'merge', 'https://example.test/pull/7', '--auto', '--merge']);
  assert.match(gated.run.stdout, /Armed auto-merge \(merge\)/);

  assert.deepEqual(land([review({ require_last_push_approval: true })]).merge, ['pr', 'merge', 'https://example.test/pull/7', '--auto', '--squash']);

  const stale = land([review({})]);
  assert.equal(stale.merge, null, 'an approval that survives a later push does not gate what lands');
  assert.match(stale.run.stdout, /Auto-merge stays off/);
  assert.equal(land([review({ required_approving_review_count: 0, dismiss_stale_reviews_on_push: true })]).merge, null);
});

test('land in a fork clone rebases onto upstream, pushes the topic to the fork and opens the PR on upstream', () => {
  const { dir, remote, clone, message, elsewhere } = trunk();
  const fork = join(dir, 'contributor', 'remote.git');
  git(dir, 'clone', '--quiet', '--bare', remote, fork);
  git(fork, 'config', 'receive.autogc', 'false');
  git(clone, 'remote', 'rename', 'origin', 'upstream');
  git(clone, 'remote', 'add', 'origin', fork);
  git(elsewhere('d.txt', 'theirs\n', 'docs(d): land elsewhere'), 'push', '--quiet', 'origin', 'HEAD:next');
  const stale = git(fork, 'rev-parse', 'next');
  writeFileSync(join(clone, 'a.txt'), 'two\n');

  const run = helper('land.mjs', clone, ['--message', message(PR)], stubGh(dir));
  assert.equal(run.status, 0, run.stderr);
  assert.equal(git(fork, 'rev-parse', 'task^'), git(remote, 'rev-parse', 'next'), "the topic sits on upstream's next, not the fork's stale one");
  assert.equal(git(fork, 'rev-parse', 'next'), stale);
  assert.equal(spawnSync('git', ['rev-parse', '--verify', 'task'], { cwd: remote, env: ENV }).status, 128, 'nothing is pushed to upstream');
  const args = ghArgs(dir);
  assert.deepEqual([...args.slice(0, 6), ...args.slice(10)], ['pr', 'create', '--base', 'next', '--head', 'contributor:task', '--repo', `${dir.split('/').at(-1)}/remote`]);
});

// A plan-page.mjs that prints what land.mjs reads from the real one: the body file, then one --attach line.
// It refuses a plan that says "no brief", as the real one refuses a plan without a ## Brief.
function stubPlanPage(clone) {
  writeFileSync(
    join(clone, '.agents/pstack/plan-page.mjs'),
    `import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const [plan, flag] = process.argv.slice(2);
if (flag !== '--pr' || readFileSync(plan, 'utf8').includes('no brief')) {
  console.error(\`\${plan} needs a ## Brief before --pr\`);
  process.exit(1);
}
mkdirSync('docs/plans/artifacts', { recursive: true });
writeFileSync('docs/plans/artifacts/x.pr.md', \`<!-- plan-page:start -->\\nThe page of \${plan}\\n<!-- plan-page:end -->\\n\`);
console.info(\`\${process.cwd()}/docs/plans/artifacts/x.pr.md\\n--attach ./docs/plans/shots/after.png\`);
`
  );
  mkdirSync(join(clone, 'docs/plans'), { recursive: true });
}
const PAGE = '<!-- plan-page:start -->\nThe page of docs/plans/2026-10-18-x.md\n<!-- plan-page:end -->\n';

test('land opens the PR with the page of the one plan the task changes, with its frames attached', () => {
  const { dir, clone, message } = trunk();
  stubPlanPage(clone);
  writeFileSync(join(clone, 'docs/plans/2026-10-18-x.md'), '# X\n');

  const run = helper('land.mjs', clone, ['--message', message(GOOD)], stubGh(dir));
  assert.equal(run.status, 0, run.stderr);
  assert.equal(readFileSync(join(dir, 'gh-body'), 'utf8'), PAGE);
  assert.deepEqual(ghArgs(dir).slice(10), ['--attach', './docs/plans/shots/after.png']);
});

test('land stops before the push when plan-page refuses the plan, and the fixed plan reruns without --message', () => {
  const { dir, remote, clone, message } = trunk();
  stubPlanPage(clone);
  writeFileSync(join(clone, 'docs/plans/2026-10-18-x.md'), '# X\n\nno brief\n');
  const gh = stubGh(dir);

  const refused = helper('land.mjs', clone, ['--message', message(GOOD)], gh);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /plan-page\.mjs refused docs\/plans\/2026-10-18-x\.md, so nothing was pushed:\ndocs\/plans\/2026-10-18-x\.md needs a ## Brief/u);
  assert.equal(spawnSync('git', ['rev-parse', '--verify', 'task'], { cwd: remote, env: ENV }).status, 128, 'no topic branch reaches the remote');
  assert.equal(existsSync(join(dir, 'gh-args')), false, 'no PR is opened');

  writeFileSync(join(clone, 'docs/plans/2026-10-18-x.md'), '# X\n');
  const landed = helper('land.mjs', clone, [], gh);
  assert.equal(landed.status, 0, landed.stderr);
  assert.equal(readFileSync(join(dir, 'gh-body'), 'utf8'), PAGE);
});

test('land in a direct clone without push access says to fork and add upstream', () => {
  const { dir, remote, clone, message } = trunk();
  writeFileSync(join(remote, 'hooks', 'pre-receive'), '#!/bin/sh\necho "Permission to t/remote.git denied to c." >&2\nexit 1\n');
  chmodSync(join(remote, 'hooks', 'pre-receive'), 0o755);
  writeFileSync(join(clone, 'a.txt'), 'two\n');

  const run = helper('land.mjs', clone, ['--message', message(PR)], stubGh(dir));
  assert.equal(run.status, 1);
  assert.match(run.stderr, /^land\.mjs: this clone cannot push to origin: fork the repository, .*add the canonical repository as `upstream`/u);
  assert.equal(existsSync(join(dir, 'gh-args')), false, 'no PR is opened');
});

test('land refuses a message without a Conventional subject or a Beyond the ask line and changes nothing', () => {
  const { remote, clone, base, message } = trunk();
  git(clone, 'config', 'pstack.delivery', 'push');
  writeFileSync(join(clone, 'a.txt'), 'two\n');
  const head = git(clone, 'rev-parse', 'HEAD');

  const noBeyond = helper('land.mjs', clone, ['--message', message('feat(a): change a\n\nWhy a changes.\n')]);
  assert.equal(noBeyond.status, 1);
  assert.match(noBeyond.stderr, /the body has no `Beyond the ask:` line/);
  const badSubject = helper('land.mjs', clone, ['--message', message('Change a.\n\nBeyond the ask: none\n')]);
  assert.equal(badSubject.status, 1);
  assert.match(badSubject.stderr, /is not one Conventional Commit/);
  assert.equal(git(remote, 'rev-parse', 'next'), base);
  assert.equal(git(clone, 'rev-parse', 'HEAD'), head);
  assert.equal(git(clone, 'status', '--porcelain'), 'M a.txt');
});

test('land refuses a closing keyword right before an issue reference, and lands a message that names the issue as <repo>#<N>', () => {
  const { remote, clone, base, message } = trunk();
  git(clone, 'config', 'pstack.delivery', 'push');
  writeFileSync(join(clone, 'a.txt'), 'two\n');

  for (const [text, name] of [
    ['feat(a): change a\n\nRan triage fix #5228 on it.\n\nBeyond the ask: none\n', 'remote'],
    ['docs(a): resolve #12\n\nBeyond the ask: none\n', 'remote'],
    ['feat(a): change a\n\nCloses: udecode/plate#12\n\nBeyond the ask: none\n', 'plate'],
    ['feat(a): change a\n\nFixed https://github.com/udecode/plate-private/issues/5228 here.\n\nBeyond the ask: none\n', 'plate-private'],
  ]) {
    const run = helper('land.mjs', clone, ['--message', message(text)]);
    assert.equal(run.status, 1, text);
    assert.match(run.stderr, new RegExp(`closes an issue .*write \`${name}#<N>\``, 'u'), text);
  }
  assert.equal(git(remote, 'rev-parse', 'next'), base);

  const run = helper('land.mjs', clone, ['--message', message('feat(a): change a\n\nRan triage fix remote#5228; see #12, prefix #7, fixture/plate#12, fix #3b82f6.\n\nBeyond the ask: none\n')]);
  assert.equal(run.status, 0, run.stderr);
  assert.notEqual(git(remote, 'rev-parse', 'next'), base);
});

const FIX = 'fix(a): repair a\n\nBeyond the ask: none';
for (const [name, args, refusal] of [
  ['names no commit that introduced its bug', ({ message }) => ['--message', message(FIX)], /names no commit that introduced its bug/],
  ['leaves its Introduced-by line empty', ({ message }) => ['--message', message(`${FIX}\nIntroduced-by: `)], /an `Introduced-by:` line has no value/],
  ['names an unknown commit', ({ message }) => ['--message', message(`${FIX}\nIntroduced-by: 0123456789abcdef0123456789abcdef01234567`)], /Introduced-by: 0123456789abcdef0123456789abcdef01234567 names no commit/],
  [
    'names a commit next does not contain',
    ({ clone, message }) => ['--message', message(`${FIX}\nIntroduced-by: ${git(clone, 'commit-tree', '-p', 'HEAD', '-m', 'local only', 'HEAD^{tree}')}`)],
    /Introduced-by: \w+ names a commit origin\/next does not contain/,
  ],
  ['names a commit beside none', ({ base, message }) => ['--message', message(`${FIX}\nIntroduced-by: none\nIntroduced-by: ${base}`)], /`Introduced-by: none` cannot stand beside another `Introduced-by:` line/],
  ['writes no space after the colon, which review.mjs would read as Beyond the ask text', ({ message }) => ['--message', message(`${FIX}\nIntroduced-by:none`)], /with a space after the colon/],
  ['writes a tab after the colon', ({ message }) => ['--message', message(`${FIX}\nIntroduced-by:\tnone`)], /with a space after the colon/],
  ['names a known commit in capitals', ({ base, message }) => ['--message', message(`${FIX}\nIntroduced-by: ${base.toUpperCase()}`)], /is not a lowercase sha of 7 to 40 characters/],
  ['names a known commit with its subject', ({ base, message }) => ['--message', message(`${FIX}\nIntroduced-by: ${base.slice(0, 12)} ("base")`)], /is not a lowercase sha of 7 to 40 characters/],
  [
    'reruns without --message from a HEAD that names no cause',
    ({ clone }) => {
      git(clone, 'commit', '--quiet', '-am', FIX);
      return [];
    },
    /names no commit that introduced its bug/,
  ],
]) {
  test(`land refuses a fix that ${name}`, () => {
    const lane = trunk();
    git(lane.clone, 'config', 'pstack.delivery', 'push');
    writeFileSync(join(lane.clone, 'a.txt'), 'two\n');

    const run = helper('land.mjs', lane.clone, args(lane));
    assert.equal(run.status, 1);
    assert.match(run.stderr, refusal);
    assert.equal(git(lane.remote, 'rev-parse', 'next'), lane.base);
  });
}

test('land takes a fix that names a commit on next or none, and any other type without the line', () => {
  const { remote, clone, base, message } = trunk();
  git(clone, 'config', 'pstack.delivery', 'push');
  const landed = (text) => {
    writeFileSync(join(clone, 'a.txt'), `${text}\n`);
    const run = helper('land.mjs', clone, ['--message', message(text)]);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(git(remote, 'log', '-1', '--format=%B', 'next'), text);
  };
  landed(GOOD);
  landed(`fix(a)!: repair a\n\nBeyond the ask: none\nIntroduced-by: ${base}\nIntroduced-by: ${git(remote, 'rev-parse', '--short', 'next')}`);
  landed('fix: repair a again\n\nBeyond the ask: none\nIntroduced-by: none');
});

test('land refuses a PR whose body is the commit body without Why and Verification text, and puts the task commits back', () => {
  const { dir, remote, clone, message } = trunk();
  writeFileSync(join(clone, 'a.txt'), 'two\n');
  git(clone, 'commit', '--quiet', '-am', 'wip');
  const head = git(clone, 'rev-parse', 'HEAD');
  const gh = stubGh(dir);

  const bare = helper('land.mjs', clone, ['--message', message(GOOD)], gh);
  assert.equal(bare.status, 1);
  assert.match(bare.stderr, /needs a `## Why` section and a `## Verification` section with text/);
  const empty = helper('land.mjs', clone, ['--message', message('feat(a): change a\n\n## Why\n\nWhy a changes.\n\n## Verification\n\n<!-- Each real run path and its outcome. -->\n\nBeyond the ask: none')], gh);
  assert.equal(empty.status, 1);
  assert.match(empty.stderr, /needs a `## Verification` section with text/);
  assert.equal(git(clone, 'rev-parse', 'HEAD'), head, 'the task commits are back as they were');
  assert.equal(spawnSync('git', ['rev-parse', '--verify', 'task'], { cwd: remote, env: ENV }).status, 128, 'no topic branch reaches the remote');
  assert.equal(existsSync(join(dir, 'gh-args')), false, 'no PR is opened');

  const landed = helper('land.mjs', clone, ['--message', message(PR)], gh);
  assert.equal(landed.status, 0, landed.stderr);
});

test('review groups the commits to review by session, --done marks one session reviewed, and --mark marks all', () => {
  const { clone } = trunk();
  assert.match(helper('review.mjs', clone, ['--mark']).stdout, /Marked origin\/next at \w+ as reviewed/);
  const land = (file, subject, body) => {
    writeFileSync(join(clone, file), `${subject}\n`);
    git(clone, 'add', file);
    git(clone, 'commit', '--quiet', '-m', subject, '-m', body);
    return git(clone, 'rev-parse', 'HEAD');
  };
  const one = land('one.txt', 'feat(a): one', 'Beyond the ask: none\n\nSession: local_s1\nPlan: docs/plans/2026-10-17-x.md');
  land('two.txt', 'fix(b): two', `No plan here.\n\nBeyond the ask: renamed c\nIntroduced-by: ${one}\n\nSession: s2`);
  const three = land('three.txt', 'docs(a): three', 'See docs/plans/2026-10-17-x.md.\n\nBeyond the ask: none\n\nSession: local_s1');
  const four = land('four.txt', 'chore: four', 'Beyond the ask: none');
  git(clone, 'push', '--quiet', 'origin', 'HEAD:next');
  const reviewed = () => git(clone, 'rev-parse', 'refs/pstack/reviewed');

  const listed = helper('review.mjs', clone).stdout;
  assert.match(listed, /^4 commit\(s\) to review on origin\/next since refs\/pstack\/reviewed/);
  assert.match(
    listed,
    /\n\nSession local_s1 \(claude:\/\/claude\.ai\/epitaxy\/local_s1\)\n {2}\w+ feat\(a\): one\n {4}docs\/plans\/2026-10-17-x\.md\n {4}Beyond the ask: none\n {2}\w+ docs\(a\): three\n {4}docs\/plans\/2026-10-17-x\.md\n {4}Beyond the ask: none\n {2}Net: node \.agents\/pstack\/review\.mjs --net local_s1\n\nSession s2\n {2}\w+ fix\(b\): two\n {4}No plan link\n {4}Beyond the ask: renamed c\n\nNo Session: line \(--done none\)\n {2}\w+ chore: four\n/
  );
  assert.equal(helper('review.mjs', clone, ['--done']).status, 2);

  assert.match(helper('review.mjs', clone, ['--done', 'local_s1']).stdout, /Marked 2 commit\(s\) of session local_s1 as reviewed\. refs\/pstack\/reviewed is now at \w+\./);
  assert.equal(reviewed(), one, 'the ref stops before the oldest commit still to review');
  const left = helper('review.mjs', clone).stdout;
  assert.match(left, /^2 commit\(s\) to review/);
  assert.doesNotMatch(left, /local_s1/);
  assert.equal(helper('review.mjs', clone, ['--done', 'local_s1']).status, 1, 'a session with nothing left to review');

  helper('review.mjs', clone, ['--done', 's2']);
  assert.equal(reviewed(), three, 'the ref passes a commit reviewed earlier');
  helper('review.mjs', clone, ['--done', 'none']);
  assert.equal(reviewed(), four);
  assert.match(helper('review.mjs', clone).stdout, /^No commits to review on origin\/next since refs\/pstack\/reviewed/);

  land('five.txt', 'feat(a): five', 'Beyond the ask: none\n\nSession: s3');
  git(clone, 'push', '--quiet', 'origin', 'HEAD:next');
  helper('review.mjs', clone, ['--mark']);
  assert.match(helper('review.mjs', clone).stdout, /^No commits to review/);
  assert.equal(helper('review.mjs', clone, ['--tier', 'public']).status, 2, 'a tier needs reviewPaths');
});

test('review lists a tier and weakened tests, needs no review for skipped paths, and --net cancels what a session undid', () => {
  const { clone } = trunk();
  const reviewPaths = { skip: ['docs/**', '**/index.ts'], tests: ['**/*.test.*'], public: ['packages/**'] };
  writeFileSync(join(clone, '.agents/pstack.json'), JSON.stringify({ branch: 'next', protected: 'main', plans: 'docs/plans', reviewPaths }));
  helper('review.mjs', clone, ['--mark']);
  const land = (files, subject, body) => {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(clone, path)), { recursive: true });
      writeFileSync(join(clone, path), text);
      git(clone, 'add', path);
    }
    git(clone, 'commit', '--quiet', '-m', subject, '-m', body);
    return git(clone, 'rev-parse', 'HEAD');
  };
  const spec = 'packages/a/x.test.ts';
  land({ [spec]: "it('a', () => {\n  expect(1).toBe(1);\n  expect(2).toBe(2);\n});\n" }, 'test(a): cover a', 'Beyond the ask: none\n\nSession: s0');
  land({ 'packages/a/src/x.ts': 'one\ntemp\n' }, 'feat(a): add x', 'Beyond the ask: renamed\nthe helper\nSession: local_s1');
  const docs = land({ 'docs/plans/p.md': 'plan\n', 'packages/a/index.ts': 'export {};\n' }, 'docs(plans): add p', 'Beyond the ask: none\n\nSession: s2');
  land({ 'apps/web/y.ts': 'y\n' }, 'feat(web): add y', 'Beyond the ask: none\n\nShipped fast, no review.\n\nSession: s3');
  land({ 'packages/a/src/x.ts': 'one\n', 'packages/a/src/z.ts': 'z\n' }, 'fix(a): drop temp', 'Beyond the ask: none\n\nSession: local_s1');
  const tip = land({ [spec]: "it('a', () => {\n  expect(1).toBe(1);\n});\nit.skip('b', () => {});\n" }, 'test(a): trim a', 'Beyond the ask: none\n\nSession: s4');
  git(clone, 'push', '--quiet', 'origin', 'HEAD:next');
  const reviewed = () => git(clone, 'rev-parse', 'refs/pstack/reviewed');

  const listed = helper('review.mjs', clone).stdout;
  assert.match(listed, /^3 commit\(s\) with public changes or weakened tests to review on origin\/next since refs\/pstack\/reviewed/);
  assert.match(listed, /\n\nSession local_s1 .*\n {2}\w+ feat\(a\): add x\n.*\n {4}Beyond the ask: renamed the helper\n {4}1 public file\(s\): packages\/a\/src\/x\.ts\n {2}\w+ fix\(a\): drop temp\n.*\n.*\n {4}2 public file\(s\): packages\/a\/src\/x\.ts, packages\/a\/src\/z\.ts\n {2}Net: node \.agents\/pstack\/review\.mjs --net local_s1\n/);
  assert.match(listed, /\n\nSession s4\n {2}\w+ test\(a\): trim a\n.*\n.*\n {4}Tests: 1 fewer expect or assert lines, 1 more \.skip or \.todo calls\n/);
  assert.doesNotMatch(listed, /Session s[023]\b/);
  assert.match(listed, /\n1 more commit\(s\) change internal paths and no public ones; --tier internal lists them/);
  assert.match(listed, /\n2 commit\(s\) change only skipped paths or add tests, and need no review\.\n$/, 'skip wins over public, and a path no list names is internal');

  const internal = helper('review.mjs', clone, ['--tier', 'internal']).stdout;
  assert.match(internal, /\n\nSession s3\n {2}\w+ feat\(web\): add y\n.*\n.*\n {4}1 internal file\(s\): apps\/web\/y\.ts\n {4}Shipped fast, no review\.\n/);
  assert.match(internal, /Session s4/, 'weakened tests show in every tier');

  const net = helper('review.mjs', clone, ['--net', 'local_s1']);
  assert.equal(net.status, 0, net.stderr);
  assert.match(net.stdout, /^Net diff of session local_s1's 2 commit\(s\) in public paths/);
  assert.match(net.stdout, /\+one\n/);
  assert.match(net.stdout, /\+z\n/);
  assert.doesNotMatch(net.stdout, /temp/, 'the second commit cancels the line the first added');

  helper('review.mjs', clone, ['--done', 'local_s1']);
  assert.equal(reviewed(), docs, 'the ref passes commits that need no review and stops before s3');
  helper('review.mjs', clone, ['--done', 's3']);
  helper('review.mjs', clone, ['--done', 's4']);
  assert.equal(reviewed(), tip);
  assert.match(helper('review.mjs', clone).stdout, /^No commits with public changes or weakened tests to review/);
});

const ONE = 'local_aaaaaaaa-1111';
const TWO = 'local_aaaaaaaa-1111-2';

function sessions() {
  const repo = trunk();
  const { dir, clone, message } = repo;
  git(clone, 'config', 'pstack.delivery', 'push');
  const land = (files, subject, session) => {
    for (const [path, text] of Object.entries(files)) writeFileSync(join(clone, path), text);
    const run = helper('land.mjs', clone, ['--message', message(`${subject}\n\nWhy.\n\nBeyond the ask: none`)], { CLAUDE_CODE_HOST_SESSION_ID: session });
    assert.equal(run.status, 0, run.stderr);
    return git(clone, 'rev-parse', 'HEAD');
  };
  const first = land({ 'a.txt': 'two\n', 'c.txt': 'c\n' }, 'feat(a): one changes a', ONE);
  const second = land({ 'b.txt': 'two\n' }, 'feat(b): two changes b', TWO);
  const worktree = join(dir, 'worktree');
  git(clone, 'worktree', 'add', '--quiet', '-b', 'undo', worktree, second);
  const third = land({ 'c.txt': 'c again\n', 'd.txt': 'd\n' }, 'feat(d): one changes c and adds d', ONE);
  return { ...repo, land, worktree, first, third };
}

test('review --revert lands one fix commit that undoes every commit of a session and keeps the others', () => {
  const { remote, worktree, first, third } = sessions();

  const run = helper('review.mjs', worktree, ['--revert', ONE]);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(git(remote, 'rev-list', '--count', `${third}..next`), '1', 'the revert lands as one commit');
  assert.equal(git(remote, 'show', 'next:a.txt'), 'one');
  assert.equal(git(remote, 'ls-tree', '--name-only', 'next', '--', 'c.txt', 'd.txt'), '');
  assert.equal(git(remote, 'show', 'next:b.txt'), 'two', 'a session whose id only starts with the reverted one keeps its commit');
  const body = git(remote, 'log', '-1', '--format=%B', 'next');
  assert.equal(body.split('\n')[0], 'fix(revert): undo session aaaaaaaa');
  assert.match(body, /^Beyond the ask: none$/mu);
  assert.deepEqual([...body.matchAll(/^Introduced-by: (\S+)$/gmu)].map(([, sha]) => sha).sort(), [first, third].sort());
});

test('review --revert --stage stages the revert, pushes nothing, and lands with the command it prints', () => {
  const { remote, worktree, third } = sessions();

  const staged = helper('review.mjs', worktree, ['--revert', ONE, '--stage', '--check', 'true']);
  assert.equal(staged.status, 0, staged.stderr);
  assert.equal(git(remote, 'rev-parse', 'next'), third, 'nothing is pushed');
  assert.deepEqual(git(worktree, 'diff', '--cached', '--name-only').split('\n').sort(), ['a.txt', 'c.txt', 'd.txt']);
  const [, message, check] = staged.stdout.match(/land\.mjs --message (\S+) --check '([^']+)'/u);
  assert.equal(check, 'true');

  const landed = helper('land.mjs', worktree, ['--message', message, '--check', check]);
  assert.equal(landed.status, 0, landed.stderr);
  assert.equal(git(remote, 'rev-list', '--count', `${third}..next`), '1');
  assert.equal(git(remote, 'show', 'next:a.txt'), 'one');
  assert.equal(helper('review.mjs', worktree, ['--stage']).status, 2, '--stage needs --revert');
});

test('review --revert in a clone that delivers by PR opens one whose body has a Why and a Verification that names the checks', () => {
  const { dir, clone, worktree } = sessions();
  git(clone, 'config', '--unset', 'pstack.delivery');

  const run = helper('review.mjs', worktree, ['--revert', ONE, '--check', 'true'], stubGh(dir));
  assert.equal(run.status, 0, run.stderr);
  const body = readFileSync(join(dir, 'gh-body'), 'utf8');
  assert.match(body, /^## Why\n\nReverts every commit session /mu);
  assert.match(body, /^## Verification\n\nland\.mjs ran `true` on the reverted tree before landing it\.$/mu);
});

test('review --revert stops on a conflict before its last commit, land refuses until the revert is continued, and then lands it whole', () => {
  const { remote, worktree, land } = sessions();
  const tip = land({ 'd.txt': 'd elsewhere\n' }, 'feat(d): three changes d', 'cccccccc');

  const stopped = helper('review.mjs', worktree, ['--revert', ONE]);
  assert.equal(stopped.status, 1);
  assert.match(stopped.stderr, /conflicts in:\n {2}d\.txt\n/);
  assert.equal(git(remote, 'rev-parse', 'next'), tip, 'nothing is pushed');

  git(worktree, 'rm', '--quiet', 'd.txt');
  const message = stopped.stderr.match(/--message ([^\s`]+)/u)[1];
  const early = helper('land.mjs', worktree, ['--message', message]);
  assert.equal(early.status, 1, 'a revert with commits left to apply');
  assert.match(early.stderr, /a rebase, merge or revert is in progress/);
  assert.equal(git(remote, 'rev-parse', 'next'), tip, 'nothing is pushed before the revert is continued');

  git(worktree, 'revert', '--continue');
  const landed = helper('land.mjs', worktree, ['--message', message]);
  assert.equal(landed.status, 0, landed.stderr);
  assert.equal(git(remote, 'rev-list', '--count', `${tip}..next`), '1');
  assert.equal(git(remote, 'show', 'next:a.txt'), 'one');
  assert.equal(git(remote, 'show', 'next:b.txt'), 'two');
  assert.equal(git(remote, 'ls-tree', '--name-only', 'next', '--', 'c.txt', 'd.txt'), '');
});

test('review --revert refuses a session no commit on next names in full', () => {
  const { remote, worktree, third } = sessions();
  const run = helper('review.mjs', worktree, ['--revert', 'aaaaaaaa']);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /no commit on origin\/next has the line Session: aaaaaaaa/);
  assert.equal(git(remote, 'rev-parse', 'next'), third);
});

test('review --revert refuses the main checkout', () => {
  const { remote, clone, third } = sessions();
  const run = helper('review.mjs', clone, ['--revert', ONE]);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /not in the main checkout/);
  assert.equal(git(remote, 'rev-parse', 'next'), third);
});

test('review --revert refuses a worktree with uncommitted changes, which the revert would carry', () => {
  const { remote, worktree, third } = sessions();
  writeFileSync(join(worktree, 'e.txt'), 'e\n');
  const run = helper('review.mjs', worktree, ['--revert', ONE]);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /uncommitted changes/);
  assert.equal(git(remote, 'rev-parse', 'next'), third);
});

test('review --revert refuses a worktree with commits next lacks, which the revert would carry', () => {
  const { remote, worktree, third } = sessions();
  writeFileSync(join(worktree, 'e.txt'), 'e\n');
  git(worktree, 'add', 'e.txt');
  git(worktree, 'commit', '--quiet', '-m', 'local');
  const run = helper('review.mjs', worktree, ['--revert', ONE]);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /HEAD has commits that origin\/next lacks/);
  assert.equal(git(remote, 'rev-parse', 'next'), third);
});

test('review --revert refuses a session that landed a merge commit', () => {
  const { remote, clone, worktree } = sessions();
  git(clone, 'switch', '--quiet', '-c', 'side', 'HEAD~1');
  writeFileSync(join(clone, 'e.txt'), 'e\n');
  git(clone, 'add', 'e.txt');
  git(clone, 'commit', '--quiet', '-m', 'side');
  git(clone, 'switch', '--quiet', 'task');
  git(clone, 'merge', '--quiet', '--no-ff', 'side', '-m', 'feat(e): merge side', '-m', `Beyond the ask: none\n\nSession: ${ONE}`);
  git(clone, 'push', '--quiet', 'origin', 'HEAD:next');
  const tip = git(clone, 'rev-parse', 'HEAD');

  const run = helper('review.mjs', worktree, ['--revert', ONE]);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /merge commit/);
  assert.equal(git(remote, 'rev-parse', 'next'), tip);
});

test('review --revert leaves the revert local and pushes nothing when a check fails', () => {
  const { remote, worktree, third } = sessions();
  const run = helper('review.mjs', worktree, ['--revert', ONE, '--check', 'false']);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /check failed: false/);
  assert.equal(git(remote, 'rev-parse', 'next'), third);
  assert.equal(git(worktree, 'log', '-1', '--format=%s'), 'fix(revert): undo session aaaaaaaa');
});

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
    "bash -c 'git push -f origin main'",
    'echo "$(git push -f origin next)"',
    'git push origin --delete next',
    'git push origin :main',
    "bash -e -c 'git push --force origin HEAD:next'",
    "bash -c -- 'git push -f origin main'",
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
    "cat <<'EOF'\ngit push -f origin next\nEOF",
    "bash -e -c 'git push --force origin task'",
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
    "bash -c 'gh pr create --base next'",
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
    "cat <<'EOF'\ngh pr create\nEOF",
  ];
  for (const command of passed) assert.equal(guard(command), null, command);
});

test('guard denies a command that would delete or overwrite the companion files, and passes the rest', () => {
  const fixture = trunk();
  const { dir, clone } = fixture;
  const old = git(clone, 'rev-parse', 'HEAD');
  split(fixture);
  const session = join(dir, 'session');
  const plain = join(dir, 'plain');
  git(clone, 'worktree', 'add', '--quiet', '--detach', session);
  git(clone, 'worktree', 'add', '--quiet', '--detach', plain);
  writeFileSync(join(session, '.git-private'), 'gitdir: elsewhere\n');
  const guard = (command, cwd = clone) => {
    const run = spawnSync(process.execPath, [join(clone, '.agents/pstack/guard.mjs')], {
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd }),
      encoding: 'utf8',
      env: ENV,
    });
    assert.equal(run.status, 0, run.stderr);
    return run.stdout ? JSON.parse(run.stdout).hookSpecificOutput : null;
  };
  const denied = {
    'git clean -fdx': /git clean -x or -X/u,
    'git clean -fX': /git clean -x or -X/u,
    'git --git-dir=.git-private --work-tree=. clean -fd': /deletes every public file/u,
    [`git checkout ${old}`]: /has no \.gitprivate/u,
    [`git switch --detach ${old}`]: /has no \.gitprivate/u,
    [`cd x && git reset --hard ${old}`]: /has no \.gitprivate/u,
    [`git rebase ${old}`]: /has no \.gitprivate/u,
    [`git worktree remove --force ${session}`]: /Run `node detach\.mjs` inside/u,
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
    `git worktree remove --force ${plain}`,
    'git --git-dir=.git-private --work-tree=. status',
  ];
  for (const command of passed) assert.equal(guard(command), null, command);
  assert.equal(guard('git clean -fdx', plain), null, 'a checkout without the companion directory has nothing of it to lose');
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

test('guard denies an edit in the main checkout on next or main, except the artifacts that hold the ledger, and passes a worktree or a task branch', () => {
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
  const dangling = join(dir, 'dangling.txt');
  symlinkSync(join(clone, 'new.txt'), dangling);
  mkdirSync(join(clone, 'docs/plans/artifacts/run'), { recursive: true });
  mkdirSync(join(clone, 'sub'));
  symlinkSync(join(clone, 'sub'), join(clone, 'docs/plans/artifacts/escape'));
  symlinkSync(`${join(clone, 'docs/plans/artifacts/escape')}/..`, join(dir, 'up'));
  symlinkSync(join(clone, 'docs/plans/artifacts/run'), join(clone, 'sub/into'));
  symlinkSync(`${join(clone, 'sub/into')}/..`, join(dir, 'down'));
  git(clone, 'switch', '--quiet', 'next');
  const denied = [
    ['Edit', 'a.txt'],
    ['Write', join(clone, 'src/new/b.ts')],
    ['NotebookEdit', 'c.ipynb'],
    ['Write', alias],
    ['Write', dangling],
    ['Edit', 'docs/plans/artifacts/escape/../a.txt'],
    ['Write', join(dir, 'up/a.txt')],
    ['Edit', join(clone, '.git/HEAD')],
  ];
  for (const [tool, path] of denied) {
    const decision = edit(tool, path);
    assert.equal(decision?.permissionDecision, 'deny', path);
    assert.match(decision.permissionDecisionReason, /Move to your own worktree/u);
  }
  const fromTree = edit('Write', join(clone, 'docs/plans/x.md'), { from: tree, cwd: tree });
  assert.equal(fromTree?.permissionDecision, 'deny', "the worktree's own guard finds the main checkout");
  assert.ok(fromTree.permissionDecisionReason.includes(join(tree, 'docs/plans/x.md')), 'the reason names the same file in the worktree');
  for (const path of ['docs/plans/artifacts/run/log.txt', join(dir, 'down/kept.txt'), join(tree, 'a.txt')]) {
    assert.equal(edit('Write', path), null, path);
  }
  const broken = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'broken', GIT_CONFIG_VALUE_0: '1' };
  assert.equal(edit('Write', 'docs/plans/artifacts/run/log.txt', { env: broken })?.permissionDecision, 'deny', 'a git failure refuses the edit');
  git(clone, 'switch', '--quiet', 'main');
  assert.equal(edit('Edit', 'a.txt')?.permissionDecision, 'deny', 'the protected branch is guarded too');
  git(clone, 'switch', '--quiet', '--detach');
  assert.equal(edit('Edit', 'a.txt')?.permissionDecision, 'deny', 'a detached main checkout, such as a stopped rebase, is guarded');
  git(clone, 'switch', '--quiet', 'task');
  assert.equal(edit('Edit', 'a.txt'), null, 'a main checkout on a task branch is not guarded');
  const config = join(clone, '.agents/pstack.json');
  writeFileSync(config, JSON.stringify({ ...JSON.parse(readFileSync(config, 'utf8')), branch: ['task'] }));
  assert.equal(edit('Edit', 'a.txt')?.permissionDecision, 'deny', 'a config without a branch name refuses the edit');
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
