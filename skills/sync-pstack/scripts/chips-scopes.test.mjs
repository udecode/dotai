import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { commit, read } from './test-sandbox.mjs';
import { chipLedger, linkedWorktree, triagedLedger } from './test-ledger.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HELPERS = join(HERE, '../assets/pstack');

test('triaged chips rank by review scope and regression pages, restore milestone on reopened dup chains, and guard folded/started updates', () => {
  const { batch, chip, chips, merge, root } = triagedLedger({ 'scopes/ghost.json/.keep': '' });
  merge('break page break');
  const head = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  const written = batch([
    ['t_7a019000 Fix f', 'offered', 'writes: f.md; topic: f; priority: P0; repro: type then reload; review-scope: pagination'],
    ['t_7a037000 Fix r', 'offered', `writes: r.md; topic: r; priority: P0; review-scope: pagination; regressed: ${head}`],
    ['t_7a02d000 Fix n', 'offered', 'writes: n.md; topic: n; priority: P1; repro: steps; review-scope: none'],
    ['t_7a010000 Fix d', 'offered', 'writes: d.md; topic: d; priority: P1; repro: steps; review-scope: editor; regression: https://example.org/tool'],
    ['t_7a023000 Fix k', 'offered', 'writes: k.md; topic: k; priority: P1; repro: steps; review-scope: editor; regression: https://platejs.org/docs/a'],
    ['t_7a033000 Fix p', 'offered', 'writes: p.md; topic: p; priority: P1; repro: Type regression: stale into box; review-scope: editor'],
  ]);
  assert.equal(written.status, 0, written.stderr);
  const board = chips().stdout;
  assert.match(board, /Ready, P0 \(2\)\n {2}t_7a019000 {2}Fix f {2}\[f\] {2}experimental [^\n]*\n {2}t_7a037000 {2}Fix r {2}\[r\] {2}experimental /);
  assert.match(board, /t_7a033000 {2}Fix p {2}\[p\] {2}new /);
  assert.match(board, /Do, card pass \(6\)\n {2}card t_7a019000:[^\n]*\n {2}card t_7a037000:[^\n]*\n {2}card t_7a010000:[^\n]*\n {2}card t_7a023000:[^\n]*\n {2}card t_7a02d000:/);

  assert.equal(chip('t_7a023000 Fix k', 'updated', 'regression:').status, 0);
  assert.match(chips().stdout, /t_7a023000 {2}Fix k {2}\[k\] {2}new /);
  const refused = batch([
    ['t_7a042000 Fix u', 'offered', 'writes: u.md; topic: u; priority: P1; repro: steps; review-scope: editor; regression: https://:'],
    ['t_7a043000 Fix v', 'offered', 'writes: v.md; topic: v; priority: P1; repro: steps; review-scope: ghost'],
  ]);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /"https:\/\/:" is not a URL/);
  assert.match(refused.stderr, /review-scope: ghost is no review scope in scopes/);

  // Fold refuses review-scope/regression; started accepts only owns:/review-scope:/regression:.
  assert.equal(chip('t_7a02d000 Fix n', 'folded', 'review-scope: pagination').status, 1);
  assert.equal(chip('t_7a02d000 Fix n', 'folded', 'regression: https://example.org/b').status, 1);
  assert.equal(chip('t_7a033000 Fix p', 'started', 'session: s1').status, 0);
  assert.equal(chip('t_7a033000 Fix p', 'updated', 'review-scope: native; regression: https://example.org/void').status, 0);
  assert.match(chips('brief', 't_7a033000').stdout, /^Review scope: native\. Milestone: regression\./mu);
  assert.match(chip('t_7a033000 Fix p', 'updated', 'topic: other').stderr, /takes only owns:, review-scope: and regression:/);

  // Dup chain reopening restores own milestone; clearing regression on kept task clears covered dups.
  const t2 = triagedLedger();
  assert.equal(t2.batch([
    ['t_7a026000 Fix typing', 'offered', 'writes: a.md; topic: shared; priority: P1; repro: steps; review-scope: editor; regression: https://example.org/r'],
    ['t_7a02b000 Fix editor', 'offered', 'writes: b.md; topic: shared; priority: P1; repro: steps; review-scope: editor'],
    ['t_7a041000 Fix page', 'offered', 'writes: c.md; topic: shared; priority: P1; repro: steps; review-scope: pagination'],
    ['t_7a026000 Fix typing', 'dismissed dup t_7a02b000', 'evidence'],
    ['t_7a02b000 Fix editor', 'dismissed dup t_7a041000', 'evidence'],
    ['t_7a026000 Fix typing', 'reopened', 'separate'],
    ['t_7a02b000 Fix editor', 'reopened', 'separate'],
  ]).status, 0);
  assert.match(t2.chips('brief', 't_7a02b000').stdout, /^Review scope: editor\. Milestone: new\.$/mu);
  assert.doesNotMatch(t2.chips('brief', 't_7a02b000').stdout, /^Regression:/mu);
  assert.equal(t2.chip('t_7a026000 Fix typing', 'dismissed dup t_7a02b000').status, 0);
  assert.equal(t2.chip('t_7a02b000 Fix editor', 'updated', 'review-scope: editor; regression:').status, 0);
  assert.doesNotMatch(t2.chips('brief', 't_7a02b000').stdout, /^Regression:/mu);
});

test('chips.tiers ranks by owned checks, paths, except, and scopes with base-red P0 above catch-all and P1 cap after catch-all', () => {
  const tiers = [{ name: 'core', paths: ['src/core/'], except: ['src/core/extra/'] }, { name: 'feature' }, { name: 'late', scopes: ['late'], checks: ['e2e:ai-'] }];
  const { batch, chips, chip } = chipLedger({ config: { triage: { experimental: ['late'] }, chips: { scopes: 'scopes', tiers } }, files: { 'scopes/editor.json': '{}', 'scopes/late.json': '{}' } });
  assert.equal(batch([
    ['t_7a04f000 Fix z', 'offered', 'writes: src/late/d.ts; topic: z; priority: P0; repro: steps; review-scope: late'],
    ['t_7a025000 Fix l', 'offered', 'writes: src/late/a.ts; topic: l; priority: P1; repro: steps; review-scope: late'],
    ['t_7a019000 Fix f', 'offered', 'writes: src/ui/a.ts; topic: f; priority: P1; repro: steps; review-scope: editor'],
    ['t_7a00d000 Fix c', 'offered', 'writes: src/late/b.ts, src/core/x.ts; topic: c; priority: P1; repro: steps; review-scope: late'],
    ['t_7a045000 Fix x', 'offered', 'writes: src/core/extra/y.ts; topic: x; priority: P1; repro: steps; review-scope: editor'],
    ['t_7a037000 Fix r', 'offered', 'writes: src/late/c.ts; topic: r; priority: P1; repro: steps; review-scope: late; owns: e2e:late'],
    ['t_7a01f000 Fix g', 'offered', 'writes: src/ui/g.ts; topic: g; priority: P1; repro: steps; review-scope: editor; owns: e2e:ui'],
    ['t_7a004000 Fix a', 'offered', 'writes: src/ui/h.ts; topic: a; priority: P1; repro: steps; review-scope: editor; owns: e2e:ai-chat'],
    ['t_7a027000 Fix m', 'offered', 'writes: src/ui/m.ts; topic: m; priority: P1; repro: steps; review-scope: editor; owns: e2e:ai-x, e2e:ui-y'],
  ]).status, 0);
  const board = chips().stdout;
  assert.match(board, /Ready, P0 \(2\)\n {2}t_7a01f000 {2}Fix g {2}\[g\] {2}regression {2}owns e2e:ui {2}no card\n {2}t_7a027000 {2}Fix m {2}\[m\] {2}regression {2}owns e2e:ai-x, e2e:ui-y {2}no card\n\n/);
  assert.match(board, /Ready, P1 \(7\)\n {2}t_7a00d000 [^\n]*core[^\n]*\n {2}t_7a019000 [^\n]*feature[^\n]*\n {2}t_7a045000 [^\n]*feature[^\n]*\n {2}t_7a04f000 [^\n]*late[^\n]*\n {2}t_7a025000 [^\n]*late[^\n]*\n {2}t_7a037000 [^\n]*late[^\n]*\n {2}t_7a004000 [^\n]*late/);
  assert.equal(chip('t_7a00d000 Fix c', 'updated', 'writes: src/late/b.ts').status, 0);
  assert.match(chips('brief', 't_7a00d000').stdout, /Tier: late, rank 3 of chips.tiers within its priority\./);

  const loose = chipLedger({ config: { chips: { scopes: 'scopes', tiers: [{ name: 'a' }, { name: 'b' }] } }, files: { 'scopes/editor.json': '{}' } });
  assert.equal(loose.batch([['t_7a004000 Fix a', 'offered', 'writes: a.md; topic: a; priority: P2; via: verdict; review-scope: editor']]).status, 0);
  assert.match(loose.chips().stdout, /fix chips\.tiers in \.agents\/pstack\.json: a and b name no paths, scopes or checks/);
});

test('repro quoting session:/transcript: preserves Codex transcript stamping; brief shows State and shell-quoted decision', () => {
  const { LEDGER, chip, chips, dir, env, offer, root } = chipLedger();
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
  const append = (d, t, r) => spawnSync(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'append', LEDGER, 'chip', d, 'why', t, r], { cwd: root, encoding: 'utf8', env: runtimeEnv });

  assert.equal(append('t_7a004000 Fix a', 'writes: a.md; topic: shared; priority: P1; repro: Type session: stale into box', 'offered').status, 0);
  assert.equal(append('t_7a009000 Fix b', 'writes: b.md; topic: shared; priority: P1; session: x; repro: Type transcript: stale into box', 'offered').status, 0);
  const rows = read(root, LEDGER).split('\n');
  assert.doesNotMatch(rows.find((r) => r.includes('t_7a004000')), /transcript:/);
  assert.match(rows.find((r) => r.includes('t_7a009000')), /; transcript: rollout-child\t/);
  assert.equal(append('t_7a009000 Fix b', 'session: none', 'updated').status, 0);
  assert.doesNotMatch(read(root, LEDGER).split('\n').find((r) => r.includes('t_7a009000') && r.endsWith('\tupdated')), /transcript:/);

  // Brief State: lines for Ready, Waiting (task & outside-checkout queued), Started, and shell-quoted decision.
  const quoted = 't_7a033000 Fix the "$HOME" parser';
  assert.equal(offer(quoted, 'p.md', 'topic: p; priority: P2; via: verdict').status, 0);
  assert.equal(offer('t_7a044000 Fix w', 'w.md', 'topic: w; priority: P3; via: verdict; waits: task:t_7a033000').status, 0);
  assert.equal(offer('t_7a02f000 Other 1', '/elsewhere/repo/x.md', 'topic: o1; priority: P2; via: verdict').status, 0);
  assert.equal(offer('t_7a030000 Other 2', '/elsewhere/repo/x.md', 'topic: o2; priority: P2; via: verdict').status, 0);
  const readyBrief = chips('brief', 't_7a033000').stdout;
  assert.match(readyBrief, /^State: Ready\.$/mu);
  const arg = readyBrief.match(/ chip ("(?:[^"\\]|\\.)*") "<why>" "<tokens>" <result>/u)?.[1];
  assert.equal(spawnSync('sh', ['-c', `printf %s ${arg}`], { encoding: 'utf8' }).stdout, quoted);
  assert.match(chips('brief', 't_7a044000').stdout, /^State: Waiting on task:t_7a033000 /mu);
  assert.match(chips('brief', 't_7a030000').stdout, /^State: Waiting on queued behind t_7a02f000/mu);
  assert.equal(chip(quoted, 'started', 'session: s1').status, 0);
  assert.match(chips('brief', 't_7a033000').stdout, /^State: Started\.$/mu);
});

test('chips lifts priority through transitive waits (not from started tasks), keeps cards on lift, and prioritizes unprioritized lifted tasks', () => {
  const { LEDGER, batch, chip, chips, root } = chipLedger();
  assert.equal(batch([
    ['t_7a00d000 Measure index', 'offered', 'writes: c.md; topic: measure; priority: P3; via: verdict'],
    ['t_7a009000 Tune index', 'offered', 'writes: b.md; topic: index; priority: P2; via: verdict; waits: task:t_7a00d000'],
    ['t_7a004000 Fix lost save', 'offered', 'writes: a.md; topic: save; priority: P0; repro: reload loses text; waits: task:t_7a009000'],
    ['t_7a010000 Carded task', 'offered', 'writes: d.md; topic: carded; priority: P2; via: verdict; card: c1; session: s1'],
    ['t_7a044000 Urgent waiter', 'offered', 'writes: w.md; topic: urgent; priority: P0; repro: steps; waits: task:t_7a010000'],
  ]).status, 0);

  assert.match(chips().stdout, /Ready, P0 \(2\)\n {2}t_7a00d000 {2}Measure index {2}\[measure\] {2}blocks t_7a009000 {2}no card\n/);
  assert.match(chips('brief', 't_7a00d000').stdout, /^\[P0\] Measure index\n\nTopic: measure\. Kind: fix\. Effort: high\. Priority: P0, from t_7a009000, which waits on it; its own is P3\./);
  assert.doesNotMatch(chips('--session', 's1').stdout, /withdraw t_7a010000/);

  assert.equal(chip('t_7a004000 Fix lost save', 'started', 'session: s9').status, 0);
  assert.match(chips('brief', 't_7a00d000').stdout, /^\[P2\] [^\n]*\n\n[^\n]*Priority: P2, from t_7a009000/, 'started waiter stops lifting');
  assert.equal(chip('t_7a009000 Tune index', 'dismissed declined').status, 0);
  assert.match(chips('brief', 't_7a00d000').stdout, /^\[P3\] Measure index\n\nTopic: measure\. Kind: fix\. Effort: high\. Priority: P3\./);

  // Unprioritized task lifted by P0 still triggers prioritize in ledger pass before carding.
  writeFileSync(join(root, LEDGER), `${readFileSync(join(root, LEDGER), 'utf8')}${['2026-01-01T10:00:00Z', 'chip', 't_7a02f000 Old docs', 'why', 'writes: docs/o.md', 'offered'].join('\t')}\n`);
  assert.equal(chip('t_7a02f000 Old docs', 'updated', 'topic: docs; waits: none').status, 0);
  assert.equal(chip('t_7a045000 Wait on old', 'offered', 'writes: x.md; topic: wait-old; priority: P0; repro: steps; waits: task:t_7a02f000').status, 0);
  assert.match(chips().stdout, /Do, ledger pass \(1\)\n {2}prioritize t_7a02f000:/);
});

test('chips.ship offers open items as unowned P1 tasks, validates ship ids, flags closed items stale, and warns on script failure', () => {
  const { chip, chips, offer, root } = chipLedger();
  assert.equal(offer('t_7a00d000 Fix cursor', 'c.md', 'topic: cursor; session: s2').status, 0);
  writeFileSync(join(root, '.agents/pstack.json'), JSON.stringify({ branch: 'next', chips: { ship: [process.execPath, 'ship.mjs'] } }));
  writeFileSync(join(root, 'ship.mjs'), "import { readFileSync } from 'node:fs';\nprocess.stdout.write(readFileSync('ship.json', 'utf8'));\n");
  const items = (list) => writeFileSync(join(root, 'ship.json'), JSON.stringify(list));
  items([
    { id: 'r1', title: 'Settle item r1', finding: 'r1 open', writes: ['docs/plans'], topic: 'review-r1', kind: 'fix' },
    { id: 'r2', title: 'Settle item r2', finding: 'r2 open', writes: ['docs/plans'], topic: 'review-r2', kind: 'decide', waits: ['run:docs/plans/r2.md'] },
  ]);
  const board = chips('--session', 's1').stdout;
  assert.match(board, /offer ship item r1, [^\n]*; ship: r1" offered/);
  assert.match(board, /offer ship item r2, [^\n]*; ship: r2; waits: run:docs\/plans\/r2\.md" offered/);

  writeFileSync(join(root, 'docs/plans/r2.md'), '# R2\n\nStatus: building\n');
  assert.equal(offer('t_7a03a000 Settle item r1', 'docs/plans', 'topic: review-r1; priority: P1; ship: r1; session: s2').status, 0);
  assert.equal(offer('t_7a03b000 Settle item r2', 'docs/plans', 'topic: review-r2; kind: decide; priority: P1; ship: r2; waits: run:docs/plans/r2.md').status, 0);
  assert.match(offer('t_7a03c000 Unknown ship', 'docs/plans', 'topic: review-r9; priority: P1; ship: r9').stderr, /ship: r9 is not an open item/);
  assert.doesNotMatch(chips('--session', 's1').stdout, /card t_7a03a000/);
  assert.match(chips('all', '--session', 's1').stdout, /Do, card pass \(1\)\n {2}card t_7a03a000:/);
  assert.equal(chip('t_7a03a000 Settle item r1', 'carded', 'card: c1; session: s1').status, 0);

  items([]);
  assert.match(chips('stale').stdout, /t_7a03a000 [^\n]*ship item r1 is no longer open/);
  writeFileSync(join(root, 'ship.mjs'), 'process.exit(3);\n');
  assert.match(chips().stdout, /No ship list: [^\n]*ship\.mjs failed/);
});

test('chips stale reports deletions, missing files, companion/rename/move commit counts, path spellings, and malformed timestamps', () => {
  const { chips, offer, root } = chipLedger();
  writeFileSync(join(root, '.agents/pstack.json'), JSON.stringify({ branch: 'next', companion: { dir: '.git-private', list: '.gitprivate' } }));
  const proj = ['-C', root];
  const comp = ['--git-dir', join(root, '.git-private'), '--work-tree', root];
  spawnSync('git', [...comp, 'init', '-q']);
  const commitAtTime = (via, msg, when) => spawnSync('git', [...via, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', msg], { env: { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } });
  const earlier = new Date(Date.now() - 86_400_000).toISOString();
  const soon = new Date(Date.now() + 3_600_000).toISOString();
  const later = new Date(Date.now() + 86_400_000).toISOString();

  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'docs/notes'), { recursive: true });
  mkdirSync(join(root, 'docs/only'), { recursive: true });
  mkdirSync(join(root, 'lib'), { recursive: true });
  writeFileSync(join(root, 'src/old.ts'), 'export const a = 1;\n');
  writeFileSync(join(root, 'src/caf\u00e9.ts'), 'export const b = 1;\n');
  writeFileSync(join(root, 'docs/notes/moved.md'), 'moved\n');
  writeFileSync(join(root, 'docs/both.md'), 'both\n');
  writeFileSync(join(root, 'docs/back.md'), 'back\n');
  writeFileSync(join(root, 'docs/only/leaf.md'), 'leaf\n');
  writeFileSync(join(root, 'lib/seed.ts'), 'shared\n');
  spawnSync('git', [...proj, 'add', 'src', 'docs/notes/moved.md', 'docs/both.md']);
  commitAtTime(proj, 'add project files', earlier);
  spawnSync('git', [...comp, 'add', 'lib/seed.ts', 'docs/both.md', 'docs/back.md', 'docs/only/leaf.md']);
  commitAtTime(comp, 'add companion files', earlier);

  assert.equal(offer('t_7a004000 Rename dir', 'src', 'topic: src').status, 0);
  assert.equal(offer('t_7a009000 Moved note', 'docs/notes/moved.md', 'topic: note').status, 0);
  assert.equal(offer('t_7a010000 Both file', 'docs/both.md, missing.md', 'topic: both').status, 0);
  assert.equal(offer('t_7a014000 Back file', 'docs/back.md', 'topic: back').status, 0);
  assert.equal(offer('t_7a00d000 Same content', 'lib', 'topic: lib').status, 0);
  assert.equal(offer('t_7a01f000 Abs leaf', join(root, 'docs/only/leaf.md'), 'topic: leaf').status, 0);
  assert.equal(offer('t_7a022000 Old file', './src/old.ts', 'topic: old').status, 0);
  assert.equal(offer('t_7a025000 Cafe file', './src/caf\u00e9.ts', 'topic: cafe').status, 0);

  // Pure rename, side-branch reverted merge, project->companion move + edit, same-content add, deletes, cross-day move back.
  spawnSync('git', [...proj, 'mv', 'src/old.ts', 'src/new.ts']);
  commitAtTime(proj, 'rename source', later);
  spawnSync('git', [...proj, 'checkout', '-q', '-b', 'side']);
  writeFileSync(join(root, 'src/caf\u00e9.ts'), 'export const b = 3;\n');
  commitAtTime(proj, 'try side', soon);
  writeFileSync(join(root, 'src/caf\u00e9.ts'), 'export const b = 1;\n');
  commitAtTime(proj, 'revert side', soon);
  spawnSync('git', [...proj, 'checkout', '-q', '-']);
  spawnSync('git', [...proj, 'merge', '-q', '--no-ff', 'side', '-m', 'merge side']);
  writeFileSync(join(root, 'src/caf\u00e9.ts'), 'export const b = 2;\n');
  spawnSync('git', [...proj, 'add', 'src/caf\u00e9.ts']);
  commitAtTime(proj, 'edit cafe', later);

  spawnSync('git', [...proj, 'rm', '-q', '--cached', 'docs/notes/moved.md']);
  commitAtTime(proj, 'move out', later);
  spawnSync('git', [...comp, 'add', 'docs/notes/moved.md']);
  commitAtTime(comp, 'move in', later);
  writeFileSync(join(root, 'docs/notes/moved.md'), 'edited\n');
  spawnSync('git', [...comp, 'add', 'docs/notes/moved.md']);
  commitAtTime(comp, 'edit note', later);

  writeFileSync(join(root, 'lib/same.ts'), 'shared\n');
  spawnSync('git', [...proj, 'add', 'lib/same.ts']);
  commitAtTime(proj, 'add shared', later);
  spawnSync('git', [...proj, 'rm', '-q', 'docs/both.md']);
  commitAtTime(proj, 'delete both', later);
  spawnSync('git', [...comp, 'rm', '-q', 'docs/only/leaf.md']);
  commitAtTime(comp, 'delete leaf', later);
  spawnSync('git', [...comp, 'rm', '-q', '--cached', 'docs/back.md']);
  commitAtTime(comp, 'drop back', soon);
  spawnSync('git', [...proj, 'add', 'docs/back.md']);
  commitAtTime(proj, 'add back', new Date(Date.now() + 3 * 86_400_000).toISOString());

  // Malformed timestamp on closed row does not break stale report.
  appendFileSync(join(root, 'docs/plans/suggested-tasks.decisions.tsv'), '2026-13-10T10:00:00Z\tchip\tt_7a04f000 Bad ts\twhy\twrites: README.md; topic: old; priority: P2; via: verdict\toffered\n2026-13-10T10:00:00Z\tchip\tt_7a04f000 Bad ts\twhy\tevidence\tdismissed declined\n');

  const stale = chips('stale');
  assert.equal(stale.status, 0, stale.stderr);
  assert.match(stale.stdout, /t_7a009000 [^\n]*; 1 commit on its paths since its offer, last "edit note"\n/);
  assert.match(stale.stdout, /t_7a004000 [^\n]*; 1 commit on its paths since its offer, last "edit cafe"\n/, 'pure rename ignored, cafe edit counted');
  assert.match(stale.stdout, /t_7a00d000 [^\n]*; 1 commit on its paths since its offer, last "add shared"\n/);
  assert.match(stale.stdout, /t_7a010000 [^\n]*deleted since its offer: docs\/both\.md; missing: missing\.md/);
  assert.match(stale.stdout, /t_7a014000 [^\n]*; 2 commits on its paths since its offer, last "add back"\n/);
  assert.match(stale.stdout, /t_7a01f000 [^\n]*deleted since its offer: /);
  assert.match(stale.stdout, /t_7a022000 [^\n]*missing: \.\/src\/old\.ts/);
  assert.doesNotMatch(stale.stdout, /t_7a022000 [^\n]*deleted since its offer/);
  assert.match(stale.stdout, /t_7a025000 [^\n]*; 1 commit on its paths since its offer, last "edit cafe"\n/);
});

test('chips groups links tasks sharing two kinds of evidence, carries apart through dups, and excludes repro/changeset paths', () => {
  const { chip, chips, helper, LEDGER } = chipLedger();
  const offer = (d, why, ev) => helper('append', LEDGER, 'chip', d, why, `${ev}; priority: P2; via: verdict`, 'offered');
  const a1 = 't_7a004000 Give worktree sessions a run directory the Write tool can reach';
  const c1 = 't_7a00d000 Name the trails rule owner';
  assert.equal(offer(a1, 'guard refuses write', 'writes: rules/trails.md, rules/run.md; topic: run-dir-write').status, 0);
  assert.equal(offer('t_7a009000 Let a worktree session write its run directory without the hook refusing', 'hook refuses', 'writes: rules/trails.md; topic: run-dir-writes').status, 0);
  assert.equal(offer(c1, 'one owner', 'writes: rules/trails.md; topic: trails-owner').status, 0);
  assert.equal(offer('t_7a010000 Give worktree sessions a run directory the Read tool can reach', 'read misses', 'writes: rules/run.md; topic: run-dir-read; waits: task:t_7a004000').status, 0);

  const groups = chips('groups');
  assert.equal(groups.status, 0, groups.stderr);
  assert.match(groups.stdout, /^1 group of open tasks [\s\S]*t_7a004000 and t_7a009000: problem; fix area \(rules\/trails\.md\)/);

  assert.equal(chip(a1, 'apart').status, 1);
  assert.equal(chip(a1, 'apart', 'from: t_7a004000').status, 1);
  assert.equal(chip(a1, 'apart', 'from: t_7a050000').status, 1);

  // apart transfers through dup and blocks later dup/merge.
  const z1 = 't_7a04f000 Record zebra crossing';
  assert.equal(offer(z1, 'zebra', 'writes: rules/zebra.md; topic: run-dir-write').status, 0);
  assert.equal(chip(z1, 'apart', 'from: t_7a009000').status, 0);
  assert.equal(chip(z1, 'dismissed dup t_7a004000').status, 0);
  assert.match(chips('groups').stdout, /^No two open tasks /);
  assert.equal(chip(a1, 'apart', 'from: t_7a04f000').status, 1);
  assert.equal(chip(c1, 'carded', 'card: k1; session: s1').status, 0);
  assert.equal(chip(c1, 'apart', 'from: t_7a004000').status, 0);

  const e1 = 't_7a014000 Cache parse tree';
  const f1 = 't_7a019000 Expire cache entries';
  const g1 = 't_7a01f000 Evict cache on write';
  const h1 = 't_7a022000 Evict cache on every write';
  assert.equal(offer(e1, 'slow', 'writes: src/cache.ts; topic: cache').status, 0);
  assert.equal(offer(f1, 'stale', 'writes: src/expire.ts; topic: cache').status, 0);
  assert.equal(offer(g1, 'stale reads', 'writes: src/evict.ts; topic: cache').status, 0);
  assert.equal(offer(h1, 'stale reads', 'writes: src/evict.ts; topic: cache').status, 0);
  assert.equal(chip(f1, 'apart', 'from: t_7a014000').status, 0);
  assert.equal(chip(g1, 'apart', 'from: t_7a022000').status, 0);
  assert.equal(chip(h1, 'dismissed dup t_7a014000').status, 0);
  assert.match(chip(g1, 'dismissed dup t_7a014000').stderr, /an apart row keeps t_7a01f000 and t_7a014000 apart/);
  assert.equal(chip(g1, 'updated', 'waits: task:t_7a014000').status, 0);
  assert.doesNotMatch(chips().stdout, /merge t_7a01f000 into t_7a014000/);

  // Repro-only file and changesets do not form a fix-area group.
  assert.equal(offer('t_7a023000 Keep caret on click', 'caret', 'writes: apps/p/tests/p.test.ts; topic: t1; repro: pnpm vitest tests/p.test.ts').status, 0);
  assert.equal(offer('t_7a025000 Select all text', 'select', 'writes: apps/p/tests/p.test.ts; topic: t2; repro: pnpm vitest tests/p.test.ts').status, 0);
  assert.equal(offer('t_7a027000 Note cache fix', 'notes', 'writes: .changeset/a.md; topic: t3').status, 0);
  assert.equal(offer('t_7a02d000 Note cache fix twice', 'notes', 'writes: .changeset/a.md; topic: t4').status, 0);
  assert.doesNotMatch(chips('groups').stdout, /t_7a023000 and t_7a025000|t_7a027000 and t_7a02d000/);
});

test('chips checks PR merges on project branch subjects only, detects wait loops, checks duplicate/disallowed tokens, and ignores forbidden replayed rows', () => {
  const { LEDGER, appendTo, chip, chips, merge, offer, outside, root } = chipLedger();
  const git = (...args) => spawnSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args]);
  git('commit', '-q', '--allow-empty', '-m', 'Routine', '-m', 'Body (#77)');
  git('update-ref', 'refs/remotes/origin/next', 'HEAD');
  git('commit', '-q', '--allow-empty', '-m', 'Merge pull request #78 from a/stacked');
  git('update-ref', 'refs/remotes/origin/feature', 'HEAD');
  git('commit', '-q', '--allow-empty', '-m', 'Merge pull request #79 from a/release');
  git('update-ref', 'refs/remotes/origin/release/next', 'HEAD');
  assert.equal(offer('t_7a004000 Body PR', 'src/p.ts', 'topic: p1; waits: pr:77').status, 0);
  assert.equal(offer('t_7a005000 Feature PR', 'src/q.ts', 'topic: p2; waits: pr:78').status, 0);
  assert.equal(offer('t_7a006000 Suffix PR', 'src/l.ts', 'topic: p3; waits: pr:79').status, 0);
  const prBoard = chips().stdout;
  for (const [id, num] of [['t_7a004000', 77], ['t_7a005000', 78], ['t_7a006000', 79]]) {
    assert.match(prBoard, new RegExp(`${id} [^\\n]*waits on pr:${num} not merged`));
  }

  // Card keeps place when earlier outside-checkout task unblocks; dup chain carries titles and drops self-waits.
  assert.equal(offer('t_7a00a000 Rewrite README', outside('README.md'), 'topic: r1; waits: pr:99').status, 0);
  assert.equal(offer('t_7a00b000 Fix badge', outside('README.md'), 'topic: r2; card: c1; session: s1').status, 0);
  merge('Merge pull request #99 from a/readme');
  assert.match(chips().stdout, /t_7a00a000 {2}Rewrite README {2}\[r1\] {2}waits on queued behind t_7a00b000/);

  // Wait loops, started task waits not looping, token discipline, and forbidden replayed row ignored.
  assert.match(offer('t_7a010000 Self wait', 'src/s.ts', 'topic: self; waits: task:t_7a010000').stderr, /cannot wait on itself/);
  assert.equal(offer('t_7a011000 Loop A', 'src/la.ts', 'topic: loop; owns: ci:a').status, 0);
  assert.equal(offer('t_7a012000 Loop B', 'src/lb.ts', 'topic: loop; waits: task:t_7a011000').status, 0);
  appendFileSync(join(root, LEDGER), '2026-01-01T10:00:00Z\tchip\tt_7a011000 Loop A\twhy\twaits: task:t_7a012000\tupdated\n');
  assert.match(chips().stdout, /fix t_7a011000's wait: task:t_7a012000 waits back on t_7a011000/);

  assert.match(appendTo('docs/plans/2026-01-01-fix.decisions.tsv', 'verify', 'read CI', 'base-red: ci:a; base-red: ci:b; proof: none', 'gap: fails').stderr, /base-red: ci:b has no open suggested task/);
  assert.match(offer('t_7a013000 Dup topic', 'README.md', 'topic: a; topic: b').stderr, /names topic: once/);
  assert.match(chip('t_7a011000 Loop A', 'started', 'topic: other').stderr, /a started row does not take topic:/);
  assert.match(chip('t_7a011000 Loop A', 'updated', 'card: c9').stderr, /an updated row does not take card:/);

  assert.equal(offer('t_7a014000 Replay guard', 'src/g.ts', 'topic: guard').status, 0);
  appendFileSync(join(root, LEDGER), '2026-01-02T00:00:00Z\tchip\tt_7a014000 Replay guard\twhy\tsession: s1\tstarted\n2026-01-03T00:00:00Z\tchip\tt_7a014000 Replay guard\twhy\tevidence\tdismissed declined\n');
  assert.match(chips('brief', 't_7a014000').stdout, /^State: Started\./mu);
});

test('chips enforces session ownership, session: none, chips all --sessions, running design-question waits, card wait/effort withdrawals, and Stop-before-landing refusal', () => {
  const { LEDGER, chip, chips, helper, offer, outside, root } = chipLedger();
  assert.equal(offer('t_7a004000 Owned s1', 'src/a.ts', 'topic: a; session: s1').status, 0);
  assert.equal(offer('t_7a009000 Owned s2', 'src/b.ts', 'topic: b; session: s2').status, 0);
  assert.equal(offer('t_7a00d000 Unowned', 'src/c.ts', 'topic: c').status, 0);
  assert.equal(offer('t_7a010000 Archived s3', 'src/d.ts', 'topic: d; session: s3').status, 0);
  assert.equal(offer('t_7a011000 Out of domain', 'src/e.ts', 'topic: e; session: none').status, 0);

  assert.match(chips('--session', 's1').stdout, /Do, card pass \(1\)\n {2}card t_7a004000:/);
  assert.doesNotMatch(chips().stdout, /card t_7a011000:/);
  assert.match(chips('brief', 't_7a011000').stdout, /Owner: none\./);
  assert.match(chip('t_7a009000 Owned s2', 'carded', 'card: c1; session: s1').stderr, /belongs to session s2/);
  assert.equal(chip('t_7a004000 Owned s1', 'updated', 'session: none').status, 0);
  assert.doesNotMatch(chips('--session', 's1').stdout, /card t_7a004000:/);

  writeFileSync(join(root, 'sessions.json'), JSON.stringify([{ sessionId: 's1', isArchived: false }, { sessionId: 's2', isArchived: false }, { sessionId: 's3', isArchived: true }]));
  assert.match(chips('all', '--session', 's1', '--sessions', 'sessions.json').stdout, /take t_7a010000: its owner session s3 is archived or gone/);
  assert.equal(chip('t_7a010000 Archived s3', 'updated', 'session: s1').status, 0);
  assert.equal(chips('all').status, 2);
  assert.equal(chips('--session', '--fetch').status, 2);
  assert.match(chip('t_7a010000 Archived s3', 'updated', 'transcript: t1').stderr, /transcript: goes beside session:/);

  // Running design question requires waits: task:<id> for next question; carded tasks withdraw on added wait or effort change.
  const dq = 't_7a020000 Decide paste (xhigh)';
  assert.equal(offer(dq, 'src/core', 'topic: paste; kind: decide').status, 0);
  assert.equal(chip(dq, 'started', 'session: s2').status, 0);
  assert.match(offer('t_7a021000 Decide drop (xhigh)', 'src/core', 'topic: paste; kind: decide').stderr, /is running; a new one waits on it with waits: task:t_7a020000/);
  assert.equal(offer('t_7a021000 Decide drop (xhigh)', 'src/core', 'topic: paste; kind: decide; waits: task:t_7a020000').status, 0);
  assert.match(chips('--session', 's1').stdout, /check session s2, which started t_7a020000:/);

  const carded = 't_7a022000 Fix parser (xhigh)';
  assert.equal(offer(carded, 'src/p.ts', 'topic: p; card: c1; session: s1').status, 0);
  assert.equal(chip(carded, 'updated', 'effort: high').status, 0);
  assert.match(chips('--session', 's1').stdout, /withdraw t_7a022000's card c1: it was offered at xhigh and the task is at high now/);
  assert.equal(chip(carded, 'updated', 'waits: task:t_7a020000').status, 0);
  assert.match(chip(carded, 'updated', 'waits: none').stderr, /holds card c1, which cannot change/);
  assert.equal(chip(carded, 'uncarded', 'card: c1').status, 0);
  assert.match(chip(carded, 'updated', 'effort: max').stderr, /effort: is high or xhigh/);

  // Outside-checkout queued task cannot be carded; card requires session:.
  assert.equal(offer('t_7a023000 Out 1', outside('x.md'), 'topic: o1').status, 0);
  assert.equal(offer('t_7a024000 Out 2', outside('x.md'), 'topic: o2').status, 0);
  assert.match(chip('t_7a024000 Out 2', 'carded', 'card: c2; session: s1').stderr, /cannot start yet \(queued behind t_7a023000/);
  assert.match(chip('t_7a023000 Out 1', 'carded', 'card: c2').stderr, /a card names the session that holds it/);

  // Stop-before-landing refusal on offer & fold, and brief sanitization of older row.
  const proof = 'writes: README.md; topic: stop; priority: P1; repro: steps';
  const stop = 'Dead link. Stop before land.mjs so a teammate can retest.';
  assert.match(helper('append', LEDGER, 'chip', 't_7a030000 Fix link', stop, proof, 'offered').stderr, /never has its session stop before landing/u);
  assert.equal(helper('append', LEDGER, 'chip', 't_7a030000 Stop land.mjs bug', 'land.mjs stops before push on fail', proof, 'offered').status, 0);
  assert.match(helper('append', LEDGER, 'chip', 't_7a030000 Stop land.mjs bug', 'Stop before land.mjs.', 'writes: README.md', 'folded').stderr, /never has its session stop before landing/u);
  appendFileSync(join(root, LEDGER), `2026-01-02T00:00:00Z\tchip\tt_7a031000 Old stop\t${stop}\twrites: docs/a.md; topic: s; priority: P1; repro: steps\toffered\n`);
  const cleanBrief = chips('brief', 't_7a031000').stdout;
  assert.match(cleanBrief, /^- Dead link\. Land once the proof passes/mu);
  assert.doesNotMatch(cleanBrief, /Stop before land/u);
});

test('landed validates public/companion commits and patch waits; chips cleanup archives/removes/keeps sessions safely', () => {
  const { chip, chips, offer, root } = chipLedger();
  writeFileSync(join(root, '.agents/pstack.json'), JSON.stringify({ branch: 'next', companion: { dir: '.git-private', list: '.gitprivate' } }));
  spawnSync('git', ['-C', root, 'remote', 'set-url', 'origin', 'https://github.com/acme/app.git']);
  const comp = ['--git-dir', join(root, '.git-private'), '--work-tree', root];
  spawnSync('git', [...comp, 'init', '-q']);
  spawnSync('git', [...comp, 'remote', 'add', 'origin', 'https://github.com/acme/app-private.git']);
  const mkCommit = (via, msg) => {
    spawnSync('git', [...via, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', msg]);
    return spawnSync('git', [...via, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  };
  const sha1 = mkCommit(['-C', root], 'fix(app): keep [caret]');
  const sha2 = mkCommit(['-C', root], 'feat(app): add guard');
  const cSha = mkCommit(comp, 'test(app): skip case');

  const card = (name) => {
    const p = join(realpathSync(root), '.claude', 'worktrees', name);
    mkdirSync(p, { recursive: true });
    return p;
  };
  const sessions = [
    { sessionId: 's1', title: 'idle card', cwd: card('a'), isArchived: false, isRunning: false },
    { sessionId: 's2', title: 'archived card', cwd: card('b'), isArchived: true, isRunning: false },
    { sessionId: 's3', title: 'working card', cwd: card('c'), isArchived: false, isRunning: true },
    { sessionId: 's4', title: 'checkout session', cwd: realpathSync(root), isArchived: false, isRunning: false },
    { sessionId: 's5', title: 'pinned card', cwd: card('e'), isArchived: false, isRunning: false, pinned: true },
    { sessionId: 's6', title: 'card holder', cwd: card('f'), isArchived: false, isRunning: false },
  ];
  const ids = ['t_7a004000', 't_7a009000', 't_7a00d000', 't_7a010000', 't_7a014000', 't_7a019000'];
  for (const [n, s] of sessions.entries()) {
    const task = `${ids[n]} Fix part ${n}`;
    assert.equal(offer(task, `src/${n}.ts`, `topic: part-${n}`).status, 0);
    if (n === 0) assert.match(chip(task, 'landed').stderr, /is offered, so it cannot be landed/);
    assert.equal(chip(task, 'started', `session: ${s.sessionId}`).status, 0);
    if (n === 0) {
      assert.match(chip(task, 'landed', 'commit: deadbeef1').stderr, /is not a commit in this checkout/);
      assert.equal(chip(task, 'landed', `commit: ${sha1}`).status, 0);
      assert.equal(chip(task, 'landed', `commit: ${sha2}`).status, 0);
    } else if (n === 1) {
      assert.equal(chip(task, 'landed', `commit: ${cSha}`).status, 0);
    } else {
      assert.equal(chip(task, 'landed', 'evidence').status, 0);
    }
  }
  const held = 't_7a01f000 Held card';
  assert.equal(offer(held, 'src/h.ts', 'topic: h; session: s6').status, 0);
  assert.equal(chip(held, 'carded', 'card: t_7a001000; session: s6').status, 0);
  writeFileSync(join(root, 'sessions.json'), JSON.stringify(sessions));

  const out = chips('cleanup', '--sessions', 'sessions.json').stdout;
  assert.match(out, /^Archive \(1\)[^\n]*\n {2}s1 {2}idle card\n/u);
  assert.match(out, new RegExp(`Remove \\(1\\)[^\\n]*\\n {2}node \\.agents/skills/cleanup/scripts/scan\\.mjs --repo \\. --remove ${card('b').replace(/[.*+?^${}()|[\]\\/]/gu, '\\$&')}\\n`));
  assert.match(out, /^Keep \(1\)[^\n]*\n {2}s6 {2}card holder: holds t_7a01f000's card t_7a001000\n/mu);
  assert.ok(out.includes(`[fix(app): keep \\[caret\\]](https://diffshub.com/acme/app/commit/${sha1})`));
  assert.ok(out.includes(`[feat(app): add guard](https://diffshub.com/acme/app/commit/${sha2})`));
  assert.ok(out.includes(`[app-private: test(app): skip case](https://diffshub.com/acme/app-private/commit/${cSha})`));
  assert.doesNotMatch(out, /t_7a0(?:0d|10|14)000/);

  // Week-old dropped card releases holder for archive.
  const ledger = join(root, 'docs/plans/suggested-tasks.decisions.tsv');
  const weekOld = new Date(Date.now() - 8 * 86_400_000).toISOString();
  writeFileSync(ledger, readFileSync(ledger, 'utf8').replace(/^\S+(\tchip\tt_7a01f000 [^\n]*\tcarded)$/mu, `${weekOld}$1`));
  assert.match(chips('cleanup', '--sessions', 'sessions.json').stdout, /^Archive \(2\)[^\n]*\n {2}s1 {2}idle card\n {2}s6 {2}card holder\n/u);

  // Patch wait clears once touched path is committed.
  const pTask = 't_7a020000 Add parser';
  assert.equal(offer(pTask, 'src/p.ts', 'topic: parser').status, 0);
  assert.equal(offer('t_7a021000 Use parser', 'src/q.ts', 'topic: parser-use; waits: task:t_7a020000').status, 0);
  assert.equal(chip(pTask, 'started').status, 0);
  const patch = 'docs/plans/artifacts/chips/t_7a020000.patch';
  assert.match(chip(pTask, 'landed', `patch: ${patch}`).stderr, /does not exist/);
  mkdirSync(join(root, 'docs/plans/artifacts/chips'), { recursive: true });
  writeFileSync(join(root, patch), 'diff --git a/src/p.ts b/src/p.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/p.ts\n@@ -0,0 +1 @@\n+export const parse = 1;\n');
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src/p.ts'), 'export const parse = 1;\n');
  assert.equal(chip(pTask, 'landed', `patch: ${patch}`).status, 0);
  assert.match(chips().stdout, /waits on task:t_7a020000 landed, waiting for a commit of src\/p\.ts/);
  spawnSync('git', ['-C', root, 'add', 'src/p.ts']);
  commit(root, 'parser');
  assert.match(chips().stdout, /t_7a021000 {2}Use parser {2}\[parser-use\] {2}no card/);
});

test('chips cleanup keeps worktrees reused by a live session or the cleanup runtime process', () => {
  const { LEDGER, dir, helper, offerHere, root, run, worktree } = linkedWorktree('trunk', 'here');
  const card = (name) => {
    const p = join(realpathSync(root), '.claude', 'worktrees', name);
    mkdirSync(p, { recursive: true });
    return p;
  };
  const sessions = [
    { sessionId: 's1', title: 'archived', cwd: card('reused'), isArchived: true, isRunning: false },
    { sessionId: 's2', title: 'archived', cwd: worktree, isArchived: true, isRunning: false },
    { sessionId: 's3', title: 'archived', cwd: card('left'), isArchived: true, isRunning: false },
    { sessionId: 's4', title: 'live', cwd: join(card('reused'), 'packages'), isArchived: false, isRunning: true },
  ];
  for (const [n, s] of sessions.slice(0, 3).entries()) {
    const task = `${['t_7a004000', 't_7a009000', 't_7a00d000'][n]} Fix part ${n}`;
    assert.equal(offerHere(task, `writes: src/${n}.ts; topic: part-${n}`).status, 0);
    assert.equal(helper('append', LEDGER, 'chip', task, 'why', `session: ${s.sessionId}`, 'started').status, 0);
    assert.equal(helper('append', LEDGER, 'chip', task, 'why', 'evidence', 'landed').status, 0);
  }
  const list = join(root, 'docs/plans/artifacts/sessions.json');
  writeFileSync(list, JSON.stringify(sessions));
  const onlyLeft = new RegExp(`Remove \\(1\\)[^\\n]*\\n {2}node \\.agents/skills/cleanup/scripts/scan\\.mjs --repo \\. --remove ${card('left').replace(/[.*+?^${}()|[\]\\/]/gu, '\\$&')}\\n`);
  assert.match(helper('chips', 'cleanup', '--sessions', list, '--session', 'lead').stdout, onlyLeft);

  const runtime = join(dir, 'bin', 'claude');
  mkdirSync(dirname(runtime), { recursive: true });
  symlinkSync(process.execPath, runtime);
  const launcher = join(dir, 'launch.mjs');
  writeFileSync(launcher, "import { spawnSync } from 'node:child_process';\nconst [cwd, ...args] = process.argv.slice(2);\nprocess.exit(spawnSync(process.execPath, args, { cwd, stdio: 'inherit' }).status);\n");
  assert.match(run(runtime, [launcher, root, join(HELPERS, 'decisions-check.mjs'), 'chips', 'cleanup', '--sessions', list, '--session', 'lead'], worktree).stdout, onlyLeft);
});

test('fast: yes enforces high-effort fixes, drops on xhigh fold/dup, and tracks owed review until reviewed', () => {
  const { chip, chips, offer, root } = chipLedger();
  const link = 't_7a019000 Fix badge link';
  assert.equal(offer(link, 'README.md', 'topic: badge; fast: yes; card: c1; session: s1').status, 0);
  assert.match(chips().stdout, /t_7a019000 {2}Fix badge link \(fast\) {2}\[badge\]/);
  assert.match(chips().stdout, /review the fast work of t_7a019000: offer one task/);
  assert.match(offer('t_7a01a000 Decide (xhigh)', 'README.md', 'topic: t1; fast: yes').stderr, /fast: yes marks only a fix at high effort/);
  assert.match(offer('t_7a01b000 Design', 'README.md', 'topic: t2; kind: decide; fast: yes').stderr, /is a decide task/);
  assert.match(offer('t_7a01c000 Color (fast)', 'README.md', 'topic: t3').stderr, /fast: yes adds \(fast\)/);
  assert.match(offer('t_7a01d000 Size', 'README.md', 'topic: t4; fast: maybe').stderr, /fast: is yes or no/);

  // Owed review lifecycle.
  const review = 't_7a037000 Review the fast work of t_7a019000';
  assert.equal(offer(review, 'README.md', 'topic: fast-review; kind: review; waits: task:t_7a019000').status, 0);
  assert.doesNotMatch(chips().stdout, /review the fast work/);
  assert.equal(chip(link, 'started').status, 0);
  mkdirSync(join(root, 'docs/plans/artifacts/chips'), { recursive: true });
  writeFileSync(join(root, 'docs/plans/artifacts/chips/t_7a019000.patch'), 'diff --git a/README.md b/README.md\n');
  assert.equal(chip(link, 'landed', 'patch: docs/plans/artifacts/chips/t_7a019000.patch').status, 0);
  assert.match(chips().stdout, /Owed review \(1\)\n {2}t_7a019000 {2}Fix badge link \(fast\)/);
  assert.equal(chip(review, 'dismissed declined').status, 0);
  assert.match(chips().stdout, /review the fast work of t_7a019000/);
  assert.equal(chip(link, 'reviewed').status, 0);
  assert.doesNotMatch(chips().stdout, /Owed review|review the fast work/);
  assert.match(chip(review, 'reviewed').stderr, /is dismissed declined, so it cannot be reviewed/);

  // Fold/dup raising to xhigh drops fast mark.
  const footer = 't_7a01f000 Fix footer';
  assert.equal(offer(footer, 'docs/f.md', 'topic: footer; fast: yes').status, 0);
  assert.equal(offer('t_7a020000 Rework footer (xhigh)', 'docs/f.md', 'topic: footer').status, 0);
  assert.equal(chip('t_7a020000 Rework footer (xhigh)', 'dismissed dup t_7a01f000').status, 0);
  assert.doesNotMatch(chips('brief', 't_7a01f000').stdout, /marked fast/);
});
