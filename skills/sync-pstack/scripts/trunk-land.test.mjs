import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { test } from 'node:test';
import { declinePushes, ENV, ghArgs, ghLines, git, GOOD, helper, HELPERS, isAlive, NO_WAIT, PR, seedGeneratedConflict, split, stubGh, trunk, until } from './test-trunk.mjs';

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
  assert.equal(git(remote, 'log', '-1', '--format=%B', 'next'), `${GOOD}\n\nLead: unknown`);
  assert.equal(git(remote, 'show', 'next:a.txt'), 'TWO', 'the lint fix of a changed file lands in the commit');
  assert.equal(git(remote, 'show', 'next:e.txt'), 'MORE');
  assert.equal(git(remote, 'show', 'next:c.txt'), 'NEW');
  assert.equal(git(remote, 'show', 'next:b.txt'), 'one', 'an unchanged file is not linted');
  assert.equal(git(remote, 'rev-parse', 'main'), base, 'main never moves');
  assert.equal(git(clone, 'status', '--porcelain'), '');
});

test('land refuses a checkout cut from a working branch that the config on origin\'s default branch has retired', () => {
  const { dir, remote, clone, base, message } = trunk();
  git(clone, 'config', 'pstack.delivery', 'push');
  const other = join(dir, 'retire');
  git(dir, 'clone', '--quiet', '--branch', 'main', remote, other);
  writeFileSync(join(other, '.agents/pstack.json'), JSON.stringify({ branch: 'main', plans: 'docs/plans' }));
  git(other, 'commit', '--quiet', '-am', 'retire next');
  git(other, 'push', '--quiet', 'origin', 'HEAD:main');
  writeFileSync(join(clone, 'a.txt'), 'two\n');

  const run = helper('land.mjs', clone, ['--message', message(GOOD)]);
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /lands on next, but origin now works on main, so this checkout was cut from a retired branch\. Run `git rebase --onto origin\/main origin\/next`/);
  assert.equal(git(remote, 'rev-parse', 'next'), base, 'nothing lands on the retired branch');
});


test('land rebases both halves onto the tips it fetched when a push from another worktree moves the shared refs between its rebases', () => {
  const fixture = trunk();
  const { dir, remote, clone, message, elsewhere } = fixture;
  const { companion, sideElsewhere } = split(fixture);
  const moved = join(dir, 'moved');
  const land = join(dir, 'land-elsewhere.sh');
  const edit = seedGeneratedConflict(fixture, `node gen.mjs && sh ${land}`);
  const other = elsewhere('other.txt', 'two\n', 'feat(o): other');
  const otherSide = sideElsewhere('other.spec', 'two\n', 'feat(o): other');
  writeFileSync(
    land,
    [
      `[ -e "${moved}" ] && exit 0`,
      `touch "${moved}"`,
      `git -C "${other}" push --quiet origin HEAD:next`,
      `git -C "${otherSide}" push --quiet origin HEAD:next`,
      'git fetch --quiet origin +refs/heads/next:refs/remotes/origin/next',
      'git --git-dir=.git-private --work-tree=. fetch --quiet origin +refs/heads/next:refs/remotes/origin/next',
      '',
    ].join('\n')
  );
  edit(clone, 'b.txt', 'three\n');

  const run = helper('land.mjs', clone, ['--message', message(GOOD), '--check', 'test ! -f other.spec || test -f other.txt']);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(git(remote, 'show', 'next:other.txt'), 'two');
  assert.equal(git(remote, 'show', 'next:gen/out.txt'), 'two\nthree');
  assert.equal(git(companion, 'show', 'next:other.spec'), 'two');
});

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
  assert.equal(git(companion, 'log', '-1', '--format=%B', 'next'), `${GOOD}\n\nLead: unknown\nLands-With: ${landed}`);
  assert.equal(side('status', '--porcelain', '--untracked-files=no'), '');

  writeFileSync(join(clone, 'a.spec'), 'three\n');
  const alone = helper('land.mjs', clone, ['--message', message(GOOD)]);
  assert.equal(alone.status, 0, alone.stderr);
  assert.equal(git(remote, 'rev-parse', 'next'), landed, 'a companion-only task adds nothing here');
  assert.equal(git(companion, 'show', 'next:a.spec'), 'three');
  assert.match(git(companion, 'log', '-1', '--format=%B', 'next'), new RegExp(`Lands-With: ${landed}$`, 'u'));
});

test('land refuses while companion files are missing from disk, and lands a companion deletion once it is staged', () => {
  const fixture = trunk();
  const { remote, clone, message } = fixture;
  const { companion, side } = split(fixture);
  git(clone, 'config', 'pstack.delivery', 'push');
  const before = git(remote, 'rev-parse', 'next');
  const start = git(companion, 'rev-parse', 'next');
  writeFileSync(join(clone, 'a.txt'), 'two\n');
  rmSync(join(clone, 'a.spec'));

  const refused = helper('land.mjs', clone, ['--message', message(GOOD)]);
  assert.equal(refused.status, 1, refused.stderr);
  assert.match(refused.stderr, /1 file that \.git-private tracks is missing from disk, such as a\.spec/u);
  assert.equal(git(remote, 'rev-parse', 'next'), before, 'nothing lands here while the companion work tree lacks its files');
  assert.equal(git(companion, 'rev-parse', 'next'), start, 'the missing file is not landed as a deletion');

  side('rm', '--quiet', '--cached', 'a.spec');
  const staged = helper('land.mjs', clone, ['--message', message(GOOD)]);
  assert.equal(staged.status, 0, staged.stderr);
  assert.equal(git(remote, 'show', 'next:a.txt'), 'two');
  assert.equal(git(companion, 'ls-tree', '--name-only', 'next'), '', 'a staged deletion lands in the companion');
});

test('land rebases the companion onto its origin/next before checking a task that changes only this checkout, and records its tree', () => {
  const fixture = trunk();
  const { dir, remote, clone, message } = fixture;
  const { companion, sideElsewhere } = split(fixture);
  git(clone, 'config', 'pstack.delivery', 'push');
  const ran = join(dir, 'ran');
  const runs = () => readFileSync(ran, 'utf8').trim().split('\n').length;
  const theirs = sideElsewhere('a.spec', 'theirs\n', 'test(a): land elsewhere');
  git(theirs, 'push', '--quiet', 'origin', 'HEAD:next');
  const check = ['--check', `echo run >> ${ran} && grep -q theirs a.spec`];
  declinePushes(remote, 99);
  writeFileSync(join(clone, 'a.txt'), 'two\n');

  const first = helper('land.mjs', clone, ['--message', message(GOOD), ...check], NO_WAIT);
  assert.equal(first.status, 75, `the check reads the companion's origin/next: ${first.stderr}`);

  writeFileSync(join(theirs, 'c.spec'), 'c\n');
  git(theirs, 'add', 'c.spec');
  git(theirs, 'commit', '--quiet', '-m', 'test(c): land elsewhere');
  git(theirs, 'push', '--quiet', 'origin', 'HEAD:next');
  declinePushes(remote, 0);
  const rerun = helper('land.mjs', clone, check, NO_WAIT);
  assert.equal(rerun.status, 0, rerun.stderr);
  assert.equal(runs(), 2, 'a companion that moved since the recorded check runs the checks again');
  assert.equal(readFileSync(join(clone, 'c.spec'), 'utf8'), 'c\n');
  assert.equal(git(remote, 'show', 'next:a.txt'), 'two');
  assert.equal(git(companion, 'log', '-1', '--format=%s', 'next'), 'test(c): land elsewhere', 'a task that changes no companion file pushes no companion commit');
});

test('land rebases both halves and checks them again before either push when the companion moves while its checks run', () => {
  const fixture = trunk();
  const { dir, remote, clone, base, message } = fixture;
  const { companion, sideElsewhere } = split(fixture);
  git(clone, 'config', 'pstack.delivery', 'push');
  const ran = join(dir, 'ran');
  const once = join(dir, 'once');
  const theirs = sideElsewhere('c.spec', 'c\n', 'test(c): land elsewhere');
  const check = ['--check', `echo run >> ${ran} && { test -e ${once} || { touch ${once} && git -C ${theirs} push --quiet origin HEAD:next; }; }`];
  writeFileSync(join(clone, 'a.txt'), 'two\n');
  writeFileSync(join(clone, 'a.spec'), 'two\n');

  const run = helper('land.mjs', clone, ['--message', message(GOOD), ...check]);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /\.git-private's origin\/next moved; rebasing and pushing again \(retry 1 of 3\)/);
  assert.equal(readFileSync(ran, 'utf8').trim().split('\n').length, 2, 'the rebased halves are checked before either is pushed');
  const landed = git(remote, 'rev-parse', 'next');
  assert.equal(git(remote, 'rev-list', '--count', `${base}..next`), '2', 'the split commit and the task land here');
  assert.deepEqual(git(companion, 'log', '-2', '--format=%s', 'next').split('\n'), ['feat(a): change a', 'test(c): land elsewhere']);
  assert.equal(git(companion, 'show', 'next:a.spec'), 'two');
  assert.match(git(companion, 'log', '-1', '--format=%B', 'next'), new RegExp(`^Lands-With: ${landed}$`, 'mu'));
});

test('a task that changes only public files checks again before its push when the companion moves while its checks run', () => {
  const fixture = trunk();
  const { dir, remote, clone, message } = fixture;
  const { sideElsewhere } = split(fixture);
  git(clone, 'config', 'pstack.delivery', 'push');
  const before = git(remote, 'rev-parse', 'next');
  const ran = join(dir, 'ran');
  const once = join(dir, 'once');
  const theirs = sideElsewhere('a.spec', 'broken\n', 'test(a): break a elsewhere');
  const check = ['--check', `echo run >> ${ran} && { test -e ${once} || { touch ${once} && git -C ${theirs} push --quiet origin HEAD:next; }; } && ! grep -q broken a.spec`];
  writeFileSync(join(clone, 'a.txt'), 'two\n');

  const run = helper('land.mjs', clone, ['--message', message(GOOD), ...check]);
  assert.equal(run.status, 1, run.stderr);
  assert.match(run.stdout, /\.git-private's origin\/next moved; rebasing and pushing again \(retry 1 of 3\)/);
  assert.equal(readFileSync(ran, 'utf8').trim().split('\n').length, 2, 'the public half is checked again beside the companion commit that landed meanwhile');
  assert.match(run.stderr, /check failed/);
  assert.equal(git(remote, 'rev-parse', 'next'), before, 'a public half that fails beside the companion tip is not pushed');
});

test('a task that changes only companion files checks again before its push when next moves while its checks run', () => {
  const fixture = trunk();
  const { dir, remote, clone, message, elsewhere } = fixture;
  const { companion } = split(fixture);
  git(clone, 'config', 'pstack.delivery', 'push');
  const ran = join(dir, 'ran');
  const once = join(dir, 'once');
  const other = elsewhere('d.txt', 'theirs\n', 'docs(d): land elsewhere');
  const check = ['--check', `echo run >> ${ran} && { test -e ${once} || { touch ${once} && git -C ${other} push --quiet origin HEAD:next; }; }`];
  writeFileSync(join(clone, 'a.spec'), 'two\n');

  const run = helper('land.mjs', clone, ['--message', message(GOOD), ...check]);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^origin\/next moved; rebasing and pushing again \(retry 1 of 3\)$/m);
  assert.equal(readFileSync(ran, 'utf8').trim().split('\n').length, 2, 'the companion half is checked again beside the public commit that landed meanwhile');
  assert.equal(readFileSync(join(clone, 'd.txt'), 'utf8'), 'theirs\n');
  assert.equal(git(companion, 'show', 'next:a.spec'), 'two');
  assert.equal(git(remote, 'log', '-1', '--format=%s', 'next'), 'docs(d): land elsewhere', 'a task that changes only companion files pushes no public commit');
});

test('a companion push refused after the public half landed rebases that half, checks it again and pushes it in the same run', () => {
  const fixture = trunk();
  const { dir, remote, clone, message } = fixture;
  const { companion, sideElsewhere } = split(fixture);
  git(clone, 'config', 'pstack.delivery', 'push');
  const ran = join(dir, 'ran');
  const once = join(dir, 'once');
  const theirs = sideElsewhere('c.spec', 'c\n', 'test(c): land elsewhere');
  const moveCompanionOnPublicPush = join(clone, '.git/hooks/pre-push');
  writeFileSync(moveCompanionOnPublicPush, `#!/bin/sh\ntest -e ${once} && exit 0\ntouch ${once}\ngit -C ${theirs} push --quiet origin HEAD:next\n`);
  chmodSync(moveCompanionOnPublicPush, 0o755);
  writeFileSync(join(clone, 'a.txt'), 'two\n');
  writeFileSync(join(clone, 'a.spec'), 'two\n');

  const run = helper('land.mjs', clone, ['--message', message(GOOD), '--check', `echo run >> ${ran}`]);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /Landed \w+ on origin\/next[\s\S]*\.git-private's origin\/next moved; rebasing and pushing again \(retry 1 of 3\)/);
  assert.equal(readFileSync(ran, 'utf8').trim().split('\n').length, 2, 'the rebased companion commit is checked before it is pushed');
  const landed = git(remote, 'rev-parse', 'next');
  assert.equal(git(remote, 'show', 'next:a.txt'), 'two');
  assert.deepEqual(git(companion, 'log', '-2', '--format=%s', 'next').split('\n'), ['feat(a): change a', 'test(c): land elsewhere']);
  assert.match(git(companion, 'log', '-1', '--format=%B', 'next'), new RegExp(`^Lands-With: ${landed}$`, 'mu'));
});

function landInFullPool(dir, clone, args) {
  const holder = spawn('sleep', ['3600'], { stdio: 'ignore' });
  const pool = join(dir, 'tmp/pstack-slots');
  mkdirSync(pool, { recursive: true });
  writeFileSync(join(pool, `${holder.pid}.json`), JSON.stringify({ pid: holder.pid, cores: availableParallelism(), label: 'other session', since: 0 }));
  const poolEnv = { ...ENV, TMPDIR: join(dir, 'tmp') };
  delete poolEnv.PSTACK_SLOT;
  const land = spawn(process.execPath, [join(HELPERS, 'land.mjs'), ...args], { cwd: clone, env: poolEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  land.out = '';
  land.err = '';
  land.stdout.on('data', (chunk) => (land.out += chunk));
  land.stderr.on('data', (chunk) => (land.err += chunk));
  land.exited = new Promise((done) => land.on('exit', done));
  land.stop = () => holder.kill();
  return land;
}

test("a landing enters a full core pool at once, and its check takes its own share as a land check instead of running inside the landing's", async () => {
  const { dir, clone, message } = trunk();
  git(clone, 'config', 'pstack.delivery', 'push');
  const seen = join(dir, 'check-env');
  writeFileSync(join(clone, 'a.txt'), 'two\n');
  const land = landInFullPool(dir, clone, ['--message', message(GOOD), '--check', `env > ${seen}`]);

  try {
    assert.equal(await land.exited, 0, land.err);
    assert.doesNotMatch(land.err, /waiting/, 'the landing waited in the core pool');
    const env = readFileSync(seen, 'utf8');
    assert.match(env, /^PSTACK_LAND_CHECK=1$/m, 'the check cannot tell it runs for a landing');
    assert.doesNotMatch(env, /^PSTACK_SLOT=/m, "the check's own reserve would return at once on the landing's share");
  } finally {
    land.stop();
  }
});

test('a landing at 55 minutes into the run starts no check and exits 75 with the commit local', () => {
  const { dir, remote, clone, base, message } = trunk();
  git(clone, 'config', 'pstack.delivery', 'push');
  const ran = join(dir, 'ran');
  const late = join(dir, 'late.mjs');
  writeFileSync(late, 'const now = performance.now.bind(performance);\nperformance.now = () => now() + 56 * 60_000;\n');
  writeFileSync(join(clone, 'a.txt'), 'two\n');

  const run = helper('land.mjs', clone, ['--message', message(GOOD), '--check', `touch ${ran}`], { NODE_OPTIONS: `--import ${late}` });
  assert.equal(run.status, 75, run.stderr);
  assert.match(run.stderr, /land\.mjs stopped touch \S+ at 55 minutes into the run[\s\S]*run land\.mjs again with the same --check options and no --message/);
  assert.equal(existsSync(ran), false, 'the checks did not start');
  assert.equal(git(remote, 'rev-parse', 'next'), base);
});

test('a landing that a signal stops still counts in the run log, as a stopped run', async () => {
  const { dir, clone, message } = trunk();
  git(clone, 'config', 'pstack.delivery', 'push');
  const pid = join(dir, 'pid');
  writeFileSync(join(clone, 'a.txt'), 'two\n');
  const land = spawn(process.execPath, [join(HELPERS, 'land.mjs'), '--message', message(GOOD), '--check', `sh -c 'echo $$ > ${pid}; exec sleep 60'`], { cwd: clone, env: ENV, stdio: 'ignore', detached: true });
  const stopped = new Promise((done) => land.on('exit', (code, signal) => done(signal)));

  await until(() => existsSync(pid) && readFileSync(pid, 'utf8').trim() !== '');
  process.kill(-land.pid, 'SIGTERM');
  assert.equal(await stopped, 'SIGTERM');
  await until(() => !isAlive(Number(readFileSync(pid, 'utf8'))));
});

test('the companion amend that adds the Lands-With line takes no work staged after the checks', () => {
  const fixture = trunk();
  const { clone, message } = fixture;
  const { companion, side } = split(fixture);
  git(clone, 'config', 'pstack.delivery', 'push');
  const hook = join(clone, '.git/hooks/pre-push');
  writeFileSync(hook, '#!/bin/sh\necho late > a.spec\ngit --git-dir=.git-private --work-tree=. add a.spec\n');
  chmodSync(hook, 0o755);
  writeFileSync(join(clone, 'a.txt'), 'two\n');
  writeFileSync(join(clone, 'a.spec'), 'two\n');

  const run = helper('land.mjs', clone, ['--message', message(GOOD)]);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(git(companion, 'show', 'next:a.spec'), 'two', 'the edit staged during the push stays out of the companion commit');
  assert.equal(side('diff', '--cached', '--name-only'), 'a.spec', 'it stays staged');
});

test('land leaves out a new file the companion list names when this clone ignores it locally', () => {
  const fixture = trunk();
  const { clone, message } = fixture;
  const { companion } = split(fixture);
  git(clone, 'config', 'pstack.delivery', 'push');
  writeFileSync(join(clone, '.git/info/exclude'), 'scratch/\n');
  mkdirSync(join(clone, 'scratch'));
  writeFileSync(join(clone, 'scratch/x.spec'), 'local\n');
  writeFileSync(join(clone, 'a.spec'), 'two\n');

  const run = helper('land.mjs', clone, ['--message', message(GOOD)]);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(git(companion, 'show', 'next:a.spec'), 'two');
  assert.equal(git(companion, 'ls-tree', '-r', '--name-only', 'next', '--', 'scratch'), '', 'a path .git/info/exclude ignores is not companion work');
});

test('a checkout that holds the companion lands in push mode when pstack.delivery is unset, and refuses another mode or a missing companion', () => {
  const fixture = trunk();
  const { dir, remote, clone, message } = fixture;
  const { companion } = split(fixture);
  writeFileSync(join(clone, 'a.txt'), 'two\n');
  writeFileSync(join(clone, 'a.spec'), 'two\n');

  const landed = helper('land.mjs', clone, ['--message', message(GOOD)]);
  assert.equal(landed.status, 0, landed.stderr);
  assert.equal(git(remote, 'show', 'next:a.txt'), 'two');
  assert.equal(git(companion, 'show', 'next:a.spec'), 'two');

  git(clone, 'config', 'pstack.delivery', 'pr');
  writeFileSync(join(clone, 'a.txt'), 'three\n');
  const pr = helper('land.mjs', clone, ['--message', message(GOOD)]);
  assert.equal(pr.status, 1);
  assert.match(pr.stderr, /\.git-private lands only in push mode/);

  git(clone, 'config', 'pstack.delivery', 'push');
  const tree = join(dir, 'tree');
  git(clone, 'worktree', 'add', '--quiet', '-b', 'other', tree, 'origin/next');
  writeFileSync(join(tree, 'a.txt'), 'four\n');
  const before = git(remote, 'rev-parse', 'next');
  const missing = helper('land.mjs', tree, ['--message', message(GOOD)]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /this checkout has no \.git-private.*attach the companion repository first/s);
  assert.equal(git(remote, 'rev-parse', 'next'), before, 'nothing lands without the companion half');
});

test('land takes a fix whose Introduced-by names a landed companion commit, and refuses one the companion has not landed', () => {
  const fixture = trunk();
  const { remote, clone, message } = fixture;
  const { companion, side } = split(fixture);
  git(clone, 'config', 'pstack.delivery', 'push');
  const start = git(companion, 'rev-parse', 'next');
  const local = side('commit-tree', '-p', 'HEAD', '-m', 'local only', 'HEAD^{tree}');
  writeFileSync(join(clone, 'a.txt'), 'two\n');

  const refused = helper('land.mjs', clone, ['--message', message(`fix(a): repair a\n\nBeyond the ask: none\nPicks: none\nNot checked: none\nIntroduced-by: ${local}`)]);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /Introduced-by: \w+ names a commit origin\/next or \.git-private's origin\/next does not contain/);
  const landed = helper('land.mjs', clone, ['--message', message(`fix(a): repair a\n\nBeyond the ask: none\nPicks: none\nNot checked: none\nIntroduced-by: ${start}`)]);
  assert.equal(landed.status, 0, landed.stderr);
  assert.match(git(remote, 'log', '-1', '--format=%B', 'next'), new RegExp(`^Introduced-by: ${start}$`, 'mu'));
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

test('land rebases, checks again and pushes when GitHub cannot lock next because another push moved it', () => {
  const { remote, clone, message, elsewhere } = trunk();
  git(clone, 'config', 'pstack.delivery', 'push');
  const other = elsewhere('d.txt', 'theirs\n', 'docs(d): land elsewhere');
  git(other, 'push', '--quiet', 'origin', 'HEAD:refs/heads/side');
  // receive-pack locks next after this hook runs, so a hook that moves next
  // once makes the same "cannot lock ref" reply a concurrent push gets.
  const hook = join(remote, 'hooks', 'pre-receive');
  writeFileSync(
    hook,
    '#!/bin/sh\n[ -e "$GIT_DIR/raced" ] && exit 0\ntouch "$GIT_DIR/raced"\nenv -u GIT_QUARANTINE_PATH -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES git update-ref refs/heads/next refs/heads/side\n'
  );
  chmodSync(hook, 0o755);
  writeFileSync(join(clone, 'a.txt'), 'two\n');

  const run = helper('land.mjs', clone, ['--message', message(GOOD)]);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /origin\/next moved; rebasing and pushing again \(retry 1 of 3\)/);
  assert.deepEqual(git(remote, 'log', '--format=%s', 'main..next').split('\n'), ['feat(a): change a', 'docs(d): land elsewhere']);
});

