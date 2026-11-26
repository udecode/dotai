import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { render, sharedTemplates, unmarkedRules, unmarkedSharedRules } from './sync-pstack.mjs';
import { CONFIG, project, read, readJson } from './test-sandbox.mjs';
import { sandbox } from './test-cli.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = readFileSync(join(HERE, '../assets/block.md'), 'utf8');
const HELPERS = join(HERE, '../assets/pstack');

test('the CLI runs through a symlinked install', () => {
  const { dir, run } = sandbox();
  symlinkSync(dirname(HERE), join(dir, 'installed'));
  const result = run(process.execPath, [join(dir, 'installed/scripts/sync-pstack.mjs'), 'help']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Usage: node sync-pstack\.mjs/);
});

test('shipped block and rule templates render cleanly for every delivery and mark every rule', () => {
  for (const [index, template] of sharedTemplates().entries()) {
    for (const [delivery, pushBranches] of [['push', false], ['pr', false], ['user', false], ['user', true]]) {
      for (const reviewList of ['', '  - `pr`: Before opening a PR, the diff gets a panel.']) {
        const rendered = render(template, { ...CONFIG, delivery, pushBranches, reviewList });
        assert.doesNotMatch(rendered, /<!--|\{\{|\}\}/, `template ${index} ${delivery}`);
        assert.doesNotMatch(rendered, /^ {2}[^\s-]/mu, `template ${index} stray indented sentence`);
      }
    }
  }
  assert.throws(() => render('run {{lintFix}}', { skip: [] }), /needs "lintFix"/);
  assert.deepEqual(unmarkedSharedRules(), []);
  assert.deepEqual(unmarkedSharedRules(TEMPLATE, { 'land.md': '- **Companion repository.** Land both halves.\n' }), ['rule "Companion repository" in rules/land.md']);
  assert.deepEqual(unmarkedRules('<!-- # adds -->\n- **Fast.** Go.\n\nOther text.\n\n- **Fast.** Skip every gate.\n'), ['Fast']);
});

test('apply refuses invalid config fields', () => {
  const { dir, cli } = sandbox();
  for (const [name, config, refusal] of [
    ['typo', { ...CONFIG, skip: ['test'] }, /skip names unknown sections: test/],
    ['string', { ...CONFIG, delivery: 'user', pushBranches: 'false' }, /pushBranches must be true or false/],
    ['push', { ...CONFIG, pushBranches: true }, /pushBranches applies only to user delivery/],
    ['effort', { ...CONFIG, maxEffort: 'extreme' }, /maxEffort must be one of low, medium, high, xhigh, max/],
    ['rounds', { ...CONFIG, maxRounds: 0 }, /maxRounds must be a whole number of 1 or more/],
  ]) {
    const result = cli('apply', project(dir, name, { config, agents: '# App\n' }));
    assert.notEqual(result.status, 0, name);
    assert.match(`${result.stdout}${result.stderr}`, refusal, name);
  }
});

test('apply inserts one block, removes retired helpers, stays idempotent, and check detects config or local drift', () => {
  const { dir, cli } = sandbox();
  const root = project(dir, 'app', {
    config: { ...CONFIG, plans: 'notes/plans', skip: ['long-runs'], reviews: [{ id: 'pr', rule: 'Before opening a PR, the diff gets a panel.' }] },
    agents: '# App rules\n\nIntro.\n\n## Product\n\nKeep this.\n',
    files: { '.agents/playbooks/bug-fix.md': '---\nextends: bug-fix\nwhen: Use it for any bug report.\n---\n# Bug fix\n' },
  });
  mkdirSync(join(root, '.agents/pstack'), { recursive: true });
  writeFileSync(join(root, '.agents/pstack/freeze.mjs'), '// retired\n');

  assert.equal(cli('apply', root).status, 0);
  const agents = read(root, 'AGENTS.md');
  assert.equal(agents.match(/<!-- pstack:begin/g).length, 1);
  assert.ok(agents.indexOf('Intro.') < agents.indexOf('<!-- pstack:begin'));
  assert.ok(agents.indexOf('<!-- pstack:end -->') < agents.indexOf('## Product\n\nKeep this.'));
  assert.match(agents, /`\.agents\/playbooks\/bug-fix\.md`, on top of pstack's `bug-fix`\. Use it for any bug report\./);
  assert.match(agents, /\n {2}- `pr`: Before opening a PR, the diff gets a panel\./);
  assert.equal(read(root, '.agents/pstack/plan-open.mjs'), readFileSync(join(HELPERS, 'plan-open.mjs'), 'utf8'));
  assert.equal(existsSync(join(root, '.agents/pstack/freeze.mjs')), false, 'retired helper removed');
  assert.equal(existsSync(join(root, '.agents/pstack/rules/long-runs.md')), false, 'skipped rule omitted');
  const trails = read(root, '.agents/pstack/rules/trails.md');
  assert.match(trails, /notes\/plans\/<date>-<slug>\.md/);
  assert.doesNotMatch(trails, /\{\{|<!--/);

  assert.match(cli('apply', root).stdout, /in sync/);
  assert.equal(cli('check', root).status, 0);

  // Every helper and rule named in rendered text stays installed.
  const rules = join(root, '.agents/pstack/rules');
  const texts = [agents, ...readdirSync(rules).map((name) => read(root, `.agents/pstack/rules/${name}`))];
  for (const path of new Set(texts.flatMap((text) => text.match(/\.agents\/pstack\/(?:rules\/)?[\w-]+\.(?:mjs|md)/gu) ?? []))) {
    assert.ok(existsSync(join(root, path)), `${path} is named but not installed`);
  }

  // Config change marks AGENTS.md and settings.json stale (not a local-edit refusal).
  writeFileSync(join(root, '.agents/pstack.json'), JSON.stringify({ ...readJson(root, '.agents/pstack.json'), tag: 'v0.9.53' }));
  const check = cli('check', root);
  assert.equal(check.status, 1);
  assert.match(check.stdout, /stale AGENTS\.md/);
  assert.match(check.stdout, /stale \.claude\/settings\.json/);

  // New playbook also marks check stale.
  assert.equal(cli('apply', root).status, 0);
  writeFileSync(join(root, '.agents/playbooks/plan.md'), '---\nextends: multi-phase-plan\nwhen: Use it to plan.\n---\n');
  assert.equal(cli('check', root).status, 1);
});

test('apply refuses main checkout of a trunk push clone, writes its worktree, and ignores local models sheet only in trunk', () => {
  const { dir, cli } = sandbox();
  const root = project(dir, 'app', { config: { ...CONFIG, delivery: 'trunk' }, agents: '# App\n', files: { '.gitignore': 'node_modules' } });
  const land = (at) => join(at, '.agents/pstack/land.mjs');
  assert.equal(cli('apply', root).status, 0);
  assert.equal(read(root, '.gitignore'), 'node_modules\n.claude/*.local.md\n');
  assert.equal(spawnSync('git', ['-C', root, 'check-ignore', '-q', '.claude/pstack-models.local.md']).status, 0);

  spawnSync('git', ['-C', root, 'add', '-A']);
  spawnSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init']);
  spawnSync('git', ['-C', root, 'config', 'pstack.delivery', 'push']);
  rmSync(land(root));

  const refused = cli('apply', root);
  assert.equal(refused.status, 1);
  assert.match(refused.stdout, /main checkout of a trunk project, which only pulls; apply in a worktree cut from origin\/next/u);
  assert.ok(!existsSync(land(root)));
  assert.equal(cli('apply', root, '--dry-run').status, 0);

  const worktree = join(dir, 'app-task');
  spawnSync('git', ['-C', root, 'worktree', 'add', '-q', '--detach', worktree]);
  assert.equal(cli('apply', worktree).status, 0);
  assert.ok(existsSync(land(worktree)));

  const other = project(dir, 'other', { config: CONFIG, agents: '# App\n' });
  assert.equal(cli('apply', other).status, 0);
  assert.equal(existsSync(join(other, '.gitignore')), false);
});

test('switching delivery to trunk and back swaps shared-checkout files for landing ones', () => {
  const { dir, cli } = sandbox();
  const root = project(dir, 'app', { config: CONFIG, agents: '# App\n' });
  const pstack = (name) => join(root, '.agents/pstack', name);
  const sharedCheckout = ['codex-build.md', 'rules/close.md', 'rules/codex.md'];
  const landing = ['guard.mjs', 'land.mjs', 'review.mjs', 'setup.mjs', 'rules/land.md'];
  const everywhere = ['cross.mjs', 'decisions-check.mjs', 'lead.mjs', 'plan-open.mjs', 'plan-page.mjs', 'proof.mjs', 'status.mjs', 'tasks.mjs', 'checkout.mjs', 'rules/autopilot.md', 'rules/chips.md', 'rules/git.md', 'rules/panel.md', 'rules/pages.md', 'rules/title.md', 'rules/trails.md', 'rules/long-runs.md'];
  const deliver = (delivery) => {
    writeFileSync(join(root, '.agents/pstack.json'), `${JSON.stringify({ ...readJson(root, '.agents/pstack.json'), delivery }, null, 2)}\n`);
    const res = cli('apply', root);
    assert.equal(res.status, 0, `${delivery}: ${res.stdout}${res.stderr}`);
    const texts = [read(root, 'AGENTS.md'), ...readdirSync(pstack('rules')).map((name) => read(root, `.agents/pstack/rules/${name}`))];
    for (const path of new Set(texts.flatMap((text) => text.match(/\.agents\/pstack\/(?:rules\/)?[\w-]+\.(?:mjs|md)/gu) ?? []))) {
      assert.ok(existsSync(join(root, path)), `${delivery}: ${path} is named but not installed`);
    }
  };
  deliver('push');
  deliver('trunk');
  for (const name of sharedCheckout) assert.ok(!existsSync(pstack(name)), `trunk keeps ${name}`);
  for (const name of [...landing, ...everywhere]) assert.ok(existsSync(pstack(name)), `trunk lacks ${name}`);
  deliver('push');
  for (const name of [...sharedCheckout, ...everywhere]) assert.ok(existsSync(pstack(name)), `push lacks ${name}`);
  for (const name of landing) assert.ok(!existsSync(pstack(name)), `push keeps ${name}`);
});

test('pushBranches toggles branch pushes in user delivery', () => {
  const { dir, cli } = sandbox();
  const owner = project(dir, 'owner', { config: { ...CONFIG, delivery: 'user' }, agents: '# App\n' });
  const branches = project(dir, 'branches', { config: { ...CONFIG, delivery: 'user', pushBranches: true }, agents: '# App\n' });
  assert.equal(cli('apply', owner).status, 0);
  assert.equal(cli('apply', branches).status, 0);
  assert.match(read(owner, '.agents/pstack/rules/git.md'), /The repair stays uncommitted there for the owner's commit\./);
  assert.match(read(branches, 'AGENTS.md'), /On every other branch the lead commits and pushes/);
  assert.match(read(branches, '.agents/pstack/rules/git.md'), /git push origin HEAD:<head branch>/);
});

test('apply drops legacy page lists from config once a playbook carries them, and refuses until then', () => {
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
