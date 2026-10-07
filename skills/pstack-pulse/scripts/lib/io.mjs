import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { HOME, planMatches } from './event.mjs';
import { emptyPhone } from './phone.mjs';

const CLAUDE_SESSIONS = join(homedir(), '.claude/sessions');
const CODEX_STATE = join(homedir(), '.codex/state_5.sqlite');
const INBOX = join(HOME, 'inbox');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const QUIET_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
const quiet = (cmd, args, options = {}) => {
  const result = spawnSync(cmd, args, { encoding: 'utf8', timeout: 10_000, env: QUIET_ENV, ...options });
  return result.status === 0 ? result.stdout : null;
};
const succeeds = (cmd, args) => spawnSync(cmd, args, { timeout: 10_000, env: QUIET_ENV }).status === 0;
const readJson = (path, fallback) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
};
export function writeFileAtomic(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, text);
  renameSync(temp, path);
}

export function loadState() {
  const path = join(HOME, 'state.json');
  if (!existsSync(path)) return { v: 2, sessions: {}, phone: emptyPhone(), applied: [] };
  let state;
  try {
    state = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    renameSync(path, join(HOME, `state.corrupt-${Date.now()}.json`));
    return { v: 2, sessions: {}, phone: emptyPhone(), applied: [] };
  }
  for (const session of Object.values(state.sessions ?? {})) {
    delete session.pending;
    delete session.findings;
    delete session.requestedTool;
  }
  return state;
}
export const saveState = (state) => writeFileAtomic(join(HOME, 'state.json'), JSON.stringify(state));
export const loadConfig = () => (existsSync(join(HOME, 'config.json')) ? JSON.parse(readFileSync(join(HOME, 'config.json'), 'utf8')) : {});
export const saveConfig = (config) => writeFileAtomic(join(HOME, 'config.json'), JSON.stringify(config, null, 2));

const isText = (value) => typeof value === 'string';
const orNull = (check) => (value) => value === null || value === undefined || check(value);
const FIELDS = {
  at: (value) => isText(value) && !Number.isNaN(Date.parse(value)),
  runtime: (value) => ['claude', 'codex'].includes(value),
  session: isText,
  event: isText,
  cwd: orNull(isText),
  transcript: orNull(isText),
  title: orNull(isText),
  source: orNull(isText),
  tool: orNull(isText),
  toolUseId: orNull(isText),
  questions: orNull((value) => Array.isArray(value) && value.length > 0 && value.every((question) => isText(question?.question) && Array.isArray(question.options) && question.options.every(isText))),
  plans: (value) => Array.isArray(value) && value.every(isText),
  push: orNull((value) => isText(value.branch) && isText(value.sha) && isText(value.cwd)),
  check: orNull((value) => typeof value.ok === 'boolean'),
  published: (value) => typeof value === 'boolean',
  lastMessage: orNull(isText),
  notification: orNull(isText),
  message: orNull(isText),
  background: Number.isInteger,
  pid: orNull(Number.isInteger),
  bridge: orNull(isText),
};
const isEvent = (event) => event?.v === 2 && Object.entries(FIELDS).every(([field, check]) => check(event[field]));
const TRANSIENT_READ = new Set(['EMFILE', 'ENFILE', 'EAGAIN', 'EBUSY']);

export function readInbox(applied) {
  for (const name of applied) {
    try {
      unlinkSync(join(INBOX, name));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  if (!existsSync(INBOX)) return [];
  const valid = [];
  for (const name of readdirSync(INBOX).filter((file) => file.endsWith('.json'))) {
    let event = null;
    try {
      event = JSON.parse(readFileSync(join(INBOX, name), 'utf8'));
    } catch (error) {
      if (TRANSIENT_READ.has(error.code)) continue;
    }
    if (isEvent(event)) valid.push({ name, event });
    else quarantine(name);
  }
  return valid.sort((a, b) => a.event.at.localeCompare(b.event.at) || a.name.localeCompare(b.name));
}

export function quarantine(name) {
  mkdirSync(join(INBOX, 'bad'), { recursive: true });
  renameSync(join(INBOX, name), join(INBOX, 'bad', name));
}

export function claudeRegistry() {
  const byId = {};
  if (!existsSync(CLAUDE_SESSIONS)) return byId;
  for (const name of readdirSync(CLAUDE_SESSIONS).filter((file) => file.endsWith('.json'))) {
    const entry = readJson(join(CLAUDE_SESSIONS, name), null);
    if (typeof entry?.sessionId !== 'string') continue;
    const text = (value) => (typeof value === 'string' ? value : null);
    byId[entry.sessionId] = { status: ['busy', 'idle', 'waiting'].includes(entry.status) ? entry.status : 'unknown', name: text(entry.name), bridge: text(entry.bridgeSessionId), host: text(entry.hostSessionId), entrypoint: text(entry.entrypoint), pid: Number.isInteger(entry.pid) ? entry.pid : null };
  }
  return byId;
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'ESRCH' ? false : null;
  }
}

export function accounts() {
  const json = (cmd, args) => {
    try {
      return JSON.parse(quiet(cmd, args) ?? 'null');
    } catch {
      return null;
    }
  };
  const desktop = json('cc-same', ['accounts', '--json']);
  const cli = json('cswap', ['list', '--json']);
  return {
    desktop: desktop?.accounts?.find((account) => account.signedIn)?.email ?? null,
    cli: cli?.accounts?.find((account) => account.number === cli.activeAccountNumber)?.email ?? null,
  };
}

function codexThreads(ids) {
  const uuids = ids.filter((id) => UUID.test(id));
  if (!uuids.length || !existsSync(CODEX_STATE)) return {};
  const out = quiet('sqlite3', ['-readonly', '-json', CODEX_STATE, `select id, name, title, source from threads where id in (${uuids.map((id) => `'${id}'`).join(',')})`]);
  const rows = out ? JSON.parse(out) : [];
  return Object.fromEntries(rows.map((row) => [row.id, { title: row.name || row.title || null, source: row.source }]));
}

const CALL_ID = /call_[A-Za-z0-9]+/gu;
const accepted = (output) => {
  try {
    return JSON.parse(output)?.accepted === true;
  } catch {
    return false;
  }
};
const stringsOf = (value) => (typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(stringsOf) : []);
const userText = (content) => (Array.isArray(content) ? content.map((part) => part?.text ?? '').join('\n') : String(content ?? ''));

const ROLLOUT_CHUNK = 8 * 1024 * 1024;
const ROLLOUT_FIRST_READ = 1024 * 1024;
const commandOutput = (record) => {
  const payload = record.payload ?? {};
  return ['function_call_output', 'custom_tool_call_output'].includes(payload.type) || (payload.type === 'item_completed' && payload.item?.type === 'CommandExecution');
};

export function readRollout(path, cursor) {
  const size = statSync(path).size;
  const from = cursor === null ? Math.max(0, size - ROLLOUT_FIRST_READ) : cursor > size ? 0 : cursor;
  if (size <= from) return { cursor: from, signals: [] };
  const chunk = Buffer.alloc(Math.min(size - from, ROLLOUT_CHUNK));
  const fd = openSync(path, 'r');
  try {
    readSync(fd, chunk, 0, chunk.length, from);
  } finally {
    closeSync(fd);
  }
  const start = cursor === null && from > 0 ? chunk.indexOf(0x0a) + 1 : 0;
  const complete = chunk.lastIndexOf(0x0a) + 1;
  const oversizedLine = complete <= start && chunk.length === ROLLOUT_CHUNK;
  if (oversizedLine) return { cursor: from + chunk.length, signals: [] };
  const partialTail = complete <= start;
  if (partialTail) return { cursor: from + start, signals: [] };
  const signals = [];
  for (const line of chunk.subarray(start, complete).toString('utf8').split('\n')) {
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const payload = record.payload ?? {};
    const at = typeof record.timestamp === 'string' ? record.timestamp : new Date().toISOString();
    if (payload.type === 'function_call' && payload.name?.startsWith('request_user_input')) {
      let first = null;
      try {
        first = JSON.parse(payload.arguments ?? '{}').questions?.[0] ?? null;
      } catch {}
      signals.push({ type: 'ask', callId: payload.call_id ?? null, at, question: String(first?.title ?? first?.question ?? 'Codex asks a question').slice(0, 300), options: (first?.options ?? []).map((option) => String(option?.label ?? option).slice(0, 80)) });
    } else if (payload.type === 'function_call_output' && payload.call_id && !accepted(payload.output)) signals.push({ type: 'reply', callId: payload.call_id, at });
    else if (payload.type === 'message' && payload.role === 'user') {
      const text = userText(payload.content);
      if (text.includes('<send_user_message_question_reply>')) for (const [callId] of text.matchAll(CALL_ID)) signals.push({ type: 'reply', callId, at });
    }
    if (commandOutput(record)) for (const text of stringsOf(payload)) for (const path of planMatches(text)) signals.push({ type: 'plan', path });
  }
  return { cursor: from + complete, signals };
}

const repoCache = {};
const OTHER = { id: 'other', name: 'other' };
const RECHECK_MS = 60_000;
const projectCache = {};

function originProject(url) {
  const [host, ...path] = url
    .replace(/^[a-z][a-z0-9+.-]*:\/\//iu, '')
    .replace(/^[^@/]+@/u, '')
    .replace(/^([^/:]+):(?!\d+\/)/u, '$1/')
    .replace(/\.git\/?$/u, '')
    .replace(/\/+$/u, '')
    .split('/');
  return { id: [host.toLowerCase(), ...path].join('/'), name: path.at(-1) || host };
}

function commonDirProject(common) {
  const real = realpathSync(common);
  return { id: real, name: real.endsWith('/.git') ? basename(dirname(real)) : basename(real).replace(/\.git$/u, '') };
}

export function projectOf(cwd) {
  if (!cwd) return OTHER;
  const cached = projectCache[cwd];
  if (cached && (cached.final || Date.now() - cached.at < RECHECK_MS)) return cached.project;
  const origin = quiet('git', ['-C', cwd, 'config', '--get', 'remote.origin.url'])?.trim();
  const common = origin ? null : quiet('git', ['-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'])?.trim();
  const project = origin ? originProject(origin) : common ? commonDirProject(common) : OTHER;
  projectCache[cwd] = { project, at: Date.now(), final: Boolean(origin) };
  return project;
}

export function repoOf(cwd) {
  if (!cwd) return null;
  if (!(cwd in repoCache)) repoCache[cwd] = quiet('git', ['-C', cwd, 'rev-parse', '--show-toplevel'])?.trim() ?? null;
  return repoCache[cwd];
}

function confirmPush(push) {
  const repoName = basename(repoOf(push.cwd) ?? push.cwd);
  const common = quiet('git', ['-C', push.cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'])?.trim();
  const repoId = common ? realpathSync(common) : repoName;
  const remote = quiet('git', ['-C', push.cwd, 'ls-remote', 'origin', `refs/heads/${push.branch}`])?.split('\t')[0]?.trim();
  const confirmed = Boolean(remote) && (remote === push.sha || (succeeds('git', ['-C', push.cwd, 'cat-file', '-e', `${remote}^{commit}`]) && succeeds('git', ['-C', push.cwd, 'merge-base', '--is-ancestor', push.sha, remote])));
  return { outcome: confirmed ? 'confirmed' : 'retry', repoId, repoName };
}

export function probe(sessions, now, problems) {
  const at = new Date(now).toISOString();
  const observations = [];
  const all = Object.values(sessions);
  const live = all.filter((session) => session.life === 'live');
  const source = (name, read) => {
    try {
      return read();
    } catch (error) {
      problems.push(`${name}: ${error.message}`);
      return {};
    }
  };
  const registry = source('Claude registry', claudeRegistry);
  const threads = source('Codex threads', () => codexThreads(live.filter((session) => session.runtime === 'codex').map((session) => session.id)));
  for (const session of all) {
    const base = { runtime: session.runtime, session: session.id, at };
    try {
      if (session.life === 'live' && session.runtime === 'claude') {
        const entry = registry[session.id];
        const pid = entry?.pid ?? session.pid;
        if (pid && alive(pid) === false) observations.push({ kind: 'gone', ...base });
        else if (entry) observations.push({ kind: 'registry', ...base, ...entry, pid });
      } else if (session.life === 'live') {
        const thread = threads[session.id];
        if (thread) observations.push({ kind: 'thread', ...base, ...thread });
        if (session.audience === 'owner' && session.transcript && existsSync(session.transcript)) observations.push({ kind: 'rollout', ...base, ...readRollout(session.transcript, session.cursor) });
      }
      for (const push of session.pushes.filter((each) => Date.parse(each.nextAt) <= now)) observations.push({ kind: 'push', ...base, sha: push.sha, branch: push.branch, ...confirmPush(push) });
    } catch (error) {
      problems.push(`${session.runtime}:${session.id}: ${error.message}`);
    }
  }
  return observations;
}

const railCache = {};
const RAIL_TTL_MS = 60_000;
const STAGE_STATES = new Set(['left', 'now', 'waiting', 'blocked', 'stopped', 'done', 'skipped']);
export function railOf(planPath) {
  if (!planPath || !existsSync(planPath)) return null;
  const stamp = [planPath, planPath.replace(/\.md$/u, '.decisions.tsv')].filter(existsSync).map((path) => statSync(path).mtimeMs).join(':');
  const cached = railCache[planPath];
  if (cached?.stamp === stamp && Date.now() - cached.at < RAIL_TTL_MS) return cached.rail;
  const root = repoOf(dirname(planPath));
  const helper = root && join(root, '.agents/pstack/plan-page.mjs');
  let rail = null;
  try {
    const raw = helper && existsSync(helper) ? JSON.parse(quiet(process.execPath, [helper, planPath, '--rail'], { cwd: root }) ?? 'null') : null;
    if (raw && Array.isArray(raw.stages)) {
      rail = {
        page: typeof raw.page === 'string' && /^https:\/\/[^\s@]+$/u.test(raw.page) ? raw.page : null,
        stages: raw.stages.filter(({ state }) => STAGE_STATES.has(state)).map(({ label, state }) => ({ label: String(label).slice(0, 40), state })),
        steps: { checked: Number(raw.steps?.checked) || 0, total: Number(raw.steps?.total) || 0 },
      };
    }
  } catch {}
  railCache[planPath] = { stamp, rail, at: Date.now() };
  return rail;
}

export function apiKey() {
  if (process.env.ACTIVITYSMITH_API_KEY) return process.env.ACTIVITYSMITH_API_KEY;
  return quiet('security', ['find-generic-password', '-s', 'pstack-pulse', '-a', 'activitysmith', '-w'])?.trim() || null;
}
