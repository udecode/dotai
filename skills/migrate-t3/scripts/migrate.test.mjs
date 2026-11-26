import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { convertClaudeMcpServer, runMigration } from './migrate.mjs';

function makeEnv() {
  const root = mkdtempSync(join(tmpdir(), 'migrate-t3-'));
  const home = join(root, 'home');
  const repo = join(root, 'repo');
  mkdirSync(home, { recursive: true });
  mkdirSync(repo, { recursive: true });
  return { home, repo };
}

test('convertClaudeMcpServer translates http url to serverUrl and preserves stdio fields', () => {
  assert.deepEqual(
    convertClaudeMcpServer({ headers: { Authorization: 'Bearer x' }, type: 'http', url: 'https://mcp.example.com/mcp' }),
    { headers: { Authorization: 'Bearer x' }, serverUrl: 'https://mcp.example.com/mcp' }
  );
  assert.deepEqual(convertClaudeMcpServer({ args: ['-y', '@playwright/mcp'], command: 'npx', env: { FOO: '1' } }), {
    args: ['-y', '@playwright/mcp'],
    command: 'npx',
    env: { FOO: '1' },
  });
  assert.equal(convertClaudeMcpServer({}), null);
});

test('apply migrates Claude MCPs, seeds gemini and T3 defaults while preserving local keys, links T3 profile, and is idempotent', () => {
  const { home, repo } = makeEnv();

  mkdirSync(join(home, 'Library/Application Support/Claude'), { recursive: true });
  writeFileSync(
    join(home, 'Library/Application Support/Claude/claude_desktop_config.json'),
    JSON.stringify({
      mcpServers: {
        linear: { type: 'http', url: 'https://mcp.linear.app/mcp' },
        playwright: { args: ['-y', '@playwright/mcp@latest'], command: 'npx' },
      },
    })
  );
  writeFileSync(
    join(home, '.claude.json'),
    JSON.stringify({
      mcpServers: {
        linear: { type: 'http', url: 'https://should-not-override-desktop.example' },
        nango: { type: 'http', url: 'https://mcp.nango.dev/mcp' },
      },
      projects: {
        [resolve(repo)]: {
          mcpServers: {
            projectApi: { type: 'http', url: 'https://api.example.com/mcp' },
          },
        },
      },
    })
  );
  mkdirSync(join(home, '.claude/skills'), { recursive: true });
  writeFileSync(join(home, '.claude/CLAUDE.md'), '# Global rules\n');
  mkdirSync(join(home, '.gemini/config/plugins/pstack/.antigravity-plugin'), { recursive: true });
  writeFileSync(
    join(home, '.gemini/config/plugins/pstack/.antigravity-plugin/plugin.json'),
    JSON.stringify({ name: 'pstack', version: '0.9.145' })
  );
  mkdirSync(join(home, '.gemini/antigravity-cli'), { recursive: true });
  writeFileSync(join(home, '.gemini/antigravity-cli/mcp_oauth_tokens.json'), '{"linear":"tok"}\n');

  mkdirSync(join(home, '.t3/userdata'), { recursive: true });
  writeFileSync(
    join(home, '.t3/userdata/settings.json'),
    JSON.stringify({
      projectSettingsOverrides: { 'local-proj-uuid': { defaultAutoPull: true } },
    })
  );
  writeFileSync(
    join(home, '.t3/userdata/client-settings.json'),
    JSON.stringify({
      browserProfiles: [{ id: 'chrome-default' }],
      fontSizeInterface: 15,
      voiceMicrophones: [{ deviceId: 'dev-1', kind: 'device', label: 'My Mic' }],
    })
  );

  const profile = join(home, '.t3/userdata/providers/antigravity/abcdef1234567890');
  mkdirSync(join(profile, 'config'), { recursive: true });
  writeFileSync(join(profile, 'config/mcp_config.json'), '');

  mkdirSync(join(repo, '.claude'), { recursive: true });
  writeFileSync(
    join(repo, '.claude/settings.json'),
    JSON.stringify({
      enabledPlugins: { 'pstack@pstack-claude': true },
      extraKnownMarketplaces: { 'pstack-claude': { source: { ref: 'v0.9.145', repo: 'michael-denyer/pstack-claude' } } },
    })
  );
  writeFileSync(join(repo, 'AGENTS.md'), '# Repo rules\n');

  const auditBefore = runMigration({ apply: false, checkBinaries: false, cwd: repo, home, platform: 'darwin' });
  assert.ok(auditBefore.todo.length >= 6);

  const applied = runMigration({ apply: true, checkBinaries: false, cwd: repo, home, platform: 'darwin' });
  assert.deepEqual(applied.todo, []);
  assert.ok(applied.changed.length >= 7);

  const t3Settings = JSON.parse(readFileSync(join(home, '.t3/userdata/settings.json'), 'utf8'));
  assert.deepEqual(t3Settings.defaultModelSelection, { instanceId: 'antigravity', model: 'gemini-4-neon' });
  assert.deepEqual(t3Settings.projectSettingsOverrides, { 'local-proj-uuid': { defaultAutoPull: true } });

  const t3Client = JSON.parse(readFileSync(join(home, '.t3/userdata/client-settings.json'), 'utf8'));
  assert.equal(t3Client.followUpBehavior, 'steer');
  assert.equal(t3Client.fontSizeInterface, 15);
  assert.deepEqual(t3Client.browserProfiles, [{ id: 'chrome-default' }]);
  assert.deepEqual(t3Client.voiceMicrophones, [{ deviceId: 'dev-1', kind: 'device', label: 'My Mic' }]);

  const mcp = JSON.parse(readFileSync(join(home, '.gemini/config/mcp_config.json'), 'utf8'));
  assert.deepEqual(mcp.mcpServers, {
    linear: { serverUrl: 'https://mcp.linear.app/mcp' },
    nango: { serverUrl: 'https://mcp.nango.dev/mcp' },
    playwright: { args: ['-y', '@playwright/mcp@latest'], command: 'npx' },
    projectApi: { serverUrl: 'https://api.example.com/mcp' },
  });

  const skills = JSON.parse(readFileSync(join(home, '.gemini/config/skills.json'), 'utf8'));
  assert.deepEqual(
    skills.entries.map((entry) => entry.path),
    ['~/.agents/skills', '~/.claude/skills']
  );

  assert.equal(readFileSync(join(home, '.gemini/AGENTS.md'), 'utf8'), '# Global rules\n');
  assert.match(readFileSync(join(home, '.gemini/config/pstack-models.md'), 'utf8'), /ui, visual: opus @high/u);

  for (const [rel, target] of [
    ['AGENTS.md', join(home, '.gemini/AGENTS.md')],
    ['config/mcp_config.json', join(home, '.gemini/config/mcp_config.json')],
    ['config/skills.json', join(home, '.gemini/config/skills.json')],
    ['config/pstack-models.md', join(home, '.gemini/config/pstack-models.md')],
    ['config/plugins', join(home, '.gemini/config/plugins')],
    ['antigravity-acp/mcp_oauth_tokens.json', join(home, '.gemini/antigravity-cli/mcp_oauth_tokens.json')],
  ]) {
    const link = join(profile, rel);
    assert.ok(lstatSync(link).isSymbolicLink(), `${rel} should be a symlink`);
    assert.equal(resolve(join(link, '..'), readlinkSync(link)), resolve(target));
  }

  const second = runMigration({ apply: true, checkBinaries: false, cwd: repo, home, platform: 'darwin' });
  assert.deepEqual(second.changed, []);
  assert.deepEqual(second.todo, []);
});

test('t3Only updates only T3 settings without touching gemini config', () => {
  const { home, repo } = makeEnv();
  const res = runMigration({ apply: true, checkBinaries: false, cwd: repo, home, platform: 'darwin', t3Only: true });
  assert.deepEqual(res.todo, []);
  assert.equal(res.changed.length, 2);
  assert.equal(existsSync(join(home, '.gemini')), false);
});

test('apply refuses to overwrite non-empty local profile files and flags oversized AGENTS.md and stale pstack pin', () => {
  const { home, repo } = makeEnv();
  mkdirSync(join(home, '.gemini/config/plugins/pstack/.antigravity-plugin'), { recursive: true });
  writeFileSync(
    join(home, '.gemini/config/plugins/pstack/.antigravity-plugin/plugin.json'),
    JSON.stringify({ name: 'pstack', version: '0.9.140' })
  );
  writeFileSync(join(home, '.gemini/config/mcp_config.json'), JSON.stringify({ mcpServers: { linear: { serverUrl: 'https://mcp.linear.app/mcp' } } }));

  const profile = join(home, '.t3/userdata/providers/antigravity/deadbeef00001111');
  mkdirSync(join(profile, 'config'), { recursive: true });
  writeFileSync(join(profile, 'config/mcp_config.json'), '{"mcpServers":{"custom":{"command":"node"}}}\n');

  mkdirSync(join(repo, '.agents'), { recursive: true });
  writeFileSync(join(repo, '.agents/pstack.json'), JSON.stringify({ tag: 'v0.9.145' }));
  writeFileSync(join(repo, 'AGENTS.md'), 'x'.repeat(23_000));

  const res = runMigration({ apply: true, checkBinaries: false, cwd: repo, home, platform: 'darwin' });
  assert.ok(res.todo.some((line) => line.includes('non-empty local file')));
  assert.ok(res.todo.some((line) => line.includes('from 0.9.140 to 0.9.145')));
  assert.ok(res.todo.some((line) => line.includes('23000 bytes')));
  assert.equal(readFileSync(join(profile, 'config/mcp_config.json'), 'utf8'), '{"mcpServers":{"custom":{"command":"node"}}}\n');
});
