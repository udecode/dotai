import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test } from 'node:test';
import { ENV, ghArgs, ghLines, git, GOOD, helper, HELPERS, PR, split, stubGh, trunk } from './test-trunk.mjs';

test('land stamps Plan: only when one dated plan changed, and stamps Lead:/Session: from the calling Claude session', () => {
  const { remote, clone, message } = trunk();
  git(clone, 'config', 'pstack.delivery', 'push');
  mkdirSync(join(clone, 'docs/plans/topics'), { recursive: true });
  writeFileSync(join(clone, 'docs/plans/2026-10-18-x.md'), '# X\n');
  writeFileSync(join(clone, 'docs/plans/2026-10-18-x.decisions.tsv'), 'row\n');
  writeFileSync(join(clone, 'docs/plans/topics/x.md'), '# X\n');
  assert.equal(helper('land.mjs', clone, ['--message', message(GOOD)]).status, 0);
  assert.equal(git(remote, 'log', '-1', '--format=%B', 'next'), `${GOOD}\n\nPlan: docs/plans/2026-10-18-x.md\nLead: unknown`);

  writeFileSync(join(clone, 'docs/plans/2026-10-18-x.md'), '# X closed\n');
  writeFileSync(join(clone, 'docs/plans/2026-10-18-y.md'), '# Y\n');
  assert.equal(helper('land.mjs', clone, ['--message', message(GOOD)]).status, 0);
  assert.equal(git(remote, 'log', '-1', '--format=%B', 'next'), `${GOOD}\n\nLead: unknown`);

  // Lead: and Session: stamped from Claude session transcript, replacing forged Lead:.
  const home = mkdtempSync(join(tmpdir(), 'land-lead-'));
  const session = '11111111-2222-4333-8444-555555555555';
  mkdirSync(join(home, '.claude', 'projects', 'p'), { recursive: true });
  const call = { type: 'assistant', effort: 'high', timestamp: 't', message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: 'land', name: 'Bash', input: { command: 'node .agents/pstack/land.mjs' } }] } };
  writeFileSync(join(home, '.claude', 'projects', 'p', `${session}.jsonl`), `${JSON.stringify(call)}\n`);
  symlinkSync(process.execPath, join(home, 'claude'));
  writeFileSync(join(home, 'runtime.mjs'), "import { spawnSync } from 'node:child_process';\nprocess.exit(spawnSync(process.execPath, process.argv.slice(2), { stdio: 'inherit' }).status ?? 1);\n");
  writeFileSync(join(clone, 'a.txt'), 'two\n');
  const landed = spawnSync(join(home, 'claude'), [join(home, 'runtime.mjs'), join(HELPERS, 'land.mjs'), '--message', message(`${GOOD}\nLead: claude-opus-5-5 @max`)], {
    cwd: clone,
    encoding: 'utf8',
    env: { ...ENV, HOME: home, CLAUDE_CODE_SESSION_ID: session },
  });
  assert.equal(landed.status, 0, landed.stderr);
  assert.equal(git(remote, 'log', '-1', '--format=%B', 'next'), `${GOOD}\n\nSession: ${session}\nLead: claude-opus-5-5 @high`);
});

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
  writeFileSync(join(bin, 'gh'), '#!/bin/sh\n[ -n "$GH_LOGIN" ] || { echo "not logged in" >&2; exit 1; }\necho "$GH_LOGIN"\n', { mode: 0o755 });
  return (login) => ({ PATH: `${bin}:${process.env.PATH}`, GH_LOGIN: login });
}

test('land enforces sourceless policy on public and companion commits', () => {
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
  assert.match(refused(GOOD, as('teammate'), 'no source'), /names no source, and only owner land without one, not teammate/);
  assert.equal(git(remote, 'rev-parse', 'next'), base);
  assert.equal(git(clone, 'rev-parse', 'HEAD'), task);
  for (const line of ['Step #3.', 'See https://github.com/someone/else/issues/12.', 'Runs card t_00000000.', 'Plan: none', 'Plan: a.txt']) {
    assert.match(refused(body(line), as('teammate'), line), /names no source/);
  }
  assert.match(refused(GOOD, as(''), 'gh fails'), /gh api user failed: not logged in/);
  assert.match(refused(GOOD, { PATH: '/usr/bin:/bin' }, 'no gh'), /gh api user failed: spawnSync gh ENOENT/);

  const owner = basename(dir).toLowerCase();
  for (const line of ['Repairs remote#12.', `Repairs ${owner}/remote#12.`, 'Runs card t_1a2b3c4d.', `See https://github.com/${owner}/remote/issues/12.`]) {
    assert.equal(helper('land.mjs', clone, ['--message', message(body(line))], as('teammate')).status, 0, line);
    change();
  }
  writeFileSync(join(clone, 'docs/plans/2026-10-28-x.md'), '# X\n');
  assert.equal(helper('land.mjs', clone, ['--message', message(GOOD)], as('teammate')).status, 0);
  change();
  assert.equal(helper('land.mjs', clone, ['--message', message(GOOD)], as('owner')).status, 0);

  // Companion rerun also enforces source.
  const { companion, side } = split(fixture);
  const landed = git(clone, 'rev-parse', 'HEAD');
  const pending = (line) => `feat(a): change a\n\n${line}\n\nBeyond the ask: none\nPicks: none\nNot checked: none\n\nLead: claude-opus-5-5 @max\nLands-With: ${landed}`;
  writeFileSync(join(clone, 'a.spec'), 'two\n');
  side('commit', '--quiet', '-am', pending('Why a changes.'));
  assert.match(helper('land.mjs', clone, [], as('teammate')).stderr, /names no source/);
  side('commit', '--quiet', '--amend', '-m', pending('Repairs companion#3.'));
  assert.equal(helper('land.mjs', clone, [], as('teammate')).status, 0);
  assert.match(git(companion, 'log', '-1', '--format=%B', 'next'), /Repairs companion#3/);
});

test('land opens PR into next with auto-merge, validates PR body/models sheet, and handles fork & no-push-access clones', () => {
  const { dir, remote, clone, base, message } = trunk();
  const gh = stubGh(dir);
  writeFileSync(join(clone, 'a.txt'), 'two\n');
  git(clone, 'commit', '--quiet', '-am', 'wip');
  const head = git(clone, 'rev-parse', 'HEAD');

  // Refuses PR without ## Why / ## Verification text, keeping HEAD intact.
  assert.match(helper('land.mjs', clone, ['--message', message(GOOD)], gh).stderr, /needs a `## Why` section and a `## Verification` section with text/);
  assert.match(helper('land.mjs', clone, ['--message', message('feat(a): change a\n\n## Why\n\nWhy.\n\n## Verification\n\n<!-- placeholder -->\n\nBeyond the ask: none\nPicks: none\nNot checked: none')], gh).stderr, /needs a `## Verification` section with text/);
  assert.equal(git(clone, 'rev-parse', 'HEAD'), head);

  // Refuses PR when models sheet seats sonnet/haiku/medium or omits arena runners.
  const codex = join(dir, 'codex');
  mkdirSync(codex);
  writeFileSync(join(codex, 'pstack-models.md'), 'interrogate reviewers: opus, sonnet, haiku, codex:gpt-6.1-sol @medium\n');
  const badSheet = helper('land.mjs', clone, ['--message', message(PR)], { ...gh, CODEX_THREAD_ID: 'thread', CODEX_HOME: codex });
  assert.equal(badSheet.status, 1);
  assert.match(badSheet.stderr, /names sonnet[\s\S]*names haiku[\s\S]*below the seat floor high/u);

  // Valid PR opens with squash auto-merge.
  const run = helper('land.mjs', clone, ['--message', message(PR)], gh);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(git(remote, 'rev-parse', 'next'), base);
  assert.deepEqual(ghArgs(dir).slice(0, 9), ['pr', 'create', '--base', 'next', '--head', 'task', '--title', 'feat(a): change a', '--body-file']);
  assert.deepEqual(ghLines(dir, 'gh-merge'), ['pr', 'merge', 'https://example.test/pull/7', '--auto', '--squash']);

  // Merge method follows branch rulesets (merge / rebase / incompatible).
  const review = (parameters) => ({ type: 'pull_request', parameters: { required_approving_review_count: 1, ...parameters } });
  let branchN = 0;
  for (const [rules, expectMerge, expectOut] of [
    [[review({ dismiss_stale_reviews_on_push: true, allowed_merge_methods: ['merge'] })], '--merge', /Armed auto-merge \(merge\)/],
    [[review({ required_approving_review_count: 0, allowed_merge_methods: ['rebase'] })], '--rebase', /Armed auto-merge \(rebase\)/],
    [[review({ allowed_merge_methods: ['merge'] }), review({ allowed_merge_methods: ['squash'] })], null, /Auto-merge stays off: next's rules allow no merge method in common/],
  ]) {
    rmSync(join(dir, 'gh-merge'), { force: true });
    writeFileSync(join(dir, 'gh-rules'), JSON.stringify(rules));
    git(clone, 'switch', '--quiet', '-c', `task-${(branchN += 1)}`, 'origin/next');
    writeFileSync(join(clone, 'a.txt'), `v-${expectMerge}\n`);
    const res = helper('land.mjs', clone, ['--message', message(PR)], gh);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, expectOut);
    if (expectMerge) assert.deepEqual(ghLines(dir, 'gh-merge'), ['pr', 'merge', 'https://example.test/pull/7', '--auto', expectMerge]);
    else assert.equal(existsSync(join(dir, 'gh-merge')), false);
  }
});

test('land in a fork rebases onto upstream and opens PR there; direct clone without push access suggests forking', () => {
  const { dir, remote, clone, message, elsewhere } = trunk();
  const gh = stubGh(dir);
  writeFileSync(join(remote, 'hooks', 'pre-receive'), '#!/bin/sh\necho "Permission to t/remote.git denied to c." >&2\nexit 1\n', { mode: 0o755 });
  writeFileSync(join(clone, 'a.txt'), 'two\n');
  assert.match(helper('land.mjs', clone, ['--message', message(PR)], gh).stderr, /this clone cannot push to origin: fork the repository.*upstream/u);
  rmSync(join(remote, 'hooks', 'pre-receive'));

  const fork = join(dir, 'contributor', 'remote.git');
  git(dir, 'clone', '--quiet', '--bare', remote, fork);
  git(fork, 'config', 'receive.autogc', 'false');
  git(clone, 'remote', 'rename', 'origin', 'upstream');
  git(clone, 'remote', 'add', 'origin', fork);
  git(elsewhere('d.txt', 'theirs\n', 'docs(d): land elsewhere'), 'push', '--quiet', 'origin', 'HEAD:next');
  const run = helper('land.mjs', clone, ['--message', message(PR)], gh);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(git(fork, 'rev-parse', 'task^'), git(remote, 'rev-parse', 'next'));
  assert.equal(spawnSync('git', ['rev-parse', '--verify', 'task'], { cwd: remote, env: ENV }).status, 128);
  const args = ghArgs(dir);
  assert.deepEqual([...args.slice(0, 6), ...args.slice(10)], ['pr', 'create', '--base', 'next', '--head', 'contributor:task', '--repo', `${dir.split('/').at(-1)}/remote`]);
});

test('land renders PR body through plan-page.mjs with --attach, and refuses push when plan-page fails', () => {
  const { dir, remote, clone, message } = trunk();
  writeFileSync(
    join(clone, '.agents/pstack/plan-page.mjs'),
    `import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const [plan, flag] = process.argv.slice(2);
if (flag !== '--pr' || readFileSync(plan, 'utf8').includes('no brief')) { console.error(\`\${plan} needs a ## Brief before --pr\`); process.exit(1); }
mkdirSync('docs/plans/artifacts', { recursive: true });
writeFileSync('docs/plans/artifacts/x.pr.md', \`<!-- plan-page:start -->\\nThe page of \${plan}\\n<!-- plan-page:end -->\\n\`);
console.info(\`\${process.cwd()}/docs/plans/artifacts/x.pr.md\\n--attach ./docs/plans/shots/after.png\`);
`,
  );
  mkdirSync(join(clone, 'docs/plans'), { recursive: true });
  writeFileSync(join(clone, 'docs/plans/2026-10-18-x.md'), '# X\n\nno brief\n');
  const gh = stubGh(dir);

  const refused = helper('land.mjs', clone, ['--message', message(GOOD)], gh);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /plan-page\.mjs refused .*needs a ## Brief/su);
  assert.equal(spawnSync('git', ['rev-parse', '--verify', 'task'], { cwd: remote, env: ENV }).status, 128);

  writeFileSync(join(clone, 'docs/plans/2026-10-18-x.md'), '# X\n');
  const landed = helper('land.mjs', clone, [], gh);
  assert.equal(landed.status, 0, landed.stderr);
  assert.equal(readFileSync(join(dir, 'gh-body'), 'utf8'), '<!-- plan-page:start -->\nThe page of docs/plans/2026-10-18-x.md\n<!-- plan-page:end -->\n');
  assert.deepEqual(ghArgs(dir).slice(10), ['--attach', './docs/plans/shots/after.png']);
});

test('land validates Conventional commits, required trailers, Writing rule, closing keywords, and Introduced-by on fixes', () => {
  const { remote, clone, base, message } = trunk();
  git(clone, 'config', 'pstack.delivery', 'push');
  writeFileSync(join(clone, 'a.txt'), 'two\n');
  const head = git(clone, 'rev-parse', 'HEAD');

  const everything = helper('land.mjs', clone, ['--message', message('Change a.\nWhy a changes — and how. Closes #12 and fixes #34\n')]);
  assert.equal(everything.status, 1);
  for (const problem of [/is not one Conventional Commit/, /a blank line must separate/, /no `Beyond the ask:`/, /no `Picks:`/, /no `Not checked:`/, /breaks the Writing rule/, /"Closes #12" closes an issue/]) {
    assert.match(everything.stderr, problem);
  }
  assert.match(helper('land.mjs', clone, ['--message', message('feat(a): change a\n\nBeyond the ask: none\n<!--\nPicks: hidden\n-->\nNot checked: none\n')]).stderr, /no `Picks:`/);
  for (const [text, name] of [
    ['feat(a): change a\n\nRan triage fix #5228.\n\nBeyond the ask: none\nPicks: none\nNot checked: none\n', 'remote'],
    ['feat(a): change a\n\nCloses: udecode/plate#12\n\nBeyond the ask: none\nPicks: none\nNot checked: none\n', 'plate'],
  ]) {
    assert.match(helper('land.mjs', clone, ['--message', message(text)]).stderr, new RegExp(`closes an issue .*write \`${name}#<N>\``));
  }

  const FIX = 'fix(a): repair a\n\nBeyond the ask: none\nPicks: none\nNot checked: none';
  for (const [line, refusal] of [
    ['', /names no commit that introduced its bug/],
    ['\nIntroduced-by: ', /an `Introduced-by:` line has no value/],
    ['\nIntroduced-by: 0123456789abcdef0123456789abcdef01234567', /names no commit/],
    [`\nIntroduced-by: none\nIntroduced-by: ${base}`, /cannot stand beside another/],
    ['\nIntroduced-by:none', /with a space after the colon/],
    [`\nIntroduced-by: ${base.toUpperCase()}`, /is not a lowercase sha/],
    [`\nIntroduced-by: ${base.slice(0, 12)} ("base")`, /is not a lowercase sha/],
  ]) {
    const run = helper('land.mjs', clone, ['--message', message(`${FIX}${line}`)]);
    assert.equal(run.status, 1, line);
    assert.match(run.stderr, refusal, line);
  }
  assert.equal(git(remote, 'rev-parse', 'next'), base);
  assert.equal(git(clone, 'rev-parse', 'HEAD'), head);

  // Valid messages: code-span em-dash, repo#N ref, fix with base sha and fix with none.
  for (const text of [
    'feat(a): change a\n\nKeeps `—` and fix remote#5228.\n\nBeyond the ask: none\nPicks: none\nNot checked: none',
    `fix(a)!: repair a\n\nBeyond the ask: none\nPicks: none\nNot checked: none\nIntroduced-by: ${base}`,
    'fix: repair again\n\nBeyond the ask: none\nPicks: none\nNot checked: none\nIntroduced-by: none',
  ]) {
    writeFileSync(join(clone, 'a.txt'), `${text}\n`);
    const ok = helper('land.mjs', clone, ['--message', message(text)]);
    assert.equal(ok.status, 0, ok.stderr);
  }

  // Rerun keeps Plan: line even when plan filename holds a word writing-check flags.
  mkdirSync(join(clone, 'docs/plans'), { recursive: true });
  writeFileSync(join(clone, 'docs/plans/2026-11-01-pivotal.md'), '# X\n');
  assert.equal(helper('land.mjs', clone, ['--message', message(GOOD), '--check', 'false']).status, 1);
  const rerun = helper('land.mjs', clone, ['--check', 'true']);
  assert.equal(rerun.status, 0, rerun.stderr);
  assert.match(git(remote, 'log', '-1', '--format=%B', 'next'), /^Plan: docs\/plans\/2026-11-01-pivotal\.md$/mu);
});

const planDoc = ({ status = 'active', impact }) =>
  `# X\n\nStatus: ${status}\n\nOne.\n\nTwo.\n\nThree.\n\nFour.\n\n## Defaults\n\n| Decision | Pick | Alternative | Word | Impact |\n| --- | --- | --- | --- | --- |\n| Order | a | b | swap | ${impact} |\n`;

test('land --dry validates Defaults tables (including non-ASCII & companion plans), runs config landChecks, and enforces 55m deadline', () => {
  const fixture = trunk();
  const { dir, remote, clone, base, message } = fixture;
  git(clone, 'config', 'pstack.delivery', 'push');
  mkdirSync(join(clone, 'docs/plans'), { recursive: true });
  const planPath = join(clone, 'docs/plans/2026-11-02-café.md');
  writeFileSync(planPath, planDoc({ impact: 'huge' }));
  const head = git(clone, 'rev-parse', 'HEAD');

  assert.match(helper('land.mjs', clone, ['--message', message(GOOD), '--dry']).stderr, /## Defaults in docs\/plans\/2026-11-02-café\.md gives "Order" the impact "huge"/u);
  const realBad = helper('land.mjs', clone, ['--message', message(GOOD), '--check', 'touch checked']);
  assert.equal(realBad.status, 1);
  assert.equal(existsSync(join(clone, 'checked')), false);
  assert.equal(git(remote, 'rev-parse', 'next'), base);

  writeFileSync(planPath, planDoc({ impact: 'small' }));
  const ran = join(dir, 'ran');
  const config = JSON.parse(readFileSync(join(clone, '.agents/pstack.json'), 'utf8'));
  config.landChecks = [`test -f c.txt && echo saw >> ${ran}`, 'test -z "$PSTACK_LAND_CHECK"'];
  writeFileSync(join(clone, '.agents/pstack.json'), JSON.stringify(config));

  assert.match(helper('land.mjs', clone, ['--message', message(GOOD), '--dry'], { PSTACK_LAND_CHECK: '1' }).stderr, /land checks failed on the working tree/);
  writeFileSync(join(clone, 'c.txt'), 'new\n');
  const dryOk = helper('land.mjs', clone, ['--message', message(GOOD), '--dry'], { PSTACK_LAND_CHECK: '1' });
  assert.equal(dryOk.status, 0, dryOk.stderr);
  assert.equal(readFileSync(ran, 'utf8'), 'saw\n');
  assert.equal(git(clone, 'rev-parse', 'HEAD'), head);

  const deadline = helper('land.mjs', clone, ['--message', message(GOOD), '--dry'], { PSTACK_LAND_SPENT_MS: String(55 * 60_000) });
  assert.equal(deadline.status, 1);
  assert.match(deadline.stderr, /land\.mjs --dry stopped .* at 55 minutes into the run/u);

  // Companion-owned plan with bad Defaults is also refused by --dry.
  split(fixture);
  writeFileSync(join(clone, '.gitprivate'), '*.spec\n/docs/plans/\n');
  writeFileSync(join(clone, 'docs/plans/2026-11-02-comp.md'), planDoc({ impact: 'huge' }));
  assert.match(helper('land.mjs', clone, ['--message', message(GOOD), '--dry']).stderr, /gives "Order" the impact "huge"/u);
});

test('land refuses an open plan whose Defaults table a clean rebase made bad before running checks', () => {
  const { dir, remote, clone, message } = trunk();
  git(clone, 'config', 'pstack.delivery', 'push');
  mkdirSync(join(clone, 'docs/plans'), { recursive: true });
  const path = 'docs/plans/2026-11-02-x.md';
  writeFileSync(join(clone, path), planDoc({ status: 'executed', impact: 'small' }));
  git(clone, 'add', '--all');
  git(clone, 'commit', '--quiet', '-m', 'plan');
  git(clone, 'push', '--quiet', 'origin', 'HEAD:next');
  const other = join(dir, 'other-plan');
  git(dir, 'clone', '--quiet', '--branch', 'next', remote, other);
  writeFileSync(join(other, path), planDoc({ status: 'executed', impact: 'huge' }));
  git(other, 'commit', '--quiet', '-am', 'impact');
  git(other, 'push', '--quiet', 'origin', 'HEAD:next');
  writeFileSync(join(clone, path), planDoc({ status: 'active', impact: 'small' }));

  const run = helper('land.mjs', clone, ['--message', message(GOOD), '--check', 'touch checked']);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /gives "Order" the impact "huge"/u);
  assert.equal(existsSync(join(clone, 'checked')), false);
});
