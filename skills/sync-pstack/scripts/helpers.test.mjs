import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { appendFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CONFIG, commit, project } from './test-sandbox.mjs';
import { sandbox } from './test-cli.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HELPERS = join(HERE, '../assets/pstack');

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
  assert.equal(head().stdout, '');
  assert.equal(origin(), 'refs/remotes/origin/main');

  writeFileSync(join(clone, '.agents/pstack.json'), JSON.stringify({ branch: 'gone', protected: 'main' }));
  assert.equal(head().status, 0);
  assert.equal(origin(), 'refs/remotes/origin/main');

  writeFileSync(join(clone, '.agents/pstack.json'), JSON.stringify({ branch: 'next', protected: 'main' }));
  const moved = head();
  assert.equal(moved.status, 0, moved.stderr);
  assert.match(moved.stdout, /origin\/HEAD now points at origin\/next/);
  assert.equal(origin(), 'refs/remotes/origin/next');
  assert.equal(head().stdout, '');

  writeFileSync(join(clone, '.agents/pstack.json'), JSON.stringify({ branch: 'main' }));
  git(clone, 'add', '.agents/pstack.json');
  git(clone, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'retire next');
  git(clone, 'push', '--quiet', 'origin', 'HEAD:main');
  writeFileSync(join(clone, '.agents/pstack.json'), JSON.stringify({ branch: 'next', protected: 'main' }));
  const retired = head();
  assert.equal(retired.status, 0, retired.stderr);
  assert.match(retired.stdout, /cut from a retired branch\. Rebase onto origin\/main/);
  assert.equal(origin(), 'refs/remotes/origin/main');
});

function ledgerRemote(extra = {}) {
  const { dir, env, run, cli } = sandbox();
  const origin = join(dir, 'origin.git');
  run('git', ['init', '-q', '--bare', origin]);
  const seed = project(dir, 'seed', {
    config: { ...CONFIG, delivery: 'trunk', plans: 'docs/plans' },
    agents: '# App\n',
    files: { '.gitignore': 'docs/plans/artifacts/\n', 'README.md': 'app\n', ...extra },
  });
  assert.equal(cli('apply', seed).status, 0);
  run('git', ['-C', seed, 'add', '-A']);
  commit(seed, 'init');
  run('git', ['-C', seed, 'remote', 'add', 'origin', origin]);
  run('git', ['-C', seed, 'push', '-q', 'origin', 'HEAD:next']);
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
  const old = Array.from({ length: 3000 }, (_, i) => `row ${i} ${'x'.repeat(400)}\n`).join('');
  const base = next();
  const main = clone('main');
  mkdirSync(join(main, 'docs/plans/artifacts'), { recursive: true });
  writeFileSync(join(main, ledger), `${old}row 1\nhalf a ro`);

  const first = setup(main);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /pushed 3001 ledger row\(s\) to refs\/pstack\/ledger/);
  assert.equal(onRef(), `${old}row 1\n`);

  const other = clone('other');
  mkdirSync(join(other, 'docs/plans/artifacts'), { recursive: true });
  writeFileSync(join(other, ledger), 'row from another clone\n');
  const elsewhere = setup(other);
  assert.match(elsewhere.stdout, /added 3001 ledger row\(s\) from refs\/pstack\/ledger/);
  assert.match(elsewhere.stdout, /pushed 1 ledger row\(s\)/);
  assert.equal(readFileSync(join(other, ledger), 'utf8'), `${old}row 1\nrow from another clone\n`);

  writeFileSync(join(main, ledger), `${old}row 1\nhalf a row\n`);
  const again = setup(main);
  assert.match(again.stdout, /added 1 ledger row\(s\)/);
  assert.match(again.stdout, /pushed 1 ledger row\(s\)/);
  assert.equal(onRef(), `${old}row 1\nrow from another clone\nhalf a row\n`);
  assert.equal(setup(main).stdout, '');
  assert.equal(next(), base);
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
  const dismissed = chip('2026-11-02T00:00:00Z', 'owner declined it', 'dismissed declined');
  const started = chip('2026-11-03T00:00:00Z', 'session: s1', 'started');
  appendFileSync(join(a, ledger), dismissed);
  appendFileSync(join(b, ledger), started);

  setup(a);
  const refused = setup(b);
  assert.equal(refused.status, 0, refused.stderr);
  assert.match(refused.stdout, /refused t_0000000a started: .*t_0000000a is dismissed declined, so it cannot be started/);
  setup(a);
  assert.equal(readFileSync(join(a, ledger), 'utf8'), readFileSync(join(b, ledger), 'utf8'));
  assert.equal(readFileSync(join(b, ledger), 'utf8'), onRef());
  const kept = readFileSync(join(b, 'docs/plans/artifacts/suggested-tasks.refused.tsv'), 'utf8');
  assert.ok(kept.startsWith(started.trimEnd()));
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
});

test('setup skips the ledger sync when the config names a companion the main checkout lacks', () => {
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
});

test('setup does nothing in a read-only session', () => {
  const { clone } = ledgerRemote();
  const main = clone('main');
  const started = spawnSync(process.execPath, [join(main, '.agents/pstack/setup.mjs')], { cwd: main, encoding: 'utf8', env: { ...process.env, PSTACK_READ_ONLY: '1' } });
  assert.equal(started.status, 0, started.stderr);
  assert.equal(started.stdout, 'setup.mjs: skipped, because this session is read-only\n');
});

test("setup moves the rows at the ledger's former path into the ledger", () => {
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
  assert.match(first.stdout, /moved 2 ledger row\(s\)/);
  assert.ok(lstatSync(join(main, former)).isSymbolicLink());
  assert.equal(onRef(), 'row 0\nrow 1\n');
  assert.equal(next(), moved);
});

test('setup refuses a flag where --install or --env needs its value', () => {
  const { dir, run } = sandbox();
  for (const args of [['--install'], ['--install', '--env'], ['--install', '--hook'], ['--env', '--hook']]) {
    const result = run(process.execPath, [join(HELPERS, 'setup.mjs'), ...args], dir);
    assert.equal(result.status, 2);
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

test('guard handles native Antigravity PreToolUse payloads and fails open on conflicted or invalid .agents/pstack.json', () => {
  const { clone } = ledgerRemote();
  const main = clone('main');
  const guard = join(main, '.agents/pstack/guard.mjs');
  const invoke = (payload) => spawnSync(process.execPath, [guard], { cwd: main, encoding: 'utf8', input: JSON.stringify(payload) });

  const denied = invoke({
    conversationId: 'c1',
    cwd: main,
    hookEventName: 'PreToolUse',
    toolCall: { id: 't1', name: 'run_command', args: { CommandLine: 'git push --force origin next' } },
  });
  assert.equal(denied.status, 0, denied.stderr);
  assert.equal(JSON.parse(denied.stdout).decision, 'deny');
  assert.match(JSON.parse(denied.stdout).reason, /guard\.mjs: agents never force-push/u);

  const allowed = invoke({
    conversationId: 'c1',
    cwd: main,
    hookEventName: 'PreToolUse',
    toolCall: { id: 't2', name: 'run_command', args: { CommandLine: 'git status' } },
  });
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.deepEqual(JSON.parse(allowed.stdout), { decision: 'allow' });

  // Regression: conflicted or invalid .agents/pstack.json must fail open so git rebase --continue and edit_file never deadlock.
  writeFileSync(join(main, '.agents/pstack.json'), '{\n<<<<<<< HEAD\n  "branch": "next"\n=======\n  "branch": "next",\n  "tag": "v0.9.145"\n>>>>>>> next\n}\n');
  const editConflicted = invoke({
    conversationId: 'c1',
    cwd: main,
    hookEventName: 'PreToolUse',
    toolCall: { id: 't3', name: 'edit_file', args: { Path: join(main, '.agents/pstack.json') } },
  });
  assert.equal(editConflicted.status, 0, editConflicted.stderr);
  assert.deepEqual(JSON.parse(editConflicted.stdout), { decision: 'allow' });

  const rebaseContinue = invoke({
    conversationId: 'c1',
    cwd: main,
    hookEventName: 'PreToolUse',
    toolCall: { id: 't4', name: 'run_command', args: { CommandLine: 'git rebase --continue' } },
  });
  assert.equal(rebaseContinue.status, 0, rebaseContinue.stderr);
  assert.deepEqual(JSON.parse(rebaseContinue.stdout), { decision: 'allow' });

  const claudeEdit = invoke({ tool_name: 'Edit', tool_input: { file_path: join(main, '.agents/pstack.json') }, cwd: main });
  assert.equal(claudeEdit.status, 0, claudeEdit.stderr);
  assert.equal(claudeEdit.stdout, '');
});
