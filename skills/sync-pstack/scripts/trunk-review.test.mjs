import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { git, helper, split, stubGh, trunk } from './test-trunk.mjs';

test('review groups commits by session, --done advances ref past reviewed commits, and --mark marks all', () => {
  const { clone } = trunk();
  assert.match(helper('review.mjs', clone, ['--mark']).stdout, /Marked origin\/next at \w+ as reviewed/);
  const land = (file, subject, body) => {
    writeFileSync(join(clone, file), `${subject}\n`);
    git(clone, 'add', file);
    git(clone, 'commit', '--quiet', '-m', subject, '-m', body);
    return git(clone, 'rev-parse', 'HEAD');
  };
  const one = land('one.txt', 'feat(a): one', 'Beyond the ask: none\n\nSession: local_s1\nPlan: docs/plans/2026-10-17-x.md');
  land('two.txt', 'fix(b): two', `No plan.\n\nBeyond the ask: renamed c\nIntroduced-by: ${one}\n\nSession: s2`);
  const three = land('three.txt', 'docs(a): three', 'See docs/plans/2026-10-17-x.md.\n\nBeyond the ask: none\n\nSession: local_s1');
  const four = land('four.txt', 'chore: four', 'Beyond the ask: none\nPicks: kept old name\nNot checked: Windows paths');
  git(clone, 'push', '--quiet', 'origin', 'HEAD:next');
  const reviewed = () => git(clone, 'rev-parse', 'refs/pstack/reviewed');

  const listed = helper('review.mjs', clone).stdout;
  assert.match(listed, /^4 commit\(s\) to review on origin\/next since refs\/pstack\/reviewed/);
  assert.match(listed, /Session local_s1\n[\s\S]*Net: node \.agents\/pstack\/review\.mjs --net local_s1/);
  assert.match(listed, /No Session: line \(--done none\)[\s\S]*Picks: kept old name[\s\S]*Not checked: Windows paths/);
  assert.equal(helper('review.mjs', clone, ['--done']).status, 2);

  assert.match(helper('review.mjs', clone, ['--done', 'local_s1']).stdout, /Marked 2 commit\(s\) of session local_s1 as reviewed/);
  assert.equal(reviewed(), one);
  assert.equal(helper('review.mjs', clone, ['--done', 'local_s1']).status, 1);

  helper('review.mjs', clone, ['--done', 's2']);
  assert.equal(reviewed(), three);
  helper('review.mjs', clone, ['--done', 'none']);
  assert.equal(reviewed(), four);
  assert.match(helper('review.mjs', clone).stdout, /^No commits to review/);
  assert.equal(helper('review.mjs', clone, ['--tier', 'public']).status, 2);
});

test('review filters reviewPaths tiers, flags weakened tests, and --net cancels self-undone lines', () => {
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
  land({ 'packages/a/src/x.ts': 'one\ntemp\n' }, 'feat(a): add x', 'Beyond the ask: renamed\nSession: local_s1');
  const docs = land({ 'docs/plans/p.md': 'plan\n', 'packages/a/index.ts': 'export {};\n' }, 'docs(plans): add p', 'Beyond the ask: none\n\nSession: s2');
  land({ 'apps/web/y.ts': 'y\n' }, 'feat(web): add y', 'Beyond the ask: none\n\nShipped fast, no review.\n\nSession: s3');
  land({ 'packages/a/src/x.ts': 'one\n', 'packages/a/src/z.ts': 'z\n' }, 'fix(a): drop temp', 'Beyond the ask: none\n\nSession: local_s1');
  const tip = land({ [spec]: "it('a', () => {\n  expect(1).toBe(1);\n});\nit.skip('b', () => {});\n" }, 'test(a): trim a', 'Beyond the ask: none\n\nSession: s4');
  git(clone, 'push', '--quiet', 'origin', 'HEAD:next');

  const listed = helper('review.mjs', clone).stdout;
  assert.match(listed, /^3 commit\(s\) with public changes or weakened tests to review/);
  assert.match(listed, /Tests: 1 fewer expect or assert lines, 1 more \.skip or \.todo calls/);
  assert.doesNotMatch(listed, /Session s[023]\b/);
  assert.match(helper('review.mjs', clone, ['--tier', 'internal']).stdout, /Session s3[\s\S]*Shipped fast, no review\.[\s\S]*Session s4/);

  const net = helper('review.mjs', clone, ['--net', 'local_s1']);
  assert.equal(net.status, 0, net.stderr);
  assert.match(net.stdout, /\+one\n/);
  assert.match(net.stdout, /\+z\n/);
  assert.doesNotMatch(net.stdout, /temp/);

  helper('review.mjs', clone, ['--done', 'local_s1']);
  assert.equal(git(clone, 'rev-parse', 'refs/pstack/reviewed'), docs);
  helper('review.mjs', clone, ['--done', 's3']);
  helper('review.mjs', clone, ['--done', 's4']);
  assert.equal(git(clone, 'rev-parse', 'refs/pstack/reviewed'), tip);
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

test('review --revert undoes all commits of one session, supports --stage and PR mode, and enforces safety refusals', () => {
  const { dir, remote, clone, worktree, first, third } = sessions();

  // Refusals: partial id, main checkout, uncommitted changes, unlanded local commit, --stage without --revert.
  assert.match(helper('review.mjs', worktree, ['--revert', 'aaaaaaaa']).stderr, /no commit on origin\/next has the line Session: aaaaaaaa/);
  assert.match(helper('review.mjs', clone, ['--revert', ONE]).stderr, /not in the main checkout/);
  assert.equal(helper('review.mjs', worktree, ['--stage']).status, 2);
  writeFileSync(join(worktree, 'e.txt'), 'e\n');
  assert.match(helper('review.mjs', worktree, ['--revert', ONE]).stderr, /uncommitted changes/);
  git(worktree, 'add', 'e.txt');
  git(worktree, 'commit', '--quiet', '-m', 'local');
  assert.match(helper('review.mjs', worktree, ['--revert', ONE]).stderr, /HEAD has commits that origin\/next lacks/);
  git(worktree, 'reset', '--quiet', '--hard', 'HEAD~1');
  rmSync(join(worktree, 'e.txt'), { force: true });

  // --stage stages without pushing, then land.mjs lands it.
  const staged = helper('review.mjs', worktree, ['--revert', ONE, '--stage', '--check', 'true']);
  assert.equal(staged.status, 0, staged.stderr);
  assert.equal(git(remote, 'rev-parse', 'next'), third);
  assert.deepEqual(git(worktree, 'diff', '--cached', '--name-only').split('\n').sort(), ['a.txt', 'c.txt', 'd.txt']);
  const [, msgPath, check] = staged.stdout.match(/land\.mjs --message (\S+) --check '([^']+)'/u);
  assert.equal(helper('land.mjs', worktree, ['--message', msgPath, '--check', check]).status, 0);
  assert.equal(git(remote, 'show', 'next:a.txt'), 'one');
  assert.equal(git(remote, 'show', 'next:b.txt'), 'two');
  assert.equal(git(remote, 'ls-tree', '--name-only', 'next', '--', 'c.txt', 'd.txt'), '');
  const body = git(remote, 'log', '-1', '--format=%B', 'next');
  assert.equal(body.split('\n')[0], 'fix(revert): undo session aaaaaaaa');
  assert.deepEqual([...body.matchAll(/^Introduced-by: (\S+)$/gmu)].map(([, sha]) => sha).sort(), [first, third].sort());

  // PR mode opens PR with ## Why and ## Verification.
  git(clone, 'config', '--unset', 'pstack.delivery');
  const prRun = helper('review.mjs', worktree, ['--revert', TWO, '--check', 'true'], stubGh(dir));
  assert.equal(prRun.status, 0, prRun.stderr);
  const prBody = readFileSync(join(dir, 'gh-body'), 'utf8');
  assert.match(prBody, /^## Why\n\nReverts every commit session /mu);
  assert.match(prBody, /^## Verification\n\nland\.mjs ran `true` on the reverted tree/mu);
});

test('review --revert handles conflicts, failed checks, and refuses merge commits', () => {
  const { remote, clone, worktree, land } = sessions();

  // Failed check keeps revert local.
  const failed = helper('review.mjs', worktree, ['--revert', TWO, '--check', 'false']);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /check failed: false/);
  git(worktree, 'reset', '--quiet', '--hard', 'origin/next');

  // Conflict stops mid-revert; land refuses until git revert --continue, then lands whole.
  const tip = land({ 'd.txt': 'd elsewhere\n' }, 'feat(d): three changes d', 'cccccccc');
  const stopped = helper('review.mjs', worktree, ['--revert', ONE]);
  assert.equal(stopped.status, 1);
  assert.match(stopped.stderr, /conflicts in:\n {2}d\.txt\n/);
  git(worktree, 'rm', '--quiet', 'd.txt');
  const msgPath = stopped.stderr.match(/--message ([^\s`]+)/u)[1];
  assert.match(helper('land.mjs', worktree, ['--message', msgPath]).stderr, /a rebase, merge or revert is in progress/);
  git(worktree, 'revert', '--continue');
  assert.equal(helper('land.mjs', worktree, ['--message', msgPath]).status, 0);
  assert.equal(git(remote, 'rev-list', '--count', `${tip}..next`), '1');
  assert.equal(git(remote, 'ls-tree', '--name-only', 'next', '--', 'c.txt', 'd.txt'), '');

  // Merge commit in session is refused.
  git(clone, 'pull', '--quiet', '--ff-only', 'origin', 'next');
  git(clone, 'switch', '--quiet', '-c', 'side', 'HEAD~1');
  writeFileSync(join(clone, 'e.txt'), 'e\n');
  git(clone, 'add', 'e.txt');
  git(clone, 'commit', '--quiet', '-m', 'side');
  git(clone, 'switch', '--quiet', 'task');
  git(clone, 'merge', '--quiet', '--no-ff', 'side', '-m', 'feat(e): merge side', '-m', 'Beyond the ask: none\n\nSession: merge-sess');
  git(clone, 'push', '--quiet', 'origin', 'HEAD:next');
  assert.match(helper('review.mjs', worktree, ['--revert', 'merge-sess']).stderr, /merge commit/);
});

test('review lists companion commits beside their public pair, flags weakened tests, and --revert undoes both halves', () => {
  const fixture = trunk();
  const { dir, remote, clone, message } = fixture;
  const { companion, side } = split(fixture);
  const config = JSON.parse(readFileSync(join(clone, '.agents/pstack.json'), 'utf8'));
  writeFileSync(join(clone, '.agents/pstack.json'), JSON.stringify({ ...config, reviewPaths: { tests: ['**/*.spec'], public: ['*.txt'] } }));
  git(clone, 'commit', '--quiet', '-am', 'review paths');
  git(clone, 'push', '--quiet', 'origin', 'HEAD:next');
  git(clone, 'config', 'pstack.delivery', 'push');
  writeFileSync(join(clone, 'a.spec'), 'expect(1);\nexpect(2);\n');
  side('add', '--force', 'a.spec');
  side('commit', '--quiet', '-m', 'tests');
  side('push', '--quiet', 'origin', 'HEAD:next');
  assert.match(helper('review.mjs', clone, ['--mark']).stdout, /Marked \.git-private's origin\/next at \w+ as reviewed/);

  const land = (files, subject, session) => {
    for (const [path, text] of Object.entries(files)) writeFileSync(join(clone, path), text);
    assert.equal(helper('land.mjs', clone, ['--message', message(`${subject}\n\nWhy.\n\nBeyond the ask: none\nPicks: none\nNot checked: none`)], { CLAUDE_CODE_HOST_SESSION_ID: session }).status, 0);
  };
  land({ 'a.txt': 'two\n', 'a.spec': 'expect(1);\n' }, 'feat(a): one', ONE);
  land({ 'b.txt': 'two\n', 'b.spec': 'two\n' }, 'feat(b): two', TWO);

  const listed = helper('review.mjs', clone).stdout;
  assert.match(listed, /In \.git-private, with [\da-f]+[\s\S]*Tests: 1 fewer expect or assert lines/);
  assert.match(helper('review.mjs', clone, ['--done', ONE]).stdout, /Marked 2 commit\(s\) of session/);

  // Attach companion to a worktree and revert ONE across both halves.
  const worktree = join(dir, 'worktree');
  git(clone, 'worktree', 'add', '--quiet', '--detach', worktree, 'origin/next');
  const target = join(mkdtempSync(join(tmpdir(), 'attach-')), 'w');
  git(clone, '--git-dir=.git-private', 'worktree', 'add', '--quiet', '--no-checkout', '--detach', target, 'origin/next');
  const link = readFileSync(join(target, '.git'), 'utf8');
  writeFileSync(join(worktree, '.git-private'), link);
  writeFileSync(join(link.replace(/^gitdir: /u, '').trim(), 'gitdir'), `${join(worktree, '.git-private')}\n`);
  git(worktree, '--git-dir=.git-private', '--work-tree=.', 'reset', '--quiet', '--hard');

  writeFileSync(join(worktree, 'a.spec'), 'dirty\n');
  assert.match(helper('review.mjs', worktree, ['--revert', ONE]).stderr, /uncommitted changes/);
  git(worktree, '--git-dir=.git-private', '--work-tree=.', 'checkout', '--', 'a.spec');

  const reverted = helper('review.mjs', worktree, ['--revert', ONE]);
  assert.equal(reverted.status, 0, reverted.stderr);
  assert.equal(git(remote, 'show', 'next:a.txt'), 'one');
  assert.equal(git(remote, 'show', 'next:b.txt'), 'two');
  assert.equal(git(companion, 'show', 'next:a.spec'), 'expect(1);\nexpect(2);');
  assert.equal(git(companion, 'show', 'next:b.spec'), 'two');
  assert.match(git(companion, 'log', '-1', '--format=%B', 'next'), new RegExp(`^Lands-With: ${git(remote, 'rev-parse', 'next')}$`, 'mu'));
});
