#!/usr/bin/env node
// Finds the agent session a cross-review is about and prints what the reviewer
// needs from it: the user's typed asks, the lead's last reply and the commits
// it reported. A session is waiting when the last line of its last reply is the
// hand-off line and no typed ask came after it.
// Usage: node session.mjs --from claude|codex [--plan <path>] [--pick <n or id>] [--days <n>]

import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, relative } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

const ASK_LIMIT = 2000;
const ASKS_TOTAL = 40000;
const REPLY_LIMIT = 6000;
const TAIL_BYTES = 1 << 18;
const NOT_TYPED = /^(?:<(?:local-command|system-reminder|task-notification|codex_delegation)|Caveat: The messages below|Base directory for this skill|\[Request interrupted by user)/u;
const HAND_OFF = /^[\s>*`]*[$/]cross-review(?:[ \t]+([^\s`*]+))?[\s`*]*$/u;
const RECENT = 5;

const handOff = (turn) => turn.last.text.trimEnd().split('\n').at(-1).match(HAND_OFF);
const REVIEW_ASK = /^[$/]cross-review\b/u;
const COMMIT = /\b([0-9a-f]{7,40}) ((?:feat|fix|docs|refactor|test|chore|perf|style|build|ci|revert)(?:\([^)]*\))?!?: .+)$|^\[[\w./-]+ ([0-9a-f]{7,40})\] (.+)$/gmu;
const CLAUDE_WRITES = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const CODEX_WRITE = /\*\*\* (?:Add|Update) File: ([^\\\n"]+)/gu;
const SESSION_ID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/u;

function* fileLines(path, start = 0, chunk = 1 << 20) {
  const fd = openSync(path, 'r');
  const buffer = Buffer.alloc(chunk);
  const decoder = new StringDecoder('utf8');
  let rest = '';
  try {
    for (let position = start, read; (read = readSync(fd, buffer, 0, chunk, position)) > 0; position += read) {
      const lines = (rest + decoder.write(buffer.subarray(0, read))).split('\n');
      rest = lines.pop();
      yield* lines;
    }
    rest += decoder.end();
    if (rest) yield rest;
  } finally {
    closeSync(fd);
  }
}

function contains(path, needle) {
  const target = Buffer.from(needle);
  const buffer = Buffer.alloc(1 << 22);
  const fd = openSync(path, 'r');
  try {
    let carry = 0;
    for (let position = 0, read; (read = readSync(fd, buffer, carry, buffer.length - carry, position)) > 0; position += read) {
      const end = carry + read;
      if (buffer.subarray(0, end).includes(target)) return true;
      carry = Math.min(target.length - 1, end);
      buffer.copy(buffer, 0, end - carry, end);
    }
    return false;
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
    : Array.isArray(content)
      ? content.filter((block) => ['text', 'output_text', 'input_text'].includes(block?.type)).map((block) => block.text ?? '').join('\n')
      : '';

function typedAsk(text) {
  const command = text.match(/<command-name>([^<]*)<\/command-name>/u)?.[1];
  if (command) return `${command} ${text.match(/<command-args>([\s\S]*?)<\/command-args>/u)?.[1] ?? ''}`.trim();
  return NOT_TYPED.test(text) ? null : text;
}

function* claudeEvents(record) {
  if (record.isSidechain) return;
  if (record.type === 'ai-title' && typeof record.aiTitle === 'string') yield { kind: 'title', text: record.aiTitle };
  const content = record.message?.content;
  if (record.type === 'user' && !record.isMeta && !record.isCompactSummary) {
    for (const block of Array.isArray(content) ? content : []) {
      if (block?.type === 'tool_result') yield { kind: 'output', text: textOf(block.content) };
    }
    const ask = typedAsk(textOf(content).trim());
    if (ask) yield { kind: 'ask', at: record.timestamp, text: ask };
  }
  if (record.type === 'assistant') {
    const reply = textOf(content).trim();
    if (reply) yield { kind: 'reply', text: reply };
    for (const block of Array.isArray(content) ? content : []) {
      if (block?.type !== 'tool_use') continue;
      const target = block.input?.file_path ?? block.input?.notebook_path;
      yield { kind: 'call', text: JSON.stringify(block.input ?? {}), writes: CLAUDE_WRITES.has(block.name) && target ? [target] : [] };
    }
  }
}

function* codexEvents(record, seen) {
  const payload = record.payload;
  if (!payload) return;
  const typed = payload.type === 'user_message' ? payload.message : payload.item?.type === 'UserMessage' ? textOf(payload.item.content) : null;
  const ask = typed ? typedAsk(typed.trim()) : null;
  if (ask && !seen.has(`${payload.turn_id}\0${ask}`)) {
    seen.add(`${payload.turn_id}\0${ask}`);
    yield { kind: 'ask', at: record.timestamp, text: ask };
  }
  const reply = payload.type === 'agent_message' ? payload.message : payload.type === 'message' && payload.role === 'assistant' ? textOf(payload.content) : null;
  if (reply?.trim()) yield { kind: 'reply', text: reply.trim() };
  const call = payload.type === 'custom_tool_call' ? payload.input : payload.type === 'function_call' ? payload.arguments : null;
  if (typeof call === 'string') yield { kind: 'call', text: call, writes: [...call.matchAll(CODEX_WRITE)].map((match) => match[1].trim()) };
  if (payload.output != null) yield { kind: 'output', text: typeof payload.output === 'string' ? payload.output : JSON.stringify(payload.output) };
}

function* events(from, path, { start = 0, only } = {}) {
  const seen = new Set();
  let skipPartial = start > 0;
  for (const line of fileLines(path, start)) {
    if (skipPartial) {
      skipPartial = false;
      continue;
    }
    if (only && !line.includes(only)) continue;
    const record = parse(line);
    if (record) yield* from === 'claude' ? claudeEvents(record) : codexEvents(record, seen);
  }
}

function* walk(dir, depth) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && depth > 0) yield* walk(path, depth - 1);
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) yield path;
  }
}

function sessionFiles(from, cwd, since) {
  const sessions = [];
  if (from === 'claude') {
    const here = cwd.replace(/[^a-zA-Z0-9]/gu, '-');
    for (const path of walk(join(homedir(), '.claude/projects'), 1)) {
      const mtime = statSync(path).mtimeMs;
      if (mtime >= since) sessions.push({ path, mtime, here: basename(join(path, '..')) === here });
    }
  } else {
    for (const root of ['.codex/sessions', '.codex/archived_sessions']) {
      for (const path of walk(join(homedir(), root), 4)) {
        const mtime = statSync(path).mtimeMs;
        if (mtime < since) continue;
        let meta = {};
        for (const line of fileLines(path, 0, 1 << 16)) {
          meta = parse(line)?.payload ?? {};
          break;
        }
        if (meta.thread_source == null || meta.thread_source === 'user') sessions.push({ path, mtime, here: meta.cwd === cwd });
      }
    }
  }
  return sessions.sort((a, b) => Number(b.here) - Number(a.here) || b.mtime - a.mtime);
}

const sessionId = (path) => path.match(SESSION_ID)?.[1] ?? basename(path, '.jsonl');

function lastTurn(from, path) {
  const size = statSync(path).size;
  for (let window = TAIL_BYTES; ; window *= 4) {
    const start = Math.max(0, size - window);
    const turn = {};
    for (const event of events(from, path, { start })) {
      if (event.kind === 'title') turn.title = event.text;
      if (event.kind === 'ask') turn.ask = event.text;
      if (event.kind !== 'title') turn.last = event;
    }
    turn.finished = turn.last?.kind === 'reply';
    if (turn.last || start === 0) return turn;
  }
}

function planScore(from, path, plan, planPattern) {
  let score = 0;
  for (const event of events(from, path, { only: plan })) {
    if (!planPattern.test(event.text) && !event.writes?.some((target) => planPattern.test(target))) continue;
    if (event.kind === 'ask' && REVIEW_ASK.test(event.text)) return -1;
    if (event.kind === 'reply' && event.text.split('\n').some((line) => HAND_OFF.test(line) && planPattern.test(line))) score = Math.max(score, 4);
    else if (event.writes?.some((target) => planPattern.test(target))) score = Math.max(score, 3);
    else if (event.kind !== 'output') score = Math.max(score, 2);
  }
  return score;
}

function read(from, path) {
  const session = { path, id: sessionId(path), asks: [], reply: '', commits: new Map() };
  for (const event of events(from, path)) {
    if (event.kind === 'title') session.title = event.text;
    if (event.kind === 'ask') session.asks.push(event);
    if (event.kind === 'reply') session.reply = event.text;
    if (event.kind === 'reply' || event.kind === 'output') {
      for (const match of event.text.matchAll(COMMIT)) session.commits.set(match[1] ?? match[3], match[2] ?? match[4]);
    }
  }
  return session;
}

function show(session) {
  const out = [`Session: ${session.path}`];
  if (session.title) out.push(`Title: ${session.title}`);
  out.push('', "## The user's typed asks, oldest first");
  let budget = ASKS_TOTAL;
  const asks = [];
  for (const ask of [...session.asks].reverse()) {
    const text = ask.text.length > ASK_LIMIT ? `${ask.text.slice(0, ASK_LIMIT)} […]` : ask.text;
    if (budget - text.length < 0) {
      asks.push({ text: '[earlier asks omitted]' });
      break;
    }
    budget -= text.length;
    asks.push({ at: ask.at, text });
  }
  for (const [index, ask] of asks.reverse().entries()) out.push(`${index + 1}. ${ask.at ? `(${ask.at}) ` : ''}${ask.text}`);
  const reply = session.reply.length > REPLY_LIMIT ? `[…] ${session.reply.slice(-REPLY_LIMIT)}` : session.reply;
  out.push('', "## The lead's last reply", reply || '(none)', '', '## Commit lines seen in the session (some may be other work shown by git log; confirm with git show)');
  out.push(...(session.commits.size > 0 ? [...session.commits].map(([sha, subject]) => `- ${sha} ${subject}`) : ['(none found; check the plan, the decision log and git log)']));
  return out.join('\n');
}

function repoPath(plan, cwd) {
  const inside = isAbsolute(plan) ? relative(cwd, plan) : plan;
  return (inside.startsWith('..') ? plan : inside).replace(/^\.\//u, '');
}

function main(argv) {
  const option = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const from = option('--from');
  const days = Number(option('--days') ?? 30);
  if (!['claude', 'codex'].includes(from) || !(days > 0)) {
    console.error('Usage: node session.mjs --from claude|codex [--plan <path>] [--pick <n or id>] [--days <n>]');
    return 2;
  }
  const cwd = process.cwd();
  const since = Date.now() - days * 86400000;
  const sessions = sessionFiles(from, cwd, since);
  const window = `in the last ${days} days (--days widens it)`;

  if (option('--plan')) {
    const plan = repoPath(option('--plan'), cwd);
    const planPattern = new RegExp(`(?<![\\w.-])${plan.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(?![\\w-])`, 'u');
    let best = { score: 0 };
    // A session can edit this repository from another working directory, so the
    // search continues past this directory's sessions until one wrote or handed off the plan.
    for (const { path } of sessions) {
      if (!contains(path, plan)) continue;
      const score = planScore(from, path, plan, planPattern);
      if (score > best.score) best = { score, path };
      if (score >= 3) break;
    }
    if (!best.path) {
      console.error(`No ${from} session ${window} worked on ${plan}.`);
      return 1;
    }
    console.info(show(read(from, best.path)));
    return 0;
  }

  const here = sessions.filter((session) => session.here);
  const pick = option('--pick');
  if (pick && !/^\d+$/u.test(pick)) {
    const match = here.find((session) => sessionId(session.path).startsWith(pick));
    if (!match) {
      console.error(`No ${from} session in ${cwd} has the id ${pick}.`);
      return 1;
    }
    console.info(show(read(from, match.path)));
    return 0;
  }
  const replied = here
    .map((session) => ({ ...session, turn: lastTurn(from, session.path) }))
    .filter(({ turn }) => turn.finished);
  const waiting = replied.filter(({ turn }, index) => index < RECENT || handOff(turn));
  if (pick && !(Number(pick) >= 1 && Number(pick) <= waiting.length)) {
    console.error(`--pick ${pick} is not in the list of ${waiting.length} waiting sessions.`);
    return 2;
  }
  if (waiting.length === 1 || pick) {
    console.info(show(read(from, waiting[pick ? Number(pick) - 1 : 0].path)));
    return 0;
  }
  if (waiting.length === 0) {
    console.error(`No ${from} session in ${cwd} ${window} is waiting for a cross-review.`);
    return 1;
  }
  console.info(`${waiting.length} sessions are waiting for a cross-review. Ask the user which one, then rerun with --pick <id>:`);
  for (const [index, { path, mtime, turn }] of waiting.entries()) {
    const plan = handOff(turn)?.[1] ?? 'no plan';
    const label = turn.title ?? turn.ask?.replace(/\s+/gu, ' ').slice(0, 100) ?? '';
    console.info(`${index + 1}. ${sessionId(path)} | ${plan} | ${new Date(mtime).toISOString()} | ${label}`);
  }
  return 3;
}

process.exitCode = main(process.argv.slice(2));
