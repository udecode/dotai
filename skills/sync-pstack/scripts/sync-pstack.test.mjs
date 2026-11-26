import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { render, sharedTemplates, unmarkedRules, unmarkedSharedRules } from './sync-pstack.mjs';
import { CONFIG, commit, project, read, readJson } from './test-sandbox.mjs';
import { sandbox, sharedSource } from './test-cli.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const TEMPLATE = readFileSync(join(HERE, '../assets/block.md'), 'utf8');
const HELPERS = join(HERE, '../assets/pstack');

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
    ['rounds', { ...CONFIG, maxRounds: 0 }, /maxRounds must be a whole number of 1 or more/],
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
  const applied = cli('apply', root);
  assert.equal(applied.status, 0, `${applied.stdout}${applied.stderr}`);
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
  const landing = ['guard.mjs', 'land.mjs', 'replay.mjs', 'review.mjs', 'setup.mjs', 'rules/land.md'];
  const everywhere = ['cross.mjs', 'decisions-check.mjs', 'lead.mjs', 'levels.mjs', 'plan-open.mjs', 'plan-page.mjs', 'proof.mjs', 'status.mjs', 'tasks.mjs', 'rules/chips.md', 'rules/panel.md', 'rules/pages.md', 'rules/title.md', 'checkout.mjs', 'reread.mjs', 'rules/long-runs.md'];
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

test('every block and rule-file rule says how it relates to pstack, and a rule whose marker is removed is flagged', () => {
  assert.deepEqual(unmarkedSharedRules(), []);
  assert.deepEqual(unmarkedSharedRules(TEMPLATE, { 'land.md': '- **Companion repository.** Land both halves.\n' }), ['rule "Companion repository" in rules/land.md']);
  assert.deepEqual(unmarkedSharedRules(TEMPLATE, { 'panel.md': '- **Panel review.** Seats run as the block says.\n' }), []);
  const stripped = TEMPLATE.replace(/^<!-- # adds -->\n(?=- \*\*Blocked\.\*\*)/mu, '');
  assert.notEqual(stripped, TEMPLATE);
  assert.deepEqual(unmarkedRules(stripped), ['Blocked']);
  assert.deepEqual(unmarkedRules('<!-- # relies ketchup/SKILL.md "## Write the reply" -->\n- **Probe.** Follow that reply format.'), []);
});

test('a rule-file rule shares the notes only of the block rule that points to its file, not of one that cites it', () => {
  assert.deepEqual(unmarkedSharedRules(TEMPLATE, { 'land.md': '- **Plan pages.** Publish nothing.\n' }), ['rule "Plan pages" in rules/land.md']);
});

test('a rule that repeats a noted rule name away from it needs notes of its own', () => {
  assert.deepEqual(unmarkedRules('<!-- # adds -->\n- **Fast.** Go.\n\nOther text.\n\n- **Fast.** Skip every gate.\n'), ['Fast']);
});

test("apply makes git ignore a person's local models sheet in a trunk project only", () => {
  const { dir, cli } = sandbox();
  const trunk = project(dir, 'trunk', { config: { ...CONFIG, delivery: 'trunk' }, agents: '# App\n', files: { '.gitignore': 'node_modules' } });
  assert.equal(cli('apply', trunk).status, 0);
  assert.equal(read(trunk, '.gitignore'), 'node_modules\n.claude/*.local.md\n');
  assert.equal(spawnSync('git', ['-C', trunk, 'check-ignore', '-q', '.claude/pstack-models.local.md']).status, 0);
  assert.match(cli('apply', trunk).stdout, /in sync/);
  const other = project(dir, 'other', { config: CONFIG, agents: '# App\n' });
  assert.equal(cli('apply', other).status, 0);
  assert.equal(existsSync(join(other, '.gitignore')), false);
});
