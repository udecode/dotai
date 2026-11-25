import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CONFIG, commit, project, read, sandbox } from './test-sandbox.mjs';
import { chipLedger, linkedWorktree } from './test-ledger.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const HELPERS = join(HERE, '../assets/pstack');

test('decisions-check keeps chip rows in the project ledger, out of run logs', () => {
  const { appendTo, offer } = chipLedger();
  const misplaced = appendTo('docs/plans/2026-01-01-fix.decisions.tsv', 'chip', 'task_a1 Fix the stale badge', 'writes: README.md; topic: docs', 'offered');
  assert.equal(misplaced.status, 1, 'a chip row in a run log');
  assert.match(misplaced.stderr, /chip rows go in the project's ledger docs\/plans\/suggested-tasks\.decisions\.tsv/);
  assert.equal(offer('task_a1 Fix the stale badge').status, 0);
});

test('decisions-check leaves the chip rows an older run log holds to that log', () => {
  const { root, run } = chipLedger();
  const log = 'docs/plans/2026-01-01-fix.decisions.tsv';
  const rows = [
    ['chip', 'task_a1 Now: Fix the stale badge', 'why', 'writes: the README badge', 'offered'],
    ['chip', 'task_a1 Now: Fix the stale badge', 'why', 'retitled as After', 'dismissed retagged task_b2'],
  ];
  writeFileSync(join(root, log), `ts\tphase\tdecision\twhy\tevidence\tresult\n${rows.map((row) => ['2026-01-01T10:00:00Z', ...row].join('\t')).join('\n')}\n`);
  const checked = run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), log], root);
  assert.equal(checked.status, 0, checked.stderr);
});

test('decisions-check takes a chip offer only with a plain title, a topic and the paths it writes', () => {
  const { LEDGER, appendTo, chip, helper, offer } = chipLedger();
  assert.equal(offer('task_a1').status, 1, 'an id with no title');
  for (const tagged of ['task_a1 Now: Fix the stale badge', 'task_a1 After: Fix the stale badge', 'task_a1 [P1] Fix the stale badge', 'task_a1 Fix the stale badge (high)']) {
    assert.match(offer(tagged).stderr, /no title says Now: or After:/, tagged);
  }
  assert.match(offer('task_a1 Fix the stale badge', 'README.md', 'the badge links a dead page').stderr, /names its owner question as "topic: <word>"/, 'an offer with no topic');
  assert.match(offer('task_a1 Fix the stale badge', 'README.md', 'topic: Docs Pages').stderr, /lowercase kebab-case/, 'a topic that is not one kebab-case word');
  assert.match(offer('task_a1 Fix the stale badge', 'README.md', 'topic: docs; waits: after the release').stderr, /waits: takes pr:<number>, task:<id> or run:/, 'a wait written as prose');
  const unscoped = chip('task_a1 Fix the stale badge', 'offered', 'topic: docs');
  assert.equal(unscoped.status, 1, 'an offer with no write set');
  assert.match(unscoped.stderr, /writes: <path>, <path>/);
  assert.match(offer('task_a1 Fix the stale badge', 'the README badge').stderr, /writes: <path>, <path>/, 'a write set that is not paths');
  assert.equal(offer('task_a1 Fix the stale badge', 'README.md', 'topic: docs; waits: pr:12, task:task_z9, run:docs/plans/x.md; kind: fix').status, 0);
  assert.match(offer('task_a1 Fix the stale badge').stderr, /already offered/, 'an id offered twice');
  assert.match(appendTo(LEDGER, 'build', 'ship the parser', 'scope: fixtures', 'offered').stderr, /only in a chip row/, 'an offered result outside a chip row');
  assert.equal(helper(LEDGER).status, 0);
});

test('decisions-check takes a new chip finding only when this checkout holds the evidence it cites', () => {
  const { LEDGER, helper, root } = chipLedger();
  const log = 'docs/plans/artifacts/probe/base-a1.log';
  const offerCiting = (finding) => helper('append', LEDGER, 'chip', 'task_a1 Fix the stale badge', finding, 'writes: README.md; topic: docs; priority: P3; via: verdict', 'offered');
  const missing = offerCiting(`the badge links a dead page (${log})`);
  assert.equal(missing.status, 1, 'an offer citing a log only another worktree holds');
  assert.match(missing.stderr, /the finding cites docs\/plans\/artifacts\/probe\/base-a1\.log, which this checkout lacks/);
  mkdirSync(join(root, 'docs/plans/artifacts/probe'), { recursive: true });
  writeFileSync(join(root, log), 'exit=1\n');
  assert.equal(offerCiting(`the badge links a dead page (${log})`).status, 0, 'an offer citing a log the checkout holds');
  const fold = (finding) => helper('append', LEDGER, 'chip', 'task_a1 Fix the stale badge', finding, 'kind: decide; effort: xhigh', 'folded');
  assert.match(fold('the footer badge fails too (docs/plans/artifacts/probe/footer-a1.log)').stderr, /cites docs\/plans\/artifacts\/probe\/footer-a1\.log, which this checkout lacks/, 'a folded finding citing a missing log');
  assert.equal(fold('the footer badge fails too').status, 0, 'a folded finding that cites no file');
  rmSync(join(root, log));
  assert.equal(helper(LEDGER).status, 0, 'the whole-log check leaves an older offer whose evidence went missing');
});

test('decisions-check takes a chip row whose writes: names a run-directory path the task will create, and checks every other path its evidence cites', () => {
  const { LEDGER, appendTo, chip, helper, offer, root } = chipLedger();
  const accepted = offer('task_a1 Render the state-machine page', 'docs/plans/artifacts/run/page/, src/page.ts', 'topic: pages');
  assert.equal(accepted.status, 0, `an offer that names the folder its page render will write: ${accepted.stderr}`);
  const started = chip('task_a1 Render the state-machine page', 'started', 'writes: docs/plans/artifacts/run/notes.md; session: s1');
  assert.equal(started.status, 0, `a started row that names a run file before its first write: ${started.stderr}`);
  assert.match(offer('task_b1 Fix the badge', 'README.md', 'topic: docs; priority: P1; repro: docs/plans/artifacts/run/gone-a1.log fails').stderr, /evidence cites docs\/plans\/artifacts\/run\/gone-a1\.log, which does not exist/, 'a missing path outside writes:');
  assert.match(offer('task_b1 Fix the badge', 'README.md', 'topic: docs; priority: P1; repro: the run writes: docs/plans/artifacts/run/gone-a2.log').stderr, /gone-a2\.log, which does not exist/, 'writes: inside repro prose');
  assert.match(appendTo('docs/plans/2026-01-01-fix.decisions.tsv', 'build', 'fix the badge', 'scope: badge; writes: docs/plans/artifacts/run/gone-a3.log', 'verified').stderr, /gone-a3\.log, which does not exist/, 'writes: in a run log row');
  const chipLine = (evidence, result) => ['2026-11-07T00:00:00Z', 'chip', 'task_a1 Render the state-machine page', 'why', evidence, result].join('\t');
  writeFileSync(join(root, 'docs/plans/2026-01-02-fix.decisions.tsv'), `ts\tphase\tdecision\twhy\tevidence\tresult\n${chipLine('writes: docs/plans/artifacts/run/gone-a4.log; topic: pages', 'offered')}\n`);
  assert.match(helper('docs/plans/2026-01-02-fix.decisions.tsv').stderr, /gone-a4\.log, which does not exist/, 'a chip row outside the ledger');
  assert.equal(helper(LEDGER).status, 0, 'the ledger holds only rows it takes');
  appendFileSync(join(root, LEDGER), `${chipLine('writes: docs/plans/artifacts/run/gone-a5.log; commit: abc1234', 'landed')}\n`);
  assert.match(helper(LEDGER).stderr, /gone-a5\.log, which does not exist/, 'a landed row, whose move takes no writes:');
});

test('chips brief forces the Codex handoff for a card carded with codex: always or a project that sets it', () => {
  const { LEDGER, chip, helper, offer, root } = chipLedger();
  const forced = /forces the Codex handoff/;
  assert.equal(offer('task_a1 Fix the stale badge').status, 0);
  assert.doesNotMatch(helper('chips', 'brief', 'task_a1').stdout, forced, 'a task with no card');
  assert.match(chip('task_a1 Fix the stale badge', 'carded', 'card: task_c1; session: s1; codex: sometimes').stderr, /codex: is always/, 'a mark other than always');
  assert.equal(chip('task_a1 Fix the stale badge', 'carded', 'card: task_c1; session: s1; codex: always').status, 0);
  assert.match(helper('chips', 'brief', 'task_a1').stdout, forced, 'a card carded with codex: always');
  assert.equal(chip('task_a1 Fix the stale badge', 'uncarded', 'card: task_c1').status, 0);
  assert.doesNotMatch(helper('chips', 'brief', 'task_a1').stdout, forced, 'the mark leaves with its card');
  writeFileSync(join(root, '.agents/pstack.json'), JSON.stringify({ branch: 'next', chips: { codex: 'always' } }));
  assert.match(helper('chips', 'brief', 'task_a1').stdout, forced, 'a project whose config sets chips.codex');
  assert.equal(helper(LEDGER).status, 0);
});

test('in a trunk project a linked worktree writes the main checkout ledger, cites its run directory and briefs a card to land through land.mjs', () => {
  const { LEDGER, dir, helper, offerHere, outside, root, worktree } = linkedWorktree('trunk');
  const offered = offerHere('task_a1 Fix the stale badge', 'writes: README.md; topic: docs; owns: ci:new');
  assert.equal(offered.status, 0, offered.stderr);
  assert.match(read(root, LEDGER), /task_a1 Fix the stale badge/, 'the row goes to the main checkout ledger');
  assert.ok(!existsSync(join(worktree, LEDGER)), 'no commit holds the ledger, so the worktree has no copy');
  assert.match(helper('chips').stdout, /task_a1 {2}Fix the stale badge/, 'the board reads the main checkout ledger');
  const log = 'docs/plans/2026-01-01-fix.decisions.tsv';
  const red = helper('append', log, 'verify', 'Record the base failure', 'why', 'base-red: ci:new; proof: none', 'partial, fails on base');
  assert.equal(red.status, 0, `a base-red row finds the owner in the main checkout ledger: ${red.stderr}`);
  const brief = helper('chips', 'brief', 'task_a1').stdout;
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
  writeFileSync(join(root, 'docs/plans/artifacts/fix/open-a1.log'), 'exit=1\n');
  writeFileSync(join(worktree, 'docs/plans/2026-01-01-fix.md'), '# Fix\n\nStatus: building\n\n## Defaults\n\n| Decision | Pick | Alternative | Word | Impact |\n| --- | --- | --- | --- | --- |\n| A | B | C | hold | small |\n');
  const accepted = helper('append', log, 'verify', 'Accept the gap', 'why', 'proof: docs/plans/artifacts/fix/open-a1.log; word: hold', 'accepted');
  assert.match(accepted.stderr, /open-a1\.log has no labeled partial, open, gap, blocked or inconclusive row before this one/, 'a main checkout proof still needs its earlier verdict');
  mkdirSync(join(dir, 'replay'), { recursive: true });
  assert.equal(helper('append', join(dir, 'replay', 'suggested-tasks.decisions.tsv'), 'trail', 'Inspect the replay', 'why', 'proof: none', 'recorded').status, 0);
  assert.match(read(dir, 'replay/suggested-tasks.decisions.tsv'), /Inspect the replay/, 'an explicit log path keeps its destination');
  assert.doesNotMatch(read(root, LEDGER), /Inspect the replay/);
  for (const [decision, topic] of [['task_b2 Edit the shared notes', 'notes-a'], ['task_c3 Rewrite the shared notes', 'notes-b']]) assert.equal(offerHere(decision, `writes: ${outside('notes.md')}; topic: ${topic}`).status, 0);
  assert.equal(offerHere('task_d4 Follow the fix', 'writes: docs/guide.md; topic: follow; waits: run:docs/plans/2026-01-01-fix.md').status, 0);
  assert.equal(offerHere('task_e5 Follow a typo', 'writes: docs/typo.md; topic: typo; waits: run:docs/plans/2026-01-01-nope.md').status, 0);
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
  const ahead = offerHere('task_a1 Draw on text', 'writes: a.md; topic: a; review-scope: ink');
  assert.equal(ahead.status, 0, `a scope the main checkout has not pulled yet, or one this run adds: ${ahead.stderr}`);
  assert.equal(offerHere('task_b1 Fix the caret', 'writes: b.md; topic: b; review-scope: editor').status, 0, 'a scope only the main checkout holds');
  const typo = offerHere('task_c1 Fix the pen', 'writes: c.md; topic: c; review-scope: inkk');
  assert.equal(typo.status, 1, 'a scope neither checkout holds');
  assert.match(typo.stderr, /review-scope: inkk is no review scope in scopes/);
});

test('outside trunk delivery a linked worktree keeps its own ledger and the waits on paths outside the checkout', () => {
  const { LEDGER, helper, offerHere, outside, root, worktree } = linkedWorktree('push');
  assert.equal(offerHere('task_a1 Fix the stale badge', 'writes: README.md; topic: docs').status, 0);
  assert.match(read(worktree, LEDGER), /task_a1/, 'the row goes to the ledger of the checkout the command runs in');
  assert.doesNotMatch(read(root, LEDGER), /task_a1/);
  for (const [decision, topic] of [['task_b2 Edit the shared notes', 'notes-a'], ['task_c3 Rewrite the shared notes', 'notes-b']]) assert.equal(offerHere(decision, `writes: ${outside('notes.md')}; topic: ${topic}`).status, 0);
  assert.match(helper('chips').stdout, /queued behind task_b2/);
});

test('decisions-check takes later rows for a task offered under an old-form title', () => {
  const { LEDGER, chip, root } = chipLedger();
  const old = 'task_a1 After: Fix the stale badge (high)';
  writeFileSync(join(root, LEDGER), `ts\tphase\tdecision\twhy\tevidence\tresult\n${['2026-01-01T10:00:00Z', 'chip', old, 'why', 'writes: README.md', 'offered'].join('\t')}\n`);
  assert.match(chip(old, 'updated', 'topic: docs').stderr, /task_a1 has no topic yet, so this row migrates it/, 'a migration row without its waits');
  assert.equal(chip(old, 'updated', 'topic: docs; waits: none').status, 0, 'a migration row');
  const started = chip(old, 'started');
  assert.equal(started.status, 0, started.stderr);
  assert.equal(chip(old, 'landed').status, 0);
});

test('decisions-check keeps a task under one id: no new gone or replaced rows', () => {
  const { LEDGER, chip, chips, offer, root } = chipLedger();
  assert.equal(offer('task_a1 Fix the stale badge').status, 0);
  assert.equal(offer('task_c3 Rewrite the install guide', 'docs/install.md').status, 0);
  for (const reason of ['gone', 'replaced task_c3']) {
    assert.match(chip('task_a1 Fix the stale badge', `dismissed ${reason}`).stderr, /a task keeps its id for good: log uncarded/, `a new dismissed ${reason} row`);
  }
  assert.equal(chip('task_a1 Fix the stale badge', 'uncarded').status, 0, 'a card that left the queue');
  assert.match(chips().stdout, /Ready, P1 \(2\)\n {2}task_a1 {2}Fix the stale badge {2}\[docs\] {2}no card/, 'the task stays open and ready after its card left');
  const old = 'task_b2 Fix the release notes';
  writeFileSync(join(root, LEDGER), `${readFileSync(join(root, LEDGER), 'utf8')}${[['offered', 'writes: CHANGES.md; topic: docs; priority: P1; repro: steps'], ['dismissed gone', 'the queue pushed it out']].map(([result, evidence]) => ['2026-01-01T10:00:00Z', 'chip', old, 'why', evidence, result].join('\t')).join('\n')}\n`);
  spawnSync('git', ['-C', root, 'add', LEDGER]);
  spawnSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'ledger']);
  const reopened = chip(old, 'reopened');
  assert.equal(reopened.status, 0, `a task an older run closed as gone comes back: ${reopened.stderr}`);
  assert.match(chips().stdout, /task_b2 {2}Fix the release notes/);
  assert.match(chip('task_a1 Fix the stale badge', 'reopened').stderr, /task_a1 is offered, so it cannot be reopened/, 'only a gone task reopens');
  assert.equal(chip('task_c3 Rewrite the install guide', 'dismissed declined: the owner dismissed its card').status, 0, 'a card the owner dismissed closes its task');
  assert.doesNotMatch(chips().stdout, /task_c3/);
  assert.match(chip('task_c3 Rewrite the install guide', 'reopened').stderr, /task_c3 is dismissed declined, so it cannot be reopened/, 'a declined task stays closed');
});

test('decisions-check reopens a dup the owner calls separate work and takes it off the kept task', () => {
  const { chip, chips, offer } = chipLedger();
  const badge = 'task_a1 Fix the stale badge';
  assert.equal(offer(badge).status, 0);
  assert.equal(offer('task_c3 Rewrite the install guide', 'docs/install.md').status, 0);
  assert.equal(chip(badge, 'dismissed dup task_c3: the guide rewrite fixes the badge too').status, 0);
  assert.match(chips('brief', 'task_c3').stdout, /Also covers:\n- task_a1 /);
  const reopened = chip(badge, 'reopened', 'the owner says the badge is separate work');
  assert.equal(reopened.status, 0, reopened.stderr);
  assert.doesNotMatch(chips('brief', 'task_c3').stdout, /- task_a1 /, 'the kept task no longer covers it');
  assert.match(chips().stdout, /task_a1 {2}Fix the stale badge/, 'the reopened task is back on the board');
  const apart = chip(badge, 'apart', 'from: task_c3');
  assert.equal(apart.status, 0, apart.stderr);
});

test('decisions-check takes a later chip row only for a task in the state it leaves, and a dup only of a live task', () => {
  const { chip, offer } = chipLedger();
  assert.equal(offer('task_a1 Fix the stale badge').status, 0);
  assert.equal(offer('task_c3 Rewrite the install guide', 'docs/install.md').status, 0);
  assert.equal(chip('task_a1 Fix the stale badge', 'dismissed').status, 1, 'a dismissal with no reason');
  assert.equal(chip('task_a1 Fix the stale badge', 'dismissed later').status, 1, 'a reason outside the list');
  assert.match(chip('task_z9 Fix the stale badge', 'dismissed done').stderr, /task_z9 has no offered chip row/, 'a task never offered');
  assert.equal(chip('task_a1 Fix the stale badge', 'dismissed dup task_q7').status, 1, 'a duplicate of a task never offered');
  assert.match(chip('task_a1 Fix the stale badge', 'dismissed dup task_a1').stderr, /task_a1 must be another task/, 'a duplicate of itself');
  assert.match(chip('task_a1 Fix the badge', 'dismissed done').stderr, /every later row repeats that decision/, 'a later row that renames the task');
  assert.match(chip('task_a1 Fix the stale badge', 'updated', 'because').stderr, /names what changes/, 'an update that changes nothing');
  assert.equal(chip('task_a1 Fix the stale badge', 'dismissed dup task_c3: the guide rewrite fixes the badge too').status, 0);
  assert.match(chip('task_a1 Fix the stale badge', 'started').stderr, /task_a1 is dismissed dup, so it cannot be started/, 'a closed task that starts');
  assert.match(chip('task_c3 Rewrite the install guide', 'dismissed dup task_a1').stderr, /task_a1 must be another task the ledger holds as offered;/, 'a duplicate of a closed task');
});

test('decisions-check closes a started task by landing or by a dismissal that fits a started task', () => {
  const { chip, offer } = chipLedger();
  const badge = 'task_a1 Fix the stale badge';
  assert.equal(offer(badge).status, 0);
  assert.equal(chip(badge, 'started').status, 0);
  assert.equal(chip(badge, 'dismissed done').status, 1, 'done for a started task, which lands instead');
  assert.match(chip(badge, 'uncarded').stderr, /task_a1 is started, so it cannot be uncarded/, 'a card row for a task the owner started');
  assert.equal(chip(badge, 'dismissed stopped: the owner closed the session').status, 0);
  const ledger = 'task_b2 Design the export ledger (xhigh)';
  assert.equal(offer(ledger, 'src/export', 'topic: export; kind: decide').status, 0);
  assert.match(chip(ledger, 'dismissed stopped').stderr, /task_b2 is offered, so it cannot be dismissed stopped/, 'stopped for a task nobody started');
  assert.equal(chip(ledger, 'started').status, 0);
  for (const reason of ['superseded', 'dup task_a1', 'done']) {
    assert.match(chip(ledger, `dismissed ${reason}`).stderr, /task_b2 is started, so it cannot be dismissed/, `${reason} for a task whose session may still be writing`);
  }
  assert.equal(offer('task_e5 Add a CSV export', 'src/export/csv.ts').status, 0);
  assert.match(chip('task_e5 Add a CSV export', 'dismissed dup task_b2').stderr, /task_b2 is started, and a dup moves work only into an offered task; keep task_e5 open, log updated with its waits plus task:task_b2, and log dismissed done once task_b2 lands with the fix/, 'an offered task a started task covers');
  assert.equal(chip('task_e5 Add a CSV export', 'updated', 'waits: task:task_b2').status, 0, 'the route the refusal names');
});

test('a started row may add a project path another started task writes, but not a path outside the checkout', () => {
  const { chip, offer, outside } = chipLedger();
  const reader = 'task_a1 Fix the reader';
  const writer = 'task_b2 Fix the writer';
  assert.equal(offer(reader, `src/a.ts, ${outside('rule.md')}`).status, 0);
  assert.equal(offer(writer, 'src/b.ts').status, 0);
  assert.equal(chip(reader, 'started').status, 0);
  assert.equal(chip(writer, 'started').status, 0);
  assert.equal(chip(writer, 'started', 'writes: src/a.ts').status, 0, 'each card session edits project paths in its own worktree');
  assert.match(chip(writer, 'started', `writes: ${outside('rule.md')}`).stderr, /task_b2 cannot add a path outside this checkout that task_a1, also started, writes/, "a widening into another repository a running session edits in place");
  assert.equal(chip(writer, 'started', `writes: ${outside('other.md')}`).status, 0, 'a widening onto a free outside path');
});

test('decisions-check refuses a write path that is a glob, quoted or ends in punctuation', () => {
  const { offer } = chipLedger();
  for (const path of ['packages/*/src', 'src/**', '`docs/x.md`', 'README.md.', '"docs/x.md"']) {
    assert.match(offer('task_a1 Fix the stale badge', path).stderr, /no whitespace, glob, quote/, path);
  }
});

test('chips names the open tasks that share a ready task\'s paths, compared by where they point, and holds back only a path outside the checkout', () => {
  const { chips, offer, outside, root } = chipLedger();
  mkdirSync(join(root, 'deep/dir'), { recursive: true });
  writeFileSync(join(root, 'deep/x.txt'), 'deep');
  writeFileSync(join(root, 'x.txt'), 'top');
  symlinkSync(join(root, 'deep/dir'), join(root, 'link'));
  assert.equal(offer('task_a1 Fix the stale badge').status, 0);
  assert.equal(offer('task_a2 Fix the deep file', 'deep/x.txt').status, 0);
  const aliases = ['./README.md', 'docs/../README.md', join(root, 'README.md'), 'readme.md', 'link/../x.txt'];
  for (const [index, alias] of aliases.entries()) assert.equal(offer(`task_b${index} Rewrite the file`, alias).status, 0, alias);
  assert.equal(offer('task_c1 Fix the top file', 'x.txt').status, 0);
  const board = chips().stdout;
  assert.match(board, /Ready, P1 \(8\)/, 'a shared project path holds no task back');
  for (const index of aliases.keys()) assert.match(board, new RegExp(`task_b${index} {2}Rewrite the file {2}\\[docs\\] {2}no card {2}shares paths with [^\\n]*task_a[12]`), aliases[index]);
  assert.match(board, /task_b4 {2}Rewrite the file {2}\[docs\] {2}no card {2}shares paths with task_a2\n/, 'the kernel follows link before .. steps out of it');
  assert.match(board, /task_c1 {2}Fix the top file {2}\[docs\] {2}no card\n/, 'the top-level file is another file than deep/x.txt');
  assert.match(board, /card task_b0: it can start and has no card; first judge whether it needs the result of another open task, starting with task_a1, task_b1, task_b2, task_b3, which write its paths, or of an open design question/);
  assert.equal(offer('task_d1 Fix the shared rule', outside('rule.md')).status, 0);
  assert.equal(offer('task_d2 Reword the shared rule', outside('../shared/rule.md')).status, 0);
  assert.match(chips().stdout, /task_d2 {2}Reword the shared rule {2}\[docs\] {2}waits on queued behind task_d1, which writes the same paths outside this checkout/, 'another repository is edited in place');
});

test('chips clears each kind of wait without a new row: a merged PR, a closed task, a done plan', () => {
  const { chip, chips, merge, offer, root } = chipLedger();
  merge('Merge pull request #12 from a/badge');
  merge('Fix the parser (#14)');
  writeFileSync(join(root, 'docs/plans/2026-01-01-pivot.md'), '# Pivot\n\nStatus: building: the ledger\n');
  assert.equal(offer('task_a1 Fix the stale badge', 'README.md', 'topic: docs; waits: pr:12').status, 0);
  assert.equal(offer('task_a2 Fix the parser', 'src/p.ts', 'topic: parser; waits: pr:14').status, 0);
  assert.equal(offer('task_a3 Fix the printer', 'src/q.ts', 'topic: parser; waits: pr:140').status, 0);
  assert.equal(offer('task_b1 Fix the guide', 'docs/guide.md', 'topic: docs; waits: task:task_a1').status, 0);
  assert.equal(offer('task_c1 Fix the lexer', 'src/l.ts', 'topic: lexer; waits: run:docs/plans/2026-01-01-pivot.md').status, 0);
  assert.equal(offer('task_d1 Fix the linter', 'src/n.ts', 'topic: lint; waits: task:task_z9').status, 0);
  let board = chips();
  assert.match(board.stdout, /task_a1 {2}Fix the stale badge {2}\[docs\] {2}no card/, 'a merge commit for its PR');
  assert.match(board.stdout, /task_a2 {2}Fix the parser {2}\[parser\] {2}no card/, 'a squash commit for its PR');
  assert.match(board.stdout, /task_a3 {2}Fix the printer {2}\[parser\] {2}waits on pr:140 not merged/, '#14 is not #140');
  assert.match(board.stdout, /task_b1 {2}Fix the guide {2}\[docs\] {2}waits on task:task_a1 offered/);
  assert.match(board.stdout, /task_c1 {2}Fix the lexer {2}\[lexer\] {2}waits on run:docs\/plans\/2026-01-01-pivot\.md active/);
  assert.match(board.stdout, /fix task_d1's wait: task:task_z9 dangling/, 'a wait on a task the ledger never held');
  assert.equal(board.status, 1, 'a dangling wait is a problem');
  assert.equal(chip('task_a1 Fix the stale badge', 'started').status, 0);
  assert.equal(chip('task_a1 Fix the stale badge', 'landed').status, 0);
  writeFileSync(join(root, 'docs/plans/2026-01-01-pivot.md'), '# Pivot\n\nStatus: executed\n');
  board = chips();
  assert.match(board.stdout, /task_b1 {2}Fix the guide {2}\[docs\] {2}no card/, 'the task it waited on landed');
  assert.match(board.stdout, /task_c1 {2}Fix the lexer {2}\[lexer\] {2}no card/, 'the plan it waited on is executed');
  assert.equal(offer('task_e1 Fix the theme', 'src/t.ts', 'topic: theme').status, 0);
  assert.equal(offer('task_e2 Fix the theme docs', 'docs/theme.md', 'topic: theme; waits: task:task_e1').status, 0);
  assert.equal(chip('task_e1 Fix the theme', 'dismissed superseded: the theme was removed').status, 0);
  writeFileSync(join(root, 'docs/plans/2026-01-02-dropped.md'), '# Dropped\n\nStatus: cancelled: the owner dropped it\n');
  assert.equal(offer('task_f1 Fix the router', 'src/r.ts', 'topic: router; waits: run:docs/plans/2026-01-02-dropped.md').status, 0);
  board = chips();
  assert.match(board.stdout, /fix task_e2's wait: task:task_e1 closed as dismissed superseded without its result/, 'a task it waited on closed without landing');
  assert.match(board.stdout, /fix task_f1's wait: run:docs\/plans\/2026-01-02-dropped\.md closed without its result/, 'a plan it waited on was cancelled');
  assert.equal(board.status, 1);
});

const daysAgo = (days) => new Date(Date.now() - days * 86_400_000).toISOString();
const LOG_HEADER = 'ts\tphase\tdecision\twhy\tevidence\tresult\n';
const planRow = (when) => `${when}\tbuild\tStep\twhy\tscope: x\tdone\n`;
const commitAt = (root, days, ...paths) => {
  const when = daysAgo(days);
  spawnSync('git', ['-C', root, 'add', ...paths]);
  spawnSync('git', ['-C', root, 'commit', '-qm', `touch ${paths[0]}`], { env: { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } });
};

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
  assert.equal(offer('task_a1 Fix the lexer', 'src/l.ts', `topic: lexer; waits: run:${parser}`).status, 0);
  assert.equal(offer('task_a2 Fix the cache', 'src/c.ts', `topic: cache; waits: run:${parser}, run:${cache}, pr:12`).status, 0);
  assert.equal(offer('task_b1 Fix the docs', 'docs/d.md', `topic: docs; waits: run:${fresh}`).status, 0);
  assert.equal(offer('task_c1 Fix the theme', 'src/t.ts', `topic: theme; waits: run:${recent}`).status, 0);
  assert.equal(offer('task_d1 Fix the phone lane', 'src/p.ts', `topic: phone; waits: run:${phone}`).status, 0);
  assert.equal(offer('task_e1 Fix the router', 'src/r.ts', `topic: router; waits: run:${go}`).status, 0);
  let board = chips();
  assert.match(board.stdout, /task_a1 {2}Fix the lexer {2}\[lexer\] {2}waits on run:docs\/plans\/2026-01-01-parser\.md stale, idle since \d{4}-\d{2}-\d{2}\n/);
  assert.match(board.stdout, /task_b1 {2}Fix the docs {2}\[docs\] {2}waits on run:docs\/plans\/2026-01-03-fresh\.md active\n/, "a row in another checkout's copy of its log keeps a plan fresh");
  assert.match(board.stdout, /task_c1 {2}Fix the theme {2}\[theme\] {2}waits on run:docs\/plans\/2026-01-04-recent\.md active\n/, 'six idle days are not a week');
  assert.match(board.stdout, /task_d1 {2}Fix the phone lane {2}\[phone\] {2}waits on run:docs\/plans\/2026-01-05-phone\.md waits on you, idle since \d{4}-\d{2}-\d{2}\n/);
  assert.match(board.stdout, /Stale plans \(4\)\n {2}docs\/plans\/2026-01-05-phone\.md {2}idle 20 days {2}waits on you: planning: waiting on you to buy a phone {2}task_d1 waits on it\n/, 'a plan that waits on the owner leads the list');
  assert.match(board.stdout, /\n {2}docs\/plans\/2026-01-01-parser\.md {2}idle 10 days {2}building: step 2 {2}task_a1 and task_a2 wait on it\n/);
  const offers = [...board.stdout.matchAll(/append chip "(t_[0-9a-f]+ [^"]+)" "([^"]+)" "([^"]+)" offered/gu)];
  assert.equal(offers.length, 2, 'one verdict per review scope, and none for the plan that waits on the owner');
  assert.match(board.stdout, /offer one verdict on review scope parser for the stale plans docs\/plans\/2026-01-01-parser\.md and docs\/plans\/2026-01-02-parser-cache\.md, which task_a1 and task_a2 wait on: append chip "t_[0-9a-f]+ Decide parser again instead of resuming its plans \(xhigh\)"/);
  assert.match(board.stdout, /offer one verdict for the stale plan docs\/plans\/2026-01-06-go\.md, which task_e1 waits on: append chip "t_[0-9a-f]+ Decide again whether to resume the go plan \(xhigh\)"/, "a Status that has the owner's go waits on nobody");
  assert.equal(board.status, 0, 'a stale plan is ledger work, not a problem');
  const misrouted = helper('append', LEDGER, 'chip', 'task_f1 Fix the stale parser', 'why', 'writes: src/x.ts; topic: x; priority: P2; via: stale', 'offered');
  assert.match(misrouted.stderr, /via: stale goes only on a kind: decide offer/);
  writeFileSync(join(root, go), "# 2026-01-06-go\n\nStatus: building: phase 1, on the owner's go\n\nStep 2 started.\n");
  commitAt(root, 0, go);
  assert.match(chips().stdout, /task_e1 {2}Fix the router {2}\[router\] {2}waits on run:docs\/plans\/2026-01-06-go\.md active\n/, 'a new commit makes a stale plan fresh again');
  const [, decision, finding, tokens] = offers.find(([, each]) => each.includes('Decide parser'));
  assert.match(tokens, /^writes: docs\/plans\/2026-01-01-parser\.md, docs\/plans\/2026-01-02-parser-cache\.md, docs\/scopes\/parser\.json; topic: review-parser; kind: decide; priority: P2; via: stale; review-scope: parser; session: none$/);
  const offered = helper('append', LEDGER, 'chip', decision, finding, tokens, 'offered');
  assert.equal(offered.status, 0, offered.stderr);
  const verdict = decision.split(' ')[0];
  board = chips();
  assert.match(board.stdout, new RegExp(`move task_a1's waits on stale plans to their fresh verdict: log updated with waits: task:${verdict}\\n`));
  assert.match(board.stdout, new RegExp(`move task_a2's waits on stale plans to their fresh verdict: log updated with waits: task:${verdict}, pr:12\\n`), 'one row moves both waits and keeps the rest');
  assert.equal(batch([['task_a1 Fix the lexer', 'updated', `waits: task:${verdict}`], ['task_a2 Fix the cache', 'updated', `waits: task:${verdict}, pr:12`]]).status, 0);
  board = chips();
  assert.match(board.stdout, new RegExp(`task_a1 {2}Fix the lexer {2}\\[lexer\\] {2}waits on task:${verdict} offered\\n`));
  assert.match(board.stdout, /Stale plans \(1\)\n {2}docs\/plans\/2026-01-05-phone\.md/, 'a plan no task waits on leaves the list');
  assert.doesNotMatch(board.stdout, new RegExp(`card ${verdict}:`), 'only /chips all cards a verdict that names session: none');
  assert.equal(offer('task_g1 Fix the guide', 'docs/g.md', 'topic: guide').status, 0);
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
  assert.equal(offerHere('task_a1 Follow the old plan', `writes: docs/guide.md; topic: follow; waits: run:${path}`).status, 0);
  const stale = helper('chips');
  assert.match(stale.stdout, /waits on run:docs\/plans\/2026-01-01-old\.md stale, idle since \d{4}-\d{2}-\d{2}\n/, stale.stderr);
  mkdirSync(join(worktree, 'docs/plans'), { recursive: true });
  writeFileSync(join(worktree, log), LOG_HEADER + planRow(daysAgo(0)));
  assert.match(helper('chips').stdout, /waits on run:docs\/plans\/2026-01-01-old\.md active\n/, 'an uncommitted row in a worktree is activity');
  const only = 'docs/plans/2026-01-02-only.md';
  const onlyLog = 'docs/plans/2026-01-02-only.decisions.tsv';
  writeFileSync(join(worktree, only), '# Only\n\nStatus: building: step 1\n');
  writeFileSync(join(worktree, onlyLog), LOG_HEADER + planRow(daysAgo(9)));
  assert.equal(offerHere('task_b1 Follow the worktree plan', `writes: docs/other.md; topic: other; waits: run:${only}`).status, 0);
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

const stalePlanLedger = (config = {}, files = {}) => {
  const ledger = chipLedger({ config: { chips: { scopes: 'docs/scopes', ...config }, pageTopic: { field: 'review_scopes' } }, files: { 'docs/scopes/parser.json': '{}\n', ...files } });
  const stalePlan = (name, scope, days = 10) => {
    const path = `docs/plans/${name}.md`;
    writeFileSync(join(ledger.root, path), `---\nreview_scopes: [${scope}]\n---\n\n# ${name}\n\nStatus: building: step 2\n`);
    commitAt(ledger.root, days, path);
    return path;
  };
  const timed = (args) => spawnSync(process.execPath, [join(HELPERS, 'decisions-check.mjs'), ...args], { cwd: ledger.root, encoding: 'utf8', env: ledger.env, timeout: 30_000 });
  return { ...ledger, stalePlan, timed };
};

test('append takes the move of a P0 task onto a stale plan verdict in a later tier, without looping', () => {
  const tiers = [{ name: 'core', paths: ['src/'] }, { name: 'feature' }, { name: 'late', scopes: ['late'] }];
  const { LEDGER, offer, stalePlan, timed } = stalePlanLedger({ tiers }, { 'docs/scopes/late.json': '{}\n' });
  const path = stalePlan('2026-01-01-late', 'late');
  assert.equal(offer('task_a1 Repair the citations', 'src/c.ts', `topic: citations; priority: P0; repro: steps; waits: run:${path}`).status, 0);
  const verdict = offer('task_v1 Decide late again', `${path}, docs/scopes/late.json`, 'topic: review-late; kind: decide; priority: P2; via: stale; review-scope: late; session: none');
  assert.equal(verdict.status, 0, verdict.stderr);
  const board = timed(['chips']);
  assert.equal(board.signal, null, 'the board read ends');
  assert.match(board.stdout, /move task_a1's waits on stale plans to their fresh verdict: log updated with waits: task:task_v1\n/);
  const moved = timed(['append', LEDGER, 'chip', 'task_a1 Repair the citations', 'why', 'waits: task:task_v1', 'updated']);
  assert.equal(moved.signal, null, 'append ends');
  assert.equal(moved.status, 0, moved.stderr);
});

test("a stale plan folds into the open design question of its scope's topic, and its waits move there", () => {
  const { batch, chip, chips, offer, stalePlan } = stalePlanLedger();
  const first = stalePlan('2026-01-01-parser', 'parser');
  const second = stalePlan('2026-01-02-parser-cache', 'parser');
  assert.equal(offer('task_q1 Settle the parser fork', 'docs/scopes/parser.json', 'topic: review-parser; kind: decide; priority: P2; via: verdict; review-scope: parser').status, 0);
  assert.equal(offer('task_a1 Fix the lexer', 'src/l.ts', `topic: lexer; waits: run:${first}`).status, 0);
  assert.equal(offer('task_a2 Fix the cache', 'src/c.ts', `topic: cache; waits: run:${second}`).status, 0);
  let board = chips();
  assert.doesNotMatch(board.stdout, /offer one verdict/, 'the topic already holds its design question');
  assert.match(board.stdout, /fold the stale plans docs\/plans\/2026-01-01-parser\.md and docs\/plans\/2026-01-02-parser-cache\.md into task_q1, the open design question in review-parser: log folded with writes: docs\/plans\/2026-01-01-parser\.md, docs\/plans\/2026-01-02-parser-cache\.md\n/);
  const folded = chip('task_q1 Settle the parser fork', 'folded', `writes: ${first}, ${second}`);
  assert.equal(folded.status, 0, folded.stderr);
  board = chips();
  assert.match(board.stdout, /move task_a1's waits on stale plans to their fresh verdict: log updated with waits: task:task_q1\n/);
  assert.match(board.stdout, /move task_a2's waits on stale plans to their fresh verdict: log updated with waits: task:task_q1\n/);
  const moved = batch([['task_a1 Fix the lexer', 'updated', 'waits: task:task_q1'], ['task_a2 Fix the cache', 'updated', 'waits: task:task_q1']]);
  assert.equal(moved.status, 0, moved.stderr);
  assert.doesNotMatch(chips().stdout, /Stale plans/);
});

test('a design question that waits on a stale plan of its own scope drops that wait and becomes its verdict', () => {
  const { chip, chips, offer, stalePlan } = stalePlanLedger();
  const path = stalePlan('2026-01-01-parser', 'parser');
  assert.equal(offer('task_q1 Settle the parser fork', `${path}, docs/scopes/parser.json`, `topic: review-parser; kind: decide; priority: P2; via: verdict; review-scope: parser; waits: run:${path}, pr:12`).status, 0);
  assert.equal(offer('task_a1 Fix the lexer', 'src/l.ts', `topic: lexer; waits: run:${path}`).status, 0);
  const board = chips();
  assert.doesNotMatch(board.stdout, /offer one verdict/);
  assert.match(board.stdout, /move task_q1's waits on stale plans to their fresh verdict: log updated with waits: pr:12\n/, 'the verdict waits on the plan it decides no longer');
  assert.match(board.stdout, /move task_a1's waits on stale plans to their fresh verdict: log updated with waits: task:task_q1\n/);
  assert.equal(chip('task_q1 Settle the parser fork', 'updated', 'waits: pr:12').status, 0);
});

test("a stale plan whose verdict waits back on the plan's waiter is a problem, not a move append refuses", () => {
  const { chips, offer, stalePlan } = stalePlanLedger();
  const path = stalePlan('2026-01-01-parser', 'parser');
  assert.equal(offer('task_a1 Fix the lexer', 'src/l.ts', `topic: lexer; waits: run:${path}`).status, 0);
  assert.equal(offer('task_v1 Decide parser again', `${path}, docs/scopes/parser.json`, 'topic: review-parser; kind: decide; priority: P2; via: stale; review-scope: parser; session: none; waits: task:task_a1').status, 0);
  const board = chips();
  assert.doesNotMatch(board.stdout, /move task_a1's waits/);
  assert.match(board.stdout, /fix task_a1's wait: run:docs\/plans\/2026-01-01-parser\.md is stale, and its verdict task_v1 waits back on task_a1; log updated with the waits it has now\n/);
  assert.equal(board.status, 1);
});

test("a stale plan's own started run is no verdict, so the ledger pass offers one", () => {
  const { LEDGER, chips, offer, root, stalePlan } = stalePlanLedger();
  const path = stalePlan('2026-01-01-own', 'parser');
  assert.equal(offer('task_r1 Build the own plan', path, 'topic: own; kind: decide; priority: P2; via: verdict; review-scope: none').status, 0);
  appendFileSync(join(root, LEDGER), `${daysAgo(12)}\tchip\ttask_r1 Build the own plan\twhy\tsession: s1\tstarted\n`);
  assert.equal(offer('task_a1 Fix the lexer', 'src/l.ts', `topic: lexer; waits: run:${path}`).status, 0);
  const board = chips();
  assert.doesNotMatch(board.stdout, /move task_a1's waits/, 'the run that wrote the plan is not its fresh verdict');
  assert.match(board.stdout, /offer one verdict on review scope parser for the stale plan docs\/plans\/2026-01-01-own\.md/);
  appendFileSync(join(root, LEDGER), `${daysAgo(9)}\tchip\ttask_r1 Build the own plan\twhy\tsession: s1; owns: src/own.ts\tstarted\n`);
  assert.match(chips().stdout, /offer one verdict on review scope parser for the stale plan docs\/plans\/2026-01-01-own\.md/, 'a later started row on the same run keeps its first start');
});

test("a stale plan's own run that still holds its scope's topic is settled before the fresh verdict", () => {
  const { LEDGER, chip, chips, offer, root, stalePlan } = stalePlanLedger();
  const path = stalePlan('2026-01-01-parser', 'parser');
  assert.equal(offer('task_r1 Build the parser plan', `${path}, docs/scopes/parser.json`, 'topic: review-parser; kind: decide; priority: P2; via: verdict; review-scope: parser').status, 0);
  appendFileSync(join(root, LEDGER), `${daysAgo(12)}\tchip\ttask_r1 Build the parser plan\twhy\tsession: s1\tstarted\n`);
  assert.equal(offer('task_a1 Fix the lexer', 'src/l.ts', `topic: lexer; waits: run:${path}`).status, 0);
  let board = chips();
  assert.doesNotMatch(board.stdout, /move task_a1's waits/);
  assert.match(board.stdout, /settle task_r1, the started run that wrote the stale plan docs\/plans\/2026-01-01-parser\.md and still holds review-parser: log landed with the commit that holds its change, or dismissed stopped when none does\n/);
  assert.equal(chip('task_r1 Build the parser plan', 'dismissed stopped').status, 0);
  board = chips();
  assert.match(board.stdout, /offer one verdict on review scope parser for the stale plan docs\/plans\/2026-01-01-parser\.md/);
});

test("a carded design question in a stale plan's topic takes none of its waits, and the fresh verdict waits on it", () => {
  const { LEDGER, chips, helper, offer, stalePlan } = stalePlanLedger();
  const path = stalePlan('2026-01-01-parser', 'parser');
  assert.equal(offer('task_q1 Choose the parser API', 'docs/scopes/parser.json', 'topic: review-parser; kind: decide; priority: P2; via: verdict; review-scope: parser; card: c1; session: s1').status, 0);
  assert.equal(offer('task_a1 Fix the lexer', 'src/l.ts', `topic: lexer; waits: run:${path}`).status, 0);
  let board = chips();
  assert.doesNotMatch(board.stdout, /move task_a1's waits/, 'a question that cannot take the plan takes none of its waits');
  const [, decision, finding, tokens] = board.stdout.match(/append chip "(t_[0-9a-f]+ [^"]+)" "([^"]+)" "([^"]+)" offered/) ?? [];
  assert.match(tokens ?? '', /; waits: task:task_q1; session: none$/);
  const offered = helper('append', LEDGER, 'chip', decision, finding, tokens, 'offered');
  assert.equal(offered.status, 0, offered.stderr);
  board = chips();
  assert.match(board.stdout, new RegExp(`move task_a1's waits on stale plans to their fresh verdict: log updated with waits: task:${decision.split(' ')[0]}\\n`));
});

test('two moves that would close a loop in one pass print one move and one problem, and the move appends', () => {
  const { batch, chips, offer, stalePlan } = stalePlanLedger({}, { 'docs/scopes/lexer.json': '{}\n' });
  const parser = stalePlan('2026-01-01-parser', 'parser', 12);
  const lexer = stalePlan('2026-01-02-lexer', 'lexer', 10);
  assert.equal(offer('task_x1 Decide the parser', `${parser}, docs/scopes/parser.json`, `topic: review-parser; kind: decide; priority: P2; via: verdict; review-scope: parser; waits: run:${lexer}`).status, 0);
  assert.equal(offer('task_y1 Decide the lexer', `${lexer}, docs/scopes/lexer.json`, `topic: review-lexer; kind: decide; priority: P2; via: verdict; review-scope: lexer; waits: run:${parser}`).status, 0);
  const board = chips();
  const moves = [...board.stdout.matchAll(/move (task_\w+)'s waits on stale plans/gu)].map((match) => match[1]);
  assert.deepEqual(moves, ['task_y1'], board.stdout);
  assert.match(board.stdout, /move task_y1's waits on stale plans to their fresh verdict: log updated with waits: task:task_x1\n/);
  assert.match(board.stdout, /fix task_x1's wait: run:docs\/plans\/2026-01-02-lexer\.md is stale, and its verdict task_y1 waits back on task_x1/);
  const moved = batch([['task_y1 Decide the lexer', 'updated', 'waits: task:task_x1']]);
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
  assert.equal(offer('task_a1 Fix the lexer', 'src/l.ts', `topic: lexer; waits: run:${join(nested, path)}`).status, 0);
  assert.match(chips().stdout, /task_a1 {2}Fix the lexer {2}\[lexer\] {2}waits on run:\S+2026-01-01-parser\.md active\n/);
});

test('an absolute path to a plan in the project reads the activity of every checkout of its log', () => {
  const { chips, dir, offer, root, stalePlan } = stalePlanLedger();
  const path = stalePlan('2026-01-01-parser', 'parser');
  const log = 'docs/plans/2026-01-01-parser.decisions.tsv';
  const worktree = join(dir, 'wt');
  spawnSync('git', ['-C', root, 'worktree', 'add', '-q', '--detach', worktree]);
  writeFileSync(join(worktree, log), LOG_HEADER + planRow(daysAgo(1)));
  assert.equal(offer('task_a1 Fix the lexer', 'src/l.ts', `topic: lexer; waits: run:${join(root, path)}`).status, 0);
  assert.match(chips().stdout, /task_a1 {2}Fix the lexer {2}\[lexer\] {2}waits on run:\S+2026-01-01-parser\.md active\n/);
});

test('chips sync withdraws no card the card pass would offer again', () => {
  const { chip, chips, offer } = chipLedger();
  const parser = 'task_c1 Fix the parser (xhigh)';
  assert.equal(offer(parser, 'src/p.ts', 'topic: parser; card: c1; session: s1').status, 0);
  assert.equal(chip(parser, 'updated', 'effort: high').status, 0);
  assert.match(chips('--session', 's1').stdout, /withdraw task_c1's card c1/);
  assert.doesNotMatch(chips('sync', '--session', 's1').stdout, /withdraw task_c1's card c1/);
  const blocked = 'task_d1 Fix the printer';
  assert.equal(offer(blocked, 'src/q.ts', 'topic: printer; card: d1; session: s1').status, 0);
  assert.equal(chip(blocked, 'updated', 'waits: pr:99').status, 0);
  assert.match(chips('sync', '--session', 's1').stdout, /withdraw task_d1's card d1: pr:99 not merged/, 'a card on a task that cannot start is still withdrawn');
});

test('decisions-check cards only a task that can start, and a waiting task reserves no paths', () => {
  const { chip, chips, offer, outside } = chipLedger();
  assert.equal(offer('task_a1 Rewrite the docs', 'docs', 'topic: docs; waits: pr:99').status, 0);
  const waiting = chip('task_a1 Rewrite the docs', 'carded', 'card: task_x1; session: s1');
  assert.equal(waiting.status, 1, 'a card for a task whose PR has not merged');
  assert.match(waiting.stderr, /task_a1 cannot start yet \(pr:99 not merged\), so it gets no card/);
  const inside = offer('task_a2 Fix the guide', 'docs/guide.md', 'topic: docs; card: task_x2; session: s1');
  assert.equal(inside.status, 0, `a ready task inside the waiting task's directory gets a card at once: ${inside.stderr}`);
  assert.equal(offer('task_b1 Fix the reader', `src/r.ts, ${outside('io.md')}`, 'topic: io').status, 0);
  assert.equal(chip('task_b1 Fix the reader', 'started').status, 0);
  assert.equal(offer('task_b2 Speed up the reader', 'src/r.ts', 'topic: io; card: task_x3; session: s1').status, 0, 'a card beside a started session on the same project path');
  assert.match(offer('task_b3 Document the reader', outside('io.md'), 'topic: io; card: task_x4; session: s1').stderr, /started task_b1 writes its paths outside this checkout/, 'a card for a task a started session blocks in another repository');
  assert.equal(chip('task_a2 Fix the guide', 'uncarded', 'card: task_x2').status, 0);
  assert.match(chips().stdout, /card task_a2: it can start and has no card/, 'the sweep lists a ready task without a card');
});

test('decisions-check holds one open design question per topic and folds the next finding into it', () => {
  const { chip, chips, offer, root } = chipLedger();
  const landing = 'task_a1 Decide where pasted content lands (xhigh)';
  assert.equal(offer(landing, 'src/core', 'topic: landing; kind: decide').status, 0);
  assert.match(offer('task_a2 Decide where dropped content lands (xhigh)', 'src/core', 'topic: landing; kind: decide').stderr, /topic landing already has the open design question task_a1; log this finding as a folded row on task_a1/);
  assert.equal(offer('task_a3 Fix the drop indicator', 'src/ui', 'topic: landing').status, 0, 'a plain fix in the same topic');
  assert.equal(offer('task_b1 Decide the export format (xhigh)', 'src/export', 'topic: export; kind: decide').status, 0, 'a design question in another topic');
  assert.equal(chip(landing, 'folded', 'writes: src/drop').status, 0);
  assert.match(chips('brief', 'task_a1').stdout, /^\[P1\] Decide where pasted content lands \(xhigh\)\n\nTopic: landing\.[\s\S]*Findings:\n- why\n- why\nWrites: src\/core, src\/drop[\s\S]*settles a design question first[\s\S]*\n\nSuggested task task_a1 in docs\/plans\/suggested-tasks\.decisions\.tsv of the project checkout [^\n]*\n?$/);
  assert.match(chips('id').stdout, /^t_[0-9a-f]{8}\n$/u);
  assert.match(chips('--fetch', 'id').stdout, /^t_[0-9a-f]{8}\n$/u, 'a flag before the id command');
  const raced = 'docs/plans/raced.decisions.tsv';
  writeFileSync(join(root, raced), `ts\tphase\tdecision\twhy\tevidence\tresult\n${['task_f1 Decide the badge', 'task_f2 Decide the badge link'].map((decision) => ['2026-01-01T10:00:00Z', 'chip', decision, 'why', 'writes: README.md; topic: badge; kind: decide', 'offered'].join('\t')).join('\n')}\n`);
  const folded = chips(raced);
  assert.equal(folded.status, 1, 'two design questions in one topic that append never checked together');
  assert.match(folded.stdout, /fold topic badge: task_f1 and task_f2 are both open design questions/);
});

test('decisions-check refuses a base-red row until an open suggested task owns that check', () => {
  const { appendTo, chip, offer } = chipLedger();
  const log = 'docs/plans/2026-01-01-fix.decisions.tsv';
  const blame = () => appendTo(log, 'verify', 'read CI', 'base-red: ci:check; proof: none', 'gap: fails on next too');
  const refused = blame();
  assert.equal(refused.status, 1, 'a failure blamed on the base that no task owns');
  assert.match(refused.stderr, /base-red: ci:check has no open suggested task that owns it/);
  assert.equal(appendTo(log, 'verify', 'read CI', 'the check also fails on next; proof: none', 'gap: fails on next too').status, 0, 'prose names no check, so nothing reads it');
  const green = 'task_a1 Make next green (xhigh)';
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
    ['task_a1 Fix the stale badge', 'writes: README.md; topic: docs', 'offered'],
    ['task_b2 Design the export ledger (xhigh)', `writes: src/export, ${join(dir, 'shared/export')}; topic: export; kind: decide`, 'offered'],
    ['task_c3 Now: Rename the probe flag', 'writes: tooling/probe.mjs', 'offered'],
    ['task_a1 Fix the stale badge', 'README.md already links the live page', 'dismissed done'],
    ['task_b2 Design the export ledger (xhigh)', 'the owner started it', 'started'],
    ['task_g1 Fix the core', `writes: src/export/core.ts, ${join(dir, 'shared/export/core.md')}; topic: export`, 'offered'],
    ['task_g1 Fix the core', 'evidence', 'started'],
  ];
  writeFileSync(join(root, 'docs/plans/suggested-tasks.decisions.tsv'), `ts\tphase\tdecision\twhy\tevidence\tresult\n${rows.map(([decision, evidence, result]) => ['2026-01-01T10:00:00Z', 'chip', decision, 'why', evidence, result].join('\t')).join('\n')}\n`);
  const listed = chips();
  assert.equal(listed.status, 0, listed.stderr);
  assert.match(listed.stdout, /^3 open suggested tasks in docs\/plans\/suggested-tasks\.decisions\.tsv\./u);
  assert.match(listed.stdout, /Started \(2\)\n {2}task_b2 {2}Design the export ledger \(xhigh\) {2}\[export, decide\]\n {2}task_g1 {2}Fix the core {2}\[export\]/);
  assert.match(listed.stdout, /Unmigrated \(1\)\n {2}task_c3 {2}Rename the probe flag\n/, 'an old offer with no topic, its readiness tag stripped');
  assert.match(listed.stdout, /migrate task_c3: log updated with topic:/);
  assert.match(listed.stderr, /task_b2 and task_g1 are both started on an overlapping path outside this checkout/);
});

test('chips prints the started-overlap note on its own line when a late reader gets the board and the note through one pipe', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', { files: { 'docs/plans/.keep': '' } });
  const rows = Array.from({ length: 600 }, (_, n) => [`task_f${n} Fix the badge number ${n} on the page ${'x'.repeat(60)}`, `writes: src/f${n}.ts; topic: topic-${n}`, 'offered']);
  rows.push(
    ['task_s1 Design the export ledger (xhigh)', `writes: src/export, ${join(dir, 'shared/export')}; topic: export; kind: decide`, 'offered'],
    ['task_s1 Design the export ledger (xhigh)', 'evidence', 'started'],
    ['task_s2 Fix the core', `writes: src/export/core.ts, ${join(dir, 'shared/export/core.md')}; topic: export`, 'offered'],
    ['task_s2 Fix the core', 'evidence', 'started'],
  );
  writeFileSync(join(root, 'docs/plans/suggested-tasks.decisions.tsv'), ledgerRows(rows));
  const result = run('sh', ['-c', `"${process.execPath}" "${join(HELPERS, 'decisions-check.mjs')}" chips 2>&1 | (sleep 1; cat)`], root);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.length > 65_536, 'the board outgrows a pipe buffer');
  assert.match(result.stdout, /^task_s1 and task_s2 are both started on an overlapping path outside this checkout; the owner runs both$/mu);
});

const ledgerRows = (rows) => `ts\tphase\tdecision\twhy\tevidence\tresult\n${rows.map(([decision, evidence, result]) => ['2026-01-01T10:00:00Z', 'chip', decision, 'why', evidence, result].join('\t')).join('\n')}\n`;

test('the whole-log check leaves uncommitted old-form chip rows to the rules they were appended under', () => {
  const { LEDGER, helper, offer, root } = chipLedger();
  writeFileSync(join(root, LEDGER), ledgerRows([
    ['task_a1 After: Fix the stale badge (high)', 'writes: README.md', 'offered'],
    ['task_a2 Now: Fix the guide', 'writes: docs/guide.md', 'offered'],
    ['task_a2 Now: Fix the guide', 'the queue dropped it', 'dismissed gone'],
  ]));
  const checked = helper(LEDGER);
  assert.equal(checked.status, 0, `rows an older helper appended and nobody committed yet: ${checked.stderr}`);
  assert.match(offer('task_b1 After: Fix it').stderr, /no title says Now: or After:/, 'append still refuses the old form');
});

test('the whole-log check judges a row by the rows before it, never by later files or rules newer than the row', () => {
  const { LEDGER, chip, chips, helper, offer, root } = chipLedger();
  mkdirSync(join(root, 'src/a'), { recursive: true });
  assert.equal(offer('task_a1 Fix a', 'src/a', 'topic: a').status, 0);
  assert.equal(chip('task_a1 Fix a', 'started').status, 0);
  assert.equal(offer('task_b1 Fix b', 'src/b', 'topic: b').status, 0);
  assert.equal(chip('task_b1 Fix b', 'started', 'writes: alias').status, 0);
  assert.equal(chip('task_a1 Fix a', 'landed').status, 0);
  assert.equal(chip('task_b1 Fix b', 'landed').status, 0);
  symlinkSync('src/a', join(root, 'alias'));
  const linked = helper(LEDGER);
  assert.equal(linked.status, 0, `a path that later became a link to another task's path: ${linked.stderr}`);
  writeFileSync(join(root, LEDGER), ledgerRows([['task_c1 Fix c', 'writes: src/c.ts; topic: c; waits: task:task_c1', 'offered']]));
  const old = helper(LEDGER);
  assert.equal(old.status, 0, `a wait on itself that a helper without waits never read: ${old.stderr}`);
  assert.match(chips().stdout, /fix task_c1's wait: task:task_c1 is this task/, 'the board asks for the repair');
});

test('a base-red row and a carded row stay valid after the state they were judged against changes', () => {
  const { LEDGER, appendTo, chip, chips, helper, offer, outside } = chipLedger();
  const log = 'docs/plans/2026-01-01-fix.decisions.tsv';
  const green = 'task_g1 Make next green (xhigh)';
  assert.equal(offer(green, '.github/workflows', 'topic: next-green; owns: ci:check').status, 0);
  assert.equal(appendTo(log, 'verify', 'read CI', 'base-red: ci:check; proof: none', 'gap: fails on next too').status, 0);
  assert.equal(chip(green, 'started').status, 0);
  assert.equal(chip(green, 'landed').status, 0);
  const logChecked = helper(log);
  assert.equal(logChecked.status, 0, `the owner landing the fix leaves the earlier row valid: ${logChecked.stderr}`);
  assert.equal(offer('task_c1 Fix the reader', outside('r.md'), 'topic: io; card: c1; session: s1').status, 0);
  assert.equal(offer('task_c2 Fix the writer', outside('r.md'), 'topic: io-write').status, 0);
  assert.equal(chip('task_c2 Fix the writer', 'started').status, 0);
  const ledgerChecked = helper(LEDGER);
  assert.equal(ledgerChecked.status, 0, `a later start leaves the earlier card row valid: ${ledgerChecked.stderr}`);
  const board = chips('--session', 's1');
  assert.match(board.stdout, /withdraw task_c1's card c1: started task_c2 writes its paths outside this checkout; log started when the dismiss tool reports the owner started it, dismissed declined with card: c1 when it reports the owner dismissed it, and otherwise uncarded with card: c1 once it is withdrawn or its session has ended\n/, 'the board still asks for the card to go, with each route a withdrawal can take');
  assert.equal(board.status, 1);
});

test('a dup moves the duplicate\'s title, findings, paths, waits and owned checks into an offered task it keeps', () => {
  const { appendTo, chip, chips, offer, outside } = chipLedger();
  const parser = 'task_a1 Fix the parser';
  const docs = 'task_b1 Fix the parser docs';
  assert.equal(offer(parser, 'src/p.ts', 'topic: parser').status, 0);
  assert.equal(offer(docs, outside('p.md'), 'topic: parser; waits: pr:99, task:task_a1; owns: ci:docs').status, 0);
  const merged = chip(docs, 'dismissed dup task_a1');
  assert.equal(merged.status, 0, merged.stderr);
  assert.match(chips().stdout, /task_a1 {2}Fix the parser {2}\[parser\] {2}owns ci:docs {2}waits on pr:99 not merged\n/, 'the wait on the kept task itself is dropped');
  assert.match(chips('brief', 'task_a1').stdout, /Findings:\n- why\nAlso covers:\n- task_b1 Fix the parser docs\n {2}- why\nWrites: src\/p\.ts, [^\n]*\/shared\/p\.md\nOwns: ci:docs\nWaited on: pr:99\n/, 'the brief names the duplicate\'s work by its title');
  assert.equal(appendTo('docs/plans/2026-01-01-fix.decisions.tsv', 'verify', 'read CI', 'base-red: ci:docs; proof: none', 'gap: fails on next too').status, 0, 'the kept task owns the check');
  assert.equal(offer('task_w1 Rewrite the docs index', outside('p.md'), 'topic: index').status, 0);
  assert.equal(chip('task_w1 Rewrite the docs index', 'started').status, 0);
  assert.match(chips().stdout, /task_a1 {2}Fix the parser {2}\[parser\] {2}owns ci:docs {2}waits on pr:99 not merged; started task_w1 writes its paths outside this checkout\n/, 'a started task on an outside path the duplicate brought');
});

test('a card prompt leads with the task, then how its session lands, and ends by loading the current brief from the project checkout', () => {
  const { chips, offer, root } = chipLedger();
  assert.equal(offer('task_a1 Fix the parser', 'src/p.ts', 'topic: parser').status, 0);
  const checkout = realpathSync(root);
  const brief = chips('brief', 'task_a1').stdout;
  const quoted = (text) => text.replace(/[.*+?^${}()|[\]\\/]/gu, '\\$&');
  assert.match(brief, /^\[P1\] Fix the parser\n\nTopic: parser\. Kind: fix\. Effort: high\. Priority: P1\.\nRepro: steps\nFindings:\n/, 'the card shows the task and its priority before any bookkeeping');
  assert.match(brief, new RegExp(`\\n\\nSuggested task task_a1 in docs/plans/suggested-tasks\\.decisions\\.tsv of the project checkout ${quoted(checkout)}\\. First detach this session from the session that offered your card or started it, such as with Claude Code desktop's detach_session with self, because while it stays linked each of your turn ends wakes that session; when the runtime refuses or lacks the detach, carry on\\. This prompt can be older than the task, so next run cd ${quoted(checkout)} && node \\.agents/pstack/decisions-check\\.mjs chips brief task_a1 and work from what it prints\\. Run every ledger command from ${quoted(checkout)} that way, even when your session opened in its own worktree[^\\n]*\\n?$`), 'a card made before a later fold or dup, run from a worktree whose ledger copy is stale');
  const patch = join(checkout, 'docs/plans/artifacts/chips/task_a1.patch');
  const branch = execFileSync('git', ['branch', '--show-current'], { cwd: checkout, encoding: 'utf8' }).trim();
  assert.match(brief, new RegExp(`you may commit in your worktree as you go\\. When you finish, land it yourself: run git add -A in your worktree and save git diff --cached <base>, where <base> is what git merge-base HEAD ${quoted(branch)} prints, which holds your commits, your uncommitted changes and new files, as ${quoted(patch)}, run git -C ${quoted(checkout)} apply --check --whitespace=error-all ${quoted(patch)}, then git -C ${quoted(checkout)} apply ${quoted(patch)}, which changes only the checkout's working tree and leaves its index alone\\.[^\\n]*Then deliver the patch's paths from ${quoted(checkout)} as your project's Delivery rule says[^\\n]*where that rule commits, commit only those paths there; where the owner owns commits, leave them in the working tree\\. Merge each run directory you wrote under docs/plans/artifacts in your worktree into the same path in ${quoted(checkout)} without overwriting, with mkdir -p <that path> && cp -Rn <your run directory>/\\. <that path>/, because append refuses a row whose evidence cites a path the checkout lacks, and the cleanup scan that later removes your worktree deletes ignored files your logged rows cite\\. Then log landed with patch: ${quoted(patch)}, adding commit: <hash>, <hash> for each commit you made`), 'a session copies its run directories into the checkout before the landed row that cites them');
  assert.match(brief, new RegExp(`so the lead's report links them\\. Last, stop each server you started\\. Then run node ${quoted(checkout)}/\\.agents/skills/cleanup/scripts/scan\\.mjs --landed <your worktree's absolute path>\\. When it exits 0, every change and ignored file of yours is committed, recreated by an install or build, or in the checkout, so leave your worktree in place, and the cleanup scan removes it once nothing has written it or your transcript for a day\\. When it exits otherwise or the script is missing, lock your worktree with git -C ${quoted(checkout)} worktree lock `), 'a landed session leaves its worktree for the daily scan and locks it when its work is not all in the checkout');
});

test('a merge or a folded design question keeps the effort the task\'s work needs', () => {
  const { chip, chips, offer } = chipLedger();
  assert.equal(offer('task_a1 Fix the parser', 'src/p.ts', 'topic: parser').status, 0);
  assert.equal(offer('task_b1 Find why the parser hangs (xhigh)', 'src/q.ts', 'topic: parser').status, 0);
  assert.equal(chip('task_b1 Find why the parser hangs (xhigh)', 'dismissed dup task_a1').status, 0);
  assert.match(chips('brief', 'task_a1').stdout, /^\[P1\] Fix the parser \(xhigh\)\n/, 'a diagnosis merged into a plain fix');
  assert.equal(offer('task_c1 Fix the printer', 'src/r.ts', 'topic: printer').status, 0);
  assert.equal(chip('task_c1 Fix the printer', 'folded', 'kind: decide; writes: src/r2.ts').status, 0, 'a design question found later');
  assert.match(chips('brief', 'task_c1').stdout, /^\[P1\] Fix the printer \(xhigh\)\n[\s\S]*Kind: decide\.[\s\S]*settles a design question first/);
});

test('a folded design question promotes its task and joins the one-question-per-topic check', () => {
  const { chip, offer } = chipLedger();
  assert.equal(offer('task_d1 Decide the export format (xhigh)', 'src/e.ts', 'topic: export; kind: decide').status, 0);
  assert.equal(offer('task_k1 Fix the export button', 'src/b.ts', 'topic: export').status, 0);
  assert.match(chip('task_k1 Fix the export button', 'folded', 'kind: decide; writes: src/c.ts').stderr, /topic export already has the open design question task_d1; log this finding as a folded row on task_d1 instead/, 'a second design question in one topic');
  assert.match(chip('task_d1 Decide the export format (xhigh)', 'folded', 'kind: fix').stderr, /a folded row takes kind: decide only/);
  assert.equal(chip('task_d1 Decide the export format (xhigh)', 'folded', 'kind: decide; writes: src/f.ts').status, 0, 'a folded design question on the topic\'s own design task');
});

test('append refuses a dup of a task with no topic until it is migrated', () => {
  const { chip, root, LEDGER, offer } = chipLedger();
  assert.equal(offer('task_a1 Fix the parser', 'src/p.ts', 'topic: parser').status, 0);
  writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + ['2026-01-01T10:00:00Z', 'chip', 'task_o1 After: Fix the parser docs (high)', 'waits for: PR 12 to merge', 'writes: docs/p.md', 'offered'].join('\t') + '\n');
  assert.match(chip('task_o1 After: Fix the parser docs (high)', 'dismissed dup task_a1').stderr, /task_o1 has no topic, so its waits may still be prose; migrate it first: log updated with topic: and the waits: it has/);
  assert.equal(chip('task_o1 After: Fix the parser docs (high)', 'updated', 'topic: parser; waits: pr:12').status, 0);
  assert.equal(chip('task_o1 After: Fix the parser docs (high)', 'dismissed dup task_a1').status, 0, 'once it has a topic');
});

test('append refuses a second card on a task that has one', () => {
  const { chip, offer } = chipLedger();
  assert.equal(offer('task_l1 Fix the lexer', 'src/l.ts', 'topic: lexer').status, 0);
  assert.equal(chip('task_l1 Fix the lexer', 'carded', 'card: c1; session: s1').status, 0);
  assert.match(chip('task_l1 Fix the lexer', 'carded', 'card: c2; session: s2').stderr, /task_l1 already has card c1; log uncarded with card: c1 once that card is withdrawn or its session has ended, then card it again/);
  assert.equal(chip('task_l1 Fix the lexer', 'uncarded', 'card: c1').status, 0);
  assert.match(chip('task_l1 Fix the lexer', 'carded', 'card: c2; session: s2').stderr, /task_l1 belongs to session s1/, 'the first session that carded an offer naming no session owns it');
  assert.equal(chip('task_l1 Fix the lexer', 'carded', 'card: c2; session: s1').status, 0);
});

test('a dup that would leave two tasks waiting on each other is refused, and the duplicate stays open', () => {
  const { chip, chips, offer } = chipLedger();
  assert.equal(offer('task_d1 Fix d', 'src/d.ts', 'topic: chain').status, 0);
  assert.equal(offer('task_m1 Fix m', 'src/m.ts', 'topic: chain; waits: task:task_d1').status, 0);
  assert.equal(offer('task_k1 Fix k', 'src/k.ts', 'topic: chain; waits: task:task_m1').status, 0);
  assert.match(chip('task_d1 Fix d', 'dismissed dup task_k1').stderr, /this row leaves task_m1 and task_k1 waiting on each other; keep task_d1 open$/m, 'a wait on the duplicate that now leads to the kept task');
  const board = chips();
  assert.equal(board.status, 0, board.stdout);
  assert.match(board.stdout, /Ready, P1 \(1\)\n {2}task_d1 {2}Fix d {2}\[chain\] {2}no card\n/, 'the route the refusal names keeps every task and wait');
});

test('an updated row that closes a wait loop is refused', () => {
  const { chip, offer } = chipLedger();
  assert.equal(offer('task_a1 Fix a', 'src/a.ts', 'topic: loop').status, 0);
  assert.equal(offer('task_b1 Fix b', 'src/b.ts', 'topic: loop; waits: task:task_a1').status, 0);
  assert.match(chip('task_a1 Fix a', 'updated', 'waits: task:task_b1').stderr, /this row leaves task_a1 and task_b1 waiting on each other; drop the wait that closes the loop/);
  assert.equal(chip('task_b1 Fix b', 'started').status, 0);
  assert.equal(chip('task_a1 Fix a', 'updated', 'waits: task:task_b1').status, 0, 'a wait on a started task never loops');
});

test('chips brief on a merged task prints the task it merged into, and a closed task has nothing to start', () => {
  const { chip, chips, offer } = chipLedger();
  assert.equal(offer('task_a1 Fix a', 'src/a.ts', 'topic: brief').status, 0);
  assert.equal(offer('task_b1 Fix b', 'src/b.ts', 'topic: brief').status, 0);
  assert.equal(chip('task_b1 Fix b', 'dismissed dup task_a1').status, 0);
  const merged = chips('brief', 'task_b1');
  assert.equal(merged.status, 0, merged.stderr);
  assert.match(merged.stdout, /^task_b1 was merged into task_a1; work from its brief\.\n\n\[P1\] Fix a\n\nTopic: brief\.[\s\S]*\n\nSuggested task task_a1 [^\n]*\n?$/, 'a card on the duplicate that another session still holds');
  assert.equal(chip('task_a1 Fix a', 'started').status, 0);
  assert.equal(chip('task_a1 Fix a', 'landed').status, 0);
  const landed = chips('brief', 'task_b1');
  assert.equal(landed.status, 1);
  assert.match(landed.stderr, /task_b1 was merged into task_a1, which is landed, so there is nothing to start; tell the owner/);
  assert.equal(offer('task_c1 Fix c', 'src/c.ts', 'topic: brief').status, 0);
  assert.equal(chip('task_c1 Fix c', 'dismissed done').status, 0);
  assert.match(chips('brief', 'task_c1').stderr, /task_c1 is dismissed done, so there is nothing to start; tell the owner/);
});

test('append refuses a dup across topics until the duplicate moves into the kept task\'s topic', () => {
  const { chip, offer } = chipLedger();
  assert.equal(offer('task_a1 Fix the export', 'src/e.ts', 'topic: export').status, 0);
  assert.equal(offer('task_b1 Fix the export format', 'src/f.ts', 'topic: format').status, 0);
  assert.match(chip('task_b1 Fix the export format', 'dismissed dup task_a1').stderr, /task_b1 is in topic format and task_a1 in export, and a dup joins tasks on one question; when task_b1 answers task_a1's question, log updated with topic: export on task_b1 first/);
  assert.equal(chip('task_b1 Fix the export format', 'updated', 'topic: export').status, 0);
  assert.equal(chip('task_b1 Fix the export format', 'dismissed dup task_a1').status, 0);
});

test('append refuses a dup into a task with no topic until it is migrated', () => {
  const { chip, root, LEDGER, offer } = chipLedger();
  assert.equal(offer('task_b1 Fix the parser docs', 'docs/p.md', 'topic: parser; waits: pr:12').status, 0);
  writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + ['2026-01-01T10:00:00Z', 'chip', 'task_o1 Now: Fix the parser', 'why', 'writes: src/p.ts', 'offered'].join('\t') + '\n');
  assert.match(chip('task_b1 Fix the parser docs', 'dismissed dup task_o1').stderr, /task_o1 has no topic, so its waits may still be prose; migrate it first/);
  assert.equal(chip('task_o1 Now: Fix the parser', 'updated', 'topic: parser; waits: none').status, 0);
  assert.equal(chip('task_b1 Fix the parser docs', 'dismissed dup task_o1').status, 0);
});

test('a dup that makes a design question beside a running one names the updated route', () => {
  const { chip, offer, root, LEDGER } = chipLedger();
  assert.equal(offer('task_s1 Decide where content lands (xhigh)', 'src/l.ts', 'topic: land; kind: decide').status, 0);
  assert.equal(chip('task_s1 Decide where content lands (xhigh)', 'started').status, 0);
  assert.equal(offer('task_k1 Fix the drop target', 'src/k.ts', 'topic: land').status, 0);
  writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + ['2026-01-01T10:00:00Z', 'chip', 'task_d1 Decide where drops land (xhigh)', 'why', 'writes: src/d.ts; topic: land; kind: decide', 'offered'].join('\t') + '\n');
  assert.match(chip('task_d1 Decide where drops land (xhigh)', 'dismissed dup task_k1').stderr, /topic land's design question task_s1 is running; log updated on task_k1 with its waits plus task:task_s1 before this row/);
  assert.equal(chip('task_k1 Fix the drop target', 'updated', 'waits: task:task_s1').status, 0);
  assert.equal(chip('task_d1 Decide where drops land (xhigh)', 'dismissed dup task_k1').status, 0);
});

test('a folded design question accepts a wait through a duplicate of the running one', () => {
  const { chip, offer } = chipLedger();
  assert.equal(offer('task_r1 Decide the format (xhigh)', 'src/r.ts', 'topic: format; kind: decide').status, 0);
  assert.equal(offer('task_a1 Fix the format docs', 'docs/r.md', 'topic: format').status, 0);
  assert.equal(chip('task_a1 Fix the format docs', 'dismissed dup task_r1').status, 0);
  assert.equal(chip('task_r1 Decide the format (xhigh)', 'started').status, 0);
  assert.equal(offer('task_k1 Fix the format button', 'src/k.ts', 'topic: format; waits: task:task_a1').status, 0);
  const folded = chip('task_k1 Fix the format button', 'folded', 'kind: decide');
  assert.equal(folded.status, 0, folded.stderr);
});

test('folding an unknown-cause diagnosis into a plain fix raises its brief and board line to xhigh', () => {
  const { chip, chips, offer } = chipLedger();
  assert.equal(offer('task_p1 Fix the parser', 'src/p.ts', 'topic: parser').status, 0);
  assert.equal(chip('task_p1 Fix the parser', 'folded', 'effort: xhigh; writes: src/q.ts').status, 0, 'a hang nobody has explained yet');
  assert.match(chips('brief', 'task_p1').stdout, /^\[P1\] Fix the parser \(xhigh\)\n[\s\S]*Kind: fix\./);
  assert.match(chips().stdout, /task_p1 {2}Fix the parser \(xhigh\) {2}\[parser\]/, 'the board shows the effort the card passes');
  assert.match(chip('task_p1 Fix the parser', 'folded', 'effort: high').stderr, /a folded row takes effort: xhigh only/);
});

test("a card's effort is its title's, capped at the project's maxEffort, in the brief and on the board", () => {
  const { chips, offer, root } = chipLedger();
  assert.equal(offer('task_p1 Fix the parser', 'src/p.ts', 'topic: parser').status, 0);
  assert.equal(offer('task_d1 Design the export ledger (xhigh)', 'src/export', 'topic: export; kind: decide').status, 0);
  assert.equal(offer('task_w1 Fix the export core', 'src/export/core.ts', 'topic: core; waits: task:task_d1').status, 0);
  assert.match(chips('brief', 'task_p1').stdout, /Kind: fix\. Effort: high\./);
  assert.match(chips('brief', 'task_d1').stdout, /Kind: decide\. Effort: xhigh\./);
  assert.match(chips().stdout, /task_d1 {2}Design the export ledger \(xhigh\) {2}\[export, decide\] {2}no card/, 'an uncapped line leaves the effort to its title');
  writeFileSync(join(root, '.agents/pstack.json'), JSON.stringify({ branch: 'next', maxEffort: 'high' }));
  assert.match(chips('brief', 'task_d1').stdout, /^\[P1\] Design the export ledger \(xhigh\)\n[\s\S]*Kind: decide\. Effort: high\./, 'the title keeps its recommendation');
  const board = chips().stdout;
  assert.match(board, /task_d1 {2}Design the export ledger \(xhigh\) {2}\[export, decide\] {2}effort high {2}no card/);
  assert.match(board, /task_w1 {2}Fix the export core {2}\[core\] {2}waits on /, 'a plain title is already at the cap');
});

test('a carded task takes no fold, update or dup until its card is withdrawn, and each refusal names its route', () => {
  const { chip, offer } = chipLedger();
  assert.equal(offer('task_k1 Fix k', 'src/k.ts', 'topic: card; card: c1; session: s1').status, 0);
  assert.equal(offer('task_d1 Fix d', 'src/d.ts', 'topic: card; waits: task:task_k1').status, 0, "a finding on the carded task's question waits on it");
  assert.match(chip('task_k1 Fix k', 'folded', 'writes: src/m.ts').stderr, /task_k1 holds card c1, which cannot show new work; offer the finding as a new task in topic card with waits: task:task_k1/);
  for (const change of ['owns: ci:k', 'writes: src/k', 'kind: decide', 'topic: other', 'fast: yes', 'waits: pr:5; topic: other']) {
    assert.match(chip('task_k1 Fix k', 'updated', change).stderr, /task_k1 holds card c1, which cannot change; withdraw the card first/, `an updated row with ${change}`);
  }
  assert.match(chip('task_d1 Fix d', 'dismissed dup task_k1').stderr, /task_k1 holds card c1, which cannot show new work; keep task_d1 open and log updated on it with its waits plus task:task_k1/);
  assert.equal(chip('task_k1 Fix k', 'uncarded', 'card: c1').status, 0);
  assert.equal(chip('task_k1 Fix k', 'folded', 'writes: src/m.ts').status, 0, 'a fold once the card is withdrawn');
});

test("a carded task's writes: can narrow to paths inside them, and only narrow", () => {
  const { chip, offer } = chipLedger();
  assert.equal(offer('task_k1 Fix k', 'src/k, test', 'topic: card; card: c1; session: s1').status, 0);
  assert.equal(chip('task_k1 Fix k', 'updated', 'writes: src/k/a.ts, test/k.test.ts').status, 0, 'a narrowing to paths inside the listed ones');
  assert.match(chip('task_k1 Fix k', 'updated', 'writes: src/k/a.ts, test').stderr, /task_k1 holds card c1, which cannot change; withdraw the card first/, 'a widening back to a directory');
  assert.match(chip('task_k1 Fix k', 'updated', 'writes: src/k/a.ts; owns: ci:k').stderr, /task_k1 holds card c1, which cannot change/, 'a narrowing beside another token');
});

test("uncarded and dismissed declined name the task's current card", () => {
  const { chip, offer } = chipLedger();
  assert.equal(offer('task_k1 Fix k', 'src/k.ts', 'topic: card; card: c1; session: s1').status, 0);
  assert.match(chip('task_k1 Fix k', 'uncarded').stderr, /task_k1 holds card c1; name it as card: c1/);
  assert.match(chip('task_k1 Fix k', 'dismissed declined').stderr, /task_k1 holds card c1; name it as card: c1/);
  assert.equal(chip('task_k1 Fix k', 'uncarded', 'card: c1').status, 0, 'a withdrawal names its card and needs no session');
  assert.match(chip('task_k1 Fix k', 'uncarded', 'card: c1').stderr, /task_k1 has no card to withdraw/);
  assert.equal(chip('task_k1 Fix k', 'carded', 'card: c2; session: s1').status, 0);
  assert.match(chip('task_k1 Fix k', 'dismissed declined', 'card: c1').stderr, /task_k1's card is c2, not c1; a dismissal of an older card closes nothing, so log no row for it/);
  assert.match(chip('task_k1 Fix k', 'uncarded', 'card: c1').stderr, /task_k1's card is c2, not c1/);
  assert.equal(chip('task_k1 Fix k', 'dismissed declined', 'card: c2').status, 0, "the owner's dismissal of the current card");
});

test('the board tells a session a card started to work from its current brief', () => {
  const { chips, offer } = chipLedger();
  assert.equal(offer('task_a1 Fix the parser', 'src/p.ts', 'topic: parser').status, 0);
  assert.match(chips().stdout, /\nA session a card started works from chips brief <its task id>, because its task can change after the card\.\n/, 'a card whose prompt predates chips brief');
});

test('an older dup into a started task passes the whole-log check', () => {
  const { chip, helper, offer, root, LEDGER } = chipLedger();
  assert.equal(offer('task_a1 Fix a', 'src/a.ts', 'topic: whole').status, 0);
  assert.equal(chip('task_a1 Fix a', 'started').status, 0);
  assert.equal(offer('task_b1 Fix b', 'src/b.ts', 'topic: whole; owns: ci:b').status, 0);
  writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + ['2026-01-01T10:00:00Z', 'chip', 'task_b1 Fix b', 'why', 'evidence', 'dismissed dup task_a1'].join('\t') + '\n');
  const whole = helper(LEDGER);
  assert.equal(whole.status, 0, `a dup the previous helper accepted: ${whole.stderr}`);
});

test('an older dup into a started task keeps the covers and owned checks it moved', () => {
  const { chip, chips, offer, root, LEDGER } = chipLedger();
  assert.equal(offer('task_a1 Fix a', 'src/a.ts', 'topic: whole').status, 0);
  assert.equal(chip('task_a1 Fix a', 'started').status, 0);
  assert.equal(offer('task_b1 Fix b', 'src/b.ts', 'topic: whole; owns: ci:b; waits: pr:7').status, 0);
  writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + ['2026-01-01T10:00:00Z', 'chip', 'task_b1 Fix b', 'why', 'evidence', 'dismissed dup task_a1'].join('\t') + '\n');
  const brief = chips('brief', 'task_a1').stdout;
  assert.match(brief, /Also covers:\n- task_b1 Fix b\n[\s\S]*Owns: ci:b\n/, 'what the previous helper moved into the started task');
  assert.match(brief, /Writes: src\/a\.ts\nOwns: ci:b\nWaited on: nothing\n/, 'the paths and waits stay the started task\'s own');
});

test('the whole-log check refuses a folded row with kind: fix', () => {
  const { helper, offer, root, LEDGER } = chipLedger();
  assert.equal(offer('task_d1 Decide the format (xhigh)', 'src/d.ts', 'topic: whole; kind: decide').status, 0);
  writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + ['2026-01-01T10:00:00Z', 'chip', 'task_d1 Decide the format (xhigh)', 'why', 'kind: fix', 'folded'].join('\t') + '\n');
  const fold = helper(LEDGER);
  assert.equal(fold.status, 1);
  assert.match(fold.stderr, /a folded row takes kind: decide only/);
});

test('a duplicate\'s card has nothing to start once the task it merged into is started', () => {
  const { chip, chips, offer } = chipLedger();
  assert.equal(offer('task_a1 Fix a', 'src/a.ts', 'topic: alias').status, 0);
  assert.equal(offer('task_b1 Fix b', 'src/b.ts', 'topic: alias').status, 0);
  assert.equal(chip('task_b1 Fix b', 'dismissed dup task_a1').status, 0);
  assert.equal(chip('task_a1 Fix a', 'started').status, 0);
  const brief = chips('brief', 'task_b1');
  assert.equal(brief.status, 1, 'a card on the duplicate that another session still holds');
  assert.match(brief.stderr, /task_b1 was merged into task_a1, which is started, so there is nothing to start; tell the owner/);
});

test('a duplicate\'s card has nothing to start while the task it merged into has its own card', () => {
  const { chip, chips, offer } = chipLedger();
  assert.equal(offer('task_a1 Fix a', 'src/a.ts', 'topic: alias').status, 0);
  assert.equal(offer('task_b1 Fix b', 'src/b.ts', 'topic: alias').status, 0);
  assert.equal(chip('task_b1 Fix b', 'dismissed dup task_a1').status, 0);
  assert.equal(chip('task_a1 Fix a', 'carded', 'card: c1; session: s1').status, 0);
  const brief = chips('brief', 'task_b1');
  assert.equal(brief.status, 1, 'two cards that would lead to one task');
  assert.match(brief.stderr, /task_b1 was merged into task_a1, which has card c1, so there is nothing to start; tell the owner/);
});

test('moving a design question into a topic that has one names the dup', () => {
  const { chip, offer } = chipLedger();
  assert.equal(offer('task_k1 Decide the export format (xhigh)', 'src/e.ts', 'topic: export; kind: decide').status, 0);
  assert.equal(offer('task_d1 Decide the file format (xhigh)', 'src/f.ts', 'topic: format; kind: decide').status, 0);
  assert.match(chip('task_d1 Decide the file format (xhigh)', 'updated', 'topic: export').stderr, /topic export already has the open design question task_k1; log task_d1 dismissed dup task_k1 instead/, 'the topic move the cross-topic refusal names for two fixes');
});

test('a covered task keeps its effort in the kept task\'s brief', () => {
  const { chip, chips, offer } = chipLedger();
  assert.equal(offer('task_a1 Fix the parser', 'src/p.ts', 'topic: parser').status, 0);
  assert.equal(offer('task_b1 Find the parser hang', 'src/q.ts', 'topic: parser').status, 0);
  assert.equal(chip('task_b1 Find the parser hang', 'folded', 'effort: xhigh').status, 0);
  assert.equal(chip('task_b1 Find the parser hang', 'dismissed dup task_a1').status, 0);
  assert.match(chips('brief', 'task_a1').stdout, /Also covers:\n- task_b1 Find the parser hang \(xhigh\)\n/);
});

test('append refuses a new self-wait on a task already in a loop', () => {
  const { chip, offer, root, LEDGER } = chipLedger();
  assert.equal(offer('task_a1 Fix a', 'src/a.ts', 'topic: loop').status, 0);
  assert.equal(offer('task_b1 Fix b', 'src/b.ts', 'topic: loop; waits: task:task_a1').status, 0);
  writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + ['2026-01-01T10:00:00Z', 'chip', 'task_a1 Fix a', 'why', 'waits: task:task_b1', 'updated'].join('\t') + '\n');
  assert.match(chip('task_a1 Fix a', 'updated', 'waits: task:task_b1, task:task_a1').stderr, /task_a1 cannot wait on itself/, 'a self-wait added to a task an older row left in a loop');
  assert.equal(chip('task_a1 Fix a', 'updated', 'waits: task:task_b1, pr:7').status, 0, 'a wait outside the loop');
});

test('an empty waits: is refused', () => {
  const { chip, offer, root, LEDGER } = chipLedger();
  assert.equal(offer('task_a1 Fix the parser', 'src/p.ts', 'topic: parser').status, 0);
  writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + ['2026-01-01T10:00:00Z', 'chip', 'task_o1 After: Fix the parser docs (high)', 'waits for: PR 12 to merge', 'writes: docs/p.md', 'offered'].join('\t') + '\n');
  assert.match(chip('task_o1 After: Fix the parser docs (high)', 'updated', 'topic: parser; waits:').stderr, /waits: takes pr:<number>, task:<id> or run:<plan path ending in \.md>, comma-separated, or none/, 'a migration that would drop its prose wait');
  assert.equal(chip('task_o1 After: Fix the parser docs (high)', 'updated', 'topic: parser; waits: none').status, 0);
});

test('a finding that waits on a carded task stays open when the owner declines the card, and gets its own card once its wait is fixed', () => {
  const { appendTo, chip, chips, offer } = chipLedger();
  assert.equal(offer('task_k1 Fix k', 'src/k.ts', 'topic: card; card: c1; session: s1').status, 0);
  assert.equal(offer('task_d1 Fix d', 'src/d.ts', 'topic: card; waits: task:task_k1; owns: ci:d').status, 0);
  assert.match(chips().stdout, /Waiting, P0 \(1\)\n {2}task_d1 {2}Fix d {2}\[card\] {2}owns ci:d {2}waits on task:task_k1 offered\n/);
  assert.equal(chip('task_k1 Fix k', 'dismissed declined', 'card: c1').status, 0, 'the owner dismissed the card, which showed task_k1 whole');
  const board = chips();
  assert.equal(board.status, 1);
  assert.match(board.stdout, /fix task_d1's wait: task:task_k1 closed as dismissed declined without its result; log updated with the waits it has now/);
  assert.equal(appendTo('docs/plans/2026-01-01-fix.decisions.tsv', 'verify', 'read CI', 'base-red: ci:d; proof: none', 'gap: fails on next too').status, 0, 'the finding still owns its check');
  assert.equal(chip('task_d1 Fix d', 'updated', 'waits: none').status, 0);
  assert.match(chips().stdout, /Do, card pass \(1\)\n {2}card task_d1: it can start and has no card/);
});

test('once a card is withdrawn, chips merges each finding that waited on it, one merge a pass', () => {
  const { batch, chip, chips, offer } = chipLedger();
  assert.equal(offer('task_k1 Fix k', 'src/k.ts', 'topic: card; card: c1; session: s1').status, 0);
  assert.equal(offer('task_d1 Fix d', 'src/d.ts', 'topic: card; waits: task:task_k1').status, 0);
  assert.equal(offer('task_e1 Fix e', 'src/e.ts', 'topic: card; waits: task:task_k1').status, 0);
  assert.equal(offer('task_p1 Decide p (xhigh)', 'src/p.ts', 'topic: other; kind: decide; waits: task:task_k1').status, 0, 'a prerequisite in another topic');
  assert.doesNotMatch(chips().stdout, /merge/, 'no merge while the card is out');
  assert.equal(chip('task_k1 Fix k', 'uncarded', 'card: c1').status, 0);
  for (const id of ['task_d1', 'task_e1']) {
    const board = chips();
    assert.equal(board.status, 0, board.stdout);
    assert.match(board.stdout, new RegExp(`Do, ledger pass \\(1\\)\\n {2}merge ${id} into task_k1: task_k1 has no card now, so log ${id} dismissed dup task_k1\\n`));
    assert.equal(batch([[`${id} Fix ${id.at(5)}`, 'dismissed dup task_k1']]).status, 0, `the merge of ${id} appends`);
  }
  const board = chips();
  assert.match(board.stdout, /Do, card pass \(1\)\n {2}card task_k1:/, 'the task is carded again with all its work');
  assert.doesNotMatch(board.stdout, /merge task_p1/, 'a prerequisite in another topic stays its own task');
  assert.match(chips('brief', 'task_k1').stdout, /Also covers:\n- task_d1 Fix d\n[\s\S]*- task_e1 Fix e\n/);
});

test('a merge leaves the other items on its two tasks for the next pass', () => {
  const { batch, chip, chips, offer } = chipLedger();
  assert.equal(offer('task_g1 Fix g', 'src/g.ts', 'topic: gone').status, 0);
  assert.equal(offer('task_o1 Fix o', 'src/o.ts', 'topic: open').status, 0);
  assert.equal(offer('task_k1 Fix k', 'src/k.ts', 'topic: card; waits: task:task_g1').status, 0);
  assert.equal(offer('task_d1 Fix d', 'src/d.ts', 'topic: card; waits: task:task_o1, task:task_k1').status, 0);
  assert.equal(chip('task_g1 Fix g', 'dismissed declined').status, 0);
  const first = chips();
  assert.equal(first.status, 1, 'the stuck wait the pass leaves out still fails chips');
  assert.match(first.stdout, /Do, ledger pass \(1\)\n {2}merge task_d1 into task_k1/);
  assert.doesNotMatch(first.stdout, /fix task_k1's wait/);
  assert.equal(batch([['task_d1 Fix d', 'dismissed dup task_k1']]).status, 0);
  assert.match(chips().stdout, /fix task_k1's wait: task:task_g1 closed as dismissed declined without its result/);
  assert.match(chips('brief', 'task_k1').stdout, /Waited on: task:task_g1, task:task_o1\n/, 'the next pass sees the wait the merge moved');
});

test('a merge that would close a wait loop prints nothing and hides no later pass', () => {
  const { chips, offer } = chipLedger();
  assert.equal(offer('task_k1 Fix k', 'src/k.ts', 'topic: card').status, 0);
  assert.equal(offer('task_x1 Fix x', 'src/x.ts', 'topic: other; waits: task:task_k1').status, 0);
  assert.equal(offer('task_d1 Fix d', 'src/d.ts', 'topic: card; waits: task:task_k1, task:task_x1').status, 0);
  const board = chips();
  assert.equal(board.status, 0, board.stdout);
  assert.doesNotMatch(board.stdout, /merge/, 'task_k1 would wait on task_x1, which waits on task_k1');
  assert.match(board.stdout, /Do, card pass \(1\)\n {2}card task_k1:/);
});

test('a design question that waits on a design question of its topic is not a second open one', () => {
  const { chip, chips, offer } = chipLedger();
  assert.equal(offer('task_k1 Decide k (xhigh)', 'src/k.ts', 'topic: card; kind: decide; card: c1; session: s1').status, 0);
  assert.match(offer('task_d1 Decide d (xhigh)', 'src/d.ts', 'topic: card; kind: decide').stderr, /topic card already has the open design question task_k1; give task_d1 waits: task:task_k1, since task_k1 holds card c1/);
  const waiting = offer('task_d1 Decide d (xhigh)', 'src/d.ts', 'topic: card; kind: decide; waits: task:task_k1');
  assert.equal(waiting.status, 0, waiting.stderr);
  assert.doesNotMatch(chips().stdout, /fold topic/);
  assert.equal(chip('task_k1 Decide k (xhigh)', 'uncarded', 'card: c1').status, 0);
  assert.match(chips().stdout, /merge task_d1 into task_k1/);
});

test('chips shows one pass at a time: withdrawals, then ledger rows, then cards, and a read with no session skips the withdrawals', () => {
  const { chip, chips, offer, root, LEDGER } = chipLedger();
  assert.equal(offer('task_a1 Fix a', 'src/a.ts', 'topic: one').status, 0);
  writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + ['2026-01-01T10:00:00Z', 'chip', 'task_o1 Fix the old docs', 'why', 'writes: docs/o.md', 'offered'].join('\t') + '\n');
  assert.equal(offer('task_c1 Fix c', 'src/c.ts', 'topic: three; card: c1; session: s1').status, 0);
  assert.equal(chip('task_c1 Fix c', 'updated', 'waits: pr:5').status, 0, 'a wait added to a carded task');
  const withdrawals = chips('--session', 's1');
  assert.match(withdrawals.stdout, /Do, withdrawal pass \(1\)\n {2}withdraw task_c1's card c1/);
  assert.doesNotMatch(withdrawals.stdout, /migrate task_o1|card task_a1/);
  const sessionless = chips();
  assert.match(sessionless.stdout, /Do, ledger pass \(1\)\n {2}migrate task_o1/, 'a read with no session applies no withdrawal, so the ledger pass shows');
  assert.equal(sessionless.status, 1, 'the waiting card still counts as a problem');
  assert.equal(chip('task_c1 Fix c', 'uncarded', 'card: c1').status, 0);
  const ledger = chips();
  assert.match(ledger.stdout, /Do, ledger pass \(1\)\n {2}migrate task_o1/);
  assert.doesNotMatch(ledger.stdout, /card task_a1/);
  assert.equal(chip('task_o1 Fix the old docs', 'updated', 'topic: docs; waits: none').status, 0);
  assert.match(chips().stdout, /Do, ledger pass \(1\)\n {2}prioritize task_o1: log updated with priority:/, 'an untagged task gets no card until a sweep tags it');
  assert.equal(chip('task_o1 Fix the old docs', 'updated', 'priority: P2').status, 0);
  assert.match(chips().stdout, /Do, card pass \(2\)\n {2}card task_a1:[^\n]*\n {2}card task_o1:/);
});

test('decisions-check takes a P0 or P1 claim only with its evidence', () => {
  const { LEDGER, chip, helper, merge, offer, root } = chipLedger();
  const bare = (decision, tokens) => helper('append', LEDGER, 'chip', decision, 'why', tokens, 'offered');
  const untagged = bare('task_a1 Fix a', 'writes: a.md; topic: one');
  assert.equal(untagged.status, 1, 'a new offer with no priority');
  assert.match(untagged.stderr, /a new offer names its priority as "priority: P0"/);
  assert.equal(bare('task_a1 Fix a', 'writes: a.md; topic: one; owns: ci:check').status, 0, 'a task that owns a failing check is P0 without a token');
  assert.match(bare('task_b1 Fix b', 'writes: b.md; topic: two; priority: P0').stderr, /a P0 task is broken now/);
  assert.match(bare('task_b1 Fix b', 'writes: b.md; topic: two; priority: P1').stderr, /a P1 task is a bug with its repro/);
  assert.match(bare('task_b1 Fix b', 'writes: b.md; topic: two; priority: P4').stderr, /priority: is P0, P1, P2 or P3/);
  assert.match(bare('task_b1 Fix b', 'writes: b.md; topic: two; priority: P0; regressed: abc1234').stderr, /regressed: abc1234 is not a commit/);
  assert.match(bare('task_b1 Fix b', 'writes: b.md; topic: two; priority: P1; ship: r1').stderr, /sets no chips\.ship command/);
  merge('break b');
  const head = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  assert.equal(bare('task_b1 Fix b', `writes: b.md; topic: two; priority: P0; regressed: ${head}`).status, 0, 'a regression names its commit');
  const lower = bare('task_c1 Fix c', 'writes: c.md; topic: three; priority: P2');
  assert.equal(lower.status, 1, 'a P2 offer outside a verdict, babysit, time, hook or panel route');
  assert.match(lower.stderr, /a run offers a task only for a new P0 or P1 finding[^\n]*list this P2 finding in the plan's Open work/);
  assert.match(bare('task_c1 Fix c', 'writes: c.md; topic: three; priority: P3; via: review').stderr, /via: is verdict, babysit, time, hook, panel or stale/);
  assert.equal(bare('task_h1 Run the due intake', 'writes: h.md; topic: intake; kind: decide; priority: P3; via: hook').status, 0, 'a project hook offers the recurring work it finds due');
  assert.match(bare('task_n1 Judge n', 'writes: n.md; topic: four; owns: none').stderr, /a new offer names its priority/, 'owns: none owns no check');
  assert.equal(bare('task_n1 Judge n', 'writes: n.md; topic: four; kind: decide; priority: P3; via: time; owns: none').status, 0);
  assert.match(helper('chips', 'brief', 'task_n1').stdout, /Priority: P3\./, 'owns: none never makes the task P0');
  assert.equal(bare('task_c1 Fix c', 'writes: c.md; topic: three; priority: P2; via: verdict').status, 0, 'P2 needs no evidence, only its route');
  assert.match(chip('task_c1 Fix c', 'updated', 'priority: P0').stderr, /a P0 task is broken now/, 'a raise to P0 without evidence');
  assert.equal(chip('task_c1 Fix c', 'updated', 'priority: P0; repro: type then reload loses the text').status, 0, 'a raise to P0 with its repro');
  assert.equal(chip('task_c1 Fix c', 'folded', 'priority: P3').status, 0);
  assert.match(helper('chips', 'brief', 'task_c1').stdout, /Priority: P0\./, 'a folded finding never lowers the priority');
  assert.equal(offer('task_d1 Fix d', 'd.md', 'topic: four; priority: P2; via: verdict; card: d1; session: s1').status, 0);
  assert.equal(chip('task_d1 Fix d', 'updated', 'priority: P3').status, 0, 'a carded task takes a new priority');
  assert.match(chip('task_d1 Fix d', 'updated', 'topic: five').stderr, /holds card d1, which cannot change/);
  assert.match(helper('chips', 'brief', 'task_b1').stdout, /Priority: P0\.[\s\S]*Regressed in: [0-9a-f]+/);
});

test('chips lists P0 and P1 in full, counts the rest and cards at most 10, highest priority first', () => {
  const { batch, chips } = chipLedger();
  const rows = [];
  for (let n = 0; n < 6; n += 1) rows.push([`task_p${n} Fix p${n}`, 'offered', `writes: p${n}.md; topic: p2-${n}; priority: P2; via: verdict`]);
  for (let n = 0; n < 4; n += 1) rows.push([`task_t${n} Tune t${n}`, 'offered', `writes: t${n}.md; topic: p3-${n}; priority: P3; via: verdict`]);
  rows.push(['task_b1 Fix the lost save', 'offered', 'writes: b.md; topic: save; priority: P0; repro: type then reload loses the text']);
  rows.push(['task_c1 Fix the cursor', 'offered', 'writes: c.md; topic: cursor; priority: P1; repro: click past the end']);
  rows.push(['task_h1 Fix held', 'offered', 'writes: h.md; topic: held; priority: P2; via: verdict; card: h1; session: s1']);
  const written = batch(rows);
  assert.equal(written.status, 0, written.stderr);
  const board = chips().stdout;
  assert.match(board, /Ready, P0 \(1\)\n {2}task_b1 /);
  assert.match(board, /Ready, P1 \(1\)\n {2}task_c1 /);
  assert.match(board, /Ready, lower priority \(P2 7, P3 4\): chips all lists them/);
  assert.doesNotMatch(board, /task_p0 {2}Fix p0 {2}\[/, 'a P2 task shows only as a count');
  assert.match(board, /Do, card pass \(10\)\n {2}card task_b1:[^\n]*\n {2}card task_c1:[^\n]*\n {2}card task_p0:/, 'P0 first');
  assert.equal(board.match(/^ {2}card task_/gmu).length, 9, 'ten cards less the one this session holds');
  assert.match(board, /\n {2}card task_t0:[^\n]*\n {2}3 more can start once this session holds fewer than 10 cards/);
  const full = chips('all', '--session', 's1').stdout;
  assert.match(full, /Ready, P2 \([0-9]+\)\n {2}task_/);
  assert.match(full, /Ready, P3 \(4\)/);
});

test('within a priority, chips lists and cards first a task whose repro names a public issue, never above a higher priority', () => {
  const { batch, chips } = chipLedger();
  const written = batch([
    ['task_a1 Fix a', 'offered', 'writes: a.md; topic: a; priority: P0; repro: type then reload loses the text'],
    ['task_b1 Fix b', 'offered', 'writes: b.md; topic: b; priority: P0; repro: acme#12 Repro 1 holds the steps'],
    ['task_d1 Fix d', 'offered', 'writes: d.md; topic: d; priority: P1; repro: paste &#12; then undo'],
    ['task_f1 Fix f', 'offered', 'writes: f.md; topic: f; priority: P1; repro: load fixtures/issues/12.json then save'],
    ['task_c1 Fix c', 'offered', 'writes: c.md; topic: c; priority: P1; repro: https://github.com/acme/app/issues/7 holds the steps'],
    ['task_e1 Fix e', 'offered', 'writes: e.md; topic: e; priority: P1; repro: #8 Repro 2 holds the steps'],
  ]);
  assert.equal(written.status, 0, written.stderr);
  const board = chips().stdout;
  assert.match(board, /Ready, P0 \(2\)\n {2}task_b1 [^\n]*\n {2}task_a1 /, 'the P0 that names an issue first');
  assert.match(board, /Ready, P1 \(4\)\n {2}task_c1 [^\n]*\n {2}task_e1 [^\n]*\n {2}task_d1 [^\n]*\n {2}task_f1 /, 'an issues URL and a bare #<number> count, and an HTML entity and an issues path do not');
  assert.match(board, /Do, card pass \(6\)\n {2}card task_b1:[^\n]*\n {2}card task_a1:[^\n]*\n {2}card task_c1:/, 'an issue-backed P1 stays below every P0');
});

test('within a priority, chips ranks regressions first and experimental scopes last, by the facts a triage record gives', () => {
  const rows = [
    ['task_a1 Fix a', 'offered', 'writes: a.md; topic: a; priority: P1; repro: type then reload; review-scope: editor'],
    ['task_b1 Fix b', 'offered', 'writes: b.md; topic: b; priority: P1; repro: type then reload; review-scope: pagination'],
    ['task_c1 Fix c', 'offered', 'writes: c.md; topic: c; priority: P1; repro: type then reload; review-scope: editor; regression: https://example.org/demo'],
    ['task_d1 Fix d', 'offered', 'writes: d.md; topic: d; priority: P1; repro: type then reload; review-scope: pagination; regression: https://example.org/pages, https://example.org/print'],
    ['task_e1 Fix e', 'offered', 'writes: e.md; topic: e; priority: P1; repro: type then reload'],
    ['task_f1 Fix f', 'offered', 'writes: f.md; topic: f; priority: P0; repro: type then reload; review-scope: pagination'],
    ['task_g1 Fix g', 'offered', 'writes: g.md; topic: g; priority: P1; repro: acme#3 holds the steps; review-scope: editor'],
    ['task_h1 Fix h', 'offered', 'writes: h.md; topic: h; priority: P1; repro: type then reload; review-scope: none; regression: https://example.org/tool'],
  ];
  const triaged = chipLedger({ config: { triage: { experimental: ['pagination'] }, chips: { scopes: 'scopes' } }, files: { 'scopes/editor.json': '{}', 'scopes/pagination.json': '{}' } });
  const written = triaged.batch(rows);
  assert.equal(written.status, 0, written.stderr);
  const board = triaged.chips().stdout;
  assert.match(board, /Ready, P0 \(1\)\n {2}task_f1 {2}Fix f {2}\[f\] {2}experimental /, 'an experimental P0 stays above every P1');
  assert.match(
    board,
    /Ready, P1 \(7\)\n {2}task_c1 {2}Fix c {2}\[c\] {2}regression [^\n]*\n {2}task_d1 {2}Fix d {2}\[d\] {2}regression [^\n]*\n {2}task_g1 {2}Fix g {2}\[g\] {2}new [^\n]*\n {2}task_a1 {2}Fix a {2}\[a\] {2}new [^\n]*\n {2}task_e1 {2}Fix e {2}\[e\] {2}no card\n {2}task_h1 {2}Fix h {2}\[h\] {2}no card\n {2}task_b1 {2}Fix b {2}\[b\] {2}experimental /,
    'a regression in an experimental scope still comes first, and a task with no review scope, or none, ranks with the new ones'
  );
  assert.match(triaged.chips('brief', 'task_d1').stdout, /^Review scope: pagination\. Milestone: regression\.\nRegression: it still works on https:\/\/example\.org\/pages, https:\/\/example\.org\/print\n/mu);
  assert.doesNotMatch(triaged.chips('brief', 'task_e1').stdout, /^Review scope:/mu);
  const stale = triaged.chips('stale').stdout;
  assert.match(stale, /task_e1 [^\n]*no review scope/, 'the stale report asks the sweep to judge a missing review scope');
  assert.doesNotMatch(stale, /task_h1 [^\n]*no review scope/, 'review-scope: none is a judged scope');
  const refused = triaged.batch([
    ['task_k1 Fix k', 'offered', 'writes: k.md; topic: k; priority: P1; repro: steps; review-scope: editr'],
    ['task_m1 Fix m', 'offered', 'writes: m.md; topic: m; priority: P1; repro: steps; regression: the old demo'],
  ]);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /review-scope: editr is no review scope in scopes; name the one that owns the task's code, or none/);
  assert.match(refused.stderr, /regression: names each page where the behavior still works by its URL[^\n]*"the old demo" is not a URL/);
  const carded = triaged.batch([
    ['task_a1 Fix a', 'carded', 'card: task_x1; session: s1'],
    ['task_a1 Fix a', 'updated', 'review-scope: pagination'],
  ]);
  assert.equal(carded.status, 0, `a carded task takes its review scope without a withdrawal: ${carded.stderr}`);
  assert.match(triaged.chips('brief', 'task_a1').stdout, /^Review scope: pagination\. Milestone: experimental\.$/mu);

  const plain = chipLedger();
  assert.equal(plain.batch(rows).status, 0);
  const unranked = plain.chips().stdout;
  assert.match(unranked, /Ready, P1 \(7\)\n {2}task_g1 [^\n]*\n {2}task_a1 [^\n]*\n {2}task_b1 [^\n]*\n {2}task_c1 /, 'without a triage config the order stays the public-issue one');
  assert.doesNotMatch(unranked, /\] {2}(?:regression|new|experimental)\b/, 'and no task shows a milestone');
  assert.doesNotMatch(plain.chips('stale').stdout, /no review scope/);
});

test('chips ranks a deferred scope after every other task, and a task that other work waits on keeps its place', () => {
  const { batch, chips } = chipLedger({ config: { chips: { scopes: 'scopes', deferred: ['collaboration'] } }, files: { 'scopes/collaboration.json': '{}', 'scopes/editor.json': '{}' } });
  const written = batch([
    ['task_z1 Fix z1', 'offered', 'writes: z1.md; topic: z1; priority: P1; repro: steps; review-scope: collaboration'],
    ['task_y1 Fix y1', 'offered', 'writes: y1.md; topic: y1; priority: P1; repro: steps; review-scope: collaboration; waits: task:task_z1'],
    ['task_w1 Fix w1', 'offered', 'writes: w1.md; topic: w1; priority: P2; via: verdict; review-scope: editor; waits: task:task_y1'],
    ['task_y0 Fix y0', 'offered', 'writes: y0.md; topic: y0; priority: P0; repro: two peers diverge; review-scope: collaboration'],
    ['task_e3 Tune e3', 'offered', 'writes: e3.md; topic: e3; priority: P3; via: verdict; review-scope: editor'],
    ['task_y2 Fix y2', 'offered', 'writes: y2.md; topic: y2; priority: P2; via: verdict; review-scope: collaboration'],
    ['task_y3 Fix y3', 'offered', 'writes: y3.md; topic: y3; priority: P2; via: verdict; review-scope: collaboration; waits: task:task_y2'],
    ['task_y4 Fix y4', 'offered', 'writes: y4.md; topic: y4; priority: P0; repro: two peers diverge; review-scope: collaboration; waits: task:task_e3'],
  ]);
  assert.equal(written.status, 0, written.stderr);
  const board = chips().stdout;
  assert.match(board, /\nReady, P1 \(1\)\n {2}task_z1 /, 'a task that work outside the list waits on through another task keeps its place');
  assert.match(board, /\nWaiting, P1 \(1\)\n {2}task_y1 /);
  assert.match(board, /\nReady, deferred, P0 \(1\)\n {2}task_y0 /);
  assert.match(board, /Do, card pass \(4\)\n {2}card task_z1:[^\n]*\n {2}card task_e3:[^\n]*\n {2}card task_y0:[^\n]*\n {2}card task_y2:/, 'a deferred P0 cards after a P3, lifts no task outside the list it waits on, and a deferred waiter keeps no task in place');
  assert.match(chips('brief', 'task_y0').stdout, /^Review scope: collaboration\. Deferred, so it ranks after every task whose scope chips\.deferred does not list\.$/mu);
  assert.match(chips('brief', 'task_y1').stdout, /^Review scope: collaboration\.$/mu);
});

test('a deferred task queues behind other work on a shared outside path, and chips asks to fix a chips.deferred it cannot use', () => {
  const { batch, chips, outside } = chipLedger({ config: { chips: { scopes: 'scopes', deferred: ['collaboration'] } }, files: { 'scopes/collaboration.json': '{}', 'scopes/editor.json': '{}' } });
  const written = batch([
    ['task_d1 Fix the shared doc', 'offered', `writes: ${outside('shared.md')}; topic: d1; priority: P0; repro: steps; review-scope: collaboration`],
    ['task_n1 Reword the shared doc', 'offered', `writes: ${outside('shared.md')}; topic: n1; priority: P1; repro: steps; review-scope: editor`],
  ]);
  assert.equal(written.status, 0, written.stderr);
  const board = chips().stdout;
  assert.match(board, /\nReady, P1 \(1\)\n {2}task_n1 /);
  assert.match(board, /\nWaiting, deferred, P0 \(1\)\n {2}task_d1 {2}Fix the shared doc {2}\[d1\] {2}waits on queued behind task_n1/);
  const cases = [
    [['colaboration'], /fix chips\.deferred in \.agents\/pstack\.json: colaboration is no review scope in scopes/],
    [{ collaboration: true }, /fix chips\.deferred in \.agents\/pstack\.json: it is a list of review scope ids/],
  ];
  for (const [deferred, said] of cases) {
    const wrong = chipLedger({ config: { chips: { scopes: 'scopes', deferred } }, files: { 'scopes/collaboration.json': '{}' } });
    const offered = wrong.batch([['task_c1 Fix c1', 'offered', 'writes: c1.md; topic: c1; priority: P1; repro: steps; review-scope: collaboration']]);
    assert.equal(offered.status, 0, offered.stderr);
    const listed = wrong.chips();
    assert.equal(listed.status, 1, JSON.stringify(deferred));
    assert.match(listed.stdout, said);
  }
});

test('a deferred task that owns a check failing on the base branch keeps its place', () => {
  const { batch, chips } = chipLedger({ config: { chips: { scopes: 'scopes', deferred: ['collaboration'] } }, files: { 'scopes/collaboration.json': '{}', 'scopes/editor.json': '{}' } });
  const written = batch([
    ['task_e1 Fix e1', 'offered', 'writes: e1.md; topic: e1; priority: P1; repro: steps; review-scope: editor'],
    ['task_y1 Fix the red peer-order step', 'offered', 'writes: y1.md; topic: y1; priority: P2; via: verdict; review-scope: collaboration; owns: ci:yjs-peer-order'],
  ]);
  assert.equal(written.status, 0, written.stderr);
  const board = chips().stdout;
  assert.match(board, /\nReady, P0 \(1\)\n {2}task_y1 /, 'a red check fails every change, so its task is not deferred');
  assert.doesNotMatch(board, /Ready, deferred/);
  assert.match(chips('brief', 'task_y1').stdout, /^Review scope: collaboration\.$/mu);
});

test("a session withdraws its lowest deferred cards when tasks that rank above them have no room for a card", () => {
  const { batch, chips } = chipLedger({ config: { chips: { scopes: 'scopes', deferred: ['collaboration'] } }, files: { 'scopes/collaboration.json': '{}', 'scopes/editor.json': '{}' } });
  const deferred = [['y1', 'P0'], ['y2', 'P1'], ['y3', 'P1']].map(([id, priority]) => [`task_${id} Fix ${id}`, 'offered', `writes: ${id}.md; topic: ${id}; priority: ${priority}; repro: steps; review-scope: collaboration; card: c${id}; session: s1`]);
  const held = [1, 2, 3, 4, 5, 6, 7].map((n) => [`task_n${n} Fix n${n}`, 'offered', `writes: n${n}.md; topic: n${n}; priority: P1; repro: steps; review-scope: editor; card: cn${n}; session: s1`]);
  const waiting = ['a1', 'a2'].map((id) => [`task_${id} Fix ${id}`, 'offered', `writes: ${id}.md; topic: ${id}; priority: P2; via: verdict; review-scope: editor; session: s1`]);
  const written = batch([...deferred, ...held, ...waiting]);
  assert.equal(written.status, 0, written.stderr);
  assert.match(chips('--session', 's1').stdout, /Do, withdrawal pass \(2\)\n {2}withdraw task_y2's card cy2: its review scope is deferred, and 2 ready tasks that rank above it have no room for a card;[^\n]*\n {2}withdraw task_y3's card cy3:/, 'a deferred P1 card gives way to a P2 outside the list, lowest first');
  assert.equal(batch([['task_y3 Fix y3', 'uncarded', 'card: cy3']]).status, 0);
  const one = chips('--session', 's1').stdout;
  assert.match(one, /Do, withdrawal pass \(1\)\n {2}withdraw task_y2's card cy2: its review scope is deferred, and 1 ready task that ranks above it has no room for a card;/);
  assert.doesNotMatch(one, /withdraw task_y1/, 'a deferred card stays while the tasks above it have room');
  assert.equal(batch([['task_y2 Fix y2', 'uncarded', 'card: cy2']]).status, 0);
  assert.match(chips('--session', 's1').stdout, /Do, card pass \(3\)\n {2}card task_a1:[^\n]*\n {2}card task_a2:[^\n]*\n {2}2 more can start once this session holds fewer than 10 cards/, 'the freed room goes to the tasks outside the list, not back to the deferred ones');
  assert.doesNotMatch(chips().stdout, /withdraw task_y/, 'a read with no session withdraws nothing');

  const leaving = chipLedger({ config: { chips: { scopes: 'scopes', deferred: ['collaboration'] } }, files: { 'scopes/collaboration.json': '{}', 'scopes/editor.json': '{}' } });
  assert.equal(leaving.batch([...deferred, ...held, ...waiting, ['task_n7 Fix n7', 'updated', 'waits: pr:5']]).status, 0);
  const freed = leaving.chips('--session', 's1').stdout;
  assert.match(freed, /withdraw task_n7's card cn7: /);
  assert.match(freed, /withdraw task_y3's card cy3: its review scope is deferred, and 1 ready task that ranks above it has no room for a card;/, "a card that leaves for a wait frees its room");
  assert.doesNotMatch(freed, /withdraw task_y2/);
});

const triagedLedger = (files = {}) =>
  chipLedger({ config: { triage: { experimental: ['pagination'] }, chips: { scopes: 'scopes' } }, files: { 'scopes/editor.json': '{}', 'scopes/native.json': '{}', 'scopes/pagination.json': '{}', ...files } });

test('a chip ranks by its own review scope and regression pages, and the card pass offers in that order', () => {
  const { batch, chip, chips, merge, root } = triagedLedger({ 'scopes/ghost.json/.keep': '' });
  merge('break the page break');
  const head = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  const written = batch([
    ['task_f1 Fix f', 'offered', 'writes: f.md; topic: f; priority: P0; repro: type then reload; review-scope: pagination'],
    ['task_r1 Fix r', 'offered', `writes: r.md; topic: r; priority: P0; review-scope: pagination; regressed: ${head}`],
    ['task_n1 Fix n', 'offered', 'writes: n.md; topic: n; priority: P1; repro: steps; review-scope: none'],
    ['task_d1 Fix d', 'offered', 'writes: d.md; topic: d; priority: P1; repro: steps; review-scope: editor; regression: https://example.org/tool'],
    ['task_e1 Fix e', 'offered', 'writes: e.md; topic: e; priority: P1; repro: steps; review-scope: editor'],
    ['task_k1 Fix k', 'offered', 'writes: k.md; topic: k; priority: P1; repro: steps; review-scope: editor; regression: https://platejs.org/docs/a'],
    ['task_p1 Fix p', 'offered', 'writes: p.md; topic: p; priority: P1; repro: Type regression: stale into the box and reload; review-scope: editor'],
  ]);
  assert.equal(written.status, 0, written.stderr);
  const board = chips().stdout;
  assert.match(board, /Ready, P0 \(2\)\n {2}task_f1 {2}Fix f {2}\[f\] {2}experimental [^\n]*\n {2}task_r1 {2}Fix r {2}\[r\] {2}experimental /, 'regressed: names a commit, not a page where the behavior works');
  assert.match(board, /task_p1 {2}Fix p {2}\[p\] {2}new /, 'regression: inside the repro is part of the repro');
  assert.match(board, /Do, card pass \(7\)\n {2}card task_f1:[^\n]*\n {2}card task_r1:[^\n]*\n {2}card task_d1:[^\n]*\n {2}card task_k1:[^\n]*\n {2}card task_n1:/, 'the card pass offers by milestone class within a priority');
  assert.equal(chip('task_k1 Fix k', 'updated', 'regression:').status, 0);
  assert.match(chips().stdout, /task_k1 {2}Fix k {2}\[k\] {2}new /, 'an empty regression: clears the pages when the record drops them');
  const refused = batch([
    ['task_u1 Fix u', 'offered', 'writes: u.md; topic: u; priority: P1; repro: steps; review-scope: editor; regression: https://:'],
    ['task_v1 Fix v', 'offered', 'writes: v.md; topic: v; priority: P1; repro: steps; review-scope: ghost'],
  ]);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /"https:\/\/:" is not a URL/);
  assert.match(refused.stderr, /review-scope: ghost is no review scope in scopes/, 'a folder named like a scope file is no scope');
  const plain = chipLedger().batch([['task_p1 Fix p', 'offered', 'writes: p.md; topic: p; priority: P1; repro: Type regression: stale into the box and reload']]);
  assert.equal(plain.status, 0, plain.stderr);
});

test('chips.tiers ranks each priority by the checks a task owns, the paths it writes and its scope, with base-red work first above the catch-all tier', () => {
  const tiers = [{ name: 'core', paths: ['src/core/'], except: ['src/core/extra/'] }, { name: 'feature' }, { name: 'late', scopes: ['late'], checks: ['e2e:ai-'] }];
  const { batch, chips, chip } = chipLedger({ config: { triage: { experimental: ['late'] }, chips: { scopes: 'scopes', tiers } }, files: { 'scopes/editor.json': '{}', 'scopes/late.json': '{}' } });
  const written = batch([
    ['task_z1 Fix z', 'offered', 'writes: src/late/d.ts; topic: z; priority: P0; repro: steps; review-scope: late'],
    ['task_l1 Fix l', 'offered', 'writes: src/late/a.ts; topic: l; priority: P1; repro: steps; review-scope: late'],
    ['task_f1 Fix f', 'offered', 'writes: src/ui/a.ts; topic: f; priority: P1; repro: steps; review-scope: editor'],
    ['task_c1 Fix c', 'offered', 'writes: src/late/b.ts, src/core/x.ts; topic: c; priority: P1; repro: steps; review-scope: late'],
    ['task_x1 Fix x', 'offered', 'writes: src/core/extra/y.ts; topic: x; priority: P1; repro: steps; review-scope: editor'],
    ['task_r1 Fix r', 'offered', 'writes: src/late/c.ts; topic: r; priority: P1; repro: steps; review-scope: late; owns: e2e:late'],
    ['task_g1 Fix g', 'offered', 'writes: src/ui/g.ts; topic: g; priority: P1; repro: steps; review-scope: editor; owns: e2e:ui'],
    ['task_a1 Fix a', 'offered', 'writes: src/ui/h.ts; topic: a; priority: P1; repro: steps; review-scope: editor; owns: e2e:ai-chat'],
    ['task_m1 Fix m', 'offered', 'writes: src/ui/m.ts; topic: m; priority: P1; repro: steps; review-scope: editor; owns: e2e:ai-x, e2e:ui-y'],
  ]);
  assert.equal(written.status, 0, written.stderr);
  const board = chips().stdout;
  assert.match(board, /Ready, P0 \(2\)\n {2}task_g1 {2}Fix g {2}\[g\] {2}regression {2}owns e2e:ui {2}no card\n {2}task_m1 {2}Fix m {2}\[m\] {2}regression {2}owns e2e:ai-x, e2e:ui-y {2}no card\n\n/, 'a red check above the catch-all tier makes a P0 that ranks first, and checks place a task only when they hold every check it owns');
  assert.match(board, /Ready, P1 \(7\)\n {2}task_c1 {2}Fix c {2}\[c\] {2}core {2}no card\n {2}task_f1 {2}Fix f {2}\[f\] {2}feature {2}no card\n {2}task_x1 {2}Fix x {2}\[x\] {2}feature {2}no card\n {2}task_z1 {2}Fix z {2}\[z\] {2}late {2}no card\n {2}task_l1 {2}Fix l {2}\[l\] {2}late {2}no card\n {2}task_r1 {2}Fix r {2}\[r\] {2}late {2}owns e2e:late {2}no card\n {2}task_a1 {2}Fix a {2}\[a\] {2}late {2}owns e2e:ai-chat {2}no card\n/, 'a core write beats its scope, an excepted path falls to the catch-all tier, and a tier after the catch-all ranks no task above P1, red check or P0 token included');
  assert.equal(chip('task_c1 Fix c', 'updated', 'writes: src/late/b.ts').status, 0);
  assert.match(chips('brief', 'task_c1').stdout, /Tier: late, rank 3 of chips.tiers within its priority\./, 'dropping the core write moves the task to its scope tier');
  const loose = chipLedger({ config: { chips: { scopes: 'scopes', tiers: [{ name: 'a' }, { name: 'b' }] } }, files: { 'scopes/editor.json': '{}' } });
  assert.equal(loose.batch([['task_a1 Fix a', 'offered', 'writes: a.md; topic: a; priority: P2; via: verdict; review-scope: editor']]).status, 0);
  assert.match(loose.chips().stdout, /fix chips\.tiers in \.agents\/pstack\.json: a and b name no paths, scopes or checks/);
});

test('a reopened duplicate leaves the kept task its own milestone class, whatever proof the merge copied', () => {
  const { batch, chip, chips, merge, root } = triagedLedger();
  merge('break page breaks');
  const head = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  const written = batch([
    ['task_keep Fix pagination', 'offered', 'writes: a.md; topic: shared; priority: P0; repro: steps; review-scope: pagination'],
    ['task_dup Fix page breaks', 'offered', `writes: b.md; topic: shared; priority: P0; review-scope: pagination; regressed: ${head}`],
    ['task_peer Fix another bug', 'offered', 'writes: c.md; topic: shared; priority: P0; repro: steps; review-scope: editor'],
    ['task_dup Fix page breaks', 'dismissed dup task_keep', 'evidence'],
    ['task_dup Fix page breaks', 'reopened', 'the owner says these are separate fixes'],
    ['task_dup Fix page breaks', 'apart', 'from: task_keep'],
  ]);
  assert.equal(written.status, 0, written.stderr);
  assert.match(chips('brief', 'task_keep').stdout, /^Review scope: pagination\. Milestone: experimental\.$/mu);
  assert.match(chips().stdout, /Do, card pass \(3\)\n {2}card task_peer:/, 'the new task cards before the experimental ones');
});

test('reopening the middle of a duplicate chain gives it back its own milestone class', () => {
  const { batch, chips } = triagedLedger();
  const written = batch([
    ['task_leaf Fix typing', 'offered', 'writes: a.md; topic: shared; priority: P1; repro: steps; review-scope: editor; regression: https://www.slatejs.org/examples/richtext'],
    ['task_mid Fix editor', 'offered', 'writes: b.md; topic: shared; priority: P1; repro: steps; review-scope: editor'],
    ['task_top Fix pagination', 'offered', 'writes: c.md; topic: shared; priority: P1; repro: steps; review-scope: pagination'],
    ['task_leaf Fix typing', 'dismissed dup task_mid', 'evidence'],
    ['task_mid Fix editor', 'dismissed dup task_top', 'evidence'],
    ['task_leaf Fix typing', 'reopened', 'separate work'],
    ['task_mid Fix editor', 'reopened', 'separate work'],
  ]);
  assert.equal(written.status, 0, written.stderr);
  const mid = chips('brief', 'task_mid').stdout;
  assert.match(mid, /^Review scope: editor\. Milestone: new\.$/mu);
  assert.doesNotMatch(mid, /^Regression:/mu);
  assert.match(chips().stdout, /Do, card pass \(3\)\n {2}card task_leaf:[^\n]*\n {2}card task_mid:[^\n]*\n {2}card task_top:/);
});

test('a folded row changes no review scope or regression page', () => {
  const { batch, chip, chips } = triagedLedger();
  assert.equal(batch([
    ['task_keep Fix pagination', 'offered', 'writes: a.md; topic: shared; priority: P1; repro: steps; review-scope: none'],
    ['task_peer Fix another bug', 'offered', 'writes: b.md; topic: shared; priority: P1; repro: steps; review-scope: editor'],
  ]).status, 0);
  const folded = chip('task_keep Fix pagination', 'folded', 'review-scope: pagination');
  assert.equal(folded.status, 1, 'a fold that names a review scope');
  assert.equal(chip('task_keep Fix pagination', 'folded', 'regression: https://www.slatejs.org/examples/b').status, 1, 'a fold that names regression pages');
  assert.match(chips().stdout, /Do, card pass \(2\)\n {2}card task_keep:[^\n]*\n {2}card task_peer:/);
});

test('a started task takes the review scope and regression pages a new triage record gives', () => {
  const { batch, chip, chips } = triagedLedger();
  assert.equal(batch([
    ['task_keep Fix the void Backspace', 'offered', 'writes: a.md; topic: void; priority: P1; repro: plate-private#109 holds the steps; review-scope: native'],
    ['task_keep Fix the void Backspace', 'started', 'session: s1'],
  ]).status, 0);
  const updated = chip('task_keep Fix the void Backspace', 'updated', 'review-scope: native; regression: https://www.slatejs.org/examples/editable-voids');
  assert.equal(updated.status, 0, updated.stderr);
  assert.match(chips('brief', 'task_keep').stdout, /^Review scope: native\. Milestone: regression\.\nRegression: it still works on https:\/\/www\.slatejs\.org\/examples\/editable-voids$/mu);
  assert.match(chip('task_keep Fix the void Backspace', 'updated', 'topic: other').stderr, /takes only owns:, review-scope: and regression:/);
});

test('an update that clears a kept task\'s regression pages clears them for the duplicates it covers', () => {
  const { batch, chip, chips } = triagedLedger();
  assert.equal(batch([
    ['task_keep Fix editor', 'offered', 'writes: a.md; topic: shared; priority: P1; repro: steps; review-scope: editor'],
    ['task_dup Fix typing', 'offered', 'writes: b.md; topic: shared; priority: P1; repro: steps; review-scope: editor; regression: https://www.slatejs.org/examples/richtext'],
    ['task_dup Fix typing', 'dismissed dup task_keep', 'evidence'],
  ]).status, 0);
  assert.equal(chip('task_keep Fix editor', 'updated', 'review-scope: editor; regression:').status, 0);
  const kept = chips('brief', 'task_keep').stdout;
  assert.match(kept, /^Review scope: editor\. Milestone: new\.$/mu);
  assert.doesNotMatch(kept, /^Regression:/mu);
  assert.match(kept, /^Also covers:\n- task_dup Fix typing/mu);
});

test('a repro that quotes session: or transcript: neither names the owner nor blocks the transcript stamp', () => {
  const { LEDGER, dir, env, root } = chipLedger();
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'ps'), '#!/bin/sh\necho "1 /runtime/codex"\n', { mode: 0o755 });
  const codexHome = join(env.HOME, '.codex');
  const runtimeEnv = { ...env, CODEX_HOME: codexHome, CODEX_THREAD_ID: 'child', CODEX_SESSION_ID: 'parent', CODEX_TOOL_CALL_ID: 'exec-12345678-1234-1234-1234-123456789abc', CLAUDECODE: '', CLAUDE_SESSION_ID: '', CLAUDE_CODE_SESSION_ID: '', CLAUDE_PID: '', CLAUDE_CODE_ENTRYPOINT: '', PATH: `${bin}:${process.env.PATH}` };
  const rollout = join(codexHome, 'sessions/2026/10/19/rollout-child.jsonl');
  mkdirSync(dirname(rollout), { recursive: true });
  writeFileSync(rollout, [
    { type: 'session_meta', payload: { id: 'child', session_id: 'parent', parent_thread_id: 'parent' } },
    { type: 'turn_context', payload: { model: 'gpt-6.1-sol', effort: 'high' } },
    { type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'wrapper', input: 'await tools.exec_command({cmd: process.env.COMMAND})' } },
  ].map(JSON.stringify).join('\n'));
  const append = (decision, tokens, result) => spawnSync(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'append', LEDGER, 'chip', decision, 'why', tokens, result], { cwd: root, encoding: 'utf8', env: runtimeEnv });
  assert.equal(append('task_a1 Fix a', 'writes: a.md; topic: shared; priority: P1; repro: Type session: stale into the box and reload', 'offered').status, 0);
  assert.equal(append('task_b1 Fix b', 'writes: b.md; topic: shared; priority: P1; session: x; repro: Type transcript: stale into the box and reload', 'offered').status, 0);
  const updated = append('task_a1 Fix a', 'repro: Type session: fresh into the box and reload', 'updated');
  assert.equal(updated.status, 0, updated.stderr);
  const rows = read(root, LEDGER).split('\n');
  assert.doesNotMatch(rows.find((row) => row.includes('task_a1') && row.endsWith('\toffered')), /transcript:/, 'no owner, so no transcript');
  assert.match(rows.find((row) => row.includes('task_b1')), /; transcript: rollout-child\t/, 'the real owner gets its transcript');
  assert.equal(append('task_b1 Fix b', 'session: none', 'updated').status, 0);
  assert.doesNotMatch(read(root, LEDGER).split('\n').find((row) => row.includes('task_b1') && row.endsWith('\tupdated')), /transcript:/, 'giving a task back names no owner, so no transcript');
});

test('a token after prose inside a field still reads as it did before the repro rule', () => {
  const { batch, chips } = chipLedger();
  const written = batch([
    ['task_first Fix typing', 'offered', 'writes: a.md; topic: typing; triage result priority: P1; repro: steps'],
    ['task_second Fix focus', 'offered', 'writes: b.md; topic: shared; priority: P1; repro: steps'],
  ]);
  assert.equal(written.status, 0, written.stderr);
  assert.match(chips().stdout, /Ready, P1 \(2\)\n {2}task_first [^\n]*\n {2}task_second /);
});
test('a brief says whether the board has its task Ready, Waiting or Started, whatever its priority', () => {
  const { batch, chip, chips } = chipLedger();
  const written = batch([
    ['task_p1 Fix p', 'offered', 'writes: p.md; topic: p; priority: P2; via: verdict'],
    ['task_w1 Fix w', 'offered', 'writes: w.md; topic: w; priority: P3; via: verdict; waits: task:task_p1'],
  ]);
  assert.equal(written.status, 0, written.stderr);
  assert.doesNotMatch(chips().stdout, /task_p1 {2}Fix p/, 'the board shows a P2 task only as a count');
  const ready = chips('brief', 'task_p1').stdout;
  assert.match(ready, /^State: Ready\.$/mu);
  assert.match(ready, /When the State: line that chips brief prints says neither Ready nor Started, tell the owner what it says and stop\./);
  assert.match(ready, /each field in "<tokens>" ended by ";" before the next, such as "writes: a\.ts, b\.ts; session: <id>"/);
  assert.match(chips('brief', 'task_w1').stdout, /^State: Waiting on task:task_p1 [^\n]*\.$/mu);
  assert.equal(chip('task_p1 Fix p', 'started', 'session: s1').status, 0);
  assert.match(chips('brief', 'task_p1').stdout, /^State: Started\.$/mu);
  const outside = batch([
    ['task_o1 Fix the other repo', 'offered', 'writes: /elsewhere/repo/x.md; topic: o1; priority: P2; via: verdict'],
    ['task_o2 Tune the other repo', 'offered', 'writes: /elsewhere/repo/x.md; topic: o2; priority: P2; via: verdict'],
  ]);
  assert.equal(outside.status, 0, outside.stderr);
  assert.match(chips('brief', 'task_o1').stdout, /^State: Ready\.$/mu);
  assert.match(chips('brief', 'task_o2').stdout, /^State: Waiting on queued behind task_o1, which writes the same paths outside this checkout\.$/mu, 'a task writing outside the checkout queues behind an earlier ready task on the same path');
});

test('chips ranks a task with the most urgent open task that waits on it', () => {
  const { batch, chip, chips } = chipLedger();
  const written = batch([
    ['task_a1 Fix the lost save', 'offered', 'writes: a.md; topic: save; priority: P0; repro: type then reload loses the text; waits: task:task_b1'],
    ['task_b1 Tune the index', 'offered', 'writes: b.md; topic: index; priority: P2; via: verdict; waits: task:task_c1'],
    ['task_c1 Measure the index', 'offered', 'writes: c.md; topic: measure; priority: P3; via: verdict'],
    ['task_d1 Fix the cursor', 'offered', 'writes: d.md; topic: cursor; priority: P1; repro: click past the end; waits: task:task_e1'],
    ['task_e1 Probe the cursor', 'offered', 'writes: e.md; topic: probe; priority: P3; via: verdict'],
    ['task_f1 Tidy the toolbar', 'offered', 'writes: f.md; topic: toolbar; priority: P2; via: verdict; waits: task:task_g1'],
    ['task_g1 Fix the toolbar focus', 'offered', 'writes: g.md; topic: focus; priority: P1; repro: tab past the last button'],
  ]);
  assert.equal(written.status, 0, written.stderr);
  const board = chips().stdout;
  assert.match(board, /Ready, P0 \(1\)\n {2}task_c1 {2}Measure the index {2}\[measure\] {2}blocks task_b1 {2}no card\n/, 'a P3 task under a P2 that a P0 waits on ranks P0');
  assert.match(board, /Ready, P1 \(2\)\n {2}task_e1 {2}Probe the cursor {2}\[probe\] {2}blocks task_d1 {2}no card\n {2}task_g1 {2}Fix the toolbar focus {2}\[focus\] {2}no card\n/, 'a less urgent waiter lowers nothing');
  assert.match(board, /Waiting, P0 \(2\)\n {2}task_a1 [^\n]*\n {2}task_b1 {2}Tune the index {2}\[index\] {2}blocks task_a1 {2}waits on task:task_c1 offered\n/);
  assert.match(chips('brief', 'task_c1').stdout, /^\[P0\] Measure the index\n\nTopic: measure\. Kind: fix\. Effort: high\. Priority: P0, from task_b1, which waits on it; its own is P3\.\n/);
  assert.match(chips('stale').stdout, /task_c1 [^\n]*priority P0 \(own P3, from task_b1\);/);
  assert.equal(chip('task_a1 Fix the lost save', 'dismissed done').status, 0);
  assert.match(chips('brief', 'task_c1').stdout, /^\[P2\] [^\n]*\n\n[^\n]*Priority: P2, from task_b1, which waits on it; its own is P3\./, 'the lift follows the waiters still open');
});

test('chips raises a task through waits logged after it, never from a started task, and shows its own priority once nothing more urgent waits', () => {
  const { batch, chip, chips } = chipLedger();
  const written = batch([
    ['task_m1 Measure the index', 'offered', 'writes: m.md; topic: measure; priority: P3; via: verdict'],
    ['task_n1 Tune the index', 'offered', 'writes: n.md; topic: index; priority: P2; via: verdict; waits: task:task_m1'],
    ['task_o1 Fix the lost save', 'offered', 'writes: o.md; topic: save; priority: P0; repro: type then reload loses the text; waits: task:task_n1'],
  ]);
  assert.equal(written.status, 0, written.stderr);
  assert.match(chips('brief', 'task_m1').stdout, /^\[P0\] [^\n]*\n\n[^\n]*Priority: P0, from task_n1, which waits on it; its own is P3\./, 'the raise climbs a chain whose waiters come later in the ledger');
  const started = chip('task_o1 Fix the lost save', 'started', 'session: s9');
  assert.equal(started.status, 0, started.stderr);
  assert.match(chips('brief', 'task_m1').stdout, /^\[P2\] [^\n]*\n\n[^\n]*Priority: P2, from task_n1, which waits on it; its own is P3\./, "a started task's waits no longer count");
  assert.equal(chip('task_n1 Tune the index', 'dismissed declined').status, 0);
  assert.match(chips('brief', 'task_m1').stdout, /^\[P3\] Measure the index\n\nTopic: measure\. Kind: fix\. Effort: high\. Priority: P3\.\n/);
  assert.match(chips('stale').stdout, /task_m1 [^\n]*priority P3;/);
  assert.doesNotMatch(chips('stale').stdout, /task_m1 [^\n]*own/);
});

test("a card stays when its task's priority changes, because its session prints the current brief", () => {
  const { chip, chips, offer } = chipLedger();
  assert.equal(offer('task_d1 Tune the index', 'd.md', 'topic: index; priority: P2; via: verdict; card: c1; session: s1').status, 0);
  assert.equal(chip('task_w1 Fix the lost save', 'offered', 'writes: w.md; topic: save; priority: P0; repro: type then reload loses the text; waits: task:task_d1').status, 0);
  assert.match(chips('brief', 'task_d1').stdout, /^\[P0\] Tune the index\n/, 'the brief shows the raised priority');
  assert.doesNotMatch(chips('--session', 's1').stdout, /withdraw task_d1/, 'a raised priority withdraws no card');
});

test('a task that only a waiting task raises gets a prioritize item before any card', () => {
  const { chip, chips, offer, root, LEDGER } = chipLedger();
  assert.equal(offer('task_a1 Fix a', 'src/a.ts', 'topic: one').status, 0);
  writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + ['2026-01-01T10:00:00Z', 'chip', 'task_o1 Fix the old docs', 'why', 'writes: docs/o.md', 'offered'].join('\t') + '\n');
  assert.equal(chip('task_o1 Fix the old docs', 'updated', 'topic: docs; waits: none').status, 0);
  assert.equal(chip('task_w1 Fix the lost save', 'offered', 'writes: w.md; topic: save; priority: P0; repro: type then reload loses the text; waits: task:task_o1').status, 0);
  assert.match(chips().stdout, /Do, ledger pass \(1\)\n {2}prioritize task_o1:/, 'a raise is no priority of its own');
  assert.match(chips('brief', 'task_o1').stdout, /Priority: P0, from task_w1, which waits on it; its own is none yet\./);
  assert.equal(chip('task_o1 Fix the old docs', 'updated', 'priority: P3').status, 0);
  assert.match(chips().stdout, /Do, card pass[\s\S]*card task_o1:/);
});

test('chips offers each open item of the ship list as a P1 task with the waits the item names', () => {
  const { chips, offer, root } = chipLedger();
  assert.equal(offer('task_c1 Fix the cursor', 'c.md', 'topic: cursor; priority: P1; repro: click past the end').status, 0);
  writeFileSync(join(root, '.agents/pstack.json'), JSON.stringify({ branch: 'next', chips: { ship: [process.execPath, 'ship.mjs'] } }));
  writeFileSync(join(root, 'ship.mjs'), "import { readFileSync } from 'node:fs';\nprocess.stdout.write(readFileSync('ship.json', 'utf8'));\n");
  const items = (list) => writeFileSync(join(root, 'ship.json'), JSON.stringify(list));
  items([
    { id: 'r1', title: 'Settle review item r1 (xhigh)', finding: 'r1 is open', writes: ['docs/plans'], topic: 'review-r1', kind: 'decide' },
    { id: 'r2', title: 'Settle review item r2 (xhigh)', finding: 'r2 is open', writes: ['docs/plans'], topic: 'review-r2', kind: 'decide' },
    { id: 'r3', title: 'Settle review item r3 (xhigh)', finding: 'r3 is open', writes: ['docs/plans'], topic: 'review-r3', kind: 'decide', waits: ['run:docs/plans/r3.md'] },
  ]);
  const shown = chips();
  const board = shown.stdout;
  assert.match(board, /Do, ledger pass \(3\)\n {2}offer ship item r1, which no open task serves: append chip "t_[0-9a-f]+ Settle review item r1 \(xhigh\)" "r1 is open" "writes: docs\/plans; topic: review-r1; kind: decide; priority: P1; ship: r1" offered\n {2}offer ship item r2/, shown.stderr);
  assert.match(board, /offer ship item r3, [^\n]*; ship: r3; waits: run:docs\/plans\/r3\.md" offered/, 'an item a plan works on is offered waiting on that plan');
  assert.equal(offer('task_s1 Settle review item r1 (xhigh)', 'docs/plans', 'topic: review-r1; kind: decide; priority: P1; ship: r1').status, 0);
  const closed = offer('task_s9 Settle review item r9 (xhigh)', 'docs/plans', 'topic: review-r9; kind: decide; priority: P1; ship: r9');
  assert.match(closed.stderr, /ship: r9 is not an open item of the project's ship list/);
  items([{ id: 'r2', title: 'Settle review item r2 (xhigh)', writes: ['docs/plans'] }]);
  assert.match(chips('stale').stdout, /task_s1 [^\n]*priority P1; ship item r1 is no longer open/);
  writeFileSync(join(root, 'ship.mjs'), 'process.exit(3);\n');
  assert.match(chips().stdout, /No ship list: [^\n]*ship\.mjs failed/);
});

test('no session owns a ship-list task, so only chips all cards it', () => {
  const { chip, chips, offer, root } = chipLedger();
  writeFileSync(join(root, '.agents/pstack.json'), JSON.stringify({ branch: 'next', chips: { ship: [process.execPath, 'ship.mjs'] } }));
  writeFileSync(join(root, 'ship.mjs'), "import { readFileSync } from 'node:fs';\nprocess.stdout.write(readFileSync('ship.json', 'utf8'));\n");
  writeFileSync(join(root, 'ship.json'), JSON.stringify([
    { id: 'r1', title: 'Settle review item r1', finding: 'r1 is open', writes: ['docs/plans'], topic: 'review-r1', kind: 'fix' },
    { id: 'r2', title: 'Settle review item r2', finding: 'r2 is open', writes: ['docs/plans'], topic: 'review-r2', kind: 'fix' },
  ]));
  assert.equal(offer('task_a1 Fix the parser', 'src/a.ts', 'topic: a; session: s2').status, 0);
  assert.match(chips('--session', 's1').stdout, /offer ship item r1[^\n]*"writes: docs\/plans; topic: review-r1; kind: fix; priority: P1; ship: r1" offered/, 'a ship offer names no session');
  assert.equal(offer('task_s1 Settle review item r1', 'docs/plans', 'topic: review-r1; priority: P1; ship: r1; session: s2').status, 0);
  assert.equal(offer('task_s2 Settle review item r2', 'docs/plans', 'topic: review-r2; priority: P1; ship: r2').status, 0);
  const own = chips('--session', 's1').stdout;
  assert.doesNotMatch(own, /card task_s/, 'a plain board cards no ship task');
  assert.doesNotMatch(chips().stdout, /card task_s/, 'a board read with no session id cards no ship task');
  assert.match(own, /Other owners \(2\)\n {2}session s2 {2}1 open: task_a1\n {2}no owner {2}2 open: task_s1, task_s2\n/, 'a ship task shows as one no session owns');
  assert.match(chips('all', '--session', 's1').stdout, /Do, card pass \(2\)\n {2}card task_s1:[^\n]*\n {2}card task_s2:/, 'chips all cards a ship task, even one an older offer gave to s2');
  assert.equal(chip('task_s1 Settle review item r1', 'carded', 'card: c1; session: s1').status, 0);
  assert.equal(chip('task_s1 Settle review item r1', 'uncarded', 'card: c1').status, 0);
  assert.equal(chip('task_s1 Settle review item r1', 'updated', 'session: s1').status, 0);
  assert.equal(chip('task_s1 Settle review item r1', 'carded', 'card: c2; session: s3').status, 0, 'neither carding nor an updated session: makes a ship task one session\'s');
  assert.equal(chip('task_a1 Fix the parser', 'carded', 'card: c3; session: s1').status, 1, 'a task off the ship list keeps its owner');
});

test('chips stale lists each open task with the paths it writes that were deleted since its offer or are missing, and the commits on its paths since its offer', () => {
  const { chip, chips, offer, root } = chipLedger();
  writeFileSync(join(root, 'kept.md'), 'old\n');
  writeFileSync(join(root, 'gone.md'), 'old\n');
  spawnSync('git', ['-C', root, 'add', 'kept.md', 'gone.md']);
  const earlier = new Date(Date.now() - 86_400_000).toISOString();
  spawnSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'add kept'], { env: { ...process.env, GIT_AUTHOR_DATE: earlier, GIT_COMMITTER_DATE: earlier } });
  assert.equal(offer('task_a1 Fix a', 'kept.md, gone.md, new.md', 'topic: stale').status, 0);
  assert.equal(offer('task_b1 Fix b', 'docs/plans', 'topic: fresh; card: c1; session: s1').status, 0);
  assert.equal(offer('task_c1 Fix c', 'src/c.ts', 'topic: closed').status, 0);
  assert.equal(chip('task_c1 Fix c', 'dismissed done').status, 0);
  writeFileSync(join(root, 'kept.md'), 'new\n');
  spawnSync('git', ['-C', root, 'rm', '-q', 'gone.md']);
  const later = new Date(Date.now() + 86_400_000).toISOString();
  spawnSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qam', 'fix kept'], { env: { ...process.env, GIT_AUTHOR_DATE: later, GIT_COMMITTER_DATE: later } });
  const stale = chips('stale');
  assert.equal(stale.status, 0, stale.stderr);
  assert.equal(
    stale.stdout,
    '2 open suggested tasks in docs/plans/suggested-tasks.decisions.tsv, the likeliest stale first:\n' +
      '  task_a1  Fix a  [stale]  age 0d; priority P1; deleted since its offer: gone.md; missing: new.md; 1 commit on its paths since its offer, last "fix kept"\n' +
      '  task_b1  Fix b  [fresh]  age 0d; priority P1; card c1 in session s1\n',
  );
});

test('chips stale counts a commit in the repository that holds each path, and no pure rename or move between the project and its companion', () => {
  const { chips, offer, root } = chipLedger();
  writeFileSync(join(root, '.agents/pstack.json'), JSON.stringify({ branch: 'next', companion: { dir: '.git-private', list: '.gitprivate' } }));
  const project = ['-C', root];
  const companion = ['--git-dir', join(root, '.git-private'), '--work-tree', root];
  spawnSync('git', [...companion, 'init', '-q']);
  const commit = (via, message, when) => spawnSync('git', [...via, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', message], { env: { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } });
  const earlier = new Date(Date.now() - 86_400_000).toISOString();
  const later = new Date(Date.now() + 86_400_000).toISOString();
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'docs/notes'), { recursive: true });
  writeFileSync(join(root, 'src/old.ts'), 'export const a = 1;\n');
  writeFileSync(join(root, 'docs/notes/moved.md'), 'moved\n');
  spawnSync('git', [...project, 'add', 'src/old.ts', 'docs/notes/moved.md']);
  commit(project, 'add the files', earlier);
  mkdirSync(join(root, 'lib'), { recursive: true });
  writeFileSync(join(root, 'lib/seed.ts'), 'shared\n');
  spawnSync('git', [...companion, 'add', 'lib/seed.ts']);
  commit(companion, 'seed the companion', earlier);
  writeFileSync(join(root, 'docs/both.md'), 'both\n');
  writeFileSync(join(root, 'docs/back.md'), 'back\n');
  spawnSync('git', [...project, 'add', 'docs/both.md']);
  commit(project, 'track both in the project', earlier);
  mkdirSync(join(root, 'docs/only'), { recursive: true });
  writeFileSync(join(root, 'docs/only/leaf.md'), 'leaf\n');
  spawnSync('git', [...companion, 'add', 'docs/both.md', 'docs/back.md', 'docs/only/leaf.md']);
  commit(companion, 'track both in the companion', earlier);
  assert.equal(offer('task_a1 Fix the source', 'src', 'topic: source').status, 0);
  assert.equal(offer('task_d1 Fix both', 'docs/both.md', 'topic: both').status, 0);
  assert.equal(offer('task_e1 Fix the note that came back', 'docs/back.md', 'topic: back').status, 0);
  assert.equal(offer('task_c1 Fix the library', 'lib', 'topic: library').status, 0);
  assert.equal(offer('task_b1 Fix the note', 'docs/notes/moved.md', 'topic: note').status, 0);
  assert.equal(offer('task_f1 Fix the note by its full path', join(root, 'docs/notes/moved.md'), 'topic: note-path').status, 0);
  assert.equal(offer('task_g1 Fix the only leaf by its full path', join(root, 'docs/only/leaf.md'), 'topic: leaf').status, 0);
  assert.equal(offer('task_h1 Fix the old source', 'src/old.ts', 'topic: old-source').status, 0);
  spawnSync('git', [...project, 'mv', 'src/old.ts', 'src/new.ts']);
  commit(project, 'rename the source', later);
  spawnSync('git', [...project, 'rm', '-q', '--cached', 'docs/notes/moved.md']);
  commit(project, 'move the note out', later);
  spawnSync('git', [...companion, 'add', 'docs/notes/moved.md']);
  commit(companion, 'move the note in', later);
  writeFileSync(join(root, 'docs/notes/moved.md'), 'edited\n');
  spawnSync('git', [...companion, 'add', 'docs/notes/moved.md']);
  commit(companion, 'edit the note', later);
  writeFileSync(join(root, 'lib/same.ts'), 'shared\n');
  spawnSync('git', [...project, 'add', 'lib/same.ts']);
  commit(project, 'add the shared file', later);
  spawnSync('git', [...project, 'rm', '-q', 'docs/both.md']);
  commit(project, 'delete both', later);
  spawnSync('git', [...companion, 'rm', '-q', 'docs/only/leaf.md']);
  commit(companion, 'delete the only leaf', later);
  spawnSync('git', [...companion, 'rm', '-q', '--cached', 'docs/back.md']);
  commit(companion, 'drop the note from the companion', new Date(Date.now() + 3_600_000).toISOString());
  spawnSync('git', [...project, 'add', 'docs/back.md']);
  commit(project, 'add the note back', new Date(Date.now() + 3 * 86_400_000).toISOString());
  const stale = chips('stale');
  assert.equal(stale.status, 0, stale.stderr);
  assert.match(stale.stdout, /task_b1 [^\n]*; 1 commit on its paths since its offer, last "edit the note"\n/, 'the companion edit counts, and neither half of the move does');
  assert.match(stale.stdout, /task_f1 [^\n]*; 1 commit on its paths since its offer, last "edit the note"\n/, 'an absolute path inside the project reads the companion too');
  assert.doesNotMatch(stale.stdout, /task_a1 [^\n]*commit/, 'a pure rename inside a written directory counts no commit');
  assert.match(stale.stdout, /task_c1 [^\n]*; 1 commit on its paths since its offer, last "add the shared file"\n/, 'a new file whose content the companion once held is no move');
  assert.match(stale.stdout, /task_d1 [^\n]*deleted since its offer: docs\/both\.md/, 'a delete counts though the companion still tracks the path');
  assert.match(stale.stdout, /task_e1 [^\n]*; 2 commits on its paths since its offer, last "add the note back"\n/, 'a delete and an add more than a day apart are no move');
  assert.match(stale.stdout, /task_g1 [^\n]*deleted since its offer: /, 'an absolute path whose directory is gone still reads its history');
  assert.match(stale.stdout, /task_h1 [^\n]*missing: src\/old\.ts/, 'a path renamed away is missing');
  assert.doesNotMatch(stale.stdout, /task_h1 [^\n]*deleted since its offer/, 'a path renamed away is no deletion');
});

test('chips groups links two open tasks that share two kinds of evidence, and an apart row keeps the pair off the list', () => {
  const { chip, chips, helper, LEDGER } = chipLedger();
  const offer = (decision, why, evidence) => helper('append', LEDGER, 'chip', decision, why, `${evidence}; priority: P2; via: verdict`, 'offered');
  const a1 = 'task_a1 Give worktree sessions a run directory the Write tool can reach';
  const c1 = 'task_c1 Name the trails rule owner';
  assert.equal(offer(a1, 'guard.mjs refuses the write', 'writes: rules/trails.md, rules/run.md; topic: run-dir-write').status, 0);
  assert.equal(offer('task_b1 Let a worktree session write its run directory without the hook refusing', 'the hook refuses it', 'writes: rules/trails.md; topic: run-dir-writes').status, 0);
  assert.equal(offer(c1, 'one owner', 'writes: rules/trails.md; topic: trails-owner').status, 0);
  assert.equal(offer('task_d1 Give worktree sessions a run directory the Read tool can reach', 'readRunDir misses it', 'writes: rules/run.md; topic: run-dir-read; waits: task:task_a1').status, 0);
  const groups = chips('groups');
  assert.equal(groups.status, 0, groups.stderr);
  assert.match(groups.stdout, /^1 group of open tasks /);
  assert.ok(
    groups.stdout.endsWith(
      '\n' +
      '  task_a1 and task_b1: problem; fix area (rules/trails.md)\n' +
      '  task_a1  Give worktree sessions a run directory the Write tool can reach  [run-dir-write]  no card\n' +
      '  task_b1  Let a worktree session write its run directory without the hook refusing  [run-dir-writes]  no card\n',
    ),
    'task_c1 shares only the file, task_d1 shares two kinds with task_a1 but waits on it, and shares only wording with task_b1',
  );
  assert.match(chip(a1, 'apart').stderr, /an apart row names in "from: <task id>, <task id>" each other task the ledger holds/);
  assert.equal(chip(a1, 'apart', 'from: task_a1').status, 1, 'the task itself');
  assert.equal(chip(a1, 'apart', 'from: task_z9').status, 1, 'a task the ledger lacks');
  const z1 = 'task_z1 Record the zebra crossing';
  assert.equal(offer(z1, 'zebra', 'writes: rules/zebra.md; topic: run-dir-write').status, 0);
  const apart = chip(z1, 'apart', 'from: task_b1');
  assert.equal(apart.status, 0, apart.stderr);
  const dup = chip(z1, 'dismissed dup task_a1');
  assert.equal(dup.status, 0, dup.stderr);
  assert.match(chips('groups').stdout, /^No two open tasks in docs\/plans\/suggested-tasks\.decisions\.tsv share two kinds of evidence/, 'task_a1 keeps the apart list of the duplicate merged into it');
  assert.equal(chip(a1, 'apart', 'from: task_z1').status, 1, 'a task merged into it');
  assert.equal(chip(c1, 'carded', 'card: k1; session: s1').status, 0);
  assert.equal(chip(c1, 'apart', 'from: task_a1').status, 0, 'an apart row changes no work, so a carded task takes it');
  const e1 = 'task_e1 Cache the parse tree';
  const f1 = 'task_f1 Expire the cache entries';
  assert.equal(offer(e1, 'slow parse', 'writes: src/cache.ts; topic: cache').status, 0);
  assert.equal(offer(f1, 'stale entries', 'writes: src/expire.ts; topic: cache').status, 0);
  assert.equal(chip(f1, 'apart', 'from: task_e1').status, 0);
  assert.equal(chip(f1, 'updated', 'waits: task:task_e1').status, 0);
  assert.doesNotMatch(chips().stdout, /merge task_f1 into task_e1/, 'chips never merges two tasks an apart row keeps apart');
  assert.match(chip(f1, 'dismissed dup task_e1').stderr, /an apart row keeps task_f1 and task_e1 apart/, 'append refuses a dup between two tasks an apart row keeps apart');
  const g1 = 'task_g1 Evict the cache on write';
  const h1 = 'task_h1 Evict the cache on every write';
  assert.equal(offer(g1, 'stale reads', 'writes: src/evict.ts; topic: cache').status, 0);
  assert.equal(offer(h1, 'stale reads', 'writes: src/evict.ts; topic: cache').status, 0);
  assert.equal(chip(g1, 'apart', 'from: task_h1').status, 0);
  assert.equal(chip(h1, 'dismissed dup task_e1').status, 0);
  assert.match(chip(g1, 'dismissed dup task_e1').stderr, /an apart row keeps task_g1 and task_e1 apart/, 'the apart row follows its task into the one it merged into');
  assert.equal(chip(g1, 'updated', 'waits: task:task_e1').status, 0);
  assert.doesNotMatch(chips().stdout, /merge task_g1 into task_e1/, 'chips follows an apart row through a dup');
  assert.equal(offer('task_k1 Keep the caret where a click lands on a page', 'caret', 'writes: apps/p/tests/donor/pagination.test.ts; topic: page-caret; repro: pnpm vitest tests/donor/pagination.test.ts').status, 0);
  assert.equal(offer('task_l1 Select all text across every page', 'select all', 'writes: apps/p/tests/donor/pagination.test.ts; topic: page-select; repro: pnpm vitest tests/donor/pagination.test.ts').status, 0);
  assert.equal(offer('task_m1 Note the cache fix in the release notes', 'notes', 'writes: .changeset/cache-fix.md; topic: cache-notes').status, 0);
  assert.equal(offer('task_n1 Note the cache fix in the release notes twice', 'notes', 'writes: .changeset/cache-fix.md; topic: cache-notes-twice').status, 0);
  const later = chips('groups').stdout;
  assert.doesNotMatch(later, /task_k1 and task_l1/, 'a file the repros name is failure evidence, never fix area too');
  assert.doesNotMatch(later, /task_m1 and task_n1/, 'a shared changeset file is no fix area');
});

test('chips stale reads a written path however its writes token spells it, and counts only what reached the branch', () => {
  const { chips, offer, root } = chipLedger();
  const [before, soon, after] = [-86_400_000, 3_600_000, 86_400_000].map((offset) => new Date(Date.now() + offset).toISOString());
  const git = (when, ...args) => spawnSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { env: { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } });
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src/main.ts'), 'export const a = 1;\n');
  writeFileSync(join(root, 'src/caf\u00e9.ts'), 'export const b = 1;\n');
  git(before, 'add', 'src');
  git(before, 'commit', '-qm', 'add the sources');
  const spellings = { task_a1: './src/main.ts', task_b1: './src', task_c1: '.', task_d1: 'src/caf\u00e9.ts' };
  for (const [id, writes] of Object.entries(spellings)) assert.equal(offer(`${id} Fix the sources`, writes, `topic: ${id.replace('_', '-')}`).status, 0, writes);
  git(soon, 'checkout', '-q', '-b', 'side');
  writeFileSync(join(root, 'src/main.ts'), 'export const a = 3;\n');
  git(soon, 'commit', '-qam', 'try a change on a side branch');
  writeFileSync(join(root, 'src/main.ts'), 'export const a = 1;\n');
  git(soon, 'commit', '-qam', 'take the change back');
  git(soon, 'checkout', '-q', '-');
  git(soon, 'merge', '-q', '--no-ff', 'side', '-m', 'merge the side branch');
  writeFileSync(join(root, 'src/main.ts'), 'export const a = 2;\n');
  writeFileSync(join(root, 'src/caf\u00e9.ts'), 'export const b = 2;\n');
  git(after, 'add', 'src');
  git(after, 'commit', '-qm', 'edit the sources');
  const old = ['writes: README.md; topic: old; priority: P2; via: verdict', 'offered'];
  appendFileSync(join(root, 'docs/plans/suggested-tasks.decisions.tsv'), [['2026-13-10T10:00:00Z', 'chip', 'task_z1 Fix an old thing', 'why', ...old], ['2026-13-10T10:00:00Z', 'chip', 'task_z1 Fix an old thing', 'why', 'evidence', 'dismissed declined']].map((row) => row.join('\t')).join('\n') + '\n');
  const stale = chips('stale');
  assert.equal(stale.status, 0, `a malformed offer time leaves the report running: ${stale.stderr}`);
  for (const [id, writes] of Object.entries(spellings)) assert.match(stale.stdout, new RegExp(`${id} [^\\n]*; 1 commit on its paths since its offer, last "edit the sources"`), writes);
});

test('a legacy row with an empty waits: replays as no waits', () => {
  const { chips, offer, root, LEDGER } = chipLedger();
  assert.equal(offer('task_a1 Fix a', 'src/a.ts', 'topic: blank; waits: pr:5').status, 0);
  writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + ['2026-01-01T10:00:00Z', 'chip', 'task_a1 Fix a', 'why', 'waits:', 'updated'].join('\t') + '\n');
  const board = chips();
  assert.equal(board.status, 0, board.stdout);
  assert.match(board.stdout, /Ready, P1 \(1\)\n {2}task_a1 {2}Fix a {2}\[blank\] {2}no card\n/, 'a row the previous helper read as clearing the waits');
});

test('chips brief on a replaced task prints its replacement\'s brief', () => {
  const { chips, offer, root, LEDGER } = chipLedger();
  assert.equal(offer('task_n1 Fix the badge', 'README.md', 'topic: badge').status, 0);
  const rows = [
    ['task_o1 Now: Fix the badge', 'writes: README.md', 'offered'],
    ['task_o1 Now: Fix the badge', 'retitled', 'dismissed replaced task_n1'],
  ];
  writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + rows.map(([decision, evidence, result]) => ['2026-01-01T10:00:00Z', 'chip', decision, 'why', evidence, result].join('\t')).join('\n') + '\n');
  const brief = chips('brief', 'task_o1');
  assert.equal(brief.status, 0, brief.stderr);
  assert.match(brief.stdout, /^task_o1 was replaced by task_n1; work from its brief\.\n\n\[P1\] Fix the badge\n/, 'an old card whose task an older helper replaced');
});

test('chips leaves a prose wait on a task with no topic to its migration', () => {
  const { chips, offer, root, LEDGER } = chipLedger();
  assert.equal(offer('task_a1 Fix a', 'src/a.ts', 'topic: other').status, 0);
  writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + ['2026-01-01T10:00:00Z', 'chip', 'task_o1 Fix o1', 'why', 'writes: src/o1.ts; waits: the parser PR', 'offered'].join('\t') + '\n');
  const board = chips();
  assert.equal(board.status, 0, 'the prose wait the migration states again: ' + board.stdout);
  assert.match(board.stdout, /migrate task_o1: log updated with topic:, priority: and the waits: it has/);
});

test('two design questions with no topic are not one topic', () => {
  const { helper, offer, root, LEDGER } = chipLedger();
  assert.equal(offer('task_a1 Fix a', 'src/a.ts', 'topic: other').status, 0);
  const rows = [
    ['task_o1 Decide the export format (xhigh)', 'writes: src/e.ts; kind: decide', 'offered'],
    ['task_o2 Decide the render order (xhigh)', 'writes: src/r.ts; kind: decide', 'offered'],
  ];
  writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + rows.map(([decision, evidence, result]) => ['2026-01-01T10:00:00Z', 'chip', decision, 'why', evidence, result].join('\t')).join('\n') + '\n');
  const whole = helper(LEDGER);
  assert.equal(whole.status, 0, 'two older design questions that name no topic: ' + whole.stderr);
});

test('chips reports a dangling wait on a task with no topic', () => {
  const { chips, offer, root, LEDGER } = chipLedger();
  assert.equal(offer('task_a1 Fix a', 'src/a.ts', 'topic: other').status, 0);
  writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + ['2026-01-01T10:00:00Z', 'chip', 'task_o1 Fix o1', 'why', 'writes: src/o1.ts; waits: task:task_zz', 'offered'].join('\t') + '\n');
  const board = chips();
  assert.equal(board.status, 1, 'a typed wait that can never clear');
  assert.match(board.stdout, /fix task_o1's wait: task:task_zz dangling, no such task/);
});

test('a card prompt asks to load the brief again after the started row', () => {
  const { chips, offer } = chipLedger();
  assert.equal(offer('task_a1 Fix the parser', 'src/p.ts', 'topic: parser').status, 0);
  assert.match(chips('brief', 'task_a1').stdout, /log a started row [^\n]*, then run cd [^\n]* && node \.agents\/pstack\/decisions-check\.mjs chips brief task_a1 again and work from what it prints, because the task can gain work until your started row\./, 'a merge between reading the brief and the started row');
});

test('a card prompt names the stored decision, shell-quoted, so its started row appends', () => {
  const { chip, chips, offer } = chipLedger();
  const decision = 'task_a1 Fix the "$HOME" parser';
  assert.equal(offer(decision, 'src/p.ts', 'topic: parser').status, 0);
  const quoted = chips('brief', 'task_a1').stdout.match(/ chip ("(?:[^"\\]|\\.)*") "<why>" "<tokens>" <result>/u)?.[1];
  assert.ok(quoted, 'the prompt shows the row command');
  const parsed = spawnSync('sh', ['-c', `printf %s ${quoted}`], { encoding: 'utf8' }).stdout;
  assert.equal(parsed, decision);
  assert.equal(chip(parsed, 'started', 'session: s1').status, 0);
});

test('a chain of dups carries every title and drops each wait that now leads back to the kept task', () => {
  const { chip, chips, offer } = chipLedger();
  assert.equal(offer('task_a1 Fix a', 'src/a.ts', 'topic: alias').status, 0);
  assert.equal(offer('task_b1 Fix b', 'src/b.ts', 'topic: alias').status, 0);
  assert.equal(offer('task_c1 Fix c', 'src/c.ts', 'topic: alias').status, 0);
  assert.equal(chip('task_c1 Fix c', 'dismissed dup task_b1').status, 0);
  assert.equal(chip('task_a1 Fix a', 'updated', 'waits: task:task_c1').status, 0);
  assert.equal(chip('task_b1 Fix b', 'dismissed dup task_a1').status, 0);
  assert.match(chips().stdout, /Ready, P1 \(1\)\n {2}task_a1 {2}Fix a {2}\[alias\] {2}no card\n/, 'a wait on a task merged earlier into the one now merged');
  assert.match(chips('brief', 'task_a1').stdout, /Also covers:\n- task_b1 Fix b\n {2}- why\n- task_c1 Fix c\n {2}- why\n/, 'titles merged earlier come along');
  assert.match(chip('task_a1 Fix a', 'updated', 'waits: task:task_c1').stderr, /task_a1 cannot wait on itself/, 'a wait on a task merged into this one');
});

test('a dup keeps a design question a design question, and is refused only when it makes a second one', () => {
  const { chip, chips, offer, root, LEDGER } = chipLedger();
  const legacy = (decision, evidence) => writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + ['2026-01-01T10:00:00Z', 'chip', decision, 'why', evidence, 'offered'].join('\t') + '\n');
  assert.equal(offer('task_k1 Fix the export', 'src/e.ts', 'topic: export').status, 0);
  assert.equal(offer('task_d1 Decide the export format (xhigh)', 'src/f.ts', 'topic: export; kind: decide').status, 0);
  assert.equal(chip('task_d1 Decide the export format (xhigh)', 'dismissed dup task_k1').status, 0);
  assert.match(chips().stdout, /task_k1 {2}Fix the export \(xhigh\) {2}\[export, decide\]/, 'the kept task takes the design question');
  assert.match(chips('brief', 'task_k1').stdout, /settles a design question first/);
  assert.equal(offer('task_e1 Decide the import format (xhigh)', 'src/g.ts', 'topic: import; kind: decide').status, 0);
  legacy('task_e2 Decide the import shape (xhigh)', 'writes: src/h.ts; topic: import; kind: decide');
  assert.equal(offer('task_e3 Fix the importer', 'src/i.ts', 'topic: import').status, 0);
  assert.match(chip('task_e2 Decide the import shape (xhigh)', 'dismissed dup task_e3').stderr, /topic import already has the open design question task_e1; log task_e2 dismissed dup task_e1 instead/, 'a dup that makes a second design question in one topic');
  const rows = ['task_f1 Decide the badge', 'task_f2 Decide the badge link', 'task_f3 Decide the badge color'].map((decision) => ['2026-01-01T10:00:00Z', 'chip', decision, 'why', 'writes: README.md; topic: badge; kind: decide', 'offered'].join('\t'));
  writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + rows.join('\n') + '\n');
  assert.match(chips().stdout, /fold topic badge: task_f1 and task_f2 and task_f3 are both open design questions/);
  assert.equal(chip('task_f2 Decide the badge link', 'dismissed dup task_f1').status, 0, 'a dup between design questions while a third stays');
  assert.equal(chip('task_f3 Decide the badge color', 'dismissed dup task_f1').status, 0);
  assert.doesNotMatch(chips().stdout, /fold topic badge/);
});

test('chips reads a PR merge only from a commit subject on the project branch', () => {
  const { chips, offer, root } = chipLedger();
  const git = (...args) => spawnSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args]);
  git('commit', '-q', '--allow-empty', '-m', 'Routine maintenance', '-m', 'Prepares the rewrite (#77)');
  git('update-ref', 'refs/remotes/origin/next', 'HEAD');
  git('commit', '-q', '--allow-empty', '-m', 'Merge pull request #78 from a/stacked');
  git('update-ref', 'refs/remotes/origin/feature', 'HEAD');
  git('commit', '-q', '--allow-empty', '-m', 'Merge pull request #79 from a/release');
  git('update-ref', 'refs/remotes/origin/release/next', 'HEAD');
  assert.equal(offer('task_a1 Fix the parser', 'src/p.ts', 'topic: parser; waits: pr:77').status, 0);
  assert.equal(offer('task_a2 Fix the printer', 'src/q.ts', 'topic: printer; waits: pr:78').status, 0);
  assert.equal(offer('task_a3 Fix the lexer', 'src/l.ts', 'topic: lexer; waits: pr:79').status, 0);
  const board = chips().stdout;
  assert.match(board, /task_a1 {2}Fix the parser {2}\[parser\] {2}waits on pr:77 not merged/, 'a PR number in a commit body');
  assert.match(board, /task_a2 {2}Fix the printer {2}\[printer\] {2}waits on pr:78 not merged/, 'a merge into a branch that is not the project branch');
  assert.match(board, /task_a3 {2}Fix the lexer {2}\[lexer\] {2}waits on pr:79 not merged/, 'a branch whose name only ends in the project branch');
});

test('a ready task with a card keeps its place when an earlier task frees up', () => {
  const { chips, merge, offer, outside } = chipLedger();
  assert.equal(offer('task_a1 Rewrite the README', outside('README.md'), 'topic: readme; waits: pr:99').status, 0);
  assert.equal(offer('task_b1 Fix the badge', outside('README.md'), 'topic: badge; card: c1; session: s1').status, 0);
  merge('Merge pull request #99 from a/readme');
  const board = chips();
  assert.match(board.stdout, /Ready, P1 \(1\)\n {2}task_b1 {2}Fix the badge {2}\[badge\] {2}card c1/, 'the card stays');
  assert.match(board.stdout, /task_a1 {2}Rewrite the README {2}\[readme\] {2}waits on queued behind task_b1/);
  assert.equal(board.status, 0, board.stdout);
});

test('a running design question takes later findings as a new question that waits on it, and takes only a new owned check', () => {
  const { appendTo, chip, offer } = chipLedger();
  const landing = 'task_d1 Decide where pasted content lands (xhigh)';
  assert.equal(offer(landing, 'src/core', 'topic: landing; kind: decide').status, 0);
  assert.equal(chip(landing, 'started').status, 0);
  const next = 'task_d2 Decide where dropped content lands (xhigh)';
  assert.match(offer(next, 'src/core', 'topic: landing; kind: decide').stderr, /topic landing's design question task_d1 is running; a new one waits on it with waits: task:task_d1/);
  assert.equal(offer(next, 'src/core', 'topic: landing; kind: decide; waits: task:task_d1').status, 0);
  assert.equal(chip(landing, 'updated', 'owns: ci:landing').status, 0, 'a started task takes the check it fixes');
  assert.equal(appendTo('docs/plans/2026-01-01-fix.decisions.tsv', 'verify', 'read CI', 'base-red: ci:landing; proof: none', 'gap: fails on next too').status, 0);
  for (const token of ['writes: src/other', 'topic: other', 'kind: fix', 'waits: pr:5']) {
    assert.match(chip(landing, 'updated', token).stderr, /task_d1 is started, so an updated row on it takes only owns:, review-scope: and regression:; the session adds paths with another started row/, `a started task's ${token.split(':')[0]}`);
  }
});

test('a card goes only to a task that is ready before the card, and names the session that holds it', () => {
  const { chip, chips, offer, outside } = chipLedger();
  assert.equal(offer('task_a1 Rewrite the README', outside('README.md'), 'topic: readme').status, 0);
  assert.equal(offer('task_b1 Fix the badge', outside('README.md'), 'topic: badge').status, 0);
  const queued = chip('task_b1 Fix the badge', 'carded', 'card: c1; session: s1');
  assert.equal(queued.status, 1, 'a card would move a queued task ahead of the task it waits behind');
  assert.match(queued.stderr, /task_b1 cannot start yet \(queued behind task_a1, which writes the same paths outside this checkout\), so it gets no card/);
  assert.match(offer('task_c1 Fix the title', outside('README.md'), 'topic: title; card: c2; session: s1').stderr, /task_c1 cannot start yet \(queued behind task_a1/, 'an offer with a card');
  assert.match(chip('task_a1 Rewrite the README', 'carded', 'card: c3').stderr, /a card names the session that holds it as "session: <id>"/);
  assert.equal(chip('task_a1 Rewrite the README', 'carded', 'card: c3; session: s1').status, 0);
  assert.equal(offer('task_d1 Fix the lexer', 'src/l.ts', 'topic: lexer; card: c4; session: s2').status, 0);
  const here = chips('--session', 's1');
  assert.equal(here.status, 0, here.stdout);
  assert.match(here.stdout, /task_d1 {2}Fix the lexer {2}\[lexer\] {2}card c4 in session s2\n/);
  assert.match(here.stdout, /check session s2, which holds task_d1's card c4: when the session tool reports it archived or gone, log uncarded/);
  assert.doesNotMatch(here.stdout, /check session s1/, "this session's own cards");
  assert.doesNotMatch(chips().stdout, /check session/, 'a board read without a session');
  assert.equal(offer('task_f1 Fix the printer', 'src/p.ts', 'topic: printer; session: s1').status, 0, 'an offer names the session that offered it, with or without a card');
  assert.doesNotMatch(chips('--session', 's1').stdout, /task_f1 {2}Fix the printer {2}\[printer\] {2}card/, 'the offering session holds no card until it cards the task');
  assert.equal(offer('task_g1 Fix the writer', 'src/w.ts', 'topic: writer; waits: pr:5; card: c5; session: s2').status, 1, 'a waiting task gets no card');
  assert.equal(offer('task_g2 Fix the reader', outside('r.md'), 'topic: reader; card: c6; session: s2').status, 0);
  assert.equal(offer('task_g3 Rewrite the reader', outside('r.md'), 'topic: reader-rewrite').status, 0);
  assert.equal(chip('task_g3 Rewrite the reader', 'started').status, 0);
  assert.match(chips('--session', 's1').stdout, /check session s2, which holds task_g2's card c6 on a task that now waits on started task_g3 writes its paths outside this checkout: when the session tool reports it archived or gone, log uncarded with card: c6/, 'a card another session holds on a task that has to wait');
  const missing = chips('--session', '--fetch');
  assert.equal(missing.status, 2, 'a flag where the session id goes');
  assert.match(missing.stderr, /--session takes this session's id/);
});

test('a started row names the session that started the task, and a sweep checks that session', () => {
  const { chip, chips, offer } = chipLedger();
  const parser = 'task_a1 Fix the parser';
  assert.equal(offer(parser, 'src/p.ts', 'topic: parser').status, 0);
  assert.equal(chip(parser, 'started').status, 0, 'a start the dismiss tool reported, which names no session');
  assert.match(chips('--session', 's1').stdout, /find the session that started task_a1 with the session tool, [^\n]*log started with session: <its id>; when the search finds none, task_a1 stays started/);
  assert.match(chip(parser, 'started', 'session: two words').stderr, /session: names the session id as one token; a field runs to the next ";", so end it with ";" before more evidence/);
  assert.equal(chip(parser, 'started', 'session: s2').status, 0);
  const here = chips('--session', 's1');
  assert.match(here.stdout, /Started \(1\)\n {2}task_a1 {2}Fix the parser {2}\[parser\] {2}session s2\n/);
  assert.match(here.stdout, /check session s2, which started task_a1: when the session tool reports it archived, log landed when a commit holds its change or its last report says it landed the change, with patch: when it names one; when that report hands back a patch it never applied, land that patch as chips brief's footer says and log landed with patch:; and log dismissed stopped when it hands back no patch and neither this checkout nor its worktree holds an uncommitted edit on its paths/);
  assert.doesNotMatch(chips('--session', 's2').stdout, /started task_a1/, "the session's own task");
  assert.doesNotMatch(chips().stdout, /started task_a1/, 'a board read without a session');
  assert.match(chips('stale').stdout, /task_a1 {2}Fix the parser {2}\[parser\] {2}age 0d; priority P1; started in session s2;/);
  assert.equal(chip(parser, 'dismissed stopped').status, 0);
  assert.doesNotMatch(chips('--session', 's1').stdout, /task_a1/);
});

test('chips reports a wait that loops back as one that can never clear', () => {
  const { chip, chips, offer, root, LEDGER } = chipLedger();
  assert.match(offer('task_a1 Fix a', 'src/a.ts', 'topic: loop; waits: task:task_a1').stderr, /task_a1 cannot wait on itself/);
  assert.equal(offer('task_a1 Fix a', 'src/a.ts', 'topic: loop').status, 0);
  assert.equal(offer('task_b1 Fix b', 'src/b.ts', 'topic: loop; waits: task:task_a1').status, 0);
  writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + ['2026-01-01T10:00:00Z', 'chip', 'task_a1 Fix a', 'why', 'waits: task:task_b1', 'updated'].join('\t') + '\n');
  assert.equal(offer('task_c1 Fix c', 'src/c.ts', 'topic: merge; waits: task:task_d1').status, 0);
  assert.equal(offer('task_d1 Fix d', 'src/d.ts', 'topic: merge').status, 0);
  assert.equal(chip('task_d1 Fix d', 'dismissed dup task_c1').status, 0);
  assert.equal(offer('task_e1 Fix e', 'src/e.ts', 'topic: stale').status, 0);
  assert.equal(offer('task_e2 Fix e2', 'src/e2.ts', 'topic: stale; waits: task:task_e1').status, 0);
  assert.equal(chip('task_e2 Fix e2', 'started').status, 0);
  assert.equal(chip('task_e1 Fix e', 'updated', 'waits: task:task_e2').status, 0);
  const board = chips();
  assert.match(board.stdout, /fix task_a1's wait: task:task_b1 waits back on task_a1/, 'two tasks that wait on each other');
  assert.match(board.stdout, /Ready, P1 \([0-9]+\)\n(?: {2}.*\n)* {2}task_c1 {2}Fix c {2}\[merge\] {2}no card\n/, 'a merge drops the kept task\'s wait on the task it absorbed');
  assert.match(board.stdout, /task_e1 {2}Fix e {2}\[stale\] {2}waits on task:task_e2 started\n/, 'a started task\'s old waits never loop');
  assert.doesNotMatch(board.stdout, /task_e2 waits back/);
  assert.equal(board.status, 1);
});

test('decisions-check reads every copy of a token and refuses one a row would ignore', () => {
  const { appendTo, chip, offer } = chipLedger();
  assert.equal(offer('task_a1 Make next green', '.github', 'topic: green; owns: ci:a').status, 0);
  assert.match(appendTo('docs/plans/2026-01-01-fix.decisions.tsv', 'verify', 'read CI', 'base-red: ci:a; base-red: ci:b; proof: none', 'gap: fails on next too').stderr, /base-red: ci:b has no open suggested task that owns it/, 'a second base-red token');
  assert.match(offer('task_b1 Fix the badge', 'README.md', 'topic: badge; topic: docs').stderr, /names topic: once/);
  assert.match(chip('task_a1 Make next green', 'started', 'topic: other').stderr, /a started row does not take topic:/);
  assert.match(chip('task_a1 Make next green', 'updated', 'card: c9').stderr, /an updated row does not take card:/);
});

test('chips lists the tasks a dropped card closed, so a sweep can reopen them', () => {
  const { LEDGER, chips, root } = chipLedger();
  writeFileSync(join(root, LEDGER), ledgerRows([
    ['task_g1 After: Fix the release notes', 'writes: CHANGES.md', 'offered'],
    ['task_g1 After: Fix the release notes', 'the queue dropped it', 'dismissed gone'],
  ]));
  const board = chips();
  assert.equal(board.status, 0, board.stderr);
  assert.match(board.stdout, /Lost \(1\)\n {2}task_g1 {2}Fix the release notes/);
  assert.match(board.stdout, /reopen task_g1 or close it/);
});

test('two tasks on one project path are both ready, and a started one holds nothing back', () => {
  const { chip, chips, offer } = chipLedger();
  assert.equal(offer('task_a1 Fix the reader', 'src/r.ts', 'topic: reader').status, 0);
  assert.equal(offer('task_b1 Speed up the reader', 'src/r.ts', 'topic: reader-speed').status, 0);
  assert.match(chips().stdout, /Ready, P1 \(2\)\n {2}task_a1 {2}Fix the reader {2}\[reader\] {2}no card {2}shares paths with task_b1\n {2}task_b1 [^\n]*shares paths with task_a1\n/);
  assert.equal(chip('task_a1 Fix the reader', 'started').status, 0);
  const board = chips().stdout;
  assert.match(board, /Ready, P1 \(1\)\n {2}task_b1 {2}Speed up the reader {2}\[reader-speed\] {2}no card {2}shares paths with task_a1\n/, 'a started session on the same project path');
  assert.match(board, /card task_b1: it can start and has no card; first judge whether it needs the result of another open task, starting with task_a1, which writes its paths, or of an open design question its work builds on/);
});

test('a carded task takes an updated row that only adds waits, and the withdrawal pass then pulls its card', () => {
  const { chip, chips, offer } = chipLedger();
  assert.equal(offer('task_t1 Decide the title slot (xhigh)', 'src/details', 'topic: title-slot; kind: decide').status, 0);
  const toc = 'task_c1 List titles in the TOC';
  assert.equal(offer(toc, 'src/toc', 'topic: toc; card: c1; session: s1').status, 0);
  assert.equal(chip(toc, 'updated', 'waits: task:task_t1').status, 0, 'a dependency found after the card');
  assert.match(chips('--session', 's1').stdout, /Do, withdrawal pass \(1\)\n {2}withdraw task_c1's card c1: task:task_t1 offered;/);
  for (const change of ['waits: pr:5', 'waits: none']) {
    assert.match(chip(toc, 'updated', change).stderr, /task_c1 holds card c1, which cannot change; withdraw the card first/, `a row that drops a wait: ${change}`);
  }
  assert.equal(chip(toc, 'updated', 'waits: task:task_t1, pr:5').status, 0, 'another wait that keeps the first');
  const index = 'task_c2 Index the titles';
  assert.equal(offer(index, 'src/index', 'topic: index; card: c2; session: s2').status, 0);
  assert.equal(chip(index, 'updated', 'waits: task:task_t1').status, 0);
  assert.match(chips('--session', 's1').stdout, /check session s2, which holds task_c2's card c2 on a task that now waits on task:task_t1 offered/, "another session's card keeps its prompt, whose board check stops its session");
});

test('chips stale marks a task whose every finding is a migration note as possibly thin', () => {
  const { LEDGER, chips, root } = chipLedger();
  const rows = [
    ['task_m1 Fix the marks', 'moved from docs/plans/old.decisions.tsv; waits for: the paused review-tree run, docs/plans/x.md'],
    ['task_m2 Fix the toc', 'waits for: udecode/plate#5165 to merge into next'],
    ['task_m3 Fix the table', 'no open run or task writes its paths'],
    ['task_m4 Fix the line end', 'waits for: the started task task_f1, which changes the same code; merges task_a1 and task_a2'],
    ['task_r1 Fix the paste', 'waits for task_a1 because bold drops on paste; the parser loses the mark'],
    ['task_r2 Fix the badge', 'merged PRs left the badge stale'],
  ];
  writeFileSync(join(root, LEDGER), `ts\tphase\tdecision\twhy\tevidence\tresult\n${rows.map(([decision, why], index) => ['2026-01-01T10:00:00Z', 'chip', decision, why, `writes: src/f${index}.ts; topic: t${index}`, 'offered'].join('\t')).join('\n')}\n`);
  const stale = chips('stale').stdout;
  for (const id of ['task_m1', 'task_m2', 'task_m3', 'task_m4']) assert.match(stale, new RegExp(`${id} [^\\n]*possibly thin: every finding is a note an older migration wrote`), id);
  for (const id of ['task_r1', 'task_r2']) assert.doesNotMatch(stale, new RegExp(`${id} [^\\n]*possibly thin`), `${id} holds a real finding`);
});

test('a landed row names each commit that delivered the task, and append refuses a hash that is no commit', () => {
  const { chip, offer, root } = chipLedger();
  const parser = 'task_a1 Add the parser';
  assert.equal(offer(parser, 'src/p.ts', 'topic: parser').status, 0);
  assert.equal(chip(parser, 'started').status, 0);
  assert.match(chip(parser, 'landed', 'commit: deadbeef1').stderr, /commit: deadbeef1 is not a commit in this checkout; name each commit that delivered the task by its hash, after committing it\n/);
  assert.match(chip(parser, 'landed', 'commit: deadbeef1 scope: the parser').stderr, /commit: deadbeef1 scope: the parser is not a commit in this checkout; .*; a field runs to the next ";"/);
  spawnSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'parser']);
  const sha = spawnSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  assert.equal(chip(parser, 'landed', `commit: ${sha}`).status, 0);
});

test('a task whose plan lands step by step logs landed after each push, and cleanup links every step', () => {
  const { chip, chips, offer, root } = chipLedger();
  spawnSync('git', ['-C', root, 'remote', 'set-url', 'origin', 'https://github.com/acme/app.git']);
  const commit = (subject) => {
    spawnSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', subject]);
    return spawnSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  };
  const card = join(realpathSync(root), '.claude', 'worktrees', 'a');
  mkdirSync(card, { recursive: true });
  writeFileSync(join(root, 'sessions.json'), JSON.stringify([{ sessionId: 's1', title: 'idle card', cwd: card, isArchived: false, isRunning: false }]));
  const plan = 'task_a1 Build the fill view';
  assert.equal(offer(plan, 'src/f.ts', 'topic: fill').status, 0);
  assert.match(chip(plan, 'landed').stderr, /task_a1 is offered, so it cannot be landed/, 'a task nobody started');
  assert.equal(chip(plan, 'started', 'session: s1').status, 0);
  const first = commit('feat(app): add the reader');
  assert.equal(chip(plan, 'landed', `commit: ${first}`).status, 0);
  const second = commit('feat(app): add the guard');
  assert.equal(chip(plan, 'landed', `commit: ${second}`).status, 0, 'the next step of the same plan');
  const report = chips('cleanup', '--sessions', 'sessions.json').stdout;
  for (const [sha, subject] of [[first, 'add the reader'], [second, 'add the guard']]) {
    assert.ok(report.includes(`[feat(app): ${subject}](https://diffshub.com/acme/app/commit/${sha})`), `the report links ${subject}`);
  }
});

test('a landed row accepts a commit that only the companion repository holds, and cleanup links it there', () => {
  const { chip, chips, offer, root } = chipLedger();
  writeFileSync(join(root, '.agents/pstack.json'), JSON.stringify({ branch: 'next', companion: { dir: '.git-private', list: '.gitprivate' } }));
  spawnSync('git', ['-C', root, 'remote', 'set-url', 'origin', 'https://github.com/acme/app.git']);
  const companion = ['--git-dir', join(root, '.git-private'), '--work-tree', root];
  spawnSync('git', [...companion, 'init', '-q']);
  spawnSync('git', [...companion, 'remote', 'add', 'origin', 'https://github.com/acme/app-private.git']);
  spawnSync('git', [...companion, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'test(app): skip the case']);
  const sha = spawnSync('git', [...companion, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  const card = join(realpathSync(root), '.claude', 'worktrees', 'a');
  mkdirSync(card, { recursive: true });
  writeFileSync(join(root, 'sessions.json'), JSON.stringify([{ sessionId: 's1', title: 'idle card', cwd: card, isArchived: false, isRunning: false }]));
  const skip = 'task_a1 Skip the parser case';
  assert.equal(offer(skip, 'tests/p.test.ts', 'topic: parser').status, 0);
  assert.equal(chip(skip, 'started', 'session: s1').status, 0);
  assert.match(chip(skip, 'landed', 'commit: deadbeef1').stderr, /commit: deadbeef1 is not a commit in this checkout/);
  assert.equal(chip(skip, 'landed', `commit: ${sha}`).status, 0);
  assert.ok(
    chips('cleanup', '--sessions', 'sessions.json').stdout.includes(`task_a1 Skip the parser case: 📦 [app-private: test(app): skip the case](https://diffshub.com/acme/app-private/commit/${sha})`),
    'the report links a companion commit in the companion repository, named first'
  );
});

test('chips cleanup lists the idle card sessions of landed tasks to archive and the worktrees of archived ones to remove, with commit links', () => {
  const { chip, chips, offer, root } = chipLedger();
  spawnSync('git', ['-C', root, 'remote', 'set-url', 'origin', 'https://github.com/acme/app.git']);
  spawnSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'fix(app): keep the [caret] in place']);
  const sha = spawnSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  const card = (name) => {
    const path = join(realpathSync(root), '.claude', 'worktrees', name);
    mkdirSync(path, { recursive: true });
    return path;
  };
  const sessions = [
    { sessionId: 's1', title: 'idle card', cwd: card('a'), isArchived: false, isRunning: false },
    { sessionId: 's2', title: 'archived card', cwd: card('b'), isArchived: true, isRunning: false },
    { sessionId: 's3', title: 'working card', cwd: card('c'), isArchived: false, isRunning: true },
    { sessionId: 's4', title: 'checkout session', cwd: realpathSync(root), isArchived: false, isRunning: false },
    { sessionId: 's5', title: 'pinned card', cwd: card('e'), isArchived: false, isRunning: false, pinned: true },
    { sessionId: 's6', title: 'card holder', cwd: card('f'), isArchived: false, isRunning: false },
  ];
  for (const [n, session] of sessions.entries()) {
    const task = `task_${'abcdef'[n]}1 Fix part ${n}`;
    assert.equal(offer(task, `src/${n}.ts`, `topic: part-${n}`).status, 0);
    assert.equal(chip(task, 'started', `session: ${session.sessionId}`).status, 0);
    assert.equal(chip(task, 'landed', n === 0 ? `commit: ${sha}` : 'evidence').status, 0);
  }
  const [aging, started] = ['task_g1 Fix a bug part 5 found', 'task_h1 Fix another bug part 5 found'];
  for (const [n, task] of [aging, started].entries()) {
    assert.equal(offer(task, `src/found-${n}.ts`, `topic: found-${n}; session: s6`).status, 0);
    assert.equal(chip(task, 'carded', `card: task_${n}f6f6f6f; session: s6`).status, 0);
  }
  writeFileSync(join(root, 'sessions.json'), JSON.stringify(sessions));
  const out = chips('cleanup', '--sessions', 'sessions.json').stdout;
  assert.match(out, /^Archive \(1\)[^\n]*\n {2}s1 {2}idle card\n/u, 'only the idle, unpinned card session is archived');
  assert.match(out, new RegExp(`Remove \\(1\\)[^\\n]*\\n {2}node \\.agents/skills/cleanup/scripts/scan\\.mjs --repo \\. --remove ${card('b').replace(/[.*+?^${}()|[\]\\/]/gu, '\\$&')}\\n`), 'the archived card worktree is removed');
  assert.match(out, /^Keep \(1\)[^\n]*\n {2}s6 {2}card holder: holds task_g1's card task_0f6f6f6f, task_h1's card task_1f6f6f6f\n/mu, 'a card session that holds a card nobody started is kept, since archiving it drops the card');
  assert.ok(out.includes(`task_a1 Fix part 0: 📦 [fix(app): keep the \\[caret\\] in place](https://diffshub.com/acme/app/commit/${sha})`), 'the report links the named commit by its subject');
  assert.match(out, /task_b1 Fix part 1: no commit named/);
  assert.match(out, /task_f1 Fix part 5: no commit named/, 'a kept session still reports its landed task');
  assert.doesNotMatch(out, /task_[cde]1/, 'a working, checkout or pinned session is left alone');
  assert.equal(chip(started, 'started', 'session: s7').status, 0);
  assert.match(chips('cleanup', '--sessions', 'sessions.json').stdout, /^Keep \(1\)[^\n]*\n {2}s6 {2}card holder: holds task_g1's card task_0f6f6f6f\n/mu, 'a started card no longer keeps its session');
  const ledger = join(root, 'docs/plans/suggested-tasks.decisions.tsv');
  const weekOld = new Date(Date.now() - 8 * 86_400_000).toISOString();
  writeFileSync(ledger, readFileSync(ledger, 'utf8').replace(/^\S+(\tchip\ttask_g1 [^\n]*\tcarded)$/mu, `${weekOld}$1`));
  assert.match(chips('cleanup', '--sessions', 'sessions.json').stdout, /^Archive \(2\)[^\n]*\n {2}s1 {2}idle card\n {2}s6 {2}card holder\n/u, 'a card the app dropped after a week, dismissed or not, no longer keeps its session');
});

test('chips cleanup keeps the worktree of an archived card session that a live session or the session running cleanup reuses', () => {
  const { LEDGER, dir, helper, offerHere, root, run, worktree } = linkedWorktree('trunk', 'here');
  const card = (name) => {
    const path = join(realpathSync(root), '.claude', 'worktrees', name);
    mkdirSync(path, { recursive: true });
    return path;
  };
  const sessions = [
    { sessionId: 's1', title: 'archived card', cwd: card('reused'), isArchived: true, isRunning: false },
    { sessionId: 's2', title: 'archived card', cwd: worktree, isArchived: true, isRunning: false },
    { sessionId: 's3', title: 'archived card', cwd: card('left'), isArchived: true, isRunning: false },
    { sessionId: 's4', title: 'new session', cwd: join(card('reused'), 'packages'), isArchived: false, isRunning: true },
  ];
  for (const [n, session] of sessions.slice(0, 3).entries()) {
    const task = `task_${'abc'[n]}1 Fix part ${n}`;
    assert.equal(offerHere(task, `writes: src/${n}.ts; topic: part-${n}`).status, 0);
    assert.equal(helper('append', LEDGER, 'chip', task, 'why', `session: ${session.sessionId}`, 'started').status, 0);
    assert.equal(helper('append', LEDGER, 'chip', task, 'why', 'evidence', 'landed').status, 0);
  }
  const list = join(root, 'docs/plans/artifacts/sessions.json');
  writeFileSync(list, JSON.stringify(sessions));
  const removesOnlyLeft = new RegExp(`Remove \\(1\\)[^\\n]*\\n {2}node \\.agents/skills/cleanup/scripts/scan\\.mjs --repo \\. --remove ${card('left').replace(/[.*+?^${}()|[\]\\/]/gu, '\\$&')}\\n`);
  const out = helper('chips', 'cleanup', '--sessions', list, '--session', 'lead').stdout;
  assert.match(out, removesOnlyLeft, 'only the folder no session works in is removed');
  assert.doesNotMatch(out, /task_[ab]1/, 'a folder a live session or the cleanup session works in is not cleaned up');
  const runtime = join(dir, 'bin', 'claude');
  mkdirSync(dirname(runtime), { recursive: true });
  symlinkSync(process.execPath, runtime);
  const launcher = join(dir, 'launch.mjs');
  writeFileSync(launcher, "import { spawnSync } from 'node:child_process';\nconst [cwd, ...args] = process.argv.slice(2);\nprocess.exit(spawnSync(process.execPath, args, { cwd, stdio: 'inherit' }).status);\n");
  const fromCheckout = run(runtime, [launcher, root, join(HELPERS, 'decisions-check.mjs'), 'chips', 'cleanup', '--sessions', list, '--session', 'lead'], worktree).stdout;
  assert.match(fromCheckout, removesOnlyLeft, "run from the main checkout, cleanup still keeps the folder its runtime process works in");
});

test('a task that waits on a landed patch starts once a commit after the landing holds each path that patch touches', () => {
  const { chip, chips, offer, root } = chipLedger();
  const parser = 'task_a1 Add the parser';
  assert.equal(offer(parser, 'src/p.ts', 'topic: parser').status, 0);
  assert.equal(offer('task_b1 Use the parser', 'src/q.ts', 'topic: parser-use; waits: task:task_a1').status, 0);
  assert.equal(chip(parser, 'started').status, 0);
  const patch = 'docs/plans/artifacts/chips/task_a1.patch';
  assert.match(chip(parser, 'landed', `patch: ${patch}`).stderr, /patch: docs\/plans\/artifacts\/chips\/task_a1\.patch does not exist/);
  mkdirSync(join(root, 'docs/plans/artifacts/chips'), { recursive: true });
  writeFileSync(join(root, patch), 'diff --git a/src/p.ts b/src/p.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/p.ts\n@@ -0,0 +1 @@\n+export const parse = 1;\n');
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src/p.ts'), 'export const parse = 1;\n');
  assert.equal(chip(parser, 'landed', `patch: ${patch}`).status, 0);
  assert.match(chips().stdout, /task_b1 {2}Use the parser {2}\[parser-use\] {2}waits on task:task_a1 landed, waiting for a commit of src\/p\.ts/, 'a new card session starts from the last commit, which lacks the parser');
  spawnSync('git', ['-C', root, 'add', 'src/p.ts']);
  commit(root, 'parser');
  writeFileSync(join(root, 'src/p.ts'), 'export const parse = 2;\n');
  assert.match(chips().stdout, /Ready, P1 \(1\)\n {2}task_b1 {2}Use the parser/, "a later task's uncommitted edit on top of the committed parser does not hold the wait");
});

test('an offer with session: none lies outside its run\'s domain, so no plain board cards it and chips all does', () => {
  const { chips, offer } = chipLedger();
  assert.equal(offer('task_a1 Fix the parser', 'src/a.ts', 'topic: a; session: none').status, 0);
  assert.equal(offer('task_b1 Fix the badge', 'src/b.ts', 'topic: b').status, 0);
  const plain = chips().stdout;
  assert.doesNotMatch(plain, /card task_a1:/, 'a runtime with no session tool cards no task outside its run\'s domain');
  assert.match(plain, /card task_b1:/, 'a runtime with no session tool still cards its own ownerless offer');
  assert.doesNotMatch(chips('--session', 's1').stdout, /card task_a1:/);
  assert.match(chips('all', '--session', 's1').stdout, /card task_a1:/, 'chips all cards it');
  assert.match(chips('brief', 'task_a1').stdout, /\nOwner: none\. Its finding lies outside the domain of the run that offered it, so only \/chips all cards it\.\n/);
});

test('an updated row with session: none gives a task back to no owner, so only chips all cards it', () => {
  const { chip, chips, offer } = chipLedger();
  assert.equal(offer('task_a1 Fix the parser', 'src/a.ts', 'topic: a; session: s1').status, 0);
  assert.match(chips('--session', 's1').stdout, /Do, card pass \(1\)\n {2}card task_a1:/);
  assert.equal(chip('task_a1 Fix the parser', 'updated', 'session: none').status, 0);
  assert.doesNotMatch(chips().stdout, /card task_a1:/, 'a run with no session id leaves the task to chips all');
  const own = chips('--session', 's1').stdout;
  assert.doesNotMatch(own, /card task_a1:/, 'the session that gave it back cards it no more');
  assert.match(own, /no owner {2}1 open: task_a1/);
  assert.match(chips('all', '--session', 's1').stdout, /card task_a1:/, 'chips all cards a task no session owns');
});

test('a session cards only the tasks it owns, and chips all takes the ones no live session owns', () => {
  const { chip, chips, offer, root } = chipLedger();
  assert.equal(offer('task_a1 Fix the parser', 'src/a.ts', 'topic: a; session: s1').status, 0);
  assert.equal(offer('task_b1 Fix the badge', 'src/b.ts', 'topic: b; session: s2').status, 0);
  assert.equal(offer('task_c1 Fix the clock', 'src/c.ts', 'topic: c').status, 0);
  assert.equal(offer('task_d1 Fix the dial', 'src/d.ts', 'topic: d; session: s3').status, 0);
  const own = chips('--session', 's1').stdout;
  assert.match(own, /Do, card pass \(1\)\n {2}card task_a1:/, 'a session cards only the task it offered');
  assert.match(own, /Other owners \(3\)\n {2}session s2 {2}1 open: task_b1\n {2}no owner {2}1 open: task_c1\n {2}session s3 {2}1 open: task_d1/);
  assert.match(chips().stdout, /Do, card pass \(4\)/, 'a runtime with no session tool cards every task');
  const refused = chip('task_b1 Fix the badge', 'carded', 'card: c1; session: s1');
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /task_b1 belongs to session s2, so only that session cards it/);
  const unlisted = chips('all', '--session', 's1').stdout;
  assert.match(unlisted, /Do, card pass \(2\)\n {2}card task_a1:[^\n]*\n {2}card task_c1:/, 'chips all cards a task no session owns');
  assert.doesNotMatch(unlisted, /take task_d1/, 'with no session list, no owner counts as gone');
  writeFileSync(join(root, 'sessions.json'), JSON.stringify([{ sessionId: 's1', isArchived: false }, { sessionId: 's2', isArchived: false }, { sessionId: 's3', isArchived: true }]));
  assert.match(chips('all', '--session', 's1', '--sessions', 'sessions.json').stdout, /Do, ledger pass \(1\)\n {2}take task_d1: its owner session s3 is archived or gone; log updated with session: s1/);
  assert.equal(chip('task_d1 Fix the dial', 'updated', 'session: s1').status, 0);
  assert.equal(chip('task_c1 Fix the clock', 'carded', 'card: c2; session: s1').status, 0, 'carding a task no session owns takes it');
  assert.match(chips('--session', 's1').stdout, /Do, card pass \(2\)\n {2}card task_a1:[^\n]*\n {2}card task_d1:/, 'a taken task is this session\'s own');
  assert.match(chips('--session', 's2').stdout, /session s1 {2}3 open: task_a1, task_c1, task_d1/);
  assert.match(chip('task_a1 Fix the parser', 'updated', 'transcript: t1').stderr, /transcript: goes beside session:/);
  assert.equal(chips('all').status, 2, 'chips all needs the session that takes the tasks');
});

test('a fast mark shows on a plain fix, refuses design judgment, and drops when a fold or dup raises the task', () => {
  const { chip, chips, offer } = chipLedger();
  const link = 'task_f1 Fix the badge link';
  assert.equal(offer(link, 'README.md', 'topic: badge; fast: yes').status, 0);
  assert.match(chips().stdout, /task_f1 {2}Fix the badge link \(fast\) {2}\[badge\]/);
  assert.match(chips('brief', 'task_f1').stdout, /^\[P1\] Fix the badge link \(fast\)\n[\s\S]*This task is marked fast: the owner's start of its card, or their "start <id>", is the word fast for it/);
  assert.match(offer('task_f2 Decide the badge (xhigh)', 'README.md', 'topic: badge-design; fast: yes').stderr, /task_f2 is an \(xhigh\) task, and fast: yes marks only a fix at high effort/);
  assert.match(offer('task_f3 Design the badge', 'README.md', 'topic: badge-look; kind: decide; fast: yes').stderr, /task_f3 is a decide task/);
  assert.match(offer('task_f4 Fix the badge color (fast)', 'README.md', 'topic: badge-color').stderr, /fast: yes adds \(fast\) for it/);
  assert.match(offer('task_f5 Fix the badge size', 'README.md', 'topic: badge-size; fast: maybe').stderr, /fast: is yes or no/);
  assert.match(chip(link, 'folded', 'kind: review').stderr, /a folded row takes kind: decide only/);
  assert.equal(chip(link, 'folded', 'effort: xhigh').status, 0);
  assert.match(chips().stdout, /task_f1 {2}Fix the badge link \(xhigh\) {2}\[badge\]/, 'a fold that needs design judgment drops the mark');
  assert.equal(offer('task_g1 Fix the footer', 'docs/f.md', 'topic: footer; fast: yes').status, 0);
  assert.equal(offer('task_g2 Rework the footer layout (xhigh)', 'docs/f.md', 'topic: footer').status, 0);
  assert.equal(chip('task_g2 Rework the footer layout (xhigh)', 'dismissed dup task_g1').status, 0);
  assert.doesNotMatch(chips('brief', 'task_g1').stdout, /marked fast/, 'a dup that brings design judgment drops the mark');
  assert.equal(offer('task_g3 Fix the header', 'docs/h.md', 'topic: header').status, 0);
  assert.equal(chip('task_g3 Fix the header', 'updated', 'fast: yes').status, 0);
  assert.match(chips().stdout, /task_g3 {2}Fix the header \(fast\)/);
});

test('fast work stays owed until a review task covers it, and comes back when that review is declined', () => {
  const { chip, chips, offer, root } = chipLedger();
  const link = 'task_f1 Fix the badge link';
  assert.equal(offer(link, 'README.md', 'topic: badge; fast: yes; card: c1; session: s1').status, 0);
  assert.match(chips().stdout, /Do, ledger pass \(1\)\n {2}review the fast work of task_f1: offer one task titled "Review the fast work of task_f1" with writes: README\.md; topic: fast-review; kind: review; waits: task:task_f1/);
  const review = 'task_r1 Review the fast work of task_f1';
  assert.equal(offer(review, 'README.md', 'topic: fast-review; kind: review; waits: task:task_f1').status, 0);
  assert.doesNotMatch(chips().stdout, /review the fast work/, 'a review task covers it');
  assert.equal(chip(link, 'started').status, 0);
  mkdirSync(join(root, 'docs/plans/artifacts/chips'), { recursive: true });
  writeFileSync(join(root, 'docs/plans/artifacts/chips/task_f1.patch'), 'diff --git a/README.md b/README.md\n');
  assert.equal(chip(link, 'landed', 'patch: docs/plans/artifacts/chips/task_f1.patch').status, 0);
  assert.match(chips().stdout, /Owed review \(1\)\n {2}task_f1 {2}Fix the badge link \(fast\) {2}\[badge\] {2}patch docs\/plans\/artifacts\/chips\/task_f1\.patch\n/);
  assert.match(chips('brief', 'task_r1').stdout, /This task reviews the fast work of the tasks it waits on[^\n]*\n- task_f1 Fix the badge link \(fast\): docs\/plans\/artifacts\/chips\/task_f1\.patch\n/);
  assert.equal(chip(review, 'dismissed declined').status, 0);
  assert.match(chips().stdout, /review the fast work of task_f1: offer one task/, 'a declined review leaves the work owed');
  assert.equal(chip(link, 'reviewed').status, 0);
  assert.doesNotMatch(chips().stdout, /Owed review|review the fast work/);
  assert.match(chip(review, 'reviewed').stderr, /task_r1 is dismissed declined, so it cannot be reviewed/);
});

test('decisions-check refuses a round past a maxRounds of 3 until a built: or another round: row', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', { config: { ...CONFIG, maxRounds: 3 } });
  const append = (phase, decision, result = 'recorded') => run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'append', 'log.decisions.tsv', phase, decision, 'why', 'evidence', result], root);
  const rounds = (count) => {
    for (let round = 1; round <= count; round += 1) {
      assert.equal(append('panel', 'seats opus').status, 0, `round ${round}`);
      assert.equal(append('writing', 'unslop on the round fixes').status, 0);
    }
  };
  rounds(3);
  const stuck = append('panel', 'seats opus');
  assert.equal(stuck.status, 1, 'a fourth round with no build between');
  assert.match(stuck.stderr, /panel round 4 since the last restart/);
  const roundsCheck = run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'rounds', 'log.decisions.tsv'], root);
  assert.equal(roundsCheck.status, 1, 'rounds exits 1 at the cap before any seat launches');
  assert.equal(append('build', 'Build has not started').status, 0);
  assert.equal(append('build', 'built: parser.mjs', 'skipped: the build has not run').status, 0);
  assert.equal(append('owner', 'Owner asked: "how long will this take?"').status, 0);
  assert.equal(append('panel', 'seats opus').status, 1, 'a build row with no built:, a skipped built: row and an owner row with no another round: restart nothing');
  assert.equal(run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'rounds', 'missing.decisions.tsv'], root).status, 2, 'rounds fails closed on a missing log');
  assert.equal(append('build', 'built: decisions-check.mjs and its test').status, 0);
  assert.equal(run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'rounds', 'log.decisions.tsv'], root).status, 0, 'rounds exits 0 after a restart');
  rounds(3);
  assert.equal(append('panel', 'seats opus').status, 1, 'the count starts again after a built: row');
  assert.equal(append('owner', 'another round: "panel"').status, 0);
  assert.equal(append('panel', 'seats opus').status, 0, 'an another round: row allows the next round');
});

test('an effort: high row lowers a stored (xhigh) title, and a design question stays at xhigh', () => {
  const { chip, chips, offer } = chipLedger();
  const parser = 'task_e1 Fix the parser (xhigh)';
  assert.equal(offer(parser, 'src/p.ts', 'topic: parser').status, 0);
  assert.match(chips('brief', 'task_e1').stdout, /^\[P1\] Fix the parser \(xhigh\)\n[\s\S]*Effort: xhigh\./);
  assert.equal(chip(parser, 'updated', 'effort: high').status, 0);
  assert.match(chips().stdout, /task_e1 {2}Fix the parser {2}\[parser\]/);
  assert.match(chips('brief', 'task_e1').stdout, /^\[P1\] Fix the parser\n[\s\S]*Effort: high\./);
  assert.equal(chip(parser, 'updated', 'effort: xhigh').status, 0);
  assert.match(chips('brief', 'task_e1').stdout, /Effort: xhigh\./, 'an updated row raises it again');
  assert.match(chip(parser, 'updated', 'effort: max').stderr, /effort: is high or xhigh/);
  const design = 'task_e2 Decide the parser shape';
  assert.equal(offer(design, 'src/q.ts', 'topic: parser-shape; kind: decide').status, 0);
  assert.equal(chip(design, 'updated', 'effort: high').status, 0);
  assert.match(chips('brief', 'task_e2').stdout, /^\[P1\] Decide the parser shape \(xhigh\)\n[\s\S]*Effort: xhigh\./, 'a design question stays at xhigh');
});

test('a fold only raises a task, and a dup of an xhigh task raises a task lowered to high', () => {
  const { chip, chips, offer } = chipLedger();
  const kept = 'task_k1 Fix the footer (xhigh)';
  assert.equal(offer(kept, 'docs/f.md', 'topic: footer').status, 0);
  assert.equal(chip(kept, 'updated', 'effort: high').status, 0);
  assert.match(chip(kept, 'folded', 'effort: high').stderr, /a folded row takes effort: xhigh only/);
  assert.equal(offer('task_d1 Rework the footer layout (xhigh)', 'docs/f.md', 'topic: footer').status, 0);
  assert.equal(chip('task_d1 Rework the footer layout (xhigh)', 'dismissed dup task_k1').status, 0);
  assert.match(chips('brief', 'task_k1').stdout, /^\[P1\] Fix the footer \(xhigh\)\n[\s\S]*Effort: xhigh\./);
});

test('a task that holds a card takes an updated row that only changes its effort', () => {
  const { chip, offer } = chipLedger();
  const parser = 'task_c1 Fix the parser (xhigh)';
  assert.equal(offer(parser, 'src/p.ts', 'topic: parser; card: c1; session: s1').status, 0);
  assert.equal(chip(parser, 'updated', 'effort: high').status, 0, 'effort changes no work');
  assert.match(chip(parser, 'updated', 'effort: xhigh; writes: src/p.ts, src/q.ts').stderr, /task_c1 holds card c1, which cannot change/);
});

test("an effort change on a carded task lists its card in the holder's withdrawal pass, then the card pass offers it again", () => {
  const { chip, chips, offer } = chipLedger();
  const parser = 'task_c1 Fix the parser (xhigh)';
  assert.equal(offer(parser, 'src/p.ts', 'topic: parser; card: c1; session: s1').status, 0);
  assert.doesNotMatch(chips('--session', 's1').stdout, /withdraw task_c1/, 'a card at its task effort stays');
  assert.equal(chip(parser, 'updated', 'effort: high').status, 0);
  const holder = chips('--session', 's1').stdout;
  assert.match(holder, /Do, withdrawal pass[\s\S]*withdraw task_c1's card c1: it was offered at xhigh and the task is at high now/);
  assert.doesNotMatch(chips('--session', 's2').stdout, /withdraw task_c1/, 'only the session holding the card can withdraw it');
  assert.equal(chip(parser, 'uncarded', 'card: c1').status, 0);
  assert.match(chips('--session', 's1').stdout, /Do, card pass[\s\S]*card task_c1:/);
});

test('a row its chip state forbids changes nothing, so a pulled row in any order cannot undo a start', () => {
  const { LEDGER, chips, offer, root } = chipLedger();
  assert.equal(offer('task_a1 Fix the lexer', 'src/l.ts', 'topic: lexer').status, 0);
  appendFileSync(join(root, LEDGER), `2026-01-02T00:00:00Z\tchip\ttask_a1 Fix the lexer\twhy\tsession: s1\tstarted\n`);
  appendFileSync(join(root, LEDGER), `2026-01-03T00:00:00Z\tchip\ttask_a1 Fix the lexer\twhy\tevidence\tdismissed declined\n`);
  assert.match(chips('brief', 'task_a1').stdout, /^State: Started\./mu);
});

test('decisions-check refuses a finding that stops its session before landing, and the brief drops one an older row holds', () => {
  const { LEDGER, chips, helper, root } = chipLedger();
  const proof = 'writes: README.md; topic: docs; priority: P1; repro: steps';
  const stop = 'The badge links a dead page. Stop before land.mjs so a teammate can retest on a local server.';
  for (const why of [stop, 'the badge links a dead page; stop just before landing']) {
    const refused = helper('append', LEDGER, 'chip', 'task_a1 Fix the stale badge', why, proof, 'offered');
    assert.equal(refused.status, 1, why);
    assert.match(refused.stderr, /never has its session stop before landing/u, why);
  }
  const nearMiss = helper('append', LEDGER, 'chip', 'task_a1 Stop land.mjs from committing deletions', 'land.mjs stops before the push when a check fails', proof, 'offered');
  assert.equal(nearMiss.status, 0, nearMiss.stderr);
  const folded = helper('append', LEDGER, 'chip', 'task_a1 Stop land.mjs from committing deletions', 'Stop before land.mjs for a local check.', 'writes: README.md', 'folded');
  assert.match(folded.stderr, /never has its session stop before landing/u, 'a folded row adds a finding too');
  appendFileSync(join(root, LEDGER), `2026-01-02T00:00:00Z\tchip\ttask_b2 Fix the dead link\t${stop}\twrites: docs/a.md; topic: links; priority: P1; repro: steps\toffered\n`);
  const brief = chips('brief', 'task_b2').stdout;
  assert.match(brief, /^- The badge links a dead page\. Land once the proof passes/mu);
  assert.doesNotMatch(brief, /Stop before land/u);
});
