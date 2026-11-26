import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { test } from 'node:test';
import { declinePushes, ENV, ghArgs, ghLines, git, GOOD, helper, HELPERS, isAlive, landingOnBothVersionFiles, NO_WAIT, PR, seedGeneratedConflict, split, stubGh, trunk, until } from './test-trunk.mjs';

const [gitMajor, gitMinor] = spawnSync('git', ['--version'], { encoding: 'utf8' }).stdout.match(/(\d+)\.(\d+)/u).slice(1).map(Number);
const NO_PREPARING = (gitMajor < 2 || (gitMajor === 2 && gitMinor < 54)) && 'needs git 2.54 or later, whose reference-transaction hook has the preparing state';
const RACED = /another fetch moved \.git-private's origin\/next while land\.mjs fetched it; fetching again \(retry 1 of 2\)/;

// The preparing state runs before git locks the ref, so a hook that moves it
// there once makes the reply a concurrent fetch from another worktree gets.
function raceCompanionFetch({ dir, clone }) {
  const gitDir = join(clone, '.git-private');
  const raced = join(dir, 'raced');
  const hook = join(gitDir, 'hooks', 'reference-transaction');
  writeFileSync(
    hook,
    `#!/bin/sh\n[ "$1" = preparing ] || exit 0\nwhile read old new ref; do\n  [ "$ref" = refs/remotes/origin/next ] && [ ! -e "${raced}" ] && touch "${raced}" && git --git-dir="${gitDir}" update-ref "$ref" "$new"\ndone\nexit 0\n`
  );
  chmodSync(hook, 0o755);
}

test('land fetches again when another fetch moves the shared companion ref between its read and its write', { skip: NO_PREPARING }, () => {
  const fixture = trunk();
  const { remote, clone, message } = fixture;
  const { sideElsewhere } = split(fixture);
  git(clone, 'config', 'pstack.delivery', 'push');
  git(sideElsewhere('c.spec', 'c\n', 'test(c): land elsewhere'), 'push', '--quiet', 'origin', 'HEAD:next');
  raceCompanionFetch(fixture);
  writeFileSync(join(clone, 'a.txt'), 'two\n');

  const run = helper('land.mjs', clone, ['--message', message(GOOD)]);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, RACED);
  assert.doesNotMatch(run.stdout, /moved; rebasing/, 'the retried fetch gave land.mjs the tip it rebased onto');
  assert.equal(git(remote, 'log', '-1', '--format=%s', 'next'), 'feat(a): change a');
});

test('a public half checks again before its push when another fetch races the fetch that sees the companion move', { skip: NO_PREPARING }, () => {
  const fixture = trunk();
  const { dir, remote, clone, message } = fixture;
  const { sideElsewhere } = split(fixture);
  git(clone, 'config', 'pstack.delivery', 'push');
  const before = git(remote, 'rev-parse', 'next');
  const ran = join(dir, 'ran');
  const once = join(dir, 'once');
  const theirs = sideElsewhere('a.spec', 'broken\n', 'test(a): break a elsewhere');
  const check = ['--check', `echo run >> ${ran} && { test -e ${once} || { touch ${once} && git -C ${theirs} push --quiet origin HEAD:next; }; } && ! grep -q broken a.spec`];
  raceCompanionFetch(fixture);
  writeFileSync(join(clone, 'a.txt'), 'two\n');

  const run = helper('land.mjs', clone, ['--message', message(GOOD), ...check]);
  assert.equal(run.status, 1, run.stderr);
  assert.match(run.stdout, RACED);
  assert.equal(readFileSync(ran, 'utf8').trim().split('\n').length, 2, 'the public half is checked again beside the companion commit the raced fetch brought');
  assert.equal(git(remote, 'rev-parse', 'next'), before, 'a public half that fails beside the companion tip is not pushed');
});

test('land finds a companion half that reached origin during its check when another fetch races the fetch that looks for it', { skip: NO_PREPARING }, () => {
  const fixture = trunk();
  const { remote, clone, message } = fixture;
  const { sideElsewhere } = split(fixture);
  git(clone, 'config', 'pstack.delivery', 'push');
  const halves = landingOnBothVersionFiles(fixture, sideElsewhere);
  git(halves[0], 'push', '--quiet', 'origin', 'HEAD:next');
  raceCompanionFetch(fixture);
  writeFileSync(join(clone, 'a.txt'), 'two\n');
  const check = `git -C "${halves[1]}" push --quiet origin HEAD:next; test "$(cat b.txt)" = "$(cat a.spec)"`;

  const run = helper('land.mjs', clone, ['--message', message(GOOD), '--check', check]);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, RACED);
  assert.ok(run.stdout.includes(`it ran on ${git(halves[0], 'rev-parse', 'HEAD')} without that commit's .git-private half`), run.stdout);
  assert.equal(git(remote, 'show', 'next:a.txt'), 'two');
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

const UNREACHABLE = 'http://127.0.0.1:9/unreachable.git';

test('land tries a push that cannot reach the remote on the GH006 schedule, exits 75 with the commit local and counts no friction, and a rerun pushes that commit without checking again', () => {
  const { dir, remote, clone, base, message } = trunk();
  git(clone, 'config', 'pstack.delivery', 'push');
  const ran = join(dir, 'ran');
  const check = ['--check', `echo run >> ${ran}`];
  git(clone, 'config', 'remote.origin.pushurl', UNREACHABLE);
  writeFileSync(join(clone, 'a.txt'), 'two\n');

  const run = helper('land.mjs', clone, ['--message', message(GOOD), ...check], NO_WAIT);
  assert.equal(run.status, 75, run.stderr);
  assert.match(run.stdout, /git push origin HEAD:next failed on the connection or with a server error; trying again in 1 min \(retry 1 of 5\)[\s\S]*trying again in 16 min \(retry 5 of 5\)/);
  assert.match(run.stderr, /still failed on the connection or with a server error\. The squashed commit stays local[\s\S]*run land\.mjs again with the same --check options and no --message[\s\S]*fatal: unable to access/);
  assert.equal(git(remote, 'rev-parse', 'next'), base);

  git(clone, 'config', '--unset', 'remote.origin.pushurl');
  const rerun = helper('land.mjs', clone, check);
  assert.equal(rerun.status, 0, rerun.stderr);
  assert.match(rerun.stdout, /pushes without running the checks again/);
  assert.equal(readFileSync(ran, 'utf8').trim().split('\n').length, 1, 'the rerun skipped the check the first run passed');
  assert.equal(git(remote, 'log', '-1', '--format=%s', 'next'), 'feat(a): change a');
});

test('land tries a fetch that cannot reach the remote on the GH006 schedule, then exits 75 having committed nothing, and a rerun with the same options lands', () => {
  const { remote, clone, base, message } = trunk();
  git(clone, 'config', 'pstack.delivery', 'push');
  const url = git(clone, 'remote', 'get-url', 'origin');
  git(clone, 'remote', 'set-url', 'origin', UNREACHABLE);
  writeFileSync(join(clone, 'a.txt'), 'two\n');
  const options = ['--message', message(GOOD)];

  const run = helper('land.mjs', clone, options, NO_WAIT);
  assert.equal(run.status, 75, run.stderr);
  assert.match(run.stdout, /git fetch failed on the connection or with a server error; trying again in 1 min \(retry 1 of 5\)[\s\S]*\(retry 5 of 5\)/);
  assert.match(run.stderr, /still failed on the connection or with a server error\. This run committed nothing, so run land\.mjs again with the same options\.[\s\S]*fatal: unable to access/);
  assert.equal(git(clone, 'rev-parse', 'HEAD'), base);

  git(clone, 'remote', 'set-url', 'origin', url);
  const rerun = helper('land.mjs', clone, options, NO_WAIT);
  assert.equal(rerun.status, 0, rerun.stderr);
  assert.equal(git(remote, 'log', '-1', '--format=%s', 'next'), 'feat(a): change a');
});

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
  const refused = helper('land.mjs', clone, ['--message', message('feat(a): change a again\n\nWhy.\n\nBeyond the ask: none\nPicks: none\nNot checked: none')], NO_WAIT);
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



test('land stops a check at 55 minutes into the run, with every process the check started, and exits 75 with the commit local', async () => {
  const { dir, remote, clone, message, elsewhere } = trunk();
  git(clone, 'config', 'pstack.delivery', 'push');
  const late = join(dir, 'late.mjs');
  writeFileSync(late, 'const now = performance.now.bind(performance);\nperformance.now = () => now() + 55 * 60_000 - 8_000;\n');
  const [ran, once, pid] = ['ran', 'once', 'pid'].map((name) => join(dir, name));
  const other = elsewhere('d.txt', 'theirs\n', 'docs(d): land elsewhere');
  writeFileSync(join(clone, 'a.txt'), 'two\n');

  const check = `echo run >> ${ran}; if test -f ${once}; then sh -c 'echo $$ > ${pid}; exec sleep 60'; else touch ${once} && git -C ${other} push --quiet origin HEAD:next; fi`;
  const run = helper('land.mjs', clone, ['--message', message(GOOD), '--check', check], { ...NO_WAIT, NODE_OPTIONS: `--import ${late}` });
  assert.equal(run.status, 75, run.stderr);
  assert.match(run.stderr, /land\.mjs stopped echo run [\s\S]* at 55 minutes into the run[\s\S]*run land\.mjs again with the same --check options and no --message/);
  assert.equal(readFileSync(ran, 'utf8').trim().split('\n').length, 2, 'the rebased commit is checked again until the deadline');
  await until(() => !isAlive(Number(readFileSync(pid, 'utf8'))));
  assert.deepEqual(git(remote, 'log', '--format=%s', 'main..next').split('\n'), ['docs(d): land elsewhere']);
});

test('a landing whose first check took most of the hour checks again after next moves, and lands', () => {
  const { dir, remote, clone, message, elsewhere } = trunk();
  git(clone, 'config', 'pstack.delivery', 'push');
  const [ran, slow] = ['ran', 'slow'].map((name) => join(dir, name));
  const late = join(dir, 'late.mjs');
  writeFileSync(late, `import { existsSync } from 'node:fs';\nconst now = performance.now.bind(performance);\nperformance.now = () => now() + (existsSync(${JSON.stringify(slow)}) ? 40 * 60_000 : 0);\n`);
  const other = elsewhere('d.txt', 'theirs\n', 'docs(d): land elsewhere');
  writeFileSync(join(clone, 'a.txt'), 'two\n');

  const check = `echo run >> ${ran} && if ! test -f ${slow}; then touch ${slow} && git -C ${other} push --quiet origin HEAD:next; fi`;
  const run = helper('land.mjs', clone, ['--message', message(GOOD), '--check', check], { NODE_OPTIONS: `--import ${late}` });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^origin\/next moved; rebasing and pushing again \(retry 1 of 3\)$/m);
  assert.equal(readFileSync(ran, 'utf8').trim().split('\n').length, 2);
  assert.equal(git(remote, 'show', 'next:a.txt'), 'two');
  assert.equal(git(remote, 'show', 'next:d.txt'), 'theirs');
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

  assert.equal(helper('land.mjs', clone, ['--message', message('feat(a): change a differently\n\nWhy.\n\nBeyond the ask: none\nPicks: none\nNot checked: none'), ...check], NO_WAIT).status, 75);
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

test('a rerun runs the checks again on a recorded commit under an assignment the config lists in freshEnv', () => {
  const { dir, remote, clone, message } = trunk();
  git(clone, 'config', 'pstack.delivery', 'push');
  const ran = join(dir, 'ran');
  const check = ['--check', `echo run >> ${ran}`];
  const runs = () => readFileSync(ran, 'utf8').trim().split('\n').length;
  const config = JSON.parse(readFileSync(join(clone, '.agents/pstack.json'), 'utf8'));
  writeFileSync(join(clone, '.agents/pstack.json'), JSON.stringify({ ...config, freshEnv: ['FORCE_CHECKS=true'] }));
  declinePushes(remote, 99);
  writeFileSync(join(clone, 'a.txt'), 'two\n');
  assert.equal(helper('land.mjs', clone, ['--message', message(GOOD), ...check], NO_WAIT).status, 75);

  assert.equal(helper('land.mjs', clone, check, { ...NO_WAIT, FORCE_CHECKS: 'false' }).status, 75);
  assert.equal(runs(), 1, 'another value of the variable keeps the record');
  const forced = helper('land.mjs', clone, check, { ...NO_WAIT, FORCE_CHECKS: 'true' });
  assert.equal(forced.status, 75, forced.stderr);
  assert.match(forced.stdout, /FORCE_CHECKS=true is set, so land\.mjs runs the checks again/);
  assert.equal(runs(), 2, 'the listed assignment checks the recorded commit again');
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
  assert.equal(git(remote, 'log', '-1', '--format=%B', 'next'), `${GOOD}\n\nSession: local_s1\nLead: unknown`, 'the rerun keeps one Session: line');
  assert.equal(git(remote, 'show', 'next:a.txt'), 'both');
});

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

test('land rebuilds an always entry after a clean rebase that left its output stale, and folds it into the task commit', () => {
  const fixture = trunk();
  const { remote, clone, message } = fixture;
  seedGeneratedConflict(fixture, 'node gen.mjs', { always: true });
  writeFileSync(join(clone, 'b.txt'), 'three\n');

  const run = helper('land.mjs', clone, ['--message', message(GOOD)]);
  assert.equal(run.status, 0, run.stderr);
  assert.doesNotMatch(run.stdout, /conflicts only in generated paths/, 'the rebase applied cleanly');
  assert.match(run.stdout, /rebuilt gen\/out\.txt after the rebase/);
  assert.equal(git(remote, 'show', 'next:gen/out.txt'), 'two\nthree');
  assert.deepEqual(git(remote, 'log', '--format=%s', '-2', 'next').split('\n'), ['feat(a): change a', 'fix(a): land elsewhere']);
});

test('land runs an always entry once when the rebase already rebuilt it', () => {
  const fixture = trunk();
  const { remote, clone, message, dir } = fixture;
  const ran = join(dir, 'ran');
  const edit = seedGeneratedConflict(fixture, `echo run >> ${ran} && node gen.mjs`, { always: true });
  edit(clone, 'b.txt', 'three\n');

  const run = helper('land.mjs', clone, ['--message', message(GOOD)]);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /conflicts only in generated paths/);
  assert.equal(readFileSync(ran, 'utf8'), 'run\n');
  assert.equal(git(remote, 'show', 'next:gen/out.txt'), 'two\nthree');
});

function seedSpecList(fixture) {
  const { clone } = fixture;
  const { companion, side, sideElsewhere } = split(fixture);
  git(clone, 'config', 'pstack.delivery', 'push');
  writeFileSync(
    join(clone, 'gen.mjs'),
    "import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';\n" +
      "const specs = readdirSync('.').filter((name) => name.endsWith('.spec')).sort().join('\\n');\n" +
      "for (const dir of ['gen', 'tests']) mkdirSync(dir, { recursive: true });\n" +
      "writeFileSync('gen/specs.txt', specs);\nwriteFileSync('tests/list.spec', specs);\n"
  );
  const config = JSON.parse(readFileSync(join(clone, '.agents/pstack.json'), 'utf8'));
  config.generated = [{ paths: ['gen/**'], command: 'node gen.mjs', always: true }];
  writeFileSync(join(clone, '.agents/pstack.json'), JSON.stringify(config));
  assert.equal(spawnSync(process.execPath, ['gen.mjs'], { cwd: clone }).status, 0);
  git(clone, 'add', '--all');
  git(clone, 'commit', '--quiet', '-m', 'generate');
  git(clone, 'push', '--quiet', 'origin', 'HEAD:next');
  git(clone, 'fetch', '--quiet', 'origin');
  side('add', '--force', 'tests/list.spec');
  side('commit', '--quiet', '-m', 'generate');
  side('push', '--quiet', 'origin', 'HEAD:next');
  side('fetch', '--quiet', 'origin');
  git(sideElsewhere('c.spec', 'c\n', 'test(c): land elsewhere'), 'push', '--quiet', 'origin', 'HEAD:next');
  return { companion, side, landed: git(companion, 'rev-parse', 'next') };
}

test("land regenerates an always entry from the companion's origin/next, and lands the output the companion tracks in a companion commit of its own", () => {
  const fixture = trunk();
  const { remote, clone, message } = fixture;
  const { companion, side, landed } = seedSpecList(fixture);
  writeFileSync(join(clone, 'a.txt'), 'two\n');

  const run = helper('land.mjs', clone, ['--message', message(GOOD)]);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(git(remote, 'show', 'next:gen/specs.txt'), 'a.spec\nc.spec', 'the output reads the spec the companion gained');
  assert.equal(git(companion, 'show', 'next:tests/list.spec'), 'a.spec\nc.spec');
  assert.equal(git(companion, 'log', '--format=%s', `${landed}..next`), 'feat(a): change a', 'a task that changed no companion file lands that output in one companion commit');
  assert.match(git(companion, 'log', '-1', '--format=%B', 'next'), new RegExp(`^Lands-With: ${git(remote, 'rev-parse', 'next')}$`, 'mu'));
  assert.equal(side('status', '--porcelain', '--untracked-files=no'), '');
});

test("land folds regenerated output the companion tracks into the task's companion commit", () => {
  const fixture = trunk();
  const { clone, message } = fixture;
  const { companion, side, landed } = seedSpecList(fixture);
  writeFileSync(join(clone, 'a.txt'), 'two\n');
  writeFileSync(join(clone, 'a.spec'), 'two\n');

  const run = helper('land.mjs', clone, ['--message', message(GOOD)]);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(git(companion, 'log', '--format=%s', `${landed}..next`), 'feat(a): change a');
  assert.equal(git(companion, 'show', 'next:a.spec'), 'two');
  assert.equal(git(companion, 'show', 'next:tests/list.spec'), 'a.spec\nc.spec');
  assert.equal(side('status', '--porcelain', '--untracked-files=no'), '');
});

test('land runs the config landChecks before each --check, and a --check it already holds once', () => {
  const { dir, remote, clone, message } = trunk();
  git(clone, 'config', 'pstack.delivery', 'push');
  const ran = join(dir, 'ran');
  const config = JSON.parse(readFileSync(join(clone, '.agents/pstack.json'), 'utf8'));
  config.landChecks = [`echo always >> ${ran}`];
  writeFileSync(join(clone, '.agents/pstack.json'), JSON.stringify(config));
  writeFileSync(join(clone, 'a.txt'), 'two\n');

  const run = helper('land.mjs', clone, ['--message', message(GOOD), '--check', `echo named >> ${ran}`, '--check', `echo always >> ${ran}`]);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(readFileSync(ran, 'utf8'), 'always\nnamed\n');
  assert.equal(git(remote, 'show', 'next:a.txt'), 'two');
});

