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


test('the whole-log check leaves uncommitted old-form chip rows to the rules they were appended under', () => {
  const { LEDGER, helper, offer, root } = chipLedger();
  writeFileSync(join(root, LEDGER), ledgerRows([
    ['t_7a004000 After: Fix the stale badge (high)', 'writes: README.md', 'offered'],
    ['t_7a005000 Now: Fix the guide', 'writes: docs/guide.md', 'offered'],
    ['t_7a005000 Now: Fix the guide', 'the queue dropped it', 'dismissed gone'],
  ]));
  const checked = helper(LEDGER);
  assert.equal(checked.status, 0, `rows an older helper appended and nobody committed yet: ${checked.stderr}`);
  assert.match(offer('t_7a009000 After: Fix it').stderr, /no title says Now: or After:/, 'append still refuses the old form');
});

test('the whole-log check judges a row by the rows before it, never by later files or rules newer than the row', () => {
  const { LEDGER, chip, chips, helper, offer, root } = chipLedger();
  mkdirSync(join(root, 'src/a'), { recursive: true });
  assert.equal(offer('t_7a004000 Fix a', 'src/a', 'topic: a').status, 0);
  assert.equal(chip('t_7a004000 Fix a', 'started').status, 0);
  assert.equal(offer('t_7a009000 Fix b', 'src/b', 'topic: b').status, 0);
  assert.equal(chip('t_7a009000 Fix b', 'started', 'writes: alias').status, 0);
  assert.equal(chip('t_7a004000 Fix a', 'landed').status, 0);
  assert.equal(chip('t_7a009000 Fix b', 'landed').status, 0);
  symlinkSync('src/a', join(root, 'alias'));
  const linked = helper(LEDGER);
  assert.equal(linked.status, 0, `a path that later became a link to another task's path: ${linked.stderr}`);
  writeFileSync(join(root, LEDGER), ledgerRows([['t_7a00d000 Fix c', 'writes: src/c.ts; topic: c; waits: task:t_7a00d000', 'offered']]));
  const old = helper(LEDGER);
  assert.equal(old.status, 0, `a wait on itself that a helper without waits never read: ${old.stderr}`);
  assert.match(chips().stdout, /fix t_7a00d000's wait: task:t_7a00d000 is this task/, 'the board asks for the repair');
});

test('a base-red row and a carded row stay valid after the state they were judged against changes', () => {
  const { LEDGER, appendTo, chip, chips, helper, offer, outside } = chipLedger();
  const log = 'docs/plans/2026-01-01-fix.decisions.tsv';
  const green = 't_7a01f000 Make next green (xhigh)';
  assert.equal(offer(green, '.github/workflows', 'topic: next-green; owns: ci:check').status, 0);
  assert.equal(appendTo(log, 'verify', 'read CI', 'base-red: ci:check; proof: none', 'gap: fails on next too').status, 0);
  assert.equal(chip(green, 'started').status, 0);
  assert.equal(chip(green, 'landed').status, 0);
  const logChecked = helper(log);
  assert.equal(logChecked.status, 0, `the owner landing the fix leaves the earlier row valid: ${logChecked.stderr}`);
  assert.equal(offer('t_7a00d000 Fix the reader', outside('r.md'), 'topic: io; card: c1; session: s1').status, 0);
  assert.equal(offer('t_7a00e000 Fix the writer', outside('r.md'), 'topic: io-write').status, 0);
  assert.equal(chip('t_7a00e000 Fix the writer', 'started').status, 0);
  const ledgerChecked = helper(LEDGER);
  assert.equal(ledgerChecked.status, 0, `a later start leaves the earlier card row valid: ${ledgerChecked.stderr}`);
  const board = chips('--session', 's1');
  assert.match(board.stdout, /withdraw t_7a00d000's card c1: started t_7a00e000 writes its paths outside this checkout; log started when the dismiss tool reports the owner started it, dismissed declined with card: c1 when it reports the owner dismissed it, and otherwise uncarded with card: c1 once it is withdrawn or its session has ended\n/, 'the board still asks for the card to go, with each route a withdrawal can take');
  assert.equal(board.status, 1);
});

test('a dup moves the duplicate\'s title, findings, paths, waits and owned checks into an offered task it keeps', () => {
  const { appendTo, chip, chips, offer, outside } = chipLedger();
  const parser = 't_7a004000 Fix the parser';
  const docs = 't_7a009000 Fix the parser docs';
  assert.equal(offer(parser, 'src/p.ts', 'topic: parser').status, 0);
  assert.equal(offer(docs, outside('p.md'), 'topic: parser; waits: pr:99, task:t_7a004000; owns: ci:docs').status, 0);
  const merged = chip(docs, 'dismissed dup t_7a004000');
  assert.equal(merged.status, 0, merged.stderr);
  assert.match(chips().stdout, /t_7a004000 {2}Fix the parser {2}\[parser\] {2}owns ci:docs {2}waits on pr:99 not merged\n/, 'the wait on the kept task itself is dropped');
  assert.match(chips('brief', 't_7a004000').stdout, /Findings:\n- why\nAlso covers:\n- t_7a009000 Fix the parser docs\n {2}- why\nWrites: src\/p\.ts, [^\n]*\/shared\/p\.md\nOwns: ci:docs\nWaited on: pr:99\n/, 'the brief names the duplicate\'s work by its title');
  assert.equal(appendTo('docs/plans/2026-01-01-fix.decisions.tsv', 'verify', 'read CI', 'base-red: ci:docs; proof: none', 'gap: fails on next too').status, 0, 'the kept task owns the check');
  assert.equal(offer('t_7a044000 Rewrite the docs index', outside('p.md'), 'topic: index').status, 0);
  assert.equal(chip('t_7a044000 Rewrite the docs index', 'started').status, 0);
  assert.match(chips().stdout, /t_7a004000 {2}Fix the parser {2}\[parser\] {2}owns ci:docs {2}waits on pr:99 not merged; started t_7a044000 writes its paths outside this checkout\n/, 'a started task on an outside path the duplicate brought');
});

test('a card prompt leads with the task, then how its session lands, and ends by loading the current brief from the project checkout', () => {
  const { chips, offer, root } = chipLedger();
  assert.equal(offer('t_7a004000 Fix the parser', 'src/p.ts', 'topic: parser').status, 0);
  const checkout = realpathSync(root);
  const brief = chips('brief', 't_7a004000').stdout;
  const quoted = (text) => text.replace(/[.*+?^${}()|[\]\\/]/gu, '\\$&');
  assert.match(brief, /^\[P1\] Fix the parser\n\nTopic: parser\. Kind: fix\. Effort: high\. Priority: P1\.\nRepro: steps\nFindings:\n/, 'the card shows the task and its priority before any bookkeeping');
  assert.match(brief, new RegExp(`\\n\\nSuggested task t_7a004000 in docs/plans/suggested-tasks\\.decisions\\.tsv of the project checkout ${quoted(checkout)}\\. First detach this session from the session that offered your card or started it, such as with Claude Code desktop's detach_session with self, because while it stays linked each of your turn ends wakes that session; when the runtime refuses or lacks the detach, carry on\\. This prompt can be older than the task, so next run cd ${quoted(checkout)} && node \\.agents/pstack/decisions-check\\.mjs chips brief t_7a004000 and work from what it prints\\. Run every ledger command from ${quoted(checkout)} that way, even when your session opened in its own worktree[^\\n]*\\n?$`), 'a card made before a later fold or dup, run from a worktree whose ledger copy is stale');
  const patch = join(checkout, 'docs/plans/artifacts/chips/t_7a004000.patch');
  const branch = execFileSync('git', ['branch', '--show-current'], { cwd: checkout, encoding: 'utf8' }).trim();
  assert.match(brief, new RegExp(`you may commit in your worktree as you go\\. When you finish, land it yourself: run git add -A in your worktree and save git diff --cached <base>, where <base> is what git merge-base HEAD ${quoted(branch)} prints, which holds your commits, your uncommitted changes and new files, as ${quoted(patch)}, run git -C ${quoted(checkout)} apply --check --whitespace=error-all ${quoted(patch)}, then git -C ${quoted(checkout)} apply ${quoted(patch)}, which changes only the checkout's working tree and leaves its index alone\\.[^\\n]*Then deliver the patch's paths from ${quoted(checkout)} as your project's Delivery rule says[^\\n]*where that rule commits, commit only those paths there; where the owner owns commits, leave them in the working tree\\. Merge each run directory you wrote under docs/plans/artifacts in your worktree into the same path in ${quoted(checkout)} without overwriting, with mkdir -p <that path> && cp -Rn <your run directory>/\\. <that path>/, because append refuses a row whose evidence cites a path the checkout lacks, and the cleanup scan that later removes your worktree deletes ignored files your logged rows cite\\. Then log landed with patch: ${quoted(patch)}, adding commit: <hash>, <hash> for each commit you made`), 'a session copies its run directories into the checkout before the landed row that cites them');
  assert.match(brief, new RegExp(`so the lead's report links them\\. Last, stop each server you started\\. Then run node ${quoted(checkout)}/\\.agents/skills/cleanup/scripts/scan\\.mjs --landed <your worktree's absolute path>\\. When it exits 0, every change and ignored file of yours is committed, recreated by an install or build, or in the checkout, so leave your worktree in place, and the cleanup scan removes it once nothing has written it or your transcript for a day\\. When it exits otherwise or the script is missing, lock your worktree with git -C ${quoted(checkout)} worktree lock `), 'a landed session leaves its worktree for the daily scan and locks it when its work is not all in the checkout');
});

test('a merge or a folded design question keeps the effort the task\'s work needs', () => {
  const { chip, chips, offer } = chipLedger();
  assert.equal(offer('t_7a004000 Fix the parser', 'src/p.ts', 'topic: parser').status, 0);
  assert.equal(offer('t_7a009000 Find why the parser hangs (xhigh)', 'src/q.ts', 'topic: parser').status, 0);
  assert.equal(chip('t_7a009000 Find why the parser hangs (xhigh)', 'dismissed dup t_7a004000').status, 0);
  assert.match(chips('brief', 't_7a004000').stdout, /^\[P1\] Fix the parser \(xhigh\)\n/, 'a diagnosis merged into a plain fix');
  assert.equal(offer('t_7a00d000 Fix the printer', 'src/r.ts', 'topic: printer').status, 0);
  assert.equal(chip('t_7a00d000 Fix the printer', 'folded', 'kind: decide; writes: src/r2.ts').status, 0, 'a design question found later');
  assert.match(chips('brief', 't_7a00d000').stdout, /^\[P1\] Fix the printer \(xhigh\)\n[\s\S]*Kind: decide\.[\s\S]*settles a design question first/);
});

test('a folded design question promotes its task and joins the one-question-per-topic check', () => {
  const { chip, offer } = chipLedger();
  assert.equal(offer('t_7a010000 Decide the export format (xhigh)', 'src/e.ts', 'topic: export; kind: decide').status, 0);
  assert.equal(offer('t_7a023000 Fix the export button', 'src/b.ts', 'topic: export').status, 0);
  assert.match(chip('t_7a023000 Fix the export button', 'folded', 'kind: decide; writes: src/c.ts').stderr, /topic export already has the open design question t_7a010000; log this finding as a folded row on t_7a010000 instead/, 'a second design question in one topic');
  assert.match(chip('t_7a010000 Decide the export format (xhigh)', 'folded', 'kind: fix').stderr, /a folded row takes kind: decide only/);
  assert.equal(chip('t_7a010000 Decide the export format (xhigh)', 'folded', 'kind: decide; writes: src/f.ts').status, 0, 'a folded design question on the topic\'s own design task');
});

test('append refuses a dup of a task with no topic until it is migrated', () => {
  const { chip, root, LEDGER, offer } = chipLedger();
  assert.equal(offer('t_7a004000 Fix the parser', 'src/p.ts', 'topic: parser').status, 0);
  writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + ['2026-01-01T10:00:00Z', 'chip', 't_7a02f000 After: Fix the parser docs (high)', 'waits for: PR 12 to merge', 'writes: docs/p.md', 'offered'].join('\t') + '\n');
  assert.match(chip('t_7a02f000 After: Fix the parser docs (high)', 'dismissed dup t_7a004000').stderr, /t_7a02f000 has no topic, so its waits may still be prose; migrate it first: log updated with topic: and the waits: it has/);
  assert.equal(chip('t_7a02f000 After: Fix the parser docs (high)', 'updated', 'topic: parser; waits: pr:12').status, 0);
  assert.equal(chip('t_7a02f000 After: Fix the parser docs (high)', 'dismissed dup t_7a004000').status, 0, 'once it has a topic');
});

test('append refuses a second card on a task that has one', () => {
  const { chip, offer } = chipLedger();
  assert.equal(offer('t_7a025000 Fix the lexer', 'src/l.ts', 'topic: lexer').status, 0);
  assert.equal(chip('t_7a025000 Fix the lexer', 'carded', 'card: c1; session: s1').status, 0);
  assert.match(chip('t_7a025000 Fix the lexer', 'carded', 'card: c2; session: s2').stderr, /t_7a025000 already has card c1; log uncarded with card: c1 once that card is withdrawn or its session has ended, then card it again/);
  assert.equal(chip('t_7a025000 Fix the lexer', 'uncarded', 'card: c1').status, 0);
  assert.match(chip('t_7a025000 Fix the lexer', 'carded', 'card: c2; session: s2').stderr, /t_7a025000 belongs to session s1/, 'the first session that carded an offer naming no session owns it');
  assert.equal(chip('t_7a025000 Fix the lexer', 'carded', 'card: c2; session: s1').status, 0);
});

test('a dup that would leave two tasks waiting on each other is refused, and the duplicate stays open', () => {
  const { chip, chips, offer } = chipLedger();
  assert.equal(offer('t_7a010000 Fix d', 'src/d.ts', 'topic: chain').status, 0);
  assert.equal(offer('t_7a027000 Fix m', 'src/m.ts', 'topic: chain; waits: task:t_7a010000').status, 0);
  assert.equal(offer('t_7a023000 Fix k', 'src/k.ts', 'topic: chain; waits: task:t_7a027000').status, 0);
  assert.match(chip('t_7a010000 Fix d', 'dismissed dup t_7a023000').stderr, /this row leaves t_7a027000 and t_7a023000 waiting on each other; keep t_7a010000 open$/m, 'a wait on the duplicate that now leads to the kept task');
  const board = chips();
  assert.equal(board.status, 0, board.stdout);
  assert.match(board.stdout, /Ready, P1 \(1\)\n {2}t_7a010000 {2}Fix d {2}\[chain\] {2}no card\n/, 'the route the refusal names keeps every task and wait');
});

test('an updated row that closes a wait loop is refused', () => {
  const { chip, offer } = chipLedger();
  assert.equal(offer('t_7a004000 Fix a', 'src/a.ts', 'topic: loop').status, 0);
  assert.equal(offer('t_7a009000 Fix b', 'src/b.ts', 'topic: loop; waits: task:t_7a004000').status, 0);
  assert.match(chip('t_7a004000 Fix a', 'updated', 'waits: task:t_7a009000').stderr, /this row leaves t_7a004000 and t_7a009000 waiting on each other; drop the wait that closes the loop/);
  assert.equal(chip('t_7a009000 Fix b', 'started').status, 0);
  assert.equal(chip('t_7a004000 Fix a', 'updated', 'waits: task:t_7a009000').status, 0, 'a wait on a started task never loops');
});

test('chips brief on a merged task prints the task it merged into, and a closed task has nothing to start', () => {
  const { chip, chips, offer } = chipLedger();
  assert.equal(offer('t_7a004000 Fix a', 'src/a.ts', 'topic: brief').status, 0);
  assert.equal(offer('t_7a009000 Fix b', 'src/b.ts', 'topic: brief').status, 0);
  assert.equal(chip('t_7a009000 Fix b', 'dismissed dup t_7a004000').status, 0);
  const merged = chips('brief', 't_7a009000');
  assert.equal(merged.status, 0, merged.stderr);
  assert.match(merged.stdout, /^t_7a009000 was merged into t_7a004000; work from its brief\.\n\n\[P1\] Fix a\n\nTopic: brief\.[\s\S]*\n\nSuggested task t_7a004000 [^\n]*\n?$/, 'a card on the duplicate that another session still holds');
  assert.equal(chip('t_7a004000 Fix a', 'started').status, 0);
  assert.equal(chip('t_7a004000 Fix a', 'landed').status, 0);
  const landed = chips('brief', 't_7a009000');
  assert.equal(landed.status, 1);
  assert.match(landed.stderr, /t_7a009000 was merged into t_7a004000, which is landed, so there is nothing to start; tell the owner/);
  assert.equal(offer('t_7a00d000 Fix c', 'src/c.ts', 'topic: brief').status, 0);
  assert.equal(chip('t_7a00d000 Fix c', 'dismissed done').status, 0);
  assert.match(chips('brief', 't_7a00d000').stderr, /t_7a00d000 is dismissed done, so there is nothing to start; tell the owner/);
});

test('append refuses a dup across topics until the duplicate moves into the kept task\'s topic', () => {
  const { chip, offer } = chipLedger();
  assert.equal(offer('t_7a004000 Fix the export', 'src/e.ts', 'topic: export').status, 0);
  assert.equal(offer('t_7a009000 Fix the export format', 'src/f.ts', 'topic: format').status, 0);
  assert.match(chip('t_7a009000 Fix the export format', 'dismissed dup t_7a004000').stderr, /t_7a009000 is in topic format and t_7a004000 in export, and a dup joins tasks on one question; when t_7a009000 answers t_7a004000's question, log updated with topic: export on t_7a009000 first/);
  assert.equal(chip('t_7a009000 Fix the export format', 'updated', 'topic: export').status, 0);
  assert.equal(chip('t_7a009000 Fix the export format', 'dismissed dup t_7a004000').status, 0);
});

test('append refuses a dup into a task with no topic until it is migrated', () => {
  const { chip, root, LEDGER, offer } = chipLedger();
  assert.equal(offer('t_7a009000 Fix the parser docs', 'docs/p.md', 'topic: parser; waits: pr:12').status, 0);
  writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + ['2026-01-01T10:00:00Z', 'chip', 't_7a02f000 Now: Fix the parser', 'why', 'writes: src/p.ts', 'offered'].join('\t') + '\n');
  assert.match(chip('t_7a009000 Fix the parser docs', 'dismissed dup t_7a02f000').stderr, /t_7a02f000 has no topic, so its waits may still be prose; migrate it first/);
  assert.equal(chip('t_7a02f000 Now: Fix the parser', 'updated', 'topic: parser; waits: none').status, 0);
  assert.equal(chip('t_7a009000 Fix the parser docs', 'dismissed dup t_7a02f000').status, 0);
});

test('a dup that makes a design question beside a running one names the updated route', () => {
  const { chip, offer, root, LEDGER } = chipLedger();
  assert.equal(offer('t_7a03a000 Decide where content lands (xhigh)', 'src/l.ts', 'topic: land; kind: decide').status, 0);
  assert.equal(chip('t_7a03a000 Decide where content lands (xhigh)', 'started').status, 0);
  assert.equal(offer('t_7a023000 Fix the drop target', 'src/k.ts', 'topic: land').status, 0);
  writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + ['2026-01-01T10:00:00Z', 'chip', 't_7a010000 Decide where drops land (xhigh)', 'why', 'writes: src/d.ts; topic: land; kind: decide', 'offered'].join('\t') + '\n');
  assert.match(chip('t_7a010000 Decide where drops land (xhigh)', 'dismissed dup t_7a023000').stderr, /topic land's design question t_7a03a000 is running; log updated on t_7a023000 with its waits plus task:t_7a03a000 before this row/);
  assert.equal(chip('t_7a023000 Fix the drop target', 'updated', 'waits: task:t_7a03a000').status, 0);
  assert.equal(chip('t_7a010000 Decide where drops land (xhigh)', 'dismissed dup t_7a023000').status, 0);
});

test('a folded design question accepts a wait through a duplicate of the running one', () => {
  const { chip, offer } = chipLedger();
  assert.equal(offer('t_7a037000 Decide the format (xhigh)', 'src/r.ts', 'topic: format; kind: decide').status, 0);
  assert.equal(offer('t_7a004000 Fix the format docs', 'docs/r.md', 'topic: format').status, 0);
  assert.equal(chip('t_7a004000 Fix the format docs', 'dismissed dup t_7a037000').status, 0);
  assert.equal(chip('t_7a037000 Decide the format (xhigh)', 'started').status, 0);
  assert.equal(offer('t_7a023000 Fix the format button', 'src/k.ts', 'topic: format; waits: task:t_7a004000').status, 0);
  const folded = chip('t_7a023000 Fix the format button', 'folded', 'kind: decide');
  assert.equal(folded.status, 0, folded.stderr);
});

test('folding an unknown-cause diagnosis into a plain fix raises its brief and board line to xhigh', () => {
  const { chip, chips, offer } = chipLedger();
  assert.equal(offer('t_7a033000 Fix the parser', 'src/p.ts', 'topic: parser').status, 0);
  assert.equal(chip('t_7a033000 Fix the parser', 'folded', 'effort: xhigh; writes: src/q.ts').status, 0, 'a hang nobody has explained yet');
  assert.match(chips('brief', 't_7a033000').stdout, /^\[P1\] Fix the parser \(xhigh\)\n[\s\S]*Kind: fix\./);
  assert.match(chips().stdout, /t_7a033000 {2}Fix the parser \(xhigh\) {2}\[parser\]/, 'the board shows the effort the card passes');
  assert.match(chip('t_7a033000 Fix the parser', 'folded', 'effort: high').stderr, /a folded row takes effort: xhigh only/);
});

test("a card's effort is its title's, capped at the project's maxEffort, in the brief and on the board", () => {
  const { chips, offer, root } = chipLedger();
  assert.equal(offer('t_7a033000 Fix the parser', 'src/p.ts', 'topic: parser').status, 0);
  assert.equal(offer('t_7a010000 Design the export ledger (xhigh)', 'src/export', 'topic: export; kind: decide').status, 0);
  assert.equal(offer('t_7a044000 Fix the export core', 'src/export/core.ts', 'topic: core; waits: task:t_7a010000').status, 0);
  assert.match(chips('brief', 't_7a033000').stdout, /Kind: fix\. Effort: high\./);
  assert.match(chips('brief', 't_7a010000').stdout, /Kind: decide\. Effort: xhigh\./);
  assert.match(chips().stdout, /t_7a010000 {2}Design the export ledger \(xhigh\) {2}\[export, decide\] {2}no card/, 'an uncapped line leaves the effort to its title');
  writeFileSync(join(root, '.agents/pstack.json'), JSON.stringify({ branch: 'next', maxEffort: 'high' }));
  assert.match(chips('brief', 't_7a010000').stdout, /^\[P1\] Design the export ledger \(xhigh\)\n[\s\S]*Kind: decide\. Effort: high\./, 'the title keeps its recommendation');
  const board = chips().stdout;
  assert.match(board, /t_7a010000 {2}Design the export ledger \(xhigh\) {2}\[export, decide\] {2}effort high {2}no card/);
  assert.match(board, /t_7a044000 {2}Fix the export core {2}\[core\] {2}waits on /, 'a plain title is already at the cap');
});

test('a carded task takes no fold, update or dup until its card is withdrawn, and each refusal names its route', () => {
  const { chip, offer } = chipLedger();
  assert.equal(offer('t_7a023000 Fix k', 'src/k.ts', 'topic: card; card: c1; session: s1').status, 0);
  assert.equal(offer('t_7a010000 Fix d', 'src/d.ts', 'topic: card; waits: task:t_7a023000').status, 0, "a finding on the carded task's question waits on it");
  assert.match(chip('t_7a023000 Fix k', 'folded', 'writes: src/m.ts').stderr, /t_7a023000 holds card c1, which cannot show new work; offer the finding as a new task in topic card with waits: task:t_7a023000/);
  for (const change of ['owns: ci:k', 'writes: src/k', 'kind: decide', 'topic: other', 'fast: yes', 'waits: pr:5; topic: other']) {
    assert.match(chip('t_7a023000 Fix k', 'updated', change).stderr, /t_7a023000 holds card c1, which cannot change; withdraw the card first/, `an updated row with ${change}`);
  }
  assert.match(chip('t_7a010000 Fix d', 'dismissed dup t_7a023000').stderr, /t_7a023000 holds card c1, which cannot show new work; keep t_7a010000 open and log updated on it with its waits plus task:t_7a023000/);
  assert.equal(chip('t_7a023000 Fix k', 'uncarded', 'card: c1').status, 0);
  assert.equal(chip('t_7a023000 Fix k', 'folded', 'writes: src/m.ts').status, 0, 'a fold once the card is withdrawn');
});

test("a carded task's writes: can narrow to paths inside them, and only narrow", () => {
  const { chip, offer } = chipLedger();
  assert.equal(offer('t_7a023000 Fix k', 'src/k, test', 'topic: card; card: c1; session: s1').status, 0);
  assert.equal(chip('t_7a023000 Fix k', 'updated', 'writes: src/k/a.ts, test/k.test.ts').status, 0, 'a narrowing to paths inside the listed ones');
  assert.match(chip('t_7a023000 Fix k', 'updated', 'writes: src/k/a.ts, test').stderr, /t_7a023000 holds card c1, which cannot change; withdraw the card first/, 'a widening back to a directory');
  assert.match(chip('t_7a023000 Fix k', 'updated', 'writes: src/k/a.ts; owns: ci:k').stderr, /t_7a023000 holds card c1, which cannot change/, 'a narrowing beside another token');
});

test("uncarded and dismissed declined name the task's current card", () => {
  const { chip, offer } = chipLedger();
  assert.equal(offer('t_7a023000 Fix k', 'src/k.ts', 'topic: card; card: c1; session: s1').status, 0);
  assert.match(chip('t_7a023000 Fix k', 'uncarded').stderr, /t_7a023000 holds card c1; name it as card: c1/);
  assert.match(chip('t_7a023000 Fix k', 'dismissed declined').stderr, /t_7a023000 holds card c1; name it as card: c1/);
  assert.equal(chip('t_7a023000 Fix k', 'uncarded', 'card: c1').status, 0, 'a withdrawal names its card and needs no session');
  assert.match(chip('t_7a023000 Fix k', 'uncarded', 'card: c1').stderr, /t_7a023000 has no card to withdraw/);
  assert.equal(chip('t_7a023000 Fix k', 'carded', 'card: c2; session: s1').status, 0);
  assert.match(chip('t_7a023000 Fix k', 'dismissed declined', 'card: c1').stderr, /t_7a023000's card is c2, not c1; a dismissal of an older card closes nothing, so log no row for it/);
  assert.match(chip('t_7a023000 Fix k', 'uncarded', 'card: c1').stderr, /t_7a023000's card is c2, not c1/);
  assert.equal(chip('t_7a023000 Fix k', 'dismissed declined', 'card: c2').status, 0, "the owner's dismissal of the current card");
});

test('the board tells a session a card started to work from its current brief', () => {
  const { chips, offer } = chipLedger();
  assert.equal(offer('t_7a004000 Fix the parser', 'src/p.ts', 'topic: parser').status, 0);
  assert.match(chips().stdout, /\nA session a card started works from chips brief <its task id>, because its task can change after the card\.\n/, 'a card whose prompt predates chips brief');
});

test('an older dup into a started task passes the whole-log check', () => {
  const { chip, helper, offer, root, LEDGER } = chipLedger();
  assert.equal(offer('t_7a004000 Fix a', 'src/a.ts', 'topic: whole').status, 0);
  assert.equal(chip('t_7a004000 Fix a', 'started').status, 0);
  assert.equal(offer('t_7a009000 Fix b', 'src/b.ts', 'topic: whole; owns: ci:b').status, 0);
  writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + ['2026-01-01T10:00:00Z', 'chip', 't_7a009000 Fix b', 'why', 'evidence', 'dismissed dup t_7a004000'].join('\t') + '\n');
  const whole = helper(LEDGER);
  assert.equal(whole.status, 0, `a dup the previous helper accepted: ${whole.stderr}`);
});

test('an older dup into a started task keeps the covers and owned checks it moved', () => {
  const { chip, chips, offer, root, LEDGER } = chipLedger();
  assert.equal(offer('t_7a004000 Fix a', 'src/a.ts', 'topic: whole').status, 0);
  assert.equal(chip('t_7a004000 Fix a', 'started').status, 0);
  assert.equal(offer('t_7a009000 Fix b', 'src/b.ts', 'topic: whole; owns: ci:b; waits: pr:7').status, 0);
  writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + ['2026-01-01T10:00:00Z', 'chip', 't_7a009000 Fix b', 'why', 'evidence', 'dismissed dup t_7a004000'].join('\t') + '\n');
  const brief = chips('brief', 't_7a004000').stdout;
  assert.match(brief, /Also covers:\n- t_7a009000 Fix b\n[\s\S]*Owns: ci:b\n/, 'what the previous helper moved into the started task');
  assert.match(brief, /Writes: src\/a\.ts\nOwns: ci:b\nWaited on: nothing\n/, 'the paths and waits stay the started task\'s own');
});

test('the whole-log check refuses a folded row with kind: fix', () => {
  const { helper, offer, root, LEDGER } = chipLedger();
  assert.equal(offer('t_7a010000 Decide the format (xhigh)', 'src/d.ts', 'topic: whole; kind: decide').status, 0);
  writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + ['2026-01-01T10:00:00Z', 'chip', 't_7a010000 Decide the format (xhigh)', 'why', 'kind: fix', 'folded'].join('\t') + '\n');
  const fold = helper(LEDGER);
  assert.equal(fold.status, 1);
  assert.match(fold.stderr, /a folded row takes kind: decide only/);
});

test('a duplicate\'s card has nothing to start once the task it merged into is started', () => {
  const { chip, chips, offer } = chipLedger();
  assert.equal(offer('t_7a004000 Fix a', 'src/a.ts', 'topic: alias').status, 0);
  assert.equal(offer('t_7a009000 Fix b', 'src/b.ts', 'topic: alias').status, 0);
  assert.equal(chip('t_7a009000 Fix b', 'dismissed dup t_7a004000').status, 0);
  assert.equal(chip('t_7a004000 Fix a', 'started').status, 0);
  const brief = chips('brief', 't_7a009000');
  assert.equal(brief.status, 1, 'a card on the duplicate that another session still holds');
  assert.match(brief.stderr, /t_7a009000 was merged into t_7a004000, which is started, so there is nothing to start; tell the owner/);
});

test('a duplicate\'s card has nothing to start while the task it merged into has its own card', () => {
  const { chip, chips, offer } = chipLedger();
  assert.equal(offer('t_7a004000 Fix a', 'src/a.ts', 'topic: alias').status, 0);
  assert.equal(offer('t_7a009000 Fix b', 'src/b.ts', 'topic: alias').status, 0);
  assert.equal(chip('t_7a009000 Fix b', 'dismissed dup t_7a004000').status, 0);
  assert.equal(chip('t_7a004000 Fix a', 'carded', 'card: c1; session: s1').status, 0);
  const brief = chips('brief', 't_7a009000');
  assert.equal(brief.status, 1, 'two cards that would lead to one task');
  assert.match(brief.stderr, /t_7a009000 was merged into t_7a004000, which has card c1, so there is nothing to start; tell the owner/);
});

test('moving a design question into a topic that has one names the dup', () => {
  const { chip, offer } = chipLedger();
  assert.equal(offer('t_7a023000 Decide the export format (xhigh)', 'src/e.ts', 'topic: export; kind: decide').status, 0);
  assert.equal(offer('t_7a010000 Decide the file format (xhigh)', 'src/f.ts', 'topic: format; kind: decide').status, 0);
  assert.match(chip('t_7a010000 Decide the file format (xhigh)', 'updated', 'topic: export').stderr, /topic export already has the open design question t_7a023000; log t_7a010000 dismissed dup t_7a023000 instead/, 'the topic move the cross-topic refusal names for two fixes');
});

test('a covered task keeps its effort in the kept task\'s brief', () => {
  const { chip, chips, offer } = chipLedger();
  assert.equal(offer('t_7a004000 Fix the parser', 'src/p.ts', 'topic: parser').status, 0);
  assert.equal(offer('t_7a009000 Find the parser hang', 'src/q.ts', 'topic: parser').status, 0);
  assert.equal(chip('t_7a009000 Find the parser hang', 'folded', 'effort: xhigh').status, 0);
  assert.equal(chip('t_7a009000 Find the parser hang', 'dismissed dup t_7a004000').status, 0);
  assert.match(chips('brief', 't_7a004000').stdout, /Also covers:\n- t_7a009000 Find the parser hang \(xhigh\)\n/);
});

test('append refuses a new self-wait on a task already in a loop', () => {
  const { chip, offer, root, LEDGER } = chipLedger();
  assert.equal(offer('t_7a004000 Fix a', 'src/a.ts', 'topic: loop').status, 0);
  assert.equal(offer('t_7a009000 Fix b', 'src/b.ts', 'topic: loop; waits: task:t_7a004000').status, 0);
  writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + ['2026-01-01T10:00:00Z', 'chip', 't_7a004000 Fix a', 'why', 'waits: task:t_7a009000', 'updated'].join('\t') + '\n');
  assert.match(chip('t_7a004000 Fix a', 'updated', 'waits: task:t_7a009000, task:t_7a004000').stderr, /t_7a004000 cannot wait on itself/, 'a self-wait added to a task an older row left in a loop');
  assert.equal(chip('t_7a004000 Fix a', 'updated', 'waits: task:t_7a009000, pr:7').status, 0, 'a wait outside the loop');
});

test('an empty waits: is refused', () => {
  const { chip, offer, root, LEDGER } = chipLedger();
  assert.equal(offer('t_7a004000 Fix the parser', 'src/p.ts', 'topic: parser').status, 0);
  writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + ['2026-01-01T10:00:00Z', 'chip', 't_7a02f000 After: Fix the parser docs (high)', 'waits for: PR 12 to merge', 'writes: docs/p.md', 'offered'].join('\t') + '\n');
  assert.match(chip('t_7a02f000 After: Fix the parser docs (high)', 'updated', 'topic: parser; waits:').stderr, /waits: takes pr:<number>, task:<id> or run:<plan path ending in \.md>, comma-separated, or none/, 'a migration that would drop its prose wait');
  assert.equal(chip('t_7a02f000 After: Fix the parser docs (high)', 'updated', 'topic: parser; waits: none').status, 0);
});

test('a finding that waits on a carded task stays open when the owner declines the card, and gets its own card once its wait is fixed', () => {
  const { appendTo, chip, chips, offer } = chipLedger();
  assert.equal(offer('t_7a023000 Fix k', 'src/k.ts', 'topic: card; card: c1; session: s1').status, 0);
  assert.equal(offer('t_7a010000 Fix d', 'src/d.ts', 'topic: card; waits: task:t_7a023000; owns: ci:d').status, 0);
  assert.match(chips().stdout, /Waiting, P0 \(1\)\n {2}t_7a010000 {2}Fix d {2}\[card\] {2}owns ci:d {2}waits on task:t_7a023000 offered\n/);
  assert.equal(chip('t_7a023000 Fix k', 'dismissed declined', 'card: c1').status, 0, 'the owner dismissed the card, which showed t_7a023000 whole');
  const board = chips();
  assert.equal(board.status, 1);
  assert.match(board.stdout, /fix t_7a010000's wait: task:t_7a023000 closed as dismissed declined without its result; log updated with the waits it has now/);
  assert.equal(appendTo('docs/plans/2026-01-01-fix.decisions.tsv', 'verify', 'read CI', 'base-red: ci:d; proof: none', 'gap: fails on next too').status, 0, 'the finding still owns its check');
  assert.equal(chip('t_7a010000 Fix d', 'updated', 'waits: none').status, 0);
  assert.match(chips().stdout, /Do, card pass \(1\)\n {2}card t_7a010000: it can start and has no card/);
});

test('once a card is withdrawn, chips merges each finding that waited on it, one merge a pass', () => {
  const { batch, chip, chips, offer } = chipLedger();
  assert.equal(offer('t_7a023000 Fix k', 'src/k.ts', 'topic: card; card: c1; session: s1').status, 0);
  assert.equal(offer('t_7a010000 Fix d', 'src/d.ts', 'topic: card; waits: task:t_7a023000').status, 0);
  assert.equal(offer('t_7a014000 Fix e', 'src/e.ts', 'topic: card; waits: task:t_7a023000').status, 0);
  assert.equal(offer('t_7a033000 Decide p (xhigh)', 'src/p.ts', 'topic: other; kind: decide; waits: task:t_7a023000').status, 0, 'a prerequisite in another topic');
  assert.doesNotMatch(chips().stdout, /merge/, 'no merge while the card is out');
  assert.equal(chip('t_7a023000 Fix k', 'uncarded', 'card: c1').status, 0);
  for (const [id, letter] of [['t_7a010000', 'd'], ['t_7a014000', 'e']]) {
    const board = chips();
    assert.equal(board.status, 0, board.stdout);
    assert.match(board.stdout, new RegExp(`Do, ledger pass \\(1\\)\\n {2}merge ${id} into t_7a023000: t_7a023000 has no card now, so log ${id} dismissed dup t_7a023000\\n`));
    assert.equal(batch([[`${id} Fix ${letter}`, 'dismissed dup t_7a023000']]).status, 0, `the merge of ${id} appends`);
  }
  const board = chips();
  assert.match(board.stdout, /Do, card pass \(1\)\n {2}card t_7a023000:/, 'the task is carded again with all its work');
  assert.doesNotMatch(board.stdout, /merge t_7a033000/, 'a prerequisite in another topic stays its own task');
  assert.match(chips('brief', 't_7a023000').stdout, /Also covers:\n- t_7a010000 Fix d\n[\s\S]*- t_7a014000 Fix e\n/);
});

test('a merge leaves the other items on its two tasks for the next pass', () => {
  const { batch, chip, chips, offer } = chipLedger();
  assert.equal(offer('t_7a01f000 Fix g', 'src/g.ts', 'topic: gone').status, 0);
  assert.equal(offer('t_7a02f000 Fix o', 'src/o.ts', 'topic: open').status, 0);
  assert.equal(offer('t_7a023000 Fix k', 'src/k.ts', 'topic: card; waits: task:t_7a01f000').status, 0);
  assert.equal(offer('t_7a010000 Fix d', 'src/d.ts', 'topic: card; waits: task:t_7a02f000, task:t_7a023000').status, 0);
  assert.equal(chip('t_7a01f000 Fix g', 'dismissed declined').status, 0);
  const first = chips();
  assert.equal(first.status, 1, 'the stuck wait the pass leaves out still fails chips');
  assert.match(first.stdout, /Do, ledger pass \(1\)\n {2}merge t_7a010000 into t_7a023000/);
  assert.doesNotMatch(first.stdout, /fix t_7a023000's wait/);
  assert.equal(batch([['t_7a010000 Fix d', 'dismissed dup t_7a023000']]).status, 0);
  assert.match(chips().stdout, /fix t_7a023000's wait: task:t_7a01f000 closed as dismissed declined without its result/);
  assert.match(chips('brief', 't_7a023000').stdout, /Waited on: task:t_7a01f000, task:t_7a02f000\n/, 'the next pass sees the wait the merge moved');
});

test('a merge that would close a wait loop prints nothing and hides no later pass', () => {
  const { chips, offer } = chipLedger();
  assert.equal(offer('t_7a023000 Fix k', 'src/k.ts', 'topic: card').status, 0);
  assert.equal(offer('t_7a045000 Fix x', 'src/x.ts', 'topic: other; waits: task:t_7a023000').status, 0);
  assert.equal(offer('t_7a010000 Fix d', 'src/d.ts', 'topic: card; waits: task:t_7a023000, task:t_7a045000').status, 0);
  const board = chips();
  assert.equal(board.status, 0, board.stdout);
  assert.doesNotMatch(board.stdout, /merge/, 't_7a023000 would wait on t_7a045000, which waits on t_7a023000');
  assert.match(board.stdout, /Do, card pass \(1\)\n {2}card t_7a023000:/);
});

test('a design question that waits on a design question of its topic is not a second open one', () => {
  const { chip, chips, offer } = chipLedger();
  assert.equal(offer('t_7a023000 Decide k (xhigh)', 'src/k.ts', 'topic: card; kind: decide; card: c1; session: s1').status, 0);
  assert.match(offer('t_7a010000 Decide d (xhigh)', 'src/d.ts', 'topic: card; kind: decide').stderr, /topic card already has the open design question t_7a023000; give t_7a010000 waits: task:t_7a023000, since t_7a023000 holds card c1/);
  const waiting = offer('t_7a010000 Decide d (xhigh)', 'src/d.ts', 'topic: card; kind: decide; waits: task:t_7a023000');
  assert.equal(waiting.status, 0, waiting.stderr);
  assert.doesNotMatch(chips().stdout, /fold topic/);
  assert.equal(chip('t_7a023000 Decide k (xhigh)', 'uncarded', 'card: c1').status, 0);
  assert.match(chips().stdout, /merge t_7a010000 into t_7a023000/);
});

test('chips shows one pass at a time: withdrawals, then ledger rows, then cards, and a read with no session skips the withdrawals', () => {
  const { chip, chips, offer, root, LEDGER } = chipLedger();
  assert.equal(offer('t_7a004000 Fix a', 'src/a.ts', 'topic: one').status, 0);
  writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + ['2026-01-01T10:00:00Z', 'chip', 't_7a02f000 Fix the old docs', 'why', 'writes: docs/o.md', 'offered'].join('\t') + '\n');
  assert.equal(offer('t_7a00d000 Fix c', 'src/c.ts', 'topic: three; card: c1; session: s1').status, 0);
  assert.equal(chip('t_7a00d000 Fix c', 'updated', 'waits: pr:5').status, 0, 'a wait added to a carded task');
  const withdrawals = chips('--session', 's1');
  assert.match(withdrawals.stdout, /Do, withdrawal pass \(1\)\n {2}withdraw t_7a00d000's card c1/);
  assert.doesNotMatch(withdrawals.stdout, /migrate t_7a02f000|card t_7a004000/);
  const sessionless = chips();
  assert.match(sessionless.stdout, /Do, ledger pass \(1\)\n {2}migrate t_7a02f000/, 'a read with no session applies no withdrawal, so the ledger pass shows');
  assert.equal(sessionless.status, 1, 'the waiting card still counts as a problem');
  assert.equal(chip('t_7a00d000 Fix c', 'uncarded', 'card: c1').status, 0);
  const ledger = chips();
  assert.match(ledger.stdout, /Do, ledger pass \(1\)\n {2}migrate t_7a02f000/);
  assert.doesNotMatch(ledger.stdout, /card t_7a004000/);
  assert.equal(chip('t_7a02f000 Fix the old docs', 'updated', 'topic: docs; waits: none').status, 0);
  assert.match(chips().stdout, /Do, ledger pass \(1\)\n {2}prioritize t_7a02f000: log updated with priority:/, 'an untagged task gets no card until a sweep tags it');
  assert.equal(chip('t_7a02f000 Fix the old docs', 'updated', 'priority: P2').status, 0);
  assert.match(chips().stdout, /Do, card pass \(2\)\n {2}card t_7a004000:[^\n]*\n {2}card t_7a02f000:/);
});

test('decisions-check takes a P0 or P1 claim only with its evidence', () => {
  const { LEDGER, chip, helper, merge, offer, root } = chipLedger();
  const bare = (decision, tokens) => helper('append', LEDGER, 'chip', decision, 'why', tokens, 'offered');
  const untagged = bare('t_7a004000 Fix a', 'writes: a.md; topic: one');
  assert.equal(untagged.status, 1, 'a new offer with no priority');
  assert.match(untagged.stderr, /a new offer names its priority as "priority: P0"/);
  assert.equal(bare('t_7a004000 Fix a', 'writes: a.md; topic: one; owns: ci:check').status, 0, 'a task that owns a failing check is P0 without a token');
  assert.match(bare('t_7a009000 Fix b', 'writes: b.md; topic: two; priority: P0').stderr, /a P0 task is broken now/);
  assert.match(bare('t_7a009000 Fix b', 'writes: b.md; topic: two; priority: P1').stderr, /a P1 task is a bug with its repro/);
  assert.match(bare('t_7a009000 Fix b', 'writes: b.md; topic: two; priority: P4').stderr, /priority: is P0, P1, P2 or P3/);
  assert.match(bare('t_7a009000 Fix b', 'writes: b.md; topic: two; priority: P0; regressed: abc1234').stderr, /regressed: abc1234 is not a commit/);
  assert.match(bare('t_7a009000 Fix b', 'writes: b.md; topic: two; priority: P1; ship: r1').stderr, /sets no chips\.ship command/);
  merge('break b');
  const head = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  assert.equal(bare('t_7a009000 Fix b', `writes: b.md; topic: two; priority: P0; regressed: ${head}`).status, 0, 'a regression names its commit');
  const lower = bare('t_7a00d000 Fix c', 'writes: c.md; topic: three; priority: P2');
  assert.equal(lower.status, 1, 'a P2 offer outside a verdict, babysit, time, hook or panel route');
  assert.match(lower.stderr, /a run offers a task only for a new P0 or P1 finding[^\n]*list this P2 finding in the plan's Open work/);
  assert.match(bare('t_7a00d000 Fix c', 'writes: c.md; topic: three; priority: P3; via: review').stderr, /via: is verdict, babysit, time, hook, panel or stale/);
  assert.equal(bare('t_7a022000 Run the due intake', 'writes: h.md; topic: intake; kind: decide; priority: P3; via: hook').status, 0, 'a project hook offers the recurring work it finds due');
  assert.match(bare('t_7a02d000 Judge n', 'writes: n.md; topic: four; owns: none').stderr, /a new offer names its priority/, 'owns: none owns no check');
  assert.equal(bare('t_7a02d000 Judge n', 'writes: n.md; topic: four; kind: decide; priority: P3; via: time; owns: none').status, 0);
  assert.match(helper('chips', 'brief', 't_7a02d000').stdout, /Priority: P3\./, 'owns: none never makes the task P0');
  assert.equal(bare('t_7a00d000 Fix c', 'writes: c.md; topic: three; priority: P2; via: verdict').status, 0, 'P2 needs no evidence, only its route');
  assert.match(chip('t_7a00d000 Fix c', 'updated', 'priority: P0').stderr, /a P0 task is broken now/, 'a raise to P0 without evidence');
  assert.equal(chip('t_7a00d000 Fix c', 'updated', 'priority: P0; repro: type then reload loses the text').status, 0, 'a raise to P0 with its repro');
  assert.equal(chip('t_7a00d000 Fix c', 'folded', 'priority: P3').status, 0);
  assert.match(helper('chips', 'brief', 't_7a00d000').stdout, /Priority: P0\./, 'a folded finding never lowers the priority');
  assert.equal(offer('t_7a010000 Fix d', 'd.md', 'topic: four; priority: P2; via: verdict; card: d1; session: s1').status, 0);
  assert.equal(chip('t_7a010000 Fix d', 'updated', 'priority: P3').status, 0, 'a carded task takes a new priority');
  assert.match(chip('t_7a010000 Fix d', 'updated', 'topic: five').stderr, /holds card d1, which cannot change/);
  assert.match(helper('chips', 'brief', 't_7a009000').stdout, /Priority: P0\.[\s\S]*Regressed in: [0-9a-f]+/);
});

test('chips lists P0 and P1 in full, counts the rest and cards at most 10, highest priority first', () => {
  const { batch, chips } = chipLedger();
  const rows = [];
  for (let n = 0; n < 6; n += 1) rows.push([`t_7a0${(0x32 + n).toString(16)}000 Fix p${n}`, 'offered', `writes: p${n}.md; topic: p2-${n}; priority: P2; via: verdict`]);
  for (let n = 0; n < 4; n += 1) rows.push([`t_7a0${(0x3f + n).toString(16)}000 Tune t${n}`, 'offered', `writes: t${n}.md; topic: p3-${n}; priority: P3; via: verdict`]);
  rows.push(['t_7a009000 Fix the lost save', 'offered', 'writes: b.md; topic: save; priority: P0; repro: type then reload loses the text']);
  rows.push(['t_7a00d000 Fix the cursor', 'offered', 'writes: c.md; topic: cursor; priority: P1; repro: click past the end']);
  rows.push(['t_7a022000 Fix held', 'offered', 'writes: h.md; topic: held; priority: P2; via: verdict; card: h1; session: s1']);
  const written = batch(rows);
  assert.equal(written.status, 0, written.stderr);
  const board = chips().stdout;
  assert.match(board, /Ready, P0 \(1\)\n {2}t_7a009000 /);
  assert.match(board, /Ready, P1 \(1\)\n {2}t_7a00d000 /);
  assert.match(board, /Ready, lower priority \(P2 7, P3 4\): chips all lists them/);
  assert.doesNotMatch(board, /t_7a032000 {2}Fix p0 {2}\[/, 'a P2 task shows only as a count');
  assert.match(board, /Do, card pass \(10\)\n {2}card t_7a009000:[^\n]*\n {2}card t_7a00d000:[^\n]*\n {2}card t_7a032000:/, 'P0 first');
  assert.equal(board.match(/^ {2}card t_/gmu).length, 9, 'ten cards less the one this session holds');
  assert.match(board, /\n {2}card t_7a03f000:[^\n]*\n {2}3 more can start once this session holds fewer than 10 cards/);
  const full = chips('all', '--session', 's1').stdout;
  assert.match(full, /Ready, P2 \([0-9]+\)\n {2}t_/);
  assert.match(full, /Ready, P3 \(4\)/);
});

test('within a priority, chips lists and cards first a task whose repro names a public issue, never above a higher priority', () => {
  const { batch, chips } = chipLedger();
  const written = batch([
    ['t_7a004000 Fix a', 'offered', 'writes: a.md; topic: a; priority: P0; repro: type then reload loses the text'],
    ['t_7a009000 Fix b', 'offered', 'writes: b.md; topic: b; priority: P0; repro: acme#12 Repro 1 holds the steps'],
    ['t_7a010000 Fix d', 'offered', 'writes: d.md; topic: d; priority: P1; repro: paste &#12; then undo'],
    ['t_7a019000 Fix f', 'offered', 'writes: f.md; topic: f; priority: P1; repro: load fixtures/issues/12.json then save'],
    ['t_7a00d000 Fix c', 'offered', 'writes: c.md; topic: c; priority: P1; repro: https://github.com/acme/app/issues/7 holds the steps'],
    ['t_7a014000 Fix e', 'offered', 'writes: e.md; topic: e; priority: P1; repro: #8 Repro 2 holds the steps'],
  ]);
  assert.equal(written.status, 0, written.stderr);
  const board = chips().stdout;
  assert.match(board, /Ready, P0 \(2\)\n {2}t_7a009000 [^\n]*\n {2}t_7a004000 /, 'the P0 that names an issue first');
  assert.match(board, /Ready, P1 \(4\)\n {2}t_7a00d000 [^\n]*\n {2}t_7a014000 [^\n]*\n {2}t_7a010000 [^\n]*\n {2}t_7a019000 /, 'an issues URL and a bare #<number> count, and an HTML entity and an issues path do not');
  assert.match(board, /Do, card pass \(6\)\n {2}card t_7a009000:[^\n]*\n {2}card t_7a004000:[^\n]*\n {2}card t_7a00d000:/, 'an issue-backed P1 stays below every P0');
});

test('within a priority, chips ranks regressions first and experimental scopes last, by the facts a triage record gives', () => {
  const rows = [
    ['t_7a004000 Fix a', 'offered', 'writes: a.md; topic: a; priority: P1; repro: type then reload; review-scope: editor'],
    ['t_7a009000 Fix b', 'offered', 'writes: b.md; topic: b; priority: P1; repro: type then reload; review-scope: pagination'],
    ['t_7a00d000 Fix c', 'offered', 'writes: c.md; topic: c; priority: P1; repro: type then reload; review-scope: editor; regression: https://example.org/demo'],
    ['t_7a010000 Fix d', 'offered', 'writes: d.md; topic: d; priority: P1; repro: type then reload; review-scope: pagination; regression: https://example.org/pages, https://example.org/print'],
    ['t_7a014000 Fix e', 'offered', 'writes: e.md; topic: e; priority: P1; repro: type then reload'],
    ['t_7a019000 Fix f', 'offered', 'writes: f.md; topic: f; priority: P0; repro: type then reload; review-scope: pagination'],
    ['t_7a01f000 Fix g', 'offered', 'writes: g.md; topic: g; priority: P1; repro: acme#3 holds the steps; review-scope: editor'],
    ['t_7a022000 Fix h', 'offered', 'writes: h.md; topic: h; priority: P1; repro: type then reload; review-scope: none; regression: https://example.org/tool'],
  ];
  const triaged = chipLedger({ config: { triage: { experimental: ['pagination'] }, chips: { scopes: 'scopes' } }, files: { 'scopes/editor.json': '{}', 'scopes/pagination.json': '{}' } });
  const written = triaged.batch(rows);
  assert.equal(written.status, 0, written.stderr);
  const board = triaged.chips().stdout;
  assert.match(board, /Ready, P0 \(1\)\n {2}t_7a019000 {2}Fix f {2}\[f\] {2}experimental /, 'an experimental P0 stays above every P1');
  assert.match(
    board,
    /Ready, P1 \(7\)\n {2}t_7a00d000 {2}Fix c {2}\[c\] {2}regression [^\n]*\n {2}t_7a010000 {2}Fix d {2}\[d\] {2}regression [^\n]*\n {2}t_7a01f000 {2}Fix g {2}\[g\] {2}new [^\n]*\n {2}t_7a004000 {2}Fix a {2}\[a\] {2}new [^\n]*\n {2}t_7a014000 {2}Fix e {2}\[e\] {2}no card\n {2}t_7a022000 {2}Fix h {2}\[h\] {2}no card\n {2}t_7a009000 {2}Fix b {2}\[b\] {2}experimental /,
    'a regression in an experimental scope still comes first, and a task with no review scope, or none, ranks with the new ones'
  );
  assert.match(triaged.chips('brief', 't_7a010000').stdout, /^Review scope: pagination\. Milestone: regression\.\nRegression: it still works on https:\/\/example\.org\/pages, https:\/\/example\.org\/print\n/mu);
  assert.doesNotMatch(triaged.chips('brief', 't_7a014000').stdout, /^Review scope:/mu);
  const stale = triaged.chips('stale').stdout;
  assert.match(stale, /t_7a014000 [^\n]*no review scope/, 'the stale report asks the sweep to judge a missing review scope');
  assert.doesNotMatch(stale, /t_7a022000 [^\n]*no review scope/, 'review-scope: none is a judged scope');
  const refused = triaged.batch([
    ['t_7a023000 Fix k', 'offered', 'writes: k.md; topic: k; priority: P1; repro: steps; review-scope: editr'],
    ['t_7a027000 Fix m', 'offered', 'writes: m.md; topic: m; priority: P1; repro: steps; regression: the old demo'],
  ]);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /review-scope: editr is no review scope in scopes; name the one that owns the task's code, or none/);
  assert.match(refused.stderr, /regression: names each page where the behavior still works by its URL[^\n]*"the old demo" is not a URL/);
  const carded = triaged.batch([
    ['t_7a004000 Fix a', 'carded', 'card: t_7a045000; session: s1'],
    ['t_7a004000 Fix a', 'updated', 'review-scope: pagination'],
  ]);
  assert.equal(carded.status, 0, `a carded task takes its review scope without a withdrawal: ${carded.stderr}`);
  assert.match(triaged.chips('brief', 't_7a004000').stdout, /^Review scope: pagination\. Milestone: experimental\.$/mu);

  const plain = chipLedger();
  assert.equal(plain.batch(rows).status, 0);
  const unranked = plain.chips().stdout;
  assert.match(unranked, /Ready, P1 \(7\)\n {2}t_7a01f000 [^\n]*\n {2}t_7a004000 [^\n]*\n {2}t_7a009000 [^\n]*\n {2}t_7a00d000 /, 'without a triage config the order stays the public-issue one');
  assert.doesNotMatch(unranked, /\] {2}(?:regression|new|experimental)\b/, 'and no task shows a milestone');
  assert.doesNotMatch(plain.chips('stale').stdout, /no review scope/);
});

test('chips ranks a deferred scope after every other task, and a task that other work waits on keeps its place', () => {
  const { batch, chips } = chipLedger({ config: { chips: { scopes: 'scopes', deferred: ['collaboration'] } }, files: { 'scopes/collaboration.json': '{}', 'scopes/editor.json': '{}' } });
  const written = batch([
    ['t_7a04f000 Fix z1', 'offered', 'writes: z1.md; topic: z1; priority: P1; repro: steps; review-scope: collaboration'],
    ['t_7a04b000 Fix y1', 'offered', 'writes: y1.md; topic: y1; priority: P1; repro: steps; review-scope: collaboration; waits: task:t_7a04f000'],
    ['t_7a044000 Fix w1', 'offered', 'writes: w1.md; topic: w1; priority: P2; via: verdict; review-scope: editor; waits: task:t_7a04b000'],
    ['t_7a04a000 Fix y0', 'offered', 'writes: y0.md; topic: y0; priority: P0; repro: two peers diverge; review-scope: collaboration'],
    ['t_7a016000 Tune e3', 'offered', 'writes: e3.md; topic: e3; priority: P3; via: verdict; review-scope: editor'],
    ['t_7a04c000 Fix y2', 'offered', 'writes: y2.md; topic: y2; priority: P2; via: verdict; review-scope: collaboration'],
    ['t_7a04d000 Fix y3', 'offered', 'writes: y3.md; topic: y3; priority: P2; via: verdict; review-scope: collaboration; waits: task:t_7a04c000'],
    ['t_7a04e000 Fix y4', 'offered', 'writes: y4.md; topic: y4; priority: P0; repro: two peers diverge; review-scope: collaboration; waits: task:t_7a016000'],
  ]);
  assert.equal(written.status, 0, written.stderr);
  const board = chips().stdout;
  assert.match(board, /\nReady, P1 \(1\)\n {2}t_7a04f000 /, 'a task that work outside the list waits on through another task keeps its place');
  assert.match(board, /\nWaiting, P1 \(1\)\n {2}t_7a04b000 /);
  assert.match(board, /\nReady, deferred, P0 \(1\)\n {2}t_7a04a000 /);
  assert.match(board, /Do, card pass \(4\)\n {2}card t_7a04f000:[^\n]*\n {2}card t_7a016000:[^\n]*\n {2}card t_7a04a000:[^\n]*\n {2}card t_7a04c000:/, 'a deferred P0 cards after a P3, lifts no task outside the list it waits on, and a deferred waiter keeps no task in place');
  assert.match(chips('brief', 't_7a04a000').stdout, /^Review scope: collaboration\. Deferred, so it ranks after every task whose scope chips\.deferred does not list\.$/mu);
  assert.match(chips('brief', 't_7a04b000').stdout, /^Review scope: collaboration\.$/mu);
});

test('a deferred task queues behind other work on a shared outside path, and chips asks to fix a chips.deferred it cannot use', () => {
  const { batch, chips, outside } = chipLedger({ config: { chips: { scopes: 'scopes', deferred: ['collaboration'] } }, files: { 'scopes/collaboration.json': '{}', 'scopes/editor.json': '{}' } });
  const written = batch([
    ['t_7a010000 Fix the shared doc', 'offered', `writes: ${outside('shared.md')}; topic: d1; priority: P0; repro: steps; review-scope: collaboration`],
    ['t_7a02d000 Reword the shared doc', 'offered', `writes: ${outside('shared.md')}; topic: n1; priority: P1; repro: steps; review-scope: editor`],
  ]);
  assert.equal(written.status, 0, written.stderr);
  const board = chips().stdout;
  assert.match(board, /\nReady, P1 \(1\)\n {2}t_7a02d000 /);
  assert.match(board, /\nWaiting, deferred, P0 \(1\)\n {2}t_7a010000 {2}Fix the shared doc {2}\[d1\] {2}waits on queued behind t_7a02d000/);
  const cases = [
    [['colaboration'], /fix chips\.deferred in \.agents\/pstack\.json: colaboration is no review scope in scopes/],
    [{ collaboration: true }, /fix chips\.deferred in \.agents\/pstack\.json: it is a list of review scope ids/],
  ];
  for (const [deferred, said] of cases) {
    const wrong = chipLedger({ config: { chips: { scopes: 'scopes', deferred } }, files: { 'scopes/collaboration.json': '{}' } });
    const offered = wrong.batch([['t_7a00d000 Fix c1', 'offered', 'writes: c1.md; topic: c1; priority: P1; repro: steps; review-scope: collaboration']]);
    assert.equal(offered.status, 0, offered.stderr);
    const listed = wrong.chips();
    assert.equal(listed.status, 1, JSON.stringify(deferred));
    assert.match(listed.stdout, said);
  }
});

test('a deferred task that owns a check failing on the base branch keeps its place', () => {
  const { batch, chips } = chipLedger({ config: { chips: { scopes: 'scopes', deferred: ['collaboration'] } }, files: { 'scopes/collaboration.json': '{}', 'scopes/editor.json': '{}' } });
  const written = batch([
    ['t_7a014000 Fix e1', 'offered', 'writes: e1.md; topic: e1; priority: P1; repro: steps; review-scope: editor'],
    ['t_7a04b000 Fix the red peer-order step', 'offered', 'writes: y1.md; topic: y1; priority: P2; via: verdict; review-scope: collaboration; owns: ci:yjs-peer-order'],
  ]);
  assert.equal(written.status, 0, written.stderr);
  const board = chips().stdout;
  assert.match(board, /\nReady, P0 \(1\)\n {2}t_7a04b000 /, 'a red check fails every change, so its task is not deferred');
  assert.doesNotMatch(board, /Ready, deferred/);
  assert.match(chips('brief', 't_7a04b000').stdout, /^Review scope: collaboration\.$/mu);
});

test("a session withdraws its lowest deferred cards when tasks that rank above them have no room for a card", () => {
  const { batch, chips } = chipLedger({ config: { chips: { scopes: 'scopes', deferred: ['collaboration'] } }, files: { 'scopes/collaboration.json': '{}', 'scopes/editor.json': '{}' } });
  const ids = { y1: 't_7a04b000', y2: 't_7a04c000', y3: 't_7a04d000', a1: 't_7a004000', a2: 't_7a005000' };
  const deferred = [['y1', 'P0'], ['y2', 'P1'], ['y3', 'P1']].map(([id, priority]) => [`${ids[id]} Fix ${id}`, 'offered', `writes: ${id}.md; topic: ${id}; priority: ${priority}; repro: steps; review-scope: collaboration; card: c${id}; session: s1`]);
  const held = [1, 2, 3, 4, 5, 6, 7].map((n) => [`t_7a0${(0x2c + n).toString(16)}000 Fix n${n}`, 'offered', `writes: n${n}.md; topic: n${n}; priority: P1; repro: steps; review-scope: editor; card: cn${n}; session: s1`]);
  const waiting = ['a1', 'a2'].map((id) => [`${ids[id]} Fix ${id}`, 'offered', `writes: ${id}.md; topic: ${id}; priority: P2; via: verdict; review-scope: editor; session: s1`]);
  const written = batch([...deferred, ...held, ...waiting]);
  assert.equal(written.status, 0, written.stderr);
  assert.match(chips('--session', 's1').stdout, /Do, withdrawal pass \(2\)\n {2}withdraw t_7a04c000's card cy2: its review scope is deferred, and 2 ready tasks that rank above it have no room for a card;[^\n]*\n {2}withdraw t_7a04d000's card cy3:/, 'a deferred P1 card gives way to a P2 outside the list, lowest first');
  assert.equal(batch([['t_7a04d000 Fix y3', 'uncarded', 'card: cy3']]).status, 0);
  const one = chips('--session', 's1').stdout;
  assert.match(one, /Do, withdrawal pass \(1\)\n {2}withdraw t_7a04c000's card cy2: its review scope is deferred, and 1 ready task that ranks above it has no room for a card;/);
  assert.doesNotMatch(one, /withdraw t_7a04b000/, 'a deferred card stays while the tasks above it have room');
  assert.equal(batch([['t_7a04c000 Fix y2', 'uncarded', 'card: cy2']]).status, 0);
  assert.match(chips('--session', 's1').stdout, /Do, card pass \(3\)\n {2}card t_7a004000:[^\n]*\n {2}card t_7a005000:[^\n]*\n {2}2 more can start once this session holds fewer than 10 cards/, 'the freed room goes to the tasks outside the list, not back to the deferred ones');
  assert.doesNotMatch(chips().stdout, /withdraw t_7a049000/, 'a read with no session withdraws nothing');

  const leaving = chipLedger({ config: { chips: { scopes: 'scopes', deferred: ['collaboration'] } }, files: { 'scopes/collaboration.json': '{}', 'scopes/editor.json': '{}' } });
  assert.equal(leaving.batch([...deferred, ...held, ...waiting, ['t_7a033000 Fix n7', 'updated', 'waits: pr:5']]).status, 0);
  const freed = leaving.chips('--session', 's1').stdout;
  assert.match(freed, /withdraw t_7a033000's card cn7: /);
  assert.match(freed, /withdraw t_7a04d000's card cy3: its review scope is deferred, and 1 ready task that ranks above it has no room for a card;/, "a card that leaves for a wait frees its room");
  assert.doesNotMatch(freed, /withdraw t_7a04c000/);
});

