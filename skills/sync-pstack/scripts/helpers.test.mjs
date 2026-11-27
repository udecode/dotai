import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readProjectConfig } from '../assets/pstack/lead.mjs';
import { CONFIG, commit, project } from './test-sandbox.mjs';
import { sandbox } from './test-cli.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HELPERS = join(HERE, '../assets/pstack');

test("head points origin/HEAD at the working branch named by origin's default branch config", () => {
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
  writeFileSync(join(clone, '.agents/pstack.json'), JSON.stringify({ branch: 'gone', protected: 'main' }));
  assert.equal(head().status, 0);
  assert.equal(origin(), 'refs/remotes/origin/main');

  writeFileSync(join(clone, '.agents/pstack.json'), JSON.stringify({ branch: 'next', protected: 'main' }));
  assert.match(head().stdout, /origin\/HEAD now points at origin\/next/);
  assert.equal(origin(), 'refs/remotes/origin/next');

  writeFileSync(join(clone, '.agents/pstack.json'), JSON.stringify({ branch: 'main' }));
  git(clone, 'add', '.agents/pstack.json');
  git(clone, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'retire next');
  git(clone, 'push', '--quiet', 'origin', 'HEAD:main');
  writeFileSync(join(clone, '.agents/pstack.json'), JSON.stringify({ branch: 'next', protected: 'main' }));
  assert.match(head().stdout, /cut from a retired branch\. Rebase onto origin\/main/);
  assert.equal(origin(), 'refs/remotes/origin/main');
});

function trunkRemote(extra = {}) {
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
  return { clone, dir, env, run, seed, setup };
}

test('setup respects read-only, validates flags, prints local models sheet, and readProjectConfig merges pstack.local.json', () => {
  const { clone, env, run, setup } = trunkRemote();
  const main = clone('main');

  // Read-only skip and bad CLI flags.
  const ro = spawnSync(process.execPath, [join(main, '.agents/pstack/setup.mjs')], { cwd: main, encoding: 'utf8', env: { ...process.env, PSTACK_READ_ONLY: '1' } });
  assert.equal(ro.stdout, 'setup.mjs: skipped, because this session is read-only\n');
  for (const args of [['--install'], ['--install', '--env'], ['--env', '--hook']]) {
    assert.equal(run(process.execPath, [join(HELPERS, 'setup.mjs'), ...args], main).status, 2);
  }

  // Local sheet printed for Claude worktree only, not Codex.
  mkdirSync(join(main, '.claude'), { recursive: true });
  writeFileSync(join(main, '.claude/pstack-models.local.md'), 'A note.\nclip: opus @medium\n');
  const tree = join(main, '../tree');
  run('git', ['-C', main, 'worktree', 'add', '-q', '--detach', tree]);
  assert.match(setup(tree).stdout, /pstack-models\.local\.md overrides these lines of \.claude\/pstack-models\.md for this person:\nclip: opus @medium\n/u);
  const codex = spawnSync(process.execPath, [join(tree, '.agents/pstack/setup.mjs')], { cwd: tree, encoding: 'utf8', env: { ...env, CLAUDE_CODE_SESSION_ID: '', CODEX_THREAD_ID: 'thread' } });
  assert.doesNotMatch(codex.stdout, /pstack-models\.local\.md/u);

  // readProjectConfig defaults maxAutoStart to 0 and shallow-merges main checkout's .agents/pstack.local.json.
  assert.equal(readProjectConfig(tree).maxAutoStart, 0);
  writeFileSync(join(main, '.agents/pstack.local.json'), JSON.stringify({ maxAutoStart: 15 }));
  assert.equal(readProjectConfig(tree).maxAutoStart, 15);
  assert.equal(readProjectConfig(tree).branch, 'next');
});

test('guard handles native Antigravity PreToolUse payloads and fails open on conflicted .agents/pstack.json', () => {
  const { clone } = trunkRemote();
  const main = clone('main');
  const guard = join(main, '.agents/pstack/guard.mjs');
  const invoke = (payload) => spawnSync(process.execPath, [guard], { cwd: main, encoding: 'utf8', input: JSON.stringify(payload) });

  const denied = invoke({ conversationId: 'c1', cwd: main, hookEventName: 'PreToolUse', toolCall: { id: 't1', name: 'run_command', args: { CommandLine: 'git push --force origin next' } } });
  assert.equal(denied.status, 0, denied.stderr);
  assert.equal(JSON.parse(denied.stdout).decision, 'deny');
  assert.match(JSON.parse(denied.stdout).reason, /guard\.mjs: agents never force-push/u);

  const allowed = invoke({ conversationId: 'c1', cwd: main, hookEventName: 'PreToolUse', toolCall: { id: 't2', name: 'run_command', args: { CommandLine: 'git status' } } });
  assert.deepEqual(JSON.parse(allowed.stdout), { decision: 'allow' });

  writeFileSync(join(main, '.agents/pstack.json'), '{\n<<<<<<< HEAD\n  "branch": "next"\n=======\n  "branch": "next",\n  "tag": "v0.9.145"\n>>>>>>> next\n}\n');
  const editConflicted = invoke({ conversationId: 'c1', cwd: main, hookEventName: 'PreToolUse', toolCall: { id: 't3', name: 'edit_file', args: { Path: join(main, '.agents/pstack.json') } } });
  assert.deepEqual(JSON.parse(editConflicted.stdout), { decision: 'allow' });
  const rebaseContinue = invoke({ conversationId: 'c1', cwd: main, hookEventName: 'PreToolUse', toolCall: { id: 't4', name: 'run_command', args: { CommandLine: 'git rebase --continue' } } });
  assert.deepEqual(JSON.parse(rebaseContinue.stdout), { decision: 'allow' });
  const claudeEdit = invoke({ tool_name: 'Edit', tool_input: { file_path: join(main, '.agents/pstack.json') }, cwd: main });
  assert.equal(claudeEdit.stdout, '');
});
