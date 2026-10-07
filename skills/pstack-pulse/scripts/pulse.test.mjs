import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';
import { eventOf } from './lib/event.mjs';
import { hookCommand, withHook, withoutHook } from './lib/install.mjs';
import { projectOf, readRollout } from './lib/io.mjs';
import { incidentsOf, keyOf, menuBoardOf, petOf, planBoard, projectKeyOf, reduce, stepOf } from './lib/model.mjs';
import { createClient, deliver, emptyPhone } from './lib/phone.mjs';

const T0 = Date.parse('2026-10-06T10:00:00.000Z');
const at = (seconds) => new Date(T0 + seconds * 1000).toISOString();
const hook = (session, event, seconds, extra = {}) => ({ kind: 'hook', v: 2, runtime: 'claude', session, event, at: at(seconds), cwd: '/repo', plans: [], source: null, ...extra });
const ask = (session, seconds, toolUseId = `tu-${session}-${seconds}`) => hook(session, 'PreToolUse', seconds, { tool: 'AskUserQuestion', toolUseId, questions: [{ question: `Ship ${session}?`, options: ['Ship', 'Hold'] }] });
const projectFrom = (cwd) => (cwd ? { id: cwd, name: basename(cwd) } : { id: 'other', name: 'other' });
const viewsOf = (sessions, urls = {}) => Object.values(sessions).map((session) => ({ session, title: session.id, project: projectFrom(session.cwd), rail: null, webUrl: urls[session.id] ?? null, appUrl: null }));
const VALID_KEY = /^[A-Za-z0-9_-]{1,255}$/u;

function fakeClient(script = {}) {
  const calls = [];
  const answer = (method, key) => {
    const queue = script[`${method} ${key}`] ?? script[method];
    return (Array.isArray(queue) ? queue.shift() : queue) ?? { ok: true };
  };
  return {
    calls,
    put: async (key) => (calls.push(`put ${key}`), VALID_KEY.test(key) ? answer('put', key) : { ok: false, kind: 'rejected', status: 400 }),
    end: async (key) => (calls.push(`end ${key}`), VALID_KEY.test(key) ? answer('end', key) : { ok: false, kind: 'rejected', status: 400 }),
    badge: async (value) => (calls.push(`badge ${value}`), answer('badge', value)),
    push: async (incident) => (calls.push(`push ${incident.title}`), answer('push', incident.kind)),
  };
}
const send = (sessions, phone, client, seconds) => {
  const now = T0 + seconds * 1000;
  const views = viewsOf(sessions);
  const board = planBoard(views, phone, { now, shippedToday: 0 });
  return deliver(phone, { cards: board.cards, badge: board.badge, incidents: incidentsOf(views), listUrl: null }, { client, clock: () => now });
};
const pushes = (client) => client.calls.filter((call) => call.startsWith('push'));

test('the board holds five project cards and no fleet card, and a sixth project takes a slot only when it is strictly more urgent', async () => {
  const sessions = {};
  ['/w/sixth', '/w/ellie', '/w/plate.js', '/w/dotai', '/w/pstack', '/w/smith'].forEach((cwd, index) => reduce(sessions, hook(`s${index}`, 'UserPromptSubmit', index, { cwd })));
  reduce(sessions, hook('s6', 'UserPromptSubmit', 6, { cwd: '/w/ellie' }));
  const phone = emptyPhone();
  await send(sessions, phone, fakeClient(), 10);
  assert.equal(Object.keys(phone.streams).length, 5);
  assert.ok(!phone.streams['pulse-fleet']);
  const sixth = projectKeyOf(projectFrom('/w/sixth'));
  reduce(sessions, hook('s0', 'PostToolUse', 20, { cwd: '/w/sixth', tool: 'Bash' }));
  const equal = fakeClient();
  await send(sessions, phone, equal, 21);
  assert.ok(!equal.calls.some((call) => call.startsWith('end') || call === `put ${sixth}`));
  reduce(sessions, { ...ask('s0', 30), cwd: '/w/sixth' });
  const urgent = fakeClient();
  await send(sessions, phone, urgent, 31);
  assert.equal(urgent.calls.filter((call) => call.startsWith('end')).length, 1);
  assert.ok(phone.streams[sixth]);
});

test('a project card keeps its stream as sessions join, and a hook that changes nothing on the card sends nothing', async () => {
  const sessions = {};
  const key = projectKeyOf(projectFrom('/w/ellie'));
  reduce(sessions, hook('a', 'UserPromptSubmit', 0, { cwd: '/w/ellie' }));
  const phone = emptyPhone();
  await send(sessions, phone, fakeClient(), 1);
  reduce(sessions, hook('b', 'UserPromptSubmit', 2, { cwd: '/w/ellie' }));
  const joined = fakeClient();
  await send(sessions, phone, joined, 3);
  assert.deepEqual(joined.calls.filter((call) => call.endsWith(key)), [`put ${key}`]);
  reduce(sessions, hook('a', 'PostToolUse', 4, { cwd: '/w/ellie', tool: 'Bash' }));
  const quiet = fakeClient();
  await send(sessions, phone, quiet, 5);
  assert.ok(!quiet.calls.includes(`put ${key}`));
});

test('cards an older daemon left, per session and for the fleet, end before any project card starts', async () => {
  const sessions = {};
  reduce(sessions, hook('old1', 'UserPromptSubmit', 0, { cwd: '/w/ellie' }));
  reduce(sessions, hook('old2', 'UserPromptSubmit', 0, { cwd: '/w/plate' }));
  const [old1, old2] = [keyOf(sessions['claude:old1']), keyOf(sessions['claude:old2'])];
  const phone = emptyPhone();
  const legacy = { type: 'segmented_progress', hash: 'old', body: { content_state: { title: 'old', type: 'segmented_progress' } } };
  Object.assign(phone.streams, { 'pulse-fleet': { type: 'stats', hash: 'old', body: { content_state: { title: 'pstack fleet', type: 'stats' } } }, [old1]: legacy, [old2]: legacy });
  const failing = fakeClient({ [`end ${old1}`]: { ok: false, kind: 'transient', status: 500 } });
  await send(sessions, phone, failing, 1);
  assert.ok(!failing.calls.some((call) => call.startsWith('put pulse-p-')));
  const retry = fakeClient();
  await send(sessions, phone, retry, 16);
  const firstStart = retry.calls.findIndex((call) => call.startsWith('put pulse-p-'));
  assert.ok(firstStart > retry.calls.indexOf(`end ${old1}`));
  assert.deepEqual(Object.keys(phone.streams).sort(), [projectKeyOf(projectFrom('/w/ellie')), projectKeyOf(projectFrom('/w/plate'))].sort());
});

const projectCard = (sessions, urls, context = {}) => planBoard(viewsOf(sessions, urls), emptyPhone(), { now: T0 + 60_000, shippedToday: 0, ...context }).cards[0][1].body;

test('a crowded project lists the session that needs you first, with its question and Answer button, and folds the rest into a more value', () => {
  const sessions = {};
  for (let index = 0; index < 10; index += 1) reduce(sessions, hook(`s${index}`, 'UserPromptSubmit', index, { cwd: '/w/ellie' }));
  reduce(sessions, { ...ask('s9', 20), cwd: '/w/ellie' });
  const card = projectCard(sessions, { s9: 'https://claude.ai/code/s9' });
  const { metrics, subtitle } = card.content_state;
  assert.equal(metrics.length, 8);
  assert.deepEqual(metrics[0], { label: 'Needs you', value: 's9', color: 'orange' });
  assert.deepEqual(metrics[7], { label: 'more', value: '+3', color: 'gray' });
  assert.equal(subtitle, 's9: Ship s9?');
  assert.equal(card.action.url, 'https://claude.ai/code/s9');
});

test('a project card lists its active sessions, then the three that went idle last, and counts the other idle ones', () => {
  const sessions = {};
  reduce(sessions, hook('busy', 'UserPromptSubmit', 0, { cwd: '/w/ellie' }));
  for (let index = 1; index <= 5; index += 1) {
    reduce(sessions, hook(`nap${index}`, 'UserPromptSubmit', 0, { cwd: '/w/ellie' }));
    reduce(sessions, hook(`nap${index}`, 'Stop', index, { cwd: '/w/ellie' }));
  }
  const mixed = projectCard(sessions).content_state;
  assert.deepEqual(mixed.metrics.map(({ value }) => value), ['busy', 'nap5', 'nap4', 'nap3']);
  assert.equal(mixed.subtitle, '1 working · +2 idle');
  reduce(sessions, hook('busy', 'Stop', 9, { cwd: '/w/ellie' }));
  const resting = projectCard(sessions).content_state;
  assert.deepEqual(resting.metrics.map(({ value }) => value), ['busy', 'nap5', 'nap4']);
  assert.equal(resting.subtitle, '+3 idle');
});

test('a project card counts only its own ships today', () => {
  const sessions = {};
  reduce(sessions, hook('shipper', 'UserPromptSubmit', 0, { cwd: '/w/ellie', push: { sha: 'abc1234567', branch: 'next' } }));
  reduce(sessions, { kind: 'push', runtime: 'claude', session: 'shipper', at: at(1), sha: 'abc1234567', branch: 'next', outcome: 'confirmed', repoId: 'ellie', repoName: 'ellie' });
  reduce(sessions, hook('other', 'UserPromptSubmit', 2, { cwd: '/w/plate' }));
  const cards = new Map(planBoard(viewsOf(sessions), emptyPhone(), { now: T0 + 60_000, shippedToday: 1 }).cards);
  assert.equal(cards.get(projectKeyOf(projectFrom('/w/ellie'))).body.content_state.subtitle, '1 working · 1 shipped today');
  assert.equal(cards.get(projectKeyOf(projectFrom('/w/plate'))).body.content_state.subtitle, '1 working');
});

test('eight sessions fill eight metrics, and a ninth folds two into a more value', () => {
  const sessions = {};
  for (let index = 0; index < 8; index += 1) reduce(sessions, hook(`s${index}`, 'UserPromptSubmit', index, { cwd: '/w/ellie' }));
  assert.ok(!projectCard(sessions).content_state.metrics.some(({ label }) => label === 'more'));
  reduce(sessions, hook('s8', 'UserPromptSubmit', 8, { cwd: '/w/ellie' }));
  assert.deepEqual(projectCard(sessions).content_state.metrics.at(-1), { label: 'more', value: '+2', color: 'gray' });
});

test('a project whose asking session has no web link opens the session list, never another session', () => {
  const sessions = {};
  reduce(sessions, hook('linked', 'UserPromptSubmit', 0, { cwd: '/w/ellie' }));
  reduce(sessions, hook('unlinked', 'UserPromptSubmit', 1, { cwd: '/w/ellie' }));
  reduce(sessions, { ...ask('unlinked', 2), cwd: '/w/ellie' });
  const card = projectCard(sessions, { linked: 'https://claude.ai/code/linked' }, { listUrl: 'https://list.example/secret/' });
  assert.deepEqual(card.action, { title: 'All sessions', type: 'open_url', url: 'https://list.example/secret/' });
  assert.equal(card.secondary_action, undefined);
});

test('clones of one repository with ssh and https origins are one project, and a folder outside any repository is other', () => {
  const root = mkdtempSync(join(tmpdir(), 'pulse-project-'));
  const repo = (name, origin) => {
    mkdirSync(join(root, name));
    spawnSync('git', ['-C', join(root, name), 'init', '-q']);
    if (origin) spawnSync('git', ['-C', join(root, name), 'remote', 'add', 'origin', origin]);
    return join(root, name);
  };
  const [first, second, solo] = [repo('r', 'git@github.com:o/r.git'), repo('r-2', 'https://github.com/o/r'), repo('solo')];
  mkdirSync(join(root, 'plain'));
  assert.deepEqual(projectOf(first), projectOf(second));
  assert.equal(projectOf(second).name, 'r');
  assert.notEqual(projectOf(solo).id, projectOf(first).id);
  assert.equal(projectOf(solo).name, 'solo');
  assert.equal(projectOf(join(root, 'plain')).id, 'other');
});

const claudeHook = (session, event, seconds, input = {}) => ({ kind: 'hook', ...eventOf('claude', { session_id: session, hook_event_name: event, cwd: '/repo', ...input }, {}, at(seconds)) });
const prompted = (session, seconds) => claudeHook(session, 'Notification', seconds, { notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' });
const needsOf = (session) => Object.values(session.needs).map((need) => need.question);

test('a question buzzes once, and not again after a restart', async () => {
  const sessions = {};
  reduce(sessions, hook('a', 'SessionStart', 0));
  reduce(sessions, hook('a', 'PermissionRequest', 1, { tool: 'Read' }));
  reduce(sessions, ask('a', 2));
  reduce(sessions, hook('a', 'PermissionRequest', 2, { tool: 'AskUserQuestion' }));
  const phone = emptyPhone();
  const client = fakeClient();
  await send(sessions, phone, client, 3);
  reduce(sessions, prompted('a', 8));
  await send(sessions, phone, client, 9);
  const restarted = JSON.parse(JSON.stringify({ sessions, phone }));
  await send(restarted.sessions, restarted.phone, client, 9);
  assert.deepEqual(pushes(client), ['push a needs you']);
});

test('a permission prompt needs you once Claude shows it unanswered, until the turn ends or you send a prompt, and a call a hook allows never does', () => {
  const sessions = {};
  reduce(sessions, hook('asked', 'UserPromptSubmit', 0));
  reduce(sessions, hook('asked', 'PermissionRequest', 1, { tool: 'Bash' }));
  reduce(sessions, prompted('asked', 7));
  assert.deepEqual(needsOf(sessions['claude:asked']), ['Claude needs your permission to use Bash']);
  reduce(sessions, hook('asked', 'PostToolUse', 9, { tool: 'Bash', toolUseId: 'tu-bash' }));
  assert.equal(sessions['claude:asked'].state, 'needs-you');
  reduce(sessions, hook('asked', 'Stop', 10, { background: 1 }));
  reduce(sessions, hook('allowed', 'UserPromptSubmit', 0));
  reduce(sessions, hook('allowed', 'PermissionRequest', 1, { tool: 'mcp__claude-in-chrome__navigate' }));
  assert.notEqual(sessions['claude:allowed'].state, 'needs-you');
  reduce(sessions, hook('allowed', 'PostToolUse', 5, { tool: 'mcp__claude-in-chrome__navigate', toolUseId: 'tu-nav' }));
  reduce(sessions, hook('remote', 'UserPromptSubmit', 0));
  reduce(sessions, prompted('remote', 7));
  reduce(sessions, hook('remote', 'UserPromptSubmit', 9, { source: 'sdk' }));
  reduce(sessions, hook('auto', 'UserPromptSubmit', 0));
  reduce(sessions, hook('auto', 'PostToolUse', 1, { tool: 'Bash', toolUseId: 'tu-bash' }));
  reduce(sessions, hook('codex', 'PermissionRequest', 1, { runtime: 'codex', tool: 'Bash' }));
  assert.equal(sessions['codex:codex'].state, 'needs-you');
  reduce(sessions, hook('codex', 'PostToolUse', 3, { runtime: 'codex', tool: 'Bash', toolUseId: 'tu-codex', inputKey: 'a1b2c3d4e5f60718' }));
  assert.deepEqual([...incidentsOf(viewsOf(sessions)).keys()], []);
});

test('a permission prompt still buzzes when another call finishes before the next tick', async () => {
  const sessions = {};
  reduce(sessions, claudeHook('t', 'UserPromptSubmit', 0));
  reduce(sessions, prompted('t', 7));
  reduce(sessions, claudeHook('t', 'PostToolUse', 7.1, { tool_name: 'Read', tool_input: { file_path: '/repo/a.ts' }, tool_use_id: 'tu-read' }));
  const client = fakeClient();
  await send(sessions, emptyPhone(), client, 8);
  assert.deepEqual(pushes(client), ['push t needs you']);
});

test('a question answered before its prompt notice leaves the next permission prompt buzzing', () => {
  const sessions = {};
  const question = { tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Ship?', options: [{ label: 'Ship' }, { label: 'Hold' }] }] } };
  reduce(sessions, claudeHook('q', 'UserPromptSubmit', 0));
  reduce(sessions, claudeHook('q', 'PreToolUse', 1, { ...question, tool_use_id: 'tu-q' }));
  reduce(sessions, claudeHook('q', 'PermissionRequest', 1, question));
  reduce(sessions, claudeHook('q', 'PostToolUse', 3, { tool_name: 'AskUserQuestion', tool_input: { ...question.tool_input, answers: { 'Ship?': 'Ship' } }, tool_use_id: 'tu-q' }));
  reduce(sessions, claudeHook('q', 'PermissionRequest', 20, { tool_name: 'Bash', tool_input: { command: 'make deploy' } }));
  reduce(sessions, prompted('q', 26));
  assert.equal(sessions['claude:q'].state, 'needs-you');
});

test('a permission need saved by an older daemon still closes, on its tool result for Codex and at the turn end for Claude', () => {
  const sessions = {};
  const saved = { id: 'permission:old', kind: 'permission', tool: 'Bash', openedAt: at(1), question: 'Allow Bash?', options: [] };
  reduce(sessions, claudeHook('l', 'UserPromptSubmit', 0));
  reduce(sessions, hook('c', 'UserPromptSubmit', 0, { runtime: 'codex' }));
  sessions['claude:l'].needs[saved.id] = { ...saved };
  sessions['codex:c'].needs[saved.id] = { ...saved };
  reduce(sessions, claudeHook('l', 'Stop', 3));
  reduce(sessions, { kind: 'hook', ...eventOf('codex', { session_id: 'c', hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'make' }, tool_use_id: 'tu-c', cwd: '/repo' }, {}, at(3)) });
  assert.deepEqual([needsOf(sessions['claude:l']), needsOf(sessions['codex:c'])], [[], []]);
});

test('a turn that stops on an API error drops its permission prompt', () => {
  const sessions = {};
  reduce(sessions, claudeHook('e', 'UserPromptSubmit', 0));
  reduce(sessions, prompted('e', 7));
  reduce(sessions, claudeHook('e', 'StopFailure', 9));
  assert.deepEqual(needsOf(sessions['claude:e']), []);
});

test('a refused push is retried until accepted, and a backlog sends one push per tick', async () => {
  const sessions = {};
  reduce(sessions, hook('retry', 'SessionStart', 0));
  reduce(sessions, ask('retry', 1));
  const phone = emptyPhone();
  const client = fakeClient({ push: [{ ok: false, kind: 'transient', status: 500 }] });
  await send(sessions, phone, client, 2);
  await send(sessions, phone, client, 10);
  assert.deepEqual(pushes(client), ['push retry needs you', 'push retry needs you']);
  const many = {};
  for (let index = 0; index < 61; index += 1) {
    reduce(many, hook(`m${index}`, 'SessionStart', 0));
    reduce(many, ask(`m${index}`, 1));
  }
  const busy = fakeClient();
  await send(many, emptyPhone(), busy, 2);
  assert.equal(pushes(busy).length, 1);
});

test('a card the API refuses holds back neither the badge nor the pushes, and the board regrows when the capacity hint expires', async () => {
  const sessions = {};
  reduce(sessions, hook('alpha', 'SessionStart', 0, { cwd: '/w/a' }));
  const phone = emptyPhone();
  await send(sessions, phone, fakeClient(), 1);
  reduce(sessions, { ...ask('alpha', 2), cwd: '/w/a' });
  reduce(sessions, hook('beta', 'SessionStart', 3, { cwd: '/w/b' }));
  reduce(sessions, { ...ask('beta', 3), cwd: '/w/b' });
  const client = fakeClient({ [`put ${projectKeyOf(projectFrom('/w/a'))}`]: { ok: false, kind: 'capacity' } });
  await send(sessions, phone, client, 4);
  assert.deepEqual(client.calls.filter((call) => !call.startsWith('put') && !call.startsWith('end')), ['badge 2', 'push alpha needs you']);
  assert.ok(!client.calls.includes(`put ${projectKeyOf(projectFrom('/w/b'))}`));
  assert.equal(planBoard(viewsOf(sessions), phone, { now: T0 + 3_600_000, shippedToday: 0 }).cards.length, 2);
});

test('the daemon picks up a key stored after it started', async () => {
  let stored = null;
  const requests = [];
  const client = createClient({ getKey: () => stored, recheckMs: 0, fetchImpl: async (url) => (requests.push(url), new Response('{}', { status: 200 })) });
  assert.equal((await client.badge(1)).kind, 'no-key');
  stored = 'key';
  assert.equal((await client.badge(1)).ok, true);
  assert.equal(requests.length, 1);
});

test('the hook drops unattended runs and subagents, keeps no command text, reads plans and pushes, and trusts only a bare check run', () => {
  const repo = mkdtempSync(join(tmpdir(), 'pulse-repo-'));
  mkdirSync(join(repo, '.agents'));
  writeFileSync(join(repo, '.agents/pstack.json'), JSON.stringify({ check: 'bun check' }));
  const input = {
    hook_event_name: 'PostToolUse',
    session_id: 'abc',
    cwd: repo,
    tool_name: 'Bash',
    tool_input: { command: 'SECRET=hunter2 node .agents/pstack/decisions-check.mjs append docs/plans/x.decisions.tsv build a b c d && git push' },
    tool_response: { stdout: 'Appended 2 rows to docs/plans/x.decisions.tsv.\n', gitOperation: { commit: { sha: 'd7cc771' }, push: { branch: 'next' } } },
  };
  assert.equal(eventOf('claude', input, { CLAUDE_CODE_SESSION_ATTENDED: '0' }), null);
  assert.equal(eventOf('claude', { ...input, agent_id: 'sub' }, {}), null);
  const kept = eventOf('claude', input, { CLAUDE_PID: '42' });
  assert.deepEqual([kept.plans, kept.push, kept.pid], [[join(repo, 'docs/plans/x.decisions.tsv')], { branch: 'next', sha: 'd7cc771', cwd: repo }, 42]);
  assert.ok(!JSON.stringify(kept).includes('hunter2'));
  const run = (command) => eventOf('claude', { ...input, tool_input: { command }, tool_response: {} }, {}).check;
  assert.deepEqual([run('bun check --bail'), run('bun check 2>&1 | tail -5'), run('bun check && git push'), run('bun check\nfalse')], [{ ok: true }, null, null, null]);
});

test('Codex questions stay open through other work and each closes only on its own reply, across reads', () => {
  const rollout = join(mkdtempSync(join(tmpdir(), 'pulse-')), 'rollout.jsonl');
  const line = (payload) => `${JSON.stringify({ timestamp: at(5), payload })}\n`;
  const question = (id, title) => line({ type: 'function_call', name: 'request_user_input_async', call_id: id, arguments: JSON.stringify({ questions: [{ title, options: [] }] }) });
  const reply = (id) => line({ type: 'message', role: 'user', content: [{ type: 'input_text', text: `<send_user_message_question_reply>\n[{"questionItemId":"[\\"request_user_input_async\\",\\"${id}\\"]"}]` }] });
  const first = question('call_q1', 'Ship it?');
  writeFileSync(rollout, `${line({ type: 'message', role: 'assistant', content: 'Plan — ready' })}${first.slice(0, 40)}`);
  const sessions = {};
  reduce(sessions, { ...hook('01a11319-0000-7000-8000-000000000001', 'SessionStart', 0), runtime: 'codex', transcript: rollout });
  const [session] = Object.values(sessions);
  const read = () => reduce(sessions, { kind: 'rollout', runtime: 'codex', session: session.id, at: at(6), ...readRollout(rollout, session.cursor) });
  read();
  appendFileSync(rollout, `${first.slice(40)}${line({ type: 'function_call_output', call_id: 'call_q1', output: '{"accepted":true}' })}${line({ type: 'function_call', name: 'exec_command', call_id: 'call_x', arguments: '{}' })}${question('call_q2', 'Which branch?')}`);
  read();
  appendFileSync(rollout, reply('call_q1'));
  read();
  assert.deepEqual(Object.values(session.needs).map(({ question: text }) => text), ['Which branch?']);
});

test('install and uninstall touch only the pulse hook, keeping a sibling hook in the same group', () => {
  const settings = { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo pstack-pulse audit' }, { type: 'command', command: 'keep-me' }] }] } };
  const original = structuredClone(settings);
  const command = hookCommand('/usr/bin/node', '/x/pstack-pulse/scripts/hook.mjs', 'claude');
  withHook(settings, [['PreToolUse', 'AskUserQuestion'], ['Stop']], command);
  withHook(settings, [['PreToolUse', 'AskUserQuestion'], ['Stop']], command);
  assert.equal(Object.values(settings.hooks).flat().flatMap((group) => group.hooks).filter((each) => each.command === command).length, 2);
  assert.deepEqual(withoutHook(settings), original);
});

test('a resumed session shows again, and a live unanswered one outlives the stale timeout', () => {
  const sessions = {};
  reduce(sessions, hook('again', 'SessionStart', 0));
  reduce(sessions, hook('again', 'SessionEnd', 1));
  reduce(sessions, hook('again', 'SessionStart', 2, { source: 'resume' }));
  assert.equal(sessions['claude:again'].life, 'live');
  reduce(sessions, hook('waiting', 'SessionStart', 0));
  reduce(sessions, ask('waiting', 1));
  reduce(sessions, { kind: 'clock', at: at(25 * 3600) });
  assert.deepEqual([sessions['claude:waiting'].life, sessions['claude:waiting'].state], ['live', 'needs-you']);
});

test('a required check buzzes once at a quiet stop while it still fails, and clears when it passes', () => {
  const sessions = {};
  reduce(sessions, hook('loop', 'SessionStart', 0));
  reduce(sessions, hook('loop', 'PostToolUseFailure', 1, { check: { ok: false } }));
  reduce(sessions, hook('loop', 'PostToolUseFailure', 2, { check: { ok: false } }));
  reduce(sessions, hook('loop', 'PostToolUse', 3, { check: { ok: true } }));
  reduce(sessions, hook('loop', 'Stop', 4, { background: 0 }));
  reduce(sessions, hook('red', 'SessionStart', 0));
  reduce(sessions, hook('red', 'PostToolUseFailure', 1, { check: { ok: false } }));
  reduce(sessions, hook('red', 'Stop', 2, { background: 0 }));
  assert.deepEqual([...incidentsOf(viewsOf(sessions)).values()].map(({ title }) => title), ['red failed']);
  reduce(sessions, hook('red', 'PostToolUse', 3, { check: { ok: true } }));
  assert.equal(sessions['claude:red'].state, 'working');
});

test('a finished rail shows its last reached stage, counting skipped ones', () => {
  const rail = { stages: ['done', 'done', 'skipped', 'done', 'done', 'done', 'done', 'done', 'skipped', 'done'].map((state, index) => ({ label: `S${index + 1}`, state })) };
  assert.equal(stepOf(rail), 10);
});

test('the pet waits with a badge while a session needs you, jumps on a fresh ship, runs while work goes on and idles after', () => {
  const sessions = {};
  reduce(sessions, hook('busy', 'UserPromptSubmit', 0));
  reduce(sessions, ask('asking', 1));
  const waiting = petOf(viewsOf(sessions), T0 + 2000);
  assert.deepEqual([waiting.mood, waiting.badge, waiting.needs.map((need) => need.question)], ['waiting', 1, ['Ship asking?']]);
  reduce(sessions, hook('asking', 'PostToolUse', 3, { tool: 'AskUserQuestion', toolUseId: 'tu-asking-1' }));
  sessions['claude:busy'].ships.push({ id: 'ship-1', at: at(4), summary: 'repo next abc' });
  assert.equal(petOf(viewsOf(sessions), T0 + 6000).mood, 'jumping');
  assert.equal(petOf(viewsOf(sessions), T0 + 60_000).mood, 'running');
  reduce(sessions, hook('busy', 'Stop', 61));
  reduce(sessions, hook('asking', 'Stop', 61));
  assert.equal(petOf(viewsOf(sessions), T0 + 62_000).mood, 'idle');
});

test('the menubar keeps the fleet line and lists every live session ranked, and each one is a metric on its project phone card', () => {
  const sessions = {};
  ['/w/a', '/w/a', '/w/a', '/w/b', '/w/b', null].forEach((cwd, index) => reduce(sessions, hook(`s${index}`, 'UserPromptSubmit', index, { cwd })));
  reduce(sessions, { ...ask('s4', 10), cwd: '/w/b' });
  const context = { now: T0 + 11_000, shippedToday: 0 };
  const views = viewsOf(sessions);
  const menu = menuBoardOf(views, context);
  assert.deepEqual(menu.cards.map(({ state }) => state), ['needs-you', 'working', 'working', 'working', 'working', 'working']);
  const phoneCards = new Map(planBoard(views, emptyPhone(), context).cards);
  for (const row of menu.cards) {
    const view = views.find(({ session }) => keyOf(session) === row.key);
    const metrics = phoneCards.get(projectKeyOf(view.project)).body.content_state.metrics;
    assert.ok(metrics.some(({ value, color }) => value === view.title && color === row.content_state.color), view.title);
  }
  assert.equal(menu.fleet.content_state.title, 'pstack fleet');
});

test('a turn that ends with only artifact page sockets open goes idle, and one with a WebSocket monitor the model armed keeps working', () => {
  const sessions = {};
  const watch = { id: 'w1', type: 'monitor', status: 'running', description: 'live updates for artifact 1kmVRY8AvwRkf1KwqAuSxM (watch)' };
  const presence = { id: 'w2', type: 'monitor', status: 'running', description: 'presence on artifact https://claude.ai/artifact/1kmVRY8AvwRkf1KwqAuSxM' };
  const armed = { id: 'm1', type: 'monitor', status: 'running', description: 'deploy events' };
  reduce(sessions, claudeHook('watching', 'UserPromptSubmit', 0));
  reduce(sessions, claudeHook('watching', 'Stop', 1, { background_tasks: [watch, presence] }));
  assert.equal(sessions['claude:watching'].state, 'idle');
  reduce(sessions, claudeHook('building', 'UserPromptSubmit', 2));
  reduce(sessions, claudeHook('building', 'Stop', 3, { background_tasks: [watch, armed] }));
  assert.equal(sessions['claude:building'].state, 'working');
});

test('a turn that hands back a plan page pushes once that the session replied, without marking it as needing you', () => {
  const sessions = {};
  reduce(sessions, hook('pager', 'UserPromptSubmit', 0, { cwd: '/w/ellie', plans: ['/w/ellie/docs/plans/x.decisions.tsv'] }));
  reduce(sessions, hook('pager', 'PostToolUse', 1, { cwd: '/w/ellie', tool: 'Artifact', published: true }));
  reduce(sessions, hook('pager', 'Stop', 2, { cwd: '/w/ellie', lastMessage: 'Shipped the lean cards.\nDetails follow.' }));
  assert.equal(sessions['claude:pager'].state, 'idle');
  const incidents = [...incidentsOf(viewsOf(sessions)).values()];
  assert.deepEqual(incidents.map(({ kind, title, message }) => ({ kind, title, message })), [{ kind: 'replied', title: 'pager replied', message: 'Shipped the lean cards.' }]);
});
