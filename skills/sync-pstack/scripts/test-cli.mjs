// What the sync-pstack CLI test files share: a local pstack upstream with one commit per tag, and a
// sandbox whose sync-pstack.mjs fetches pstack from it instead of GitHub.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { overrideAnchors, sharedTemplates } from './sync-pstack.mjs';
import { commit, sandbox as plainSandbox } from './test-sandbox.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'sync-pstack.mjs');

export const ABSENT = Symbol('absent at this tag');

export function pstackRepo(dir, tags) {
  const repo = join(dir, 'pstack');
  spawnSync('git', ['init', '-q', repo]);
  const base = {};
  for (const { path, anchor } of overrideAnchors(sharedTemplates().join('\n'))) base[path] = `${base[path] ?? ''}${anchor}\n`;
  for (const [tag, files] of Object.entries(tags)) {
    for (const path of new Set([...Object.keys(base), ...Object.keys(files)])) {
      const file = join(repo, 'plugins/pstack/skills', path);
      rmSync(file, { force: true });
      if (files[path] === ABSENT) continue;
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `${base[path] ?? ''}${files[path] ?? ''}`);
    }
    spawnSync('git', ['-C', repo, 'add', '-A']);
    commit(repo, tag);
    spawnSync('git', ['-C', repo, 'tag', tag]);
  }
  return repo;
}

export const PSTACK = pstackRepo(mkdtempSync(join(tmpdir(), 'sync-pstack-upstream-')), { 'v0.9.52': {}, 'v0.9.53': {} });

export function sandbox({ upstream = PSTACK } = {}) {
  const box = plainSandbox();
  box.env.SYNC_PSTACK_UPSTREAM = upstream;
  return { ...box, cli: (...args) => box.run(process.execPath, [SCRIPT, ...args]) };
}
