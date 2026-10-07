import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { hintModes, overrideAnchors, render, unmarkedRules } from './sync-pstack.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'sync-pstack.mjs');
const TEMPLATE = readFileSync(join(HERE, '../assets/block.md'), 'utf8');
const HELPERS = join(HERE, '../assets/pstack');
const AUDIT = join(HERE, 'audit.mjs');
const CONFIG = {
  tag: 'v0.9.52',
  branch: 'next',
  protected: 'main',
  delivery: 'push',
  lintFix: 'bun run lint:fix',
  check: 'bun check',
  plans: 'docs/plans',
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
    for (const reviewList of ['', '  - `pr`: Before opening a PR, the diff gets a panel.']) {
      const block = render(TEMPLATE, { ...CONFIG, delivery, reviewList });
      assert.doesNotMatch(block, /<!--|\{\{|\}\}/, `${delivery} reviewList=${Boolean(reviewList)}`);
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

test('apply installs every helper the rendered rules name, whichever sections are skipped', () => {
  const { dir, cli } = sandbox();
  const root = project(dir, 'app', { config: { ...CONFIG, skip: ['tests', 'review', 'plans', 'long-runs', 'commits'] }, agents: '# App\n' });
  assert.equal(cli('apply', root).status, 0);
  const named = new Set(read(root, 'AGENTS.md').match(/\.agents\/pstack\/[\w-]+\.mjs/gu));
  assert.ok(named.size > 0);
  for (const path of named) assert.ok(existsSync(join(root, path)), `${path} is named but not installed`);
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

test('the reviews list renders each row under the Panel rule, and an empty one says every panel waits for the user', () => {
  const { dir, cli } = sandbox();
  const listed = project(dir, 'listed', { config: { ...CONFIG, reviews: [{ id: 'pr', rule: 'Before opening a PR, the diff gets a panel.' }] }, agents: '# App\n' });
  const empty = project(dir, 'empty', { config: CONFIG, agents: '# App\n' });
  assert.equal(cli('apply', listed).status, 0);
  assert.equal(cli('apply', empty).status, 0);
  assert.match(read(listed, 'AGENTS.md'), /\n {2}- `pr`: Before opening a PR, the diff gets a panel\./);
  assert.match(read(empty, 'AGENTS.md'), /reviews list is empty, so panels run only where a pstack step calls for them or on the user's word/);
});

test('verify flags a playbook that runs a panel tool without citing a reviews row, a citation of a missing row, and a retired review field', () => {
  const { dir, cli } = sandbox();
  const root = project(dir, 'app', {
    config: { ...CONFIG, bigWork: 'a plan with more than one phase', reviews: [{ id: 'api-plan', rule: 'A plan with an API target gets architect, then a panel on the plan.' }] },
    agents: '# App\n',
    files: {
      '.agents/playbooks/plan.md':
        '---\nextends: multi-phase-plan\nwhen: Use it to plan.\n---\n- Run `pstack:architect` for an API target (reviews: api-plan).\n- Run `pstack:interrogate` on the winner.\n- Run `pstack:arena` on a hard slice (reviews: hard-slice).\n',
    },
  });
  cli('apply', root);
  const result = cli('verify', root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /\.agents\/playbooks\/plan\.md:6: names `pstack:interrogate` without citing a reviews row/);
  assert.match(result.stdout, /\.agents\/playbooks\/plan\.md:7: cites reviews row `hard-slice`, which \.agents\/pstack\.json does not list/);
  assert.doesNotMatch(result.stdout, /plan\.md:5:/);
  assert.match(result.stdout, /\.agents\/pstack\.json still sets `bigWork`; move it into `reviews`/);
});

test('apply drops the page lists from the config once a playbook carries them, and refuses until then', () => {
  const { dir, cli } = sandbox();
  const config = { ...CONFIG, pageLead: ['What other editors do'], pagePairs: ['Document shape'], pageTopic: { field: 'review_scopes', require: ['What other editors do'] } };
  const root = project(dir, 'app', { config, agents: '# App\n', files: { '.agents/playbooks/plan.md': '---\nextends: multi-phase-plan\nwhen: Use it to plan.\npage-lead: What other editors do\n---\n' } });
  const refused = cli('apply', root);
  assert.equal(refused.status, 1);
  assert.match(refused.stdout, /pagePairs "Document shape", pageTopic\.require "What other editors do"/);
  assert.ok(!existsSync(join(root, '.agents/pstack/plan-page.mjs')));
  writeFileSync(join(root, '.agents/playbooks/plan.md'), '---\nextends: multi-phase-plan\nwhen: Use it to plan.\npage-lead: What other editors do\npage-pairs: Document shape\npage-require: What other editors do\n---\n');
  assert.equal(cli('apply', root).status, 0);
  const applied = readJson(root, '.agents/pstack.json');
  assert.ok(!('pageLead' in applied) && !('pagePairs' in applied));
  assert.deepEqual(applied.pageTopic, { field: 'review_scopes' });
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
    'v0.9.52': { 'poteto-mode/playbooks/feature.md': ABSENT, 'poteto-mode/playbooks/triage.md': '1. Sort it.\n' },
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
  assert.match(result.stdout, /pstack v0\.9\.52 has the triage playbook, which PSTACK_PLAYBOOKS in the plan-page renderer lacks/);
  assert.doesNotMatch(result.stdout, /has the bug-fix playbook/);
});

test('smoke runs each prompt in both runtimes from the project root, without CLAUDECODE, and prints only their answers', () => {
  const { dir, home } = sandbox();
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\necho "progress noise" >&2\necho "claude in $(pwd) CLAUDECODE=${CLAUDECODE:-unset}: $*"\n', { mode: 0o755 });
  const codex = [
    '#!/bin/sh',
    'flags="$1 $2 $3 $4 $5"',
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
  assert.ok(result.stdout.includes(`claude in ${root} CLAUDECODE=unset: -p --model opus --permission-mode plan -- the toolbar closes`), result.stdout);
  assert.ok(result.stdout.includes(`codex in ${root} with exec -m gpt-6.1-sol --sandbox read-only: the toolbar closes`), result.stdout);
  assert.doesNotMatch(result.stdout, /noise/);
});

test('cross runs a prompt file in the other runtime: Codex from Claude Code, Claude from Codex', () => {
  const { dir, home } = sandbox();
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\necho "claude: $*"\n', { mode: 0o755 });
  writeFileSync(join(bin, 'codex'), '#!/bin/sh\nwhile [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2 ;; *) last="$1"; shift ;; esac; done\necho "codex: $last" > "$out"\n', { mode: 0o755 });
  writeFileSync(join(dir, 'brief.md'), 'Review docs/plans/x.md for gaps.');
  const cross = (env) =>
    spawnSync(process.execPath, [join(HELPERS, 'cross.mjs'), '--prompt-file', join(dir, 'brief.md')], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, CLAUDECODE: '', ...env },
    });
  const fromClaude = cross({ CLAUDECODE: '1' });
  assert.equal(fromClaude.status, 0, fromClaude.stderr);
  assert.equal(fromClaude.stdout.trim(), 'codex: Review docs/plans/x.md for gaps.');
  const fromCodex = cross({});
  assert.equal(fromCodex.stdout.trim(), 'claude: -p --model opus --settings {"disableAllHooks":true} --permission-mode plan -- Review docs/plans/x.md for gaps.');
});

test('cross runs a Codex seat read-only on the model and effort it names', () => {
  const { dir, home } = sandbox();
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'codex'), '#!/bin/sh\nargs="$*"\nwhile [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2 ;; *) shift ;; esac; done\necho "$args" > "$out"\n', { mode: 0o755 });
  const seat = spawnSync(process.execPath, [join(HELPERS, 'cross.mjs'), '--to', 'codex', '--model', 'gpt-6-astra', '--effort', 'high', 'review it'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, CLAUDECODE: '' },
  });
  assert.equal(seat.status, 0, seat.stderr);
  assert.match(seat.stdout, /exec -m gpt-6-astra -c model_reasoning_effort=high --disable hooks --sandbox read-only /);
});

test('cross runs a Codex build worker that writes, logs its events, and resumes its session', () => {
  const { dir, home } = sandbox();
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const codex = [
    '#!/bin/sh',
    'echo "$*" >> "$ARGS_LOG"',
    'while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2 ;; *) shift ;; esac; done',
    'echo \'{"type":"thread.started","thread_id":"t-1"}\'',
    'echo \'{"type":"item.completed","item":{"type":"file_change"}}\'',
    'echo "built" > "$out"',
  ].join('\n');
  writeFileSync(join(bin, 'codex'), `${codex}\n`, { mode: 0o755 });
  const argsLog = join(dir, 'args.log');
  const events = join(dir, 'events.jsonl');
  const run = (args) =>
    spawnSync(process.execPath, [join(HELPERS, 'cross.mjs'), '--to', 'codex', '--model', 'gpt-6.1-sol', '--effort', 'high', ...args], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, CLAUDECODE: '1', ARGS_LOG: argsLog },
    });
  const first = run(['--write', '--events', events, 'build the slice']);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stdout.trim(), 'session t-1\nbuilt');
  const resumed = run(['--write', '--events', events, '--resume', 't-1', 'fix the test name']);
  assert.equal(resumed.status, 0, resumed.stderr);
  const [writeArgs, resumeArgs] = readFileSync(argsLog, 'utf8').trim().split('\n');
  assert.match(writeArgs, /^exec -m gpt-6\.1-sol -c model_reasoning_effort=high --disable hooks -c sandbox_mode="workspace-write" --json -o \S+ -- build the slice$/);
  assert.match(resumeArgs, /^exec resume t-1 -m gpt-6\.1-sol .*-c sandbox_mode="workspace-write" --json -o \S+ -- fix the test name$/);
  assert.equal(readFileSync(events, 'utf8').match(/thread\.started/g)?.length, 2, 'both runs append their events');
  const refused = run(['--to', 'claude', '--write', '--events', events, 'build it']);
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /--write runs only --to codex/);
});

test('a stopped cross run stops the runtime it launched', async () => {
  const { dir, home } = sandbox();
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const pidFile = join(dir, 'codex.pid');
  writeFileSync(join(bin, 'codex'), `#!/bin/sh\necho $$ > ${pidFile}\nsleep 30\n`, { mode: 0o755 });
  const cross = spawn(process.execPath, [join(HELPERS, 'cross.mjs'), '--to', 'codex', 'review it'], {
    cwd: dir,
    env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, CLAUDECODE: '' },
  });
  const deadline = Date.now() + 10000;
  while (!existsSync(pidFile) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
  const pid = Number(readFileSync(pidFile, 'utf8'));
  cross.kill('SIGTERM');
  await new Promise((resolve) => cross.on('exit', resolve));
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.throws(() => process.kill(pid, 0), /ESRCH/, 'the launched runtime outlived its stopped parent');
});

test('cross passes a prompt that starts with dashes as the prompt, and gives up on a runtime that ignores its timeout', () => {
  const { dir, home } = sandbox();
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\nfor arg; do last="$arg"; done\necho "prompt=[$last] terminated=$([ \"$(eval echo \\${$(($#-1))})\" = \"--\" ] && echo yes || echo no)"\n', { mode: 0o755 });
  writeFileSync(join(bin, 'codex'), "#!/bin/sh\ntrap '' TERM\nsleep 30\n", { mode: 0o755 });
  const cross = (args) =>
    spawnSync(process.execPath, [join(HELPERS, 'cross.mjs'), ...args], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, CLAUDECODE: '' },
    });
  assert.equal(cross(['--to', 'claude', '--help me review']).stdout.trim(), 'prompt=[--help me review] terminated=yes');
  const started = Date.now();
  const hung = cross(['--to', 'codex', '--timeout', '1', 'review it']);
  assert.equal(hung.status, 1);
  assert.ok(Date.now() - started < 15000, `took ${Date.now() - started} ms`);
});

test('smoke fails when a runtime exits cleanly with no answer', () => {
  const { dir, home } = sandbox();
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\necho "a plan"\n', { mode: 0o755 });
  writeFileSync(join(bin, 'codex'), '#!/bin/sh\necho "progress, not an answer"\nexit 0\n', { mode: 0o755 });
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
  assert.deepEqual(hintModes("argument-hint: '[status | promote] [dry-run] <scope>'"), ['status', 'promote']);
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

test('discover counts a command the user typed, not text pasted after it or written by an agent', () => {
  const { dir, home, cli } = sandbox();
  const root = project(dir, 'app', {
    files: { '.agents/rules/sync-vision.mdc': '---\n---\n', '.agents/rules/ui-audit.mdc': '---\n---\n', '.agents/skills/typescript-advanced-types/SKILL.md': '---\nname: typescript-advanced-types\n---\n' },
  });
  const claude = join(home, '.claude/projects', root.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(claude, { recursive: true });
  const now = new Date().toISOString();
  const filler = 'The plan names its subject and its proof. '.repeat(200);
  const user = (content, extra = {}) => ({ type: 'user', timestamp: now, message: { role: 'user', content }, ...extra });
  writeFileSync(
    join(claude, 'session.jsonl'),
    [
      user(`Reviewer report follows.\n${filler}\nNext: [$sync-vision](/x/SKILL.md) sync`),
      user('also following [$typescript-advanced-types](/x/SKILL.md) here'),
      user(`/ui-audit documents ${filler}`),
      user('Run /ui-audit next.', { promptSource: 'system' }),
      user('Run /ui-audit next.', { origin: { kind: 'task-notification' } }),
      user('Run /ui-audit next.', { entrypoint: 'sdk-cli' }),
      user('please run /ui-audit on documents', { entrypoint: 'claude-desktop', promptSource: 'sdk', origin: { kind: 'human' } }),
      user(`<pasted_content id="7">\n${filler} $sync-vision\n</pasted_content id="7">\n/ui-audit go`),
      user('/typescript-advanced-types\n<pasted_content id="8">\n## My request for Codex:\n$sync-vision\n</pasted_content id="8">'),
    ]
      .map((line) => JSON.stringify(line))
      .join('\n'),
  );
  const codex = join(home, '.codex/sessions/2026/10/03');
  mkdirSync(codex, { recursive: true });
  const session = (name, meta, message) =>
    writeFileSync(
      join(codex, name),
      [{ type: 'session_meta', payload: { cwd: root, ...meta } }, { timestamp: now, type: 'event_msg', payload: { type: 'user_message', turn_id: name, message } }]
        .map((line) => JSON.stringify(line))
        .join('\n'),
    );
  session('rollout-exec.jsonl', { originator: 'Codex Desktop', source: 'exec' }, 'run $ui-audit read-only');
  session('rollout-automation.jsonl', { thread_source: 'automation' }, 'run $ui-audit');
  session('rollout-tui.jsonl', {}, `# Context from the in-app browser\n${filler}\n## My request for Codex:\n[$sync-vision](/x/SKILL.md) audit`);
  const result = cli('discover', root);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).typed.counts, {
    'sync-vision': { all: 1, week: 1 },
    'typescript-advanced-types': { all: 2, week: 2 },
    'ui-audit': { all: 3, week: 3 },
  });
});

test('audit counts a user-scope skill typed in any project, and not a link to a project copy of the same name', () => {
  const { dir, home: link } = sandbox();
  const home = realpathSync(link);
  const root = project(dir, 'app', { agents: '# App\n' });
  for (const [skills, name] of [['.agents/skills', 'security-triage'], ['.agents/skills', 'orchestrator'], ['.codex/skills', 'game-guides']]) {
    mkdirSync(join(home, skills, name), { recursive: true });
    writeFileSync(join(home, skills, name, 'SKILL.md'), `---\nname: ${name}\ndescription: x\n---\n`);
  }
  const elsewhere = join(home, '.claude/projects', join(dir, 'other').replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(elsewhere, { recursive: true });
  const now = new Date().toISOString();
  writeFileSync(
    join(elsewhere, 'session.jsonl'),
    [
      `run [$security-triage](${home}/.agents/skills/security-triage/SKILL.md)`,
      `use [$orchestrator](${dir}/other/.agents/skills/orchestrator/SKILL.md)`,
      `use [$orchestrator](<${dir}/a b/.agents/skills/orchestrator/SKILL.md>)`,
      `use [$orchestrator](${home}/.agents/../other/.agents/skills/orchestrator/SKILL.md)`,
      `use [$orchestrator](${home}/.codex/worktrees/demo/app/.agents/skills/orchestrator/SKILL.md)`,
      'use [$orchestrator](.agents/skills/orchestrator/SKILL.md)',
      `again [$security-triage](<${home}/.agents/skills/security-triage/my notes/../SKILL.md>)`,
      'play $game-guides',
    ]
      .map((text) => JSON.stringify({ type: 'user', timestamp: now, message: { role: 'user', content: text } }))
      .join('\n'),
  );
  const result = spawnSync(process.execPath, [AUDIT, root, '--json'], { cwd: home, encoding: 'utf8', env: { ...process.env, HOME: home } });
  assert.equal(result.status, 0, result.stderr);
  const user = Object.fromEntries(JSON.parse(result.stdout).userSkills.map((skill) => [skill.name, skill.typed.all]));
  assert.deepEqual(user, { 'game-guides': 1, orchestrator: 0, 'security-triage': 2 });
});

test('audit run from an installed copy reports dotai facts as unknown instead of comparing the copy with itself', () => {
  const { dir, home, run } = sandbox();
  const root = project(dir, 'app', { agents: '# App\n' });
  const installed = join(home, '.agents/skills/sync-pstack');
  cpSync(dirname(HERE), installed, { recursive: true });
  const result = run(process.execPath, [join(installed, 'scripts/audit.mjs'), root, '--json'], root);
  assert.equal(result.status, 0, result.stderr);
  const skill = JSON.parse(result.stdout).userSkills.find((entry) => entry.name === 'sync-pstack');
  assert.deepEqual([skill.inDotai, skill.stale], [null, null]);
});

test('the audit report shows block and pstack repeats ahead of a flood of project duplicates', () => {
  const { dir, home, run } = sandbox();
  const block = 'Every test must fail for a named, plausible defect and pass only once it is fixed.';
  const pstack = 'Verify against the real artifact, never a proxy that only compiles or type checks.';
  const pstackSkill = join(home, '.claude/plugins/cache/pstack-claude/pstack/9.9.9/skills/prove');
  mkdirSync(pstackSkill, { recursive: true });
  writeFileSync(join(pstackSkill, 'SKILL.md'), `# Prove\n\n${pstack}\n`);
  const sentence = (n, what) => `Rule ${n} keeps ${what} ${n} database free across every suite and runner today.`;
  const duplicates = Array.from({ length: 40 }, (_, n) => `${sentence(n, 'fixture')} ${sentence(n, 'mock')}`).join('\n\n');
  const root = project(dir, 'app', {
    agents: '# App\n',
    files: {
      '.agents/pstack.json': '{ "tag": "v9.9.9" }\n',
      '.agents/rules/a.mdc': `# A\n\n${duplicates}\n`,
      '.agents/rules/b.mdc': `# B\n\n${duplicates}\n\n${block}\n\n${pstack}\n`,
    },
  });
  const result = run(process.execPath, [AUDIT, root], root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\.agents\/rules\/b\.mdc:\d+ ~ block:\d+: Every test must fail/);
  assert.match(result.stdout, /\.agents\/rules\/b\.mdc:\d+ ~ pstack\/prove\/SKILL\.md:\d+: Verify against the real artifact/);
  assert.match(result.stdout, /repeated elsewhere in the project \(score >= 0\.5\): 80,/);
});

test('audit routes count whole skill names, not longer names, paths or plain common words', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', {
    agents: '# App\n\nVendor skills (sentry, rate-limiter-flexible) are references. Use `$cross-review` for a hand-off.\n',
    files: {
      '.agents/rules/best-api.mdc': '---\ndescription: api\n---\n# Best API\n',
      '.agents/rules/best-api-review.mdc': '---\ndescription: review\n---\nRun $best-api-review audit, then /task:checkout and import x from "/best-api.ts".\n',
      '.agents/rules/task.mdc': '---\ndescription: task\n---\n# Task\n',
      '.agents/rules/react.mdc': '---\ndescription: react\n---\nThe react docs and @trpc/react-query.\n',
      ...Object.fromEntries(['best-api', 'best-api-review', 'task', 'react', 'cross-review', 'rate-limiter-flexible'].map((name) => [`.agents/skills/${name}/SKILL.md`, `---\nname: ${name}\n---\n`])),
    },
  });
  const result = run(process.execPath, [AUDIT, root, '--json'], root);
  assert.equal(result.status, 0, result.stderr);
  const routes = Object.fromEntries(JSON.parse(result.stdout).skills.map((skill) => [skill.name, skill.routes]));
  assert.deepEqual(routes, { 'best-api': [], 'best-api-review': [], 'cross-review': ['AGENTS.md'], 'rate-limiter-flexible': ['AGENTS.md'], react: [], task: [] });
});

test('audit lists a project rule sentence that repeats the block, even wrapped across lines', () => {
  const { dir, run } = sandbox();
  const copied = 'Every test must fail for a named, plausible defect and pass only once it is fixed.';
  const wrapped = copied.replace('defect and', 'defect\nand');
  const root = project(dir, 'app', { agents: '# App\n', files: { '.agents/rules/qa.mdc': `---\ndescription: qa\n---\n# QA\n\n${wrapped} Keep the suite fast.\n` } });
  const result = run(process.execPath, [AUDIT, root, '--json'], root);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(JSON.parse(result.stdout).overlaps.some((overlap) => overlap.file === '.agents/rules/qa.mdc' && overlap.with === 'block'), result.stdout);
});

test('every block rule says how it relates to pstack, and a rule whose marker is removed is flagged', () => {
  assert.deepEqual(unmarkedRules(TEMPLATE), []);
  const stripped = TEMPLATE.replace(/^<!-- # adds -->\n(?=- \*\*Blocked\.\*\*)/mu, '');
  assert.notEqual(stripped, TEMPLATE);
  assert.deepEqual(unmarkedRules(stripped), ['Blocked']);
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

test("verify fails when AGENTS.md is longer than Codex loads, and passes once the Codex config raises the limit", () => {
  const { dir, home, cli } = sandbox();
  const root = setupFixture(dir, home);
  writeFileSync(join(root, 'AGENTS.md'), `${readFileSync(join(root, 'AGENTS.md'), 'utf8')}\n## Project rules\n\n${'- A project rule Codex must read.\n'.repeat(1200)}`);
  mkdirSync(join(home, '.codex'), { recursive: true });
  const noConfig = cli('verify', root);
  assert.equal(noConfig.status, 1);
  assert.match(noConfig.stdout + noConfig.stderr, /Codex loads only the first 32768; set project_doc_max_bytes = 131072 at the top of .*config\.toml/);
  writeFileSync(join(home, '.codex/config.toml'), 'model = "gpt-6.1-sol"\n\n[profiles.deep]\nproject_doc_max_bytes = 262144\n');
  const short = cli('verify', root);
  assert.equal(short.status, 1);
  assert.match(short.stdout + short.stderr, /AGENTS\.md is \d+ bytes, but Codex loads only the first 32768; set project_doc_max_bytes = 131072 at the top of .*config\.toml/);
  writeFileSync(join(home, '.codex/config.toml'), 'model = "gpt-6.1-sol"\nproject_doc_max_bytes = 131072\n');
  const raised = cli('verify', root);
  assert.equal(raised.status, 0, raised.stdout + raised.stderr);
});

test('plan-open reports an open box outside code and ignores one inside a fence', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', { files: { 'plan.md': '# Plan\n\n- [x] done: `bun test ./a.test.ts`\n- [ ] ship it\n\n```md\n- [ ] example\n```\n' } });
  const result = run(process.execPath, [join(HELPERS, 'plan-open.mjs'), 'plan.md'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^1 open item\(s\):\nplan\.md:4: - \[ \] ship it$/m);
});

test('plan-open reads a checkbox nested in a numbered step', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', { files: { 'plan.md': '# Plan\n\n1. - [x] **Build.** Proof: `bun test ./a.test.ts`.\n2. - [ ] **Ship.**\n' } });
  const result = run(process.execPath, [join(HELPERS, 'plan-open.mjs'), 'plan.md'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^1 open item\(s\):\nplan\.md:4: 2\. - \[ \] \*\*Ship\.\*\*$/m);
});

const BRIEF_ANSWERS = [
  ['What will change?', 'It opens with a brief.'],
  ['What could go wrong?', 'Old plans need a brief.'],
];
const FIVE_ROW_BRIEF = [
  ['What did you find?', 'The page hides its answer.'],
  BRIEF_ANSWERS[0],
  ['What do you need from me?', 'Pick build or hold.'],
  ['What happens if I say go?', 'The renderer changes.'],
  BRIEF_ANSWERS[1],
];
const brief = (answers = BRIEF_ANSWERS) => `## Brief\n\n${answers.map(([question, answer]) => `### ${question}\n\n${answer}\n`).join('\n')}\n`;

const MEMO = '### Build\n\nBuild the memo now?\n\nWhy it needs you: The renderer is shared by every project.\n\n- Another session changed it this morning.\n\n- **Build now** (recommended): I build it today. Cost: A design mistake shows up after the build.\n- **Hold**: Nothing changes. Cost: Needs you stays hard to read.\n\nWhy I pick it: The prototype settled the design.\n\nAttention: look\n\nIf you say go: I build the memo renderer.\n';
const playbook = (fields) => `---\nextends: multi-phase-plan\nwhen: Use it for a plan.\n${fields}---\n\n# Plan\n`;

test("plan-page renders a playbook's page-lead sections right after Public API", () => {
  const { dir, run } = sandbox();
  const plan = '# Plan\n\nStatus: planning\n\n## Main changes\n\n- Moves the owner.\n\n## What other editors do\n\n- Lexical keeps it in the node.\n\n## Public API\n\n```ts before\nold()\n```\n\n```ts after\nnext()\n```\n' + brief();
  const root = project(dir, 'app', { files: { '.agents/playbooks/plan.md': playbook('page-lead: What other editors do\n'), 'docs/plans/plan.md': plan } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const html = read(root, 'docs/plans/artifacts/plan.html');
  const at = (title) => html.indexOf(`<h2>${title}</h2>`);
  assert.ok(at('Public API') < at('What other editors do') && at('What other editors do') < at('Main changes'));
});

test('plan-page refuses a before fence that prose separates from its after fence', () => {
  const { dir, run } = sandbox();
  const plan = '# Plan\n\nStatus: done\n\n## Public API\n\n```ts before\nold()\n```\n\nIt now takes a type.\n\n```ts after\nnext()\n```\n';
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Public API needs each before fence followed directly by its after fence/);
});

test('plan-page checks pairs in a project section only when a playbook pairs it', () => {
  const { dir, run } = sandbox();
  const plan = '# Plan\n\nStatus: done\n\n## Document shape\n\n- A signed document keeps its template id.\n';
  const plain = project(dir, 'plain', { files: { 'docs/plans/plan.md': plan } });
  assert.equal(run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], plain).status, 0);
  const paired = project(dir, 'paired', { files: { '.agents/playbooks/plan.md': playbook('page-pairs: Document shape\n'), 'docs/plans/plan.md': plan } });
  assert.equal(run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], paired).status, 1);
});

test('plan-page refuses a pstack.json that still sets the page lists', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', { config: { pageLead: ['What other editors do'] }, files: { 'docs/plans/plan.md': '# Plan\n\nStatus: planning\n' + brief() } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /still sets pageLead; move each list into the frontmatter of the playbook/);
});

test('plan-page shows the Demo steps in order right after the brief, inlines each screenshot and names a missing one', () => {
  const { dir, run } = sandbox();
  const demo = '## Demo\n\n1. Open **Settings → Migration**. The view says Not pulled yet.\n   ![before](shots/before.png) ![after](shots/after.png)\n2. Click Start onboarding. Its two steps appear.\n   ![after](shots/gone.png)\n';
  const plan = `# Plan\n\nStatus: building\n\n${brief()}\n${demo}\n## Open questions\n\n## Steps\n\n- [ ] Ship.\n`;
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan } });
  mkdirSync(join(root, 'docs/plans/shots'), { recursive: true });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==', 'base64');
  writeFileSync(join(root, 'docs/plans/shots/before.png'), png);
  writeFileSync(join(root, 'docs/plans/shots/after.png'), png);
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const html = read(root, 'docs/plans/artifacts/plan.html');
  const demoAt = html.indexOf('class="demo');
  assert.ok(demoAt > html.indexOf('class="brief'), 'Demo follows the brief');
  assert.ok(demoAt < html.indexOf('class="source"'), 'Demo sits on the page, not in the plan files note');
  assert.ok(html.indexOf('The view says Not pulled yet') < html.indexOf('Its two steps appear'), 'steps keep their order');
  assert.equal([...html.matchAll(/<img src="data:image\/png;base64,/g)].length, 2);
  assert.match(html, /<figcaption>Before<\/figcaption>/);
  assert.match(html, /shots\/gone\.png/);
  assert.equal([...html.matchAll(/<dialog class="lightbox"/g)].length, 1, 'a frame opens full size in one shared viewer');
});

test('plan-page adds the full-size viewer only to a page that shows frames', () => {
  const { dir, run } = sandbox();
  const plan = `# Plan\n\nStatus: building\n\n${brief()}\n## Demo\n\n1. Open the page. It loads.\n`;
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(read(root, 'docs/plans/artifacts/plan.html'), /class="lightbox"/);
});

test('plan-page refuses a Demo with no numbered step', () => {
  const { dir, run } = sandbox();
  const plan = `# Plan\n\nStatus: building\n\n${brief()}\n## Demo\n\nOpen the page and look around.\n`;
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /## Demo in docs\/plans\/plan\.md needs numbered steps/);
});

test('plan-page diffs a before and after pair line by line', () => {
  const { dir, run } = sandbox();
  const plan = '# Plan\n\nStatus: done\n\n## Public API\n\n```ts before\nsetup()\nold()\n```\n\n```ts after\nsetup()\nnext()\n```\n';
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const html = read(root, 'docs/plans/artifacts/plan.html');
  const rows = (kind) => [...html.matchAll(new RegExp(`class="row ${kind}"><span class="num">\\d+</span><span class="sign">[^<]*</span><code class="language-ts">([^<]*)</code>`, 'gu'))].map((match) => match[1]);
  assert.deepEqual([rows('same'), rows('del'), rows('add')], [['setup()', 'setup()'], ['old()'], ['next()']]);
});

test('plan-page renders a short-dash table and a stray pipe line instead of hanging', () => {
  const { dir } = sandbox();
  const plan = '# Plan\n\nStatus: done\n\n## Notes\n\n| # | Pass |\n| -: | --- |\n| 1 | ground |\n\n| a pipe that starts no table\n';
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan } });
  const result = spawnSync(process.execPath, ['--max-old-space-size=64', join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], { cwd: root, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  const html = read(root, 'docs/plans/artifacts/plan.html');
  assert.match(html, /<td>ground<\/td>/);
  assert.match(html, /a pipe that starts no table/);
});

test('plan-page renders a topic plan as its subject page, led by its newest open iteration, and names both files', () => {
  const { dir, run } = sandbox();
  const topic = '# Workflow\n\nPage: https://example.test/page\n\n## Main changes\n\n- Pages follow subjects.\n';
  const first = '# First pass\n\nStatus: done\nTopic: workflow\n\n## Main changes\n\n- Moved the renderer.\n';
  const second = '# Second pass\n\nStatus: planning\nTopic: workflow\n\n## Open questions\n\n- Keep the old pages?\n' + brief();
  const other = '# Unrelated\n\nStatus: done\n';
  const root = project(dir, 'app', { files: { 'docs/plans/topics/workflow.md': topic, 'docs/plans/2026-01-01-first.md': first.replace('Status: done', 'Status: awaiting review'), 'docs/plans/2026-02-01-second.md': second, 'docs/plans/2026-01-15-other.md': other } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-02-01-second.md'], root);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.trim().endsWith('docs/plans/artifacts/topics/workflow.html'), result.stdout);
  const html = read(root, 'docs/plans/artifacts/topics/workflow.html');
  const text = html.replace(/<[^>]+>/gu, '');
  assert.ok(text.includes('Plan Second pass') && text.includes('Keep the old pages?'), 'the newest open iteration leads with its question');
  assert.match(text, /review rounds are in docs\/plans\/2026-02-01-second\.md and docs\/plans\/topics\/workflow\.md/);
  assert.ok(!html.includes('Unrelated'));
});

test('plan-page --index renders every subject page locally and lists it with its state and iteration count, subjects that wait on the owner first, a refused page with its reason, and hub topics with no page yet', () => {
  const { dir, run } = sandbox();
  const files = {
    'docs/plans/topics/README.md': '# Topics\n\nPage: https://example.test/index\n',
    'docs/plans/topics/quiet.md': '# Quiet topic\n\nPage: https://example.test/quiet\n\nThe quiet lead.\n\n## Main changes\n\n- Settled.\n',
    'docs/plans/topics/busy.md': '# Busy topic\n\nPage: https://example.test/busy\n\nThe busy lead.\n\n## Main changes\n\n- Moving.\n',
    'docs/plans/2026-03-01-quiet-pass.md': '# Quiet pass\n\nStatus: executed\nTopic: quiet\n\n## Main changes\n\n- Done.\n',
    'docs/plans/2026-01-01-busy-one.md': '# Busy one\n\nStatus: executed\nTopic: busy\n\n## Main changes\n\n- One.\n',
    'docs/plans/2026-01-02-busy-two.md': '# Busy two\n\nStatus: planning, waiting for Build now\nTopic: busy\n\n## Open questions\n\n' + MEMO + brief(),
    'docs/plans/topics/broken.md': '# Broken topic\n\nThe broken lead.\n\n## Main changes\n\n- Stuck.\n',
    'docs/plans/2026-01-03-broken-pass.md': '# Broken pass\n\nStatus: someday maybe\nTopic: broken\n\n## Main changes\n\n- Stuck.\n',
    'docs/research/features/busy.md': '# Busy feature\n',
    'docs/research/features/quiet.md': '# Quiet feature\n',
    'docs/research/features/fresh.md': '# Fresh feature\n',
  };
  const root = project(dir, 'app', { files, config: { plans: 'docs/plans', pageTopic: { hub: 'docs/research/features/{topic}.md' } } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), '--index'], root);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.trim().endsWith('docs/plans/artifacts/topics/index.html'), result.stdout);
  const html = read(root, 'docs/plans/artifacts/topics/index.html');
  assert.ok(html.includes('href="busy.html"') && existsSync(join(root, 'docs/plans/artifacts/topics/busy.html')), 'a subject links its locally rendered page');
  assert.match(html.replace(/<[^>]+>/gu, ''), /planning waiting for Build now/, 'a subject shows its leading status');
  assert.match(html, /Broken topic[\s\S]*?refused[\s\S]*?state word/, 'a page the renderer refuses shows the refusal instead of a link');
  assert.match(html, /Busy topic[\s\S]*?2 iterations/, 'a subject counts its iterations');
  assert.ok(html.indexOf('Busy topic') < html.indexOf('Quiet topic'), 'a subject that waits on the owner comes before a newer settled one');
  assert.match(html, /Fresh feature[\s\S]*?no page yet/, 'a hub with no subject file is a topic with no page yet');
  assert.ok(!html.includes('>Topics<'), 'the index file is not a subject');
});

test('plan-page keeps an older iteration\'s open question in Needs you under a newer open plan', () => {
  const { dir, run } = sandbox();
  const topic = '# Workflow\n\n## Main changes\n\n- Pages follow subjects.\n';
  const built = '# Built\n\nStatus: executed\nTopic: workflow\n\n## Main changes\n\n- Moved the renderer.\n\n## Open questions\n\n### Lessons\n\nApply the reflect lessons?\n\n- **apply** (recommended): apply them.\n- **skip**: drop them.\n\n## Close\n\n- Landed.\n';
  const next = '# Next\n\nStatus: planning, waiting for Build now\nTopic: workflow\n\n## Main changes\n\n- Index every subject.\n' + brief();
  const root = project(dir, 'app', { files: { 'docs/plans/topics/workflow.md': topic, 'docs/plans/2026-01-01-built.md': built, 'docs/plans/2026-02-01-next.md': next } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-02-01-next.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const html = read(root, 'docs/plans/artifacts/topics/workflow.html');
  assert.match(html, /It opens with a brief\.[\s\S]*Apply the reflect lessons\?/, 'the older question stays under the newer plan');
  assert.match(html, /Apply the reflect lessons\?[\s\S]*?from[\s\S]*?Built/, 'the question names the plan it belongs to');
});

const reviewRow = (phase, decision, result) => `2026-01-01T00:00:00Z\t${phase}\t${decision}\twhy\tevidence\t${result}`;

test('plan-page tags the latest panel round and lists every round at the bottom by priority', () => {
  const { dir, run } = sandbox();
  const plan = '# Plan\n\nStatus: executed\n\n## Main changes\n\n- Seat Codex.\n';
  const log = [
    'ts\tphase\tdecision\twhy\tevidence\tresult',
    reviewRow('plan', 'Pick seats', 'decided'),
    reviewRow('panel', 'seats opus, codex:gpt-6-astra @high', 'recorded'),
    reviewRow('panel', 'nit Rename the flag', 'dismissed: churn'),
    reviewRow('panel', 'critical The seat writes files', 'applied: read-only brief'),
    reviewRow('review-response', 'Accepted the hand-off edits', 'kept'),
    reviewRow('panel', 'seats opus, codex:gpt-6.1-sol @xhigh missing', 'recorded'),
    reviewRow('panel', 'warning Fallback hides a missing seat', 'applied: reported missing'),
  ].join('\n');
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan, 'docs/plans/plan.decisions.tsv': `${log}\n` } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const html = read(root, 'docs/plans/artifacts/plan.html');
  const header = html.slice(html.indexOf('<header>'), html.indexOf('</header>')).replace(/<[^>]+>/gu, '');
  assert.match(header, /Review round 2/);
  assert.match(header, /gpt-6\.1-sol xhigh missing/, 'a missing seat says so');
  const history = html.slice(html.lastIndexOf('Review history')).replace(/<[^>]+>/gu, '');
  const order = ['Round 1', 'critical The seat writes files', 'nit Rename the flag', 'Accepted the hand-off edits', 'Round 2', 'warning Fallback hides a missing seat'].map((text) => history.indexOf(text));
  assert.ok(order.every((index, at) => index > (order[at - 1] ?? -1)), JSON.stringify(order));
  assert.ok(!html.includes('Pick seats'));
});

test("plan-page draws the flow rail from the log's stage phases and the Status, never from words inside a row", () => {
  const { dir, run } = sandbox();
  const plan = '# Plan\n\nStatus: waiting for the owner\nPlaybook: audit\n\n## Main changes\n\n- Draw the rail.\n' + brief();
  const log = [
    'ts\tphase\tdecision\twhy\tevidence\tresult',
    reviewRow('plan', 'Run architect now and reflect after ship', 'decided'),
    reviewRow('architect', 'Seat three runners', 'decided'),
    reviewRow('panel', 'seats opus, codex:gpt-6-astra @high', 'recorded'),
    reviewRow('build', 'Port the rail', 'fixed'),
    reviewRow('writing', 'Run deslop and no-comments', 'fixed'),
    reviewRow('panel', 'seats opus', 'recorded'),
    reviewRow('panel', 'seats opus', 'recorded'),
    reviewRow('verify', 'Prove the rail', 'verified'),
    reviewRow('review', 'Accept the hand-off', 'kept'),
  ].join('\n');
  const files = { '.agents/playbooks/audit.md': '---\nextends: autonomous-run\nwhen: Use it to audit.\n---\n', 'docs/plans/plan.md': plan, 'docs/plans/plan.decisions.tsv': `${log}\n` };
  const root = project(dir, 'app', { files });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const html = read(root, 'docs/plans/artifacts/plan.html');
  const rail = [...html.matchAll(/<li class="fs (\w+)"[^>]*>(.*?)<\/li>/gu)].map(([, state, body]) => `${state}:${body.replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ').trim()}`);
  assert.deepEqual(rail, [
    'done:Plan audit autonomous-run',
    'done:Design architect',
    'done:Plan review interrogate',
    'done:Build',
    'done:Writing deslop no-comments',
    'done:Code review ×2 interrogate',
    'done:Verify',
    'done:Audit show-me-your-work',
    'waiting:Ship',
    'left:Reflect',
  ]);
});

test('plan-page --rail prints the rail the page draws', () => {
  const { dir, run } = sandbox();
  const plan = '# Plan\n\nStatus: building\nPage: https://claude.ai/artifact/x\nPlaybook: audit\n\n## Main changes\n\n- Draw the rail.\n\n## Steps\n\n1. - [x] One.\n2. - [ ] Two.\n' + brief();
  const log = ['ts\tphase\tdecision\twhy\tevidence\tresult', reviewRow('architect', 'Seat runners', 'decided'), reviewRow('panel', 'seats opus', 'recorded'), reviewRow('build', 'Port', 'fixed')].join('\n');
  const files = { '.agents/playbooks/audit.md': '---\nextends: autonomous-run\nwhen: Use it to audit.\n---\n', 'docs/plans/plan.md': plan, 'docs/plans/plan.decisions.tsv': `${log}\n` };
  const root = project(dir, 'app', { files });
  assert.equal(run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root).status, 0);
  const html = read(root, 'docs/plans/artifacts/plan.html');
  const drawn = [...html.matchAll(/<li class="fs (\w+)"[^>]*>(.*?)<\/li>/gu)].map(([, state, body]) => `${state}:${body.replace(/<span class="fs-meta">.*?<\/span>|<span class="tool">.*?<\/span>/gu, '').replace(/<[^>]+>/gu, '').trim()}`);
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md', '--rail'], root);
  assert.equal(result.status, 0, result.stderr);
  const rail = JSON.parse(result.stdout);
  assert.deepEqual(rail.stages.map(({ state, label }) => `${state}:${label}`), drawn);
  assert.deepEqual([rail.valid, rail.page, rail.steps], [true, 'https://claude.ai/artifact/x', { checked: 1, total: 2 }]);
});

test('plan-page --rail still prints the rail of a plan the page refuses, with the reason', () => {
  const { dir, run } = sandbox();
  const plan = '# Plan\n\nStatus: building\n\n## Main changes\n\n- Draft.\n\n## Defaults\n\nNo table yet.\n' + brief();
  const log = ['ts\tphase\tdecision\twhy\tevidence\tresult', reviewRow('build', 'Port', 'fixed')].join('\n');
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan, 'docs/plans/plan.decisions.tsv': `${log}\n` } });
  assert.equal(run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md', '--check'], root).status, 1);
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md', '--rail'], root);
  assert.equal(result.status, 0, result.stderr);
  const rail = JSON.parse(result.stdout);
  assert.equal(rail.valid, false);
  assert.match(rail.reason, /## Defaults/);
  assert.equal(rail.stages.find(({ label }) => label === 'Build').state, 'done');
});

test('plan-page --rail names the plan its subject page leads with', () => {
  const { dir, run } = sandbox();
  const older = '# First pass\n\nStatus: executed\nTopic: workflow\n\n## Main changes\n\n- Seats.\n';
  const newer = '# Second pass\n\nStatus: building\nTopic: workflow\n\n## Main changes\n\n- More seats.\n' + brief();
  const root = project(dir, 'app', {
    files: {
      'docs/plans/topics/workflow.md': '# Workflow\nPage: https://claude.ai/artifact/topic\n\n## Main changes\n\n- Seats.\n',
      'docs/plans/2026-01-01-first.md': older,
      'docs/plans/2026-02-01-second.md': newer,
    },
  });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-first.md', '--rail'], root);
  assert.equal(result.status, 0, result.stderr);
  const rail = JSON.parse(result.stdout);
  assert.deepEqual([rail.requestedPlan, rail.leadingPlan, rail.page], ['docs/plans/2026-01-01-first.md', 'docs/plans/2026-02-01-second.md', 'https://claude.ai/artifact/topic']);
});

test('plan-page keeps a subject\'s latest review in its header and history after newer unreviewed iterations', () => {
  const { dir, run } = sandbox();
  const plan = '# Seat Codex\n\nStatus: executed\nTopic: workflow\n\n## Main changes\n\n- Seats.\n';
  const log = ['ts\tphase\tdecision\twhy\tevidence\tresult', reviewRow('panel', 'seats opus', 'recorded'), reviewRow('panel', 'critical History vanishes', 'applied: kept')].join('\n');
  const root = project(dir, 'app', {
    files: {
      'docs/plans/topics/workflow.md': '# Workflow\n\n## Main changes\n\n- Seats.\n',
      'docs/plans/2026-01-01-seats.md': plan,
      'docs/plans/2026-01-01-seats.decisions.tsv': `${log}\n`,
      'docs/plans/2026-02-01-later.md': '# Later pass\n\nStatus: executed\nTopic: workflow\n\n## Main changes\n\n- Seats.\n',
      'docs/plans/2026-02-01-later.decisions.tsv': `ts\tphase\tdecision\twhy\tevidence\tresult\n${reviewRow('review', 'Hand-off edit', 'applied: kept')}\n`,
    },
  });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-seats.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const page = read(root, 'docs/plans/artifacts/topics/workflow.html');
  assert.match(page.slice(page.indexOf('<header>'), page.indexOf('</header>')).replace(/<[^>]+>/gu, ''), /Review round 1.*Seat Codex/su);
  const html = page.replace(/<[^>]+>/gu, '');
  assert.match(html, /critical History vanishes/);
});

test('plan-page keeps a scoped plan on its own page until its subject file exists', () => {
  const { dir, run } = sandbox();
  const plan = '---\nreview_scopes: [uploads]\n---\n# Upload drafts\n\nStatus: building\n\n' + brief();
  const root = project(dir, 'app', { config: { pageTopic: { field: 'review_scopes' } }, files: { 'docs/plans/2026-01-01-drafts.md': plan } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-drafts.md'], root);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.trim().endsWith('docs/plans/artifacts/2026-01-01-drafts.html'), result.stdout);
  assert.match(result.stderr, /create docs\/plans\/topics\/uploads\.md/);
});

test('plan-page takes the subject from the first entry of the configured frontmatter list', () => {
  const { dir, run } = sandbox();
  const plan = '---\nreview_scopes:\n  - dnd\n  - clipboard\n---\n# Transfer\n\nStatus: done\n';
  const root = project(dir, 'app', { config: { pageTopic: { field: 'review_scopes' } }, files: { 'docs/plans/topics/dnd.md': '# Drag and drop\n', 'docs/plans/2026-01-01-transfer.md': plan } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-transfer.md'], root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(read(root, 'docs/plans/artifacts/topics/dnd.html'), /Transfer/);
});

test('plan-page ignores a frontmatter topic field and keeps a legacy plan on its own page', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', { files: { 'docs/plans/2026-01-01-old.md': '---\ntopic: old-proof-plan\nstatus: blocked\n---\n# Old proof\n\n' + brief() } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-old.md'], root);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.trim().endsWith('docs/plans/artifacts/2026-01-01-old.html'), result.stdout);
});

test("plan-page refuses a ledger-scope subject page that lacks a section its plan's playbook requires", () => {
  const { dir, run } = sandbox();
  const config = { pageTopic: { field: 'review_scopes', hub: 'docs/hubs/{topic}.md' } };
  const plan = '---\nreview_scopes: [dnd]\n---\n# Transfer\n\nStatus: done\nPlaybook: plan\n';
  const files = {
    '.agents/playbooks/bug-fix.md': playbook(''),
    '.agents/playbooks/plan.md': playbook('page-require: What other editors do\n'),
    'docs/hubs/dnd.md': '# Drag and drop\n',
    'docs/plans/2026-01-01-transfer.md': plan,
    'docs/plans/topics/dnd.md': '# Drag and drop\n\n## Main changes\n\n- One transfer action.\n',
  };
  const root = project(dir, 'app', { config, files });
  const refused = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-transfer.md'], root);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /dnd needs ## What other editors do/);
  writeFileSync(join(root, 'docs/plans/2026-01-01-transfer.md'), plan.replace('Playbook: plan', 'Playbook: bug-fix'));
  assert.equal(run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-transfer.md'], root).status, 0);
  writeFileSync(join(root, 'docs/plans/2026-01-01-transfer.md'), plan);
  writeFileSync(join(root, 'docs/plans/topics/dnd.md'), files['docs/plans/topics/dnd.md'] + '\n## What other editors do\n\n- Lexical keeps drag in the view.\n');
  assert.equal(run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-transfer.md'], root).status, 0);
  writeFileSync(join(root, 'docs/plans/topics/workflow.md'), '# Workflow\n\n## Main changes\n\n- Pages follow subjects.\n');
  writeFileSync(join(root, 'docs/plans/2026-01-02-pass.md'), '# Pass\n\nStatus: planning\nTopic: workflow\n' + brief());
  assert.equal(run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-02-pass.md'], root).status, 0);
});

test('plan-page names the subject file to create when a topic has none', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', { files: { 'docs/plans/2026-01-01-pass.md': '# Pass\n\nStatus: planning\nTopic: workflow\n' + brief() } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-pass.md'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /create docs\/plans\/topics\/workflow\.md/);
});

const CLOSE = '\n## Close\n\n- Landed the schema landing.\n';
const DELTA_TOPIC = '# Drag\n\n## Public API\n\n```ts\nold();\n```\n\n## Layer and owner\n\n| Change | Layer |\n| --- | --- |\n| Column landing | Plate |\n| Upload veto | Plate |\n';
const DELTA_PLAN = '# Landing\n\nStatus: planning\nTopic: drag\n\n## Public API\n\n```ts before\nold();\n```\n\n```ts after\nnext();\n```\n\n## Layer and owner\n\n| Delta | Change | Layer |\n| --- | --- | --- |\n| added | Schema landing | Plite |\n| changed | Upload veto | Plite |\n| removed | Column landing | Plate |\n' + brief();
const deltaProject = (dir, topic, plan) =>
  project(dir, 'app', {
    files: { '.agents/playbooks/plan.md': playbook('page-lead: Layer and owner\n'), 'docs/plans/topics/drag.md': topic, 'docs/plans/2026-01-01-landing.md': plan },
  });

test('plan-page refuses a Delta row whose key the subject file does not have', () => {
  const { dir, run } = sandbox();
  const root = deltaProject(dir, DELTA_TOPIC, DELTA_PLAN.replace('| changed | Upload veto |', '| changed | Upload vetoes |'));
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-landing.md'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /marks "Upload vetoes" changed, but docs\/plans\/topics\/drag\.md has no such row/);
});

test("plan-page --folded refuses an executed plan until the subject file holds its delta", () => {
  const { dir, run } = sandbox();
  const done = DELTA_PLAN.replace('Status: planning', 'Status: executed, awaiting cross-review') + CLOSE;
  const folded = '# Drag\n\n## Public API\n\n```ts\nfirst();\nnext();\n```\n\n## Layer and owner\n\n| Change | Layer |\n| --- | --- |\n| Schema landing | Plite |\n| Upload veto | Plite |\n';
  const render = (topic) => {
    const root = deltaProject(mkdtempSync(join(dir, 'case-')), topic, done);
    return { root, result: run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-landing.md', '--folded'], root) };
  };
  const unfolded = render(DELTA_TOPIC).result;
  assert.equal(unfolded.status, 1);
  assert.match(unfolded.stderr, /does not show the added row "Schema landing"/);
  const apiLeft = render(folded.replace('next();', 'old();')).result;
  assert.equal(apiLeft.status, 1);
  assert.match(apiLeft.stderr, /does not show the after line/);
  const prefixed = render(folded.replace('next();', 'editor.next();')).result;
  assert.equal(prefixed.status, 1);
  assert.match(prefixed.stderr, /does not show the after line/);
  const oldKept = render(folded.replace('next();', 'next();\nold();')).result;
  assert.equal(oldKept.status, 1);
  assert.match(oldKept.stderr, /still shows the before line/);
  const { root, result } = render(folded);
  assert.equal(result.status, 0, result.stderr);
  writeFileSync(join(root, 'docs/plans/2026-01-01-landing.md'), done.replace(CLOSE, ''));
  const unclosed = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-landing.md', '--folded'], root);
  assert.equal(unclosed.status, 1, 'a fold without its Close');
  assert.match(unclosed.stderr, /needs a ## Close before --folded/);
});

test("plan-page shows the leader's Close after Needs you, keeps it on top once executed, and drops it when newer work opens", () => {
  const { dir, run } = sandbox();
  const topic = '# Workflow\n\nThe subject lead.\n\n## Main changes\n\n- Pages follow subjects.\n';
  const built = '# Built\n\nStatus: executed\nTopic: workflow\n\n## Main changes\n\n- Moved the renderer.\n\n## Close\n\n- Landed the renderer move, 3 done and 0 open.\n';
  const root = project(dir, 'app', { files: { 'docs/plans/topics/workflow.md': topic, 'docs/plans/2026-01-01-built.md': built } });
  const render = (plan) => {
    const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), plan], root);
    assert.equal(result.status, 0, result.stderr);
    return read(root, 'docs/plans/artifacts/topics/workflow.html');
  };
  const executed = render('docs/plans/2026-01-01-built.md');
  assert.ok(executed.includes('Landed the renderer move'), 'an executed leader keeps its Close on the page');
  assert.ok(executed.indexOf('Landed the renderer move') < executed.indexOf('The subject lead.'), 'the Close leads the subject state');
  writeFileSync(join(root, 'docs/plans/2026-01-01-built.md'), built + '\n## Open questions\n\n### Lessons\n\nApply the reflect lessons?\n\n- **apply** (recommended): apply them.\n- **skip**: drop them.\n');
  const asking = render('docs/plans/2026-01-01-built.md');
  assert.ok(asking.includes('Needs you') && asking.indexOf('Apply the reflect lessons?') < asking.indexOf('Landed the renderer move'), 'an executed leader still asks its open question');
  writeFileSync(join(root, 'docs/plans/2026-02-01-next.md'), '# Next\n\nStatus: planning\nTopic: workflow\n\n## Open questions\n\n' + MEMO + brief());
  assert.ok(!render('docs/plans/2026-02-01-next.md').includes('Landed the renderer move'), 'newer open work replaces the old Close');
  const oneOff = '# Fix\n\nStatus: executed\n\nThe fix lead.\n\n## Open questions\n\n### Ship\n\nShip it?\n\n- **ship** (recommended): ship.\n- **hold**: wait.\n\n## Close\n\n- Fixed the caret, 1 done.\n';
  writeFileSync(join(root, 'docs/plans/2026-03-01-fix.md'), oneOff);
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-03-01-fix.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const page = readFileSync(result.stdout.trim(), 'utf8');
  assert.ok(page.indexOf('Ship it?') < page.indexOf('Fixed the caret') && page.indexOf('Fixed the caret') < page.indexOf('The fix lead.'), 'a one-off plan shows its Close between Needs you and its lead');
});

test('plan-page leads with the open iteration when a finished one renders', () => {
  const { dir, run } = sandbox();
  const folded = '# Drag\n\n## Public API\n\n```ts\nnext();\n```\n\n## Layer and owner\n\n| Change | Layer |\n| --- | --- |\n| Schema landing | Plite |\n| Upload veto | Plite |\n';
  const root = deltaProject(dir, folded, DELTA_PLAN.replace('Status: planning', 'Status: done'));
  const open = '# Rows\n\nStatus: building; slice 1 complete\nTopic: drag\n\n## Layer and owner\n\n| Delta | Change | Layer |\n| --- | --- | --- |\n| added | Row veto | Plate |\n' + brief();
  const stale = '# Stale\n\nStatus: superseded by the rows plan\nTopic: drag\n\n## Layer and owner\n\n| Delta | Change | Layer |\n| --- | --- | --- |\n| added | Stale veto | Plate |\n';
  writeFileSync(join(root, 'docs/plans/2026-02-01-rows.md'), open);
  writeFileSync(join(root, 'docs/plans/2026-03-01-stale.md'), stale);
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-landing.md'], root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(read(root, 'docs/plans/artifacts/topics/drag.html').replace(/<[^>]+>/gu, ''), /Plan Rows/);
});

test('plan-page renders a plan reopened after its delta was folded', () => {
  const { dir, run } = sandbox();
  const folded = '# Drag\n\n## Public API\n\n```ts\nnext();\n```\n\n## Layer and owner\n\n| Change | Layer |\n| --- | --- |\n| Schema landing | Plite |\n| Upload veto | Plite |\n';
  const root = deltaProject(dir, folded, DELTA_PLAN.replace('Status: planning', 'Status: reopened; the execution review found a gap'));
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-landing.md'], root);
  assert.equal(result.status, 0, result.stderr);
});

test('plan-page refuses a subject folded while its plan is still open', () => {
  const { dir, run } = sandbox();
  const render = (topic) =>
    run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-landing.md'], deltaProject(mkdtempSync(join(dir, 'case-')), topic, DELTA_PLAN));
  const rows = render(DELTA_TOPIC.replace('| Upload veto | Plate |', '| Upload veto | Plite |'));
  assert.equal(rows.status, 1);
  assert.match(rows.stderr, /docs\/plans\/topics\/drag\.md already shows the changed row "Upload veto" of ## Layer and owner from docs\/plans\/2026-01-01-landing\.md, which is still open/);
  const api = render(DELTA_TOPIC.replace('old();', 'next();'));
  assert.equal(api.status, 1);
  assert.match(api.stderr, /already shows the after side of a ## Public API pair/);
  const cased = (topic, plan) =>
    run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-landing.md'], deltaProject(mkdtempSync(join(dir, 'case-')), topic, plan));
  const recase = DELTA_PLAN.replace('```ts after\nnext();', '```ts after\nOld();').replace('| changed | Upload veto | Plite |', '| changed | Upload veto | PLATE |');
  assert.equal(cased(DELTA_TOPIC, recase).status, 0, 'a change of case alone is a real change');
  assert.equal(cased(DELTA_TOPIC.replace('old();', 'Old();'), recase).status, 1);
  const order = DELTA_PLAN.replace('```ts before\nold();', '```ts before\nold();\nnext();').replace('```ts after\nnext();', '```ts after\nnext();\nold();');
  assert.equal(cased(DELTA_TOPIC.replace('old();', 'old();\nnext();'), order).status, 0);
  assert.equal(cased(DELTA_TOPIC.replace('old();', 'next();\nold();'), order).status, 1);
  const gone = render(DELTA_TOPIC.replace(/\n## Layer and owner[\s\S]*$/, '\n'));
  assert.equal(gone.status, 1, 'a subject without the section already shows the removed row as removed');
  const unlisted = DELTA_PLAN.replace('```ts before\nold();\n```\n\n```ts after\nnext();\n```', '```ts before\nother();\n```\n\n```ts after\n```');
  assert.equal(cased(DELTA_TOPIC, unlisted).status, 0, 'deleting a call the subject never listed is not a fold');
  const folding = deltaProject(mkdtempSync(join(dir, 'case-')), DELTA_TOPIC.replace('old();', 'next();'), DELTA_PLAN);
  const fold = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-landing.md', '--folded'], folding);
  assert.equal(fold.status, 1, 'the fold check still runs');
  assert.doesNotMatch(fold.stderr, /already shows/);
  const pair = (before, after) => DELTA_PLAN.replace('```ts before\nold();\n```\n\n```ts after\nnext();\n```', `\`\`\`ts before\n${before}\n\`\`\`\n\n\`\`\`ts after\n${after}\n\`\`\``);
  const subject = (code) => DELTA_TOPIC.replace('old();', code);
  const moved = ['if (on) {\n  start();\n}\nfinish();', 'if (on) {\n  start();\n  finish();\n}'];
  assert.equal(cased(subject(moved[0]), pair(...moved)).status, 0, 'a brace move is a real change');
  const spaced = ['title("a b");', 'title("a  b");'];
  assert.equal(cased(subject(spaced[0]), pair(...spaced)).status, 0, 'spacing inside a literal is a real change');
  const deps = ['useThing(() => {\n  run();\n});', 'useThing(() => {\n  run();\n}, []);'];
  assert.equal(cased(subject(deps[0]), pair(...deps)).status, 0, 'a punctuation-only change is a real change');
  assert.equal(cased(subject(deps[1]), pair(...deps)).status, 1);
  const ordinary = DELTA_PLAN + '\n## Ownership\n\n| Delta | Owner | Layer |\n| --- | --- | --- |\n| removed | Upload | Plate |\n';
  assert.equal(cased(DELTA_TOPIC, ordinary).status, 1, 'a removed row in a section the subject lacks is already folded');
});

test('plan-page skips a line another iteration also changes, and --folded checks the order of the after block', () => {
  const { dir, run } = sandbox();
  const plan = (status, before, after) => `# Plan\n\nStatus: ${status}\nTopic: drag\n\n## Public API\n\n\`\`\`ts before\n${before}\n\`\`\`\n\n\`\`\`ts after\n${after}\n\`\`\`\n${CLOSE}` + brief();
  const root = deltaProject(dir, DELTA_TOPIC.replace('old();', 'run();\nreplacement();'), plan('building', 'run();\nlegacy();', 'run();'));
  writeFileSync(join(root, 'docs/plans/2025-12-01-replace.md'), plan('executed', 'legacy();', 'replacement();'));
  assert.equal(run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-landing.md'], root).status, 0);
  const order = deltaProject(mkdtempSync(join(dir, 'case-')), DELTA_TOPIC.replace('old();', 'end();\nbegin();'), plan('building', 'old();', 'begin();\nend();'));
  const folded = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-landing.md', '--folded'], order);
  assert.equal(folded.status, 1);
  assert.match(folded.stderr, /does not show the after block of a ## Public API pair in order/);
  const spacing = deltaProject(mkdtempSync(join(dir, 'case-')), DELTA_TOPIC.replace('old();', 'title("a b");\ntitle("a  b");'), plan('building', 'title("a b");', 'title("a  b");'));
  const stale = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-landing.md', '--folded'], spacing);
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /still shows the before line "title\("a b"\);"/);
});

test("plan-page applies each iteration's own refusals whichever iteration renders the page", () => {
  const { dir, run } = sandbox();
  const older = (body) => `# Older\n\nStatus: building\nTopic: drag\n${body}` + brief();
  const render = (plan) => {
    const topic = DELTA_TOPIC.replace('| Upload veto | Plate |\n', '| Upload veto | Plate |\n| Drop veto | Plate |\n');
    const root = deltaProject(mkdtempSync(join(dir, 'case-')), topic, DELTA_PLAN);
    writeFileSync(join(root, 'docs/plans/2025-12-15-older.md'), plan);
    return run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-landing.md'], root);
  };
  assert.match(render(older('\n## Defaults\n\n- **Local only.**\n')).stderr, /## Defaults in docs\/plans\/2025-12-15-older\.md needs a table/);
  assert.match(render(older('Playbook: plna\n')).stderr, /2025-12-15-older\.md names playbook plna/);
  assert.equal(render(older('Playbook: feature\n')).status, 0, "a pstack playbook's name renders");
  assert.match(render(older('\n## Public API\n\n```ts before\nlater();\n```\n\nIt moved.\n\n```ts after\nlatest();\n```\n')).stderr, /needs each before fence followed directly by its after fence/);
  assert.match(render(older('\n## Layer and owner\n\n| Delta | Change | Layer |\n| --- | --- | --- |\n| changed | Drop veto | Plate |\n')).stderr, /already shows the changed row "Drop veto"/);
  assert.match(render(older('\n## Layer and owner\n\n| Delta | Change | Layer |\n| --- | --- | --- |\n| modified | Drop veto | Plite |\n')).stderr, /A Delta cell in ## Layer and owner of docs\/plans\/2025-12-15-older\.md is added, changed or removed, not "modified"/);
  assert.equal(render(older('Playbook: retired\n').replace('Status: building', 'Status: executed')).status, 0, 'an executed iteration keeps rendering after its playbook is renamed');
  const history = deltaProject(mkdtempSync(join(dir, 'case-')), DELTA_TOPIC, DELTA_PLAN.replace('Status: planning', 'Status: executed\nPlaybook: retired'));
  assert.equal(run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-landing.md'], history).status, 0, 'an executed leader keeps rendering after its playbook is renamed');
  const root = deltaProject(mkdtempSync(join(dir, 'case-')), DELTA_TOPIC, DELTA_PLAN);
  writeFileSync(join(root, 'docs/plans/2025-12-15-older.md'), older('Playbook: plna\n'));
  assert.match(run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2025-12-15-older.md'], root).stderr, /2025-12-15-older\.md names playbook plna/, 'the older path refuses the same way');
});

test('plan-page --check refuses an open plan whose Defaults is not the decision table, and writes nothing', () => {
  const { dir, run } = sandbox();
  const plan = (defaults) => `# Plan\n\nStatus: planning\n\n## Defaults\n\n${defaults}` + brief();
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan('- **Local only.** Reverse with "ci lane".\n') } });
  const listed = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md', '--check'], root);
  assert.equal(listed.status, 1);
  assert.match(listed.stderr, /## Defaults in docs\/plans\/plan\.md needs a table whose columns start with Decision, Pick, Alternative and Word/);
  writeFileSync(join(root, 'docs/plans/plan.md'), plan('| Decision | Pick | Alternative | Word |\n| --- | --- | --- | --- |\n| Where it runs | Locally | A nightly runner | ci lane |\n'));
  assert.equal(run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md', '--check'], root).status, 0);
  assert.ok(!existsSync(join(root, 'docs/plans/artifacts/plan.html')));
});

test('plan-page opens an open plan with its brief, its open questions and its changes, and leaves proof and steps to the plan file', () => {
  const { dir, run } = sandbox();
  const plan = `# Plan\n\nStatus: planning\n\n${brief()}## Open questions\n\n${MEMO}\n## Main changes\n\n- Moves the owner.\n\n## Steps\n\n- [ ] Ship the owner move.\n\n## Close\n\n- Landed nothing yet.\n`;
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const html = read(root, 'docs/plans/artifacts/plan.html');
  assert.ok(html.indexOf('It opens with a brief.') < html.indexOf('Build the memo now?'), 'the brief leads the page');
  assert.ok(html.indexOf('Old plans need a brief.') < html.indexOf('Build the memo now?'), 'every answer stays above the open questions');
  assert.ok(html.indexOf('Build the memo now?') < html.indexOf('Moves the owner.'), 'Main changes shows after the open questions');
  assert.ok(!html.includes('Ship the owner move.') && !html.includes('Landed nothing yet.'), 'Steps and Close stay in the plan file');
  assert.match(html.replace(/<[^>]+>/gu, ''), /review rounds are in docs\/plans\/plan\.md/);
});

test('plan-page renders an open question as a decision memo: why it needs you, the facts, each option with what happens and its cost, the pick with its reason, and what go does', () => {
  const { dir, run } = sandbox();
  const plan = `# Plan\n\nStatus: planning\n\n${brief()}## Open questions\n\n${MEMO}`;
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const html = read(root, 'docs/plans/artifacts/plan.html');
  const needs = html.slice(html.indexOf('Needs you'));
  const order = ['Build the memo now?', 'The renderer is shared by every project.', 'Another session changed it this morning.', 'I build it today.', 'A design mistake shows up after the build.', 'The prototype settled the design.', 'Nothing changes.', 'Needs you stays hard to read.'];
  order.forEach((text) => assert.ok(needs.includes(text), `the memo shows "${text}"`));
  assert.ok(needs.indexOf('The prototype settled the design.') < needs.indexOf('Nothing changes.'), 'the reason sits with the pick, before the other options');
  assert.match(needs, /<input type="radio" name="q0" value="Build now" checked>/, 'my pick starts checked');
  assert.match(needs, /<input type="radio" name="q0" value="Hold">/, 'the other option is a radio too');
});

test('plan-page refuses an open question that skips a memo part, accepts one with no pick, and renders an executed plan\'s old question', () => {
  const { dir, run } = sandbox();
  const render = (root) => run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  const old = '### Ship\n\nShip it?\n\n- **ship** (recommended): ship.\n- **hold**: wait.\n';
  const refused = render(project(dir, 'old', { files: { 'docs/plans/plan.md': `# Plan\n\nStatus: planning\n\n${brief()}## Open questions\n\n${old}` } }));
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /"Ship" in docs\/plans\/plan\.md needs Why it needs you:, a Cost: on every option, Why I pick it: and Attention: safe, look or answer/);
  const noPick = MEMO.replace(' (recommended)', '').replace('\nWhy I pick it: The prototype settled the design.\n', '').replace('I build the memo renderer.', 'go leaves this open.');
  const accepted = render(project(dir, 'nopick', { files: { 'docs/plans/plan.md': `# Plan\n\nStatus: planning\n\n${brief()}## Open questions\n\n${noPick}` } }));
  assert.equal(accepted.status, 0, accepted.stderr);
  const executed = project(dir, 'executed', { files: { 'docs/plans/plan.md': `# Plan\n\nStatus: executed\n\n## Open questions\n\n${old}\n## Close\n\n- Shipped.\n` } });
  assert.equal(render(executed).status, 0);
  assert.ok(read(executed, 'docs/plans/artifacts/plan.html').includes('Ship it?'), 'an executed plan keeps its old question');
  const legacy = project(dir, 'legacy', { files: { 'docs/plans/plan.md': `# Plan\n\n## Open questions\n\n${old}\n### Resolve before planning\n\n- Should the doc ship alone, or\n  with an appendix?\n` } });
  assert.equal(render(legacy).status, 0, 'a plan with no Status: line keeps its old question');
  assert.ok(read(legacy, 'docs/plans/artifacts/plan.html').includes('Should the doc ship alone, or with an appendix?'), 'a question with no options renders its text whole');
});

test('plan-page refuses an open question whose part runs past its word budget or holds more than two facts, and renders an executed plan\'s long question', () => {
  const { dir, run } = sandbox();
  const render = (root) => run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  const longFact = MEMO.replace('Another session changed it this morning.', 'Another session changed the shared renderer this morning while two other sessions were still rendering their pages.');
  const long = render(project(dir, 'long', { files: { 'docs/plans/plan.md': `# Plan\n\nStatus: planning\n\n${brief()}## Open questions\n\n${longFact}` } }));
  assert.equal(long.status, 1);
  assert.match(long.stderr, /"Build" in docs\/plans\/plan\.md runs long: fact 1 at 17 words, where 15 is the most/);
  const threeFacts = MEMO.replace('- Another session changed it this morning.\n', '- Another session changed it this morning.\n- The tests pass.\n- The corpus renders.\n');
  const many = render(project(dir, 'many', { files: { 'docs/plans/plan.md': `# Plan\n\nStatus: planning\n\n${brief()}## Open questions\n\n${threeFacts}` } }));
  assert.equal(many.status, 1);
  assert.match(many.stderr, /runs long: 3 facts, where 2 is the most/);
  const executed = render(project(dir, 'executed', { files: { 'docs/plans/plan.md': `# Plan\n\nStatus: executed\n\n## Open questions\n\n${longFact}\n## Close\n\n- Shipped.\n` } }));
  assert.equal(executed.status, 0, executed.stderr);
});

test("plan-page shows the subject's page-lead section, marked current, when the open plan has none", () => {
  const { dir, run } = sandbox();
  const topic = '# Workflow\n\nPage: https://example.test/page\n\n## What other editors do\n\n- Lexical keeps it in the node.\n\n## Main changes\n\n- Pages follow subjects.\n';
  const second = '# Second pass\n\nStatus: planning\nTopic: workflow\n\n## Main changes\n\n- Moves the owner.\n' + brief();
  const root = project(dir, 'app', { files: { '.agents/playbooks/plan.md': playbook('page-lead: What other editors do\n'), 'docs/plans/topics/workflow.md': topic, 'docs/plans/2026-02-01-second.md': second } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-02-01-second.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const text = read(root, 'docs/plans/artifacts/topics/workflow.html').replace(/<[^>]+>/gu, '');
  assert.match(text, /What other editors do current\s*Lexical keeps it in the node\./);
  assert.ok(text.indexOf('Lexical keeps it') < text.indexOf('Moves the owner.') && !text.includes('Pages follow subjects'), "the plan's changes show, and the subject's own Main changes stays in its file");
});

test('plan-page refuses code in an open plan\'s brief, questions or defaults, and renders an executed plan that has it', () => {
  const { dir, run } = sandbox();
  const render = (root) => run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  const coded = brief().replace('Old plans need a brief.', 'Old plans need a `## Brief`.');
  const open = render(project(dir, 'open', { files: { 'docs/plans/plan.md': `# Plan\n\nStatus: planning\n\n${coded}` } }));
  assert.equal(open.status, 1);
  assert.match(open.stderr, /## Brief in docs\/plans\/plan\.md holds code `## Brief`; the page shows this section, so write it in plain words/);
  const executed = render(project(dir, 'executed', { files: { 'docs/plans/plan.md': `# Plan\n\nStatus: executed\n\n${coded}## Close\n\n- Shipped.\n` } }));
  assert.equal(executed.status, 0, executed.stderr);
});

test('plan-page puts the questions that need the owner first and renders a Pick any question as checked checkboxes', () => {
  const { dir, run } = sandbox();
  const safe = MEMO.replace('### Build', '### Safe one').replace('Build the memo now?', 'Ship the safe part now?').replace('Attention: look', 'Attention: safe');
  const many = '### Lessons\n\nWhich lessons become rules?\n\nWhy it needs you: Each lesson changes every future agent.\n\nPick any.\n\n- **Test last** (recommended): Agents test after the cleanup. Cost: Slower changes.\n- **Clean messages** (recommended): Agents clean each message. Cost: One more step.\n- **Count todos**: A script counts todos. Cost: A new script.\n\nWhy I pick it: Both fixed real mistakes.\n\nAttention: look\n';
  const open = '### Order\n\nWhich page moves first?\n\nWhy it needs you: I have no reason to prefer one.\n\n- **History**: I move history today. Cost: Reads waits.\n- **Reads**: I move reads today. Cost: History waits.\n\nIf you say go: go leaves this question open.\n';
  const plan = `# Plan\n\nStatus: planning\n\n${brief()}## Open questions\n\n${safe}\n${many}\n${open}`;
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const html = read(root, 'docs/plans/artifacts/plan.html');
  const at = (text) => html.indexOf(text);
  assert.ok(at('Which page moves first?') < at('Which lessons become rules?') && at('Which lessons become rules?') < at('Ship the safe part now?'), 'needs you, then worth a look, then safe');
  assert.match(html, /<input type="checkbox" name="q1" value="Test last" checked>[\s\S]*<input type="checkbox" name="q1" value="Clean messages" checked>[\s\S]*<input type="checkbox" name="q1" value="Count todos">/);
});

test('plan-page refuses an open question with a pick but no Attention line, or two picks without Pick any', () => {
  const { dir, run } = sandbox();
  const render = (name, memo) => run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], project(dir, name, { files: { 'docs/plans/plan.md': `# Plan\n\nStatus: planning\n\n${brief()}## Open questions\n\n${memo}` } }));
  const unrated = render('unrated', MEMO.replace('\nAttention: look\n', ''));
  assert.equal(unrated.status, 1);
  assert.match(unrated.stderr, /"Build" in docs\/plans\/plan\.md needs Attention: safe, look or answer/);
  const twoPicks = render('two', MEMO.replace('- **Hold**:', '- **Hold** (recommended):'));
  assert.equal(twoPicks.status, 1);
  assert.match(twoPicks.stderr, /needs at most one \(recommended\) option, or a Pick any\. line/);
});

test('plan-page ends a superseded plan\'s rail at its status word instead of Ship', () => {
  const { dir, run } = sandbox();
  const plan = '# Plan\n\nStatus: superseded by the next plan\n\n## Main changes\n\n- Draw the rail.\n';
  const log = ['ts\tphase\tdecision\twhy\tevidence\tresult', reviewRow('build', 'Port the rail', 'fixed')].join('\n');
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan, 'docs/plans/plan.decisions.tsv': `${log}\n` } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const rail = [...read(root, 'docs/plans/artifacts/plan.html').matchAll(/<li class="fs (\w+)"[^>]*>(.*?)<\/li>/gu)].map(([, state, body]) => `${state}:${body.replace(/<[^>]+>/gu, '')}`);
  assert.deepEqual(rail.slice(3, 6), ['done:Build', 'stopped:Superseded', 'skipped:Writing']);
  assert.ok(rail.includes('skipped:Ship'), 'a superseded plan never shows Ship as done');
});

test('plan-page refuses an open plan that leads its page without a brief, and renders older and executed plans without one', () => {
  const { dir, run } = sandbox();
  const render = (root, plan) => run(process.execPath, [join(HELPERS, 'plan-page.mjs'), plan], root);
  const open = project(dir, 'open', { files: { 'docs/plans/plan.md': '# Plan\n\nStatus: planning\n\n## Main changes\n\n- Moves the owner.\n' } });
  const refused = render(open, 'docs/plans/plan.md');
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /docs\/plans\/plan\.md leads its page while open, so it needs a ## Brief/);
  const executed = project(dir, 'executed', { files: { 'docs/plans/plan.md': '# Plan\n\nStatus: executed\n\n## Main changes\n\n- Moved the owner.\n' } });
  assert.equal(render(executed, 'docs/plans/plan.md').status, 0);
  const reopened = project(dir, 'reopened', { files: { 'docs/plans/plan.md': '# Plan\n\nStatus: reopened after the fold\n\n## Main changes\n\n- Moves the owner again.\n' } });
  assert.equal(render(reopened, 'docs/plans/plan.md').status, 1, 'a reopened plan owes its brief again');
  const topic = '# Workflow\n\n## Main changes\n\n- Pages follow subjects.\n';
  const older = '# Older\n\nStatus: planning\nTopic: workflow\n\n## Main changes\n\n- An older open pass.\n';
  const newer = `# Newer\n\nStatus: planning\nTopic: workflow\n\n${brief()}## Main changes\n\n- The newer pass.\n`;
  const subject = project(dir, 'subject', { files: { 'docs/plans/topics/workflow.md': topic, 'docs/plans/2026-01-01-older.md': older, 'docs/plans/2026-02-01-newer.md': newer } });
  const result = render(subject, 'docs/plans/2026-01-01-older.md');
  assert.equal(result.status, 0, result.stderr);
});

test('plan-page refuses a brief that skips or reorders a question, leaves one empty or runs long', () => {
  const { dir, run } = sandbox();
  const cases = [
    [BRIEF_ANSWERS.slice(0, 1), /asks .* but it needs a ## Brief/],
    [[BRIEF_ANSWERS[1], BRIEF_ANSWERS[0]], /asks .* but it needs a ## Brief/],
    [BRIEF_ANSWERS.map(([question, answer], index) => [question, index === 1 ? '' : answer]), /leaves "What could go wrong\?" unanswered/],
    [BRIEF_ANSWERS.map(([question, answer], index) => [question, index === 0 ? 'word '.repeat(41) : answer]), /answers "What will change\?" in 41 words; keep each answer to 40/],
    [FIVE_ROW_BRIEF, /drop "What did you find\?", "What do you need from me\?" and "What happens if I say go\?"; an ask that is not a decision goes on the Status: line/],
  ];
  for (const [index, [answers, message]] of cases.entries()) {
    const root = project(dir, `case-${index}`, { files: { 'docs/plans/plan.md': `# Plan\n\nStatus: planning\n\n${brief(answers)}` } });
    const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md', '--check'], root);
    assert.equal(result.status, 1, `case ${index} renders`);
    assert.match(result.stderr, message);
  }
});

test("plan-page shows an open plan's Status sentence in the page header", () => {
  const { dir, run } = sandbox();
  const plan = `# Plan\n\nStatus: waiting on your answer, then your commit of the guide\n\n${brief()}## Open questions\n\n${MEMO}`;
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const header = read(root, 'docs/plans/artifacts/plan.html').match(/<header>[\s\S]*?<\/header>/u)?.[0] ?? '';
  assert.match(header.replace(/<[^>]+>/gu, ''), /Waiting on your answer, then your commit of the guide/);
});

test("plan-page shows only Changes and Risks from an executed plan's five-row brief", () => {
  const { dir, run } = sandbox();
  const plan = `# Plan\n\nStatus: executed\n\n${brief(FIVE_ROW_BRIEF)}## Main changes\n\n- Moved the owner.\n`;
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const card = read(root, 'docs/plans/artifacts/plan.html').match(/<section class="brief card">[\s\S]*?<\/section>/u)?.[0] ?? '';
  assert.deepEqual([...card.matchAll(/<h2[^>]*>([^<]+)<\/h2>/gu)].map((match) => match[1]), ['Changes', 'Risks']);
  assert.ok(!card.includes('Pick build or hold.') && !card.includes('The renderer changes.'), 'the cut rows stay in the plan file');
});

test("plan-page shows only the leading plan's own review round on a brief page", () => {
  const { dir, run } = sandbox();
  const topic = '# Workflow\n\n## Main changes\n\n- Pages follow subjects.\n';
  const older = '# Older\n\nStatus: executed\nTopic: workflow\n\n## Main changes\n\n- An older pass.\n';
  const log = 'ts\tphase\tdecision\twhy\tevidence\tresult\n2026-01-01T00:00:00Z\tpanel\tseats opus\tround 1\tcommit abc\trecorded: answered\n';
  const newer = `# Newer\n\nStatus: planning\nTopic: workflow\n\n${brief()}`;
  const root = project(dir, 'app', {
    files: {
      'docs/plans/topics/workflow.md': topic,
      'docs/plans/2026-01-01-older.md': older,
      'docs/plans/2026-01-01-older.decisions.tsv': log,
      'docs/plans/2026-02-01-newer.md': newer,
    },
  });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-02-01-newer.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const html = read(root, 'docs/plans/artifacts/topics/workflow.html');
  assert.ok(!html.slice(html.indexOf('<header>'), html.indexOf('</header>')).includes('Review round'), 'the header names no other plan\'s round');
});

test('plan-page leads with the same-day iteration whose log moved last, whichever plan renders it', () => {
  const { dir, run } = sandbox();
  const plan = (title) => `# ${title}\n\nStatus: executed\nTopic: workflow\n\n## Main changes\n\n- ${title} work.\n\n## Close\n\n- Closed ${title}.\n`;
  const log = (stamp) => `ts\tphase\tdecision\twhy\tevidence\tresult\n${stamp}\tbuild\tdid it\twhy\tevidence\trecorded\n`;
  const root = project(dir, 'app', {
    files: {
      'docs/plans/topics/workflow.md': '# Workflow\n\n## Main changes\n\n- Pages follow subjects.\n',
      'docs/plans/2026-01-01-alpha.md': plan('alpha'),
      'docs/plans/2026-01-01-alpha.decisions.tsv': log('2026-01-01T18:00:00Z'),
      'docs/plans/2026-01-01-beta.md': plan('beta'),
      'docs/plans/2026-01-01-beta.decisions.tsv': log('2026-01-01T09:00:00Z'),
    },
  });
  const render = (path) => {
    const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), path], root);
    assert.equal(result.status, 0, result.stderr);
    return read(root, 'docs/plans/artifacts/topics/workflow.html');
  };
  const page = render('docs/plans/2026-01-01-beta.md');
  assert.ok(page.includes('Closed alpha') && !page.includes('Closed beta'), 'the iteration whose log moved last leads');
  assert.equal(render('docs/plans/2026-01-01-alpha.md'), page);
});

test('plan-page draws one page for a subject whichever iteration renders it', () => {
  const { dir, run } = sandbox();
  const root = deltaProject(dir, DELTA_TOPIC, DELTA_PLAN);
  writeFileSync(join(root, 'docs/plans/2026-02-01-rows.md'), '# Rows\n\nStatus: planning\nTopic: drag\n\n## Main changes\n\n- Rows move.\n' + brief());
  const render = (path) => {
    const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), path], root);
    assert.equal(result.status, 0, result.stderr);
    return read(root, 'docs/plans/artifacts/topics/drag.html');
  };
  assert.equal(render('docs/plans/2026-01-01-landing.md'), render('docs/plans/2026-02-01-rows.md'));
  writeFileSync(join(root, 'docs/plans/2026-02-01-rows.md'), '# Rows\n\nStatus: done\nTopic: drag\n\n## Open questions\n\n- Keep rows?\n');
  writeFileSync(join(root, 'docs/plans/2026-01-01-landing.md'), DELTA_PLAN.replace('Status: planning', 'Status: superseded by rows'));
  assert.equal(render('docs/plans/2026-01-01-landing.md'), render('docs/plans/2026-02-01-rows.md'));
});

test("plan-page reads a subject iteration's state from the first word of its Status", () => {
  const { dir, run } = sandbox();
  const status = (line) => {
    const root = deltaProject(mkdtempSync(join(dir, 'case-')), DELTA_TOPIC, DELTA_PLAN.replace('Status: planning', `Status: ${line}`));
    return { ...run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-landing.md'], root), root };
  };
  const unknown = status('Not done yet');
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /needs a Status: line that starts with a state word/);
  const reopened = status('Re-opened after the execution review');
  assert.equal(reopened.status, 0, reopened.stderr);
});

test('plan-page leads with the dated open iteration over an undated issue plan', () => {
  const { dir, run } = sandbox();
  const root = deltaProject(dir, DELTA_TOPIC, DELTA_PLAN);
  writeFileSync(join(root, 'docs/plans/4731-old-issue.md'), '# Old issue\n\nStatus: planning\nTopic: drag\n\n## Main changes\n\n- Old work.\n' + brief());
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/4731-old-issue.md'], root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(read(root, 'docs/plans/artifacts/topics/drag.html'), /<span>Plan <strong>Landing<\/strong>/);
});

test('plan-open --done sweeps an executed plan that still has an open box', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', { files: { 'docs/plans/2026-01-01-shipped.md': '# Shipped\n\nStatus: executed, awaiting review\n\n- [ ] Close the gate\n', 'docs/plans/2026-01-02-gone.md': '# Gone\n\nStatus: superseded by shipped\n\n- [ ] Never done\n' } });
  const result = run(process.execPath, [join(HELPERS, 'plan-open.mjs'), '--done'], root);
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /2026-01-01-shipped\.md/);
  assert.doesNotMatch(result.stdout + result.stderr, /2026-01-02-gone\.md/);
});

test('plan-page refuses a subject file that keeps a before and after pair', () => {
  const { dir, run } = sandbox();
  const topic = DELTA_TOPIC.replace('```ts\nold();\n```', '```ts before\nold();\n```\n\n```ts after\nnext();\n```');
  const root = deltaProject(dir, topic, DELTA_PLAN);
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-landing.md'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Public API in docs\/plans\/topics\/drag\.md holds the current state as plain fences/);
});

test('plan-page reads a Delta column as a plain table on a one-off plan', () => {
  const { dir, run } = sandbox();
  const plan = '# Audit\n\nStatus: done\n\n## Notes\n\n| Delta | Owner |\n| --- | --- |\n| DOM ledger | Plite |\n';
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(read(root, 'docs/plans/artifacts/plan.html'), /<td>DOM ledger<\/td>/);
});

test('plan-open fails a gate row that leaves Applies, evidence or another column pending', () => {
  const { dir, run } = sandbox();
  const plan = '# Plan\n\nCompletion Gates:\n| Gate | Applies | Required action | Evidence |\n|---|---|---|---|\n| Package proof | yes | Run the package proof | `bun test ./a.test.ts` passed |\n| Scale proof | pending | Run the probe | pending |\n';
  const root = project(dir, 'app', { files: { 'plan.md': plan } });
  const result = run(process.execPath, [join(HELPERS, 'plan-open.mjs'), 'plan.md'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /plan\.md:7: .*Scale proof/);
  assert.doesNotMatch(result.stderr, /Package proof/);
});

test('plan-open makes a newly closed box name its artifact and a deferred finding name its owner and stop', () => {
  const { dir, run } = sandbox();
  const legacy = '# Plan\n\nStatus: In progress.\n\n- [x] shipped long ago\n';
  const root = project(dir, 'app', { files: { 'plan.md': legacy } });
  run('git', ['add', '.'], root);
  run('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'plan'], root);
  const check = () => run(process.execPath, [join(HELPERS, 'plan-open.mjs'), 'plan.md'], root);

  writeFileSync(join(root, 'plan.md'), `${legacy}- [x] writing passes ran\n- [x] tests pass: \`bun test ./src/a.test.ts\`\n- [x] docs: skip: no docs changed\n\n## Deferred\n\n- schema check\n- ledger merge, owner: issue-harvester in docs/plans/next.md, stop: when the merged ledger's check passes\n`);
  const result = check();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /plan\.md:6: .*writing passes ran/);
  assert.match(result.stderr, /plan\.md:12: .*schema check/);
  assert.doesNotMatch(result.stderr, /:5:|:7:|:8:|:13:/);
});

test('plan-open makes an Open work item added since HEAD name its owner and its stop', () => {
  const { dir, run } = sandbox();
  const legacy = '# Plan\n\nStatus: In progress.\n\n## Open work\n\n- old backlog item\n';
  const root = project(dir, 'app', { files: { 'plan.md': legacy } });
  run('git', ['add', '.'], root);
  run('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'plan'], root);

  writeFileSync(join(root, 'plan.md'), `${legacy}- split the ledger, owner: lead in docs/plans/topics/ledger.md\n- drop the dossier, owner: lead in docs/plans/topics/ledger.md, stop: when slate mode is retired\n`);
  const result = run(process.execPath, [join(HELPERS, 'plan-open.mjs'), 'plan.md'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /plan\.md:8: .*split the ledger.*stop:/);
  assert.doesNotMatch(result.stderr, /:7:|:9:/);
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

test('decisions-check refuses a panel row in the plans directory until its plan sits beside the log', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', { files: { 'docs/plans/.keep': '' } });
  const append = (log) => run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'append', log, 'panel', 'seats opus', 'why', 'evidence', 'recorded'], root);
  const orphan = append('docs/plans/2026-01-01-verdict.decisions.tsv');
  assert.equal(orphan.status, 1, 'a panel row with no plan beside it');
  assert.match(orphan.stderr, /needs its plan docs\/plans\/2026-01-01-verdict\.md/);
  assert.equal(run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'append', 'docs/plans/2026-01-01-verdict.decisions.tsv', 'plan', 'pick the scope', 'why', 'evidence', 'recorded'], root).status, 0, 'other phases need no plan');
  writeFileSync(join(root, 'docs/plans/2026-01-01-verdict.md'), '# Verdict\n\nStatus: planning\n' + brief());
  assert.equal(append('docs/plans/2026-01-01-verdict.decisions.tsv').status, 0, 'the plan exists');
  assert.equal(append('log.decisions.tsv').status, 0, 'a log outside the plans directory');
});

test('decisions-check takes a panel finding only with a severity, after a seats row, and with an applied, dismissed or owned deferred reason', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app');
  const append = (decision, result) => run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'append', 'log.decisions.tsv', 'panel', decision, 'why', 'evidence', result], root);
  assert.equal(append('critical The seat writes files', 'applied: read-only').status, 1, 'a finding before any seats row');
  assert.equal(append('seats opus, codex:gpt-6.1-sol @xhigh', 'recorded').status, 0);
  assert.equal(append('The seat writes files', 'applied: read-only').status, 1, 'a finding without a severity');
  assert.equal(append('critical The seat writes files', 'recorded').status, 1, 'a finding with no disposition');
  assert.equal(append('critical The seat writes files', 'applied').status, 1, 'a disposition with no reason');
  assert.equal(append('critical The seat writes files', 'applied: read-only').status, 0);
  assert.equal(append('warning The fallback lists stale sessions', 'deferred: outside the ask').status, 1, 'a deferral with no owner');
  assert.equal(append('warning The fallback lists stale sessions', 'deferred: outside the ask, owner:').status, 1, 'a deferral with an empty owner');
  assert.equal(append('critical The seat writes files', 'deferred: later, owner: user').status, 1, 'a deferred critical finding');
  assert.equal(append('warning The fallback lists stale sessions', 'deferred: outside the ask, owner: user in docs/plans/next.md').status, 0);
});

test('decisions-check takes an open panel finding only with its patch and owner', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app');
  const append = (decision, result) => run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'append', 'log.decisions.tsv', 'panel', decision, 'why', 'evidence', result], root);
  assert.equal(append('seats opus', 'recorded').status, 0);
  assert.equal(append('critical The guard drops real typing', 'open: the fix adds code past the cap').status, 1, 'an open finding with no patch or owner');
  assert.equal(append('critical The guard drops real typing', 'open: past the cap, patch: fix.patch').status, 1, 'an open finding with no owner');
  assert.equal(append('critical The guard drops real typing', 'open: past the cap, owner: user').status, 1, 'an open finding with no patch');
  const ok = append('critical The guard drops real typing', 'open: past the cap, patch: scratch/fix.patch, owner: user');
  assert.equal(ok.status, 0, ok.stderr);
});

test("decisions-check takes a later round's seats row only after a writing row", () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app');
  const append = (phase, decision, result = 'recorded') => run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'append', 'log.decisions.tsv', phase, decision, 'why', 'evidence', result], root);
  assert.equal(append('panel', 'seats opus').status, 0, 'the first round');
  assert.equal(append('panel', 'critical The guard drops typing', 'applied: the guard reads the composition flag').status, 0);
  const unwritten = append('panel', 'seats opus');
  assert.equal(unwritten.status, 1, 'a second round whose fixes had no writing pass');
  assert.match(unwritten.stderr, /needs a writing row/);
  assert.equal(append('writing', 'deslop and no-comments on the round 1 fixes').status, 0);
  assert.equal(append('panel', 'seats opus').status, 0, 'the second round after the writing pass');
  const batch = (name, rows) => {
    writeFileSync(join(root, name), rows.map((row) => row.join('\t')).join('\n') + '\n');
    return run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'append', 'log.decisions.tsv', '--from', name], root);
  };
  assert.equal(batch('written.tsv', [['writing', 'unslop on the round 2 fixes', 'why', 'evidence', 'recorded'], ['panel', 'seats opus', 'why', 'evidence', 'recorded']]).status, 0, 'a queued writing row before the next round');
  const skipped = batch('skipped.tsv', [['writing', 'unslop on the round 3 fixes', 'why', 'evidence', 'recorded'], ['panel', 'seats opus', 'why', 'evidence', 'recorded'], ['panel', 'critical The guard drops typing', 'why', 'evidence', 'applied: fixed'], ['panel', 'seats opus', 'why', 'evidence', 'recorded']]);
  assert.equal(skipped.status, 1, 'a queued round with no writing row after the previous one');
  assert.match(skipped.stderr, /\(new row 4\): a later round's seats row/);
  writeFileSync(join(root, 'old.decisions.tsv'), 'ts\tphase\tdecision\twhy\tevidence\tresult\n2026-10-06T10:00:00Z\tpanel\tseats opus\twhy\tevidence\trecorded\n2026-10-06T11:00:00Z\tpanel\tseats opus\twhy\tevidence\trecorded\n');
  assert.equal(run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'old.decisions.tsv'], root).status, 0, 'a whole-log check leaves rounds already written alone');
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

test('a clean shared source refuses to drop edits a project was synced from before they were committed', () => {
  const { dir, run } = sandbox();
  const shared = sharedSource(dir);
  const original = readFileSync(shared.template, 'utf8');
  writeFileSync(shared.template, original.replace('Never claim a skipped or unavailable proof passed.', 'Never claim an unrun proof passed.'));
  const root = project(dir, 'app', { config: CONFIG, agents: '# App\n' });
  assert.equal(run(process.execPath, [shared.script, 'apply', root]).status, 0);
  writeFileSync(shared.template, original);

  const refused = run(process.execPath, [shared.script, 'apply', root]);
  assert.equal(refused.status, 1);
  assert.match(refused.stdout, /uncommitted shared edits/);
  assert.match(read(root, 'AGENTS.md'), /unrun proof/);
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

test('freeze writes a commit no ref points to without touching the checkout index', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-pstack-freeze-'));
  const repo = join(dir, 'repo');
  spawnSync('git', ['init', '-q', repo]);
  writeFileSync(join(repo, 'plan.md'), 'reviewed\n');
  writeFileSync(join(repo, 'other.md'), 'base\n');
  spawnSync('git', ['-C', repo, 'add', '-A']);
  commit(repo, 'base');
  writeFileSync(join(repo, 'plan.md'), 'round one\n');
  writeFileSync(join(repo, 'other.md'), 'another session\n');
  const runDir = join(dir, 'run');
  const freeze = (...args) => spawnSync(process.execPath, [join(HELPERS, 'freeze.mjs'), '--dir', runDir, ...args], { cwd: repo, encoding: 'utf8' });

  const first = freeze('plan.md');
  assert.equal(first.status, 0, first.stderr);
  const sha = first.stdout.trim();
  const show = (rev, path) => spawnSync('git', ['-C', repo, 'show', `${rev}:${path}`], { encoding: 'utf8' }).stdout;
  assert.equal(show(sha, 'plan.md'), 'round one\n');
  assert.equal(show(sha, 'other.md'), 'base\n');
  assert.equal(spawnSync('git', ['-C', repo, 'diff', '--cached', '--quiet']).status, 0);
  assert.equal(spawnSync('git', ['-C', repo, 'for-each-ref', '--contains', sha], { encoding: 'utf8' }).stdout, '');
  assert.ok(existsSync(join(runDir, 'freeze-index')));

  writeFileSync(join(repo, 'plan.md'), 'round two\n');
  const second = freeze('--parent', sha, 'plan.md');
  assert.equal(second.status, 0, second.stderr);
  const parent = spawnSync('git', ['-C', repo, 'rev-parse', `${second.stdout.trim()}^`], { encoding: 'utf8' }).stdout.trim();
  assert.equal(parent, sha);

  assert.equal(freeze('missing.md').status, 1);
  assert.equal(spawnSync(process.execPath, [join(HELPERS, 'freeze.mjs')], { cwd: repo }).status, 2);
});

test('decisions-check append --from writes every queued row or none', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app');
  const queue = (rows) => {
    writeFileSync(join(root, 'queued.tsv'), rows.map((row) => row.join('\t')).join('\n'));
    return run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'append', 'log.decisions.tsv', '--from', 'queued.tsv'], root);
  };
  const seats = ['panel', 'seats opus, codex:gpt-6.1-sol @xhigh', 'round 1', 'frozen abc1234', 'recorded'];
  const finding = ['panel', 'critical The seat writes files', 'seat probe', 'reran the probe', 'applied: read-only flag'];

  const refused = queue([seats, ['panel', 'superseded the earlier finding', 'why', 'evidence', 'superseded']]);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /new row 2/);
  assert.equal(existsSync(join(root, 'log.decisions.tsv')), false, 'a refused batch writes no row');

  const ok = queue([seats, finding]);
  assert.equal(ok.status, 0, ok.stderr);
  const lines = read(root, 'log.decisions.tsv').trim().split('\n');
  assert.deepEqual(lines.slice(1).map((line) => line.split('\t')[2]), [seats[1], finding[1]]);
});


test('decisions-check refuses a new row whose evidence cites a run-directory path that does not exist', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', {
    files: {
      'docs/plans/artifacts/run/test-a1.log': '$ (.) node --test\nexit=0\n',
      'docs/plans/artifacts/run/proof result-a1.log': 'exit=0\n',
    },
  });
  const append = (evidence, phase = 'build') => run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'append', 'log.decisions.tsv', phase, 'fix the parser', 'why', evidence, 'verified'], root);

  const missing = append('scope: parser fixtures; docs/plans/artifacts/run/test-a2.log');
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /cites docs\/plans\/artifacts\/run\/test-a2\.log, which does not exist/);
  for (const [evidence, why] of [
    ['scope: parser; `docs/plans/artifacts/run/test-a1.log:2:5`.', 'a line and column suffix'],
    ['scope: parser; [log](docs/plans/artifacts/run/test-a1.log#L2)', 'a link with a line anchor'],
    ['scope: parser; `docs/plans/artifacts/run/proof result-a1.log`', 'a code span holding a space'],
    [`scope: parser; ${join(root, 'docs/plans/artifacts/run/test-a1.log')}`, 'an absolute path'],
    ['scope: every seat; docs/plans/artifacts/run/seat-*.md, docs/plans/artifacts/run/a1..a8/answer.md and run-[12].log', 'a glob, a range and a bracket'],
    ['scope: parser; docs/plans/artifacts/run/test-a9.log (missing) is what the trail cites', 'a path marked missing'],
    ['scope: parser; `docs/plans/artifacts/run/test-a9.log:12` (missing) is what the trail cites', 'a path with a line marked missing'],
    ['scope: parser; `./docs/plans/artifacts/run/test-a1.log`', 'a path that starts with ./'],
  ]) {
    const accepted = append(evidence);
    assert.equal(accepted.status, 0, `${why}: ${accepted.stderr}`);
  }
  assert.equal(append('scope: the trail; row 4 cites docs/plans/artifacts/run/test-a9.log, which ls cannot find', 'review-trail').status, 0, 'a hand-off reviewer row reports a missing file');
});

test('decisions-check and plan-open judge rows and boxes since PSTACK_BASE, and refuse a base that names no commit', () => {
  const { dir, run } = sandbox();
  const header = 'ts\tphase\tdecision\twhy\tevidence\tresult';
  const root = project(dir, 'app', { files: { 'log.decisions.tsv': `${header}\n`, 'plan.md': '# Plan\n\nStatus: building\n' } });
  run('git', ['add', '.'], root);
  run('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'intake'], root);
  const base = run('git', ['rev-parse', 'HEAD'], root).stdout.trim();
  writeFileSync(join(root, 'log.decisions.tsv'), `${header}\n2026-09-02T00:00:00Z\tbuild\tfix\twhy\tscope: x; docs/plans/artifacts/run/gone-a1.log\tverified\n`);
  writeFileSync(join(root, 'plan.md'), '# Plan\n\nStatus: building\n\n- [x] tests: `docs/plans/artifacts/run/gone-a1.log`\n');
  run('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qam', 'owner sweep'], root);
  const check = (script, file, env) => spawnSync(process.execPath, [join(HELPERS, script), file], { cwd: root, encoding: 'utf8', env: { ...process.env, ...env } });

  assert.equal(check('decisions-check.mjs', 'log.decisions.tsv', {}).status, 0, 'against HEAD the swept row looks committed');
  assert.match(check('decisions-check.mjs', 'log.decisions.tsv', { PSTACK_BASE: base }).stderr, /gone-a1\.log, which does not exist/);
  assert.match(check('plan-open.mjs', 'plan.md', { PSTACK_BASE: base }).stderr, /gone-a1\.log, which does not exist/);
  assert.equal(check('plan-open.mjs', 'plan.md', { PSTACK_BASE: '0'.repeat(40) }).status, 1, 'an unresolvable base fails closed');
});

test('plan-open refuses a newly closed box whose cited proof is missing or records no exit status', () => {
  const { dir, run } = sandbox();
  const legacy = '# Plan\n\nStatus: building\n\n- [x] old step: `docs/plans/artifacts/run/gone-a1.log`\n';
  const root = project(dir, 'app', {
    files: {
      'plan.md': legacy,
      'docs/plans/artifacts/run/pass-a1.log': '$ (.) node --test\nok\nexit=0\n',
      'docs/plans/artifacts/run/bare-a1.log': 'ok 1 - parser\n',
    },
  });
  run('git', ['add', 'plan.md'], root);
  run('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'plan'], root);
  const check = (lines) => {
    writeFileSync(join(root, 'plan.md'), `${legacy}${lines}`);
    return run(process.execPath, [join(HELPERS, 'plan-open.mjs'), 'plan.md'], root);
  };

  assert.equal(check('- [x] tests pass: `docs/plans/artifacts/run/pass-a1.log`\n').status, 0, 'an existing log that records its exit, and a committed box citing a gone log');
  assert.match(check('- [x] typecheck: `docs/plans/artifacts/run/typecheck-a1.log`\n').stderr, /typecheck-a1\.log, which does not exist/);
  assert.match(check('- [x] lint: `docs/plans/artifacts/run/bare-a1.log`\n').stderr, /bare-a1\.log, which records no exit status/);
  assert.match(check('- [x] tests: `node --test`\n  Log: `docs/plans/artifacts/run/missing-a1.log`\n').stderr, /plan\.md:6: .*missing-a1\.log, which does not exist/, 'a citation on an indented line under the box');
  assert.match(check('- [x] parent: `docs/plans/artifacts/run/missing-a1.log`\n  - [x] child: `docs/plans/artifacts/run/pass-a1.log`\n').stderr, /plan\.md:6: .*missing-a1\.log, which does not exist/, 'a parent box before a nested closed box');
  assert.match(check('- [x] dotted: `./docs/plans/artifacts/run/missing-a1.log`\n').stderr, /missing-a1\.log, which does not exist/, 'a citation that starts with ./');
});

test('plan-open accepts a log with a line that reads exactly exit=<code> and refuses every other exit form', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', { files: { 'plan.md': '# Plan\n\nStatus: building\n' } });
  run('git', ['add', 'plan.md'], root);
  run('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'plan'], root);
  const verdict = (log) => {
    writeFileSync(join(root, 'docs/plans/artifacts/run/x-a1.log'), log);
    writeFileSync(join(root, 'plan.md'), '# Plan\n\nStatus: building\n\n- [x] step: `docs/plans/artifacts/run/x-a1.log`\n');
    return run(process.execPath, [join(HELPERS, 'plan-open.mjs'), 'plan.md'], root).status;
  };
  mkdirSync(join(root, 'docs/plans/artifacts/run'), { recursive: true });

  for (const [log, why] of [
    ['$ (.) missing-command\nexit=ENOENT\n', 'a spawn error'],
    ['$ (wt) sync-pstack.mjs apply\n  write AGENTS.md\nexit=0\nleaked notes: 0\n', 'an exit line mid-file'],
    [`$ (.) node test.mjs\n${'x'.repeat(5000)}\nexit=0\n${'x'.repeat(70_000)}\n`, 'an exit line past the first 64 KB chunk'],
  ]) assert.equal(verdict(log), 0, why);
  for (const [log, why] of [
    ['$ (.) node check.mjs && echo exit=0\npartial output\n', 'exit=0 inside the command line'],
    ['$ (.) node test.mjs\nok 1 - handles exit=0\nprocess crashed\n', 'a test title'],
    ['$ (.) node check.mjs\nexpected exit=0\n', 'an exit named at the end of a sentence'],
    ['$ (.) node check.mjs\nchild exited with code 0\n', 'an exited-with sentence'],
    ['$ node check.mjs\n# exit 1\n', 'a commented exit'],
    ['Ran 1 test across 1 file.\nexit=1 seconds=67\n', 'an exit line with trailing fields'],
    ['> www typecheck\nExit status 1\n', "pnpm's exit status line"],
  ]) assert.equal(verdict(log), 1, why);
});

test('plan-open still makes a closed box under Open work name its owner and its stop', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', { files: { 'plan.md': '# Plan\n\nStatus: building\n' } });
  run('git', ['add', 'plan.md'], root);
  run('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'plan'], root);
  writeFileSync(join(root, 'plan.md'), '# Plan\n\nStatus: building\n\n## Open work\n\n- [x] followed up in `tooling/scripts/proof-worktree.mjs`\n');

  assert.match(run(process.execPath, [join(HELPERS, 'plan-open.mjs'), 'plan.md'], root).stderr, /plan\.md:7: .*name its owner:/);
});

test('proof writes each run to the next attempt log with its command and exit status, under pipefail', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-pstack-proof-'));
  const prove = (...command) => spawnSync(process.execPath, [join(HELPERS, 'proof.mjs'), '--dir', join(dir, 'run'), '--name', 'lint', '--', ...command], { cwd: dir, encoding: 'utf8' });

  const failing = prove('echo found 2 problems; false | cat');
  assert.equal(failing.status, 1, 'pipefail keeps the failure of a piped command');
  assert.match(failing.stdout, /log: .*lint-a1\.log exit=1/);
  const passing = prove(process.execPath, '-e', 'console.log("clean")');
  assert.equal(passing.status, 0, passing.stderr);
  assert.equal(read(dir, 'run/lint-a1.log'), `$ (${realpathSync(dir)}) echo found 2 problems; false | cat\nfound 2 problems\nexit=1\n`);
  assert.match(read(dir, 'run/lint-a2.log'), /^\$ \(.*\) .*-e 'console\.log\("clean"\)'\nclean\nexit=0\n$/);
  assert.match(prove("echo 'héllo—x'").stdout, /^héllo—x\n/u, 'a command line with multibyte text stays out of the output');
});

test('mutate links each workspace node_modules into its worktree', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-pstack-mutate-links-'));
  const repo = join(dir, 'repo');
  spawnSync('git', ['init', '-q', repo]);
  mkdirSync(join(repo, 'pkg/node_modules/dep'), { recursive: true });
  writeFileSync(join(repo, '.gitignore'), 'node_modules\n');
  writeFileSync(join(repo, 'pkg/package.json'), '{ "type": "module" }\n');
  writeFileSync(join(repo, 'pkg/node_modules/dep/package.json'), '{ "type": "module", "main": "index.js" }\n');
  writeFileSync(join(repo, 'pkg/node_modules/dep/index.js'), 'export const base = 10;\n');
  writeFileSync(join(repo, 'pkg/sum.mjs'), "import { base } from 'dep';\nexport const sum = (a) => a + base;\n");
  writeFileSync(
    join(repo, 'pkg/sum.test.mjs'),
    "import assert from 'node:assert/strict';\nimport { mkdirSync, writeFileSync } from 'node:fs';\nimport { test } from 'node:test';\nimport { sum } from './sum.mjs';\nmkdirSync(new URL('./node_modules/.vite', import.meta.url), { recursive: true });\nwriteFileSync(new URL('./node_modules/.vite/written', import.meta.url), 'cache');\ntest('sum adds the base', () => assert.equal(sum(1), 11, 'sum lost its base'));\n",
  );
  spawnSync('git', ['-C', repo, 'add', '-A']);
  commit(repo, 'base');
  const sha = spawnSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  writeFileSync(
    join(dir, 'spec.json'),
    JSON.stringify({ commit: sha, test: [process.execPath, '--test', 'pkg/sum.test.mjs'], mutations: [{ name: 'minus', file: 'pkg/sum.mjs', from: 'a + base', to: 'a - base', expect: 'sum lost its base' }] }),
  );
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT'));
  const result = spawnSync(process.execPath, [join(HELPERS, 'mutate.mjs'), '--dir', join(dir, 'run'), join(dir, 'spec.json')], { cwd: repo, encoding: 'utf8', env });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /minus: caught/);
  assert.equal(existsSync(join(repo, 'pkg/node_modules/dep/index.js')), true, 'removing the worktree keeps the checkout\'s packages');
  assert.equal(existsSync(join(repo, 'pkg/node_modules/.vite/written')), false, 'a test cache stays in the worktree');
});

test('mutate counts a mutation caught only when its named assertion fails, in an export it makes and removes, leaving no worktree', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-pstack-mutate-'));
  const repo = join(dir, 'repo');
  const outside = join(dir, 'outside');
  spawnSync('git', ['init', '-q', repo]);
  mkdirSync(outside);
  const source = 'export const add = (a, b) => a + b;\nexport const zero = 0;\nexport const one = 1;\n';
  writeFileSync(join(outside, 'add.mjs'), source);
  writeFileSync(join(repo, 'add.mjs'), source);
  writeFileSync(
    join(repo, 'add.test.mjs'),
    "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { add, zero } from './add.mjs';\ntest('add sums its arguments', () => assert.equal(add(1, 2), 3, 'add returned the wrong sum'));\ntest('zero starts at zero', () => assert.equal(zero, 0, 'zero moved'));\n",
  );
  symlinkSync(outside, join(repo, 'ext'));
  spawnSync('git', ['-C', repo, 'add', '-A']);
  commit(repo, 'base');
  const sha = spawnSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  const mutate = (mutation) => {
    writeFileSync(join(dir, 'spec.json'), JSON.stringify({ commit: sha, test: [process.execPath, '--test', 'add.test.mjs'], mutations: [mutation] }));
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT'));
    return spawnSync(process.execPath, [join(HELPERS, 'mutate.mjs'), '--dir', join(dir, 'run'), join(dir, 'spec.json')], { cwd: repo, encoding: 'utf8', env });
  };
  const subtract = { name: 'subtract', file: 'add.mjs', from: 'a + b', to: 'a - b', expect: 'add returned the wrong sum' };

  const caught = mutate(subtract);
  assert.equal(caught.status, 0, caught.stdout + caught.stderr);
  assert.match(caught.stdout, /subtract: caught \(exit=1\)/);
  assert.equal(spawnSync('git', ['-C', repo, 'worktree', 'list'], { encoding: 'utf8' }).stdout.trim().split('\n').length, 1, 'the worktree it made is gone');
  assert.equal(read(repo, 'add.mjs'), source, 'the checkout it ran from is untouched');

  assert.match(mutate({ ...subtract, name: 'unused', from: 'zero = 0', to: 'zero = 0 + 0' }).stdout, /unused: survived/);
  assert.match(mutate({ ...subtract, name: 'syntax', to: 'a +' }).stdout, /syntax: failed without the expected text/, 'a crash is not the named failure');
  assert.match(mutate({ ...subtract, name: 'title', from: 'zero = 0', to: 'zero = 2', expect: 'add sums its arguments' }).stdout, /title: not run, its expected text also appears in the passing control run/, 'a passing test title is not a failure');
  assert.match(mutate({ ...subtract, name: 'twice', from: 'export const', to: 'const' }).stdout, /anchor matches 3 times/);
  const escaped = mutate({ ...subtract, name: 'escape', file: 'ext/add.mjs' });
  assert.match(escaped.stdout, /escape: not run, ext\/add\.mjs is outside the export/, 'a mutation through a link out of the export is refused');
  assert.equal(read(outside, 'add.mjs'), source);

  writeFileSync(join(dir, 'spec.json'), JSON.stringify({ commit: '0'.repeat(40), test: [process.execPath, '--test', 'add.test.mjs'], mutations: [subtract] }));
  const failed = spawnSync(process.execPath, [join(HELPERS, 'mutate.mjs'), '--dir', join(dir, 'run'), join(dir, 'spec.json')], { cwd: repo, encoding: 'utf8' });
  assert.match(failed.stderr, /could not export 0{40}/, 'a commit the repository lacks');
});

test('reply copies the final assistant text of a finished subagent and never overwrites', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-pstack-reply-'));
  const record = (id, content, extra = {}) => JSON.stringify({ type: 'assistant', ...extra, message: { id, role: 'assistant', stop_reason: null, ...extra.message, content } });
  const answer = '## Findings\n\n| a | b |\n|---|---|\n| 1 | 2 |';
  const start = [
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'review the plan' } }),
    record('m1', [{ type: 'text', text: 'Reading the plan.' }]),
    record('m1', [{ type: 'tool_use', id: 't1', name: 'Read', input: {} }], { message: { stop_reason: 'tool_use' } }),
    JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'plan text' }] } }),
  ];
  writeFileSync(join(dir, 'done.output'), [...start, record('m2', [{ type: 'thinking', thinking: '' }]), record('m2', [{ type: 'text', text: answer }], { message: { stop_reason: 'end_turn' } })].join('\n'));
  writeFileSync(join(dir, 'interim.output'), [...start, record('m2', [{ type: 'text', text: 'Now checking the log.' }])].join('\n'));
  writeFileSync(join(dir, 'limit.output'), [...start, record('m2', [{ type: 'text', text: "You've hit your weekly limit" }], { isApiErrorMessage: true, message: { model: '<synthetic>', stop_reason: 'stop_sequence' } })].join('\n'));
  const reply = (source, dest) => spawnSync(process.execPath, [join(HELPERS, 'reply.mjs'), join(dir, source), join(dir, dest)], { encoding: 'utf8' });

  const saved = reply('done.output', 'seat/answer.md');
  assert.equal(saved.status, 0, saved.stderr);
  assert.equal(read(dir, 'seat/answer.md'), answer);
  assert.equal(reply('done.output', 'seat/answer.md').status, 1, 'a saved reply is never overwritten');
  assert.match(reply('interim.output', 'interim.md').stderr, /has not finished/, 'text that does not end the turn');
  assert.match(reply('limit.output', 'limit.md').stderr, /API error/, 'an error the runtime wrote for the agent');
  assert.equal(existsSync(join(dir, 'interim.md')) || existsSync(join(dir, 'limit.md')), false);
});

test('reread prints each changed sentence whole against its last snapshot', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-pstack-reread-'));
  const rules = 'Intro line.\n\n- **Delivery.** The user owns commits. Run the last check before handing back, and never push the protected branch without the owner asking for it in this request.\n- Keep plans in the repository.\n\nA repair edits the one owner, fixes every artifact that\nstill teaches the rejected shape, and regenerates\nand proves mirrors. Ask Dr. Smith before a release.\n';
  writeFileSync(join(dir, 'AGENTS.md'), rules);
  const reread = (...args) => spawnSync(process.execPath, [join(HELPERS, 'reread.mjs'), ...args], { cwd: dir, encoding: 'utf8' });
  const edit = (from, to) => writeFileSync(join(dir, 'AGENTS.md'), rules.replace(from, to));

  assert.match(reread('--dir', 'snap', 'AGENTS.md').stdout, /AGENTS\.md: first snapshot; read it in full/);
  assert.match(reread('--dir', 'snap', 'AGENTS.md').stdout, /AGENTS\.md: unchanged since /);
  edit('without the owner asking for it in this request', 'unless the owner asks');
  const changed = reread('--dir', 'snap', 'AGENTS.md').stdout;
  assert.match(changed, /1 sentence\(s\) removed and 1 added/);
  assert.ok(changed.includes('+ Run the last check before handing back, and never push the protected branch unless the owner asks.'), changed);
  assert.doesNotMatch(changed, /owns commits|Keep plans/);
  edit('and proves mirrors', 'but never proves mirrors');
  assert.ok(reread('--dir', 'snap', 'AGENTS.md').stdout.includes('+ A repair edits the one owner, fixes every artifact that still teaches the rejected shape, and regenerates but never proves mirrors.'), 'a hard-wrapped sentence prints whole');
  edit('Dr. Smith', 'Dr. Jones');
  assert.ok(reread('--dir', 'snap', 'AGENTS.md').stdout.includes('+ Ask Dr. Jones before a release.'), 'an abbreviation stays inside its sentence');

  const hook = (source) => spawnSync(process.execPath, [join(HELPERS, 'reread.mjs'), '--hook', 'AGENTS.md', 'missing.md'], { cwd: dir, encoding: 'utf8', input: JSON.stringify({ session_id: `s-${source}`, source }) });
  assert.doesNotMatch(hook('startup').stdout, /AGENTS\.md|missing/, 'a fresh start only seeds the snapshots');
  assert.match(hook('compact').stdout, /AGENTS\.md: first snapshot; read it in full/, 'a compacted session with no snapshot rereads');
  edit('Keep plans in the repository.', 'Keep plans in the repository. Never stash.');
  const after = hook('startup').stdout;
  assert.ok(after.includes('+ Never stash.'), after);
  assert.match(after, /--dir docs\/plans\/artifacts\/reread\/s-startup/);
});
