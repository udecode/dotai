import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { chipLedger, ledgerRows } from './test-ledger.mjs';

test('whole-log check judges each row in history order and stays valid after later symlinks, landings or cards', () => {
  const { LEDGER, appendTo, chip, chips, helper, offer, outside, root } = chipLedger();
  mkdirSync(join(root, 'src/a'), { recursive: true });
  assert.equal(offer('t_7a004000 Fix a', 'src/a', 'topic: a').status, 0);
  assert.equal(chip('t_7a004000 Fix a', 'started').status, 0);
  assert.equal(offer('t_7a009000 Fix b', 'src/b', 'topic: b').status, 0);
  assert.equal(chip('t_7a009000 Fix b', 'started', 'writes: alias').status, 0);
  assert.equal(chip('t_7a004000 Fix a', 'landed').status, 0);
  assert.equal(chip('t_7a009000 Fix b', 'landed').status, 0);
  symlinkSync('src/a', join(root, 'alias'));
  assert.equal(helper(LEDGER).status, 0);

  // base-red row stays valid after owning task lands; carded row stays valid after another task starts on outside path.
  const log = 'docs/plans/2026-01-01-fix.decisions.tsv';
  const green = 't_7a01f000 Make next green (xhigh)';
  assert.equal(offer(green, '.github/workflows', 'topic: next-green; owns: ci:check').status, 0);
  assert.equal(appendTo(log, 'verify', 'read CI', 'base-red: ci:check; proof: none', 'gap: fails on next too').status, 0);
  assert.equal(chip(green, 'started').status, 0);
  assert.equal(chip(green, 'landed').status, 0);
  assert.equal(helper(log).status, 0);

  assert.equal(offer('t_7a00d000 Fix the reader', outside('r.md'), 'topic: io; card: c1; session: s1').status, 0);
  assert.equal(offer('t_7a00e000 Fix the writer', outside('r.md'), 'topic: io-write').status, 0);
  assert.equal(chip('t_7a00e000 Fix the writer', 'started').status, 0);
  assert.equal(helper(LEDGER).status, 0);
  const board = chips('--session', 's1');
  assert.equal(board.status, 1);
  assert.match(board.stdout, /withdraw t_7a00d000's card c1: started t_7a00e000 writes its paths outside this checkout/);
});

test('dups transfer covers, paths, waits, owned checks, and effort, enforce topic/loop/card guards, and redirect briefs', () => {
  const { appendTo, chip, chips, offer, outside } = chipLedger();
  const parser = 't_7a004000 Fix the parser';
  const docs = 't_7a009000 Find why the parser hangs (xhigh)';
  assert.equal(offer(parser, 'src/p.ts', 'topic: parser').status, 0);
  assert.equal(offer(docs, outside('p.md'), 'topic: other; waits: pr:99, task:t_7a004000; owns: ci:docs').status, 0);

  // Cross-topic dup refused until moved to same topic.
  assert.match(chip(docs, 'dismissed dup t_7a004000').stderr, /t_7a009000 is in topic other and t_7a004000 in parser/);
  assert.equal(chip(docs, 'updated', 'topic: parser').status, 0);
  assert.equal(chip(docs, 'dismissed dup t_7a004000').status, 0);

  // Brief shows promoted effort, merged covers/paths/owns/waits, and merged-id redirect.
  assert.match(chips('brief', 't_7a004000').stdout, /^\[P0\] Fix the parser \(xhigh\)\n[\s\S]*Also covers:\n- t_7a009000 Find why the parser hangs \(xhigh\)\n[\s\S]*Owns: ci:docs\nWaited on: pr:99\n/);
  assert.match(chips('brief', 't_7a009000').stdout, /^t_7a009000 was merged into t_7a004000; work from its brief\./);
  assert.equal(appendTo('docs/plans/2026-01-01-fix.decisions.tsv', 'verify', 'read CI', 'base-red: ci:docs; proof: none', 'gap: fails on next too').status, 0);

  // Dup that would close a wait loop is refused.
  assert.equal(offer('t_7a010000 Fix d', 'src/d.ts', 'topic: chain').status, 0);
  assert.equal(offer('t_7a027000 Fix m', 'src/m.ts', 'topic: chain; waits: task:t_7a010000').status, 0);
  assert.equal(offer('t_7a023000 Fix k', 'src/k.ts', 'topic: chain; waits: task:t_7a027000').status, 0);
  assert.match(chip('t_7a010000 Fix d', 'dismissed dup t_7a023000').stderr, /waiting on each other; keep t_7a010000 open$/m);
  assert.match(chip('t_7a010000 Fix d', 'updated', 'waits: task:t_7a027000').stderr, /waiting on each other; drop the wait that closes the loop/);

  // Merged brief refuses once target is started, carded or landed.
  assert.equal(chip(parser, 'started').status, 0);
  assert.equal(chips('brief', 't_7a009000').status, 1);
  assert.match(chips('brief', 't_7a009000').stderr, /merged into t_7a004000, which is started/);
  assert.equal(chip(parser, 'landed').status, 0);
  assert.match(chips('brief', 't_7a009000').stderr, /merged into t_7a004000, which is landed/);
});

test('folding promotes kind/effort, enforces one design question per topic, and refuses invalid fold tokens', () => {
  const { chip, chips, offer } = chipLedger();
  assert.equal(offer('t_7a010000 Decide the export format (xhigh)', 'src/e.ts', 'topic: export; kind: decide').status, 0);
  assert.equal(offer('t_7a023000 Fix the export button', 'src/b.ts', 'topic: export').status, 0);
  assert.match(chip('t_7a023000 Fix the export button', 'folded', 'kind: decide; writes: src/c.ts').stderr, /topic export already has the open design question t_7a010000/);
  assert.match(chip('t_7a010000 Decide the export format (xhigh)', 'folded', 'kind: fix').stderr, /a folded row takes kind: decide only/);
  assert.equal(chip('t_7a010000 Decide the export format (xhigh)', 'folded', 'kind: decide; writes: src/f.ts').status, 0);

  assert.equal(offer('t_7a033000 Fix the parser', 'src/p.ts', 'topic: parser').status, 0);
  assert.match(chip('t_7a033000 Fix the parser', 'folded', 'effort: high').stderr, /a folded row takes effort: xhigh only/);
  assert.equal(chip('t_7a033000 Fix the parser', 'folded', 'effort: xhigh; writes: src/q.ts').status, 0);
  assert.match(chips('brief', 't_7a033000').stdout, /^\[P1\] Fix the parser \(xhigh\)\n[\s\S]*Kind: fix\./);

  assert.equal(offer('t_7a035000 Decide file format (xhigh)', 'src/f2.ts', 'topic: format; kind: decide').status, 0);
  assert.match(chip('t_7a035000 Decide file format (xhigh)', 'updated', 'topic: export').stderr, /topic export already has the open design question t_7a010000; log t_7a035000 dismissed dup t_7a010000 instead/);
});

test('card lifecycle: single card per task, carded immutability except narrowing/priority, exact card id on uncarded/declined, and withdrawal->ledger->card pass ordering', () => {
  const { batch, chip, chips, offer, root, LEDGER } = chipLedger();
  assert.equal(offer('t_7a023000 Fix k', 'src/k, test', 'topic: card; card: c1; session: s1').status, 0);
  assert.equal(offer('t_7a010000 Fix d', 'src/d.ts', 'topic: card; waits: task:t_7a023000').status, 0);

  // Second card, fold, widening/other updates, and dup into carded task are refused; narrowing writes and priority update are allowed.
  assert.match(chip('t_7a023000 Fix k', 'carded', 'card: c2; session: s2').stderr, /already has card c1/);
  assert.match(chip('t_7a023000 Fix k', 'folded', 'writes: src/m.ts').stderr, /holds card c1, which cannot show new work/);
  assert.match(chip('t_7a010000 Fix d', 'dismissed dup t_7a023000').stderr, /holds card c1, which cannot show new work/);
  assert.equal(chip('t_7a023000 Fix k', 'updated', 'writes: src/k/a.ts, test/k.test.ts').status, 0);
  assert.match(chip('t_7a023000 Fix k', 'updated', 'writes: src/k/a.ts, test').stderr, /holds card c1, which cannot change/);
  assert.match(chip('t_7a023000 Fix k', 'updated', 'topic: other').stderr, /holds card c1, which cannot change/);
  assert.equal(chip('t_7a023000 Fix k', 'updated', 'priority: P2').status, 0);

  // uncarded/declined must match current card id; once uncarded, waiting same-topic finding merges cleanly.
  assert.match(chip('t_7a023000 Fix k', 'uncarded').stderr, /name it as card: c1/);
  assert.match(chip('t_7a023000 Fix k', 'dismissed declined').stderr, /name it as card: c1/);
  assert.equal(chip('t_7a023000 Fix k', 'uncarded', 'card: c1').status, 0);
  assert.match(chips().stdout, /Do, ledger pass \(1\)\n {2}merge t_7a010000 into t_7a023000:/);
  assert.equal(batch([['t_7a010000 Fix d', 'dismissed dup t_7a023000']]).status, 0);

  // Pass ordering: withdrawal pass -> ledger pass -> card pass.
  assert.equal(offer('t_7a00d000 Fix c', 'src/c.ts', 'topic: three; card: c3; session: s1').status, 0);
  assert.equal(chip('t_7a00d000 Fix c', 'updated', 'waits: pr:5').status, 0);
  writeFileSync(join(root, LEDGER), `${ledgerRows([['t_7a02f000 Fix old', 'writes: docs/o.md', 'offered']]).trimEnd()}\n` + readFileSync(join(root, LEDGER), 'utf8').split('\n').slice(1).join('\n'));
  const wPass = chips('--session', 's1');
  assert.match(wPass.stdout, /Do, withdrawal pass \(1\)\n {2}withdraw t_7a00d000's card c3/);
  assert.doesNotMatch(wPass.stdout, /migrate t_7a02f000|card t_7a023000/);
  assert.equal(chip('t_7a00d000 Fix c', 'uncarded', 'card: c3').status, 0);
  assert.match(chips().stdout, /Do, ledger pass \(1\)\n {2}migrate t_7a02f000/);
  assert.equal(chip('t_7a02f000 Fix old', 'updated', 'topic: docs; waits: none').status, 0);
  assert.match(chips().stdout, /Do, ledger pass \(1\)\n {2}prioritize t_7a02f000:/);
  assert.equal(chip('t_7a02f000 Fix old', 'updated', 'priority: P2').status, 0);
  assert.match(chips().stdout, /Do, card pass/);
});

test('priority evidence, maxEffort cap, 10-card limit, and issue-backed ordering within priority', () => {
  const { LEDGER, batch, chip, chips, helper, merge, root } = chipLedger();
  const bare = (decision, tokens) => helper('append', LEDGER, 'chip', decision, 'why', tokens, 'offered');

  assert.match(bare('t_7a004000 Fix a', 'writes: a.md; topic: one').stderr, /names its priority/);
  assert.equal(bare('t_7a004000 Fix a', 'writes: a.md; topic: one; owns: ci:check').status, 0);
  assert.match(bare('t_7a009000 Fix b', 'writes: b.md; topic: two; priority: P0').stderr, /a P0 task is broken now/);
  assert.match(bare('t_7a009000 Fix b', 'writes: b.md; topic: two; priority: P1').stderr, /a P1 task is a bug with its repro/);
  assert.match(bare('t_7a009000 Fix b', 'writes: b.md; topic: two; priority: P4').stderr, /priority: is P0, P1, P2 or P3/);
  assert.match(bare('t_7a009000 Fix b', 'writes: b.md; topic: two; priority: P0; regressed: abc1234').stderr, /is not a commit/);
  assert.match(bare('t_7a00d000 Fix c', 'writes: c.md; topic: three; priority: P2').stderr, /P0 or P1 finding/);
  merge('break b');
  const head = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  assert.equal(bare('t_7a009000 Fix b', `writes: b.md; topic: two; priority: P0; regressed: ${head}`).status, 0);
  assert.equal(bare('t_7a00d000 Fix c', 'writes: c.md; topic: three; priority: P2; via: verdict').status, 0);
  assert.equal(chip('t_7a00d000 Fix c', 'updated', 'priority: P0; repro: acme#12 fails').status, 0);

  // maxEffort cap applies in brief and board.
  assert.equal(bare('t_7a010000 Design export (xhigh)', 'writes: e.md; topic: export; kind: decide; priority: P1; repro: https://github.com/acme/app/issues/7').status, 0);
  writeFileSync(join(root, '.agents/pstack.json'), JSON.stringify({ branch: 'next', maxEffort: 'high' }));
  assert.match(chips('brief', 't_7a010000').stdout, /Kind: decide\. Effort: high\./);
  assert.match(chips().stdout, /t_7a010000 {2}Design export \(xhigh\) {2}\[export, decide\] {2}effort high/);

  // 10-card cap and issue-backed ranking within P0/P1.
  const extras = [];
  for (let n = 0; n < 9; n += 1) extras.push([`t_7a0${(0x32 + n).toString(16)}000 Fix p${n}`, 'offered', `writes: p${n}.md; topic: p2-${n}; priority: P2; via: verdict`]);
  extras.push(['t_7a014000 Fix non-issue', 'offered', 'writes: n.md; topic: n; priority: P1; repro: paste &#12; then undo']);
  assert.equal(batch(extras).status, 0);
  const board = chips().stdout;
  assert.match(board, /Ready, P0 \(3\)\n {2}t_7a00d000 /);
  assert.match(board, /Ready, P1 \(2\)\n {2}t_7a010000 [^\n]*\n {2}t_7a014000 /);
  assert.match(board, /Ready, lower priority \(P2 9\): chips all lists them/);
  assert.equal(board.match(/^ {2}card t_/gmu).length, 10);
});

test('chips ranks regressions before new before experimental scopes, and ranks deferred scopes last with withdrawal when crowded', () => {
  const { batch, chip, chips, outside } = chipLedger({
    config: { triage: { experimental: ['pagination'] }, chips: { scopes: 'scopes', deferred: ['collaboration'] } },
    files: { 'scopes/editor.json': '{}', 'scopes/pagination.json': '{}', 'scopes/collaboration.json': '{}' },
  });
  const written = batch([
    ['t_7a004000 Fix a', 'offered', 'writes: a.md; topic: a; priority: P1; repro: steps; review-scope: editor'],
    ['t_7a009000 Fix b', 'offered', 'writes: b.md; topic: b; priority: P1; repro: steps; review-scope: pagination'],
    ['t_7a00d000 Fix c', 'offered', 'writes: c.md; topic: c; priority: P1; repro: steps; review-scope: pagination; regression: https://example.org/demo'],
    ['t_7a010000 Fix d', 'offered', 'writes: d.md; topic: d; priority: P1; repro: steps; review-scope: none'],
    ['t_7a04a000 Fix y0', 'offered', 'writes: y0.md; topic: y0; priority: P0; repro: peers diverge; review-scope: collaboration'],
    ['t_7a04b000 Fix y1', 'offered', 'writes: y1.md; topic: y1; priority: P2; via: verdict; review-scope: collaboration; owns: ci:yjs'],
    ['t_7a04f000 Fix z1', 'offered', `writes: ${outside('shared.md')}; topic: z1; priority: P0; repro: steps; review-scope: collaboration`],
    ['t_7a02d000 Fix n1', 'offered', `writes: ${outside('shared.md')}; topic: n1; priority: P1; repro: steps; review-scope: editor`],
  ]);
  assert.equal(written.status, 0, written.stderr);
  const board = chips().stdout;
  assert.match(board, /Ready, P0 \(1\)\n {2}t_7a04b000 /, 'base-red owner in deferred scope stays P0');
  assert.match(board, /Ready, P1 \(5\)\n {2}t_7a00d000 [^\n]*regression[\s\S]*t_7a004000 [^\n]*new[\s\S]*t_7a009000 [^\n]*experimental/);
  assert.match(board, /Ready, deferred, P0 \(1\)\n {2}t_7a04a000 /);
  assert.match(board, /Waiting, deferred, P0 \(1\)\n {2}t_7a04f000 [^\n]*queued behind t_7a02d000/);

  // Invalid review-scope and non-URL regression refused.
  assert.match(chip('t_7a023000 Fix k', 'offered', 'writes: k.md; topic: k; priority: P1; repro: steps; review-scope: editr').stderr, /is no review scope/);
  assert.match(chip('t_7a027000 Fix m', 'offered', 'writes: m.md; topic: m; priority: P1; repro: steps; regression: bad').stderr, /is not a URL/);
});
