import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { namesSkill } from './sync-pstack.mjs';
import { CONFIG, project, read, readJson } from './test-sandbox.mjs';
import { ABSENT, pstackRepo, sandbox } from './test-cli.mjs';

const reviewItems = (stdout) => {
  const lines = stdout.split('the write needs --dispositions')[1].split('\n').slice(1);
  const end = lines.findIndex((line) => !line.startsWith('    '));
  return lines.slice(0, end < 0 ? lines.length : end).map((line) => line.trim());
};
const writeNoneDispositions = (cli, root, tag, dir) => {
  const tsv = join(dir, 'dispositions.tsv');
  writeFileSync(tsv, reviewItems(cli('apply', root, '--tag', tag, '--dry-run').stdout).map((item) => `${item}\tnone\tno rule names it`).join('\n'));
  return tsv;
};

test('a pin adds the plugin, keeps the other settings and their format, and a bump moves only the ref', () => {
  const { dir, cli } = sandbox();
  const original = '{\n  "permissions": {\n    "allow": ["Bash", "Edit"]\n  },\n  "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "node stage.mjs" }] }] },\n  "enabledPlugins": { "other@market": true }\n}\n';
  const root = project(dir, 'app', { config: CONFIG, agents: '# App\n', files: { '.claude/settings.json': original } });
  cli('apply', root);
  const pinnedText = read(root, '.claude/settings.json');
  const after = JSON.parse(pinnedText);
  assert.deepEqual(after.hooks, JSON.parse(original).hooks);
  assert.deepEqual(after.enabledPlugins, { 'other@market': true, 'pstack@pstack-claude': true });
  assert.deepEqual(after.extraKnownMarketplaces['pstack-claude'].source, { source: 'github', repo: 'michael-denyer/pstack-claude', ref: 'v0.9.52' });
  assert.match(pinnedText, /^ {4}"allow": \["Bash", "Edit"\],?$/m);

  cli('apply', root, '--tag', 'v0.9.53');
  assert.equal(read(root, '.claude/settings.json'), pinnedText.replace('"ref": "v0.9.52"', '"ref": "v0.9.53"'));
});

test('a bump refuses when pstack dropped the step a playbook anchors on, and shows the upstream diff', () => {
  const upstream = pstackRepo(mkdtempSync(join(tmpdir(), 'sync-pstack-upstream-')), {
    'v0.9.52': { 'poteto-mode/playbooks/bug-fix.md': '1. Reproduce it yourself on the matching surface.\n' },
    'v0.9.53': { 'poteto-mode/playbooks/bug-fix.md': '1. Reproduce on the same surface.\n' },
  });
  const { dir, cli } = sandbox({ upstream });
  const change = (anchor) => `---\nextends: bug-fix\nwhen: Use it for any bug report.\n---\n- **After** "${anchor}": compare with main.\n`;
  const root = project(dir, 'app', { config: CONFIG, agents: '# App\n', files: { '.agents/playbooks/bug-fix.md': change('Reproduce it yourself') } });
  assert.equal(cli('apply', root).status, 0);

  const refused = cli('apply', root, '--tag', 'v0.9.53');
  assert.equal(refused.status, 1);
  assert.match(refused.stdout, /refused pstack anchors: \.agents\/playbooks\/bug-fix\.md anchors a change on "Reproduce it yourself"/);
  assert.match(refused.stdout, /^ +-1\. Reproduce it yourself on the matching surface\.$/m);
  assert.equal(readJson(root, '.claude/settings.json').extraKnownMarketplaces['pstack-claude'].source.ref, 'v0.9.52');
  assert.equal(cli('apply', root, '--tag', 'v0.9.53', '--force').status, 1);

  writeFileSync(join(root, '.agents/playbooks/bug-fix.md'), change('Reproduce on the same surface'));
  assert.equal(cli('apply', root, '--tag', 'v0.9.53', '--dispositions', writeNoneDispositions(cli, root, 'v0.9.53', dir)).status, 0);
});

const BUMP = {
  'v0.9.52': { 'thermos/SKILL.md': 'Review in two lanes.\n', '../agents/comment-sicko.md': 'Never edit.\n' },
  'v0.9.53': { 'thermos/SKILL.md': 'Review in three lanes.\n', '../agents/comment-sicko.md': 'Edit freely.\n', 'unnamed-skill/SKILL.md': 'New.\n' },
};
const bumpProject = (dir, config = CONFIG) =>
  project(dir, 'app', { config, agents: '# App\n', files: { '.agents/rules/qa.mdc': 'Run `pstack:thermos` on each slice.\n' } });
test('a bump diffs anchored files, agents included, and skills the project rules name, and counts the rest', () => {
  const { dir, cli } = sandbox({ upstream: pstackRepo(mkdtempSync(join(tmpdir(), 'sync-pstack-upstream-')), BUMP) });
  const root = bumpProject(dir);
  cli('apply', root);
  const result = cli('apply', root, '--tag', 'v0.9.53', '--dry-run');
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /pstack changed in files this project anchors on[^\n]*\n(?: +[^\n]*\n)*? +-Never edit\.$/m);
  assert.match(result.stdout, /pstack changed in skills the shared or project rules name without a note[^\n]*\n(?: +[^\n]*\n)*? +-Review in two lanes\.$/m);
  assert.match(result.stdout, /pstack changed files no rule file anchors or names[^\n]*\n +unnamed-skill: 1 added$/m);
  const items = reviewItems(result.stdout);
  assert.ok(items.some((item) => /^\.\.\/agents\/comment-sicko\.md @@ /.test(item)), items.join('\n'));
  assert.ok(items.some((item) => /^thermos\/SKILL\.md @@ /.test(item)), items.join('\n'));
  assert.ok(items.includes('unnamed-skill: 1 added'), items.join('\n'));
});

test('a bump writes only once every item of its report has a disposition with a reason', () => {
  const { dir, cli } = sandbox({ upstream: pstackRepo(mkdtempSync(join(tmpdir(), 'sync-pstack-upstream-')), BUMP) });
  const root = bumpProject(dir);
  cli('apply', root);
  const items = reviewItems(cli('apply', root, '--tag', 'v0.9.53', '--dry-run').stdout);
  const tsv = join(dir, 'dispositions.tsv');
  const refused = (pattern) => {
    const result = cli('apply', root, '--tag', 'v0.9.53', '--dispositions', tsv);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stdout, pattern);
    assert.equal(readJson(root, '.agents/pstack.json').tag, 'v0.9.52');
  };
  const missing = cli('apply', root, '--tag', 'v0.9.53');
  assert.equal(missing.status, 1, missing.stdout);
  assert.match(missing.stdout, /refused pstack dispositions: pstack changed between the tags; read the bump report and pass --dispositions/);
  writeFileSync(tsv, items.slice(1).map((item) => `${item}\tnone\tno rule names it`).join('\n'));
  refused(/1 item\(s\) in the bump report have no row/);
  writeFileSync(tsv, items.map((item, index) => `${item}\t${index === 0 ? 'ignored' : 'none'}\tno rule names it`).join('\n'));
  refused(/has disposition "ignored", which is not one of none, covered, noted, rewritten, dropped/);
  writeFileSync(tsv, items.map((item, index) => `${item}\tnone\t${index === 0 ? '' : 'no rule names it'}`).join('\n'));
  refused(/gives no reason for "none"/);
  writeFileSync(tsv, items.map((item) => `${item}\tnone\tno rule names it`).join('\n'));
  const written = cli('apply', root, '--tag', 'v0.9.53', '--dispositions', tsv);
  assert.equal(written.status, 0, written.stdout);
  assert.equal(readJson(root, '.agents/pstack.json').tag, 'v0.9.53');
});

test('a bump from a pinned tag upstream lacks refuses and keeps the pin', () => {
  const { dir, cli } = sandbox({ upstream: pstackRepo(mkdtempSync(join(tmpdir(), 'sync-pstack-upstream-')), BUMP) });
  const root = bumpProject(dir, { ...CONFIG, tag: 'v0.9.40' });
  cli('apply', root);
  const result = cli('apply', root, '--tag', 'v0.9.53');
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout, /refused pstack diff: cannot compare pstack v0\.9\.40 with v0\.9\.53: .*has no tag v0\.9\.40/);
  assert.equal(readJson(root, '.agents/pstack.json').tag, 'v0.9.40');
});

test('apply --tag at the pinned tag still refuses a note whose text pstack lacks', () => {
  const upstream = pstackRepo(mkdtempSync(join(tmpdir(), 'sync-pstack-upstream-')), { 'v0.9.52': { 'ketchup/SKILL.md': ABSENT } });
  const { dir, cli } = sandbox({ upstream });
  const root = project(dir, 'app', { config: CONFIG, agents: '# App\n' });
  const result = cli('apply', root, '--tag', 'v0.9.52');
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout, /refused pstack anchors: the block relies on ketchup\/SKILL\.md, which pstack v0\.9\.52 no longer has/);
  assert.equal(existsSync(join(root, '.agents/pstack')), false);
});

test('namesSkill matches a skill the rules cite, not a bare word', () => {
  assert.equal(namesSkill('the `pstack:ketchup` skill', 'ketchup'), true);
  assert.equal(namesSkill('run `/setup-pstack` first', 'setup-pstack'), true);
  assert.equal(namesSkill('the `how explorer` role', 'how'), true);
  assert.equal(namesSkill('run the **arena** skill', 'arena'), true);
  assert.equal(namesSkill('overrides interrogate/SKILL.md "x"', 'interrogate'), true);
  assert.equal(namesSkill('say how it works', 'how'), false);
  assert.equal(namesSkill('`setup-pstack-extra`', 'setup-pstack'), false);
});

test('a bump diffs a skill that only a file AGENTS.md names mentions', () => {
  const { dir, cli } = sandbox({ upstream: pstackRepo(mkdtempSync(join(tmpdir(), 'sync-pstack-upstream-')), BUMP) });
  const root = project(dir, 'app', { config: CONFIG, agents: '# App\n\nRead CODING_STANDARDS.md.\n', files: { 'CODING_STANDARDS.md': 'Run `pstack:thermos` on each slice.\n' } });
  cli('apply', root);
  const result = cli('apply', root, '--tag', 'v0.9.53', '--dry-run');
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /pstack changed in skills the shared or project rules name without a note[^\n]*\n(?: +[^\n]*\n)*? +-Review in two lanes\.$/m);
});
