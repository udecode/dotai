import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { audit, report, SIZE_BUDGETS, sizeAudit } from './audit.mjs';
import { CONFIG, project, sandbox } from './test-sandbox.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const AUDIT = join(HERE, 'audit.mjs');

test('sizeAudit reports zero findings when playbooks, rules, and skills stay under caps and excludes skill scripts/', () => {
  const { dir } = sandbox();
  const root = project(dir, 'clean', {
    config: CONFIG,
    agents: '# Clean\n',
    files: {
      '.agents/playbooks/plan.md': 'a'.repeat(SIZE_BUDGETS.playbookFile),
      '.agents/rules/core.mdc': 'b'.repeat(SIZE_BUDGETS.ruleFile),
      '.agents/skills/demo/SKILL.md': 'c'.repeat(SIZE_BUDGETS.skillFile),
      '.agents/skills/demo/references/guide.md': 'd'.repeat(SIZE_BUDGETS.skillDir - SIZE_BUDGETS.skillFile),
      '.agents/skills/demo/scripts/heavy.mjs': 'e'.repeat(60_000),
    },
  });
  const result = sizeAudit(root);
  assert.deepEqual(result.over, []);
  assert.equal(result.totals.playbooks, SIZE_BUDGETS.playbookFile);
  assert.equal(result.totals.rules, SIZE_BUDGETS.ruleFile);
  assert.equal(result.totals.skills, SIZE_BUDGETS.skillDir);

  const rendered = report(audit(root));
  assert.match(rendered, /## Size budgets \(over cap: 0\)\nnone \(playbooks total 14000\/70000 B\)/);
});

test('sizeAudit flags over-budget playbooks, total playbooks, rules, SKILL.md, and skill folders (excluding scripts/)', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'bloated', {
    config: CONFIG,
    agents: '# Bloated\n',
    files: {
      '.agents/playbooks/a.md': 'a'.repeat(14_001),
      '.agents/playbooks/b.md': 'b'.repeat(14_000),
      '.agents/playbooks/c.md': 'c'.repeat(14_000),
      '.agents/playbooks/d.md': 'd'.repeat(14_000),
      '.agents/playbooks/e.md': 'e'.repeat(14_000),
      '.agents/rules/huge.mdc': 'r'.repeat(14_001),
      '.agents/skills/big/SKILL.md': 's'.repeat(20_001),
      '.agents/skills/big/references/extra.md': 'x'.repeat(20_000),
      '.agents/skills/big/scripts/ignored.mjs': 'z'.repeat(50_000),
      '.agents/skills/scripts-heavy/SKILL.md': 'k'.repeat(5_000),
      '.agents/skills/scripts-heavy/scripts/sub/helper.mjs': 'h'.repeat(80_000),
    },
  });

  const result = sizeAudit(root);
  assert.deepEqual(
    result.over.map(({ kind, path, bytes, limit }) => ({ kind, path, bytes, limit })),
    [
      { kind: 'playbook-file', path: '.agents/playbooks/a.md', bytes: 14_001, limit: 14_000 },
      { kind: 'playbooks-total', path: '.agents/playbooks', bytes: 70_001, limit: 70_000 },
      { kind: 'rule-file', path: '.agents/rules/huge.mdc', bytes: 14_001, limit: 14_000 },
      { kind: 'skill-dir', path: '.agents/skills/big', bytes: 40_001, limit: 40_000 },
      { kind: 'skill-file', path: '.agents/skills/big/SKILL.md', bytes: 20_001, limit: 20_000 },
    ],
  );

  const cliText = run(process.execPath, [AUDIT, root]);
  assert.equal(cliText.status, 0, cliText.stderr);
  assert.match(cliText.stdout, /## Size budgets \(over cap: 5\)/);
  assert.match(cliText.stdout, /playbook-file \| \.agents\/playbooks\/a\.md \| 14001 \| 14000/);
  assert.match(cliText.stdout, /playbooks-total \| \.agents\/playbooks \| 70001 \| 70000/);
  assert.match(cliText.stdout, /rule-file \| \.agents\/rules\/huge\.mdc \| 14001 \| 14000/);
  assert.match(cliText.stdout, /skill-file \| \.agents\/skills\/big\/SKILL\.md \| 20001 \| 20000/);
  assert.match(cliText.stdout, /skill-dir \| \.agents\/skills\/big \| 40001 \| 40000/);
  const sizeSection = cliText.stdout.slice(cliText.stdout.indexOf('## Size budgets'));
  assert.doesNotMatch(sizeSection, /scripts-heavy/);

  const cliJson = run(process.execPath, [AUDIT, root, '--json']);
  assert.equal(cliJson.status, 0, cliJson.stderr);
  const parsed = JSON.parse(cliJson.stdout);
  assert.equal(parsed.sizeBudgets.over.length, 5);
});
