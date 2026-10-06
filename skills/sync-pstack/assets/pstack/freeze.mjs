#!/usr/bin/env node
// Installed by the sync-pstack skill.
// Usage: node .agents/pstack/freeze.mjs --dir <run-dir> [--parent <commit>] [--message <text>] <path> [...]
// Freezes HEAD plus the named paths' working copies as a commit object that no
// branch or ref points to, and prints its sha. The temporary index lives in the
// run directory and stays there, so the checkout's own index never changes.

import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

function parse(argv) {
  const options = { message: 'frozen review tree', parent: 'HEAD', paths: [] };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--dir') options.dir = argv[++index];
    else if (arg === '--parent') options.parent = argv[++index];
    else if (arg === '--message') options.message = argv[++index];
    else options.paths.push(arg);
  }
  return options;
}

function git(args, env) {
  const result = spawnSync('git', args, { encoding: 'utf8', env: { ...process.env, ...env } });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

const options = parse(process.argv.slice(2));
if (!options.dir || options.paths.length === 0) {
  console.error('Usage: node .agents/pstack/freeze.mjs --dir <run-dir> [--parent <commit>] [--message <text>] <path> [...]');
  process.exit(2);
}

try {
  const dir = resolve(options.dir);
  mkdirSync(dir, { recursive: true });
  const env = { GIT_INDEX_FILE: resolve(dir, 'freeze-index') };
  git(['read-tree', 'HEAD'], env);
  git(['add', '--force', '--', ...options.paths], env);
  const tree = git(['write-tree'], env);
  const commit = git(['commit-tree', tree, '-p', options.parent, '-m', options.message], env);
  console.log(commit);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
