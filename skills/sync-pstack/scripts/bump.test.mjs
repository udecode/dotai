import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { CONFIG, project, read, readJson } from './test-sandbox.mjs';
import { ABSENT, pstackRepo, sandbox } from './test-cli.mjs';

const reviewItems = (stdout) => {
  const lines = stdout.split('the write needs --dispositions')[1].split('\n').slice(1);
  const end = lines.findIndex((line) => !line.startsWith('    '));
  return lines.slice(0, end < 0 ? lines.length : end).map((line) => line.trim());
};

test('a pin adds the plugin, keeps other settings and their format, and a bump moves only the ref', () => {
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

test('a bump refuses when pstack dropped a playbook anchor and passes once updated', () => {
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
  const tsv = join(dir, 'dispositions.tsv');
  writeFileSync(tsv, reviewItems(cli('apply', root, '--tag', 'v0.9.53', '--dry-run').stdout).map((item) => `${item}\tnone\tno rule names it`).join('\n'));
  assert.equal(cli('apply', root, '--tag', 'v0.9.53', '--dispositions', tsv).status, 0);
});

const BUMP = {
  'v0.9.52': { 'thermos/SKILL.md': 'Review in two lanes.\n', '../agents/comment-sicko.md': 'Never edit.\n' },
  'v0.9.53': { 'thermos/SKILL.md': 'Review in three lanes.\n', '../agents/comment-sicko.md': 'Edit freely.\n', 'unnamed-skill/SKILL.md': 'New.\n' },
};

test('a bump diffs anchored files and named skills (including via AGENTS.md links) and enforces --dispositions', () => {
  const { dir, cli } = sandbox({ upstream: pstackRepo(mkdtempSync(join(tmpdir(), 'sync-pstack-upstream-')), BUMP) });
  const root = project(dir, 'app', {
    config: CONFIG,
    agents: '# App\n\nRead CODING_STANDARDS.md.\n',
    files: { 'CODING_STANDARDS.md': 'Run `pstack:thermos` on each slice.\n' },
  });
  cli('apply', root);
  const dry = cli('apply', root, '--tag', 'v0.9.53', '--dry-run');
  assert.equal(dry.status, 0, dry.stdout);
  assert.match(dry.stdout, /pstack changed in files this project anchors on[^\n]*\n(?: +[^\n]*\n)*? +-Never edit\.$/m);
  assert.match(dry.stdout, /pstack changed in skills the shared or project rules name without a note[^\n]*\n(?: +[^\n]*\n)*? +-Review in two lanes\.$/m);
  assert.match(dry.stdout, /pstack changed files no rule file anchors or names[^\n]*\n +unnamed-skill: 1 added$/m);

  const items = reviewItems(dry.stdout);
  assert.ok(items.some((item) => /^\.\.\/agents\/comment-sicko\.md @@ /.test(item)));
  assert.ok(items.some((item) => /^thermos\/SKILL\.md @@ /.test(item)));
  assert.ok(items.includes('unnamed-skill: 1 added'));

  const tsv = join(dir, 'dispositions.tsv');
  const refused = (pattern) => {
    const result = cli('apply', root, '--tag', 'v0.9.53', '--dispositions', tsv);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stdout, pattern);
    assert.equal(readJson(root, '.agents/pstack.json').tag, 'v0.9.52');
  };
  assert.match(cli('apply', root, '--tag', 'v0.9.53').stdout, /refused pstack dispositions:/);
  writeFileSync(tsv, items.slice(1).map((item) => `${item}\tnone\tno rule names it`).join('\n'));
  refused(/1 item\(s\) in the bump report have no row/);
  writeFileSync(tsv, items.map((item, i) => `${item}\t${i === 0 ? 'ignored' : 'none'}\tno rule names it`).join('\n'));
  refused(/has disposition "ignored"/);
  writeFileSync(tsv, items.map((item, i) => `${item}\tnone\t${i === 0 ? '' : 'no rule names it'}`).join('\n'));
  refused(/gives no reason for "none"/);
  writeFileSync(tsv, items.map((item) => `${item}\tnone\tno rule names it`).join('\n'));
  const written = cli('apply', root, '--tag', 'v0.9.53', '--dispositions', tsv);
  assert.equal(written.status, 0, written.stdout);
  assert.equal(readJson(root, '.agents/pstack.json').tag, 'v0.9.53');
});

test('a bump refuses an unknown pinned tag or a missing relies-on file at the pinned tag', () => {
  const { dir, cli } = sandbox({ upstream: pstackRepo(mkdtempSync(join(tmpdir(), 'sync-pstack-upstream-')), BUMP) });
  const missingTag = project(dir, 'missing-tag', { config: { ...CONFIG, tag: 'v0.9.40' }, agents: '# App\n' });
  cli('apply', missingTag);
  const diffFail = cli('apply', missingTag, '--tag', 'v0.9.53');
  assert.equal(diffFail.status, 1);
  assert.match(diffFail.stdout, /refused pstack diff: .*has no tag v0\.9\.40/);
  assert.equal(readJson(missingTag, '.agents/pstack.json').tag, 'v0.9.40');

  const upstream = pstackRepo(mkdtempSync(join(tmpdir(), 'sync-pstack-upstream-')), { 'v0.9.52': { 'ketchup/SKILL.md': ABSENT } });
  const box = sandbox({ upstream });
  const root = project(box.dir, 'app', { config: CONFIG, agents: '# App\n' });
  const anchorFail = box.cli('apply', root, '--tag', 'v0.9.52');
  assert.equal(anchorFail.status, 1);
  assert.match(anchorFail.stdout, /refused pstack anchors: the block relies on ketchup\/SKILL\.md/);
  assert.equal(existsSync(join(root, '.agents/pstack')), false);
});
