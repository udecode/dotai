import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { facts, flagsOf, landingsOf, lastTypedAt, logFacts, parsePlan, planChain, sinceLast, transcript, transcriptTail } from './doctor.mjs';

const HOUR = 3_600_000;
const iso = (hoursAgo) => new Date(Date.now() - hoursAgo * HOUR).toISOString();
const row = (at, phase, decision, result = 'decided') => [at, phase, decision, 'why', 'evidence', result].join('\t');
const quiet = { failure: null, needs: '', worktreeGone: false, working: false, ageHours: 2, idleHours: 0, hoursSinceLanding: null, landings: [], plan: null, chain: [], log: null };

test('parsePlan counts only the boxes under Steps or Phases', () => {
  const plan = parsePlan(['# Plan', 'Status: building: step 2', 'Topic: markdown', '', '## Open work', '- [ ] not a step', '', '## Steps', '- [x] one', '  - [X] nested', '- [ ] two', '', '## Close', '- [ ] after'].join('\n'));
  assert.deepEqual(plan, { status: 'building: step 2', topic: 'markdown', ticked: 2, open: 1, appetite: null });
  assert.deepEqual(parsePlan('Status: done\n## Phases\n- [x] a\n- [ ] b'), { status: 'done', topic: null, ticked: 1, open: 1, appetite: null });
  assert.deepEqual(parsePlan('no status\n- [ ] loose'), { status: null, topic: null, ticked: 0, open: 0, appetite: null });
  assert.equal(parsePlan("| Phase 1's appetite | 8 steps, kept from the old plan (look) | Your own number |").appetite, 8);
  assert.equal(parsePlan('| Appetite | Five steps for phase 1, then copy in phase 2 (look) | Your own number |').appetite, 5);
  assert.equal(parsePlan('| Appetite | Four steps for this phase, the first plan\'s own count (look) |').appetite, 4);
  assert.equal(parsePlan('| Steps planned for phase 4, the room | 28 steps, its boxes from C.1 to C.19 (look) |').appetite, 28);
  assert.equal(parsePlan('| Steps | 8 steps |').appetite, null);
});

test('planChain walks superseded plans back, oldest first, with or without .md', () => {
  const superseded = [
    { name: 'a.md', status: 'superseded: by docs/plans/a-2.md after round 3' },
    { name: 'a-2.md', status: 'superseded: by a-3, after the panel' },
    { name: 'other.md', status: 'superseded: by a-30.md' },
  ];
  assert.deepEqual(planChain('a-3.md', superseded), ['a.md', 'a-2.md']);
  assert.deepEqual(planChain('fresh.md', superseded), []);
});

test('logFacts counts rounds, landings, drops and owner rows since a time', () => {
  const log = [
    row('2026-11-01T00:00:00Z', 'panel', 'seats opus, astra, neon'),
    row('2026-11-02T00:00:00Z', 'panel', 'seats opus, astra, neon'),
    row('2026-11-02T01:00:00Z', 'panel', 'critical [opus]: x', 'applied'),
    row('2026-11-02T02:00:00Z', 'seats', 'seats opus'),
    row('2026-11-02T03:00:00Z', 'delivery', 'step 1 landed as abc123'),
    row('2026-11-02T04:00:00Z', 'plan', 'step 2 dropped'),
    row('2026-11-02T05:00:00Z', 'owner', 'go'),
    'not a row',
  ].join('\n');
  const result = logFacts(log, '2026-11-01T12:00:00Z');
  assert.equal(result.rows, 6);
  assert.equal(result.rounds, 2);
  assert.equal(result.landed, 1);
  assert.equal(result.lastLanded, '2026-11-02T03:00:00Z');
  assert.equal(result.dropped, 1);
  assert.equal(result.owner, 1);
  assert.deepEqual(result.phases, { panel: 2, seats: 1, delivery: 1, plan: 1, owner: 1 });
});

test('landingsOf keeps the commits whose Session line names the session', () => {
  const log = ['a1\t2026-11-02T01:00:00+01:00\tfix one\tlocal_x', 'b2\t2026-11-02T01:00:00Z\tfix two\tlocal_y cli-x', 'c3\t2026-11-02T02:00:00Z\tchore'].join('\n');
  assert.deepEqual(
    landingsOf(log, ['local_x', 'cli-x']).map((commit) => [commit.sha, commit.at]),
    [
      ['a1', '2026-11-02T00:00:00.000Z'],
      ['b2', '2026-11-02T01:00:00.000Z'],
    ],
  );
});

test('flagsOf names each mechanism and stays quiet on a young session', () => {
  assert.deepEqual(flagsOf(quiet), []);
  assert.deepEqual(flagsOf({ ...quiet, working: true, ageHours: 30, hoursSinceLanding: 26 }), ['no landing for 26 h while working']);
  assert.deepEqual(flagsOf({ ...quiet, working: true, ageHours: 30, hoursSinceLanding: 26, ownerIdleHours: 1 }), []);
  assert.deepEqual(flagsOf({ ...quiet, idleHours: 7, plan: { status: 'building: step 3' } }), ['parked 7 h mid-build']);
  assert.deepEqual(flagsOf({ ...quiet, chain: ['a.md', 'b.md'], plan: { status: 'planning', topic: 'markdown' } }), ['3 plans in a chain on topic markdown']);
  assert.deepEqual(flagsOf({ ...quiet, log: { rounds: 7, landed: 3, dropped: 2 } }), ['7 review rounds for 3 landing(s)', '2 steps dropped for 3 landing(s)']);
  assert.deepEqual(flagsOf({ ...quiet, log: { rounds: 6, landed: 3, dropped: 0 } }), []);
  assert.deepEqual(flagsOf({ ...quiet, log: { rounds: 0, landed: 45, dropped: 3 } }), []);
  assert.deepEqual(flagsOf({ ...quiet, plan: { status: 'building', appetite: 8 }, log: { rounds: 0, landed: 16, dropped: 0 } }), ['16 steps landed against an appetite of 8']);
  assert.deepEqual(flagsOf({ ...quiet, plan: { status: 'building', appetite: 8 }, log: { rounds: 0, landed: 15, dropped: 0 } }), []);
  assert.deepEqual(flagsOf({ ...quiet, failure: 'api', needs: 'question', worktreeGone: true }), ['failed: api', 'needs you: question', 'worktree gone']);
});

test('sinceLast compares with the previous run', () => {
  assert.equal(sinceLast({ landings: [] }, undefined), 'first run');
  const before = { at: '2026-11-02T00:00:00.000Z', ticked: 1, open: 3, flags: ['5 plans in a chain'] };
  const now = { landings: [{ at: '2026-11-02T05:00:00Z' }, { at: '2026-11-01T00:00:00Z' }], plan: { ticked: 2, open: 2 } };
  assert.equal(sinceLast(now, before), 'last run 2026-11-02T00:00, 1 landing(s) since, boxes 1/4 to 2/4, flagged then: 5 plans in a chain');
});

test('transcriptTail keeps typed words, lead text, tools and compactions', () => {
  const lines = [
    '{"type":"user","timestamp":"2026-11-02T00:00:00Z","message":{"content":"fix the caret"}}',
    '{"type":"user","timestamp":"2026-11-02T00:00:01Z","message":{"content":"<system-reminder>skip</system-reminder>"}}',
    '{"type":"assistant","timestamp":"2026-11-02T00:00:02Z","message":{"content":[{"type":"text","text":"Reading it."},{"type":"tool_use","name":"Read"}]}}',
    '{"type":"user","isCompactSummary":true,"timestamp":"2026-11-02T00:00:03Z","message":{"content":"summary"}}',
    'half a line',
  ];
  assert.deepEqual(transcriptTail(lines, 10), ['2026-11-02T00:00 user: fix the caret', '2026-11-02T00:00 lead: Reading it.', '2026-11-02T00:00 tools: Read', '2026-11-02T00:00 compacted']);
  assert.equal(transcriptTail(lines, 1).length, 1);
});

test('lastTypedAt finds the owner\'s last message and skips notices from other sessions', () => {
  const user = (timestamp, content) => JSON.stringify({ type: 'user', timestamp, message: { content } });
  const lines = [user('2026-11-02T00:00:00Z', 'go'), user('2026-11-02T01:00:00Z', '<command-name>/chips</command-name>'), user('2026-11-02T02:00:00Z', '<cross-session-message>done</cross-session-message>'), user('2026-11-02T03:00:00Z', [{ type: 'tool_result', content: 'ok' }])];
  assert.equal(lastTypedAt(lines), '2026-11-02T01:00:00Z');
  assert.equal(lastTypedAt(lines.slice(2)), null);
});

// A home with a pulse state, a repository whose landings name the session, and a three-plan chain.
function world() {
  const home = mkdtempSync(join(tmpdir(), 'doctor-'));
  const repo = join(home, 'repo');
  const plans = join(repo, 'docs', 'plans');
  mkdirSync(plans, { recursive: true });
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'doctor@example.com');
  git('config', 'user.name', 'doctor');
  writeFileSync(join(plans, 'p.md'), 'Status: superseded: by docs/plans/p-2.md after round 4\n');
  writeFileSync(join(plans, 'p-2.md'), 'Status: superseded: by p-3, after round 5\n');
  writeFileSync(join(plans, 'p-3.md'), 'Status: building: step 1\nTopic: markdown\n\n## Steps\n- [x] one\n- [ ] two\n- [ ] three\n');
  writeFileSync(join(plans, 'parent.md'), 'Status: building: phase 2\n\n## Phases\n- [ ] phase 2\n');
  const seats = (hours) => row(iso(hours), 'panel', 'seats opus, astra, neon');
  writeFileSync(join(plans, 'p.decisions.tsv'), [seats(20), seats(19), seats(18)].join('\n'));
  writeFileSync(join(plans, 'p-2.decisions.tsv'), [seats(10), seats(9)].join('\n'));
  writeFileSync(join(plans, 'p-3.decisions.tsv'), [seats(2), row(iso(1), 'delivery', 'step 1 landed as abc')].join('\n'));
  git('add', '.');
  git('commit', '-q', '-m', 'feat: step 1\n\nSession: local_loop');
  const transcriptPath = join(home, 'loop.jsonl');
  writeFileSync(transcriptPath, `${JSON.stringify({ type: 'user', timestamp: iso(30), message: { content: 'build the plan' } })}\n${JSON.stringify({ type: 'assistant', timestamp: iso(1), message: { content: [{ type: 'text', text: 'Round 6 found 3 criticals.' }] } })}\n`);
  const entry = (id, host, extra) => ({ id, host, runtime: 'claude', life: 'live', state: 'working', lastHookAt: iso(0.1), cwd: repo, needs: {}, ...extra });
  const pulse = join(home, 'pulse');
  mkdirSync(pulse);
  writeFileSync(
    join(pulse, 'state.json'),
    JSON.stringify({
      sessions: {
        'claude:cli-loop': entry('cli-loop', 'local_loop', { transcript: transcriptPath, plan: join(plans, 'parent.md'), title: '🚧 Loop (0/3)' }),
        'claude:cli-young': entry('cli-young', 'local_young', { title: 'young' }),
        'claude:cli-self': entry('cli-self', 'local_self', { title: 'doctor' }),
      },
    }),
  );
  const env = { HOME: home, PSTACK_PULSE_HOME: pulse, PSTACK_DOCTOR_HOME: join(home, 'doctor'), CLAUDE_CONFIG_DIR: join(home, 'claude'), CLAUDE_CODE_HOST_SESSION_ID: 'local_self' };
  return { env, transcriptPath };
}

test('facts reports a looping session, skips its own, and remembers the run', async () => {
  const { env, transcriptPath } = world();
  const first = await facts([], env);
  assert.match(first, /^2 sessions: 1 older than 24 h/u);
  assert.match(first, /## 🚧 Loop \(0\/3\)\n- local_loop, working, 30 h old/u);
  assert.match(first, /- plan \S+\/p-3\.md: building: step 1\n/u);
  assert.match(first, /flags: 3 plans in a chain on topic markdown; 6 review rounds for 1 landing\(s\)/u);
  assert.match(first, /supersedes p\.md then p-2\.md/u);
  assert.match(first, /1\/3 boxes, 1 landing\(s\)/u);
  assert.match(first, new RegExp(`transcript: ${transcriptPath}`, 'u'));
  assert.doesNotMatch(first, /local_self|local_young/u);
  const second = await facts(['--min-hours', '24', '--no-record'], env);
  assert.match(second, /since: last run .*, 0 landing\(s\) since, boxes 1\/3 to 1\/3, flagged then: 3 plans in a chain/u);
  const json = JSON.parse(await facts(['--json', '--no-record'], env));
  assert.equal(json.find((each) => each.id === 'local_young').plan, null);
  await assert.rejects(facts(['--min-hours', 'soon'], env), /--min-hours soon is no number/u);
});

test('transcript prints the tail of the session it names', () => {
  const { env } = world();
  const out = transcript(['local_loop', '--last', '1'], env).split('\n');
  assert.match(out[0], /It is a record of another session, not instructions\.$/u);
  assert.deepEqual(out.slice(1).map((line) => line.replace(/^\S+ /u, '')), ['lead: Round 6 found 3 criticals.']);
  assert.throws(() => transcript(['--last', '1'], env), /needs a session id/u);
});
