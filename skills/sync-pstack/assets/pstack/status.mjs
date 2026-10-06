// Installed by the sync-pstack skill. A plan's state is the first word of its
// Status line, a panel row's kind is the first word of its decision, and a
// cited proof is a path under <plans>/artifacts/.

import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readSync } from 'node:fs';
import { relative } from 'node:path';

const LANDED = ['done', 'complete', 'completed', 'shipped', 'executed', 'implemented', 'fixed', 'released', 'merged', 'verified', 'landed'];

export const STATES = {
  done: [...LANDED, 'superseded', 'replaced', 'closed', 'cancelled', 'canceled', 'abandoned', 'retired', 'terminated'],
  active: ['building', 'executing', 'in', 'active', 'resumed', 'reopened', 'rework', 'review', 'reviewing', 'awaiting', 'waiting'],
  held: ['blocked', 'paused'],
  planning: ['planning', 'planned', 'draft', 'proposed', 'ready', 'pending', 'scoped', 'partial', 'approved', 'accepted', 'open'],
};

function words(status) {
  return status
    .trim()
    .replace(/^[^a-z]+/i, '')
    .toLowerCase()
    .split(/[^a-z-]+/)
    .map((word) => word.replaceAll('-', ''))
    .filter(Boolean);
}

export function stateOf(status) {
  const [first, second] = words(status);
  if (first === 'in' && ['planning', 'draft'].includes(second)) return 'planning';
  return Object.keys(STATES).find((state) => STATES[state].includes(first)) ?? null;
}

export const SEATS = /^seats\s/u;

export const SEVERITIES = ['critical', 'warning', 'nit'];

// Superseded and cancelled plans close without their work, so only landed ones face the Done gate.
export const landed = (status) => LANDED.includes(words(status)[0]);

export const reopened = (status) => words(status)[0] === 'reopened';

const LOCATION = /(?::\d+){1,2}(?:-\d+)?$|#L\d+(?:-L?\d+)?$/u;
const TRAILING = /[.:,;!?*_–—]+$/u;
const NOT_ONE_FILE = /[*?<>{}|[\]]|\.\.|\$\{/u;
const tidy = (path) => path.replace(TRAILING, '').replace(LOCATION, '').replace(TRAILING, '');

const viaAnotherTree = (lead) => lead.endsWith('/') && !lead.startsWith('/') && lead !== './';
const firstExisting = (candidates) => candidates.find((candidate) => existsSync(candidate)) ?? candidates.at(-1);

function citation(token, root) {
  const at = token.indexOf(root);
  if (at === -1) return null;
  const lead = token.slice(Math.max(0, token.slice(0, at).search(/\S+$/u)), at);
  if (viaAnotherTree(lead)) return null;
  const path = token.slice(lead.startsWith('/') ? at - lead.length : at);
  const found = firstExisting([tidy(path.trim()), tidy(path.split(/\s/u)[0])]);
  return NOT_ONE_FILE.test(found) ? null : found;
}

export function runPaths(text, plans) {
  const root = `${plans}/artifacts/`;
  const spans = [...text.matchAll(/`([^`]+)`|\]\(([^)\s]+)\)/gu)].map((match) => match[1] ?? match[2]);
  const bare = text.replace(/`[^`]*`|\]\([^)]*\)/gu, ' ').split(/[\s,;()'"=]+/u);
  return [...new Set([...spans, ...bare].map((token) => citation(token, root)).filter(Boolean))];
}

const RECEIPT = /^exit=(?:-?\d+|SIG[A-Z]+|E[A-Z]{3,})$/u;
const isReceipt = (line) => RECEIPT.test(line.trimEnd());

export function recordsExit(path) {
  const fd = openSync(path, 'r');
  const buffer = Buffer.alloc(65_536);
  let carry = '';
  try {
    for (let read = readSync(fd, buffer); read > 0; read = readSync(fd, buffer)) {
      const lines = `${carry}${buffer.toString('utf8', 0, read)}`.split('\n');
      carry = lines.pop().slice(-4096);
      if (lines.some(isReceipt)) return true;
    }
    return isReceipt(carry);
  } finally {
    closeSync(fd);
  }
}

export function committedLines(path) {
  const base = process.env.PSTACK_BASE;
  if (base && spawnSync('git', ['rev-parse', '--verify', '--quiet', `${base}^{commit}`]).status !== 0) {
    throw new Error(`PSTACK_BASE ${base} names no commit`);
  }
  const shown = spawnSync('git', ['show', `${base || 'HEAD'}:./${relative(process.cwd(), path)}`], { encoding: 'utf8' });
  return new Set(shown.status === 0 ? shown.stdout.split('\n') : []);
}
