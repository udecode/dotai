import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { commit, read, readJson } from './test-sandbox.mjs';
import { sandbox, setupFixture } from './test-cli.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'sync-pstack.mjs');

function retiredFixture(dir, home, { agentsTail = '', files = {} } = {}) {
  const root = setupFixture(dir, home);
  const flow = {
    '.agents/rules/old-flow.mdc': '---\ndescription: an old flow\n---\n# Old flow\n',
    '.agents/skills/old-flow/SKILL.md': '---\nname: old-flow\n---\n# Old flow\n',
  };
  const write = (entries) => {
    for (const [path, text] of Object.entries(entries)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
  };
  write(flow);
  spawnSync('git', ['-C', root, 'add', '-A']);
  commit(root, 'old flow');
  for (const path of Object.keys(flow)) rmSync(join(root, path));
  appendFileSync(join(root, 'AGENTS.md'), agentsTail);
  write(files);
  spawnSync('git', ['-C', root, 'add', '-A']);
  return root;
}

const literal = (text) => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const retiredIn = (file) => new RegExp(`^${literal(file)}:\\d+: names retired \`old-flow\`$`, 'mu');

test('verify reads each file AGENTS.md names, however the name is written', () => {
  const { dir, home, cli } = sandbox();
  const forms = {
    'coding(rules).md': '[rules](coding\\(rules\\).md)',
    'entity_rules.md': '[rules](entity&#95;rules.md)',
    'encoded_rules.md': '[rules](encoded_rules%2Emd)',
    'emphasis.md': 'Read _emphasis.md_ first.',
    'dash.md': 'The code rules—dash.md—win.',
    'hyphen.md': 'Follow the hyphen.md-listed checks.',
    'UPPER.MD': 'Read UPPER.MD first.',
    'policy.txt': 'Read @policy.txt.',
    RULES: '@RULES',
  };
  const root = retiredFixture(dir, home, {
    agentsTail: Object.values(forms).map((line) => `${line}\n`).join(''),
    files: Object.fromEntries(Object.keys(forms).map((file) => [file, 'Run old-flow first.\n'])),
  });
  const result = cli('verify', root);
  assert.deepEqual(Object.keys(forms).filter((file) => !retiredIn(file).test(result.stdout)), [], result.stdout);
});

test('verify reads every Markdown file under .agents/ except the skills there', () => {
  const { dir, home, cli } = sandbox();
  const root = retiredFixture(dir, home, { files: { '.agents/ellie/lesson.md': 'Run old-flow first.\n', '.agents/skills/feature/notes.md': 'Run old-flow first.\n' } });
  const result = cli('verify', root);
  assert.match(result.stdout, retiredIn('.agents/ellie/lesson.md'));
  assert.doesNotMatch(result.stdout, retiredIn('.agents/skills/feature/notes.md'));
});

test('verify reads no file outside the project, through a symlinked AGENTS.md or a symlinked seed', () => {
  const { dir, home, cli } = sandbox();
  const root = retiredFixture(dir, home, { files: { 'target.md': 'Run old-flow first.\n' } });
  const outside = join(dir, 'outside');
  mkdirSync(outside);
  writeFileSync(join(outside, 'AGENTS.md'), `${read(root, 'AGENTS.md')}Read target.md\nRun old-flow first.\n`);
  writeFileSync(join(outside, 'seed.md'), 'Run old-flow first.\n');
  rmSync(join(root, 'AGENTS.md'));
  symlinkSync(join(outside, 'AGENTS.md'), join(root, 'AGENTS.md'));
  mkdirSync(join(root, '.agents/team'));
  symlinkSync(join(outside, 'seed.md'), join(root, '.agents/team/seed.md'));
  const result = cli('verify', root);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(['AGENTS.md', 'target.md', '.agents/team/seed.md'].filter((file) => retiredIn(file).test(result.stdout)), [], result.stdout);
});

test('verify reads the longest file name AGENTS.md writes, not a shorter file it ends with', () => {
  const { dir, home, cli } = sandbox();
  const root = retiredFixture(dir, home, { agentsTail: 'Read <docs/my notes.md>.\n', files: { 'docs/my notes.md': 'Nothing old here.\n', 'notes.md': 'Run old-flow first.\n' } });
  const result = cli('verify', root);
  assert.equal(result.status, 0, result.stdout);
});

test('verify reads ../<name>/ as a skill link only in .agents/rules/', () => {
  const { dir, home, cli } = sandbox();
  const root = retiredFixture(dir, home, {
    agentsTail: 'Read docs/guide.md.\n',
    files: {
      'docs/guide.md': 'See [the schema](../old-flow/schema.md).\n',
      '.agents/rules/feature.mdc': '---\ndescription: ship a feature\n---\n# Feature\n\nPlan it with [Old](../old-flow/SKILL.md).\n',
    },
  });
  const result = cli('verify', root);
  assert.match(result.stdout, retiredIn('.agents/rules/feature.mdc'));
  assert.doesNotMatch(result.stdout, retiredIn('docs/guide.md'));
});

test('verify reports a retired name in any other file git or the companion tracks, and still passes', () => {
  const { dir, home, cli } = sandbox();
  const root = retiredFixture(dir, home, { files: { 'docs/plans/old.md': 'Ran old-flow last year.\n' } });
  const companion = ['--git-dir', join(root, '.git-companion'), '--work-tree', root];
  spawnSync('git', [...companion, 'init', '-q']);
  writeFileSync(join(root, 'private.txt'), 'Ran old-flow in private.\n');
  spawnSync('git', [...companion, 'add', 'private.txt']);
  const config = readJson(root, '.agents/pstack.json');
  writeFileSync(join(root, '.agents/pstack.json'), JSON.stringify({ ...config, companion: { dir: '.git-companion' } }, null, 2));
  const result = cli('verify', root);
  assert.equal(result.status, 0, result.stdout);
  const reported = ['docs/plans/old.md', 'private.txt'].filter((file) => result.stdout.includes(`${file}:1: names retired \`old-flow\` outside the rule files`));
  assert.deepEqual(reported, ['docs/plans/old.md', 'private.txt'], result.stdout);
});

test('verify follows each folder link under .agents/ once, and only inside the project', () => {
  const { dir, env, home } = sandbox();
  const root = retiredFixture(dir, home, { files: { 'policies/law.md': 'Run old-flow first.\n', 'hidden/law.md': 'Run old-flow first.\n' } });
  const outside = join(dir, 'outside');
  mkdirSync(outside);
  symlinkSync(join(root, 'hidden'), join(outside, 'inner'));
  symlinkSync('../policies', join(root, '.agents/team'));
  symlinkSync(outside, join(root, '.agents/vendor'));
  symlinkSync('.', join(root, '.agents/loop'));
  symlinkSync('.', join(root, '.agents/again'));
  const result = spawnSync(process.execPath, [SCRIPT, 'verify', root], { encoding: 'utf8', env, timeout: 30_000 });
  assert.equal(result.signal, null, 'verify ran past 30 s');
  assert.match(result.stdout, retiredIn('policies/law.md'));
  assert.doesNotMatch(result.stdout, retiredIn('hidden/law.md'));
});

test('verify reads a file a rule file imports beside itself', () => {
  const { dir, home, cli } = sandbox();
  const root = retiredFixture(dir, home, {
    agentsTail: 'Read docs/CONTEXT.md.\n',
    files: {
      'docs/CONTEXT.md': 'Team rules: @../.agents/team/policy.txt, @./local.txt and @spare.txt\n',
      '.agents/team/policy.txt': 'Run old-flow first.\n',
      'docs/local.txt': 'Run old-flow first.\n',
      'local.txt': 'Run old-flow first.\n',
      'spare.txt': 'Run old-flow first.\n',
    },
  });
  const result = cli('verify', root);
  assert.deepEqual(['.agents/team/policy.txt', 'docs/local.txt'].filter((file) => !retiredIn(file).test(result.stdout)), [], result.stdout);
  assert.deepEqual(['local.txt', 'spare.txt'].filter((file) => retiredIn(file).test(result.stdout)), [], result.stdout);
});

test('verify reads .agents/rules/ when .agents/skills links to it', () => {
  const { dir, home, cli } = sandbox();
  const root = retiredFixture(dir, home, { files: { '.agents/rules/shipping.mdc': '---\ndescription: ship\n---\nRun old-flow first.\n' } });
  rmSync(join(root, '.agents/skills'), { recursive: true });
  symlinkSync('rules', join(root, '.agents/skills'));
  assert.match(cli('verify', root).stdout, retiredIn('.agents/rules/shipping.mdc'));
});

test('verify reads a rule through a folder link or an uppercase link in .agents/rules/', () => {
  const { dir, home, cli } = sandbox();
  const rule = '---\ndescription: ship a feature\n---\n# Feature\n\nPlan it with [Old](../old-flow/SKILL.md).\n';
  const root = retiredFixture(dir, home, { files: { '.agents/shared/team.md': rule, '.agents/upper/current.md': rule } });
  symlinkSync('../shared', join(root, '.agents/rules/team'));
  symlinkSync('../upper/current.md', join(root, '.agents/rules/shipping.MDC'));
  const result = cli('verify', root);
  assert.deepEqual(['.agents/shared/team.md', '.agents/upper/current.md'].filter((file) => !retiredIn(file).test(result.stdout)), [], result.stdout);
});

test('verify skips a link cycle under .agents/', () => {
  const { dir, home, cli } = sandbox();
  const root = retiredFixture(dir, home, { files: { '.agents/team/policy.md': 'Run old-flow first.\n' } });
  symlinkSync('b', join(root, '.agents/a'));
  symlinkSync('a', join(root, '.agents/b'));
  symlinkSync('self.md', join(root, '.agents/self.md'));
  const result = cli('verify', root);
  assert.match(result.stdout, retiredIn('.agents/team/policy.md'), result.stderr);
});

test('verify reports a retired name past a megabyte of git grep output', () => {
  const { dir, home, cli } = sandbox();
  const root = retiredFixture(dir, home, { files: { 'docs/history.txt': `Ran \`old-flow\` ${'x'.repeat(1_200_000)}\n`, 'RULES.txt': 'Ran old-flow once.\n' } });
  const result = cli('verify', root);
  assert.match(result.stdout, /^RULES\.txt:1: names retired `old-flow` outside the rule files$/mu, result.stdout);
});

test('verify fails when it cannot search the companion for retired names', () => {
  const { dir, home, cli } = sandbox();
  const root = retiredFixture(dir, home);
  mkdirSync(join(root, '.git-companion'));
  const config = readJson(root, '.agents/pstack.json');
  writeFileSync(join(root, '.agents/pstack.json'), JSON.stringify({ ...config, companion: { dir: '.git-companion' } }, null, 2));
  const result = cli('verify', root);
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout, /^git grep for retired names failed in \.git-companion: /mu);
});
