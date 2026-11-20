import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { hintModes } from './sync-pstack.mjs';
import { CONFIG, commit, project, read, readJson } from './test-sandbox.mjs';
import { ABSENT, PSTACK, pstackRepo, sandbox, setupFixture, sharedSource } from './test-cli.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'sync-pstack.mjs');

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

test('verify flags a playbook that extends a missing pstack playbook, a change with no anchor, and an override pstack no longer says', () => {
  const upstream = pstackRepo(mkdtempSync(join(tmpdir(), 'sync-pstack-upstream-')), {
    'v0.9.52': { 'poteto-mode/playbooks/feature.md': ABSENT, 'interrogate/SKILL.md': ABSENT, 'poteto-mode/playbooks/triage.md': '1. Sort it.\n' },
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
  assert.match(result.stdout, /the block relies on interrogate\/SKILL\.md, which pstack v0\.9\.52 no longer has/);
  assert.match(result.stdout, /pstack v0\.9\.52 has the triage playbook, which PSTACK_PLAYBOOKS in the plan-page renderer lacks/);
  assert.doesNotMatch(result.stdout, /has the bug-fix playbook/);
});

test('argument-hint modes are the literal words that open an alternative, outside placeholders', () => {
  assert.deepEqual(hintModes("argument-hint: '[<question | plan path to extend> | diagnose <report> | --deep]'"), ['diagnose']);
  assert.deepEqual(hintModes('argument-hint: [sync [package] | <path>]'), ['sync']);
  assert.deepEqual(hintModes("argument-hint: '[status | promote] [dry-run] <scope>'"), ['status', 'promote']);
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

test('verify fails a setup that cut a typed command, left dead links or retired names, coupled a public skill, drifted the block, or ships a rule with no note', () => {
  const { dir, home, run } = sandbox();
  const root = setupFixture(dir, home);
  for (const path of ['.agents/rules/task.mdc', '.agents/skills/task/SKILL.md']) rmSync(join(root, path));
  writeFileSync(join(root, '.agents/skills/sync-ui/SKILL.md'), '---\nname: sync-ui\n---\n# Sync UI\n\nClose with `node .agents/pstack/plan-open.mjs <plan>`.\n');
  writeFileSync(join(root, 'AGENTS.md'), read(root, 'AGENTS.md').replace('allow two informed attempts or ten minutes', 'allow three informed attempts or ten minutes'));
  const shared = sharedSource(dir);
  appendFileSync(join(shared.repo, 'skills/sync-pstack/assets/pstack/rules/land.md'), '\n- **Planted.** Land without a note.\n');

  const result = run(process.execPath, [shared.script, 'verify', root]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /rule "Planted" in rules\/land\.md has no overrides or relies note/);
  assert.match(result.stdout, /typed command `task` .*no longer resolves/);
  assert.match(result.stdout, /\.agents\/skills\/feature\/SKILL\.md: dead link \.\.\/task\/SKILL\.md/);
  assert.match(result.stdout, /\.agents\/rules\/feature\.mdc:6: names retired `task`/);
  assert.match(result.stdout, /public skill `sync-ui` depends on \.agents\/pstack\//);
  assert.match(result.stdout, /block or helpers differ/);
});

test('verify reads no link inside inline code', () => {
  const { dir, home, cli } = sandbox();
  const root = setupFixture(dir, home);
  writeFileSync(join(root, '.agents/skills/feature/SKILL.md'), '---\nname: feature\n---\n# Feature\n\nPlan it with [Task](../task/SKILL.md). One at a time reads `link[ref v2]("ab")`.\n');
  const deadLinks = {
    'double-backticks.md': ['Wrap code in `` ` `` and see [Gone](../gone/SKILL.md) per `rule`.\n', '../gone/SKILL.md'],
    'double-run.md': ['``a`b`` [Gone](../gone/SKILL.md) `tail`\n', '../gone/SKILL.md'],
    'double-unmatched.md': ['``a [Gone](../gone/SKILL.md) `b`\n', '../gone/SKILL.md'],
    'double-wraps.md': ['See ``foo\nbar`` and [Gone](../gone/SKILL.md) and `x`.\n', '../gone/SKILL.md'],
    'mixed-runs.md': ['`a``b` [Gone](../gone/SKILL.md) ``c``\n', '../gone/SKILL.md'],
    'escaped.md': ['Type \\` then [Gone](../gone/SKILL.md) and `x`.\n', '../gone/SKILL.md'],
    'wrapped-span.md': ['See `foo\nbar` and [Gone](../gone/SKILL.md) and `x`.\n', '../gone/SKILL.md'],
    'tick-in-destination.md': ['[Gone](../task`old`/SKILL.md)\n', '../task`old`/SKILL.md'],
    'table-cell.md': ['| a | b |\n| --- | --- |\n| `x [Gone](../gone/SKILL.md) | y` |\n', '../gone/SKILL.md'],
    'html-before-span.md': ['<i title="`">[Gone](../gone/SKILL.md)`</i> and `x`\n', '../gone/SKILL.md'],
    'paren-in-destination.md': ['[x](a(b)`) [Gone](../gone/SKILL.md) `y\n', '../gone/SKILL.md'],
    'tick-in-label.md': ['[t][b`c] [Gone](../gone/SKILL.md) `y\n\n[b`c]: /u\n', '../gone/SKILL.md'],
    'destination-next-line.md': ['[x](\n`a) [Gone](../gone/SKILL.md) `y\n', '../gone/SKILL.md'],
    'quote-in-destination.md': ['[x](b"("c)z`) [Gone](../gone/SKILL.md) `y\n', '../gone/SKILL.md'],
    'nbsp-line-table.md': ['| a | b |\n| - | - |\n \n| `x [Gone](../gone/SKILL.md) | y` |\n', '../gone/SKILL.md'],
    'nbsp-line-paragraph.md': ['`foo\n \nbar` [Gone](../gone/SKILL.md) `tail\n', '../gone/SKILL.md'],
    'bare-url.md': ['See https://x.com/a` [Gone](../gone/SKILL.md) `b\n', '../gone/SKILL.md'],
    'bare-www.md': ['See www.x.com/a` [Gone](../gone/SKILL.md) `b\n', '../gone/SKILL.md'],
    'bare-ftp.md': ['See ftp://x.com/a` [Gone](../gone/SKILL.md) `b\n', '../gone/SKILL.md'],
    'footnote-definition.md': ['See this[^a`b].\n\n[^a`b]: [Gone](../gone/SKILL.md) `c\n', '../gone/SKILL.md'],
    'footnote-call.md': ['[^a`b] [Gone](../gone/SKILL.md) `c\n\n[^a`b]: note\n', '../gone/SKILL.md'],
  };
  const quiet = {
    'no-link.md': '[Gone]`example`(../gone/SKILL.md)\n',
    'span-tokens.md': 'Tokens `[a](b)`, `<br/>`, `<`, `\\` and `|` stay code.\n',
    'quote-destination-code.md': '[x](https://example.com/a"b) `[Gone](../gone/SKILL.md)`\n',
    'apostrophe-destination-code.md': "[a](https://x.com/it's) `[Gone](../gone/SKILL.md)`\n",
    'double-span.md': 'Show ``a `[Gone](../gone/SKILL.md)` b`` as code.\n',
    'double-span-html.md': 'Use ``a <u>b</u> [Gone](../gone/SKILL.md) now`` here.\n',
    'span-after-double.md': 'First ``a`b`` here,\nthen `[Gone](../gone/SKILL.md)` stays code.\n',
  };
  for (const [file, [text]] of Object.entries(deadLinks)) writeFileSync(join(root, '.agents/skills/feature', file), text);
  for (const [file, text] of Object.entries(quiet)) writeFileSync(join(root, '.agents/skills/feature', file), text);
  const result = cli('verify', root);
  const wrong = [
    ...Object.entries(deadLinks).filter(([file, [, target]]) => !result.stdout.includes(`.agents/skills/feature/${file}: dead link ${target}`)).map(([file]) => `missed ${file}`),
    ...['dead link "ab"', ...Object.keys(quiet)].filter((text) => result.stdout.includes(text)).map((text) => `reported ${text}`),
  ];
  assert.deepEqual(wrong, []);
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
