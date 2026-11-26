import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { test } from 'node:test';
import { ENV, ghArgs, ghLines, git, GOOD, helper, HELPERS, isAlive, NO_WAIT, PR, split, stubGh, trunk, until } from './test-trunk.mjs';

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
  land('two.txt', 'fix(b): two', `No plan here.\n\nBeyond the ask: renamed c\nIntroduced-by: ${one}\n\nBeyond the ask:\nmoved d\n\nSession: s2`);
  const three = land('three.txt', 'docs(a): three', 'See docs/plans/2026-10-17-x.md.\n\nBeyond the ask: none\n\nSession: local_s1');
  const four = land('four.txt', 'chore: four', 'Beyond the ask: none\nPicks: kept the old name,\nreversed by rename\nNot checked: Windows paths\nShipped fast, no review.');
  git(clone, 'push', '--quiet', 'origin', 'HEAD:next');
  const reviewed = () => git(clone, 'rev-parse', 'refs/pstack/reviewed');

  const listed = helper('review.mjs', clone).stdout;
  assert.match(listed, /^4 commit\(s\) to review on origin\/next since refs\/pstack\/reviewed/);
  assert.match(
    listed,
    /\n\nSession local_s1 \(claude:\/\/claude\.ai\/epitaxy\/local_s1\)\n {2}\w+ feat\(a\): one\n {4}docs\/plans\/2026-10-17-x\.md\n {4}Beyond the ask: none\n {2}\w+ docs\(a\): three\n {4}docs\/plans\/2026-10-17-x\.md\n {4}Beyond the ask: none\n {2}Net: node \.agents\/pstack\/review\.mjs --net local_s1\n\nSession s2\n {2}\w+ fix\(b\): two\n {4}No plan link\n {4}Beyond the ask: renamed c Beyond the ask: moved d\n\nNo Session: line \(--done none\)\n {2}\w+ chore: four\n {4}No plan link\n {4}Beyond the ask: none\n {4}Picks: kept the old name, reversed by rename\n {4}Not checked: Windows paths\n/
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
    const run = helper('land.mjs', clone, ['--message', message(`${subject}\n\nWhy.\n\nBeyond the ask: none\nPicks: none\nNot checked: none`)], { CLAUDE_CODE_HOST_SESSION_ID: session });
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
  assert.match(body, /^Not checked: the reverted tree, beyond the lint fix and the config's landChecks$/mu);
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
  assert.match(body, /^Not checked: none$/mu);
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

test('review --revert lands a session whose subject landed before the writing check', () => {
  const { remote, clone, worktree } = sessions();
  writeFileSync(join(clone, 'e.txt'), 'e\n');
  git(clone, 'add', 'e.txt');
  git(clone, 'commit', '--quiet', '-m', 'feat(e): add e — a vibrant one\n\nSession: local_bbbbbbbb-2222');
  git(clone, 'push', '--quiet', 'origin', 'HEAD:next');

  const run = helper('review.mjs', worktree, ['--revert', 'local_bbbbbbbb-2222']);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(git(remote, 'ls-tree', '--name-only', 'next', '--', 'e.txt'), '');
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

function attach(clone, worktree) {
  git(clone, 'worktree', 'add', '--quiet', '--detach', worktree, 'origin/next');
  const target = join(mkdtempSync(join(tmpdir(), 'attach-')), 'w');
  git(clone, '--git-dir=.git-private', 'worktree', 'add', '--quiet', '--no-checkout', '--detach', target, 'origin/next');
  const link = readFileSync(join(target, '.git'), 'utf8');
  writeFileSync(join(worktree, '.git-private'), link);
  writeFileSync(join(link.replace(/^gitdir: /u, '').trim(), 'gitdir'), `${join(worktree, '.git-private')}\n`);
  git(worktree, '--git-dir=.git-private', '--work-tree=.', 'reset', '--quiet', '--hard');
}

test('review lists the companion commits by session beside their public pair, flags their weakened tests, and moves both refs', () => {
  const fixture = trunk();
  const { clone } = fixture;
  const { companion, side } = split(fixture);
  const config = JSON.parse(readFileSync(join(clone, '.agents/pstack.json'), 'utf8'));
  writeFileSync(join(clone, '.agents/pstack.json'), JSON.stringify({ ...config, reviewPaths: { tests: ['**/*.spec'], public: ['*.txt'] } }));
  git(clone, 'commit', '--quiet', '-am', 'review paths');
  git(clone, 'push', '--quiet', 'origin', 'HEAD:next');
  writeFileSync(join(clone, 'a.spec'), 'expect(1);\nexpect(2);\n');
  writeFileSync(join(clone, 'b.spec'), 'expect(3);\n');
  side('add', '--force', 'a.spec', 'b.spec');
  side('commit', '--quiet', '-m', 'tests');
  side('push', '--quiet', 'origin', 'HEAD:next');
  assert.match(helper('review.mjs', clone, ['--mark']).stdout, /Marked origin\/next at \w+ as reviewed\.\nMarked \.git-private's origin\/next at \w+ as reviewed\./);
  assert.equal(side('rev-parse', 'refs/pstack/reviewed'), git(companion, 'rev-parse', 'next'));

  writeFileSync(join(clone, 'a.txt'), 'two\n');
  git(clone, 'commit', '--quiet', '-am', 'feat(a): change a', '-m', 'Beyond the ask: none\n\nSession: s1');
  git(clone, 'push', '--quiet', 'origin', 'HEAD:next');
  const pub = git(clone, 'rev-parse', 'HEAD');
  writeFileSync(join(clone, 'a.spec'), 'expect(1);\n');
  side('commit', '--quiet', '-am', 'feat(a): change a', '-m', `Beyond the ask: none\n\nSession: s1\nLands-With: ${pub}`);
  const pair = side('rev-parse', 'HEAD');
  side('rm', '--quiet', 'b.spec');
  side('commit', '--quiet', '-m', 'test(b): drop b', '-m', `Beyond the ask: none\n\nSession: s2\nLands-With: ${pub}`);
  side('push', '--quiet', 'origin', 'HEAD:next');

  const listed = helper('review.mjs', clone).stdout;
  assert.match(listed, /^3 commit\(s\) with public changes or weakened tests to review on origin\/next/);
  assert.match(
    listed,
    new RegExp(`\\n\\nSession s1\\n {2}\\w+ feat\\(a\\): change a\\n.*\\n.*\\n {4}1 public file\\(s\\): a\\.txt\\n {2}\\w+ feat\\(a\\): change a\\n {4}In \\.git-private, with ${pub.slice(0, 7)}\\n.*\\n.*\\n {4}Tests: 1 fewer expect or assert lines\\n`, 'u')
  );
  assert.match(listed, /\n\nSession s2\n {2}\w+ test\(b\): drop b\n {4}In \.git-private\n.*\n.*\n {4}Tests: deleted 1 test file\(s\): b\.spec/);

  assert.match(helper('review.mjs', clone, ['--done', 's1']).stdout, /Marked 2 commit\(s\) of session s1 as reviewed\./);
  assert.equal(git(clone, 'rev-parse', 'refs/pstack/reviewed'), pub);
  assert.equal(side('rev-parse', 'refs/pstack/reviewed'), pair, "the companion's ref stops before its oldest commit still to review");
  helper('review.mjs', clone, ['--done', 's2']);
  assert.equal(side('rev-parse', 'refs/pstack/reviewed'), git(companion, 'rev-parse', 'next'));
  assert.match(helper('review.mjs', clone).stdout, /^No commits with public changes or weakened tests to review/);
});

test('review --revert undoes a session in both halves and lands the pair', () => {
  const fixture = trunk();
  const { dir, remote, clone, message } = fixture;
  const { companion } = split(fixture);
  git(clone, 'config', 'pstack.delivery', 'push');
  const land = (files, subject, session) => {
    for (const [path, text] of Object.entries(files)) writeFileSync(join(clone, path), text);
    const run = helper('land.mjs', clone, ['--message', message(`${subject}\n\nWhy.\n\nBeyond the ask: none\nPicks: none\nNot checked: none`)], { CLAUDE_CODE_HOST_SESSION_ID: session });
    assert.equal(run.status, 0, run.stderr);
  };
  land({ 'a.txt': 'two\n', 'a.spec': 'two\n' }, 'feat(a): one changes a', ONE);
  land({ 'b.txt': 'two\n', 'b.spec': 'two\n' }, 'feat(b): two changes b', TWO);
  land({ 'c.spec': 'c\n' }, 'test(c): one adds c', ONE);
  const ones = git(companion, 'log', '--format=%H', `--grep=^Session: ${ONE}$`, 'next').split('\n');
  const worktree = join(dir, 'worktree');
  attach(clone, worktree);
  writeFileSync(join(worktree, 'a.spec'), 'dirty\n');
  const dirty = helper('review.mjs', worktree, ['--revert', ONE]);
  assert.equal(dirty.status, 1);
  assert.match(dirty.stderr, /uncommitted changes/, 'the clean check covers the companion half');
  git(worktree, '--git-dir=.git-private', '--work-tree=.', 'checkout', '--', 'a.spec');

  const run = helper('review.mjs', worktree, ['--revert', ONE]);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(git(remote, 'show', 'next:a.txt'), 'one');
  assert.equal(git(remote, 'show', 'next:b.txt'), 'two');
  assert.equal(git(companion, 'show', 'next:a.spec'), 'one');
  assert.equal(git(companion, 'show', 'next:b.spec'), 'two', "the other session's companion commit stays");
  assert.equal(git(companion, 'ls-tree', '--name-only', 'next', '--', 'c.spec'), '');
  const body = git(companion, 'log', '-1', '--format=%B', 'next');
  assert.equal(body.split('\n')[0], 'fix(revert): undo session aaaaaaaa');
  for (const sha of ones) assert.match(body, new RegExp(`^Introduced-by: ${sha}$`, 'mu'));
  assert.match(body, new RegExp(`^Lands-With: ${git(remote, 'rev-parse', 'next')}$`, 'mu'));
});

test('review --revert leaves the revert local and pushes nothing when a check fails', () => {
  const { remote, worktree, third } = sessions();
  const run = helper('review.mjs', worktree, ['--revert', ONE, '--check', 'false']);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /check failed: false/);
  assert.equal(git(remote, 'rev-parse', 'next'), third);
  assert.equal(git(worktree, 'log', '-1', '--format=%s'), 'fix(revert): undo session aaaaaaaa');
});

