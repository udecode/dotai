import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { appendFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { commit, project, read, sandbox } from './test-sandbox.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const HELPERS = join(HERE, '../assets/pstack');

test('freeze writes a commit no ref points to without touching the checkout index', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-pstack-freeze-'));
  const repo = join(dir, 'repo');
  spawnSync('git', ['init', '-q', repo]);
  writeFileSync(join(repo, 'plan.md'), 'reviewed\n');
  writeFileSync(join(repo, 'other.md'), 'base\n');
  spawnSync('git', ['-C', repo, 'add', '-A']);
  commit(repo, 'base');
  writeFileSync(join(repo, 'plan.md'), 'round one\n');
  writeFileSync(join(repo, 'other.md'), 'another session\n');
  const runDir = join(dir, 'run');
  const freeze = (...args) => spawnSync(process.execPath, [join(HELPERS, 'freeze.mjs'), '--dir', runDir, ...args], { cwd: repo, encoding: 'utf8' });

  const first = freeze('plan.md');
  assert.equal(first.status, 0, first.stderr);
  const sha = first.stdout.trim();
  const show = (rev, path) => spawnSync('git', ['-C', repo, 'show', `${rev}:${path}`], { encoding: 'utf8' }).stdout;
  assert.equal(show(sha, 'plan.md'), 'round one\n');
  assert.equal(show(sha, 'other.md'), 'base\n');
  assert.equal(spawnSync('git', ['-C', repo, 'diff', '--cached', '--quiet']).status, 0);
  assert.equal(spawnSync('git', ['-C', repo, 'for-each-ref', '--contains', sha], { encoding: 'utf8' }).stdout, '');
  assert.ok(existsSync(join(runDir, 'freeze-index')));

  writeFileSync(join(repo, 'plan.md'), 'round two\n');
  const second = freeze('--parent', sha, 'plan.md');
  assert.equal(second.status, 0, second.stderr);
  const parent = spawnSync('git', ['-C', repo, 'rev-parse', `${second.stdout.trim()}^`], { encoding: 'utf8' }).stdout.trim();
  assert.equal(parent, sha);

  assert.equal(freeze('missing.md').status, 1);
  assert.equal(spawnSync(process.execPath, [join(HELPERS, 'freeze.mjs')], { cwd: repo }).status, 2);
});

test('freeze refuses a parent whose changed paths the new freeze does not name', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-pstack-freeze-parent-'));
  const repo = join(dir, 'repo');
  spawnSync('git', ['init', '-q', repo]);
  mkdirSync(join(repo, 'docs'));
  writeFileSync(join(repo, 'docs', 'a.md'), 'base a\n');
  writeFileSync(join(repo, 'b.md'), 'base b\n');
  spawnSync('git', ['-C', repo, 'add', '-A']);
  commit(repo, 'base');
  const runDir = join(dir, 'run');
  const freeze = (...args) => spawnSync(process.execPath, [join(HELPERS, 'freeze.mjs'), '--dir', runDir, ...args], { cwd: repo, encoding: 'utf8' });
  const show = (rev, path) => spawnSync('git', ['-C', repo, 'show', `${rev}:${path}`], { encoding: 'utf8' }).stdout;
  const commitOnly = (path, message) => {
    spawnSync('git', ['-C', repo, 'add', '--', path]);
    spawnSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--only', '-m', message, '--', path]);
  };

  writeFileSync(join(repo, 'docs', 'a.md'), 'iteration one\n');
  const first = freeze('docs/a.md').stdout.trim();
  writeFileSync(join(repo, 'b.md'), 'iteration two\n');

  const dropped = freeze('--parent', first, 'b.md');
  assert.equal(dropped.status, 1);
  assert.match(dropped.stderr, /1 path\(s\) differ between HEAD and --parent \S+ and hold uncommitted changes, but are not named.*: docs\/a\.md\./u);

  const named = freeze('--parent', first, 'docs/a.md', 'b.md');
  assert.equal(named.status, 0, named.stderr);
  assert.equal(show(named.stdout.trim(), 'docs/a.md'), 'iteration one\n');
  assert.equal(show(named.stdout.trim(), 'b.md'), 'iteration two\n');

  const byDirectory = freeze('--parent', first, 'docs', 'b.md');
  assert.equal(byDirectory.status, 0, byDirectory.stderr);

  const newChain = freeze('b.md');
  assert.equal(newChain.status, 0, newChain.stderr);

  writeFileSync(join(repo, 'c.md'), 'unrelated\n');
  commitOnly('c.md', 'owner commits an unrelated file');
  assert.match(freeze('--parent', first, 'b.md').stderr, /^1 path\(s\) .*: docs\/a\.md\./u);

  writeFileSync(join(repo, 'new.md'), 'untracked\n');
  const withUntracked = freeze('--parent', first, 'docs/a.md', 'new.md').stdout.trim();
  assert.match(freeze('--parent', withUntracked, 'docs/a.md', 'b.md').stderr, /: new\.md\./u);

  commitOnly('docs/a.md', 'owner commits iteration one');
  const afterOwnerCommit = freeze('--parent', first, 'b.md');
  assert.equal(afterOwnerCommit.status, 0, afterOwnerCommit.stderr);

  symlinkSync('b.md', join(repo, 'link'));
  commitOnly('link', 'owner adds a link');
  rmSync(join(repo, 'link'));
  symlinkSync('c.md', join(repo, 'link'));
  const linkFreeze = freeze('link').stdout.trim();
  rmSync(join(repo, 'link'));
  symlinkSync('docs/a.md', join(repo, 'link'));
  commitOnly('link', 'owner points the link elsewhere');
  const afterLinkCommit = freeze('--parent', linkFreeze, 'b.md');
  assert.equal(afterLinkCommit.status, 0, afterLinkCommit.stderr);
});

test('freeze refuses an unnamed parent path whose name git quotes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-pstack-freeze-quoted-'));
  const repo = join(dir, 'repo');
  spawnSync('git', ['init', '-q', repo]);
  writeFileSync(join(repo, 'quote"d.md'), 'base\n');
  writeFileSync(join(repo, 'b.md'), 'base\n');
  spawnSync('git', ['-C', repo, 'add', '-A']);
  commit(repo, 'base');
  const runDir = join(dir, 'run');
  const freeze = (...args) => spawnSync(process.execPath, [join(HELPERS, 'freeze.mjs'), '--dir', runDir, ...args], { cwd: repo, encoding: 'utf8' });

  writeFileSync(join(repo, 'quote"d.md'), 'iteration one\n');
  const first = freeze('quote"d.md').stdout.trim();
  writeFileSync(join(repo, 'b.md'), 'iteration two\n');
  const dropped = freeze('--parent', first, 'b.md');
  assert.equal(dropped.status, 1);
  assert.match(dropped.stderr, /: quote"d\.md\./u);
});

test('freeze names only the missing paths, running no git but a read-only HEAD probe first, and still freezes a tracked file deleted from disk', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-pstack-freeze-missing-'));
  const repo = join(dir, 'repo');
  spawnSync('git', ['init', '-q', repo]);
  writeFileSync(join(repo, 'plan.md'), 'base\n');
  writeFileSync(join(repo, 'gone.md'), 'base\n');
  mkdirSync(join(repo, 'notes'));
  writeFileSync(join(repo, 'notes', 'n.md'), 'base\n');
  spawnSync('git', ['-C', repo, 'add', '-A']);
  commit(repo, 'base');
  writeFileSync(join(repo, 'plan.md'), 'round one\n');
  rmSync(join(repo, 'gone.md'));
  rmSync(join(repo, 'notes'), { recursive: true });
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const gitCalls = join(dir, 'git-calls');
  const realGit = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
  writeFileSync(join(bin, 'git'), `#!/bin/sh\necho "$*" >> ${gitCalls}\nexec ${realGit} "$@"\n`, { mode: 0o755 });
  const freeze = (runDir, ...paths) =>
    spawnSync(process.execPath, [join(HELPERS, 'freeze.mjs'), '--dir', join(dir, runDir), ...paths], { cwd: repo, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });

  const missing = freeze('refused', 'plan.md', 'missing.md', 'gone.md', 'notes/', 'plan.md/child', 'plan.md/', 'docs/absent.md');
  assert.equal(missing.status, 1);
  assert.equal(missing.stderr, '4 path(s) not found in the working tree or HEAD: missing.md, plan.md/child, plan.md/, docs/absent.md\n');
  const calls = readFileSync(gitCalls, 'utf8').trim().split('\n');
  assert.ok(calls.length > 0 && calls.every((call) => call.startsWith('cat-file -e ')), `a refused freeze ran git beyond the HEAD probe: ${calls}`);

  const deletion = freeze('kept', 'plan.md', 'gone.md', 'notes/');
  assert.equal(deletion.status, 0, deletion.stderr);
  const tree = spawnSync('git', ['-C', repo, 'ls-tree', '--name-only', deletion.stdout.trim()], { encoding: 'utf8' }).stdout;
  assert.equal(tree, 'plan.md\n', 'the frozen tree records the deletion');
});

test('reply copies the final assistant text of a finished subagent and never overwrites', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-pstack-reply-'));
  const record = (id, content, extra = {}) => JSON.stringify({ type: 'assistant', ...extra, message: { id, role: 'assistant', stop_reason: null, ...extra.message, content } });
  const answer = '## Findings\n\n| a | b |\n|---|---|\n| 1 | 2 |';
  const start = [
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'review the plan' } }),
    record('m1', [{ type: 'text', text: 'Reading the plan.' }]),
    record('m1', [{ type: 'tool_use', id: 't1', name: 'Read', input: {} }], { message: { stop_reason: 'tool_use' } }),
    JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'plan text' }] } }),
  ];
  writeFileSync(join(dir, 'done.output'), [...start, record('m2', [{ type: 'thinking', thinking: '' }]), record('m2', [{ type: 'text', text: answer }], { message: { stop_reason: 'end_turn' } })].join('\n'));
  writeFileSync(join(dir, 'interim.output'), [...start, record('m2', [{ type: 'text', text: 'Now checking the log.' }])].join('\n'));
  writeFileSync(join(dir, 'limit.output'), [...start, record('m2', [{ type: 'text', text: "You've hit your weekly limit" }], { isApiErrorMessage: true, message: { model: '<synthetic>', stop_reason: 'stop_sequence' } })].join('\n'));
  const reply = (source, dest) => spawnSync(process.execPath, [join(HELPERS, 'reply.mjs'), join(dir, source), join(dir, dest)], { encoding: 'utf8' });

  const saved = reply('done.output', 'seat/answer.md');
  assert.equal(saved.status, 0, saved.stderr);
  assert.equal(read(dir, 'seat/answer.md'), answer);
  assert.equal(reply('done.output', 'seat/answer.md').status, 1, 'a saved reply is never overwritten');
  assert.match(reply('interim.output', 'interim.md').stderr, /has not finished/, 'text that does not end the turn');
  assert.match(reply('limit.output', 'limit.md').stderr, /API error/, 'an error the runtime wrote for the agent');
  const notified = (source, dest) => spawnSync(process.execPath, [join(HELPERS, 'reply.mjs'), '--notified', join(dir, source), join(dir, dest)], { encoding: 'utf8' });
  assert.equal(notified('interim.output', 'notified.md').status, 0, 'a reply the completion notice vouches for, whose stop reason was never written');
  assert.equal(read(dir, 'notified.md'), 'Now checking the log.');
  assert.match(notified('limit.output', 'limit-2.md').stderr, /API error/, 'the notice never vouches for an API error');
  writeFileSync(join(dir, 'calling.output'), [...start, record('m2', [{ type: 'text', text: 'Checking.' }]), record('m2', [{ type: 'tool_use', id: 't2', name: 'Read', input: {} }])].join('\n'));
  assert.match(notified('calling.output', 'calling.md').stderr, /has not finished/, 'the notice never vouches for a message that calls a tool');
  assert.equal(existsSync(join(dir, 'interim.md')) || existsSync(join(dir, 'limit.md')), false);
});

test("head points origin/HEAD at the working branch named by the config on origin's default branch", () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-pstack-head-'));
  const remote = join(dir, 'remote.git');
  const clone = join(dir, 'clone');
  const git = (cwd, ...args) => {
    const run = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    return run.stdout.trim();
  };
  git(dir, 'init', '--quiet', '--bare', '--initial-branch=main', remote);
  git(remote, 'config', 'receive.autogc', 'false');
  git(dir, 'clone', '--quiet', remote, clone);
  git(clone, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '--allow-empty', '-m', 'base');
  git(clone, 'push', '--quiet', 'origin', 'HEAD:main', 'HEAD:next');
  git(clone, 'remote', 'set-head', 'origin', 'main');
  mkdirSync(join(clone, '.agents'));
  const head = () => spawnSync(process.execPath, [join(HELPERS, 'head.mjs')], { cwd: clone, encoding: 'utf8' });
  const origin = () => git(clone, 'symbolic-ref', 'refs/remotes/origin/HEAD');

  writeFileSync(join(clone, '.agents/pstack.json'), JSON.stringify({ branch: 'main' }));
  assert.equal(head().stdout, '', 'no protected branch, so the default branch is the working branch');
  assert.equal(origin(), 'refs/remotes/origin/main');

  writeFileSync(join(clone, '.agents/pstack.json'), JSON.stringify({ branch: 'gone', protected: 'main' }));
  assert.equal(head().status, 0);
  assert.equal(origin(), 'refs/remotes/origin/main', 'a working branch origin lacks moves nothing');

  writeFileSync(join(clone, '.agents/pstack.json'), JSON.stringify({ branch: 'next', protected: 'main' }));
  const moved = head();
  assert.equal(moved.status, 0, moved.stderr);
  assert.match(moved.stdout, /origin\/HEAD now points at origin\/next/);
  assert.equal(origin(), 'refs/remotes/origin/next');
  assert.equal(head().stdout, '', 'a second run finds origin/HEAD in place and prints nothing');

  writeFileSync(join(clone, '.agents/pstack.json'), JSON.stringify({ branch: 'main' }));
  git(clone, 'add', '.agents/pstack.json');
  git(clone, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'retire next');
  git(clone, 'push', '--quiet', 'origin', 'HEAD:main');
  writeFileSync(join(clone, '.agents/pstack.json'), JSON.stringify({ branch: 'next', protected: 'main' }));
  const retired = head();
  assert.equal(retired.status, 0, retired.stderr);
  assert.match(retired.stdout, /cut from a retired branch\. Rebase onto origin\/main/, 'a checkout cut from the retired branch is told to rebase');
  assert.match(retired.stdout, /origin\/HEAD now points at origin\/main/, 'the config on origin\'s default branch wins over the stale checkout');
  assert.equal(origin(), 'refs/remotes/origin/main');
});

test('reread prints each changed sentence whole against its last snapshot', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-pstack-reread-'));
  const rules = 'Intro line.\n\n- **Delivery.** The user owns commits. Run the last check before handing back, and never push the protected branch without the owner asking for it in this request.\n- Keep plans in the repository.\n\nA repair edits the one owner, fixes every artifact that\nstill teaches the rejected shape, and regenerates\nand proves mirrors. Ask Dr. Smith before a release.\n';
  writeFileSync(join(dir, 'AGENTS.md'), rules);
  const reread = (...args) => spawnSync(process.execPath, [join(HELPERS, 'reread.mjs'), ...args], { cwd: dir, encoding: 'utf8' });
  const edit = (from, to) => writeFileSync(join(dir, 'AGENTS.md'), rules.replace(from, to));

  assert.match(reread('--dir', 'snap', 'AGENTS.md').stdout, /AGENTS\.md: first snapshot; read it in full/);
  assert.match(reread('--dir', 'snap', 'AGENTS.md').stdout, /AGENTS\.md: unchanged since /);
  edit('without the owner asking for it in this request', 'unless the owner asks');
  const changed = reread('--dir', 'snap', 'AGENTS.md').stdout;
  assert.match(changed, /1 sentence\(s\) removed and 1 added/);
  assert.ok(changed.includes('+ Run the last check before handing back, and never push the protected branch unless the owner asks.'), changed);
  assert.doesNotMatch(changed, /owns commits|Keep plans/);
  edit('and proves mirrors', 'but never proves mirrors');
  assert.ok(reread('--dir', 'snap', 'AGENTS.md').stdout.includes('+ A repair edits the one owner, fixes every artifact that still teaches the rejected shape, and regenerates but never proves mirrors.'), 'a hard-wrapped sentence prints whole');
  edit('Dr. Smith', 'Dr. Jones');
  assert.ok(reread('--dir', 'snap', 'AGENTS.md').stdout.includes('+ Ask Dr. Jones before a release.'), 'an abbreviation stays inside its sentence');

  const hook = (source) => spawnSync(process.execPath, [join(HELPERS, 'reread.mjs'), '--hook', 'AGENTS.md', 'missing.md', "it's spaced.md"], { cwd: dir, encoding: 'utf8', input: JSON.stringify({ session_id: `s-${source}`, source }) });
  assert.doesNotMatch(hook('startup').stdout, /^(?:AGENTS|missing)\.md:/mu, 'a fresh start only seeds the snapshots');
  assert.match(hook('compact').stdout, /AGENTS\.md: first snapshot; read it in full/, 'a compacted session with no snapshot rereads');
  edit('Keep plans in the repository.', 'Keep plans in the repository. Never stash.');
  const after = hook('startup').stdout;
  assert.ok(after.includes('+ Never stash.'), after);
  assert.ok(after.includes(`run node .agents/pstack/reread.mjs --dir ${realpathSync(dir)}/docs/plans/artifacts/reread/s-startup AGENTS.md`), after);
  assert.ok(after.includes("AGENTS.md missing.md 'it'\\''s spaced.md' before each gate"), after);
  const bare = spawnSync(process.execPath, [join(HELPERS, 'reread.mjs'), '--hook'], { cwd: dir, encoding: 'utf8', input: JSON.stringify({ session_id: 's-bare', source: 'startup' }) });
  assert.doesNotMatch(bare.stdout, /--dir/u, 'a hook given no files prints no command that would only print usage');
});

test('reread takes a folder for every Markdown file under it and prints one summary line for the folder', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-pstack-reread-folder-'));
  mkdirSync(join(dir, 'playbooks/references'), { recursive: true });
  writeFileSync(join(dir, 'playbooks/build.md'), 'Land each step on its own.\n');
  writeFileSync(join(dir, 'playbooks/plan.md'), 'Plan the steps.\n');
  writeFileSync(join(dir, 'playbooks/references/architecture.md'), 'Compare two targets.\n');
  writeFileSync(join(dir, 'playbooks/notes.txt'), 'Not a rule.\n');
  const reread = (...args) => spawnSync(process.execPath, [join(HELPERS, 'reread.mjs'), ...args], { cwd: dir, encoding: 'utf8' });

  const seeded = reread('--dir', 'snap', 'playbooks').stdout;
  assert.ok(seeded.includes('playbooks: 0 file(s) unchanged; first snapshot of playbooks/build.md, playbooks/plan.md, playbooks/references/architecture.md; read in full each one the run follows'), seeded);
  assert.equal(reread('--dir', 'snap', 'playbooks').stdout, 'playbooks: 3 file(s) unchanged\n');

  writeFileSync(join(dir, 'playbooks/build.md'), 'Land each step on its own. A fix to landed code lands first.\n');
  writeFileSync(join(dir, 'playbooks/triage.md'), 'Triage each issue.\n');
  rmSync(join(dir, 'playbooks/plan.md'));
  const changed = reread('--dir', 'snap', 'playbooks').stdout;
  assert.ok(changed.includes('playbooks: 1 file(s) unchanged; first snapshot of playbooks/triage.md; read in full each one the run follows; removed since their last snapshot: playbooks/plan.md'), changed);
  assert.ok(changed.includes('playbooks/build.md: 0 sentence(s) removed and 1 added'), changed);
  assert.ok(changed.includes('+ A fix to landed code lands first.'), changed);
  assert.doesNotMatch(changed, /notes\.txt/u);
  assert.equal(reread('--dir', 'snap', 'playbooks').stdout, 'playbooks: 3 file(s) unchanged\n', 'a removed file is reported once');

  const hook = spawnSync(process.execPath, [join(HELPERS, 'reread.mjs'), '--hook', 'playbooks'], { cwd: dir, encoding: 'utf8', input: JSON.stringify({ session_id: 's-folder', source: 'startup' }) });
  assert.doesNotMatch(hook.stdout, /^playbooks:/mu, 'a fresh start only seeds the folder');
  assert.ok(hook.stdout.includes('reread/s-folder playbooks before each gate'), hook.stdout);
});

test('reread --hook started in the main checkout reads the worktree the payload names and keeps its snapshots in the main checkout', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'sync-pstack-reread-tree-')));
  const [main, tree, other] = ['main', 'tree', 'other'].map((name) => join(dir, name));
  const git = (cwd, ...args) => assert.equal(spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd }).status, 0, args.join(' '));
  for (const repo of [main, other]) {
    mkdirSync(repo);
    git(repo, 'init', '--quiet');
  }
  writeFileSync(join(main, 'AGENTS.md'), 'Main rules.\n');
  git(main, 'add', 'AGENTS.md');
  git(main, 'commit', '--quiet', '-m', 'base');
  git(main, 'worktree', 'add', '--quiet', '--detach', tree);
  writeFileSync(join(tree, 'AGENTS.md'), 'Tree rules.\n');
  mkdirSync(join(tree, 'sub'));
  const hook = (session, cwd) => spawnSync(process.execPath, [join(HELPERS, 'reread.mjs'), '--hook', 'AGENTS.md'], { cwd: main, encoding: 'utf8', input: JSON.stringify({ cwd, session_id: session, source: 'startup' }) });
  const snapshots = join(main, 'docs/plans/artifacts/reread/s1');

  assert.ok(hook('s1', join(tree, 'sub')).stdout.includes(`--dir ${snapshots} AGENTS.md`), 'the printed directory is the main checkout\'s, by absolute path');
  assert.equal(readFileSync(join(snapshots, encodeURIComponent(join(tree, 'AGENTS.md'))), 'utf8'), 'Tree rules.\n', 'the snapshot holds the worktree\'s file');
  const later = spawnSync(process.execPath, [join(HELPERS, 'reread.mjs'), '--dir', snapshots, 'AGENTS.md'], { cwd: tree, encoding: 'utf8' });
  assert.match(later.stdout, /AGENTS\.md: unchanged since /, 'the session\'s own reread from its worktree compares against the hook\'s snapshot');
  hook('s2', other);
  assert.ok(existsSync(join(main, 'docs/plans/artifacts/reread/s2', encodeURIComponent(join(main, 'AGENTS.md')))), 'a session cwd in another repository keeps the checkout the hook started in');
});

test('reread --hook names on a reload line each loaded skill the compaction restore cut short, and only after a compaction', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-pstack-reread-reload-'));
  writeFileSync(join(dir, 'AGENTS.md'), 'Rules.\n');
  const typed = (uuid, name) => ({ type: 'user', uuid, message: { role: 'user', content: `<command-message>${name}</command-message>\n<command-name>/${name}</command-name>\n<command-args>go</command-args>` } });
  const launched = (uuid, name) => ({ type: 'user', uuid, message: { role: 'user', content: [{ type: 'tool_result', content: `Launching skill: ${name}` }] }, toolUseResult: { success: true, commandName: name } });
  const loaded = (parentUuid, text) => ({ type: 'user', isMeta: true, parentUuid, uuid: `${parentUuid}-text`, message: { role: 'user', content: [{ type: 'text', text }] } });
  const long = 'x'.repeat(20_001);
  const transcript = [
    typed('t1', 'best-api-review'),
    loaded('t1', `Base directory for this skill: /x/best-api-review\n${long}`),
    launched('t2', 'pstack:poteto-mode'),
    loaded('t2', `Base directory for this skill: /x/poteto-mode\n${long}`),
    typed('t3', 'compact'),
    { type: 'user', parentUuid: 't3', uuid: 't3-out', message: { role: 'user', content: '<local-command-stdout>Compacted</local-command-stdout>' } },
    launched('t4', 'plan-page'),
    { type: 'attachment', parentUuid: 't4', uuid: 't4-hook', attachment: { type: 'hook_success', hookName: 'PostToolUse:Skill' } },
    loaded('t4-hook', 'Base directory for this skill: /x/plan-page'),
    launched('t5', 'pstack:poteto-mode'),
    loaded('t5', '(Re-invocation of /pstack:poteto-mode, the previously loaded copy was truncated by compaction; the full instructions follow.)'),
    { type: 'system', subtype: 'compact_boundary', uuid: 'b1', content: 'Conversation compacted' },
    { type: 'user', isCompactSummary: true, uuid: 's1', message: { role: 'user', content: 'This session is being continued.' } },
  ];
  writeFileSync(join(dir, 'transcript.jsonl'), `${transcript.map((record) => JSON.stringify(record)).join('\n')}\nnot json\n`);
  const hook = (payload) => spawnSync(process.execPath, [join(HELPERS, 'reread.mjs'), '--hook', 'AGENTS.md'], { cwd: dir, encoding: 'utf8', input: JSON.stringify({ session_id: 's1', ...payload }) });

  const compacted = hook({ source: 'compact', transcript_path: join(dir, 'transcript.jsonl') });
  assert.equal(compacted.status, 0, compacted.stderr);
  assert.match(compacted.stdout, /^reload: best-api-review, pstack:poteto-mode\. The compaction restored only the first 20,000 characters of these skills; as the Long runs rule says, reload through the Skill tool each one whose mode you are running before your next step\.$/mu, 'plan-page fits the restore, so it is not reloaded');
  writeFileSync(join(dir, 'short.jsonl'), `${transcript.slice(5, 9).map((record) => JSON.stringify(record)).join('\n')}\n`);
  assert.doesNotMatch(hook({ source: 'compact', transcript_path: join(dir, 'short.jsonl') }).stdout, /reload:/, 'a session whose skills all fit the restore reloads none');
  assert.match(compacted.stdout, /^Instruction snapshots: /mu, 'the reload line comes with the snapshot lines, not instead of them');
  for (const source of ['startup', 'resume', 'clear']) {
    assert.doesNotMatch(hook({ source, transcript_path: join(dir, 'transcript.jsonl') }).stdout, /reload:/, `${source} prints no reload line`);
  }
  mkdirSync(join(dir, 'directory.jsonl'));
  for (const unreadable of ['gone.jsonl', 'directory.jsonl']) {
    const result = hook({ source: 'compact', transcript_path: join(dir, unreadable) });
    assert.equal(result.status, 0, `${unreadable} blocks the hook`);
    assert.doesNotMatch(result.stdout, /reload:/);
    assert.match(result.stdout, /^Instruction snapshots: /mu, unreadable);
  }
});

const levelsRun = (args, { claude = '', codex = '', agents = '' } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'levels-'));
  mkdirSync(join(dir, 'home/.claude'), { recursive: true });
  mkdirSync(join(dir, 'codex'));
  writeFileSync(join(dir, 'home/.claude/pstack-models.md'), claude);
  writeFileSync(join(dir, 'codex/pstack-models.md'), codex);
  writeFileSync(join(dir, 'AGENTS.md'), agents);
  const env = { ...process.env, HOME: join(dir, 'home'), CODEX_HOME: join(dir, 'codex') };
  return { dir, run: (more = []) => spawnSync(process.execPath, [join(HELPERS, 'levels.mjs'), ...args, ...more], { cwd: dir, encoding: 'utf8', env }) };
};

const LEVELS_LOG = [
  'ts\tphase\tdecision\twhy\tevidence\tresult',
  'T\tplan\tWrite the plan\tw\te\trecorded',
  'T\tlead\tclaude-opus-5-5 @high\tw\te\trecorded',
  'T\tbuild\tBuild step one\tw\te\tbuilt',
  'T\tpanel\tseats claude-opus-5-5 @high, gpt-6-astra @xhigh, gpt-6.1-sol @xhigh\tw\te\trecorded',
  'T\tlead\tclaude-opus-5-5 @xhigh\tw\te\trecorded',
  'T\tpanel\tseats #12 round 3: claude-opus-5-5 @high, codex:gpt-6-astra @high, codex:gpt-6.1-sol @xhigh (round 2, delta only)\tw\te\trecorded',
  "T\tpanel\tseats opus @high, codex:gpt-6-astra @xhigh missing, codex:gpt-6.1-sol @xhigh missing, opus same-family in astra's place\tw\te\tpartial",
  'T\tarchitect\trunners answered: opus @high, gpt-6-astra @xhigh and gpt-6.1-sol @xhigh each returned a design\tw\te\trecorded',
  'T\tlead\tgpt-6.1-sol @xhigh\tw\te\trecorded',
  'T\tbuild\tBuild step two\tw\te\tbuilt',
  '',
].join('\n');

const LEVELS_SHEET = [
  'interrogate reviewers: opus, codex:gpt-6-astra @high, codex:gpt-6.1-sol @xhigh',
  'default effort: high',
].join('\n');

test('levels lists each lead stretch and seat round below this session or the configured seats, with project rules raising or lowering a seat', () => {
  const agents = [
    '<!-- pstack:begin (rendered) -->',
    '- A seat such as `codex:gpt-6.1-sol @max` inside the block raises nothing.',
    '<!-- pstack:end -->',
    '- **Astra effort.** Seat `codex:gpt-6-astra @xhigh` instead of the sheet\'s `@high`.',
    '- **Sol effort.** No seat runs at xhigh here, so seat `codex:gpt-6.1-sol @high`.',
  ].join('\n');
  const { dir, run } = levelsRun(['--lead', 'claude-opus-5-5 @xhigh', 'log.tsv'], { claude: LEVELS_SHEET, agents });
  writeFileSync(join(dir, 'log.tsv'), LEVELS_LOG);
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout,
    [
      'target: lead claude-opus-5-5 @xhigh; seats opus @high, gpt-6-astra @xhigh, gpt-6.1-sol @high',
      'log.tsv',
      '  below line 2: lead unknown (no verified lead names its level)',
      '  below lines 4-5: lead claude-opus-5-5 @high (@high is below @xhigh)',
      '  at line 5: panel opus @high, gpt-6-astra @xhigh, gpt-6.1-sol @xhigh',
      '  at lines 7-9: lead claude-opus-5-5 @xhigh',
      '  below line 7: panel opus @high, gpt-6-astra @high, gpt-6.1-sol @xhigh (gpt-6-astra @high is below @xhigh)',
      '  below line 8: panel opus @high, gpt-6-astra @xhigh missing, gpt-6.1-sol @xhigh missing, opus same-family (gpt-6-astra missing; gpt-6.1-sol missing)',
      '  below line 11: lead gpt-6.1-sol @xhigh (led in Codex, and plans start in Claude Code)',
      '5 of 7 units below target',
      '',
    ].join('\n'),
  );
});

test('levels in a Codex session keeps Claude-led stretches and takes the session effort for a seat with none', () => {
  const codex = 'interrogate reviewers: opus, codex:gpt-6-astra @high, codex:gpt-6.1-sol @xhigh\ndefault effort: session';
  const { dir, run } = levelsRun(['--lead', 'gpt-6.1-sol @xhigh', 'log.tsv'], { codex });
  writeFileSync(join(dir, 'log.tsv'), LEVELS_LOG);
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^target: lead gpt-6\.1-sol @xhigh; seats opus @xhigh, gpt-6-astra @high, gpt-6\.1-sol @xhigh$/mu);
  assert.match(result.stdout, /^ {2}at lines 4-5: lead claude-opus-5-5 @high$/mu);
  assert.match(result.stdout, /^ {2}below line 5: panel .*\(opus @high is below @xhigh\)$/mu);
  assert.match(result.stdout, /^ {2}at line 11: lead gpt-6\.1-sol @xhigh$/mu);
});

test("levels caps the lead and every seat target at the project's maxEffort", () => {
  const { dir, run } = levelsRun(['--lead', 'claude-opus-5-5 @xhigh', 'log.tsv'], { claude: LEVELS_SHEET });
  writeFileSync(join(dir, 'log.tsv'), LEVELS_LOG);
  mkdirSync(join(dir, '.agents'));
  writeFileSync(join(dir, '.agents/pstack.json'), JSON.stringify({ maxEffort: 'high' }));
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^target: lead claude-opus-5-5 @high; seats opus @high, gpt-6-astra @high, gpt-6\.1-sol @high; maxEffort high$/mu);
  assert.match(result.stdout, /^ {2}at lines 4-5: lead claude-opus-5-5 @high$/mu, 'a stretch at the cap');
  assert.match(result.stdout, /^ {2}at line 7: panel /mu, 'seats at the cap');
  writeFileSync(join(dir, '.agents/pstack.json'), JSON.stringify({ maxEffort: 'xhigh' }));
  assert.match(run().stdout, /^target: lead claude-opus-5-5 @xhigh; seats opus @xhigh, gpt-6-astra @high, gpt-6\.1-sol @xhigh; maxEffort xhigh$/mu, 'a seat with no effort targets maxEffort, as cross.mjs runs it');
  writeFileSync(join(dir, '.agents/pstack.json'), JSON.stringify({ maxEffort: 'huge' }));
  assert.match(run().stderr, /maxEffort is "huge", not one of low, medium, high, xhigh, max/);
});

test('levels counts a round at target when its provider refused a seat for security, and below when the seat is missing', () => {
  const { dir, run } = levelsRun(['--lead', 'claude-opus-5-5 @xhigh', 'log.tsv'], { claude: 'interrogate reviewers: opus, codex:gpt-6.1-sol @xhigh\ndefault effort: xhigh' });
  const log = (seats) => ['ts\tphase\tdecision\twhy\tevidence\tresult', 'T\tlead\tclaude-opus-5-5 @xhigh\tw\te\trecorded', `T\tpanel\tseats ${seats}\tw\te\trecorded`, ''].join('\n');
  writeFileSync(join(dir, 'log.tsv'), log('opus @xhigh, codex:gpt-6.1-sol @xhigh skipped'));
  assert.match(run().stdout, /^ {2}at line 3: panel opus @xhigh, gpt-6\.1-sol @xhigh skipped$/mu);
  writeFileSync(join(dir, 'log.tsv'), log('opus @xhigh, codex:gpt-6.1-sol @xhigh missing'));
  assert.match(run().stdout, /^ {2}below line 3: panel .*\(gpt-6\.1-sol missing\)$/mu);
  writeFileSync(join(dir, 'log.tsv'), log('opus @xhigh skipped, codex:gpt-6.1-sol @xhigh'));
  assert.match(run().stdout, /^ {2}below line 3: panel .*\(opus missing\)$/mu, 'a Claude provider never skips a seat');
});

test('levels counts a seat that answered on its sheet fallback, and below when neither model answered', () => {
  const { dir, run } = levelsRun(['--lead', 'claude-opus-5-5 @high', 'log.tsv'], { claude: 'interrogate reviewers: opus @high, codex:gpt-6.2-astra @high or fable @high\ndefault effort: high' });
  const log = (seats) => ['ts\tphase\tdecision\twhy\tevidence\tresult', 'T\tlead\tclaude-opus-5-5 @high\tw\te\trecorded', `T\tpanel\tseats ${seats}\tw\te\trecorded`, ''].join('\n');
  writeFileSync(join(dir, 'log.tsv'), log('claude-opus-5-5 @high, claude-fable-5-2 @high'));
  assert.match(run().stdout, /^ {2}at line 3: panel /mu);
  writeFileSync(join(dir, 'log.tsv'), log('claude-opus-5-5 @high, gpt-6.2-astra @high'));
  assert.match(run().stdout, /^ {2}at line 3: panel /mu);
  writeFileSync(join(dir, 'log.tsv'), log('claude-opus-5-5 @high'));
  assert.match(run().stdout, /^ {2}below line 3: panel .*\(gpt-6\.2-astra missing\)$/mu);
});

test('levels reads an agy seat by its Gemini model, skipped when Gemini refused it and below when it ran under its sheet level', () => {
  const { dir, run } = levelsRun(['--lead', 'claude-opus-5-5 @xhigh', 'log.tsv'], { claude: 'interrogate reviewers: opus, codex:gpt-6.1-sol @xhigh, agy:gemini-4-neon @xhigh\ndefault effort: xhigh' });
  const log = (seats) => ['ts\tphase\tdecision\twhy\tevidence\tresult', 'T\tlead\tclaude-opus-5-5 @xhigh\tw\te\trecorded', `T\tpanel\tseats ${seats}\tw\te\trecorded`, ''].join('\n');
  writeFileSync(join(dir, 'log.tsv'), log('opus @xhigh, gpt-6.1-sol @xhigh, gemini-4-neon @xhigh'));
  assert.match(run().stdout, /^ {2}at line 3: panel opus @xhigh, gpt-6\.1-sol @xhigh, gemini-4-neon @xhigh$/mu);
  writeFileSync(join(dir, 'log.tsv'), log('opus @xhigh, gpt-6.1-sol @xhigh, agy:gemini-4-neon @xhigh skipped'));
  assert.match(run().stdout, /^ {2}at line 3: panel .*gemini-4-neon @xhigh skipped$/mu);
  writeFileSync(join(dir, 'log.tsv'), log('opus @xhigh, gpt-6.1-sol @xhigh, gemini-4-neon @high'));
  assert.match(run().stdout, /^ {2}below line 3: panel .*\(gemini-4-neon @high is below @xhigh\)$/mu);
  writeFileSync(join(dir, 'log.tsv'), log('opus @xhigh, gpt-6.1-sol @xhigh'));
  assert.match(run().stdout, /^ {2}below line 3: panel .*\(gemini-4-neon missing\)$/mu);
});

test("levels judges a co-lead row against the Claude Code sheet's co-lead line, whichever runtime reads the log", () => {
  const claude = 'interrogate reviewers: opus @high\nco-lead: agy:gemini-4-neon @xhigh or opus @high\ndefault effort: high';
  const codex = 'interrogate reviewers: opus @high\ndefault effort: high';
  const log = (colead) => ['ts\tphase\tdecision\twhy\tevidence\tresult', 'T\tlead\tclaude-opus-5-5 @high\tw\te\trecorded', `T\tcolead\t${colead}\tw\te\trecorded`, ''].join('\n');
  const { dir, run } = levelsRun(['--lead', 'claude-opus-5-5 @high', 'log.tsv'], { claude, codex });
  writeFileSync(join(dir, 'log.tsv'), log('agy:gemini-4-neon @xhigh'));
  assert.match(run().stdout, /^ {2}at line 3: colead gemini-4-neon @xhigh$/mu);
  assert.match(run(['--seats', 'opus @high']).stdout, /^ {2}at line 3: colead /mu, '--seats replaces only panel and arena seats');
  writeFileSync(join(dir, 'log.tsv'), log('opus @high'));
  assert.match(run().stdout, /^ {2}at line 3: colead opus @high$/mu, 'the fallback');
  writeFileSync(join(dir, 'log.tsv'), log('agy:gemini-4-neon @high'));
  assert.match(run().stdout, /^ {2}below line 3: colead .*\(gemini-4-neon @high is below @xhigh\)$/mu);
  const codexRun = levelsRun(['--lead', 'gpt-6.1-sol @xhigh', 'log.tsv'], { claude, codex });
  writeFileSync(join(codexRun.dir, 'log.tsv'), log('agy:gemini-4-neon @xhigh'));
  assert.match(codexRun.run().stdout, /^ {2}at line 3: colead gemini-4-neon @xhigh$/mu, 'a Codex session reads the Claude Code line');
  const noLine = levelsRun(['--lead', 'claude-opus-5-5 @high', 'log.tsv'], { claude: codex });
  writeFileSync(join(noLine.dir, 'log.tsv'), log('agy:gemini-4-neon @xhigh'));
  assert.match(noLine.run().stderr, /^the Claude Code models sheet has no "co-lead:" line, so line 3 cannot be judged$/mu);
});

test('levels refuses a missing log, a flag with no value, and a round the models sheet has no line for', () => {
  const { dir, run } = levelsRun([], { claude: 'arena runners: opus @high\ndefault effort: high' });
  writeFileSync(join(dir, 'log.tsv'), LEVELS_LOG);
  const usage = run();
  assert.equal(usage.status, 1);
  assert.match(usage.stderr, /^usage: levels\.mjs/u);
  assert.match(run(['--lead']).stderr, /^usage:/u);
  assert.match(run(['--lead', 'claude-opus-5-5 @xhigh', '--bogus', 'log.tsv']).stderr, /^usage:/u);
  assert.match(run(['--lead', 'claude-opus-5-5 @xhigh', 'gone.tsv']).stderr, /^gone\.tsv does not exist/u);
  const noLine = run(['--lead', 'claude-opus-5-5 @xhigh', 'log.tsv']);
  assert.equal(noLine.status, 1);
  assert.match(noLine.stderr, /no "interrogate reviewers:" line, so line 5 cannot be judged; pass --seats/u);
  const seats = run(['--lead', 'claude-opus-5-5 @xhigh', '--seats', 'opus @high, codex:gpt-6-astra @high, codex:gpt-6.1-sol @xhigh', 'log.tsv']);
  assert.equal(seats.status, 0, seats.stderr);
  assert.match(seats.stdout, /^ {2}at line 7: panel /mu);
});

const SCORE_LOG = 'docs/plans/2026-01-01-a.decisions.tsv';

function scorecard(rows, args = []) {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', {
    files: { [SCORE_LOG]: ['ts\tphase\tdecision\twhy\tevidence\tresult', ...rows.map(([decision, result = 'applied: fixed']) => `2026-01-01T00:00:00Z\tpanel\t${decision}\twhy\tevidence\t${result}`)].join('\n') + '\n' },
  });
  return run(process.execPath, [join(HELPERS, 'scorecard.mjs'), ...args], root);
}

const placed = (result) => result.stdout.trim().split('\n').map((line) => line.split('\t')[1]);

test('scorecard counts each seat a critical row names in brackets, and the lead', () => {
  const result = scorecard([
    ['seats opus, codex:gpt-6-astra @xhigh, codex:gpt-6.1-sol @xhigh', 'recorded'],
    ['critical [opus, codex:gpt-6-astra @xhigh]: the guard drops typing'],
    ['critical [gpt-6.1-sol]: the cache outlives a remount', 'dismissed: the remount clears it'],
    ['critical [lead]: the fallback hides a missing seat'],
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^\| opus \| 1 \| 1 \| 1 \| 0 \| 0 \| 0 \| 0 \|$/mu);
  assert.match(result.stdout, /^\| gpt-6-astra \| 1 \| 1 \| 1 \| 0 \| 0 \| 0 \| 0 \|$/mu);
  assert.match(result.stdout, /^\| gpt-6\.1-sol \| 1 \| 1 \| 0 \| 1 \| 0 \| 0 \| 0 \|$/mu);
  assert.match(result.stdout, /^\| lead \| - \| 1 \| 1 \| 0 \| 0 \| 0 \| 1 \|$/mu, 'an applied critical the lead alone raised');
  assert.match(result.stdout, /^3 of 3 critical rows placed; 0 unplaced\.$/mu);
});

test('scorecard credits a critical row that names a seat by the last word of its roster model', () => {
  const result = scorecard([
    ['seats opus, codex:gpt-6-luna @high', 'recorded'],
    ['critical [luna]: the guard drops typing'],
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^\| gpt-6-luna \| 1 \| 1 \| 1 \| 0 \| 0 \| 0 \| 1 \|$/mu);
  assert.match(result.stdout, /^1 of 1 critical rows placed; 0 unplaced\.$/mu);
});

test('scorecard maps seat letters and numbers to their round\'s roster order', () => {
  const result = scorecard(
    [
      ['seats gpt-6.1-sol @xhigh, opus, codex:gpt-6-astra @xhigh', 'recorded'],
      ['critical (B, C): the guard drops typing'],
      ['critical (seat 1): the cache outlives a remount'],
      ['critical (seat A, its finding 3): the cache outlives a remount'],
      ['critical (seats B and C, each its finding 1): the guard drops typing'],
      ['seats opus, codex:gpt-6-astra @xhigh missing, codex:gpt-6.1-sol @xhigh', 'recorded'],
      ['critical (seat 3): the cache outlives a remount'],
      ['critical (B): the guard drops typing'],
      ['critical (gpt-6-astra, sol): the guard drops typing'],
    ],
    ['--rows'],
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(placed(result), ['opus, gpt-6-astra', 'gpt-6.1-sol', 'gpt-6.1-sol', 'opus, gpt-6-astra', 'gpt-6.1-sol', 'unplaced', 'gpt-6.1-sol']);
});

test('scorecard credits a stand-in seat to the model that ran, not the seat it replaced', () => {
  const result = scorecard(
    [
      ["seats opus, codex:gpt-6-astra @xhigh missing, opus same-family in astra's place", 'recorded'],
      ['critical the guard drops typing (opus for gpt-6-astra)'],
    ],
    ['--rows'],
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(placed(result), ['opus']);
});

test('scorecard credits every model a critical row names, whatever severity it names it at', () => {
  const result = scorecard(
    [
      ['seats claude-opus-5-5 @high, gpt-6-astra @xhigh, gpt-6.1-sol @xhigh', 'recorded'],
      ['critical the guard drops typing (astra, sol; opus as a warning)'],
      ['critical (gpt-6-astra, gpt-6.1-sol; warning from opus): the relay tunnels CDP'],
      ['critical (opus 2b, astra 2, sol #4): the relay drops frames'],
      ['critical (sol; astra in part; opus as a nit): the fix still accepts +?'],
    ],
    ['--rows'],
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(placed(result), ['gpt-6-astra, gpt-6.1-sol, opus', 'gpt-6-astra, gpt-6.1-sol, opus', 'opus, gpt-6-astra, gpt-6.1-sol', 'gpt-6.1-sol, gpt-6-astra, opus']);
});

test('scorecard reads a bracketed seat list that says a seat raised the issue at a lower severity', () => {
  const result = scorecard(
    [
      ['seats opus @xhigh, gpt-6-astra @xhigh, gpt-6.1-sol @xhigh', 'recorded'],
      ['critical [gpt-6-astra, gpt-6.1-sol; opus as warning]: refusals checked only the first line'],
    ],
    ['--rows'],
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(placed(result), ['gpt-6-astra, gpt-6.1-sol, opus']);
});

test('scorecard lists a critical row it cannot place instead of crediting a seat', () => {
  const result = scorecard([
    ['seats opus, codex:gpt-6.1-sol @xhigh', 'recorded'],
    ['critical (sol): the cache outlives a remount'],
    ['critical the parser drops rows'],
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^1 of 2 critical rows placed; 1 unplaced, such as:\n- docs\/plans\/2026-01-01-a\.decisions\.tsv:4$/mu);
  assert.match(result.stdout, /^\| opus \| 1 \| 0 \|/mu);
});

test('scorecard counts fixes by whether they name the commit that introduced the bug, and whether a panel reviewed that commit', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', { config: { branch: 'next', plans: 'docs/plans' } });
  const at = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const land = (message, days, files = {}) => {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    run('git', ['add', '-A'], root);
    const when = at(days);
    spawnSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', message], { env: { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } });
    return run('git', ['rev-parse', 'HEAD'], root).stdout.trim();
  };
  const header = 'ts\tphase\tdecision\twhy\tevidence\tresult\n';
  const seats = '2026-01-01T00:00:00Z\tpanel\tseats opus\twhy\tevidence\trecorded\n';
  const reviewed = land('feat(a): add a\n\nPlan: docs/plans/2026-01-01-a.md', 4, { 'docs/plans/2026-01-01-a.md': '# A\n', 'docs/plans/2026-01-01-a.decisions.tsv': header + seats });
  const unreviewed = land('feat(b): add b\n\nPlan: docs/plans/2026-01-01-b.md', 2, { 'docs/plans/2026-01-01-b.md': '# B\n', 'docs/plans/2026-01-01-b.decisions.tsv': header });
  land('docs(b): review b late', 1, { 'docs/plans/2026-01-01-b.decisions.tsv': header + seats });
  land(`fix(a): repair a and b\n\nIntroduced-by: ${reviewed}\nIntroduced-by: ${unreviewed}`, 0);
  land('fix: repair c\n\nIntroduced-by: none', 0);
  land('fix(d)!: repair d', 0);
  land('feat(e): add e', 0);
  land(`fix(revert): undo session aaaaaaaa\n\nIntroduced-by: ${reviewed}`, 0);
  run('git', ['checkout', '-q', '-b', 'side', 'HEAD~1'], root);
  land('fix(f): repair f', 0);
  run('git', ['checkout', '-q', '-'], root);
  run('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'merge', '-q', '--no-ff', '-m', 'Merge pull request #1 from side', 'side'], root);
  run('git', ['update-ref', 'refs/remotes/origin/next', 'HEAD'], root);
  const result = run(process.execPath, [join(HELPERS, 'scorecard.mjs')], root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^\| \d{4}-W\d{2} \| 4 \| 1 \(25%\) \| 1 \(25%\) \| 2 \| 3\.0 \| 1 of 2 \| 1 \|$/mu, 'a merged fix counts, none gets its share, and a revert counts only as a revert');
});

// A bare origin whose next holds the helpers and a trunk config whose checkout
// ignores the plans artifacts, with clones of it standing in for main checkouts.
function ledgerRemote(files = {}) {
  const { dir, env, run } = sandbox();
  const origin = join(dir, 'origin.git');
  const seed = join(dir, 'seed');
  run('git', ['init', '-q', '--bare', '-b', 'next', origin]);
  // A push starts a detached `git maintenance` that repacks the objects a later local clone hardlinks.
  run('git', ['--git-dir', origin, 'config', 'receive.autogc', 'false']);
  run('git', ['clone', '-q', origin, seed]);
  run('git', ['-C', seed, 'checkout', '-q', '-b', 'next']);
  cpSync(HELPERS, join(seed, '.agents/pstack'), { recursive: true });
  writeFileSync(join(seed, '.agents/pstack.json'), `${JSON.stringify({ branch: 'next', plans: 'docs/plans', delivery: 'trunk' })}\n`);
  writeFileSync(join(seed, '.gitignore'), 'docs/plans/artifacts/\n');
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(seed, path)), { recursive: true });
    writeFileSync(join(seed, path), text);
  }
  run('git', ['-C', seed, 'add', '.']);
  commit(seed, 'seed');
  run('git', ['-C', seed, 'push', '-q', 'origin', 'next']);
  const clone = (name) => {
    run('git', ['clone', '-q', '-b', 'next', origin, join(dir, name)]);
    return join(dir, name);
  };
  const setup = (cwd) => run(process.execPath, [join(cwd, '.agents/pstack/setup.mjs')], cwd);
  const onRef = () => execFileSync('git', ['--git-dir', origin, 'show', 'refs/pstack/ledger:suggested-tasks.decisions.tsv'], { encoding: 'utf8', maxBuffer: 1 << 30 });
  const next = () => run('git', ['--git-dir', origin, 'rev-parse', 'next']).stdout;
  return { clone, env, next, onRef, run, seed, setup };
}

test('setup keeps the ignored ledger in step with refs/pstack/ledger on origin and never commits to the branch', () => {
  const { clone, next, onRef, run, setup } = ledgerRemote();
  const ledger = 'docs/plans/artifacts/suggested-tasks.decisions.tsv';
  // Past spawnSync's 1 MB default buffer, as a real ledger grows.
  const old = Array.from({ length: 3000 }, (_, i) => `row ${i} ${'x'.repeat(400)}\n`).join('');
  const base = next();
  const main = clone('main');
  mkdirSync(join(main, 'docs/plans/artifacts'), { recursive: true });
  writeFileSync(join(main, ledger), `${old}row 1\nhalf a ro`);

  const first = setup(main);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /pushed 3001 ledger row\(s\) to refs\/pstack\/ledger/);
  assert.equal(onRef(), `${old}row 1\n`, 'a row another session is still writing stays local');

  const other = clone('other');
  mkdirSync(join(other, 'docs/plans/artifacts'), { recursive: true });
  writeFileSync(join(other, ledger), 'row from another clone\n');
  const elsewhere = setup(other);
  assert.match(elsewhere.stdout, /added 3001 ledger row\(s\) from refs\/pstack\/ledger/);
  assert.match(elsewhere.stdout, /pushed 1 ledger row\(s\)/);
  assert.equal(readFileSync(join(other, ledger), 'utf8'), `${old}row 1\nrow from another clone\n`, "the ref's rows come first");

  writeFileSync(join(main, ledger), `${old}row 1\nhalf a row\n`);
  const again = setup(main);
  assert.match(again.stdout, /added 1 ledger row\(s\)/);
  assert.match(again.stdout, /pushed 1 ledger row\(s\)/);
  assert.equal(readFileSync(join(main, ledger), 'utf8'), `${old}row 1\nrow from another clone\nhalf a row\n`);
  assert.equal(onRef(), `${old}row 1\nrow from another clone\nhalf a row\n`);
  assert.equal(setup(main).stdout, '', 'a ledger in step with the ref changes nothing');
  assert.equal(next(), base, 'no session start commits to next');
  assert.equal(run('git', ['-C', main, 'status', '--porcelain']).stdout, '');
});

test("setup gives every clone the ref's rows in the ref's order and moves a row the ref's state forbids to the refused file", () => {
  const { clone, onRef, run, setup } = ledgerRemote();
  const ledger = 'docs/plans/artifacts/suggested-tasks.decisions.tsv';
  const chip = (ts, evidence, result) => `${ts}\tchip\tt_0000000a Keep one ledger order\tclones disagree\t${evidence}\t${result}\n`;
  const a = clone('a');
  const b = clone('b');
  for (const main of [a, b]) {
    mkdirSync(join(main, 'docs/plans/artifacts'), { recursive: true });
    writeFileSync(join(main, ledger), `ts\tphase\tdecision\twhy\tevidence\tresult\n${chip('2026-11-01T00:00:00Z', 'writes: README.md; topic: ledger; priority: P1; repro: steps', 'offered')}`);
  }
  assert.match(setup(a).stdout, /pushed 2 ledger row\(s\)/);
  // Written straight into each file, as an offline clone or an older helper would.
  const dismissed = chip('2026-11-02T00:00:00Z', 'owner declined it', 'dismissed declined');
  const started = chip('2026-11-03T00:00:00Z', 'session: s1', 'started');
  appendFileSync(join(a, ledger), dismissed);
  appendFileSync(join(b, ledger), started);

  setup(a);
  const refused = setup(b);
  assert.equal(refused.status, 0, refused.stderr);
  assert.match(refused.stdout, /refused t_0000000a started: .*t_0000000a is dismissed declined, so it cannot be started/);
  setup(a);
  assert.equal(readFileSync(join(a, ledger), 'utf8'), readFileSync(join(b, ledger), 'utf8'), 'both clones hold the same bytes');
  assert.equal(readFileSync(join(b, ledger), 'utf8'), onRef());
  for (const main of [a, b]) {
    const brief = run(process.execPath, [join(main, '.agents/pstack/decisions-check.mjs'), 'chips', 'brief', 't_0000000a'], main);
    assert.match(brief.stderr, /t_0000000a is dismissed declined, so there is nothing to start/, `${main} reads the chip as dismissed`);
  }
  const kept = readFileSync(join(b, 'docs/plans/artifacts/suggested-tasks.refused.tsv'), 'utf8');
  assert.ok(kept.startsWith(started.trimEnd()), "the refused file keeps B's started row");
  assert.match(kept, /\tt_0000000a started: t_0000000a is dismissed declined, so it cannot be started\n$/u, 'with its reason in a last cell');
});

test("a push the ref moved under after its append pulled fetches and checks again, so another clone's dismissal still wins", async () => {
  const { clone, onRef, setup } = ledgerRemote();
  const ledger = 'docs/plans/artifacts/suggested-tasks.decisions.tsv';
  const chip = (ts, evidence, result) => `${ts}\tchip\tt_0000000a Keep one ledger order\tclones disagree\t${evidence}\t${result}\n`;
  const a = clone('a');
  mkdirSync(join(a, 'docs/plans/artifacts'), { recursive: true });
  writeFileSync(join(a, ledger), `ts\tphase\tdecision\twhy\tevidence\tresult\n${chip('2026-11-01T00:00:00Z', 'writes: README.md; topic: ledger; priority: P1; repro: steps', 'offered')}`);
  assert.match(setup(a).stdout, /pushed 2 ledger row\(s\)/);
  const b = clone('b');
  mkdirSync(join(b, 'docs/plans/artifacts'), { recursive: true });
  assert.match(setup(b).stdout, /added 2 ledger row\(s\)/);

  const { syncLedger } = await import(join(a, '.agents/pstack/tasks.mjs'));
  const lock = { touch() {}, release() {} };
  const pulled = syncLedger(join(a, ledger), ['-C', a], lock, { push: false });
  const dismissed = chip('2026-11-02T00:00:00Z', 'owner declined it', 'dismissed declined');
  appendFileSync(join(b, ledger), dismissed);
  assert.match(setup(b).stdout, /pushed 1 ledger row\(s\)/);
  appendFileSync(join(a, ledger), chip('2026-11-03T00:00:00Z', 'session: s1', 'started'));

  const pushed = syncLedger(join(a, ledger), ['-C', a], lock, { checked: pulled.tip });
  assert.deepEqual(pushed.refused.map(({ problem }) => problem), ['t_0000000a started: t_0000000a is dismissed declined, so it cannot be started']);
  assert.equal(pushed.pending, 0);
  assert.ok(onRef().endsWith(dismissed), "the ref ends with B's dismissal");
  assert.equal(readFileSync(join(a, ledger), 'utf8'), onRef());
});

test('two appends that race in one clone take turns under the ledger lock, so a topic gets one open design question', async () => {
  const { clone, env } = ledgerRemote();
  const ledger = 'docs/plans/artifacts/suggested-tasks.decisions.tsv';
  const main = clone('main');
  mkdirSync(join(main, 'docs/plans/artifacts'), { recursive: true });
  const lock = join(main, '.git', 'pstack-ledger.lock');
  mkdirSync(lock);
  const offer = (id) => {
    const child = spawn(process.execPath, [join(main, '.agents/pstack/decisions-check.mjs'), 'append', ledger, 'chip', `${id} Decide the ledger order`, 'finding', 'writes: README.md; topic: ledger; kind: decide; priority: P1; repro: steps', 'offered'], { cwd: main, env });
    const output = { stderr: '' };
    child.stderr.on('data', (chunk) => {
      output.stderr += chunk;
    });
    const exited = once(child, 'close').then(([code]) => ({ code, ...output }));
    const running = new Promise((resolve) => {
      child.stderr.on('data', () => output.stderr.includes('Waiting for the ledger lock') && resolve());
      exited.then(resolve);
    });
    return { exited, running };
  };
  const appends = [offer('t_0000000b'), offer('t_0000000c')];
  await Promise.all(appends.map((each) => each.running));
  rmSync(lock, { recursive: true });
  const results = await Promise.all(appends.map((each) => each.exited));
  assert.deepEqual(results.map((each) => each.code).sort(), [0, 1], results.map((each) => each.stderr).join('\n'));
  assert.match(results.find((each) => each.code === 1).stderr, /topic ledger already has the open design question t_0000000[bc]/);
});

test("setup keeps the ledger on the companion repository's origin once the checkout holds its git directory", () => {
  const { clone, run, seed, setup } = ledgerRemote();
  const ledger = 'docs/plans/artifacts/suggested-tasks.decisions.tsv';
  const main = clone('main');
  const companion = join(dirname(seed), 'companion.git');
  run('git', ['init', '-q', '--bare', companion]);
  run('git', ['-C', main, 'init', '-q', '--bare', '.git-private']);
  run('git', ['--git-dir', join(main, '.git-private'), 'remote', 'add', 'origin', companion]);
  const config = JSON.parse(readFileSync(join(main, '.agents/pstack.json'), 'utf8'));
  writeFileSync(join(main, '.agents/pstack.json'), JSON.stringify({ ...config, companion: { dir: '.git-private', list: '.gitprivate' } }));
  mkdirSync(join(main, 'docs/plans/artifacts'), { recursive: true });
  writeFileSync(join(main, ledger), 'team row\n');

  const started = setup(main);
  assert.equal(started.status, 0, started.stderr);
  assert.match(started.stdout, /pushed 1 ledger row\(s\)/);
  assert.equal(run('git', ['--git-dir', companion, 'show', 'refs/pstack/ledger:suggested-tasks.decisions.tsv']).stdout, 'team row\n');
  assert.notEqual(spawnSync('git', ['-C', main, 'ls-remote', '--exit-code', 'origin', 'refs/pstack/ledger']).status, 0, 'the public origin gets no ledger');
});

test('setup skips the ledger sync when the config names a companion the main checkout lacks, and never pushes the ledger to the public origin', () => {
  const { clone, setup } = ledgerRemote();
  const ledger = 'docs/plans/artifacts/suggested-tasks.decisions.tsv';
  const main = clone('main');
  const config = JSON.parse(readFileSync(join(main, '.agents/pstack.json'), 'utf8'));
  writeFileSync(join(main, '.agents/pstack.json'), JSON.stringify({ ...config, companion: { dir: '.git-private', list: '.gitprivate' } }));
  mkdirSync(join(main, 'docs/plans/artifacts'), { recursive: true });
  writeFileSync(join(main, ledger), 'team row\n');

  const started = setup(main);
  assert.equal(started.status, 0, started.stderr);
  assert.match(started.stdout, /^setup\.mjs: skipped the ledger sync, because this clone has no \.git-private yet$/mu);
  assert.notEqual(spawnSync('git', ['-C', main, 'ls-remote', '--exit-code', 'origin', 'refs/pstack/ledger']).status, 0, 'the public origin gets no ledger');
  assert.equal(readFileSync(join(main, ledger), 'utf8'), 'team row\n');
});

test('setup does nothing in a read-only session, so a smoke neither pushes the ledger nor moves the branch', () => {
  const { clone } = ledgerRemote();
  const main = clone('main');
  mkdirSync(join(main, 'docs/plans/artifacts'), { recursive: true });
  writeFileSync(join(main, 'docs/plans/artifacts/suggested-tasks.decisions.tsv'), 'local row\n');
  const started = spawnSync(process.execPath, [join(main, '.agents/pstack/setup.mjs')], { cwd: main, encoding: 'utf8', env: { ...process.env, PSTACK_READ_ONLY: '1' } });
  assert.equal(started.status, 0, started.stderr);
  assert.equal(started.stdout, 'setup.mjs: skipped, because this session is read-only\n');
  assert.notEqual(spawnSync('git', ['-C', main, 'ls-remote', '--exit-code', 'origin', 'refs/pstack/ledger']).status, 0, 'origin gets no ledger row');
});

test("setup moves the rows at the ledger's former path into the ledger, so next can trade that file for a link", () => {
  const former = 'docs/plans/suggested-tasks.decisions.tsv';
  const { clone, next, onRef, run, seed, setup } = ledgerRemote({ [former]: 'row 0\n' });
  const main = clone('main');
  writeFileSync(join(main, former), 'row 0\nrow 1\n');
  run('git', ['-C', seed, 'rm', '-q', '--cached', former]);
  rmSync(join(seed, former));
  symlinkSync('artifacts/suggested-tasks.decisions.tsv', join(seed, former));
  run('git', ['-C', seed, 'add', former]);
  commit(seed, 'move the ledger');
  run('git', ['-C', seed, 'push', '-q', 'origin', 'next']);
  const moved = next();

  const first = setup(main);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /moved 2 ledger row\(s\) from docs\/plans\/suggested-tasks\.decisions\.tsv/);
  assert.match(first.stdout, /pushed 2 ledger row\(s\)/);
  assert.match(first.stdout, /fast-forwarded next by 1 commit/, "the former path's unlanded row no longer blocks the fast-forward");
  assert.ok(lstatSync(join(main, former)).isSymbolicLink());
  assert.equal(readFileSync(join(main, former), 'utf8'), 'row 0\nrow 1\n', 'a helper that predates the move reads the ledger through the link');
  appendFileSync(join(main, former), 'row 2\n');
  assert.match(setup(main).stdout, /pushed 1 ledger row\(s\)/, 'and its appends reach the ref');
  assert.equal(onRef(), 'row 0\nrow 1\nrow 2\n');
  assert.equal(next(), moved, 'no session start commits to next');
  assert.equal(run('git', ['-C', main, 'status', '--porcelain']).stdout, '');
});

test('setup refuses a flag where --install or --env needs its value, so a chained command stops', () => {
  const { dir, run } = sandbox();
  for (const args of [['--install'], ['--install', '--env'], ['--install', '--hook'], ['--env', '--hook']]) {
    const result = run(process.execPath, [join(HELPERS, 'setup.mjs'), ...args], dir);
    assert.equal(result.status, 2, `setup.mjs ${args.join(' ')} exits 2`);
    assert.match(result.stderr, /^Usage: node \.agents\/pstack\/setup\.mjs/);
  }
});

test("setup prints a person's local sheet lines from the main checkout to a Claude Code session, and nothing to Codex", () => {
  const { clone, env, run, setup } = ledgerRemote();
  const main = clone('main');
  mkdirSync(join(main, '.claude'), { recursive: true });
  writeFileSync(join(main, '.claude/pstack-models.local.md'), 'A note.\nclip: opus @medium\n');
  const tree = join(main, '../tree');
  run('git', ['-C', main, 'worktree', 'add', '-q', '--detach', tree]);
  assert.match(setup(tree).stdout, /pstack-models\.local\.md overrides these lines of \.claude\/pstack-models\.md for this person:\nclip: opus @medium\n/u);
  const codex = spawnSync(process.execPath, [join(tree, '.agents/pstack/setup.mjs')], { cwd: tree, encoding: 'utf8', env: { ...env, CLAUDE_CODE_SESSION_ID: '', CODEX_THREAD_ID: 'thread' } });
  assert.equal(codex.status, 0, codex.stderr);
  assert.doesNotMatch(codex.stdout, /pstack-models\.local\.md/u);
});
