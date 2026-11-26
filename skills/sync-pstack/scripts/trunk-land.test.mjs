import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ENV, git, GOOD, helper, HELPERS, isAlive, seedGeneratedConflict, split, trunk, until } from './test-trunk.mjs';

test('land squashes, lints changed files only, runs --check, and pushes next as one commit', () => {
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
  assert.equal(git(remote, 'rev-list', '--count', `${base}..next`), '1');
  assert.equal(git(remote, 'log', '-1', '--format=%B', 'next'), `${GOOD}\n\nLead: unknown`);
  assert.equal(git(remote, 'show', 'next:a.txt'), 'TWO');
  assert.equal(git(remote, 'show', 'next:e.txt'), 'MORE');
  assert.equal(git(remote, 'show', 'next:c.txt'), 'NEW');
  assert.equal(git(remote, 'show', 'next:b.txt'), 'one');
  assert.equal(git(remote, 'rev-parse', 'main'), base);
  assert.equal(git(clone, 'status', '--porcelain'), '');
});

test('land refuses a retired working branch when origin default branch switched', () => {
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
  assert.match(run.stderr, /lands on next, but origin now works on main/);
  assert.equal(git(remote, 'rev-parse', 'next'), base);
});

test('land dual-lands public and companion halves with Lands-With, respects local excludes, and supports companion-only landing', () => {
  const fixture = trunk();
  const { remote, clone, message } = fixture;
  const { companion, side } = split(fixture);
  git(clone, 'config', 'pstack.delivery', 'push');
  writeFileSync(join(clone, '.git/info/exclude'), 'scratch/\n');
  mkdirSync(join(clone, 'scratch'));
  writeFileSync(join(clone, 'scratch/x.spec'), 'local\n');
  writeFileSync(join(clone, 'a.txt'), 'two\n');
  writeFileSync(join(clone, 'a.spec'), 'two\n');
  writeFileSync(join(clone, 'b.spec'), 'new\n');

  const run = helper('land.mjs', clone, ['--message', message(GOOD), '--check', 'test "$(cat b.spec)" = new']);
  assert.equal(run.status, 0, run.stderr);
  const landed = git(remote, 'rev-parse', 'next');
  assert.equal(git(remote, 'show', 'next:a.txt'), 'two');
  assert.equal(git(remote, 'ls-tree', '--name-only', 'next', '--', 'a.spec', 'b.spec'), '');
  assert.equal(git(companion, 'show', 'next:a.spec'), 'two');
  assert.equal(git(companion, 'show', 'next:b.spec'), 'new');
  assert.equal(git(companion, 'ls-tree', '-r', '--name-only', 'next', '--', 'scratch'), '');
  assert.equal(git(companion, 'log', '-1', '--format=%B', 'next'), `${GOOD}\n\nLead: unknown\nLands-With: ${landed}`);
  assert.equal(side('status', '--porcelain', '--untracked-files=no'), '');

  writeFileSync(join(clone, 'a.spec'), 'three\n');
  assert.equal(helper('land.mjs', clone, ['--message', message(GOOD)]).status, 0);
  assert.equal(git(remote, 'rev-parse', 'next'), landed);
  assert.equal(git(companion, 'show', 'next:a.spec'), 'three');
  assert.match(git(companion, 'log', '-1', '--format=%B', 'next'), new RegExp(`Lands-With: ${landed}$`, 'u'));
});

test('land enforces companion guards: missing files, staged deletion, push-only mode, missing .git-private, pre-split branch, and companion Introduced-by', () => {
  const fixture = trunk();
  const { dir, remote, clone, message } = fixture;
  git(clone, 'branch', 'old');
  const { companion, side } = split(fixture);

  // Unset delivery still defaults to push when companion is present.
  writeFileSync(join(clone, 'a.txt'), 'two\n');
  writeFileSync(join(clone, 'a.spec'), 'two\n');
  assert.equal(helper('land.mjs', clone, ['--message', message(GOOD)]).status, 0);

  // Refuses pr mode with companion.
  git(clone, 'config', 'pstack.delivery', 'pr');
  writeFileSync(join(clone, 'a.txt'), 'three\n');
  assert.match(helper('land.mjs', clone, ['--message', message(GOOD)]).stderr, /\.git-private lands only in push mode/);
  git(clone, 'config', 'pstack.delivery', 'push');

  // Refuses missing companion file until deletion is staged.
  const before = git(remote, 'rev-parse', 'next');
  rmSync(join(clone, 'a.spec'));
  assert.match(helper('land.mjs', clone, ['--message', message(GOOD)]).stderr, /1 file that \.git-private tracks is missing from disk/);
  assert.equal(git(remote, 'rev-parse', 'next'), before);
  side('rm', '--quiet', '--cached', 'a.spec');
  assert.equal(helper('land.mjs', clone, ['--message', message(GOOD)]).status, 0);
  assert.equal(git(companion, 'ls-tree', '--name-only', 'next'), '');

  // Introduced-by accepts landed companion sha and refuses unlanded companion sha.
  const landedComp = git(companion, 'rev-parse', 'next');
  const localComp = side('commit-tree', '-p', 'HEAD', '-m', 'local only', 'HEAD^{tree}');
  writeFileSync(join(clone, 'a.txt'), 'four\n');
  assert.match(helper('land.mjs', clone, ['--message', message(`fix(a): repair\n\nBeyond the ask: none\nPicks: none\nNot checked: none\nIntroduced-by: ${localComp}`)]).stderr, /does not contain/);
  assert.equal(helper('land.mjs', clone, ['--message', message(`fix(a): repair\n\nBeyond the ask: none\nPicks: none\nNot checked: none\nIntroduced-by: ${landedComp}`)]).status, 0);

  // Worktree missing .git-private is refused.
  const tree = join(dir, 'tree');
  git(clone, 'worktree', 'add', '--quiet', '-b', 'other', tree, 'origin/next');
  writeFileSync(join(tree, 'a.txt'), 'five\n');
  assert.match(helper('land.mjs', tree, ['--message', message(GOOD)]).stderr, /this checkout has no \.git-private.*attach the companion repository first/s);

  // Branch cut before .gitprivate existed is refused with migrate command.
  git(clone, '--git-dir=.git', 'switch', '--quiet', 'old');
  writeFileSync(join(clone, 'a.txt'), 'six\n');
  assert.match(helper('land.mjs', clone, ['--message', message(GOOD)]).stderr, /cut before \.gitprivate existed on origin\/next.*Run `node migrate\.mjs`/su);
});

test('land rebases both halves on concurrent moves, rechecks before push, and handles companion push refusal after public lands', () => {
  const fixture = trunk();
  const { dir, remote, clone, message } = fixture;
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
  assert.equal(readFileSync(ran, 'utf8').trim().split('\n').length, 2);
  assert.equal(git(companion, 'show', 'next:a.spec'), 'two');

  // Companion moves during public push hook -> companion rebases and rechecks in same run.
  const ran2 = join(dir, 'ran2');
  const once2 = join(dir, 'once2');
  const theirs2 = sideElsewhere('d.spec', 'd\n', 'test(d): land elsewhere');
  const prePush = join(clone, '.git/hooks/pre-push');
  writeFileSync(prePush, `#!/bin/sh\ntest -e ${once2} && exit 0\ntouch ${once2}\ngit -C ${theirs2} push --quiet origin HEAD:next\n`, { mode: 0o755 });
  writeFileSync(join(clone, 'a.txt'), 'three\n');
  writeFileSync(join(clone, 'a.spec'), 'three\n');
  const run2 = helper('land.mjs', clone, ['--message', message(GOOD), '--check', `echo run >> ${ran2}`]);
  assert.equal(run2.status, 0, run2.stderr);
  assert.equal(readFileSync(ran2, 'utf8').trim().split('\n').length, 2);
  assert.match(git(companion, 'log', '-1', '--format=%B', 'next'), new RegExp(`^Lands-With: ${git(remote, 'rev-parse', 'next')}$`, 'mu'));
});

test('public-only task rechecks and refuses push when companion moves and breaks check during run', () => {
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
  assert.equal(readFileSync(ran, 'utf8').trim().split('\n').length, 2);
  assert.match(run.stderr, /check failed/);
  assert.equal(git(remote, 'rev-parse', 'next'), before);
});

test('land rebases both halves onto fetched tips when another worktree moves shared refs between rebases', () => {
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
    `[ -e "${moved}" ] && exit 0\ntouch "${moved}"\ngit -C "${other}" push --quiet origin HEAD:next\ngit -C "${otherSide}" push --quiet origin HEAD:next\ngit fetch --quiet origin +refs/heads/next:refs/remotes/origin/next\ngit --git-dir=.git-private --work-tree=. fetch --quiet origin +refs/heads/next:refs/remotes/origin/next\n`,
  );
  edit(clone, 'b.txt', 'three\n');

  const run = helper('land.mjs', clone, ['--message', message(GOOD), '--check', 'test ! -f other.spec || test -f other.txt']);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(git(remote, 'show', 'next:other.txt'), 'two');
  assert.equal(git(remote, 'show', 'next:gen/out.txt'), 'two\nthree');
  assert.equal(git(companion, 'show', 'next:other.spec'), 'two');
});

test('land rebases, rechecks, and pushes when next moves during check or fails to lock ref', () => {
  const { dir, remote, clone, message, elsewhere } = trunk();
  git(clone, 'config', 'pstack.delivery', 'push');
  const ran = join(dir, 'ran');
  const other = elsewhere('d.txt', 'theirs\n', 'docs(d): land elsewhere');
  writeFileSync(join(clone, 'a.txt'), 'two\n');

  const run = helper('land.mjs', clone, ['--message', message(GOOD), '--check', `echo run >> ${ran} && git -C ${other} push --quiet origin HEAD:next`]);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /origin\/next moved; rebasing and pushing again \(retry 1 of 3\)/);
  assert.equal(readFileSync(ran, 'utf8').trim().split('\n').length, 2);
  assert.deepEqual(git(remote, 'log', '--format=%s', 'main..next').split('\n'), ['feat(a): change a', 'docs(d): land elsewhere']);

  // Concurrent ref-lock failure on receive-pack also triggers rebase retry.
  const other2 = elsewhere('e.txt', 'theirs\n', 'docs(e): lock race');
  git(other2, 'push', '--quiet', 'origin', 'HEAD:refs/heads/side');
  const hook = join(remote, 'hooks', 'pre-receive');
  writeFileSync(hook, '#!/bin/sh\n[ -e "$GIT_DIR/raced" ] && exit 0\ntouch "$GIT_DIR/raced"\nenv -u GIT_QUARANTINE_PATH -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES git update-ref refs/heads/next refs/heads/side\n', { mode: 0o755 });
  writeFileSync(join(clone, 'a.txt'), 'three\n');
  const raced = helper('land.mjs', clone, ['--message', message(GOOD)]);
  assert.equal(raced.status, 0, raced.stderr);
  assert.match(raced.stdout, /origin\/next moved; rebasing and pushing again \(retry 1 of 3\)/);
});

test('landing enters full core pool with PSTACK_LAND_CHECK=1, exits 75 past 55m, and kills check process group on SIGTERM', async () => {
  const { dir, remote, clone, base, message } = trunk();
  git(clone, 'config', 'pstack.delivery', 'push');

  // 55m deadline exits 75 without starting check.
  const late = join(dir, 'late.mjs');
  writeFileSync(late, 'const now = performance.now.bind(performance);\nperformance.now = () => now() + 56 * 60_000;\n');
  writeFileSync(join(clone, 'a.txt'), 'two\n');
  const stopped = helper('land.mjs', clone, ['--message', message(GOOD), '--check', `touch ${join(dir, 'never')}`], { NODE_OPTIONS: `--import ${late}` });
  assert.equal(stopped.status, 75, stopped.stderr);
  assert.equal(existsSync(join(dir, 'never')), false);
  assert.equal(git(remote, 'rev-parse', 'next'), base);

  // Full core pool admits landing immediately and clears PSTACK_SLOT while setting PSTACK_LAND_CHECK=1.
  const holder = spawn('sleep', ['3600'], { stdio: 'ignore' });
  const pool = join(dir, 'tmp/pstack-slots');
  mkdirSync(pool, { recursive: true });
  writeFileSync(join(pool, `${holder.pid}.json`), JSON.stringify({ pid: holder.pid, cores: availableParallelism(), label: 'other', since: 0 }));
  const seen = join(dir, 'check-env');
  const poolEnv = { ...ENV, TMPDIR: join(dir, 'tmp') };
  delete poolEnv.PSTACK_SLOT;
  try {
    const land = spawn(process.execPath, [join(HELPERS, 'land.mjs'), '--check', `env > ${seen}`], { cwd: clone, env: poolEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    land.stderr.on('data', (c) => (err += c));
    assert.equal(await new Promise((done) => land.on('exit', done)), 0, err);
    assert.doesNotMatch(err, /waiting/);
    const envOut = readFileSync(seen, 'utf8');
    assert.match(envOut, /^PSTACK_LAND_CHECK=1$/m);
    assert.doesNotMatch(envOut, /^PSTACK_SLOT=/m);
  } finally {
    holder.kill();
  }

  // SIGTERM kills check descendants cleanly.
  const pidFile = join(dir, 'pid');
  writeFileSync(join(clone, 'a.txt'), 'three\n');
  const sig = spawn(process.execPath, [join(HELPERS, 'land.mjs'), '--message', message(GOOD), '--check', `sh -c 'echo $$ > ${pidFile}; exec sleep 60'`], { cwd: clone, env: ENV, stdio: 'ignore', detached: true });
  const sigDone = new Promise((done) => sig.on('exit', (_, signal) => done(signal)));
  await until(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8').trim() !== '');
  process.kill(-sig.pid, 'SIGTERM');
  assert.equal(await sigDone, 'SIGTERM');
  await until(() => !isAlive(Number(readFileSync(pidFile, 'utf8'))));
});
