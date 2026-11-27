import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HELPERS = join(dirname(fileURLToPath(import.meta.url)), '../assets/pstack');
export const ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
  GIT_EDITOR: 'true',
  CLAUDE_CODE_HOST_SESSION_ID: '',
  CLAUDE_CODE_SESSION_ID: '',
  CODEX_SESSION_ID: '',
  CODEX_THREAD_ID: '',
  T3CODE_THREAD_ID: '',
  T3_ACP_MCP_NODE: '',
  T3_ACP_MCP_ENTRYPOINT: '',
  T3_ACP_MCP_ENDPOINT: '',
  ANTIGRAVITY_CONVERSATION_ID: '',
  PSTACK_SLOT: '1',
};
export const GOOD = 'feat(a): change a\n\nWhy a changes.';
export const PR = 'feat(a): change a\n\n## Why\n\nWhy a changes.\n\n## Verification\n\n- a.txt reads two.';

export const git = (cwd, ...args) => {
  const run = spawnSync('git', args, { cwd, encoding: 'utf8', env: ENV });
  assert.equal(run.status, 0, `git ${args.join(' ')}: ${run.stderr}`);
  return run.stdout.trim();
};
export const helper = (name, cwd, args = [], env = {}) =>
  spawnSync(process.execPath, [join(HELPERS, name), ...args], { cwd, encoding: 'utf8', env: { ...ENV, ...env } });

let trunkTemplate;
function baseTrunk() {
  if (trunkTemplate) return trunkTemplate;
  const dir = mkdtempSync(join(tmpdir(), 'sync-pstack-trunk-tpl-'));
  const remote = join(dir, 'remote.git');
  const clone = join(dir, 'clone');
  git(dir, 'init', '--quiet', '--bare', '--initial-branch=main', remote);
  git(remote, 'config', 'receive.autogc', 'false');
  git(dir, 'clone', '--quiet', remote, clone);
  mkdirSync(join(clone, '.agents/pstack'), { recursive: true });
  for (const name of ['guard.mjs', 'status.mjs']) cpSync(join(HELPERS, name), join(clone, `.agents/pstack/${name}`));
  writeFileSync(join(clone, '.agents/pstack.json'), JSON.stringify({ branch: 'next', protected: 'main', plans: 'docs/plans' }));
  writeFileSync(join(clone, '.gitignore'), '.env\n.env.local\nnode_modules\n');
  writeFileSync(join(clone, 'a.txt'), 'one\n');
  writeFileSync(join(clone, 'b.txt'), 'one\n');
  git(clone, 'add', '--all');
  git(clone, 'commit', '--quiet', '-m', 'base');
  git(clone, 'push', '--quiet', 'origin', 'HEAD:main', 'HEAD:next');
  git(clone, 'fetch', '--quiet', 'origin');
  git(clone, 'switch', '--quiet', '-c', 'task', 'origin/next');
  trunkTemplate = { remote, clone, base: git(remote, 'rev-parse', 'next') };
  return trunkTemplate;
}

// A bare remote whose next and main hold one base commit, and a clone on a
// task branch cut from origin/next, as a session's worktree would be. With
// `lint`, the config's lintFix uppercases each file it is given.
export function trunk({ lint = false } = {}) {
  const tpl = baseTrunk();
  const dir = mkdtempSync(join(tmpdir(), 'sync-pstack-trunk-'));
  const remote = join(dir, 'remote.git');
  const clone = join(dir, 'clone');
  cpSync(tpl.remote, remote, { recursive: true });
  cpSync(tpl.clone, clone, { recursive: true });
  const cfgPath = join(clone, '.git/config');
  writeFileSync(cfgPath, readFileSync(cfgPath, 'utf8').replaceAll(tpl.remote, remote));
  let base = tpl.base;
  if (lint) {
    const fix = join(dir, 'fix.mjs');
    writeFileSync(fix, "import { readFileSync, writeFileSync } from 'node:fs';\nfor (const file of process.argv.slice(2)) writeFileSync(file, readFileSync(file, 'utf8').toUpperCase());\n");
    writeFileSync(join(clone, '.agents/pstack.json'), JSON.stringify({ branch: 'next', protected: 'main', plans: 'docs/plans', lintFix: `node ${fix}` }));
    git(clone, 'commit', '--quiet', '--amend', '-am', 'base');
    git(clone, 'push', '--quiet', '--force', 'origin', 'HEAD:main', 'HEAD:next');
    git(clone, 'fetch', '--quiet', 'origin');
    base = git(remote, 'rev-parse', 'next');
  }
  const message = (text) => {
    const file = join(dir, `message-${Math.random().toString(36).slice(2)}`);
    writeFileSync(file, text);
    return file;
  };
  // Lands a commit on origin/next from a second clone, as another session would.
  const elsewhere = (path, text, subject) => {
    const other = join(dir, `other-${Math.random().toString(36).slice(2)}`);
    git(dir, 'clone', '--quiet', '--branch', 'next', remote, other);
    writeFileSync(join(other, path), text);
    git(other, 'add', '--all');
    git(other, 'commit', '--quiet', '-m', subject);
    return other;
  };
  return { dir, remote, clone, base, message, elsewhere };
}


// Splits the trunk: next gains .gitprivate, which the clone's git ignores
// through core.excludesFile, and the companion repository .git-private, with
// its own bare remote, tracks a.spec from its first commit.
export function split(fixture) {
  const { dir, clone } = fixture;
  writeFileSync(join(clone, '.gitprivate'), '*.spec\n');
  writeFileSync(join(clone, '.gitignore'), '.env\n.env.local\nnode_modules\n/.git-private\n');
  const config = JSON.parse(readFileSync(join(clone, '.agents/pstack.json'), 'utf8'));
  config.companion = { dir: '.git-private', list: '.gitprivate', migrate: 'node migrate.mjs', detach: 'node detach.mjs' };
  writeFileSync(join(clone, '.agents/pstack.json'), JSON.stringify(config));
  git(clone, 'add', '--all');
  git(clone, 'commit', '--quiet', '-m', 'split');
  git(clone, 'push', '--quiet', 'origin', 'HEAD:next');
  git(clone, 'fetch', '--quiet', 'origin');
  git(clone, 'config', 'core.excludesFile', join(clone, '.gitprivate'));
  const remote = join(dir, 'companion.git');
  git(dir, 'init', '--quiet', '--bare', '--initial-branch=next', remote);
  git(clone, 'init', '--quiet', '--bare', '.git-private');
  const side = (...args) => git(clone, '--git-dir=.git-private', '--work-tree=.', ...args);
  side('config', 'core.bare', 'false');
  side('remote', 'add', 'origin', remote);
  writeFileSync(join(clone, 'a.spec'), 'one\n');
  side('add', '--force', 'a.spec');
  side('commit', '--quiet', '-m', 'start');
  side('push', '--quiet', 'origin', 'HEAD:next');
  side('fetch', '--quiet', 'origin');
  const sideElsewhere = (path, text, subject) => {
    const other = join(dir, `side-${Math.random().toString(36).slice(2)}`);
    git(dir, 'clone', '--quiet', '--branch', 'next', remote, other);
    writeFileSync(join(other, path), text);
    git(other, 'add', '--all');
    git(other, 'commit', '--quiet', '-m', subject);
    return other;
  };
  return { companion: remote, side, sideElsewhere };
}


export const NO_WAIT = { PSTACK_LAND_WAIT_SCALE: '0' };
export const until = async (done) => {
  const deadline = Date.now() + 30_000;
  while (!done()) {
    assert.ok(Date.now() < deadline, 'timed out');
    await new Promise((wake) => setTimeout(wake, 50));
  }
};
export const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export function stubGh(dir) {
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(
    join(bin, 'gh'),
    [
      '#!/bin/sh',
      'case "$1 $2" in',
      `  "pr create") printf '%s\\n' "$@" > '${dir}/gh-args'; cp "\${10}" '${dir}/gh-body'; echo https://example.test/pull/7 ;;`,
      `  "pr merge") printf '%s\\n' "$@" > '${dir}/gh-merge' ;;`,
      `  "api "*) cat '${dir}/gh-rules' 2>/dev/null || echo '[]' ;;`,
      'esac',
      '',
    ].join('\n')
  );
  chmodSync(join(bin, 'gh'), 0o755);
  return { PATH: `${bin}:${process.env.PATH}` };
}
export const ghLines = (dir, file) => readFileSync(join(dir, file), 'utf8').trim().split('\n');
export const ghArgs = (dir) => ghLines(dir, 'gh-args');

export function declinePushes(remote, count, reasons = ['']) {
  const hook = join(remote, 'hooks', 'pre-receive');
  const lines = reasons.map((reason) => `echo "error: ${reason}" >&2\n`).join('');
  writeFileSync(
    hook,
    `#!/bin/sh\ncount=$(cat "$GIT_DIR/declines" 2>/dev/null || echo 0)\n[ "$count" -gt 0 ] || exit 0\necho $((count - 1)) > "$GIT_DIR/declines"\necho "error: GH006: Protected branch update failed for refs/heads/next." >&2\n${lines}exit 1\n`
  );
  chmodSync(hook, 0o755);
  writeFileSync(join(remote, 'declines'), `${count}\n`);
}

export function seedGeneratedConflict(fixture, command = 'node gen.mjs', entry = {}) {
  const { clone } = fixture;
  git(clone, 'config', 'pstack.delivery', 'push');
  writeFileSync(join(clone, 'gen.mjs'), "import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';\nmkdirSync('gen', { recursive: true });\nwriteFileSync('gen/out.txt', ['a.txt', 'b.txt'].map((file) => readFileSync(file, 'utf8')).join(''));\n");
  const config = JSON.parse(readFileSync(join(clone, '.agents/pstack.json'), 'utf8'));
  config.generated = [{ paths: ['gen/**'], command, ...entry }];
  writeFileSync(join(clone, '.agents/pstack.json'), JSON.stringify(config));
  const edit = (dir, path, text) => {
    writeFileSync(join(dir, path), text);
    assert.equal(spawnSync(process.execPath, ['gen.mjs'], { cwd: dir }).status, 0);
  };
  edit(clone, 'a.txt', 'one\n');
  git(clone, 'add', '--all');
  git(clone, 'commit', '--quiet', '-m', 'generate');
  git(clone, 'push', '--quiet', 'origin', 'HEAD:next');
  git(clone, 'fetch', '--quiet', 'origin');
  const other = join(fixture.dir, 'other-generated');
  git(fixture.dir, 'clone', '--quiet', '--branch', 'next', fixture.remote, other);
  edit(other, 'a.txt', 'two\n');
  git(other, 'commit', '--quiet', '-am', 'fix(a): land elsewhere');
  git(other, 'push', '--quiet', 'origin', 'HEAD:next');
  return edit;
}

export function landingOnBothVersionFiles({ elsewhere }, sideElsewhere) {
  const other = elsewhere('b.txt', 'two\n', 'feat(o): other');
  const otherSide = sideElsewhere('a.spec', 'two\n', 'feat(o): other');
  git(otherSide, 'commit', '--quiet', '--amend', '-m', `feat(o): other\n\nLands-With: ${git(other, 'rev-parse', 'HEAD')}`);
  return [other, otherSide];
}
