#!/usr/bin/env node
// Fails a plan that still has open work, so no plan is marked Done with an
// unchecked box or a placeholder left in it. In a Done plan, a box closed since
// HEAD must name the artifact that closed it, and a deferred or open finding
// added since HEAD must name its owner; committed lines stay as history.
// Installed by the sync-pstack skill.
// Usage: node .agents/pstack/plan-open.mjs <plan.md> [...]
//        node .agents/pstack/plan-open.mjs --done   (every plan whose status says Done)

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const OPEN_BOX = /^\s*(?:[-*+]|\d+\.)\s+\[ \]/u;
const CLOSED_BOX = /^\s*(?:[-*+]|\d+\.)\s+\[[xX]\]/u;
const ITEM = /^\s*(?:[-*+]|\d+\.)\s+/u;
const PLACEHOLDER = /\b(?:TODO|TBD|FIXME)\b/u;
const DONE = /^Status:\s*\**done/imu;
const FINDINGS = /^#{1,6}\s+.*\b(?:deferred|open (?:items|findings|questions)|follow-?ups?|known gaps|gaps|residual)\b/iu;
// A path or command in backticks, a link, a URL, a commit or an explicit skip.
const ARTIFACT = /`[^`]*[/.\s][^`]*`|\]\([^)]+\)|https?:\/\/|\b[0-9a-f]{7,40}\b|\bskip:/u;

function plansDir() {
  const config = '.agents/pstack.json';
  return (existsSync(config) && JSON.parse(readFileSync(config, 'utf8')).plans) || 'docs/plans';
}

function committedLines(path) {
  const committed = spawnSync('git', ['show', `HEAD:./${relative(process.cwd(), path)}`], { encoding: 'utf8' });
  return new Set(committed.status === 0 ? committed.stdout.split('\n') : []);
}

function openLines(path) {
  const text = readFileSync(path, 'utf8');
  const done = DONE.test(text);
  const committed = done ? committedLines(path) : new Set();
  const found = [];
  let fenced = false;
  let commented = false;
  let findings = false;
  for (const [index, raw] of text.split('\n').entries()) {
    if (/^\s*(?:```|~~~)/u.test(raw)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    let line = raw;
    if (commented) {
      const end = line.indexOf('-->');
      if (end === -1) continue;
      commented = false;
      line = line.slice(end + 3);
    }
    line = line.replace(/<!--.*?-->/gu, '');
    const start = line.indexOf('<!--');
    if (start !== -1) {
      commented = true;
      line = line.slice(0, start);
    }
    if (/^#{1,6}\s/u.test(line)) findings = FINDINGS.test(line);
    const where = `${path}:${index + 1}: ${raw.trim()}`;
    const prose = line.replace(/`[^`]*`/gu, '');
    if (OPEN_BOX.test(prose) || PLACEHOLDER.test(prose)) {
      found.push(where);
      continue;
    }
    if (!done || committed.has(raw)) continue;
    if (CLOSED_BOX.test(line) && !ARTIFACT.test(line)) found.push(`${where} (name the artifact that closed it, or skip: <reason>)`);
    else if (findings && ITEM.test(line) && !/\bowner:/iu.test(line)) found.push(`${where} (name its owner: and where it is tracked)`);
  }
  return found;
}

function donePlans() {
  const dir = plansDir();
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => join(dir, entry.name))
    .filter((path) => /^Status:\s*\**Done/mu.test(readFileSync(path, 'utf8')));
}

const args = process.argv.slice(2);
const paths = args[0] === '--done' ? donePlans() : args;
if (paths.length === 0 && args[0] !== '--done') {
  console.error('Usage: node .agents/pstack/plan-open.mjs <plan.md> [...] | --done');
  process.exit(2);
}
const open = paths.flatMap(openLines);
if (open.length > 0) {
  console.error(`${open.length} open item(s):\n${open.join('\n')}`);
  process.exit(1);
}
console.info(`No open items in ${paths.length} plan(s).`);
