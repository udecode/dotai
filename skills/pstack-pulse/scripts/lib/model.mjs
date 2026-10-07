import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { QUESTION_TOOLS } from './event.mjs';

const SLOTS = 5;
const IDLE_GRACE_MS = 15 * 60_000;
const METRIC_LIMIT = 8;
const HOUR = 3_600_000;
const LOST_SHOWN_MS = HOUR;
const STALE_MS = 24 * HOUR;
const PUSH_GIVE_UP_MS = 24 * HOUR;
const SHIP_KEPT_MS = 24 * HOUR;
const ENDED_KEPT_MS = 7 * 24 * HOUR;
const RANK = { 'needs-you': 0, failed: 1, working: 2, idle: 3 };
const STATE_COLOR = { 'needs-you': 'orange', failed: 'red', working: 'blue', idle: 'gray' };
const STATE_LABEL = { 'needs-you': 'Needs you', failed: 'Failed', working: 'Working', idle: 'Idle' };

const ms = (iso) => Date.parse(iso);
const iso = (time) => new Date(time).toISOString();
export const keyOf = (session) => `pulse-${createHash('sha1').update(`${session.runtime}:${session.id}`).digest('hex').slice(0, 12)}`;
export const projectKeyOf = (project) => `pulse-p-${createHash('sha1').update(project.id).digest('hex').slice(0, 12)}`;
export const hashOf = (value) => createHash('sha1').update(JSON.stringify(value)).digest('hex');

function planPathOf(signal, cwd) {
  const path = resolve(cwd ?? '/', signal);
  if (path.endsWith('.decisions.tsv')) return path.replace(/\.decisions\.tsv$/u, '.md');
  const page = path.match(/^(.*)\/artifacts\/([^/]+)\.html$/u);
  return page ? join(page[1], `${page[2]}.md`) : null;
}

function newSession(observation) {
  return {
    id: observation.session,
    runtime: observation.runtime,
    audience: observation.runtime === 'claude' ? 'owner' : 'unknown',
    life: 'live',
    endedAt: null,
    state: 'working',
    since: observation.at,
    active: true,
    lastHookAt: observation.at,
    lastAliveAt: observation.at,
    cwd: null,
    transcript: null,
    title: null,
    pid: null,
    bridge: null,
    host: null,
    entrypoint: null,
    plan: null,
    turn: 0,
    needs: {},
    failure: null,
    check: null,
    published: null,
    pushes: [],
    ships: [],
    replies: [],
    cursor: null,
  };
}

const openNeed = (session, id, need) => {
  session.needs[id] ??= { id, ...need };
};
const openPermission = (session, tool, at, question) => openNeed(session, `permission:${at}`, { kind: 'permission', tool, openedAt: at, question, options: [] });
const askingOwner = (session) => Object.values(session.needs).some((need) => need.kind === 'question' || need.kind === 'permission');
const settlesPermission = (session, need, event) => need.kind === 'permission' && session.runtime === 'codex' && need.tool === event.tool;
const closeNeeds = (session, match) => {
  for (const [id, need] of Object.entries(session.needs)) if (match(need)) delete session.needs[id];
};
export const firstNeed = (session) => Object.values(session.needs).sort((a, b) => a.openedAt.localeCompare(b.openedAt))[0] ?? null;

function applyHook(session, event, key) {
  session.lastHookAt = event.at;
  session.cwd = event.cwd ?? session.cwd;
  session.transcript = event.transcript ?? session.transcript;
  session.pid = event.pid ?? session.pid;
  session.bridge = event.bridge ?? session.bridge;
  if (event.title) session.title = event.title;
  for (const signal of event.plans ?? []) session.plan = planPathOf(signal, event.cwd) ?? session.plan;
  if (event.push && !session.pushes.some((push) => push.sha === event.push.sha && push.branch === event.push.branch)) session.pushes.push({ ...event.push, at: event.at, attempts: 0, nextAt: event.at });
  if (event.check?.ok) {
    session.check = null;
    if (session.failure?.kind === 'check') session.failure = null;
  } else if (event.check) session.check ??= { episode: event.at };
  if (event.published && session.plan) session.published = session.turn;
  switch (event.event) {
    case 'SessionStart':
      session.life = 'live';
      session.endedAt = null;
      if (session.failure?.showUntil) session.failure = null;
      break;
    case 'UserPromptSubmit':
      session.life = 'live';
      session.endedAt = null;
      session.active = true;
      if ([null, 'user', 'sdk'].includes(event.source)) {
        session.turn += 1;
        session.failure = null;
        closeNeeds(session, (need) => need.kind !== 'codex-question');
      }
      break;
    case 'PreToolUse':
      session.active = true;
      if (QUESTION_TOOLS.includes(event.tool)) {
        const first = event.questions?.[0] ?? { question: event.tool === 'ExitPlanMode' ? 'Approve the plan?' : 'A question waits for you', options: [] };
        openNeed(session, event.toolUseId ?? `${event.tool}:${event.at}`, { kind: 'question', openedAt: event.at, question: first.question, options: first.options ?? [] });
      }
      break;
    case 'PermissionRequest':
      if (session.runtime === 'codex') openPermission(session, event.tool, event.at, `Allow ${event.tool ?? 'a tool'}?`);
      break;
    case 'Notification':
      if (event.notification === 'permission_prompt' && !askingOwner(session)) openPermission(session, null, event.at, event.message ?? 'Claude needs your permission');
      break;
    case 'PostToolUse':
    case 'PostToolUseFailure':
    case 'PermissionDenied':
      session.active = true;
      closeNeeds(session, (need) => settlesPermission(session, need, event) || need.id === event.toolUseId || (need.kind === 'question' && !event.toolUseId && QUESTION_TOOLS.includes(event.tool)));
      break;
    case 'Stop':
      session.active = event.background > 0;
      closeNeeds(session, (need) => need.kind === 'permission');
      if (session.active) break;
      if (session.published === session.turn && !session.replies?.some(({ turn }) => turn === session.turn)) {
        const summary = event.lastMessage?.split('\n').find((line) => line.trim())?.trim() ?? 'Plan page handed back';
        (session.replies ??= []).push({ id: `reply:${key}:${session.turn}`, turn: session.turn, at: event.at, summary });
      }
      if (session.check) session.failure = { kind: 'check', id: `${key}:check:${session.check.episode}`, summary: 'A required check is still failing' };
      break;
    case 'StopFailure':
      session.active = false;
      closeNeeds(session, (need) => need.kind === 'permission');
      session.failure = { kind: 'stop', id: `${key}:stop:${event.at}`, summary: 'The turn stopped on an API error' };
      break;
    case 'SessionEnd':
      session.life = 'ended';
      session.endedAt = event.at;
      session.needs = {};
      break;
    default:
      break;
  }
}

function applyRegistry(session, entry) {
  session.lastAliveAt = entry.at;
  session.title = entry.name ?? session.title;
  session.bridge = entry.bridge ?? session.bridge;
  session.host = entry.host ?? session.host;
  session.entrypoint = entry.entrypoint ?? session.entrypoint;
  session.pid = entry.pid ?? session.pid;
}

function applyGone(session, gone, key) {
  if (session.life === 'ended' || session.failure?.showUntil) return;
  if (!session.active) {
    session.life = 'ended';
    session.endedAt = gone.at;
    return;
  }
  session.active = false;
  session.failure = { kind: 'lost', id: `${key}:lost:${session.pid}`, summary: 'The session stopped while it was working', showUntil: iso(ms(gone.at) + LOST_SHOWN_MS) };
}

function applyRollout(session, rollout) {
  if (rollout.cursor !== session.cursor) session.lastAliveAt = rollout.at;
  session.cursor = rollout.cursor;
  for (const signal of rollout.signals) {
    if (signal.type === 'plan') session.plan = planPathOf(signal.path, session.cwd) ?? session.plan;
    else if (signal.type === 'ask') openNeed(session, signal.callId ?? `ask:${signal.at}`, { kind: 'codex-question', openedAt: signal.at, question: signal.question, options: signal.options });
    else if (signal.type === 'reply') delete session.needs[signal.callId];
  }
}

function applyPush(session, result) {
  const index = session.pushes.findIndex((push) => push.sha === result.sha && push.branch === result.branch);
  if (index < 0) return;
  const push = session.pushes[index];
  if (result.outcome === 'confirmed') {
    session.pushes.splice(index, 1);
    const id = `ship:${result.repoId}:${push.branch}:${push.sha}`;
    if (!session.ships.some((ship) => ship.id === id)) session.ships.push({ id, at: result.at, summary: `${result.repoName} ${push.branch} ${push.sha.slice(0, 9)}` });
  } else if (ms(result.at) - ms(push.at) > PUSH_GIVE_UP_MS) session.pushes.splice(index, 1);
  else {
    push.attempts += 1;
    push.nextAt = iso(ms(result.at) + Math.min(2000 * 2 ** push.attempts, 300_000));
  }
}

function applyClock(session, at) {
  const now = ms(at);
  session.ships = session.ships.filter((ship) => now - ms(ship.at) < SHIP_KEPT_MS);
  session.replies = (session.replies ?? []).filter((reply) => now - ms(reply.at) < SHIP_KEPT_MS);
  if (session.life !== 'live') return;
  const quiet = now - Math.max(ms(session.lastHookAt), ms(session.lastAliveAt)) > STALE_MS;
  const livenessProbed = session.runtime === 'claude';
  if ((session.failure?.showUntil && now > ms(session.failure.showUntil)) || (quiet && !(livenessProbed && Object.keys(session.needs).length))) {
    session.life = 'ended';
    session.endedAt = at;
  }
}

function derive(session, at) {
  const next = Object.keys(session.needs).length ? 'needs-you' : session.failure ? 'failed' : session.active ? 'working' : 'idle';
  if (next === session.state) return;
  session.state = next;
  session.since = at;
}

export function reduce(sessions, observation) {
  if (observation.kind === 'clock') {
    for (const [key, session] of Object.entries(sessions)) {
      applyClock(session, observation.at);
      derive(session, observation.at);
      const gone = session.endedAt ?? (session.audience === 'hidden' ? session.lastHookAt : null);
      if (gone && ms(observation.at) - ms(gone) > ENDED_KEPT_MS) delete sessions[key];
    }
    return;
  }
  const key = `${observation.runtime}:${observation.session}`;
  if (!sessions[key] && observation.kind !== 'hook') return;
  const session = (sessions[key] ??= newSession(observation));
  if (observation.kind === 'hook') applyHook(session, observation, key);
  else if (observation.kind === 'registry') applyRegistry(session, observation);
  else if (observation.kind === 'gone') applyGone(session, observation, key);
  else if (observation.kind === 'thread') {
    session.audience = ['vscode', 'cli'].includes(observation.source) ? 'owner' : 'hidden';
    session.title = observation.title ?? session.title;
  } else if (observation.kind === 'rollout') applyRollout(session, observation);
  else if (observation.kind === 'push') applyPush(session, observation);
  derive(session, observation.at);
}

const LIVE_STAGES = ['now', 'waiting', 'blocked', 'stopped'];
// The pstack Session title rule leads each title with its stage or state emoji and ends it with (n/total).
const TITLE_STAGES = { '📝': 'Plan', '📐': 'Design', '👥': 'Plan review', '🚧': 'Build', '✍': 'Writing', '🔎': 'Code review', '🧪': 'Verify', '🕵': 'Audit', '🚀': 'Ship', '🧠': 'Reflect', '🟠': 'Waiting', '🔴': 'Blocked', '💤': 'Paused' };

function titleStageOf(title) {
  const label = TITLE_STAGES[/^(\p{Extended_Pictographic})\uFE0F?\s/u.exec(title ?? '')?.[1]];
  if (!label) return null;
  const count = /\((\d+)\/(\d+)[^)]*\)\s*$/u.exec(title);
  return count ? { label, step: Number(count[1]), total: Number(count[2]) } : { label, step: 1, total: 1 };
}

const stageText = (stage) => (stage.total > 1 ? `${stage.label} ${stage.step}/${stage.total}` : stage.label);
const openPlanPage = (view) => (view.rail?.page && view.rail.stages.some(({ state }) => LIVE_STAGES.includes(state)) ? view.rail.page : null);

export function stepOf(rail) {
  const live = rail.stages.findIndex(({ state }) => LIVE_STAGES.includes(state));
  if (live >= 0) return live + 1;
  return rail.stages.findLastIndex(({ state }) => state !== 'left') + 1 || 1;
}

function sessionCardOf(view) {
  const { state } = view.session;
  const need = state === 'needs-you' ? firstNeed(view.session) : null;
  const stage = titleStageOf(view.title);
  const subtitle = (need ? String(need.question) : [view.project.name, stage ? stageText(stage) : STATE_LABEL[state]].join(' · ')).slice(0, 120);
  const title = clip(labelOf(view.title), 80);
  const color = STATE_COLOR[state] ?? 'blue';
  const page = openPlanPage(view);
  const planPage = page ? { title: 'Plan page', type: 'open_url', url: page } : null;
  const answer = view.webUrl ? { title: 'Answer', type: 'open_url', url: view.webUrl } : null;
  const [action, secondary] = (need ? [answer, planPage] : [planPage, answer]).filter(Boolean);
  return {
    type: 'segmented_progress',
    body: {
      content_state: { title, subtitle, type: 'segmented_progress', number_of_steps: stage?.total ?? 1, current_step: stage?.step ?? 1, color, badge: { title: STATE_LABEL[state] ?? 'Working', color } },
      ...(action ? { action } : {}),
      ...(secondary ? { secondary_action: secondary } : {}),
    },
  };
}

function fleetOf(views, { shippedToday, account, listUrl }) {
  const count = (state) => views.filter(({ session }) => session.state === state).length;
  const projects = Object.values(Object.groupBy(views, ({ project }) => project.id)).map((list) => `${list[0].project.name} ${list.length}`);
  return {
    type: 'stats',
    body: {
      content_state: {
        title: 'pstack fleet',
        subtitle: [account, ...projects].filter(Boolean).join(' · ').slice(0, 80),
        type: 'stats',
        metrics: [
          { label: 'Working', value: String(count('working')), color: 'blue' },
          { label: 'Needs you', value: String(count('needs-you')), color: 'orange' },
          { label: 'Failed', value: String(count('failed')), color: 'red' },
          { label: 'Shipped today', value: String(shippedToday), color: 'green' },
        ],
      },
      ...(listUrl ? { action: { title: 'All sessions', type: 'open_url', url: listUrl } } : {}),
    },
  };
}

const clip = (text, size) => (text.length > size ? `${text.slice(0, size - 1)}…` : text);
const labelOf = (title) => title.replace(/^\p{Extended_Pictographic}\uFE0F?\s*/u, '').replace(/\s*\(\d+\/\d+[^)]*\)\s*$/u, '');

function valueOf(view) {
  const { state } = view.session;
  const stage = titleStageOf(view.title);
  return state === 'needs-you' || state === 'failed' || !stage ? STATE_LABEL[state] : stageText(stage);
}

const byUrgencyThenName = (a, b) =>
  RANK[a.session.state] - RANK[b.session.state] ||
  (a.session.state === 'needs-you' ? firstNeed(a.session).openedAt.localeCompare(firstNeed(b.session).openedAt) : 0) ||
  labelOf(a.title).localeCompare(labelOf(b.title)) ||
  keyOf(a.session).localeCompare(keyOf(b.session));

function projectCardOf({ project, sessions }, { listUrl }) {
  const ordered = sessions.toSorted(byUrgencyThenName);
  const active = ordered.filter(({ session }) => session.state !== 'idle');
  const shown = active.length > METRIC_LIMIT ? active.slice(0, METRIC_LIMIT - 1) : active;
  const metrics = shown.length
    ? shown.map((view) => ({ label: valueOf(view), value: clip(labelOf(view.title), 20), color: STATE_COLOR[view.session.state] }))
    : [{ label: 'idle', value: String(ordered.length), color: 'gray' }];
  if (shown.length < active.length) metrics.push({ label: 'more', value: `+${active.length - shown.length}`, color: 'gray' });
  const asking = ordered.find(({ session }) => session.state === 'needs-you');
  const counts = Object.groupBy(active, ({ session }) => session.state);
  const subtitle = asking
    ? `${clip(labelOf(asking.title), 30)}: ${firstNeed(asking.session).question}`
    : active.length
      ? ['failed', 'working'].filter((state) => counts[state]).map((state) => `${counts[state].length} ${STATE_LABEL[state].toLowerCase()}`).join(' · ')
      : 'all idle';
  const action = asking?.webUrl ? { title: 'Answer', type: 'open_url', url: asking.webUrl } : listUrl ? { title: 'All sessions', type: 'open_url', url: listUrl } : null;
  return { type: 'stats', body: { content_state: { title: project.name, subtitle: clip(subtitle, 110), type: 'stats', metrics }, ...(action ? { action } : {}) } };
}

function projectsOf(ranked) {
  const groups = new Map();
  for (const view of ranked) {
    if (!groups.has(view.project.id)) groups.set(view.project.id, { key: projectKeyOf(view.project), rank: RANK[view.session.state], project: view.project, sessions: [] });
    groups.get(view.project.id).sessions.push(view);
  }
  return [...groups.values()];
}

function keepShownUntilOutranked(ranked, shown, slots) {
  const chosen = ranked.filter(({ key }) => shown.has(key)).slice(0, slots);
  for (const unit of ranked) {
    if (chosen.includes(unit)) continue;
    if (chosen.length < slots) {
      chosen.push(unit);
      continue;
    }
    const weakest = chosen.toSorted((a, b) => b.rank - a.rank)[0];
    if (weakest && unit.rank < weakest.rank) chosen.splice(chosen.indexOf(weakest), 1, unit);
  }
  return chosen;
}

function rankedLive(views) {
  const live = views.filter(({ session }) => session.life === 'live' && RANK[session.state] !== undefined);
  const ranked = live.toSorted((a, b) => RANK[a.session.state] - RANK[b.session.state] || (a.session.state === 'needs-you' ? firstNeed(a.session).openedAt.localeCompare(firstNeed(b.session).openedAt) : b.session.lastHookAt.localeCompare(a.session.lastHookAt)));
  return { live, ranked };
}

export function menuBoardOf(views, context) {
  const { live, ranked } = rankedLive(views);
  const rowOf = (view) => ({
    key: keyOf(view.session),
    state: view.session.state,
    ...sessionCardOf(view).body,
    open: view.session.host ? `claude://claude.ai/epitaxy/${view.session.host}` : view.webUrl,
    page: openPlanPage(view),
  });
  return { fleet: fleetOf(live, context).body, cards: ranked.map(rowOf) };
}

const sessionRankOf = ({ session }, now) => (session.state === 'idle' && now - ms(session.since) < IDLE_GRACE_MS ? RANK.working : RANK[session.state]);

export function planBoard(views, phone, context) {
  const { live } = rankedLive(views);
  const { ranked } = rankedLive(views.filter((view) => titleStageOf(view.title)));
  const shown = new Set(Object.keys(phone.streams));
  const slots = phone.capacity && context.now < phone.capacity.until ? Math.min(SLOTS, phone.capacity.slots) : SLOTS;
  const projects = keepShownUntilOutranked(projectsOf(ranked), shown, slots);
  const candidates = ranked
    .filter((view) => view.session.state !== 'idle' || shown.has(keyOf(view.session)))
    .map((view) => ({ key: keyOf(view.session), rank: sessionRankOf(view, context.now), view }));
  const sessions = keepShownUntilOutranked(candidates, shown, slots - projects.length);
  return {
    cards: [...projects.map((group) => [group.key, projectCardOf(group, context)]), ...sessions.map(({ key, view }) => [key, sessionCardOf(view)])],
    badge: live.filter(({ session }) => session.state === 'needs-you').length,
  };
}

export function incidentsOf(views) {
  const incidents = new Map();
  const add = (incident) => {
    if (!incidents.has(incident.id)) incidents.set(incident.id, incident);
  };
  for (const view of views) {
    const { session } = view;
    const title = labelOf(view.title);
    const key = `${session.runtime}:${session.id}`;
    const page = openPlanPage(view);
    const link = view.appUrl ?? view.webUrl ?? page;
    if (session.life === 'live') for (const need of Object.values(session.needs)) add({ id: `need:${key}:${need.id}:${need.openedAt}`, kind: 'needs-you', at: need.openedAt, title: `${title} needs you`, message: String(need.question), link, page });
    if (session.failure) add({ id: `fail:${session.failure.id}`, kind: 'failed', at: session.since, title: `${title} failed`, message: session.failure.summary, link, page });
    for (const ship of session.ships) add({ id: ship.id, kind: 'shipped', at: ship.at, title: `${title} shipped`, message: ship.summary, link, page });
    for (const reply of session.replies) add({ id: reply.id, kind: 'replied', at: reply.at, title: `${title} replied`, message: reply.summary, link, page });
  }
  return incidents;
}

export const shippedToday = (sessions, now) => new Set(Object.values(sessions).flatMap((session) => session.ships.filter((ship) => ship.at.slice(0, 10) === iso(now).slice(0, 10)).map((ship) => ship.id))).size;

const CELEBRATE_MS = 10_000;

export function petOf(views, now) {
  const live = views.filter(({ session }) => session.life === 'live');
  const count = (state) => live.filter(({ session }) => session.state === state).length;
  const needs = live
    .filter(({ session }) => session.state === 'needs-you')
    .map((view) => ({ title: view.title, repo: view.project.name, runtime: view.session.runtime, question: firstNeed(view.session)?.question ?? null, url: view.appUrl ?? view.webUrl, page: view.rail?.page ?? null }));
  const shipped = live.some(({ session }) => session.ships.some((ship) => now - ms(ship.at) < CELEBRATE_MS));
  const mood = needs.length ? 'waiting' : count('failed') ? 'failed' : shipped ? 'jumping' : count('working') ? 'running' : 'idle';
  return { mood, badge: needs.length, needs, counts: { working: count('working'), needsYou: needs.length, failed: count('failed') } };
}
