import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { test } from 'node:test';
import { ENV, ghArgs, ghLines, git, GOOD, helper, HELPERS, isAlive, landingOnBothVersionFiles, NO_WAIT, PR, split, stubGh, trunk, until } from './test-trunk.mjs';

function signerFailingFrom(dir, failFrom) {
  const path = join(dir, 'signer');
  writeFileSync(path, ['#!/bin/sh', `n=$(($(cat '${path}.count' 2>/dev/null || echo 0) + 1))`, `echo "$n" > '${path}.count'`, `if [ "$n" -ge ${failFrom} ]; then echo 'signer is locked' >&2; exit 1; fi`, 'for last; do :; done', 'echo signature > "$last.sig"', ''].join('\n'), { mode: 0o755 });
  writeFileSync(`${path}.pub`, 'ssh-ed25519 AAAA test\n');
  return path;
}
const signWith = (run, path) => {
  run('config', 'commit.gpgsign', 'true');
  run('config', 'gpg.format', 'ssh');
  run('config', 'gpg.ssh.program', path);
  run('config', 'user.signingkey', `${path}.pub`);
};

test('land names the signer beside a squash commit it cannot sign, and puts the task commits back', () => {
  const { dir, clone, message } = trunk();
  writeFileSync(join(clone, 'a.txt'), 'two\n');
  git(clone, 'commit', '--quiet', '-am', 'wip');
  const head = git(clone, 'rev-parse', 'HEAD');
  const path = signerFailingFrom(dir, 1);
  signWith((...args) => git(clone, ...args), path);

  const run = helper('land.mjs', clone, ['--message', message(PR)], stubGh(dir));

  assert.equal(run.status, 1);
  assert.match(run.stderr, /signer is locked/);
  assert.match(run.stderr, /git commit failed; the task commits are back as they were/);
  assert.ok(run.stderr.includes(`signs its commits with ${path}.`), run.stderr);
  assert.match(run.stderr, /after they answer, run the same land\.mjs command again\.\n$/);
  assert.equal(git(clone, 'rev-parse', 'HEAD'), head);
});

test('land adds no signer text to a failed commit when signing is off', () => {
  const { dir, clone, message } = trunk();
  writeFileSync(join(clone, 'a.txt'), 'two\n');
  git(clone, 'commit', '--quiet', '-am', 'wip');
  const head = git(clone, 'rev-parse', 'HEAD');
  writeFileSync(join(clone, '.git/hooks/pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });

  const run = helper('land.mjs', clone, ['--message', message(PR)], stubGh(dir));

  assert.equal(run.status, 1);
  assert.match(run.stderr, /git commit failed; the task commits are back as they were\n$/);
  assert.doesNotMatch(run.stderr, /signs its commits/);
  assert.equal(git(clone, 'rev-parse', 'HEAD'), head);
});

test('land names the signer beside a rebase it cannot sign, and leaves no rebase in progress', () => {
  const { dir, clone, message, elsewhere } = trunk();
  writeFileSync(join(clone, 'a.txt'), 'two\n');
  const path = signerFailingFrom(dir, 2);
  signWith((...args) => git(clone, ...args), path);
  git(elsewhere('other.txt', 'two\n', 'feat(o): other'), 'push', '--quiet', 'origin', 'HEAD:next');

  const run = helper('land.mjs', clone, ['--message', message(PR)], stubGh(dir));

  assert.equal(run.status, 1);
  assert.match(run.stderr, /git rebase .* failed/);
  assert.ok(run.stderr.includes(`signs its commits with ${path}.`), run.stderr);
  assert.match(run.stderr, /after they answer, run land\.mjs again with the same --check options and no --message, because its commit stays local\.\n$/);
  assert.equal(spawnSync('git', ['rev-parse', '--verify', 'REBASE_HEAD'], { cwd: clone, env: ENV }).status, 128);
});

test('land names the signer beside a lint amend it cannot sign', () => {
  const { dir, clone, message } = trunk({ lint: true });
  writeFileSync(join(clone, 'a.txt'), 'two\n');
  const path = signerFailingFrom(dir, 2);
  signWith((...args) => git(clone, ...args), path);

  const run = helper('land.mjs', clone, ['--message', message(PR)], stubGh(dir));

  assert.equal(run.status, 1);
  assert.match(run.stderr, /commit --quiet --amend --no-edit failed/);
  assert.ok(run.stderr.includes(`signs its commits with ${path}.`), run.stderr);
});

test("land names the companion's own signer, and puts both task heads back", () => {
  const fixture = trunk();
  const { dir, clone, message } = fixture;
  const { side } = split(fixture);
  git(clone, 'config', 'pstack.delivery', 'push');
  writeFileSync(join(clone, 'a.txt'), 'two\n');
  writeFileSync(join(clone, 'a.spec'), 'two\n');
  git(clone, 'commit', '--quiet', '-am', 'wip');
  side('commit', '--quiet', '-am', 'wip');
  const heads = [git(clone, 'rev-parse', 'HEAD'), side('rev-parse', 'HEAD')];
  const path = signerFailingFrom(dir, 1);
  signWith(side, path);

  const run = helper('land.mjs', clone, ['--message', message(GOOD)]);

  assert.equal(run.status, 1);
  assert.ok(run.stderr.includes(`signs its commits with ${path}.`), run.stderr);
  assert.deepEqual([git(clone, 'rev-parse', 'HEAD'), side('rev-parse', 'HEAD')], heads);
});

test('land names the program git runs for the signing format, not the openpgp one', () => {
  const { dir, clone, message } = trunk();
  writeFileSync(join(clone, 'a.txt'), 'two\n');
  git(clone, 'config', 'commit.gpgsign', 'true');
  git(clone, 'config', 'gpg.format', 'ssh');
  git(clone, 'config', 'gpg.program', '/unrelated/openpgp');
  git(clone, 'config', 'user.signingkey', join(dir, 'missing.pub'));

  const run = helper('land.mjs', clone, ['--message', message(PR)], stubGh(dir));

  assert.equal(run.status, 1);
  assert.match(run.stderr, /signs its commits with ssh-keygen\./);
  assert.doesNotMatch(run.stderr, /unrelated/);
});

function gitWatchingReads(dir, { holdCompanionRead = false, landAfterCompanionRead, landAfterPublicRead }) {
  const real = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim();
  const reads = join(dir, 'reads');
  const started = join(dir, 'public-read-started');
  const landed = join(dir, 'landed');
  const land = (halves) => (halves ? `if [ ! -e '${landed}' ]; then touch '${landed}'; ${halves.map((half) => `'${real}' -C '${half}' push --quiet origin HEAD:next`).join('; ')}; fi` : ':');
  const bin = join(dir, 'reads-bin');
  mkdirSync(bin);
  writeFileSync(
    join(bin, 'git'),
    [
      '#!/bin/sh',
      'case "$*" in',
      '  --git-dir=*" fetch "*)',
      `    echo companion-start >> '${reads}'; rm -f '${started}'`,
      holdCompanionRead ? `    i=0; while [ ! -e '${started}' ] && [ "$i" -lt 30 ]; do sleep 0.1; i=$((i + 1)); done` : '    :',
      `    '${real}' "$@"; status=$?`,
      `    echo companion-end >> '${reads}'`,
      `    ${land(landAfterCompanionRead)}`,
      '    exit $status ;;',
      '  "fetch "*)',
      `    echo public-start >> '${reads}'; touch '${started}'`,
      `    '${real}' "$@"; status=$?`,
      `    ${land(landAfterPublicRead)}`,
      '    exit $status ;;',
      'esac',
      `exec '${real}' "$@"`,
      '',
    ].join('\n'),
    { mode: 0o755 }
  );
  return { bin, reads };
}

test('land finishes reading the companion before it starts reading the public half, on the first read and on the retry after a rejected push', () => {
  const fixture = trunk();
  const { dir, remote, clone, message, elsewhere } = fixture;
  const { companion, sideElsewhere } = split(fixture);
  git(clone, 'config', 'pstack.delivery', 'push');
  const other = elsewhere('other.txt', 'two\n', 'feat(o): other');
  const otherSide = sideElsewhere('other.spec', 'two\n', 'feat(o): other');
  const { bin, reads } = gitWatchingReads(dir, { holdCompanionRead: true, landAfterPublicRead: [other, otherSide] });
  writeFileSync(join(clone, 'a.txt'), 'two\n');

  const run = helper('land.mjs', clone, ['--message', message(GOOD), '--check', 'test ! -f other.spec || test -f other.txt'], { PATH: `${bin}:${ENV.PATH}` });

  assert.equal(run.status, 0, run.stderr);
  const oneRead = ['companion-start', 'companion-end', 'public-start'];
  const beforePush = ['companion-start', 'companion-end'];
  assert.deepEqual(readFileSync(reads, 'utf8').trim().split('\n'), [...oneRead, ...beforePush, ...oneRead, ...beforePush]);
  assert.equal(git(remote, 'show', 'next:a.txt'), 'two');
  assert.equal(git(remote, 'show', 'next:other.txt'), 'two');
  assert.equal(git(companion, 'show', 'next:other.spec'), 'two');
});

test('a check that ran on a public commit whose companion half arrived after the read checks both halves again in the same run, and lands', () => {
  const fixture = trunk();
  const { dir, remote, clone, message } = fixture;
  const { sideElsewhere } = split(fixture);
  git(clone, 'config', 'pstack.delivery', 'push');
  const halves = landingOnBothVersionFiles(fixture, sideElsewhere);
  const { bin } = gitWatchingReads(dir, { landAfterCompanionRead: halves });
  writeFileSync(join(clone, 'a.txt'), 'two\n');
  const pairs = 'test "$(cat b.txt)" = "$(cat a.spec)"';

  const run = helper('land.mjs', clone, ['--message', message(GOOD), '--check', pairs], { PATH: `${bin}:${ENV.PATH}` });

  assert.equal(run.status, 0, run.stderr);
  assert.ok(run.stdout.includes(`it ran on ${git(halves[0], 'rev-parse', 'HEAD')} without that commit's .git-private half`), run.stdout);
  assert.match(run.stdout, /^\.git-private's origin\/next moved; rebasing and pushing again \(retry 1 of 3\)$/m);
  assert.equal(git(remote, 'show', 'next:a.txt'), 'two');
});

// Puts the helpers on next, so the clone runs its own copy as a worktree does, and returns a commit elsewhere whose land.mjs prints a line.
function helpersOnNext(fixture) {
  const { clone, elsewhere } = fixture;
  cpSync(HELPERS, join(clone, '.agents/pstack'), { recursive: true });
  git(clone, 'add', '--all');
  git(clone, 'commit', '--quiet', '-m', 'chore(pstack): sync the helpers');
  git(clone, 'push', '--quiet', 'origin', 'HEAD:next');
  const land = readFileSync(join(HELPERS, 'land.mjs'), 'utf8').replace('// Installed by the sync-pstack skill.\n', "// Installed by the sync-pstack skill.\nconsole.log('the rebased land.mjs ran');\n");
  return elsewhere('.agents/pstack/land.mjs', land, 'chore(pstack): sync a newer land.mjs');
}
const ownLand = (clone, args, env = {}) =>
  spawnSync(process.execPath, [join(clone, '.agents/pstack/land.mjs'), ...args], { cwd: clone, encoding: 'utf8', env: { ...ENV, ...NO_WAIT, ...env } });

test('a landing whose rebase brings a newer land.mjs goes on in a new process that runs the rebased copy, and lands', () => {
  const fixture = trunk();
  const { dir, remote, clone, message } = fixture;
  git(clone, 'config', 'pstack.delivery', 'push');
  const newer = helpersOnNext(fixture);
  git(newer, 'push', '--quiet', 'origin', 'HEAD:next');
  const ran = join(dir, 'ran');
  writeFileSync(join(clone, 'a.txt'), 'two\n');

  const run = ownLand(clone, ['--message', message(GOOD), '--check', `echo run >> ${ran}`]);

  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /the rebase changed \.agents\/pstack or \.agents\/pstack\.json, so land\.mjs goes on in a new process/);
  assert.equal(run.stdout.match(/the rebased land\.mjs ran/g)?.length, 1, run.stdout);
  assert.equal(readFileSync(ran, 'utf8'), 'run\n', 'the process that loaded the old helpers ran no check');
  assert.equal(git(remote, 'log', '-1', '--format=%B', 'next'), `${GOOD}\n\nLead: unknown`);
});

test('a landing whose retry rebases onto a newer land.mjs goes on in a new process that checks again, and lands', () => {
  const fixture = trunk();
  const { dir, remote, clone, message } = fixture;
  git(clone, 'config', 'pstack.delivery', 'push');
  const newer = helpersOnNext(fixture);
  const ran = join(dir, 'ran');
  writeFileSync(join(clone, 'a.txt'), 'two\n');
  const check = `echo run >> ${ran}; [ -e ${ran}.moved ] || { touch ${ran}.moved; git -C ${newer} push --quiet origin HEAD:next; }`;

  const run = ownLand(clone, ['--message', message(GOOD), '--check', check]);

  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /origin\/next moved; rebasing and pushing again \(retry 1 of 3\)/);
  assert.equal(run.stdout.match(/the rebased land\.mjs ran/g)?.length, 1, run.stdout);
  assert.equal(readFileSync(ran, 'utf8'), 'run\nrun\n');
  assert.equal(git(remote, 'show', 'next:a.txt'), 'two');
});

test('a landing that goes on in a new process counts the minutes the process before it spent toward its 55', () => {
  const { dir, clone, message } = trunk();
  git(clone, 'config', 'pstack.delivery', 'push');
  const ran = join(dir, 'ran');
  writeFileSync(join(clone, 'a.txt'), 'two\n');

  const run = helper('land.mjs', clone, ['--message', message(GOOD), '--check', `touch ${ran}`], { ...NO_WAIT, PSTACK_LAND_SPENT_MS: String(55 * 60_000) });

  assert.equal(run.status, 75, run.stderr);
  assert.match(run.stderr, /at 55 minutes into the run/);
  assert.equal(existsSync(ran), false);
});

test('land keeps a failed check at exit 1 when the companion half that arrived belongs to a public commit the clone holds but the check did not run on', () => {
  const fixture = trunk();
  const { dir, clone, message } = fixture;
  const { sideElsewhere } = split(fixture);
  git(clone, 'config', 'pstack.delivery', 'push');
  const halves = landingOnBothVersionFiles(fixture, sideElsewhere);
  git(clone, 'fetch', '--quiet', halves[0], 'HEAD');
  const { bin } = gitWatchingReads(dir, { landAfterPublicRead: halves });
  writeFileSync(join(clone, 'a.txt'), 'two\n');

  const run = helper('land.mjs', clone, ['--message', message(GOOD), '--check', 'false'], { PATH: `${bin}:${ENV.PATH}` });

  assert.equal(run.status, 1, run.stderr);
  assert.match(run.stderr, /check failed: false; the squashed commit stays local\n$/);
});

test('land keeps a failed check at exit 1 when the companion commit that arrived lands no public half', () => {
  const fixture = trunk();
  const { dir, remote, clone, message } = fixture;
  const { sideElsewhere } = split(fixture);
  git(clone, 'config', 'pstack.delivery', 'push');
  const otherSide = sideElsewhere('other.spec', 'two\n', 'feat(o): other spec');
  git(otherSide, 'commit', '--quiet', '--amend', '-m', `feat(o): other spec\n\nLands-With: ${git(remote, 'rev-parse', 'next')}`);
  const { bin } = gitWatchingReads(dir, { landAfterCompanionRead: [otherSide] });
  writeFileSync(join(clone, 'a.txt'), 'two\n');

  const run = helper('land.mjs', clone, ['--message', message(GOOD), '--check', 'false'], { PATH: `${bin}:${ENV.PATH}` });

  assert.equal(run.status, 1, run.stderr);
  assert.match(run.stderr, /check failed: false; the squashed commit stays local\n$/);
});

test("land names the companion's signer beside a Lands-With stamp it cannot sign after the public half landed, and a rerun lands that half", () => {
  const fixture = trunk();
  const { dir, remote, clone, message } = fixture;
  const { companion, side } = split(fixture);
  git(clone, 'config', 'pstack.delivery', 'push');
  writeFileSync(join(clone, 'a.txt'), 'two\n');
  writeFileSync(join(clone, 'a.spec'), 'two\n');
  git(clone, 'commit', '--quiet', '-am', 'wip');
  side('commit', '--quiet', '-am', 'wip');
  const path = signerFailingFrom(dir, 2);
  signWith(side, path);

  const run = helper('land.mjs', clone, ['--message', message(GOOD)]);

  assert.equal(run.status, 1);
  assert.ok(run.stderr.includes(`signs its commits with ${path}.`), run.stderr);
  assert.equal(git(remote, 'show', 'next:a.txt'), 'two');
  assert.equal(git(companion, 'show', 'next:a.spec'), 'one');

  signerFailingFrom(dir, 99);
  const rerun = helper('land.mjs', clone, []);

  assert.equal(rerun.status, 0, rerun.stderr);
  assert.equal(git(companion, 'show', 'next:a.spec'), 'two');
  assert.match(git(companion, 'log', '-1', '--format=%B', 'next'), new RegExp(`^Lands-With: ${git(remote, 'rev-parse', 'next')}$`, 'mu'));
});

test("land names the companion's signer beside a companion rebase it cannot sign", () => {
  const fixture = trunk();
  const { dir, clone, message } = fixture;
  const { side, sideElsewhere } = split(fixture);
  git(clone, 'config', 'pstack.delivery', 'push');
  writeFileSync(join(clone, 'a.spec'), 'two\n');
  const path = signerFailingFrom(dir, 2);
  signWith(side, path);
  git(sideElsewhere('other.spec', 'two\n', 'feat(o): other'), 'push', '--quiet', 'origin', 'HEAD:next');

  const run = helper('land.mjs', clone, ['--message', message(GOOD)]);

  assert.equal(run.status, 1);
  assert.match(run.stderr, /git rebase .*\.git-private.* failed/);
  assert.ok(run.stderr.includes(`signs its commits with ${path}.`), run.stderr);
});

test('land names the last of the two openpgp program settings, as git runs it', () => {
  const { clone, message } = trunk();
  git(clone, 'config', 'pstack.delivery', 'push');
  writeFileSync(join(clone, 'a.txt'), 'two\n');
  git(clone, 'config', 'commit.gpgsign', 'true');
  git(clone, 'config', 'gpg.openpgp.program', '/first/gpg');
  git(clone, 'config', 'gpg.program', '/last/gpg');

  const run = helper('land.mjs', clone, ['--message', message(GOOD)]);

  assert.equal(run.status, 1);
  assert.ok(run.stderr.includes('signs its commits with /last/gpg.'), run.stderr);
});

test('land names the default signing program of each format when no setting names one', () => {
  for (const [format, program] of [['openpgp', 'gpg'], ['x509', 'gpgsm']]) {
    const { dir, clone, message } = trunk();
    git(clone, 'config', 'pstack.delivery', 'push');
    const bin = join(dir, 'signer-bin');
    mkdirSync(bin);
    writeFileSync(join(bin, program), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    writeFileSync(join(clone, 'a.txt'), 'two\n');
    git(clone, 'config', 'commit.gpgsign', 'true');
    git(clone, 'config', 'gpg.format', format);

    const run = helper('land.mjs', clone, ['--message', message(GOOD)], { PATH: `${bin}:${ENV.PATH}` });

    assert.equal(run.status, 1);
    assert.ok(run.stderr.includes(`signs its commits with ${program}.`), run.stderr);
  }
});

