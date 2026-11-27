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

test('land opens PR into next with auto-merge, validates PR body/models sheet, and handles fork & no-push-access clones', () => {
  const { dir, remote, clone, base, message } = trunk();
  const gh = stubGh(dir);
  writeFileSync(join(clone, 'a.txt'), 'two\n');
  git(clone, 'commit', '--quiet', '-am', 'wip');
  const head = git(clone, 'rev-parse', 'HEAD');

  // Refuses PR without ## Why / ## Verification text, keeping HEAD intact.
  assert.match(helper('land.mjs', clone, ['--message', message(GOOD)], gh).stderr, /needs a `## Why` section and a `## Verification` section with text/);
  assert.match(helper('land.mjs', clone, ['--message', message('feat(a): change a\n\n## Why\n\nWhy.\n\n## Verification\n\n<!-- placeholder -->\n')], gh).stderr, /needs a `## Verification` section with text/);
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

test('land uses the changed dated plan Markdown directly as PR body (stripping YAML frontmatter)', () => {
  const { dir, clone, message } = trunk();
  mkdirSync(join(clone, 'docs/plans'), { recursive: true });
  writeFileSync(join(clone, 'docs/plans/2026-10-18-x.md'), '---\nstatus: active\n---\n# X\n\nPlan details.\n');
  const gh = stubGh(dir);

  const landed = helper('land.mjs', clone, ['--message', message(GOOD)], gh);
  assert.equal(landed.status, 0, landed.stderr);
  assert.equal(readFileSync(join(dir, 'gh-body'), 'utf8'), '# X\n\nPlan details.\n');
});

test('land validates Conventional commits, Writing rule, closing keywords, and optional Introduced-by on fixes', () => {
  const { remote, clone, base, message } = trunk();
  git(clone, 'config', 'pstack.delivery', 'push');
  writeFileSync(join(clone, 'a.txt'), 'two\n');
  const head = git(clone, 'rev-parse', 'HEAD');

  const everything = helper('land.mjs', clone, ['--message', message('Change a.\nWhy a changes — and how. Closes #12 and fixes #34\n')]);
  assert.equal(everything.status, 1);
  for (const problem of [/is not one Conventional Commit/, /a blank line must separate/, /breaks the Writing rule/, /"Closes #12" closes an issue/]) {
    assert.match(everything.stderr, problem);
  }
  for (const [text, name] of [
    ['feat(a): change a\n\nRan triage fix #5228.\n', 'remote'],
    ['feat(a): change a\n\nCloses: udecode/plate#12\n', 'plate'],
  ]) {
    assert.match(helper('land.mjs', clone, ['--message', message(text)]).stderr, new RegExp(`closes an issue .*write \`${name}#<N>\``));
  }

  const FIX = 'fix(a): repair a\n\nWhy.';
  for (const [line, refusal] of [
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

  // Valid messages: code-span em-dash, repo#N ref, fix without Introduced-by, fix with base sha, and fix with none.
  for (const text of [
    'feat(a): change a\n\nKeeps `—` and fix remote#5228.',
    'fix(a): repair without trailer\n\nWhy.',
    `fix(a)!: repair a\n\nIntroduced-by: ${base}`,
    'fix: repair again\n\nIntroduced-by: none',
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

test('land --dry runs config landChecks without committing and enforces 55m deadline', () => {
  const fixture = trunk();
  const { dir, clone, message } = fixture;
  git(clone, 'config', 'pstack.delivery', 'push');
  const head = git(clone, 'rev-parse', 'HEAD');
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
});
