// Fixtures the sync-pstack test files share. Importing this file points git at no user or system
// config, so a test never reads the machine's settings. It also marks every proof.mjs a test starts
// as holding a core already, so none queues behind the machine's real proofs; a test of the pool
// itself deletes PSTACK_SLOT and gives the pool its own TMPDIR.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

Object.assign(process.env, {
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
  PSTACK_SLOT: '1',
});

export const CONFIG = {
  tag: 'v0.9.52',
  branch: 'next',
  protected: 'main',
  delivery: 'push',
  lintFix: 'bun run lint:fix',
  check: 'bun check',
  plans: 'docs/plans',
  skip: [],
};

export const commit = (root, message) =>
  spawnSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qam', message]);

// A scratch folder with its own home; run spawns a command with that home.
export function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'sync-pstack-test-'));
  const home = join(dir, 'home');
  mkdirSync(home);
  const env = { ...process.env, HOME: home };
  delete env.PSTACK_BASE;
  const run = (command, args, cwd) => spawnSync(command, args, { cwd, encoding: 'utf8', env });
  return { dir, env, home, run };
}

export function project(dir, name, { config, agents, settings, files = {} } = {}) {
  const root = join(dir, name);
  mkdirSync(root, { recursive: true });
  spawnSync('git', ['init', '-q', '-b', 'next', root]);
  const all = {
    ...files,
    ...(agents === undefined ? {} : { 'AGENTS.md': agents }),
    ...(settings ? { '.claude/settings.json': JSON.stringify(settings, null, 2) } : {}),
    ...(config ? { '.agents/pstack.json': JSON.stringify(config, null, 2) } : {}),
  };
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

export const read = (root, path) => readFileSync(join(root, path), 'utf8');
export const readJson = (root, path) => JSON.parse(read(root, path));

export const BRIEF_ANSWERS = [
  ['What will change?', 'It opens with a brief.'],
  ['What could go wrong?', 'Old plans need a brief.'],
];
export const brief = (answers = BRIEF_ANSWERS) => `## Brief\n\n${answers.map(([question, answer]) => `### ${question}\n\n${answer}\n`).join('\n')}\n`;

export const LOG_HEAD = 'time\tphase\tdecision\twhy\tevidence\tresult\n';
export const logRow = (phase, decision) => `2026-10-13T00:00:00Z\t${phase}\t${decision}\twhy\tevidence\tfixed: done\n`;
