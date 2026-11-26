import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { declinePushes, git, GOOD, helper, isAlive, NO_WAIT, seedGeneratedConflict, split, trunk, until } from './test-trunk.mjs';

const [gitMajor, gitMinor] = spawnSync('git', ['--version'], { encoding: 'utf8' }).stdout.match(/(\d+)\.(\d+)/u).slice(1).map(Number);
const NO_PREPARING = (gitMajor < 2 || (gitMajor === 2 && gitMinor < 54)) && 'needs git 2.54+';
const UNREACHABLE = 'http://127.0.0.1:9/unreachable.git';

test('land retries a raced companion fetch', { skip: NO_PREPARING }, () => {
  const fixture = trunk();
  const { dir, remote, clone, message } = fixture;
  const { sideElsewhere } = split(fixture);
  git(clone, 'config', 'pstack.delivery', 'push');
  git(sideElsewhere('c.spec', 'c\n', 'test(c): land elsewhere'), 'push', '--quiet', 'origin', 'HEAD:next');
  const gitDir = join(clone, '.git-private');
  const raced = join(dir, 'raced');
  writeFileSync(
    join(gitDir, 'hooks', 'reference-transaction'),
    `#!/bin/sh\n[ "$1" = preparing ] || exit 0\nwhile read old new ref; do\n  [ "$ref" = refs/remotes/origin/next ] && [ ! -e "${raced}" ] && touch "${raced}" && git --git-dir="${gitDir}" update-ref "$ref" "$new"\ndone\nexit 0\n`,
    { mode: 0o755 },
  );
  writeFileSync(join(clone, 'a.txt'), 'two\n');
  const run = helper('land.mjs', clone, ['--message', message(GOOD)]);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /another fetch moved \.git-private's origin\/next while land\.mjs fetched it; fetching again \(retry 1 of 2\)/);
  assert.equal(git(remote, 'log', '-1', '--format=%s', 'next'), 'feat(a): change a');
});

test('land keeps a rebased commit local and unrecorded when incoming next breaks checks', () => {
  const { dir, remote, clone, message, elsewhere } = trunk();
  git(clone, 'config', 'pstack.delivery', 'push');
  const ran = join(dir, 'ran');
  const other = elsewhere('d.txt', 'theirs\n', 'docs(d): land elsewhere');
  const check = ['--check', `echo run >> ${ran} && git -C ${other} push --quiet origin HEAD:next && ! { test -e c.txt && test -e d.txt; }`];
  writeFileSync(join(clone, 'c.txt'), 'mine\n');

  const run = helper('land.mjs', clone, ['--message', message(GOOD), ...check]);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /check failed: .*; the squashed commit stays local/);
  assert.equal(git(clone, 'rev-parse', 'HEAD^'), git(remote, 'rev-parse', 'next'));
  assert.equal(helper('land.mjs', clone, check).status, 1);
  assert.equal(readFileSync(ran, 'utf8').trim().split('\n').length, 3);
});

test('land retries unreachable push and fetch on GH006 schedule, exits 75, and rerun skips already-checked commit', () => {
  const { dir, remote, clone, base, message } = trunk();
  git(clone, 'config', 'pstack.delivery', 'push');
  const url = git(clone, 'remote', 'get-url', 'origin');
  writeFileSync(join(clone, 'a.txt'), 'two\n');

  // Unreachable fetch commits nothing and exits 75.
  git(clone, 'remote', 'set-url', 'origin', UNREACHABLE);
  const fetchFail = helper('land.mjs', clone, ['--message', message(GOOD)], NO_WAIT);
  assert.equal(fetchFail.status, 75);
  assert.match(fetchFail.stderr, /This run committed nothing/);
  assert.equal(git(clone, 'rev-parse', 'HEAD'), base);
  git(clone, 'remote', 'set-url', 'origin', url);

  // Unreachable push keeps commit local, exits 75, and rerun pushes without rechecking.
  const ran = join(dir, 'ran');
  const check = ['--check', `echo run >> ${ran}`];
  git(clone, 'config', 'remote.origin.pushurl', UNREACHABLE);
  const pushFail = helper('land.mjs', clone, ['--message', message(GOOD), ...check], NO_WAIT);
  assert.equal(pushFail.status, 75);
  assert.match(pushFail.stdout, /retry 1 of 5[\s\S]*retry 5 of 5/);
  assert.equal(git(remote, 'rev-parse', 'next'), base);

  git(clone, 'config', '--unset', 'remote.origin.pushurl');
  const rerun = helper('land.mjs', clone, check);
  assert.equal(rerun.status, 0, rerun.stderr);
  assert.match(rerun.stdout, /pushes without running the checks again/);
  assert.equal(readFileSync(ran, 'utf8').trim().split('\n').length, 1);
  assert.equal(git(remote, 'log', '-1', '--format=%s', 'next'), 'feat(a): change a');
});

test('land retries empty GH006, fails immediately on GH006 with reason, and invalidates recorded check on message/tree/freshEnv/parent change', () => {
  const { dir, remote, clone, message, elsewhere } = trunk();
  git(clone, 'config', 'pstack.delivery', 'push');
  assert.equal(helper('land.mjs', clone, [], { PSTACK_LAND_WAIT_SCALE: '-1' }).status, 2);

  // Empty GH006 retries and lands; GH006 with reason fails immediately.
  declinePushes(remote, 2);
  writeFileSync(join(clone, 'a.txt'), 'two\n');
  const retried = helper('land.mjs', clone, ['--message', message(GOOD)], NO_WAIT);
  assert.equal(retried.status, 0, retried.stderr);
  assert.match(retried.stdout, /empty GH006; pushing again in 1 min \(retry 1 of 5\)/);

  declinePushes(remote, 1, ['', 'Changes must be made through a pull request.']);
  writeFileSync(join(clone, 'a.txt'), 'three\n');
  const withReason = helper('land.mjs', clone, ['--message', message(GOOD)], NO_WAIT);
  assert.equal(withReason.status, 1);
  assert.doesNotMatch(withReason.stdout, /pushing again/);
  assert.match(withReason.stderr, /Changes must be made through a pull request/);

  // Recorded check skips only while tree, parent, message and freshEnv match.
  const ran = join(dir, 'ran');
  const runs = () => readFileSync(ran, 'utf8').trim().split('\n').length;
  const config = JSON.parse(readFileSync(join(clone, '.agents/pstack.json'), 'utf8'));
  writeFileSync(join(clone, '.agents/pstack.json'), JSON.stringify({ ...config, freshEnv: ['FORCE_CHECKS=true'] }));
  const check = ['--check', `echo run >> ${ran}`];
  declinePushes(remote, 99);
  assert.equal(helper('land.mjs', clone, ['--message', message(GOOD), ...check], NO_WAIT).status, 75);
  assert.equal(runs(), 1);
  assert.equal(helper('land.mjs', clone, check, { ...NO_WAIT, FORCE_CHECKS: 'false' }).status, 75);
  assert.equal(runs(), 1);
  assert.equal(helper('land.mjs', clone, check, { ...NO_WAIT, FORCE_CHECKS: 'true' }).status, 75);
  assert.equal(runs(), 2);
  assert.equal(helper('land.mjs', clone, ['--message', message('feat(a): other\n\nWhy.\n\nBeyond the ask: none\nPicks: none\nNot checked: none'), ...check], NO_WAIT).status, 75);
  assert.equal(runs(), 3);
  writeFileSync(join(clone, 'a.txt'), 'four\n');
  assert.equal(helper('land.mjs', clone, check, NO_WAIT).status, 75);
  assert.equal(runs(), 4);
  declinePushes(remote, 0);
  git(elsewhere('b.txt', 'two\n', 'fix(b): move next'), 'push', '--quiet', 'origin', 'HEAD:next');
  const afterParentMove = helper('land.mjs', clone, check, NO_WAIT);
  assert.equal(afterParentMove.status, 0, afterParentMove.stderr);
  assert.equal(runs(), 5);
});

test('land kills a check at 55 minutes into the run and stops retrying GH006 past 55 minutes', async () => {
  const { dir, remote, clone, base, message } = trunk();
  git(clone, 'config', 'pstack.delivery', 'push');
  const late = join(dir, 'late.mjs');
  writeFileSync(late, 'const now = performance.now.bind(performance);\nperformance.now = () => now() + 55 * 60_000 - 1_000;\n');
  const pid = join(dir, 'pid');
  writeFileSync(join(clone, 'a.txt'), 'two\n');

  const check = `sh -c 'echo $$ > ${pid}; exec sleep 60'`;
  const run = helper('land.mjs', clone, ['--message', message(GOOD), '--check', check], { ...NO_WAIT, NODE_OPTIONS: `--import ${late}` });
  assert.equal(run.status, 75, run.stderr);
  assert.match(run.stderr, /at 55 minutes into the run/);
  await until(() => !isAlive(Number(readFileSync(pid, 'utf8'))));
  assert.equal(git(remote, 'rev-parse', 'next'), base);

  writeFileSync(late, 'const now = performance.now.bind(performance);\nperformance.now = () => now() + 56 * 60_000;\n');
  declinePushes(remote, 1);
  const noRetry = helper('land.mjs', clone, [], { ...NO_WAIT, NODE_OPTIONS: `--import ${late}` });
  assert.equal(noRetry.status, 75);
  assert.doesNotMatch(noRetry.stdout, /pushing again/);
});

test('land stops on a rebase conflict and reruns without --message once resolved', () => {
  const { remote, clone, message, elsewhere } = trunk();
  const session = { CLAUDE_CODE_HOST_SESSION_ID: 'local_s1' };
  git(clone, 'config', 'pstack.delivery', 'push');
  git(elsewhere('a.txt', 'theirs\n', 'fix(a): land elsewhere'), 'push', '--quiet', 'origin', 'HEAD:next');
  writeFileSync(join(clone, 'a.txt'), 'mine\n');

  const stopped = helper('land.mjs', clone, ['--message', message(GOOD)], session);
  assert.equal(stopped.status, 1);
  assert.match(stopped.stderr, /conflicts in:\n {2}a\.txt\n/);
  assert.match(helper('land.mjs', clone).stderr, /a rebase, merge or revert is in progress/);

  writeFileSync(join(clone, 'a.txt'), 'both\n');
  git(clone, 'add', 'a.txt');
  git(clone, 'rebase', '--continue');
  const landed = helper('land.mjs', clone, [], session);
  assert.equal(landed.status, 0, landed.stderr);
  assert.equal(git(remote, 'log', '-1', '--format=%B', 'next'), `${GOOD}\n\nSession: local_s1\nLead: unknown`);
  assert.equal(git(remote, 'show', 'next:a.txt'), 'both');
});

test('land rebuilds generated-only conflicts, stops on source conflict / stray edit / rebuild failure, and runs always entries', () => {
  // Clean generated-only conflict rebuild.
  const f1 = trunk();
  const edit1 = seedGeneratedConflict(f1);
  edit1(f1.clone, 'b.txt', 'three\n');
  const ok = helper('land.mjs', f1.clone, ['--message', f1.message(GOOD)]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /takes origin\/next's side of them and rebuilds them/);
  assert.equal(git(f1.remote, 'show', 'next:gen/out.txt'), 'two\nthree');

  // Source conflict beside generated stops without rebuilding.
  const f2 = trunk();
  const edit2 = seedGeneratedConflict(f2);
  edit2(f2.clone, 'a.txt', 'mine\n');
  const srcConflict = helper('land.mjs', f2.clone, ['--message', f2.message(GOOD)]);
  assert.equal(srcConflict.status, 1);
  assert.match(srcConflict.stderr, /gen\/out\.txt is generated: .*`node gen\.mjs`/);
  assert.match(git(f2.clone, 'diff', '--name-only', '--diff-filter=U'), /gen\/out\.txt/);

  // Stray file outside generated paths stops; failed rebuild puts conflicts back.
  const f3 = trunk();
  const edit3 = seedGeneratedConflict(f3, 'node gen.mjs && echo stray > stray.txt && git add stray.txt');
  edit3(f3.clone, 'b.txt', 'three\n');
  assert.match(helper('land.mjs', f3.clone, ['--message', f3.message(GOOD)]).stderr, /also changed files outside its generated paths:\n {2}stray\.txt\n/);

  const f4 = trunk();
  const edit4 = seedGeneratedConflict(f4, 'node gen.mjs && exit 3');
  edit4(f4.clone, 'b.txt', 'three\n');
  assert.match(helper('land.mjs', f4.clone, ['--message', f4.message(GOOD)]).stderr, /failed, so land\.mjs put the conflicts back/);
  assert.match(git(f4.clone, 'diff', '--name-only', '--diff-filter=U'), /gen\/out\.txt/);

  // always: true rebuilds after clean rebase and folds into commit.
  const f5 = trunk();
  seedGeneratedConflict(f5, 'node gen.mjs', { always: true });
  writeFileSync(join(f5.clone, 'b.txt'), 'three\n');
  const always = helper('land.mjs', f5.clone, ['--message', f5.message(GOOD)]);
  assert.equal(always.status, 0, always.stderr);
  assert.match(always.stdout, /rebuilt gen\/out\.txt after the rebase/);
  assert.equal(git(f5.remote, 'show', 'next:gen/out.txt'), 'two\nthree');
});

test('land regenerates always entry across companion repo and deduplicates config landChecks vs --check', () => {
  const fixture = trunk();
  const { dir, remote, clone, message } = fixture;
  const { companion, side, sideElsewhere } = split(fixture);
  git(clone, 'config', 'pstack.delivery', 'push');
  const ran = join(dir, 'ran');
  writeFileSync(
    join(clone, 'gen.mjs'),
    "import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';\nconst specs = readdirSync('.').filter((n) => n.endsWith('.spec')).sort().join('\\n');\nfor (const d of ['gen', 'tests']) mkdirSync(d, { recursive: true });\nwriteFileSync('gen/specs.txt', specs);\nwriteFileSync('tests/list.spec', specs);\n",
  );
  const config = JSON.parse(readFileSync(join(clone, '.agents/pstack.json'), 'utf8'));
  config.generated = [{ paths: ['gen/**'], command: 'node gen.mjs', always: true }];
  config.landChecks = [`echo always >> ${ran}`];
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

  writeFileSync(join(clone, 'a.txt'), 'two\n');
  const run = helper('land.mjs', clone, ['--message', message(GOOD), '--check', `echo named >> ${ran}`, '--check', `echo always >> ${ran}`]);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(readFileSync(ran, 'utf8'), 'always\nnamed\n');
  assert.equal(git(remote, 'show', 'next:gen/specs.txt'), 'a.spec\nc.spec');
  assert.equal(git(companion, 'show', 'next:tests/list.spec'), 'a.spec\nc.spec');
  assert.match(git(companion, 'log', '-1', '--format=%B', 'next'), new RegExp(`^Lands-With: ${git(remote, 'rev-parse', 'next')}$`, 'mu'));
});
