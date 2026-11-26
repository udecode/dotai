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

test('a chip ranks by its own review scope and regression pages, and the card pass offers in that order', () => {
  const { batch, chip, chips, merge, root } = triagedLedger({ 'scopes/ghost.json/.keep': '' });
  merge('break the page break');
  const head = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  const written = batch([
    ['t_7a019000 Fix f', 'offered', 'writes: f.md; topic: f; priority: P0; repro: type then reload; review-scope: pagination'],
    ['t_7a037000 Fix r', 'offered', `writes: r.md; topic: r; priority: P0; review-scope: pagination; regressed: ${head}`],
    ['t_7a02d000 Fix n', 'offered', 'writes: n.md; topic: n; priority: P1; repro: steps; review-scope: none'],
    ['t_7a010000 Fix d', 'offered', 'writes: d.md; topic: d; priority: P1; repro: steps; review-scope: editor; regression: https://example.org/tool'],
    ['t_7a014000 Fix e', 'offered', 'writes: e.md; topic: e; priority: P1; repro: steps; review-scope: editor'],
    ['t_7a023000 Fix k', 'offered', 'writes: k.md; topic: k; priority: P1; repro: steps; review-scope: editor; regression: https://platejs.org/docs/a'],
    ['t_7a033000 Fix p', 'offered', 'writes: p.md; topic: p; priority: P1; repro: Type regression: stale into the box and reload; review-scope: editor'],
  ]);
  assert.equal(written.status, 0, written.stderr);
  const board = chips().stdout;
  assert.match(board, /Ready, P0 \(2\)\n {2}t_7a019000 {2}Fix f {2}\[f\] {2}experimental [^\n]*\n {2}t_7a037000 {2}Fix r {2}\[r\] {2}experimental /, 'regressed: names a commit, not a page where the behavior works');
  assert.match(board, /t_7a033000 {2}Fix p {2}\[p\] {2}new /, 'regression: inside the repro is part of the repro');
  assert.match(board, /Do, card pass \(7\)\n {2}card t_7a019000:[^\n]*\n {2}card t_7a037000:[^\n]*\n {2}card t_7a010000:[^\n]*\n {2}card t_7a023000:[^\n]*\n {2}card t_7a02d000:/, 'the card pass offers by milestone class within a priority');
  assert.equal(chip('t_7a023000 Fix k', 'updated', 'regression:').status, 0);
  assert.match(chips().stdout, /t_7a023000 {2}Fix k {2}\[k\] {2}new /, 'an empty regression: clears the pages when the record drops them');
  const refused = batch([
    ['t_7a042000 Fix u', 'offered', 'writes: u.md; topic: u; priority: P1; repro: steps; review-scope: editor; regression: https://:'],
    ['t_7a043000 Fix v', 'offered', 'writes: v.md; topic: v; priority: P1; repro: steps; review-scope: ghost'],
  ]);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /"https:\/\/:" is not a URL/);
  assert.match(refused.stderr, /review-scope: ghost is no review scope in scopes/, 'a folder named like a scope file is no scope');
  const plain = chipLedger().batch([['t_7a033000 Fix p', 'offered', 'writes: p.md; topic: p; priority: P1; repro: Type regression: stale into the box and reload']]);
  assert.equal(plain.status, 0, plain.stderr);
});

test('chips.tiers ranks each priority by the checks a task owns, the paths it writes and its scope, with base-red work first above the catch-all tier', () => {
  const tiers = [{ name: 'core', paths: ['src/core/'], except: ['src/core/extra/'] }, { name: 'feature' }, { name: 'late', scopes: ['late'], checks: ['e2e:ai-'] }];
  const { batch, chips, chip } = chipLedger({ config: { triage: { experimental: ['late'] }, chips: { scopes: 'scopes', tiers } }, files: { 'scopes/editor.json': '{}', 'scopes/late.json': '{}' } });
  const written = batch([
    ['t_7a04f000 Fix z', 'offered', 'writes: src/late/d.ts; topic: z; priority: P0; repro: steps; review-scope: late'],
    ['t_7a025000 Fix l', 'offered', 'writes: src/late/a.ts; topic: l; priority: P1; repro: steps; review-scope: late'],
    ['t_7a019000 Fix f', 'offered', 'writes: src/ui/a.ts; topic: f; priority: P1; repro: steps; review-scope: editor'],
    ['t_7a00d000 Fix c', 'offered', 'writes: src/late/b.ts, src/core/x.ts; topic: c; priority: P1; repro: steps; review-scope: late'],
    ['t_7a045000 Fix x', 'offered', 'writes: src/core/extra/y.ts; topic: x; priority: P1; repro: steps; review-scope: editor'],
    ['t_7a037000 Fix r', 'offered', 'writes: src/late/c.ts; topic: r; priority: P1; repro: steps; review-scope: late; owns: e2e:late'],
    ['t_7a01f000 Fix g', 'offered', 'writes: src/ui/g.ts; topic: g; priority: P1; repro: steps; review-scope: editor; owns: e2e:ui'],
    ['t_7a004000 Fix a', 'offered', 'writes: src/ui/h.ts; topic: a; priority: P1; repro: steps; review-scope: editor; owns: e2e:ai-chat'],
    ['t_7a027000 Fix m', 'offered', 'writes: src/ui/m.ts; topic: m; priority: P1; repro: steps; review-scope: editor; owns: e2e:ai-x, e2e:ui-y'],
  ]);
  assert.equal(written.status, 0, written.stderr);
  const board = chips().stdout;
  assert.match(board, /Ready, P0 \(2\)\n {2}t_7a01f000 {2}Fix g {2}\[g\] {2}regression {2}owns e2e:ui {2}no card\n {2}t_7a027000 {2}Fix m {2}\[m\] {2}regression {2}owns e2e:ai-x, e2e:ui-y {2}no card\n\n/, 'a red check above the catch-all tier makes a P0 that ranks first, and checks place a task only when they hold every check it owns');
  assert.match(board, /Ready, P1 \(7\)\n {2}t_7a00d000 {2}Fix c {2}\[c\] {2}core {2}no card\n {2}t_7a019000 {2}Fix f {2}\[f\] {2}feature {2}no card\n {2}t_7a045000 {2}Fix x {2}\[x\] {2}feature {2}no card\n {2}t_7a04f000 {2}Fix z {2}\[z\] {2}late {2}no card\n {2}t_7a025000 {2}Fix l {2}\[l\] {2}late {2}no card\n {2}t_7a037000 {2}Fix r {2}\[r\] {2}late {2}owns e2e:late {2}no card\n {2}t_7a004000 {2}Fix a {2}\[a\] {2}late {2}owns e2e:ai-chat {2}no card\n/, 'a core write beats its scope, an excepted path falls to the catch-all tier, and a tier after the catch-all ranks no task above P1, red check or P0 token included');
  assert.equal(chip('t_7a00d000 Fix c', 'updated', 'writes: src/late/b.ts').status, 0);
  assert.match(chips('brief', 't_7a00d000').stdout, /Tier: late, rank 3 of chips.tiers within its priority\./, 'dropping the core write moves the task to its scope tier');
  const loose = chipLedger({ config: { chips: { scopes: 'scopes', tiers: [{ name: 'a' }, { name: 'b' }] } }, files: { 'scopes/editor.json': '{}' } });
  assert.equal(loose.batch([['t_7a004000 Fix a', 'offered', 'writes: a.md; topic: a; priority: P2; via: verdict; review-scope: editor']]).status, 0);
  assert.match(loose.chips().stdout, /fix chips\.tiers in \.agents\/pstack\.json: a and b name no paths, scopes or checks/);
});

test('a reopened duplicate leaves the kept task its own milestone class, whatever proof the merge copied', () => {
  const { batch, chip, chips, merge, root } = triagedLedger();
  merge('break page breaks');
  const head = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  const written = batch([
    ['t_7a024000 Fix pagination', 'offered', 'writes: a.md; topic: shared; priority: P0; repro: steps; review-scope: pagination'],
    ['t_7a013000 Fix page breaks', 'offered', `writes: b.md; topic: shared; priority: P0; review-scope: pagination; regressed: ${head}`],
    ['t_7a034000 Fix another bug', 'offered', 'writes: c.md; topic: shared; priority: P0; repro: steps; review-scope: editor'],
    ['t_7a013000 Fix page breaks', 'dismissed dup t_7a024000', 'evidence'],
    ['t_7a013000 Fix page breaks', 'reopened', 'the owner says these are separate fixes'],
    ['t_7a013000 Fix page breaks', 'apart', 'from: t_7a024000'],
  ]);
  assert.equal(written.status, 0, written.stderr);
  assert.match(chips('brief', 't_7a024000').stdout, /^Review scope: pagination\. Milestone: experimental\.$/mu);
  assert.match(chips().stdout, /Do, card pass \(3\)\n {2}card t_7a034000:/, 'the new task cards before the experimental ones');
});

test('reopening the middle of a duplicate chain gives it back its own milestone class', () => {
  const { batch, chips } = triagedLedger();
  const written = batch([
    ['t_7a026000 Fix typing', 'offered', 'writes: a.md; topic: shared; priority: P1; repro: steps; review-scope: editor; regression: https://www.slatejs.org/examples/richtext'],
    ['t_7a02b000 Fix editor', 'offered', 'writes: b.md; topic: shared; priority: P1; repro: steps; review-scope: editor'],
    ['t_7a041000 Fix pagination', 'offered', 'writes: c.md; topic: shared; priority: P1; repro: steps; review-scope: pagination'],
    ['t_7a026000 Fix typing', 'dismissed dup t_7a02b000', 'evidence'],
    ['t_7a02b000 Fix editor', 'dismissed dup t_7a041000', 'evidence'],
    ['t_7a026000 Fix typing', 'reopened', 'separate work'],
    ['t_7a02b000 Fix editor', 'reopened', 'separate work'],
  ]);
  assert.equal(written.status, 0, written.stderr);
  const mid = chips('brief', 't_7a02b000').stdout;
  assert.match(mid, /^Review scope: editor\. Milestone: new\.$/mu);
  assert.doesNotMatch(mid, /^Regression:/mu);
  assert.match(chips().stdout, /Do, card pass \(3\)\n {2}card t_7a026000:[^\n]*\n {2}card t_7a02b000:[^\n]*\n {2}card t_7a041000:/);
});

test('a folded row changes no review scope or regression page', () => {
  const { batch, chip, chips } = triagedLedger();
  assert.equal(batch([
    ['t_7a024000 Fix pagination', 'offered', 'writes: a.md; topic: shared; priority: P1; repro: steps; review-scope: none'],
    ['t_7a034000 Fix another bug', 'offered', 'writes: b.md; topic: shared; priority: P1; repro: steps; review-scope: editor'],
  ]).status, 0);
  const folded = chip('t_7a024000 Fix pagination', 'folded', 'review-scope: pagination');
  assert.equal(folded.status, 1, 'a fold that names a review scope');
  assert.equal(chip('t_7a024000 Fix pagination', 'folded', 'regression: https://www.slatejs.org/examples/b').status, 1, 'a fold that names regression pages');
  assert.match(chips().stdout, /Do, card pass \(2\)\n {2}card t_7a024000:[^\n]*\n {2}card t_7a034000:/);
});

test('a started task takes the review scope and regression pages a new triage record gives', () => {
  const { batch, chip, chips } = triagedLedger();
  assert.equal(batch([
    ['t_7a024000 Fix the void Backspace', 'offered', 'writes: a.md; topic: void; priority: P1; repro: plate-private#109 holds the steps; review-scope: native'],
    ['t_7a024000 Fix the void Backspace', 'started', 'session: s1'],
  ]).status, 0);
  const updated = chip('t_7a024000 Fix the void Backspace', 'updated', 'review-scope: native; regression: https://www.slatejs.org/examples/editable-voids');
  assert.equal(updated.status, 0, updated.stderr);
  assert.match(chips('brief', 't_7a024000').stdout, /^Review scope: native\. Milestone: regression\.\nRegression: it still works on https:\/\/www\.slatejs\.org\/examples\/editable-voids$/mu);
  assert.match(chip('t_7a024000 Fix the void Backspace', 'updated', 'topic: other').stderr, /takes only owns:, review-scope: and regression:/);
});

test('an update that clears a kept task\'s regression pages clears them for the duplicates it covers', () => {
  const { batch, chip, chips } = triagedLedger();
  assert.equal(batch([
    ['t_7a024000 Fix editor', 'offered', 'writes: a.md; topic: shared; priority: P1; repro: steps; review-scope: editor'],
    ['t_7a013000 Fix typing', 'offered', 'writes: b.md; topic: shared; priority: P1; repro: steps; review-scope: editor; regression: https://www.slatejs.org/examples/richtext'],
    ['t_7a013000 Fix typing', 'dismissed dup t_7a024000', 'evidence'],
  ]).status, 0);
  assert.equal(chip('t_7a024000 Fix editor', 'updated', 'review-scope: editor; regression:').status, 0);
  const kept = chips('brief', 't_7a024000').stdout;
  assert.match(kept, /^Review scope: editor\. Milestone: new\.$/mu);
  assert.doesNotMatch(kept, /^Regression:/mu);
  assert.match(kept, /^Also covers:\n- t_7a013000 Fix typing/mu);
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
  assert.equal(append('t_7a004000 Fix a', 'writes: a.md; topic: shared; priority: P1; repro: Type session: stale into the box and reload', 'offered').status, 0);
  assert.equal(append('t_7a009000 Fix b', 'writes: b.md; topic: shared; priority: P1; session: x; repro: Type transcript: stale into the box and reload', 'offered').status, 0);
  const updated = append('t_7a004000 Fix a', 'repro: Type session: fresh into the box and reload', 'updated');
  assert.equal(updated.status, 0, updated.stderr);
  const rows = read(root, LEDGER).split('\n');
  assert.doesNotMatch(rows.find((row) => row.includes('t_7a004000') && row.endsWith('\toffered')), /transcript:/, 'no owner, so no transcript');
  assert.match(rows.find((row) => row.includes('t_7a009000')), /; transcript: rollout-child\t/, 'the real owner gets its transcript');
  assert.equal(append('t_7a009000 Fix b', 'session: none', 'updated').status, 0);
  assert.doesNotMatch(read(root, LEDGER).split('\n').find((row) => row.includes('t_7a009000') && row.endsWith('\tupdated')), /transcript:/, 'giving a task back names no owner, so no transcript');
});

test('a token after prose inside a field still reads as it did before the repro rule', () => {
  const { batch, chips } = chipLedger();
  const written = batch([
    ['t_7a01e000 Fix typing', 'offered', 'writes: a.md; topic: typing; triage result priority: P1; repro: steps'],
    ['t_7a03d000 Fix focus', 'offered', 'writes: b.md; topic: shared; priority: P1; repro: steps'],
  ]);
  assert.equal(written.status, 0, written.stderr);
  assert.match(chips().stdout, /Ready, P1 \(2\)\n {2}t_7a01e000 [^\n]*\n {2}t_7a03d000 /);
});
test('a brief says whether the board has its task Ready, Waiting or Started, whatever its priority', () => {
  const { batch, chip, chips } = chipLedger();
  const written = batch([
    ['t_7a033000 Fix p', 'offered', 'writes: p.md; topic: p; priority: P2; via: verdict'],
    ['t_7a044000 Fix w', 'offered', 'writes: w.md; topic: w; priority: P3; via: verdict; waits: task:t_7a033000'],
  ]);
  assert.equal(written.status, 0, written.stderr);
  assert.doesNotMatch(chips().stdout, /t_7a033000 {2}Fix p/, 'the board shows a P2 task only as a count');
  const ready = chips('brief', 't_7a033000').stdout;
  assert.match(ready, /^State: Ready\.$/mu);
  assert.match(ready, /When the State: line that chips brief prints says neither Ready nor Started, tell the owner what it says and stop\./);
  assert.match(ready, /each field in "<tokens>" ended by ";" before the next, such as "writes: a\.ts, b\.ts; session: <id>"/);
  assert.match(chips('brief', 't_7a044000').stdout, /^State: Waiting on task:t_7a033000 [^\n]*\.$/mu);
  assert.equal(chip('t_7a033000 Fix p', 'started', 'session: s1').status, 0);
  assert.match(chips('brief', 't_7a033000').stdout, /^State: Started\.$/mu);
  const outside = batch([
    ['t_7a02f000 Fix the other repo', 'offered', 'writes: /elsewhere/repo/x.md; topic: o1; priority: P2; via: verdict'],
    ['t_7a030000 Tune the other repo', 'offered', 'writes: /elsewhere/repo/x.md; topic: o2; priority: P2; via: verdict'],
  ]);
  assert.equal(outside.status, 0, outside.stderr);
  assert.match(chips('brief', 't_7a02f000').stdout, /^State: Ready\.$/mu);
  assert.match(chips('brief', 't_7a030000').stdout, /^State: Waiting on queued behind t_7a02f000, which writes the same paths outside this checkout\.$/mu, 'a task writing outside the checkout queues behind an earlier ready task on the same path');
});

test('chips ranks a task with the most urgent open task that waits on it', () => {
  const { batch, chip, chips } = chipLedger();
  const written = batch([
    ['t_7a004000 Fix the lost save', 'offered', 'writes: a.md; topic: save; priority: P0; repro: type then reload loses the text; waits: task:t_7a009000'],
    ['t_7a009000 Tune the index', 'offered', 'writes: b.md; topic: index; priority: P2; via: verdict; waits: task:t_7a00d000'],
    ['t_7a00d000 Measure the index', 'offered', 'writes: c.md; topic: measure; priority: P3; via: verdict'],
    ['t_7a010000 Fix the cursor', 'offered', 'writes: d.md; topic: cursor; priority: P1; repro: click past the end; waits: task:t_7a014000'],
    ['t_7a014000 Probe the cursor', 'offered', 'writes: e.md; topic: probe; priority: P3; via: verdict'],
    ['t_7a019000 Tidy the toolbar', 'offered', 'writes: f.md; topic: toolbar; priority: P2; via: verdict; waits: task:t_7a01f000'],
    ['t_7a01f000 Fix the toolbar focus', 'offered', 'writes: g.md; topic: focus; priority: P1; repro: tab past the last button'],
  ]);
  assert.equal(written.status, 0, written.stderr);
  const board = chips().stdout;
  assert.match(board, /Ready, P0 \(1\)\n {2}t_7a00d000 {2}Measure the index {2}\[measure\] {2}blocks t_7a009000 {2}no card\n/, 'a P3 task under a P2 that a P0 waits on ranks P0');
  assert.match(board, /Ready, P1 \(2\)\n {2}t_7a014000 {2}Probe the cursor {2}\[probe\] {2}blocks t_7a010000 {2}no card\n {2}t_7a01f000 {2}Fix the toolbar focus {2}\[focus\] {2}no card\n/, 'a less urgent waiter lowers nothing');
  assert.match(board, /Waiting, P0 \(2\)\n {2}t_7a004000 [^\n]*\n {2}t_7a009000 {2}Tune the index {2}\[index\] {2}blocks t_7a004000 {2}waits on task:t_7a00d000 offered\n/);
  assert.match(chips('brief', 't_7a00d000').stdout, /^\[P0\] Measure the index\n\nTopic: measure\. Kind: fix\. Effort: high\. Priority: P0, from t_7a009000, which waits on it; its own is P3\.\n/);
  assert.match(chips('stale').stdout, /t_7a00d000 [^\n]*priority P0 \(own P3, from t_7a009000\);/);
  assert.equal(chip('t_7a004000 Fix the lost save', 'dismissed done').status, 0);
  assert.match(chips('brief', 't_7a00d000').stdout, /^\[P2\] [^\n]*\n\n[^\n]*Priority: P2, from t_7a009000, which waits on it; its own is P3\./, 'the lift follows the waiters still open');
});

test('chips raises a task through waits logged after it, never from a started task, and shows its own priority once nothing more urgent waits', () => {
  const { batch, chip, chips } = chipLedger();
  const written = batch([
    ['t_7a027000 Measure the index', 'offered', 'writes: m.md; topic: measure; priority: P3; via: verdict'],
    ['t_7a02d000 Tune the index', 'offered', 'writes: n.md; topic: index; priority: P2; via: verdict; waits: task:t_7a027000'],
    ['t_7a02f000 Fix the lost save', 'offered', 'writes: o.md; topic: save; priority: P0; repro: type then reload loses the text; waits: task:t_7a02d000'],
  ]);
  assert.equal(written.status, 0, written.stderr);
  assert.match(chips('brief', 't_7a027000').stdout, /^\[P0\] [^\n]*\n\n[^\n]*Priority: P0, from t_7a02d000, which waits on it; its own is P3\./, 'the raise climbs a chain whose waiters come later in the ledger');
  const started = chip('t_7a02f000 Fix the lost save', 'started', 'session: s9');
  assert.equal(started.status, 0, started.stderr);
  assert.match(chips('brief', 't_7a027000').stdout, /^\[P2\] [^\n]*\n\n[^\n]*Priority: P2, from t_7a02d000, which waits on it; its own is P3\./, "a started task's waits no longer count");
  assert.equal(chip('t_7a02d000 Tune the index', 'dismissed declined').status, 0);
  assert.match(chips('brief', 't_7a027000').stdout, /^\[P3\] Measure the index\n\nTopic: measure\. Kind: fix\. Effort: high\. Priority: P3\.\n/);
  assert.match(chips('stale').stdout, /t_7a027000 [^\n]*priority P3;/);
  assert.doesNotMatch(chips('stale').stdout, /t_7a027000 [^\n]*own/);
});

test("a card stays when its task's priority changes, because its session prints the current brief", () => {
  const { chip, chips, offer } = chipLedger();
  assert.equal(offer('t_7a010000 Tune the index', 'd.md', 'topic: index; priority: P2; via: verdict; card: c1; session: s1').status, 0);
  assert.equal(chip('t_7a044000 Fix the lost save', 'offered', 'writes: w.md; topic: save; priority: P0; repro: type then reload loses the text; waits: task:t_7a010000').status, 0);
  assert.match(chips('brief', 't_7a010000').stdout, /^\[P0\] Tune the index\n/, 'the brief shows the raised priority');
  assert.doesNotMatch(chips('--session', 's1').stdout, /withdraw t_7a010000/, 'a raised priority withdraws no card');
});

test('a task that only a waiting task raises gets a prioritize item before any card', () => {
  const { chip, chips, offer, root, LEDGER } = chipLedger();
  assert.equal(offer('t_7a004000 Fix a', 'src/a.ts', 'topic: one').status, 0);
  writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + ['2026-01-01T10:00:00Z', 'chip', 't_7a02f000 Fix the old docs', 'why', 'writes: docs/o.md', 'offered'].join('\t') + '\n');
  assert.equal(chip('t_7a02f000 Fix the old docs', 'updated', 'topic: docs; waits: none').status, 0);
  assert.equal(chip('t_7a044000 Fix the lost save', 'offered', 'writes: w.md; topic: save; priority: P0; repro: type then reload loses the text; waits: task:t_7a02f000').status, 0);
  assert.match(chips().stdout, /Do, ledger pass \(1\)\n {2}prioritize t_7a02f000:/, 'a raise is no priority of its own');
  assert.match(chips('brief', 't_7a02f000').stdout, /Priority: P0, from t_7a044000, which waits on it; its own is none yet\./);
  assert.equal(chip('t_7a02f000 Fix the old docs', 'updated', 'priority: P3').status, 0);
  assert.match(chips().stdout, /Do, card pass[\s\S]*card t_7a02f000:/);
});

test('chips offers each open item of the ship list as a P1 task with the waits the item names', () => {
  const { chips, offer, root } = chipLedger();
  assert.equal(offer('t_7a00d000 Fix the cursor', 'c.md', 'topic: cursor; priority: P1; repro: click past the end').status, 0);
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
  assert.equal(offer('t_7a03a000 Settle review item r1 (xhigh)', 'docs/plans', 'topic: review-r1; kind: decide; priority: P1; ship: r1').status, 0);
  const closed = offer('t_7a03c000 Settle review item r9 (xhigh)', 'docs/plans', 'topic: review-r9; kind: decide; priority: P1; ship: r9');
  assert.match(closed.stderr, /ship: r9 is not an open item of the project's ship list/);
  items([{ id: 'r2', title: 'Settle review item r2 (xhigh)', writes: ['docs/plans'] }]);
  assert.match(chips('stale').stdout, /t_7a03a000 [^\n]*priority P1; ship item r1 is no longer open/);
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
  assert.equal(offer('t_7a004000 Fix the parser', 'src/a.ts', 'topic: a; session: s2').status, 0);
  assert.match(chips('--session', 's1').stdout, /offer ship item r1[^\n]*"writes: docs\/plans; topic: review-r1; kind: fix; priority: P1; ship: r1" offered/, 'a ship offer names no session');
  assert.equal(offer('t_7a03a000 Settle review item r1', 'docs/plans', 'topic: review-r1; priority: P1; ship: r1; session: s2').status, 0);
  assert.equal(offer('t_7a03b000 Settle review item r2', 'docs/plans', 'topic: review-r2; priority: P1; ship: r2').status, 0);
  const own = chips('--session', 's1').stdout;
  assert.doesNotMatch(own, /card t_7a039000/, 'a plain board cards no ship task');
  assert.doesNotMatch(chips().stdout, /card t_7a039000/, 'a board read with no session id cards no ship task');
  assert.match(own, /Other owners \(2\)\n {2}session s2 {2}1 open: t_7a004000\n {2}no owner {2}2 open: t_7a03a000, t_7a03b000\n/, 'a ship task shows as one no session owns');
  assert.match(chips('all', '--session', 's1').stdout, /Do, card pass \(2\)\n {2}card t_7a03a000:[^\n]*\n {2}card t_7a03b000:/, 'chips all cards a ship task, even one an older offer gave to s2');
  assert.equal(chip('t_7a03a000 Settle review item r1', 'carded', 'card: c1; session: s1').status, 0);
  assert.equal(chip('t_7a03a000 Settle review item r1', 'uncarded', 'card: c1').status, 0);
  assert.equal(chip('t_7a03a000 Settle review item r1', 'updated', 'session: s1').status, 0);
  assert.equal(chip('t_7a03a000 Settle review item r1', 'carded', 'card: c2; session: s3').status, 0, 'neither carding nor an updated session: makes a ship task one session\'s');
  assert.equal(chip('t_7a004000 Fix the parser', 'carded', 'card: c3; session: s1').status, 1, 'a task off the ship list keeps its owner');
});

test('chips stale lists each open task with the paths it writes that were deleted since its offer or are missing, and the commits on its paths since its offer', () => {
  const { chip, chips, offer, root } = chipLedger();
  writeFileSync(join(root, 'kept.md'), 'old\n');
  writeFileSync(join(root, 'gone.md'), 'old\n');
  spawnSync('git', ['-C', root, 'add', 'kept.md', 'gone.md']);
  const earlier = new Date(Date.now() - 86_400_000).toISOString();
  spawnSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'add kept'], { env: { ...process.env, GIT_AUTHOR_DATE: earlier, GIT_COMMITTER_DATE: earlier } });
  assert.equal(offer('t_7a004000 Fix a', 'kept.md, gone.md, new.md', 'topic: stale').status, 0);
  assert.equal(offer('t_7a009000 Fix b', 'docs/plans', 'topic: fresh; card: c1; session: s1').status, 0);
  assert.equal(offer('t_7a00d000 Fix c', 'src/c.ts', 'topic: closed').status, 0);
  assert.equal(chip('t_7a00d000 Fix c', 'dismissed done').status, 0);
  writeFileSync(join(root, 'kept.md'), 'new\n');
  spawnSync('git', ['-C', root, 'rm', '-q', 'gone.md']);
  const later = new Date(Date.now() + 86_400_000).toISOString();
  spawnSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qam', 'fix kept'], { env: { ...process.env, GIT_AUTHOR_DATE: later, GIT_COMMITTER_DATE: later } });
  const stale = chips('stale');
  assert.equal(stale.status, 0, stale.stderr);
  assert.equal(
    stale.stdout,
    '2 open suggested tasks in docs/plans/suggested-tasks.decisions.tsv, the likeliest stale first:\n' +
      '  t_7a004000  Fix a  [stale]  age 0d; priority P1; deleted since its offer: gone.md; missing: new.md; 1 commit on its paths since its offer, last "fix kept"\n' +
      '  t_7a009000  Fix b  [fresh]  age 0d; priority P1; card c1 in session s1\n',
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
  assert.equal(offer('t_7a004000 Fix the source', 'src', 'topic: source').status, 0);
  assert.equal(offer('t_7a010000 Fix both', 'docs/both.md', 'topic: both').status, 0);
  assert.equal(offer('t_7a014000 Fix the note that came back', 'docs/back.md', 'topic: back').status, 0);
  assert.equal(offer('t_7a00d000 Fix the library', 'lib', 'topic: library').status, 0);
  assert.equal(offer('t_7a009000 Fix the note', 'docs/notes/moved.md', 'topic: note').status, 0);
  assert.equal(offer('t_7a019000 Fix the note by its full path', join(root, 'docs/notes/moved.md'), 'topic: note-path').status, 0);
  assert.equal(offer('t_7a01f000 Fix the only leaf by its full path', join(root, 'docs/only/leaf.md'), 'topic: leaf').status, 0);
  assert.equal(offer('t_7a022000 Fix the old source', 'src/old.ts', 'topic: old-source').status, 0);
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
  assert.match(stale.stdout, /t_7a009000 [^\n]*; 1 commit on its paths since its offer, last "edit the note"\n/, 'the companion edit counts, and neither half of the move does');
  assert.match(stale.stdout, /t_7a019000 [^\n]*; 1 commit on its paths since its offer, last "edit the note"\n/, 'an absolute path inside the project reads the companion too');
  assert.doesNotMatch(stale.stdout, /t_7a004000 [^\n]*commit/, 'a pure rename inside a written directory counts no commit');
  assert.match(stale.stdout, /t_7a00d000 [^\n]*; 1 commit on its paths since its offer, last "add the shared file"\n/, 'a new file whose content the companion once held is no move');
  assert.match(stale.stdout, /t_7a010000 [^\n]*deleted since its offer: docs\/both\.md/, 'a delete counts though the companion still tracks the path');
  assert.match(stale.stdout, /t_7a014000 [^\n]*; 2 commits on its paths since its offer, last "add the note back"\n/, 'a delete and an add more than a day apart are no move');
  assert.match(stale.stdout, /t_7a01f000 [^\n]*deleted since its offer: /, 'an absolute path whose directory is gone still reads its history');
  assert.match(stale.stdout, /t_7a022000 [^\n]*missing: src\/old\.ts/, 'a path renamed away is missing');
  assert.doesNotMatch(stale.stdout, /t_7a022000 [^\n]*deleted since its offer/, 'a path renamed away is no deletion');
});

test('chips groups links two open tasks that share two kinds of evidence, and an apart row keeps the pair off the list', () => {
  const { chip, chips, helper, LEDGER } = chipLedger();
  const offer = (decision, why, evidence) => helper('append', LEDGER, 'chip', decision, why, `${evidence}; priority: P2; via: verdict`, 'offered');
  const a1 = 't_7a004000 Give worktree sessions a run directory the Write tool can reach';
  const c1 = 't_7a00d000 Name the trails rule owner';
  assert.equal(offer(a1, 'guard.mjs refuses the write', 'writes: rules/trails.md, rules/run.md; topic: run-dir-write').status, 0);
  assert.equal(offer('t_7a009000 Let a worktree session write its run directory without the hook refusing', 'the hook refuses it', 'writes: rules/trails.md; topic: run-dir-writes').status, 0);
  assert.equal(offer(c1, 'one owner', 'writes: rules/trails.md; topic: trails-owner').status, 0);
  assert.equal(offer('t_7a010000 Give worktree sessions a run directory the Read tool can reach', 'readRunDir misses it', 'writes: rules/run.md; topic: run-dir-read; waits: task:t_7a004000').status, 0);
  const groups = chips('groups');
  assert.equal(groups.status, 0, groups.stderr);
  assert.match(groups.stdout, /^1 group of open tasks /);
  assert.ok(
    groups.stdout.endsWith(
      '\n' +
      '  t_7a004000 and t_7a009000: problem; fix area (rules/trails.md)\n' +
      '  t_7a004000  Give worktree sessions a run directory the Write tool can reach  [run-dir-write]  no card\n' +
      '  t_7a009000  Let a worktree session write its run directory without the hook refusing  [run-dir-writes]  no card\n',
    ),
    't_7a00d000 shares only the file, t_7a010000 shares two kinds with t_7a004000 but waits on it, and shares only wording with t_7a009000',
  );
  assert.match(chip(a1, 'apart').stderr, /an apart row names in "from: <task id>, <task id>" each other task the ledger holds/);
  assert.equal(chip(a1, 'apart', 'from: t_7a004000').status, 1, 'the task itself');
  assert.equal(chip(a1, 'apart', 'from: t_7a050000').status, 1, 'a task the ledger lacks');
  const z1 = 't_7a04f000 Record the zebra crossing';
  assert.equal(offer(z1, 'zebra', 'writes: rules/zebra.md; topic: run-dir-write').status, 0);
  const apart = chip(z1, 'apart', 'from: t_7a009000');
  assert.equal(apart.status, 0, apart.stderr);
  const dup = chip(z1, 'dismissed dup t_7a004000');
  assert.equal(dup.status, 0, dup.stderr);
  assert.match(chips('groups').stdout, /^No two open tasks in docs\/plans\/suggested-tasks\.decisions\.tsv share two kinds of evidence/, 't_7a004000 keeps the apart list of the duplicate merged into it');
  assert.equal(chip(a1, 'apart', 'from: t_7a04f000').status, 1, 'a task merged into it');
  assert.equal(chip(c1, 'carded', 'card: k1; session: s1').status, 0);
  assert.equal(chip(c1, 'apart', 'from: t_7a004000').status, 0, 'an apart row changes no work, so a carded task takes it');
  const e1 = 't_7a014000 Cache the parse tree';
  const f1 = 't_7a019000 Expire the cache entries';
  assert.equal(offer(e1, 'slow parse', 'writes: src/cache.ts; topic: cache').status, 0);
  assert.equal(offer(f1, 'stale entries', 'writes: src/expire.ts; topic: cache').status, 0);
  assert.equal(chip(f1, 'apart', 'from: t_7a014000').status, 0);
  assert.equal(chip(f1, 'updated', 'waits: task:t_7a014000').status, 0);
  assert.doesNotMatch(chips().stdout, /merge t_7a019000 into t_7a014000/, 'chips never merges two tasks an apart row keeps apart');
  assert.match(chip(f1, 'dismissed dup t_7a014000').stderr, /an apart row keeps t_7a019000 and t_7a014000 apart/, 'append refuses a dup between two tasks an apart row keeps apart');
  const g1 = 't_7a01f000 Evict the cache on write';
  const h1 = 't_7a022000 Evict the cache on every write';
  assert.equal(offer(g1, 'stale reads', 'writes: src/evict.ts; topic: cache').status, 0);
  assert.equal(offer(h1, 'stale reads', 'writes: src/evict.ts; topic: cache').status, 0);
  assert.equal(chip(g1, 'apart', 'from: t_7a022000').status, 0);
  assert.equal(chip(h1, 'dismissed dup t_7a014000').status, 0);
  assert.match(chip(g1, 'dismissed dup t_7a014000').stderr, /an apart row keeps t_7a01f000 and t_7a014000 apart/, 'the apart row follows its task into the one it merged into');
  assert.equal(chip(g1, 'updated', 'waits: task:t_7a014000').status, 0);
  assert.doesNotMatch(chips().stdout, /merge t_7a01f000 into t_7a014000/, 'chips follows an apart row through a dup');
  assert.equal(offer('t_7a023000 Keep the caret where a click lands on a page', 'caret', 'writes: apps/p/tests/donor/pagination.test.ts; topic: page-caret; repro: pnpm vitest tests/donor/pagination.test.ts').status, 0);
  assert.equal(offer('t_7a025000 Select all text across every page', 'select all', 'writes: apps/p/tests/donor/pagination.test.ts; topic: page-select; repro: pnpm vitest tests/donor/pagination.test.ts').status, 0);
  assert.equal(offer('t_7a027000 Note the cache fix in the release notes', 'notes', 'writes: .changeset/cache-fix.md; topic: cache-notes').status, 0);
  assert.equal(offer('t_7a02d000 Note the cache fix in the release notes twice', 'notes', 'writes: .changeset/cache-fix.md; topic: cache-notes-twice').status, 0);
  const later = chips('groups').stdout;
  assert.doesNotMatch(later, /t_7a023000 and t_7a025000/, 'a file the repros name is failure evidence, never fix area too');
  assert.doesNotMatch(later, /t_7a027000 and t_7a02d000/, 'a shared changeset file is no fix area');
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
  const spellings = { t_7a004000: './src/main.ts', t_7a009000: './src', t_7a00d000: '.', t_7a010000: 'src/caf\u00e9.ts' };
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
  appendFileSync(join(root, 'docs/plans/suggested-tasks.decisions.tsv'), [['2026-13-10T10:00:00Z', 'chip', 't_7a04f000 Fix an old thing', 'why', ...old], ['2026-13-10T10:00:00Z', 'chip', 't_7a04f000 Fix an old thing', 'why', 'evidence', 'dismissed declined']].map((row) => row.join('\t')).join('\n') + '\n');
  const stale = chips('stale');
  assert.equal(stale.status, 0, `a malformed offer time leaves the report running: ${stale.stderr}`);
  for (const [id, writes] of Object.entries(spellings)) assert.match(stale.stdout, new RegExp(`${id} [^\\n]*; 1 commit on its paths since its offer, last "edit the sources"`), writes);
});

test('a legacy row with an empty waits: replays as no waits', () => {
  const { chips, offer, root, LEDGER } = chipLedger();
  assert.equal(offer('t_7a004000 Fix a', 'src/a.ts', 'topic: blank; waits: pr:5').status, 0);
  writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + ['2026-01-01T10:00:00Z', 'chip', 't_7a004000 Fix a', 'why', 'waits:', 'updated'].join('\t') + '\n');
  const board = chips();
  assert.equal(board.status, 0, board.stdout);
  assert.match(board.stdout, /Ready, P1 \(1\)\n {2}t_7a004000 {2}Fix a {2}\[blank\] {2}no card\n/, 'a row the previous helper read as clearing the waits');
});

test('chips brief on a replaced task prints its replacement\'s brief', () => {
  const { chips, offer, root, LEDGER } = chipLedger();
  assert.equal(offer('t_7a02d000 Fix the badge', 'README.md', 'topic: badge').status, 0);
  const rows = [
    ['t_7a02f000 Now: Fix the badge', 'writes: README.md', 'offered'],
    ['t_7a02f000 Now: Fix the badge', 'retitled', 'dismissed replaced t_7a02d000'],
  ];
  writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + rows.map(([decision, evidence, result]) => ['2026-01-01T10:00:00Z', 'chip', decision, 'why', evidence, result].join('\t')).join('\n') + '\n');
  const brief = chips('brief', 't_7a02f000');
  assert.equal(brief.status, 0, brief.stderr);
  assert.match(brief.stdout, /^t_7a02f000 was replaced by t_7a02d000; work from its brief\.\n\n\[P1\] Fix the badge\n/, 'an old card whose task an older helper replaced');
});

test('chips leaves a prose wait on a task with no topic to its migration', () => {
  const { chips, offer, root, LEDGER } = chipLedger();
  assert.equal(offer('t_7a004000 Fix a', 'src/a.ts', 'topic: other').status, 0);
  writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + ['2026-01-01T10:00:00Z', 'chip', 't_7a02f000 Fix o1', 'why', 'writes: src/o1.ts; waits: the parser PR', 'offered'].join('\t') + '\n');
  const board = chips();
  assert.equal(board.status, 0, 'the prose wait the migration states again: ' + board.stdout);
  assert.match(board.stdout, /migrate t_7a02f000: log updated with topic:, priority: and the waits: it has/);
});

test('two design questions with no topic are not one topic', () => {
  const { helper, offer, root, LEDGER } = chipLedger();
  assert.equal(offer('t_7a004000 Fix a', 'src/a.ts', 'topic: other').status, 0);
  const rows = [
    ['t_7a02f000 Decide the export format (xhigh)', 'writes: src/e.ts; kind: decide', 'offered'],
    ['t_7a030000 Decide the render order (xhigh)', 'writes: src/r.ts; kind: decide', 'offered'],
  ];
  writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + rows.map(([decision, evidence, result]) => ['2026-01-01T10:00:00Z', 'chip', decision, 'why', evidence, result].join('\t')).join('\n') + '\n');
  const whole = helper(LEDGER);
  assert.equal(whole.status, 0, 'two older design questions that name no topic: ' + whole.stderr);
});

test('chips reports a dangling wait on a task with no topic', () => {
  const { chips, offer, root, LEDGER } = chipLedger();
  assert.equal(offer('t_7a004000 Fix a', 'src/a.ts', 'topic: other').status, 0);
  writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + ['2026-01-01T10:00:00Z', 'chip', 't_7a02f000 Fix o1', 'why', 'writes: src/o1.ts; waits: task:t_7a051000', 'offered'].join('\t') + '\n');
  const board = chips();
  assert.equal(board.status, 1, 'a typed wait that can never clear');
  assert.match(board.stdout, /fix t_7a02f000's wait: task:t_7a051000 dangling, no such task/);
});

test('a card prompt asks to load the brief again after the started row', () => {
  const { chips, offer } = chipLedger();
  assert.equal(offer('t_7a004000 Fix the parser', 'src/p.ts', 'topic: parser').status, 0);
  assert.match(chips('brief', 't_7a004000').stdout, /log a started row [^\n]*, then run cd [^\n]* && node \.agents\/pstack\/decisions-check\.mjs chips brief t_7a004000 again and work from what it prints, because the task can gain work until your started row\./, 'a merge between reading the brief and the started row');
});

test('a card prompt names the stored decision, shell-quoted, so its started row appends', () => {
  const { chip, chips, offer } = chipLedger();
  const decision = 't_7a004000 Fix the "$HOME" parser';
  assert.equal(offer(decision, 'src/p.ts', 'topic: parser').status, 0);
  const quoted = chips('brief', 't_7a004000').stdout.match(/ chip ("(?:[^"\\]|\\.)*") "<why>" "<tokens>" <result>/u)?.[1];
  assert.ok(quoted, 'the prompt shows the row command');
  const parsed = spawnSync('sh', ['-c', `printf %s ${quoted}`], { encoding: 'utf8' }).stdout;
  assert.equal(parsed, decision);
  assert.equal(chip(parsed, 'started', 'session: s1').status, 0);
});

test('a chain of dups carries every title and drops each wait that now leads back to the kept task', () => {
  const { chip, chips, offer } = chipLedger();
  assert.equal(offer('t_7a004000 Fix a', 'src/a.ts', 'topic: alias').status, 0);
  assert.equal(offer('t_7a009000 Fix b', 'src/b.ts', 'topic: alias').status, 0);
  assert.equal(offer('t_7a00d000 Fix c', 'src/c.ts', 'topic: alias').status, 0);
  assert.equal(chip('t_7a00d000 Fix c', 'dismissed dup t_7a009000').status, 0);
  assert.equal(chip('t_7a004000 Fix a', 'updated', 'waits: task:t_7a00d000').status, 0);
  assert.equal(chip('t_7a009000 Fix b', 'dismissed dup t_7a004000').status, 0);
  assert.match(chips().stdout, /Ready, P1 \(1\)\n {2}t_7a004000 {2}Fix a {2}\[alias\] {2}no card\n/, 'a wait on a task merged earlier into the one now merged');
  assert.match(chips('brief', 't_7a004000').stdout, /Also covers:\n- t_7a009000 Fix b\n {2}- why\n- t_7a00d000 Fix c\n {2}- why\n/, 'titles merged earlier come along');
  assert.match(chip('t_7a004000 Fix a', 'updated', 'waits: task:t_7a00d000').stderr, /t_7a004000 cannot wait on itself/, 'a wait on a task merged into this one');
});

test('a dup keeps a design question a design question, and is refused only when it makes a second one', () => {
  const { chip, chips, offer, root, LEDGER } = chipLedger();
  const legacy = (decision, evidence) => writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + ['2026-01-01T10:00:00Z', 'chip', decision, 'why', evidence, 'offered'].join('\t') + '\n');
  assert.equal(offer('t_7a023000 Fix the export', 'src/e.ts', 'topic: export').status, 0);
  assert.equal(offer('t_7a010000 Decide the export format (xhigh)', 'src/f.ts', 'topic: export; kind: decide').status, 0);
  assert.equal(chip('t_7a010000 Decide the export format (xhigh)', 'dismissed dup t_7a023000').status, 0);
  assert.match(chips().stdout, /t_7a023000 {2}Fix the export \(xhigh\) {2}\[export, decide\]/, 'the kept task takes the design question');
  assert.match(chips('brief', 't_7a023000').stdout, /settles a design question first/);
  assert.equal(offer('t_7a014000 Decide the import format (xhigh)', 'src/g.ts', 'topic: import; kind: decide').status, 0);
  legacy('t_7a015000 Decide the import shape (xhigh)', 'writes: src/h.ts; topic: import; kind: decide');
  assert.equal(offer('t_7a016000 Fix the importer', 'src/i.ts', 'topic: import').status, 0);
  assert.match(chip('t_7a015000 Decide the import shape (xhigh)', 'dismissed dup t_7a016000').stderr, /topic import already has the open design question t_7a014000; log t_7a015000 dismissed dup t_7a014000 instead/, 'a dup that makes a second design question in one topic');
  const rows = ['t_7a019000 Decide the badge', 't_7a01a000 Decide the badge link', 't_7a01b000 Decide the badge color'].map((decision) => ['2026-01-01T10:00:00Z', 'chip', decision, 'why', 'writes: README.md; topic: badge; kind: decide', 'offered'].join('\t'));
  writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + rows.join('\n') + '\n');
  assert.match(chips().stdout, /fold topic badge: t_7a019000 and t_7a01a000 and t_7a01b000 are both open design questions/);
  assert.equal(chip('t_7a01a000 Decide the badge link', 'dismissed dup t_7a019000').status, 0, 'a dup between design questions while a third stays');
  assert.equal(chip('t_7a01b000 Decide the badge color', 'dismissed dup t_7a019000').status, 0);
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
  assert.equal(offer('t_7a004000 Fix the parser', 'src/p.ts', 'topic: parser; waits: pr:77').status, 0);
  assert.equal(offer('t_7a005000 Fix the printer', 'src/q.ts', 'topic: printer; waits: pr:78').status, 0);
  assert.equal(offer('t_7a006000 Fix the lexer', 'src/l.ts', 'topic: lexer; waits: pr:79').status, 0);
  const board = chips().stdout;
  assert.match(board, /t_7a004000 {2}Fix the parser {2}\[parser\] {2}waits on pr:77 not merged/, 'a PR number in a commit body');
  assert.match(board, /t_7a005000 {2}Fix the printer {2}\[printer\] {2}waits on pr:78 not merged/, 'a merge into a branch that is not the project branch');
  assert.match(board, /t_7a006000 {2}Fix the lexer {2}\[lexer\] {2}waits on pr:79 not merged/, 'a branch whose name only ends in the project branch');
});

test('a ready task with a card keeps its place when an earlier task frees up', () => {
  const { chips, merge, offer, outside } = chipLedger();
  assert.equal(offer('t_7a004000 Rewrite the README', outside('README.md'), 'topic: readme; waits: pr:99').status, 0);
  assert.equal(offer('t_7a009000 Fix the badge', outside('README.md'), 'topic: badge; card: c1; session: s1').status, 0);
  merge('Merge pull request #99 from a/readme');
  const board = chips();
  assert.match(board.stdout, /Ready, P1 \(1\)\n {2}t_7a009000 {2}Fix the badge {2}\[badge\] {2}card c1/, 'the card stays');
  assert.match(board.stdout, /t_7a004000 {2}Rewrite the README {2}\[readme\] {2}waits on queued behind t_7a009000/);
  assert.equal(board.status, 0, board.stdout);
});

test('a running design question takes later findings as a new question that waits on it, and takes only a new owned check', () => {
  const { appendTo, chip, offer } = chipLedger();
  const landing = 't_7a010000 Decide where pasted content lands (xhigh)';
  assert.equal(offer(landing, 'src/core', 'topic: landing; kind: decide').status, 0);
  assert.equal(chip(landing, 'started').status, 0);
  const next = 't_7a011000 Decide where dropped content lands (xhigh)';
  assert.match(offer(next, 'src/core', 'topic: landing; kind: decide').stderr, /topic landing's design question t_7a010000 is running; a new one waits on it with waits: task:t_7a010000/);
  assert.equal(offer(next, 'src/core', 'topic: landing; kind: decide; waits: task:t_7a010000').status, 0);
  assert.equal(chip(landing, 'updated', 'owns: ci:landing').status, 0, 'a started task takes the check it fixes');
  assert.equal(appendTo('docs/plans/2026-01-01-fix.decisions.tsv', 'verify', 'read CI', 'base-red: ci:landing; proof: none', 'gap: fails on next too').status, 0);
  for (const token of ['writes: src/other', 'topic: other', 'kind: fix', 'waits: pr:5']) {
    assert.match(chip(landing, 'updated', token).stderr, /t_7a010000 is started, so an updated row on it takes only owns:, review-scope: and regression:; the session adds paths with another started row/, `a started task's ${token.split(':')[0]}`);
  }
});

test('a card goes only to a task that is ready before the card, and names the session that holds it', () => {
  const { chip, chips, offer, outside } = chipLedger();
  assert.equal(offer('t_7a004000 Rewrite the README', outside('README.md'), 'topic: readme').status, 0);
  assert.equal(offer('t_7a009000 Fix the badge', outside('README.md'), 'topic: badge').status, 0);
  const queued = chip('t_7a009000 Fix the badge', 'carded', 'card: c1; session: s1');
  assert.equal(queued.status, 1, 'a card would move a queued task ahead of the task it waits behind');
  assert.match(queued.stderr, /t_7a009000 cannot start yet \(queued behind t_7a004000, which writes the same paths outside this checkout\), so it gets no card/);
  assert.match(offer('t_7a00d000 Fix the title', outside('README.md'), 'topic: title; card: c2; session: s1').stderr, /t_7a00d000 cannot start yet \(queued behind t_7a004000/, 'an offer with a card');
  assert.match(chip('t_7a004000 Rewrite the README', 'carded', 'card: c3').stderr, /a card names the session that holds it as "session: <id>"/);
  assert.equal(chip('t_7a004000 Rewrite the README', 'carded', 'card: c3; session: s1').status, 0);
  assert.equal(offer('t_7a010000 Fix the lexer', 'src/l.ts', 'topic: lexer; card: c4; session: s2').status, 0);
  const here = chips('--session', 's1');
  assert.equal(here.status, 0, here.stdout);
  assert.match(here.stdout, /t_7a010000 {2}Fix the lexer {2}\[lexer\] {2}card c4 in session s2\n/);
  assert.match(here.stdout, /check session s2, which holds t_7a010000's card c4: when the session tool reports it archived or gone, log uncarded/);
  assert.doesNotMatch(here.stdout, /check session s1/, "this session's own cards");
  assert.doesNotMatch(chips().stdout, /check session/, 'a board read without a session');
  assert.equal(offer('t_7a019000 Fix the printer', 'src/p.ts', 'topic: printer; session: s1').status, 0, 'an offer names the session that offered it, with or without a card');
  assert.doesNotMatch(chips('--session', 's1').stdout, /t_7a019000 {2}Fix the printer {2}\[printer\] {2}card/, 'the offering session holds no card until it cards the task');
  assert.equal(offer('t_7a01f000 Fix the writer', 'src/w.ts', 'topic: writer; waits: pr:5; card: c5; session: s2').status, 1, 'a waiting task gets no card');
  assert.equal(offer('t_7a020000 Fix the reader', outside('r.md'), 'topic: reader; card: c6; session: s2').status, 0);
  assert.equal(offer('t_7a021000 Rewrite the reader', outside('r.md'), 'topic: reader-rewrite').status, 0);
  assert.equal(chip('t_7a021000 Rewrite the reader', 'started').status, 0);
  assert.match(chips('--session', 's1').stdout, /check session s2, which holds t_7a020000's card c6 on a task that now waits on started t_7a021000 writes its paths outside this checkout: when the session tool reports it archived or gone, log uncarded with card: c6/, 'a card another session holds on a task that has to wait');
  const missing = chips('--session', '--fetch');
  assert.equal(missing.status, 2, 'a flag where the session id goes');
  assert.match(missing.stderr, /--session takes this session's id/);
});

test('a started row names the session that started the task, and a sweep checks that session', () => {
  const { chip, chips, offer } = chipLedger();
  const parser = 't_7a004000 Fix the parser';
  assert.equal(offer(parser, 'src/p.ts', 'topic: parser').status, 0);
  assert.equal(chip(parser, 'started').status, 0, 'a start the dismiss tool reported, which names no session');
  assert.match(chips('--session', 's1').stdout, /find the session that started t_7a004000 with the session tool, [^\n]*log started with session: <its id>; when the search finds none, t_7a004000 stays started/);
  assert.match(chip(parser, 'started', 'session: two words').stderr, /session: names the session id as one token; a field runs to the next ";", so end it with ";" before more evidence/);
  assert.equal(chip(parser, 'started', 'session: s2').status, 0);
  const here = chips('--session', 's1');
  assert.match(here.stdout, /Started \(1\)\n {2}t_7a004000 {2}Fix the parser {2}\[parser\] {2}session s2\n/);
  assert.match(here.stdout, /check session s2, which started t_7a004000: when the session tool reports it archived, log landed when a commit holds its change or its last report says it landed the change, with patch: when it names one; when that report hands back a patch it never applied, land that patch as chips brief's footer says and log landed with patch:; and log dismissed stopped when it hands back no patch and neither this checkout nor its worktree holds an uncommitted edit on its paths/);
  assert.doesNotMatch(chips('--session', 's2').stdout, /started t_7a004000/, "the session's own task");
  assert.doesNotMatch(chips().stdout, /started t_7a004000/, 'a board read without a session');
  assert.match(chips('stale').stdout, /t_7a004000 {2}Fix the parser {2}\[parser\] {2}age 0d; priority P1; started in session s2;/);
  assert.equal(chip(parser, 'dismissed stopped').status, 0);
  assert.doesNotMatch(chips('--session', 's1').stdout, /t_7a004000/);
});

test('chips reports a wait that loops back as one that can never clear', () => {
  const { chip, chips, offer, root, LEDGER } = chipLedger();
  assert.match(offer('t_7a004000 Fix a', 'src/a.ts', 'topic: loop; waits: task:t_7a004000').stderr, /t_7a004000 cannot wait on itself/);
  assert.equal(offer('t_7a004000 Fix a', 'src/a.ts', 'topic: loop').status, 0);
  assert.equal(offer('t_7a009000 Fix b', 'src/b.ts', 'topic: loop; waits: task:t_7a004000').status, 0);
  writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + ['2026-01-01T10:00:00Z', 'chip', 't_7a004000 Fix a', 'why', 'waits: task:t_7a009000', 'updated'].join('\t') + '\n');
  assert.equal(offer('t_7a00d000 Fix c', 'src/c.ts', 'topic: merge; waits: task:t_7a010000').status, 0);
  assert.equal(offer('t_7a010000 Fix d', 'src/d.ts', 'topic: merge').status, 0);
  assert.equal(chip('t_7a010000 Fix d', 'dismissed dup t_7a00d000').status, 0);
  assert.equal(offer('t_7a014000 Fix e', 'src/e.ts', 'topic: stale').status, 0);
  assert.equal(offer('t_7a015000 Fix e2', 'src/e2.ts', 'topic: stale; waits: task:t_7a014000').status, 0);
  assert.equal(chip('t_7a015000 Fix e2', 'started').status, 0);
  assert.equal(chip('t_7a014000 Fix e', 'updated', 'waits: task:t_7a015000').status, 0);
  const board = chips();
  assert.match(board.stdout, /fix t_7a004000's wait: task:t_7a009000 waits back on t_7a004000/, 'two tasks that wait on each other');
  assert.match(board.stdout, /Ready, P1 \([0-9]+\)\n(?: {2}.*\n)* {2}t_7a00d000 {2}Fix c {2}\[merge\] {2}no card\n/, 'a merge drops the kept task\'s wait on the task it absorbed');
  assert.match(board.stdout, /t_7a014000 {2}Fix e {2}\[stale\] {2}waits on task:t_7a015000 started\n/, 'a started task\'s old waits never loop');
  assert.doesNotMatch(board.stdout, /t_7a015000 waits back/);
  assert.equal(board.status, 1);
});

test('decisions-check reads every copy of a token and refuses one a row would ignore', () => {
  const { appendTo, chip, offer } = chipLedger();
  assert.equal(offer('t_7a004000 Make next green', '.github', 'topic: green; owns: ci:a').status, 0);
  assert.match(appendTo('docs/plans/2026-01-01-fix.decisions.tsv', 'verify', 'read CI', 'base-red: ci:a; base-red: ci:b; proof: none', 'gap: fails on next too').stderr, /base-red: ci:b has no open suggested task that owns it/, 'a second base-red token');
  assert.match(offer('t_7a009000 Fix the badge', 'README.md', 'topic: badge; topic: docs').stderr, /names topic: once/);
  assert.match(chip('t_7a004000 Make next green', 'started', 'topic: other').stderr, /a started row does not take topic:/);
  assert.match(chip('t_7a004000 Make next green', 'updated', 'card: c9').stderr, /an updated row does not take card:/);
});

test('chips lists the tasks a dropped card closed, so a sweep can reopen them', () => {
  const { LEDGER, chips, root } = chipLedger();
  writeFileSync(join(root, LEDGER), ledgerRows([
    ['t_7a01f000 After: Fix the release notes', 'writes: CHANGES.md', 'offered'],
    ['t_7a01f000 After: Fix the release notes', 'the queue dropped it', 'dismissed gone'],
  ]));
  const board = chips();
  assert.equal(board.status, 0, board.stderr);
  assert.match(board.stdout, /Lost \(1\)\n {2}t_7a01f000 {2}Fix the release notes/);
  assert.match(board.stdout, /reopen t_7a01f000 or close it/);
});

test('two tasks on one project path are both ready, and a started one holds nothing back', () => {
  const { chip, chips, offer } = chipLedger();
  assert.equal(offer('t_7a004000 Fix the reader', 'src/r.ts', 'topic: reader').status, 0);
  assert.equal(offer('t_7a009000 Speed up the reader', 'src/r.ts', 'topic: reader-speed').status, 0);
  assert.match(chips().stdout, /Ready, P1 \(2\)\n {2}t_7a004000 {2}Fix the reader {2}\[reader\] {2}no card {2}shares paths with t_7a009000\n {2}t_7a009000 [^\n]*shares paths with t_7a004000\n/);
  assert.equal(chip('t_7a004000 Fix the reader', 'started').status, 0);
  const board = chips().stdout;
  assert.match(board, /Ready, P1 \(1\)\n {2}t_7a009000 {2}Speed up the reader {2}\[reader-speed\] {2}no card {2}shares paths with t_7a004000\n/, 'a started session on the same project path');
  assert.match(board, /card t_7a009000: it can start and has no card; first judge whether it needs the result of another open task, starting with t_7a004000, which writes its paths, or of an open design question its work builds on/);
});

test('a carded task takes an updated row that only adds waits, and the withdrawal pass then pulls its card', () => {
  const { chip, chips, offer } = chipLedger();
  assert.equal(offer('t_7a040000 Decide the title slot (xhigh)', 'src/details', 'topic: title-slot; kind: decide').status, 0);
  const toc = 't_7a00d000 List titles in the TOC';
  assert.equal(offer(toc, 'src/toc', 'topic: toc; card: c1; session: s1').status, 0);
  assert.equal(chip(toc, 'updated', 'waits: task:t_7a040000').status, 0, 'a dependency found after the card');
  assert.match(chips('--session', 's1').stdout, /Do, withdrawal pass \(1\)\n {2}withdraw t_7a00d000's card c1: task:t_7a040000 offered;/);
  for (const change of ['waits: pr:5', 'waits: none']) {
    assert.match(chip(toc, 'updated', change).stderr, /t_7a00d000 holds card c1, which cannot change; withdraw the card first/, `a row that drops a wait: ${change}`);
  }
  assert.equal(chip(toc, 'updated', 'waits: task:t_7a040000, pr:5').status, 0, 'another wait that keeps the first');
  const index = 't_7a00e000 Index the titles';
  assert.equal(offer(index, 'src/index', 'topic: index; card: c2; session: s2').status, 0);
  assert.equal(chip(index, 'updated', 'waits: task:t_7a040000').status, 0);
  assert.match(chips('--session', 's1').stdout, /check session s2, which holds t_7a00e000's card c2 on a task that now waits on task:t_7a040000 offered/, "another session's card keeps its prompt, whose board check stops its session");
});

test('chips stale marks a task whose every finding is a migration note as possibly thin', () => {
  const { LEDGER, chips, root } = chipLedger();
  const rows = [
    ['t_7a027000 Fix the marks', 'moved from docs/plans/old.decisions.tsv; waits for: the paused review-tree run, docs/plans/x.md'],
    ['t_7a028000 Fix the toc', 'waits for: udecode/plate#5165 to merge into next'],
    ['t_7a029000 Fix the table', 'no open run or task writes its paths'],
    ['t_7a02a000 Fix the line end', 'waits for: the started task t_7a019000, which changes the same code; merges t_7a004000 and t_7a005000'],
    ['t_7a037000 Fix the paste', 'waits for t_7a004000 because bold drops on paste; the parser loses the mark'],
    ['t_7a038000 Fix the badge', 'merged PRs left the badge stale'],
  ];
  writeFileSync(join(root, LEDGER), `ts\tphase\tdecision\twhy\tevidence\tresult\n${rows.map(([decision, why], index) => ['2026-01-01T10:00:00Z', 'chip', decision, why, `writes: src/f${index}.ts; topic: t${index}`, 'offered'].join('\t')).join('\n')}\n`);
  const stale = chips('stale').stdout;
  for (const id of ['t_7a027000', 't_7a028000', 't_7a029000', 't_7a02a000']) assert.match(stale, new RegExp(`${id} [^\\n]*possibly thin: every finding is a note an older migration wrote`), id);
  for (const id of ['t_7a037000', 't_7a038000']) assert.doesNotMatch(stale, new RegExp(`${id} [^\\n]*possibly thin`), `${id} holds a real finding`);
});

test('a landed row names each commit that delivered the task, and append refuses a hash that is no commit', () => {
  const { chip, offer, root } = chipLedger();
  const parser = 't_7a004000 Add the parser';
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
  const plan = 't_7a004000 Build the fill view';
  assert.equal(offer(plan, 'src/f.ts', 'topic: fill').status, 0);
  assert.match(chip(plan, 'landed').stderr, /t_7a004000 is offered, so it cannot be landed/, 'a task nobody started');
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
  const skip = 't_7a004000 Skip the parser case';
  assert.equal(offer(skip, 'tests/p.test.ts', 'topic: parser').status, 0);
  assert.equal(chip(skip, 'started', 'session: s1').status, 0);
  assert.match(chip(skip, 'landed', 'commit: deadbeef1').stderr, /commit: deadbeef1 is not a commit in this checkout/);
  assert.equal(chip(skip, 'landed', `commit: ${sha}`).status, 0);
  assert.ok(
    chips('cleanup', '--sessions', 'sessions.json').stdout.includes(`t_7a004000 Skip the parser case: 📦 [app-private: test(app): skip the case](https://diffshub.com/acme/app-private/commit/${sha})`),
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
    const task = `${['t_7a004000', 't_7a009000', 't_7a00d000', 't_7a010000', 't_7a014000', 't_7a019000'][n]} Fix part ${n}`;
    assert.equal(offer(task, `src/${n}.ts`, `topic: part-${n}`).status, 0);
    assert.equal(chip(task, 'started', `session: ${session.sessionId}`).status, 0);
    assert.equal(chip(task, 'landed', n === 0 ? `commit: ${sha}` : 'evidence').status, 0);
  }
  const [aging, started] = ['t_7a01f000 Fix a bug part 5 found', 't_7a022000 Fix another bug part 5 found'];
  for (const [n, task] of [aging, started].entries()) {
    assert.equal(offer(task, `src/found-${n}.ts`, `topic: found-${n}; session: s6`).status, 0);
    assert.equal(chip(task, 'carded', `card: t_7a00${n + 1}000; session: s6`).status, 0);
  }
  writeFileSync(join(root, 'sessions.json'), JSON.stringify(sessions));
  const out = chips('cleanup', '--sessions', 'sessions.json').stdout;
  assert.match(out, /^Archive \(1\)[^\n]*\n {2}s1 {2}idle card\n/u, 'only the idle, unpinned card session is archived');
  assert.match(out, new RegExp(`Remove \\(1\\)[^\\n]*\\n {2}node \\.agents/skills/cleanup/scripts/scan\\.mjs --repo \\. --remove ${card('b').replace(/[.*+?^${}()|[\]\\/]/gu, '\\$&')}\\n`), 'the archived card worktree is removed');
  assert.match(out, /^Keep \(1\)[^\n]*\n {2}s6 {2}card holder: holds t_7a01f000's card t_7a001000, t_7a022000's card t_7a002000\n/mu, 'a card session that holds a card nobody started is kept, since archiving it drops the card');
  assert.ok(out.includes(`t_7a004000 Fix part 0: 📦 [fix(app): keep the \\[caret\\] in place](https://diffshub.com/acme/app/commit/${sha})`), 'the report links the named commit by its subject');
  assert.match(out, /t_7a009000 Fix part 1: no commit named/);
  assert.match(out, /t_7a019000 Fix part 5: no commit named/, 'a kept session still reports its landed task');
  assert.doesNotMatch(out, /t_7a0(?:0d|10|14)000/, 'a working, checkout or pinned session is left alone');
  assert.equal(chip(started, 'started', 'session: s7').status, 0);
  assert.match(chips('cleanup', '--sessions', 'sessions.json').stdout, /^Keep \(1\)[^\n]*\n {2}s6 {2}card holder: holds t_7a01f000's card t_7a001000\n/mu, 'a started card no longer keeps its session');
  const ledger = join(root, 'docs/plans/suggested-tasks.decisions.tsv');
  const weekOld = new Date(Date.now() - 8 * 86_400_000).toISOString();
  writeFileSync(ledger, readFileSync(ledger, 'utf8').replace(/^\S+(\tchip\tt_7a01f000 [^\n]*\tcarded)$/mu, `${weekOld}$1`));
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
    const task = `${['t_7a004000', 't_7a009000', 't_7a00d000'][n]} Fix part ${n}`;
    assert.equal(offerHere(task, `writes: src/${n}.ts; topic: part-${n}`).status, 0);
    assert.equal(helper('append', LEDGER, 'chip', task, 'why', `session: ${session.sessionId}`, 'started').status, 0);
    assert.equal(helper('append', LEDGER, 'chip', task, 'why', 'evidence', 'landed').status, 0);
  }
  const list = join(root, 'docs/plans/artifacts/sessions.json');
  writeFileSync(list, JSON.stringify(sessions));
  const removesOnlyLeft = new RegExp(`Remove \\(1\\)[^\\n]*\\n {2}node \\.agents/skills/cleanup/scripts/scan\\.mjs --repo \\. --remove ${card('left').replace(/[.*+?^${}()|[\]\\/]/gu, '\\$&')}\\n`);
  const out = helper('chips', 'cleanup', '--sessions', list, '--session', 'lead').stdout;
  assert.match(out, removesOnlyLeft, 'only the folder no session works in is removed');
  assert.doesNotMatch(out, /t_7a00[49]000/, 'a folder a live session or the cleanup session works in is not cleaned up');
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
  const parser = 't_7a004000 Add the parser';
  assert.equal(offer(parser, 'src/p.ts', 'topic: parser').status, 0);
  assert.equal(offer('t_7a009000 Use the parser', 'src/q.ts', 'topic: parser-use; waits: task:t_7a004000').status, 0);
  assert.equal(chip(parser, 'started').status, 0);
  const patch = 'docs/plans/artifacts/chips/t_7a004000.patch';
  assert.match(chip(parser, 'landed', `patch: ${patch}`).stderr, /patch: docs\/plans\/artifacts\/chips\/t_7a004000\.patch does not exist/);
  mkdirSync(join(root, 'docs/plans/artifacts/chips'), { recursive: true });
  writeFileSync(join(root, patch), 'diff --git a/src/p.ts b/src/p.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/p.ts\n@@ -0,0 +1 @@\n+export const parse = 1;\n');
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src/p.ts'), 'export const parse = 1;\n');
  assert.equal(chip(parser, 'landed', `patch: ${patch}`).status, 0);
  assert.match(chips().stdout, /t_7a009000 {2}Use the parser {2}\[parser-use\] {2}waits on task:t_7a004000 landed, waiting for a commit of src\/p\.ts/, 'a new card session starts from the last commit, which lacks the parser');
  spawnSync('git', ['-C', root, 'add', 'src/p.ts']);
  commit(root, 'parser');
  writeFileSync(join(root, 'src/p.ts'), 'export const parse = 2;\n');
  assert.match(chips().stdout, /Ready, P1 \(1\)\n {2}t_7a009000 {2}Use the parser/, "a later task's uncommitted edit on top of the committed parser does not hold the wait");
});

test('an offer with session: none lies outside its run\'s domain, so no plain board cards it and chips all does', () => {
  const { chips, offer } = chipLedger();
  assert.equal(offer('t_7a004000 Fix the parser', 'src/a.ts', 'topic: a; session: none').status, 0);
  assert.equal(offer('t_7a009000 Fix the badge', 'src/b.ts', 'topic: b').status, 0);
  const plain = chips().stdout;
  assert.doesNotMatch(plain, /card t_7a004000:/, 'a runtime with no session tool cards no task outside its run\'s domain');
  assert.match(plain, /card t_7a009000:/, 'a runtime with no session tool still cards its own ownerless offer');
  assert.doesNotMatch(chips('--session', 's1').stdout, /card t_7a004000:/);
  assert.match(chips('all', '--session', 's1').stdout, /card t_7a004000:/, 'chips all cards it');
  assert.match(chips('brief', 't_7a004000').stdout, /\nOwner: none\. Its finding lies outside the domain of the run that offered it, so only \/chips all cards it\.\n/);
});

test('an updated row with session: none gives a task back to no owner, so only chips all cards it', () => {
  const { chip, chips, offer } = chipLedger();
  assert.equal(offer('t_7a004000 Fix the parser', 'src/a.ts', 'topic: a; session: s1').status, 0);
  assert.match(chips('--session', 's1').stdout, /Do, card pass \(1\)\n {2}card t_7a004000:/);
  assert.equal(chip('t_7a004000 Fix the parser', 'updated', 'session: none').status, 0);
  assert.doesNotMatch(chips().stdout, /card t_7a004000:/, 'a run with no session id leaves the task to chips all');
  const own = chips('--session', 's1').stdout;
  assert.doesNotMatch(own, /card t_7a004000:/, 'the session that gave it back cards it no more');
  assert.match(own, /no owner {2}1 open: t_7a004000/);
  assert.match(chips('all', '--session', 's1').stdout, /card t_7a004000:/, 'chips all cards a task no session owns');
});

test('a session cards only the tasks it owns, and chips all takes the ones no live session owns', () => {
  const { chip, chips, offer, root } = chipLedger();
  assert.equal(offer('t_7a004000 Fix the parser', 'src/a.ts', 'topic: a; session: s1').status, 0);
  assert.equal(offer('t_7a009000 Fix the badge', 'src/b.ts', 'topic: b; session: s2').status, 0);
  assert.equal(offer('t_7a00d000 Fix the clock', 'src/c.ts', 'topic: c').status, 0);
  assert.equal(offer('t_7a010000 Fix the dial', 'src/d.ts', 'topic: d; session: s3').status, 0);
  const own = chips('--session', 's1').stdout;
  assert.match(own, /Do, card pass \(1\)\n {2}card t_7a004000:/, 'a session cards only the task it offered');
  assert.match(own, /Other owners \(3\)\n {2}session s2 {2}1 open: t_7a009000\n {2}no owner {2}1 open: t_7a00d000\n {2}session s3 {2}1 open: t_7a010000/);
  assert.match(chips().stdout, /Do, card pass \(4\)/, 'a runtime with no session tool cards every task');
  const refused = chip('t_7a009000 Fix the badge', 'carded', 'card: c1; session: s1');
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /t_7a009000 belongs to session s2, so only that session cards it/);
  const unlisted = chips('all', '--session', 's1').stdout;
  assert.match(unlisted, /Do, card pass \(2\)\n {2}card t_7a004000:[^\n]*\n {2}card t_7a00d000:/, 'chips all cards a task no session owns');
  assert.doesNotMatch(unlisted, /take t_7a010000/, 'with no session list, no owner counts as gone');
  writeFileSync(join(root, 'sessions.json'), JSON.stringify([{ sessionId: 's1', isArchived: false }, { sessionId: 's2', isArchived: false }, { sessionId: 's3', isArchived: true }]));
  assert.match(chips('all', '--session', 's1', '--sessions', 'sessions.json').stdout, /Do, ledger pass \(1\)\n {2}take t_7a010000: its owner session s3 is archived or gone; log updated with session: s1/);
  assert.equal(chip('t_7a010000 Fix the dial', 'updated', 'session: s1').status, 0);
  assert.equal(chip('t_7a00d000 Fix the clock', 'carded', 'card: c2; session: s1').status, 0, 'carding a task no session owns takes it');
  assert.match(chips('--session', 's1').stdout, /Do, card pass \(2\)\n {2}card t_7a004000:[^\n]*\n {2}card t_7a010000:/, 'a taken task is this session\'s own');
  assert.match(chips('--session', 's2').stdout, /session s1 {2}3 open: t_7a004000, t_7a00d000, t_7a010000/);
  assert.match(chip('t_7a004000 Fix the parser', 'updated', 'transcript: t1').stderr, /transcript: goes beside session:/);
  assert.equal(chips('all').status, 2, 'chips all needs the session that takes the tasks');
});

test('a fast mark shows on a plain fix, refuses design judgment, and drops when a fold or dup raises the task', () => {
  const { chip, chips, offer } = chipLedger();
  const link = 't_7a019000 Fix the badge link';
  assert.equal(offer(link, 'README.md', 'topic: badge; fast: yes').status, 0);
  assert.match(chips().stdout, /t_7a019000 {2}Fix the badge link \(fast\) {2}\[badge\]/);
  assert.match(chips('brief', 't_7a019000').stdout, /^\[P1\] Fix the badge link \(fast\)\n[\s\S]*This task is marked fast: the owner's start of its card, or their "start <id>", is the word fast for it/);
  assert.match(offer('t_7a01a000 Decide the badge (xhigh)', 'README.md', 'topic: badge-design; fast: yes').stderr, /t_7a01a000 is an \(xhigh\) task, and fast: yes marks only a fix at high effort/);
  assert.match(offer('t_7a01b000 Design the badge', 'README.md', 'topic: badge-look; kind: decide; fast: yes').stderr, /t_7a01b000 is a decide task/);
  assert.match(offer('t_7a01c000 Fix the badge color (fast)', 'README.md', 'topic: badge-color').stderr, /fast: yes adds \(fast\) for it/);
  assert.match(offer('t_7a01d000 Fix the badge size', 'README.md', 'topic: badge-size; fast: maybe').stderr, /fast: is yes or no/);
  assert.match(chip(link, 'folded', 'kind: review').stderr, /a folded row takes kind: decide only/);
  assert.equal(chip(link, 'folded', 'effort: xhigh').status, 0);
  assert.match(chips().stdout, /t_7a019000 {2}Fix the badge link \(xhigh\) {2}\[badge\]/, 'a fold that needs design judgment drops the mark');
  assert.equal(offer('t_7a01f000 Fix the footer', 'docs/f.md', 'topic: footer; fast: yes').status, 0);
  assert.equal(offer('t_7a020000 Rework the footer layout (xhigh)', 'docs/f.md', 'topic: footer').status, 0);
  assert.equal(chip('t_7a020000 Rework the footer layout (xhigh)', 'dismissed dup t_7a01f000').status, 0);
  assert.doesNotMatch(chips('brief', 't_7a01f000').stdout, /marked fast/, 'a dup that brings design judgment drops the mark');
  assert.equal(offer('t_7a021000 Fix the header', 'docs/h.md', 'topic: header').status, 0);
  assert.equal(chip('t_7a021000 Fix the header', 'updated', 'fast: yes').status, 0);
  assert.match(chips().stdout, /t_7a021000 {2}Fix the header \(fast\)/);
});

test('fast work stays owed until a review task covers it, and comes back when that review is declined', () => {
  const { chip, chips, offer, root } = chipLedger();
  const link = 't_7a019000 Fix the badge link';
  assert.equal(offer(link, 'README.md', 'topic: badge; fast: yes; card: c1; session: s1').status, 0);
  assert.match(chips().stdout, /Do, ledger pass \(1\)\n {2}review the fast work of t_7a019000: offer one task titled "Review the fast work of t_7a019000" with writes: README\.md; topic: fast-review; kind: review; waits: task:t_7a019000/);
  const review = 't_7a037000 Review the fast work of t_7a019000';
  assert.equal(offer(review, 'README.md', 'topic: fast-review; kind: review; waits: task:t_7a019000').status, 0);
  assert.doesNotMatch(chips().stdout, /review the fast work/, 'a review task covers it');
  assert.equal(chip(link, 'started').status, 0);
  mkdirSync(join(root, 'docs/plans/artifacts/chips'), { recursive: true });
  writeFileSync(join(root, 'docs/plans/artifacts/chips/t_7a019000.patch'), 'diff --git a/README.md b/README.md\n');
  assert.equal(chip(link, 'landed', 'patch: docs/plans/artifacts/chips/t_7a019000.patch').status, 0);
  assert.match(chips().stdout, /Owed review \(1\)\n {2}t_7a019000 {2}Fix the badge link \(fast\) {2}\[badge\] {2}patch docs\/plans\/artifacts\/chips\/t_7a019000\.patch\n/);
  assert.match(chips('brief', 't_7a037000').stdout, /This task reviews the fast work of the tasks it waits on[^\n]*\n- t_7a019000 Fix the badge link \(fast\): docs\/plans\/artifacts\/chips\/t_7a019000\.patch\n/);
  assert.equal(chip(review, 'dismissed declined').status, 0);
  assert.match(chips().stdout, /review the fast work of t_7a019000: offer one task/, 'a declined review leaves the work owed');
  assert.equal(chip(link, 'reviewed').status, 0);
  assert.doesNotMatch(chips().stdout, /Owed review|review the fast work/);
  assert.match(chip(review, 'reviewed').stderr, /t_7a037000 is dismissed declined, so it cannot be reviewed/);
});

test('an effort: high row lowers a stored (xhigh) title, and a design question stays at xhigh', () => {
  const { chip, chips, offer } = chipLedger();
  const parser = 't_7a014000 Fix the parser (xhigh)';
  assert.equal(offer(parser, 'src/p.ts', 'topic: parser').status, 0);
  assert.match(chips('brief', 't_7a014000').stdout, /^\[P1\] Fix the parser \(xhigh\)\n[\s\S]*Effort: xhigh\./);
  assert.equal(chip(parser, 'updated', 'effort: high').status, 0);
  assert.match(chips().stdout, /t_7a014000 {2}Fix the parser {2}\[parser\]/);
  assert.match(chips('brief', 't_7a014000').stdout, /^\[P1\] Fix the parser\n[\s\S]*Effort: high\./);
  assert.equal(chip(parser, 'updated', 'effort: xhigh').status, 0);
  assert.match(chips('brief', 't_7a014000').stdout, /Effort: xhigh\./, 'an updated row raises it again');
  assert.match(chip(parser, 'updated', 'effort: max').stderr, /effort: is high or xhigh/);
  const design = 't_7a015000 Decide the parser shape';
  assert.equal(offer(design, 'src/q.ts', 'topic: parser-shape; kind: decide').status, 0);
  assert.equal(chip(design, 'updated', 'effort: high').status, 0);
  assert.match(chips('brief', 't_7a015000').stdout, /^\[P1\] Decide the parser shape \(xhigh\)\n[\s\S]*Effort: xhigh\./, 'a design question stays at xhigh');
});

test('a fold only raises a task, and a dup of an xhigh task raises a task lowered to high', () => {
  const { chip, chips, offer } = chipLedger();
  const kept = 't_7a023000 Fix the footer (xhigh)';
  assert.equal(offer(kept, 'docs/f.md', 'topic: footer').status, 0);
  assert.equal(chip(kept, 'updated', 'effort: high').status, 0);
  assert.match(chip(kept, 'folded', 'effort: high').stderr, /a folded row takes effort: xhigh only/);
  assert.equal(offer('t_7a010000 Rework the footer layout (xhigh)', 'docs/f.md', 'topic: footer').status, 0);
  assert.equal(chip('t_7a010000 Rework the footer layout (xhigh)', 'dismissed dup t_7a023000').status, 0);
  assert.match(chips('brief', 't_7a023000').stdout, /^\[P1\] Fix the footer \(xhigh\)\n[\s\S]*Effort: xhigh\./);
});

test('a task that holds a card takes an updated row that only changes its effort', () => {
  const { chip, offer } = chipLedger();
  const parser = 't_7a00d000 Fix the parser (xhigh)';
  assert.equal(offer(parser, 'src/p.ts', 'topic: parser; card: c1; session: s1').status, 0);
  assert.equal(chip(parser, 'updated', 'effort: high').status, 0, 'effort changes no work');
  assert.match(chip(parser, 'updated', 'effort: xhigh; writes: src/p.ts, src/q.ts').stderr, /t_7a00d000 holds card c1, which cannot change/);
});

test("an effort change on a carded task lists its card in the holder's withdrawal pass, then the card pass offers it again", () => {
  const { chip, chips, offer } = chipLedger();
  const parser = 't_7a00d000 Fix the parser (xhigh)';
  assert.equal(offer(parser, 'src/p.ts', 'topic: parser; card: c1; session: s1').status, 0);
  assert.doesNotMatch(chips('--session', 's1').stdout, /withdraw t_7a00d000/, 'a card at its task effort stays');
  assert.equal(chip(parser, 'updated', 'effort: high').status, 0);
  const holder = chips('--session', 's1').stdout;
  assert.match(holder, /Do, withdrawal pass[\s\S]*withdraw t_7a00d000's card c1: it was offered at xhigh and the task is at high now/);
  assert.doesNotMatch(chips('--session', 's2').stdout, /withdraw t_7a00d000/, 'only the session holding the card can withdraw it');
  assert.equal(chip(parser, 'uncarded', 'card: c1').status, 0);
  assert.match(chips('--session', 's1').stdout, /Do, card pass[\s\S]*card t_7a00d000:/);
});

test('a row its chip state forbids changes nothing, so a pulled row in any order cannot undo a start', () => {
  const { LEDGER, chips, offer, root } = chipLedger();
  assert.equal(offer('t_7a004000 Fix the lexer', 'src/l.ts', 'topic: lexer').status, 0);
  appendFileSync(join(root, LEDGER), `2026-01-02T00:00:00Z\tchip\tt_7a004000 Fix the lexer\twhy\tsession: s1\tstarted\n`);
  appendFileSync(join(root, LEDGER), `2026-01-03T00:00:00Z\tchip\tt_7a004000 Fix the lexer\twhy\tevidence\tdismissed declined\n`);
  assert.match(chips('brief', 't_7a004000').stdout, /^State: Started\./mu);
});

test('decisions-check refuses a finding that stops its session before landing, and the brief drops one an older row holds', () => {
  const { LEDGER, chips, helper, root } = chipLedger();
  const proof = 'writes: README.md; topic: docs; priority: P1; repro: steps';
  const stop = 'The badge links a dead page. Stop before land.mjs so a teammate can retest on a local server.';
  for (const why of [stop, 'the badge links a dead page; stop just before landing']) {
    const refused = helper('append', LEDGER, 'chip', 't_7a004000 Fix the stale badge', why, proof, 'offered');
    assert.equal(refused.status, 1, why);
    assert.match(refused.stderr, /never has its session stop before landing/u, why);
  }
  const nearMiss = helper('append', LEDGER, 'chip', 't_7a004000 Stop land.mjs from committing deletions', 'land.mjs stops before the push when a check fails', proof, 'offered');
  assert.equal(nearMiss.status, 0, nearMiss.stderr);
  const folded = helper('append', LEDGER, 'chip', 't_7a004000 Stop land.mjs from committing deletions', 'Stop before land.mjs for a local check.', 'writes: README.md', 'folded');
  assert.match(folded.stderr, /never has its session stop before landing/u, 'a folded row adds a finding too');
  appendFileSync(join(root, LEDGER), `2026-01-02T00:00:00Z\tchip\tt_7a00a000 Fix the dead link\t${stop}\twrites: docs/a.md; topic: links; priority: P1; repro: steps\toffered\n`);
  const brief = chips('brief', 't_7a00a000').stdout;
  assert.match(brief, /^- The badge links a dead page\. Land once the proof passes/mu);
  assert.doesNotMatch(brief, /Stop before land/u);
});

