// Installed by the sync-pstack skill.

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { landed, stateOf } from './status.mjs';

export const LEDGER = 'suggested-tasks.decisions.tsv';

const FROM = {
  started: ['offered', 'started'],
  landed: ['started'],
  carded: ['offered'],
  uncarded: ['offered'],
  updated: ['offered', 'started'],
  folded: ['offered'],
  reopened: ['dismissed gone'],
  'dismissed done': ['offered'],
  'dismissed dup': ['offered'],
  'dismissed superseded': ['offered'],
  'dismissed declined': ['offered'],
  'dismissed stopped': ['started'],
  'dismissed gone': ['offered'],
  'dismissed replaced': ['offered'],
};
const TARGETED = ['dup', 'replaced'];
const REASONS = Object.keys(FROM)
  .filter((move) => move.startsWith('dismissed '))
  .map((move) => move.slice('dismissed '.length))
  .filter((reason) => !TARGETED.includes(reason));
export const CHIP_STATES = ['offered', ...Object.keys(FROM).filter((move) => !move.startsWith('dismissed '))];
const RESULT = new RegExp(`^(${CHIP_STATES.join('|')}|dismissed (?:${REASONS.join('|')}|(${TARGETED.join('|')}) ([\\w-]+)))(?:[.:;,]?(?:\\s.*)?)?$`, 'u');
const LEGACY_ONLY = ['dismissed gone', 'dismissed replaced'];
const TAKES = {
  offered: ['writes', 'topic', 'kind', 'waits', 'owns', 'card', 'session'],
  updated: ['writes', 'topic', 'kind', 'waits', 'owns'],
  folded: ['writes', 'kind', 'effort', 'waits', 'owns'],
  started: ['writes'],
  carded: ['card', 'session'],
};
const LIST_KEYS = ['writes', 'waits', 'owns'];
const SCALAR_KEYS = ['topic', 'kind', 'effort', 'card', 'session'];

const CHIP = /^([\w-]+) (?:(?:Now|After): )?\S/u;
const LEGACY_TITLE_TAGS = /^(?:Now|After): | \(high\)$/gu;
const NOT_A_PATH = /[\s*?{}`'"]|[^.][.:]$/u;
const TOPIC = /^[a-z0-9][a-z0-9-]*$/u;
const CHECK = /^[\w.:/-]+$/u;
export const SESSION = /^\w[\w.-]*$/u;
const WAIT = /^(?:pr:(\d+)|task:([\w-]+)|run:(\S+\.md))$/u;

const values = (evidence, key) => [...evidence.matchAll(new RegExp(`(?:^|[\\s;])${key}:\\s*([^;]*)`, 'gu'))].map((match) => match[1].trim());
const list = (value) => value.split(',').map((item) => item.trim()).filter(Boolean);
const moveOf = (outcome) => (outcome[2] ? `dismissed ${outcome[2]}` : outcome[1]);
const isOpen = (task) => task.status === 'offered' || task.status === 'started';
const taskState = (task) => (task.status === 'dismissed' ? `dismissed ${task.reason}` : task.status);
const joined = (a, b) => [...new Set([...a, ...b])];
const sessionPicksPlan = (task) => task.status === 'started';
const byOrder = (a, b) => a.order - b.order;
const untaggedTitle = (decision, id) => decision.slice(id.length + 1).replace(LEGACY_TITLE_TAGS, '');
const takePlaceOf = (kept, task) => {
  if (kept) kept.order = Math.min(kept.order, task.order);
};
const article = (word) => (/^[aeiou]/u.test(word) ? 'an' : 'a');

// Lowercased because macOS volumes are case-insensitive by default, so
// readme.md and README.md name one file. The kernel follows a symlink before
// a later .. steps out of it, so the path is not resolve()d until its
// existing part has been through realpath.
export function writeKey(path) {
  let base = isAbsolute(path) ? path : `${process.cwd()}/${path}`;
  const rest = [];
  while (!existsSync(base)) {
    rest.unshift(basename(base));
    base = dirname(base);
  }
  return resolve(realpathSync.native(base), ...rest).toLowerCase();
}

const contains = (outer, inner) => inner.startsWith(outer.endsWith('/') ? outer : `${outer}/`);
export const overlaps = (a, b) => a.some((x) => b.some((y) => x === y || contains(x, y) || contains(y, x)));

const parseRow = ([phase, decision = '', why = '', evidence = '', result = '']) => {
  const [, id] = phase === 'chip' ? (decision.match(CHIP) ?? []) : [];
  const outcome = id && result.match(RESULT);
  return outcome ? { id, decision, why, evidence, move: moveOf(outcome), target: outcome[3] } : null;
};

const fields = (evidence) => {
  const given = {};
  const repeated = [];
  for (const key of LIST_KEYS) {
    const found = values(evidence, key);
    if (found.length > 0) given[key] = found.flatMap(list);
  }
  for (const key of SCALAR_KEYS) {
    const found = values(evidence, key);
    if (found.length > 1) repeated.push(key);
    if (found.length > 0) given[key] = found[0];
  }
  const blankWaits = given.waits?.length === 0;
  if (given.waits) given.waits = given.waits.filter((wait) => wait !== 'none');
  return { given, repeated, blankWaits };
};

const follow = (id, tasks) => {
  const seen = new Set();
  let task = tasks.get(id);
  while (task?.status === 'dismissed' && task.target && !seen.has(task.id)) {
    seen.add(task.id);
    task = tasks.get(task.target);
  }
  return task;
};

const mergeInto = (kept, task, tasks) => {
  kept.covers.push({ id: task.id, title: displayTitle(task), findings: task.findings }, ...task.covers);
  kept.owns = joined(kept.owns, task.owns);
  if (kept.status !== 'offered') return;
  if (kept.card) kept.addedAfterCard = true;
  const outside = (wait) => {
    const target = wait.match(WAIT)?.[2];
    return !target || follow(target, tasks) !== kept;
  };
  kept.waits = joined(kept.waits.filter(outside), task.waits.filter(outside));
  kept.writes = joined(kept.writes, task.writes);
  kept.keys = kept.writes.map(writeKey);
  if (task.kind === 'decide') kept.kind = 'decide';
  if (task.effort) kept.effort = task.effort;
};

export function recordRow(tasks, cells) {
  const row = parseRow(cells);
  if (!row) return;
  const task = tasks.get(row.id);
  const { given } = fields(row.evidence);
  if (row.move === 'offered') {
    if (task) return;
    const writes = given.writes ?? [];
    const created = {
      id: row.id,
      decision: row.decision,
      title: untaggedTitle(row.decision, row.id),
      order: tasks.size,
      status: 'offered',
      reason: null,
      target: null,
      writes,
      keys: writes.map(writeKey),
      topic: given.topic ?? null,
      kind: given.kind ?? 'fix',
      waits: given.waits ?? [],
      owns: given.owns ?? [],
      card: given.card ?? null,
      session: given.card ? (given.session ?? null) : null,
      effort: null,
      addedAfterCard: false,
      findings: [row.why],
      covers: [],
    };
    created.cardTitle = created.card ? displayTitle(created) : null;
    tasks.set(row.id, created);
    return;
  }
  if (!task) return;
  if (row.move === 'started' || row.move === 'folded') {
    task.writes = joined(task.writes, given.writes ?? []);
    task.keys = task.writes.map(writeKey);
  }
  if (row.move === 'folded') {
    if (given.kind === 'decide') task.kind = 'decide';
    if (given.effort) task.effort = given.effort;
    task.waits = joined(task.waits, given.waits ?? []);
    task.owns = joined(task.owns, given.owns ?? []);
    task.findings.push(row.why);
    if (task.card) task.addedAfterCard = true;
  }
  if (row.move === 'started') task.status = 'started';
  if (row.move === 'landed') task.status = 'landed';
  if (row.move === 'carded') {
    task.card = given.card ?? null;
    task.session = given.session ?? null;
    task.cardTitle = displayTitle(task);
    task.addedAfterCard = false;
  }
  if (row.move === 'uncarded' || row.move === 'reopened' || row.move.startsWith('dismissed')) {
    task.card = null;
    task.session = null;
  }
  if (row.move === 'reopened') {
    task.status = 'offered';
    task.reason = null;
  }
  if (row.move === 'updated') {
    if (given.writes) {
      task.writes = given.writes;
      task.keys = given.writes.map(writeKey);
    }
    for (const key of ['topic', 'kind', 'waits', 'owns']) if (given[key] !== undefined) task[key] = given[key];
    if (task.card && (given.writes || given.owns)) task.addedAfterCard = true;
  }
  if (row.move.startsWith('dismissed')) {
    task.status = 'dismissed';
    task.reason = row.move.slice('dismissed '.length);
    task.target = row.target ?? null;
    const kept = row.target && tasks.get(row.target);
    takePlaceOf(kept, task);
    if (row.move === 'dismissed dup' && kept && isOpen(kept)) mergeInto(kept, task, tasks);
  }
}

export function readTasks(lines) {
  const tasks = new Map();
  for (const line of lines) if (line.trim()) recordRow(tasks, line.split('\t').slice(1));
  return tasks;
}

const tokenProblems = (given, where) => {
  const found = [];
  if (given.topic !== undefined && !TOPIC.test(given.topic)) found.push(`${where}: topic: names the owner question as one lowercase kebab-case word, such as plite-landing`);
  if (given.kind !== undefined && !['fix', 'decide'].includes(given.kind)) found.push(`${where}: kind: is fix or decide`);
  if (given.effort !== undefined && given.effort !== 'xhigh') found.push(`${where}: effort: takes only xhigh, for a folded finding that needs design judgment the task's title lacks`);
  for (const wait of given.waits ?? []) if (!WAIT.test(wait)) found.push(`${where}: waits: takes pr:<number>, task:<id> or run:<plan path ending in .md>, comma-separated, or none; "${wait}" is none of them`);
  for (const check of given.owns ?? []) if (!CHECK.test(check)) found.push(`${where}: owns: names each check as one token, such as ci:check`);
  if (given.session !== undefined && !SESSION.test(given.session)) found.push(`${where}: session: names the session id as one token`);
  return found;
};

const afterRow = (before, cells) => {
  const after = structuredClone(before);
  recordRow(after, cells);
  return after;
};

export function chipRowProblems(cells, before, where) {
  const [, decision, , evidence] = cells;
  const [, id] = decision.match(CHIP) ?? [];
  if (!id) return [`${where}: a chip row's decision is "<task id> <title>", with (xhigh) after a title that needs design judgment`];
  const row = parseRow(cells);
  if (!row) return [`${where}: a chip row's result is offered, carded, uncarded, updated, folded, started, landed, reopened, or dismissed with done, superseded, declined, stopped or dup <task id>`];
  const { move } = row;
  const known = before.get(id);
  const { given } = fields(evidence);
  const found = tokenProblems(given, where);
  if ((given.writes ?? []).some((path) => NOT_A_PATH.test(path)) || (move === 'offered' && !given.writes?.length)) {
    found.push(`${where}: a chip offer lists the paths the task will write as "writes: <path>, <path>" in its evidence, and a later row lists any it adds, each a repository path or directory, or an absolute path in another checkout, with no whitespace, glob, quote, comma or semicolon`);
  }
  if (move === 'offered') {
    if (known) return [...found, `${where}: ${id} was already offered; a task id is offered once`];
  } else {
    if (!known) return [...found, `${where}: ${id} has no offered chip row before this one`];
    if (known.decision !== decision) found.push(`${where}: ${id} was offered as "${known.decision}", and every later row repeats that decision`);
    const state = taskState(known);
    if (!FROM[move].includes(state)) found.push(`${where}: ${id} is ${state}, so it cannot be ${move}`);
  }
  if (move === 'carded' && !given.card) found.push(`${where}: a carded row names the suggest tool's card id as "card: <id>"`);
  if (move === 'updated' && !TAKES.updated.some((key) => given[key] !== undefined)) found.push(`${where}: an updated row names what changes: writes:, topic:, kind:, waits: or owns:`);
  if (move === 'updated' && known && sessionPicksPlan(known) && Object.keys(given).some((key) => key !== 'owns')) {
    found.push(`${where}: ${id} is started, so an updated row on it takes only owns:; the session adds paths with another started row`);
  }
  const kept = row.target && before.get(row.target);
  if (move === 'dismissed dup' && (row.target === id || !kept || !isOpen(kept))) found.push(`${where}: ${row.target} must be another task the ledger holds as offered; offer the task it merges into before this row`);
  if (move === 'folded' && given.kind === 'fix') found.push(`${where}: a folded row takes kind: decide only, when its finding is a design question; it never turns a design question back into a fix`);
  if (found.length > 0) return found;
  const after = afterRow(before, cells);
  const dup = move === 'dismissed dup';
  const subject = dup ? after.get(row.target) : after.get(id);
  const madeDecide = !['dismissed dup', 'folded'].includes(move) || before.get(subject.id).kind !== 'decide';
  if (['offered', 'updated', 'reopened', 'folded', 'dismissed dup'].includes(move) && subject.status === 'offered' && subject.kind === 'decide' && madeDecide) {
    const peers = [...after.values()].filter((peer) => peer.id !== subject.id && peer.kind === 'decide' && peer.topic === subject.topic);
    const rival = peers.find((peer) => peer.status === 'offered');
    if (rival) {
      const moved = move === 'updated' && given.topic !== undefined;
      const route = dup || (moved && known.topic !== null) ? `log ${id} dismissed dup ${rival.id} instead` : moved ? `give ${id} a topic of its own with its waits, then log it dismissed dup ${rival.id}` : `log this finding as a folded row on ${rival.id} instead`;
      found.push(`${where}: topic ${subject.topic} already has the open design question ${rival.id}; ${route}`);
    }
    for (const running of peers.filter((peer) => peer.status === 'started')) {
      const waitsOnRunning = subject.waits.some((wait) => {
        const target = wait.match(WAIT)?.[2];
        return target && follow(target, after)?.id === running.id;
      });
      if (!waitsOnRunning) {
        found.push(
          dup
            ? `${where}: topic ${subject.topic}'s design question ${running.id} is running; log updated on ${subject.id} with its waits plus task:${running.id} before this row`
            : `${where}: topic ${subject.topic}'s design question ${running.id} is running; a new one waits on it with waits: task:${running.id}`,
        );
      }
    }
  }
  return found;
}

export function newChipRowProblems(cells, before, where, git) {
  const [, decision, , evidence] = cells;
  const row = parseRow(cells);
  if (!row) return [];
  const { id, move } = row;
  if (LEGACY_ONLY.includes(move)) return [`${where}: a task keeps its id for good: log uncarded when its card leaves the queue, updated when its waits or paths change, and dismissed dup <task id> to merge it into another task`];
  const { given, repeated, blankWaits } = fields(evidence);
  const found = repeated.map((key) => `${where}: a chip row names ${key}: once`);
  if (blankWaits) found.push(`${where}: waits: takes pr:<number>, task:<id> or run:<plan path ending in .md>, comma-separated, or none; an empty waits: is none of them`);
  const takes = TAKES[move] ?? [];
  for (const key of Object.keys(given)) {
    if (!takes.includes(key)) found.push(`${where}: ${article(move)} ${move} row does not take ${key}:, so it would be ignored; ${takes.length ? `it takes ${takes.map((each) => `${each}:`).join(', ')}` : 'it takes none'}`);
  }
  if (move === 'offered' && !before.has(id)) {
    if (untaggedTitle(decision, id) !== decision.slice(id.length + 1)) found.push(`${where}: a new title is a plain imperative phrase, with (xhigh) when it needs design judgment; chips works out when a task can start, so no title says Now: or After:`);
    if (!given.topic) found.push(`${where}: a new offer names its owner question as "topic: <word>"; run chips to see the open topics and reuse one when the finding answers its question`);
  }
  const cycledBefore = cyclicEdges(before);
  const added = [...cyclicEdges(afterRow(before, cells))].filter((edge) => !cycledBefore.has(edge)).map((edge) => edge.split(' '));
  const self = added.find(([from, to]) => from === to);
  const loops = [...new Set(added.flat())];
  if (self) found.push(`${where}: ${self[0]} cannot wait on itself`);
  else if (loops.length > 0) {
    const route = move !== 'dismissed dup' ? 'drop the wait that closes the loop' : `keep ${id} open`;
    found.push(`${where}: this row leaves ${loops.join(' and ')} waiting on each other; ${route}`);
  }
  if (move === 'started') {
    const known = before.get(id);
    const added = (given.writes ?? []).map(writeKey).filter((key) => !known?.keys.includes(key));
    for (const [other, peer] of before) {
      if (other !== id && peer.status === 'started' && overlaps(added, peer.keys)) found.push(`${where}: ${id} cannot add a path ${other}, also started, writes; leave that path to ${other} and tell the owner`);
    }
  }
  const unmigrated = (task) => `${where}: ${task.id} has no topic, so its waits may still be prose; migrate it first: log updated with topic: and the waits: it has, as waits: none when it has none`;
  const own = before.get(id);
  const keeper = row.target && before.get(row.target);
  if (move === 'dismissed dup' && keeper?.status === 'started') found.push(`${where}: ${keeper.id} is started, and a dup moves work only into an offered task; keep ${id} open, log updated with its waits plus task:${keeper.id}, and log dismissed done once ${keeper.id} lands with the fix`);
  if (move === 'dismissed declined' && own?.card && (own.addedAfterCard || displayTitle(own) !== own.cardTitle)) found.push(`${where}: ${id} changed after card ${own.card} was offered, so the owner declined a card that did not show all of it; log uncarded and, once chips lists it as Ready, card it again with the prompt from chips brief ${id}`);
  if (move === 'dismissed dup' && own && keeper) {
    if (own.topic === null) found.push(unmigrated(own));
    else if (keeper.topic === null) found.push(unmigrated(keeper));
    else if (own.topic !== keeper.topic && (own.kind !== 'decide' || keeper.kind !== 'decide')) found.push(`${where}: ${id} is in topic ${own.topic} and ${keeper.id} in ${keeper.topic}, and a dup joins tasks on one question; when ${id} answers ${keeper.id}'s question, log updated with topic: ${keeper.topic} on ${id} first`);
  }
  if (move === 'updated' && given.topic && own?.topic === null && given.waits === undefined) found.push(`${where}: ${id} has no topic yet, so this row migrates it; name its waits too, as waits: none when it has none`);
  if (move === 'carded' && before.get(id)?.card) found.push(`${where}: ${id} already has card ${before.get(id).card}; log uncarded once that card is withdrawn or its session has ended, then card it again`);
  if (move === 'offered' && given.session && !given.card) found.push(`${where}: an offer names session: only beside card:, the card it records`);
  if (given.card && !given.session) found.push(`${where}: a card names the session that holds it as "session: <id>", the id the runtime's session tool gives this session`);
  if (move === 'carded' || (move === 'offered' && given.card)) {
    const uncarded = move === 'carded' ? before : afterRow(before, cells);
    const task = uncarded.get(id);
    if (move === 'offered' && task) task.card = null;
    const view = board(uncarded, git);
    if (task && !view.ready.includes(task)) {
      const blockers = view.waiting.find((entry) => entry.task === task)?.blockers ?? ['it has no topic'];
      found.push(`${where}: ${id} cannot start yet (${blockers.join('; ')}), so it gets no card; chips lists it until it is ready`);
    }
  }
  return found;
}

export function baseRedProblems(evidence, tasks, where) {
  return values(evidence, 'base-red')
    .flatMap(list)
    .flatMap((check) => {
      if (!CHECK.test(check)) return [`${where}: base-red: names each failing check as one token, such as ci:check`];
      const owner = [...tasks.values()].some((task) => isOpen(task) && task.owns.includes(check));
      return owner ? [] : [`${where}: base-red: ${check} has no open suggested task that owns it; offer one with "owns: ${check}", or log updated on the task that makes the base branch green, before this row`];
    });
}

export function gitMerges({ fetch = false, branch } = {}) {
  const where = branch ? `each remote's ${branch} branch` : 'the remote branches';
  let note = `PR waits read ${where} as last fetched; chips --fetch refreshes them.`;
  if (fetch) {
    try {
      execFileSync('git', ['fetch', '--quiet', '--all'], { stdio: 'ignore', timeout: 60_000 });
      note = `PR waits read ${where} just fetched.`;
    } catch {
      note = `The fetch failed, so PR waits read ${where} as last fetched.`;
    }
  }
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n');
  // A ref glob's * also matches /, so each remote's branch is named exactly.
  const refsOf = () => {
    if (!branch) return ['--remotes'];
    const wanted = new Set(git('remote').filter(Boolean).map((remote) => `refs/remotes/${remote}/${branch}`));
    return git('for-each-ref', '--format=%(refname)', 'refs/remotes/').filter((ref) => wanted.has(ref));
  };
  let refs;
  const cache = new Map();
  const merged = (number) => {
    if (!cache.has(number)) {
      try {
        refs ??= refsOf();
        const subjects = refs.length === 0 ? [] : git('log', ...refs, '--format=%s', '-E', `--grep=Merge pull request #${number} from`, `--grep=\\(#${number}\\)`);
        const merge = new RegExp(`^Merge pull request #${number} from `, 'u');
        const squash = new RegExp(`\\(#${number}\\)$`, 'u');
        cache.set(number, subjects.some((subject) => merge.test(subject) || squash.test(subject)));
      } catch {
        cache.set(number, null);
      }
    }
    return cache.get(number);
  };
  return { merged, note };
}

const cyclicEdges = (tasks) => {
  const edges = new Set();
  for (const task of tasks.values()) {
    if (task.status !== 'offered') continue;
    for (const wait of task.waits) {
      const taskId = wait.match(WAIT)?.[2];
      const next = taskId && follow(taskId, tasks);
      if (next?.status === 'offered' && (next.id === task.id || loopsBack(next, task, tasks))) edges.add(`${task.id} ${next.id}`);
    }
  }
  return edges;
};

const loopsBack = (from, origin, tasks, seen = new Set()) => {
  if (seen.has(from.id)) return false;
  seen.add(from.id);
  return from.waits.some((wait) => {
    const [, , taskId] = wait.match(WAIT) ?? [];
    const next = taskId && follow(taskId, tasks);
    return next?.status === 'offered' && (next.id === origin.id || loopsBack(next, origin, tasks, seen));
  });
};

function waitBlocker(wait, origin, tasks, git) {
  const [, pr, taskId, plan] = wait.match(WAIT) ?? [];
  if (pr) {
    const merged = git.merged(Number(pr));
    if (merged) return null;
    return { text: merged === null ? `pr:${pr} unreadable, git log failed` : `pr:${pr} not merged` };
  }
  if (taskId) {
    const task = follow(taskId, tasks);
    if (!task) return { text: `task:${taskId} dangling, no such task`, stuck: true };
    if (task.id === origin.id) return { text: `task:${taskId} is this task`, stuck: true, loop: true };
    if (isOpen(task)) return task.status === 'offered' && loopsBack(task, origin, tasks) ? { text: `task:${taskId} waits back on ${origin.id}`, stuck: true, loop: true } : { text: `task:${taskId} ${task.status}` };
    if (task.status === 'landed' || task.reason === 'done') return null;
    return { text: `task:${taskId} closed as dismissed ${task.reason} without its result`, stuck: true };
  }
  if (plan) {
    if (!existsSync(plan)) return { text: `run:${plan} dangling, no such plan`, stuck: true };
    const status = readFileSync(plan, 'utf8').match(/^Status:\s*(.*)$/mu)?.[1] ?? '';
    if (landed(status)) return null;
    const state = stateOf(status);
    return state === 'done' ? { text: `run:${plan} closed without its result`, stuck: true } : { text: `run:${plan} ${state ?? 'without a Status line'}` };
  }
  return { text: `${wait} malformed`, stuck: true };
}

function blockersOf(task, tasks, git) {
  const found = task.waits.map((wait) => waitBlocker(wait, task, tasks, git)).filter(Boolean);
  for (const peer of tasks.values()) {
    if (peer.id !== task.id && peer.status === 'started' && overlaps(task.keys, peer.keys)) found.push({ text: `started ${peer.id} writes its paths` });
  }
  return found;
}

export function startedOverlaps(tasks) {
  const started = [...tasks.values()].filter((task) => task.status === 'started');
  return started.flatMap((task, at) =>
    started.slice(at + 1).filter((peer) => overlaps(task.keys, peer.keys)).map((peer) => `${task.id} and ${peer.id} are both started on an overlapping path; the owner runs both`),
  );
}

export function board(tasks, git, here = null) {
  const open = [...tasks.values()].filter(isOpen).sort(byOrder);
  const started = open.filter((task) => task.status === 'started');
  const offered = open.filter((task) => task.status === 'offered');
  const lost = [...tasks.values()].filter((task) => task.status === 'dismissed' && task.reason === 'gone').sort(byOrder);
  const ready = [];
  const waiting = [];
  const unmigrated = [];
  const cardedFirst = [...offered.filter((each) => each.card), ...offered.filter((each) => !each.card)];
  for (const task of cardedFirst) {
    if (!task.topic) {
      unmigrated.push(task);
      continue;
    }
    const found = blockersOf(task, tasks, git);
    const ahead = ready.find((peer) => overlaps(task.keys, peer.keys));
    if (found.length === 0 && ahead) found.push({ text: `queued behind ${ahead.id}, which writes the same paths` });
    if (found.length > 0) waiting.push({ task, blockers: found.map((blocker) => blocker.text), stuck: found.filter((blocker) => blocker.stuck).map((blocker) => blocker.text) });
    else ready.push(task);
  }
  ready.sort(byOrder);
  waiting.sort((a, b) => byOrder(a.task, b.task));
  const topics = new Map();
  for (const task of open) {
    if (!task.topic) continue;
    const entry = topics.get(task.topic) ?? { topic: task.topic, tasks: [], decides: [] };
    entry.tasks.push(task);
    if (task.kind === 'decide') entry.decides.push(task);
    topics.set(task.topic, entry);
  }
  const offeredDecides = (entry) => entry.decides.filter((task) => task.status === 'offered');
  const elsewhere = (task) => here !== null && task.session !== here;
  const todo = [
    ...ready.filter((task) => !task.card).map((task) => ({ kind: 'card', text: `card ${task.id}: it can start and has no card; offer it with the prompt from chips brief ${task.id} and log carded, or list it in Open work where the runtime has no suggest tool` })),
    ...offered
      .filter((task) => task.card && elsewhere(task))
      .map((task) => {
        const blocker = waiting.find((entry) => entry.task === task)?.blockers[0];
        const holds = `${task.id}'s card ${task.card}${blocker ? ` on a task that now waits on ${blocker}` : ''}`;
        return {
          kind: 'check',
          text: task.session ? `check session ${task.session}, which holds ${holds}: when the session tool reports it archived or gone, log uncarded` : `check ${holds}, which names no session: when the owner says it is gone, log uncarded`,
        };
      }),
    ...ready
      .filter((task) => task.card && here !== null && task.session === here && displayTitle(task) !== task.cardTitle)
      .map((task) => ({ kind: 'card', text: `re-card ${task.id}: its title is now "${displayTitle(task)}", not the "${task.cardTitle}" card ${task.card} shows; withdraw that card; log started when the dismiss tool reports the owner started it, and otherwise log uncarded and, once chips lists it as Ready, card it again with the prompt from chips brief ${task.id}` })),
    ...waiting.filter(({ task }) => task.card && !elsewhere(task)).map(({ task, blockers }) => ({ kind: 'problem', text: `withdraw ${task.id}'s card ${task.card}: ${blockers[0]}; log uncarded once it is withdrawn or its session has ended` })),
    ...waiting.flatMap(({ task, stuck }) => stuck.map((blocker) => ({ kind: 'problem', text: `fix ${task.id}'s wait: ${blocker}; log updated with the waits it has now` }))),
    ...[...topics.values()]
      .filter((entry) => offeredDecides(entry).length > 1)
      .map((entry) => ({ kind: 'problem', text: `fold topic ${entry.topic}: ${offeredDecides(entry).map((task) => task.id).join(' and ')} are both open design questions; keep one and log the others as dismissed dup <kept id>` })),
    ...unmigrated.flatMap((task) => blockersOf(task, tasks, git).filter((blocker) => blocker.loop).map((blocker) => ({ kind: 'problem', text: `fix ${task.id}'s wait: ${blocker.text}; log updated with the waits it has now` }))),
    ...unmigrated.map((task) => ({ kind: 'migrate', text: `migrate ${task.id}: log updated with topic: and the waits: it has, as waits: none when it has none` })),
    ...lost.map((task) => ({ kind: 'migrate', text: `reopen ${task.id} or close it: a dropped card closed it as gone; log reopened, then updated with topic: and waits:, or dismissed done or superseded` })),
  ];
  return { open, ready, started, waiting, unmigrated, lost, topics: [...topics.values()], todo, here, note: git.note };
}

const line = (task, extra = '') => `  ${task.id}  ${displayTitle(task)}${task.topic ? `  [${task.topic}${task.kind === 'decide' ? ', decide' : ''}]` : ''}${task.owns.length ? `  owns ${task.owns.join(', ')}` : ''}${extra}`;

export function renderBoard(view, ledger) {
  if (view.open.length === 0 && view.lost.length === 0) return `No open suggested tasks in ${ledger}.`;
  const out = [`${view.open.length} open suggested tasks in ${ledger}. ${view.note}`, 'A session a card started works from chips brief <its task id>, because its task can change after the card.'];
  const section = (title, rows) => {
    if (rows.length > 0) out.push('', `${title} (${rows.length})`, ...rows);
  };
  const card = (task) => `  card ${task.card}${task.session && task.session !== view.here ? ` in session ${task.session}` : ''}`;
  section('Ready', view.ready.map((task) => line(task, task.card ? card(task) : '  no card')));
  section('Started', view.started.map((task) => line(task)));
  section('Waiting', view.waiting.map(({ task, blockers }) => line(task, `  waits on ${blockers.join('; ')}`)));
  section('Unmigrated', view.unmigrated.map((task) => line(task)));
  section('Lost', view.lost.map((task) => line(task)));
  section(
    'Topics',
    view.topics.filter((entry) => entry.tasks.length > 1 || entry.decides.length > 0).map((entry) => `  ${entry.topic}  ${entry.tasks.length} open${entry.decides.length ? `, design question ${entry.decides.map((task) => task.id).join(' and ')}` : ''}`),
  );
  section('Do', view.todo.map((item) => `  ${item.text}`));
  return out.join('\n');
}

const XHIGH = ' (xhigh)';
const displayTitle = (task) => (!task.title.endsWith(XHIGH) && (task.kind === 'decide' || task.effort === 'xhigh' || task.covers.some((entry) => entry.title.endsWith(XHIGH))) ? task.title + XHIGH : task.title);

export function briefOf(tasks, id, ledger) {
  const task = tasks.get(id);
  const live = follow(id, tasks);
  if (['dup', 'replaced'].includes(task.reason) && live && live !== task) {
    const moved = task.reason === 'dup' ? 'merged into' : 'replaced by';
    if (live.status === 'offered' && !live.card) return { ok: true, text: `${id} was ${moved} ${live.id}; work from its brief.\n\n${brief(live, ledger)}` };
    const held = live.status === 'offered' ? `has card ${live.card}` : `is ${taskState(live)}`;
    return { ok: false, text: `${id} was ${moved} ${live.id}, which ${held}, so there is nothing to start; tell the owner.` };
  }
  return isOpen(task) ? { ok: true, text: brief(task, ledger) } : { ok: false, text: `${id} is ${taskState(task)}, so there is nothing to start; tell the owner.` };
}

function brief(task, ledger) {
  return [
    displayTitle(task),
    '',
    `Suggested task ${task.id} in ${ledger}. This prompt can be older than the task, so first run node .agents/pstack/decisions-check.mjs chips brief ${task.id} and work from what it prints. Then run node .agents/pstack/decisions-check.mjs chips; when it lists this task as neither Ready nor Started, tell the owner what it waits on. Started means the lead already logged your start. Before you write any file, log a started row for it, with writes: naming any path the list below lacks, as .agents/pstack/rules/chips.md says.`,
    '',
    `Topic: ${task.topic ?? 'none'}. Kind: ${task.kind}.`,
    'Findings:',
    ...task.findings.map((finding) => `- ${finding}`),
    ...(task.covers.length ? ['Also covers:', ...task.covers.flatMap((entry) => [`- ${entry.id} ${entry.title}`, ...entry.findings.map((finding) => `  - ${finding}`)])] : []),
    `Writes: ${task.writes.join(', ')}`,
    ...(task.owns.length ? [`Owns: ${task.owns.join(', ')}`] : []),
    `Waited on: ${task.waits.length ? task.waits.join(', ') : 'nothing'}`,
    ...(task.kind === 'decide' ? ['', "This task settles a design question first. Route it through the project playbook that gives a design verdict, or pstack's Investigation playbook where the project has none, then plan any fix."] : []),
  ].join('\n');
}

export const newId = () => `t_${randomBytes(4).toString('hex')}`;
