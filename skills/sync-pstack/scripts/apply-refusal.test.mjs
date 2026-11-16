import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { CONFIG, commit, project, read, readJson } from './test-sandbox.mjs';
import { sandbox, sharedSource } from './test-cli.mjs';

test('apply refuses a block or helper edited in the project and writes nothing until --force', () => {
  const { dir, cli } = sandbox();
  const root = project(dir, 'app', { config: CONFIG, agents: '# App\n' });
  cli('apply', root);
  const edited = read(root, 'AGENTS.md').replace('**Blocked.**', '**Blocked (local lesson).**');
  writeFileSync(join(root, 'AGENTS.md'), edited);
  writeFileSync(join(root, '.agents/pstack/plan-open.mjs'), '// local fork\n');

  const refused = cli('apply', root, '--tag', 'v0.9.53');
  assert.equal(refused.status, 1);
  assert.match(refused.stdout, /refused AGENTS\.md: the block was edited/);
  assert.match(refused.stdout, /refused \.agents\/pstack\/plan-open\.mjs: the helper was edited/);
  assert.equal(read(root, 'AGENTS.md'), edited);
  assert.equal(readJson(root, '.claude/settings.json').extraKnownMarketplaces['pstack-claude'].source.ref, 'v0.9.52');

  assert.equal(cli('apply', root, '--tag', 'v0.9.53', '--force').status, 0);
  assert.doesNotMatch(read(root, 'AGENTS.md'), /local lesson/);
  assert.equal(readJson(root, '.claude/settings.json').extraKnownMarketplaces['pstack-claude'].source.ref, 'v0.9.53');
});

test('apply refuses a config whose working branch is also the protected one', () => {
  const { dir, cli } = sandbox();
  const root = project(dir, 'app', { config: { ...CONFIG, branch: 'main', protected: 'main' }, agents: '# App\n' });
  const result = cli('apply', root);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /protected must differ from branch/);
});

test('a refusal shows only what the project edited, even after the shared template moved', () => {
  const { dir, run } = sandbox();
  const shared = sharedSource(dir);
  const root = project(dir, 'app', { config: CONFIG, agents: '# App\n' });
  run(process.execPath, [shared.script, 'apply', root]);
  writeFileSync(join(root, 'AGENTS.md'), read(root, 'AGENTS.md').replace('**Blocked.**', '**Blocked (local lesson).**'));
  const before = readFileSync(shared.template, 'utf8');
  const after = before.replace('allow two informed attempts or ten minutes', 'allow three informed attempts or ten minutes');
  assert.notEqual(after, before);
  writeFileSync(shared.template, after);
  commit(shared.repo, 'template change');

  const refused = run(process.execPath, [shared.script, 'apply', root]);
  assert.equal(refused.status, 1);
  assert.match(refused.stdout, /the project's edit since the last sync/);
  assert.match(refused.stdout, /\+- \*\*Blocked \(local lesson\)\.\*\*/);
  assert.doesNotMatch(refused.stdout, /three informed attempts/);
});

test('a clean shared source refuses to drop edits a project was synced from before they were committed', () => {
  const { dir, run } = sandbox();
  const shared = sharedSource(dir);
  const original = readFileSync(shared.template, 'utf8');
  writeFileSync(shared.template, original.replace('allow two informed attempts or ten minutes', 'allow three informed attempts or ten minutes'));
  const root = project(dir, 'app', { config: CONFIG, agents: '# App\n' });
  assert.equal(run(process.execPath, [shared.script, 'apply', root]).status, 0);
  writeFileSync(shared.template, original);

  const refused = run(process.execPath, [shared.script, 'apply', root]);
  assert.equal(refused.status, 1);
  assert.match(refused.stdout, /uncommitted shared edits/);
  assert.match(read(root, 'AGENTS.md'), /three informed attempts/);
});

test('an older copy of the shared source refuses to undo a newer sync', () => {
  const { dir, run } = sandbox();
  const shared = sharedSource(dir);
  writeFileSync(shared.template, readFileSync(shared.template, 'utf8').replace('allow two informed attempts or ten minutes', 'allow three informed attempts or ten minutes'));
  commit(shared.repo, 'newer rule');
  const root = project(dir, 'app', { config: CONFIG, agents: '# App\n' });
  run(process.execPath, [shared.script, 'apply', root]);
  run('git', ['checkout', '-q', 'HEAD~1'], shared.repo);

  const refused = run(process.execPath, [shared.script, 'apply', root]);
  assert.equal(refused.status, 1);
  assert.match(refused.stdout, /does not include/);
  assert.match(read(root, 'AGENTS.md'), /three informed attempts/);
});

test('a sync from an uncommitted source records the commit once it lands', () => {
  const { dir, run } = sandbox();
  const shared = sharedSource(dir);
  writeFileSync(shared.template, readFileSync(shared.template, 'utf8').replace('allow two informed attempts or ten minutes', 'allow three informed attempts or ten minutes'));
  const root = project(dir, 'app', { config: CONFIG, agents: '# App\n' });
  run(process.execPath, [shared.script, 'apply', root]);
  assert.equal(readJson(root, '.agents/pstack.json').synced.source, null);
  commit(shared.repo, 'newer rule');
  run(process.execPath, [shared.script, 'apply', root]);
  assert.match(readJson(root, '.agents/pstack.json').synced.source ?? '', /^[0-9a-f]{40}$/);
});

test('apply refuses a helper that imports a file HELPER_FILES does not install', () => {
  const { dir, run } = sandbox();
  const shared = sharedSource(dir);
  const helpers = join(dirname(shared.template), 'pstack');
  writeFileSync(join(helpers, 'stray.mjs'), 'export const stray = 1;\n');
  writeFileSync(join(helpers, 'head.mjs'), `${readFileSync(join(helpers, 'head.mjs'), 'utf8')}\nimport './stray.mjs';\n`);
  spawnSync('git', ['-C', shared.repo, 'add', '-A']);
  commit(shared.repo, 'stray import');
  const root = project(dir, 'app', { config: CONFIG, agents: '# App\n' });
  const result = run(process.execPath, [shared.script, 'apply', root]);
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout, /\.agents\/pstack\/head\.mjs[\s\S]*imports \.\/stray\.mjs/);
  assert.ok(!existsSync(join(root, '.agents/pstack/head.mjs')), 'nothing installs');
});
