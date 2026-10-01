#!/usr/bin/env node
// Finds the agent session a cross-review is about, in this repository, and
// prints what the reviewer needs from it: the user's typed asks, the lead's
// last reply and the commits it reported. A session is waiting when its last
// reply ends with the hand-off line.
// Usage: node session.mjs --from claude|codex [--plan <path>] [--pick <n>]

import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ASK_LIMIT = 2000;
const ASKS_TOTAL = 40000;
const REPLY_LIMIT = 6000;
const NOT_TYPED = /^<(?:local-command|command-|system-reminder|task-notification)|^Caveat: The messages below|^Base directory for this skill/u;
const COMMIT = /\b([0-9a-f]{7,40}) ((?:feat|fix|docs|refactor|test|chore|perf|style|build|ci|revert)(?:\([^)]*\))?!?: .+)$|^\[[\w./-]+ ([0-9a-f]{7,40})\] (.+)$/gmu;

function* fileLines(path) {
  const fd = openSync(path, 'r');
  const buffer = Buffer.alloc(1 << 20);
  let rest = '';
  try {
    for (let read; (read = readSync(fd, buffer, 0, buffer.length, null)) > 0; ) {
      const lines = (rest + buffer.subarray(0, read).toString('utf8')).split('\n');
      rest = lines.pop();
      yield* lines;
    }
    if (rest) yield rest;
  } finally {
    closeSync(fd);
  }
}

const parse = (line) => {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
};

const textOf = (content) =>
  typeof content === 'string'
    ? content
    : (content ?? []).filter((block) => block?.type === 'text' || block?.type === 'output_text' || block?.type === 'input_text').map((block) => block.text ?? '').join('\n');

function claudeFiles(cwd) {
  const projects = join(homedir(), '.claude/projects');
  const dirs = cwd ? [cwd.replace(/[^a-zA-Z0-9]/gu, '-')] : existsSync(projects) ? readdirSync(projects) : [];
  return dirs.flatMap((name) => {
    const dir = join(projects, name);
    return existsSync(dir) && statSync(dir).isDirectory() ? readdirSync(dir).filter((file) => file.endsWith('.jsonl')).map((file) => join(dir, file)) : [];
  });
}

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.name.endsWith('.jsonl')) yield path;
  }
}

function codexFiles(cwd) {
  const files = [];
  for (const root of ['.codex/sessions', '.codex/archived_sessions']) {
    for (const path of walk(join(homedir(), root))) {
      const first = fileLines(path).next().value;
      const payload = parse(first ?? '')?.payload ?? {};
      if ((!cwd || payload.cwd === cwd) && payload.thread_source !== 'subagent') files.push(path);
    }
  }
  return files;
}

function readClaude(path) {
  const session = { path, asks: [], reply: '', commits: new Map(), text: '' };
  for (const line of fileLines(path)) {
    const record = parse(line);
    if (!record || record.isSidechain) continue;
    if (record.type === 'ai-title' && typeof record.aiTitle === 'string') session.title = record.aiTitle;
    if (record.type === 'user' && !record.isMeta && !record.isCompactSummary) {
      const content = record.message?.content;
      for (const block of Array.isArray(content) ? content : []) {
        if (block?.type === 'tool_result') session.text += `\n${textOf(block.content)}`;
      }
      const typed = textOf(content).trim();
      if (typed && !NOT_TYPED.test(typed)) session.asks.push({ at: record.timestamp, text: typed });
    }
    if (record.type === 'assistant') {
      const reply = textOf(record.message?.content).trim();
      if (reply) session.reply = reply;
      session.text += `\n${reply}`;
    }
  }
  return session;
}

function readCodex(path) {
  const session = { path, asks: [], reply: '', commits: new Map(), text: '' };
  const seen = new Set();
  for (const line of fileLines(path)) {
    const record = parse(line);
    const payload = record?.payload;
    if (!payload) continue;
    const typed = payload.type === 'user_message' ? payload.message : payload.item?.type === 'UserMessage' ? textOf(payload.item.content) : null;
    if (typed && !seen.has(`${payload.turn_id}\0${typed}`) && !NOT_TYPED.test(typed.trim())) {
      seen.add(`${payload.turn_id}\0${typed}`);
      session.asks.push({ at: record.timestamp, text: typed.trim() });
    }
    const reply = payload.type === 'agent_message' ? payload.message : payload.type === 'message' && payload.role === 'assistant' ? textOf(payload.content) : null;
    if (reply?.trim()) {
      session.reply = reply.trim();
      session.text += `\n${session.reply}`;
    }
    if (typeof payload.output === 'string') session.text += `\n${payload.output}`;
  }
  return session;
}

function commitsIn(text) {
  const commits = new Map();
  for (const match of text.matchAll(COMMIT)) commits.set(match[1] ?? match[3], match[2] ?? match[4]);
  return commits;
}

function show(session) {
  const out = [`Session: ${session.path}`];
  if (session.title) out.push(`Title: ${session.title}`);
  out.push('', '## The user\'s typed asks, oldest first');
  let budget = ASKS_TOTAL;
  const asks = [];
  for (const ask of [...session.asks].reverse()) {
    const text = ask.text.length > ASK_LIMIT ? `${ask.text.slice(0, ASK_LIMIT)} […]` : ask.text;
    if (budget - text.length < 0) {
      asks.push({ at: '', text: '[earlier asks omitted]' });
      break;
    }
    budget -= text.length;
    asks.push({ at: ask.at, text });
  }
  for (const [index, ask] of asks.reverse().entries()) out.push(`${index + 1}. ${ask.at ? `(${ask.at}) ` : ''}${ask.text}`);
  const reply = session.reply.length > REPLY_LIMIT ? `[…] ${session.reply.slice(-REPLY_LIMIT)}` : session.reply;
  out.push('', '## The lead\'s last reply', reply || '(none)', '', '## Commit lines seen in the session (some may be other work shown by git log; confirm with git show)');
  const commits = commitsIn(session.text);
  out.push(...(commits.size > 0 ? [...commits].map(([sha, subject]) => `- ${sha} ${subject}`) : ['(none found; check the plan, the decision log and git log)']));
  return out.join('\n');
}

function main(argv) {
  const option = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const from = option('--from');
  if (!['claude', 'codex'].includes(from)) {
    console.error('Usage: node session.mjs --from claude|codex [--plan <path>] [--pick <n>]');
    return 2;
  }
  const cwd = process.cwd();
  const read = from === 'claude' ? readClaude : readCodex;
  const marker = new RegExp(`(?:^|\\s)${from === 'claude' ? '\\$' : '/'}cross-review(?:[ \\t]+(\\S+))?[ \\t]*$`, 'mu');
  const files = from === 'claude' ? claudeFiles : codexFiles;
  const newestFirst = (paths) => paths.map((path) => ({ path, mtime: statSync(path).mtimeMs })).sort((a, b) => b.mtime - a.mtime);
  const sessions = newestFirst(files(cwd));
  const plan = option('--plan');
  if (plan) {
    // A session can edit this repository from another working directory.
    const elsewhere = newestFirst(files(null).filter((path) => !sessions.some((session) => session.path === path)));
    for (const { path } of [...sessions, ...elsewhere]) {
      const session = read(path);
      if (session.text.includes(plan) || session.asks.some((ask) => ask.text.includes(plan))) {
        console.info(show(session));
        return 0;
      }
    }
    console.error(`No ${from} session mentions ${plan}.`);
    return 1;
  }
  const waiting = sessions.map(({ path, mtime }) => ({ ...read(path), mtime })).filter((session) => marker.test(session.reply));
  const pick = Number(option('--pick'));
  if (waiting.length === 1 || (pick >= 1 && pick <= waiting.length)) {
    console.info(show(waiting[waiting.length === 1 ? 0 : pick - 1]));
    return 0;
  }
  if (waiting.length === 0) {
    console.error(`No ${from} session in ${cwd} is waiting for a cross-review.`);
    return 1;
  }
  console.info(`${waiting.length} sessions are waiting for a cross-review. Ask the user which one, then rerun with --pick <n>:`);
  for (const [index, session] of waiting.entries()) {
    const handedOff = session.reply.match(marker)?.[1] ?? 'no plan';
    const lastAsk = session.asks.at(-1)?.text.replace(/\s+/gu, ' ').slice(0, 100) ?? '';
    console.info(`${index + 1}. ${handedOff} | ${new Date(session.mtime).toISOString()} | ${session.title ?? lastAsk}`);
  }
  return 3;
}

process.exitCode = main(process.argv.slice(2));
