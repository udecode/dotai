import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CONFIG, project, read, sandbox } from './test-sandbox.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HELPERS = join(HERE, '../assets/pstack');

test('decisions-check append validates 6 cells, status words, scope: on proven rows, and writes only valid rows', () => {
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

test('decisions-check prints every problem of a long log through a pipe', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app');
  const rows = Array.from({ length: 4000 }, (_, n) => `2026-01-01T00:00:00Z\tbuild\tdecision ${n}\twhy\tevidence`);
  writeFileSync(join(root, 'long.decisions.tsv'), `ts\tphase\tdecision\twhy\tevidence\tresult\n${rows.join('\n')}\n`);
  const result = run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'long.decisions.tsv'], root);
  assert.equal(result.status, 1);
  const [announced, ...problems] = result.stderr.trim().split('\n');
  assert.equal(announced, '4000 problem(s):');
  assert.equal(problems.length, 4000);
});

test('decisions-check validates basic panel rows and rejects chip states outside phase chip', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', { config: CONFIG });
  const append = (phase, decision, result) => run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'append', 'log.decisions.tsv', phase, decision, 'why', 'evidence', result], root);
  assert.equal(append('panel', 'seats opus @high, codex:gpt-6.2-sol @high', 'recorded').status, 0);
  assert.equal(append('panel', 'missing severity', 'applied: fixed').status, 1);
  assert.equal(append('panel', 'critical [opus]: broken check', 'applied').status, 1);
  assert.equal(append('panel', 'critical [opus]: broken check', 'applied: fixed in parser.ts').status, 0);
  assert.equal(append('build', 'offer task', 'offered').status, 1);
});

test('decisions-check append --from appends batches atomically and rejects invalid batches', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app');
  const queue = join(root, 'queue.tsv');
  writeFileSync(queue, 'plan\tpick A\twhy\tevidence\tdecided\nbuild\tbad row\twhy\tevidence\tbogus\n');
  assert.equal(run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'append', 'log.decisions.tsv', '--from', queue], root).status, 1);
  assert.equal(existsSync(join(root, 'log.decisions.tsv')), false);

  writeFileSync(queue, 'plan\tpick A\twhy\tevidence\tdecided\nbuild\tship A\twhy\tscope: tests\tverified\n');
  const ok = run(process.execPath, [join(HELPERS, 'decisions-check.mjs'), 'append', 'log.decisions.tsv', '--from', queue], root);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /Appended 2 rows to log\.decisions\.tsv\./u);
});
