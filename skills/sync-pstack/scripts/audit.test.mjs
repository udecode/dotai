import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SIZE_BUDGETS } from './audit.mjs';
import { CONFIG, project, sandbox } from './test-sandbox.mjs';

const AUDIT = join(dirname(fileURLToPath(import.meta.url)), 'audit.mjs');

test('audit size budgets pass at cap, exclude scripts/, and flag every over-cap kind in text and JSON', () => {
  const { dir, run } = sandbox();
  const clean = project(dir, 'clean', {
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
  const okText = run(process.execPath, [AUDIT, clean]);
  assert.equal(okText.status, 0, okText.stderr);
  assert.match(okText.stdout, /## Size budgets \(over cap: 0\)\nnone \(playbooks total 14000\/70000 B\)/);

  const bloated = project(dir, 'bloated', {
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
  const cliText = run(process.execPath, [AUDIT, bloated]);
  assert.equal(cliText.status, 0, cliText.stderr);
  assert.match(cliText.stdout, /## Size budgets \(over cap: 5\)/);
  assert.match(cliText.stdout, /playbook-file \| \.agents\/playbooks\/a\.md \| 14001 \| 14000/);
  assert.match(cliText.stdout, /playbooks-total \| \.agents\/playbooks \| 70001 \| 70000/);
  assert.match(cliText.stdout, /rule-file \| \.agents\/rules\/huge\.mdc \| 14001 \| 14000/);
  assert.match(cliText.stdout, /skill-file \| \.agents\/skills\/big\/SKILL\.md \| 20001 \| 20000/);
  assert.match(cliText.stdout, /skill-dir \| \.agents\/skills\/big \| 40001 \| 40000/);
  assert.doesNotMatch(cliText.stdout.slice(cliText.stdout.indexOf('## Size budgets')), /scripts-heavy/);

  const cliJson = run(process.execPath, [AUDIT, bloated, '--json']);
  assert.equal(cliJson.status, 0, cliJson.stderr);
  assert.deepEqual(
    JSON.parse(cliJson.stdout).sizeBudgets.over.map(({ kind, path, bytes, limit }) => ({ kind, path, bytes, limit })),
    [
      { kind: 'playbook-file', path: '.agents/playbooks/a.md', bytes: 14_001, limit: 14_000 },
      { kind: 'playbooks-total', path: '.agents/playbooks', bytes: 70_001, limit: 70_000 },
      { kind: 'rule-file', path: '.agents/rules/huge.mdc', bytes: 14_001, limit: 14_000 },
      { kind: 'skill-dir', path: '.agents/skills/big', bytes: 40_001, limit: 40_000 },
      { kind: 'skill-file', path: '.agents/skills/big/SKILL.md', bytes: 20_001, limit: 20_000 },
    ],
  );
});
