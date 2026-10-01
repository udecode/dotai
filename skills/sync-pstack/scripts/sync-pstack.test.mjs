import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { hintModes, overrideAnchors, render } from './sync-pstack.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'sync-pstack.mjs');
const TEMPLATE = readFileSync(join(HERE, '../assets/block.md'), 'utf8');
const HELPERS = join(HERE, '../assets/pstack');
const CONFIG = {
  tag: 'v0.9.52',
  branch: 'next',
  protected: 'main',
  delivery: 'push',
  lintFix: 'bun run lint:fix',
  check: 'bun check',
  plans: 'docs/plans',
  risk: 'auth changes',
  skip: [],
};

const commit = (root, message) =>
  spawnSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qam', message]);

const ABSENT = Symbol('absent at this tag');

function pstackRepo(dir, tags) {
  const repo = join(dir, 'pstack');
  spawnSync('git', ['init', '-q', repo]);
  const base = {};
  for (const { path, anchor } of overrideAnchors(TEMPLATE)) base[path] = `${base[path] ?? ''}${anchor}\n`;
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

const PSTACK = pstackRepo(mkdtempSync(join(tmpdir(), 'sync-pstack-upstream-')), { 'v0.9.52': {}, 'v0.9.53': {} });

function sandbox({ upstream = PSTACK } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sync-pstack-test-'));
  const home = join(dir, 'home');
  mkdirSync(home);
  const env = { ...process.env, HOME: home, SYNC_PSTACK_UPSTREAM: upstream };
  const run = (command, args, cwd) => spawnSync(command, args, { cwd, encoding: 'utf8', env });
  return { dir, home, run, cli: (...args) => run(process.execPath, [SCRIPT, ...args]) };
}

// A git checkout holding a copy of this skill, standing in for the dotai checkout.
function sharedSource(dir) {
  const repo = join(dir, 'dotai');
  cpSync(dirname(HERE), join(repo, 'skills/sync-pstack'), { recursive: true });
  spawnSync('git', ['init', '-q', repo]);
  spawnSync('git', ['-C', repo, 'add', '.']);
  commit(repo, 'shared source');
  return { repo, script: join(repo, 'skills/sync-pstack/scripts/sync-pstack.mjs'), template: join(repo, 'skills/sync-pstack/assets/block.md') };
}

function project(dir, name, { config, agents, settings, files = {} } = {}) {
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

const read = (root, path) => readFileSync(join(root, path), 'utf8');
const readJson = (root, path) => JSON.parse(read(root, path));

test('the CLI runs when invoked through a symlinked install', () => {
  const { dir, run } = sandbox();
  symlinkSync(dirname(HERE), join(dir, 'installed'));
  const result = run(process.execPath, [join(dir, 'installed/scripts/sync-pstack.mjs'), 'help']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Usage: node sync-pstack\.mjs/);
});

test('render keeps only the regions the config selects and refuses what it cannot render', () => {
  const template = [
    '<!-- # a template note -->',
    'on {{branch}}',
    '<!-- if delivery=push -->',
    'push only',
    '<!-- end -->',
    '<!-- if delivery=user|pr -->',
    'not push',
    '<!-- end -->',
    '<!-- section tests -->',
    'tests',
    '<!-- if !risk -->',
    'review on request',
    '<!-- end -->',
    '<!-- end -->',
    'always',
  ].join('\n');
  assert.equal(render(template, { branch: 'next', delivery: 'user', risk: '', skip: [] }), 'on next\nnot push\ntests\nreview on request\nalways');
  assert.equal(render(template, { branch: 'next', delivery: 'push', risk: 'auth', skip: ['tests'] }), 'on next\npush only\nalways');
  assert.throws(() => render('run {{lintFix}}', { skip: [] }), /needs "lintFix"/);
  assert.throws(() => render('<!-- section tests -->\nx\n<!-- end -->', { skip: ['test'] }), /unknown sections: test/);
});

test('the shipped template renders cleanly for every delivery', () => {
  for (const delivery of ['push', 'pr', 'user']) {
    for (const reviewPr of [false, true]) {
      const block = render(TEMPLATE, { ...CONFIG, delivery, reviewPr });
      assert.doesNotMatch(block, /<!--|\{\{|\}\}/, `${delivery} reviewPr=${reviewPr}`);
    }
  }
});

test('apply inserts one block after the intro, and a second apply changes nothing', () => {
  const { dir, cli } = sandbox();
  const root = project(dir, 'app', { config: CONFIG, agents: '# App rules\n\nIntro.\n\n## Product\n\nKeep this.\n' });
  assert.equal(cli('apply', root).status, 0);
  const agents = read(root, 'AGENTS.md');
  assert.equal(agents.match(/<!-- pstack:begin/g).length, 1);
  assert.ok(agents.indexOf('Intro.') < agents.indexOf('<!-- pstack:begin'));
  assert.ok(agents.indexOf('<!-- pstack:end -->') < agents.indexOf('## Product\n\nKeep this.'));
  assert.equal(read(root, '.agents/pstack/plan-open.mjs'), readFileSync(join(HELPERS, 'plan-open.mjs'), 'utf8'));

  const again = cli('apply', root);
  assert.match(again.stdout, /in sync/);
  assert.equal(read(root, 'AGENTS.md'), agents);
  assert.equal(cli('check', root).status, 0);
});

test('check fails once the project config moves past what was applied', () => {
  const { dir, cli } = sandbox();
  const root = project(dir, 'app', { config: CONFIG, agents: '# App\n' });
  cli('apply', root);
  writeFileSync(join(root, '.agents/pstack.json'), JSON.stringify({ ...readJson(root, '.agents/pstack.json'), tag: 'v0.9.53' }));
  const check = cli('check', root);
  assert.equal(check.status, 1);
  assert.match(check.stdout, /stale AGENTS\.md/);
  assert.match(check.stdout, /stale \.claude\/settings\.json/);
});

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
test('project playbooks render into the block, and a new one makes check stale', () => {
  const { dir, cli } = sandbox();
  const playbook = '---\nextends: bug-fix\nwhen: Use it for any bug report.\n---\n# Bug fix\n';
  const root = project(dir, 'app', { config: CONFIG, agents: '# App\n', files: { '.agents/playbooks/bug-fix.md': playbook } });
  assert.equal(cli('apply', root).status, 0);
  assert.match(read(root, 'AGENTS.md'), /`\.agents\/playbooks\/bug-fix\.md`, on top of pstack's `bug-fix`\. Use it for any bug report\./);
  writeFileSync(join(root, '.agents/playbooks/plan.md'), '---\nextends: multi-phase-plan\nwhen: Use it to plan.\n---\n');
  assert.equal(cli('check', root).status, 1);
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
  assert.equal(cli('apply', root, '--tag', 'v0.9.53').status, 0);
});

test('verify flags a playbook that extends a missing pstack playbook, a change with no anchor, and an override pstack no longer says', () => {
  const upstream = pstackRepo(mkdtempSync(join(tmpdir(), 'sync-pstack-upstream-')), {
    'v0.9.52': { 'poteto-mode/playbooks/feature.md': ABSENT },
  });
  const { dir, cli } = sandbox({ upstream });
  const root = project(dir, 'app', {
    config: CONFIG,
    agents: '# App\n',
    files: {
      '.agents/playbooks/ship.md': '---\nextends: shipping-v2\nwhen: Use it to ship.\n---\n',
      '.agents/playbooks/fix.md': '---\nextends: bug-fix\nwhen: Use it to fix.\n---\n- **After** \u201cReproduce it\u201d: compare with main.\n',
    },
  });
  cli('apply', root);
  const result = cli('verify', root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /\.agents\/playbooks\/ship\.md extends `shipping-v2`, which pstack v0\.9\.52 does not have/);
  assert.match(result.stdout, /\.agents\/playbooks\/fix\.md has a change with no straight-quoted pstack text to anchor on/);
  assert.match(result.stdout, /the block overrides poteto-mode\/playbooks\/feature\.md, which pstack v0\.9\.52 no longer has/);
});

test('smoke runs each prompt in both runtimes from the project root, without CLAUDECODE, and prints only their answers', () => {
  const { dir, home } = sandbox();
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\necho "progress noise" >&2\necho "claude in $(pwd) CLAUDECODE=${CLAUDECODE:-unset}: $*"\n', { mode: 0o755 });
  const codex = [
    '#!/bin/sh',
    'flags="$1 $2 $3"',
    'while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2 ;; *) prompt="$1"; shift ;; esac; done',
    'echo "transcript noise"',
    'echo "progress noise" >&2',
    'if [ -p /dev/stdin ] || [ -S /dev/stdin ]; then echo "stdin was left open" > "$out"; else echo "codex in $(pwd) with $flags: $prompt" > "$out"; fi',
  ].join('\n');
  writeFileSync(join(bin, 'codex'), `${codex}\n`, { mode: 0o755 });
  const root = realpathSync(project(dir, 'app', { agents: '# App\n' }));
  const result = spawnSync(process.execPath, [SCRIPT, 'smoke', root, 'the toolbar closes'], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, CLAUDECODE: '1' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`claude in ${root} CLAUDECODE=unset: -p --permission-mode plan the toolbar closes`), result.stdout);
  assert.ok(result.stdout.includes(`codex in ${root} with exec --sandbox read-only: the toolbar closes`), result.stdout);
  assert.doesNotMatch(result.stdout, /noise/);
});

test('smoke fails when a runtime exits cleanly with no answer', () => {
  const { dir, home } = sandbox();
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\necho "a plan"\n', { mode: 0o755 });
  writeFileSync(join(bin, 'codex'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const root = project(dir, 'app', { agents: '# App\n' });
  const result = spawnSync(process.execPath, [SCRIPT, 'smoke', root, 'the toolbar closes'], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` },
  });
  assert.equal(result.status, 1, result.stdout);
});

test('argument-hint modes are the literal words that open an alternative, outside placeholders', () => {
  assert.deepEqual(hintModes("argument-hint: '[<question | plan path to extend> | diagnose <report> | --deep]'"), ['diagnose']);
  assert.deepEqual(hintModes('argument-hint: [sync [package] | <path>]'), ['sync']);
});

test('playbook prints each base with the project changes applied at their steps, in order', () => {
  const upstream = pstackRepo(mkdtempSync(join(tmpdir(), 'sync-pstack-upstream-')), {
    'v0.9.52': { 'poteto-mode/playbooks/feature.md': '### Feature\n\n1. Read the code.\n2. Design it.\n3. Write the code.\n   Keep it small.\n4. Verify it.\n\n**Reply:** done.\n' },
  });
  const { dir, cli } = sandbox({ upstream });
  const playbook = [
    '---\nextends: feature\nwhen: Use it to build.\n---\n',
    '- **Replace** "Design it": skip, the plan settled it.',
    '- **In** "Write the code": follow the plan slices.',
    '- **After** "Verify it": record the result.',
    '- **Before** "Read the code": reread the plan.',
    '- At the close, report the next item.\n',
  ].join('\n');
  const root = project(dir, 'app', { config: CONFIG, agents: '# App\n', files: { '.agents/playbooks/build.md': playbook } });
  const result = cli('playbook', root, 'build');
  assert.equal(result.status, 0, result.stderr);
  const order = ['reread the plan', 'Read the code', 'skip, the plan settled it', 'Keep it small', 'follow the plan slices', 'Verify it', 'record the result', 'report the next item'];
  const at = order.map((text) => result.stdout.indexOf(text));
  assert.ok(at.every((index, i) => index >= 0 && (i === 0 || index > at[i - 1])), result.stdout);
  assert.doesNotMatch(result.stdout.slice(0, at[2]), /2\. Design it/);
});

test('playbook flags two changes that replace one step, and keeps a change body that wraps', () => {
  const upstream = pstackRepo(mkdtempSync(join(tmpdir(), 'sync-pstack-upstream-')), {
    'v0.9.52': { 'poteto-mode/playbooks/feature.md': '1. Design it.\n2. Verify it.\n' },
  });
  const { dir, cli } = sandbox({ upstream });
  const playbook = '---\nextends: feature\nwhen: Use it to build.\n---\n- **Replace** "Design it": use the plan.\n- **Replace** "Design it": skip it.\n- **After** "Verify it": record the result\n  and report it.\n';
  const root = project(dir, 'app', { config: CONFIG, agents: '# App\n', files: { '.agents/playbooks/build.md': playbook } });
  const result = cli('playbook', root, 'build');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /two changes replace step 1/);
  assert.match(result.stdout, /record the result and report it\./);
});

test('a bump prints the pstack diff of anchored files even when every anchor holds', () => {
  const upstream = pstackRepo(mkdtempSync(join(tmpdir(), 'sync-pstack-upstream-')), {
    'v0.9.52': { 'poteto-mode/playbooks/bug-fix.md': '1. Reproduce it yourself on the matching surface.\n2. Plan the fix and review the diff.\n' },
    'v0.9.53': { 'poteto-mode/playbooks/bug-fix.md': '1. Reproduce it yourself on the matching surface.\n2. Plan the fix.\n' },
  });
  const { dir, cli } = sandbox({ upstream });
  const playbook = '---\nextends: bug-fix\nwhen: Use it for any bug report.\n---\n- **After** "Reproduce it yourself": compare with main.\n';
  const root = project(dir, 'app', { config: CONFIG, agents: '# App\n', files: { '.agents/playbooks/bug-fix.md': playbook } });
  cli('apply', root);
  const result = cli('apply', root, '--tag', 'v0.9.53', '--dry-run');
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /^ +-2\. Plan the fix and review the diff\.$/m);
});

test('status flags an upstream VERSION ahead of the newest tag', () => {
  const upstream = pstackRepo(mkdtempSync(join(tmpdir(), 'sync-pstack-upstream-')), { 'v0.9.52': {} });
  writeFileSync(join(upstream, 'VERSION'), '0.9.53\n');
  spawnSync('git', ['-C', upstream, 'add', '-A']);
  commit(upstream, 'bump without a tag');
  const { dir, cli } = sandbox({ upstream });
  const root = project(dir, 'app', { config: CONFIG, agents: '# App\n' });
  const result = cli('status', root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /upstream VERSION 0\.9\.53 is ahead of the newest tag v0\.9\.52/);
});

test('verify flags a typed mode cut from an argument hint', () => {
  const { dir, home, cli } = sandbox();
  const rule = (hint) => `---\ndescription: fix a bug\nargument-hint: '${hint}'\n---\n# Patch\n`;
  const root = project(dir, 'app', {
    config: CONFIG,
    agents: '# App\n',
    files: { '.agents/rules/patch.mdc': rule('[<report> | corpus <cases>]'), '.agents/skills/patch/SKILL.md': '---\nname: patch\n---\n# Patch\n' },
  });
  spawnSync(process.execPath, [SCRIPT, 'apply', root], { env: { ...process.env, HOME: home, SYNC_PSTACK_UPSTREAM: PSTACK } });
  spawnSync('git', ['-C', root, 'add', '-A']);
  commit(root, 'before setup');
  writeFileSync(join(root, '.agents/rules/patch.mdc'), rule('[<report>]'));
  const claude = join(home, '.claude/projects', root.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(claude, { recursive: true });
  writeFileSync(join(claude, 'session.jsonl'), JSON.stringify({ type: 'user', timestamp: new Date().toISOString(), message: { role: 'user', content: '/patch corpus the toolbar cases' } }));
  const result = cli('verify', root);
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout, /typed mode `patch corpus` \(typed 1 times\) was cut from its argument hint/);
});

test('status finds managed, pinned and vendored pstack projects under a root', () => {
  const { dir, cli } = sandbox();
  const repos = join(dir, 'repos');
  const managed = project(repos, 'managed', { config: CONFIG, agents: '# A\n' });
  const pinned = project(repos, 'pinned', { settings: { enabledPlugins: { 'pstack@pstack-claude': true } } });
  const vendored = project(repos, 'vendored', { files: { '.agents/skills/poteto-mode/SKILL.md': '---\nname: poteto-mode\n---\n' } });
  project(repos, 'plain', { agents: '# Plain\n' });
  const status = cli('status', '--root', repos, '--json', '--offline');
  assert.equal(status.status, 0, status.stderr);
  assert.deepEqual(
    JSON.parse(status.stdout).projects.map((state) => state.path),
    [managed, pinned, vendored],
  );
});

test('discover counts only what the user typed: Claude Code, Codex sessions and archives, once per forked turn', () => {
  const { dir, home, cli } = sandbox();
  const root = project(dir, 'app', { files: { '.agents/rules/task.mdc': '---\n---\n', '.agents/skills/patch/SKILL.md': '---\nname: patch\n---\n' } });
  const now = new Date().toISOString();
  const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const claude = join(home, '.claude/projects', root.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(claude, { recursive: true });
  writeFileSync(
    join(claude, 'session.jsonl'),
    [
      { type: 'user', timestamp: now, message: { role: 'user', content: '<command-name>/task</command-name>' } },
      { type: 'user', timestamp: now, isMeta: true, message: { role: 'user', content: 'Base directory for this skill. Run /task.' } },
      { type: 'user', timestamp: old, message: { role: 'user', content: [{ type: 'text', text: 'use $task here' }] } },
      { type: 'user', timestamp: now, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: '/task' }] } },
    ]
      .map((line) => JSON.stringify(line))
      .join('\n'),
  );
  const codex = join(home, '.codex/sessions/2026/09/30');
  mkdirSync(codex, { recursive: true });
  const typed = { type: 'item_completed', turn_id: 't1', item: { type: 'UserMessage', content: [{ type: 'text', text: 'run [$patch](/x/SKILL.md)' }] } };
  writeFileSync(
    join(codex, 'rollout.jsonl'),
    [
      { type: 'session_meta', payload: { cwd: root } },
      { timestamp: now, type: 'event_msg', payload: typed },
      { timestamp: now, type: 'event_msg', payload: typed },
      { timestamp: now, type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'AGENTS.md says $patch' }] } },
    ]
      .map((line) => JSON.stringify(line))
      .join('\n'),
  );
  const archived = (path, meta, ...messages) => {
    mkdirSync(join(home, path, '..'), { recursive: true });
    writeFileSync(
      join(home, path),
      [{ type: 'session_meta', payload: { cwd: root, ...meta } }, ...messages.map(([turn_id, message]) => ({ timestamp: old, type: 'event_msg', payload: { type: 'user_message', turn_id, message } }))]
        .map((line) => JSON.stringify(line))
        .join('\n'),
    );
  };
  const typedTask = ['a1', 'go [$task](/x/SKILL.md)'];
  archived('.codex/archived_sessions/2026/08/01/rollout-a.jsonl', {}, typedTask, ['a3', 'and [$task](/x/SKILL.md) again'], ['a2', '# Files pasted by the user:\n## "use [$patch](/x/SKILL.md) next…": /tmp/Pasted text.txt\n## My request: hhf']);
  archived('.codex/sessions/2026/09/30/rollout-fork.jsonl', {}, typedTask);
  archived('.codex/sessions/2026/09/30/rollout-sub.jsonl', { thread_source: 'subagent' }, ['b1', 'brief: run [$patch](/x/SKILL.md)']);
  const result = cli('discover', root);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).typed.counts, { patch: { all: 1, week: 1 }, task: { all: 4, week: 1 } });
});

test('discover flags skills added in the last two weeks, even untyped ones', () => {
  const { dir, cli } = sandbox();
  const root = project(dir, 'app', { files: { '.agents/rules/old.mdc': '---\n---\n' } });
  const past = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  spawnSync('git', ['-C', root, 'add', '-A']);
  spawnSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'old'], { env: { ...process.env, GIT_AUTHOR_DATE: past, GIT_COMMITTER_DATE: past } });
  mkdirSync(join(root, '.agents/skills/fresh'), { recursive: true });
  writeFileSync(join(root, '.agents/skills/fresh/SKILL.md'), '---\nname: fresh\n---\n');
  const result = cli('discover', root);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).recent, ['fresh']);
});

// A managed project at its pre-setup commit: a typed `task` rule, a rule that
// routes to it, and a skill the docs tell users to install.
function setupFixture(dir, home) {
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

test('verify fails a setup that cut a typed command, left dead links or retired names, coupled a public skill, or drifted the block', () => {
  const { dir, home, cli } = sandbox();
  const root = setupFixture(dir, home);
  for (const path of ['.agents/rules/task.mdc', '.agents/skills/task/SKILL.md']) rmSync(join(root, path));
  writeFileSync(join(root, '.agents/skills/sync-ui/SKILL.md'), '---\nname: sync-ui\n---\n# Sync UI\n\nClose with `node .agents/pstack/plan-open.mjs <plan>`.\n');
  writeFileSync(join(root, 'AGENTS.md'), read(root, 'AGENTS.md').replace('Never claim a skipped or unavailable proof passed.', 'Never claim an unrun proof passed.'));

  const result = cli('verify', root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /typed command `task` .*no longer resolves/);
  assert.match(result.stdout, /\.agents\/skills\/feature\/SKILL\.md: dead link \.\.\/task\/SKILL\.md/);
  assert.match(result.stdout, /\.agents\/rules\/feature\.mdc:6: names retired `task`/);
  assert.match(result.stdout, /public skill `sync-ui` depends on \.agents\/pstack\//);
  assert.match(result.stdout, /block or helpers differ/);
});

test('verify accepts a typed command the owner dropped', () => {
  const { dir, home, cli } = sandbox();
  const root = setupFixture(dir, home);
  for (const path of ['.agents/rules/task.mdc', '.agents/skills/task/SKILL.md']) rmSync(join(root, path));
  writeFileSync(join(root, '.agents/rules/feature.mdc'), '---\ndescription: ship a feature\n---\n# Feature\n');
  writeFileSync(join(root, '.agents/skills/feature/SKILL.md'), '---\nname: feature\n---\n# Feature\n');
  const config = readJson(root, '.agents/pstack.json');
  writeFileSync(join(root, '.agents/pstack.json'), JSON.stringify({ ...config, dropped: ['task'] }, null, 2));
  const result = cli('verify', root);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('verify passes a setup that keeps typed commands as entry points', () => {
  const { dir, home, cli } = sandbox();
  const root = setupFixture(dir, home);
  writeFileSync(join(root, '.agents/rules/task.mdc'), '---\ndescription: alias for poteto-mode\n---\n# Task\n\nHand the request to pstack.\n');
  mkdirSync(join(root, '.agents/skills/vendor-orm/references'), { recursive: true });
  writeFileSync(join(root, '.agents/skills/vendor-orm/SKILL.md'), '---\nname: vendor-orm\n---\n# Vendor ORM\n');
  writeFileSync(join(root, '.agents/skills/vendor-orm/references/guide.md'), 'See [the ADR](../../docs/adr-1.md) in the upstream repo.\n');
  const result = cli('verify', root);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('plan-open reports an open box outside code and ignores one inside a fence', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', { files: { 'plan.md': '# Plan\n\n- [x] done: `bun test ./a.test.ts`\n- [ ] ship it\n\n```md\n- [ ] example\n```\n' } });
  const result = run(process.execPath, [join(HELPERS, 'plan-open.mjs'), 'plan.md'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^1 open item\(s\):\nplan\.md:4: - \[ \] ship it$/m);
});

test('plan-open makes a newly closed box name its artifact and a deferred finding name its owner', () => {
  const { dir, run } = sandbox();
  const legacy = '# Plan\n\nStatus: Done\n\n- [x] shipped long ago\n';
  const root = project(dir, 'app', { files: { 'plan.md': legacy } });
  run('git', ['add', '.'], root);
  run('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'plan'], root);
  const check = () => run(process.execPath, [join(HELPERS, 'plan-open.mjs'), 'plan.md'], root);

  writeFileSync(join(root, 'plan.md'), `${legacy}- [x] writing passes ran\n- [x] tests pass: \`bun test ./src/a.test.ts\`\n- [x] docs: skip: no docs changed\n\n## Deferred\n\n- schema check\n- ledger merge, owner: issue-harvester in docs/plans/next.md\n`);
  const result = check();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /plan\.md:6: .*writing passes ran/);
  assert.match(result.stderr, /plan\.md:12: .*schema check/);
  assert.doesNotMatch(result.stderr, /:5:|:7:|:8:|:13:/);
});

test('plan-open applies the closure checks before the plan is marked Done', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', { files: { 'plan.md': '# Plan\n\nStatus: In progress.\n' } });
  run('git', ['add', '.'], root);
  run('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'plan'], root);

  writeFileSync(join(root, 'plan.md'), '# Plan\n\nStatus: In progress.\n\n- [x] writing passes ran\n');
  const result = run(process.execPath, [join(HELPERS, 'plan-open.mjs'), 'plan.md'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /plan\.md:5: .*writing passes ran.*name the artifact/);
});

test('decisions-check append writes only a row that passes the check', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app');
  const append = (...cells) => run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'append', 'log.decisions.tsv', ...cells], root);

  assert.equal(append('fix', 'repair the parser', 'it dropped rows', 'ran the suite', 'verified on all fixtures').status, 1);
  assert.equal(append('fix', 'repair\tthe parser', 'it dropped rows', 'ran it, scope: fixtures', 'verified').status, 1);
  assert.equal(existsSync(join(root, 'log.decisions.tsv')), false);
  const ok = append('fix', 'repair the parser', 'it dropped rows', 'ran it, scope: all fixtures', 'verified');
  assert.equal(ok.status, 0, ok.stderr);
  const lines = read(root, 'log.decisions.tsv').trim().split('\n');
  assert.equal(lines[0], 'ts\tphase\tdecision\twhy\tevidence\tresult');
  assert.match(lines[1], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\tfix\trepair the parser\t/);
  assert.equal(run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'log.decisions.tsv'], root).status, 0);
});

test('decisions-check requires scope on a proven row and leaves committed rows alone', () => {
  const { dir, run } = sandbox();
  const header = 'ts\tphase\tdecision\twhy\tevidence\tresult';
  const legacy = '2026-09-01T00:00:00Z\tfix\told\tbecause\tno scope\tfixed it';
  const root = project(dir, 'app', { files: { 'log.decisions.tsv': `${header}\n${legacy}\n` } });
  run('git', ['add', '.'], root);
  run('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'log'], root);
  const check = () => run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'log.decisions.tsv'], root);

  writeFileSync(join(root, 'log.decisions.tsv'), `${header}\n${legacy}\n2026-09-02T00:00:00Z\tfix\tnew\tbecause\tran it\tverified at desktop\n`);
  const missing = check();
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /log\.decisions\.tsv:3: a verified result needs "scope:"/);
  assert.doesNotMatch(missing.stderr, /:2:/);

  writeFileSync(join(root, 'log.decisions.tsv'), `${header}\n${legacy}\n2026-09-02T00:00:00Z\tfix\tnew\tbecause\tscope: desktop\tverified at desktop\n`);
  assert.equal(check().status, 0);
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
  writeFileSync(shared.template, readFileSync(shared.template, 'utf8').replace('Never claim a skipped or unavailable proof passed.', 'Never claim an unrun proof passed.'));
  commit(shared.repo, 'template change');

  const refused = run(process.execPath, [shared.script, 'apply', root]);
  assert.equal(refused.status, 1);
  assert.match(refused.stdout, /the project's edit since the last sync/);
  assert.match(refused.stdout, /\+- \*\*Blocked \(local lesson\)\.\*\*/);
  assert.doesNotMatch(refused.stdout, /unrun proof/);
});

test('an older copy of the shared source refuses to undo a newer sync', () => {
  const { dir, run } = sandbox();
  const shared = sharedSource(dir);
  writeFileSync(shared.template, readFileSync(shared.template, 'utf8').replace('Never claim a skipped or unavailable proof passed.', 'Never claim an unrun proof passed.'));
  commit(shared.repo, 'newer rule');
  const root = project(dir, 'app', { config: CONFIG, agents: '# App\n' });
  run(process.execPath, [shared.script, 'apply', root]);
  run('git', ['checkout', '-q', 'HEAD~1'], shared.repo);

  const refused = run(process.execPath, [shared.script, 'apply', root]);
  assert.equal(refused.status, 1);
  assert.match(refused.stdout, /does not include/);
  assert.match(read(root, 'AGENTS.md'), /unrun proof/);
});

test('a sync from an uncommitted source records the commit once it lands', () => {
  const { dir, run } = sandbox();
  const shared = sharedSource(dir);
  writeFileSync(shared.template, readFileSync(shared.template, 'utf8').replace('Never claim a skipped or unavailable proof passed.', 'Never claim an unrun proof passed.'));
  const root = project(dir, 'app', { config: CONFIG, agents: '# App\n' });
  run(process.execPath, [shared.script, 'apply', root]);
  assert.equal(readJson(root, '.agents/pstack.json').synced.source, null);
  commit(shared.repo, 'newer rule');
  run(process.execPath, [shared.script, 'apply', root]);
  assert.match(readJson(root, '.agents/pstack.json').synced.source ?? '', /^[0-9a-f]{40}$/);
});

test('sync writes only a clean checkout on the project branch', () => {
  const { dir, cli, run } = sandbox();
  const root = project(dir, 'app', { config: CONFIG, agents: '# App\n' });
  cli('apply', root);
  run('git', ['add', '.'], root);
  commit(root, 'setup');
  writeFileSync(join(root, 'AGENTS.md'), `${read(root, 'AGENTS.md')}\nAn owner's unfinished edit.\n`);

  const dirty = cli('sync', '--tag', 'v0.9.53', root);
  assert.equal(dirty.status, 1);
  assert.match(dirty.stdout, /uncommitted edits to files the sync writes/);
  assert.equal(readJson(root, '.claude/settings.json').extraKnownMarketplaces['pstack-claude'].source.ref, 'v0.9.52');

  run('git', ['checkout', '-q', '--', 'AGENTS.md'], root);
  run('git', ['checkout', '-q', '-b', 'topic'], root);
  const offBranch = cli('sync', '--tag', 'v0.9.53', root);
  assert.equal(offBranch.status, 1);
  assert.match(offBranch.stdout, /the checkout is on topic, not next/);
});
