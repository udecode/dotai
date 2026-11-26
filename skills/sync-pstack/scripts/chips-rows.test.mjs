import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CONFIG, commit, project, read, sandbox } from './test-sandbox.mjs';
import { chipLedger, commitAt, daysAgo, ledgerRows, linkedWorktree, LOG_HEADER, planRow, stalePlanLedger, triagedLedger } from './test-ledger.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HELPERS = join(HERE, '../assets/pstack');

test('decisions-check keeps chip rows in the project ledger, out of run logs', () => {
  const { appendTo, offer } = chipLedger();
  const misplaced = appendTo('docs/plans/2026-01-01-fix.decisions.tsv', 'chip', 't_7a004000 Fix the stale badge', 'writes: README.md; topic: docs', 'offered');
  assert.equal(misplaced.status, 1, 'a chip row in a run log');
  assert.match(misplaced.stderr, /chip rows go in the project's ledger docs\/plans\/suggested-tasks\.decisions\.tsv/);
  assert.equal(offer('t_7a004000 Fix the stale badge').status, 0);
});

test('decisions-check leaves the chip rows an older run log holds to that log', () => {
  const { root, run } = chipLedger();
  const log = 'docs/plans/2026-01-01-fix.decisions.tsv';
  const rows = [
    ['chip', 't_7a004000 Now: Fix the stale badge', 'why', 'writes: the README badge', 'offered'],
    ['chip', 't_7a004000 Now: Fix the stale badge', 'why', 'retitled as After', 'dismissed retagged t_7a00a000'],
  ];
  writeFileSync(join(root, log), `ts\tphase\tdecision\twhy\tevidence\tresult\n${rows.map((row) => ['2026-01-01T10:00:00Z', ...row].join('\t')).join('\n')}\n`);
  const checked = run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), log], root);
  assert.equal(checked.status, 0, checked.stderr);
});

test('decisions-check takes a chip offer only with a plain title, a topic and the paths it writes', () => {
  const { LEDGER, appendTo, chip, helper, offer } = chipLedger();
  assert.equal(offer('t_7a004000').status, 1, 'an id with no title');
  for (const tagged of ['t_7a004000 Now: Fix the stale badge', 't_7a004000 After: Fix the stale badge', 't_7a004000 [P1] Fix the stale badge', 't_7a004000 Fix the stale badge (high)']) {
    assert.match(offer(tagged).stderr, /no title says Now: or After:/, tagged);
  }
  assert.match(offer('t_7a004000 Fix the stale badge', 'README.md', 'the badge links a dead page').stderr, /names its owner question as "topic: <word>"/, 'an offer with no topic');
  assert.match(offer('t_7a004000 Fix the stale badge', 'README.md', 'topic: Docs Pages').stderr, /lowercase kebab-case/, 'a topic that is not one kebab-case word');
  assert.match(offer('t_7a004000 Fix the stale badge', 'README.md', 'topic: docs; waits: after the release').stderr, /waits: takes pr:<number>, task:<id> or run:/, 'a wait written as prose');
  const unscoped = chip('t_7a004000 Fix the stale badge', 'offered', 'topic: docs');
  assert.equal(unscoped.status, 1, 'an offer with no write set');
  assert.match(unscoped.stderr, /writes: <path>, <path>/);
  assert.match(offer('t_7a004000 Fix the stale badge', 'the README badge').stderr, /writes: <path>, <path>/, 'a write set that is not paths');
  assert.equal(offer('t_7a004000 Fix the stale badge', 'README.md', 'topic: docs; waits: pr:12, task:t_7a050000, run:docs/plans/x.md; kind: fix').status, 0);
  assert.match(offer('t_7a004000 Fix the stale badge').stderr, /already offered/, 'an id offered twice');
  assert.match(appendTo(LEDGER, 'build', 'ship the parser', 'scope: fixtures', 'offered').stderr, /only in a chip row/, 'an offered result outside a chip row');
  assert.equal(helper(LEDGER).status, 0);
});

test('decisions-check takes a new chip offer only under the task id chips id prints', () => {
  const { LEDGER, chip, helper, offer, root } = chipLedger();
  const title = "Keep a document value's attached records when readDocumentRecord drops an undefined field";
  for (const decision of [title, `task_a1 ${title}`, `t_8cb2e81 ${title}`, `T_8CB2E811 ${title}`]) {
    const refused = offer(decision);
    assert.equal(refused.status, 1, decision);
    assert.match(refused.stderr, /a new offer's decision is "<task id> <title>", and "[^"]+" is no task id; put the id that "node \.agents\/pstack\/decisions-check\.mjs chips id" prints, such as t_[0-9a-f]{8}, before the title/, decision);
  }
  assert.match(chip(title, 'dismissed dup t_8cb2e811').stderr, /Keep has no offered chip row before this one/, 'a later row on a title-only decision');
  assert.equal(offer(`t_8cb2e811 ${title}`).status, 0, 'the id chips id prints');
  appendFileSync(join(root, LEDGER), `2026-01-01T00:00:00Z\tchip\ttask_b1 Fix the old badge\twhy\twrites: README.md; topic: docs; priority: P1; repro: steps\toffered\n`);
  assert.equal(chip('task_b1 Fix the old badge', 'updated', 'topic: badges').status, 0, 'a later row on a task offered under an old id');
  assert.equal(helper(LEDGER).status, 0, 'the whole-log check keeps rows offered under an old id');
});

test('decisions-check takes a new chip finding only when this checkout holds the evidence it cites', () => {
  const { LEDGER, helper, root } = chipLedger();
  const log = 'docs/plans/artifacts/probe/base-a1.log';
  const offerCiting = (finding) => helper('append', LEDGER, 'chip', 't_7a004000 Fix the stale badge', finding, 'writes: README.md; topic: docs; priority: P3; via: verdict', 'offered');
  const missing = offerCiting(`the badge links a dead page (${log})`);
  assert.equal(missing.status, 1, 'an offer citing a log only another worktree holds');
  assert.match(missing.stderr, /the finding cites docs\/plans\/artifacts\/probe\/base-a1\.log, which this checkout lacks/);
  mkdirSync(join(root, 'docs/plans/artifacts/probe'), { recursive: true });
  writeFileSync(join(root, log), 'exit=1\n');
  assert.equal(offerCiting(`the badge links a dead page (${log})`).status, 0, 'an offer citing a log the checkout holds');
  const fold = (finding) => helper('append', LEDGER, 'chip', 't_7a004000 Fix the stale badge', finding, 'kind: decide; effort: xhigh', 'folded');
  assert.match(fold('the footer badge fails too (docs/plans/artifacts/probe/footer-a1.log)').stderr, /cites docs\/plans\/artifacts\/probe\/footer-a1\.log, which this checkout lacks/, 'a folded finding citing a missing log');
  assert.equal(fold('the footer badge fails too').status, 0, 'a folded finding that cites no file');
  rmSync(join(root, log));
  assert.equal(helper(LEDGER).status, 0, 'the whole-log check leaves an older offer whose evidence went missing');
});

test('decisions-check takes a chip row whose writes: names a run-directory path the task will create, and checks every other path its evidence cites', () => {
  const { LEDGER, appendTo, chip, helper, offer, root } = chipLedger();
  const accepted = offer('t_7a004000 Render the state-machine page', 'docs/plans/artifacts/run/page/, src/page.ts', 'topic: pages');
  assert.equal(accepted.status, 0, `an offer that names the folder its page render will write: ${accepted.stderr}`);
  const started = chip('t_7a004000 Render the state-machine page', 'started', 'writes: docs/plans/artifacts/run/notes.md; session: s1');
  assert.equal(started.status, 0, `a started row that names a run file before its first write: ${started.stderr}`);
  assert.match(offer('t_7a009000 Fix the badge', 'README.md', 'topic: docs; priority: P1; repro: docs/plans/artifacts/run/gone-a1.log fails').stderr, /evidence cites docs\/plans\/artifacts\/run\/gone-a1\.log, which does not exist/, 'a missing path outside writes:');
  assert.match(offer('t_7a009000 Fix the badge', 'README.md', 'topic: docs; priority: P1; repro: the run writes: docs/plans/artifacts/run/gone-a2.log').stderr, /gone-a2\.log, which does not exist/, 'writes: inside repro prose');
  assert.match(appendTo('docs/plans/2026-01-01-fix.decisions.tsv', 'build', 'fix the badge', 'scope: badge; writes: docs/plans/artifacts/run/gone-a3.log', 'verified').stderr, /gone-a3\.log, which does not exist/, 'writes: in a run log row');
  const chipLine = (evidence, result) => ['2026-11-07T00:00:00Z', 'chip', 't_7a004000 Render the state-machine page', 'why', evidence, result].join('\t');
  writeFileSync(join(root, 'docs/plans/2026-01-02-fix.decisions.tsv'), `ts\tphase\tdecision\twhy\tevidence\tresult\n${chipLine('writes: docs/plans/artifacts/run/gone-a4.log; topic: pages', 'offered')}\n`);
  assert.match(helper('docs/plans/2026-01-02-fix.decisions.tsv').stderr, /gone-a4\.log, which does not exist/, 'a chip row outside the ledger');
  assert.equal(helper(LEDGER).status, 0, 'the ledger holds only rows it takes');
  appendFileSync(join(root, LEDGER), `${chipLine('writes: docs/plans/artifacts/run/gone-a5.log; commit: abc1234', 'landed')}\n`);
  assert.match(helper(LEDGER).stderr, /gone-a5\.log, which does not exist/, 'a landed row, whose move takes no writes:');
});

test('chips brief forces the Codex handoff for a card carded with codex: always or a project that sets it', () => {
  const { LEDGER, chip, helper, offer, root } = chipLedger();
  const forced = /forces the Codex handoff/;
  assert.equal(offer('t_7a004000 Fix the stale badge').status, 0);
  assert.doesNotMatch(helper('chips', 'brief', 't_7a004000').stdout, forced, 'a task with no card');
  assert.match(chip('t_7a004000 Fix the stale badge', 'carded', 'card: t_7a00d000; session: s1; codex: sometimes').stderr, /codex: is always/, 'a mark other than always');
  assert.equal(chip('t_7a004000 Fix the stale badge', 'carded', 'card: t_7a00d000; session: s1; codex: always').status, 0);
  assert.match(helper('chips', 'brief', 't_7a004000').stdout, forced, 'a card carded with codex: always');
  assert.equal(chip('t_7a004000 Fix the stale badge', 'uncarded', 'card: t_7a00d000').status, 0);
  assert.doesNotMatch(helper('chips', 'brief', 't_7a004000').stdout, forced, 'the mark leaves with its card');
  writeFileSync(join(root, '.agents/pstack.json'), JSON.stringify({ branch: 'next', chips: { codex: 'always' } }));
  assert.match(helper('chips', 'brief', 't_7a004000').stdout, forced, 'a project whose config sets chips.codex');
  assert.equal(helper(LEDGER).status, 0);
});

test('in a trunk project a linked worktree writes the main checkout ledger, cites its run directory and briefs a card to land through land.mjs', () => {
  const { LEDGER, dir, helper, offerHere, outside, root, worktree } = linkedWorktree('trunk');
  const offered = offerHere('t_7a004000 Fix the stale badge', 'writes: README.md; topic: docs; owns: ci:new');
  assert.equal(offered.status, 0, offered.stderr);
  assert.match(read(root, LEDGER), /t_7a004000 Fix the stale badge/, 'the row goes to the main checkout ledger');
  assert.ok(!existsSync(join(worktree, LEDGER)), 'no commit holds the ledger, so the worktree has no copy');
  assert.match(helper('chips').stdout, /t_7a004000 {2}Fix the stale badge/, 'the board reads the main checkout ledger');
  const log = 'docs/plans/2026-01-01-fix.decisions.tsv';
  const red = helper('append', log, 'verify', 'Record the base failure', 'why', 'base-red: ci:new; proof: none', 'partial, fails on base');
  assert.equal(red.status, 0, `a base-red row finds the owner in the main checkout ledger: ${red.stderr}`);
  const brief = helper('chips', 'brief', 't_7a004000').stdout;
  assert.match(brief, /land the task yourself from it with node \.agents\/pstack\/land\.mjs/);
  assert.match(brief, /scan\.mjs --landed <your worktree's absolute path>\. When it exits 0/, 'the landed scan checks the work reached the checkout');
  assert.match(brief, /holds the change\. Last, stop each server/, 'the landing steps run before the review title');
  assert.match(brief, /carry the outcome to its next \/chips\. Once the task has landed or its PR is open, where your runtime can rename this session, title your session 👀 <name>, with no count, in the same message as your last other call, such as the scan\.mjs --landed check, and after that call, as [^\n]*\/\.agents\/pstack\/rules\/title\.md says[^\n]*\. When a later message has you work again, title the session 🚧 <name> before your first step\./, 'a landed card session takes the review title in its last message, after the landed check, and drops it when it works again');
  assert.doesNotMatch(brief, /git diff --cached|apply --check|\/wt\b|cd \/|outside the checkout/, 'no patch landing, checkout cd, worktree path or outside-path wait');
  mkdirSync(join(root, 'docs/plans/artifacts/fix'), { recursive: true });
  writeFileSync(join(root, 'docs/plans/artifacts/fix/send-a1.log'), 'exit=0\n');
  const cited = helper('append', log, 'verify', 'Prove the send', 'why', 'proof: docs/plans/artifacts/fix/send-a1.log', 'partial, one width ran');
  assert.equal(cited.status, 0, cited.stderr);
  assert.ok(existsSync(join(worktree, log)), 'a run log stays in the worktree');
  const missing = helper('append', log, 'verify', 'Prove the reply', 'why', 'proof: docs/plans/artifacts/fix/reply-a1.log', 'partial, no run');
  assert.equal(missing.status, 1, 'a path neither checkout holds');
  writeFileSync(join(worktree, 'docs/plans/2026-01-01-fix.md'), '# Fix\n\nStatus: building\n');
  mkdirSync(join(dir, 'replay'), { recursive: true });
  assert.equal(helper('append', join(dir, 'replay', 'suggested-tasks.decisions.tsv'), 'trail', 'Inspect the replay', 'why', 'proof: none', 'recorded').status, 0);
  assert.match(read(dir, 'replay/suggested-tasks.decisions.tsv'), /Inspect the replay/, 'an explicit log path keeps its destination');
  assert.doesNotMatch(read(root, LEDGER), /Inspect the replay/);
  for (const [decision, topic] of [['t_7a00a000 Edit the shared notes', 'notes-a'], ['t_7a00f000 Rewrite the shared notes', 'notes-b']]) assert.equal(offerHere(decision, `writes: ${outside('notes.md')}; topic: ${topic}`).status, 0);
  assert.equal(offerHere('t_7a012000 Follow the fix', 'writes: docs/guide.md; topic: follow; waits: run:docs/plans/2026-01-01-fix.md').status, 0);
  assert.equal(offerHere('t_7a017000 Follow a typo', 'writes: docs/typo.md; topic: typo; waits: run:docs/plans/2026-01-01-nope.md').status, 0);
  const board = helper('chips').stdout;
  assert.doesNotMatch(board, /queued behind|outside this checkout/, 'trunk drops the waits on paths outside the checkout');
  assert.match(board, /run:docs\/plans\/2026-01-01-fix\.md not landed/, 'a plan only a worktree holds has not landed');
  assert.match(board, /run:docs\/plans\/2026-01-01-nope\.md dangling, no such plan/);
  writeFileSync(join(root, 'docs/plans/2026-01-01-fix.md'), '# Fix\n\nStatus: done\n');
  spawnSync('git', ['-C', root, 'add', 'docs/plans/2026-01-01-fix.md']);
  commit(root, 'land the fix');
  spawnSync('git', ['-C', root, 'update-ref', 'refs/remotes/origin/next', 'HEAD']);
  assert.doesNotMatch(helper('chips').stdout, /2026-01-01-fix\.md/, "the wait clears once origin's branch holds the done plan");
});

test('in a trunk project append takes a review scope whose file the calling worktree holds and the main checkout lacks', () => {
  const { offerHere, root, worktree } = linkedWorktree('trunk');
  writeFileSync(join(root, '.agents/pstack.json'), JSON.stringify({ branch: 'next', delivery: 'trunk', chips: { scopes: 'scopes' } }));
  for (const [checkout, scope] of [[root, 'editor'], [worktree, 'ink']]) {
    mkdirSync(join(checkout, 'scopes'));
    writeFileSync(join(checkout, 'scopes', `${scope}.json`), '{}');
  }
  const ahead = offerHere('t_7a004000 Draw on text', 'writes: a.md; topic: a; review-scope: ink');
  assert.equal(ahead.status, 0, `a scope the main checkout has not pulled yet, or one this run adds: ${ahead.stderr}`);
  assert.equal(offerHere('t_7a009000 Fix the caret', 'writes: b.md; topic: b; review-scope: editor').status, 0, 'a scope only the main checkout holds');
  const typo = offerHere('t_7a00d000 Fix the pen', 'writes: c.md; topic: c; review-scope: inkk');
  assert.equal(typo.status, 1, 'a scope neither checkout holds');
  assert.match(typo.stderr, /review-scope: inkk is no review scope in scopes/);
});

test('outside trunk delivery a linked worktree keeps its own ledger and the waits on paths outside the checkout', () => {
  const { LEDGER, helper, offerHere, outside, root, worktree } = linkedWorktree('push');
  assert.equal(offerHere('t_7a004000 Fix the stale badge', 'writes: README.md; topic: docs').status, 0);
  assert.match(read(worktree, LEDGER), /t_7a004000/, 'the row goes to the ledger of the checkout the command runs in');
  assert.doesNotMatch(read(root, LEDGER), /t_7a004000/);
  for (const [decision, topic] of [['t_7a00a000 Edit the shared notes', 'notes-a'], ['t_7a00f000 Rewrite the shared notes', 'notes-b']]) assert.equal(offerHere(decision, `writes: ${outside('notes.md')}; topic: ${topic}`).status, 0);
  assert.match(helper('chips').stdout, /queued behind t_7a00a000/);
});

test('decisions-check takes later rows for a task offered under an old-form title', () => {
  const { LEDGER, chip, root } = chipLedger();
  const old = 't_7a004000 After: Fix the stale badge (high)';
  writeFileSync(join(root, LEDGER), `ts\tphase\tdecision\twhy\tevidence\tresult\n${['2026-01-01T10:00:00Z', 'chip', old, 'why', 'writes: README.md', 'offered'].join('\t')}\n`);
  assert.match(chip(old, 'updated', 'topic: docs').stderr, /t_7a004000 has no topic yet, so this row migrates it/, 'a migration row without its waits');
  assert.equal(chip(old, 'updated', 'topic: docs; waits: none').status, 0, 'a migration row');
  const started = chip(old, 'started');
  assert.equal(started.status, 0, started.stderr);
  assert.equal(chip(old, 'landed').status, 0);
});

test('decisions-check keeps a task under one id: no new gone or replaced rows', () => {
  const { LEDGER, chip, chips, offer, root } = chipLedger();
  assert.equal(offer('t_7a004000 Fix the stale badge').status, 0);
  assert.equal(offer('t_7a00f000 Rewrite the install guide', 'docs/install.md').status, 0);
  for (const reason of ['gone', 'replaced t_7a00f000']) {
    assert.match(chip('t_7a004000 Fix the stale badge', `dismissed ${reason}`).stderr, /a task keeps its id for good: log uncarded/, `a new dismissed ${reason} row`);
  }
  assert.equal(chip('t_7a004000 Fix the stale badge', 'uncarded').status, 0, 'a card that left the queue');
  assert.match(chips().stdout, /Ready, P1 \(2\)\n {2}t_7a004000 {2}Fix the stale badge {2}\[docs\] {2}no card/, 'the task stays open and ready after its card left');
  const old = 't_7a00a000 Fix the release notes';
  writeFileSync(join(root, LEDGER), `${readFileSync(join(root, LEDGER), 'utf8')}${[['offered', 'writes: CHANGES.md; topic: docs; priority: P1; repro: steps'], ['dismissed gone', 'the queue pushed it out']].map(([result, evidence]) => ['2026-01-01T10:00:00Z', 'chip', old, 'why', evidence, result].join('\t')).join('\n')}\n`);
  spawnSync('git', ['-C', root, 'add', LEDGER]);
  spawnSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'ledger']);
  const reopened = chip(old, 'reopened');
  assert.equal(reopened.status, 0, `a task an older run closed as gone comes back: ${reopened.stderr}`);
  assert.match(chips().stdout, /t_7a00a000 {2}Fix the release notes/);
  assert.match(chip('t_7a004000 Fix the stale badge', 'reopened').stderr, /t_7a004000 is offered, so it cannot be reopened/, 'only a gone task reopens');
  assert.equal(chip('t_7a00f000 Rewrite the install guide', 'dismissed declined: the owner dismissed its card').status, 0, 'a card the owner dismissed closes its task');
  assert.doesNotMatch(chips().stdout, /t_7a00f000/);
  assert.match(chip('t_7a00f000 Rewrite the install guide', 'reopened').stderr, /t_7a00f000 is dismissed declined, so it cannot be reopened/, 'a declined task stays closed');
});

test('decisions-check reopens a dup the owner calls separate work and takes it off the kept task', () => {
  const { chip, chips, offer } = chipLedger();
  const badge = 't_7a004000 Fix the stale badge';
  assert.equal(offer(badge).status, 0);
  assert.equal(offer('t_7a00f000 Rewrite the install guide', 'docs/install.md').status, 0);
  assert.equal(chip(badge, 'dismissed dup t_7a00f000: the guide rewrite fixes the badge too').status, 0);
  assert.match(chips('brief', 't_7a00f000').stdout, /Also covers:\n- t_7a004000 /);
  const reopened = chip(badge, 'reopened', 'the owner says the badge is separate work');
  assert.equal(reopened.status, 0, reopened.stderr);
  assert.doesNotMatch(chips('brief', 't_7a00f000').stdout, /- t_7a004000 /, 'the kept task no longer covers it');
  assert.match(chips().stdout, /t_7a004000 {2}Fix the stale badge/, 'the reopened task is back on the board');
  const apart = chip(badge, 'apart', 'from: t_7a00f000');
  assert.equal(apart.status, 0, apart.stderr);
});

test('decisions-check takes a later chip row only for a task in the state it leaves, and a dup only of a live task', () => {
  const { chip, offer } = chipLedger();
  assert.equal(offer('t_7a004000 Fix the stale badge').status, 0);
  assert.equal(offer('t_7a00f000 Rewrite the install guide', 'docs/install.md').status, 0);
  assert.equal(chip('t_7a004000 Fix the stale badge', 'dismissed').status, 1, 'a dismissal with no reason');
  assert.equal(chip('t_7a004000 Fix the stale badge', 'dismissed later').status, 1, 'a reason outside the list');
  assert.match(chip('t_7a050000 Fix the stale badge', 'dismissed done').stderr, /t_7a050000 has no offered chip row/, 'a task never offered');
  assert.equal(chip('t_7a004000 Fix the stale badge', 'dismissed dup t_7a036000').status, 1, 'a duplicate of a task never offered');
  assert.match(chip('t_7a004000 Fix the stale badge', 'dismissed dup t_7a004000').stderr, /t_7a004000 must be another task/, 'a duplicate of itself');
  assert.match(chip('t_7a004000 Fix the badge', 'dismissed done').stderr, /every later row repeats that decision/, 'a later row that renames the task');
  assert.match(chip('t_7a004000 Fix the stale badge', 'updated', 'because').stderr, /names what changes/, 'an update that changes nothing');
  assert.equal(chip('t_7a004000 Fix the stale badge', 'dismissed dup t_7a00f000: the guide rewrite fixes the badge too').status, 0);
  assert.match(chip('t_7a004000 Fix the stale badge', 'started').stderr, /t_7a004000 is dismissed dup, so it cannot be started/, 'a closed task that starts');
  assert.match(chip('t_7a00f000 Rewrite the install guide', 'dismissed dup t_7a004000').stderr, /t_7a004000 must be another task the ledger holds as offered;/, 'a duplicate of a closed task');
});

test('decisions-check closes a started task by landing or by a dismissal that fits a started task', () => {
  const { chip, offer } = chipLedger();
  const badge = 't_7a004000 Fix the stale badge';
  assert.equal(offer(badge).status, 0);
  assert.equal(chip(badge, 'started').status, 0);
  assert.equal(chip(badge, 'dismissed done').status, 1, 'done for a started task, which lands instead');
  assert.match(chip(badge, 'uncarded').stderr, /t_7a004000 is started, so it cannot be uncarded/, 'a card row for a task the owner started');
  assert.equal(chip(badge, 'dismissed stopped: the owner closed the session').status, 0);
  const ledger = 't_7a00a000 Design the export ledger (xhigh)';
  assert.equal(offer(ledger, 'src/export', 'topic: export; kind: decide').status, 0);
  assert.match(chip(ledger, 'dismissed stopped').stderr, /t_7a00a000 is offered, so it cannot be dismissed stopped/, 'stopped for a task nobody started');
  assert.equal(chip(ledger, 'started').status, 0);
  for (const reason of ['superseded', 'dup t_7a004000', 'done']) {
    assert.match(chip(ledger, `dismissed ${reason}`).stderr, /t_7a00a000 is started, so it cannot be dismissed/, `${reason} for a task whose session may still be writing`);
  }
  assert.equal(offer('t_7a017000 Add a CSV export', 'src/export/csv.ts').status, 0);
  assert.match(chip('t_7a017000 Add a CSV export', 'dismissed dup t_7a00a000').stderr, /t_7a00a000 is started, and a dup moves work only into an offered task; keep t_7a017000 open, log updated with its waits plus task:t_7a00a000, and log dismissed done once t_7a00a000 lands with the fix/, 'an offered task a started task covers');
  assert.equal(chip('t_7a017000 Add a CSV export', 'updated', 'waits: task:t_7a00a000').status, 0, 'the route the refusal names');
});

test('a started row may add a project path another started task writes, but not a path outside the checkout', () => {
  const { chip, offer, outside } = chipLedger();
  const reader = 't_7a004000 Fix the reader';
  const writer = 't_7a00a000 Fix the writer';
  assert.equal(offer(reader, `src/a.ts, ${outside('rule.md')}`).status, 0);
  assert.equal(offer(writer, 'src/b.ts').status, 0);
  assert.equal(chip(reader, 'started').status, 0);
  assert.equal(chip(writer, 'started').status, 0);
  assert.equal(chip(writer, 'started', 'writes: src/a.ts').status, 0, 'each card session edits project paths in its own worktree');
  assert.match(chip(writer, 'started', `writes: ${outside('rule.md')}`).stderr, /t_7a00a000 cannot add a path outside this checkout that t_7a004000, also started, writes/, "a widening into another repository a running session edits in place");
  assert.equal(chip(writer, 'started', `writes: ${outside('other.md')}`).status, 0, 'a widening onto a free outside path');
});

test('decisions-check refuses a write path that is a glob, quoted or ends in punctuation', () => {
  const { offer } = chipLedger();
  for (const path of ['packages/*/src', 'src/**', '`docs/x.md`', 'README.md.', '"docs/x.md"']) {
    assert.match(offer('t_7a004000 Fix the stale badge', path).stderr, /no whitespace, glob, quote/, path);
  }
});

test('chips names the open tasks that share a ready task\'s paths, compared by where they point, and holds back only a path outside the checkout', () => {
  const { chips, offer, outside, root } = chipLedger();
  mkdirSync(join(root, 'deep/dir'), { recursive: true });
  writeFileSync(join(root, 'deep/x.txt'), 'deep');
  writeFileSync(join(root, 'x.txt'), 'top');
  symlinkSync(join(root, 'deep/dir'), join(root, 'link'));
  assert.equal(offer('t_7a004000 Fix the stale badge').status, 0);
  assert.equal(offer('t_7a005000 Fix the deep file', 'deep/x.txt').status, 0);
  const aliases = ['./README.md', 'docs/../README.md', join(root, 'README.md'), 'readme.md', 'link/../x.txt'];
  for (const [index, alias] of aliases.entries()) assert.equal(offer(`t_7a00${(8 + index).toString(16)}000 Rewrite the file`, alias).status, 0, alias);
  assert.equal(offer('t_7a00d000 Fix the top file', 'x.txt').status, 0);
  const board = chips().stdout;
  assert.match(board, /Ready, P1 \(8\)/, 'a shared project path holds no task back');
  for (const index of aliases.keys()) assert.match(board, new RegExp(`t_7a00${(8 + index).toString(16)}000 {2}Rewrite the file {2}\\[docs\\] {2}no card {2}shares paths with [^\\n]*t_7a00[45]000`), aliases[index]);
  assert.match(board, /t_7a00c000 {2}Rewrite the file {2}\[docs\] {2}no card {2}shares paths with t_7a005000\n/, 'the kernel follows link before .. steps out of it');
  assert.match(board, /t_7a00d000 {2}Fix the top file {2}\[docs\] {2}no card\n/, 'the top-level file is another file than deep/x.txt');
  assert.match(board, /card t_7a008000: it can start and has no card; first judge whether it needs the result of another open task, starting with t_7a004000, t_7a009000, t_7a00a000, t_7a00b000, which write its paths, or of an open design question/);
  assert.equal(offer('t_7a010000 Fix the shared rule', outside('rule.md')).status, 0);
  assert.equal(offer('t_7a011000 Reword the shared rule', outside('../shared/rule.md')).status, 0);
  assert.match(chips().stdout, /t_7a011000 {2}Reword the shared rule {2}\[docs\] {2}waits on queued behind t_7a010000, which writes the same paths outside this checkout/, 'another repository is edited in place');
});

test('chips clears each kind of wait without a new row: a merged PR, a closed task, a done plan', () => {
  const { chip, chips, merge, offer, root } = chipLedger();
  merge('Merge pull request #12 from a/badge');
  merge('Fix the parser (#14)');
  writeFileSync(join(root, 'docs/plans/2026-01-01-pivot.md'), '# Pivot\n\nStatus: building: the ledger\n');
  assert.equal(offer('t_7a004000 Fix the stale badge', 'README.md', 'topic: docs; waits: pr:12').status, 0);
  assert.equal(offer('t_7a005000 Fix the parser', 'src/p.ts', 'topic: parser; waits: pr:14').status, 0);
  assert.equal(offer('t_7a006000 Fix the printer', 'src/q.ts', 'topic: parser; waits: pr:140').status, 0);
  assert.equal(offer('t_7a009000 Fix the guide', 'docs/guide.md', 'topic: docs; waits: task:t_7a004000').status, 0);
  assert.equal(offer('t_7a00d000 Fix the lexer', 'src/l.ts', 'topic: lexer; waits: run:docs/plans/2026-01-01-pivot.md').status, 0);
  assert.equal(offer('t_7a010000 Fix the linter', 'src/n.ts', 'topic: lint; waits: task:t_7a050000').status, 0);
  let board = chips();
  assert.match(board.stdout, /t_7a004000 {2}Fix the stale badge {2}\[docs\] {2}no card/, 'a merge commit for its PR');
  assert.match(board.stdout, /t_7a005000 {2}Fix the parser {2}\[parser\] {2}no card/, 'a squash commit for its PR');
  assert.match(board.stdout, /t_7a006000 {2}Fix the printer {2}\[parser\] {2}waits on pr:140 not merged/, '#14 is not #140');
  assert.match(board.stdout, /t_7a009000 {2}Fix the guide {2}\[docs\] {2}waits on task:t_7a004000 offered/);
  assert.match(board.stdout, /t_7a00d000 {2}Fix the lexer {2}\[lexer\] {2}waits on run:docs\/plans\/2026-01-01-pivot\.md active/);
  assert.match(board.stdout, /fix t_7a010000's wait: task:t_7a050000 dangling/, 'a wait on a task the ledger never held');
  assert.equal(board.status, 1, 'a dangling wait is a problem');
  assert.equal(chip('t_7a004000 Fix the stale badge', 'started').status, 0);
  assert.equal(chip('t_7a004000 Fix the stale badge', 'landed').status, 0);
  writeFileSync(join(root, 'docs/plans/2026-01-01-pivot.md'), '# Pivot\n\nStatus: executed\n');
  board = chips();
  assert.match(board.stdout, /t_7a009000 {2}Fix the guide {2}\[docs\] {2}no card/, 'the task it waited on landed');
  assert.match(board.stdout, /t_7a00d000 {2}Fix the lexer {2}\[lexer\] {2}no card/, 'the plan it waited on is executed');
  assert.equal(offer('t_7a014000 Fix the theme', 'src/t.ts', 'topic: theme').status, 0);
  assert.equal(offer('t_7a015000 Fix the theme docs', 'docs/theme.md', 'topic: theme; waits: task:t_7a014000').status, 0);
  assert.equal(chip('t_7a014000 Fix the theme', 'dismissed superseded: the theme was removed').status, 0);
  writeFileSync(join(root, 'docs/plans/2026-01-02-dropped.md'), '# Dropped\n\nStatus: cancelled: the owner dropped it\n');
  assert.equal(offer('t_7a019000 Fix the router', 'src/r.ts', 'topic: router; waits: run:docs/plans/2026-01-02-dropped.md').status, 0);
  board = chips();
  assert.match(board.stdout, /fix t_7a015000's wait: task:t_7a014000 closed as dismissed superseded without its result/, 'a task it waited on closed without landing');
  assert.match(board.stdout, /fix t_7a019000's wait: run:docs\/plans\/2026-01-02-dropped\.md closed without its result/, 'a plan it waited on was cancelled');
  assert.equal(board.status, 1);
});

test('chips reads a plan idle for a week as stale, offers one verdict per review scope, moves the waits on it there and leaves a plan that waits on the owner to the owner', () => {
  const { LEDGER, batch, chips, dir, helper, offer, root } = chipLedger({ config: { chips: { scopes: 'docs/scopes' }, pageTopic: { field: 'review_scopes' } }, files: { 'docs/scopes/parser.json': '{}\n' } });
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
  const go = plan('2026-01-06-go', "building: phase 1, on the owner's go");
  commitAt(root, 20, go);
  const worktree = join(dir, 'wt');
  spawnSync('git', ['-C', root, 'worktree', 'add', '-q', '--detach', worktree]);
  appendFileSync(join(worktree, freshLog), planRow(daysAgo(1)));
  assert.equal(offer('t_7a004000 Fix the lexer', 'src/l.ts', `topic: lexer; waits: run:${parser}`).status, 0);
  assert.equal(offer('t_7a005000 Fix the cache', 'src/c.ts', `topic: cache; waits: run:${parser}, run:${cache}, pr:12`).status, 0);
  assert.equal(offer('t_7a009000 Fix the docs', 'docs/d.md', `topic: docs; waits: run:${fresh}`).status, 0);
  assert.equal(offer('t_7a00d000 Fix the theme', 'src/t.ts', `topic: theme; waits: run:${recent}`).status, 0);
  assert.equal(offer('t_7a010000 Fix the phone lane', 'src/p.ts', `topic: phone; waits: run:${phone}`).status, 0);
  assert.equal(offer('t_7a014000 Fix the router', 'src/r.ts', `topic: router; waits: run:${go}`).status, 0);
  let board = chips();
  assert.match(board.stdout, /t_7a004000 {2}Fix the lexer {2}\[lexer\] {2}waits on run:docs\/plans\/2026-01-01-parser\.md stale, idle since \d{4}-\d{2}-\d{2}\n/);
  assert.match(board.stdout, /t_7a009000 {2}Fix the docs {2}\[docs\] {2}waits on run:docs\/plans\/2026-01-03-fresh\.md active\n/, "a row in another checkout's copy of its log keeps a plan fresh");
  assert.match(board.stdout, /t_7a00d000 {2}Fix the theme {2}\[theme\] {2}waits on run:docs\/plans\/2026-01-04-recent\.md active\n/, 'six idle days are not a week');
  assert.match(board.stdout, /t_7a010000 {2}Fix the phone lane {2}\[phone\] {2}waits on run:docs\/plans\/2026-01-05-phone\.md waits on you, idle since \d{4}-\d{2}-\d{2}\n/);
  assert.match(board.stdout, /Stale plans \(4\)\n {2}docs\/plans\/2026-01-05-phone\.md {2}idle 20 days {2}waits on you: planning: waiting on you to buy a phone {2}t_7a010000 waits on it\n/, 'a plan that waits on the owner leads the list');
  assert.match(board.stdout, /\n {2}docs\/plans\/2026-01-01-parser\.md {2}idle 10 days {2}building: step 2 {2}t_7a004000 and t_7a005000 wait on it\n/);
  const offers = [...board.stdout.matchAll(/append chip "(t_[0-9a-f]+ [^"]+)" "([^"]+)" "([^"]+)" offered/gu)];
  assert.equal(offers.length, 2, 'one verdict per review scope, and none for the plan that waits on the owner');
  assert.match(board.stdout, /offer one verdict on review scope parser for the stale plans docs\/plans\/2026-01-01-parser\.md and docs\/plans\/2026-01-02-parser-cache\.md, which t_7a004000 and t_7a005000 wait on: append chip "t_[0-9a-f]+ Decide parser again instead of resuming its plans \(xhigh\)"/);
  assert.match(board.stdout, /offer one verdict for the stale plan docs\/plans\/2026-01-06-go\.md, which t_7a014000 waits on: append chip "t_[0-9a-f]+ Decide again whether to resume the go plan \(xhigh\)"/, "a Status that has the owner's go waits on nobody");
  assert.equal(board.status, 0, 'a stale plan is ledger work, not a problem');
  const misrouted = helper('append', LEDGER, 'chip', 't_7a019000 Fix the stale parser', 'why', 'writes: src/x.ts; topic: x; priority: P2; via: stale', 'offered');
  assert.match(misrouted.stderr, /via: stale goes only on a kind: decide offer/);
  writeFileSync(join(root, go), "# 2026-01-06-go\n\nStatus: building: phase 1, on the owner's go\n\nStep 2 started.\n");
  commitAt(root, 0, go);
  assert.match(chips().stdout, /t_7a014000 {2}Fix the router {2}\[router\] {2}waits on run:docs\/plans\/2026-01-06-go\.md active\n/, 'a new commit makes a stale plan fresh again');
  const [, decision, finding, tokens] = offers.find(([, each]) => each.includes('Decide parser'));
  assert.match(tokens, /^writes: docs\/plans\/2026-01-01-parser\.md, docs\/plans\/2026-01-02-parser-cache\.md, docs\/scopes\/parser\.json; topic: review-parser; kind: decide; priority: P2; via: stale; review-scope: parser; session: none$/);
  const offered = helper('append', LEDGER, 'chip', decision, finding, tokens, 'offered');
  assert.equal(offered.status, 0, offered.stderr);
  const verdict = decision.split(' ')[0];
  board = chips();
  assert.match(board.stdout, new RegExp(`move t_7a004000's waits on stale plans to their fresh verdict: log updated with waits: task:${verdict}\\n`));
  assert.match(board.stdout, new RegExp(`move t_7a005000's waits on stale plans to their fresh verdict: log updated with waits: task:${verdict}, pr:12\\n`), 'one row moves both waits and keeps the rest');
  assert.equal(batch([['t_7a004000 Fix the lexer', 'updated', `waits: task:${verdict}`], ['t_7a005000 Fix the cache', 'updated', `waits: task:${verdict}, pr:12`]]).status, 0);
  board = chips();
  assert.match(board.stdout, new RegExp(`t_7a004000 {2}Fix the lexer {2}\\[lexer\\] {2}waits on task:${verdict} offered\\n`));
  assert.match(board.stdout, /Stale plans \(1\)\n {2}docs\/plans\/2026-01-05-phone\.md/, 'a plan no task waits on leaves the list');
  assert.doesNotMatch(board.stdout, new RegExp(`card ${verdict}:`), 'only /chips all cards a verdict that names session: none');
  assert.equal(offer('t_7a01f000 Fix the guide', 'docs/g.md', 'topic: guide').status, 0);
  assert.match(chips().stdout, /Do, card pass/);
  const synced = chips('sync');
  assert.match(synced.stdout, /chips sync leaves out the card pass, so it offers no card/);
  assert.doesNotMatch(synced.stdout, /Do, card pass|^ {2}card \S+: it can start/m);
});

test('in a trunk project chips reads a plan as stale from origin and fresh from any checkout of its log', () => {
  const { helper, offerHere, root, worktree } = linkedWorktree('trunk');
  const path = 'docs/plans/2026-01-01-old.md';
  const log = 'docs/plans/2026-01-01-old.decisions.tsv';
  writeFileSync(join(root, path), '# Old\n\nStatus: building: step 3\n');
  writeFileSync(join(root, log), LOG_HEADER);
  commitAt(root, 12, path, log);
  spawnSync('git', ['-C', root, 'update-ref', 'refs/remotes/origin/next', 'HEAD']);
  assert.equal(offerHere('t_7a004000 Follow the old plan', `writes: docs/guide.md; topic: follow; waits: run:${path}`).status, 0);
  const stale = helper('chips');
  assert.match(stale.stdout, /waits on run:docs\/plans\/2026-01-01-old\.md stale, idle since \d{4}-\d{2}-\d{2}\n/, stale.stderr);
  mkdirSync(join(worktree, 'docs/plans'), { recursive: true });
  writeFileSync(join(worktree, log), LOG_HEADER + planRow(daysAgo(0)));
  assert.match(helper('chips').stdout, /waits on run:docs\/plans\/2026-01-01-old\.md active\n/, 'an uncommitted row in a worktree is activity');
  const only = 'docs/plans/2026-01-02-only.md';
  const onlyLog = 'docs/plans/2026-01-02-only.decisions.tsv';
  writeFileSync(join(worktree, only), '# Only\n\nStatus: building: step 1\n');
  writeFileSync(join(worktree, onlyLog), LOG_HEADER + planRow(daysAgo(9)));
  assert.equal(offerHere('t_7a009000 Follow the worktree plan', `writes: docs/other.md; topic: other; waits: run:${only}`).status, 0);
  assert.match(helper('chips').stdout, /waits on run:docs\/plans\/2026-01-02-only\.md stale, idle since \d{4}-\d{2}-\d{2}\n/, 'a plan only a worktree holds goes stale too');
  writeFileSync(join(worktree, onlyLog), LOG_HEADER + planRow(daysAgo(0)));
  assert.match(helper('chips').stdout, /waits on run:docs\/plans\/2026-01-02-only\.md not landed\n/);
});

test('a Status line waits on the owner when a wait word and the owner share a clause, or when it is paused', async () => {
  const { waitsOnOwner } = await import(pathToFileURL(join(HELPERS, 'status.mjs')).href);
  for (const status of ['planning: waiting on you to buy a phone', 'blocked on owner steps: Pinyin for #5137', "awaiting the owner's answers under Needs you", 'waiting: on your go', 'in review as PR 5141; nothing needs you until you review it', 'paused: held for the release', "waiting: built; the misses wait on the pivot plan's rerun, then you review", 'waiting: built and tested in dotai, uncommitted until you say push', "partial: landed uncommitted in the checkout; waits on suggested task t_e0e8d398's timings, then your commit", 'on hold until you decide']) {
    assert.equal(waitsOnOwner(status), true, status);
  }
  for (const status of ["building: phase 1, on the owner's go", 'waiting: on the timing rerun under a quiet machine', 'reopened: the owner asked for a redesign', 'waiting: on the rerun. You can read the draft meanwhile']) {
    assert.equal(waitsOnOwner(status), false, status);
  }
});

test('append takes the move of a P0 task onto a stale plan verdict in a later tier, without looping', () => {
  const tiers = [{ name: 'core', paths: ['src/'] }, { name: 'feature' }, { name: 'late', scopes: ['late'] }];
  const { LEDGER, offer, stalePlan, timed } = stalePlanLedger({ tiers }, { 'docs/scopes/late.json': '{}\n' });
  const path = stalePlan('2026-01-01-late', 'late');
  assert.equal(offer('t_7a004000 Repair the citations', 'src/c.ts', `topic: citations; priority: P0; repro: steps; waits: run:${path}`).status, 0);
  const verdict = offer('t_7a043000 Decide late again', `${path}, docs/scopes/late.json`, 'topic: review-late; kind: decide; priority: P2; via: stale; review-scope: late; session: none');
  assert.equal(verdict.status, 0, verdict.stderr);
  const board = timed(['chips']);
  assert.equal(board.signal, null, 'the board read ends');
  assert.match(board.stdout, /move t_7a004000's waits on stale plans to their fresh verdict: log updated with waits: task:t_7a043000\n/);
  const moved = timed(['append', LEDGER, 'chip', 't_7a004000 Repair the citations', 'why', 'waits: task:t_7a043000', 'updated']);
  assert.equal(moved.signal, null, 'append ends');
  assert.equal(moved.status, 0, moved.stderr);
});

test("a stale plan folds into the open design question of its scope's topic, and its waits move there", () => {
  const { batch, chip, chips, offer, stalePlan } = stalePlanLedger();
  const first = stalePlan('2026-01-01-parser', 'parser');
  const second = stalePlan('2026-01-02-parser-cache', 'parser');
  assert.equal(offer('t_7a035000 Settle the parser fork', 'docs/scopes/parser.json', 'topic: review-parser; kind: decide; priority: P2; via: verdict; review-scope: parser').status, 0);
  assert.equal(offer('t_7a004000 Fix the lexer', 'src/l.ts', `topic: lexer; waits: run:${first}`).status, 0);
  assert.equal(offer('t_7a005000 Fix the cache', 'src/c.ts', `topic: cache; waits: run:${second}`).status, 0);
  let board = chips();
  assert.doesNotMatch(board.stdout, /offer one verdict/, 'the topic already holds its design question');
  assert.match(board.stdout, /fold the stale plans docs\/plans\/2026-01-01-parser\.md and docs\/plans\/2026-01-02-parser-cache\.md into t_7a035000, the open design question in review-parser: log folded with writes: docs\/plans\/2026-01-01-parser\.md, docs\/plans\/2026-01-02-parser-cache\.md\n/);
  const folded = chip('t_7a035000 Settle the parser fork', 'folded', `writes: ${first}, ${second}`);
  assert.equal(folded.status, 0, folded.stderr);
  board = chips();
  assert.match(board.stdout, /move t_7a004000's waits on stale plans to their fresh verdict: log updated with waits: task:t_7a035000\n/);
  assert.match(board.stdout, /move t_7a005000's waits on stale plans to their fresh verdict: log updated with waits: task:t_7a035000\n/);
  const moved = batch([['t_7a004000 Fix the lexer', 'updated', 'waits: task:t_7a035000'], ['t_7a005000 Fix the cache', 'updated', 'waits: task:t_7a035000']]);
  assert.equal(moved.status, 0, moved.stderr);
  assert.doesNotMatch(chips().stdout, /Stale plans/);
});

test('a design question that waits on a stale plan of its own scope drops that wait and becomes its verdict', () => {
  const { chip, chips, offer, stalePlan } = stalePlanLedger();
  const path = stalePlan('2026-01-01-parser', 'parser');
  assert.equal(offer('t_7a035000 Settle the parser fork', `${path}, docs/scopes/parser.json`, `topic: review-parser; kind: decide; priority: P2; via: verdict; review-scope: parser; waits: run:${path}, pr:12`).status, 0);
  assert.equal(offer('t_7a004000 Fix the lexer', 'src/l.ts', `topic: lexer; waits: run:${path}`).status, 0);
  const board = chips();
  assert.doesNotMatch(board.stdout, /offer one verdict/);
  assert.match(board.stdout, /move t_7a035000's waits on stale plans to their fresh verdict: log updated with waits: pr:12\n/, 'the verdict waits on the plan it decides no longer');
  assert.match(board.stdout, /move t_7a004000's waits on stale plans to their fresh verdict: log updated with waits: task:t_7a035000\n/);
  assert.equal(chip('t_7a035000 Settle the parser fork', 'updated', 'waits: pr:12').status, 0);
});

test("a stale plan whose verdict waits back on the plan's waiter is a problem, not a move append refuses", () => {
  const { chips, offer, stalePlan } = stalePlanLedger();
  const path = stalePlan('2026-01-01-parser', 'parser');
  assert.equal(offer('t_7a004000 Fix the lexer', 'src/l.ts', `topic: lexer; waits: run:${path}`).status, 0);
  assert.equal(offer('t_7a043000 Decide parser again', `${path}, docs/scopes/parser.json`, 'topic: review-parser; kind: decide; priority: P2; via: stale; review-scope: parser; session: none; waits: task:t_7a004000').status, 0);
  const board = chips();
  assert.doesNotMatch(board.stdout, /move t_7a004000's waits/);
  assert.match(board.stdout, /fix t_7a004000's wait: run:docs\/plans\/2026-01-01-parser\.md is stale, and its verdict t_7a043000 waits back on t_7a004000; log updated with the waits it has now\n/);
  assert.equal(board.status, 1);
});

test("a stale plan's own started run is no verdict, so the ledger pass offers one", () => {
  const { LEDGER, chips, offer, root, stalePlan } = stalePlanLedger();
  const path = stalePlan('2026-01-01-own', 'parser');
  assert.equal(offer('t_7a037000 Build the own plan', path, 'topic: own; kind: decide; priority: P2; via: verdict; review-scope: none').status, 0);
  appendFileSync(join(root, LEDGER), `${daysAgo(12)}\tchip\tt_7a037000 Build the own plan\twhy\tsession: s1\tstarted\n`);
  assert.equal(offer('t_7a004000 Fix the lexer', 'src/l.ts', `topic: lexer; waits: run:${path}`).status, 0);
  const board = chips();
  assert.doesNotMatch(board.stdout, /move t_7a004000's waits/, 'the run that wrote the plan is not its fresh verdict');
  assert.match(board.stdout, /offer one verdict on review scope parser for the stale plan docs\/plans\/2026-01-01-own\.md/);
  appendFileSync(join(root, LEDGER), `${daysAgo(9)}\tchip\tt_7a037000 Build the own plan\twhy\tsession: s1; owns: src/own.ts\tstarted\n`);
  assert.match(chips().stdout, /offer one verdict on review scope parser for the stale plan docs\/plans\/2026-01-01-own\.md/, 'a later started row on the same run keeps its first start');
});

test("a stale plan's own run that still holds its scope's topic is settled before the fresh verdict", () => {
  const { LEDGER, chip, chips, offer, root, stalePlan } = stalePlanLedger();
  const path = stalePlan('2026-01-01-parser', 'parser');
  assert.equal(offer('t_7a037000 Build the parser plan', `${path}, docs/scopes/parser.json`, 'topic: review-parser; kind: decide; priority: P2; via: verdict; review-scope: parser').status, 0);
  appendFileSync(join(root, LEDGER), `${daysAgo(12)}\tchip\tt_7a037000 Build the parser plan\twhy\tsession: s1\tstarted\n`);
  assert.equal(offer('t_7a004000 Fix the lexer', 'src/l.ts', `topic: lexer; waits: run:${path}`).status, 0);
  let board = chips();
  assert.doesNotMatch(board.stdout, /move t_7a004000's waits/);
  assert.match(board.stdout, /settle t_7a037000, the started run that wrote the stale plan docs\/plans\/2026-01-01-parser\.md and still holds review-parser: log landed with the commit that holds its change, or dismissed stopped when none does\n/);
  assert.equal(chip('t_7a037000 Build the parser plan', 'dismissed stopped').status, 0);
  board = chips();
  assert.match(board.stdout, /offer one verdict on review scope parser for the stale plan docs\/plans\/2026-01-01-parser\.md/);
});

test("a carded design question in a stale plan's topic takes none of its waits, and the fresh verdict waits on it", () => {
  const { LEDGER, chips, helper, offer, stalePlan } = stalePlanLedger();
  const path = stalePlan('2026-01-01-parser', 'parser');
  assert.equal(offer('t_7a035000 Choose the parser API', 'docs/scopes/parser.json', 'topic: review-parser; kind: decide; priority: P2; via: verdict; review-scope: parser; card: c1; session: s1').status, 0);
  assert.equal(offer('t_7a004000 Fix the lexer', 'src/l.ts', `topic: lexer; waits: run:${path}`).status, 0);
  let board = chips();
  assert.doesNotMatch(board.stdout, /move t_7a004000's waits/, 'a question that cannot take the plan takes none of its waits');
  const [, decision, finding, tokens] = board.stdout.match(/append chip "(t_[0-9a-f]+ [^"]+)" "([^"]+)" "([^"]+)" offered/) ?? [];
  assert.match(tokens ?? '', /; waits: task:t_7a035000; session: none$/);
  const offered = helper('append', LEDGER, 'chip', decision, finding, tokens, 'offered');
  assert.equal(offered.status, 0, offered.stderr);
  board = chips();
  assert.match(board.stdout, new RegExp(`move t_7a004000's waits on stale plans to their fresh verdict: log updated with waits: task:${decision.split(' ')[0]}\\n`));
});

test('two moves that would close a loop in one pass print one move and one problem, and the move appends', () => {
  const { batch, chips, offer, stalePlan } = stalePlanLedger({}, { 'docs/scopes/lexer.json': '{}\n' });
  const parser = stalePlan('2026-01-01-parser', 'parser', 12);
  const lexer = stalePlan('2026-01-02-lexer', 'lexer', 10);
  assert.equal(offer('t_7a045000 Decide the parser', `${parser}, docs/scopes/parser.json`, `topic: review-parser; kind: decide; priority: P2; via: verdict; review-scope: parser; waits: run:${lexer}`).status, 0);
  assert.equal(offer('t_7a04b000 Decide the lexer', `${lexer}, docs/scopes/lexer.json`, `topic: review-lexer; kind: decide; priority: P2; via: verdict; review-scope: lexer; waits: run:${parser}`).status, 0);
  const board = chips();
  const moves = [...board.stdout.matchAll(/move (t_[0-9a-f]{8})'s waits on stale plans/gu)].map((match) => match[1]);
  assert.deepEqual(moves, ['t_7a04b000'], board.stdout);
  assert.match(board.stdout, /move t_7a04b000's waits on stale plans to their fresh verdict: log updated with waits: task:t_7a045000\n/);
  assert.match(board.stdout, /fix t_7a045000's wait: run:docs\/plans\/2026-01-02-lexer\.md is stale, and its verdict t_7a04b000 waits back on t_7a045000/);
  const moved = batch([['t_7a04b000 Decide the lexer', 'updated', 'waits: task:t_7a045000']]);
  assert.equal(moved.status, 0, moved.stderr);
});

test('an absolute path into a worktree nested in the project reads the activity of every checkout of its log', () => {
  const { chips, offer, root, stalePlan } = stalePlanLedger();
  const path = stalePlan('2026-01-01-parser', 'parser');
  const log = 'docs/plans/2026-01-01-parser.decisions.tsv';
  const nested = join(root, '.claude/worktrees/child');
  spawnSync('git', ['-C', root, 'worktree', 'add', '-q', '--detach', nested]);
  writeFileSync(join(nested, log), LOG_HEADER + planRow(daysAgo(10)));
  writeFileSync(join(root, log), LOG_HEADER + planRow(daysAgo(1)));
  assert.equal(offer('t_7a004000 Fix the lexer', 'src/l.ts', `topic: lexer; waits: run:${join(nested, path)}`).status, 0);
  assert.match(chips().stdout, /t_7a004000 {2}Fix the lexer {2}\[lexer\] {2}waits on run:\S+2026-01-01-parser\.md active\n/);
});

test('an absolute path to a plan in the project reads the activity of every checkout of its log', () => {
  const { chips, dir, offer, root, stalePlan } = stalePlanLedger();
  const path = stalePlan('2026-01-01-parser', 'parser');
  const log = 'docs/plans/2026-01-01-parser.decisions.tsv';
  const worktree = join(dir, 'wt');
  spawnSync('git', ['-C', root, 'worktree', 'add', '-q', '--detach', worktree]);
  writeFileSync(join(worktree, log), LOG_HEADER + planRow(daysAgo(1)));
  assert.equal(offer('t_7a004000 Fix the lexer', 'src/l.ts', `topic: lexer; waits: run:${join(root, path)}`).status, 0);
  assert.match(chips().stdout, /t_7a004000 {2}Fix the lexer {2}\[lexer\] {2}waits on run:\S+2026-01-01-parser\.md active\n/);
});

test('chips sync withdraws no card the card pass would offer again', () => {
  const { chip, chips, offer } = chipLedger();
  const parser = 't_7a00d000 Fix the parser (xhigh)';
  assert.equal(offer(parser, 'src/p.ts', 'topic: parser; card: c1; session: s1').status, 0);
  assert.equal(chip(parser, 'updated', 'effort: high').status, 0);
  assert.match(chips('--session', 's1').stdout, /withdraw t_7a00d000's card c1/);
  assert.doesNotMatch(chips('sync', '--session', 's1').stdout, /withdraw t_7a00d000's card c1/);
  const blocked = 't_7a010000 Fix the printer';
  assert.equal(offer(blocked, 'src/q.ts', 'topic: printer; card: d1; session: s1').status, 0);
  assert.equal(chip(blocked, 'updated', 'waits: pr:99').status, 0);
  assert.match(chips('sync', '--session', 's1').stdout, /withdraw t_7a010000's card d1: pr:99 not merged/, 'a card on a task that cannot start is still withdrawn');
});

test('decisions-check cards only a task that can start, and a waiting task reserves no paths', () => {
  const { chip, chips, offer, outside } = chipLedger();
  assert.equal(offer('t_7a004000 Rewrite the docs', 'docs', 'topic: docs; waits: pr:99').status, 0);
  const waiting = chip('t_7a004000 Rewrite the docs', 'carded', 'card: t_7a045000; session: s1');
  assert.equal(waiting.status, 1, 'a card for a task whose PR has not merged');
  assert.match(waiting.stderr, /t_7a004000 cannot start yet \(pr:99 not merged\), so it gets no card/);
  const inside = offer('t_7a005000 Fix the guide', 'docs/guide.md', 'topic: docs; card: t_7a046000; session: s1');
  assert.equal(inside.status, 0, `a ready task inside the waiting task's directory gets a card at once: ${inside.stderr}`);
  assert.equal(offer('t_7a009000 Fix the reader', `src/r.ts, ${outside('io.md')}`, 'topic: io').status, 0);
  assert.equal(chip('t_7a009000 Fix the reader', 'started').status, 0);
  assert.equal(offer('t_7a00a000 Speed up the reader', 'src/r.ts', 'topic: io; card: t_7a047000; session: s1').status, 0, 'a card beside a started session on the same project path');
  assert.match(offer('t_7a00b000 Document the reader', outside('io.md'), 'topic: io; card: t_7a048000; session: s1').stderr, /started t_7a009000 writes its paths outside this checkout/, 'a card for a task a started session blocks in another repository');
  assert.equal(chip('t_7a005000 Fix the guide', 'uncarded', 'card: t_7a046000').status, 0);
  assert.match(chips().stdout, /card t_7a005000: it can start and has no card/, 'the sweep lists a ready task without a card');
});

test('decisions-check holds one open design question per topic and folds the next finding into it', () => {
  const { chip, chips, offer, root } = chipLedger();
  const landing = 't_7a004000 Decide where pasted content lands (xhigh)';
  assert.equal(offer(landing, 'src/core', 'topic: landing; kind: decide').status, 0);
  assert.match(offer('t_7a005000 Decide where dropped content lands (xhigh)', 'src/core', 'topic: landing; kind: decide').stderr, /topic landing already has the open design question t_7a004000; log this finding as a folded row on t_7a004000/);
  assert.equal(offer('t_7a006000 Fix the drop indicator', 'src/ui', 'topic: landing').status, 0, 'a plain fix in the same topic');
  assert.equal(offer('t_7a009000 Decide the export format (xhigh)', 'src/export', 'topic: export; kind: decide').status, 0, 'a design question in another topic');
  assert.equal(chip(landing, 'folded', 'writes: src/drop').status, 0);
  assert.match(chips('brief', 't_7a004000').stdout, /^\[P1\] Decide where pasted content lands \(xhigh\)\n\nTopic: landing\.[\s\S]*Findings:\n- why\n- why\nWrites: src\/core, src\/drop[\s\S]*settles a design question first[\s\S]*\n\nSuggested task t_7a004000 in docs\/plans\/suggested-tasks\.decisions\.tsv of the project checkout [^\n]*\n?$/);
  assert.match(chips('id').stdout, /^t_[0-9a-f]{8}\n$/u);
  assert.match(chips('--fetch', 'id').stdout, /^t_[0-9a-f]{8}\n$/u, 'a flag before the id command');
  const raced = 'docs/plans/raced.decisions.tsv';
  writeFileSync(join(root, raced), `ts\tphase\tdecision\twhy\tevidence\tresult\n${['t_7a019000 Decide the badge', 't_7a01a000 Decide the badge link'].map((decision) => ['2026-01-01T10:00:00Z', 'chip', decision, 'why', 'writes: README.md; topic: badge; kind: decide', 'offered'].join('\t')).join('\n')}\n`);
  const folded = chips(raced);
  assert.equal(folded.status, 1, 'two design questions in one topic that append never checked together');
  assert.match(folded.stdout, /fold topic badge: t_7a019000 and t_7a01a000 are both open design questions/);
});

test('decisions-check refuses a base-red row until an open suggested task owns that check', () => {
  const { appendTo, chip, offer } = chipLedger();
  const log = 'docs/plans/2026-01-01-fix.decisions.tsv';
  const blame = () => appendTo(log, 'verify', 'read CI', 'base-red: ci:check; proof: none', 'gap: fails on next too');
  const refused = blame();
  assert.equal(refused.status, 1, 'a failure blamed on the base that no task owns');
  assert.match(refused.stderr, /base-red: ci:check has no open suggested task that owns it/);
  assert.equal(appendTo(log, 'verify', 'read CI', 'the check also fails on next; proof: none', 'gap: fails on next too').status, 0, 'prose names no check, so nothing reads it');
  const green = 't_7a004000 Make next green (xhigh)';
  assert.equal(offer(green, '.github/workflows', 'topic: next-green; owns: ci:check').status, 0);
  assert.equal(blame().status, 0, 'a base-red row once a task owns the check');
  assert.equal(chip(green, 'started').status, 0);
  assert.equal(chip(green, 'landed').status, 0);
  assert.equal(blame().status, 1, 'the owning task landed, so the check has no owner again');
});

test('decisions-check chips prints every open task by state, and lists started overlaps', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', { files: { 'docs/plans/.keep': '' } });
  const chips = (...args) => run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'chips', ...args], root);
  assert.match(chips().stderr, /No ledger at docs\/plans\/suggested-tasks\.decisions\.tsv yet/, 'a project with no ledger yet');
  assert.equal(chips('docs/plans/missing.decisions.tsv').status, 2, 'a named ledger that does not exist');
  const rows = [
    ['t_7a004000 Fix the stale badge', 'writes: README.md; topic: docs', 'offered'],
    ['t_7a00a000 Design the export ledger (xhigh)', `writes: src/export, ${join(dir, 'shared/export')}; topic: export; kind: decide`, 'offered'],
    ['t_7a00f000 Now: Rename the probe flag', 'writes: tooling/probe.mjs', 'offered'],
    ['t_7a004000 Fix the stale badge', 'README.md already links the live page', 'dismissed done'],
    ['t_7a00a000 Design the export ledger (xhigh)', 'the owner started it', 'started'],
    ['t_7a01f000 Fix the core', `writes: src/export/core.ts, ${join(dir, 'shared/export/core.md')}; topic: export`, 'offered'],
    ['t_7a01f000 Fix the core', 'evidence', 'started'],
  ];
  writeFileSync(join(root, 'docs/plans/suggested-tasks.decisions.tsv'), `ts\tphase\tdecision\twhy\tevidence\tresult\n${rows.map(([decision, evidence, result]) => ['2026-01-01T10:00:00Z', 'chip', decision, 'why', evidence, result].join('\t')).join('\n')}\n`);
  const listed = chips();
  assert.equal(listed.status, 0, listed.stderr);
  assert.match(listed.stdout, /^3 open suggested tasks in docs\/plans\/suggested-tasks\.decisions\.tsv\./u);
  assert.match(listed.stdout, /Started \(2\)\n {2}t_7a00a000 {2}Design the export ledger \(xhigh\) {2}\[export, decide\]\n {2}t_7a01f000 {2}Fix the core {2}\[export\]/);
  assert.match(listed.stdout, /Unmigrated \(1\)\n {2}t_7a00f000 {2}Rename the probe flag\n/, 'an old offer with no topic, its readiness tag stripped');
  assert.match(listed.stdout, /migrate t_7a00f000: log updated with topic:/);
  assert.match(listed.stderr, /t_7a00a000 and t_7a01f000 are both started on an overlapping path outside this checkout/);
});

test('chips prints the started-overlap note on its own line when a late reader gets the board and the note through one pipe', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', { files: { 'docs/plans/.keep': '' } });
  const rows = Array.from({ length: 600 }, (_, n) => [`t_7a018${n.toString(16).padStart(3, '0')} Fix the badge number ${n} on the page ${'x'.repeat(60)}`, `writes: src/f${n}.ts; topic: topic-${n}`, 'offered']);
  rows.push(
    ['t_7a03a000 Design the export ledger (xhigh)', `writes: src/export, ${join(dir, 'shared/export')}; topic: export; kind: decide`, 'offered'],
    ['t_7a03a000 Design the export ledger (xhigh)', 'evidence', 'started'],
    ['t_7a03b000 Fix the core', `writes: src/export/core.ts, ${join(dir, 'shared/export/core.md')}; topic: export`, 'offered'],
    ['t_7a03b000 Fix the core', 'evidence', 'started'],
  );
  writeFileSync(join(root, 'docs/plans/suggested-tasks.decisions.tsv'), ledgerRows(rows));
  const result = run('sh', ['-c', `"${process.execPath}" "${join(HELPERS, 'decisions-check.mjs')}" chips 2>&1 | (sleep 1; cat)`], root);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.length > 65_536, 'the board outgrows a pipe buffer');
  assert.match(result.stdout, /^t_7a03a000 and t_7a03b000 are both started on an overlapping path outside this checkout; the owner runs both$/mu);
});

