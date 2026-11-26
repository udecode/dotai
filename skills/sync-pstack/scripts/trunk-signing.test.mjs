import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ENV, git, GOOD, helper, HELPERS, landingOnBothVersionFiles, NO_WAIT, PR, split, stubGh, trunk } from './test-trunk.mjs';

function signerFailingFrom(dir, failFrom) {
  const path = join(dir, 'signer');
  rmSync(`${path}.count`, { force: true });
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

test('land names the configured signing program on squash/rebase failures, restores state, and omits signer text when signing is off', () => {
  const { dir, clone, message, elsewhere } = trunk();
  const gh = stubGh(dir);
  writeFileSync(join(clone, 'a.txt'), 'two\n');
  git(clone, 'commit', '--quiet', '-am', 'wip');
  const head = git(clone, 'rev-parse', 'HEAD');

  // Signing off + pre-commit failure omits signer text and restores HEAD.
  const preCommit = join(clone, '.git/hooks/pre-commit');
  writeFileSync(preCommit, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const off = helper('land.mjs', clone, ['--message', message(PR)], gh);
  assert.equal(off.status, 1);
  assert.doesNotMatch(off.stderr, /signs its commits/);
  assert.equal(git(clone, 'rev-parse', 'HEAD'), head);
  writeFileSync(preCommit, '#!/bin/sh\nexit 0\n', { mode: 0o755 });

  // SSH signer failure on squash names signer and restores HEAD.
  const path = signerFailingFrom(dir, 1);
  signWith((...args) => git(clone, ...args), path);
  const sq = helper('land.mjs', clone, ['--message', message(PR)], gh);
  assert.equal(sq.status, 1);
  assert.ok(sq.stderr.includes(`signs its commits with ${path}.`), sq.stderr);
  assert.equal(git(clone, 'rev-parse', 'HEAD'), head);

  // Format-specific signer lookup (ssh ignores gpg.program; openpgp uses last setting).
  git(clone, 'config', '--unset', 'gpg.ssh.program');
  git(clone, 'config', 'gpg.program', '/first/gpg');
  assert.match(helper('land.mjs', clone, ['--message', message(PR)], gh).stderr, /signs its commits with ssh-keygen\./);
  git(clone, 'config', 'gpg.format', 'openpgp');
  git(clone, 'config', 'gpg.openpgp.program', '/last/gpg');
  assert.ok(helper('land.mjs', clone, ['--message', message(PR)], gh).stderr.includes('signs its commits with /last/gpg.'));

  // Rebase signing failure aborts rebase and leaves no REBASE_HEAD.
  git(clone, 'config', 'gpg.format', 'ssh');
  signWith((...args) => git(clone, ...args), signerFailingFrom(dir, 2));
  git(elsewhere('other.txt', 'two\n', 'feat(o): other'), 'push', '--quiet', 'origin', 'HEAD:next');
  const rb = helper('land.mjs', clone, ['--message', message(PR)], gh);
  assert.equal(rb.status, 1);
  assert.match(rb.stderr, /git rebase .* failed/);
  assert.equal(spawnSync('git', ['rev-parse', '--verify', 'REBASE_HEAD'], { cwd: clone, env: ENV }).status, 128);
});

test('land reports companion signer failure on Lands-With stamp and recovers on rerun', () => {
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
    { mode: 0o755 },
  );
  return { bin, reads };
}

test('land reads companion before public, rechecks when a paired companion half arrives late, and keeps unrelated check failures at exit 1', () => {
  const f1 = trunk();
  const { sideElsewhere: se1 } = split(f1);
  git(f1.clone, 'config', 'pstack.delivery', 'push');
  const halves = landingOnBothVersionFiles(f1, se1);
  const { bin: bin1, reads } = gitWatchingReads(f1.dir, { holdCompanionRead: true, landAfterCompanionRead: halves });
  writeFileSync(join(f1.clone, 'a.txt'), 'two\n');

  const ok = helper('land.mjs', f1.clone, ['--message', f1.message(GOOD), '--check', 'test "$(cat b.txt)" = "$(cat a.spec)"'], { PATH: `${bin1}:${ENV.PATH}` });
  assert.equal(ok.status, 0, ok.stderr);
  assert.deepEqual(readFileSync(reads, 'utf8').trim().split('\n').slice(0, 3), ['companion-start', 'companion-end', 'public-start']);
  assert.ok(ok.stdout.includes(`without that commit's .git-private half`), ok.stdout);

  // Companion-only arrival without a paired public half leaves a failing check at exit 1.
  const f2 = trunk();
  const { sideElsewhere: se2 } = split(f2);
  git(f2.clone, 'config', 'pstack.delivery', 'push');
  const otherSide = se2('other.spec', 'two\n', 'feat(o): other spec');
  git(otherSide, 'commit', '--quiet', '--amend', '-m', `feat(o): other spec\n\nLands-With: ${git(f2.remote, 'rev-parse', 'next')}`);
  const { bin: bin2 } = gitWatchingReads(f2.dir, { landAfterCompanionRead: [otherSide] });
  writeFileSync(join(f2.clone, 'a.txt'), 'two\n');
  const fail = helper('land.mjs', f2.clone, ['--message', f2.message(GOOD), '--check', 'false'], { PATH: `${bin2}:${ENV.PATH}` });
  assert.equal(fail.status, 1);
  assert.match(fail.stderr, /check failed: false; the squashed commit stays local\n$/);
});

test('land re-execs when rebase brings a newer land.mjs and carries forward spent time across re-execs', () => {
  const fixture = trunk();
  const { dir, remote, clone, message, elsewhere } = fixture;
  git(clone, 'config', 'pstack.delivery', 'push');
  cpSync(HELPERS, join(clone, '.agents/pstack'), { recursive: true });
  git(clone, 'add', '--all');
  git(clone, 'commit', '--quiet', '-m', 'chore(pstack): sync helpers');
  git(clone, 'push', '--quiet', 'origin', 'HEAD:next');
  const newerText = readFileSync(join(HELPERS, 'land.mjs'), 'utf8').replace('// Installed by the sync-pstack skill.\n', "// Installed by the sync-pstack skill.\nconsole.log('the rebased land.mjs ran');\n");
  const newer = elsewhere('.agents/pstack/land.mjs', newerText, 'chore(pstack): newer land.mjs');
  git(newer, 'push', '--quiet', 'origin', 'HEAD:next');

  const ran = join(dir, 'ran');
  writeFileSync(join(clone, 'a.txt'), 'two\n');
  const run = spawnSync(process.execPath, [join(clone, '.agents/pstack/land.mjs'), '--message', message(GOOD), '--check', `echo run >> ${ran}`], {
    cwd: clone,
    encoding: 'utf8',
    env: { ...ENV, ...NO_WAIT },
  });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /goes on in a new process/);
  assert.equal(run.stdout.match(/the rebased land\.mjs ran/g)?.length, 1);
  assert.equal(readFileSync(ran, 'utf8'), 'run\n');
  assert.equal(git(remote, 'show', 'next:a.txt'), 'two');

  // PSTACK_LAND_SPENT_MS carries deadline across processes.
  writeFileSync(join(clone, 'a.txt'), 'three\n');
  const spent = helper('land.mjs', clone, ['--message', message(GOOD), '--check', `touch ${join(dir, 'nope')}`], { ...NO_WAIT, PSTACK_LAND_SPENT_MS: String(55 * 60_000) });
  assert.equal(spent.status, 75);
  assert.equal(existsSync(join(dir, 'nope')), false);
});
