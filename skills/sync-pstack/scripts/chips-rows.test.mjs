import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { commit, project, read, sandbox } from './test-sandbox.mjs';
import { chipLedger, commitAt, daysAgo, linkedWorktree, LOG_HEADER, planRow, stalePlanLedger } from './test-ledger.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HELPERS = join(HERE, '../assets/pstack');

test('decisions-check validates chip ledger location, offer ids, titles, topics, writes paths, evidence files, and base-red owners', () => {
  const { LEDGER, appendTo, chip, helper, offer, root } = chipLedger();
  const runLog = 'docs/plans/2026-01-01-fix.decisions.tsv';

  // Chip rows belong in the project ledger, never run logs; offered belongs only in phase chip.
  assert.match(appendTo(runLog, 'chip', 't_7a004000 Fix the stale badge', 'writes: README.md; topic: docs', 'offered').stderr, /chip rows go in the project's ledger/);
  assert.match(appendTo(LEDGER, 'build', 'ship the parser', 'scope: fixtures', 'offered').stderr, /only in a chip row/);

  // Task id, title, topic, writes:, waits: validation.
  assert.equal(offer('t_7a004000').status, 1);
  for (const bad of ['No id title', 'task_a1 Old id', 't_8cb2e81 Short hex', 'T_8CB2E811 Upper']) {
    assert.match(offer(bad).stderr, /is no task id; put the id that/, bad);
  }
  for (const tagged of ['t_7a004000 Now: Fix badge', 't_7a004000 After: Fix badge', 't_7a004000 [P1] Fix badge', 't_7a004000 Fix badge (high)']) {
    assert.match(offer(tagged).stderr, /no title says Now: or After:/, tagged);
  }
  assert.match(offer('t_7a004000 Fix badge', 'README.md', 'no topic').stderr, /names its owner question as "topic: <word>"/);
  assert.match(offer('t_7a004000 Fix badge', 'README.md', 'topic: Docs Pages').stderr, /lowercase kebab-case/);
  assert.match(offer('t_7a004000 Fix badge', 'README.md', 'topic: docs; waits: after the release').stderr, /waits: takes pr:<number>, task:<id> or run:/);
  assert.match(chip('t_7a004000 Fix badge', 'offered', 'topic: docs').stderr, /writes: <path>, <path>/);
  for (const path of ['packages/*/src', 'src/**', '`docs/x.md`', 'README.md.', '"docs/x.md"']) {
    assert.match(offer('t_7a004000 Fix badge', path).stderr, /no whitespace, glob, quote/, path);
  }

  // Missing cited artifact log is refused on offer/fold/repro, while writes: run-dir path may not exist yet.
  const missingLog = 'docs/plans/artifacts/probe/base-a1.log';
  assert.match(helper('append', LEDGER, 'chip', 't_7a004000 Fix badge', `dead link (${missingLog})`, 'writes: README.md; topic: docs; priority: P3; via: verdict', 'offered').stderr, /which this checkout lacks/);
  assert.match(offer('t_7a009000 Fix badge', 'README.md', 'topic: docs; priority: P1; repro: docs/plans/artifacts/run/gone.log fails').stderr, /which does not exist/);
  mkdirSync(join(root, 'docs/plans/artifacts/probe'), { recursive: true });
  writeFileSync(join(root, missingLog), 'exit=1\n');
  assert.equal(helper('append', LEDGER, 'chip', 't_7a004000 Fix badge', `dead link (${missingLog})`, 'writes: docs/plans/artifacts/run/page/, README.md; topic: docs; owns: ci:check; priority: P1; repro: steps', 'offered').status, 0);
  assert.match(offer('t_7a004000 Fix badge').stderr, /already offered/);
  assert.match(helper('append', LEDGER, 'chip', 't_7a004000 Fix badge', 'footer (docs/plans/artifacts/probe/missing.log)', 'kind: decide; effort: xhigh', 'folded').stderr, /which this checkout lacks/);
  rmSync(join(root, missingLog));
  assert.equal(helper(LEDGER).status, 0, 'whole-log check tolerates older offer whose artifact was later removed');

  // base-red: requires an open owning task, and clears once the owner lands.
  assert.equal(appendTo(runLog, 'verify', 'read CI', 'base-red: ci:check; proof: none', 'gap: fails on next').status, 0);
  assert.match(appendTo(runLog, 'verify', 'read CI', 'base-red: ci:other; proof: none', 'gap: fails on next').stderr, /base-red: ci:other has no open suggested task that owns it/);
  assert.equal(chip('t_7a004000 Fix badge', 'started', 'writes: docs/plans/artifacts/run/notes.md; session: s1').status, 0);
  assert.equal(chip('t_7a004000 Fix badge', 'landed').status, 0);
  assert.equal(appendTo(runLog, 'verify', 'read CI', 'base-red: ci:check; proof: none', 'gap: fails on next').status, 1);

  // Old task ids remain editable after replay.
  appendFileSync(join(root, LEDGER), '2026-01-01T00:00:00Z\tchip\ttask_b1 Fix old\twhy\twrites: README.md; topic: docs; priority: P1; repro: steps\toffered\n');
  assert.equal(chip('task_b1 Fix old', 'updated', 'topic: badges').status, 0);
  assert.equal(helper(LEDGER).status, 0);
});

test('chip transitions enforce valid states, codex: always, T3CODE_THREAD_ID colon session tokens, and outside-checkout started exclusivity', () => {
  const { LEDGER, chip, chips, helper, offer, outside, root } = chipLedger();
  const badge = 't_7a004000 Fix the stale badge';
  const guide = 't_7a00f000 Rewrite the install guide';
  const threadId = 'import:claudeAgent:6fa59d13-f5d8-41e1-9b73-264920d44263';
  assert.equal(offer(badge, `README.md, ${outside('rule.md')}`, `topic: docs; session: ${threadId}`).status, 0);
  assert.equal(offer(guide, 'docs/install.md', 'topic: docs').status, 0);

  // Colon-delimited T3CODE_THREAD_ID accepted; malformed session tokens refused.
  assert.equal(chip(badge, 'carded', `card: t_7a00d000; session: ${threadId}; codex: always`).status, 0);
  assert.match(chips('brief', 't_7a004000').stdout, /forces the Codex handoff/);
  assert.match(chips('--session', threadId).stdout, /t_7a004000 {2}Fix the stale badge/);
  for (const bad of [':leading', 'has space', 'bad/slash']) {
    assert.match(offer('t_7a009000 Bad session', 'README.md', `topic: docs; session: ${bad}`).stderr, /session: names the session id as one token/, bad);
  }
  assert.equal(chips('--session', ':leading').status, 2);
  assert.match(chip(guide, 'carded', 'card: c2; session: s1; codex: sometimes').stderr, /codex: is always/);
  assert.equal(chip(badge, 'uncarded', 'card: t_7a00d000').status, 0);
  assert.doesNotMatch(chips('brief', 't_7a004000').stdout, /forces the Codex handoff/);
  writeFileSync(join(root, '.agents/pstack.json'), JSON.stringify({ branch: 'next', chips: { codex: 'always' } }));
  assert.match(chips('brief', 't_7a004000').stdout, /forces the Codex handoff/);

  // Dismissal & dup validation, plus reopening a dup and marking apart.
  for (const bad of ['dismissed', 'dismissed later', 'dismissed gone', 'dismissed replaced t_7a00f000', 'dismissed dup t_7a036000', 'dismissed dup t_7a004000']) {
    assert.equal(chip(badge, bad).status, 1, bad);
  }
  assert.match(chip('t_7a004000 Renamed badge', 'dismissed done').stderr, /every later row repeats that decision/);
  assert.match(chip(badge, 'updated', 'because').stderr, /names what changes/);
  assert.equal(chip(badge, 'dismissed dup t_7a00f000: guide covers badge').status, 0);
  assert.match(chips('brief', 't_7a00f000').stdout, /Also covers:\n- t_7a004000 /);
  assert.match(chip(badge, 'started').stderr, /is dismissed dup, so it cannot be started/);
  assert.equal(chip(badge, 'reopened', 'owner says separate').status, 0);
  assert.doesNotMatch(chips('brief', 't_7a00f000').stdout, /- t_7a004000 /);
  assert.equal(chip(badge, 'apart', 'from: t_7a00f000').status, 0);

  // Started state rules: cannot dismiss done/superseded/dup or uncard, can widen project path but not outside-checkout overlap.
  const writer = 't_7a00e000 Fix the writer';
  assert.equal(offer(writer, 'src/w.ts', 'topic: docs').status, 0);
  assert.match(chip(badge, 'dismissed stopped').stderr, /is offered, so it cannot be dismissed stopped/);
  assert.equal(chip(badge, 'started', `session: ${threadId}`).status, 0);
  for (const bad of ['dismissed done', 'dismissed superseded', 'dismissed dup t_7a00f000', 'uncarded']) {
    assert.equal(chip(badge, bad).status, 1, bad);
  }
  assert.match(chip(guide, 'dismissed dup t_7a004000').stderr, /is started, and a dup moves work only into an offered task/);
  assert.equal(chip(writer, 'started').status, 0);
  assert.equal(chip(writer, 'started', 'writes: README.md').status, 0, 'project path overlap allowed across worktrees');
  assert.match(chip(writer, 'started', `writes: ${outside('rule.md')}`).stderr, /cannot add a path outside this checkout that t_7a004000, also started, writes/);
  assert.equal(chip(writer, 'started', `writes: ${outside('other.md')}`).status, 0);
  assert.equal(chip(badge, 'dismissed stopped: owner closed session').status, 0);
  assert.equal(helper(LEDGER).status, 0);
});

test('trunk linked worktree uses main checkout ledger, run dir, and both checkouts review scopes; non-trunk keeps its own ledger', () => {
  const { LEDGER, dir, helper, offerHere, outside, root, worktree } = linkedWorktree('trunk');
  writeFileSync(join(root, '.agents/pstack.json'), JSON.stringify({ branch: 'next', delivery: 'trunk', chips: { scopes: 'scopes' } }));
  for (const [checkout, scope] of [[root, 'editor'], [worktree, 'ink']]) {
    mkdirSync(join(checkout, 'scopes'));
    writeFileSync(join(checkout, 'scopes', `${scope}.json`), '{}');
  }

  assert.equal(offerHere('t_7a004000 Fix badge', 'writes: README.md; topic: docs; owns: ci:new; review-scope: ink').status, 0);
  assert.equal(offerHere('t_7a009000 Fix caret', 'writes: b.md; topic: b; review-scope: editor').status, 0);
  assert.match(offerHere('t_7a00d000 Fix pen', 'writes: c.md; topic: c; review-scope: inkk').stderr, /review-scope: inkk is no review scope in scopes/);
  assert.match(read(root, LEDGER), /t_7a004000 Fix badge/);
  assert.equal(existsSync(join(worktree, LEDGER)), false);
  assert.match(helper('chips').stdout, /t_7a004000 {2}Fix badge/);

  const log = 'docs/plans/2026-01-01-fix.decisions.tsv';
  assert.equal(helper('append', log, 'verify', 'Record base red', 'why', 'base-red: ci:new; proof: none', 'partial, fails on base').status, 0);
  mkdirSync(join(root, 'docs/plans/artifacts/fix'), { recursive: true });
  writeFileSync(join(root, 'docs/plans/artifacts/fix/send-a1.log'), 'exit=0\n');
  assert.equal(helper('append', log, 'verify', 'Prove send', 'why', 'proof: docs/plans/artifacts/fix/send-a1.log', 'partial, one width').status, 0);
  assert.equal(existsSync(join(worktree, log)), true);
  assert.equal(helper('append', log, 'verify', 'Prove missing', 'why', 'proof: docs/plans/artifacts/fix/missing.log', 'partial, none').status, 1);
  mkdirSync(join(dir, 'replay'), { recursive: true });
  assert.equal(helper('append', join(dir, 'replay', 'suggested-tasks.decisions.tsv'), 'trail', 'Inspect replay', 'why', 'proof: none', 'recorded').status, 0);
  assert.doesNotMatch(read(root, LEDGER), /Inspect replay/);

  const brief = helper('chips', 'brief', 't_7a004000').stdout;
  assert.match(brief, /land the task yourself from it with node \.agents\/pstack\/land\.mjs/);
  assert.doesNotMatch(brief, /git diff --cached|apply --check|outside the checkout/);

  // Trunk drops outside-checkout path waits, checks run: plans against origin/next.
  for (const [decision, topic] of [['t_7a00a000 Edit notes', 'notes-a'], ['t_7a00f000 Rewrite notes', 'notes-b']]) {
    assert.equal(offerHere(decision, `writes: ${outside('notes.md')}; topic: ${topic}`).status, 0);
  }
  writeFileSync(join(worktree, 'docs/plans/2026-01-01-fix.md'), '# Fix\n\nStatus: building\n');
  assert.equal(offerHere('t_7a012000 Follow fix', 'writes: docs/guide.md; topic: follow; waits: run:docs/plans/2026-01-01-fix.md').status, 0);
  assert.equal(offerHere('t_7a017000 Follow typo', 'writes: docs/typo.md; topic: typo; waits: run:docs/plans/2026-01-01-nope.md').status, 0);
  const board = helper('chips').stdout;
  assert.doesNotMatch(board, /queued behind|outside this checkout/);
  assert.match(board, /run:docs\/plans\/2026-01-01-fix\.md not landed/);
  assert.match(board, /run:docs\/plans\/2026-01-01-nope\.md dangling, no such plan/);

  writeFileSync(join(root, 'docs/plans/2026-01-01-fix.md'), '# Fix\n\nStatus: done\n');
  spawnSync('git', ['-C', root, 'add', 'docs/plans/2026-01-01-fix.md']);
  commit(root, 'land fix');
  spawnSync('git', ['-C', root, 'update-ref', 'refs/remotes/origin/next', 'HEAD']);
  assert.doesNotMatch(helper('chips').stdout, /2026-01-01-fix\.md/);

  // Non-trunk linked worktree keeps its own ledger and outside-checkout path waits.
  const push = linkedWorktree('push');
  assert.equal(push.offerHere('t_7a004000 Fix badge', 'writes: README.md; topic: docs').status, 0);
  assert.match(read(push.worktree, push.LEDGER), /t_7a004000/);
  assert.doesNotMatch(read(push.root, push.LEDGER), /t_7a004000/);
  for (const [decision, topic] of [['t_7a00a000 Edit notes', 'notes-a'], ['t_7a00f000 Rewrite notes', 'notes-b']]) {
    assert.equal(push.offerHere(decision, `writes: ${push.outside('notes.md')}; topic: ${topic}`).status, 0);
  }
  assert.match(push.helper('chips').stdout, /queued behind t_7a00a000/);
});

test('chips compares normalized/symlinked paths, clears merged PR/landed task/done plan waits, and flags dangling/closed waits', () => {
  const { chip, chips, merge, offer, outside, root } = chipLedger();
  mkdirSync(join(root, 'deep/dir'), { recursive: true });
  writeFileSync(join(root, 'deep/x.txt'), 'deep');
  writeFileSync(join(root, 'x.txt'), 'top');
  symlinkSync(join(root, 'deep/dir'), join(root, 'link'));
  assert.equal(offer('t_7a004000 Fix badge').status, 0);
  assert.equal(offer('t_7a005000 Fix deep', 'deep/x.txt').status, 0);
  const aliases = ['./README.md', 'docs/../README.md', join(root, 'README.md'), 'readme.md', 'link/../x.txt'];
  for (const [i, alias] of aliases.entries()) assert.equal(offer(`t_7a00${(8 + i).toString(16)}000 Rewrite file`, alias).status, 0, alias);
  assert.equal(offer('t_7a00d000 Fix top', 'x.txt').status, 0);
  assert.equal(offer('t_7a010000 Fix rule', outside('rule.md')).status, 0);
  assert.equal(offer('t_7a011000 Reword rule', outside('../shared/rule.md')).status, 0);

  const overlapBoard = chips().stdout;
  assert.match(overlapBoard, /t_7a00c000 {2}Rewrite file {2}\[docs\] {2}no card {2}shares paths with t_7a005000\n/);
  assert.match(overlapBoard, /t_7a00d000 {2}Fix top {2}\[docs\] {2}no card\n/);
  assert.match(overlapBoard, /t_7a011000 {2}Reword rule {2}\[docs\] {2}waits on queued behind t_7a010000, which writes the same paths outside this checkout/);

  // Wait clearing: PR merge/squash (#14 != #140), landed task, executed plan; dangling/superseded/cancelled -> exit 1.
  merge('Merge pull request #12 from a/badge');
  merge('Fix the parser (#14)');
  writeFileSync(join(root, 'docs/plans/2026-01-01-pivot.md'), '# Pivot\n\nStatus: building: ledger\n');
  writeFileSync(join(root, 'docs/plans/2026-01-02-dropped.md'), '# Dropped\n\nStatus: cancelled: dropped\n');
  assert.equal(offer('t_7a020000 Wait merge', 'src/a.ts', 'topic: w1; waits: pr:12').status, 0);
  assert.equal(offer('t_7a021000 Wait squash', 'src/b.ts', 'topic: w2; waits: pr:14').status, 0);
  assert.equal(offer('t_7a022000 Wait 140', 'src/c.ts', 'topic: w3; waits: pr:140').status, 0);
  assert.equal(offer('t_7a023000 Wait task', 'src/d.ts', 'topic: w4; waits: task:t_7a020000').status, 0);
  assert.equal(offer('t_7a024000 Wait plan', 'src/e.ts', 'topic: w5; waits: run:docs/plans/2026-01-01-pivot.md').status, 0);
  assert.equal(offer('t_7a025000 Wait dangling', 'src/f.ts', 'topic: w6; waits: task:t_7a050000').status, 0);
  assert.equal(offer('t_7a026000 Theme', 'src/t.ts', 'topic: theme').status, 0);
  assert.equal(offer('t_7a027000 Theme docs', 'docs/t.md', 'topic: theme; waits: task:t_7a026000').status, 0);
  assert.equal(chip('t_7a026000 Theme', 'dismissed superseded: removed').status, 0);
  assert.equal(offer('t_7a028000 Cancelled plan', 'src/r.ts', 'topic: router; waits: run:docs/plans/2026-01-02-dropped.md').status, 0);

  let board = chips();
  assert.equal(board.status, 1);
  assert.match(board.stdout, /t_7a020000 {2}Wait merge {2}\[w1\] {2}no card/);
  assert.match(board.stdout, /t_7a021000 {2}Wait squash {2}\[w2\] {2}no card/);
  assert.match(board.stdout, /t_7a022000 {2}Wait 140 {2}\[w3\] {2}waits on pr:140 not merged/);
  assert.match(board.stdout, /fix t_7a025000's wait: task:t_7a050000 dangling/);
  assert.match(board.stdout, /fix t_7a027000's wait: task:t_7a026000 closed as dismissed superseded without its result/);
  assert.match(board.stdout, /fix t_7a028000's wait: run:docs\/plans\/2026-01-02-dropped\.md closed without its result/);

  assert.equal(chip('t_7a020000 Wait merge', 'started').status, 0);
  assert.equal(chip('t_7a020000 Wait merge', 'landed').status, 0);
  writeFileSync(join(root, 'docs/plans/2026-01-01-pivot.md'), '# Pivot\n\nStatus: executed\n');
  board = chips();
  assert.match(board.stdout, /t_7a023000 {2}Wait task {2}\[w4\] {2}no card/);
  assert.match(board.stdout, /t_7a024000 {2}Wait plan {2}\[w5\] {2}no card/);
});

test('chips detects stale plans (worktree log freshness, waitsOnOwner, one verdict per scope, chips sync, and trunk origin checks)', async () => {
  const { waitsOnOwner } = await import(pathToFileURL(join(HELPERS, 'status.mjs')).href);
  for (const s of ['planning: waiting on you to buy a phone', "awaiting the owner's answers", 'paused: held for release', 'on hold until you decide']) assert.equal(waitsOnOwner(s), true, s);
  for (const s of ["building: phase 1, on the owner's go", 'waiting: on the timing rerun', 'waiting: on rerun. You can read the draft meanwhile']) assert.equal(waitsOnOwner(s), false, s);

  const { LEDGER, batch, chip, chips, dir, helper, offer, root } = chipLedger({ config: { chips: { scopes: 'docs/scopes' }, pageTopic: { field: 'review_scopes' } }, files: { 'docs/scopes/parser.json': '{}\n' } });
  const plan = (name, status, scopes) => {
    const path = `docs/plans/${name}.md`;
    writeFileSync(join(root, path), `${scopes ? `---\nreview_scopes: [${scopes}]\n---\n\n` : ''}# ${name}\n\nStatus: ${status}\n`);
    return path;
  };
  const parser = plan('2026-01-01-parser', 'building: step 2', 'parser, lexer');
  writeFileSync(join(root, 'docs/plans/2026-01-01-parser.decisions.tsv'), LOG_HEADER + planRow(daysAgo(10)));
  commitAt(root, 10, parser, 'docs/plans/2026-01-01-parser.decisions.tsv');
  const cache = plan('2026-01-02-parser-cache', 'planning', 'parser');
  commitAt(root, 9, cache);
  const fresh = plan('2026-01-03-fresh', 'building: step 4');
  const freshLog = 'docs/plans/2026-01-03-fresh.decisions.tsv';
  writeFileSync(join(root, freshLog), LOG_HEADER + planRow(daysAgo(10)));
  commitAt(root, 10, fresh, freshLog);
  const recent = plan('2026-01-04-recent', 'building: step 1');
  commitAt(root, 6, recent);
  const phone = plan('2026-01-05-phone', 'planning: waiting on you to buy a phone');
  commitAt(root, 20, phone);
  const worktree = join(dir, 'wt');
  spawnSync('git', ['-C', root, 'worktree', 'add', '-q', '--detach', worktree]);
  appendFileSync(join(worktree, freshLog), planRow(daysAgo(1)));

  assert.equal(offer('t_7a004000 Fix lexer', 'src/l.ts', `topic: lexer; waits: run:${parser}`).status, 0);
  assert.equal(offer('t_7a005000 Fix cache', 'src/c.ts', `topic: cache; waits: run:${parser}, run:${cache}, pr:12`).status, 0);
  assert.equal(offer('t_7a009000 Fix docs', 'docs/d.md', `topic: docs; waits: run:${join(root, fresh)}`).status, 0);
  assert.equal(offer('t_7a00d000 Fix theme', 'src/t.ts', `topic: theme; waits: run:${recent}`).status, 0);
  assert.equal(offer('t_7a010000 Fix phone', 'src/p.ts', `topic: phone; waits: run:${phone}`).status, 0);

  let board = chips();
  assert.equal(board.status, 0);
  assert.match(board.stdout, /t_7a004000 {2}Fix lexer {2}\[lexer\] {2}waits on run:docs\/plans\/2026-01-01-parser\.md stale/);
  assert.match(board.stdout, /t_7a009000 {2}Fix docs {2}\[docs\] {2}waits on run:\S+2026-01-03-fresh\.md active/);
  assert.match(board.stdout, /t_7a00d000 {2}Fix theme {2}\[theme\] {2}waits on run:docs\/plans\/2026-01-04-recent\.md active/);
  assert.match(board.stdout, /Stale plans \(3\)\n {2}docs\/plans\/2026-01-05-phone\.md {2}idle 20 days {2}waits on you/);

  const offers = [...board.stdout.matchAll(/append chip "(t_[0-9a-f]+ [^"]+)" "([^"]+)" "([^"]+)" offered/gu)];
  assert.equal(offers.length, 1);
  assert.match(helper('append', LEDGER, 'chip', 't_7a019000 Fix parser', 'why', 'writes: src/x.ts; topic: x; priority: P2; via: stale', 'offered').stderr, /via: stale goes only on a kind: decide offer/);
  const [, decision, finding, tokens] = offers[0];
  assert.equal(helper('append', LEDGER, 'chip', decision, finding, tokens, 'offered').status, 0);
  const verdict = decision.split(' ')[0];
  assert.match(chips().stdout, new RegExp(`move t_7a005000's waits on stale plans to their fresh verdict: log updated with waits: task:${verdict}, pr:12`));
  assert.equal(batch([['t_7a004000 Fix lexer', 'updated', `waits: task:${verdict}`], ['t_7a005000 Fix cache', 'updated', `waits: task:${verdict}, pr:12`]]).status, 0);
  assert.match(chips().stdout, /Stale plans \(1\)\n {2}docs\/plans\/2026-01-05-phone\.md/);

  // chips sync omits card pass and keeps effort-changed cards, while withdrawing blocked cards.
  const pTask = 't_7a01f000 Fix guide (xhigh)';
  assert.equal(offer(pTask, 'docs/g.md', 'topic: guide; card: c1; session: s1').status, 0);
  assert.equal(chip(pTask, 'updated', 'effort: high').status, 0);
  assert.equal(offer('t_7a020000 Fix printer', 'src/q.ts', 'topic: printer; card: d1; session: s1').status, 0);
  assert.equal(chip('t_7a020000 Fix printer', 'updated', 'waits: pr:99').status, 0);
  const synced = chips('sync', '--session', 's1').stdout;
  assert.match(synced, /chips sync leaves out the card pass/);
  assert.doesNotMatch(synced, /withdraw t_7a01f000's card c1/);
  assert.match(synced, /withdraw t_7a020000's card d1: pr:99 not merged/);

  // Trunk reads stale plans from origin/next and freshness from uncommitted worktree log.
  const tr = linkedWorktree('trunk');
  const oldPath = 'docs/plans/2026-01-01-old.md';
  const oldLog = 'docs/plans/2026-01-01-old.decisions.tsv';
  writeFileSync(join(tr.root, oldPath), '# Old\n\nStatus: building: step 3\n');
  writeFileSync(join(tr.root, oldLog), LOG_HEADER);
  commitAt(tr.root, 12, oldPath, oldLog);
  spawnSync('git', ['-C', tr.root, 'update-ref', 'refs/remotes/origin/next', 'HEAD']);
  assert.equal(tr.offerHere('t_7a004000 Follow old', `writes: docs/guide.md; topic: follow; waits: run:${oldPath}`).status, 0);
  assert.match(tr.helper('chips').stdout, /waits on run:docs\/plans\/2026-01-01-old\.md stale/);
  mkdirSync(join(tr.worktree, 'docs/plans'), { recursive: true });
  writeFileSync(join(tr.worktree, oldLog), LOG_HEADER + planRow(daysAgo(0)));
  assert.match(tr.helper('chips').stdout, /waits on run:docs\/plans\/2026-01-01-old\.md active/);
});

test('stale-plan verdict routing handles folding, own-scope self-wait, loops, started runs, carded questions, and tier moves without looping', () => {
  // 1. Fold into open design question + own-scope design question drops self-wait.
  {
    const { batch, chip, chips, offer, stalePlan } = stalePlanLedger({}, { 'docs/scopes/lexer.json': '{}\n' });
    const p1 = stalePlan('2026-01-01-parser', 'parser');
    const p2 = stalePlan('2026-01-02-lexer', 'lexer');
    assert.equal(offer('t_7a035000 Settle parser', 'docs/scopes/parser.json', 'topic: review-parser; kind: decide; priority: P2; via: verdict; review-scope: parser').status, 0);
    assert.equal(offer('t_7a036000 Settle lexer', `${p2}, docs/scopes/lexer.json`, `topic: review-lexer; kind: decide; priority: P2; via: verdict; review-scope: lexer; waits: run:${p2}, pr:12`).status, 0);
    assert.equal(offer('t_7a004000 Fix parser', 'src/p.ts', `topic: p; waits: run:${p1}`).status, 0);
    assert.equal(offer('t_7a005000 Fix lexer', 'src/l.ts', `topic: l; waits: run:${p2}`).status, 0);
    const b1 = chips().stdout;
    assert.match(b1, /fold the stale plan docs\/plans\/2026-01-01-parser\.md into t_7a035000/);
    assert.match(b1, /move t_7a036000's waits on stale plans to their fresh verdict: log updated with waits: pr:12/);
    assert.equal(chip('t_7a035000 Settle parser', 'folded', `writes: ${p1}`).status, 0);
    assert.equal(batch([['t_7a004000 Fix parser', 'updated', 'waits: task:t_7a035000'], ['t_7a036000 Settle lexer', 'updated', 'waits: pr:12'], ['t_7a005000 Fix lexer', 'updated', 'waits: task:t_7a036000']]).status, 0);
    assert.doesNotMatch(chips().stdout, /Stale plans/);
  }

  // 2. Verdict waiting back + mutual-loop breaker + P0 move into later tier terminates cleanly.
  {
    const tiers = [{ name: 'core', paths: ['src/'] }, { name: 'feature' }, { name: 'late', scopes: ['late'] }];
    const { LEDGER, batch, chips, offer, stalePlan, timed } = stalePlanLedger({ tiers }, { 'docs/scopes/lexer.json': '{}\n', 'docs/scopes/late.json': '{}\n' });
    const parser = stalePlan('2026-01-01-parser', 'parser', 12);
    const lexer = stalePlan('2026-01-02-lexer', 'lexer', 10);
    const late = stalePlan('2026-01-03-late', 'late', 10);
    assert.equal(offer('t_7a045000 Decide parser', `${parser}, docs/scopes/parser.json`, `topic: review-parser; kind: decide; priority: P2; via: verdict; review-scope: parser; waits: run:${lexer}`).status, 0);
    assert.equal(offer('t_7a04b000 Decide lexer', `${lexer}, docs/scopes/lexer.json`, `topic: review-lexer; kind: decide; priority: P2; via: verdict; review-scope: lexer; waits: run:${parser}`).status, 0);
    assert.equal(offer('t_7a004000 Repair citations', 'src/c.ts', `topic: citations; priority: P0; repro: steps; waits: run:${late}`).status, 0);
    assert.equal(offer('t_7a043000 Decide late', `${late}, docs/scopes/late.json`, 'topic: review-late; kind: decide; priority: P2; via: stale; review-scope: late; session: none').status, 0);

    const board = timed(['chips']);
    assert.equal(board.signal, null);
    assert.match(board.stdout, /move t_7a04b000's waits on stale plans to their fresh verdict: log updated with waits: task:t_7a045000/);
    assert.match(board.stdout, /fix t_7a045000's wait: run:docs\/plans\/2026-01-02-lexer\.md is stale, and its verdict t_7a04b000 waits back/);
    assert.equal(batch([['t_7a04b000 Decide lexer', 'updated', 'waits: task:t_7a045000']]).status, 0);
    const moved = timed(['append', LEDGER, 'chip', 't_7a004000 Repair citations', 'why', 'waits: task:t_7a043000', 'updated']);
    assert.equal(moved.signal, null);
    assert.equal(moved.status, 0, moved.stderr);
  }

  // 3. Stale plan's own started run (holding scope topic) settled before verdict; carded question gets waiting verdict.
  {
    const { LEDGER, chip, chips, helper, offer, root, stalePlan } = stalePlanLedger({}, { 'docs/scopes/lexer.json': '{}\n' });
    const p1 = stalePlan('2026-01-01-parser', 'parser');
    const p2 = stalePlan('2026-01-02-lexer', 'lexer');
    assert.equal(offer('t_7a037000 Build parser plan', `${p1}, docs/scopes/parser.json`, 'topic: review-parser; kind: decide; priority: P2; via: verdict; review-scope: parser').status, 0);
    appendFileSync(join(root, LEDGER), `${daysAgo(12)}\tchip\tt_7a037000 Build parser plan\twhy\tsession: s1\tstarted\n`);
    assert.equal(offer('t_7a035000 Choose lexer API', 'docs/scopes/lexer.json', 'topic: review-lexer; kind: decide; priority: P2; via: verdict; review-scope: lexer; card: c1; session: s1').status, 0);
    assert.equal(offer('t_7a004000 Fix parser', 'src/p.ts', `topic: p; waits: run:${p1}`).status, 0);
    assert.equal(offer('t_7a005000 Fix lexer', 'src/l.ts', `topic: l; waits: run:${p2}`).status, 0);

    let board = chips().stdout;
    assert.match(board, /settle t_7a037000, the started run that wrote the stale plan docs\/plans\/2026-01-01-parser\.md/);
    const [, decision, finding, tokens] = board.match(/append chip "(t_[0-9a-f]+ [^"]+)" "([^"]+)" "([^"]+)" offered/) ?? [];
    assert.match(tokens ?? '', /; waits: task:t_7a035000; session: none$/);
    assert.equal(helper('append', LEDGER, 'chip', decision, finding, tokens, 'offered').status, 0);
    assert.equal(chip('t_7a037000 Build parser plan', 'dismissed stopped').status, 0);
    board = chips().stdout;
    assert.match(board, /offer one verdict on review scope parser for the stale plan docs\/plans\/2026-01-01-parser\.md/);
  }
});

test('chips handles missing ledger, id generation, raced duplicate design questions, and started outside-checkout overlaps', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', { files: { 'docs/plans/.keep': '' } });
  const chips = (...args) => run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'chips', ...args], root);
  assert.match(chips().stderr, /No ledger at docs\/plans\/suggested-tasks\.decisions\.tsv yet/);
  assert.equal(chips('docs/plans/missing.decisions.tsv').status, 2);
  assert.match(chips('id').stdout, /^t_[0-9a-f]{8}\n$/u);
  assert.match(chips('--fetch', 'id').stdout, /^t_[0-9a-f]{8}\n$/u);

  const rows = [
    ['t_7a00a000 Design export (xhigh)', `writes: src/export, ${join(dir, 'shared/export')}; topic: export; kind: decide`, 'offered'],
    ['t_7a00a000 Design export (xhigh)', 'started', 'started'],
    ['t_7a01f000 Fix core', `writes: src/export/core.ts, ${join(dir, 'shared/export/core.md')}; topic: export`, 'offered'],
    ['t_7a01f000 Fix core', 'started', 'started'],
    ['t_7a00f000 Now: Rename probe', 'writes: tooling/probe.mjs', 'offered'],
  ];
  writeFileSync(join(root, 'docs/plans/suggested-tasks.decisions.tsv'), `ts\tphase\tdecision\twhy\tevidence\tresult\n${rows.map(([d, e, r]) => ['2026-01-01T10:00:00Z', 'chip', d, 'why', e, r].join('\t')).join('\n')}\n`);
  const listed = chips();
  assert.equal(listed.status, 0, listed.stderr);
  assert.match(listed.stdout, /Started \(2\)/);
  assert.match(listed.stdout, /Unmigrated \(1\)\n {2}t_7a00f000 {2}Rename probe\n/);
  assert.match(listed.stderr, /t_7a00a000 and t_7a01f000 are both started on an overlapping path outside this checkout/);

  const raced = 'docs/plans/raced.decisions.tsv';
  writeFileSync(join(root, raced), `ts\tphase\tdecision\twhy\tevidence\tresult\n${['t_7a019000 Decide badge', 't_7a01a000 Decide link'].map((d) => ['2026-01-01T10:00:00Z', 'chip', d, 'why', 'writes: README.md; topic: badge; kind: decide', 'offered'].join('\t')).join('\n')}\n`);
  const folded = chips(raced);
  assert.equal(folded.status, 1);
  assert.match(folded.stdout, /fold topic badge: t_7a019000 and t_7a01a000 are both open design questions/);
});
