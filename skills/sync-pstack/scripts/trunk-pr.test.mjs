import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { test } from 'node:test';
import { ENV, ghArgs, ghLines, git, GOOD, helper, HELPERS, isAlive, NO_WAIT, PR, split, stubGh, trunk, until } from './test-trunk.mjs';

test('land names the one dated plan the task changes, and no plan when it changes two or only a subject file', () => {
  const { remote, clone, message } = trunk();
  git(clone, 'config', 'pstack.delivery', 'push');
  mkdirSync(join(clone, 'docs/plans/topics'), { recursive: true });
  writeFileSync(join(clone, 'docs/plans/2026-10-18-x.md'), '# X\n');
  writeFileSync(join(clone, 'docs/plans/2026-10-18-x.decisions.tsv'), 'row\n');
  writeFileSync(join(clone, 'docs/plans/topics/x.md'), '# X\n');
  assert.equal(helper('land.mjs', clone, ['--message', message(GOOD)]).status, 0);
  assert.equal(git(remote, 'log', '-1', '--format=%B', 'next'), `${GOOD}\n\nPlan: docs/plans/2026-10-18-x.md\nLead: unknown`);

  writeFileSync(join(clone, 'docs/plans/topics/x.md'), '# X again\n');
  assert.equal(helper('land.mjs', clone, ['--message', message(GOOD)]).status, 0);
  assert.equal(git(remote, 'log', '-1', '--format=%B', 'next'), `${GOOD}\n\nLead: unknown`, 'a subject file alone names no plan');

  writeFileSync(join(clone, 'docs/plans/2026-10-18-x.md'), '# X closed\n');
  writeFileSync(join(clone, 'docs/plans/2026-10-18-y.md'), '# Y\n');
  assert.equal(helper('land.mjs', clone, ['--message', message(GOOD)]).status, 0);
  assert.equal(git(remote, 'log', '-1', '--format=%B', 'next'), `${GOOD}\n\nLead: unknown`, 'two plans name none');
});

// Puts next's config on sourceless: ['owner'] in trunk delivery, with one card in the ledger, and returns the env of a gh whose login is the one given, or that fails when it is empty.
function sourceless(fixture) {
  const { dir, clone } = fixture;
  const config = JSON.parse(readFileSync(join(clone, '.agents/pstack.json'), 'utf8'));
  writeFileSync(join(clone, '.agents/pstack.json'), JSON.stringify({ ...config, delivery: 'trunk', sourceless: ['owner'] }));
  writeFileSync(join(clone, '.gitignore'), '.env\n.env.local\nnode_modules\ndocs/plans/artifacts\n');
  git(clone, 'commit', '--quiet', '-am', 'sourceless');
  git(clone, 'push', '--quiet', 'origin', 'HEAD:next');
  git(clone, 'fetch', '--quiet', 'origin');
  mkdirSync(join(clone, 'docs/plans/artifacts'), { recursive: true });
  writeFileSync(join(clone, 'docs/plans/artifacts/suggested-tasks.decisions.tsv'), '2026-10-24T10:00:00Z\tchip\tt_1a2b3c4d Fix a\tWhy a breaks.\twrites: a.txt; topic: a; kind: fix; waits: none\toffered\n');
  const bin = join(dir, 'login-bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'gh'), '#!/bin/sh\n[ -n "$GH_LOGIN" ] || { echo "not logged in" >&2; exit 1; }\necho "$GH_LOGIN"\n');
  chmodSync(join(bin, 'gh'), 0o755);
  return (login) => ({ PATH: `${bin}:${process.env.PATH}`, GH_LOGIN: login });
}

test('land refuses a commit that names no source of this project unless the gh login is one next lists as sourceless', () => {
  const fixture = trunk();
  const { dir, remote, clone, message } = fixture;
  git(clone, 'config', 'pstack.delivery', 'push');
  const as = sourceless(fixture);
  const base = git(remote, 'rev-parse', 'next');
  const body = (line) => `feat(a): change a\n\n${line}\n\nBeyond the ask: none\nPicks: none\nNot checked: none`;
  let count = 0;
  const change = () => writeFileSync(join(clone, 'a.txt'), `change ${(count += 1)}\n`);
  const refused = (text, env, why) => {
    const run = helper('land.mjs', clone, ['--message', message(text)], env);
    assert.equal(run.status, 1, `${why}: ${run.stderr}`);
    return run.stderr;
  };

  change();
  git(clone, 'commit', '--quiet', '-am', 'wip');
  const task = git(clone, 'rev-parse', 'HEAD');
  const bare = refused(GOOD, as('teammate'), 'no source');
  assert.match(bare, /names no source, and only owner land without one, not teammate\. A source is an issue of remote written as/);
  assert.doesNotMatch(bare, /Lead: unknown/, 'the refusal comes before the lead lookup, which can wait a minute');
  assert.equal(git(remote, 'rev-parse', 'next'), base, 'a refused land pushes nothing');
  assert.equal(git(clone, 'rev-parse', 'HEAD'), task, 'a refused land puts HEAD back');
  const notPlans = ['Plan: none', 'Plan: a.txt', 'Plan: .', 'Plan: docs/plans', 'Plan: docs/plans/artifacts/suggested-tasks.decisions.tsv'];
  for (const line of ['Step #3 of the list.', 'Ports C#1 behavior.', 'See https://github.com/someone/else/issues/12.', 'Runs card t_00000000.', ...notPlans]) {
    assert.match(refused(body(line), as('teammate'), line), /names no source/);
  }
  assert.match(refused(GOOD, as(''), 'gh fails'), /gh api user failed: not logged in/);
  assert.match(refused(GOOD, { PATH: '/usr/bin:/bin' }, 'no gh'), /gh api user failed: spawnSync gh ENOENT/);
  assert.equal(git(clone, 'rev-parse', 'HEAD'), task, 'a missing gh puts HEAD back');
  const config = JSON.parse(readFileSync(join(clone, '.agents/pstack.json'), 'utf8'));
  writeFileSync(join(clone, '.agents/pstack.json'), JSON.stringify({ ...config, sourceless: undefined }));
  assert.match(refused(GOOD, as('teammate'), 'own config'), /names no source/, "next's config wins over the task's copy");
  git(clone, 'checkout', 'HEAD', '--', '.agents/pstack.json');

  const owner = basename(dir).toLowerCase();
  for (const line of ['Repairs remote#12.', `Repairs ${owner}/remote#12.`, 'Runs card t_1a2b3c4d.', `See https://github.com/${owner}/remote/issues/12.`]) {
    const landed = helper('land.mjs', clone, ['--message', message(body(line))], as('teammate'));
    assert.equal(landed.status, 0, `${line}: ${landed.stderr}`);
    change();
  }
  writeFileSync(join(clone, 'docs/plans/2026-10-28-x.md'), '# X\n');
  assert.equal(helper('land.mjs', clone, ['--message', message(GOOD)], as('teammate')).status, 0, 'a changed plan is a source');
  change();
  assert.equal(helper('land.mjs', clone, ['--message', message(body('Plan: docs/plans/2026-10-28-x.md'))], as('teammate')).status, 0, 'a Plan: line naming a plan that exists is a source');
  change();
  rmSync(join(clone, 'docs/plans/2026-10-28-x.md'));
  assert.match(refused(GOOD, as('teammate'), 'a deleted plan'), /names no source/);
  const landed = helper('land.mjs', clone, ['--message', message(GOOD)], as('owner'));
  assert.equal(landed.status, 0, landed.stderr);
  assert.equal(git(remote, 'log', '-1', '--format=%B', 'next'), `${GOOD}\n\nLead: unknown`);
});

test('a rerun checks the source of the companion commit it pushes and writes its Lead line again', () => {
  const fixture = trunk();
  const { clone } = fixture;
  const as = sourceless(fixture);
  const { companion, side } = split(fixture);
  git(clone, 'config', 'pstack.delivery', 'push');
  const before = git(companion, 'rev-parse', 'next');
  const landed = git(clone, 'rev-parse', 'HEAD');
  const pending = (line) => `feat(a): change a\n\n${line}\n\nBeyond the ask: none\nPicks: none\nNot checked: none\n\nLead: claude-opus-5-5 @max\nLands-With: ${landed}`;
  writeFileSync(join(clone, 'a.spec'), 'two\n');
  side('commit', '--quiet', '-am', pending('Why a changes.'));

  const refused = helper('land.mjs', clone, [], as('teammate'));
  assert.equal(refused.status, 1, refused.stderr);
  assert.match(refused.stderr, /names no source/);
  assert.equal(git(companion, 'rev-parse', 'next'), before, 'a refused rerun pushes nothing');

  side('commit', '--quiet', '--amend', '-m', pending('Repairs companion#3.'));
  const pushed = helper('land.mjs', clone, [], as('teammate'));
  assert.equal(pushed.status, 0, pushed.stderr);
  assert.equal(git(companion, 'log', '-1', '--format=%B', 'next'), `feat(a): change a\n\nRepairs companion#3.\n\nBeyond the ask: none\nPicks: none\nNot checked: none\n\nLands-With: ${landed}\nLead: unknown`);
});

test('land ends the commit with the Lead line of the session that runs it, in place of one written in the message', () => {
  const { clone, remote, message } = trunk();
  git(clone, 'config', 'pstack.delivery', 'push');
  writeFileSync(join(clone, 'a.txt'), 'two\n');
  const home = mkdtempSync(join(tmpdir(), 'land-lead-'));
  const session = '11111111-2222-4333-8444-555555555555';
  mkdirSync(join(home, '.claude', 'projects', 'p'), { recursive: true });
  const call = { type: 'assistant', effort: 'high', timestamp: 't', message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: 'land', name: 'Bash', input: { command: 'node .agents/pstack/land.mjs' } }] } };
  writeFileSync(join(home, '.claude', 'projects', 'p', `${session}.jsonl`), `${JSON.stringify(call)}\n`);
  symlinkSync(process.execPath, join(home, 'claude'));
  writeFileSync(join(home, 'runtime.mjs'), "import { spawnSync } from 'node:child_process';\nprocess.exit(spawnSync(process.execPath, process.argv.slice(2), { stdio: 'inherit' }).status ?? 1);\n");
  const landUnderClaude = (file) => spawnSync(join(home, 'claude'), [join(home, 'runtime.mjs'), join(HELPERS, 'land.mjs'), '--message', file], { cwd: clone, encoding: 'utf8', env: { ...ENV, HOME: home, CLAUDE_CODE_SESSION_ID: session } });

  const landed = landUnderClaude(message(`${GOOD}\nLead: claude-opus-5-5 @max`));
  assert.equal(landed.status, 0, landed.stderr);
  assert.equal(git(remote, 'log', '-1', '--format=%B', 'next'), `${GOOD}\n\nSession: ${session}\nLead: claude-opus-5-5 @high`);

  writeFileSync(join(clone, 'a.txt'), 'three\n');
  const outside = helper('land.mjs', clone, ['--message', message(GOOD)]);
  assert.equal(outside.status, 0, outside.stderr);
  assert.match(outside.stderr, /the commit says `Lead: unknown`, because /);
  assert.equal(git(remote, 'log', '-1', '--format=%B', 'next'), `${GOOD}\n\nLead: unknown`);
});



test('land pushes a topic branch and opens a PR into next when the clone has no push setting', () => {
  const { dir, remote, clone, base, message } = trunk();
  writeFileSync(join(clone, 'a.txt'), 'two\n');

  const run = helper('land.mjs', clone, ['--message', message(PR)], stubGh(dir));
  assert.equal(run.status, 0, run.stderr);
  assert.equal(git(remote, 'rev-parse', 'next'), base, 'next does not move in PR mode');
  assert.equal(git(remote, 'log', '-1', '--format=%B', 'task'), `${PR}\n\nLead: unknown`, 'the commit keeps its section headings');
  assert.equal(git(remote, 'log', '-1', '--format=%s', 'task'), 'feat(a): change a');
  assert.deepEqual(ghArgs(dir).slice(0, 9), ['pr', 'create', '--base', 'next', '--head', 'task', '--title', 'feat(a): change a', '--body-file']);
  assert.equal(ghArgs(dir).length, 10, 'a direct clone names no other repository');
  assert.equal(readFileSync(join(dir, 'gh-body'), 'utf8'), `${PR.split('\n').slice(2).join('\n')}\n`);
  assert.match(run.stdout, /https:\/\/example\.test\/pull\/7/);
  assert.match(run.stdout, /Armed auto-merge \(squash\)/);
  assert.deepEqual(ghLines(dir, 'gh-merge'), ['pr', 'merge', 'https://example.test/pull/7', '--auto', '--squash'], 'a branch with no rules still gets auto-merge');
});

test("land opens no PR while its author's models sheet seats Sonnet, Haiku or a low effort or leaves a seat line out, and lets a Codex-only sheet through", () => {
  const land = (sheet) => {
    const { dir, clone, message } = trunk();
    const codex = join(dir, 'codex');
    mkdirSync(codex);
    writeFileSync(join(codex, 'pstack-models.md'), sheet);
    const config = join(clone, '.agents/pstack.json');
    writeFileSync(config, JSON.stringify({ ...JSON.parse(readFileSync(config, 'utf8')), maxEffort: 'xhigh' }));
    writeFileSync(join(clone, 'a.txt'), 'two\n');
    return helper('land.mjs', clone, ['--message', message(PR)], { ...stubGh(dir), CODEX_THREAD_ID: 'thread', CODEX_HOME: codex });
  };
  const arena = 'arena runners: opus, codex:gpt-6.1-sol @xhigh\n';
  const bad = land(`interrogate reviewers: opus, sonnet, haiku, codex:gpt-6.1-sol @medium\n`);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /`interrogate reviewers:` names sonnet/u);
  assert.match(bad.stderr, /`interrogate reviewers:` names haiku/u);
  assert.match(bad.stderr, /runs codex:gpt-6\.1-sol @medium, below the seat floor high/u);
  assert.match(bad.stderr, /add the line `arena runners: opus, codex:gpt-6\.2-sol`, or `arena runners: codex:gpt-6\.2-sol` without Claude Code/u);
  const good = land(`All roles inherit gpt-6.1-sol and never dispatch sonnet.\n${arena}interrogate reviewers: codex:gpt-6.1-sol @high, codex:gpt-6.1-sol\n`);
  assert.equal(good.status, 0, good.stderr);
});

test('land arms auto-merge on every PR it opens, with a method the rules allow, and reports a refusal', () => {
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

  assert.deepEqual(land([review({})]).merge, ['pr', 'merge', 'https://example.test/pull/7', '--auto', '--squash'], 'an approval that survives a later push still gets auto-merge');
  assert.deepEqual(land([review({ required_approving_review_count: 0, allowed_merge_methods: ['rebase'] })]).merge, ['pr', 'merge', 'https://example.test/pull/7', '--auto', '--rebase']);

  const none = land([review({ allowed_merge_methods: ['merge'] }), review({ allowed_merge_methods: ['squash'] })]);
  assert.equal(none.merge, null);
  assert.match(none.run.stdout, /Auto-merge stays off: next's rules allow no merge method in common/);
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
  assert.match(run.stderr, /^land\.mjs: this clone cannot push to origin: fork the repository, .*add the canonical repository as `upstream`/mu);
  assert.equal(existsSync(join(dir, 'gh-args')), false, 'no PR is opened');
});

test('land refuses a message without a Conventional subject or a Beyond the ask, Picks or Not checked line, names every problem in one refusal and changes nothing', () => {
  const { remote, clone, base, message } = trunk();
  git(clone, 'config', 'pstack.delivery', 'push');
  writeFileSync(join(clone, 'a.txt'), 'two\n');
  const head = git(clone, 'rev-parse', 'HEAD');

  const noBeyond = helper('land.mjs', clone, ['--message', message('feat(a): change a\n\nWhy a changes.\n\nPicks: none\nNot checked: none\n')]);
  assert.equal(noBeyond.status, 1);
  assert.match(noBeyond.stderr, /the body has no `Beyond the ask:` line/);
  const noPicks = helper('land.mjs', clone, ['--message', message('feat(a): change a\n\nWhy a changes.\n\nBeyond the ask: none\nNot checked: none\n')]);
  assert.equal(noPicks.status, 1);
  assert.match(noPicks.stderr, /the body has no `Picks:` line; name each call the owner would notice/);
  const commentedPicks = helper('land.mjs', clone, ['--message', message('feat(a): change a\n\nWhy a changes.\n\nBeyond the ask: none\n<!--\nPicks: name each call\n-->\nNot checked: none\n')]);
  assert.equal(commentedPicks.status, 1);
  assert.match(commentedPicks.stderr, /the body has no `Picks:` line/);
  const noUnchecked = helper('land.mjs', clone, ['--message', message('feat(a): change a\n\nWhy a changes.\n\nBeyond the ask: none\nPicks: none\nNot checked:\n')]);
  assert.equal(noUnchecked.status, 1);
  assert.match(noUnchecked.stderr, /the body has no `Not checked:` line; name what the proof did not check/);
  const everything = helper('land.mjs', clone, ['--message', message('Change a.\nWhy a changes — and how. Closes #12 and fixes #34\n')]);
  assert.equal(everything.status, 1);
  for (const problem of [
    /is not one Conventional Commit/,
    /a blank line must separate/,
    /the body has no `Beyond the ask:` line/,
    /the body has no `Picks:` line/,
    /the body has no `Not checked:` line/,
    /breaks the Writing rule[\s\S]*line 2/u,
    /"Closes #12" closes an issue/,
    /"fixes #34" closes an issue/,
  ]) assert.match(everything.stderr, problem);
  const joined = helper('land.mjs', clone, ['--message', message('feat(a): change a\nBeyond the ask: none\n\nPicks: none\nNot checked: none\n')]);
  assert.equal(joined.status, 1);
  assert.match(joined.stderr, /a blank line must separate/);
  assert.doesNotMatch(joined.stderr, /the body has no/);
  const fix = helper('land.mjs', clone, ['--message', message('fix(a): repair a\n\nWhy a changes.\n\nBeyond the ask: none\nNot checked: none\n')]);
  assert.equal(fix.status, 1);
  assert.match(fix.stderr, /the body has no `Picks:` line/);
  assert.match(fix.stderr, /the fix names no commit that introduced its bug/);
  assert.equal(git(remote, 'rev-parse', 'next'), base);
  assert.equal(git(clone, 'rev-parse', 'HEAD'), head);
  assert.equal(git(clone, 'status', '--porcelain'), 'M a.txt');
});

test('land --dry runs the message and Defaults refusals without committing, and a real run refuses a bad Defaults table before any check', () => {
  const { remote, clone, base, message } = trunk();
  git(clone, 'config', 'pstack.delivery', 'push');
  mkdirSync(join(clone, 'docs/plans'), { recursive: true });
  const plan = join(clone, 'docs/plans/2026-11-02-x.md');
  const defaults = (impact) => `# X\n\n## Defaults\n\n| Decision | Pick | Alternative | Word | Impact |\n| --- | --- | --- | --- | --- |\n| Order | a | b | swap | ${impact} |\n`;
  writeFileSync(plan, defaults('huge'));
  const head = git(clone, 'rev-parse', 'HEAD');

  const badSha = helper('land.mjs', clone, ['--message', message('fix(a): change a\n\nWhy a changes.\n\nIntroduced-by: abc\n\nBeyond the ask: none\nPicks: none\nNot checked: none'), '--dry']);
  assert.equal(badSha.status, 1);
  assert.match(badSha.stderr, /Introduced-by: abc is not a lowercase sha/u);
  const badImpact = helper('land.mjs', clone, ['--message', message(GOOD), '--dry']);
  assert.equal(badImpact.status, 1);
  assert.match(badImpact.stderr, /## Defaults in docs\/plans\/2026-11-02-x\.md gives "Order" the impact "huge"; write big or small/u);
  writeFileSync(plan, defaults('small'));
  const passed = helper('land.mjs', clone, ['--message', message(GOOD), '--dry']);
  assert.equal(passed.status, 0, passed.stderr);
  assert.match(passed.stdout, /nothing was committed/u);
  assert.equal(git(clone, 'rev-parse', 'HEAD'), head);
  assert.equal(git(clone, 'status', '--porcelain'), '?? docs/');

  writeFileSync(plan, defaults('huge'));
  const refused = helper('land.mjs', clone, ['--message', message(GOOD), '--check', 'touch checked']);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /gives "Order" the impact "huge"/u);
  assert.equal(existsSync(join(clone, 'checked')), false, 'no check runs');
  assert.equal(git(remote, 'rev-parse', 'next'), base);
});

test('land --dry runs every config landCheck on the working tree outside the landing share, names each that fails and commits nothing', () => {
  const { dir, clone, message } = trunk();
  git(clone, 'config', 'pstack.delivery', 'push');
  const ran = join(dir, 'ran');
  const config = JSON.parse(readFileSync(join(clone, '.agents/pstack.json'), 'utf8'));
  config.landChecks = [`test -f c.txt && echo saw >> ${ran}`, 'test -f d.txt', 'test -z "$PSTACK_LAND_CHECK"'];
  writeFileSync(join(clone, '.agents/pstack.json'), JSON.stringify(config));
  writeFileSync(join(clone, 'a.txt'), 'two\n');
  const head = git(clone, 'rev-parse', 'HEAD');

  const refused = helper('land.mjs', clone, ['--message', message(GOOD), '--dry'], { PSTACK_LAND_CHECK: '1' });
  assert.equal(refused.status, 1, refused.stdout + refused.stderr);
  assert.match(refused.stderr, /land checks failed on the working tree, and nothing was committed:\n  test -f c\.txt && echo saw >> \S+\n  test -f d\.txt\n/u);
  assert.doesNotMatch(refused.stderr, /PSTACK_LAND_CHECK/u);
  writeFileSync(join(clone, 'c.txt'), 'new\n');
  writeFileSync(join(clone, 'd.txt'), 'new\n');
  const passed = helper('land.mjs', clone, ['--message', message(GOOD), '--dry'], { PSTACK_LAND_CHECK: '1' });
  assert.equal(passed.status, 0, passed.stderr);
  assert.match(passed.stdout, /landChecks pass; nothing was committed/u);
  assert.equal(readFileSync(ran, 'utf8'), 'saw\n');
  assert.equal(git(clone, 'rev-parse', 'HEAD'), head);
});

test('land --dry that reaches the deadline exits 1, so the lead never answers it with a real land', () => {
  const { clone, message } = trunk();
  git(clone, 'config', 'pstack.delivery', 'push');
  const config = JSON.parse(readFileSync(join(clone, '.agents/pstack.json'), 'utf8'));
  config.landChecks = ['true'];
  writeFileSync(join(clone, '.agents/pstack.json'), JSON.stringify(config));
  writeFileSync(join(clone, 'a.txt'), 'two\n');
  const stopped = helper('land.mjs', clone, ['--message', message(GOOD), '--dry'], { PSTACK_LAND_SPENT_MS: String(55 * 60_000) });
  assert.equal(stopped.status, 1, stopped.stdout + stopped.stderr);
  assert.match(stopped.stderr, /land\.mjs --dry stopped true at 55 minutes into the run; nothing was committed/u);
});

const plan = ({ status = 'active', impact }) =>
  `# X\n\nStatus: ${status}\n\nOne.\n\nTwo.\n\nThree.\n\nFour.\n\n## Defaults\n\n| Decision | Pick | Alternative | Word | Impact |\n| --- | --- | --- | --- | --- |\n| Order | a | b | swap | ${impact} |\n`;

test('land refuses a bad Defaults table in a plan whose name git quotes, with --dry and without', () => {
  const { remote, clone, base, message } = trunk();
  git(clone, 'config', 'pstack.delivery', 'push');
  mkdirSync(join(clone, 'docs/plans'), { recursive: true });
  writeFileSync(join(clone, 'docs/plans/2026-11-02-café.md'), plan({ impact: 'huge' }));

  const dry = helper('land.mjs', clone, ['--message', message(GOOD), '--dry']);
  assert.equal(dry.status, 1);
  assert.match(dry.stderr, /## Defaults in docs\/plans\/2026-11-02-café\.md gives "Order" the impact "huge"/u);
  const real = helper('land.mjs', clone, ['--message', message(GOOD), '--check', 'touch checked']);
  assert.equal(real.status, 1);
  assert.match(real.stderr, /gives "Order" the impact "huge"/u);
  assert.equal(existsSync(join(clone, 'checked')), false, 'no check runs');
  assert.equal(git(remote, 'rev-parse', 'next'), base);
});

test('land --dry refuses a bad Defaults table in a new plan the companion owns', () => {
  const fixture = trunk();
  const { clone, message } = fixture;
  split(fixture);
  git(clone, 'config', 'pstack.delivery', 'push');
  writeFileSync(join(clone, '.gitprivate'), '*.spec\n/docs/plans/\n');
  mkdirSync(join(clone, 'docs/plans'), { recursive: true });
  writeFileSync(join(clone, 'docs/plans/2026-11-02-x.md'), plan({ impact: 'huge' }));

  const dry = helper('land.mjs', clone, ['--message', message(GOOD), '--dry']);
  assert.equal(dry.status, 1, dry.stdout);
  assert.match(dry.stderr, /## Defaults in docs\/plans\/2026-11-02-x\.md gives "Order" the impact "huge"/u);
});

test('land refuses an open plan whose Defaults table a clean rebase made bad, before any check', () => {
  const { dir, remote, clone, message } = trunk();
  git(clone, 'config', 'pstack.delivery', 'push');
  mkdirSync(join(clone, 'docs/plans'), { recursive: true });
  const path = 'docs/plans/2026-11-02-x.md';
  writeFileSync(join(clone, path), plan({ status: 'executed', impact: 'small' }));
  git(clone, 'add', '--all');
  git(clone, 'commit', '--quiet', '-m', 'plan');
  git(clone, 'push', '--quiet', 'origin', 'HEAD:next');
  const other = join(dir, 'other-plan');
  git(dir, 'clone', '--quiet', '--branch', 'next', remote, other);
  writeFileSync(join(other, path), plan({ status: 'executed', impact: 'huge' }));
  git(other, 'commit', '--quiet', '-am', 'impact');
  git(other, 'push', '--quiet', 'origin', 'HEAD:next');
  writeFileSync(join(clone, path), plan({ status: 'active', impact: 'small' }));

  const run = helper('land.mjs', clone, ['--message', message(GOOD), '--check', 'touch checked']);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /gives "Order" the impact "huge"/u);
  assert.equal(readFileSync(join(clone, path), 'utf8'), plan({ status: 'active', impact: 'huge' }), 'the rebase merged both edits');
  assert.equal(existsSync(join(clone, 'checked')), false, 'no check runs');
});

test('land refuses a message that breaks the Writing rule, and lands one that keeps the same character in a code span', () => {
  const { remote, clone, base, message } = trunk();
  git(clone, 'config', 'pstack.delivery', 'push');
  writeFileSync(join(clone, 'a.txt'), 'two\n');

  const dashed = helper('land.mjs', clone, ['--message', message('feat(a): change a\n\nWhy a changes — and how.\n\nBeyond the ask: none\nPicks: none\nNot checked: none\n')]);
  assert.equal(dashed.status, 1);
  assert.match(dashed.stderr, /breaks the Writing rule[\s\S]*line 3/u);
  assert.equal(git(remote, 'rev-parse', 'next'), base);
  assert.equal(git(clone, 'status', '--porcelain'), 'M a.txt');

  const literal = helper('land.mjs', clone, ['--message', message('feat(a): change a\n\nKeeps the `—` character in a.\n\nBeyond the ask: none\nPicks: none\nNot checked: none\n')]);
  assert.equal(literal.status, 0, literal.stderr);
  assert.notEqual(git(remote, 'rev-parse', 'next'), base);
});

test('a rerun lands with the Plan line the first run wrote, though the plan name holds a word the writing check flags', () => {
  const { remote, clone, message } = trunk();
  git(clone, 'config', 'pstack.delivery', 'push');
  mkdirSync(join(clone, 'docs/plans'), { recursive: true });
  writeFileSync(join(clone, 'docs/plans/2026-11-01-pivotal.md'), '# X\n');
  assert.equal(helper('land.mjs', clone, ['--message', message(GOOD), '--check', 'false']).status, 1);

  const rerun = helper('land.mjs', clone, ['--check', 'true']);
  assert.equal(rerun.status, 0, rerun.stderr);
  assert.match(git(remote, 'log', '-1', '--format=%B', 'next'), /^Plan: docs\/plans\/2026-11-01-pivotal\.md$/mu);
});

test('land refuses a closing keyword right before an issue reference, and lands a message that names the issue as <repo>#<N>', () => {
  const { remote, clone, base, message } = trunk();
  git(clone, 'config', 'pstack.delivery', 'push');
  writeFileSync(join(clone, 'a.txt'), 'two\n');

  for (const [text, name] of [
    ['feat(a): change a\n\nRan triage fix #5228 on it.\n\nBeyond the ask: none\nPicks: none\nNot checked: none\n', 'remote'],
    ['docs(a): resolve #12\n\nBeyond the ask: none\nPicks: none\nNot checked: none\n', 'remote'],
    ['feat(a): change a\n\nCloses: udecode/plate#12\n\nBeyond the ask: none\nPicks: none\nNot checked: none\n', 'plate'],
    ['feat(a): change a\n\nFixed https://github.com/udecode/plate-private/issues/5228 here.\n\nBeyond the ask: none\nPicks: none\nNot checked: none\n', 'plate-private'],
  ]) {
    const run = helper('land.mjs', clone, ['--message', message(text)]);
    assert.equal(run.status, 1, text);
    assert.match(run.stderr, new RegExp(`closes an issue .*write \`${name}#<N>\``, 'u'), text);
  }
  assert.equal(git(remote, 'rev-parse', 'next'), base);

  const run = helper('land.mjs', clone, ['--message', message('feat(a): change a\n\nRan triage fix remote#5228; see #12, prefix #7, fixture/plate#12, fix #3b82f6.\n\nBeyond the ask: none\nPicks: none\nNot checked: none\n')]);
  assert.equal(run.status, 0, run.stderr);
  assert.notEqual(git(remote, 'rev-parse', 'next'), base);
});

const FIX = 'fix(a): repair a\n\nBeyond the ask: none\nPicks: none\nNot checked: none';
for (const [name, args, refusal] of [
  ['leaves its Introduced-by line empty', ({ message }) => ['--message', message(`${FIX}\nIntroduced-by: `)], /an `Introduced-by:` line has no value/],
  ['names an unknown commit', ({ message }) => ['--message', message(`${FIX}\nIntroduced-by: 0123456789abcdef0123456789abcdef01234567`)], /Introduced-by: 0123456789abcdef0123456789abcdef01234567 names no commit/],
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
    assert.equal(git(remote, 'log', '-1', '--format=%B', 'next'), `${text}\n\nLead: unknown`);
  };
  landed(GOOD);
  landed(`fix(a)!: repair a\n\nBeyond the ask: none\nPicks: none\nNot checked: none\nIntroduced-by: ${base}\nIntroduced-by: ${git(remote, 'rev-parse', '--short', 'next')}`);
  landed('fix: repair a again\n\nBeyond the ask: none\nPicks: none\nNot checked: none\nIntroduced-by: none');
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
  const empty = helper('land.mjs', clone, ['--message', message('feat(a): change a\n\n## Why\n\nWhy a changes.\n\n## Verification\n\n<!-- Each real run path and its outcome. -->\n\nBeyond the ask: none\nPicks: none\nNot checked: none')], gh);
  assert.equal(empty.status, 1);
  assert.match(empty.stderr, /needs a `## Verification` section with text/);
  const labelInComment = helper('land.mjs', clone, ['--message', message('feat(a): change a\n\n## Why\n\nWhy a changes.\n\n## Verification\n\n<!--\nPicks: state the choice here\n-->\n\nBeyond the ask: none\nPicks: none\nNot checked: none')], gh);
  assert.equal(labelInComment.status, 1);
  assert.match(labelInComment.stderr, /needs a `## Verification` section with text/);
  assert.equal(git(clone, 'rev-parse', 'HEAD'), head, 'the task commits are back as they were');
  assert.equal(spawnSync('git', ['rev-parse', '--verify', 'task'], { cwd: remote, env: ENV }).status, 128, 'no topic branch reaches the remote');
  assert.equal(existsSync(join(dir, 'gh-args')), false, 'no PR is opened');

  const landed = helper('land.mjs', clone, ['--message', message(PR)], gh);
  assert.equal(landed.status, 0, landed.stderr);
});

