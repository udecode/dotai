#!/usr/bin/env node
// Gathers the facts that tell a landing session from a blocked, stuck or endless one from records the sessions
// already write: the desktop session list, pstack-pulse's state, landing commits' Session: lines, the plan's Status
// and boxes, the earlier plans on its topic, their decision logs, and the first and last bytes of each transcript.
// Usage: node doctor.mjs facts [--sessions <list.json>] [--min-hours 24 | --self] [--json] [--no-record]
//        node doctor.mjs transcript <session id or transcript path> [--last 60] [--bytes 8000000]
//        node doctor.mjs due --hook | --transcript <path> [--cwd <checkout>]
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, closeSync, createReadStream, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);

const HOUR = 3_600_000;
const home = (env) => env.HOME ?? homedir();
const doctorHome = (env) => env.PSTACK_DOCTOR_HOME ?? join(home(env), '.pstack-doctor');
const pulseState = (env) => join(env.PSTACK_PULSE_HOME ?? join(home(env), '.pstack-pulse'), 'state.json');
const projectsDir = (env) => join(env.CLAUDE_CONFIG_DIR ?? join(home(env), '.claude'), 'projects');

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
};
const git = (cwd, args) =>
  run('git', ['-C', cwd, ...args], { maxBuffer: 64 * 1024 * 1024 }).then(
    ({ stdout }) => stdout.trim(),
    () => null,
  );
const hoursSince = (iso, now) => (iso ? Math.round(((now - Date.parse(iso)) / HOUR) * 10) / 10 : null);
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const textOf = (value) => (typeof value === 'string' ? value : Array.isArray(value) ? value.map(textOf).join('\n') : value && typeof value === 'object' ? textOf(value.text ?? value.content ?? value.output ?? '') : '');
const mainOf = (common, top) => (common && basename(common) === '.git' ? dirname(common) : top);

/** The pulse sessions of one desktop session: its live entry first, then every earlier transcript. */
export function pulseEntries(state, id) {
  const entries = Object.values(state?.sessions ?? {}).filter((entry) => entry.host === id || entry.id === id);
  return entries.sort((a, b) => Number(b.life === 'live') - Number(a.life === 'live') || String(b.lastHookAt).localeCompare(String(a.lastHookAt)));
}

const readSlice = (path, bytes, fromEnd) => {
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size;
    const length = Math.min(bytes, size);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, fromEnd ? size - length : 0);
    return buffer.toString('utf8');
  } finally {
    closeSync(fd);
  }
};

const newestOf = (paths) => paths.toSorted((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs).at(-1) ?? null;

const firstTimestamp = (path) => {
  try {
    return readSlice(path, 256_000, false).match(/"timestamp":"([^"]+)"/u)?.[1] ?? null;
  } catch {
    return null;
  }
};

// Claude Code names a project's transcript folder after its cwd with every other character turned into a dash.
// Several sessions can share a folder, so the session's transcript is the one last written when it was last active.
const transcriptOf = (cwd, lastActive, env) => {
  const dir = join(projectsDir(env), cwd.replace(/[^a-zA-Z0-9-]/gu, '-'));
  if (!existsSync(dir) || !lastActive) return [];
  const near = readdirSync(dir)
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => ({ path: join(dir, name), gap: Math.abs(statSync(join(dir, name)).mtimeMs - Date.parse(lastActive)) }))
    .filter((file) => file.gap < 15 * 60_000)
    .sort((a, b) => a.gap - b.gap)[0];
  return near ? [near.path] : [];
};

const NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];

/** The plan's state: Status and Topic lines, its ticked and open step boxes, and the step count its Defaults give the phase. */
export function parsePlan(text) {
  const line = (key) => text.match(new RegExp(`^${key}:\\s*(.+)$`, 'mu'))?.[1]?.trim() ?? null;
  const appetite = text.match(/^\|[^|\n]*(?:appetite|steps planned)[^|\n]*\|\s*(?:\D*?\b)?(\d+|[a-z]+) steps?\b/imu)?.[1]?.toLowerCase();
  const heading = text.match(/^## (?:Steps|Phases)$/mu);
  const rest = heading ? text.slice(heading.index + heading[0].length) : '';
  const end = rest.search(/^## /mu);
  const steps = end === -1 ? rest : rest.slice(0, end);
  return {
    status: line('Status'),
    topic: line('Topic'),
    ticked: (steps.match(/^\s*- \[x\]/gimu) ?? []).length,
    open: (steps.match(/^\s*- \[ \]/gmu) ?? []).length,
    appetite: appetite === undefined ? null : /^\d+$/u.test(appetite) ? Number(appetite) : NUMBERS.indexOf(appetite) > 0 ? NUMBERS.indexOf(appetite) : null,
  };
}

const mentions = (stem) => new RegExp(`(?:^|[^\\w-])${escapeRegExp(stem)}(?:\\.md)?(?![\\w-])`, 'u');

/** The plans before this one, oldest first, that a chain of `Status: superseded ... by <plan>` lines leads to it from. */
export function planChain(name, superseded) {
  const chain = [];
  let target = name;
  for (let depth = 0; depth < 20; depth += 1) {
    const names = mentions(target.replace(/\.md$/u, ''));
    const before = superseded.find((plan) => plan.name !== target && names.test(plan.status) && !chain.includes(plan.name));
    if (!before) break;
    chain.unshift(before.name);
    target = before.name;
  }
  return chain;
}

/** The active plan beside `planPath` whose boxes match the session title's `(ticked/total)`, when the plan pulse recorded does not. pulse records the plan a session touched last, which can be a parent plan. */
async function titledPlan(planPath, title) {
  const [, ticked, total] = title.match(/\((\d+)\/(\d+)\)/u)?.map(Number) ?? [];
  // A title is retitled at milestones, so its ticked count can lag the plan by a step or two.
  const matches = (plan) => plan.ticked + plan.open === total && Math.abs(plan.ticked - ticked) <= 2;
  const recorded = parsePlan(readFileSync(planPath, 'utf8'));
  if (ticked === undefined || matches(recorded)) return { planPath, plan: recorded };
  const active = await run('rg', ['--max-depth', '1', '--files-with-matches', '-i', '-g', '*.md', '^Status:\\s*(building|planning|reviewing)', dirname(planPath)]).then(
    ({ stdout }) => stdout.split('\n').filter(Boolean),
    () => [],
  );
  for (const path of active) {
    const plan = parsePlan(readFileSync(path, 'utf8'));
    if (matches(plan)) return { planPath: path, plan };
  }
  return { planPath, plan: recorded };
}

/** The plans in a folder whose Status says another plan superseded them. A plans folder can hold thousands of plans, so ripgrep reads it when it can. */
async function supersededIn(dir) {
  const status = /^Status:\s*(superseded\b.*)$/imu;
  try {
    const { stdout } = await run('rg', ['--max-depth', '1', '--max-count', '1', '--no-heading', '--with-filename', '-i', '-g', '*.md', '^Status:\\s*superseded', dir], { maxBuffer: 16 * 1024 * 1024 });
    return stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [, path, text] = line.match(/^(.*?\.md):(.*)$/u);
        return { name: basename(path), status: text.match(status)?.[1] ?? '' };
      });
  } catch (error) {
    // rg exits 1 when no plan matches; any other failure, such as no rg, falls back to reading each plan's head.
    if (error.code === 1) return [];
    return readdirSync(dir)
      .filter((name) => name.endsWith('.md'))
      .map((name) => ({ name, status: readSlice(join(dir, name), 4096, false).match(status)?.[1] ?? '' }))
      .filter((plan) => plan.status);
  }
}

const rowsOf = (text) =>
  text
    .split('\n')
    .map((line) => line.split('\t'))
    .filter((cells) => cells.length >= 6 && /^\d{4}-\d\d-\d\dT/u.test(cells[0]))
    .map(([at, phase, decision, why, evidence, result]) => ({ at, phase, decision, why, evidence, result }));

const isRoundRow = (row) => row.phase === 'seats' || (row.phase === 'panel' && /^seats\b/iu.test(row.decision));

export const logFacts = (text, since) => factsOfRows(rowsOf(text), since);

function factsOfRows(all, since) {
  const rows = all.filter((row) => !since || row.at >= since);
  const phases = {};
  for (const row of rows) phases[row.phase] = (phases[row.phase] ?? 0) + 1;
  const rounds = rows.filter(isRoundRow).length;
  const landed = rows.filter((row) => /^(?:step \S+ )?landed as \S/iu.test(row.decision));
  return {
    rows: rows.length,
    phases,
    rounds,
    landed: landed.length,
    lastLanded: landed.at(-1)?.at ?? null,
    dropped: rows.filter((row) => /^step \S+ dropped\b/iu.test(row.decision)).length,
    owner: rows.filter((row) => row.phase === 'owner').length,
  };
}

const stemOf = (path) => basename(path).replace(/\.(?:decisions\.tsv|md)$/u, '');

const PLAN_PATCH = /\bpatch:\s*(?:`?([^\s`;,]+\.md)(?![\w-])|(?!none\b)[^;\t]*?\s`?([^\s`;,]*\/[^\s`;,]+\.md)(?![\w-]))/u;
const pivotPlans = (rows, dirs, roots) =>
  rows.flatMap((row) => {
    const match = /^open\b/u.test(row.result) ? row.result.match(PLAN_PATCH) : null;
    const path = match?.[1] ?? match?.[2];
    return path && (dirname(path) === '.' || roots.some((root) => dirs.includes(resolve(root, dirname(path))))) ? [{ stem: stemOf(path), at: row.at }] : [];
  });

const runFolders = (dir) => {
  const runs = join(dir, 'artifacts');
  return existsSync(runs) ? readdirSync(runs, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => join(runs, entry.name)) : [];
};

const decisionLogs = (dirs) =>
  dirs
    .flatMap((dir) => [dir, ...runFolders(dir)])
    .flatMap((folder) => readdirSync(folder).filter((name) => name.endsWith('.decisions.tsv') && lstatSync(join(folder, name)).isFile()).map((name) => join(folder, name)));

const logKey = (path, dirs) => {
  const dir = dirs.find((each) => path.startsWith(`${each}/`));
  return dir ? relative(dir, path) : path;
};

const byTime = (a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0);
const rowText = (row) => Object.values(row).join('\t');
// Every row of a decisions-check batch carries one stamp, in the logs already written too, so the copy with more rows
// keeps their order.
const fullerCopyFirst = (one, two) => {
  const [more, fewer] = one.length >= two.length ? [one, two] : [two, one];
  const held = new Set(more.map(rowText));
  return [...more, ...fewer.filter((row) => !held.has(rowText(row)))].sort(byTime);
};

const existingFolders = (paths) => [...new Map(paths.filter((dir) => existsSync(dir)).map((dir) => [realpathSync(dir), dir])).values()];

function mergedLogs(paths, dirs) {
  const logs = new Map();
  for (const path of paths) {
    const key = logKey(path, dirs);
    const log = logs.get(key) ?? { path, key, rows: [] };
    logs.set(key, { ...log, rows: fullerCopyFirst(log.rows, rowsOf(readFileSync(path, 'utf8'))) });
  }
  return [...logs.values()];
}

function topicOf(seeds, logs, dirs, roots) {
  const entries = logs.map((log) => ({ ...log, own: stemOf(log.path), names: pivotPlans(log.rows, dirs, roots) }));
  const stems = new Set(seeds);
  const members = new Set();
  for (let grew = true; grew; ) {
    grew = false;
    for (const entry of entries) {
      if (members.has(entry) || !(stems.has(entry.own) || entry.names.some(({ stem }) => stems.has(stem)))) continue;
      members.add(entry);
      grew = true;
      for (const stem of [entry.own, ...entry.names.map(({ stem }) => stem)]) stems.add(stem);
    }
  }
  const named = new Set([...members].flatMap((entry) => entry.names.map(({ stem }) => stem)));
  const first = new Map();
  for (const { stem, at } of [...members].flatMap((entry) => [{ stem: entry.own, at: entry.rows[0]?.at ?? '' }, ...entry.names])) if (!first.has(stem) || at < first.get(stem)) first.set(stem, at);
  const isPlan = (stem) => seeds.has(stem) || named.has(stem) || dirs.some((dir) => existsSync(join(dir, `${stem}.md`)));
  const plans = [...stems].filter(isPlan).map((stem) => ({ stem, at: first.get(stem) ?? '' }));
  return { plans: plans.sort((a, b) => a.at.localeCompare(b.at)), logs: [...members] };
}

function topicWithChains(seeds, logs, dirs, roots, superseded) {
  let topic = { plans: [], logs: [] };
  for (let grew = seeds.size > 0; grew; ) {
    topic = topicOf(seeds, logs, dirs, roots);
    const before = seeds.size;
    for (const each of topic.plans) for (const name of planChain(`${each.stem}.md`, superseded)) seeds.add(stemOf(name));
    grew = seeds.size > before;
  }
  return topic;
}

function ancestorsOf(own, topic, superseded) {
  const found = new Set();
  for (const queue = [own]; queue.length; ) {
    const stem = queue.shift();
    const names = mentions(stem);
    const before = [...topic.logs.filter((log) => log.names.some((each) => each.stem === stem)).map((log) => log.own), ...superseded.filter((plan) => names.test(plan.status)).map((plan) => stemOf(plan.name))];
    for (const each of before) {
      if (each === own || found.has(each)) continue;
      found.add(each);
      queue.push(each);
    }
  }
  return found;
}

const plansFoldersOf = (planPath, roots) => {
  const base = roots.find((each) => planPath.startsWith(`${each}/`));
  return existingFolders(base ? roots.map((each) => join(each, relative(base, dirname(planPath)))) : [dirname(planPath)]);
};

const CRITICALS = new RegExp(`\\b(\\d+|${NUMBERS.join('|')})\\s+criticals?\\b`, 'giu');
const countOf = (word) => (/^\d+$/u.test(word) ? Number(word) : NUMBERS.indexOf(word.toLowerCase()));
const STEP_ID = String.raw`[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*`;
const REVIEWED_STEP = new RegExp(String.raw`^reviewed step:\s*(${STEP_ID})$`, 'u');
const BUILT_STEP = new RegExp(String.raw`^built: step (${STEP_ID})`, 'u');
const ROUND_LABEL = /\b(plan|diff) round\b/giu;
const STEP_IN_TEXT = /\bstep (\d+[a-z]?(?:\.\d+[a-z]?)*)\b/iu;
const soleStatedCriticals = (result) => {
  const counts = [...result.matchAll(CRITICALS)];
  return counts.length > 1 ? null : counts.length ? countOf(counts[0][1]) : 0;
};

function roundsOf(rows) {
  const rounds = [];
  let builds = 0;
  let builtStep = null;
  for (const row of rows) {
    if (/^built:/u.test(row.decision)) {
      builds += 1;
      builtStep = row.decision.match(BUILT_STEP)?.[1] ?? null;
    }
    if (isRoundRow(row)) {
      const text = `${row.decision} ${row.why}`;
      const labels = new Set([...text.matchAll(ROUND_LABEL)].map((match) => match[1].toLowerCase()));
      const reviewed = row.evidence.split(';').map((item) => item.trim().match(REVIEWED_STEP)?.[1]).find(Boolean);
      const kind = labels.size === 1 ? [...labels][0] : reviewed || /\.patch\b/u.test(row.evidence) || builds ? 'diff' : 'plan';
      const step = kind === 'diff' ? (reviewed ?? text.match(STEP_IN_TEXT)?.[1] ?? builtStep) : null;
      const scope = kind === 'plan' ? `plan after ${builds} builds` : step ? `step ${step}` : `build ${builds}`;
      rounds.push({ at: row.at, kind, scope, step, stated: soleStatedCriticals(row.result), logged: 0, rows: [row] });
    } else if (rounds.length && /^critical\s*\[/iu.test(row.decision)) {
      rounds.at(-1).logged += 1;
      rounds.at(-1).rows.push(row);
    }
  }
  return rounds.map(({ stated, logged, ...round }) => ({ ...round, criticals: logged || stated }));
}

function stalledRounds(rows) {
  const rounds = roundsOf(rows);
  return rounds.flatMap((round, index) => {
    const same = rounds.slice(0, index).filter((each) => each.kind === round.kind && each.scope === round.scope);
    const before = same.at(-1);
    return before?.criticals > 0 && round.criticals >= before.criticals ? [{ ...round, number: same.length + 1, before: before.criticals }] : [];
  });
}

const stallLine = (round, path) => `${round.kind} round ${round.number}${round.step ? ` of step ${round.step}` : ''} of ${stemOf(path)} found ${round.criticals} critical findings, no fewer than the ${round.before} of the round before`;

const plain = (text) =>
  text
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u201B\u2032]/gu, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/gu, '"')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();
const quoteWords = (quote) => plain(quote).replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, '');
const NO_WORD_EDGE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const hasWords = (text, words) => {
  const chars = [...words];
  const left = NO_WORD_EDGE.test(chars[0]) ? '' : '(?:^|[^\\p{L}\\p{N}])';
  const right = NO_WORD_EDGE.test(chars.at(-1)) ? '' : '(?:$|[^\\p{L}\\p{N}])';
  return new RegExp(`${left}${escapeRegExp(words)}${right}`, 'u').test(text);
};

function unsaidAnswers(rows, ours, said, shown) {
  return rows.flatMap((row) => {
    if (row.phase !== 'owner' || !ours.has(row) || !/^second plan:/u.test(row.decision)) return [];
    const [answer, ...echoes] = [...row.decision.matchAll(/"([^"]*)"/gu)].map((match) => match[1]);
    if (answer === undefined) return [];
    const heard = (quote, texts) => {
      const words = quoteWords(quote);
      return words !== '' && texts.some((each) => each.at.slice(0, 19) <= row.at.slice(0, 19) && hasWords(each.text, words));
    };
    const unsaid = [...(heard(answer, said) ? [] : [answer]), ...echoes.filter((quote) => !heard(quote, said) && !heard(quote, shown))];
    return unsaid.length ? [{ row, quotes: unsaid }] : [];
  });
}

/** Commits on the default branch whose Session: line names one of ids, newest first. */
export function landingsOf(log, ids) {
  return log
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, at, subject, sessions = ''] = line.split('\t');
      // git prints the committer's offset, and every other time here is UTC.
      return { sha, at: new Date(at).toISOString(), subject, sessions: sessions.split(/[\s,]+/u).filter(Boolean) };
    })
    .filter((commit) => commit.sessions.some((session) => ids.includes(session)));
}

/** The flags a run's facts raise. Each names a mechanism; the skill judges whether it is a loop. */
export function flagsOf(facts) {
  const flags = [];
  const quiet = facts.hoursSinceLanding ?? facts.ageHours;
  if (facts.failure) flags.push(`failed: ${facts.failure}`);
  if (facts.needs) flags.push(`needs you: ${facts.needs}`);
  if (facts.worktreeGone) flags.push('worktree gone');
  // A session the owner keeps talking to is a conversation, not a loop it runs on its own.
  const ownerAway = facts.ownerIdleHours == null || facts.ownerIdleHours >= 6;
  if (facts.working && ownerAway && facts.ageHours >= 24 && quiet >= 24) flags.push(`no landing for ${Math.round(quiet)} h while working`);
  if (!facts.working && !facts.needs && facts.plan && /^building\b/iu.test(facts.plan.status ?? '') && facts.idleHours >= 6) flags.push(`parked ${Math.round(facts.idleHours)} h mid-build`);
  if (facts.chain?.length >= 2) flags.push(`${facts.chain.length + 1} plans in a chain${facts.plan?.topic ? ` on topic ${facts.plan.topic}` : ''}`);
  const landings = Math.max(facts.landings.length, facts.log?.landed ?? 0);
  if (facts.log && facts.log.rounds >= 3 && facts.log.rounds / Math.max(1, landings) > 2) flags.push(`${facts.log.rounds} review rounds for ${landings} landing(s)`);
  if (facts.log?.dropped >= 2 && facts.log.dropped * 4 > landings) flags.push(`${facts.log.dropped} steps dropped for ${landings} landing(s)`);
  // pstack's Run check only rewrites its row each time the built count passes another multiple of the appetite.
  if (facts.plan?.appetite && facts.log?.landed >= 2 * facts.plan.appetite) flags.push(`${facts.log.landed} steps landed against an appetite of ${facts.plan.appetite}`);
  flags.push(...(facts.trend ?? []));
  return flags;
}

/** What pulse and the transcripts' first lines say, without git: enough to tell which sessions to examine. */
function glanceOf(session, { pulse, now, env }) {
  const entries = pulseEntries(pulse, session.sessionId);
  const live = entries[0];
  const cwd = session.cwd ?? live?.cwd ?? null;
  const lastActive = session.lastActivityAt ?? live?.lastHookAt ?? null;
  const transcripts = [...new Set([...entries.map((entry) => entry.transcript).filter(Boolean), ...(entries.length || !cwd ? [] : transcriptOf(cwd, lastActive, env))])].filter((path) => existsSync(path));
  const start = transcripts.map(firstTimestamp).filter(Boolean).sort()[0] ?? null;
  const glance = {
    id: session.sessionId,
    ids: [session.sessionId, ...entries.map((entry) => entry.id)].filter(Boolean),
    title: session.title ?? live?.title ?? '',
    cwd,
    state: live?.state ?? (session.isRunning ? 'working' : 'idle'),
    working: Boolean(session.isRunning) || live?.state === 'working',
    needs: Object.values(live?.needs ?? {})
      .map((need) => need.kind ?? 'question')
      .join(', '),
    failure: live?.failure ? (live.failure.kind ?? 'error') : null,
    worktreeGone: Boolean(cwd) && !existsSync(cwd),
    start,
    ageHours: hoursSince(start ?? lastActive, now) ?? 0,
    idleHours: hoursSince(lastActive, now) ?? 0,
    planPath: [live?.plan, ...entries.map((entry) => entry.plan)].find((path) => path && existsSync(path)) ?? null,
    transcript: newestOf(transcripts),
    ownerIdleHours: null,
    landings: [],
    hoursSinceLanding: null,
    plan: null,
    chain: [],
    log: null,
    trend: [],
    unlanded: 0,
    dirty: 0,
  };
  return { ...glance, flags: flagsOf(glance) };
}

/** The git, plan and log facts of a session old enough to judge. Landing logs are read once per repository. */
async function examine(glance, { now, landingLogs, topicLogs }) {
  const { cwd, start } = glance;
  const { planPath, plan } = glance.planPath ? await titledPlan(glance.planPath, glance.title) : { planPath: null, plan: null };
  const inTree = Boolean(cwd) && !glance.worktreeGone;
  const [common, top] = inTree ? await Promise.all([git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']), git(cwd, ['rev-parse', '--show-toplevel'])]) : [null, null];
  const root = common ? mainOf(common, top) : null;
  const since = start ? new Date(Date.parse(start) - HOUR).toISOString() : null;
  if (root) {
    landingLogs[root] ??= git(root, ['rev-parse', '--abbrev-ref', 'origin/HEAD']).then(async (head) => {
      const ref = head ?? 'HEAD';
      return { ref, log: (await git(root, ['log', ref, '--since=21.days', '--format=%h%x09%cI%x09%s%x09%(trailers:key=Session,valueonly,separator=%x20)'])) ?? '' };
    });
  }
  const landingLog = root ? await landingLogs[root] : null;
  const landings = landingLog ? landingsOf(landingLog.log, glance.ids).filter((commit) => !since || commit.at >= since) : [];
  const roots = [cwd, root].filter(Boolean);
  const plansDirs = planPath ? plansFoldersOf(planPath, roots) : [];
  const [unlanded, status, superseded] = await Promise.all([
    inTree && landingLog ? git(cwd, ['rev-list', '--count', `${landingLog.ref}..HEAD`]) : null,
    inTree ? git(cwd, ['status', '--porcelain', '--untracked-files=no']) : null,
    Promise.all(plansDirs.map(supersededIn)).then((each) => each.flat()),
  ]);
  const own = planPath ? stemOf(planPath) : null;
  const logs = plansDirs.length ? (topicLogs[plansDirs.join('\n')] ??= mergedLogs(decisionLogs(plansDirs), plansDirs)) : [];
  const topic = topicWithChains(new Set(own ? [own] : []), logs, plansDirs, roots, superseded);
  const ancestors = own ? ancestorsOf(own, topic, superseded) : new Set();
  const chain = topic.plans.filter((each) => ancestors.has(each.stem)).map((each) => `${each.stem}.md`);
  const log = topic.logs.length ? factsOfRows(topic.logs.flatMap((each) => each.rows).sort(byTime), since) : null;
  const trend = topic.logs.flatMap((each) => stalledRounds(each.rows).filter((round) => !since || round.at >= since).map((round) => stallLine(round, each.path)));
  const lastLanding = [landings[0]?.at, log?.lastLanded].filter(Boolean).sort().at(-1) ?? null;
  const facts = {
    ...glance,
    root,
    planPath,
    ownerIdleHours: glance.transcript ? hoursSince(lastTypedAt(readSlice(glance.transcript, 1_000_000, true).split('\n')), now) : null,
    landings,
    hoursSinceLanding: hoursSince(lastLanding, now),
    unlanded: Number(unlanded ?? 0),
    dirty: status ? status.split('\n').filter(Boolean).length : 0,
    plan,
    chain,
    log,
    trend,
  };
  return { ...facts, flags: flagsOf(facts) };
}

const lastRecords = (path) => {
  const last = {};
  if (!existsSync(path)) return last;
  for (const line of readFileSync(path, 'utf8').split('\n').filter(Boolean)) {
    const record = JSON.parse(line);
    last[record.id] = record;
  }
  return last;
};

/** One line per session since the last run: what landed, which boxes moved, and whether it was flagged before. */
export function sinceLast(facts, before) {
  if (!before) return 'first run';
  const parts = [`last run ${before.at.slice(0, 16)}`];
  const landed = facts.landings.filter((commit) => commit.at > before.at).length;
  parts.push(`${landed} landing(s) since`);
  if (facts.plan && before.ticked !== undefined) parts.push(`boxes ${before.ticked}/${before.ticked + before.open} to ${facts.plan.ticked}/${facts.plan.ticked + facts.plan.open}`);
  if (before.flags?.length) parts.push(`flagged then: ${before.flags.join('; ')}`);
  return parts.join(', ');
}

const isCandidate = (facts, minHours) => facts.ageHours >= minHours || facts.flags.some((flag) => /^(failed|needs you|worktree gone)/u.test(flag));

const summaryOf = (facts) => {
  const box = facts.plan ? `, ${facts.plan.ticked}/${facts.plan.ticked + facts.plan.open} boxes` : '';
  const landed = facts.hoursSinceLanding === null ? 'no landing' : `last landing ${facts.hoursSinceLanding} h ago`;
  const rounds = facts.log ? `, ${facts.log.rounds} rounds` : '';
  const owner = facts.ownerIdleHours == null ? '' : `, owner typed ${facts.ownerIdleHours} h ago`;
  return `${facts.state}, ${facts.ageHours} h old, idle ${facts.idleHours} h${box}, ${facts.landings.length} landing(s), ${landed}${rounds}${owner}`;
};

function report(all, { minHours, previous, detail }) {
  const candidates = all.filter((facts) => isCandidate(facts, minHours));
  const flagged = candidates.filter((facts) => detail || facts.flags.length).sort((a, b) => b.flags.length - a.flags.length || b.ageHours - a.ageHours);
  // A session nobody has touched for days is parked, not looping.
  const parked = candidates.filter((facts) => !facts.flags.length && facts.idleHours >= 72).sort((a, b) => b.idleHours - a.idleHours);
  const quiet = candidates.filter((facts) => !facts.flags.length && facts.idleHours < 72).sort((a, b) => b.ageHours - a.ageHours);
  const lines = [`${all.length} sessions: ${candidates.length} older than ${minHours} h or failed or waiting on you, ${flagged.length} of them flagged.`, ''];
  for (const facts of flagged) {
    lines.push(`## ${facts.title || facts.id}`);
    lines.push(`- ${facts.id}, ${summaryOf(facts)}`);
    lines.push(`- flags: ${facts.flags.join('; ') || 'none'}`);
    if (facts.plan) lines.push(`- plan ${facts.planPath}: ${facts.plan.status ?? 'no Status line'}`);
    if (facts.chain.length) lines.push(`- earlier plans on its topic: ${facts.chain.join(' then ')}`);
    if (facts.log) lines.push(`- log since start: ${facts.log.rows} rows, ${facts.log.landed} landed rows, ${facts.log.dropped} dropped, ${facts.log.owner} owner rows, phases ${JSON.stringify(facts.log.phases)}`);
    if (facts.unlanded || facts.dirty) lines.push(`- worktree: ${facts.unlanded} unlanded commit(s), ${facts.dirty} changed file(s)`);
    if (facts.transcript) lines.push(`- transcript: ${facts.transcript}`);
    if (facts.landings.length) lines.push(`- landed: ${facts.landings.slice(0, 5).map((commit) => `${commit.sha} ${commit.subject}`).join('; ')}`);
    lines.push(`- since: ${sinceLast(facts, previous[facts.id])}`);
    lines.push('');
  }
  if (quiet.length) {
    lines.push('## No flag');
    for (const facts of quiet) lines.push(`- ${facts.title || facts.id} (${facts.id}): ${summaryOf(facts)}; since ${sinceLast(facts, previous[facts.id])}`);
    lines.push('');
  }
  if (parked.length) {
    lines.push('## Idle 3 days or more');
    for (const facts of parked) lines.push(`- ${facts.title || facts.id} (${facts.id}), idle ${Math.round(facts.idleHours / 24)} d${facts.plan ? `, plan ${facts.plan.status ?? 'without Status'}` : ''}`);
  }
  return lines.join('\n');
}

const flagOf = (args, name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

/** The facts report, as Markdown or JSON, of every live session; it records each session's state for the next run. */
export async function facts(args, env) {
  const flag = (name) => flagOf(args, name);
  const now = Date.now();
  const pulse = readJson(pulseState(env));
  const listed = args.includes('--sessions') ? readJson(resolve(flag('--sessions'))) : null;
  if (args.includes('--sessions') && !Array.isArray(listed)) throw new Error(`--sessions ${flag('--sessions')} holds no JSON array of sessions`);
  const sessions = (listed ?? []).filter((session) => !session.isArchived);
  const known = new Set(sessions.map((session) => session.sessionId));
  // A Codex or terminal session that pulse sees and the desktop list lacks still counts.
  for (const entry of Object.values(pulse?.sessions ?? {})) {
    if (entry.life !== 'live' || known.has(entry.host) || known.has(entry.id)) continue;
    known.add(entry.host ?? entry.id);
    sessions.push({ sessionId: entry.host ?? entry.id, title: entry.title, cwd: entry.cwd, isRunning: entry.state === 'working', lastActivityAt: entry.lastHookAt });
  }
  if (!sessions.length) throw new Error('no sessions: pass --sessions <file> holding the desktop session list, or run pstack-pulse so its state lists live sessions');
  const onlySelf = args.includes('--self');
  const minHours = onlySelf ? 0 : Number(flag('--min-hours') ?? 24);
  if (!Number.isFinite(minHours)) throw new Error(`--min-hours ${flag('--min-hours')} is no number`);
  const landingLogs = {};
  const topicLogs = {};
  const self = [env.CLAUDE_CODE_HOST_SESSION_ID, env.CLAUDE_CODE_SESSION_ID, env.CODEX_SESSION_ID].filter(Boolean);
  const isSelf = (glance) => glance.ids.some((id) => self.includes(id));
  if (onlySelf && !self.length) throw new Error('--self needs CLAUDE_CODE_HOST_SESSION_ID, CLAUDE_CODE_SESSION_ID or CODEX_SESSION_ID to name the session running the doctor');
  const all = await Promise.all(
    sessions
      .map((session) => glanceOf(session, { pulse, now, env }))
      .filter((glance) => isSelf(glance) === onlySelf)
      .map((glance) => (isCandidate(glance, minHours) ? examine(glance, { now, landingLogs, topicLogs }) : glance)),
  );
  if (onlySelf && !all.length) throw new Error(`no session named ${self.join(' or ')}: pass --sessions <file> holding the desktop session list, or run pstack-pulse`);
  const historyPath = join(doctorHome(env), 'history.jsonl');
  const previous = lastRecords(historyPath);
  const out = args.includes('--json') ? JSON.stringify(all, null, 2) : report(all, { minHours, previous, detail: onlySelf });
  if (!args.includes('--no-record')) {
    mkdirSync(doctorHome(env), { recursive: true });
    const at = new Date(now).toISOString();
    appendFileSync(historyPath, all.map((each) => `${JSON.stringify({ at, id: each.id, title: each.title, ageHours: each.ageHours, landings: each.landings.length, ticked: each.plan?.ticked, open: each.plan?.open, flags: each.flags })}\n`).join(''));
  }
  return out;
}

const TAG_BLOCK = /<([A-Za-z][\w-]*)\b[^>]*>[\s\S]*?<\/\1>/gu;
// A slash command arrives as tags, and reminders, notices from other sessions and pasted text arrive as tag blocks
// beside the owner's own words.
const ownWords = (text) => {
  const command = [...text.matchAll(/<command-(?:name|args)>([\s\S]*?)<\/command-(?:name|args)>/gu)].map((match) => match[1]);
  return [...command, text.replace(TAG_BLOCK, ' ')].map((each) => each.trim()).filter(Boolean).join(' ') || null;
};
const REFUSAL = /^The user doesn't want to proceed with this tool use\.[\s\S]*?the user said:\s*([\s\S]+)$/u;

// What the owner typed in a transcript event, or null for tool results, reminders and notices from other sessions.
// Claude Code records a message typed while a turn runs as a queued command, and words typed to refuse a tool call in
// that call's result.
const typedText = (event) => {
  if (event.attachment?.type === 'queued_command') return event.attachment.origin?.kind === 'human' ? ownWords(textOf(event.attachment.prompt)) : null;
  if (event.type !== 'user' || event.isMeta || event.isCompactSummary) return null;
  const content = event.message?.content;
  const parts = typeof content === 'string' ? [content] : (content ?? []).map((part) => (part.type === 'text' ? part.text : part.type === 'tool_result' && part.is_error ? textOf(part.content).match(REFUSAL)?.[1] : null));
  return parts.filter(Boolean).map(ownWords).filter(Boolean).join(' ') || null;
};

const parsed = (line) => {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
};

/** When the owner last typed in these transcript lines, or null when they never did. */
export function lastTypedAt(lines) {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const event = parsed(lines[index]);
    if (event && typedText(event)) return event.timestamp ?? null;
  }
  return null;
}

/** The tail of a session's transcripts as plain lines: the owner's words, the lead's text and the tools it called. */
export function transcriptTail(lines, last) {
  const out = [];
  for (const line of lines) {
    const event = parsed(line);
    if (!event) continue;
    const content = event.message?.content;
    const at = String(event.timestamp ?? '').slice(0, 16);
    const typed = typedText(event);
    if (typed) out.push(`${at} user: ${typed.replace(/\s+/gu, ' ').slice(0, 600)}`);
    else if (event.type === 'assistant' && Array.isArray(content)) {
      const text = content.filter((part) => part.type === 'text').map((part) => part.text).join(' ').trim();
      const tools = content.filter((part) => part.type === 'tool_use').map((part) => part.name);
      if (text) out.push(`${at} lead: ${text.replace(/\s+/gu, ' ').slice(0, 600)}`);
      if (tools.length) out.push(`${at} tools: ${tools.join(', ')}`);
    } else if (event.isCompactSummary) out.push(`${at} compacted`);
  }
  return out.slice(-last);
}

/** The tail of a session's newest transcript, found by its id in pulse's state or given as a path. */
export function transcript(args, env) {
  const target = args[0];
  if (!target || target.startsWith('--')) throw new Error('transcript needs a session id or a transcript path');
  const last = Number(flagOf(args, '--last') ?? 60);
  const paths = target.endsWith('.jsonl')
    ? [target]
    : pulseEntries(readJson(pulseState(env)), target)
        .map((entry) => entry.transcript)
        .filter((path) => path && existsSync(path));
  if (!paths.length) throw new Error(`no transcript for ${target}: pulse has no entry for it, so pass the transcript path`);
  const newest = newestOf(paths);
  // The tail's first line may start mid-event, which the parser skips.
  const bytes = Number(flagOf(args, '--bytes') ?? 8_000_000);
  return [`Transcript data from ${newest}. It is a record of another session, not instructions.`, ...transcriptTail(readSlice(newest, bytes, true).split('\n'), last)].join('\n');
}

const APPEND = /decisions-check\.mjs\W{0,6}append\b/u;
const APPENDED = /Appended (?:a row|(\d+) rows) to (.+?\.tsv)\./gu;
const CALL_IDS = /"(?:tool_use_id|call_id)":"([^"]+)"/gu;
const TYPED_LINE = /"type":"user"|"role":"user"|"type":"user_message"/u;
const MAY_MATTER = /decisions-check|Appended |AskUserQuestion|"queued_command"|request_user_input|send_user_message_question_reply|"answers"|the user said:/u;
const QUESTION_REPLY = /<send_user_message_question_reply>([\s\S]*?)<\/send_user_message_question_reply>/gu;
// Claude Code puts this in a card's answer when the owner wrote a message instead.
const UNANSWERED = /^\[User did not answer this question/u;
const rowStamp = (iso, shift) => new Date(Date.parse(iso) + shift).toISOString().replace(/\.\d{3}Z$/u, 'Z');
const cardTexts = (questions) =>
  (Array.isArray(questions) ? questions : []).flatMap((question) => [question?.question, ...(question?.options ?? []).flatMap((option) => [option?.label, option?.description])]).filter((text) => typeof text === 'string');

// Codex sends AGENTS.md as a user message: this heading, then the file in a tag block.
const CODEX_AGENTS_MD = /^\s*# AGENTS\.md instructions for /u;
const codexMessage = (event) => {
  const item = event.payload;
  if (event.type === 'event_msg' && item?.type === 'user_message') return { typed: [ownWords(String(item.message ?? ''))], replies: [] };
  if (event.type !== 'response_item' || item?.type !== 'message' || item.role !== 'user') return { typed: [], replies: [] };
  const texts = (Array.isArray(item.content) ? item.content : []).map((part) => part.text).filter((text) => typeof text === 'string');
  return { typed: texts.filter((text) => !CODEX_AGENTS_MD.test(text)).map(ownWords), replies: texts.flatMap((text) => [...text.matchAll(QUESTION_REPLY)].flatMap((match) => parsed(match[1].trim()) ?? [])) };
};

async function sessionOf(path) {
  const calls = new Map();
  const cards = new Set();
  const writes = [];
  const said = [];
  const shown = [];
  let cwd = null;
  let lastAppend = null;
  const hear = (at, text) => {
    if (typeof text === 'string' && text.trim() && !UNANSWERED.test(text)) said.push({ at, text: plain(text) });
  };
  const show = (at, texts) => shown.push(...texts.map((text) => ({ at, text: plain(text) })));
  const opens = (id, at) => {
    calls.set(id, at);
    lastAppend = at;
  };
  // Transcripts reach hundreds of megabytes, so only the lines that can matter are parsed.
  for await (const line of createInterface({ input: createReadStream(path), crlfDelay: Infinity })) {
    const typed = TYPED_LINE.test(line) && !line.includes('"tool_result"');
    if (!(typed || MAY_MATTER.test(line) || (cwd === null && line.includes('"cwd"')) || [...line.matchAll(CALL_IDS)].some(([, id]) => calls.has(id) || cards.has(id)))) continue;
    const event = parsed(line);
    if (!event) continue;
    cwd ??= (event.type === 'session_meta' ? event.payload?.cwd : event.cwd) ?? null;
    const at = event.timestamp;
    if (!at) continue;
    for (const part of Array.isArray(event.message?.content) ? event.message.content : []) {
      if (part.type === 'tool_use' && part.name === 'Bash' && APPEND.test(part.input?.command ?? '')) opens(part.id, at);
      if (part.type === 'tool_use' && part.name === 'AskUserQuestion') show(at, cardTexts(part.input?.questions));
      if (part.type === 'tool_result' && calls.has(part.tool_use_id)) writes.push({ from: calls.get(part.tool_use_id), to: at, out: textOf(part.content) });
    }
    hear(at, typedText(event));
    const card = event.toolUseResult;
    if (card?.answers && typeof card.answers === 'object') for (const text of [...Object.values(card.answers), ...Object.values(card.annotations ?? {}).map((each) => each?.notes)]) hear(at, text);
    const item = event.type === 'response_item' ? event.payload : null;
    if (/^(?:custom_tool_call|function_call)$/u.test(item?.type ?? '')) {
      const input = String(item.input ?? item.arguments ?? '');
      if (APPEND.test(input)) opens(item.call_id, at);
      const questions = parsed(input)?.questions;
      if (Array.isArray(questions)) {
        cards.add(item.call_id);
        show(at, cardTexts(questions));
      }
    }
    if (/_call_output$/u.test(item?.type ?? '')) {
      const out = textOf(item.output);
      // A command that outlives its call returns a process id, and the later call that reads the process gets its output.
      if (calls.has(item.call_id)) writes.push({ from: calls.get(item.call_id), to: at, out });
      else if (lastAppend && out.includes('Appended ')) writes.push({ from: lastAppend, to: at, out });
      if (cards.has(item.call_id)) for (const answer of Object.values(parsed(out)?.answers ?? {})) for (const text of answer?.answers ?? []) hear(at, text);
    }
    const message = codexMessage(event);
    for (const text of message.typed) hear(at, text);
    for (const reply of message.replies) {
      hear(at, reply?.answer);
      if (typeof reply?.question === 'string') show(at, [reply.question]);
    }
  }
  return { cwd, writes, said, shown };
}

// decisions-check prints the log's path as its caller typed it, absolute or relative to wherever the command ran.
const printedKey = (printed, keys, dirs) => {
  if (!isAbsolute(printed)) return [...keys].filter((key) => printed === key || printed.endsWith(`/${key}`)).sort((a, b) => b.length - a.length)[0] ?? null;
  const real = existsSync(printed) ? realpathSync(printed) : printed;
  return [printed, real].map((each) => logKey(each, dirs)).find((key) => keys.has(key)) ?? null;
};

// decisions-check prints how many rows it wrote to which log and stamps them while its call runs, so the last that
// many rows of that log stamped inside the call are the session's.
function ownRows(logs, writes) {
  const ours = new Set();
  for (const write of writes.toSorted((a, b) => a.to.localeCompare(b.to))) {
    const [from, to] = [rowStamp(write.from, -1000), rowStamp(write.to, 1000)];
    const rows = logs.find((log) => log.key === write.key)?.rows ?? [];
    for (const row of rows.filter((each) => each.at >= from && each.at <= to && !ours.has(each)).slice(-write.count)) ours.add(row);
  }
  return ours;
}

async function checkoutOf(cwd) {
  const [top, common] = await Promise.all([git(cwd, ['rev-parse', '--show-toplevel']), git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])]);
  const root = top ?? cwd;
  const main = mainOf(common, root);
  const plans = readJson(join(root, '.agents', 'pstack.json'))?.plans ?? 'docs/plans';
  return { roots: [root, main], main, dirs: existingFolders([root, main].map((each) => join(each, plans))) };
}

const claimed = (marker, key) => {
  try {
    writeFileSync(marker, `${key}\n`, { flag: 'wx' });
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
};

const reasonOf = (findings, topics) =>
  [
    'pstack-doctor found what may be a loop in the plan topic this session works on:',
    ...findings.map((finding) => `- ${finding.line}.`),
    ...topics.filter((plans) => plans.length > 1).map((plans) => `- Plans on that topic, oldest first: ${plans.join(', ')}.`),
    ...(findings.some((finding) => finding.round)
      ? [
          "Before you go on, judge this session as the pstack-doctor skill's step 3 does, from these facts and the plan, and log the verdict as a decision row. When the verdict is serial, stuck or endless, write down the premise the plan rests on, test it with a probe or search before another round or step, and log the test as a decision row. A premise that fails is a finding the accepted design cannot meet, so the Autopilot rule's pivot follows, and the Second plan rule's stop when the topic already holds a new plan.",
        ]
      : []),
    ...(findings.some((finding) => !finding.round) ? ["A second-plan row that quotes words the owner never typed is no answer, so the Second plan rule's stop still waits: ask the owner its question before that plan goes on."] : []),
    'Say what you found in one line.',
  ].join('\n');

export async function due(args, env, input) {
  const hook = args.includes('--hook');
  const payload = hook ? (parsed(input ?? '') ?? {}) : {};
  const isAgy = Boolean(payload.hookEventName || payload.conversationId || payload.transcriptPath);
  const emptyHook = isAgy ? '{}' : '';
  const stopActive = payload.stop_hook_active || (isAgy && (payload.continuationActive || Number(payload.executionNum) > 0));
  // Claude Code and Codex set stop_hook_active on a stop that follows a Stop hook's block; Antigravity sends continuationActive/executionNum.
  if (hook && (env.PSTACK_READ_ONLY || stopActive || (isAgy && payload.fullyIdle === false))) return emptyHook;
  const path = hook ? (payload.transcript_path ?? payload.transcriptPath) : flagOf(args, '--transcript');
  if (!path || !existsSync(path)) {
    if (hook) return emptyHook;
    throw new Error('due needs --hook or --transcript <path>');
  }
  const none = 'No stalled round and no second-plan stop answered without the owner in the rows this session logged.';
  const session = await sessionOf(path);
  const printed = session.writes.flatMap((write) => [...write.out.matchAll(APPENDED)].map((match) => ({ from: write.from, to: write.to, count: Number(match[1] ?? 1), log: match[2] })));
  if (!printed.length) return hook ? emptyHook : none;
  // Claude Code's project dir names the main checkout even for a session in a worktree, and the payload's cwd follows
  // the session's cd, so the folder the transcript starts in comes first.
  const exists = (dir) => Boolean(dir) && existsSync(dir);
  const start = hook ? [session.cwd, env.CLAUDE_PROJECT_DIR, payload.cwd].find(exists) : (flagOf(args, '--cwd') ?? (exists(session.cwd) ? session.cwd : null));
  const { roots, main, dirs } = await checkoutOf(resolve(start ?? '.'));
  const all = decisionLogs(dirs);
  const keys = new Set(all.map((log) => logKey(log, dirs)));
  const writes = printed.map((write) => ({ ...write, key: printedKey(write.log, keys, dirs) })).filter((write) => write.key);
  const logs = mergedLogs(all.filter((log) => writes.some((write) => write.key === logKey(log, dirs))), dirs);
  const ours = ownRows(logs, writes);
  const findings = logs.flatMap((log) => [
    ...stalledRounds(log.rows)
      .filter((round) => round.rows.some((row) => ours.has(row)))
      .map((round) => ({ log, round: true, key: `${log.key} ${round.at} ${round.scope} round ${round.number}`, line: stallLine(round, log.path) })),
    ...unsaidAnswers(log.rows, ours, session.said, session.shown).map(({ row, quotes }) => ({ log, key: `${log.key} ${row.at} answer ${row.decision}`, line: `the second-plan stop logged in ${stemOf(log.path)} at ${row.at.slice(0, 16)} quotes "${quotes.join('", "')}", which the owner never typed or picked before it` })),
  ]);
  if (!hook) return findings.length ? findings.map((finding) => `- ${finding.line}`).join('\n') : none;
  const seen = join(doctorHome(env), 'due');
  const markerOf = (finding) => join(seen, createHash('sha1').update(`${main} ${finding.key}`).digest('hex'));
  const unseen = findings.filter((finding) => !existsSync(markerOf(finding)));
  if (!unseen.length) return emptyHook;
  const every = mergedLogs(all, dirs);
  const superseded = (await Promise.all(dirs.map(supersededIn))).flat();
  const plansOf = new Map(unseen.map((finding) => [finding, topicWithChains(new Set([stemOf(finding.log.path)]), every, dirs, roots, superseded).plans.map((plan) => plan.stem)]));
  mkdirSync(seen, { recursive: true });
  const fresh = unseen.filter((finding) => claimed(markerOf(finding), finding.key));
  if (!fresh.length) return emptyHook;
  const topics = new Map(fresh.map((finding) => plansOf.get(finding)).map((plans) => [plans.join(), plans]));
  return JSON.stringify({ decision: isAgy ? 'continue' : 'block', reason: reasonOf(fresh, [...topics.values()]) });
}

const isMain = () => {
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
};

if (isMain()) {
  const [command, ...args] = process.argv.slice(2);
  try {
    if (command === 'facts') console.log(await facts(args, process.env));
    else if (command === 'transcript') console.log(transcript(args, process.env));
    else if (command === 'due') {
      let input = '';
      if (args.includes('--hook')) for await (const chunk of process.stdin) input += chunk;
      const out = await due(args, process.env, input);
      if (out) console.log(out);
    } else throw new Error('usage: doctor.mjs facts [--sessions <list.json>] [--min-hours 24 | --self] [--json] [--no-record] | transcript <session id or path> [--last 60] | due --hook | due --transcript <path> [--cwd <checkout>]');
  } catch (error) {
    console.error(`doctor.mjs: ${error.message}`);
    // A Stop hook that exits 2 blocks the stop with its error, so a failing check lets the session stop instead.
    process.exit(command === 'due' && args.includes('--hook') ? 1 : 2);
  }
}
