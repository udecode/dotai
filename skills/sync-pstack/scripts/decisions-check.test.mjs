import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CONFIG, LOG_HEAD, brief, logRow, project, read, sandbox } from './test-sandbox.mjs';
import { chipLedger, linkedWorktree } from './test-ledger.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const HELPERS = join(HERE, '../assets/pstack');

test('decisions-check append writes only a row that passes the check', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app');
  const append = (...cells) => run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'append', 'log.decisions.tsv', ...cells], root);

  assert.equal(append('fix', 'repair the parser', 'it dropped rows', 'ran the suite', 'verified on all fixtures').status, 1);
  assert.equal(append('fix', 'repair\tthe parser', 'it dropped rows', 'ran it, scope: fixtures', 'verified').status, 1);
  assert.equal(existsSync(join(root, 'log.decisions.tsv')), false);
  const ok = append('fix', 'repair the parser', 'it dropped rows', 'ran it, scope: all fixtures', 'verified');
  assert.equal(ok.status, 0, ok.stderr);
  const lines = read(root, 'log.decisions.tsv').trim().split('\n');
  assert.equal(lines[0], 'ts\tphase\tdecision\twhy\tevidence\tresult');
  assert.match(lines.find((line) => line.split('\t')[1] === 'fix'), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\tfix\trepair the parser\t/);
  assert.equal(run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'log.decisions.tsv'], root).status, 0);
});

test('decisions-check prints every problem of a long log through a pipe, as a shell tool reads it', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app');
  const rows = Array.from({ length: 4000 }, (_, n) => `2026-01-01T00:00:00Z\tbuild\tdecision ${n}\twhy\tevidence`);
  writeFileSync(join(root, 'long.decisions.tsv'), `ts\tphase\tdecision\twhy\tevidence\tresult\n${rows.join('\n')}\n`);
  const result = run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'long.decisions.tsv'], root);
  assert.equal(result.status, 1);
  const [announced, ...problems] = result.stderr.trim().split('\n');
  assert.equal(announced, '4000 problem(s):');
  assert.equal(problems.length, 4000, `printed ${problems.length} of 4000 problems in ${result.stderr.length} bytes`);
  assert.ok(result.stderr.length > 2 * 65_536, 'the problems outgrow a pipe buffer twice over');
});

test('decisions-check refuses a panel row in the plans directory until its plan sits beside the log', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', { files: { 'docs/plans/.keep': '' } });
  const append = (log) => run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'append', log, 'panel', 'seats opus', 'why', 'evidence', 'recorded'], root);
  const orphan = append('docs/plans/2026-01-01-verdict.decisions.tsv');
  assert.equal(orphan.status, 1, 'a panel row with no plan beside it');
  assert.match(orphan.stderr, /needs its plan docs\/plans\/2026-01-01-verdict\.md/);
  assert.equal(run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'append', 'docs/plans/2026-01-01-verdict.decisions.tsv', 'plan', 'pick the scope', 'why', 'evidence', 'recorded'], root).status, 0, 'other phases need no plan');
  writeFileSync(join(root, 'docs/plans/2026-01-01-verdict.md'), '# Verdict\n\nStatus: planning\n' + brief());
  assert.equal(append('docs/plans/2026-01-01-verdict.decisions.tsv').status, 0, 'the plan exists');
  assert.equal(append('log.decisions.tsv').status, 0, 'a log outside the plans directory');
});

test('decisions-check takes a panel finding only with a severity, after a seats row, and with an applied, dismissed or owned deferred reason', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app');
  const append = (decision, result) => run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'append', 'log.decisions.tsv', 'panel', decision, 'why', 'evidence', result], root);
  assert.equal(append('critical The seat writes files', 'applied: read-only').status, 1, 'a finding before any seats row');
  assert.equal(append('seats opus, codex:gpt-6.1-sol @xhigh', 'recorded').status, 0);
  assert.equal(append('The seat writes files', 'applied: read-only').status, 1, 'a finding without a severity');
  assert.equal(append('critical [opus]: The seat writes files', 'recorded').status, 1, 'a finding with no disposition');
  assert.equal(append('critical [opus]: The seat writes files', 'applied').status, 1, 'a disposition with no reason');
  const unnamed = append('critical The seat writes files', 'applied: read-only');
  assert.equal(unnamed.status, 1, 'a critical finding that names no seat');
  assert.match(unnamed.stderr, /critical \[<seat>, \.\.\.\]: .*opus, gpt-6\.1-sol or lead/);
  assert.equal(append('critical [opus, gpt-6-astra]: The seat writes files', 'applied: read-only').status, 1, 'a seat off the round\'s roster');
  assert.equal(append('critical [opus, codex:gpt-6.1-sol @xhigh]: The seat writes files', 'applied: read-only').status, 0, 'seats from the roster');
  assert.equal(append('critical [opus, sol]: The seat writes files', 'applied: read-only').status, 0, 'the answer file name of a roster seat');
  assert.equal(append('critical [gpt]: The seat writes files', 'applied: read-only').status, 1, 'a word that is not the last of a roster model');
  assert.equal(append('critical [astra]: The seat writes files', 'applied: read-only').status, 1, 'the answer file name of a seat off the roster');
  assert.equal(append('critical [lead]: The fallback hides a missing seat', 'applied: the fallback names it').status, 0, 'the lead');
  assert.equal(append('critical [opus, lead]: The seat writes files', 'applied: read-only').status, 1, 'the lead beside a seat');
  assert.equal(append('warning The fallback lists stale sessions', 'deferred: outside the ask').status, 1, 'a deferral with no owner');
  assert.equal(append('warning The fallback lists stale sessions', 'deferred: outside the ask, owner:').status, 1, 'a deferral with an empty owner');
  assert.equal(append('critical [opus]: The seat writes files', 'deferred: later, owner: user').status, 1, 'a deferred critical finding');
  assert.equal(append('warning The fallback lists stale sessions', 'deferred: outside the ask, owner: user in docs/plans/next.md').status, 0);
  assert.equal(append('warning: The fallback lists stale sessions', 'dismissed: each read rebuilds the list').status, 0, 'a severity with a colon right after it');
  assert.equal(append('warnings from both seats', 'dismissed: each read rebuilds the list').status, 1, 'a longer word that starts with a severity');
  assert.equal(append('warningé The fallback lists stale sessions', 'dismissed: each read rebuilds the list').status, 1, 'a longer word whose next letter is outside ASCII');
  assert.equal(append('nit９ Rename the flag', 'dismissed: churn').status, 1, 'a longer word whose next digit is outside ASCII');
  assert.equal(append('warning‍ness is a longer token', 'dismissed: each read rebuilds the list').status, 1, 'a longer word joined by a zero-width joiner');
  assert.equal(append('nit­picky naming', 'dismissed: churn').status, 1, 'a longer word joined by a soft hyphen');
  assert.equal(append('warning, nit: two small points', 'dismissed: churn').status, 1, 'a severity that punctuation other than a colon follows');
  const colon = append('critical: The seat writes files', 'applied: read-only');
  assert.equal(colon.status, 1, 'a critical finding with a colon where its seats go');
  assert.match(colon.stderr, /critical \[<seat>, \.\.\.\]: .*opus, gpt-6\.1-sol or lead/);
  assert.equal(run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'log.decisions.tsv'], root).status, 0, 'a whole-log check reads the roster too');
  assert.equal(run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'append', 'log.decisions.tsv', 'writing', 'deslop on the round 1 fixes', 'why', 'evidence', 'recorded'], root).status, 0);
  assert.equal(append('seats gpt-6-astra @xhigh', 'recorded').status, 0);
  assert.equal(append('critical [opus]: The seat writes files', 'applied: read-only').status, 1, 'a seat of an earlier round only');
  assert.equal(run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'append', 'log.decisions.tsv', 'writing', 'deslop on the round 2 fixes', 'why', 'evidence', 'recorded'], root).status, 0);
  assert.equal(append('seats gpt-6-astra @xhigh, codex:gpt-6.1-sol @xhigh missing', 'recorded').status, 0);
  assert.equal(append('critical [gpt-6.1-sol]: The seat writes files', 'applied: read-only').status, 1, 'a seat the seats row marks missing');
  assert.equal(append('critical [gpt-6-astra]: The seat writes files', 'applied: read-only').status, 0, 'a seat that answered beside a missing one');
});

test('decisions-check takes an open panel finding only with its patch and owner', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app');
  const append = (decision, result) => run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'append', 'log.decisions.tsv', 'panel', decision, 'why', 'the seat\'s probe; proof: none', result], root);
  assert.equal(append('seats opus', 'recorded').status, 0);
  assert.equal(append('critical [opus]: The guard drops real typing', 'open: the fix adds code past the cap').status, 1, 'an open finding with no patch or owner');
  assert.equal(append('critical [opus]: The guard drops real typing', 'open: past the cap, patch: fix.patch').status, 1, 'an open finding with no owner');
  assert.equal(append('critical [opus]: The guard drops real typing', 'open: past the cap, owner: user').status, 1, 'an open finding with no patch');
  const ok = append('critical [opus]: The guard drops real typing', 'open: past the cap, patch: scratch/fix.patch, owner: user');
  assert.equal(ok.status, 0, ok.stderr);
});

test('decisions-check takes a second open critical finding only with an open design question that cites the plan', () => {
  const { LEDGER, helper, root } = chipLedger();
  const log = 'docs/plans/2026-01-01-join.decisions.tsv';
  writeFileSync(join(root, 'docs/plans/2026-01-01-join.md'), '# Join\n\nStatus: building\n' + brief());
  const panel = (decision, result) => helper('append', log, 'panel', decision, 'why', "the seat's probe fails on base too; proof: none", result);
  const open = (finding, task = '') => panel(`critical [opus]: ${finding}`, `open: base fails the same way, patch: none, owner: user, stop: the fix lands${task}`);
  const chip = (decision, why, evidence, result) => helper('append', LEDGER, 'chip', decision, why, evidence, result);
  const offer = (decision, why, kind) => chip(decision, why, `writes: src/join.ts; topic: joins; kind: ${kind}; priority: P1; repro: steps`, 'offered');
  const QUESTION = 't_dec00001 Decide whether the join design needs a redesign (xhigh)';

  assert.equal(panel('seats opus', 'recorded').status, 0);
  assert.equal(open('the redo puts the paragraph in the first quote').status, 0, 'one open finding is a limit');
  assert.equal(panel('critical [opus]: the moved line stays split', 'applied: the read follows the end place').status, 0, 'an applied finding is not open');
  const second = open('the unwrap drops the paragraph');
  assert.equal(second.status, 1, 'a second open finding with no design question');
  assert.match(second.stderr, /this log already holds 1 open critical finding,.*kind: decide task in docs\/plans\/suggested-tasks\.decisions\.tsv, with via: panel when it ranks P2 or P3, whose finding cites 2026-01-01-join .*"task:<id>"/);
  assert.match(open('the unwrap drops the paragraph', ', task:t_none0001').stderr, /task:t_none0001 is not a task/, 'a task the ledger lacks');
  assert.equal(offer('t_fix00001 Fix the unwrap loss', 'the unwrap in docs/plans/2026-01-01-join.md drops the paragraph', 'fix').status, 0);
  assert.match(open('the unwrap drops the paragraph', ', task:t_fix00001').stderr, /task:t_fix00001 is a fix task, not a design question/, 'a fix task');
  assert.equal(offer(QUESTION, 'joins in docs/plans/2026-01-01-join-2.md keep needing special cases', 'decide').status, 0);
  assert.match(open('the unwrap drops the paragraph', ', task:t_dec00001').stderr, /no finding of task:t_dec00001 cites 2026-01-01-join;/, 'a design question that cites only a plan whose name starts the same');
  assert.equal(chip(QUESTION, 'docs/plans/2026-01-01-join.md leaves the redo and the unwrap open', 'kind: decide', 'folded').status, 0);
  const named = open('the unwrap drops the paragraph', ', task:t_dec00001');
  assert.equal(named.status, 0, named.stderr);
  assert.equal(open('the moved anchor keeps the quotes split', ', stop: task:t_fix00001 lands, task:t_dec00001').status, 0, 'one open design question among the tasks it names');

  const declined = chip(QUESTION, 'the owner keeps the join design', 'evidence', 'dismissed declined');
  assert.equal(declined.status, 0, declined.stderr);
  assert.match(open('the redo loses the letter', ', task:t_dec00001').stderr, /task:t_dec00001 is dismissed, not open/, 'a closed design question');
  const tooling = chip('t_dec00003 Decide whether the join design needs a redesign (xhigh)', 'docs/plans/2026-01-01-join.md leaves four findings open', 'writes: src/join.ts; topic: joins; kind: decide; priority: P3; via: panel', 'offered');
  assert.equal(tooling.status, 0, `a P3 design question on the panel route: ${tooling.stderr}`);
  assert.equal(open('the redo loses the letter', ', task:t_dec00003').status, 0);
  const unrelated = chip('t_fix00002 Reword the README introduction', 'the introduction reads badly', 'writes: README.md; topic: docs; kind: fix; priority: P3; via: panel', 'offered');
  assert.equal(unrelated.status, 1, 'a P3 fix on the panel route');
  assert.match(unrelated.stderr, /via: panel is the route for the design question that two open critical panel findings require, so it goes only on a kind: decide offer/);
});

test("decisions-check takes a review round's second critical finding under redesign-runs only once the log holds a redesign run row", () => {
  const { helper, root } = chipLedger();
  mkdirSync(join(root, '.agents/playbooks'), { recursive: true });
  const fix = (setting, eol = '\n') => `---\nextends: bug-fix\nwhen: Use it for a bug report.\n${setting}---\n\n# Bug fix\n`.replaceAll('\n', eol);
  writeFileSync(join(root, '.agents/playbooks/bug-fix.md'), fix('redesign-runs: on\n'));
  writeFileSync(join(root, '.agents/playbooks/build.md'), fix(''));
  writeFileSync(join(root, '.agents/playbooks/triage.md'), fix('redesign-runs: off\n'));
  writeFileSync(join(root, '.agents/playbooks/crlf.md'), fix('redesign-runs: on\n', '\r\n'));
  const plan = (slug, playbook, eol = '\n') => {
    writeFileSync(join(root, `docs/plans/${slug}.md`), `# Join\n\nStatus: building\nPlaybook: ${playbook}\n${brief()}`.replaceAll('\n', eol));
    return `docs/plans/${slug}.decisions.tsv`;
  };
  const row = (decision, result = 'applied: the read follows the end place', phase = 'panel', evidence = 'proof: none') => [phase, decision, 'why', evidence, result].join('\t');
  const seats = row('seats opus', 'recorded');
  const writing = row('deslop on the round fixes', 'recorded', 'writing');
  const critical = (n, result) => row(`critical [opus]: finding ${n}`, result);
  const open = (n) => critical(n, 'open: a row of the expected-results table, patch: none, owner: user, stop: the slice that fixes it lands');
  const append = (log, ...rows) => {
    writeFileSync(join(root, 'rows.tsv'), rows.join('\n') + '\n');
    return helper('append', log, '--from', 'rows.tsv');
  };
  const refused = (at) => new RegExp(`\\(new row${at ? ` ${at}` : ''}\\): this is critical finding \\d of its panel round.*the bug-fix playbook counts more than one failure kind with one owner .*"redesign run:" .*"plan round:" .*"separate owners:"`);
  const asked = /this log already holds 1 open critical finding/;

  writeFileSync(join(root, 'docs/plans/2026-01-02-join-verdict.md'), '# Verdict on the join reader\n');
  writeFileSync(join(root, 'VISION.md'), '# Vision\n');
  const verdict = (decision, evidence) => row(decision, 'decided', 'verdict', evidence);
  const redesigned = verdict('redesign run: verdict Pursue on the join reader', 'page: docs/plans/2026-01-02-join-verdict.md');
  const planRound = row('plan round: docs/plans/2026-01-03-join.md', 'decided', 'plan');

  const log = plan('2026-01-03-join', 'bug-fix');
  assert.equal(append(log, seats, planRound, critical(1), critical(2)).status, 0, 'a plan round row');
  const code = append(log, writing, seats, critical(1), critical(2));
  assert.match(code.stderr, refused(4), 'a round without a plan round row reviews a fix, with or without a build row before it');
  assert.match(code.stderr, /in phase verdict, giving the verdict and naming in its evidence the verdict's page/);
  assert.match(append(log, writing, row('the join reads the end place', 'fixed: src/join.ts', 'verify'), seats, critical(1), critical(2)).stderr, refused(5), 'a fix logged under verify');
  assert.equal(append(log, writing, seats, critical(1), critical(2, 'dismissed: the probe ran on the old build')).status, 0, 'a dismissed finding is no failure kind');
  assert.match(append(log, critical(3)).stderr, refused(), 'a later batch counts the round so far');
  const owners = append(log, row('separate owners: the join reader; the undo history', 'decided', 'review'), critical(3));
  assert.equal(owners.status, 0, `two owners take two findings: ${owners.stderr}`);
  const third = append(log, critical(4));
  assert.match(third.stderr, /critical finding 3 of its panel round while its separate owners: row names 2 owners/, 'a third finding past two owners');
  assert.match(append(log, row('separate owners: the join reader; The Join Reader', 'decided', 'review'), critical(4)).stderr, refused(2), 'one owner named twice');
  assert.equal(append(log, writing, row('built: src/join.ts', 'applied: the join reads the end place', 'build'), seats, critical(4)).status, 0);
  assert.match(append(log, critical(5)).stderr, refused(), "an earlier round's owners do not carry over");
  for (const [marker, why] of [
    [verdict('redesign run: verdict Pursue on the join reader', 'proof: none'), 'a verdict row that names no page'],
    [verdict('redesign run: no', 'proof: none'), 'a verdict row that says no'],
    [verdict('redesign run: verdict Pursue on the join reader', 'plan: docs/plans/2026-01-03-join.md'), "a verdict row that names the log's own plan"],
    [verdict('redesign run: verdict Pursue on the join reader', 'page: VISION.md'), 'a verdict row that names a file outside the plans directory'],
    [row('redesign run: verdict Pursue on the join reader', 'decided', 'fix', 'page: docs/plans/2026-01-02-join-verdict.md'), 'a redesign run row in a fix phase'],
  ]) assert.match(append(log, marker, critical(5)).stderr, refused(2), why);
  assert.match(append(log, critical(5), redesigned).stderr, refused(1), 'a redesign run row after the finding');
  assert.equal(append(log, redesigned, critical(5), critical(6)).status, 0, "a verdict row that names the verdict's page");
  assert.equal(append(log, writing, seats, critical(7), critical(8)).status, 0, 'the run stays a redesign run in later rounds');
  const answered = append(log, writing, seats, open(9), open(10));
  assert.equal(answered.status, 0, `a redesign run's verdict answers the design question two open findings ask: ${answered.stderr}`);
  const next = plan('2026-01-04-join-2', 'bug-fix');
  const continued = append(next, verdict('redesign run: continues the join redesign', `${log}:12`), seats, critical(1), critical(2));
  assert.equal(continued.status, 0, `a plan that continues a redesign run cites the earlier log: ${continued.stderr}`);
  const owner = plan('2026-01-04-join', 'bug-fix');
  assert.equal(append(owner, row('redesign run: the owner said "redesign the join"', 'decided', 'owner'), seats, critical(1), critical(2)).status, 0, "the owner's words");
  const crlf = plan('2026-01-10-join', 'crlf', '\r\n');
  assert.match(append(crlf, seats, critical(1), critical(2)).stderr, /\(new row 3\): this is critical finding 2 of its panel round.*the crlf playbook/, 'a playbook and a plan with CRLF line ends');

  for (const [slug, playbook] of [['2026-01-05-join', 'build'], ['2026-01-06-join', 'triage'], ['2026-01-07-join', 'feature']]) {
    const other = plan(slug, playbook);
    const plain = append(other, seats, critical(1), critical(2));
    assert.equal(plain.status, 0, `${playbook} does not set redesign-runs: on: ${plain.stderr}`);
    assert.match(append(other, redesigned, writing, seats, open(3), open(4)).stderr, asked, `a redesign run row leaves ${playbook}'s design question in place`);
  }
  assert.equal(append('run.decisions.tsv', seats, critical(1), critical(2)).status, 0, 'a log with no plan beside it');
  assert.match(append('run.decisions.tsv', redesigned, writing, seats, open(3), open(4)).stderr, asked, 'a redesign run row in a log with no plan beside it');
  const byHand = plan('2026-01-08-join', 'bug-fix');
  const header = ['ts', 'phase', 'decision', 'why', 'evidence', 'result'].join('\t');
  writeFileSync(join(root, byHand), [header, seats, critical(1), critical(2)].map((line, index) => (index ? `2026-01-08T00:00:0${index}Z\t${line}` : line)).join('\n') + '\n');
  const whole = helper(byHand);
  assert.equal(whole.status, 0, `the whole-log check leaves rows written by hand alone: ${whole.stderr}`);
});

test("decisions-check counts a pivot's open critical findings like any other", () => {
  const { helper, root } = chipLedger();
  const log = 'docs/plans/2026-01-02-wrap.decisions.tsv';
  writeFileSync(join(root, 'docs/plans/2026-01-02-wrap.md'), '# Wrap\n\nStatus: building\n' + brief());
  writeFileSync(join(root, 'docs/plans/2026-01-02-wrap-2.md'), '# Wrap again\n\nThe pivot from 2026-01-02-wrap.\n\nStatus: planning\n' + brief());
  mkdirSync(join(root, 'docs/plans/artifacts/wrap'), { recursive: true });
  writeFileSync(join(root, 'docs/plans/artifacts/wrap/prior-art.md'), '# What other editors do with the unwrap\n');
  const row = (n, result) => ['panel', n ? `critical [opus]: finding ${n}` : 'seats opus', 'why', 'proof: none', result].join('\t');
  const pivot = (n) => row(n, 'open: the design cannot meet it, patch: docs/plans/2026-01-02-wrap-2.md, owner: user, stop: its build, prior-art: docs/plans/artifacts/wrap/prior-art.md');
  const batch = (...rows) => {
    writeFileSync(join(root, 'rows.tsv'), [row(0, 'recorded'), ...rows].join('\n') + '\n');
    return helper('append', log, '--from', 'rows.tsv');
  };
  const refused = /\(new row 3\): this log already holds 1 open critical finding/;

  assert.match(batch(row(1, 'open: base fails too, patch: none, owner: user'), row(2, 'open: base fails too, patch: none, owner: user')).stderr, refused, 'two open findings in one batch');
  assert.match(batch(row(1, 'open: base fails too, patch: none, owner: user'), pivot(2)).stderr, refused, 'a pivot after a limit');
  assert.match(batch(pivot(1), pivot(2)).stderr, refused, 'two findings that pivot to the same new plan');
  assert.equal(batch(pivot(1)).status, 0, 'one pivot');
});

test("decisions-check counts only the log's own open critical findings, so a plan's next iteration starts again", () => {
  const { helper, root } = chipLedger();
  const plan = (name) => writeFileSync(join(root, `docs/plans/${name}.md`), `# ${name}\n\nStatus: building\n` + brief());
  const panel = (name, decision, result) => helper('append', `docs/plans/${name}.decisions.tsv`, 'panel', decision, 'why', 'proof: none', result);
  const limit = (name) => {
    assert.equal(panel(name, 'seats opus', 'recorded').status, 0);
    return panel(name, 'critical [opus]: the unwrap drops the paragraph', 'open: base fails too, patch: none, owner: user');
  };
  const names = ['2026-01-01-join', '2026-01-03-join-2', '2026-01-03-pstack-0967', '2026-01-04-pstack-09118'];
  for (const name of names) plan(name);
  for (const name of names) {
    const one = limit(name);
    assert.equal(one.status, 0, `${name}: ${one.stderr}`);
  }
});

test('decisions-check reads a design question through its merged findings and never through a refused ledger row', () => {
  const { LEDGER, helper, root } = chipLedger();
  const log = 'docs/plans/2026-01-01-join.decisions.tsv';
  writeFileSync(join(root, 'docs/plans/2026-01-01-join.md'), '# Join\n\nStatus: building\n' + brief());
  const panel = (decision, result) => helper('append', log, 'panel', decision, 'why', 'proof: none', result);
  const open = (task) => panel('critical [opus]: the unwrap drops the paragraph', `open: base fails too, patch: none, owner: user, task:${task}`);
  const chip = (decision, why, result, evidence = 'writes: src/join.ts; topic: joins; kind: decide; priority: P1; repro: steps') => helper('append', LEDGER, 'chip', decision, why, evidence, result);
  assert.equal(panel('seats opus', 'recorded').status, 0);
  assert.equal(panel('critical [opus]: the redo splits the quote', 'open: base fails too, patch: none, owner: user').status, 0);
  assert.equal(chip('t_dec00001 Decide whether joins need a redesign (xhigh)', 'joins keep needing special cases', 'offered').status, 0);

  const ledger = read(root, LEDGER);
  writeFileSync(join(root, LEDGER), `${ledger}2026-01-01T00:00:00Z\tchip\tt_dec00001 Decide whether joins need a redesign (xhigh)\tdocs/plans/2026-01-01-join.md leaves two findings open\tkind: decide\tnot-a-state\n`);
  assert.match(open('t_dec00001').stderr, /no finding of task:t_dec00001 cites 2026-01-01-join;/, 'a ledger row the task parser refuses');
  writeFileSync(join(root, LEDGER), ledger);

  const other = chip('t_dec00002 Decide whether the join design needs a redesign (xhigh)', 'docs/plans/2026-01-01-join.md leaves two findings open', 'offered', 'writes: src/join.ts; topic: unwraps; kind: decide; priority: P1; repro: steps');
  assert.equal(other.status, 0, other.stderr);
  const merged = chip('t_dec00002 Decide whether the join design needs a redesign (xhigh)', 'the same question as t_dec00001', 'dismissed dup t_dec00001', 'evidence');
  assert.equal(merged.status, 0, merged.stderr);
  const kept = open('t_dec00001');
  assert.equal(kept.status, 0, `the kept task holds the merged finding: ${kept.stderr}`);
});

test("decisions-check takes a later round's seats row only after a writing row", () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app');
  const append = (phase, decision, result = 'recorded') => run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'append', 'log.decisions.tsv', phase, decision, 'why', 'evidence', result], root);
  assert.equal(append('panel', 'seats opus').status, 0, 'the first round');
  assert.equal(append('panel', 'critical [opus]: The guard drops typing', 'applied: the guard reads the composition flag').status, 0);
  const unwritten = append('panel', 'seats opus');
  assert.equal(unwritten.status, 1, 'a second round whose fixes had no writing pass');
  assert.match(unwritten.stderr, /needs a writing row/);
  assert.equal(append('writing', 'deslop and no-comments on the round 1 fixes').status, 0);
  assert.equal(append('panel', 'seats opus').status, 0, 'the second round after the writing pass');
  const batch = (name, rows) => {
    writeFileSync(join(root, name), rows.map((row) => row.join('\t')).join('\n') + '\n');
    return run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'append', 'log.decisions.tsv', '--from', name], root);
  };
  assert.equal(batch('written.tsv', [['writing', 'unslop on the round 2 fixes', 'why', 'evidence', 'recorded'], ['panel', 'seats opus', 'why', 'evidence', 'recorded']]).status, 0, 'a queued writing row before the next round');
  const skipped = batch('skipped.tsv', [['writing', 'unslop on the round 3 fixes', 'why', 'evidence', 'recorded'], ['panel', 'seats opus', 'why', 'evidence', 'recorded'], ['panel', 'critical [opus]: The guard drops typing', 'why', 'evidence', 'applied: fixed'], ['panel', 'seats opus', 'why', 'evidence', 'recorded']]);
  assert.equal(skipped.status, 1, 'a queued round with no writing row after the previous one');
  assert.match(skipped.stderr, /\(new row 4\): a later round's seats row/);
  writeFileSync(join(root, 'old.decisions.tsv'), 'ts\tphase\tdecision\twhy\tevidence\tresult\n2026-10-06T10:00:00Z\tpanel\tseats opus\twhy\tevidence\trecorded\n2026-10-06T11:00:00Z\tpanel\tseats opus\twhy\tevidence\trecorded\n');
  assert.equal(run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'old.decisions.tsv'], root).status, 0, 'a whole-log check leaves rounds already written alone');
});

test('decisions-check takes a recorded critical finding only with its saved case and fixing step, and holds the reach step until each is settled', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', { files: { 'docs/plans/artifacts/run/void.md': 'case', 'docs/plans/artifacts/run/mark.md': 'case' } });
  const append = (phase, decision, evidence, result) => run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'append', 'log.decisions.tsv', phase, decision, 'why', evidence, result], root);
  const voidCase = 'proof: docs/plans/artifacts/run/void.md';
  const markCase = 'proof: docs/plans/artifacts/run/mark.md';
  const reach = () => append('build', 'built: step 5 index.ts; reach: exports walk from the package root', 'scope: the export test', 'applied: step 5');
  assert.equal(append('panel', 'seats opus', 'evidence', 'recorded').status, 0);
  assert.equal(append('panel', 'critical [opus]: The walk skips a void', voidCase, 'recorded: no export reaches the walk').status, 1, 'no fixing step');
  assert.equal(append('panel', 'critical [opus]: The walk skips a void', 'proof: none', 'recorded: no export reaches the walk, step: 4').status, 1, 'no saved case');
  assert.equal(append('panel', 'critical [opus]: The walk skips a void', 'proof: docs/plans/artifacts/run/gone.md (missing)', 'recorded: no export reaches the walk, step: 4').status, 1, 'a saved case that is no file');
  assert.equal(append('panel', 'warning The walk name reads oddly', voidCase, 'recorded: later, step: 4').status, 1, 'a warning is never recorded');
  assert.equal(append('panel', 'critical [opus]: The walk skips a void', voidCase, 'recorded: no export reaches the walk, step: 4').status, 0);
  assert.equal(append('panel', 'critical [opus]: The merge drops a mark', markCase, 'recorded: no export reaches the merge, step: 4').status, 0, 'a second recorded finding needs no design question');
  assert.equal(append('build', 'built: step 3 walk.ts', 'scope: walk tests', 'applied: step 3').status, 0, 'a step that names no reach');
  const held = reach();
  assert.equal(held.status, 1);
  assert.match(held.stderr, /2 recorded critical findings are not settled: critical \[opus\]: The walk skips a void; critical \[opus\]: The merge drops a mark/);
  assert.equal(append('build', 'built: step 4 walk.ts', `${voidCase}; scope: the void case`, 'fixed: the walk visits voids').status, 0);
  assert.match(reach().stderr, /a recorded critical finding is not settled: critical \[opus\]: The merge drops a mark/, 'one still waits');
  assert.equal(append('panel', 'critical [lead]: The merge drops a mark', markCase, 'dismissed: the mark case keeps its mark on the base and the step').status, 0);
  assert.equal(reach().status, 0, 'every recorded finding settled');
  assert.equal(append('slice review', 'critical: The walk leaks a listener', 'proof: none', 'recorded: no export reaches the walk, step: 6').status, 1, "a slice review's recorded finding names its saved case too");
  assert.equal(append('slice review', 'critical: The walk leaks a listener', voidCase, 'recorded: no export reaches the walk, step: 6').status, 0);
  assert.match(reach().stderr, /not settled: critical: The walk leaks a listener/, "a slice review's recorded finding holds the reach step");
  assert.equal(append('build', 'built: step 6 index.ts; reach: exports walk from the package root', `${voidCase}; scope: the listener case`, 'fixed: the walk drops its listener').status, 0, 'a reach step that fixes the recorded case itself');
});

test('decisions-check takes the panel round cap from maxRounds and refuses a cap that is not a whole number', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', { config: { ...CONFIG, maxRounds: 1 } });
  const check = (...args) => run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), ...args], root);
  const append = (phase, decision) => check('append', 'log.decisions.tsv', phase, decision, 'why', 'evidence', 'recorded');
  assert.equal(append('panel', 'seats opus').status, 0);
  assert.equal(append('writing', 'unslop on the round fixes').status, 0);
  const stuck = append('panel', 'seats opus');
  assert.equal(stuck.status, 1, 'a second round past a cap of 1');
  assert.match(stuck.stderr, /panel round 2 since the last restart, past the cap of 1/);
  const rounds = check('rounds', 'log.decisions.tsv');
  assert.equal(rounds.status, 1);
  assert.match(rounds.stdout, /the cap is 1\b/);
  writeFileSync(join(root, '.agents/pstack.json'), JSON.stringify({ ...CONFIG, maxRounds: 'five' }));
  assert.notEqual(append('panel', 'seats opus').status, 0, 'a cap that is not a whole number refuses instead of turning the cap off');
  writeFileSync(join(root, '.agents/pstack.json'), JSON.stringify({ ...CONFIG, maxRounds: null }));
  assert.notEqual(check('rounds', 'log.decisions.tsv').status, 0, 'a null cap refuses, as apply refuses it, instead of reading as the default');
});

test('decisions-check refuses a new trunk step while an earlier one is built and not landed', () => {
  const { dir, run } = sandbox();
  const append = (root, phase, decision) => run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'append', 'log.decisions.tsv', phase, decision, 'why', 'evidence', 'recorded'], root);
  const root = project(dir, 'app', { config: { ...CONFIG, delivery: 'trunk' } });
  assert.equal(append(root, 'build', 'built: step 1 parser.mjs').status, 0);
  assert.equal(append(root, 'build', 'built: step 2 lexer.mjs').status, 0, 'before any landing the steps may land together');
  assert.equal(append(root, 'delivery', 'step 1 landed as abc1234').status, 0);
  const stuck = append(root, 'build', 'built: step 3 printer.mjs');
  assert.equal(stuck.status, 1);
  assert.match(stuck.stderr, /starts step 3 while step 2 is built and not landed/);
  assert.equal(append(root, 'build', 'built: step 2 round 1 fixes in lexer.mjs').status, 0, 'more work on the step in flight');
  assert.equal(append(root, 'delivery', 'step 2 landed as def5678').status, 0);
  assert.equal(append(root, 'build', 'built: step 3a printer.mjs').status, 0);
  assert.equal(append(root, 'delivery', 'step 3 landed as 0a1b2c3').status, 0);
  assert.equal(append(root, 'build', 'built: step 3b formatter.mjs').status, 1, 'step 3 landing does not land step 3a');
  assert.equal(append(root, 'delivery', 'step 3a dropped: folded into step 3b').status, 0);
  assert.equal(append(root, 'build', 'built: step 3b formatter.mjs').status, 0);

  const pr = project(dir, 'lib');
  for (const [phase, decision] of [['build', 'built: step 1 a.mjs'], ['delivery', 'step 1 landed as abc1234'], ['build', 'built: step 2 b.mjs']]) assert.equal(append(pr, phase, decision).status, 0);
  assert.equal(append(pr, 'build', 'built: step 3 c.mjs').status, 0, 'outside trunk delivery steps build in parallel');
});

const restampInOrder = () => {
  let tick = 0;
  return (file, result) => {
    if (result.status !== 0) return result;
    const stamp = new Date(Date.UTC(2000, 0, 1) + (tick += 1) * 1000).toISOString().replace(/\.\d{3}Z$/u, 'Z');
    const lines = readFileSync(file, 'utf8').split('\n');
    writeFileSync(file, lines.map((line, index) => (index > 0 && line && !line.startsWith('2000-') ? `${stamp}${line.slice(line.indexOf('\t'))}` : line)).join('\n'));
    return result;
  };
};

const pivotRun = (names) => {
  const { dir, run } = sandbox();
  const files = Object.fromEntries(names.map((name) => [`docs/plans/2026-01-01-${name}.md`, `# ${name}\n`]));
  const root = project(dir, 'app', { files: { ...files, 'docs/plans/artifacts/run/prior-art.md': '# Prior art\n' } });
  const tick = restampInOrder();
  const logOf = (name) => (name === 'run' ? 'docs/plans/artifacts/run/run.decisions.tsv' : `docs/plans/2026-01-01-${name}.decisions.tsv`);
  const append = (log, phase, decision, result = 'recorded') => tick(join(root, logOf(log)), run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'append', logOf(log), phase, decision, 'why', 'proof: none', result], root));
  const pivot = (from, to, severity = 'critical') => append(from, 'panel', `${severity} [opus]: The join drops a block`, `open: the run pivots; patch: docs/plans/2026-01-01-${to}.md; owner: the owner; stop: its build; prior-art: docs/plans/artifacts/run/prior-art.md`);
  return { append, pivot, root, run, tick };
};

test('decisions-check refuses a second new plan with nothing landed until the owner answer is quoted', () => {
  const { append, pivot } = pivotRun(['a', 'b', 'c', 'd']);
  assert.equal(append('a', 'panel', 'seats opus').status, 0);
  assert.equal(pivot('a', 'b').status, 0, "the first new plan is the lead's call");
  assert.equal(pivot('a', 'b', 'warning').status, 0, 'a second finding carried into the same new plan');
  assert.equal(append('b', 'panel', 'seats opus').status, 0);
  assert.equal(pivot('b', 'a', 'warning').status, 0, "a return into the run's first plan");
  const stuck = pivot('b', 'c');
  assert.equal(stuck.status, 1, "the second new plan, from the first new plan's log");
  assert.match(stuck.stderr, /starts the new plan 2026-01-01-c\.md after 1 new plan the lead chose since the run's last landing/);
  assert.equal(append('b', 'owner', 'second plan: the owner asked for a new plan').status, 0);
  assert.match(pivot('b', 'c').stderr, /after 1 new plan the lead chose/, 'an owner row that quotes nothing');
  assert.equal(append('b', 'owner', 'second plan: the owner said "take the new plan"').status, 0);
  assert.equal(pivot('b', 'c').status, 0);
  assert.equal(append('c', 'panel', 'seats opus').status, 0);
  assert.match(pivot('c', 'd').stderr, /after 1 new plan the lead chose/, "each later new plan needs its own answer, and the owner's plan c does not count");
  assert.equal(append('c', 'delivery', 'step 1 landed as abc1234').status, 0);
  assert.equal(pivot('c', 'd').status, 0, 'a landing starts the count again');
  assert.equal(append('c', 'owner', 'second plan: the owner said "plan the merge apart"').status, 0);
  assert.equal(pivot('c', 'e', 'warning').status, 0, 'a plan the owner asked for in their own words');
  assert.match(pivot('c', 'f', 'warning').stderr, /after 1 new plan the lead chose/, 'only d counts, not the owner-asked e');
});

test("decisions-check refuses a pivot's first row until it names the prior-art report on the finding's case", () => {
  const { append: to, root, run, tick } = pivotRun(['a', 'b']);
  const append = (phase, decision, result) => to('a', phase, decision, result);
  const pivot = (prior, severity = 'critical') => append('panel', `${severity} [opus]: The join drops a block`, `open: the run pivots; patch: docs/plans/2026-01-01-b.md; owner: the owner; stop: its build${prior}`);
  assert.equal(append('panel', 'seats opus', 'recorded').status, 0);
  assert.match(pivot('').stderr, /starts the new plan 2026-01-01-b\.md, and it names no prior-art: report/, 'the first new plan needs one too');
  assert.match(pivot('; prior-art: docs/plans/artifacts/run/missing.md').stderr, /its prior-art: docs\/plans\/artifacts\/run\/missing\.md is no file under docs\/plans\/artifacts\//);
  assert.match(pivot('; prior-art: docs/plans/2026-01-01-a.md').stderr, /its prior-art: docs\/plans\/2026-01-01-a\.md is no file under/, 'a file outside the artifacts folder');
  assert.match(pivot('; prior-art: docs/plans/artifacts/run').stderr, /its prior-art: docs\/plans\/artifacts\/run is no file under/, 'a folder');
  assert.equal(pivot('; prior-art: [the report](docs/plans/artifacts/run/prior-art.md).').status, 0, 'a Markdown link');
  assert.equal(pivot('', 'warning').status, 0, 'a finding carried into a plan the log already named');
  assert.equal(append('delivery', 'step 1 landed as abc1234', 'recorded').status, 0);
  assert.equal(pivot('', 'warning').status, 0, 'a plan the log named before its last landing');
  assert.equal(append('owner', 'second plan: the owner said "take it"', 'recorded').status, 0);
  const next = (prior) => append('panel', 'warning [opus]: The split drops a cell', `open: the run pivots; patch: docs/plans/2026-01-01-c.md; owner: the owner; stop: its build${prior}`);
  assert.equal(next('; prior-art: `docs/plans/artifacts/run/prior-art.md:3`, read at 2026-01-01').status, 0, 'a cited line and trailing punctuation');
  const log = 'docs/plans/2026-01-01-a.decisions.tsv';
  const onto = (plan, prior, evidence = 'proof: none') => tick(join(root, log), run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'append', log, 'panel', 'warning [opus]: The split drops a cell', 'why', evidence, `open: the run pivots; patch: docs/plans/2026-01-01-${plan}.md; owner: the owner; stop: its build${prior}`], root));
  const shapes = [
    ['d', '; prior-art: **docs/plans/artifacts/run/prior-art.md**', 'proof: none', 'a path in bold'],
    ['e', '; prior-art: "docs/plans/artifacts/run/prior-art.md"', 'proof: none', 'a quoted path'],
    ['f', '; prior-art: docs/plans/artifacts/run/prior-art.md', 'proof: none; the prior-art: lanes read two projects', 'a prior-art: mention in the evidence before the path in the result'],
    ['g', '; **prior-art:** docs/plans/artifacts/run/prior-art.md', 'proof: none', 'a label in bold'],
    ['h', '; Prior-art: docs/plans/artifacts/run/prior-art.md', 'proof: none', 'a capitalized label'],
  ];
  for (const [index, [plan, prior, evidence, why]] of shapes.entries()) {
    assert.equal(append('delivery', `landed as ${index}a1b2c3d`, 'recorded').status, 0);
    assert.equal(onto(plan, prior, evidence).status, 0, why);
  }
  assert.match(onto('i', '; prior-art: docs/plans/artifacts/../2026-01-01-a.md').stderr, /its prior-art: docs\/plans\/2026-01-01-a\.md is no file under/, 'a path that climbs out of the artifacts folder');
});

test('decisions-check counts a landing only from its fixed row and counts new plans through the run\'s logs', () => {
  const { append, pivot } = pivotRun(['a', 'b', 'x', 'y']);
  for (const log of ['run', 'a', 'b', 'x', 'y']) assert.equal(append(log, 'panel', 'seats opus').status, 0);
  assert.equal(pivot('run', 'a').status, 0, 'a run-folder log starts the first new plan');
  assert.match(pivot('a', 'b').stderr, /after 1 new plan the lead chose/, "the run folder's log counts toward the second");
  for (const [decision, result, why] of [
    ['land step 1 with land.mjs --dry', 'recorded: would land 717cb0f964', 'a dry run'],
    ['will land step 1 as 8c2d5eaeb3 after review', 'recorded', 'a landing still to come'],
    ['the land.mjs run for step 1 stopped on a rebase conflict at 53e6272d09', 'recorded', 'a stopped land.mjs run'],
    ['land step 1', 'recorded: landed cbd8db2914 on next', 'a landing worded another way'],
    ['step 1 not landed as 53e6272d09: the rebase stopped', 'recorded', 'a row that says the step did not land'],
  ]) {
    assert.equal(append('a', 'delivery', decision, result).status, 0);
    assert.match(pivot('a', 'b').stderr, /after 1 new plan the lead chose[^]*log that row before this one/, why);
  }
  assert.equal(append('a', 'ship', 'step 1 landed as afaebad', 'recorded: refusal messages now tested').status, 0);
  assert.equal(pivot('a', 'b').status, 0, 'the fixed row in any phase, with a sha of letters');
  assert.equal(append('a', 'delivery', 'landed as 717cb0f964').status, 0);
  assert.equal(pivot('a', 'b', 'warning').status, 0, 'a finding carried into b after the next landing');
  assert.equal(pivot('a', 'e', 'warning').status, 0, 'b started before the landing, so e is the first new plan since');
  assert.equal(pivot('a', 'b', 'warning').status, 0, 'b again after e started: b is still no new plan');
  assert.match(pivot('b', 'c').stderr, /after 1 new plan the lead chose/, 'the plan e that the earlier log started after its landing');
  assert.equal(pivot('b', 'e', 'warning').status, 0, "a finding carried into e, which a's log started");

  assert.equal(pivot('x', 'y').status, 0);
  assert.match(pivot('y', 'z').stderr, /after 1 new plan the lead chose/);
  assert.equal(append('x', 'delivery', 'landed as 0a1b2c3d').status, 0);
  assert.equal(pivot('y', 'z').status, 0, 'a landing in the earlier log after it named this one');
});

test("decisions-check finds the run's last landing by time across its logs", () => {
  const { append, pivot } = pivotRun(['p', 'q', 'r', 'm', 'n']);
  assert.equal(append('p', 'panel', 'seats opus').status, 0);
  assert.equal(pivot('p', 'q').status, 0);
  assert.equal(append('p', 'delivery', 'step 1 landed as 0a1b2c3d').status, 0);
  assert.equal(append('q', 'panel', 'seats opus').status, 0);
  assert.equal(pivot('q', 'r').status, 0);
  assert.equal(append('p', 'delivery', 'step 2 landed as 1a2b3c4d').status, 0);
  assert.equal(append('r', 'panel', 'seats opus').status, 0);
  assert.equal(pivot('r', 's').status, 0, 'a landing in an earlier log after this plan started');

  assert.equal(append('m', 'panel', 'seats opus').status, 0);
  assert.equal(pivot('m', 'n').status, 0);
  assert.equal(append('n', 'panel', 'seats opus').status, 0);
  assert.equal(append('n', 'delivery', 'step 1 landed as 2a3b4c5d').status, 0);
  assert.equal(pivot('m', 'k', 'warning').status, 0, "a landing in the new plan's log");
  assert.match(pivot('n', 'o').stderr, /after 1 new plan the lead chose/, "k, which the old log started after the new plan's landing");
});

test("in a trunk project a worktree's second new plan counts the main checkout's plan logs", () => {
  const { helper, root, run, worktree } = linkedWorktree('trunk');
  const tick = restampInOrder();
  const main = realpathSync(root);
  writeFileSync(join(root, 'docs/plans/artifacts/prior-art.md'), '# Prior art\n');
  writeFileSync(join(root, 'docs/plans/2026-01-01-a.md'), '# a\n');
  writeFileSync(join(worktree, 'docs/plans/2026-01-01-b.md'), '# b\n');
  const log = (name) => `docs/plans/2026-01-01-${name}.decisions.tsv`;
  const pivot = (to, plans = 'docs/plans', severity = 'critical') => ['panel', `${severity} [opus]: The join drops a block`, 'why', 'proof: none', `open: the run pivots; patch: ${plans}/2026-01-01-${to}.md; owner: the owner; stop: its build; prior-art: docs/plans/artifacts/prior-art.md`];
  const seats = ['panel', 'seats opus', 'why', 'proof: none', 'recorded'];
  const inMain = (name, ...cells) => tick(join(root, log(name)), run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'append', log(name), ...cells], root));
  const inWorktree = (name, ...cells) => tick(join(worktree, log(name)), helper('append', log(name), ...cells));
  assert.equal(inMain('a', ...seats).status, 0);
  assert.equal(inMain('a', ...pivot('b', `${main}/docs/plans`)).status, 0, "an absolute path into the main checkout's plans directory");
  assert.equal(existsSync(join(worktree, log('a'))), false);
  assert.equal(inWorktree('b', ...seats).status, 0);
  assert.match(inWorktree('b', ...pivot('c')).stderr, /after 1 new plan the lead chose/, "the main checkout's log, read from the worktree");
  assert.equal(inMain('a', 'delivery', 'landed as 0a1b2c3d', 'why', 'proof: none', 'recorded').status, 0);
  writeFileSync(join(worktree, log('a')), readFileSync(join(root, log('a')), 'utf8'));
  assert.equal(inMain('a', ...pivot('e', 'docs/plans', 'warning')).status, 0);
  assert.match(inWorktree('b', ...pivot('c')).stderr, /after 1 new plan the lead chose/, "the main checkout's newer rows beside the worktree's older copy");
});

test('decisions-check requires scope on a proven row and leaves committed rows alone', () => {
  const { dir, run } = sandbox();
  const header = 'ts\tphase\tdecision\twhy\tevidence\tresult';
  const legacy = '2026-09-01T00:00:00Z\tfix\told\tbecause\tno scope\tfixed it';
  const root = project(dir, 'app', { files: { 'log.decisions.tsv': `${header}\n${legacy}\n` } });
  run('git', ['add', '.'], root);
  run('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'log'], root);
  const check = () => run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'log.decisions.tsv'], root);

  writeFileSync(join(root, 'log.decisions.tsv'), `${header}\n${legacy}\n2026-09-02T00:00:00Z\tfix\tnew\tbecause\tran it\tverified at desktop\n`);
  const missing = check();
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /log\.decisions\.tsv:3: a verified result needs "scope:"/);
  assert.doesNotMatch(missing.stderr, /:2:/);

  writeFileSync(join(root, 'log.decisions.tsv'), `${header}\n${legacy}\n2026-09-02T00:00:00Z\tfix\tnew\tbecause\tscope: desktop\tverified at desktop\n`);
  assert.equal(check().status, 0);
});

test('decisions-check append --from writes every queued row or none', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app');
  const queue = (rows) => {
    writeFileSync(join(root, 'queued.tsv'), rows.map((row) => row.join('\t')).join('\n'));
    return run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'append', 'log.decisions.tsv', '--from', 'queued.tsv'], root);
  };
  const seats = ['panel', 'seats opus, codex:gpt-6.1-sol @xhigh', 'round 1', 'frozen abc1234', 'recorded'];
  const finding = ['panel', 'critical [opus]: The seat writes files', 'seat probe', 'reran the probe', 'applied: read-only flag'];

  const refused = queue([seats, ['panel', 'superseded the earlier finding', 'why', 'evidence', 'superseded']]);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /new row 2/);
  assert.equal(existsSync(join(root, 'log.decisions.tsv')), false, 'a refused batch writes no row');

  const ok = queue([seats, finding]);
  assert.equal(ok.status, 0, ok.stderr);
  const lines = read(root, 'log.decisions.tsv').trim().split('\n');
  assert.deepEqual(lines.slice(1).filter((line) => line.split('\t')[1] !== 'lead').map((line) => line.split('\t')[2]), [seats[1], finding[1]]);
});

test('decisions-check refuses a new row whose evidence cites a run-directory path that does not exist', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', {
    files: {
      'docs/plans/artifacts/run/test-a1.log': '$ (.) node --test\nexit=0\n',
      'docs/plans/artifacts/run/proof result-a1.log': 'exit=0\n',
    },
  });
  const append = (evidence, phase = 'build') => run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'append', 'log.decisions.tsv', phase, 'fix the parser', 'why', evidence, 'verified'], root);

  const missing = append('scope: parser fixtures; docs/plans/artifacts/run/test-a2.log');
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /cites docs\/plans\/artifacts\/run\/test-a2\.log, which does not exist/);
  assert.match(append('scope: parser; `/bin/cat docs/plans/artifacts/run/test-a3.log`').stderr, /test-a3\.log, which does not exist/, 'a command before the cited path');
  for (const [evidence, why] of [
    ['scope: parser; `docs/plans/artifacts/run/test-a1.log:2:5`.', 'a line and column suffix'],
    ['scope: parser; [log](docs/plans/artifacts/run/test-a1.log#L2)', 'a link with a line anchor'],
    ['scope: parser; `docs/plans/artifacts/run/proof result-a1.log`', 'a code span holding a space'],
    [`scope: parser; ${join(root, 'docs/plans/artifacts/run/test-a1.log')}`, 'an absolute path'],
    ['scope: every seat; docs/plans/artifacts/run/seat-*.md, docs/plans/artifacts/run/a1..a8/answer.md and run-[12].log', 'a glob, a range and a bracket'],
    ['scope: parser; docs/plans/artifacts/run/test-a9.log (missing) is what the trail cites', 'a path marked missing'],
    ['scope: parser; `docs/plans/artifacts/run/test-a9.log:12` (missing) is what the trail cites', 'a path with a line marked missing'],
    ['scope: parser; `./docs/plans/artifacts/run/test-a1.log`', 'a path that starts with ./'],
  ]) {
    const accepted = append(evidence);
    assert.equal(accepted.status, 0, `${why}: ${accepted.stderr}`);
  }
  assert.equal(append('scope: the trail; row 4 cites docs/plans/artifacts/run/test-a9.log, which ls cannot find', 'review-trail').status, 0, 'a hand-off reviewer row reports a missing file');
});

test('decisions-check append asks a marking row to name the file it grades, and reads a label only in its own grammar', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', { files: { 'docs/plans/artifacts/run/typecheck-a1.log': '$ (.) tsc\nexit=1\n' } });
  const append = (evidence, result = 'partial: the type check still fails', phase = 'build') =>
    run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'append', 'log.decisions.tsv', phase, 'typecheck plitejs', 'why', evidence, result], root);
  const log = 'docs/plans/artifacts/run/typecheck-a1.log';

  assert.match(append(`ran ${log}`).stderr, /an unlabeled partial row: name the file whose verdict it states/, 'a partial row with a citation but no label');
  assert.match(append(`capacity-proof: ${log}`).stderr, /an unlabeled partial row/, 'a word ending in proof: is no label');
  assert.match(append('runtime proof: real click').stderr, /an unlabeled partial row/, 'proof: before a word that is no path is no label');
  assert.match(append('proof: docs/plans/artifacts/run/gone-a1.log (missing)').stderr, /proof: docs\/plans\/artifacts\/run\/gone-a1\.log names no file/);
  assert.equal(append(`\`proof: ${log}\``).status, 0, 'a label inside a code span');
  assert.equal(append('tracks bug 12; proof: none', 'open: bug 12 waits on upstream').status, 0, 'proof: none for a row that grades no file');
  assert.equal(append('no label', 'partial: the reviewer could not run it', 'review').status, 0, 'a reviewer row needs no label');
  assert.equal(append('no label', 'superseded: rerun in a2').status, 0, 'a superseded row needs no label');
  writeFileSync(join(root, 'old.decisions.tsv'), `ts\tphase\tdecision\twhy\tevidence\tresult\n2026-10-06T10:00:00Z\tbuild\told row\twhy\tno label\tpartial: written before labels\n`);
  assert.equal(run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'old.decisions.tsv'], root).status, 0, 'the whole-log check asks no row for a label');
});

test('decisions-check append takes an accepted row only for a not-passed file and a word the plan Defaults offers', () => {
  const { dir, run } = sandbox();
  const defaults = (words) => `# Plan\n\nStatus: building\n\n## Defaults\n\n| Decision | Pick | Alternative | Word |\n| --- | --- | --- | --- |\n| The type check | Ship with its known failure | Hold the build | ${words} |\n`;
  const root = project(dir, 'app', { files: { 'plan.md': defaults('`hold`, or **ship it**'), 'docs/plans/artifacts/run/typecheck-a1.log': '$ (.) tsc\nexit=1\n' } });
  const log = 'docs/plans/artifacts/run/typecheck-a1.log';
  const append = (evidence, result) => run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'append', 'plan.decisions.tsv', 'build', 'typecheck plitejs', 'why', evidence, result], root);

  assert.match(append(`proof: ${log}; word: hold`, 'accepted: the owner ships it').stderr, /nothing to accept/, 'a file with no not-passed row');
  assert.equal(append(`proof: ${log}`, 'partial: the type check fails on one fixture').status, 0);
  assert.match(append(`proof: ${log}; word: later`, 'accepted: the owner ships it').stderr, /word: later is not an option of a Word cell/);
  assert.match(append(`proof: ${log}`, 'accepted: the owner ships it').stderr, /names the accepting Defaults word/);
  assert.equal(append(`proof: ${log}; word: Ship it.`, 'accepted: the owner ships it').status, 0, 'a bold option after a comma and "or", compared without case or punctuation');
  writeFileSync(join(root, 'plan.md'), `${defaults('hold')}\n\`\`\`\`md\n| Decision | Pick | Alternative | Word |\n| --- | --- | --- | --- |\n| x | y | z | fenced |\n\`\`\`\`\n`);
  assert.match(append(`proof: ${log}; word: fenced`, 'accepted: the owner ships it').stderr, /word: fenced is not an option/, 'a table inside a four-backtick fence');
  writeFileSync(join(root, 'plan.md'), `<!--\n\`\`\`js\n-->\n${defaults('HOLD OR SHIP')}`);
  assert.equal(append(`proof: ${log}; word: ship`, 'accepted: the owner ships it').status, 0, 'a fence inside a comment opens nothing, and an upper-case OR splits options');
});

test('plan-open refuses a newly closed box that cites a not-passed proof until a pass or an accepted row with a live Defaults word', () => {
  const { dir, run } = sandbox();
  const plan = (words, box) => `# Plan\n\nStatus: building\n\n## Defaults\n\n| Decision | Pick | Alternative | Word |\n| --- | --- | --- | --- |\n| The type check | Ship with its known failure | Hold the build | ${words} |\n\n## Steps\n\n${box}\n`;
  const root = project(dir, 'app', { files: { 'plan.md': plan('ship it', '- [ ] type check: `./docs/plans/artifacts/run/typecheck-a1.log`'), 'docs/plans/artifacts/run/typecheck-a1.log': '$ (.) tsc\nexit=1\n' } });
  run('git', ['add', '-A'], root);
  run('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'plan'], root);
  const log = 'docs/plans/artifacts/run/typecheck-a1.log';
  const append = (evidence, result) => run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'append', 'plan.decisions.tsv', 'build', 'typecheck plitejs', 'why', evidence, result], root);
  const check = (words) => {
    writeFileSync(join(root, 'plan.md'), plan(words, '- [x] type check: `./docs/plans/artifacts/run/typecheck-a1.log`'));
    return run(process.execPath, [join(HELPERS, 'plan-open.mjs'), 'plan.md'], root);
  };

  assert.equal(append(`proof: ${join(root, log)}`, 'partial: the type check fails on one fixture').status, 0, 'an absolute label spelling');
  const refused = check('ship it');
  assert.equal(refused.status, 1, 'a box citing a file whose latest labeled verdict is partial');
  assert.match(refused.stderr, /typecheck-a1\.log, whose latest labeled verdict is not passed/);
  assert.equal(append(`proof: ${log}; word: ship it`, 'accepted: the owner ships the known failure').status, 0);
  assert.equal(check('ship it').status, 0, 'the accepted row with a word the Defaults still offer');
  assert.match(check('hold').stderr, /latest labeled verdict is not passed/, 'the owner reversed the Defaults row');
  assert.equal(append(`proof: ${log}; scope: the full type check, read 2026-10-07`, 'verified: the type check passes').status, 0);
  assert.equal(check('hold').status, 0, 'a later labeled pass');
});

function acceptedTypingRun(log) {
  const { dir, run } = sandbox();
  const plan = (box) => `# Plan\n\nStatus: building\n\n## Defaults\n\n| Decision | Pick | Alternative | Word |\n| --- | --- | --- | --- |\n| Typing timings | Hand them to a suggested task | Time them now | time typing now |\n\n## Steps\n\n${box}\n`;
  const root = project(dir, 'app', { files: { 'plan.md': plan('- [ ] 2.6 Time typing'), [log]: '$ (.) probe\nexit=0\n' } });
  run('git', ['add', '-A'], root);
  run('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'plan'], root);
  const append = (evidence, result) => run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'append', 'plan.decisions.tsv', 'verify', 'typing lines', 'why', evidence, result], root);
  assert.equal(append(`proof: ${log}`, 'inconclusive: the host was loaded').status, 0);
  assert.equal(append(`proof: ${log}; word: time typing now`, 'accepted: the typing lines go to a suggested task').status, 0);
  const check = (box) => {
    writeFileSync(join(root, 'plan.md'), plan(box));
    return run(process.execPath, [join(HELPERS, 'plan-open.mjs'), 'plan.md'], root);
  };
  return { append, check };
}

test('plan-open keeps refusing a closed pre-acceptance probe box on a not-passed proof whatever accepted row follows', () => {
  const log = 'docs/plans/artifacts/run/typing-a1.log';
  const { append, check } = acceptedTypingRun(log);
  const refused = check(`- [x] 2.6 Pre-acceptance probe: \`${log}\``);
  assert.equal(refused.status, 1, 'the accepted row does not close a probe a design acceptance waits on');
  assert.match(refused.stderr, /typing-a1\.log, whose latest labeled verdict is not passed, and a pre-acceptance probe stays open/);
  assert.equal(check(`- [x] 2.7 Rerun step 2.6's probe on the final bytes: \`${log}\``).status, 0, 'a final rerun that names no pre-acceptance probe keeps the accepted route');
  assert.doesNotMatch(check(`- [ ] 2.6 Pre-acceptance probe: \`${log}\``).stderr, /stays open until it passes/, 'the reopened box');
  assert.equal(append(`proof: ${log}; scope: typing lines A1 and C on a quiet host, read 2026-10-16`, 'verified: the typing lines pass').status, 0);
  assert.equal(check(`- [x] 2.6 Pre-acceptance probe: \`${log}\``).status, 0, 'a later labeled pass');
});

test('plan-open reads the pre-acceptance mark from prose, not from a cited path', () => {
  const log = 'docs/plans/artifacts/pre-acceptance-run/typing-a1.log';
  const { check } = acceptedTypingRun(log);
  assert.equal(check(`- [x] 2.7 Rerun step 2.6's probe on the final bytes.\n  Closed by: \`${log}\`, ${log}`).status, 0, 'a final rerun citing a path named pre-acceptance');
});

test('plan-open reads the pre-acceptance mark through Markdown emphasis', () => {
  const log = 'docs/plans/artifacts/run/typing-a1.log';
  const { check } = acceptedTypingRun(log);
  assert.match(check(`- [x] 2.6 _Pre-acceptance_ probe: \`${log}\``).stderr, /a pre-acceptance probe stays open/);
});

test('decisions-check records verified runtime identity and an unknown boundary before later work', () => {
  const { dir, env, home } = sandbox();
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': '# Plan\n\nStatus: executed\n', 'q.tsv': 'build\tship it\twhy\tevidence\tdecided\n' } });
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'ps'), '#!/bin/sh\necho "1 /runtime/codex"\n', { mode: 0o755 });
  const runtimeEnv = { ...env, CODEX_HOME: join(home, '.codex'), CODEX_THREAD_ID: 'child', CODEX_SESSION_ID: 'parent', CODEX_TOOL_CALL_ID: 'exec-12345678-1234-1234-1234-123456789abc', CLAUDECODE: '', CLAUDE_SESSION_ID: '', CLAUDE_CODE_SESSION_ID: '', CLAUDE_PID: '', CLAUDE_CODE_ENTRYPOINT: '', PATH: `${bin}:${process.env.PATH}` };
  const rollout = join(runtimeEnv.CODEX_HOME, 'sessions/2026/10/19/rollout-child.jsonl');
  mkdirSync(dirname(rollout), { recursive: true });
  writeFileSync(rollout, [
    { type: 'session_meta', payload: { id: 'child', session_id: 'parent', parent_thread_id: 'parent' } },
    { type: 'turn_context', payload: { model: 'gpt-6.1-sol', effort: 'high' } },
    { type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'wrapper', input: 'await tools.exec_command({cmd: process.env.COMMAND})' } },
  ].map(JSON.stringify).join('\n'));
  const append = (extra = {}) => spawnSync(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'append', 'docs/plans/plan.decisions.tsv', '--from', 'q.tsv'], { cwd: root, encoding: 'utf8', env: { ...runtimeEnv, ...extra } });
  const leads = () => read(root, 'docs/plans/plan.decisions.tsv').split('\n').filter((line) => line.split('\t')[1] === 'lead').map((line) => line.split('\t')[2]);
  const first = append();
  assert.equal(first.status, 0, first.stderr);
  assert.equal(append().status, 0);
  assert.deepEqual(leads(), ['gpt-6.1-sol @high']);
  const unknown = append({ CODEX_TOOL_CALL_ID: '' });
  assert.equal(unknown.status, 0, unknown.stderr);
  assert.match(unknown.stderr, /unknown lead boundary/);
  assert.deepEqual(leads(), ['gpt-6.1-sol @high', 'unknown']);
  assert.match(read(root, 'docs/plans/plan.decisions.tsv'), /\tlead\tunknown\truntime identity could not be verified because CODEX_TOOL_CALL_ID holds no exec call id\t/, 'the unknown lead row names its miss');
  assert.equal(append({ CODEX_TOOL_CALL_ID: '' }).status, 0);
  assert.deepEqual(leads(), ['gpt-6.1-sol @high', 'unknown']);
  assert.equal(append().status, 0);
  assert.deepEqual(leads(), ['gpt-6.1-sol @high', 'unknown', 'gpt-6.1-sol @high']);
  const check = spawnSync(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'docs/plans/plan.decisions.tsv'], { cwd: root, encoding: 'utf8', env });
  assert.equal(check.status, 0, check.stderr);
  const levels = spawnSync(process.execPath, [join(HELPERS, 'levels.mjs'), '--seats', 'gpt-6-astra @high', 'docs/plans/plan.decisions.tsv'], { cwd: root, encoding: 'utf8', env: runtimeEnv });
  assert.equal(levels.status, 0, levels.stderr);
  assert.match(levels.stdout, /at lines 3-4: lead gpt-6.1-sol @high/);
  assert.match(levels.stdout, /below lines 6-7: lead unknown/);
  assert.match(levels.stdout, /at line 9: lead gpt-6.1-sol @high/);
  const page = spawnSync(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], { cwd: root, encoding: 'utf8', env });
  assert.equal(page.status, 0, page.stderr);
  const html = read(root, 'docs/plans/artifacts/plan.html');
  const header = html.slice(html.indexOf('<header'), html.indexOf('</header>')).replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ');
  assert.match(header, /Lead gpt-6.1-sol high Lead unknown/);
});

test('unknown identity never attributes foreign readers and remains unknown in levels and the page', () => {
  const { dir, env, home } = sandbox();
  const plan = '# Plan\n\nStatus: executed\n\n## Main changes\n\n- Check attribution.\n';
  const log = LOG_HEAD + logRow('lead', 'claude-opus-5-5 @medium') + logRow('build', 'known work');
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan, 'docs/plans/plan.decisions.tsv': log, 'q.tsv': 'build\tunknown work\twhy\tevidence\trecorded\npanel\tseats gpt-6-astra @high\twhy\tevidence\trecorded\n' } });
  const foreign = join(home, '.claude/projects/-app/foreign.jsonl');
  mkdirSync(dirname(foreign), { recursive: true });
  writeFileSync(foreign, JSON.stringify({ type: 'assistant', effort: 'medium', message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: 'foreign', name: 'Bash', input: { command: 'cat plan.decisions.tsv' } }] } }));
  const unknownEnv = { ...env, CODEX_HOME: join(home, '.codex'), CODEX_THREAD_ID: '', CODEX_SESSION_ID: '', CODEX_TOOL_CALL_ID: '', CLAUDE_CODE_SESSION_ID: '' };
  const append = spawnSync(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'append', 'docs/plans/plan.decisions.tsv', '--from', 'q.tsv'], { cwd: root, encoding: 'utf8', env: unknownEnv });
  assert.equal(append.status, 0, append.stderr);
  assert.match(read(root, 'docs/plans/plan.decisions.tsv'), /\tlead\tunknown\t/);
  const levels = spawnSync(process.execPath, [join(HELPERS, 'levels.mjs'), '--lead', 'claude-opus-5-5 @medium', '--seats', 'gpt-6-astra @high', 'docs/plans/plan.decisions.tsv'], { cwd: root, encoding: 'utf8', env: unknownEnv });
  assert.equal(levels.status, 0, levels.stderr);
  assert.match(levels.stdout, /below lines 5-6: lead unknown \(no verified lead names its level\)/);
  const page = spawnSync(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], { cwd: root, encoding: 'utf8', env: unknownEnv });
  assert.equal(page.status, 0, page.stderr);
  const html = read(root, 'docs/plans/artifacts/plan.html');
  const header = html.slice(html.indexOf('<header'), html.indexOf('</header>')).replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ');
  assert.match(header, /Lead claude-opus-5-5 medium Lead unknown Reviews gpt-6-astra high/);
});

test('decisions-check append names the stage a batch moves the log into', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app');
  const append = (phase, decision, result = 'recorded') => run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'append', 'log.decisions.tsv', phase, decision, 'why', 'evidence', result], root);
  assert.match(append('architect', 'three runners').stdout, /Stage: Design\. Rename the session/);
  assert.doesNotMatch(append('architect', 'picked the base').stdout, /Stage:/, 'a row in the same stage');
  assert.match(append('build', 'built: the helper').stdout, /Stage: Build\./);
  assert.match(append('panel', 'seats opus').stdout, /Stage: Code review\./, 'a panel round after a build reviews the code');
  assert.doesNotMatch(append('writing', 'deslop on the round 1 fixes').stdout, /Stage:/, "a review round's writing pass stays under that review's stage");
  assert.doesNotMatch(append('panel', 'seats opus').stdout, /Stage:/, 'the next round stays in Code review');
  assert.match(append('verify', 'Prove the helper').stdout, /Stage: Verify\./);
});

test('decisions-check append counts a bug fix row as the build a panel round reviews', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app');
  const append = (phase, decision) => run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'append', 'log.decisions.tsv', phase, decision, 'why', 'evidence', 'recorded'], root);
  append('repro', 'Reproduce the report');
  assert.match(append('fix', 'Merge the ranges').stdout, /Stage: Build\./);
  assert.match(append('panel', 'seats opus').stdout, /Stage: Code review\./, 'a panel round after a fix row reviews the code');
});

test('decisions-check append names the stage when a batch leaves the stage and comes back to it', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app');
  const append = (...args) => run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'append', 'log.decisions.tsv', ...args], root);
  assert.match(append('verify', 'Prove the helper', 'why', 'evidence', 'recorded').stdout, /Stage: Verify\./);
  writeFileSync(join(root, 'queue.tsv'), 'build\tbuilt: the fix\twhy\tevidence\trecorded\nverify\tProve the fix\twhy\tevidence\trecorded\n');
  assert.match(append('--from', 'queue.tsv').stdout, /Stage: Build, then Verify\./, 'a batch that builds and verifies again names both stages');
});

test('decisions-check append names Audit when a hand-off reviewer row follows', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app');
  const append = (phase, decision) => run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'append', 'log.decisions.tsv', phase, decision, 'why', 'evidence', 'recorded'], root);
  assert.match(append('verify', 'Prove the helper').stdout, /Stage: Verify\./);
  assert.match(append('review-trail', 'Check the trail').stdout, /Stage: Audit\./, 'the rail counts review phases as Audit');
});

test("decisions-check append warns once when a babysit plan's first review or ship row lands before its page", () => {
  const { dir, run } = sandbox();
  const plan = (fields) => `# Babysit\n\nStatus: building\n${fields}\n## Steps\n\n- [ ] Repair it.\n`;
  const root = project(dir, 'app', {
    files: { 'docs/plans/b.md': plan('Playbook: babysit\n'), 'docs/plans/p.md': plan('Page: https://claude.ai/artifact/x\nPlaybook: babysit\n'), 'docs/plans/f.md': plan('Playbook: feature\n') },
  });
  const append = (slug, phase) => {
    const result = run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'append', `docs/plans/${slug}.decisions.tsv`, phase, 'a decision', 'why', 'evidence', 'recorded'], root);
    assert.equal(result.status, 0, result.stderr);
    return /has no Page: line/.test(result.stderr);
  };
  assert.equal(append('b', 'build'), false, 'a build row is not yet a public action');
  assert.ok(append('b', 'review'), "the first review row of an unpublished babysit plan warns, under babysit's own review phase");
  assert.equal(append('b', 'delivery'), false, 'only the first review or ship row warns');
  for (const slug of ['p', 'f']) assert.equal(append(slug, 'deliver'), false, `${slug}.md has a page or is not a babysit plan`);
});
