// What the sync-pstack CLI test files share: a local pstack upstream with one commit per tag, and a
// sandbox whose sync-pstack.mjs fetches pstack from it instead of GitHub.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { overrideAnchors, sharedTemplates } from './sync-pstack.mjs';
import { CONFIG, commit, project, sandbox as plainSandbox } from './test-sandbox.mjs';

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

// A git checkout holding a copy of this skill, standing in for the dotai checkout.
export function sharedSource(dir) {
  const repo = join(dir, 'dotai');
  cpSync(dirname(HERE), join(repo, 'skills/sync-pstack'), { recursive: true });
  spawnSync('git', ['init', '-q', repo]);
  spawnSync('git', ['-C', repo, 'add', '.']);
  commit(repo, 'shared source');
  return { repo, script: join(repo, 'skills/sync-pstack/scripts/sync-pstack.mjs'), template: join(repo, 'skills/sync-pstack/assets/block.md') };
}

// A managed project at its pre-setup commit: a typed `task` rule, a rule that
// routes to it, and a skill the docs tell users to install.
export function setupFixture(dir, home) {
  const root = project(dir, 'app', {
    config: CONFIG,
    agents: '# App\n',
    files: {
      '.agents/rules/task.mdc': '---\ndescription: plan and do a task\n---\n# Task\n',
      '.agents/skills/task/SKILL.md': '---\nname: task\n---\n# Task\n',
      '.agents/rules/feature.mdc': '---\ndescription: ship a feature\n---\n# Feature\n\nPlan it with [Task](../task/SKILL.md) and `task-plan` mode.\n',
      '.agents/skills/feature/SKILL.md': '---\nname: feature\n---\n# Feature\n\nPlan it with [Task](../task/SKILL.md).\n',
      '.agents/skills/sync-ui/SKILL.md': '---\nname: sync-ui\n---\n# Sync UI\n\nKeep each run plan in `.sync-ui/runs/`.\n',
      'docs/install.mdx': 'Install it with `npx skills add acme/app --skill sync-ui`.\n',
    },
  });
  spawnSync(process.execPath, [SCRIPT, 'apply', root], { env: { ...process.env, HOME: home } });
  spawnSync('git', ['-C', root, 'add', '-A']);
  commit(root, 'before setup');
  const claude = join(home, '.claude/projects', root.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(claude, { recursive: true });
  writeFileSync(join(claude, 'session.jsonl'), JSON.stringify({ type: 'user', timestamp: new Date().toISOString(), message: { role: 'user', content: '/task plan the export menu' } }));
  return root;
}
