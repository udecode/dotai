// Installed by the sync-pstack skill.
// The working branch a remote names now: the `branch` in the
// .agents/pstack.json that the remote's default branch holds, read from this
// clone's last fetch of that branch. A worktree cut from a retired working
// branch still carries that branch's own config, so head.mjs and land.mjs ask
// the remote instead of trusting it. It fetches nothing, because land.mjs
// orders its own fetches. Returns null when the remote cannot be read or its
// default branch holds no config.

import { spawnSync } from 'node:child_process';

const git = (...args) => spawnSync('git', args, { encoding: 'utf8' });

export function remoteWorkingBranch(remote = 'origin') {
  const symref = git('ls-remote', '--symref', remote, 'HEAD');
  const head = symref.status === 0 ? /^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(symref.stdout)?.[1] : null;
  if (!head) return null;
  const shown = git('show', `refs/remotes/${remote}/${head}:.agents/pstack.json`);
  if (shown.status !== 0) return null;
  try {
    return JSON.parse(shown.stdout).branch ?? null;
  } catch {
    return null;
  }
}
