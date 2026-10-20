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
};
const GOOD = 'feat(a): change a\n\nWhy a changes.\n\nBeyond the ask: none';

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

test('land rebases and pushes again when next moves while its checks run', () => {
  const { remote, clone, message, elsewhere } = trunk();
  git(clone, 'config', 'pstack.delivery', 'push');
  const other = elsewhere('d.txt', 'theirs\n', 'docs(d): land elsewhere');
  writeFileSync(join(clone, 'a.txt'), 'two\n');

  const run = helper('land.mjs', clone, ['--message', message(GOOD), '--check', `git -C ${other} push --quiet origin HEAD:next`]);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /origin\/next moved; rebasing and pushing again \(retry 1 of 3\)/);
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
  assert.match(helper('land.mjs', clone).stderr, /a rebase or merge is in progress/);

  writeFileSync(join(clone, 'a.txt'), 'both\n');
  git(clone, 'add', 'a.txt');
  git(clone, 'rebase', '--continue');
  const landed = helper('land.mjs', clone, [], session);
  assert.equal(landed.status, 0, landed.stderr);
  assert.equal(git(remote, 'log', '-1', '--format=%B', 'next'), `${GOOD}\n\nSession: local_s1`, 'the rerun keeps one Session: line');
  assert.equal(git(remote, 'show', 'next:a.txt'), 'both');
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
  writeFileSync(join(bin, 'gh'), `#!/bin/sh\nprintf '%s\\n' "$@" > '${dir}/gh-args'\ncp "\${10}" '${dir}/gh-body'\necho https://example.test/pull/7\n`);
  chmodSync(join(bin, 'gh'), 0o755);
  return { PATH: `${bin}:${process.env.PATH}` };
}
const ghArgs = (dir) => readFileSync(join(dir, 'gh-args'), 'utf8').trim().split('\n');

test('land pushes a topic branch and opens a PR into next when the clone has no push setting', () => {
  const { dir, remote, clone, base, message } = trunk();
  writeFileSync(join(clone, 'a.txt'), 'two\n');

  const run = helper('land.mjs', clone, ['--message', message(GOOD)], stubGh(dir));
  assert.equal(run.status, 0, run.stderr);
  assert.equal(git(remote, 'rev-parse', 'next'), base, 'next does not move in PR mode');
  assert.equal(git(remote, 'log', '-1', '--format=%s', 'task'), 'feat(a): change a');
  assert.deepEqual(ghArgs(dir).slice(0, 9), ['pr', 'create', '--base', 'next', '--head', 'task', '--title', 'feat(a): change a', '--body-file']);
  assert.equal(ghArgs(dir).length, 10, 'a direct clone names no other repository');
  assert.equal(readFileSync(join(dir, 'gh-body'), 'utf8'), 'Why a changes.\n\nBeyond the ask: none\n');
  assert.match(run.stdout, /https:\/\/example\.test\/pull\/7/);
});

test('land in a fork clone rebases onto upstream, pushes the topic to the fork and opens the PR on upstream', () => {
  const { dir, remote, clone, message, elsewhere } = trunk();
  const fork = join(dir, 'contributor', 'remote.git');
  git(dir, 'clone', '--quiet', '--bare', remote, fork);
  git(clone, 'remote', 'rename', 'origin', 'upstream');
  git(clone, 'remote', 'add', 'origin', fork);
  git(elsewhere('d.txt', 'theirs\n', 'docs(d): land elsewhere'), 'push', '--quiet', 'origin', 'HEAD:next');
  const stale = git(fork, 'rev-parse', 'next');
  writeFileSync(join(clone, 'a.txt'), 'two\n');

  const run = helper('land.mjs', clone, ['--message', message(GOOD)], stubGh(dir));
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

  const run = helper('land.mjs', clone, ['--message', message(GOOD)], stubGh(dir));
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
  land('two.txt', 'fix(b): two', 'No plan here.\n\nBeyond the ask: renamed c\n\nSession: s2');
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

test('review lists a tier and weakened tests, needs no review for unreviewed paths, and --net cancels what a session undid', () => {
  const { clone } = trunk();
  const reviewPaths = { tests: ['**/*.test.*'], public: ['packages/**'], internal: ['apps/**'] };
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
  land({ 'packages/a/src/x.ts': 'one\ntemp\n' }, 'feat(a): add x', 'Beyond the ask: none\n\nSession: local_s1');
  const docs = land({ 'docs/plans/p.md': 'plan\n' }, 'docs(plans): add p', 'Beyond the ask: none\n\nSession: s2');
  land({ 'apps/web/y.ts': 'y\n' }, 'feat(web): add y', 'Beyond the ask: none\n\nShipped fast, no review.\n\nSession: s3');
  land({ 'packages/a/src/x.ts': 'one\n', 'packages/a/src/z.ts': 'z\n' }, 'fix(a): drop temp', 'Beyond the ask: none\n\nSession: local_s1');
  const tip = land({ [spec]: "it('a', () => {\n  expect(1).toBe(1);\n});\nit.skip('b', () => {});\n" }, 'test(a): trim a', 'Beyond the ask: none\n\nSession: s4');
  git(clone, 'push', '--quiet', 'origin', 'HEAD:next');
  const reviewed = () => git(clone, 'rev-parse', 'refs/pstack/reviewed');

  const listed = helper('review.mjs', clone).stdout;
  assert.match(listed, /^3 commit\(s\) with public changes or weakened tests to review on origin\/next since refs\/pstack\/reviewed/);
  assert.match(listed, /\n\nSession local_s1 .*\n {2}\w+ feat\(a\): add x\n.*\n.*\n {4}1 public file\(s\): packages\/a\/src\/x\.ts\n {2}\w+ fix\(a\): drop temp\n.*\n.*\n {4}2 public file\(s\): packages\/a\/src\/x\.ts, packages\/a\/src\/z\.ts\n {2}Net: node \.agents\/pstack\/review\.mjs --net local_s1\n/);
  assert.match(listed, /\n\nSession s4\n {2}\w+ test\(a\): trim a\n.*\n.*\n {4}Tests: 1 fewer expect or assert lines, 1 more \.skip or \.todo calls\n/);
  assert.doesNotMatch(listed, /Session s[023]\b/);
  assert.match(listed, /\n1 more commit\(s\) change internal paths and no public ones; --tier internal lists them/);
  assert.match(listed, /\n2 commit\(s\) change only unreviewed paths or add tests, and need no review\.\n$/);

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

test('guard denies an edit in the main checkout on next or main, except the ledger and artifacts, and passes a worktree or a task branch', () => {
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
  for (const path of ['docs/plans/suggested-tasks.decisions.tsv', 'docs/plans/artifacts/run/log.txt', join(dir, 'down/kept.txt'), join(tree, 'a.txt')]) {
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
