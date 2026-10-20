import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hintModes, overrideAnchors, render, sharedTemplates, unmarkedRules } from './sync-pstack.mjs';

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
  delete env.PSTACK_BASE;
  const run = (command, args, cwd) => spawnSync(command, args, { cwd, encoding: 'utf8', env });
  return { dir, env, home, run, cli: (...args) => run(process.execPath, [SCRIPT, ...args]) };
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
});

test('an indented line renders onto its rule, and a nested list keeps its own lines', () => {
  const template = ['- **Git.** Check the branch.', '<!-- if protected -->', '  Never edit from `{{protected}}`.', '<!-- end -->', '  The rows:', '  - `pr`: a panel.', '  After the list.'].join('\n');
  assert.equal(render(template, { protected: 'main', skip: [] }), '- **Git.** Check the branch. Never edit from `main`. The rows:\n  - `pr`: a panel.\n  After the list.');
});

test('the shipped block and rule files render cleanly for every delivery', () => {
  for (const [index, template] of sharedTemplates().entries()) {
    for (const [delivery, pushBranches] of [['push', false], ['pr', false], ['user', false], ['user', true]]) {
      for (const reviewList of ['', '  - `pr`: Before opening a PR, the diff gets a panel.']) {
        const rendered = render(template, { ...CONFIG, delivery, pushBranches, reviewList });
        assert.doesNotMatch(rendered, /<!--|\{\{|\}\}/, `template ${index} ${delivery} pushBranches=${pushBranches} reviewList=${Boolean(reviewList)}`);
        assert.doesNotMatch(rendered, /^ {2}[^\s-]/mu, `template ${index} leaves an indented line that reads as a stray sentence`);
      }
    }
  }
});

test('a section marker indented inside a rule file still counts, so skipping that section applies', () => {
  const { dir, run } = sandbox();
  const shared = sharedSource(dir);
  const panel = join(dirname(shared.template), 'pstack/rules/panel.md');
  const before = readFileSync(panel, 'utf8');
  const after = before.replace('<!-- section review -->', '  <!-- section review -->');
  assert.notEqual(after, before);
  writeFileSync(panel, after);
  commit(shared.repo, 'indented marker');
  const root = project(dir, 'app', { config: { ...CONFIG, skip: ['review'] }, agents: '# App\n' });
  assert.equal(run(process.execPath, [shared.script, 'apply', root]).status, 0);
  assert.doesNotMatch(read(root, '.agents/pstack/rules/panel.md'), /\*\*Review\.\*\*/);
});

test('apply refuses a skip entry that no template holds and a pushBranches that grants nothing it says', () => {
  const { dir, cli } = sandbox();
  for (const [name, config, refusal] of [
    ['typo', { ...CONFIG, skip: ['test'] }, /skip names unknown sections: test/],
    ['string', { ...CONFIG, delivery: 'user', pushBranches: 'false' }, /pushBranches must be true or false/],
    ['push', { ...CONFIG, pushBranches: true }, /pushBranches applies only to user delivery/],
    ['effort', { ...CONFIG, maxEffort: 'extreme' }, /maxEffort must be one of low, medium, high, xhigh, max/],
  ]) {
    const result = cli('apply', project(dir, name, { config, agents: '# App\n' }));
    assert.notEqual(result.status, 0, name);
    assert.match(`${result.stdout}${result.stderr}`, refusal, name);
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

test('apply installs every helper and rule file the rendered rules name, whichever sections are skipped', () => {
  const { dir, cli } = sandbox();
  const root = project(dir, 'app', { config: { ...CONFIG, skip: ['tests', 'review', 'plans', 'long-runs', 'commits'] }, agents: '# App\n' });
  assert.equal(cli('apply', root).status, 0);
  const rules = join(root, '.agents/pstack/rules');
  const texts = [read(root, 'AGENTS.md'), ...readdirSync(rules).map((name) => read(root, `.agents/pstack/rules/${name}`))];
  const named = new Set(texts.flatMap((text) => text.match(/\.agents\/pstack\/(?:rules\/)?[\w-]+\.(?:mjs|md)/gu) ?? []));
  assert.ok(named.size > 0);
  for (const path of named) assert.ok(existsSync(join(root, path)), `${path} is named but not installed`);
});

test('apply refuses to write the main checkout of a trunk project whose clone lands through land.mjs, and writes its worktree', () => {
  const { dir, cli } = sandbox();
  const root = project(dir, 'app', { config: { ...CONFIG, delivery: 'trunk' }, agents: '# App\n' });
  const land = (at) => join(at, '.agents/pstack/land.mjs');
  assert.equal(cli('apply', root).status, 0, 'a clone that does not land through land.mjs still syncs in place');
  spawnSync('git', ['-C', root, 'add', '-A']);
  spawnSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init']);
  spawnSync('git', ['-C', root, 'config', 'pstack.delivery', 'push']);
  rmSync(land(root));

  const refused = cli('apply', root);
  assert.equal(refused.status, 1);
  assert.match(refused.stdout, /main checkout of a trunk project, which only pulls; apply in a worktree cut from origin\/next/u);
  assert.ok(!existsSync(land(root)), 'the refused apply writes nothing');
  assert.equal(cli('apply', root, '--dry-run').status, 0, 'a dry run still previews');

  const worktree = join(dir, 'app-task');
  spawnSync('git', ['-C', root, 'worktree', 'add', '-q', '--detach', worktree]);
  assert.equal(cli('apply', worktree).status, 0);
  assert.ok(existsSync(land(worktree)), 'the worktree gets the sync');
});

test('switching delivery to trunk and back swaps the shared-checkout files for the landing ones, and every file the rules name stays installed', () => {
  const { dir, cli } = sandbox();
  const root = project(dir, 'app', { config: CONFIG, agents: '# App\n' });
  const pstack = (name) => join(root, '.agents/pstack', name);
  const sharedCheckout = ['codex-build.md', 'freeze.mjs', 'mutate.mjs', 'reply.mjs', ...['close', 'codex', 'trails'].map((name) => `rules/${name}.md`)];
  const landing = ['guard.mjs', 'land.mjs', 'review.mjs', 'setup.mjs', 'rules/land.md'];
  const everywhere = ['cross.mjs', 'decisions-check.mjs', 'lead.mjs', 'levels.mjs', 'plan-open.mjs', 'plan-page.mjs', 'proof.mjs', 'status.mjs', 'tasks.mjs', 'rules/chips.md', 'rules/panel.md', 'rules/pages.md', 'rules/title.md', 'reread.mjs', 'rules/long-runs.md'];
  const deliver = (delivery) => {
    writeFileSync(join(root, '.agents/pstack.json'), `${JSON.stringify({ ...JSON.parse(read(root, '.agents/pstack.json')), delivery }, null, 2)}\n`);
    assert.equal(cli('apply', root).status, 0);
    const texts = [read(root, 'AGENTS.md'), ...readdirSync(pstack('rules')).map((name) => read(root, `.agents/pstack/rules/${name}`))];
    for (const path of new Set(texts.flatMap((text) => text.match(/\.agents\/pstack\/(?:rules\/)?[\w-]+\.(?:mjs|md)/gu) ?? []))) {
      assert.ok(existsSync(join(root, path)), `${delivery}: ${path} is named but not installed`);
    }
  };
  deliver('push');
  deliver('trunk');
  for (const name of sharedCheckout) assert.ok(!existsSync(pstack(name)), `trunk keeps ${name}`);
  for (const name of [...landing, ...everywhere]) assert.ok(existsSync(pstack(name)), `trunk lacks ${name}`);
  assert.doesNotMatch(read(root, 'AGENTS.md'), /freeze\.mjs|Codex workers|Side work/);
  assert.match(read(root, 'AGENTS.md'), /- \*\*Suggested tasks\.\*\* The `chips` skill/);
  assert.match(read(root, 'AGENTS.md'), /- \*\*Extraction\.\*\* The session's own model/);
  deliver('push');
  for (const name of [...sharedCheckout, ...everywhere]) assert.ok(existsSync(pstack(name)), `push lacks ${name}`);
  for (const name of landing) assert.ok(!existsSync(pstack(name)), `push keeps ${name}`);
});

test('apply renders each rule file with the project config and leaves out the file of a skipped section', () => {
  const { dir, cli } = sandbox();
  const root = project(dir, 'app', { config: { ...CONFIG, plans: 'notes/plans', skip: ['long-runs'] }, agents: '# App\n' });
  assert.equal(cli('apply', root).status, 0);
  const trails = read(root, '.agents/pstack/rules/trails.md');
  assert.match(trails, /notes\/plans\/<date>-<slug>\.md/);
  assert.doesNotMatch(trails, /\{\{|<!--/);
  assert.ok(!existsSync(join(root, '.agents/pstack/rules/long-runs.md')));
});

test('pushBranches lets the lead commit and push every branch but the working one in user delivery', () => {
  const { dir, cli } = sandbox();
  const owner = project(dir, 'owner', { config: { ...CONFIG, delivery: 'user' }, agents: '# App\n' });
  const branches = project(dir, 'branches', { config: { ...CONFIG, delivery: 'user', pushBranches: true }, agents: '# App\n' });
  assert.equal(cli('apply', owner).status, 0);
  assert.equal(cli('apply', branches).status, 0);
  assert.match(read(owner, 'AGENTS.md'), /The repair stays uncommitted there for the owner's commit\./);
  assert.doesNotMatch(read(owner, 'AGENTS.md'), /On every other branch the lead commits and pushes/);
  assert.match(read(branches, 'AGENTS.md'), /On every other branch the lead commits and pushes/);
  assert.match(read(branches, 'AGENTS.md'), /git push origin HEAD:<head branch>/);
  assert.doesNotMatch(read(branches, 'AGENTS.md'), /The repair stays uncommitted there/);
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
    'flags="$1 $2 $3 $4 $5 $6"',
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
  assert.ok(result.stdout.replace(/--session-id [\da-f-]{36} /u, '').includes(`claude in ${root} CLAUDECODE=unset: -p --model opus --add-dir ${home}/.claude/plugins --permission-mode plan -- the toolbar closes`), result.stdout);
  assert.ok(result.stdout.includes(`codex in ${root} with exec --ignore-rules -m gpt-6.1-sol --sandbox read-only: the toolbar closes`), result.stdout);
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
  assert.equal(fromCodex.stdout.trim().replace(/--session-id [\da-f-]{36} /u, ''), 'claude: -p --model opus --settings {"disableAllHooks":true} --permission-mode plan -- Review docs/plans/x.md for gaps.');
  assert.match(fromCodex.stderr, /^seat: opus @default$/mu, 'a seat with no transcript and no --effort says its effort is the default');
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
  assert.match(seat.stdout, /^exec --ignore-user-config --ignore-rules .* -m gpt-6-astra -c model_reasoning_effort=high --disable hooks --sandbox read-only /);
});

test("cross caps a seat's effort at the project's maxEffort, and runs a seat with no effort at the cap", () => {
  const { dir, home } = sandbox();
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'codex'), '#!/bin/sh\nargs="$*"\nwhile [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2 ;; *) shift ;; esac; done\necho "$args" > "$out"\n', { mode: 0o755 });
  const seat = (...args) =>
    spawnSync(process.execPath, [join(HELPERS, 'cross.mjs'), '--to', 'codex', '--model', 'gpt-6.1-sol', ...args, 'review it'], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, CLAUDECODE: '' },
    });
  assert.match(seat('--effort', 'xhigh').stdout, /-c model_reasoning_effort=xhigh /, 'a project with no cap');
  assert.doesNotMatch(seat().stdout, /model_reasoning_effort/, 'no cap and no effort leaves the runtime default');
  mkdirSync(join(dir, '.agents'));
  writeFileSync(join(dir, '.agents/pstack.json'), JSON.stringify({ maxEffort: 'high' }));
  assert.match(seat('--effort', 'xhigh').stdout, /-c model_reasoning_effort=high /);
  assert.match(seat('--effort', 'medium').stdout, /-c model_reasoning_effort=medium /, 'an effort under the cap stays');
  assert.match(seat().stdout, /-c model_reasoning_effort=high /);
});

test('cross --bypass runs a Codex worker on the owner config with hooks and no sandbox, and refuses any other runtime or lane', () => {
  const { dir, home } = sandbox();
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'codex'), '#!/bin/sh\nargs="$*"\nwhile [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2 ;; *) shift ;; esac; done\necho "$args" > "$out"\n', { mode: 0o755 });
  const run = (args) =>
    spawnSync(process.execPath, [join(HELPERS, 'cross.mjs'), ...args, 'research it'], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, CLAUDECODE: '1' },
    });
  const worker = run(['--to', 'codex', '--bypass']);
  assert.equal(worker.status, 0, worker.stderr);
  assert.match(worker.stdout.trim(), /^exec -m gpt-6\.1-sol --dangerously-bypass-approvals-and-sandbox -o \S+ -- research it$/u);
  for (const args of [['--to', 'claude', '--bypass'], ['--to', 'codex', '--bypass', '--ignore-user-config']]) {
    const refused = run(args);
    assert.equal(refused.status, 2, args.join(' '));
    assert.equal(refused.stdout, '', args.join(' '));
    assert.match(refused.stderr, /^--bypass runs only --to codex/u, args.join(' '));
  }
});

test('cross --reach runs a Codex seat on the owner config with network, writing only a scratch folder, and drops an inherited permission profile', () => {
  const { dir, home } = sandbox();
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'codex'), '#!/bin/sh\nargs="$*"\nwhile [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2 ;; *) shift ;; esac; done\nprintf "%s\\ncwd=%s\\nprofile=%s\\n" "$args" "$PWD" "$CODEX_PERMISSION_PROFILE" > "$out"\n', { mode: 0o755 });
  const run = (args) =>
    spawnSync(process.execPath, [join(HELPERS, 'cross.mjs'), ...args, 'review it'], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, CLAUDECODE: '1', CODEX_PERMISSION_PROFILE: ':danger-full-access' },
    });
  const seat = run(['--to', 'codex', '--reach', '--model', 'gpt-6-astra']);
  assert.equal(seat.status, 0, seat.stderr);
  assert.match(seat.stdout, /^exec --ignore-rules --skip-git-repo-check -c web_search="live" -m gpt-6-astra --disable hooks --sandbox workspace-write -c sandbox_workspace_write\.network_access=true -o \S+ -- Your working directory is a scratch folder you may write\. The project is \S+: read it by absolute path and never write it\.\n\nreview it\n\nPut your whole answer in your final message\. Nobody reads the files you write in the scratch folder\.\n/u);
  assert.match(seat.stdout, /^cwd=\S*pstack-reach-\S+$/mu);
  assert.match(seat.stdout, /^profile=$/mu);
  const refused = run(['--to', 'codex', '--reach', '--bypass']);
  assert.equal(refused.status, 2);
  assert.equal(refused.stdout, '');
});

function browserMachine({ profiles = ['Ellie QA'], appVersion = '26.1', stubborn = false } = {}) {
  const { dir, home } = sandbox();
  const chrome = join(home, 'Library/Application Support/Google/Chrome');
  mkdirSync(join(chrome, 'NativeMessagingHosts'), { recursive: true });
  writeFileSync(join(chrome, 'NativeMessagingHosts/com.openai.codexextension.json'), '{}');
  const names = {};
  profiles.forEach((name, index) => {
    mkdirSync(join(chrome, `Profile ${index}`));
    writeFileSync(join(chrome, `Profile ${index}/Secure Preferences`), JSON.stringify({ extensions: { settings: { hehggadaopoacecdllhhajmbjkdcmajg: { disable_reasons: [] } } } }));
    names[`Profile ${index}`] = { name };
  });
  writeFileSync(join(chrome, 'Local State'), JSON.stringify({ profile: { info_cache: names } }));
  const app = join(dir, 'ChatGPT.app');
  mkdirSync(join(app, 'Contents'), { recursive: true });
  writeFileSync(join(app, 'Contents/Info.plist'), `<dict><key>CFBundleShortVersionString</key>\n<string>${appVersion}</string></dict>`);
  const plugin = join(home, '.codex/plugins/cache/openai-bundled/unified-computer-use/26.1');
  mkdirSync(plugin, { recursive: true });
  const env = { BROWSER_USE_CODEX_APP_VERSION: '26.1', SKY_CUA_SERVICE_PATH: '/desktop', NODE_REPL_TRUSTED_SERVICES: '{"browser":"b","sky":"s"}', CUA_REPL_ENABLED_SURFACES: 'browser,computer' };
  writeFileSync(join(plugin, '.mcp.json'), JSON.stringify({ mcpServers: { cua_repl: { command: join(app, 'Contents/Resources/node'), args: ['repl.mjs'], env, enabled_tools: ['js'] } } }));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const launched = join(dir, 'launched.json');
  writeFileSync(
    join(bin, 'codex'),
    `#!${process.execPath}
const fs = require('fs');
const args = process.argv.slice(2);
if (args[0] === 'mcp') {
  const off = args.filter((a) => /^mcp_servers\\.\\w+\\.enabled=false$/.test(a)).map((a) => a.split('.')[1]);
  const names = ['Sentry', 'cua_browser', ...(${stubborn} ? ['stubborn'] : [])];
  console.log(JSON.stringify(names.map((name) => ({ name, enabled: name === 'stubborn' || !off.includes(name) }))));
} else {
  fs.writeFileSync(${JSON.stringify(launched)}, JSON.stringify({ args, cwd: process.cwd() }));
  fs.writeFileSync(args[args.indexOf('-o') + 1], 'done');
  console.log(JSON.stringify({ type: 'turn.completed' }));
}
`,
    { mode: 0o755 },
  );
  const events = join(dir, 'events.jsonl');
  const cross = (extra = []) =>
    spawnSync(process.execPath, [join(HELPERS, 'cross.mjs'), '--to', 'codex', '--computer-use', events, '--chrome-profile', 'Ellie QA', ...extra, 'check tasks'], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, HOME: home, CODEX_HOME: join(home, '.codex'), PATH: `${bin}:${process.env.PATH}`, CLAUDECODE: '1' },
    });
  return { dir, chrome, events, launched, cross };
}

const MAC_ONLY = { skip: process.platform !== 'darwin' && 'the browser lane runs only on macOS' };

test('the browser lane runs Codex on one browser-only server with no desktop service or shell, from an empty folder, and saves its events', MAC_ONLY, () => {
  const machine = browserMachine();
  const run = machine.cross();
  assert.equal(run.status, 0, run.stderr);
  const { args, cwd } = JSON.parse(readFileSync(machine.launched, 'utf8'));
  assert.notEqual(realpathSync(cwd), realpathSync(machine.dir));
  assert.ok(args.includes('mcp_servers.Sentry.enabled=false'), args.join(' '));
  const server = args.find((arg) => arg.startsWith('mcp_servers.cua_browser='));
  assert.match(server, /"NODE_REPL_TRUSTED_SERVICES"="{\\"browser\\":\\"@oai\/browser-desktop\/service\\"}"/);
  assert.match(server, /"CUA_REPL_ENABLED_SURFACES"="browser"/);
  assert.doesNotMatch(server, /SKY_CUA_SERVICE_PATH|"sky"/);
  for (const flag of ['shell_tool', 'unified_exec', 'apps', 'remote_plugin', 'skill_mcp_dependency_install']) assert.ok(args.join(' ').includes(`--disable ${flag}`), flag);
  assert.ok(args.includes('--json') && args.includes('--ignore-rules') && args.join(' ').includes('--sandbox read-only'));
  assert.equal(readFileSync(machine.events, 'utf8').trim(), '{"type":"turn.completed"}');
});

test('the browser lane refuses when Codex extension is not enabled in the named Chrome profile', MAC_ONLY, () => {
  const machine = browserMachine({ profiles: ['Main'] });
  const run = machine.cross();
  assert.equal(run.status, 1);
  assert.match(run.stderr, /not enabled in the "Ellie QA" profile; it is enabled in .*\(Main\)/);
  assert.equal(existsSync(machine.launched), false);
});

test('the browser lane refuses when Codex still lists a server it cannot turn off', MAC_ONLY, () => {
  const machine = browserMachine({ stubborn: true });
  const run = machine.cross();
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Codex still enables cua_browser, stubborn/);
  assert.equal(existsSync(machine.launched), false);
});

test('the browser lane refuses when the cached plugin was built for another app version', MAC_ONLY, () => {
  const machine = browserMachine({ appVersion: '26.2' });
  const run = machine.cross();
  assert.equal(run.status, 1);
  assert.match(run.stderr, /cached computer-use plugin is for app 26\.1, but .* is 26\.2/);
  assert.equal(existsSync(machine.launched), false);
});

function browserRun(steps, { code = 'await tab.getAXState();', text = 'Browser tab: 7, Title: "Ellie", URL: "https://next-ellie.vercel.app/tasks".\n0 heading Tasks', extra = [] } = {}) {
  const meta = { 'codex/toolSurface': { extensionInstanceId: 'e1', openTabIds: ['7'] }, browser_use: { url: 'https://next-ellie.vercel.app/tasks' } };
  const call = (id, callCode, callText) => ({ type: 'item.completed', item: { id, type: 'mcp_tool_call', server: 'cua_browser', arguments: { code: callCode }, result: { content: [{ type: 'text', text: callText }], _meta: meta } } });
  return [call('item_1', code, text), ...extra.map((item, index) => ({ type: 'item.completed', item: { id: `x${index}`, ...item } })), { type: 'item.completed', item: { type: 'agent_message', text: `\`\`\`json\n${JSON.stringify(steps)}\n\`\`\`` } }]
    .map((event) => JSON.stringify(event))
    .join('\n');
}

const checkSteps = (events) => {
  const dir = mkdtempSync(join(tmpdir(), 'cua-steps-'));
  writeFileSync(join(dir, 'events.jsonl'), events);
  const run = spawnSync(process.execPath, [join(HELPERS, 'cua-steps.mjs'), join(dir, 'events.jsonl'), '--host', 'next-ellie.vercel.app'], { encoding: 'utf8' });
  return { status: run.status, steps: JSON.parse(run.stdout) };
};

const TASKS_PASS = [{ step: 1, result: 'PASS', url: 'https://next-ellie.vercel.app/tasks', checked: 'Tasks' }];

test('cua-steps keeps a PASS that a page read backs', () => {
  const { status, steps } = checkSteps(browserRun(TASKS_PASS));
  assert.equal(status, 0, JSON.stringify(steps));
  assert.equal(steps[0].result, 'PASS');
});

test('cua-steps downgrades a PASS backed only by text the run wrote itself', () => {
  const { steps } = checkSteps(browserRun(TASKS_PASS, { code: 'nodeRepl.write(`Tasks heading present: ${ok}`)', text: 'Tasks heading present: false' }));
  assert.equal(steps[0].result, 'UNPROVED');
  assert.match(steps[0].reason, /no page read shows "Tasks"/);
});

test('cua-steps voids every PASS in a run that listed tabs', () => {
  const { steps } = checkSteps(browserRun(TASKS_PASS, { code: 'await cua.listTabs({browser:"chrome"}); await tab.getAXState();' }));
  assert.equal(steps[0].result, 'UNPROVED');
  assert.match(steps[0].reason, /ran forbidden code/);
});

test('cua-steps voids every PASS in a run that ran a shell command', () => {
  const { steps } = checkSteps(browserRun(TASKS_PASS, { extra: [{ type: 'command_execution', command: 'id' }] }));
  assert.equal(steps[0].result, 'UNPROVED');
  assert.match(steps[0].reason, /ran a command_execution item/);
});

test('cua-steps voids every PASS in a run that reached a host outside the list', () => {
  const { steps } = checkSteps(browserRun(TASKS_PASS, { text: 'Browser tab: 7, Title: "QA", URL: "https://qa.example.com/tasks".\n0 heading Tasks' }));
  assert.equal(steps[0].result, 'UNPROVED');
  assert.match(steps[0].reason, /reached qa\.example\.com/);
});

test('cua-steps downgrades a PASS whose URL the runtime never reported', () => {
  const { steps } = checkSteps(browserRun([{ ...TASKS_PASS[0], url: 'https://next-ellie.vercel.app/tasks?search=x' }]));
  assert.equal(steps[0].result, 'UNPROVED');
  assert.match(steps[0].reason, /no page the runtime reported/);
});

test('cross refuses the retired write, events and resume flags before launching Codex', () => {
  const { dir, home } = sandbox();
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const launched = join(dir, 'launched');
  writeFileSync(join(bin, 'codex'), `#!/bin/sh\ntouch ${launched}\nwhile [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2 ;; *) shift ;; esac; done\necho ok > "$out"\n`, { mode: 0o755 });
  const run = (flags) =>
    spawnSync(process.execPath, [join(HELPERS, 'cross.mjs'), '--to', 'codex', ...flags, 'build it'], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, CLAUDECODE: '1' },
    });
  for (const flags of [['--write'], ['--events', join(dir, 'e.jsonl')], ['--resume', 't-1']]) {
    const result = run(flags);
    assert.equal(existsSync(launched), false, `${flags.join(' ')} launched Codex`);
    assert.equal(result.status, 2, flags.join(' '));
    assert.match(result.stderr, /is retired: cross\.mjs runs Codex read-only, or with no sandbox under --bypass/);
  }
  assert.equal(run([]).status, 0, 'the same call without a retired flag launches');
  assert.equal(existsSync(launched), true);
});

test('cross refuses a --timeout over the hour time budget before launching, unless --stress', () => {
  const { dir, home } = sandbox();
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const launched = join(dir, 'launched');
  writeFileSync(join(bin, 'codex'), `#!/bin/sh\ntouch ${launched}\nwhile [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2 ;; *) shift ;; esac; done\necho ok > "$out"\n`, { mode: 0o755 });
  const run = (...flags) =>
    spawnSync(process.execPath, [join(HELPERS, 'cross.mjs'), '--to', 'codex', ...flags, 'build it'], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, CLAUDECODE: '1' },
    });
  const refused = run('--timeout', '3601');
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /--timeout 3601 is over the 3600-second time budget/);
  assert.equal(existsSync(launched), false, 'a refused run launched Codex');
  assert.equal(run('--timeout', '3600').status, 0, 'a run at the budget launches');
  assert.equal(run('--timeout', '3601', '--stress').status, 0, 'a stress run past the budget launches');
  assert.equal(run('--bypass', '--timeout', '21600').status, 0, 'a coding run at its six-hour budget launches');
  const long = run('--bypass', '--timeout', '21601');
  assert.equal(long.status, 2);
  assert.match(long.stderr, /--timeout 21601 is over the 21600-second budget of a --bypass coding run/);
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

test('cross reports why a runtime failed when it prints the reason on stdout', () => {
  const { dir, home } = sandbox();
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'claude'), "#!/bin/sh\necho \"You've hit your weekly limit\"\nexit 1\n", { mode: 0o755 });
  const failed = spawnSync(process.execPath, [join(HELPERS, 'cross.mjs'), '--to', 'claude', 'review it'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, CLAUDECODE: '' },
  });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /^exit 1: You've hit your weekly limit$/mu);
});

test('cross prints its usage for --help and refuses an unknown flag, launching no runtime', () => {
  const { dir, home } = sandbox();
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const launched = join(dir, 'launched');
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\ntouch ${launched}\nfor arg; do last="$arg"; done\necho "prompt=[$last]"\n`, { mode: 0o755 });
  const cross = (args) =>
    spawnSync(process.execPath, [join(HELPERS, 'cross.mjs'), '--to', 'claude', ...args], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, CLAUDECODE: '' },
    });

  for (const flag of ['--help', '-h']) {
    const help = cross([flag]);
    assert.equal(help.status, 0, flag);
    assert.match(help.stdout, /^Usage: node \.agents\/pstack\/cross\.mjs /u, flag);
  }
  for (const flag of ['--modle', '-?', '---model']) {
    const unknown = cross([flag, 'review it']);
    assert.equal(unknown.status, 2, flag);
    assert.ok(unknown.stderr.startsWith(`unknown flag ${flag}\nUsage: node .agents/pstack/cross.mjs `), unknown.stderr);
  }
  const flagAsValue = cross(['--effort', '--modle', 'review it']);
  assert.equal(flagAsValue.status, 2);
  assert.match(flagAsValue.stderr, /^--effort needs a value\nUsage: node \.agents\/pstack\/cross\.mjs /u);
  writeFileSync(join(dir, 'brief.md'), 'review it');
  for (const args of [['--prompt', 'named', 'positional'], ['--prompt', 'named', '--prompt-file', 'brief.md'], ['positional', '--prompt-file', 'brief.md'], ['first', 'second']]) {
    const conflict = cross(args);
    assert.equal(conflict.status, 2, args.join(' '));
    assert.match(conflict.stderr, /^give one prompt: a positional prompt, --prompt or --prompt-file\n/u, args.join(' '));
  }
  const twice = cross(['--prompt', 'a', '--prompt', 'b']);
  assert.equal(twice.status, 2);
  assert.match(twice.stderr, /^--prompt given twice\n/u);
  assert.equal(existsSync(launched), false, 'a help, unknown-flag or flag-as-value call launched a runtime');

  const prompted = cross(['review it']);
  assert.equal(prompted.status, 0, prompted.stderr);
  assert.equal(prompted.stdout.trim(), 'prompt=[review it]');
  const named = cross(['--prompt', 'review it']);
  assert.equal(named.status, 0, named.stderr);
  assert.equal(named.stdout.trim(), 'prompt=[review it]');
  assert.equal(existsSync(launched), true);
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

test("corpus diffs the project's installed ledger helpers against this skill's copies over every managed project", () => {
  const { dir, env, cli } = sandbox();
  const ledger = [
    'ts\tphase\tdecision\twhy\tevidence\tresult',
    '2026-10-01T00:00:00Z\tchip\tt_0a1b2c3d Fix the corpus fixture\tA finding\twrites: src/a.ts; topic: corpus-fixture\toffered',
    '',
  ].join('\n');
  const root = project(dir, 'app', { config: CONFIG, agents: '# App\n', files: { 'docs/plans/suggested-tasks.decisions.tsv': ledger } });
  project(dir, 'bare', { agents: '# Bare\n' });
  assert.equal(cli('apply', root).status, 0);
  spawnSync('git', ['-C', root, 'add', '-A']);
  commit(root, 'app');
  writeFileSync(join(root, 'docs/plans/2026-10-01-x.decisions.tsv'), 'ts\tphase\tdecision\twhy\tevidence\tresult\n2026-10-01T00:00:00Z\tbuild\tA decision\tA reason\tsome evidence\tmaybe\n');
  spawnSync('git', ['-C', root, 'add', '-A']);
  commit(root, 'log');
  const installed = join(root, '.agents/pstack/decisions-check.mjs');
  cpSync(join(root, '.agents/pstack'), join(dir, 'baseline'), { recursive: true });

  const same = spawnSync(process.execPath, [SCRIPT, 'corpus', root, '--out', join(dir, 'same')], { encoding: 'utf8', env: { ...env, PSTACK_BASE: 'HEAD' } });
  assert.equal(same.status, 0, same.stderr);
  assert.match(same.stdout, /^\S+\/app\n {2}no difference$/m);
  assert.match(read(join(dir, 'same'), 'corpus-app-bundled.txt'), /2026-10-01-x\.decisions\.tsv/);

  writeFileSync(installed, "console.log('old', process.argv.slice(2).join(' '), process.cwd());\nif (process.argv[2] === '--all') throw new Error('boom');\n");
  const out = join(dir, 'out');
  const changed = cli('corpus', '--root', dir, '--session', 'local_1', '--out', out);
  assert.equal(changed.status, 0, changed.stderr);
  assert.doesNotMatch(changed.stdout, /bare/);
  assert.match(changed.stdout, /^ {2}-old chips --session local_1 <snapshot>\/suggested-tasks\.decisions\.tsv \S+\/app$/m);
  assert.match(changed.stdout, /^ {2}-old chips stale <snapshot>\/suggested-tasks\.decisions\.tsv \S+\/app$/m);
  assert.match(changed.stdout, /^ {2}\+\s+t_0a1b2c3d {2}Fix the corpus fixture/m);
  const old = read(out, 'corpus-app-installed.txt');
  assert.match(old, /file:\/\/<helpers>\/decisions-check\.mjs:2/);
  assert.equal(old.includes(installed), false);
  assert.equal(read(out, 'corpus-app-bundled.txt').includes('\nold '), false);

  assert.match(cli('corpus', root, '--installed', join(dir, 'baseline')).stdout, /^\S+\/app\n {2}no difference$/m);

  rmSync(installed);
  assert.match(cli('corpus', root).stdout, /^ {2}-absent$/m);
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
  spawnSync('git', ['-C', managed, 'add', '-A']);
  commit(managed, 'managed');
  spawnSync('git', ['-C', managed, 'worktree', 'add', '-q', '--detach', join(repos, 'managed-proof')]);
  assert.ok(existsSync(join(repos, 'managed-proof/.agents/pstack.json')));
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
  assert.match(result.stdout, /\.agents\/rules\/b\.mdc:\d+ ~ rules\/tests\.md:\d+: Every test must fail/);
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
  writeFileSync(join(root, 'AGENTS.md'), read(root, 'AGENTS.md').replace('allow two informed attempts or ten minutes', 'allow three informed attempts or ten minutes'));

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

test('plan-open reads past a comment opener inside a code span', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', { files: { 'plan.md': '# Plan\n\nA note opens with `<!--` and ``a `<!--` b``.\n\n- [ ] ship it\n' } });
  const result = run(process.execPath, [join(HELPERS, 'plan-open.mjs'), 'plan.md'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^1 open item\(s\):\nplan\.md:5: - \[ \] ship it$/m);
});

test('plan-open treats a fence inside a comment as part of the comment', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', { files: { 'plan.md': '# Plan\n\n<!--\n```\n- [ ] example\n-->\n\n- [ ] ship it\n' } });
  const result = run(process.execPath, [join(HELPERS, 'plan-open.mjs'), 'plan.md'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^1 open item\(s\):\nplan\.md:8: - \[ \] ship it$/m);
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

test('plan-page renders a topic plan as its subject page, led by that plan, and names both files', () => {
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
  assert.ok(text.includes('Plan Second pass') && text.includes('Keep the old pages?'), 'the rendered iteration leads with its question');
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

test("plan-page counts each seat's rounds in the header and lists every round at the bottom by priority", () => {
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
  const header = html.slice(html.indexOf('<header'), html.indexOf('</header>')).replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ');
  assert.match(header, /Reviews opus ×2 gpt-6-astra high gpt-6\.1-sol xhigh missing /, 'a seat counts its rounds, and a missing seat says so');
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
    'waiting:Verify',
    'done:Audit show-me-your-work',
    'left:Ship',
    'left:Reflect',
  ]);
});

const railStates = (run, root, plan) => {
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), plan, '--rail'], root);
  assert.equal(result.status, 0, result.stderr);
  return Object.fromEntries(JSON.parse(result.stdout).stages.map(({ label, state }) => [label, state]));
};
const phaseLog = (phases) => `${['ts\tphase\tdecision\twhy\tevidence\tresult', ...phases.map((phase) => reviewRow(phase, phase === 'panel' ? 'seats opus' : 'Step', 'decided'))].join('\n')}\n`;

test("plan-page's rail marks the newest work row's stage as the current one", () => {
  const { dir, run } = sandbox();
  const railOf = (name, status, phases) => {
    const files = { 'docs/plans/plan.md': `# Plan\n\nStatus: ${status}\n\n## Main changes\n\n- Draw the rail.\n${brief()}`, 'docs/plans/plan.decisions.tsv': phaseLog(phases) };
    return railStates(run, project(dir, name, { files }), 'docs/plans/plan.md');
  };
  const building = railOf('building', 'building', ['build']);
  assert.deepEqual([building.Build, building.Writing], ['now', 'left'], 'a page published mid-build shows Build as current');
  const back = railOf('back', 'building', ['build', 'verify', 'panel', 'build']);
  assert.deepEqual([back.Build, back.Writing, back['Code review'], back.Verify], ['now', 'left', 'done', 'done'], 'a run back in Build after review stays in Build');
  const planned = railOf('planned', 'waiting for the owner', ['plan']);
  assert.deepEqual([planned.Plan, planned.Design], ['waiting', 'left'], 'a plan waiting on the owner waits at Plan');
  const reviewed = railOf('reviewed', 'building: phase 1 next', ['panel', 'trail', 'plan', 'owner']);
  assert.deepEqual([reviewed['Plan review'], reviewed.Audit, reviewed.Ship], ['now', 'done', 'left'], 'audit and stageless rows leave the current stage at the last work row');
  assert.equal(railOf('prose', 'planning', ['architect', 'writing']).Design, 'now', 'a prose pass on the plan before any build leaves the rail at Design');
  assert.equal(railOf('audited', 'building', ['trail']).Plan, 'now', 'a log with no work row sits at Plan');
});

test("plan-page keeps the leading plan's current stage on a rail that folds in the plans it carries", () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', {
    files: {
      'docs/plans/pr.md': `# PR\n\nStatus: building\nPlans: a.md\n\n## Main changes\n\n- Carry a plan.\n${brief()}`,
      'docs/plans/pr.decisions.tsv': phaseLog(['build']),
      'docs/plans/a.md': '# A\n\nStatus: executed\n\n## Main changes\n\n- One.\n',
      'docs/plans/a.decisions.tsv': phaseLog(['build', 'verify']),
    },
  });
  const states = railStates(run, root, 'docs/plans/pr.md');
  assert.deepEqual([states.Build, states.Verify], ['now', 'done']);
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
  assert.equal(rail.stages.find(({ label }) => label === 'Build').state, 'now');
});

test('plan-page --rail reports the rail of the plan it is given, not a newer open iteration', () => {
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
  assert.deepEqual([rail.requestedPlan, rail.status, rail.page], ['docs/plans/2026-01-01-first.md', 'executed', 'https://claude.ai/artifact/topic']);
  assert.equal(rail.stages.find(({ label }) => label === 'Ship').state, 'done', 'the executed plan shows its own shipped rail');
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
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-02-01-later.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const page = read(root, 'docs/plans/artifacts/topics/workflow.html');
  assert.match(page.slice(page.indexOf('<header'), page.indexOf('</header>')).replace(/<[^>]+>/gu, ''), /Review round 1.*Seat Codex/su);
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

test('plan-page leads a subject page with the plan it renders, under an older open plan that waits on the owner', () => {
  const { dir, run } = sandbox();
  const topic = '# Workflow\n\n## Main changes\n\n- Pages follow subjects.\n';
  const waiting = '# Waiting\n\nStatus: planning, waiting for Build now\nTopic: workflow\n\n## Open questions\n\n' + MEMO + brief([['What will change?', 'The waiting plan changes.'], ['What could go wrong?', 'The waiting plan breaks.']]);
  const built = '# Built\n\nStatus: executed\nTopic: workflow\n\n' + brief([['What will change?', 'The built plan landed.'], ['What could go wrong?', 'The built plan regresses.']]) + '## Main changes\n\n- Moved the renderer.\n\n## Close\n\n- Landed the renderer move.\n';
  const root = project(dir, 'app', { files: { 'docs/plans/topics/workflow.md': topic, 'docs/plans/2026-01-01-waiting.md': waiting, 'docs/plans/2026-02-01-built.md': built } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-02-01-built.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const text = read(root, 'docs/plans/artifacts/topics/workflow.html').replace(/<[^>]+>/gu, '');
  assert.ok(text.includes('Plan Built') && text.includes('The built plan landed.'), 'the handed-back plan leads its page');
  assert.ok(!text.includes('The waiting plan changes.'), 'the older open plan does not take over the brief');
  assert.match(text, /Build the memo now\?[\s\S]*?from[\s\S]*?Waiting/, 'the older plan still asks its question under its own name');
});

test('plan-page names the plan it renders in the header of a subject page without a brief', () => {
  const { dir, run } = sandbox();
  const topic = '# Workflow\n\n## Main changes\n\n- Pages follow subjects.\n';
  const waiting = '# Waiting\n\nStatus: planning, waiting for Build now\nTopic: workflow\n\n## Open questions\n\n' + MEMO + brief();
  const built = '# Built\n\nStatus: executed\nTopic: workflow\n\n## Main changes\n\n- Moved the renderer.\n\n## Close\n\n- Landed the renderer move.\n';
  const root = project(dir, 'app', { files: { 'docs/plans/topics/workflow.md': topic, 'docs/plans/2026-01-01-waiting.md': waiting, 'docs/plans/2026-02-01-built.md': built } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-02-01-built.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const html = read(root, 'docs/plans/artifacts/topics/workflow.html');
  const header = html.slice(html.indexOf('<header'), html.indexOf('</header>')).replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ');
  assert.match(header, /Executed .*Plan Built/u, 'the header names the executed plan and its status');
  assert.ok(html.replace(/<[^>]+>/gu, '').includes('Landed the renderer move.'), 'the page shows that plan\'s Close');
});

test("plan-page keeps another plan's unheaded question beside the rendered plan's structured one", () => {
  const { dir, run } = sandbox();
  const topic = '# Workflow\n\n## Main changes\n\n- Pages follow subjects.\n';
  const built = '# Built\n\nStatus: executed\nTopic: workflow\n\n' + brief() + '## Open questions\n\n' + MEMO + '\n## Close\n\n- Landed the renderer move.\n';
  const waiting = '# Waiting\n\nStatus: planning, waiting for the owner\nTopic: workflow\n\n## Open questions\n\n- Keep the old pages?\n';
  const root = project(dir, 'app', { files: { 'docs/plans/topics/workflow.md': topic, 'docs/plans/2026-01-01-built.md': built, 'docs/plans/2026-02-01-waiting.md': waiting } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-built.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const text = read(root, 'docs/plans/artifacts/topics/workflow.html').replace(/<[^>]+>/gu, '');
  assert.match(text, /from Waiting[\s\S]*?Keep the old pages\?/u, "the newer plan's question shows under its name");
});

test("plan-page lists another plan's unheaded question after the rendered plan's question cards", () => {
  const { dir, run } = sandbox();
  const topic = '# Workflow\n\n## Main changes\n\n- Pages follow subjects.\n';
  const built = '# Built\n\nStatus: executed\nTopic: workflow\n\n' + brief() + '## Open questions\n\n' + MEMO + '\n## Close\n\n- Landed the renderer move.\n';
  const waiting = '# Waiting\n\nStatus: planning, waiting for the owner\nTopic: workflow\n\n## Open questions\n\n- Keep the old pages?\n';
  const root = project(dir, 'app', { files: { 'docs/plans/topics/workflow.md': topic, 'docs/plans/2026-01-01-built.md': built, 'docs/plans/2026-02-01-waiting.md': waiting } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-built.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const text = read(root, 'docs/plans/artifacts/topics/workflow.html').replace(/<[^>]+>/gu, '');
  assert.ok(text.indexOf('Build the memo now?') < text.indexOf('Keep the old pages?'), "the rendered plan's question comes before the other plan's");
});

test('plan-page shows the Status of another open plan that waits on the owner without an Open questions section', () => {
  const { dir, run } = sandbox();
  const topic = '# Workflow\n\n## Main changes\n\n- Pages follow subjects.\n';
  const held = '# Held\n\nStatus: waiting: built, uncommitted until you say push\nTopic: workflow\n\n## Main changes\n\n- Moved the rail.\n';
  const shipped = '# Shipped\n\nStatus: executed: waiting on your commit\nTopic: workflow\n\n## Main changes\n\n- Moved the index.\n';
  const built = '# Built\n\nStatus: executed\nTopic: workflow\n\n' + brief() + '## Main changes\n\n- Moved the renderer.\n\n## Close\n\n- Landed the renderer move.\n';
  const files = { 'docs/plans/topics/workflow.md': topic, 'docs/plans/2026-01-01-held.md': held, 'docs/plans/2026-01-15-shipped.md': shipped, 'docs/plans/2026-02-01-built.md': built };
  const root = project(dir, 'app', { files });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-02-01-built.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const html = read(root, 'docs/plans/artifacts/topics/workflow.html');
  const start = html.indexOf('<section class="needs"');
  assert.ok(start >= 0, 'the page has a Needs you section');
  const needs = html.slice(start, html.indexOf('</section>', start)).replace(/<[^>]+>/gu, '');
  assert.match(needs, /from Held[\s\S]*?until you say push/u, "the held plan's Status shows under its name");
  assert.ok(!needs.includes('waiting on your commit'), "a finished plan's Status stays off Needs you");
});

test("plan-page names the plan of another plan's unheaded question when no question on the page has a heading", () => {
  const { dir, run } = sandbox();
  const topic = '# Workflow\n\n## Main changes\n\n- Pages follow subjects.\n';
  const built = '# Built\n\nStatus: executed\nTopic: workflow\n\n## Main changes\n\n- Moved the renderer.\n';
  const waiting = '# Waiting\n\nStatus: planning, waiting for the owner\nTopic: workflow\n\n## Open questions\n\n- Keep the old pages?\n';
  const root = project(dir, 'app', { files: { 'docs/plans/topics/workflow.md': topic, 'docs/plans/2026-01-01-built.md': built, 'docs/plans/2026-02-01-waiting.md': waiting } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-built.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const html = read(root, 'docs/plans/artifacts/topics/workflow.html');
  const needs = html.slice(html.indexOf('<section class="needs"'), html.indexOf('</section>', html.indexOf('<section class="needs"'))).replace(/<[^>]+>/gu, '');
  assert.match(needs, /from Waiting[\s\S]*?Keep the old pages\?/u, "the newer plan's question shows under its name");
});

test('plan-page shows the Demo, Teach and picks of an executed plan it renders on a subject page without a brief', () => {
  const { dir, run } = sandbox();
  const topic = '# Workflow\n\n## Main changes\n\n- Pages follow subjects.\n';
  const built = '# Built\n\nStatus: executed\nTopic: workflow\n\n## Main changes\n\n- Moved the renderer.\n\n## Demo\n\n1. Open the subject page. The built plan leads.\n\n## Teach\n\nA subject page is led by the plan it renders.\n\n## Defaults\n\n| Decision | Pick | Alternative | Word | Impact |\n| --- | --- | --- | --- | --- |\n| Page lead | The rendered plan | The newest open plan | newest lead | small |\n\n## Close\n\n- Landed the renderer move.\n';
  const waiting = '# Waiting\n\nStatus: planning, waiting for Build now\nTopic: workflow\n\n## Open questions\n\n' + MEMO + brief();
  const root = project(dir, 'app', { files: { 'docs/plans/topics/workflow.md': topic, 'docs/plans/2026-01-01-waiting.md': waiting, 'docs/plans/2026-02-01-built.md': built } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-02-01-built.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const text = read(root, 'docs/plans/artifacts/topics/workflow.html').replace(/<[^>]+>/gu, '');
  const missing = ['The built plan leads.', 'A subject page is led by the plan it renders.', 'The rendered plan'].filter((line) => !text.includes(line));
  assert.deepEqual(missing, [], "the page shows the rendered plan's Demo, Teach and picks");
});

test('plan-page shows both Open questions sections of an open plan under Needs you on every page layout', () => {
  const topic = '# Workflow\n\n## Main changes\n\n- Pages follow subjects.\n';
  const second = MEMO.replace('### Build', '### Ship').replace('Build the memo now?', 'Ship the memo today?');
  const waiting = '# Waiting\n\nStatus: planning, waiting for Build now\nTopic: workflow\n\n## Open questions\n\n' + MEMO + brief() + '## Open questions\n\n' + second;
  const built = (head) => `# Built\n\nStatus: executed\nTopic: workflow\n\n${head}## Main changes\n\n- Moved the renderer.\n`;
  const cases = [
    ['an executed plan without a brief', built(''), 'docs/plans/2026-02-01-built.md'],
    ['an executed plan with a brief', built(brief()), 'docs/plans/2026-02-01-built.md'],
    ['the open plan itself', built(''), 'docs/plans/2026-01-01-waiting.md'],
  ];
  const missing = cases.flatMap(([name, plan, rendered]) => {
    const { dir, run } = sandbox();
    const root = project(dir, 'app', { files: { 'docs/plans/topics/workflow.md': topic, 'docs/plans/2026-01-01-waiting.md': waiting, 'docs/plans/2026-02-01-built.md': plan } });
    const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), rendered], root);
    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
    const html = read(root, 'docs/plans/artifacts/topics/workflow.html');
    const start = html.indexOf('<section class="needs"');
    const needs = start < 0 ? '' : html.slice(start, html.indexOf('</section>', start)).replace(/<[^>]+>/gu, '');
    return ['Build the memo now?', 'Ship the memo today?'].filter((question) => !needs.includes(question)).map((question) => `${name}: ${question}`);
  });
  assert.deepEqual(missing, [], 'Needs you shows each Open questions section');
});

test("plan-page refuses a malformed question in a plan's second Open questions section", () => {
  const { dir, run } = sandbox();
  const plan = '# Plan\n\nStatus: planning, waiting for Build now\n\n## Open questions\n\n' + MEMO + brief() + '## Open questions\n\n### Ship\n\nShip it?\n';
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /"Ship" in docs\/plans\/plan\.md needs/u);
});

test("plan-page keeps an unheaded question in a later Open questions section out of the memo above it", () => {
  const { dir, run } = sandbox();
  const legacy = 'Keep the backup?\n\n- **Retain** (recommended): Keep it. Cost: Disk space.\n- **Drop**: Delete it. Cost: No way back.\n';
  const plan = '# Built\n\nStatus: executed\n\n## Main changes\n\n- Moved the renderer.\n\n## Open questions\n\n' + MEMO + '\n## Open questions\n\n' + legacy;
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const html = read(root, 'docs/plans/artifacts/plan.html');
  const cards = html.split('<article class="q"').slice(1);
  assert.deepEqual(cards.filter((card) => card.includes('Build now') && card.includes('Retain')), [], "the backup's options stay out of the Build memo");
  assert.match(html.replace(/<[^>]+>/gu, ''), /Keep the backup\?/u, 'the unheaded question still shows under Needs you');
});

test("plan-page refuses code in a plan's second Open questions section", () => {
  const { dir, run } = sandbox();
  const second = MEMO.replace('### Build', '### Ship').replace('Build the memo now?', 'Ship `main` now?');
  const plan = '# Plan\n\nStatus: planning, waiting for Build now\n\n## Open questions\n\n' + MEMO + brief() + '## Open questions\n\n' + second;
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /## Open questions in docs\/plans\/plan\.md holds code `main`/u);
});

test("plan-page refuses a plan's second Defaults section without its table", () => {
  const { dir, run } = sandbox();
  const plan = `# Plan\n\nStatus: planning\n\n${brief()}## Defaults\n\n| Decision | Pick | Alternative | Word |\n| --- | --- | --- | --- |\n| Page look | One line per choice. | The old table | keep table |\n\n## Defaults\n\n- Keep the old pages.\n`;
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /## Defaults in docs\/plans\/plan\.md needs a table whose columns start with Decision/u);
});

test('plan-page --index leads a subject page with its older open plan over a newer executed one', () => {
  const { dir, run } = sandbox();
  const topic = '# Workflow\n\n## Main changes\n\n- Pages follow subjects.\n';
  const waiting = '# Waiting\n\nStatus: planning, waiting for Build now\nTopic: workflow\n\n## Open questions\n\n' + MEMO + brief();
  const built = '# Built\n\nStatus: executed\nTopic: workflow\n\n## Main changes\n\n- Moved the renderer.\n';
  const root = project(dir, 'app', { files: { 'docs/plans/topics/workflow.md': topic, 'docs/plans/2026-01-01-waiting.md': waiting, 'docs/plans/2026-02-01-built.md': built } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), '--index'], root);
  assert.equal(result.status, 0, result.stderr);
  const html = read(root, 'docs/plans/artifacts/topics/workflow.html');
  const header = html.slice(html.indexOf('<header'), html.indexOf('</header>')).replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ');
  assert.match(header, /Plan Waiting/u, 'the index leads with the open plan');
});

test("plan-page accepts a hub's required section from the open plan it renders while a newer open plan lacks it", () => {
  const { dir, run } = sandbox();
  const files = {
    '.agents/playbooks/bug-fix.md': playbook(''),
    '.agents/playbooks/plan.md': playbook('page-require: What other editors do\n'),
    'docs/hubs/dnd.md': '# Drag and drop\n',
    'docs/plans/topics/dnd.md': '# Drag and drop\n\n## Main changes\n\n- One transfer action.\n',
    'docs/plans/2026-01-01-transfer.md': '# Transfer\n\nStatus: planning\nTopic: dnd\nPlaybook: plan\n\n' + brief() + '## What other editors do\n\n- Lexical keeps drag in the view.\n',
    'docs/plans/2026-02-01-fix.md': '# Fix\n\nStatus: planning\nTopic: dnd\nPlaybook: bug-fix\n',
  };
  const root = project(dir, 'app', { config: { pageTopic: { hub: 'docs/hubs/{topic}.md' } }, files });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-transfer.md'], root);
  assert.equal(result.status, 0, result.stderr);
});

test("plan-page refuses a hub's required section that only an open plan off the page holds", () => {
  const { dir, run } = sandbox();
  const files = {
    '.agents/playbooks/plan.md': playbook('page-require: What other editors do\n'),
    'docs/hubs/dnd.md': '# Drag and drop\n',
    'docs/plans/topics/dnd.md': '# Drag and drop\n\n## Main changes\n\n- One transfer action.\n',
    'docs/plans/2026-01-01-transfer.md': '# Transfer\n\nStatus: planning\nTopic: dnd\nPlaybook: plan\n\n' + brief() + '## What other editors do\n\n- Lexical keeps drag in the view.\n',
    'docs/plans/2026-02-01-drop.md': '# Drop\n\nStatus: planning\nTopic: dnd\nPlaybook: plan\n\n' + brief(),
  };
  const root = project(dir, 'app', { config: { pageTopic: { hub: 'docs/hubs/{topic}.md' } }, files });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-02-01-drop.md'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /needs ## What other editors do in docs\/plans\/topics\/dnd\.md or docs\/plans\/2026-02-01-drop\.md/u);
});

test("plan-page refuses a hub's required section that only an executed plan without a brief holds", () => {
  const { dir, run } = sandbox();
  const files = {
    '.agents/playbooks/plan.md': playbook('page-lead: What other editors do\npage-require: What other editors do\n'),
    'docs/hubs/dnd.md': '# Drag and drop\n',
    'docs/plans/topics/dnd.md': '# Drag and drop\n\n## Main changes\n\n- One transfer action.\n',
    'docs/plans/2026-02-01-built.md': '# Built\n\nStatus: executed\nTopic: dnd\nPlaybook: plan\n\n## Main changes\n\n- One transfer action.\n\n## What other editors do\n\n- Lexical keeps drag in the view.\n',
  };
  const root = project(dir, 'app', { config: { pageTopic: { hub: 'docs/hubs/{topic}.md' } }, files });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-02-01-built.md'], root);
  assert.equal(result.status, 1, 'the page without a brief shows only the subject file');
  assert.match(result.stderr, /needs ## What other editors do in docs\/plans\/topics\/dnd\.md, the sources its page shows/u);
});

test('plan-page lists a hand-off review row whose phase starts with a capital', () => {
  const { dir, run } = sandbox();
  const plan = '# Plan\n\nStatus: executed\n\n## Main changes\n\n- Seat Codex.\n';
  const log = ['ts\tphase\tdecision\twhy\tevidence\tresult', reviewRow('panel', 'seats opus', 'recorded'), reviewRow('Review-trail', 'warning The trail cites a missing log', 'recorded')].join('\n');
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan, 'docs/plans/plan.decisions.tsv': `${log}\n` } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(read(root, 'docs/plans/artifacts/plan.html').includes('The trail cites a missing log'));
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

test('plan-page shows Teach as How it works right after the brief and before the open questions', () => {
  const { dir, run } = sandbox();
  const plan = `# Plan\n\nStatus: planning\n\n${brief()}## Teach\n\nA page is the one place the owner reads.\n\n## Open questions\n\n${MEMO}\n## Main changes\n\n- Moves the owner.\n`;
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const html = read(root, 'docs/plans/artifacts/plan.html');
  assert.ok(html.includes('<h2>How it works</h2>'), 'Teach shows under its page title');
  assert.ok(html.indexOf('Old plans need a brief.') < html.indexOf('A page is the one place the owner reads.'), 'Teach follows the brief');
  assert.ok(html.indexOf('A page is the one place the owner reads.') < html.indexOf('Build the memo now?'), 'Teach comes before the open questions');
});

test('plan-page shows each Defaults row as its decision over the pick in bold and the alternative marked (alt), with the word that switches it', () => {
  const { dir, run } = sandbox();
  const plan = `# Plan\n\nStatus: planning\n\n${brief()}## Defaults\n\n| Decision | Pick | Alternative | Word |\n| --- | --- | --- | --- |\n| Page look | One line per choice. | The old table | keep table |\n`;
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const html = read(root, 'docs/plans/artifacts/plan.html');
  assert.ok(html.includes('<li>Page look<ul><li><strong>One line per choice</strong></li><li class="alt">The old table (alt) · say <code>keep table</code></li></ul></li>'));
  assert.ok(!html.includes('<th>Decision</th>'), 'the table no longer shows');
});

test('plan-page groups Defaults rows under Big calls, Small calls and Details when the table has an Impact column', () => {
  const { dir, run } = sandbox();
  const plan = `# Plan\n\nStatus: planning\n\n${brief()}## Defaults\n\n| Decision | Pick | Alternative | Word | Impact |\n| --- | --- | --- | --- | --- |\n| Button color | Blue | Green | green | detail |\n| Storage | One file | A database | database | big |\n| Sort order | Newest first | Oldest first | oldest | small |\n`;
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const picked = read(root, 'docs/plans/artifacts/plan.html').split('<h2>Picked for you</h2>')[1];
  assert.match(picked, /^<h3>Big calls<\/h3><ul class="picks"><li>Storage<ul>.*?<h3>Small calls<\/h3><ul class="picks"><li>Sort order<ul>.*?<h3>Details<\/h3><ul class="picks"><li>Button color<ul>/);
});

test('plan-page refuses an open plan whose Defaults impact is not big, small or detail', () => {
  const { dir, run } = sandbox();
  const plan = `# Plan\n\nStatus: planning\n\n${brief()}## Defaults\n\n| Decision | Pick | Alternative | Word | Impact |\n| --- | --- | --- | --- | --- |\n| Storage | One file | A database | database | high |\n`;
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md', '--check'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /## Defaults in .* gives "Storage" the impact "high"; write big, small or detail/);
});

test('plan-page shows a Teach picture inline, with one viewer for the whole page', () => {
  const { dir, run } = sandbox();
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg>';
  const plan = `# Plan\n\nStatus: planning\n\n${brief()}## Demo\n\n1. Open the page. ![after](after.svg)\n\n## Teach\n\nA page is the one place the owner reads.\n\n![before](before.svg) ![after](after.svg)\n`;
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan, 'docs/plans/before.svg': svg, 'docs/plans/after.svg': svg } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const html = read(root, 'docs/plans/artifacts/plan.html');
  const teach = html.slice(html.indexOf('<h2>How it works</h2>'), html.indexOf('</section>', html.indexOf('<h2>How it works</h2>')));
  assert.match(teach, /<div class="shots"><figure class="shot"><img src="data:image\/svg\+xml;base64,[^"]+" alt="Before"><figcaption>Before<\/figcaption><\/figure><figure class="shot"><img src="data:image\/svg\+xml;base64,/);
  assert.equal(html.split('<dialog class="lightbox">').length - 1, 1, 'Demo and Teach share one viewer');
});

test('plan-page refuses an open plan whose Teach runs past three paragraphs', () => {
  const { dir, run } = sandbox();
  const plan = `# Plan\n\nStatus: planning\n\n${brief()}## Teach\n\nOne.\n\nTwo.\n\nThree.\n\nFour.\n`;
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md', '--check'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /## Teach in .* runs 4 paragraphs and 4 words, where 3 paragraphs and 160 words are the most/);
});

test('plan-page refuses an open plan whose Teach runs past 160 words in three paragraphs', () => {
  const { dir, run } = sandbox();
  const paragraph = (words) => Array.from({ length: words }, () => 'word').join(' ');
  const plan = `# Plan\n\nStatus: planning\n\n${brief()}## Teach\n\n${paragraph(60)}\n\n${paragraph(60)}\n\n${paragraph(41)}\n`;
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md', '--check'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /## Teach in .* runs 3 paragraphs and 161 words/);
});

test('plan-page refuses an open plan whose Teach puts a picture inside a sentence', () => {
  const { dir, run } = sandbox();
  const plan = `# Plan\n\nStatus: planning\n\n${brief()}## Teach\n\nThe page looks like this ![after](after.svg) now.\n`;
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md', '--check'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /## Teach in .* puts a picture inside a sentence/);
});

test('plan-page refuses an open plan whose Teach holds a code block', () => {
  const { dir, run } = sandbox();
  const plan = `# Plan\n\nStatus: planning\n\n${brief()}## Teach\n\nIt draws the page.\n\n\`\`\`js\nrender(page);\n\`\`\`\n`;
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md', '--check'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /## Teach in .* holds code \`\`\`js/);
});

test('plan-page refuses an open plan whose Teach holds code', () => {
  const { dir, run } = sandbox();
  const plan = `# Plan\n\nStatus: planning\n\n${brief()}## Teach\n\nThe \`renderPage\` function draws it.\n`;
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md', '--check'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /## Teach in .* holds code `renderPage`/);
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

test('plan-page refuses an open plan that leads its page without a brief, and renders executed plans and plans it does not lead without one', () => {
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
  const result = render(subject, 'docs/plans/2026-02-01-newer.md');
  assert.equal(result.status, 0, result.stderr);
  const leading = render(subject, 'docs/plans/2026-01-01-older.md');
  assert.equal(leading.status, 1, 'the older open plan owes a brief once it leads its own render');
  assert.match(leading.stderr, /docs\/plans\/2026-01-01-older\.md leads its page while open, so it needs a ## Brief/);
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
  const header = read(root, 'docs/plans/artifacts/plan.html').match(/<header[\s\S]*?<\/header>/u)?.[0] ?? '';
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
  assert.ok(!html.slice(html.indexOf('<header'), html.indexOf('</header>')).includes('Review round'), 'the header names no other plan\'s round');
});

test('plan-page --index leads a subject page with the same-day iteration whose log moved last', () => {
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
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), '--index'], root);
  assert.equal(result.status, 0, result.stderr);
  const page = read(root, 'docs/plans/artifacts/topics/workflow.html');
  assert.ok(page.includes('Closed alpha') && !page.includes('Closed beta'), 'the iteration whose log moved last leads');
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

test('plan-page --index leads a subject page with the dated open iteration over an undated issue plan', () => {
  const { dir, run } = sandbox();
  const root = deltaProject(dir, DELTA_TOPIC, DELTA_PLAN);
  writeFileSync(join(root, 'docs/plans/4731-old-issue.md'), '# Old issue\n\nStatus: planning\nTopic: drag\n\n## Main changes\n\n- Old work.\n' + brief());
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), '--index'], root);
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

test('plan-open reads a closed box artifact from a line indented directly under it', () => {
  const { dir, run } = sandbox();
  const legacy = '# Plan\n\nStatus: In progress.\n\n- [x] shipped long ago\n';
  const root = project(dir, 'app', { files: { 'plan.md': legacy } });
  run('git', ['add', '.'], root);
  run('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'plan'], root);

  writeFileSync(join(root, 'plan.md'), `${legacy}- [x] step one\n  Closed by \`scripts/check.mjs\`.\n- [x] step two\n\n  Closed by \`scripts/other.mjs\`.\n`);
  const result = run(process.execPath, [join(HELPERS, 'plan-open.mjs'), 'plan.md'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /plan\.md:8: .*step two \(name the artifact/);
  assert.doesNotMatch(result.stderr, /plan\.md:6:/);
});

test('plan-open does not let a closed box borrow a nested box artifact', () => {
  const { dir, run } = sandbox();
  const legacy = '# Plan\n\nStatus: In progress.\n\n';
  const root = project(dir, 'app', { files: { 'plan.md': legacy } });
  run('git', ['add', '.'], root);
  run('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'plan'], root);

  writeFileSync(join(root, 'plan.md'), `${legacy}- [x] finish A\n  - [x] finish B \`scripts/b.mjs\`\n`);
  const result = run(process.execPath, [join(HELPERS, 'plan-open.mjs'), 'plan.md'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /plan\.md:5: .*finish A \(name the artifact/);
  assert.doesNotMatch(result.stderr, /plan\.md:6:/);
});

test('plan-open does not take a closing artifact from an indented line committed before the box closed', () => {
  const { dir, run } = sandbox();
  const before = '# Plan\n\nStatus: In progress.\n\n- [ ] step one\n  Proof: `pnpm test x`\n';
  const root = project(dir, 'app', { files: { 'plan.md': before } });
  run('git', ['add', '.'], root);
  run('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'plan'], root);

  writeFileSync(join(root, 'plan.md'), before.replace('- [ ] step one', '- [x] step one'));
  const result = run(process.execPath, [join(HELPERS, 'plan-open.mjs'), 'plan.md'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /plan\.md:5: .*step one \(name the artifact/);
});

test('plan-open makes a closed Open work box name its owner and stop when its artifact is on an indented line', () => {
  const { dir, run } = sandbox();
  const legacy = '# Plan\n\nStatus: In progress.\n\n## Open work\n\n';
  const root = project(dir, 'app', { files: { 'plan.md': legacy } });
  run('git', ['add', '.'], root);
  run('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'plan'], root);

  writeFileSync(join(root, 'plan.md'), `${legacy}- [x] ledger merge\n  Closed by \`scripts/merge.mjs\`.\n- [x] schema check, owner: zbeyens\n  Closed by \`scripts/check.mjs\`, stop: 2026-11-08.\n`);
  const result = run(process.execPath, [join(HELPERS, 'plan-open.mjs'), 'plan.md'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /plan\.md:7: .*ledger merge \(name its owner:/);
  assert.doesNotMatch(result.stderr, /plan\.md:9:/);
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
  assert.match(lines.find((line) => line.split('\t')[1] === 'fix'), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\tfix\trepair the parser\t/);
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
  const append = (decision, result) => run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'append', 'log.decisions.tsv', 'panel', decision, 'why', 'the seat\'s probe; proof: none', result], root);
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

const chipLedger = () => {
  const { dir, env, run } = sandbox();
  const root = project(dir, 'app', { files: { 'docs/plans/.keep': '', '.agents/pstack.json': JSON.stringify({ branch: 'next' }) } });
  spawnSync('git', ['-C', root, 'remote', 'add', 'origin', join(dir, 'origin.git')]);
  const LEDGER = 'docs/plans/suggested-tasks.decisions.tsv';
  const helper = (...args) => run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), ...args], root);
  const appendTo = (log, phase, decision, evidence, result) => helper('append', log, phase, decision, 'why', evidence, result);
  // A new offer must name its priority, so the helpers give each offer that names
  // none a P1 bug's evidence, keeping every test's task listed in full on the board.
  const tagged = (result, evidence) => (/^offered\b/u.test(result) && !/(?:^|[\s;])priority:/u.test(evidence) ? `${evidence}; priority: P1; repro: steps` : evidence);
  const chip = (decision, result, evidence = 'evidence') => appendTo(LEDGER, 'chip', decision, tagged(result, evidence), result);
  const offer = (decision, writes = 'README.md', more = 'topic: docs') => chip(decision, 'offered', `writes: ${writes}; ${more}`);
  const batch = (rows) => {
    writeFileSync(join(root, 'batch.tsv'), rows.map(([decision, result, evidence = 'evidence']) => ['chip', decision, 'why', tagged(result, evidence), result].join('\t')).join('\n') + '\n');
    return helper('append', LEDGER, '--from', 'batch.tsv');
  };
  const chips = (...args) => helper('chips', ...args);
  const merge = (subject) => {
    spawnSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', subject]);
    spawnSync('git', ['-C', root, 'update-ref', 'refs/remotes/origin/next', 'HEAD']);
  };
  const outside = (name) => join(dir, 'shared', name);
  return { LEDGER, appendTo, batch, chip, chips, dir, env, helper, merge, offer, outside, root, run };
};

test('decisions-check keeps chip rows in the project ledger, out of run logs', () => {
  const { appendTo, offer } = chipLedger();
  const misplaced = appendTo('docs/plans/2026-01-01-fix.decisions.tsv', 'chip', 'task_a1 Fix the stale badge', 'writes: README.md; topic: docs', 'offered');
  assert.equal(misplaced.status, 1, 'a chip row in a run log');
  assert.match(misplaced.stderr, /chip rows go in the project's ledger docs\/plans\/suggested-tasks\.decisions\.tsv/);
  assert.equal(offer('task_a1 Fix the stale badge').status, 0);
});

test('decisions-check leaves the chip rows an older run log holds to that log', () => {
  const { root, run } = chipLedger();
  const log = 'docs/plans/2026-01-01-fix.decisions.tsv';
  const rows = [
    ['chip', 'task_a1 Now: Fix the stale badge', 'why', 'writes: the README badge', 'offered'],
    ['chip', 'task_a1 Now: Fix the stale badge', 'why', 'retitled as After', 'dismissed retagged task_b2'],
  ];
  writeFileSync(join(root, log), `ts\tphase\tdecision\twhy\tevidence\tresult\n${rows.map((row) => ['2026-01-01T10:00:00Z', ...row].join('\t')).join('\n')}\n`);
  const checked = run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), log], root);
  assert.equal(checked.status, 0, checked.stderr);
});

test('decisions-check takes a chip offer only with a plain title, a topic and the paths it writes', () => {
  const { LEDGER, appendTo, chip, helper, offer } = chipLedger();
  assert.equal(offer('task_a1').status, 1, 'an id with no title');
  for (const tagged of ['task_a1 Now: Fix the stale badge', 'task_a1 After: Fix the stale badge', 'task_a1 [P1] Fix the stale badge', 'task_a1 Fix the stale badge (high)']) {
    assert.match(offer(tagged).stderr, /no title says Now: or After:/, tagged);
  }
  assert.match(offer('task_a1 Fix the stale badge', 'README.md', 'the badge links a dead page').stderr, /names its owner question as "topic: <word>"/, 'an offer with no topic');
  assert.match(offer('task_a1 Fix the stale badge', 'README.md', 'topic: Docs Pages').stderr, /lowercase kebab-case/, 'a topic that is not one kebab-case word');
  assert.match(offer('task_a1 Fix the stale badge', 'README.md', 'topic: docs; waits: after the release').stderr, /waits: takes pr:<number>, task:<id> or run:/, 'a wait written as prose');
  const unscoped = chip('task_a1 Fix the stale badge', 'offered', 'topic: docs');
  assert.equal(unscoped.status, 1, 'an offer with no write set');
  assert.match(unscoped.stderr, /writes: <path>, <path>/);
  assert.match(offer('task_a1 Fix the stale badge', 'the README badge').stderr, /writes: <path>, <path>/, 'a write set that is not paths');
  assert.equal(offer('task_a1 Fix the stale badge', 'README.md', 'topic: docs; waits: pr:12, task:task_z9, run:docs/plans/x.md; kind: fix').status, 0);
  assert.match(offer('task_a1 Fix the stale badge').stderr, /already offered/, 'an id offered twice');
  assert.match(appendTo(LEDGER, 'build', 'ship the parser', 'scope: fixtures', 'offered').stderr, /only in a chip row/, 'an offered result outside a chip row');
  assert.equal(helper(LEDGER).status, 0);
});

test('decisions-check takes a new chip finding only when this checkout holds the evidence it cites', () => {
  const { LEDGER, helper, root } = chipLedger();
  const log = 'docs/plans/artifacts/probe/base-a1.log';
  const offerCiting = (finding) => helper('append', LEDGER, 'chip', 'task_a1 Fix the stale badge', finding, 'writes: README.md; topic: docs; priority: P3', 'offered');
  const missing = offerCiting(`the badge links a dead page (${log})`);
  assert.equal(missing.status, 1, 'an offer citing a log only another worktree holds');
  assert.match(missing.stderr, /the finding cites docs\/plans\/artifacts\/probe\/base-a1\.log, which this checkout lacks/);
  mkdirSync(join(root, 'docs/plans/artifacts/probe'), { recursive: true });
  writeFileSync(join(root, log), 'exit=1\n');
  assert.equal(offerCiting(`the badge links a dead page (${log})`).status, 0, 'an offer citing a log the checkout holds');
  const fold = (finding) => helper('append', LEDGER, 'chip', 'task_a1 Fix the stale badge', finding, 'kind: decide; effort: xhigh', 'folded');
  assert.match(fold('the footer badge fails too (docs/plans/artifacts/probe/footer-a1.log)').stderr, /cites docs\/plans\/artifacts\/probe\/footer-a1\.log, which this checkout lacks/, 'a folded finding citing a missing log');
  assert.equal(fold('the footer badge fails too').status, 0, 'a folded finding that cites no file');
  rmSync(join(root, log));
  assert.equal(helper(LEDGER).status, 0, 'the whole-log check leaves an older offer whose evidence went missing');
});

test('chips brief forces the Codex handoff for a card carded with codex: always or a project that sets it', () => {
  const { LEDGER, chip, helper, offer, root } = chipLedger();
  const forced = /forces the Codex handoff/;
  assert.equal(offer('task_a1 Fix the stale badge').status, 0);
  assert.doesNotMatch(helper('chips', 'brief', 'task_a1').stdout, forced, 'a task with no card');
  assert.match(chip('task_a1 Fix the stale badge', 'carded', 'card: task_c1; session: s1; codex: sometimes').stderr, /codex: is always/, 'a mark other than always');
  assert.equal(chip('task_a1 Fix the stale badge', 'carded', 'card: task_c1; session: s1; codex: always').status, 0);
  assert.match(helper('chips', 'brief', 'task_a1').stdout, forced, 'a card carded with codex: always');
  assert.equal(chip('task_a1 Fix the stale badge', 'uncarded', 'card: task_c1').status, 0);
  assert.doesNotMatch(helper('chips', 'brief', 'task_a1').stdout, forced, 'the mark leaves with its card');
  writeFileSync(join(root, '.agents/pstack.json'), JSON.stringify({ branch: 'next', chips: { codex: 'always' } }));
  assert.match(helper('chips', 'brief', 'task_a1').stdout, forced, 'a project whose config sets chips.codex');
  assert.equal(helper(LEDGER).status, 0);
});

const linkedWorktree = (delivery) => {
  const context = chipLedger();
  const { LEDGER, dir, root, run } = context;
  writeFileSync(join(root, '.agents/pstack.json'), JSON.stringify({ branch: 'next', delivery }));
  writeFileSync(join(root, LEDGER), 'ts\tphase\tdecision\twhy\tevidence\tresult\n');
  spawnSync('git', ['-C', root, 'add', '-A']);
  commit(root, 'base');
  const worktree = join(dir, 'wt');
  spawnSync('git', ['-C', root, 'worktree', 'add', '-q', '--detach', worktree]);
  const helper = (...args) => run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), ...args], worktree);
  const offerHere = (decision, evidence) => helper('append', LEDGER, 'chip', decision, 'why', `${evidence}; priority: P1; repro: steps`, 'offered');
  return { ...context, helper, offerHere, worktree };
};

test('in a trunk project a linked worktree writes the main checkout ledger, cites its run directory and briefs a card to land through land.mjs', () => {
  const { LEDGER, dir, helper, offerHere, outside, root, worktree } = linkedWorktree('trunk');
  const offered = offerHere('task_a1 Fix the stale badge', 'writes: README.md; topic: docs; owns: ci:new');
  assert.equal(offered.status, 0, offered.stderr);
  assert.match(read(root, LEDGER), /task_a1 Fix the stale badge/, 'the row goes to the main checkout ledger');
  assert.doesNotMatch(read(worktree, LEDGER), /task_a1/, "the worktree's committed copy stays as it was");
  assert.match(helper('chips').stdout, /task_a1 {2}Fix the stale badge/, 'the board reads the main checkout ledger');
  const log = 'docs/plans/2026-01-01-fix.decisions.tsv';
  const red = helper('append', log, 'verify', 'Record the base failure', 'why', 'base-red: ci:new; proof: none', 'partial, fails on base');
  assert.equal(red.status, 0, `a base-red row finds the owner in the main checkout ledger: ${red.stderr}`);
  const brief = helper('chips', 'brief', 'task_a1').stdout;
  assert.match(brief, /land the task yourself from it with node \.agents\/pstack\/land\.mjs/);
  assert.match(brief, /scan\.mjs --landed <your worktree's absolute path>\. When it exits 0/, 'the landed scan guards the worktree removal');
  assert.match(brief, /holds the change\. Then title your session 👀 <name>, with no count, as [^\n]*\/\.agents\/pstack\/rules\/title\.md says[^\n]*\. Last, stop each server/, 'a landed card session takes the review title before its cleanup');
  assert.doesNotMatch(brief, /git diff --cached|apply --check|\/wt\b|cd \/|outside the checkout/, 'no patch landing, checkout cd, worktree path or outside-path wait');
  mkdirSync(join(root, 'docs/plans/artifacts/fix'), { recursive: true });
  writeFileSync(join(root, 'docs/plans/artifacts/fix/send-a1.log'), 'exit=0\n');
  const cited = helper('append', log, 'verify', 'Prove the send', 'why', 'proof: docs/plans/artifacts/fix/send-a1.log', 'partial, one width ran');
  assert.equal(cited.status, 0, cited.stderr);
  assert.ok(existsSync(join(worktree, log)), 'a run log stays in the worktree');
  const missing = helper('append', log, 'verify', 'Prove the reply', 'why', 'proof: docs/plans/artifacts/fix/reply-a1.log', 'partial, no run');
  assert.equal(missing.status, 1, 'a path neither checkout holds');
  writeFileSync(join(root, 'docs/plans/artifacts/fix/open-a1.log'), 'exit=1\n');
  writeFileSync(join(worktree, 'docs/plans/2026-01-01-fix.md'), '# Fix\n\nStatus: building\n\n## Defaults\n\n| Decision | Pick | Alternative | Word | Impact |\n| --- | --- | --- | --- | --- |\n| A | B | C | hold | small |\n');
  const accepted = helper('append', log, 'verify', 'Accept the gap', 'why', 'proof: docs/plans/artifacts/fix/open-a1.log; word: hold', 'accepted');
  assert.match(accepted.stderr, /open-a1\.log has no labeled partial, open, gap, blocked or inconclusive row before this one/, 'a main checkout proof still needs its earlier verdict');
  mkdirSync(join(dir, 'replay'), { recursive: true });
  assert.equal(helper('append', join(dir, 'replay', 'suggested-tasks.decisions.tsv'), 'trail', 'Inspect the replay', 'why', 'proof: none', 'recorded').status, 0);
  assert.match(read(dir, 'replay/suggested-tasks.decisions.tsv'), /Inspect the replay/, 'an explicit log path keeps its destination');
  assert.doesNotMatch(read(root, LEDGER), /Inspect the replay/);
  for (const [decision, topic] of [['task_b2 Edit the shared notes', 'notes-a'], ['task_c3 Rewrite the shared notes', 'notes-b']]) assert.equal(offerHere(decision, `writes: ${outside('notes.md')}; topic: ${topic}`).status, 0);
  assert.equal(offerHere('task_d4 Follow the fix', 'writes: docs/guide.md; topic: follow; waits: run:docs/plans/2026-01-01-fix.md').status, 0);
  assert.equal(offerHere('task_e5 Follow a typo', 'writes: docs/typo.md; topic: typo; waits: run:docs/plans/2026-01-01-nope.md').status, 0);
  const board = helper('chips').stdout;
  assert.doesNotMatch(board, /queued behind|outside this checkout/, 'trunk drops the waits on paths outside the checkout');
  assert.match(board, /run:docs\/plans\/2026-01-01-fix\.md not landed/, 'a plan only a worktree holds has not landed');
  assert.match(board, /run:docs\/plans\/2026-01-01-nope\.md dangling, no such plan/);
  writeFileSync(join(root, 'docs/plans/2026-01-01-fix.md'), '# Fix\n\nStatus: done\n');
  spawnSync('git', ['-C', root, 'add', 'docs/plans/2026-01-01-fix.md']);
  commit(root, 'land the fix');
  spawnSync('git', ['-C', root, 'update-ref', 'refs/remotes/origin/next', 'HEAD']);
  assert.doesNotMatch(helper('chips').stdout, /2026-01-01-fix\.md/, "the wait clears once origin's branch holds the done plan");
});

test('outside trunk delivery a linked worktree keeps its own ledger and the waits on paths outside the checkout', () => {
  const { LEDGER, helper, offerHere, outside, root, worktree } = linkedWorktree('push');
  assert.equal(offerHere('task_a1 Fix the stale badge', 'writes: README.md; topic: docs').status, 0);
  assert.match(read(worktree, LEDGER), /task_a1/, 'the row goes to the ledger of the checkout the command runs in');
  assert.doesNotMatch(read(root, LEDGER), /task_a1/);
  for (const [decision, topic] of [['task_b2 Edit the shared notes', 'notes-a'], ['task_c3 Rewrite the shared notes', 'notes-b']]) assert.equal(offerHere(decision, `writes: ${outside('notes.md')}; topic: ${topic}`).status, 0);
  assert.match(helper('chips').stdout, /queued behind task_b2/);
});

test('decisions-check takes later rows for a task offered under an old-form title', () => {
  const { LEDGER, chip, root } = chipLedger();
  const old = 'task_a1 After: Fix the stale badge (high)';
  writeFileSync(join(root, LEDGER), `ts\tphase\tdecision\twhy\tevidence\tresult\n${['2026-01-01T10:00:00Z', 'chip', old, 'why', 'writes: README.md', 'offered'].join('\t')}\n`);
  assert.match(chip(old, 'updated', 'topic: docs').stderr, /task_a1 has no topic yet, so this row migrates it/, 'a migration row without its waits');
  assert.equal(chip(old, 'updated', 'topic: docs; waits: none').status, 0, 'a migration row');
  const started = chip(old, 'started');
  assert.equal(started.status, 0, started.stderr);
  assert.equal(chip(old, 'landed').status, 0);
});

test('decisions-check keeps a task under one id: no new gone or replaced rows', () => {
  const { LEDGER, chip, chips, offer, root } = chipLedger();
  assert.equal(offer('task_a1 Fix the stale badge').status, 0);
  assert.equal(offer('task_c3 Rewrite the install guide', 'docs/install.md').status, 0);
  for (const reason of ['gone', 'replaced task_c3']) {
    assert.match(chip('task_a1 Fix the stale badge', `dismissed ${reason}`).stderr, /a task keeps its id for good: log uncarded/, `a new dismissed ${reason} row`);
  }
  assert.equal(chip('task_a1 Fix the stale badge', 'uncarded').status, 0, 'a card that left the queue');
  assert.match(chips().stdout, /Ready, P1 \(2\)\n {2}task_a1 {2}Fix the stale badge {2}\[docs\] {2}no card/, 'the task stays open and ready after its card left');
  const old = 'task_b2 Fix the release notes';
  writeFileSync(join(root, LEDGER), `${readFileSync(join(root, LEDGER), 'utf8')}${[['offered', 'writes: CHANGES.md; topic: docs; priority: P1; repro: steps'], ['dismissed gone', 'the queue pushed it out']].map(([result, evidence]) => ['2026-01-01T10:00:00Z', 'chip', old, 'why', evidence, result].join('\t')).join('\n')}\n`);
  spawnSync('git', ['-C', root, 'add', LEDGER]);
  spawnSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'ledger']);
  const reopened = chip(old, 'reopened');
  assert.equal(reopened.status, 0, `a task an older run closed as gone comes back: ${reopened.stderr}`);
  assert.match(chips().stdout, /task_b2 {2}Fix the release notes/);
  assert.match(chip('task_a1 Fix the stale badge', 'reopened').stderr, /task_a1 is offered, so it cannot be reopened/, 'only a gone task reopens');
  assert.equal(chip('task_c3 Rewrite the install guide', 'dismissed declined: the owner dismissed its card').status, 0, 'a card the owner dismissed closes its task');
  assert.doesNotMatch(chips().stdout, /task_c3/);
  assert.match(chip('task_c3 Rewrite the install guide', 'reopened').stderr, /task_c3 is dismissed declined, so it cannot be reopened/, 'a declined task stays closed');
});

test('decisions-check takes a later chip row only for a task in the state it leaves, and a dup only of a live task', () => {
  const { chip, offer } = chipLedger();
  assert.equal(offer('task_a1 Fix the stale badge').status, 0);
  assert.equal(offer('task_c3 Rewrite the install guide', 'docs/install.md').status, 0);
  assert.equal(chip('task_a1 Fix the stale badge', 'dismissed').status, 1, 'a dismissal with no reason');
  assert.equal(chip('task_a1 Fix the stale badge', 'dismissed later').status, 1, 'a reason outside the list');
  assert.match(chip('task_z9 Fix the stale badge', 'dismissed done').stderr, /task_z9 has no offered chip row/, 'a task never offered');
  assert.equal(chip('task_a1 Fix the stale badge', 'dismissed dup task_q7').status, 1, 'a duplicate of a task never offered');
  assert.match(chip('task_a1 Fix the stale badge', 'dismissed dup task_a1').stderr, /task_a1 must be another task/, 'a duplicate of itself');
  assert.match(chip('task_a1 Fix the badge', 'dismissed done').stderr, /every later row repeats that decision/, 'a later row that renames the task');
  assert.match(chip('task_a1 Fix the stale badge', 'updated', 'because').stderr, /names what changes/, 'an update that changes nothing');
  assert.equal(chip('task_a1 Fix the stale badge', 'dismissed dup task_c3: the guide rewrite fixes the badge too').status, 0);
  assert.match(chip('task_a1 Fix the stale badge', 'started').stderr, /task_a1 is dismissed dup, so it cannot be started/, 'a closed task that starts');
  assert.match(chip('task_c3 Rewrite the install guide', 'dismissed dup task_a1').stderr, /task_a1 must be another task the ledger holds as offered;/, 'a duplicate of a closed task');
});

test('decisions-check closes a started task by landing or by a dismissal that fits a started task', () => {
  const { chip, offer } = chipLedger();
  const badge = 'task_a1 Fix the stale badge';
  assert.equal(offer(badge).status, 0);
  assert.equal(chip(badge, 'started').status, 0);
  assert.equal(chip(badge, 'dismissed done').status, 1, 'done for a started task, which lands instead');
  assert.match(chip(badge, 'uncarded').stderr, /task_a1 is started, so it cannot be uncarded/, 'a card row for a task the owner started');
  assert.equal(chip(badge, 'dismissed stopped: the owner closed the session').status, 0);
  const ledger = 'task_b2 Design the export ledger (xhigh)';
  assert.equal(offer(ledger, 'src/export', 'topic: export; kind: decide').status, 0);
  assert.match(chip(ledger, 'dismissed stopped').stderr, /task_b2 is offered, so it cannot be dismissed stopped/, 'stopped for a task nobody started');
  assert.equal(chip(ledger, 'started').status, 0);
  for (const reason of ['superseded', 'dup task_a1', 'done']) {
    assert.match(chip(ledger, `dismissed ${reason}`).stderr, /task_b2 is started, so it cannot be dismissed/, `${reason} for a task whose session may still be writing`);
  }
  assert.equal(offer('task_e5 Add a CSV export', 'src/export/csv.ts').status, 0);
  assert.match(chip('task_e5 Add a CSV export', 'dismissed dup task_b2').stderr, /task_b2 is started, and a dup moves work only into an offered task; keep task_e5 open, log updated with its waits plus task:task_b2, and log dismissed done once task_b2 lands with the fix/, 'an offered task a started task covers');
  assert.equal(chip('task_e5 Add a CSV export', 'updated', 'waits: task:task_b2').status, 0, 'the route the refusal names');
});

test('a started row may add a project path another started task writes, but not a path outside the checkout', () => {
  const { chip, offer, outside } = chipLedger();
  const reader = 'task_a1 Fix the reader';
  const writer = 'task_b2 Fix the writer';
  assert.equal(offer(reader, `src/a.ts, ${outside('rule.md')}`).status, 0);
  assert.equal(offer(writer, 'src/b.ts').status, 0);
  assert.equal(chip(reader, 'started').status, 0);
  assert.equal(chip(writer, 'started').status, 0);
  assert.equal(chip(writer, 'started', 'writes: src/a.ts').status, 0, 'each card session edits project paths in its own worktree');
  assert.match(chip(writer, 'started', `writes: ${outside('rule.md')}`).stderr, /task_b2 cannot add a path outside this checkout that task_a1, also started, writes/, "a widening into another repository a running session edits in place");
  assert.equal(chip(writer, 'started', `writes: ${outside('other.md')}`).status, 0, 'a widening onto a free outside path');
});

test('decisions-check refuses a write path that is a glob, quoted or ends in punctuation', () => {
  const { offer } = chipLedger();
  for (const path of ['packages/*/src', 'src/**', '`docs/x.md`', 'README.md.', '"docs/x.md"']) {
    assert.match(offer('task_a1 Fix the stale badge', path).stderr, /no whitespace, glob, quote/, path);
  }
});

test('chips names the open tasks that share a ready task\'s paths, compared by where they point, and holds back only a path outside the checkout', () => {
  const { chips, offer, outside, root } = chipLedger();
  mkdirSync(join(root, 'deep/dir'), { recursive: true });
  writeFileSync(join(root, 'deep/x.txt'), 'deep');
  writeFileSync(join(root, 'x.txt'), 'top');
  symlinkSync(join(root, 'deep/dir'), join(root, 'link'));
  assert.equal(offer('task_a1 Fix the stale badge').status, 0);
  assert.equal(offer('task_a2 Fix the deep file', 'deep/x.txt').status, 0);
  const aliases = ['./README.md', 'docs/../README.md', join(root, 'README.md'), 'readme.md', 'link/../x.txt'];
  for (const [index, alias] of aliases.entries()) assert.equal(offer(`task_b${index} Rewrite the file`, alias).status, 0, alias);
  assert.equal(offer('task_c1 Fix the top file', 'x.txt').status, 0);
  const board = chips().stdout;
  assert.match(board, /Ready, P1 \(8\)/, 'a shared project path holds no task back');
  for (const index of aliases.keys()) assert.match(board, new RegExp(`task_b${index} {2}Rewrite the file {2}\\[docs\\] {2}no card {2}shares paths with [^\\n]*task_a[12]`), aliases[index]);
  assert.match(board, /task_b4 {2}Rewrite the file {2}\[docs\] {2}no card {2}shares paths with task_a2\n/, 'the kernel follows link before .. steps out of it');
  assert.match(board, /task_c1 {2}Fix the top file {2}\[docs\] {2}no card\n/, 'the top-level file is another file than deep/x.txt');
  assert.match(board, /card task_b0: it can start and has no card; first judge whether it needs the result of another open task, starting with task_a1, task_b1, task_b2, task_b3, which write its paths, or of an open design question/);
  assert.equal(offer('task_d1 Fix the shared rule', outside('rule.md')).status, 0);
  assert.equal(offer('task_d2 Reword the shared rule', outside('../shared/rule.md')).status, 0);
  assert.match(chips().stdout, /task_d2 {2}Reword the shared rule {2}\[docs\] {2}waits on queued behind task_d1, which writes the same paths outside this checkout/, 'another repository is edited in place');
});

test('chips clears each kind of wait without a new row: a merged PR, a closed task, a done plan', () => {
  const { chip, chips, merge, offer, root } = chipLedger();
  merge('Merge pull request #12 from a/badge');
  merge('Fix the parser (#14)');
  writeFileSync(join(root, 'docs/plans/2026-01-01-pivot.md'), '# Pivot\n\nStatus: building: the ledger\n');
  assert.equal(offer('task_a1 Fix the stale badge', 'README.md', 'topic: docs; waits: pr:12').status, 0);
  assert.equal(offer('task_a2 Fix the parser', 'src/p.ts', 'topic: parser; waits: pr:14').status, 0);
  assert.equal(offer('task_a3 Fix the printer', 'src/q.ts', 'topic: parser; waits: pr:140').status, 0);
  assert.equal(offer('task_b1 Fix the guide', 'docs/guide.md', 'topic: docs; waits: task:task_a1').status, 0);
  assert.equal(offer('task_c1 Fix the lexer', 'src/l.ts', 'topic: lexer; waits: run:docs/plans/2026-01-01-pivot.md').status, 0);
  assert.equal(offer('task_d1 Fix the linter', 'src/n.ts', 'topic: lint; waits: task:task_z9').status, 0);
  let board = chips();
  assert.match(board.stdout, /task_a1 {2}Fix the stale badge {2}\[docs\] {2}no card/, 'a merge commit for its PR');
  assert.match(board.stdout, /task_a2 {2}Fix the parser {2}\[parser\] {2}no card/, 'a squash commit for its PR');
  assert.match(board.stdout, /task_a3 {2}Fix the printer {2}\[parser\] {2}waits on pr:140 not merged/, '#14 is not #140');
  assert.match(board.stdout, /task_b1 {2}Fix the guide {2}\[docs\] {2}waits on task:task_a1 offered/);
  assert.match(board.stdout, /task_c1 {2}Fix the lexer {2}\[lexer\] {2}waits on run:docs\/plans\/2026-01-01-pivot\.md active/);
  assert.match(board.stdout, /fix task_d1's wait: task:task_z9 dangling/, 'a wait on a task the ledger never held');
  assert.equal(board.status, 1, 'a dangling wait is a problem');
  assert.equal(chip('task_a1 Fix the stale badge', 'started').status, 0);
  assert.equal(chip('task_a1 Fix the stale badge', 'landed').status, 0);
  writeFileSync(join(root, 'docs/plans/2026-01-01-pivot.md'), '# Pivot\n\nStatus: executed\n');
  board = chips();
  assert.match(board.stdout, /task_b1 {2}Fix the guide {2}\[docs\] {2}no card/, 'the task it waited on landed');
  assert.match(board.stdout, /task_c1 {2}Fix the lexer {2}\[lexer\] {2}no card/, 'the plan it waited on is executed');
  assert.equal(offer('task_e1 Fix the theme', 'src/t.ts', 'topic: theme').status, 0);
  assert.equal(offer('task_e2 Fix the theme docs', 'docs/theme.md', 'topic: theme; waits: task:task_e1').status, 0);
  assert.equal(chip('task_e1 Fix the theme', 'dismissed superseded: the theme was removed').status, 0);
  writeFileSync(join(root, 'docs/plans/2026-01-02-dropped.md'), '# Dropped\n\nStatus: cancelled: the owner dropped it\n');
  assert.equal(offer('task_f1 Fix the router', 'src/r.ts', 'topic: router; waits: run:docs/plans/2026-01-02-dropped.md').status, 0);
  board = chips();
  assert.match(board.stdout, /fix task_e2's wait: task:task_e1 closed as dismissed superseded without its result/, 'a task it waited on closed without landing');
  assert.match(board.stdout, /fix task_f1's wait: run:docs\/plans\/2026-01-02-dropped\.md closed without its result/, 'a plan it waited on was cancelled');
  assert.equal(board.status, 1);
});

test('decisions-check cards only a task that can start, and a waiting task reserves no paths', () => {
  const { chip, chips, offer, outside } = chipLedger();
  assert.equal(offer('task_a1 Rewrite the docs', 'docs', 'topic: docs; waits: pr:99').status, 0);
  const waiting = chip('task_a1 Rewrite the docs', 'carded', 'card: task_x1; session: s1');
  assert.equal(waiting.status, 1, 'a card for a task whose PR has not merged');
  assert.match(waiting.stderr, /task_a1 cannot start yet \(pr:99 not merged\), so it gets no card/);
  const inside = offer('task_a2 Fix the guide', 'docs/guide.md', 'topic: docs; card: task_x2; session: s1');
  assert.equal(inside.status, 0, `a ready task inside the waiting task's directory gets a card at once: ${inside.stderr}`);
  assert.equal(offer('task_b1 Fix the reader', `src/r.ts, ${outside('io.md')}`, 'topic: io').status, 0);
  assert.equal(chip('task_b1 Fix the reader', 'started').status, 0);
  assert.equal(offer('task_b2 Speed up the reader', 'src/r.ts', 'topic: io; card: task_x3; session: s1').status, 0, 'a card beside a started session on the same project path');
  assert.match(offer('task_b3 Document the reader', outside('io.md'), 'topic: io; card: task_x4; session: s1').stderr, /started task_b1 writes its paths outside this checkout/, 'a card for a task a started session blocks in another repository');
  assert.equal(chip('task_a2 Fix the guide', 'uncarded', 'card: task_x2').status, 0);
  assert.match(chips().stdout, /card task_a2: it can start and has no card/, 'the sweep lists a ready task without a card');
});

test('decisions-check holds one open design question per topic and folds the next finding into it', () => {
  const { chip, chips, offer, root } = chipLedger();
  const landing = 'task_a1 Decide where pasted content lands (xhigh)';
  assert.equal(offer(landing, 'src/core', 'topic: landing; kind: decide').status, 0);
  assert.match(offer('task_a2 Decide where dropped content lands (xhigh)', 'src/core', 'topic: landing; kind: decide').stderr, /topic landing already has the open design question task_a1; log this finding as a folded row on task_a1/);
  assert.equal(offer('task_a3 Fix the drop indicator', 'src/ui', 'topic: landing').status, 0, 'a plain fix in the same topic');
  assert.equal(offer('task_b1 Decide the export format (xhigh)', 'src/export', 'topic: export; kind: decide').status, 0, 'a design question in another topic');
  assert.equal(chip(landing, 'folded', 'writes: src/drop').status, 0);
  assert.match(chips('brief', 'task_a1').stdout, /^\[P1\] Decide where pasted content lands \(xhigh\)\n\nTopic: landing\.[\s\S]*Findings:\n- why\n- why\nWrites: src\/core, src\/drop[\s\S]*settles a design question first[\s\S]*\n\nSuggested task task_a1 in docs\/plans\/suggested-tasks\.decisions\.tsv of the project checkout [^\n]*\n?$/);
  assert.match(chips('id').stdout, /^t_[0-9a-f]{8}\n$/u);
  assert.match(chips('--fetch', 'id').stdout, /^t_[0-9a-f]{8}\n$/u, 'a flag before the id command');
  const raced = 'docs/plans/raced.decisions.tsv';
  writeFileSync(join(root, raced), `ts\tphase\tdecision\twhy\tevidence\tresult\n${['task_f1 Decide the badge', 'task_f2 Decide the badge link'].map((decision) => ['2026-01-01T10:00:00Z', 'chip', decision, 'why', 'writes: README.md; topic: badge; kind: decide', 'offered'].join('\t')).join('\n')}\n`);
  const folded = chips(raced);
  assert.equal(folded.status, 1, 'two design questions in one topic that append never checked together');
  assert.match(folded.stdout, /fold topic badge: task_f1 and task_f2 are both open design questions/);
});

test('decisions-check refuses a base-red row until an open suggested task owns that check', () => {
  const { appendTo, chip, offer } = chipLedger();
  const log = 'docs/plans/2026-01-01-fix.decisions.tsv';
  const blame = () => appendTo(log, 'verify', 'read CI', 'base-red: ci:check; proof: none', 'gap: fails on next too');
  const refused = blame();
  assert.equal(refused.status, 1, 'a failure blamed on the base that no task owns');
  assert.match(refused.stderr, /base-red: ci:check has no open suggested task that owns it/);
  assert.equal(appendTo(log, 'verify', 'read CI', 'the check also fails on next; proof: none', 'gap: fails on next too').status, 0, 'prose names no check, so nothing reads it');
  const green = 'task_a1 Make next green (xhigh)';
  assert.equal(offer(green, '.github/workflows', 'topic: next-green; owns: ci:check').status, 0);
  assert.equal(blame().status, 0, 'a base-red row once a task owns the check');
  assert.equal(chip(green, 'started').status, 0);
  assert.equal(chip(green, 'landed').status, 0);
  assert.equal(blame().status, 1, 'the owning task landed, so the check has no owner again');
});

test('decisions-check chips prints every open task by state, and lists started overlaps', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', { files: { 'docs/plans/.keep': '' } });
  const chips = (...args) => run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'chips', ...args], root);
  assert.match(chips().stderr, /No ledger at docs\/plans\/suggested-tasks\.decisions\.tsv yet/, 'a project with no ledger yet');
  assert.equal(chips('docs/plans/missing.decisions.tsv').status, 2, 'a named ledger that does not exist');
  const rows = [
    ['task_a1 Fix the stale badge', 'writes: README.md; topic: docs', 'offered'],
    ['task_b2 Design the export ledger (xhigh)', `writes: src/export, ${join(dir, 'shared/export')}; topic: export; kind: decide`, 'offered'],
    ['task_c3 Now: Rename the probe flag', 'writes: tooling/probe.mjs', 'offered'],
    ['task_a1 Fix the stale badge', 'README.md already links the live page', 'dismissed done'],
    ['task_b2 Design the export ledger (xhigh)', 'the owner started it', 'started'],
    ['task_g1 Fix the core', `writes: src/export/core.ts, ${join(dir, 'shared/export/core.md')}; topic: export`, 'offered'],
    ['task_g1 Fix the core', 'evidence', 'started'],
  ];
  writeFileSync(join(root, 'docs/plans/suggested-tasks.decisions.tsv'), `ts\tphase\tdecision\twhy\tevidence\tresult\n${rows.map(([decision, evidence, result]) => ['2026-01-01T10:00:00Z', 'chip', decision, 'why', evidence, result].join('\t')).join('\n')}\n`);
  const listed = chips();
  assert.equal(listed.status, 0, listed.stderr);
  assert.match(listed.stdout, /^3 open suggested tasks in docs\/plans\/suggested-tasks\.decisions\.tsv\./u);
  assert.match(listed.stdout, /Started \(2\)\n {2}task_b2 {2}Design the export ledger \(xhigh\) {2}\[export, decide\]\n {2}task_g1 {2}Fix the core {2}\[export\]/);
  assert.match(listed.stdout, /Unmigrated \(1\)\n {2}task_c3 {2}Rename the probe flag\n/, 'an old offer with no topic, its readiness tag stripped');
  assert.match(listed.stdout, /migrate task_c3: log updated with topic:/);
  assert.match(listed.stderr, /task_b2 and task_g1 are both started on an overlapping path outside this checkout/);
});

const ledgerRows = (rows) => `ts\tphase\tdecision\twhy\tevidence\tresult\n${rows.map(([decision, evidence, result]) => ['2026-01-01T10:00:00Z', 'chip', decision, 'why', evidence, result].join('\t')).join('\n')}\n`;

test('the whole-log check leaves uncommitted old-form chip rows to the rules they were appended under', () => {
  const { LEDGER, helper, offer, root } = chipLedger();
  writeFileSync(join(root, LEDGER), ledgerRows([
    ['task_a1 After: Fix the stale badge (high)', 'writes: README.md', 'offered'],
    ['task_a2 Now: Fix the guide', 'writes: docs/guide.md', 'offered'],
    ['task_a2 Now: Fix the guide', 'the queue dropped it', 'dismissed gone'],
  ]));
  const checked = helper(LEDGER);
  assert.equal(checked.status, 0, `rows an older helper appended and nobody committed yet: ${checked.stderr}`);
  assert.match(offer('task_b1 After: Fix it').stderr, /no title says Now: or After:/, 'append still refuses the old form');
});

test('the whole-log check judges a row by the rows before it, never by later files or rules newer than the row', () => {
  const { LEDGER, chip, chips, helper, offer, root } = chipLedger();
  mkdirSync(join(root, 'src/a'), { recursive: true });
  assert.equal(offer('task_a1 Fix a', 'src/a', 'topic: a').status, 0);
  assert.equal(chip('task_a1 Fix a', 'started').status, 0);
  assert.equal(offer('task_b1 Fix b', 'src/b', 'topic: b').status, 0);
  assert.equal(chip('task_b1 Fix b', 'started', 'writes: alias').status, 0);
  assert.equal(chip('task_a1 Fix a', 'landed').status, 0);
  assert.equal(chip('task_b1 Fix b', 'landed').status, 0);
  symlinkSync('src/a', join(root, 'alias'));
  const linked = helper(LEDGER);
  assert.equal(linked.status, 0, `a path that later became a link to another task's path: ${linked.stderr}`);
  writeFileSync(join(root, LEDGER), ledgerRows([['task_c1 Fix c', 'writes: src/c.ts; topic: c; waits: task:task_c1', 'offered']]));
  const old = helper(LEDGER);
  assert.equal(old.status, 0, `a wait on itself that a helper without waits never read: ${old.stderr}`);
  assert.match(chips().stdout, /fix task_c1's wait: task:task_c1 is this task/, 'the board asks for the repair');
});

test('a base-red row and a carded row stay valid after the state they were judged against changes', () => {
  const { LEDGER, appendTo, chip, chips, helper, offer, outside } = chipLedger();
  const log = 'docs/plans/2026-01-01-fix.decisions.tsv';
  const green = 'task_g1 Make next green (xhigh)';
  assert.equal(offer(green, '.github/workflows', 'topic: next-green; owns: ci:check').status, 0);
  assert.equal(appendTo(log, 'verify', 'read CI', 'base-red: ci:check; proof: none', 'gap: fails on next too').status, 0);
  assert.equal(chip(green, 'started').status, 0);
  assert.equal(chip(green, 'landed').status, 0);
  const logChecked = helper(log);
  assert.equal(logChecked.status, 0, `the owner landing the fix leaves the earlier row valid: ${logChecked.stderr}`);
  assert.equal(offer('task_c1 Fix the reader', outside('r.md'), 'topic: io; card: c1; session: s1').status, 0);
  assert.equal(offer('task_c2 Fix the writer', outside('r.md'), 'topic: io-write').status, 0);
  assert.equal(chip('task_c2 Fix the writer', 'started').status, 0);
  const ledgerChecked = helper(LEDGER);
  assert.equal(ledgerChecked.status, 0, `a later start leaves the earlier card row valid: ${ledgerChecked.stderr}`);
  const board = chips();
  assert.match(board.stdout, /withdraw task_c1's card c1: started task_c2 writes its paths outside this checkout; log started when the dismiss tool reports the owner started it, dismissed declined with card: c1 when it reports the owner dismissed it, and otherwise uncarded with card: c1 once it is withdrawn or its session has ended\n/, 'the board still asks for the card to go, with each route a withdrawal can take');
  assert.equal(board.status, 1);
});

test('a dup moves the duplicate\'s title, findings, paths, waits and owned checks into an offered task it keeps', () => {
  const { appendTo, chip, chips, offer, outside } = chipLedger();
  const parser = 'task_a1 Fix the parser';
  const docs = 'task_b1 Fix the parser docs';
  assert.equal(offer(parser, 'src/p.ts', 'topic: parser').status, 0);
  assert.equal(offer(docs, outside('p.md'), 'topic: parser; waits: pr:99, task:task_a1; owns: ci:docs').status, 0);
  const merged = chip(docs, 'dismissed dup task_a1');
  assert.equal(merged.status, 0, merged.stderr);
  assert.match(chips().stdout, /task_a1 {2}Fix the parser {2}\[parser\] {2}owns ci:docs {2}waits on pr:99 not merged\n/, 'the wait on the kept task itself is dropped');
  assert.match(chips('brief', 'task_a1').stdout, /Findings:\n- why\nAlso covers:\n- task_b1 Fix the parser docs\n {2}- why\nWrites: src\/p\.ts, [^\n]*\/shared\/p\.md\nOwns: ci:docs\nWaited on: pr:99\n/, 'the brief names the duplicate\'s work by its title');
  assert.equal(appendTo('docs/plans/2026-01-01-fix.decisions.tsv', 'verify', 'read CI', 'base-red: ci:docs; proof: none', 'gap: fails on next too').status, 0, 'the kept task owns the check');
  assert.equal(offer('task_w1 Rewrite the docs index', outside('p.md'), 'topic: index').status, 0);
  assert.equal(chip('task_w1 Rewrite the docs index', 'started').status, 0);
  assert.match(chips().stdout, /task_a1 {2}Fix the parser {2}\[parser\] {2}owns ci:docs {2}waits on pr:99 not merged; started task_w1 writes its paths outside this checkout\n/, 'a started task on an outside path the duplicate brought');
});

test('a card prompt leads with the task, then how its session lands, and ends by loading the current brief from the project checkout', () => {
  const { chips, offer, root } = chipLedger();
  assert.equal(offer('task_a1 Fix the parser', 'src/p.ts', 'topic: parser').status, 0);
  const checkout = realpathSync(root);
  const brief = chips('brief', 'task_a1').stdout;
  const quoted = (text) => text.replace(/[.*+?^${}()|[\]\\/]/gu, '\\$&');
  assert.match(brief, /^\[P1\] Fix the parser\n\nTopic: parser\. Kind: fix\. Effort: high\. Priority: P1\.\nRepro: steps\nFindings:\n/, 'the card shows the task and its priority before any bookkeeping');
  assert.match(brief, new RegExp(`\\n\\nSuggested task task_a1 in docs/plans/suggested-tasks\\.decisions\\.tsv of the project checkout ${quoted(checkout)}\\. This prompt can be older than the task, so before anything else run cd ${quoted(checkout)} && node \\.agents/pstack/decisions-check\\.mjs chips brief task_a1 and work from what it prints\\. Run every ledger command from ${quoted(checkout)} that way, even when your session opened in its own worktree[^\\n]*\\n?$`), 'a card made before a later fold or dup, run from a worktree whose ledger copy is stale');
  const patch = join(checkout, 'docs/plans/artifacts/chips/task_a1.patch');
  const branch = execFileSync('git', ['branch', '--show-current'], { cwd: checkout, encoding: 'utf8' }).trim();
  assert.match(brief, new RegExp(`you may commit in your worktree as you go\\. When you finish, land it yourself: run git add -A in your worktree and save git diff --cached <base>, where <base> is what git merge-base HEAD ${quoted(branch)} prints, which holds your commits, your uncommitted changes and new files, as ${quoted(patch)}, run git -C ${quoted(checkout)} apply --check --whitespace=error-all ${quoted(patch)}, then git -C ${quoted(checkout)} apply ${quoted(patch)}, which changes only the checkout's working tree and leaves its index alone\\.[^\\n]*Then deliver the patch's paths from ${quoted(checkout)} as your project's Delivery rule says[^\\n]*where that rule commits, commit only those paths there; where the owner owns commits, leave them in the working tree\\. Merge each run directory you wrote under docs/plans/artifacts in your worktree into the same path in ${quoted(checkout)} without overwriting, with mkdir -p <that path> && cp -Rn <your run directory>/\\. <that path>/, because append refuses a row whose evidence cites a path the checkout lacks, and removing the worktree deletes ignored files your logged rows cite\\. Then log landed with patch: ${quoted(patch)}, adding commit: <hash>, <hash> for each commit you made`), 'a session copies its run directories into the checkout before the landed row that cites them');
  assert.match(brief, new RegExp(`so the lead's report links them\\. Then title your session 👀 <name>, with no count, as ${quoted(checkout)}/\\.agents/pstack/rules/title\\.md says, so the owner's sidebar shows which sessions hold work to review\\. Last, stop each server you started\\. Then run node ${quoted(checkout)}/\\.agents/skills/cleanup/scripts/scan\\.mjs --landed <your worktree's absolute path>\\. When it exits 0, every change and ignored file of yours is committed, recreated by an install or build, or in the checkout, so remove your worktree as your final command with git -C ${quoted(checkout)} worktree remove --force <your worktree's absolute path> && git -C ${quoted(checkout)} worktree list, and check that its list no longer names your worktree\\. `), 'a landed session deletes its own worktree only once the cleanup scan finds all its work in the checkout');
});

test('a merge or a folded design question keeps the effort the task\'s work needs', () => {
  const { chip, chips, offer } = chipLedger();
  assert.equal(offer('task_a1 Fix the parser', 'src/p.ts', 'topic: parser').status, 0);
  assert.equal(offer('task_b1 Find why the parser hangs (xhigh)', 'src/q.ts', 'topic: parser').status, 0);
  assert.equal(chip('task_b1 Find why the parser hangs (xhigh)', 'dismissed dup task_a1').status, 0);
  assert.match(chips('brief', 'task_a1').stdout, /^\[P1\] Fix the parser \(xhigh\)\n/, 'a diagnosis merged into a plain fix');
  assert.equal(offer('task_c1 Fix the printer', 'src/r.ts', 'topic: printer').status, 0);
  assert.equal(chip('task_c1 Fix the printer', 'folded', 'kind: decide; writes: src/r2.ts').status, 0, 'a design question found later');
  assert.match(chips('brief', 'task_c1').stdout, /^\[P1\] Fix the printer \(xhigh\)\n[\s\S]*Kind: decide\.[\s\S]*settles a design question first/);
});

test('folding a design finding into an offered fix makes it a design question', () => {
  const { chip, chips, offer } = chipLedger();
  assert.equal(offer('task_f1 Fix the export button', 'src/b.ts', 'topic: export').status, 0);
  assert.equal(chip('task_f1 Fix the export button', 'folded', 'kind: decide; writes: src/c.ts').status, 0, 'a design finding on the same question');
  assert.match(chips('brief', 'task_f1').stdout, /Kind: decide\.[\s\S]*settles a design question first/, 'the card routes to a verdict');
});

test('a folded design question promotes its task and joins the one-question-per-topic check', () => {
  const { chip, offer } = chipLedger();
  assert.equal(offer('task_d1 Decide the export format (xhigh)', 'src/e.ts', 'topic: export; kind: decide').status, 0);
  assert.equal(offer('task_k1 Fix the export button', 'src/b.ts', 'topic: export').status, 0);
  assert.match(chip('task_k1 Fix the export button', 'folded', 'kind: decide; writes: src/c.ts').stderr, /topic export already has the open design question task_d1; log this finding as a folded row on task_d1 instead/, 'a second design question in one topic');
  assert.match(chip('task_d1 Decide the export format (xhigh)', 'folded', 'kind: fix').stderr, /a folded row takes kind: decide only/);
  assert.equal(chip('task_d1 Decide the export format (xhigh)', 'folded', 'kind: decide; writes: src/f.ts').status, 0, 'a folded design question on the topic\'s own design task');
});

test('append refuses a dup of a task with no topic until it is migrated', () => {
  const { chip, root, LEDGER, offer } = chipLedger();
  assert.equal(offer('task_a1 Fix the parser', 'src/p.ts', 'topic: parser').status, 0);
  writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + ['2026-01-01T10:00:00Z', 'chip', 'task_o1 After: Fix the parser docs (high)', 'waits for: PR 12 to merge', 'writes: docs/p.md', 'offered'].join('\t') + '\n');
  assert.match(chip('task_o1 After: Fix the parser docs (high)', 'dismissed dup task_a1').stderr, /task_o1 has no topic, so its waits may still be prose; migrate it first: log updated with topic: and the waits: it has/);
  assert.equal(chip('task_o1 After: Fix the parser docs (high)', 'updated', 'topic: parser; waits: pr:12').status, 0);
  assert.equal(chip('task_o1 After: Fix the parser docs (high)', 'dismissed dup task_a1').status, 0, 'once it has a topic');
});

test('append refuses a second card on a task that has one', () => {
  const { chip, offer } = chipLedger();
  assert.equal(offer('task_l1 Fix the lexer', 'src/l.ts', 'topic: lexer').status, 0);
  assert.equal(chip('task_l1 Fix the lexer', 'carded', 'card: c1; session: s1').status, 0);
  assert.match(chip('task_l1 Fix the lexer', 'carded', 'card: c2; session: s2').stderr, /task_l1 already has card c1; log uncarded with card: c1 once that card is withdrawn or its session has ended, then card it again/);
  assert.equal(chip('task_l1 Fix the lexer', 'uncarded', 'card: c1').status, 0);
  assert.match(chip('task_l1 Fix the lexer', 'carded', 'card: c2; session: s2').stderr, /task_l1 belongs to session s1/, 'the first session that carded an offer naming no session owns it');
  assert.equal(chip('task_l1 Fix the lexer', 'carded', 'card: c2; session: s1').status, 0);
});

test('a dup that would leave two tasks waiting on each other is refused, and the duplicate stays open', () => {
  const { chip, chips, offer } = chipLedger();
  assert.equal(offer('task_d1 Fix d', 'src/d.ts', 'topic: chain').status, 0);
  assert.equal(offer('task_m1 Fix m', 'src/m.ts', 'topic: chain; waits: task:task_d1').status, 0);
  assert.equal(offer('task_k1 Fix k', 'src/k.ts', 'topic: chain; waits: task:task_m1').status, 0);
  assert.match(chip('task_d1 Fix d', 'dismissed dup task_k1').stderr, /this row leaves task_m1 and task_k1 waiting on each other; keep task_d1 open$/m, 'a wait on the duplicate that now leads to the kept task');
  const board = chips();
  assert.equal(board.status, 0, board.stdout);
  assert.match(board.stdout, /Ready, P1 \(1\)\n {2}task_d1 {2}Fix d {2}\[chain\] {2}no card\n/, 'the route the refusal names keeps every task and wait');
});

test('a dup that hands the kept task a wait back on itself is refused', () => {
  const { chip, offer } = chipLedger();
  assert.equal(offer('task_k1 Fix k', 'src/k.ts', 'topic: chain').status, 0);
  assert.equal(offer('task_c1 Fix c', 'src/c.ts', 'topic: chain; waits: task:task_k1').status, 0);
  assert.equal(offer('task_d1 Fix d', 'src/d.ts', 'topic: chain; waits: task:task_c1').status, 0);
  assert.match(chip('task_d1 Fix d', 'dismissed dup task_k1').stderr, /this row leaves task_k1 and task_c1 waiting on each other; keep task_d1 open$/m, 'a loop whose closing wait the duplicate would bring');
});

test('an updated row that closes a wait loop is refused', () => {
  const { chip, offer } = chipLedger();
  assert.equal(offer('task_a1 Fix a', 'src/a.ts', 'topic: loop').status, 0);
  assert.equal(offer('task_b1 Fix b', 'src/b.ts', 'topic: loop; waits: task:task_a1').status, 0);
  assert.match(chip('task_a1 Fix a', 'updated', 'waits: task:task_b1').stderr, /this row leaves task_a1 and task_b1 waiting on each other; drop the wait that closes the loop/);
  assert.equal(chip('task_b1 Fix b', 'started').status, 0);
  assert.equal(chip('task_a1 Fix a', 'updated', 'waits: task:task_b1').status, 0, 'a wait on a started task never loops');
});

test('chips brief on a merged task prints the task it merged into, and a closed task has nothing to start', () => {
  const { chip, chips, offer } = chipLedger();
  assert.equal(offer('task_a1 Fix a', 'src/a.ts', 'topic: brief').status, 0);
  assert.equal(offer('task_b1 Fix b', 'src/b.ts', 'topic: brief').status, 0);
  assert.equal(chip('task_b1 Fix b', 'dismissed dup task_a1').status, 0);
  const merged = chips('brief', 'task_b1');
  assert.equal(merged.status, 0, merged.stderr);
  assert.match(merged.stdout, /^task_b1 was merged into task_a1; work from its brief\.\n\n\[P1\] Fix a\n\nTopic: brief\.[\s\S]*\n\nSuggested task task_a1 [^\n]*\n?$/, 'a card on the duplicate that another session still holds');
  assert.equal(chip('task_a1 Fix a', 'started').status, 0);
  assert.equal(chip('task_a1 Fix a', 'landed').status, 0);
  const landed = chips('brief', 'task_b1');
  assert.equal(landed.status, 1);
  assert.match(landed.stderr, /task_b1 was merged into task_a1, which is landed, so there is nothing to start; tell the owner/);
  assert.equal(offer('task_c1 Fix c', 'src/c.ts', 'topic: brief').status, 0);
  assert.equal(chip('task_c1 Fix c', 'dismissed done').status, 0);
  assert.match(chips('brief', 'task_c1').stderr, /task_c1 is dismissed done, so there is nothing to start; tell the owner/);
});

test('append refuses a dup across topics until the duplicate moves into the kept task\'s topic', () => {
  const { chip, offer } = chipLedger();
  assert.equal(offer('task_a1 Fix the export', 'src/e.ts', 'topic: export').status, 0);
  assert.equal(offer('task_b1 Fix the export format', 'src/f.ts', 'topic: format').status, 0);
  assert.match(chip('task_b1 Fix the export format', 'dismissed dup task_a1').stderr, /task_b1 is in topic format and task_a1 in export, and a dup joins tasks on one question; when task_b1 answers task_a1's question, log updated with topic: export on task_b1 first/);
  assert.equal(chip('task_b1 Fix the export format', 'updated', 'topic: export').status, 0);
  assert.equal(chip('task_b1 Fix the export format', 'dismissed dup task_a1').status, 0);
});

test('append refuses a dup into a task with no topic until it is migrated', () => {
  const { chip, root, LEDGER, offer } = chipLedger();
  assert.equal(offer('task_b1 Fix the parser docs', 'docs/p.md', 'topic: parser; waits: pr:12').status, 0);
  writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + ['2026-01-01T10:00:00Z', 'chip', 'task_o1 Now: Fix the parser', 'why', 'writes: src/p.ts', 'offered'].join('\t') + '\n');
  assert.match(chip('task_b1 Fix the parser docs', 'dismissed dup task_o1').stderr, /task_o1 has no topic, so its waits may still be prose; migrate it first/);
  assert.equal(chip('task_o1 Now: Fix the parser', 'updated', 'topic: parser; waits: none').status, 0);
  assert.equal(chip('task_b1 Fix the parser docs', 'dismissed dup task_o1').status, 0);
});

test('a migration names the task\'s waits along with its topic', () => {
  const { chip, root, LEDGER, offer } = chipLedger();
  assert.equal(offer('task_a1 Fix the parser', 'src/p.ts', 'topic: parser').status, 0);
  writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + ['2026-01-01T10:00:00Z', 'chip', 'task_o1 After: Fix the parser docs (high)', 'waits for: PR 12 to merge', 'writes: docs/p.md', 'offered'].join('\t') + '\n');
  assert.match(chip('task_o1 After: Fix the parser docs (high)', 'updated', 'topic: parser').stderr, /task_o1 has no topic yet, so this row migrates it; name its waits too, as waits: none when it has none/);
  assert.equal(chip('task_o1 After: Fix the parser docs (high)', 'updated', 'topic: parser; waits: pr:12').status, 0);
});

test('a dup that makes a design question beside a running one names the updated route', () => {
  const { chip, offer, root, LEDGER } = chipLedger();
  assert.equal(offer('task_s1 Decide where content lands (xhigh)', 'src/l.ts', 'topic: land; kind: decide').status, 0);
  assert.equal(chip('task_s1 Decide where content lands (xhigh)', 'started').status, 0);
  assert.equal(offer('task_k1 Fix the drop target', 'src/k.ts', 'topic: land').status, 0);
  writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + ['2026-01-01T10:00:00Z', 'chip', 'task_d1 Decide where drops land (xhigh)', 'why', 'writes: src/d.ts; topic: land; kind: decide', 'offered'].join('\t') + '\n');
  assert.match(chip('task_d1 Decide where drops land (xhigh)', 'dismissed dup task_k1').stderr, /topic land's design question task_s1 is running; log updated on task_k1 with its waits plus task:task_s1 before this row/);
  assert.equal(chip('task_k1 Fix the drop target', 'updated', 'waits: task:task_s1').status, 0);
  assert.equal(chip('task_d1 Decide where drops land (xhigh)', 'dismissed dup task_k1').status, 0);
});

test('a folded design question accepts a wait through a duplicate of the running one', () => {
  const { chip, offer } = chipLedger();
  assert.equal(offer('task_r1 Decide the format (xhigh)', 'src/r.ts', 'topic: format; kind: decide').status, 0);
  assert.equal(offer('task_a1 Fix the format docs', 'docs/r.md', 'topic: format').status, 0);
  assert.equal(chip('task_a1 Fix the format docs', 'dismissed dup task_r1').status, 0);
  assert.equal(chip('task_r1 Decide the format (xhigh)', 'started').status, 0);
  assert.equal(offer('task_k1 Fix the format button', 'src/k.ts', 'topic: format; waits: task:task_a1').status, 0);
  const folded = chip('task_k1 Fix the format button', 'folded', 'kind: decide');
  assert.equal(folded.status, 0, folded.stderr);
});

test('folding an unknown-cause diagnosis into a plain fix raises its brief and board line to xhigh', () => {
  const { chip, chips, offer } = chipLedger();
  assert.equal(offer('task_p1 Fix the parser', 'src/p.ts', 'topic: parser').status, 0);
  assert.equal(chip('task_p1 Fix the parser', 'folded', 'effort: xhigh; writes: src/q.ts').status, 0, 'a hang nobody has explained yet');
  assert.match(chips('brief', 'task_p1').stdout, /^\[P1\] Fix the parser \(xhigh\)\n[\s\S]*Kind: fix\./);
  assert.match(chips().stdout, /task_p1 {2}Fix the parser \(xhigh\) {2}\[parser\]/, 'the board shows the effort the card passes');
  assert.match(chip('task_p1 Fix the parser', 'folded', 'effort: high').stderr, /a folded row takes effort: xhigh only/);
});

test("a card's effort is its title's, capped at the project's maxEffort, in the brief and on the board", () => {
  const { chips, offer, root } = chipLedger();
  assert.equal(offer('task_p1 Fix the parser', 'src/p.ts', 'topic: parser').status, 0);
  assert.equal(offer('task_d1 Design the export ledger (xhigh)', 'src/export', 'topic: export; kind: decide').status, 0);
  assert.equal(offer('task_w1 Fix the export core', 'src/export/core.ts', 'topic: core; waits: task:task_d1').status, 0);
  assert.match(chips('brief', 'task_p1').stdout, /Kind: fix\. Effort: high\./);
  assert.match(chips('brief', 'task_d1').stdout, /Kind: decide\. Effort: xhigh\./);
  assert.match(chips().stdout, /task_d1 {2}Design the export ledger \(xhigh\) {2}\[export, decide\] {2}no card/, 'an uncapped line leaves the effort to its title');
  writeFileSync(join(root, '.agents/pstack.json'), JSON.stringify({ branch: 'next', maxEffort: 'high' }));
  assert.match(chips('brief', 'task_d1').stdout, /^\[P1\] Design the export ledger \(xhigh\)\n[\s\S]*Kind: decide\. Effort: high\./, 'the title keeps its recommendation');
  const board = chips().stdout;
  assert.match(board, /task_d1 {2}Design the export ledger \(xhigh\) {2}\[export, decide\] {2}effort high {2}no card/);
  assert.match(board, /task_w1 {2}Fix the export core {2}\[core\] {2}waits on /, 'a plain title is already at the cap');
});

test('a carded task takes no fold, update or dup until its card is withdrawn, and each refusal names its route', () => {
  const { chip, offer } = chipLedger();
  assert.equal(offer('task_k1 Fix k', 'src/k.ts', 'topic: card; card: c1; session: s1').status, 0);
  assert.equal(offer('task_d1 Fix d', 'src/d.ts', 'topic: card; waits: task:task_k1').status, 0, "a finding on the carded task's question waits on it");
  assert.match(chip('task_k1 Fix k', 'folded', 'writes: src/m.ts').stderr, /task_k1 holds card c1, which cannot show new work; offer the finding as a new task in topic card with waits: task:task_k1/);
  for (const change of ['owns: ci:k', 'writes: src/k', 'kind: decide', 'topic: other', 'fast: yes', 'waits: pr:5; topic: other']) {
    assert.match(chip('task_k1 Fix k', 'updated', change).stderr, /task_k1 holds card c1, which cannot change; withdraw the card first/, `an updated row with ${change}`);
  }
  assert.match(chip('task_d1 Fix d', 'dismissed dup task_k1').stderr, /task_k1 holds card c1, which cannot show new work; keep task_d1 open and log updated on it with its waits plus task:task_k1/);
  assert.equal(chip('task_k1 Fix k', 'uncarded', 'card: c1').status, 0);
  assert.equal(chip('task_k1 Fix k', 'folded', 'writes: src/m.ts').status, 0, 'a fold once the card is withdrawn');
});

test("a carded task's writes: can narrow to paths inside them, and only narrow", () => {
  const { chip, offer } = chipLedger();
  assert.equal(offer('task_k1 Fix k', 'src/k, test', 'topic: card; card: c1; session: s1').status, 0);
  assert.equal(chip('task_k1 Fix k', 'updated', 'writes: src/k/a.ts, test/k.test.ts').status, 0, 'a narrowing to paths inside the listed ones');
  assert.match(chip('task_k1 Fix k', 'updated', 'writes: src/k/a.ts, test').stderr, /task_k1 holds card c1, which cannot change; withdraw the card first/, 'a widening back to a directory');
  assert.match(chip('task_k1 Fix k', 'updated', 'writes: src/k/a.ts; owns: ci:k').stderr, /task_k1 holds card c1, which cannot change/, 'a narrowing beside another token');
});

test("uncarded and dismissed declined name the task's current card", () => {
  const { chip, offer } = chipLedger();
  assert.equal(offer('task_k1 Fix k', 'src/k.ts', 'topic: card; card: c1; session: s1').status, 0);
  assert.match(chip('task_k1 Fix k', 'uncarded').stderr, /task_k1 holds card c1; name it as card: c1/);
  assert.match(chip('task_k1 Fix k', 'dismissed declined').stderr, /task_k1 holds card c1; name it as card: c1/);
  assert.equal(chip('task_k1 Fix k', 'uncarded', 'card: c1').status, 0, 'a withdrawal names its card and needs no session');
  assert.match(chip('task_k1 Fix k', 'uncarded', 'card: c1').stderr, /task_k1 has no card to withdraw/);
  assert.equal(chip('task_k1 Fix k', 'carded', 'card: c2; session: s1').status, 0);
  assert.match(chip('task_k1 Fix k', 'dismissed declined', 'card: c1').stderr, /task_k1's card is c2, not c1; a dismissal of an older card closes nothing, so log no row for it/);
  assert.match(chip('task_k1 Fix k', 'uncarded', 'card: c1').stderr, /task_k1's card is c2, not c1/);
  assert.equal(chip('task_k1 Fix k', 'dismissed declined', 'card: c2').status, 0, "the owner's dismissal of the current card");
});

test('the board tells a session a card started to work from its current brief', () => {
  const { chips, offer } = chipLedger();
  assert.equal(offer('task_a1 Fix the parser', 'src/p.ts', 'topic: parser').status, 0);
  assert.match(chips().stdout, /\nA session a card started works from chips brief <its task id>, because its task can change after the card\.\n/, 'a card whose prompt predates chips brief');
});

test('an older dup into a started task passes the whole-log check', () => {
  const { chip, helper, offer, root, LEDGER } = chipLedger();
  assert.equal(offer('task_a1 Fix a', 'src/a.ts', 'topic: whole').status, 0);
  assert.equal(chip('task_a1 Fix a', 'started').status, 0);
  assert.equal(offer('task_b1 Fix b', 'src/b.ts', 'topic: whole; owns: ci:b').status, 0);
  writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + ['2026-01-01T10:00:00Z', 'chip', 'task_b1 Fix b', 'why', 'evidence', 'dismissed dup task_a1'].join('\t') + '\n');
  const whole = helper(LEDGER);
  assert.equal(whole.status, 0, `a dup the previous helper accepted: ${whole.stderr}`);
});

test('an older dup into a started task keeps the covers and owned checks it moved', () => {
  const { chip, chips, offer, root, LEDGER } = chipLedger();
  assert.equal(offer('task_a1 Fix a', 'src/a.ts', 'topic: whole').status, 0);
  assert.equal(chip('task_a1 Fix a', 'started').status, 0);
  assert.equal(offer('task_b1 Fix b', 'src/b.ts', 'topic: whole; owns: ci:b; waits: pr:7').status, 0);
  writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + ['2026-01-01T10:00:00Z', 'chip', 'task_b1 Fix b', 'why', 'evidence', 'dismissed dup task_a1'].join('\t') + '\n');
  const brief = chips('brief', 'task_a1').stdout;
  assert.match(brief, /Also covers:\n- task_b1 Fix b\n[\s\S]*Owns: ci:b\n/, 'what the previous helper moved into the started task');
  assert.match(brief, /Writes: src\/a\.ts\nOwns: ci:b\nWaited on: nothing\n/, 'the paths and waits stay the started task\'s own');
});

test('the whole-log check refuses a folded row with kind: fix', () => {
  const { helper, offer, root, LEDGER } = chipLedger();
  assert.equal(offer('task_d1 Decide the format (xhigh)', 'src/d.ts', 'topic: whole; kind: decide').status, 0);
  writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + ['2026-01-01T10:00:00Z', 'chip', 'task_d1 Decide the format (xhigh)', 'why', 'kind: fix', 'folded'].join('\t') + '\n');
  const fold = helper(LEDGER);
  assert.equal(fold.status, 1);
  assert.match(fold.stderr, /a folded row takes kind: decide only/);
});

test('a duplicate\'s card has nothing to start once the task it merged into is started', () => {
  const { chip, chips, offer } = chipLedger();
  assert.equal(offer('task_a1 Fix a', 'src/a.ts', 'topic: alias').status, 0);
  assert.equal(offer('task_b1 Fix b', 'src/b.ts', 'topic: alias').status, 0);
  assert.equal(chip('task_b1 Fix b', 'dismissed dup task_a1').status, 0);
  assert.equal(chip('task_a1 Fix a', 'started').status, 0);
  const brief = chips('brief', 'task_b1');
  assert.equal(brief.status, 1, 'a card on the duplicate that another session still holds');
  assert.match(brief.stderr, /task_b1 was merged into task_a1, which is started, so there is nothing to start; tell the owner/);
});

test('a duplicate\'s card has nothing to start while the task it merged into has its own card', () => {
  const { chip, chips, offer } = chipLedger();
  assert.equal(offer('task_a1 Fix a', 'src/a.ts', 'topic: alias').status, 0);
  assert.equal(offer('task_b1 Fix b', 'src/b.ts', 'topic: alias').status, 0);
  assert.equal(chip('task_b1 Fix b', 'dismissed dup task_a1').status, 0);
  assert.equal(chip('task_a1 Fix a', 'carded', 'card: c1; session: s1').status, 0);
  const brief = chips('brief', 'task_b1');
  assert.equal(brief.status, 1, 'two cards that would lead to one task');
  assert.match(brief.stderr, /task_b1 was merged into task_a1, which has card c1, so there is nothing to start; tell the owner/);
});

test('two design questions in different topics merge into one', () => {
  const { chip, chips, offer } = chipLedger();
  assert.equal(offer('task_k1 Decide the export format (xhigh)', 'src/e.ts', 'topic: export; kind: decide').status, 0);
  assert.equal(offer('task_d1 Decide the file format (xhigh)', 'src/f.ts', 'topic: format; kind: decide').status, 0);
  const merged = chip('task_d1 Decide the file format (xhigh)', 'dismissed dup task_k1');
  assert.equal(merged.status, 0, merged.stderr);
  assert.match(chips('brief', 'task_k1').stdout, /Also covers:\n- task_d1 Decide the file format \(xhigh\)\n/);
});

test('moving a design question into a topic that has one names the dup', () => {
  const { chip, offer } = chipLedger();
  assert.equal(offer('task_k1 Decide the export format (xhigh)', 'src/e.ts', 'topic: export; kind: decide').status, 0);
  assert.equal(offer('task_d1 Decide the file format (xhigh)', 'src/f.ts', 'topic: format; kind: decide').status, 0);
  assert.match(chip('task_d1 Decide the file format (xhigh)', 'updated', 'topic: export').stderr, /topic export already has the open design question task_k1; log task_d1 dismissed dup task_k1 instead/, 'the topic move the cross-topic refusal names for two fixes');
});

test('a covered task keeps its effort in the kept task\'s brief', () => {
  const { chip, chips, offer } = chipLedger();
  assert.equal(offer('task_a1 Fix the parser', 'src/p.ts', 'topic: parser').status, 0);
  assert.equal(offer('task_b1 Find the parser hang', 'src/q.ts', 'topic: parser').status, 0);
  assert.equal(chip('task_b1 Find the parser hang', 'folded', 'effort: xhigh').status, 0);
  assert.equal(chip('task_b1 Find the parser hang', 'dismissed dup task_a1').status, 0);
  assert.match(chips('brief', 'task_a1').stdout, /Also covers:\n- task_b1 Find the parser hang \(xhigh\)\n/);
});

test('append refuses a new self-wait on a task already in a loop', () => {
  const { chip, offer, root, LEDGER } = chipLedger();
  assert.equal(offer('task_a1 Fix a', 'src/a.ts', 'topic: loop').status, 0);
  assert.equal(offer('task_b1 Fix b', 'src/b.ts', 'topic: loop; waits: task:task_a1').status, 0);
  writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + ['2026-01-01T10:00:00Z', 'chip', 'task_a1 Fix a', 'why', 'waits: task:task_b1', 'updated'].join('\t') + '\n');
  assert.match(chip('task_a1 Fix a', 'updated', 'waits: task:task_b1, task:task_a1').stderr, /task_a1 cannot wait on itself/, 'a self-wait added to a task an older row left in a loop');
  assert.equal(chip('task_a1 Fix a', 'updated', 'waits: task:task_b1, pr:7').status, 0, 'a wait outside the loop');
});

test('an empty waits: is refused', () => {
  const { chip, offer, root, LEDGER } = chipLedger();
  assert.equal(offer('task_a1 Fix the parser', 'src/p.ts', 'topic: parser').status, 0);
  writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + ['2026-01-01T10:00:00Z', 'chip', 'task_o1 After: Fix the parser docs (high)', 'waits for: PR 12 to merge', 'writes: docs/p.md', 'offered'].join('\t') + '\n');
  assert.match(chip('task_o1 After: Fix the parser docs (high)', 'updated', 'topic: parser; waits:').stderr, /waits: takes pr:<number>, task:<id> or run:<plan path ending in \.md>, comma-separated, or none/, 'a migration that would drop its prose wait');
  assert.equal(chip('task_o1 After: Fix the parser docs (high)', 'updated', 'topic: parser; waits: none').status, 0);
});

test('a finding that waits on a carded task stays open when the owner declines the card, and gets its own card once its wait is fixed', () => {
  const { appendTo, chip, chips, offer } = chipLedger();
  assert.equal(offer('task_k1 Fix k', 'src/k.ts', 'topic: card; card: c1; session: s1').status, 0);
  assert.equal(offer('task_d1 Fix d', 'src/d.ts', 'topic: card; waits: task:task_k1; owns: ci:d').status, 0);
  assert.match(chips().stdout, /Waiting, P0 \(1\)\n {2}task_d1 {2}Fix d {2}\[card\] {2}owns ci:d {2}waits on task:task_k1 offered\n/);
  assert.equal(chip('task_k1 Fix k', 'dismissed declined', 'card: c1').status, 0, 'the owner dismissed the card, which showed task_k1 whole');
  const board = chips();
  assert.equal(board.status, 1);
  assert.match(board.stdout, /fix task_d1's wait: task:task_k1 closed as dismissed declined without its result; log updated with the waits it has now/);
  assert.equal(appendTo('docs/plans/2026-01-01-fix.decisions.tsv', 'verify', 'read CI', 'base-red: ci:d; proof: none', 'gap: fails on next too').status, 0, 'the finding still owns its check');
  assert.equal(chip('task_d1 Fix d', 'updated', 'waits: none').status, 0);
  assert.match(chips().stdout, /Do, card pass \(1\)\n {2}card task_d1: it can start and has no card/);
});

test('once a card is withdrawn, chips merges each finding that waited on it, one merge a pass', () => {
  const { batch, chip, chips, offer } = chipLedger();
  assert.equal(offer('task_k1 Fix k', 'src/k.ts', 'topic: card; card: c1; session: s1').status, 0);
  assert.equal(offer('task_d1 Fix d', 'src/d.ts', 'topic: card; waits: task:task_k1').status, 0);
  assert.equal(offer('task_e1 Fix e', 'src/e.ts', 'topic: card; waits: task:task_k1').status, 0);
  assert.equal(offer('task_p1 Decide p (xhigh)', 'src/p.ts', 'topic: other; kind: decide; waits: task:task_k1').status, 0, 'a prerequisite in another topic');
  assert.doesNotMatch(chips().stdout, /merge/, 'no merge while the card is out');
  assert.equal(chip('task_k1 Fix k', 'uncarded', 'card: c1').status, 0);
  for (const id of ['task_d1', 'task_e1']) {
    const board = chips();
    assert.equal(board.status, 0, board.stdout);
    assert.match(board.stdout, new RegExp(`Do, ledger pass \\(1\\)\\n {2}merge ${id} into task_k1: task_k1 has no card now, so log ${id} dismissed dup task_k1\\n`));
    assert.equal(batch([[`${id} Fix ${id.at(5)}`, 'dismissed dup task_k1']]).status, 0, `the merge of ${id} appends`);
  }
  const board = chips();
  assert.match(board.stdout, /Do, card pass \(1\)\n {2}card task_k1:/, 'the task is carded again with all its work');
  assert.doesNotMatch(board.stdout, /merge task_p1/, 'a prerequisite in another topic stays its own task');
  assert.match(chips('brief', 'task_k1').stdout, /Also covers:\n- task_d1 Fix d\n[\s\S]*- task_e1 Fix e\n/);
});

test('a merge leaves the other items on its two tasks for the next pass', () => {
  const { batch, chip, chips, offer } = chipLedger();
  assert.equal(offer('task_g1 Fix g', 'src/g.ts', 'topic: gone').status, 0);
  assert.equal(offer('task_o1 Fix o', 'src/o.ts', 'topic: open').status, 0);
  assert.equal(offer('task_k1 Fix k', 'src/k.ts', 'topic: card; waits: task:task_g1').status, 0);
  assert.equal(offer('task_d1 Fix d', 'src/d.ts', 'topic: card; waits: task:task_o1, task:task_k1').status, 0);
  assert.equal(chip('task_g1 Fix g', 'dismissed declined').status, 0);
  const first = chips();
  assert.equal(first.status, 1, 'the stuck wait the pass leaves out still fails chips');
  assert.match(first.stdout, /Do, ledger pass \(1\)\n {2}merge task_d1 into task_k1/);
  assert.doesNotMatch(first.stdout, /fix task_k1's wait/);
  assert.equal(batch([['task_d1 Fix d', 'dismissed dup task_k1']]).status, 0);
  assert.match(chips().stdout, /fix task_k1's wait: task:task_g1 closed as dismissed declined without its result/);
  assert.match(chips('brief', 'task_k1').stdout, /Waited on: task:task_g1, task:task_o1\n/, 'the next pass sees the wait the merge moved');
});

test('a merge that would close a wait loop prints nothing and hides no later pass', () => {
  const { chips, offer } = chipLedger();
  assert.equal(offer('task_k1 Fix k', 'src/k.ts', 'topic: card').status, 0);
  assert.equal(offer('task_x1 Fix x', 'src/x.ts', 'topic: other; waits: task:task_k1').status, 0);
  assert.equal(offer('task_d1 Fix d', 'src/d.ts', 'topic: card; waits: task:task_k1, task:task_x1').status, 0);
  const board = chips();
  assert.equal(board.status, 0, board.stdout);
  assert.doesNotMatch(board.stdout, /merge/, 'task_k1 would wait on task_x1, which waits on task_k1');
  assert.match(board.stdout, /Do, card pass \(1\)\n {2}card task_k1:/);
});

test('a design question that waits on a design question of its topic is not a second open one', () => {
  const { chip, chips, offer } = chipLedger();
  assert.equal(offer('task_k1 Decide k (xhigh)', 'src/k.ts', 'topic: card; kind: decide; card: c1; session: s1').status, 0);
  assert.match(offer('task_d1 Decide d (xhigh)', 'src/d.ts', 'topic: card; kind: decide').stderr, /topic card already has the open design question task_k1; give task_d1 waits: task:task_k1, since task_k1 holds card c1/);
  const waiting = offer('task_d1 Decide d (xhigh)', 'src/d.ts', 'topic: card; kind: decide; waits: task:task_k1');
  assert.equal(waiting.status, 0, waiting.stderr);
  assert.doesNotMatch(chips().stdout, /fold topic/);
  assert.equal(chip('task_k1 Decide k (xhigh)', 'uncarded', 'card: c1').status, 0);
  assert.match(chips().stdout, /merge task_d1 into task_k1/);
});

test('chips shows one pass at a time: withdrawals, then ledger rows, then cards', () => {
  const { chip, chips, offer, root, LEDGER } = chipLedger();
  assert.equal(offer('task_a1 Fix a', 'src/a.ts', 'topic: one').status, 0);
  writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + ['2026-01-01T10:00:00Z', 'chip', 'task_o1 Fix the old docs', 'why', 'writes: docs/o.md', 'offered'].join('\t') + '\n');
  assert.equal(offer('task_c1 Fix c', 'src/c.ts', 'topic: three; card: c1; session: s1').status, 0);
  assert.equal(chip('task_c1 Fix c', 'updated', 'waits: pr:5').status, 0, 'a wait added to a carded task');
  const withdrawals = chips();
  assert.match(withdrawals.stdout, /Do, withdrawal pass \(1\)\n {2}withdraw task_c1's card c1/);
  assert.doesNotMatch(withdrawals.stdout, /migrate task_o1|card task_a1/);
  assert.equal(chip('task_c1 Fix c', 'uncarded', 'card: c1').status, 0);
  const ledger = chips();
  assert.match(ledger.stdout, /Do, ledger pass \(1\)\n {2}migrate task_o1/);
  assert.doesNotMatch(ledger.stdout, /card task_a1/);
  assert.equal(chip('task_o1 Fix the old docs', 'updated', 'topic: docs; waits: none').status, 0);
  assert.match(chips().stdout, /Do, ledger pass \(1\)\n {2}prioritize task_o1: log updated with priority:/, 'an untagged task gets no card until a sweep tags it');
  assert.equal(chip('task_o1 Fix the old docs', 'updated', 'priority: P2').status, 0);
  assert.match(chips().stdout, /Do, card pass \(2\)\n {2}card task_a1:[^\n]*\n {2}card task_o1:/);
});

test('decisions-check takes a P0 or P1 claim only with its evidence', () => {
  const { LEDGER, chip, helper, merge, offer, root } = chipLedger();
  const bare = (decision, tokens) => helper('append', LEDGER, 'chip', decision, 'why', tokens, 'offered');
  const untagged = bare('task_a1 Fix a', 'writes: a.md; topic: one');
  assert.equal(untagged.status, 1, 'a new offer with no priority');
  assert.match(untagged.stderr, /a new offer names its priority as "priority: P0"/);
  assert.equal(bare('task_a1 Fix a', 'writes: a.md; topic: one; owns: ci:check').status, 0, 'a task that owns a failing check is P0 without a token');
  assert.match(bare('task_b1 Fix b', 'writes: b.md; topic: two; priority: P0').stderr, /a P0 task is broken now/);
  assert.match(bare('task_b1 Fix b', 'writes: b.md; topic: two; priority: P1').stderr, /a P1 task is a bug with its repro/);
  assert.match(bare('task_b1 Fix b', 'writes: b.md; topic: two; priority: P4').stderr, /priority: is P0, P1, P2 or P3/);
  assert.match(bare('task_b1 Fix b', 'writes: b.md; topic: two; priority: P0; regressed: abc1234').stderr, /regressed: abc1234 is not a commit/);
  assert.match(bare('task_b1 Fix b', 'writes: b.md; topic: two; priority: P1; ship: r1').stderr, /sets no chips\.ship command/);
  merge('break b');
  const head = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  assert.equal(bare('task_b1 Fix b', `writes: b.md; topic: two; priority: P0; regressed: ${head}`).status, 0, 'a regression names its commit');
  assert.equal(bare('task_c1 Fix c', 'writes: c.md; topic: three; priority: P2').status, 0, 'P2 needs no evidence');
  assert.match(chip('task_c1 Fix c', 'updated', 'priority: P0').stderr, /a P0 task is broken now/, 'a raise to P0 without evidence');
  assert.equal(chip('task_c1 Fix c', 'updated', 'priority: P0; repro: type then reload loses the text').status, 0, 'a raise to P0 with its repro');
  assert.equal(chip('task_c1 Fix c', 'folded', 'priority: P3').status, 0);
  assert.match(helper('chips', 'brief', 'task_c1').stdout, /Priority: P0\./, 'a folded finding never lowers the priority');
  assert.equal(offer('task_d1 Fix d', 'd.md', 'topic: four; priority: P2; card: d1; session: s1').status, 0);
  assert.equal(chip('task_d1 Fix d', 'updated', 'priority: P3').status, 0, 'a carded task takes a new priority');
  assert.match(chip('task_d1 Fix d', 'updated', 'topic: five').stderr, /holds card d1, which cannot change/);
  assert.match(helper('chips', 'brief', 'task_b1').stdout, /Priority: P0\.[\s\S]*Regressed in: [0-9a-f]+/);
});

test('chips lists P0 and P1 in full, counts the rest and cards at most 10, highest priority first', () => {
  const { batch, chips } = chipLedger();
  const rows = [];
  for (let n = 0; n < 6; n += 1) rows.push([`task_p${n} Fix p${n}`, 'offered', `writes: p${n}.md; topic: p2-${n}; priority: P2`]);
  for (let n = 0; n < 4; n += 1) rows.push([`task_t${n} Tune t${n}`, 'offered', `writes: t${n}.md; topic: p3-${n}; priority: P3`]);
  rows.push(['task_b1 Fix the lost save', 'offered', 'writes: b.md; topic: save; priority: P0; repro: type then reload loses the text']);
  rows.push(['task_c1 Fix the cursor', 'offered', 'writes: c.md; topic: cursor; priority: P1; repro: click past the end']);
  rows.push(['task_h1 Fix held', 'offered', 'writes: h.md; topic: held; priority: P2; card: h1; session: s1']);
  const written = batch(rows);
  assert.equal(written.status, 0, written.stderr);
  const board = chips().stdout;
  assert.match(board, /Ready, P0 \(1\)\n {2}task_b1 /);
  assert.match(board, /Ready, P1 \(1\)\n {2}task_c1 /);
  assert.match(board, /Ready, lower priority \(P2 7, P3 4\): chips all lists them/);
  assert.doesNotMatch(board, /task_p0 {2}Fix p0 {2}\[/, 'a P2 task shows only as a count');
  assert.match(board, /Do, card pass \(10\)\n {2}card task_b1:[^\n]*\n {2}card task_c1:[^\n]*\n {2}card task_p0:/, 'P0 first');
  assert.equal(board.match(/^ {2}card task_/gmu).length, 9, 'ten cards less the one this session holds');
  assert.match(board, /\n {2}card task_t0:[^\n]*\n {2}3 more can start once this session holds fewer than 10 cards/);
  const full = chips('all', '--session', 's1').stdout;
  assert.match(full, /Ready, P2 \([0-9]+\)\n {2}task_/);
  assert.match(full, /Ready, P3 \(4\)/);
});

test('chips ranks a task with the most urgent open task that waits on it', () => {
  const { batch, chip, chips } = chipLedger();
  const written = batch([
    ['task_a1 Fix the lost save', 'offered', 'writes: a.md; topic: save; priority: P0; repro: type then reload loses the text; waits: task:task_b1'],
    ['task_b1 Tune the index', 'offered', 'writes: b.md; topic: index; priority: P2; waits: task:task_c1'],
    ['task_c1 Measure the index', 'offered', 'writes: c.md; topic: measure; priority: P3'],
    ['task_d1 Fix the cursor', 'offered', 'writes: d.md; topic: cursor; priority: P1; repro: click past the end; waits: task:task_e1'],
    ['task_e1 Probe the cursor', 'offered', 'writes: e.md; topic: probe; priority: P3'],
    ['task_f1 Tidy the toolbar', 'offered', 'writes: f.md; topic: toolbar; priority: P2; waits: task:task_g1'],
    ['task_g1 Fix the toolbar focus', 'offered', 'writes: g.md; topic: focus; priority: P1; repro: tab past the last button'],
  ]);
  assert.equal(written.status, 0, written.stderr);
  const board = chips().stdout;
  assert.match(board, /Ready, P0 \(1\)\n {2}task_c1 {2}Measure the index {2}\[measure\] {2}blocks task_b1 {2}no card\n/, 'a P3 task under a P2 that a P0 waits on ranks P0');
  assert.match(board, /Ready, P1 \(2\)\n {2}task_e1 {2}Probe the cursor {2}\[probe\] {2}blocks task_d1 {2}no card\n {2}task_g1 {2}Fix the toolbar focus {2}\[focus\] {2}no card\n/, 'a less urgent waiter lowers nothing');
  assert.match(board, /Waiting, P0 \(2\)\n {2}task_a1 [^\n]*\n {2}task_b1 {2}Tune the index {2}\[index\] {2}blocks task_a1 {2}waits on task:task_c1 offered\n/);
  assert.match(chips('brief', 'task_c1').stdout, /^\[P0\] Measure the index\n\nTopic: measure\. Kind: fix\. Effort: high\. Priority: P0, from task_b1, which waits on it; its own is P3\.\n/);
  assert.match(chips('stale').stdout, /task_c1 [^\n]*priority P0 \(own P3, from task_b1\);/);
  assert.equal(chip('task_a1 Fix the lost save', 'dismissed done').status, 0);
  assert.match(chips('brief', 'task_c1').stdout, /^\[P2\] [^\n]*\n\n[^\n]*Priority: P2, from task_b1, which waits on it; its own is P3\./, 'the lift follows the waiters still open');
});

test('chips raises a task through waits logged after it, never from a started task, and shows its own priority once nothing more urgent waits', () => {
  const { batch, chip, chips } = chipLedger();
  const written = batch([
    ['task_m1 Measure the index', 'offered', 'writes: m.md; topic: measure; priority: P3'],
    ['task_n1 Tune the index', 'offered', 'writes: n.md; topic: index; priority: P2; waits: task:task_m1'],
    ['task_o1 Fix the lost save', 'offered', 'writes: o.md; topic: save; priority: P0; repro: type then reload loses the text; waits: task:task_n1'],
  ]);
  assert.equal(written.status, 0, written.stderr);
  assert.match(chips('brief', 'task_m1').stdout, /^\[P0\] [^\n]*\n\n[^\n]*Priority: P0, from task_n1, which waits on it; its own is P3\./, 'the raise climbs a chain whose waiters come later in the ledger');
  const started = chip('task_o1 Fix the lost save', 'started', 'session: s9');
  assert.equal(started.status, 0, started.stderr);
  assert.match(chips('brief', 'task_m1').stdout, /^\[P2\] [^\n]*\n\n[^\n]*Priority: P2, from task_n1, which waits on it; its own is P3\./, "a started task's waits no longer count");
  assert.equal(chip('task_n1 Tune the index', 'dismissed declined').status, 0);
  assert.match(chips('brief', 'task_m1').stdout, /^\[P3\] Measure the index\n\nTopic: measure\. Kind: fix\. Effort: high\. Priority: P3\.\n/);
  assert.match(chips('stale').stdout, /task_m1 [^\n]*priority P3;/);
  assert.doesNotMatch(chips('stale').stdout, /task_m1 [^\n]*own/);
});

test("a card stays when its task's priority changes, because its session prints the current brief", () => {
  const { chip, chips, offer } = chipLedger();
  assert.equal(offer('task_d1 Tune the index', 'd.md', 'topic: index; priority: P2; card: c1; session: s1').status, 0);
  assert.equal(chip('task_w1 Fix the lost save', 'offered', 'writes: w.md; topic: save; priority: P0; repro: type then reload loses the text; waits: task:task_d1').status, 0);
  assert.match(chips('brief', 'task_d1').stdout, /^\[P0\] Tune the index\n/, 'the brief shows the raised priority');
  assert.doesNotMatch(chips('--session', 's1').stdout, /withdraw task_d1/, 'a raised priority withdraws no card');
});

test('a task that only a waiting task raises gets a prioritize item before any card', () => {
  const { chip, chips, offer, root, LEDGER } = chipLedger();
  assert.equal(offer('task_a1 Fix a', 'src/a.ts', 'topic: one').status, 0);
  writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + ['2026-01-01T10:00:00Z', 'chip', 'task_o1 Fix the old docs', 'why', 'writes: docs/o.md', 'offered'].join('\t') + '\n');
  assert.equal(chip('task_o1 Fix the old docs', 'updated', 'topic: docs; waits: none').status, 0);
  assert.equal(chip('task_w1 Fix the lost save', 'offered', 'writes: w.md; topic: save; priority: P0; repro: type then reload loses the text; waits: task:task_o1').status, 0);
  assert.match(chips().stdout, /Do, ledger pass \(1\)\n {2}prioritize task_o1:/, 'a raise is no priority of its own');
  assert.match(chips('brief', 'task_o1').stdout, /Priority: P0, from task_w1, which waits on it; its own is none yet\./);
  assert.equal(chip('task_o1 Fix the old docs', 'updated', 'priority: P3').status, 0);
  assert.match(chips().stdout, /Do, card pass[\s\S]*card task_o1:/);
});

test('chips offers each open item of the ship list as a P1 task with the waits the item names', () => {
  const { chips, offer, root } = chipLedger();
  assert.equal(offer('task_c1 Fix the cursor', 'c.md', 'topic: cursor; priority: P1; repro: click past the end').status, 0);
  writeFileSync(join(root, '.agents/pstack.json'), JSON.stringify({ branch: 'next', chips: { ship: [process.execPath, 'ship.mjs'] } }));
  writeFileSync(join(root, 'ship.mjs'), "import { readFileSync } from 'node:fs';\nprocess.stdout.write(readFileSync('ship.json', 'utf8'));\n");
  const items = (list) => writeFileSync(join(root, 'ship.json'), JSON.stringify(list));
  items([
    { id: 'r1', title: 'Settle review item r1 (xhigh)', finding: 'r1 is open', writes: ['docs/plans'], topic: 'review-r1', kind: 'decide' },
    { id: 'r2', title: 'Settle review item r2 (xhigh)', finding: 'r2 is open', writes: ['docs/plans'], topic: 'review-r2', kind: 'decide' },
    { id: 'r3', title: 'Settle review item r3 (xhigh)', finding: 'r3 is open', writes: ['docs/plans'], topic: 'review-r3', kind: 'decide', waits: ['run:docs/plans/r3.md'] },
  ]);
  const shown = chips();
  const board = shown.stdout;
  assert.match(board, /Do, ledger pass \(3\)\n {2}offer ship item r1, which no open task serves: append chip "t_[0-9a-f]+ Settle review item r1 \(xhigh\)" "r1 is open" "writes: docs\/plans; topic: review-r1; kind: decide; priority: P1; ship: r1" offered\n {2}offer ship item r2/, shown.stderr);
  assert.match(board, /offer ship item r3, [^\n]*; ship: r3; waits: run:docs\/plans\/r3\.md" offered/, 'an item a plan works on is offered waiting on that plan');
  assert.equal(offer('task_s1 Settle review item r1 (xhigh)', 'docs/plans', 'topic: review-r1; kind: decide; priority: P1; ship: r1').status, 0);
  const closed = offer('task_s9 Settle review item r9 (xhigh)', 'docs/plans', 'topic: review-r9; kind: decide; priority: P1; ship: r9');
  assert.match(closed.stderr, /ship: r9 is not an open item of the project's ship list/);
  items([{ id: 'r2', title: 'Settle review item r2 (xhigh)', writes: ['docs/plans'] }]);
  assert.match(chips('stale').stdout, /task_s1 [^\n]*priority P1; ship item r1 is no longer open/);
  writeFileSync(join(root, 'ship.mjs'), 'process.exit(3);\n');
  assert.match(chips().stdout, /No ship list: [^\n]*ship\.mjs failed/);
});

test('no session owns a ship-list task, so any session cards it', () => {
  const { chip, chips, offer, root } = chipLedger();
  writeFileSync(join(root, '.agents/pstack.json'), JSON.stringify({ branch: 'next', chips: { ship: [process.execPath, 'ship.mjs'] } }));
  writeFileSync(join(root, 'ship.mjs'), "import { readFileSync } from 'node:fs';\nprocess.stdout.write(readFileSync('ship.json', 'utf8'));\n");
  writeFileSync(join(root, 'ship.json'), JSON.stringify([
    { id: 'r1', title: 'Settle review item r1', finding: 'r1 is open', writes: ['docs/plans'], topic: 'review-r1', kind: 'fix' },
    { id: 'r2', title: 'Settle review item r2', finding: 'r2 is open', writes: ['docs/plans'], topic: 'review-r2', kind: 'fix' },
  ]));
  assert.equal(offer('task_a1 Fix the parser', 'src/a.ts', 'topic: a; session: s2').status, 0);
  assert.match(chips('--session', 's1').stdout, /offer ship item r1[^\n]*"writes: docs\/plans; topic: review-r1; kind: fix; priority: P1; ship: r1" offered/, 'a ship offer names no session');
  assert.equal(offer('task_s1 Settle review item r1', 'docs/plans', 'topic: review-r1; priority: P1; ship: r1; session: s2').status, 0);
  assert.equal(offer('task_s2 Settle review item r2', 'docs/plans', 'topic: review-r2; priority: P1; ship: r2').status, 0);
  const own = chips('--session', 's1').stdout;
  assert.match(own, /Do, card pass \(2\)\n {2}card task_s1:[^\n]*\n {2}card task_s2:/, 'a ship task an older offer gave to s2 is cardable from s1');
  assert.match(own, /Other owners \(1\)\n {2}session s2 {2}1 open: task_a1\n/, 'the ship task is not listed under another owner');
  assert.equal(chip('task_s1 Settle review item r1', 'carded', 'card: c1; session: s1').status, 0);
  assert.equal(chip('task_s1 Settle review item r1', 'uncarded', 'card: c1').status, 0);
  assert.equal(chip('task_s1 Settle review item r1', 'updated', 'session: s1').status, 0);
  assert.equal(chip('task_s1 Settle review item r1', 'carded', 'card: c2; session: s3').status, 0, 'neither carding nor an updated session: makes a ship task one session\'s');
  assert.equal(chip('task_a1 Fix the parser', 'carded', 'card: c3; session: s1').status, 1, 'a task off the ship list keeps its owner');
});

test('chips stale lists each open task with the paths it writes that were deleted since its offer or are missing, and the commits on its paths since its offer', () => {
  const { chip, chips, offer, root } = chipLedger();
  writeFileSync(join(root, 'kept.md'), 'old\n');
  writeFileSync(join(root, 'gone.md'), 'old\n');
  spawnSync('git', ['-C', root, 'add', 'kept.md', 'gone.md']);
  const earlier = new Date(Date.now() - 86_400_000).toISOString();
  spawnSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'add kept'], { env: { ...process.env, GIT_AUTHOR_DATE: earlier, GIT_COMMITTER_DATE: earlier } });
  assert.equal(offer('task_a1 Fix a', 'kept.md, gone.md, new.md', 'topic: stale').status, 0);
  assert.equal(offer('task_b1 Fix b', 'docs/plans', 'topic: fresh; card: c1; session: s1').status, 0);
  assert.equal(offer('task_c1 Fix c', 'src/c.ts', 'topic: closed').status, 0);
  assert.equal(chip('task_c1 Fix c', 'dismissed done').status, 0);
  writeFileSync(join(root, 'kept.md'), 'new\n');
  spawnSync('git', ['-C', root, 'rm', '-q', 'gone.md']);
  const later = new Date(Date.now() + 86_400_000).toISOString();
  spawnSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qam', 'fix kept'], { env: { ...process.env, GIT_AUTHOR_DATE: later, GIT_COMMITTER_DATE: later } });
  const stale = chips('stale');
  assert.equal(stale.status, 0, stale.stderr);
  assert.equal(
    stale.stdout,
    '2 open suggested tasks in docs/plans/suggested-tasks.decisions.tsv, the likeliest stale first:\n' +
      '  task_a1  Fix a  [stale]  age 0d; priority P1; deleted since its offer: gone.md; missing: new.md; 1 commit on its paths since its offer, last "fix kept"\n' +
      '  task_b1  Fix b  [fresh]  age 0d; priority P1; card c1 in session s1\n',
  );
});

test('a legacy row with an empty waits: replays as no waits', () => {
  const { chips, offer, root, LEDGER } = chipLedger();
  assert.equal(offer('task_a1 Fix a', 'src/a.ts', 'topic: blank; waits: pr:5').status, 0);
  writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + ['2026-01-01T10:00:00Z', 'chip', 'task_a1 Fix a', 'why', 'waits:', 'updated'].join('\t') + '\n');
  const board = chips();
  assert.equal(board.status, 0, board.stdout);
  assert.match(board.stdout, /Ready, P1 \(1\)\n {2}task_a1 {2}Fix a {2}\[blank\] {2}no card\n/, 'a row the previous helper read as clearing the waits');
});

test('chips brief on a replaced task prints its replacement\'s brief', () => {
  const { chips, offer, root, LEDGER } = chipLedger();
  assert.equal(offer('task_n1 Fix the badge', 'README.md', 'topic: badge').status, 0);
  const rows = [
    ['task_o1 Now: Fix the badge', 'writes: README.md', 'offered'],
    ['task_o1 Now: Fix the badge', 'retitled', 'dismissed replaced task_n1'],
  ];
  writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + rows.map(([decision, evidence, result]) => ['2026-01-01T10:00:00Z', 'chip', decision, 'why', evidence, result].join('\t')).join('\n') + '\n');
  const brief = chips('brief', 'task_o1');
  assert.equal(brief.status, 0, brief.stderr);
  assert.match(brief.stdout, /^task_o1 was replaced by task_n1; work from its brief\.\n\n\[P1\] Fix the badge\n/, 'an old card whose task an older helper replaced');
});

test('a design question moved into the topic of a design question it absorbed counts once', () => {
  const { chip, chips, offer } = chipLedger();
  assert.equal(offer('task_k1 Decide the export format (xhigh)', 'src/e.ts', 'topic: export; kind: decide').status, 0);
  assert.equal(offer('task_d1 Decide the file format (xhigh)', 'src/f.ts', 'topic: format; kind: decide').status, 0);
  assert.equal(chip('task_d1 Decide the file format (xhigh)', 'dismissed dup task_k1').status, 0);
  assert.equal(chip('task_k1 Decide the export format (xhigh)', 'updated', 'topic: format').status, 0);
  const board = chips();
  assert.equal(board.status, 0, 'a task that is not its own rival: ' + board.stdout);
});

test('a design question in a topic a merge left is judged by that topic alone', () => {
  const { chip, helper, offer, LEDGER } = chipLedger();
  assert.equal(offer('task_k1 Decide the export format (xhigh)', 'src/e.ts', 'topic: export; kind: decide').status, 0);
  assert.equal(offer('task_d1 Decide the file format (xhigh)', 'src/f.ts', 'topic: format; kind: decide').status, 0);
  assert.equal(chip('task_d1 Decide the file format (xhigh)', 'dismissed dup task_k1').status, 0);
  assert.equal(chip('task_k1 Decide the export format (xhigh)', 'started').status, 0);
  assert.equal(offer('task_n1 Decide the format version (xhigh)', 'src/n.ts', 'topic: format; kind: decide').status, 0, 'a design question an older helper accepted after the merge');
  const whole = helper(LEDGER);
  assert.equal(whole.status, 0, whole.stderr);
});

test('chips leaves a prose wait on a task with no topic to its migration', () => {
  const { chips, offer, root, LEDGER } = chipLedger();
  assert.equal(offer('task_a1 Fix a', 'src/a.ts', 'topic: other').status, 0);
  writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + ['2026-01-01T10:00:00Z', 'chip', 'task_o1 Fix o1', 'why', 'writes: src/o1.ts; waits: the parser PR', 'offered'].join('\t') + '\n');
  const board = chips();
  assert.equal(board.status, 0, 'the prose wait the migration states again: ' + board.stdout);
  assert.match(board.stdout, /migrate task_o1: log updated with topic:, priority: and the waits: it has/);
});

test('chips reports a wait loop between tasks that have no topic', () => {
  const { chips, offer, root, LEDGER } = chipLedger();
  assert.equal(offer('task_a1 Fix a', 'src/a.ts', 'topic: other').status, 0);
  const rows = [
    ['task_o1 Fix o1', 'writes: src/o1.ts', 'offered'],
    ['task_o2 Fix o2', 'writes: src/o2.ts; waits: task:task_o1', 'offered'],
    ['task_o1 Fix o1', 'waits: task:task_o2', 'updated'],
  ];
  writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + rows.map(([decision, evidence, result]) => ['2026-01-01T10:00:00Z', 'chip', decision, 'why', evidence, result].join('\t')).join('\n') + '\n');
  const board = chips();
  assert.equal(board.status, 1, 'a loop an older helper let through');
  assert.match(board.stdout, /fix task_o1's wait: task:task_o2 waits back on task_o1/);
});

test('two design questions with no topic are not one topic', () => {
  const { helper, offer, root, LEDGER } = chipLedger();
  assert.equal(offer('task_a1 Fix a', 'src/a.ts', 'topic: other').status, 0);
  const rows = [
    ['task_o1 Decide the export format (xhigh)', 'writes: src/e.ts; kind: decide', 'offered'],
    ['task_o2 Decide the render order (xhigh)', 'writes: src/r.ts; kind: decide', 'offered'],
  ];
  writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + rows.map(([decision, evidence, result]) => ['2026-01-01T10:00:00Z', 'chip', decision, 'why', evidence, result].join('\t')).join('\n') + '\n');
  const whole = helper(LEDGER);
  assert.equal(whole.status, 0, 'two older design questions that name no topic: ' + whole.stderr);
});

test('chips reports a dangling wait on a task with no topic', () => {
  const { chips, offer, root, LEDGER } = chipLedger();
  assert.equal(offer('task_a1 Fix a', 'src/a.ts', 'topic: other').status, 0);
  writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + ['2026-01-01T10:00:00Z', 'chip', 'task_o1 Fix o1', 'why', 'writes: src/o1.ts; waits: task:task_zz', 'offered'].join('\t') + '\n');
  const board = chips();
  assert.equal(board.status, 1, 'a typed wait that can never clear');
  assert.match(board.stdout, /fix task_o1's wait: task:task_zz dangling, no such task/);
});

test('a card prompt asks to load the brief again after the started row', () => {
  const { chips, offer } = chipLedger();
  assert.equal(offer('task_a1 Fix the parser', 'src/p.ts', 'topic: parser').status, 0);
  assert.match(chips('brief', 'task_a1').stdout, /log a started row [^\n]*, then run cd [^\n]* && node \.agents\/pstack\/decisions-check\.mjs chips brief task_a1 again and work from what it prints, because the task can gain work until your started row\./, 'a merge between reading the brief and the started row');
});

test('a card prompt names the stored decision, shell-quoted, so its started row appends', () => {
  const { chip, chips, offer } = chipLedger();
  const decision = 'task_a1 Fix the "$HOME" parser';
  assert.equal(offer(decision, 'src/p.ts', 'topic: parser').status, 0);
  const quoted = chips('brief', 'task_a1').stdout.match(/ chip ("(?:[^"\\]|\\.)*") "<why>" "<tokens>" <result>/u)?.[1];
  assert.ok(quoted, 'the prompt shows the row command');
  const parsed = spawnSync('sh', ['-c', `printf %s ${quoted}`], { encoding: 'utf8' }).stdout;
  assert.equal(parsed, decision);
  assert.equal(chip(parsed, 'started', 'session: s1').status, 0);
});

test('a chain of dups carries every title and drops each wait that now leads back to the kept task', () => {
  const { chip, chips, offer } = chipLedger();
  assert.equal(offer('task_a1 Fix a', 'src/a.ts', 'topic: alias').status, 0);
  assert.equal(offer('task_b1 Fix b', 'src/b.ts', 'topic: alias').status, 0);
  assert.equal(offer('task_c1 Fix c', 'src/c.ts', 'topic: alias').status, 0);
  assert.equal(chip('task_c1 Fix c', 'dismissed dup task_b1').status, 0);
  assert.equal(chip('task_a1 Fix a', 'updated', 'waits: task:task_c1').status, 0);
  assert.equal(chip('task_b1 Fix b', 'dismissed dup task_a1').status, 0);
  assert.match(chips().stdout, /Ready, P1 \(1\)\n {2}task_a1 {2}Fix a {2}\[alias\] {2}no card\n/, 'a wait on a task merged earlier into the one now merged');
  assert.match(chips('brief', 'task_a1').stdout, /Also covers:\n- task_b1 Fix b\n {2}- why\n- task_c1 Fix c\n {2}- why\n/, 'titles merged earlier come along');
  assert.match(chip('task_a1 Fix a', 'updated', 'waits: task:task_c1').stderr, /task_a1 cannot wait on itself/, 'a wait on a task merged into this one');
});

test('a dup keeps a design question a design question, and is refused only when it makes a second one', () => {
  const { chip, chips, offer, root, LEDGER } = chipLedger();
  const legacy = (decision, evidence) => writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + ['2026-01-01T10:00:00Z', 'chip', decision, 'why', evidence, 'offered'].join('\t') + '\n');
  assert.equal(offer('task_k1 Fix the export', 'src/e.ts', 'topic: export').status, 0);
  assert.equal(offer('task_d1 Decide the export format (xhigh)', 'src/f.ts', 'topic: export; kind: decide').status, 0);
  assert.equal(chip('task_d1 Decide the export format (xhigh)', 'dismissed dup task_k1').status, 0);
  assert.match(chips().stdout, /task_k1 {2}Fix the export \(xhigh\) {2}\[export, decide\]/, 'the kept task takes the design question');
  assert.match(chips('brief', 'task_k1').stdout, /settles a design question first/);
  assert.equal(offer('task_e1 Decide the import format (xhigh)', 'src/g.ts', 'topic: import; kind: decide').status, 0);
  legacy('task_e2 Decide the import shape (xhigh)', 'writes: src/h.ts; topic: import; kind: decide');
  assert.equal(offer('task_e3 Fix the importer', 'src/i.ts', 'topic: import').status, 0);
  assert.match(chip('task_e2 Decide the import shape (xhigh)', 'dismissed dup task_e3').stderr, /topic import already has the open design question task_e1; log task_e2 dismissed dup task_e1 instead/, 'a dup that makes a second design question in one topic');
  const rows = ['task_f1 Decide the badge', 'task_f2 Decide the badge link', 'task_f3 Decide the badge color'].map((decision) => ['2026-01-01T10:00:00Z', 'chip', decision, 'why', 'writes: README.md; topic: badge; kind: decide', 'offered'].join('\t'));
  writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + rows.join('\n') + '\n');
  assert.match(chips().stdout, /fold topic badge: task_f1 and task_f2 and task_f3 are both open design questions/);
  assert.equal(chip('task_f2 Decide the badge link', 'dismissed dup task_f1').status, 0, 'a dup between design questions while a third stays');
  assert.equal(chip('task_f3 Decide the badge color', 'dismissed dup task_f1').status, 0);
  assert.doesNotMatch(chips().stdout, /fold topic badge/);
});

test('chips reads a PR merge only from a commit subject on the project branch', () => {
  const { chips, offer, root } = chipLedger();
  const git = (...args) => spawnSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args]);
  git('commit', '-q', '--allow-empty', '-m', 'Routine maintenance', '-m', 'Prepares the rewrite (#77)');
  git('update-ref', 'refs/remotes/origin/next', 'HEAD');
  git('commit', '-q', '--allow-empty', '-m', 'Merge pull request #78 from a/stacked');
  git('update-ref', 'refs/remotes/origin/feature', 'HEAD');
  git('commit', '-q', '--allow-empty', '-m', 'Merge pull request #79 from a/release');
  git('update-ref', 'refs/remotes/origin/release/next', 'HEAD');
  assert.equal(offer('task_a1 Fix the parser', 'src/p.ts', 'topic: parser; waits: pr:77').status, 0);
  assert.equal(offer('task_a2 Fix the printer', 'src/q.ts', 'topic: printer; waits: pr:78').status, 0);
  assert.equal(offer('task_a3 Fix the lexer', 'src/l.ts', 'topic: lexer; waits: pr:79').status, 0);
  const board = chips().stdout;
  assert.match(board, /task_a1 {2}Fix the parser {2}\[parser\] {2}waits on pr:77 not merged/, 'a PR number in a commit body');
  assert.match(board, /task_a2 {2}Fix the printer {2}\[printer\] {2}waits on pr:78 not merged/, 'a merge into a branch that is not the project branch');
  assert.match(board, /task_a3 {2}Fix the lexer {2}\[lexer\] {2}waits on pr:79 not merged/, 'a branch whose name only ends in the project branch');
});

test('a ready task with a card keeps its place when an earlier task frees up', () => {
  const { chips, merge, offer, outside } = chipLedger();
  assert.equal(offer('task_a1 Rewrite the README', outside('README.md'), 'topic: readme; waits: pr:99').status, 0);
  assert.equal(offer('task_b1 Fix the badge', outside('README.md'), 'topic: badge; card: c1; session: s1').status, 0);
  merge('Merge pull request #99 from a/readme');
  const board = chips();
  assert.match(board.stdout, /Ready, P1 \(1\)\n {2}task_b1 {2}Fix the badge {2}\[badge\] {2}card c1/, 'the card stays');
  assert.match(board.stdout, /task_a1 {2}Rewrite the README {2}\[readme\] {2}waits on queued behind task_b1/);
  assert.equal(board.status, 0, board.stdout);
});

test('a running design question takes later findings as a new question that waits on it, and takes only a new owned check', () => {
  const { appendTo, chip, offer } = chipLedger();
  const landing = 'task_d1 Decide where pasted content lands (xhigh)';
  assert.equal(offer(landing, 'src/core', 'topic: landing; kind: decide').status, 0);
  assert.equal(chip(landing, 'started').status, 0);
  const next = 'task_d2 Decide where dropped content lands (xhigh)';
  assert.match(offer(next, 'src/core', 'topic: landing; kind: decide').stderr, /topic landing's design question task_d1 is running; a new one waits on it with waits: task:task_d1/);
  assert.equal(offer(next, 'src/core', 'topic: landing; kind: decide; waits: task:task_d1').status, 0);
  assert.equal(chip(landing, 'updated', 'owns: ci:landing').status, 0, 'a started task takes the check it fixes');
  assert.equal(appendTo('docs/plans/2026-01-01-fix.decisions.tsv', 'verify', 'read CI', 'base-red: ci:landing; proof: none', 'gap: fails on next too').status, 0);
  for (const token of ['writes: src/other', 'topic: other', 'kind: fix', 'waits: pr:5']) {
    assert.match(chip(landing, 'updated', token).stderr, /task_d1 is started, so an updated row on it takes only owns:; the session adds paths with another started row/, `a started task's ${token.split(':')[0]}`);
  }
});

test('a card goes only to a task that is ready before the card, and names the session that holds it', () => {
  const { chip, chips, offer, outside } = chipLedger();
  assert.equal(offer('task_a1 Rewrite the README', outside('README.md'), 'topic: readme').status, 0);
  assert.equal(offer('task_b1 Fix the badge', outside('README.md'), 'topic: badge').status, 0);
  const queued = chip('task_b1 Fix the badge', 'carded', 'card: c1; session: s1');
  assert.equal(queued.status, 1, 'a card would move a queued task ahead of the task it waits behind');
  assert.match(queued.stderr, /task_b1 cannot start yet \(queued behind task_a1, which writes the same paths outside this checkout\), so it gets no card/);
  assert.match(offer('task_c1 Fix the title', outside('README.md'), 'topic: title; card: c2; session: s1').stderr, /task_c1 cannot start yet \(queued behind task_a1/, 'an offer with a card');
  assert.match(chip('task_a1 Rewrite the README', 'carded', 'card: c3').stderr, /a card names the session that holds it as "session: <id>"/);
  assert.equal(chip('task_a1 Rewrite the README', 'carded', 'card: c3; session: s1').status, 0);
  assert.equal(offer('task_d1 Fix the lexer', 'src/l.ts', 'topic: lexer; card: c4; session: s2').status, 0);
  const here = chips('--session', 's1');
  assert.equal(here.status, 0, here.stdout);
  assert.match(here.stdout, /task_d1 {2}Fix the lexer {2}\[lexer\] {2}card c4 in session s2\n/);
  assert.match(here.stdout, /check session s2, which holds task_d1's card c4: when the session tool reports it archived or gone, log uncarded/);
  assert.doesNotMatch(here.stdout, /check session s1/, "this session's own cards");
  assert.doesNotMatch(chips().stdout, /check session/, 'a board read without a session');
  assert.equal(offer('task_f1 Fix the printer', 'src/p.ts', 'topic: printer; session: s1').status, 0, 'an offer names the session that offered it, with or without a card');
  assert.doesNotMatch(chips('--session', 's1').stdout, /task_f1 {2}Fix the printer {2}\[printer\] {2}card/, 'the offering session holds no card until it cards the task');
  assert.equal(offer('task_g1 Fix the writer', 'src/w.ts', 'topic: writer; waits: pr:5; card: c5; session: s2').status, 1, 'a waiting task gets no card');
  assert.equal(offer('task_g2 Fix the reader', outside('r.md'), 'topic: reader; card: c6; session: s2').status, 0);
  assert.equal(offer('task_g3 Rewrite the reader', outside('r.md'), 'topic: reader-rewrite').status, 0);
  assert.equal(chip('task_g3 Rewrite the reader', 'started').status, 0);
  assert.match(chips('--session', 's1').stdout, /check session s2, which holds task_g2's card c6 on a task that now waits on started task_g3 writes its paths outside this checkout: when the session tool reports it archived or gone, log uncarded with card: c6/, 'a card another session holds on a task that has to wait');
  const missing = chips('--session', '--fetch');
  assert.equal(missing.status, 2, 'a flag where the session id goes');
  assert.match(missing.stderr, /--session takes this session's id/);
});

test('a started row names the session that started the task, and a sweep checks that session', () => {
  const { chip, chips, offer } = chipLedger();
  const parser = 'task_a1 Fix the parser';
  assert.equal(offer(parser, 'src/p.ts', 'topic: parser').status, 0);
  assert.equal(chip(parser, 'started').status, 0, 'a start the dismiss tool reported, which names no session');
  assert.match(chips('--session', 's1').stdout, /find the session that started task_a1 with the session tool, [^\n]*log started with session: <its id>; when the search finds none, task_a1 stays started/);
  assert.match(chip(parser, 'started', 'session: two words').stderr, /session: names the session id as one token; a field runs to the next ";", so end it with ";" before more evidence/);
  assert.equal(chip(parser, 'started', 'session: s2').status, 0);
  const here = chips('--session', 's1');
  assert.match(here.stdout, /Started \(1\)\n {2}task_a1 {2}Fix the parser {2}\[parser\] {2}session s2\n/);
  assert.match(here.stdout, /check session s2, which started task_a1: when the session tool reports it archived, log landed when a commit holds its change or its last report says it landed the change, with patch: when it names one; when that report hands back a patch it never applied, land that patch as chips brief's footer says and log landed with patch:; and log dismissed stopped when it hands back no patch and neither this checkout nor its worktree holds an uncommitted edit on its paths/);
  assert.doesNotMatch(chips('--session', 's2').stdout, /started task_a1/, "the session's own task");
  assert.doesNotMatch(chips().stdout, /started task_a1/, 'a board read without a session');
  assert.match(chips('stale').stdout, /task_a1 {2}Fix the parser {2}\[parser\] {2}age 0d; priority P1; started in session s2;/);
  assert.equal(chip(parser, 'dismissed stopped').status, 0);
  assert.doesNotMatch(chips('--session', 's1').stdout, /task_a1/);
});

test('chips reports a wait that loops back as one that can never clear', () => {
  const { chip, chips, offer, root, LEDGER } = chipLedger();
  assert.match(offer('task_a1 Fix a', 'src/a.ts', 'topic: loop; waits: task:task_a1').stderr, /task_a1 cannot wait on itself/);
  assert.equal(offer('task_a1 Fix a', 'src/a.ts', 'topic: loop').status, 0);
  assert.equal(offer('task_b1 Fix b', 'src/b.ts', 'topic: loop; waits: task:task_a1').status, 0);
  writeFileSync(join(root, LEDGER), readFileSync(join(root, LEDGER), 'utf8') + ['2026-01-01T10:00:00Z', 'chip', 'task_a1 Fix a', 'why', 'waits: task:task_b1', 'updated'].join('\t') + '\n');
  assert.equal(offer('task_c1 Fix c', 'src/c.ts', 'topic: merge; waits: task:task_d1').status, 0);
  assert.equal(offer('task_d1 Fix d', 'src/d.ts', 'topic: merge').status, 0);
  assert.equal(chip('task_d1 Fix d', 'dismissed dup task_c1').status, 0);
  assert.equal(offer('task_e1 Fix e', 'src/e.ts', 'topic: stale').status, 0);
  assert.equal(offer('task_e2 Fix e2', 'src/e2.ts', 'topic: stale; waits: task:task_e1').status, 0);
  assert.equal(chip('task_e2 Fix e2', 'started').status, 0);
  assert.equal(chip('task_e1 Fix e', 'updated', 'waits: task:task_e2').status, 0);
  const board = chips();
  assert.match(board.stdout, /fix task_a1's wait: task:task_b1 waits back on task_a1/, 'two tasks that wait on each other');
  assert.match(board.stdout, /Ready, P1 \([0-9]+\)\n(?: {2}.*\n)* {2}task_c1 {2}Fix c {2}\[merge\] {2}no card\n/, 'a merge drops the kept task\'s wait on the task it absorbed');
  assert.match(board.stdout, /task_e1 {2}Fix e {2}\[stale\] {2}waits on task:task_e2 started\n/, 'a started task\'s old waits never loop');
  assert.doesNotMatch(board.stdout, /task_e2 waits back/);
  assert.equal(board.status, 1);
});

test('decisions-check reads every copy of a token and refuses one a row would ignore', () => {
  const { appendTo, chip, offer } = chipLedger();
  assert.equal(offer('task_a1 Make next green', '.github', 'topic: green; owns: ci:a').status, 0);
  assert.match(appendTo('docs/plans/2026-01-01-fix.decisions.tsv', 'verify', 'read CI', 'base-red: ci:a; base-red: ci:b; proof: none', 'gap: fails on next too').stderr, /base-red: ci:b has no open suggested task that owns it/, 'a second base-red token');
  assert.match(offer('task_b1 Fix the badge', 'README.md', 'topic: badge; topic: docs').stderr, /names topic: once/);
  assert.match(chip('task_a1 Make next green', 'started', 'topic: other').stderr, /a started row does not take topic:/);
  assert.match(chip('task_a1 Make next green', 'updated', 'card: c9').stderr, /an updated row does not take card:/);
});

test('chips lists the tasks a dropped card closed, so a sweep can reopen them', () => {
  const { LEDGER, chips, root } = chipLedger();
  writeFileSync(join(root, LEDGER), ledgerRows([
    ['task_g1 After: Fix the release notes', 'writes: CHANGES.md', 'offered'],
    ['task_g1 After: Fix the release notes', 'the queue dropped it', 'dismissed gone'],
  ]));
  const board = chips();
  assert.equal(board.status, 0, board.stderr);
  assert.match(board.stdout, /Lost \(1\)\n {2}task_g1 {2}Fix the release notes/);
  assert.match(board.stdout, /reopen task_g1 or close it/);
});

test('two tasks on one project path are both ready, and a started one holds nothing back', () => {
  const { chip, chips, offer } = chipLedger();
  assert.equal(offer('task_a1 Fix the reader', 'src/r.ts', 'topic: reader').status, 0);
  assert.equal(offer('task_b1 Speed up the reader', 'src/r.ts', 'topic: reader-speed').status, 0);
  assert.match(chips().stdout, /Ready, P1 \(2\)\n {2}task_a1 {2}Fix the reader {2}\[reader\] {2}no card {2}shares paths with task_b1\n {2}task_b1 [^\n]*shares paths with task_a1\n/);
  assert.equal(chip('task_a1 Fix the reader', 'started').status, 0);
  const board = chips().stdout;
  assert.match(board, /Ready, P1 \(1\)\n {2}task_b1 {2}Speed up the reader {2}\[reader-speed\] {2}no card {2}shares paths with task_a1\n/, 'a started session on the same project path');
  assert.match(board, /card task_b1: it can start and has no card; first judge whether it needs the result of another open task, starting with task_a1, which writes its paths, or of an open design question its work builds on/);
});

test('a carded task takes an updated row that only adds waits, and the withdrawal pass then pulls its card', () => {
  const { chip, chips, offer } = chipLedger();
  assert.equal(offer('task_t1 Decide the title slot (xhigh)', 'src/details', 'topic: title-slot; kind: decide').status, 0);
  const toc = 'task_c1 List titles in the TOC';
  assert.equal(offer(toc, 'src/toc', 'topic: toc; card: c1; session: s1').status, 0);
  assert.equal(chip(toc, 'updated', 'waits: task:task_t1').status, 0, 'a dependency found after the card');
  assert.match(chips('--session', 's1').stdout, /Do, withdrawal pass \(1\)\n {2}withdraw task_c1's card c1: task:task_t1 offered;/);
  for (const change of ['waits: pr:5', 'waits: none']) {
    assert.match(chip(toc, 'updated', change).stderr, /task_c1 holds card c1, which cannot change; withdraw the card first/, `a row that drops a wait: ${change}`);
  }
  assert.equal(chip(toc, 'updated', 'waits: task:task_t1, pr:5').status, 0, 'another wait that keeps the first');
  const index = 'task_c2 Index the titles';
  assert.equal(offer(index, 'src/index', 'topic: index; card: c2; session: s2').status, 0);
  assert.equal(chip(index, 'updated', 'waits: task:task_t1').status, 0);
  assert.match(chips('--session', 's1').stdout, /check session s2, which holds task_c2's card c2 on a task that now waits on task:task_t1 offered/, "another session's card keeps its prompt, whose board check stops its session");
});

test('chips stale marks a task whose every finding is a migration note as possibly thin', () => {
  const { LEDGER, chips, root } = chipLedger();
  const rows = [
    ['task_m1 Fix the marks', 'moved from docs/plans/old.decisions.tsv; waits for: the paused review-tree run, docs/plans/x.md'],
    ['task_m2 Fix the toc', 'waits for: udecode/plate#5165 to merge into next'],
    ['task_m3 Fix the table', 'no open run or task writes its paths'],
    ['task_m4 Fix the line end', 'waits for: the started task task_f1, which changes the same code; merges task_a1 and task_a2'],
    ['task_r1 Fix the paste', 'waits for task_a1 because bold drops on paste; the parser loses the mark'],
    ['task_r2 Fix the badge', 'merged PRs left the badge stale'],
  ];
  writeFileSync(join(root, LEDGER), `ts\tphase\tdecision\twhy\tevidence\tresult\n${rows.map(([decision, why], index) => ['2026-01-01T10:00:00Z', 'chip', decision, why, `writes: src/f${index}.ts; topic: t${index}`, 'offered'].join('\t')).join('\n')}\n`);
  const stale = chips('stale').stdout;
  for (const id of ['task_m1', 'task_m2', 'task_m3', 'task_m4']) assert.match(stale, new RegExp(`${id} [^\\n]*possibly thin: every finding is a note an older migration wrote`), id);
  for (const id of ['task_r1', 'task_r2']) assert.doesNotMatch(stale, new RegExp(`${id} [^\\n]*possibly thin`), `${id} holds a real finding`);
});

test('a landed row names each commit that delivered the task, and append refuses a hash that is no commit', () => {
  const { chip, offer, root } = chipLedger();
  const parser = 'task_a1 Add the parser';
  assert.equal(offer(parser, 'src/p.ts', 'topic: parser').status, 0);
  assert.equal(chip(parser, 'started').status, 0);
  assert.match(chip(parser, 'landed', 'commit: deadbeef1').stderr, /commit: deadbeef1 is not a commit in this checkout; name each commit that delivered the task by its hash, after committing it\n/);
  assert.match(chip(parser, 'landed', 'commit: deadbeef1 scope: the parser').stderr, /commit: deadbeef1 scope: the parser is not a commit in this checkout; .*; a field runs to the next ";"/);
  spawnSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'parser']);
  const sha = spawnSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  assert.equal(chip(parser, 'landed', `commit: ${sha}`).status, 0);
});

test('chips cleanup lists the idle card sessions of landed tasks to archive and the worktrees of archived ones to remove, with commit links', () => {
  const { chip, chips, offer, root } = chipLedger();
  spawnSync('git', ['-C', root, 'remote', 'set-url', 'origin', 'https://github.com/acme/app.git']);
  spawnSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'fix']);
  const sha = spawnSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  const card = (name) => {
    const path = join(realpathSync(root), '.claude', 'worktrees', name);
    mkdirSync(path, { recursive: true });
    return path;
  };
  const sessions = [
    { sessionId: 's1', title: 'idle card', cwd: card('a'), isArchived: false, isRunning: false },
    { sessionId: 's2', title: 'archived card', cwd: card('b'), isArchived: true, isRunning: false },
    { sessionId: 's3', title: 'working card', cwd: card('c'), isArchived: false, isRunning: true },
    { sessionId: 's4', title: 'checkout session', cwd: realpathSync(root), isArchived: false, isRunning: false },
    { sessionId: 's5', title: 'pinned card', cwd: card('e'), isArchived: false, isRunning: false, pinned: true },
  ];
  for (const [n, session] of sessions.entries()) {
    const task = `task_${'abcde'[n]}1 Fix part ${n}`;
    assert.equal(offer(task, `src/${n}.ts`, `topic: part-${n}`).status, 0);
    assert.equal(chip(task, 'started', `session: ${session.sessionId}`).status, 0);
    assert.equal(chip(task, 'landed', n === 0 ? `commit: ${sha}` : 'evidence').status, 0);
  }
  writeFileSync(join(root, 'sessions.json'), JSON.stringify(sessions));
  const out = chips('cleanup', '--sessions', 'sessions.json').stdout;
  assert.match(out, /^Archive \(1\)[^\n]*\n {2}s1 {2}idle card\n/u, 'only the idle, unpinned card session is archived');
  assert.match(out, new RegExp(`Remove \\(1\\)[^\\n]*\\n {2}node \\.agents/skills/cleanup/scripts/scan\\.mjs --repo \\. --remove ${card('b').replace(/[.*+?^${}()|[\]\\/]/gu, '\\$&')}\\n`), 'the archived card worktree is removed');
  assert.match(out, new RegExp(`task_a1 Fix part 0: https://diffshub\\.com/acme/app/commit/${sha}`), 'the report links the named commit');
  assert.match(out, /task_b1 Fix part 1: no commit named/);
  assert.doesNotMatch(out, /task_[cde]1/, 'a working, checkout or pinned session is left alone');
});

test('a task that waits on a landed patch starts once a commit after the landing holds each path that patch touches', () => {
  const { chip, chips, offer, root } = chipLedger();
  const parser = 'task_a1 Add the parser';
  assert.equal(offer(parser, 'src/p.ts', 'topic: parser').status, 0);
  assert.equal(offer('task_b1 Use the parser', 'src/q.ts', 'topic: parser-use; waits: task:task_a1').status, 0);
  assert.equal(chip(parser, 'started').status, 0);
  const patch = 'docs/plans/artifacts/chips/task_a1.patch';
  assert.match(chip(parser, 'landed', `patch: ${patch}`).stderr, /patch: docs\/plans\/artifacts\/chips\/task_a1\.patch does not exist/);
  mkdirSync(join(root, 'docs/plans/artifacts/chips'), { recursive: true });
  writeFileSync(join(root, patch), 'diff --git a/src/p.ts b/src/p.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/p.ts\n@@ -0,0 +1 @@\n+export const parse = 1;\n');
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src/p.ts'), 'export const parse = 1;\n');
  assert.equal(chip(parser, 'landed', `patch: ${patch}`).status, 0);
  assert.match(chips().stdout, /task_b1 {2}Use the parser {2}\[parser-use\] {2}waits on task:task_a1 landed, waiting for a commit of src\/p\.ts/, 'a new card session starts from the last commit, which lacks the parser');
  spawnSync('git', ['-C', root, 'add', 'src/p.ts']);
  commit(root, 'parser');
  writeFileSync(join(root, 'src/p.ts'), 'export const parse = 2;\n');
  assert.match(chips().stdout, /Ready, P1 \(1\)\n {2}task_b1 {2}Use the parser/, "a later task's uncommitted edit on top of the committed parser does not hold the wait");
});

test('a session cards only the tasks it owns, and chips all takes the ones no live session owns', () => {
  const { chip, chips, offer, root } = chipLedger();
  assert.equal(offer('task_a1 Fix the parser', 'src/a.ts', 'topic: a; session: s1').status, 0);
  assert.equal(offer('task_b1 Fix the badge', 'src/b.ts', 'topic: b; session: s2').status, 0);
  assert.equal(offer('task_c1 Fix the clock', 'src/c.ts', 'topic: c').status, 0);
  assert.equal(offer('task_d1 Fix the dial', 'src/d.ts', 'topic: d; session: s3').status, 0);
  const own = chips('--session', 's1').stdout;
  assert.match(own, /Do, card pass \(1\)\n {2}card task_a1:/, 'a session cards only the task it offered');
  assert.match(own, /Other owners \(3\)\n {2}session s2 {2}1 open: task_b1\n {2}no owner {2}1 open: task_c1\n {2}session s3 {2}1 open: task_d1/);
  assert.match(chips().stdout, /Do, card pass \(4\)/, 'a runtime with no session tool cards every task');
  const refused = chip('task_b1 Fix the badge', 'carded', 'card: c1; session: s1');
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /task_b1 belongs to session s2, so only that session cards it/);
  const unlisted = chips('all', '--session', 's1').stdout;
  assert.match(unlisted, /Do, card pass \(2\)\n {2}card task_a1:[^\n]*\n {2}card task_c1:/, 'chips all cards a task no session owns');
  assert.doesNotMatch(unlisted, /take task_d1/, 'with no session list, no owner counts as gone');
  writeFileSync(join(root, 'sessions.json'), JSON.stringify([{ sessionId: 's1', isArchived: false }, { sessionId: 's2', isArchived: false }, { sessionId: 's3', isArchived: true }]));
  assert.match(chips('all', '--session', 's1', '--sessions', 'sessions.json').stdout, /Do, ledger pass \(1\)\n {2}take task_d1: its owner session s3 is archived or gone; log updated with session: s1/);
  assert.equal(chip('task_d1 Fix the dial', 'updated', 'session: s1').status, 0);
  assert.equal(chip('task_c1 Fix the clock', 'carded', 'card: c2; session: s1').status, 0, 'carding a task no session owns takes it');
  assert.match(chips('--session', 's1').stdout, /Do, card pass \(2\)\n {2}card task_a1:[^\n]*\n {2}card task_d1:/, 'a taken task is this session\'s own');
  assert.match(chips('--session', 's2').stdout, /session s1 {2}3 open: task_a1, task_c1, task_d1/);
  assert.match(chip('task_a1 Fix the parser', 'updated', 'transcript: t1').stderr, /transcript: goes beside session:/);
  assert.equal(chips('all').status, 2, 'chips all needs the session that takes the tasks');
});

test('a fast mark shows on a plain fix, refuses design judgment, and drops when a fold or dup raises the task', () => {
  const { chip, chips, offer } = chipLedger();
  const link = 'task_f1 Fix the badge link';
  assert.equal(offer(link, 'README.md', 'topic: badge; fast: yes').status, 0);
  assert.match(chips().stdout, /task_f1 {2}Fix the badge link \(fast\) {2}\[badge\]/);
  assert.match(chips('brief', 'task_f1').stdout, /^\[P1\] Fix the badge link \(fast\)\n[\s\S]*This task is marked fast: the owner's start of its card, or their "start <id>", is the word fast for it/);
  assert.match(offer('task_f2 Decide the badge (xhigh)', 'README.md', 'topic: badge-design; fast: yes').stderr, /task_f2 is an \(xhigh\) task, and fast: yes marks only a fix at high effort/);
  assert.match(offer('task_f3 Design the badge', 'README.md', 'topic: badge-look; kind: decide; fast: yes').stderr, /task_f3 is a decide task/);
  assert.match(offer('task_f4 Fix the badge color (fast)', 'README.md', 'topic: badge-color').stderr, /fast: yes adds \(fast\) for it/);
  assert.match(offer('task_f5 Fix the badge size', 'README.md', 'topic: badge-size; fast: maybe').stderr, /fast: is yes or no/);
  assert.match(chip(link, 'folded', 'kind: review').stderr, /a folded row takes kind: decide only/);
  assert.equal(chip(link, 'folded', 'effort: xhigh').status, 0);
  assert.match(chips().stdout, /task_f1 {2}Fix the badge link \(xhigh\) {2}\[badge\]/, 'a fold that needs design judgment drops the mark');
  assert.equal(offer('task_g1 Fix the footer', 'docs/f.md', 'topic: footer; fast: yes').status, 0);
  assert.equal(offer('task_g2 Rework the footer layout (xhigh)', 'docs/f.md', 'topic: footer').status, 0);
  assert.equal(chip('task_g2 Rework the footer layout (xhigh)', 'dismissed dup task_g1').status, 0);
  assert.doesNotMatch(chips('brief', 'task_g1').stdout, /marked fast/, 'a dup that brings design judgment drops the mark');
  assert.equal(offer('task_g3 Fix the header', 'docs/h.md', 'topic: header').status, 0);
  assert.equal(chip('task_g3 Fix the header', 'updated', 'fast: yes').status, 0);
  assert.match(chips().stdout, /task_g3 {2}Fix the header \(fast\)/);
});

test('fast work stays owed until a review task covers it, and comes back when that review is declined', () => {
  const { chip, chips, offer, root } = chipLedger();
  const link = 'task_f1 Fix the badge link';
  assert.equal(offer(link, 'README.md', 'topic: badge; fast: yes; card: c1; session: s1').status, 0);
  assert.match(chips().stdout, /Do, ledger pass \(1\)\n {2}review the fast work of task_f1: offer one task titled "Review the fast work of task_f1" with writes: README\.md; topic: fast-review; kind: review; waits: task:task_f1/);
  const review = 'task_r1 Review the fast work of task_f1';
  assert.equal(offer(review, 'README.md', 'topic: fast-review; kind: review; waits: task:task_f1').status, 0);
  assert.doesNotMatch(chips().stdout, /review the fast work/, 'a review task covers it');
  assert.equal(chip(link, 'started').status, 0);
  mkdirSync(join(root, 'docs/plans/artifacts/chips'), { recursive: true });
  writeFileSync(join(root, 'docs/plans/artifacts/chips/task_f1.patch'), 'diff --git a/README.md b/README.md\n');
  assert.equal(chip(link, 'landed', 'patch: docs/plans/artifacts/chips/task_f1.patch').status, 0);
  assert.match(chips().stdout, /Owed review \(1\)\n {2}task_f1 {2}Fix the badge link \(fast\) {2}\[badge\] {2}patch docs\/plans\/artifacts\/chips\/task_f1\.patch\n/);
  assert.match(chips('brief', 'task_r1').stdout, /This task reviews the fast work of the tasks it waits on[^\n]*\n- task_f1 Fix the badge link \(fast\): docs\/plans\/artifacts\/chips\/task_f1\.patch\n/);
  assert.equal(chip(review, 'dismissed declined').status, 0);
  assert.match(chips().stdout, /review the fast work of task_f1: offer one task/, 'a declined review leaves the work owed');
  assert.equal(chip(link, 'reviewed').status, 0);
  assert.doesNotMatch(chips().stdout, /Owed review|review the fast work/);
  assert.match(chip(review, 'reviewed').stderr, /task_r1 is dismissed declined, so it cannot be reviewed/);
});

test('decisions-check refuses a fourth panel round until a built: or another round: row', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app');
  const append = (phase, decision, result = 'recorded') => run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'append', 'log.decisions.tsv', phase, decision, 'why', 'evidence', result], root);
  const rounds = (count) => {
    for (let round = 1; round <= count; round += 1) {
      assert.equal(append('panel', 'seats opus').status, 0, `round ${round}`);
      assert.equal(append('writing', 'unslop on the round fixes').status, 0);
    }
  };
  rounds(3);
  const stuck = append('panel', 'seats opus');
  assert.equal(stuck.status, 1, 'a fourth round with no build between');
  assert.match(stuck.stderr, /panel round 4 since the last restart/);
  const roundsCheck = run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'rounds', 'log.decisions.tsv'], root);
  assert.equal(roundsCheck.status, 1, 'rounds exits 1 at the cap before any seat launches');
  assert.equal(append('build', 'Build has not started').status, 0);
  assert.equal(append('build', 'built: parser.mjs', 'skipped: the build has not run').status, 0);
  assert.equal(append('owner', 'Owner asked: "how long will this take?"').status, 0);
  assert.equal(append('panel', 'seats opus').status, 1, 'a build row with no built:, a skipped built: row and an owner row with no another round: restart nothing');
  assert.equal(run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'rounds', 'missing.decisions.tsv'], root).status, 2, 'rounds fails closed on a missing log');
  assert.equal(append('build', 'built: decisions-check.mjs and its test').status, 0);
  assert.equal(run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'rounds', 'log.decisions.tsv'], root).status, 0, 'rounds exits 0 after a restart');
  rounds(3);
  assert.equal(append('panel', 'seats opus').status, 1, 'the count starts again after a built: row');
  assert.equal(append('owner', 'another round: "panel"').status, 0);
  assert.equal(append('panel', 'seats opus').status, 0, 'an another round: row allows the next round');
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

test('freeze refuses a parent whose changed paths the new freeze does not name', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-pstack-freeze-parent-'));
  const repo = join(dir, 'repo');
  spawnSync('git', ['init', '-q', repo]);
  mkdirSync(join(repo, 'docs'));
  writeFileSync(join(repo, 'docs', 'a.md'), 'base a\n');
  writeFileSync(join(repo, 'b.md'), 'base b\n');
  spawnSync('git', ['-C', repo, 'add', '-A']);
  commit(repo, 'base');
  const runDir = join(dir, 'run');
  const freeze = (...args) => spawnSync(process.execPath, [join(HELPERS, 'freeze.mjs'), '--dir', runDir, ...args], { cwd: repo, encoding: 'utf8' });
  const show = (rev, path) => spawnSync('git', ['-C', repo, 'show', `${rev}:${path}`], { encoding: 'utf8' }).stdout;
  const commitOnly = (path, message) => {
    spawnSync('git', ['-C', repo, 'add', '--', path]);
    spawnSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--only', '-m', message, '--', path]);
  };

  writeFileSync(join(repo, 'docs', 'a.md'), 'iteration one\n');
  const first = freeze('docs/a.md').stdout.trim();
  writeFileSync(join(repo, 'b.md'), 'iteration two\n');

  const dropped = freeze('--parent', first, 'b.md');
  assert.equal(dropped.status, 1);
  assert.match(dropped.stderr, /1 path\(s\) differ between HEAD and --parent \S+ and hold uncommitted changes, but are not named.*: docs\/a\.md\./u);

  const named = freeze('--parent', first, 'docs/a.md', 'b.md');
  assert.equal(named.status, 0, named.stderr);
  assert.equal(show(named.stdout.trim(), 'docs/a.md'), 'iteration one\n');
  assert.equal(show(named.stdout.trim(), 'b.md'), 'iteration two\n');

  const byDirectory = freeze('--parent', first, 'docs', 'b.md');
  assert.equal(byDirectory.status, 0, byDirectory.stderr);

  const newChain = freeze('b.md');
  assert.equal(newChain.status, 0, newChain.stderr);

  writeFileSync(join(repo, 'c.md'), 'unrelated\n');
  commitOnly('c.md', 'owner commits an unrelated file');
  assert.match(freeze('--parent', first, 'b.md').stderr, /^1 path\(s\) .*: docs\/a\.md\./u);

  writeFileSync(join(repo, 'new.md'), 'untracked\n');
  const withUntracked = freeze('--parent', first, 'docs/a.md', 'new.md').stdout.trim();
  assert.match(freeze('--parent', withUntracked, 'docs/a.md', 'b.md').stderr, /: new\.md\./u);

  commitOnly('docs/a.md', 'owner commits iteration one');
  const afterOwnerCommit = freeze('--parent', first, 'b.md');
  assert.equal(afterOwnerCommit.status, 0, afterOwnerCommit.stderr);

  symlinkSync('b.md', join(repo, 'link'));
  commitOnly('link', 'owner adds a link');
  rmSync(join(repo, 'link'));
  symlinkSync('c.md', join(repo, 'link'));
  const linkFreeze = freeze('link').stdout.trim();
  rmSync(join(repo, 'link'));
  symlinkSync('docs/a.md', join(repo, 'link'));
  commitOnly('link', 'owner points the link elsewhere');
  const afterLinkCommit = freeze('--parent', linkFreeze, 'b.md');
  assert.equal(afterLinkCommit.status, 0, afterLinkCommit.stderr);
});

test('freeze refuses an unnamed parent path whose name git quotes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-pstack-freeze-quoted-'));
  const repo = join(dir, 'repo');
  spawnSync('git', ['init', '-q', repo]);
  writeFileSync(join(repo, 'quote"d.md'), 'base\n');
  writeFileSync(join(repo, 'b.md'), 'base\n');
  spawnSync('git', ['-C', repo, 'add', '-A']);
  commit(repo, 'base');
  const runDir = join(dir, 'run');
  const freeze = (...args) => spawnSync(process.execPath, [join(HELPERS, 'freeze.mjs'), '--dir', runDir, ...args], { cwd: repo, encoding: 'utf8' });

  writeFileSync(join(repo, 'quote"d.md'), 'iteration one\n');
  const first = freeze('quote"d.md').stdout.trim();
  writeFileSync(join(repo, 'b.md'), 'iteration two\n');
  const dropped = freeze('--parent', first, 'b.md');
  assert.equal(dropped.status, 1);
  assert.match(dropped.stderr, /: quote"d\.md\./u);
});

test('freeze names only the missing paths, running no git but a read-only HEAD probe first, and still freezes a tracked file deleted from disk', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-pstack-freeze-missing-'));
  const repo = join(dir, 'repo');
  spawnSync('git', ['init', '-q', repo]);
  writeFileSync(join(repo, 'plan.md'), 'base\n');
  writeFileSync(join(repo, 'gone.md'), 'base\n');
  mkdirSync(join(repo, 'notes'));
  writeFileSync(join(repo, 'notes', 'n.md'), 'base\n');
  spawnSync('git', ['-C', repo, 'add', '-A']);
  commit(repo, 'base');
  writeFileSync(join(repo, 'plan.md'), 'round one\n');
  rmSync(join(repo, 'gone.md'));
  rmSync(join(repo, 'notes'), { recursive: true });
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const gitCalls = join(dir, 'git-calls');
  const realGit = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
  writeFileSync(join(bin, 'git'), `#!/bin/sh\necho "$*" >> ${gitCalls}\nexec ${realGit} "$@"\n`, { mode: 0o755 });
  const freeze = (runDir, ...paths) =>
    spawnSync(process.execPath, [join(HELPERS, 'freeze.mjs'), '--dir', join(dir, runDir), ...paths], { cwd: repo, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });

  const missing = freeze('refused', 'plan.md', 'missing.md', 'gone.md', 'notes/', 'plan.md/child', 'plan.md/', 'docs/absent.md');
  assert.equal(missing.status, 1);
  assert.equal(missing.stderr, '4 path(s) not found in the working tree or HEAD: missing.md, plan.md/child, plan.md/, docs/absent.md\n');
  const calls = readFileSync(gitCalls, 'utf8').trim().split('\n');
  assert.ok(calls.length > 0 && calls.every((call) => call.startsWith('cat-file -e ')), `a refused freeze ran git beyond the HEAD probe: ${calls}`);

  const deletion = freeze('kept', 'plan.md', 'gone.md', 'notes/');
  assert.equal(deletion.status, 0, deletion.stderr);
  const tree = spawnSync('git', ['-C', repo, 'ls-tree', '--name-only', deletion.stdout.trim()], { encoding: 'utf8' }).stdout;
  assert.equal(tree, 'plan.md\n', 'the frozen tree records the deletion');
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
  assert.deepEqual(lines.slice(1).filter((line) => line.split('\t')[1] !== 'lead').map((line) => line.split('\t')[2]), [seats[1], finding[1]]);
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
  assert.match(append('scope: parser; `/bin/cat docs/plans/artifacts/run/test-a3.log`').stderr, /test-a3\.log, which does not exist/, 'a command before the cited path');
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
  const { dir, env: clean, run } = sandbox();
  const header = 'ts\tphase\tdecision\twhy\tevidence\tresult';
  const root = project(dir, 'app', { files: { 'log.decisions.tsv': `${header}\n`, 'plan.md': '# Plan\n\nStatus: building\n' } });
  run('git', ['add', '.'], root);
  run('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'intake'], root);
  const base = run('git', ['rev-parse', 'HEAD'], root).stdout.trim();
  writeFileSync(join(root, 'log.decisions.tsv'), `${header}\n2026-09-02T00:00:00Z\tbuild\tfix\twhy\tscope: x; docs/plans/artifacts/run/gone-a1.log\tverified\n`);
  writeFileSync(join(root, 'plan.md'), '# Plan\n\nStatus: building\n\n- [x] tests: `docs/plans/artifacts/run/gone-a1.log`\n');
  run('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qam', 'owner sweep'], root);
  const check = (script, file, env) => spawnSync(process.execPath, [join(HELPERS, script), file], { cwd: root, encoding: 'utf8', env: { ...clean, ...env } });

  assert.equal(check('decisions-check.mjs', 'log.decisions.tsv', {}).status, 0, 'against HEAD the swept row looks committed');
  assert.match(check('decisions-check.mjs', 'log.decisions.tsv', { PSTACK_BASE: base }).stderr, /gone-a1\.log, which does not exist/);
  assert.match(check('plan-open.mjs', 'plan.md', { PSTACK_BASE: base }).stderr, /gone-a1\.log, which does not exist/);
  assert.equal(check('plan-open.mjs', 'plan.md', { PSTACK_BASE: '0'.repeat(40) }).status, 1, 'an unresolvable base fails closed');
  assert.equal(check('decisions-check.mjs', 'log.decisions.tsv', { PSTACK_BASE: '' }).status, 1, 'an empty base fails closed');
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

test('proof refuses a --timeout over the hour time budget unless --stress, and writes no log for a refused run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-pstack-proof-budget-'));
  const prove = (flags) => spawnSync(process.execPath, [join(HELPERS, 'proof.mjs'), '--dir', join(dir, 'run'), '--name', 'slow', ...flags, '--', 'true'], { cwd: dir, encoding: 'utf8' });

  const refused = prove(['--timeout', '3601']);
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /--timeout 3601 is over the 3600-second time budget/);
  assert.equal(existsSync(join(dir, 'run/slow-a1.log')), false, 'a refused proof writes no log');
  assert.equal(prove(['--timeout', '3601', '--stress']).status, 0, 'a stress proof past the budget runs');
});

const proveWithTimeout = (dir, name, command) =>
  spawnSync(process.execPath, [join(HELPERS, 'proof.mjs'), '--dir', join(dir, 'run'), '--name', name, '--timeout', '1', '--', command], { cwd: dir, encoding: 'utf8' });

test('proof stops every process a timed-out command started, so none writes to its log afterwards', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-pstack-proof-late-'));

  assert.equal(proveWithTimeout(dir, 'late', 'sh -c "sleep 2; echo late-write"; true').status, 1);
  spawnSync('sleep', ['3']);
  assert.equal(read(dir, 'run/late-a1.log'), `$ (${realpathSync(dir)}) sh -c "sleep 2; echo late-write"; true\ntimed out after 1 seconds\nexit=ETIMEDOUT\n`, 'a process the command started wrote after the timeout');
});

const until = async (done) => {
  for (const begun = Date.now(); !done() && Date.now() - begun < 10_000; ) await new Promise((wake) => setTimeout(wake, 50));
};

test('proof logs the exit when it is stopped before its command ends', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-pstack-proof-stopped-'));
  const proof = spawn(process.execPath, [join(HELPERS, 'proof.mjs'), '--dir', join(dir, 'run'), '--name', 'stopped', '--', 'echo ready; sleep 20'], { cwd: dir, detached: true, stdio: 'ignore' });

  await until(() => existsSync(join(dir, 'run/stopped-a1.log')) && read(dir, 'run/stopped-a1.log').includes('\nready\n'));
  process.kill(-proof.pid, 'SIGTERM');
  await until(() => read(dir, 'run/stopped-a1.log').includes('exit='));
  assert.match(read(dir, 'run/stopped-a1.log'), /\nready\n\nproof\.mjs stopped by SIGTERM\nexit=SIGTERM\n$/);
});

test('proof logs the exit of a command that outlives its parent proof.mjs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-pstack-proof-orphan-'));
  const proof = spawn(process.execPath, [join(HELPERS, 'proof.mjs'), '--dir', join(dir, 'run'), '--name', 'orphan', '--', 'echo ready; sleep 1'], { cwd: dir, stdio: 'ignore' });

  await until(() => existsSync(join(dir, 'run/orphan-a1.log')) && read(dir, 'run/orphan-a1.log').includes('\nready\n'));
  proof.kill('SIGKILL');
  await until(() => read(dir, 'run/orphan-a1.log').includes('exit='));
  assert.match(read(dir, 'run/orphan-a1.log'), /\nready\n\nproof\.mjs ended before its command\nexit=0\n$/);
});

test('proof fails a timed-out command that exits 0 on its timeout signal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-pstack-proof-graceful-'));
  const graceful = proveWithTimeout(dir, 'graceful', "trap 'exit 0' TERM; sleep 20 & wait");

  assert.match(graceful.stdout, /exit=ETIMEDOUT/, 'a timed-out command that exits 0 was logged as passing');
  assert.equal(graceful.status, 1);
});

test('proof stops a timed-out command that ignores its timeout signal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-pstack-proof-stubborn-'));
  const started = Date.now();

  assert.equal(proveWithTimeout(dir, 'stubborn', "trap '' TERM; sleep 20").status, 1);
  assert.ok(Date.now() - started < 12_000, 'a command that ignores its timeout signal ran past the timeout and its grace');
});

test('prove refuses a timeout that is not a positive number before it writes a log', async () => {
  const { prove } = await import(pathToFileURL(join(HELPERS, 'proof.mjs')));
  const dir = mkdtempSync(join(tmpdir(), 'sync-pstack-prove-zero-'));

  for (const timeout of [0, -5, Number.NaN]) {
    assert.throws(() => prove({ dir, name: 'bad', command: ['true'], timeout }), /takes a positive number of seconds/, `prove accepted a timeout of ${timeout}`);
  }
  assert.deepEqual(readdirSync(dir), [], 'a refused proof wrote a log');
});

test('prove runs a command under the hour time budget by default and with no timeout under stress', async () => {
  const { prove } = await import(pathToFileURL(join(HELPERS, 'proof.mjs')));
  const dir = mkdtempSync(join(tmpdir(), 'sync-pstack-prove-default-'));
  const supervisorArgs = (options) => prove({ dir, name: 'supervisor', command: ['ps -o args= -p $PPID'], ...options }).output;

  assert.match(supervisorArgs({}), /--supervise-group 3600 bash/);
  assert.match(supervisorArgs({ stress: true }), /--supervise-group 0 bash/);
});

test('mutate refuses a spec timeout over the hour time budget before exporting anything', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-pstack-mutate-budget-'));
  writeFileSync(join(dir, 'spec.json'), JSON.stringify({ commit: 'HEAD', timeout: 5400, test: ['true'], mutations: [{ name: 'm', file: 'a.js', from: 'a', to: 'b', expect: 'x' }] }));
  const result = spawnSync(process.execPath, [join(HELPERS, 'mutate.mjs'), '--dir', join(dir, 'run'), join(dir, 'spec.json')], { cwd: dir, encoding: 'utf8' });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /within the 3600-second time budget, got 5400/);
  assert.equal(existsSync(join(dir, 'run')), false, 'a refused spec exports nothing');
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
  const notified = (source, dest) => spawnSync(process.execPath, [join(HELPERS, 'reply.mjs'), '--notified', join(dir, source), join(dir, dest)], { encoding: 'utf8' });
  assert.equal(notified('interim.output', 'notified.md').status, 0, 'a reply the completion notice vouches for, whose stop reason was never written');
  assert.equal(read(dir, 'notified.md'), 'Now checking the log.');
  assert.match(notified('limit.output', 'limit-2.md').stderr, /API error/, 'the notice never vouches for an API error');
  writeFileSync(join(dir, 'calling.output'), [...start, record('m2', [{ type: 'text', text: 'Checking.' }]), record('m2', [{ type: 'tool_use', id: 't2', name: 'Read', input: {} }])].join('\n'));
  assert.match(notified('calling.output', 'calling.md').stderr, /has not finished/, 'the notice never vouches for a message that calls a tool');
  assert.equal(existsSync(join(dir, 'interim.md')) || existsSync(join(dir, 'limit.md')), false);
});

test('head points origin/HEAD at the working branch only when a protected branch differs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-pstack-head-'));
  const remote = join(dir, 'remote.git');
  const clone = join(dir, 'clone');
  const git = (cwd, ...args) => {
    const run = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    return run.stdout.trim();
  };
  git(dir, 'init', '--quiet', '--bare', '--initial-branch=main', remote);
  git(dir, 'clone', '--quiet', remote, clone);
  git(clone, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '--allow-empty', '-m', 'base');
  git(clone, 'push', '--quiet', 'origin', 'HEAD:main', 'HEAD:next');
  git(clone, 'remote', 'set-head', 'origin', 'main');
  mkdirSync(join(clone, '.agents'));
  const head = () => spawnSync(process.execPath, [join(HELPERS, 'head.mjs')], { cwd: clone, encoding: 'utf8' });
  const origin = () => git(clone, 'symbolic-ref', 'refs/remotes/origin/HEAD');

  writeFileSync(join(clone, '.agents/pstack.json'), JSON.stringify({ branch: 'main' }));
  assert.equal(head().stdout, '', 'no protected branch, so the default branch is the working branch');
  assert.equal(origin(), 'refs/remotes/origin/main');

  writeFileSync(join(clone, '.agents/pstack.json'), JSON.stringify({ branch: 'gone', protected: 'main' }));
  assert.equal(head().status, 0);
  assert.equal(origin(), 'refs/remotes/origin/main', 'a working branch origin lacks moves nothing');

  writeFileSync(join(clone, '.agents/pstack.json'), JSON.stringify({ branch: 'next', protected: 'main' }));
  const moved = head();
  assert.equal(moved.status, 0, moved.stderr);
  assert.match(moved.stdout, /origin\/HEAD now points at origin\/next/);
  assert.equal(origin(), 'refs/remotes/origin/next');
  assert.equal(head().stdout, '', 'a second run finds origin/HEAD in place and prints nothing');
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

  const hook = (source) => spawnSync(process.execPath, [join(HELPERS, 'reread.mjs'), '--hook', 'AGENTS.md', 'missing.md', "it's spaced.md"], { cwd: dir, encoding: 'utf8', input: JSON.stringify({ session_id: `s-${source}`, source }) });
  assert.doesNotMatch(hook('startup').stdout, /^(?:AGENTS|missing)\.md:/mu, 'a fresh start only seeds the snapshots');
  assert.match(hook('compact').stdout, /AGENTS\.md: first snapshot; read it in full/, 'a compacted session with no snapshot rereads');
  edit('Keep plans in the repository.', 'Keep plans in the repository. Never stash.');
  const after = hook('startup').stdout;
  assert.ok(after.includes('+ Never stash.'), after);
  assert.ok(after.includes("run node .agents/pstack/reread.mjs --dir docs/plans/artifacts/reread/s-startup AGENTS.md missing.md 'it'\\''s spaced.md' before each gate"), after);
  const bare = spawnSync(process.execPath, [join(HELPERS, 'reread.mjs'), '--hook'], { cwd: dir, encoding: 'utf8', input: JSON.stringify({ session_id: 's-bare', source: 'startup' }) });
  assert.doesNotMatch(bare.stdout, /--dir/u, 'a hook given no files prints no command that would only print usage');
});

test('reread --hook names on a reload line each loaded skill the compaction restore cut short, and only after a compaction', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-pstack-reread-reload-'));
  writeFileSync(join(dir, 'AGENTS.md'), 'Rules.\n');
  const typed = (uuid, name) => ({ type: 'user', uuid, message: { role: 'user', content: `<command-message>${name}</command-message>\n<command-name>/${name}</command-name>\n<command-args>go</command-args>` } });
  const launched = (uuid, name) => ({ type: 'user', uuid, message: { role: 'user', content: [{ type: 'tool_result', content: `Launching skill: ${name}` }] }, toolUseResult: { success: true, commandName: name } });
  const loaded = (parentUuid, text) => ({ type: 'user', isMeta: true, parentUuid, uuid: `${parentUuid}-text`, message: { role: 'user', content: [{ type: 'text', text }] } });
  const long = 'x'.repeat(20_001);
  const transcript = [
    typed('t1', 'best-api-review'),
    loaded('t1', `Base directory for this skill: /x/best-api-review\n${long}`),
    launched('t2', 'pstack:poteto-mode'),
    loaded('t2', `Base directory for this skill: /x/poteto-mode\n${long}`),
    typed('t3', 'compact'),
    { type: 'user', parentUuid: 't3', uuid: 't3-out', message: { role: 'user', content: '<local-command-stdout>Compacted</local-command-stdout>' } },
    launched('t4', 'plan-page'),
    { type: 'attachment', parentUuid: 't4', uuid: 't4-hook', attachment: { type: 'hook_success', hookName: 'PostToolUse:Skill' } },
    loaded('t4-hook', 'Base directory for this skill: /x/plan-page'),
    launched('t5', 'pstack:poteto-mode'),
    loaded('t5', '(Re-invocation of /pstack:poteto-mode, the previously loaded copy was truncated by compaction; the full instructions follow.)'),
    { type: 'system', subtype: 'compact_boundary', uuid: 'b1', content: 'Conversation compacted' },
    { type: 'user', isCompactSummary: true, uuid: 's1', message: { role: 'user', content: 'This session is being continued.' } },
  ];
  writeFileSync(join(dir, 'transcript.jsonl'), `${transcript.map((record) => JSON.stringify(record)).join('\n')}\nnot json\n`);
  const hook = (payload) => spawnSync(process.execPath, [join(HELPERS, 'reread.mjs'), '--hook', 'AGENTS.md'], { cwd: dir, encoding: 'utf8', input: JSON.stringify({ session_id: 's1', ...payload }) });

  const compacted = hook({ source: 'compact', transcript_path: join(dir, 'transcript.jsonl') });
  assert.equal(compacted.status, 0, compacted.stderr);
  assert.match(compacted.stdout, /^reload: best-api-review, pstack:poteto-mode\. The compaction restored only the first 20,000 characters of these skills; as the Long runs rule says, reload through the Skill tool each one whose mode you are running before your next step\.$/mu, 'plan-page fits the restore, so it is not reloaded');
  writeFileSync(join(dir, 'short.jsonl'), `${transcript.slice(5, 9).map((record) => JSON.stringify(record)).join('\n')}\n`);
  assert.doesNotMatch(hook({ source: 'compact', transcript_path: join(dir, 'short.jsonl') }).stdout, /reload:/, 'a session whose skills all fit the restore reloads none');
  assert.match(compacted.stdout, /^Instruction snapshots: /mu, 'the reload line comes with the snapshot lines, not instead of them');
  for (const source of ['startup', 'resume', 'clear']) {
    assert.doesNotMatch(hook({ source, transcript_path: join(dir, 'transcript.jsonl') }).stdout, /reload:/, `${source} prints no reload line`);
  }
  mkdirSync(join(dir, 'directory.jsonl'));
  for (const unreadable of ['gone.jsonl', 'directory.jsonl']) {
    const result = hook({ source: 'compact', transcript_path: join(dir, unreadable) });
    assert.equal(result.status, 0, `${unreadable} blocks the hook`);
    assert.doesNotMatch(result.stdout, /reload:/);
    assert.match(result.stdout, /^Instruction snapshots: /mu, unreadable);
  }
});

test('decisions-check append asks a marking row to name the file it grades, and reads a label only in its own grammar', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', { files: { 'docs/plans/artifacts/run/typecheck-a1.log': '$ (.) tsc\nexit=1\n' } });
  const append = (evidence, result = 'partial: the type check still fails', phase = 'build') =>
    run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'append', 'log.decisions.tsv', phase, 'typecheck plitejs', 'why', evidence, result], root);
  const log = 'docs/plans/artifacts/run/typecheck-a1.log';

  assert.match(append(`ran ${log}`).stderr, /an unlabeled partial row: name the file whose verdict it states/, 'a partial row with a citation but no label');
  assert.match(append(`capacity-proof: ${log}`).stderr, /an unlabeled partial row/, 'a word ending in proof: is no label');
  assert.match(append('runtime proof: real click').stderr, /an unlabeled partial row/, 'proof: before a word that is no path is no label');
  assert.match(append('proof: docs/plans/artifacts/run/gone-a1.log (missing)').stderr, /proof: docs\/plans\/artifacts\/run\/gone-a1\.log names no file/);
  assert.equal(append(`\`proof: ${log}\``).status, 0, 'a label inside a code span');
  assert.equal(append('tracks bug 12; proof: none', 'open: bug 12 waits on upstream').status, 0, 'proof: none for a row that grades no file');
  assert.equal(append('no label', 'partial: the reviewer could not run it', 'review').status, 0, 'a reviewer row needs no label');
  assert.equal(append('no label', 'superseded: rerun in a2').status, 0, 'a superseded row needs no label');
  writeFileSync(join(root, 'old.decisions.tsv'), `ts\tphase\tdecision\twhy\tevidence\tresult\n2026-10-06T10:00:00Z\tbuild\told row\twhy\tno label\tpartial: written before labels\n`);
  assert.equal(run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'old.decisions.tsv'], root).status, 0, 'the whole-log check asks no row for a label');
});

test('decisions-check append takes an accepted row only for a not-passed file and a word the plan Defaults offers', () => {
  const { dir, run } = sandbox();
  const defaults = (words) => `# Plan\n\nStatus: building\n\n## Defaults\n\n| Decision | Pick | Alternative | Word |\n| --- | --- | --- | --- |\n| The type check | Ship with its known failure | Hold the build | ${words} |\n`;
  const root = project(dir, 'app', { files: { 'plan.md': defaults('`hold`, or **ship it**'), 'docs/plans/artifacts/run/typecheck-a1.log': '$ (.) tsc\nexit=1\n' } });
  const log = 'docs/plans/artifacts/run/typecheck-a1.log';
  const append = (evidence, result) => run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'append', 'plan.decisions.tsv', 'build', 'typecheck plitejs', 'why', evidence, result], root);

  assert.match(append(`proof: ${log}; word: hold`, 'accepted: the owner ships it').stderr, /nothing to accept/, 'a file with no not-passed row');
  assert.equal(append(`proof: ${log}`, 'partial: the type check fails on one fixture').status, 0);
  assert.match(append(`proof: ${log}; word: later`, 'accepted: the owner ships it').stderr, /word: later is not an option of a Word cell/);
  assert.match(append(`proof: ${log}`, 'accepted: the owner ships it').stderr, /names the accepting Defaults word/);
  assert.equal(append(`proof: ${log}; word: Ship it.`, 'accepted: the owner ships it').status, 0, 'a bold option after a comma and "or", compared without case or punctuation');
  writeFileSync(join(root, 'plan.md'), `${defaults('hold')}\n\`\`\`\`md\n| Decision | Pick | Alternative | Word |\n| --- | --- | --- | --- |\n| x | y | z | fenced |\n\`\`\`\`\n`);
  assert.match(append(`proof: ${log}; word: fenced`, 'accepted: the owner ships it').stderr, /word: fenced is not an option/, 'a table inside a four-backtick fence');
  writeFileSync(join(root, 'plan.md'), `<!--\n\`\`\`js\n-->\n${defaults('HOLD OR SHIP')}`);
  assert.equal(append(`proof: ${log}; word: ship`, 'accepted: the owner ships it').status, 0, 'a fence inside a comment opens nothing, and an upper-case OR splits options');
});

test('plan-open refuses a newly closed box that cites a not-passed proof until a pass or an accepted row with a live Defaults word', () => {
  const { dir, run } = sandbox();
  const plan = (words, box) => `# Plan\n\nStatus: building\n\n## Defaults\n\n| Decision | Pick | Alternative | Word |\n| --- | --- | --- | --- |\n| The type check | Ship with its known failure | Hold the build | ${words} |\n\n## Steps\n\n${box}\n`;
  const root = project(dir, 'app', { files: { 'plan.md': plan('ship it', '- [ ] type check: `./docs/plans/artifacts/run/typecheck-a1.log`'), 'docs/plans/artifacts/run/typecheck-a1.log': '$ (.) tsc\nexit=1\n' } });
  run('git', ['add', '-A'], root);
  run('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'plan'], root);
  const log = 'docs/plans/artifacts/run/typecheck-a1.log';
  const append = (evidence, result) => run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'append', 'plan.decisions.tsv', 'build', 'typecheck plitejs', 'why', evidence, result], root);
  const check = (words) => {
    writeFileSync(join(root, 'plan.md'), plan(words, '- [x] type check: `./docs/plans/artifacts/run/typecheck-a1.log`'));
    return run(process.execPath, [join(HELPERS, 'plan-open.mjs'), 'plan.md'], root);
  };

  assert.equal(append(`proof: ${join(root, log)}`, 'partial: the type check fails on one fixture').status, 0, 'an absolute label spelling');
  const refused = check('ship it');
  assert.equal(refused.status, 1, 'a box citing a file whose latest labeled verdict is partial');
  assert.match(refused.stderr, /typecheck-a1\.log, whose latest labeled verdict is not passed/);
  assert.equal(append(`proof: ${log}; word: ship it`, 'accepted: the owner ships the known failure').status, 0);
  assert.equal(check('ship it').status, 0, 'the accepted row with a word the Defaults still offer');
  assert.match(check('hold').stderr, /latest labeled verdict is not passed/, 'the owner reversed the Defaults row');
  assert.equal(append(`proof: ${log}; scope: the full type check, read 2026-10-07`, 'verified: the type check passes').status, 0);
  assert.equal(check('hold').status, 0, 'a later labeled pass');
});

function acceptedTypingRun(log) {
  const { dir, run } = sandbox();
  const plan = (box) => `# Plan\n\nStatus: building\n\n## Defaults\n\n| Decision | Pick | Alternative | Word |\n| --- | --- | --- | --- |\n| Typing timings | Hand them to a suggested task | Time them now | time typing now |\n\n## Steps\n\n${box}\n`;
  const root = project(dir, 'app', { files: { 'plan.md': plan('- [ ] 2.6 Time typing'), [log]: '$ (.) probe\nexit=0\n' } });
  run('git', ['add', '-A'], root);
  run('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'plan'], root);
  const append = (evidence, result) => run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'append', 'plan.decisions.tsv', 'verify', 'typing lines', 'why', evidence, result], root);
  assert.equal(append(`proof: ${log}`, 'inconclusive: the host was loaded').status, 0);
  assert.equal(append(`proof: ${log}; word: time typing now`, 'accepted: the typing lines go to a suggested task').status, 0);
  const check = (box) => {
    writeFileSync(join(root, 'plan.md'), plan(box));
    return run(process.execPath, [join(HELPERS, 'plan-open.mjs'), 'plan.md'], root);
  };
  return { append, check };
}

test('plan-open keeps refusing a closed pre-acceptance probe box on a not-passed proof whatever accepted row follows', () => {
  const log = 'docs/plans/artifacts/run/typing-a1.log';
  const { append, check } = acceptedTypingRun(log);
  const refused = check(`- [x] 2.6 Pre-acceptance probe: \`${log}\``);
  assert.equal(refused.status, 1, 'the accepted row does not close a probe a design acceptance waits on');
  assert.match(refused.stderr, /typing-a1\.log, whose latest labeled verdict is not passed, and a pre-acceptance probe stays open/);
  assert.equal(check(`- [x] 2.7 Rerun step 2.6's probe on the final bytes: \`${log}\``).status, 0, 'a final rerun that names no pre-acceptance probe keeps the accepted route');
  assert.doesNotMatch(check(`- [ ] 2.6 Pre-acceptance probe: \`${log}\``).stderr, /stays open until it passes/, 'the reopened box');
  assert.equal(append(`proof: ${log}; scope: typing lines A1 and C on a quiet host, read 2026-10-16`, 'verified: the typing lines pass').status, 0);
  assert.equal(check(`- [x] 2.6 Pre-acceptance probe: \`${log}\``).status, 0, 'a later labeled pass');
});

test('plan-open reads the pre-acceptance mark from prose, not from a cited path', () => {
  const log = 'docs/plans/artifacts/pre-acceptance-run/typing-a1.log';
  const { check } = acceptedTypingRun(log);
  assert.equal(check(`- [x] 2.7 Rerun step 2.6's probe on the final bytes.\n  Closed by: \`${log}\`, ${log}`).status, 0, 'a final rerun citing a path named pre-acceptance');
});

test('plan-open reads the pre-acceptance mark through Markdown emphasis', () => {
  const log = 'docs/plans/artifacts/run/typing-a1.log';
  const { check } = acceptedTypingRun(log);
  assert.match(check(`- [x] 2.6 _Pre-acceptance_ probe: \`${log}\``).stderr, /a pre-acceptance probe stays open/);
});

test('decisions-check records verified runtime identity and an unknown boundary before later work', () => {
  const { dir, env, home } = sandbox();
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': '# Plan\n\nStatus: executed\n', 'q.tsv': 'build\tship it\twhy\tevidence\tdecided\n' } });
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'ps'), '#!/bin/sh\necho "1 /runtime/codex"\n', { mode: 0o755 });
  const runtimeEnv = { ...env, CODEX_HOME: join(home, '.codex'), CODEX_THREAD_ID: 'child', CODEX_SESSION_ID: 'parent', CODEX_TOOL_CALL_ID: 'exec-12345678-1234-1234-1234-123456789abc', CLAUDECODE: '', CLAUDE_SESSION_ID: '', CLAUDE_CODE_SESSION_ID: '', CLAUDE_PID: '', CLAUDE_CODE_ENTRYPOINT: '', PATH: `${bin}:${process.env.PATH}` };
  const rollout = join(runtimeEnv.CODEX_HOME, 'sessions/2026/10/19/rollout-child.jsonl');
  mkdirSync(dirname(rollout), { recursive: true });
  writeFileSync(rollout, [
    { type: 'session_meta', payload: { id: 'child', session_id: 'parent', parent_thread_id: 'parent' } },
    { type: 'turn_context', payload: { model: 'gpt-6.1-sol', effort: 'high' } },
    { type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'wrapper', input: 'await tools.exec_command({cmd: process.env.COMMAND})' } },
  ].map(JSON.stringify).join('\n'));
  const append = (extra = {}) => spawnSync(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'append', 'docs/plans/plan.decisions.tsv', '--from', 'q.tsv'], { cwd: root, encoding: 'utf8', env: { ...runtimeEnv, ...extra } });
  const leads = () => read(root, 'docs/plans/plan.decisions.tsv').split('\n').filter((line) => line.split('\t')[1] === 'lead').map((line) => line.split('\t')[2]);
  const first = append();
  assert.equal(first.status, 0, first.stderr);
  assert.equal(append().status, 0);
  assert.deepEqual(leads(), ['gpt-6.1-sol @high']);
  const unknown = append({ CODEX_TOOL_CALL_ID: '' });
  assert.equal(unknown.status, 0, unknown.stderr);
  assert.match(unknown.stderr, /unknown lead boundary/);
  assert.deepEqual(leads(), ['gpt-6.1-sol @high', 'unknown']);
  assert.equal(append({ CODEX_TOOL_CALL_ID: '' }).status, 0);
  assert.deepEqual(leads(), ['gpt-6.1-sol @high', 'unknown']);
  assert.equal(append().status, 0);
  assert.deepEqual(leads(), ['gpt-6.1-sol @high', 'unknown', 'gpt-6.1-sol @high']);
  const check = spawnSync(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'docs/plans/plan.decisions.tsv'], { cwd: root, encoding: 'utf8', env });
  assert.equal(check.status, 0, check.stderr);
  const levels = spawnSync(process.execPath, [join(HELPERS, 'levels.mjs'), '--seats', 'gpt-6-astra @high', 'docs/plans/plan.decisions.tsv'], { cwd: root, encoding: 'utf8', env: runtimeEnv });
  assert.equal(levels.status, 0, levels.stderr);
  assert.match(levels.stdout, /at lines 3-4: lead gpt-6.1-sol @high/);
  assert.match(levels.stdout, /below lines 6-7: lead unknown/);
  assert.match(levels.stdout, /at line 9: lead gpt-6.1-sol @high/);
  const page = spawnSync(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], { cwd: root, encoding: 'utf8', env });
  assert.equal(page.status, 0, page.stderr);
  const html = read(root, 'docs/plans/artifacts/plan.html');
  const header = html.slice(html.indexOf('<header'), html.indexOf('</header>')).replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ');
  assert.match(header, /Lead gpt-6.1-sol high Lead unknown/);
});

test('unknown identity never attributes foreign readers and remains unknown in levels and the page', () => {
  const { dir, env, home } = sandbox();
  const plan = '# Plan\n\nStatus: executed\n\n## Main changes\n\n- Check attribution.\n';
  const log = LOG_HEAD + logRow('lead', 'claude-opus-5-5 @medium') + logRow('build', 'known work');
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan, 'docs/plans/plan.decisions.tsv': log, 'q.tsv': 'build\tunknown work\twhy\tevidence\trecorded\npanel\tseats gpt-6-astra @high\twhy\tevidence\trecorded\n' } });
  const foreign = join(home, '.claude/projects/-app/foreign.jsonl');
  mkdirSync(dirname(foreign), { recursive: true });
  writeFileSync(foreign, JSON.stringify({ type: 'assistant', effort: 'medium', message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: 'foreign', name: 'Bash', input: { command: 'cat plan.decisions.tsv' } }] } }));
  const unknownEnv = { ...env, CODEX_HOME: join(home, '.codex'), CODEX_THREAD_ID: '', CODEX_SESSION_ID: '', CODEX_TOOL_CALL_ID: '', CLAUDE_CODE_SESSION_ID: '' };
  const append = spawnSync(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'append', 'docs/plans/plan.decisions.tsv', '--from', 'q.tsv'], { cwd: root, encoding: 'utf8', env: unknownEnv });
  assert.equal(append.status, 0, append.stderr);
  assert.match(read(root, 'docs/plans/plan.decisions.tsv'), /\tlead\tunknown\t/);
  const levels = spawnSync(process.execPath, [join(HELPERS, 'levels.mjs'), '--lead', 'claude-opus-5-5 @medium', '--seats', 'gpt-6-astra @high', 'docs/plans/plan.decisions.tsv'], { cwd: root, encoding: 'utf8', env: unknownEnv });
  assert.equal(levels.status, 0, levels.stderr);
  assert.match(levels.stdout, /below lines 5-6: lead unknown \(no verified lead names its level\)/);
  const page = spawnSync(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], { cwd: root, encoding: 'utf8', env: unknownEnv });
  assert.equal(page.status, 0, page.stderr);
  const html = read(root, 'docs/plans/artifacts/plan.html');
  const header = html.slice(html.indexOf('<header'), html.indexOf('</header>')).replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ');
  assert.match(header, /Lead claude-opus-5-5 medium Lead unknown Reviews gpt-6-astra high/);
});

test('plan-page shows each lead model and effort in the header', () => {
  const { dir, run } = sandbox();
  const plan = '# Plan\n\nStatus: executed\n\n## Main changes\n\n- Raise the effort.\n';
  const log = [
    'ts\tphase\tdecision\twhy\tevidence\tresult',
    reviewRow('lead', 'claude-opus-5-5 @medium', 'recorded claude session'),
    reviewRow('plan', 'Draft the plan', 'decided'),
    reviewRow('lead', 'claude-opus-5-5 @xhigh', 'recorded claude session'),
  ].join('\n');
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan, 'docs/plans/plan.decisions.tsv': `${log}\n` } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const html = read(root, 'docs/plans/artifacts/plan.html');
  const header = html.slice(html.indexOf('<header'), html.indexOf('</header>')).replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ');
  assert.match(header, /Lead claude-opus-5-5 medium Lead claude-opus-5-5 xhigh/);
});

test('decisions-check append names the stage a batch moves the log into', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app');
  const append = (phase, decision, result = 'recorded') => run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'append', 'log.decisions.tsv', phase, decision, 'why', 'evidence', result], root);
  assert.match(append('architect', 'three runners').stdout, /Stage: Design\. Rename the session/);
  assert.doesNotMatch(append('architect', 'picked the base').stdout, /Stage:/, 'a row in the same stage');
  assert.match(append('build', 'built: the helper').stdout, /Stage: Build\./);
  assert.match(append('panel', 'seats opus').stdout, /Stage: Code review\./, 'a panel round after a build reviews the code');
  assert.doesNotMatch(append('writing', 'deslop on the round 1 fixes').stdout, /Stage:/, "a review round's writing pass stays under that review's stage");
  assert.doesNotMatch(append('panel', 'seats opus').stdout, /Stage:/, 'the next round stays in Code review');
  assert.match(append('verify', 'Prove the helper').stdout, /Stage: Verify\./);
});

test('decisions-check append names the stage when a batch leaves the stage and comes back to it', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app');
  const append = (...args) => run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'append', 'log.decisions.tsv', ...args], root);
  assert.match(append('verify', 'Prove the helper', 'why', 'evidence', 'recorded').stdout, /Stage: Verify\./);
  writeFileSync(join(root, 'queue.tsv'), 'build\tbuilt: the fix\twhy\tevidence\trecorded\nverify\tProve the fix\twhy\tevidence\trecorded\n');
  assert.match(append('--from', 'queue.tsv').stdout, /Stage: Build, then Verify\./, 'a batch that builds and verifies again names both stages');
});

test('decisions-check append names Audit when a hand-off reviewer row follows', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app');
  const append = (phase, decision) => run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'append', 'log.decisions.tsv', phase, decision, 'why', 'evidence', 'recorded'], root);
  assert.match(append('verify', 'Prove the helper').stdout, /Stage: Verify\./);
  assert.match(append('review-trail', 'Check the trail').stdout, /Stage: Audit\./, 'the rail counts review phases as Audit');
});

const LOG_HEAD = 'time\tphase\tdecision\twhy\tevidence\tresult\n';
const logRow = (phase, decision) => `2026-10-13T00:00:00Z\t${phase}\t${decision}\twhy\tevidence\tfixed: done\n`;
const prPlan = (fields, body = '') =>
  `# PR\n\nStatus: executed\nPlaybook: feature\n${fields}\n${brief()}## Teach\n\nThe page is the plan.\n\n## Demo\n\n1. Open the page. ![after](shots/after.png)\n2. Scroll down. ![before](https://github.com/user-attachments/assets/v1)\n\n## Defaults\n\n| Decision | Pick | Alternative | Word | Impact |\n| --- | --- | --- | --- | --- |\n| Body shape | The page | A hand-written body | hand body | big |\n\n## Public API\n\n\`\`\`ts before\nold()\n\`\`\`\n\n\`\`\`ts after\nnext()\n\`\`\`\n\n## Main changes\n\n- Moves the owner.\n\n## Steps\n\n- [x] Build it. Proof: the test.\n${body}`;

test('plan-page --pr writes the models, brief, frames, picks and API diff between markers', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', {
    files: {
      'docs/plans/pr.md': prPlan('', '\n## Design\n\nInternal only.\n\n## Notes\n\nLeft in the plan.\n'),
      'docs/plans/shots/after.png': 'png',
      'docs/plans/pr.decisions.tsv': LOG_HEAD + logRow('lead', 'claude-opus-5-5 @xhigh') + logRow('panel', 'seats claude-opus-5-5 @high, codex:gpt-6.1-sol @xhigh missing') + logRow('build', 'built it') + logRow('writing', 'deslop and unslop') + logRow('panel', 'seats claude-opus-5-5 @high, codex:gpt-6.1-sol @xhigh missing'),
    },
  });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/pr.md', '--pr'], root);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split('\n').slice(1), ['--attach ./docs/plans/shots/after.png']);
  const body = read(root, 'docs/plans/artifacts/pr.pr.md');
  assert.ok(
    body.startsWith('<!-- plan-page:start -->\n- `claude-opus-5-5 xhigh` · `feature` · not run: design, verify, audit\n  - `claude-opus-5-5` `high` ×2\n  - `gpt-6.1-sol` `xhigh` missing ×2\n\nIt opens with a brief.\n\n> [!CAUTION]\n> Old plans need a brief.\n'),
    'each lead with the playbook and the checks that did not run, its seats with their rounds, then Changes and Risks'
  );
  assert.match(body, /\n1\. Open the page\.\n\nAfter\n\n<!-- frame: \.\/docs\/plans\/shots\/after\.png -->\n!\[after\]\(\.\/docs\/plans\/shots\/after\.png\)\n/);
  assert.match(body, /\n2\. Scroll down\.\n\nBefore\n\nhttps:\/\/github\.com\/user-attachments\/assets\/v1\n/);
  assert.ok(body.includes('\n## Decisions\n\n- Body shape\n  - **The page**\n  - A hand-written body (alt)\n'));
  assert.match(body, /\n```diff\n-old\(\)\n\+next\(\)\n```\n/);
  assert.doesNotMatch(body, /Left in the plan|Internal only|Moves the owner|Status:/, 'engineer sections and the Status line stay in the plan');
  assert.ok(body.indexOf('## How it works') < body.indexOf('## Demo') && body.indexOf('## Decisions') < body.indexOf('## Public API'));
  assert.ok(body.endsWith('\n## Plans\n\n- PR (`docs/plans/pr.md`)\n\n<!-- plan-page:end -->\n'));
  assert.equal(run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/pr.md'], root).status, 0);
  assert.match(read(root, 'docs/plans/artifacts/pr.html'), /<a href="https:\/\/github\.com\/user-attachments\/assets\/v1">/, 'the page links a frame it cannot inline');
});

test('plan-page --pr --into replaces only its region and reuses an uploaded frame', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', { files: { 'docs/plans/pr.md': prPlan(''), 'docs/plans/shots/after.png': 'png' } });
  const uploaded = '![after](https://github.com/user-attachments/assets/abc)';
  writeFileSync(
    join(root, 'body.md'),
    `<!-- auto-release:start -->\n- [ ] Auto release\n<!-- auto-release:end -->\n\n<!-- plan-page:start -->\nOld region.\n<!-- frame: ./docs/plans/shots/after.png -->\n${uploaded}\n<!-- plan-page:end -->\n\n## Videos\n\nKept by hand.\n`
  );
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/pr.md', '--pr', '--into', 'body.md'], root);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /--attach/, 'an uploaded frame is not attached again');
  const body = read(root, 'docs/plans/artifacts/pr.pr.md');
  assert.match(body, /^<!-- auto-release:start -->\n- \[ \] Auto release\n<!-- auto-release:end -->\n\n<!-- plan-page:start -->\n`feature` · not run: /);
  assert.ok(body.includes(`<!-- frame: ./docs/plans/shots/after.png -->\n${uploaded}\n`));
  assert.doesNotMatch(body, /Old region\.|!\[after\]\(\.\//);
  assert.match(body, /<!-- plan-page:end -->\n\n## Videos\n\nKept by hand\.\n$/);
  writeFileSync(join(root, 'plain.md'), 'Hand-written body.\n');
  assert.equal(run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/pr.md', '--pr', '--into', 'plain.md'], root).status, 0);
  assert.match(read(root, 'docs/plans/artifacts/pr.pr.md'), /<!-- plan-page:end -->\n\nHand-written body\.\n$/, 'a body without the markers keeps its text below the region');
});

test('plan-page --pr folds the plans a PR plan lists into its rail and models', () => {
  const { dir, run } = sandbox();
  const child = '# A\n\nStatus: executed\nPlaybook: bug-fix\n\n## Steps\n\n- [x] One.\n- [x] Two.\n';
  const root = project(dir, 'app', {
    files: {
      'docs/plans/pr.md': prPlan('Plans: a.md'),
      'docs/plans/shots/after.png': 'png',
      'docs/plans/a.md': child,
      'docs/plans/pr.decisions.tsv': LOG_HEAD + logRow('lead', 'claude-opus-5-5 @xhigh'),
      'docs/plans/a.decisions.tsv': LOG_HEAD + logRow('lead', 'gpt-6.1-sol @xhigh') + logRow('build', 'built') + logRow('panel', 'seats gpt-6-astra @xhigh'),
    },
  });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/pr.md', '--pr'], root);
  assert.equal(result.status, 0, result.stderr);
  const body = read(root, 'docs/plans/artifacts/pr.pr.md');
  assert.ok(body.includes('\n## Plans\n\n- PR (`docs/plans/pr.md`)\n- A (`docs/plans/a.md`)\n'));
  assert.ok(
    body.includes('\n- `claude-opus-5-5 xhigh` · `feature`, `bug-fix` · not run: design, plan review, verify, audit\n- `gpt-6.1-sol xhigh`\n  - `gpt-6-astra` `xhigh`\n'),
    "the carried plan's playbook, review and lead count"
  );
  writeFileSync(join(root, 'docs/plans/pr.md'), prPlan('Plans: a.md, gone.md'));
  const missing = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/pr.md', '--pr'], root);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /lists docs\/plans\/gone\.md on its Plans: line, but that plan does not exist/);
});

test('plan-page --pr refuses a plan titled with a PR number', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', { files: { 'docs/plans/pr.md': prPlan('').replace('# PR\n', '# PR 5165 redo\n'), 'docs/plans/shots/after.png': 'png' } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/pr.md', '--pr'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /is titled "PR 5165 redo"; the PR body links its plan by title, so name the change instead of the PR/);
});

test('plan-page --pr refuses a plan without a brief, even an executed one', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', { files: { 'docs/plans/pr.md': '# PR\n\nStatus: executed\n\n## Main changes\n\n- Moves the owner.\n' } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/pr.md', '--pr'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /needs a ## Brief before --pr, because the PR body opens with its Changes and Risks/);
  assert.equal(run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/pr.md'], root).status, 0, 'the page still renders without a brief');
});

test("plan-page --pr shows the sections the playbook's page-pr line names, from each carried plan when the PR plan has none", () => {
  const { dir, run } = sandbox();
  const shape = '\n## Document shape\n\n```json before\n{ "level": 1 }\n```\n\n```json after\n{ "level": 2 }\n```\n\n## Layer and owner\n\nPlite owns the level.\n';
  const root = project(dir, 'app', {
    files: {
      '.agents/playbooks/plan.md': playbook('page-lead: What other editors do, Document shape, Layer and owner\npage-pairs: Document shape\npage-pr: Document shape, What other editors do\n'),
      'docs/plans/pr.md': prPlan('Plans: a.md', shape),
      'docs/plans/shots/after.png': 'png',
      'docs/plans/a.md': '# A\n\nStatus: executed\nPlaybook: plan\n\n## What other editors do\n\nLexical drops the key.\n',
    },
  });
  const pr = () => run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/pr.md', '--pr'], root);
  assert.equal(pr().status, 0);
  const body = read(root, 'docs/plans/artifacts/pr.pr.md');
  assert.ok(body.includes('\n## What other editors do\n\n### A\n\nLexical drops the key.\n'), "the carried plan's section shows under its title");
  assert.ok(body.includes('\n## Document shape\n\n```diff\n-{ "level": 1 }\n+{ "level": 2 }\n```\n'), 'a paired section shows as one diff');
  assert.ok(body.indexOf('## Public API') < body.indexOf('## What other editors do') && body.indexOf('## What other editors do') < body.indexOf('## Document shape'), 'page-lead order, after Public API');
  assert.doesNotMatch(body, /Layer and owner|Plite owns the level/, 'a section the line leaves out stays in the plan');
  writeFileSync(join(root, '.agents/playbooks/babysit.md'), playbook(''));
  writeFileSync(join(root, 'docs/plans/pr.md'), prPlan('Plans: a.md', shape).replace('Playbook: feature', 'Playbook: babysit'));
  assert.equal(pr().status, 0);
  assert.match(read(root, 'docs/plans/artifacts/pr.pr.md'), /\n## What other editors do\n\n### A\n/, "a carried plan's playbook names sections for a PR plan whose own playbook names none");
  writeFileSync(join(root, '.agents/playbooks/plan.md'), playbook('page-lead: What other editors do\npage-pr: Native behavior and proof\n'));
  const stray = pr();
  assert.equal(stray.status, 1);
  assert.match(stray.stderr, /lists Native behavior and proof on its page-pr line; the PR body shows only page-lead sections/);
});

test("plan-page --comment covers only the commits after the author's, without the clips the description already shows", () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', {
    files: {
      'docs/plans/pr.md': prPlan('', '\n## On top of the PR\n\n- Kept\n  - The title fix\n- Dropped\n  - The private scroll zone\n'),
      'docs/plans/shots/after.png': 'png',
      'description.md': 'The author demo: ![before](https://github.com/user-attachments/assets/v1)\n',
    },
  });
  const git = (...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root, encoding: 'utf8' });
  git('remote', 'add', 'origin', 'https://github.com/o/r.git');
  git('commit', '-q', '--allow-empty', '-m', 'author');
  const author = git('rev-parse', 'HEAD').stdout.trim();
  git('commit', '-q', '--allow-empty', '-m', 'mine');
  const head = git('rev-parse', 'HEAD').stdout.trim();
  const comment = (...extra) => run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/pr.md', ...extra], root);
  const result = comment('--comment', author, '--against', 'description.md');
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.split('\n')[0].endsWith('/docs/plans/artifacts/pr.comment.md'), result.stdout);
  const body = read(root, 'docs/plans/artifacts/pr.comment.md');
  assert.ok(body.includes(`\n[My commits after yours](https://diffshub.com/o/r/compare/${author}...${head})\n`), 'the compare link spans exactly the commits after the author');
  assert.ok(body.includes('\n## On top of the PR\n\n- Kept\n  - The title fix\n- Dropped\n  - The private scroll zone\n'));
  assert.ok(body.indexOf('## How it works') < body.indexOf('## On top of the PR') && body.indexOf('## On top of the PR') < body.indexOf('## Demo'));
  assert.match(body, /\n## Demo\n\n1\. Open the page\.\n/);
  assert.doesNotMatch(body, /Scroll down|assets\/v1/, 'a step whose clips the description shows stays out');
  assert.match(comment('--comment', 'deadbeef').stderr, /--comment names deadbeef, which is not a commit in this checkout/);
  git('checkout', '-q', '--orphan', 'other');
  git('commit', '-q', '--allow-empty', '-m', 'unrelated');
  assert.match(comment('--comment', author).stderr, new RegExp(`--comment names ${author}, which this checkout's HEAD does not contain`));
  assert.equal(comment('--pr', '--comment', author).status, 2, '--pr and --comment write different bodies');
  assert.equal(comment('--against', 'description.md').status, 2, '--against needs --comment');
});

test('plan-page --pr links a plan the current commit holds and names an uncommitted one by path', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', {
    files: {
      'docs/plans/pr.md': prPlan('Plans: a.md'),
      'docs/plans/shots/after.png': 'png',
      'docs/plans/a.md': '# A\n\nStatus: executed\n\n## Steps\n\n- [x] One.\n',
    },
  });
  const git = (...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root, encoding: 'utf8' });
  git('remote', 'add', 'origin', 'https://github.com/o/r.git');
  git('add', 'docs/plans/pr.md');
  git('commit', '-q', '-m', 'plan');
  const sha = git('rev-parse', 'HEAD').stdout.trim();
  assert.equal(run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/pr.md', '--pr'], root).status, 0);
  assert.ok(read(root, 'docs/plans/artifacts/pr.pr.md').includes(`\n## Plans\n\n- [PR](https://github.com/o/r/blob/${sha}/docs/plans/pr.md)\n- A (\`docs/plans/a.md\`)\n`));
});

const STAGE_TOPIC = '# Stage\n\nPage: https://claude.ai/artifact/stage\n\n## Main changes\n\n- Pages go live.\n';
const stagePlan = (title, status, extra = '') => `# ${title}\n\nStatus: ${status}\nTopic: stage\n\n## Main changes\n\n- ${title}.\n${brief()}${extra}`;
const gitAt = (root) => (...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root, encoding: 'utf8' });

function pushed(dir, name, files) {
  const root = project(dir, name, { files, config: { branch: 'next' } });
  const git = gitAt(root);
  git('add', '-A');
  git('commit', '-qm', 'base');
  spawnSync('git', ['init', '-q', '--bare', join(dir, `${name}.git`)]);
  git('remote', 'add', 'origin', join(dir, `${name}.git`));
  git('push', '-q', 'origin', 'next');
  return { root, git };
}
const worktree = (git, dir, name) => {
  git('worktree', 'add', '-q', '-b', name, join(dir, name));
  return realpathSync(join(dir, name));
};

test("plan-page binds a checkout to its own Page: line while only it moved from the fork point's, else to origin's, and lists other worktrees' lines", () => {
  const { dir, run } = sandbox();
  const topic = (url) => STAGE_TOPIC.replace('https://claude.ai/artifact/stage', url);
  const { root, git } = pushed(dir, 'app', { 'docs/plans/topics/stage.md': topic('https://claude.ai/artifact/a'), 'docs/plans/live.md': stagePlan('Live', 'building') });
  const rebound = worktree(git, dir, 'rebound');
  const behind = worktree(git, dir, 'behind');
  const render = (tree, ...flags) => run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/live.md', ...flags], tree);
  writeFileSync(join(rebound, 'docs/plans/topics/stage.md'), topic('https://claude.ai/artifact/b'));
  gitAt(rebound)('commit', '-qam', 'rebind mid-run');
  assert.equal(JSON.parse(render(rebound, '--rail').stdout).page, 'https://claude.ai/artifact/b', 'a line changed since the fork point stays bound after a commit');
  writeFileSync(join(root, 'docs/plans/topics/stage.md'), topic('https://claude.ai/artifact/c'));
  git('commit', '-qam', 'rebind on next');
  git('push', '-q', 'origin', 'next');
  assert.equal(JSON.parse(render(rebound, '--rail').stdout).page, 'https://claude.ai/artifact/c', 'once origin rebinds too, every checkout publishes to one page');
  assert.equal(JSON.parse(render(behind, '--rail').stdout).page, 'https://claude.ai/artifact/c', "a worktree that has not pulled uses origin's line");
  const plain = render(behind);
  assert.equal(plain.status, 0, plain.stderr);
  const lines = plain.stdout.split('\n');
  assert.ok(lines.includes('Page: https://claude.ai/artifact/c (publish through page-stop.mjs)'), plain.stdout);
  assert.ok(lines.includes(`Page in ${rebound}: https://claude.ai/artifact/b`), plain.stdout);
  assert.ok(!lines.some((line) => line.startsWith(`Page in ${realpathSync(root)}:`)), 'a worktree on the same line is not listed');
});

test('importing plan-page.mjs runs no CLI', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': '# Plan\n\nStatus: done\n', 'probe.mjs': `import ${JSON.stringify(pathToFileURL(join(HELPERS, 'plan-page.mjs')).href)};\n` } });
  const result = run(process.execPath, ['probe.mjs', 'docs/plans/plan.md'], root);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!existsSync(join(root, 'docs/plans/artifacts/plan.html')), 'the import rendered no page');
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

test('plan-page keeps the plan anchors on the local page, with no deck, mount or data block, and keeps the anchors out of the PR body and comment', () => {
  const { dir, run } = sandbox();
  const asking = '# Asking\n\nStatus: waiting for the owner\nTopic: stage\n\n## Main changes\n\n- Ask.\n\n## Open questions\n\n' + MEMO;
  const root = project(dir, 'app', {
    files: {
      'docs/plans/topics/stage.md': STAGE_TOPIC,
      'docs/plans/2026-01-01-asking.md': asking,
      'docs/plans/2026-02-01-live.md': stagePlan('Live', 'building', `\n## Open questions\n\n${MEMO}`),
      'docs/plans/pr.md': prPlan(''),
      'docs/plans/shots/after.png': 'png',
    },
  });
  const render = (...args) => run(process.execPath, [join(HELPERS, 'plan-page.mjs'), ...args], root);
  assert.equal(render('docs/plans/2026-02-01-live.md').status, 0);
  const html = read(root, 'docs/plans/artifacts/topics/stage.html');
  assert.doesNotMatch(html, /plan-page-(?:data|live|others|deck)|window\.claude/u, 'the local page has no deck, mount or database');
  assert.match(html, /<header id="run-2026-02-01-live"/u);
  const items = [...html.matchAll(/<(?:article class="q"|p class="from")[^>]*>/gu)].map(([item]) => item);
  assert.ok(items.length >= 3 && items.every((item) => / data-plan="docs\/plans\/2026-0[12]-0\d-\w+\.md"/u.test(item)), items.join('\n'));
  assert.deepEqual(items.filter((item) => item.includes('id="run-')).map((item) => item.match(/id="(run-[^"]+)"/u)[1]), ['run-2026-01-01-asking'], "another plan's first item carries its anchor");
  const git = gitAt(root);
  git('add', '-A');
  git('commit', '-qm', 'author');
  const author = git('rev-parse', 'HEAD').stdout.trim();
  assert.equal(render('docs/plans/pr.md', '--pr').status, 0);
  assert.equal(render('docs/plans/pr.md', '--comment', author).status, 0);
  for (const body of ['pr.pr.md', 'pr.comment.md']) {
    assert.doesNotMatch(read(root, `docs/plans/artifacts/${body}`), /data-plan|id="run-/u, body);
  }
});

test("plan-page inlines a frame its worktree lacks from the main checkout's run directory and names one that exists nowhere", () => {
  const { dir, run } = sandbox();
  const plan = `# Demo\n\nStatus: building\n\n${brief()}\n## Demo\n\n1. Open it. ![after](artifacts/demo/after.png) ![before](artifacts/demo/gone.png)\n`;
  const { root, git } = pushed(dir, 'app', { 'docs/plans/demo.md': plan });
  mkdirSync(join(root, 'docs/plans/artifacts/demo'), { recursive: true });
  writeFileSync(join(root, 'docs/plans/artifacts/demo/after.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==', 'base64'));
  const tree = worktree(git, dir, 'work');
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/demo.md'], tree);
  assert.equal(result.status, 0, result.stderr);
  const html = readFileSync(join(tree, 'docs/plans/artifacts/demo.html'), 'utf8');
  assert.equal([...html.matchAll(/<img src="data:image\/png;base64,/gu)].length, 1);
  assert.match(html, /<code>artifacts\/demo\/gone\.png<\/code> is not on this machine/u);
});

test('the page header counts each lead seat across rounds and carries the plans a PR plan lists', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', {
    files: {
      'docs/plans/pr.md': prPlan('Plans: a.md'),
      'docs/plans/shots/after.png': 'png',
      'docs/plans/a.md': '# A\n\nStatus: executed\nPlaybook: bug-fix\n\n## Steps\n\n- [x] One.\n- [x] Two.\n',
      'docs/plans/pr.decisions.tsv': LOG_HEAD + logRow('lead', 'claude-opus-5-5 @xhigh') + logRow('panel', 'seats claude-opus-5-5 @high, codex:gpt-6.1-sol @xhigh missing') + logRow('build', 'built it') + logRow('panel', 'seats #12 round 3: claude-opus-5-5 @high, codex:gpt-6.1-sol @xhigh (round 2, delta only) missing'),
      'docs/plans/a.decisions.tsv': LOG_HEAD + logRow('lead', 'gpt-6.1-sol @xhigh') + logRow('panel', 'seats gpt-6-astra @xhigh'),
    },
  });
  assert.equal(run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/pr.md'], root).status, 0);
  const html = read(root, 'docs/plans/artifacts/pr.html');
  const meta = html.match(/<div class="meta">(.*?)<\/div>/)[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').replace(/ Updated .*$/, '').trim();
  assert.equal(meta, 'Plans A Lead claude-opus-5-5 xhigh Reviews claude-opus-5-5 high ×2 gpt-6.1-sol xhigh missing ×2 Lead gpt-6.1-sol xhigh Reviews gpt-6-astra xhigh', 'a label or note around a seat stays out of its name');
  assert.match(html, /Build<span class="fs-meta">3\/3<\/span>/, "the rail counts the carried plan's steps");
  assert.match(html, /<li class="fs done"[^>]*>Plan review<span class="fs-meta">×2<\/span>/, 'review rounds from both plans add up');
});

test('a finished page shows its Verification, then its Open work last', () => {
  const { dir, run } = sandbox();
  const tail = '\n## Open work\n\n- Push it.\n\n## Verification\n\n- Rendered every plan.\n\n## Design\n\nInternal only.\n';
  const root = project(dir, 'app', { files: { 'docs/plans/pr.md': prPlan('', tail), 'docs/plans/shots/after.png': 'png' } });
  const order = () => {
    assert.equal(run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/pr.md'], root).status, 0);
    return [...read(root, 'docs/plans/artifacts/pr.html').matchAll(/<h2>([^<]+)<\/h2>/g)].map(([, title]) => title).filter((title) => ['Main changes', 'Design', 'Verification', 'Open work'].includes(title));
  };
  assert.deepEqual(order(), ['Main changes', 'Design', 'Verification', 'Open work']);
  writeFileSync(join(root, 'docs/plans/pr.md'), prPlan('', tail).replace('Status: executed', 'Status: building: step two'));
  assert.deepEqual(order(), ['Main changes', 'Design', 'Open work'], 'proof stays in the plan file while work runs');
});

const levelsRun = (args, { claude = '', codex = '', agents = '' } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'levels-'));
  mkdirSync(join(dir, 'home/.claude'), { recursive: true });
  mkdirSync(join(dir, 'codex'));
  writeFileSync(join(dir, 'home/.claude/pstack-models.md'), claude);
  writeFileSync(join(dir, 'codex/pstack-models.md'), codex);
  writeFileSync(join(dir, 'AGENTS.md'), agents);
  const env = { ...process.env, HOME: join(dir, 'home'), CODEX_HOME: join(dir, 'codex') };
  return { dir, run: (more = []) => spawnSync(process.execPath, [join(HELPERS, 'levels.mjs'), ...args, ...more], { cwd: dir, encoding: 'utf8', env }) };
};

const LEVELS_LOG = [
  'ts\tphase\tdecision\twhy\tevidence\tresult',
  'T\tplan\tWrite the plan\tw\te\trecorded',
  'T\tlead\tclaude-opus-5-5 @high\tw\te\trecorded',
  'T\tbuild\tBuild step one\tw\te\tbuilt',
  'T\tpanel\tseats claude-opus-5-5 @high, gpt-6-astra @xhigh, gpt-6.1-sol @xhigh\tw\te\trecorded',
  'T\tlead\tclaude-opus-5-5 @xhigh\tw\te\trecorded',
  'T\tpanel\tseats #12 round 3: claude-opus-5-5 @high, codex:gpt-6-astra @high, codex:gpt-6.1-sol @xhigh (round 2, delta only)\tw\te\trecorded',
  "T\tpanel\tseats opus @high, codex:gpt-6-astra @xhigh missing, codex:gpt-6.1-sol @xhigh missing, opus same-family in astra's place\tw\te\tpartial",
  'T\tarchitect\trunners answered: opus @high, gpt-6-astra @xhigh and gpt-6.1-sol @xhigh each returned a design\tw\te\trecorded',
  'T\tlead\tgpt-6.1-sol @xhigh\tw\te\trecorded',
  'T\tbuild\tBuild step two\tw\te\tbuilt',
  '',
].join('\n');

const LEVELS_SHEET = [
  'interrogate reviewers: opus, codex:gpt-6-astra @high, codex:gpt-6.1-sol @xhigh',
  'architect runners: opus, codex:gpt-6-astra @high, codex:gpt-6.1-sol @xhigh',
  'default effort: high',
].join('\n');

test('levels lists each lead stretch and seat round below this session or the configured seats, with project rules raising or lowering a seat', () => {
  const agents = [
    '<!-- pstack:begin (rendered) -->',
    '- A seat such as `codex:gpt-6.1-sol @max` inside the block raises nothing.',
    '<!-- pstack:end -->',
    '- **Astra effort.** Seat `codex:gpt-6-astra @xhigh` instead of the sheet\'s `@high`.',
    '- **Sol effort.** No seat runs at xhigh here, so seat `codex:gpt-6.1-sol @high`.',
  ].join('\n');
  const { dir, run } = levelsRun(['--lead', 'claude-opus-5-5 @xhigh', 'log.tsv'], { claude: LEVELS_SHEET, agents });
  writeFileSync(join(dir, 'log.tsv'), LEVELS_LOG);
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout,
    [
      'target: lead claude-opus-5-5 @xhigh; seats opus @high, gpt-6-astra @xhigh, gpt-6.1-sol @high',
      'log.tsv',
      '  below line 2: lead unknown (no verified lead names its level)',
      '  below lines 4-5: lead claude-opus-5-5 @high (@high is below @xhigh)',
      '  at line 5: panel opus @high, gpt-6-astra @xhigh, gpt-6.1-sol @xhigh',
      '  at lines 7-9: lead claude-opus-5-5 @xhigh',
      '  below line 7: panel opus @high, gpt-6-astra @high, gpt-6.1-sol @xhigh (gpt-6-astra @high is below @xhigh)',
      '  below line 8: panel opus @high, gpt-6-astra @xhigh missing, gpt-6.1-sol @xhigh missing, opus same-family (gpt-6-astra missing; gpt-6.1-sol missing)',
      '  at line 9: architect opus @high, gpt-6-astra @xhigh, gpt-6.1-sol @xhigh',
      '  below line 11: lead gpt-6.1-sol @xhigh (led in Codex, and plans start in Claude Code)',
      '5 of 8 units below target',
      '',
    ].join('\n'),
  );
});

test('levels in a Codex session keeps Claude-led stretches and takes the session effort for a seat with none', () => {
  const codex = 'interrogate reviewers: opus, codex:gpt-6-astra @high, codex:gpt-6.1-sol @xhigh\narchitect runners: opus @high, codex:gpt-6-astra @high, codex:gpt-6.1-sol @xhigh\ndefault effort: session';
  const { dir, run } = levelsRun(['--lead', 'gpt-6.1-sol @xhigh', 'log.tsv'], { codex });
  writeFileSync(join(dir, 'log.tsv'), LEVELS_LOG);
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^target: lead gpt-6\.1-sol @xhigh; seats opus @xhigh, gpt-6-astra @high, gpt-6\.1-sol @xhigh$/mu);
  assert.match(result.stdout, /^ {2}at lines 4-5: lead claude-opus-5-5 @high$/mu);
  assert.match(result.stdout, /^ {2}below line 5: panel .*\(opus @high is below @xhigh\)$/mu);
  assert.match(result.stdout, /^ {2}at line 11: lead gpt-6\.1-sol @xhigh$/mu);
});

test("levels caps the lead and every seat target at the project's maxEffort", () => {
  const { dir, run } = levelsRun(['--lead', 'claude-opus-5-5 @xhigh', 'log.tsv'], { claude: LEVELS_SHEET });
  writeFileSync(join(dir, 'log.tsv'), LEVELS_LOG);
  mkdirSync(join(dir, '.agents'));
  writeFileSync(join(dir, '.agents/pstack.json'), JSON.stringify({ maxEffort: 'high' }));
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^target: lead claude-opus-5-5 @high; seats opus @high, gpt-6-astra @high, gpt-6\.1-sol @high; maxEffort high$/mu);
  assert.match(result.stdout, /^ {2}at lines 4-5: lead claude-opus-5-5 @high$/mu, 'a stretch at the cap');
  assert.match(result.stdout, /^ {2}at line 7: panel /mu, 'seats at the cap');
  writeFileSync(join(dir, '.agents/pstack.json'), JSON.stringify({ maxEffort: 'huge' }));
  assert.match(run().stderr, /maxEffort is "huge", not one of low, medium, high, xhigh, max/);
});

test('levels refuses a missing log, a flag with no value, and a round the models sheet has no line for', () => {
  const { dir, run } = levelsRun([], { claude: 'interrogate reviewers: opus @high\ndefault effort: high' });
  writeFileSync(join(dir, 'log.tsv'), LEVELS_LOG);
  const usage = run();
  assert.equal(usage.status, 1);
  assert.match(usage.stderr, /^usage: levels\.mjs/u);
  assert.match(run(['--lead']).stderr, /^usage:/u);
  assert.match(run(['--lead', 'claude-opus-5-5 @xhigh', '--bogus', 'log.tsv']).stderr, /^usage:/u);
  assert.match(run(['--lead', 'claude-opus-5-5 @xhigh', 'gone.tsv']).stderr, /^gone\.tsv does not exist/u);
  const noLine = run(['--lead', 'claude-opus-5-5 @xhigh', 'log.tsv']);
  assert.equal(noLine.status, 1);
  assert.match(noLine.stderr, /no "architect runners:" line, so line 9 cannot be judged; pass --seats/u);
  const seats = run(['--lead', 'claude-opus-5-5 @xhigh', '--seats', 'opus @high, codex:gpt-6-astra @high, codex:gpt-6.1-sol @xhigh', 'log.tsv']);
  assert.equal(seats.status, 0, seats.stderr);
  assert.match(seats.stdout, /^ {2}at line 7: panel /mu);
});

test('an effort: high row lowers a stored (xhigh) title, and a design question stays at xhigh', () => {
  const { chip, chips, offer } = chipLedger();
  const parser = 'task_e1 Fix the parser (xhigh)';
  assert.equal(offer(parser, 'src/p.ts', 'topic: parser').status, 0);
  assert.match(chips('brief', 'task_e1').stdout, /^\[P1\] Fix the parser \(xhigh\)\n[\s\S]*Effort: xhigh\./);
  assert.equal(chip(parser, 'updated', 'effort: high').status, 0);
  assert.match(chips().stdout, /task_e1 {2}Fix the parser {2}\[parser\]/);
  assert.match(chips('brief', 'task_e1').stdout, /^\[P1\] Fix the parser\n[\s\S]*Effort: high\./);
  assert.equal(chip(parser, 'updated', 'effort: xhigh').status, 0);
  assert.match(chips('brief', 'task_e1').stdout, /Effort: xhigh\./, 'an updated row raises it again');
  assert.match(chip(parser, 'updated', 'effort: max').stderr, /effort: is high or xhigh/);
  const design = 'task_e2 Decide the parser shape';
  assert.equal(offer(design, 'src/q.ts', 'topic: parser-shape; kind: decide').status, 0);
  assert.equal(chip(design, 'updated', 'effort: high').status, 0);
  assert.match(chips('brief', 'task_e2').stdout, /^\[P1\] Decide the parser shape \(xhigh\)\n[\s\S]*Effort: xhigh\./, 'a design question stays at xhigh');
});

test('a fold only raises a task, and a dup of an xhigh task raises a task lowered to high', () => {
  const { chip, chips, offer } = chipLedger();
  const kept = 'task_k1 Fix the footer (xhigh)';
  assert.equal(offer(kept, 'docs/f.md', 'topic: footer').status, 0);
  assert.equal(chip(kept, 'updated', 'effort: high').status, 0);
  assert.match(chip(kept, 'folded', 'effort: high').stderr, /a folded row takes effort: xhigh only/);
  assert.equal(offer('task_d1 Rework the footer layout (xhigh)', 'docs/f.md', 'topic: footer').status, 0);
  assert.equal(chip('task_d1 Rework the footer layout (xhigh)', 'dismissed dup task_k1').status, 0);
  assert.match(chips('brief', 'task_k1').stdout, /^\[P1\] Fix the footer \(xhigh\)\n[\s\S]*Effort: xhigh\./);
});

test('a task that holds a card takes an updated row that only changes its effort', () => {
  const { chip, offer } = chipLedger();
  const parser = 'task_c1 Fix the parser (xhigh)';
  assert.equal(offer(parser, 'src/p.ts', 'topic: parser; card: c1; session: s1').status, 0);
  assert.equal(chip(parser, 'updated', 'effort: high').status, 0, 'effort changes no work');
  assert.match(chip(parser, 'updated', 'effort: xhigh; writes: src/p.ts, src/q.ts').stderr, /task_c1 holds card c1, which cannot change/);
});

test("an effort change on a carded task lists its card in the holder's withdrawal pass, then the card pass offers it again", () => {
  const { chip, chips, offer } = chipLedger();
  const parser = 'task_c1 Fix the parser (xhigh)';
  assert.equal(offer(parser, 'src/p.ts', 'topic: parser; card: c1; session: s1').status, 0);
  assert.doesNotMatch(chips('--session', 's1').stdout, /withdraw task_c1/, 'a card at its task effort stays');
  assert.equal(chip(parser, 'updated', 'effort: high').status, 0);
  const holder = chips('--session', 's1').stdout;
  assert.match(holder, /Do, withdrawal pass[\s\S]*withdraw task_c1's card c1: it was offered at xhigh and the task is at high now/);
  assert.doesNotMatch(chips('--session', 's2').stdout, /withdraw task_c1/, 'only the session holding the card can withdraw it');
  assert.equal(chip(parser, 'uncarded', 'card: c1').status, 0);
  assert.match(chips('--session', 's1').stdout, /Do, card pass[\s\S]*card task_c1:/);
});

