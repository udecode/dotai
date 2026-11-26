import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DOTAI_BUDGETS, SIZE_BUDGETS } from './audit.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
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

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'skill-audit-test-'));
  const home = join(dir, 'home');
  mkdirSync(home);
  const env = { ...process.env, HOME: home };
  const run = (command, args, cwd) => spawnSync(command, args, { cwd, encoding: 'utf8', env });
  return { dir, env, home, run };
}

function project(dir, name, { config, agents, files = {} } = {}) {
  const root = join(dir, name);
  mkdirSync(root, { recursive: true });
  const all = {
    ...files,
    ...(agents === undefined ? {} : { 'AGENTS.md': agents }),
    ...(config ? { '.agents/pstack.json': JSON.stringify(config, null, 2) } : {}),
  };
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

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

test('audit detects user skills, standalone installed copy without sync-pstack, overlaps, routes, and symlink boundaries', () => {
  const { dir, home: link, run } = sandbox();
  const home = realpathSync(link);
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
      `again [$security-triage](<${home}/.agents/skills/security-triage/my notes/../SKILL.md>)`,
      'play $game-guides',
    ].map((text) => JSON.stringify({ type: 'user', timestamp: now, message: { role: 'user', content: text } })).join('\n'),
  );

  const block = 'Every test must fail for a named, plausible defect and pass only once it is fixed.';
  const pstack = 'Verify against the real artifact, never a proxy that only compiles or type checks.';
  const pstackSkill = join(home, '.claude/plugins/cache/pstack-claude/pstack/9.9.9/skills/prove');
  mkdirSync(pstackSkill, { recursive: true });
  writeFileSync(join(pstackSkill, 'SKILL.md'), `# Prove\n\n${pstack}\n`);
  const sentence = (n, what) => `Rule ${n} keeps ${what} ${n} database free across every suite and runner today.`;
  const duplicates = Array.from({ length: 40 }, (_, n) => `${sentence(n, 'fixture')} ${sentence(n, 'mock')}`).join('\n\n');
  const root = project(dir, 'app', {
    agents: '# App\n\nRead CODING_STANDARDS.md and docs/guide.md. Vendor skills (rate-limiter-flexible) are references.\n',
    files: {
      '.agents/pstack.json': '{ "tag": "v9.9.9" }\n',
      'CODING_STANDARDS.md': 'Use `$cross-review` for a hand-off.\n',
      'docs/guide.md': 'See [the lanes](../only-rule-rel/lanes.md).\n',
      '.agents/rules/a.mdc': `# A\n\n${duplicates}\n`,
      '.agents/rules/b.mdc': `# B\n\n${duplicates}\n\n${block.replace('defect and', 'defect\nand')}\n\n${pstack}\n`,
      '.agents/rules/shipping.mdc': '---\ndescription: ship\n---\nHand off with [review](../only-rule-rel/SKILL.md). The react docs and @trpc/react-query.\n',
      ...Object.fromEntries(['cross-review', 'only-rule-rel', 'rate-limiter-flexible', 'react'].map((name) => [`.agents/skills/${name}/SKILL.md`, `---\nname: ${name}\n---\n`])),
    },
  });

  const textRes = run(process.execPath, [AUDIT, root], root);
  assert.equal(textRes.status, 0, textRes.stderr);
  assert.match(textRes.stdout, /\.agents\/rules\/b\.mdc:\d+ ~ rules\/tests\.md:\d+: Every test must fail/);
  assert.match(textRes.stdout, /\.agents\/rules\/b\.mdc:\d+ ~ pstack\/prove\/SKILL\.md:\d+: Verify against the real artifact/);
  assert.match(textRes.stdout, /repeated elsewhere in the project \(score >= 0\.5\): 80,/);

  const jsonRes = spawnSync(process.execPath, [AUDIT, root, '--json'], { cwd: home, encoding: 'utf8', env: { ...process.env, HOME: home } });
  assert.equal(jsonRes.status, 0, jsonRes.stderr);
  const data = JSON.parse(jsonRes.stdout);
  assert.deepEqual(Object.fromEntries(data.userSkills.map((s) => [s.name, s.typed.all])), { 'game-guides': 1, orchestrator: 0, 'security-triage': 2 });
  assert.deepEqual(Object.fromEntries(data.skills.map((s) => [s.name, s.routes])), {
    'cross-review': ['CODING_STANDARDS.md'],
    'only-rule-rel': ['.agents/rules/shipping.mdc'],
    'rate-limiter-flexible': ['AGENTS.md'],
    react: [],
  });

  // Standalone installed copy (without sibling sync-pstack) runs cleanly and reports dotai facts as unknown.
  const installed = join(home, '.agents/skills/skill-audit');
  cpSync(dirname(HERE), installed, { recursive: true });
  const inst = run(process.execPath, [join(installed, 'scripts/audit.mjs'), root, '--json'], root);
  assert.equal(inst.status, 0, inst.stderr);
  const instData = JSON.parse(inst.stdout);
  const self = instData.userSkills.find((e) => e.name === 'skill-audit');
  assert.deepEqual([self.inDotai, self.stale], [null, null]);
  assert.equal(instData.dotai, null);

  // Symlinked AGENTS.md inside project skips its own block; symlink outside project is ignored.
  const blockBody = `<!-- pstack:begin -->\n${block}\n<!-- pstack:end -->\n`;
  const sym = project(dir, 'sym', {
    config: CONFIG,
    files: {
      'instructions.md': `# App\n\n${blockBody}`,
      '.agents/skills/cross-review/SKILL.md': '---\nname: cross-review\n---\n',
    },
  });
  symlinkSync('instructions.md', join(sym, 'AGENTS.md'));
  assert.deepEqual(JSON.parse(run(process.execPath, [AUDIT, sym, '--json'], sym).stdout).overlaps.filter((o) => o.with === 'block'), []);
  const outside = join(dir, 'outside.md');
  writeFileSync(outside, '# App\n\nUse `$cross-review`.\n');
  rmSync(join(sym, 'AGENTS.md'));
  symlinkSync(outside, join(sym, 'AGENTS.md'));
  assert.deepEqual(JSON.parse(run(process.execPath, [AUDIT, sym, '--json'], sym).stdout).skills.find((s) => s.name === 'cross-review').routes, []);
});

test('audit handles non-pstack plain repos and dotai-shaped repos without .agents/pstack.json', () => {
  const { dir, run } = sandbox();

  const plain = project(dir, 'plain', {
    agents: '# Plain\n\nUse `$custom-flow` for releases.\n',
    files: {
      '.agents/playbooks/release.md': '# Release\n\nVerify every package build before tagging a release version.\n',
      '.agents/rules/custom-flow.mdc': '# Custom\n\nVerify every package build before tagging a release version.\n',
      '.agents/skills/custom-flow/SKILL.md': '---\nname: custom-flow\ndescription: x\n---\n',
    },
  });
  const plainRes = run(process.execPath, [AUDIT, plain]);
  assert.equal(plainRes.status, 0, plainRes.stderr);
  assert.match(plainRes.stdout, /non-pstack repo/);
  assert.match(plainRes.stdout, /custom-flow \| rule \| 0 \(0\) \| 1 \|/);
  assert.match(plainRes.stdout, /## Size budgets \(over cap: 0\)/);
  assert.match(plainRes.stdout, /## Block rules with no overrides note or adds marker: not checked/);
  assert.match(plainRes.stdout, /## Project sentences repeated elsewhere in the project \(score >= 0\.5\): 1/);

  const dotaiLike = project(dir, 'dotai-like', {
    agents: '# Dotai\n',
    files: {
      'upstream-skills.json': '{"skills":[]}\n',
      'skills/alpha/SKILL.md': `---\nname: alpha\ndescription: x\n---\n${'x'.repeat(DOTAI_BUDGETS.skillFile + 1)}\n`,
      'skills/beta/SKILL.md': '---\nname: beta\ndescription: x\n---\nAlways validate schema boundaries before mutating any tracked config file.\n',
      'skills/gamma/SKILL.md': '---\nname: gamma\ndescription: x\n---\nAlways validate schema boundaries before mutating any tracked config file.\n',
      'skills/sync-pstack/assets/block.md': '- **Unmarked rule.** Do something.\n',
      'skills/sync-pstack/assets/pstack/rules/big.md': 'r'.repeat(DOTAI_BUDGETS.ruleFile + 1),
    },
  });
  const dotaiRes = run(process.execPath, [AUDIT, dotaiLike, '--json']);
  assert.equal(dotaiRes.status, 0, dotaiRes.stderr);
  const parsed = JSON.parse(dotaiRes.stdout);
  assert.deepEqual(parsed.skills.map((s) => s.name), ['alpha', 'beta', 'gamma']);
  assert.deepEqual(parsed.unmarkedRules, ['Unmarked rule']);
  assert.deepEqual(
    parsed.sizeBudgets.over.map(({ kind, path }) => ({ kind, path })),
    [
      { kind: 'dotai-rule-file', path: 'skills/sync-pstack/assets/pstack/rules/big.md' },
      { kind: 'dotai-skill-file', path: 'skills/alpha/SKILL.md' },
    ],
  );
  assert.ok(parsed.overlaps.some((o) => o.with === 'project' && o.file === 'skills/beta/SKILL.md' && o.source.startsWith('skills/gamma/SKILL.md:')));
});

test('audit skips node_modules and scripts markdown, excludes binary assets from skill-dir cap, and counts routes from .agents/pstack/rules', () => {
  const { dir, run } = sandbox();
  const duplicate = 'Always run deterministic schema validation before writing tracked workspace files.';

  const repo = project(dir, 'fixes', {
    config: CONFIG,
    agents: '# Fixes\n',
    files: {
      '.agents/pstack/rules/long-runs.md': `# Long runs\n\nUse \`redo\` to rerun a prior plan at a higher effort.\n\n${duplicate}\n`,
      '.agents/rules/local.mdc': `# Local\n\n${duplicate}\n`,
      '.agents/skills/redo/SKILL.md': '---\nname: redo\ndescription: x\n---\n',
      '.agents/skills/clip/SKILL.md': '---\nname: clip\ndescription: x\n---\n',
      '.agents/skills/clip/assets/font.ttf': 'f'.repeat(50_000),
      '.agents/skills/clip/assets/poster.png': 'p'.repeat(50_000),
      'skills/clip/SKILL.md': '---\nname: clip\ndescription: x\n---\n',
      'skills/clip/scripts/README.md': `# Script\n\n${duplicate}\n`,
      'skills/clip/scripts/node_modules/pkg/README.md': `# Pkg\n\n${duplicate}\n`,
    },
  });

  const res = run(process.execPath, [AUDIT, repo, '--json']);
  assert.equal(res.status, 0, res.stderr);
  const data = JSON.parse(res.stdout);

  // Binary assets do not trip the 40 KB skill-dir cap.
  assert.deepEqual(data.sizeBudgets.over, []);

  // node_modules and scripts markdown produce zero overlap hits, and .agents/pstack/rules stays out of project overlaps.
  assert.equal(
    data.overlaps.some((o) => o.file.includes('node_modules') || o.file.includes('/scripts/') || o.file.startsWith('.agents/pstack/rules/') || o.source.startsWith('.agents/pstack/rules/')),
    false,
  );

  // Route counting scans .agents/pstack/rules/*.md so `redo` routed by long-runs.md reports routes >= 1.
  const redo = data.skills.find((s) => s.name === 'redo');
  assert.deepEqual(redo.routes, ['.agents/pstack/rules/long-runs.md']);
});
