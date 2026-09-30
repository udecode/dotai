#!/usr/bin/env node
// Fails a plan that still has open work, so no plan is marked Done with an
// unchecked box or a placeholder left in it. Installed by the sync-pstack skill.
// Usage: node .agents/pstack/plan-open.mjs <plan.md> [...]
//        node .agents/pstack/plan-open.mjs --done   (every plan whose status says Done)

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const OPEN_BOX = /^\s*(?:[-*+]|\d+\.)\s+\[ \]/u;
const PLACEHOLDER = /\b(?:TODO|TBD|FIXME)\b/u;

function plansDir() {
  const config = '.agents/pstack.json';
  return (existsSync(config) && JSON.parse(readFileSync(config, 'utf8')).plans) || 'docs/plans';
}

function openLines(path) {
  const found = [];
  let fenced = false;
  let commented = false;
  for (const [index, raw] of readFileSync(path, 'utf8').split('\n').entries()) {
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
    const prose = line.replace(/`[^`]*`/gu, '');
    if (OPEN_BOX.test(prose) || PLACEHOLDER.test(prose)) found.push(`${path}:${index + 1}: ${raw.trim()}`);
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
