#!/usr/bin/env node
// Checks the rows a show-me-your-work decision log gained since HEAD, so a
// committed row always says plainly whether its work is fixed, partial or still
// open. Rows already committed are left as history. Installed by sync-pstack.
// Usage: node .agents/pstack/decisions-check.mjs <log.decisions.tsv> [...]
//        node .agents/pstack/decisions-check.mjs --all
//        node .agents/pstack/decisions-check.mjs append <log> <phase> <decision> <why> <evidence> <result>
//        (stamps the row, checks it, and writes it only when it passes)

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const HEADER = 'ts\tphase\tdecision\twhy\tevidence\tresult';
const STATUSES = [
  'applied',
  'blocked',
  'corrected',
  'decided',
  'dismissed',
  'fixed',
  'gap',
  'inconclusive',
  'kept',
  'open',
  'partial',
  'proven',
  'recorded',
  'reverted',
  'skipped',
  'superseded',
  'verified',
];
const PROVEN = ['fixed', 'proven', 'verified'];
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u;
const CELLS = ['phase', 'decision', 'why', 'evidence', 'result'];

function plansDir() {
  const config = '.agents/pstack.json';
  return (existsSync(config) && JSON.parse(readFileSync(config, 'utf8')).plans) || 'docs/plans';
}

function committedRows(path) {
  const committed = spawnSync('git', ['show', `HEAD:./${relative(process.cwd(), path)}`], { encoding: 'utf8' });
  return new Set(committed.status === 0 ? committed.stdout.split('\n') : []);
}

function rowProblems(line, where) {
  const cells = line.split('\t');
  if (cells.length !== 6) return [`${where}: ${cells.length} cells, expected 6`];
  const found = [];
  const [ts, ...rest] = cells;
  if (!TIMESTAMP.test(ts)) found.push(`${where}: ts "${ts}" is not UTC ISO8601`);
  for (const [cell, value] of rest.entries()) {
    if (!value.trim()) found.push(`${where}: empty ${CELLS[cell]}`);
  }
  const status = rest[4].replace(/^'/u, '').match(/^[a-z]+/iu)?.[0]?.toLowerCase();
  if (rest[4].trim() && (!status || !STATUSES.includes(status))) {
    found.push(`${where}: result must start with one of: ${STATUSES.join(', ')}`);
  }
  // A claim of success names what the proof covered (widths, persona,
  // fixture, allowed or denied path), which is where overclaims hide.
  if (status && PROVEN.includes(status) && !/\bscope:/iu.test(rest[3])) {
    found.push(`${where}: a ${status} result needs "scope:" in its evidence naming what the proof covered`);
  }
  return found;
}

function problems(path) {
  const lines = readFileSync(path, 'utf8').split('\n');
  if (lines[0] !== HEADER) return [`${path}:1: header must be "${HEADER.replaceAll('\t', ' ')}"`];
  const committed = committedRows(path);
  return lines.flatMap((line, index) => (index === 0 || line === '' || committed.has(line) ? [] : rowProblems(line, `${path}:${index + 1}`)));
}

function append(path, cells) {
  if (cells.length !== 5) return [`append takes 5 cells after the log path, got ${cells.length}`];
  const broken = cells.findIndex((cell) => /[\t\n]/u.test(cell));
  if (broken !== -1) return [`${CELLS[broken]} contains a tab or newline`];
  const row = [new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z'), ...cells].join('\t');
  const found = rowProblems(row, `${path} (new row)`);
  if (found.length > 0) return found;
  if (existsSync(path)) {
    const text = readFileSync(path, 'utf8');
    appendFileSync(path, `${text === '' || text.endsWith('\n') ? '' : '\n'}${row}\n`);
  } else writeFileSync(path, `${HEADER}\n${row}\n`);
  return [];
}

const args = process.argv.slice(2);
if (args[0] === 'append') {
  const found = append(args[1] ?? '', args.slice(2));
  if (found.length > 0) {
    console.error(`Row not written:\n${found.join('\n')}`);
    process.exit(1);
  }
  console.info(`Appended a row to ${args[1]}.`);
  process.exit(0);
}
const paths =
  args[0] === '--all'
    ? readdirSync(plansDir())
        .filter((name) => name.endsWith('.decisions.tsv'))
        .map((name) => join(plansDir(), name))
    : args;
if (paths.length === 0 && args[0] !== '--all') {
  console.error('Usage: node .agents/pstack/decisions-check.mjs <log.decisions.tsv> [...] | --all');
  process.exit(2);
}
const found = paths.flatMap(problems);
if (found.length > 0) {
  console.error(`${found.length} problem(s):\n${found.join('\n')}`);
  process.exit(1);
}
console.info(`New rows are well formed in ${paths.length} log(s).`);
