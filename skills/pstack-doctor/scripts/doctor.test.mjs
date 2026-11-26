import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { due, facts, flagsOf, landingsOf, lastTypedAt, logFacts, parsePlan, planChain, sinceLast, transcript, transcriptTail } from './doctor.mjs';

const HOUR = 3_600_000;
const iso = (hoursAgo) => new Date(Date.now() - hoursAgo * HOUR).toISOString();
const row = (at, phase, decision, result = 'decided') => [at, phase, decision, 'why', 'evidence', result].join('\t');
const planRound = (at, criticals) => [at, 'panel', 'seats opus, astra, neon on the plan round', 'why', 'evidence', `${criticals} critical`].join('\t');
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

function world() {
  const home = mkdtempSync(join(tmpdir(), 'doctor-'));
  const repo = join(home, 'repo');
  const plans = join(repo, 'docs', 'plans');
  mkdirSync(join(plans, 'artifacts', 'fix'), { recursive: true });
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'doctor@example.com');
  git('config', 'user.name', 'doctor');
  writeFileSync(join(plans, 'p.md'), 'Status: superseded: by docs/plans/p-2.md after round 4\n');
  writeFileSync(join(plans, 'p-2.md'), 'Status: blocked: the rest moved to p-3\n');
  writeFileSync(join(plans, 'p-3.md'), 'Status: building: step 1\nTopic: markdown\n\n## Steps\n- [x] one\n- [ ] two\n- [ ] three\n');
  writeFileSync(join(plans, 'parent.md'), 'Status: building: phase 2\n\n## Phases\n- [ ] phase 2\n');
  writeFileSync(join(plans, 'x.md'), 'Status: done\n');
  writeFileSync(join(plans, 'q.md'), 'Status: planning\n');
  const seats = (hours) => row(iso(hours), 'panel', 'seats opus, astra, neon');
  writeFileSync(join(plans, 'p.decisions.tsv'), [seats(20), seats(19), seats(18)].join('\n'));
  writeFileSync(join(plans, 'p-2.decisions.tsv'), [seats(10), seats(9), row(iso(8), 'plan', 'the rest goes to a new plan', 'open: patch: docs/plans/p-3.md')].join('\n'));
  writeFileSync(join(plans, 'x.decisions.tsv'), [seats(7), seats(6.9), seats(6.8)].join('\n'));
  writeFileSync(join(plans, 'artifacts', 'fix', 'fix.decisions.tsv'), [planRound(iso(4), 4), planRound(iso(3.9), 5), row(iso(3.8), 'plan', 'fix moves into p-3', 'open: patch: docs/plans/p-3.md')].join('\n'));
  writeFileSync(join(plans, 'p-3.decisions.tsv'), [planRound(iso(2.5), 2), planRound(iso(2), 3), row(iso(1.5), 'plan', 'x comes back', 'open: patch: other/plans/x.md'), row(iso(1.2), 'plan', 'q splits off', 'open: patch: docs/plans/q.md'), row(iso(1), 'delivery', 'step 1 landed as abc')].join('\n'));
  git('add', '.');
  git('commit', '-q', '-m', 'feat: step 1\n\nSession: local_loop');
  const worktree = join(home, 'worktree');
  git('worktree', 'add', '-q', '--detach', worktree);
  appendFileSync(join(plans, 'p-3.decisions.tsv'), `\n${row(iso(0.5), 'delivery', 'step 2 landed as def')}`);
  const transcriptPath = join(home, 'loop.jsonl');
  writeFileSync(transcriptPath, `${JSON.stringify({ type: 'user', timestamp: iso(30), message: { content: 'build the plan' } })}\n${JSON.stringify({ type: 'assistant', timestamp: iso(1), message: { content: [{ type: 'text', text: 'Round 6 found 3 criticals.' }] } })}\n`);
  const entry = (id, host, extra) => ({ id, host, runtime: 'claude', life: 'live', state: 'working', lastHookAt: iso(0.1), cwd: worktree, needs: {}, ...extra });
  const pulse = join(home, 'pulse');
  mkdirSync(pulse);
  writeFileSync(
    join(pulse, 'state.json'),
    JSON.stringify({
      sessions: {
        'claude:cli-loop': entry('cli-loop', 'local_loop', { transcript: transcriptPath, plan: join(worktree, 'docs', 'plans', 'parent.md'), title: '🚧 Loop (0/3)' }),
        'claude:cli-young': entry('cli-young', 'local_young', { title: 'young' }),
        'claude:cli-self': entry('cli-self', 'local_self', { title: 'doctor' }),
      },
    }),
  );
  const env = { HOME: home, PSTACK_PULSE_HOME: pulse, PSTACK_DOCTOR_HOME: join(home, 'doctor'), CLAUDE_CONFIG_DIR: join(home, 'claude'), CLAUDE_CODE_HOST_SESSION_ID: 'local_self' };
  return { env, transcriptPath };
}

const reportFlags = (report) => report.match(/- flags: (.*)\n/u)[1].split('; ');

test('facts follows a topic through superseded Status lines and patch: links, and lists only the plans before its own', async () => {
  const report = await facts(['--no-record'], world().env);
  assert.equal(reportFlags(report)[0], '3 plans in a chain on topic markdown');
  assert.match(report, /earlier plans on its topic: p\.md then p-2\.md\n/u);
});

test('facts skips a log that only a patch: path in another project names', async () => {
  assert.equal(reportFlags(await facts(['--no-record'], world().env))[1], '9 review rounds for 2 landing(s)');
});

test("facts reads the logs in the plans folder's run folders, and the main checkout's rows a worktree copy lacks", async () => {
  const report = await facts(['--no-record'], world().env);
  assert.deepEqual(reportFlags(report).slice(2).sort(), ['plan round 2 of fix found 5 critical findings, no fewer than the 4 of the round before', 'plan round 2 of p-3 found 3 critical findings, no fewer than the 2 of the round before']);
  assert.match(report, /log since start: 15 rows, 2 landed rows/u);
});

test('facts reports a looping session, skips its own, and remembers the run', async () => {
  const { env, transcriptPath } = world();
  const first = await facts([], env);
  assert.match(first, /^2 sessions: 1 older than 24 h/u);
  assert.match(first, /## 🚧 Loop \(0\/3\)\n- local_loop, working, 30 h old/u);
  assert.match(first, /- plan \S+\/worktree\/docs\/plans\/p-3\.md: building: step 1\n/u);
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

test('facts lists as earlier plans only those that lead to its own, from superseded Status lines in either checkout and patch: links, even when their rows share a second', async () => {
  const { env } = world();
  writeFileSync(join(env.HOME, 'repo', 'docs', 'plans', 'p0.md'), 'Status: superseded: by p.md\n');
  for (const root of ['repo', 'worktree']) {
    const plansDir = join(env.HOME, root, 'docs', 'plans');
    const opening = readFileSync(join(plansDir, 'p-2.decisions.tsv'), 'utf8').trim().split('\n').at(-1);
    writeFileSync(join(plansDir, 'p-2.decisions.tsv'), `${opening}\n`);
    writeFileSync(join(plansDir, 'q.md'), 'Status: superseded: by q-2.md\n');
    writeFileSync(join(plansDir, 'q-2.md'), 'Status: planning\n');
    writeFileSync(join(plansDir, 'q.decisions.tsv'), `${row(iso(1), 'plan', 'q moves on', 'open: patch: docs/plans/q-2.md')}\n`);
  }
  assert.match(await facts(['--no-record'], env), /earlier plans on its topic: p0\.md then p\.md then p-2\.md\n/u);
});

test('facts --self reports only the session running it, in full detail, whatever its age', async () => {
  const { env } = world();
  const report = await facts(['--self', '--no-record'], env);
  assert.match(report, /^1 sessions: /u);
  assert.match(report, /## doctor\n- local_self, working, .*\n- flags: none\n/u);
  assert.doesNotMatch(report, /local_loop|local_young/u);
  await assert.rejects(facts(['--self', '--no-record'], { ...env, CLAUDE_CODE_HOST_SESSION_ID: undefined }), /--self needs/u);
});

const stampOf = (iso) => iso.replace(/\.\d{3}Z$/u, 'Z');
const appended = (count, printed) => `${count > 1 ? `Appended ${count} rows to ${printed}.` : `Appended a row to ${printed}.`}\nLead: claude-opus-5-5 @high.`;

function topic() {
  const home = mkdtempSync(join(tmpdir(), 'doctor due '));
  const repo = join(home, 'repo');
  const plans = join(repo, 'docs', 'plans');
  mkdirSync(plans, { recursive: true });
  execFileSync('git', ['-C', repo, 'init', '-q', '-b', 'main']);
  let clock = Date.now() - 6 * HOUR;
  const next = (seconds) => new Date((clock += seconds * 1000)).toISOString();
  const transcriptPath = join(home, 'session.jsonl');
  const events = [];
  const logs = new Map();
  let calls = 0;
  let start = { type: 'system', cwd: repo };
  const fileOf = (name) => (name.includes('/') ? name : join(plans, name));
  const add = (name, at, [phase, decision, result = 'decided', evidence = 'evidence']) => logs.set(fileOf(name), [...(logs.get(fileOf(name)) ?? []), [stampOf(at), phase, decision, 'why', evidence, result].join('\t')]);
  const batch = (name, rows) => {
    const at = next(1);
    for (const each of rows) {
      if (each.alongside) add(each.alongside, at, each.row);
      else add(name, at, each);
    }
    return rows.filter((each) => !each.alongside).length;
  };
  const bash = (command, run) => {
    const id = `toolu_${(calls += 1)}`;
    events.push({ type: 'assistant', timestamp: next(30), message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } });
    const output = run();
    events.push({ type: 'user', timestamp: next(1), message: { content: [{ type: 'tool_result', tool_use_id: id, content: output }] } });
  };
  const appendCommand = (name) => `tail -3 docs/plans/b.decisions.tsv; L=${fileOf(name)}; node .agents/pstack/decisions-check.mjs append "$L" --from queue.tsv`;
  const codexEvent = (seconds, payload) => events.push({ timestamp: next(seconds), type: 'response_item', payload });
  const world = {
    home,
    repo,
    plans,
    transcriptPath,
    env: { HOME: home, PSTACK_DOCTOR_HOME: join(home, 'doctor') },
    stop: (extra) => JSON.stringify({ transcript_path: transcriptPath, cwd: repo, stop_hook_active: false, ...extra }),
    startIn(dir) {
      start = { type: 'system', cwd: dir };
      return world;
    },
    theirs(name, ...rows) {
      for (const each of rows) add(name, next(30), each);
      return world;
    },
    ours(name, ...rows) {
      bash(appendCommand(name), () => appended(batch(name, rows), fileOf(name)));
      return world;
    },
    oursPrinting(printed, name, ...rows) {
      bash(appendCommand(name), () => appended(batch(name, rows), printed));
      return world;
    },
    reads(...rows) {
      bash("rg -n 'decisions-check.mjs append' notes.md", () => {
        batch(null, rows);
        return 'notes.md:3: node .agents/pstack/decisions-check.mjs append log --from queue.tsv';
      });
      return world;
    },
    said(content) {
      events.push({ type: 'user', timestamp: next(30), message: { content } });
      return world;
    },
    queued(prompt, kind = 'human') {
      events.push({ type: 'attachment', timestamp: next(30), attachment: { type: 'queued_command', prompt, origin: { kind } } });
      return world;
    },
    refused(words) {
      const id = `toolu_${(calls += 1)}`;
      events.push({ type: 'assistant', timestamp: next(30), message: { content: [{ type: 'tool_use', id, name: 'Edit', input: {} }] } });
      const content = `The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). To tell you how to proceed, the user said:\n${words}`;
      events.push({ type: 'user', timestamp: next(30), message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: true, content }] } });
      return world;
    },
    ask(question, answer, notes) {
      const id = `toolu_${(calls += 1)}`;
      events.push({ type: 'assistant', timestamp: next(30), message: { content: [{ type: 'tool_use', id, name: 'AskUserQuestion', input: { questions: [{ question }] } }] } });
      const toolUseResult = { questions: [{ question }], answers: { [question]: answer }, annotations: notes ? { [question]: { notes } } : {} };
      events.push({ type: 'user', timestamp: next(30), toolUseResult, message: { content: [{ type: 'tool_result', tool_use_id: id, content: `Your questions have been answered: "${question}"="${answer}"` }] } });
      return world;
    },
    codexStartIn(dir = repo) {
      start = { type: 'session_meta', payload: { cwd: dir } };
      return world;
    },
    codex(name, ...rows) {
      const call_id = `call_${(calls += 1)}`;
      const argv = ['node', '.agents/pstack/decisions-check.mjs', 'append', fileOf(name), '--from', 'queue.tsv'];
      const item = calls % 2 ? { type: 'function_call', name: 'shell', call_id, arguments: JSON.stringify({ command: ['bash', '-lc', argv.join(' ')] }) } : { type: 'custom_tool_call', name: 'exec', call_id, input: `await tools.exec(${JSON.stringify(argv)});` };
      codexEvent(30, item);
      const output = appended(batch(name, rows), fileOf(name));
      codexEvent(1, { type: `${item.type}_output`, call_id, output });
      return world;
    },
    codexYielded(name, ...rows) {
      const call_id = `call_${(calls += 1)}`;
      codexEvent(30, { type: 'function_call', name: 'exec_command', call_id, arguments: JSON.stringify({ cmd: `node .agents/pstack/decisions-check.mjs append ${fileOf(name)} --from queue.tsv` }) });
      codexEvent(1, { type: 'function_call_output', call_id, output: 'Process running with session ID 42' });
      const count = batch(name, rows);
      const poll = `call_${(calls += 1)}`;
      codexEvent(5, { type: 'function_call', name: 'write_stdin', call_id: poll, arguments: JSON.stringify({ session_id: 42, chars: '' }) });
      codexEvent(1, { type: 'function_call_output', call_id: poll, output: { content: appended(count, fileOf(name)) } });
      return world;
    },
    codexSaid(...texts) {
      codexEvent(30, { type: 'message', role: 'user', content: texts.map((each) => ({ type: 'input_text', text: each })) });
      return world;
    },
    codexUserMessage(message) {
      events.push({ timestamp: next(30), type: 'event_msg', payload: { type: 'user_message', message } });
      return world;
    },
    codexCard(question, label) {
      const call_id = `call_${(calls += 1)}`;
      codexEvent(30, { type: 'function_call', name: 'request_user_input', call_id, arguments: JSON.stringify({ questions: [{ id: 'q1', header: 'Plan', question, options: [{ label, description: 'the narrowed plan' }] }] }) });
      codexEvent(30, { type: 'function_call_output', call_id, output: JSON.stringify({ answers: { q1: { answers: [label] } } }) });
      return world;
    },
    codexReply(question, answer) {
      const text = `<send_user_message_question_reply>\n${JSON.stringify([{ questionItemId: 'q1', question, answer }])}\n</send_user_message_question_reply>\n`;
      return world.codexSaid(text);
    },
    save() {
      for (const [file, rows] of logs) writeFileSync(file, `${rows.join('\n')}\n`);
      const first = { ...start, timestamp: new Date(Date.now() - 7 * HOUR).toISOString() };
      writeFileSync(transcriptPath, [first, ...events].map((event) => JSON.stringify(event)).join('\n'));
      return world;
    },
  };
  return world;
}

const plan = (result) => ['panel', 'seats opus, astra, neon on the plan round', result];
const diff = (result) => ['panel', 'seats opus, astra, neon on the diff round', result];
const onStep = (step, result) => ['panel', 'seats opus, astra, neon', result, `scope: the step's diff; reviewed step: ${step}`];
const seats = (why, result, evidence = 'evidence') => ['panel', `seats: seat: claude-opus-5-5 @high; ${why}`, result, evidence];
const owner = (decision) => ['owner', decision];
const alongside = (name, row) => ({ alongside: name, row });
const findings = (out) => out.split('\n').filter((line) => line.startsWith('- '));
const timeless = (lines) => lines.map((line) => line.replace(/ at \S+ /u, ' at <time> '));
const dueOf = (world, cwd = world.repo) => due(['--transcript', world.transcriptPath, '--cwd', cwd], world.env, '').then(findings);
const stalled = () => topic().ours('a.decisions.tsv', plan('5 critical'), plan('5 critical')).save();
const worktreeOf = (world) => {
  execFileSync('git', ['-C', world.repo, '-c', 'user.email=doctor@example.com', '-c', 'user.name=doctor', 'commit', '-q', '--allow-empty', '-m', 'base']);
  const worktree = join(world.home, 'worktree');
  execFileSync('git', ['-C', world.repo, 'worktree', 'add', '-q', '--detach', worktree]);
  mkdirSync(join(worktree, 'docs', 'plans'), { recursive: true });
  return worktree;
};

test('due blocks a stop once for a round this session logged that found no fewer criticals than the round of its kind before, and names the plans that patch: links and superseded Status lines join to its topic', async () => {
  const world = topic();
  writeFileSync(join(world.plans, 'a0.md'), 'Status: superseded by docs/plans/a.md\n');
  writeFileSync(join(world.plans, 'a.md'), 'Status: blocked\n');
  writeFileSync(join(world.plans, 'b.md'), 'Status: planning\n');
  world.theirs('a0.decisions.tsv', ['plan', 'a0 starts']);
  world.theirs('a.decisions.tsv', plan('5 critical'));
  world.ours('a.decisions.tsv', plan('6 critical'), ['plan', 'the rest goes to a new plan', 'open: patch: docs/plans/b.md']);
  world.ours('b.decisions.tsv', plan('4 critical')).save();
  const block = JSON.parse(await due(['--hook'], world.env, world.stop()));
  assert.equal(block.decision, 'block');
  assert.deepEqual(findings(block.reason).slice(0, -1), ['- plan round 2 of a found 6 critical findings, no fewer than the 5 of the round before.']);
  assert.match(block.reason, /- Plans on that topic, oldest first: a0, a, b\.\n/u);
  assert.match(block.reason, /test it with a probe or search before another round or step/u);
  assert.doesNotMatch(block.reason, /Second plan rule's stop still waits/u);
  assert.equal(await due(['--hook'], world.env, world.stop()), '');
});

test('due blocks each stalled round once, rounds that one batch logged in the same second included, and blocks again for a later round', async () => {
  const world = topic().ours('a.decisions.tsv', plan('5 critical'), plan('5 critical'), plan('6 critical')).save();
  const first = JSON.parse(await due(['--hook'], world.env, world.stop()));
  assert.deepEqual(findings(first.reason), ['- plan round 2 of a found 5 critical findings, no fewer than the 5 of the round before.', '- plan round 3 of a found 6 critical findings, no fewer than the 5 of the round before.']);
  assert.equal(await due(['--hook'], world.env, world.stop()), '');
  world.ours('a.decisions.tsv', plan('6 critical')).save();
  assert.deepEqual(findings(JSON.parse(await due(['--hook'], world.env, world.stop())).reason), ['- plan round 4 of a found 6 critical findings, no fewer than the 6 of the round before.']);
});

test("due judges only the rows that this session's append calls report writing, to the logs their output names, wherever the command ran", async () => {
  const world = topic();
  world.theirs('b.decisions.tsv', diff('9 critical'));
  world.oursPrinting('docs/plans/a.decisions.tsv', 'a.decisions.tsv', plan('5 critical'), alongside('b.decisions.tsv', diff('10 critical')));
  world.reads(alongside('b.decisions.tsv', diff('11 critical')), alongside('c.decisions.tsv', owner('second plan: "never typed" picks c')));
  world.theirs('a.decisions.tsv', owner('second plan: "never typed" picks d'));
  world.ours('a.decisions.tsv', alongside('a.decisions.tsv', owner('second plan: "never typed" picks e')), ['plan', 'a waits on its fixes']);
  world.ours('a.decisions.tsv', plan('5 critical')).save();
  assert.deepEqual(await dueOf(world), ['- plan round 2 of a found 5 critical findings, no fewer than the 5 of the round before']);
  assert.equal(await due(['--hook'], world.env, JSON.stringify({ transcript_path: join(world.home, 'other.jsonl'), cwd: world.repo })), '');
});

test('due compares a diff round only with the last round on its step, from its reviewed step: evidence or else the last built step, and never with a round that found none', async () => {
  const world = topic();
  world
    .ours(
      'a.decisions.tsv',
      ['delivery', 'built: step 1'],
      onStep('1', '3 critical'),
      onStep('1', '2 critical'),
      ['delivery', 'built: step 2'],
      onStep('2', '4 critical'),
      diff('2 critical'),
      ['delivery', 'built: step 3'],
      diff('2 critical'),
      plan('0 critical'),
      plan('0 critical'),
      onStep('2', '4 critical'),
    )
    .save();
  assert.deepEqual(await dueOf(world), ['- diff round 3 of step 2 of a found 4 critical findings, no fewer than the 2 of the round before']);
});

test('due tells steps apart by the step a round row names, so the first reviews of two steps are never compared', async () => {
  const world = topic()
    .ours(
      'a.decisions.tsv',
      ['delivery', 'built: step 9b'],
      ['delivery', 'built: step 9c'],
      seats("round 1 on step 9b's diff", '5 critical'),
      seats("round 1 on step 9c's diff", '8 critical'),
      seats('round 2', '7 critical', "scope: the step's diff; reviewed step: 9b"),
      ['delivery', 'built: phase 3'],
      seats('round 1', '2 critical'),
      seats('round 2', '2 critical'),
    )
    .save();
  assert.deepEqual(await dueOf(world), ['- diff round 2 of step 9b of a found 7 critical findings, no fewer than the 5 of the round before', '- diff round 2 of a found 2 critical findings, no fewer than the 2 of the round before']);
});

test('due counts the critical rows a round logged over the count its result states, and reads plural criticals', async () => {
  const critical = ['panel', 'critical [opus]: the caret jumps', 'applied'];
  const world = topic().ours('a.decisions.tsv', plan('2 criticals, 1 warning'), plan('1 critical, 3 warnings'), critical, critical, critical).save();
  assert.deepEqual(await dueOf(world), ['- plan round 2 of a found 3 critical findings, no fewer than the 2 of the round before']);
});

test("due takes a round's kind from its plan round or diff round label, else from whether the log built anything before it, and leaves a round whose result states several counts uncompared", async () => {
  const world = topic()
    .ours(
      'a.decisions.tsv',
      seats('round 1 on the finished plan', '2 critical'),
      seats('round 2, which earns one more round on the diff of its fixes', '3 critical'),
      ['delivery', 'built: phase 1'],
      plan('3 critical'),
      seats('the plan round fixes get a diff round', '3 critical'),
      seats('round 1 on the diff', 'recorded: opus 1 critical, astra 2 criticals'),
      seats('round 2 on the diff', '3 critical; the seats reran the 2 critical cases of round 1 and found them fixed'),
      seats('round 3 on the diff', '4 critical'),
    )
    .save();
  assert.deepEqual(await dueOf(world), ['- plan round 2 of a found 3 critical findings, no fewer than the 2 of the round before']);
});

test('due stays quiet for a stop the hook already blocked and for a read-only seat, but checks a stop that waits on background work', async () => {
  const world = stalled();
  assert.equal(await due(['--hook'], world.env, world.stop({ stop_hook_active: true })), '');
  assert.equal(await due(['--hook'], { ...world.env, PSTACK_READ_ONLY: '1' }, world.stop()), '');
  assert.equal(JSON.parse(await due(['--hook'], world.env, world.stop({ background_tasks: [{ id: 'b1' }], session_crons: [{ id: 'c1' }] }))).decision, 'block');
});

test('due finds the plans from the folder the transcript starts in, even a subfolder of a worktree, whatever the project dir and the stop say', async () => {
  const world = topic();
  const worktree = worktreeOf(world);
  world
    .startIn(join(worktree, 'docs'))
    .ours(join(worktree, 'docs', 'plans', 'a.decisions.tsv'), plan('5 critical'), plan('5 critical'))
    .save();
  const elsewhere = mkdtempSync(join(tmpdir(), 'elsewhere-'));
  assert.equal(JSON.parse(await due(['--hook'], { ...world.env, CLAUDE_PROJECT_DIR: world.repo }, world.stop({ cwd: elsewhere }))).decision, 'block');
});

test('due claims no finding when the topic lookup fails, so the next stop still blocks', async () => {
  const world = stalled();
  const unreadable = join(world.plans, 'z.decisions.tsv');
  writeFileSync(unreadable, '');
  chmodSync(unreadable, 0o000);
  await assert.rejects(due(['--hook'], world.env, world.stop()), /EACCES/u);
  chmodSync(unreadable, 0o644);
  assert.equal(JSON.parse(await due(['--hook'], world.env, world.stop())).decision, 'block');
});

test('the due hook runs through a symlink in a folder whose name has a space, and lets the stop go when it fails', () => {
  const world = stalled();
  const link = join(world.home, 'skills', 'pstack doctor', 'doctor.mjs');
  mkdirSync(dirname(link), { recursive: true });
  symlinkSync(fileURLToPath(new URL('./doctor.mjs', import.meta.url)), link);
  const { PSTACK_READ_ONLY, CLAUDE_PROJECT_DIR, ...env } = process.env;
  const hook = (input) => spawnSync(process.execPath, [link, 'due', '--hook'], { input, env: { ...env, ...world.env }, encoding: 'utf8' });
  const blocked = hook(world.stop());
  assert.equal(blocked.status, 0);
  assert.equal(JSON.parse(blocked.stdout).decision, 'block');
  const failed = hook(JSON.stringify({ transcript_path: world.home, cwd: world.repo }));
  assert.deepEqual([failed.status, failed.stdout], [1, '']);
  assert.match(failed.stderr, /^doctor\.mjs: /u);
});

test('due flags a second-plan row this session logged when the owner had not typed, picked or noted its first quote before it, or had neither said nor seen on a question card another of its quotes', async () => {
  const world = topic();
  world.said('go b');
  world.said([
    { type: 'text', text: '<system-reminder>a reminder</system-reminder>' },
    { type: 'text', text: 'Take the narrowed plan' },
  ]);
  world.said('<pasted_content>pasted words</pasted_content> my own words');
  world.said('<system-reminder>a reminder</system-reminder>Build all three');
  world.said("don't stop");
  world.said('ok, go.');
  world.said('好的开新计划修吧');
  world.queued('Start the plan');
  world.queued('<task-notification>notice words</task-notification>', 'human');
  world.queued('agent words', 'task-notification');
  world.refused('only the late writes');
  world.ask('Narrow it or keep going?', 'Keep going');
  world.ask('Which plan?', 'Write the new plan', 'but only for late focus writes');
  world.ask('Pick one?', '[User did not answer this question — they sent a message instead. Treat that message as their response; do not re-ask.]');
  world.ours(
    'b.decisions.tsv',
    owner('second plan: "the stop does not ask" picks b'),
    owner('second plan: "go b" picks b'),
    owner('second plan: "take the narrowed plan" picks b-narrow'),
    owner('second plan: "narrow it" picks b-narrow'),
    owner('second plan: "Write the new plan" picks b'),
    owner('second plan: "only for late focus writes" picks b'),
    owner('second plan: "go bold" or "go b" picks b'),
    owner('second plan: "go b" and "skip the review" picks b'),
    owner('second plan: "go b" to "Which plan?" picks b'),
    owner('second plan: "keep go" picks b'),
    owner('second plan: " " picks b'),
    owner('second plan: "pasted words" picks b'),
    owner('second plan: "my own words" picks b'),
    owner('second plan: "Build all three." picks b'),
    owner('second plan: "don’t stop" picks b'),
    owner('second plan: "开新计划修" picks b'),
    owner('second plan: "start the plan" picks b'),
    owner('second plan: "notice words" picks b'),
    owner('second plan: "agent words" picks b'),
    owner('second plan: "only the late writes" picks b'),
    owner('second plan: "they sent a message instead" picks b'),
  );
  world.theirs('b.decisions.tsv', owner('second plan: "never typed" picks c'));
  world.ours('b.decisions.tsv', owner('second plan: "later words" picks b'));
  world.said('later words').save();
  const flagged = (quote) => `- the second-plan stop logged in b at <time> quotes "${quote}", which the owner never typed or picked before it`;
  assert.deepEqual(timeless(await dueOf(world)), ['the stop does not ask', 'narrow it', 'go bold', 'skip the review', 'keep go', ' ', 'pasted words', 'notice words', 'agent words', 'they sent a message instead', 'later words'].map(flagged));
  const block = JSON.parse(await due(['--hook'], world.env, world.stop()));
  assert.match(block.reason, /the Second plan rule's stop still waits: ask the owner its question/u);
  assert.doesNotMatch(block.reason, /test it with a probe or search/u);
});

test('due reads a log from both the worktree and the main checkout, which can each hold rows the other lacks', async () => {
  const world = topic();
  const worktree = worktreeOf(world);
  world.theirs('a.decisions.tsv', plan('5 critical'));
  world.ours(join(worktree, 'docs', 'plans', 'a.decisions.tsv'), plan('6 critical')).save();
  assert.deepEqual(await dueOf(world, worktree), ['- plan round 2 of a found 6 critical findings, no fewer than the 5 of the round before']);
});

test("due keeps the order of a log's fuller copy when the other copy holds one of its rows stamped in the same second", async () => {
  const world = topic();
  const worktree = worktreeOf(world);
  world.ours('a.decisions.tsv', plan('2 critical'), plan('3 critical')).save();
  const [, second] = readFileSync(join(world.plans, 'a.decisions.tsv'), 'utf8').trim().split('\n');
  writeFileSync(join(worktree, 'docs', 'plans', 'a.decisions.tsv'), `${second}\n`);
  assert.deepEqual(await dueOf(world, worktree), ['- plan round 2 of a found 3 critical findings, no fewer than the 2 of the round before']);
});

test("due reads a Codex rollout: the rows its exec, shell and yielded calls appended, the owner's words apart from Codex's own AGENTS.md and context, and the answers to its question cards", async () => {
  const world = topic()
    .codexStartIn()
    .codexSaid('# AGENTS.md instructions for repo\n\n<INSTRUCTIONS>keep go</INSTRUCTIONS>', '<environment_context>keep go</environment_context>')
    .codexSaid('go b')
    .codexUserMessage('older words')
    .codexCard('Narrow it or keep going?', 'Narrow it')
    .codexReply('Which plan?', 'Write the new plan')
    .codex('a.decisions.tsv', plan('5 critical'), owner('second plan: "keep go" picks b'), owner('second plan: "instructions for repo" picks b'))
    .codex('a.decisions.tsv', plan('5 critical'), owner('second plan: "go b" picks b'), owner('second plan: "older words" picks b'))
    .codexYielded('c.decisions.tsv', owner('second plan: "narrow it" picks c'), owner('second plan: "write the new plan" for "Which plan?" picks c'), owner('second plan: "which plan" picks c'))
    .save();
  assert.deepEqual(timeless(await dueOf(world)).sort(), [
    '- plan round 2 of a found 5 critical findings, no fewer than the 5 of the round before',
    '- the second-plan stop logged in a at <time> quotes "instructions for repo", which the owner never typed or picked before it',
    '- the second-plan stop logged in a at <time> quotes "keep go", which the owner never typed or picked before it',
    '- the second-plan stop logged in c at <time> quotes "which plan", which the owner never typed or picked before it',
  ]);
  const elsewhere = mkdtempSync(join(tmpdir(), 'elsewhere-'));
  const stop = JSON.stringify({ session_id: 'codex', transcript_path: world.transcriptPath, cwd: elsewhere, hook_event_name: 'Stop', stop_hook_active: false });
  assert.equal(JSON.parse(await due(['--hook'], world.env, stop)).decision, 'block');
});

test('due reads an Antigravity transcript: detects stalled rounds and fabricated second-plan quotes, outputs continue once, and skips on executionNum > 0', async () => {
  const world = topic();
  world.theirs('a.decisions.tsv', plan('5 critical')).save();
  const at1 = '2026-11-26T13:10:00Z';
  const at2 = '2026-11-26T13:10:02Z';
  const at3 = '2026-11-26T13:10:05Z';
  const logFile = join(world.plans, 'a.decisions.tsv');
  const existing = readFileSync(logFile, 'utf8');
  const appendedRows = [
    `${at2}\tpanel\tseats opus @high\tplan round\treviewed\t5 critical`,
    `${at2}\towner\tsecond plan: "fake approval" picks b\twhy\tevidence\tapproved`,
    `${at2}\towner\tsecond plan: "real approval" picks b\twhy\tevidence\tapproved`,
  ];
  writeFileSync(logFile, `${existing}${appendedRows.join('\n')}\n`);
  const agyTranscript = join(world.repo, 'agy-transcript.jsonl');
  writeFileSync(
    agyTranscript,
    [
      { step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', created_at: at1, content: '<USER_REQUEST>\nreal approval\n</USER_REQUEST>' },
      { step_index: 1, source: 'MODEL', type: 'PLANNER_RESPONSE', created_at: at2, tool_calls: [{ name: 'run_command', args: { CommandLine: JSON.stringify('node .agents/pstack/decisions-check.mjs append docs/plans/a.decisions.tsv') } }] },
      { step_index: 2, source: 'MODEL', type: 'GENERIC', created_at: at3, content: 'Appended 3 rows to docs/plans/a.decisions.tsv.' },
    ]
      .map((entry) => JSON.stringify(entry))
      .join('\n') + '\n'
  );
  const stopPayload = (extra = {}) =>
    JSON.stringify({
      conversationId: 'agy-1',
      cwd: world.repo,
      executionNum: 0,
      fullyIdle: true,
      hookEventName: 'Stop',
      transcriptPath: agyTranscript,
      ...extra,
    });
  const blocked = JSON.parse(await due(['--hook'], world.env, stopPayload()));
  assert.equal(blocked.decision, 'continue');
  assert.match(blocked.reason, /plan round 2 of a found 5 critical findings/u);
  assert.match(blocked.reason, /quotes "fake approval"/u);
  assert.doesNotMatch(blocked.reason, /real approval/u);
  assert.deepEqual(JSON.parse(await due(['--hook'], world.env, stopPayload({ executionNum: 1 }))), {});
});

test('facts, transcript, transcriptTail and lastTypedAt discover and audit Gemini 4 Neon (Antigravity ACP) sessions while skipping subagents', async () => {
  const home = mkdtempSync(join(tmpdir(), 'doctor-agy-'));
  const repo = join(home, 'repo');
  mkdirSync(repo, { recursive: true });
  execFileSync('git', ['-C', repo, 'init', '-q', '-b', 'main']);
  execFileSync('git', ['-C', repo, '-c', 'user.email=d@e.com', '-c', 'user.name=d', 'commit', '-q', '--allow-empty', '-m', 'init']);

  const t3Brain = join(home, '.t3', 'userdata', 'providers', 'antigravity', 'acct1', 'antigravity-acp', 'brain');
  const neonDir = join(t3Brain, 'conv-neon-stuck', '.system_generated', 'logs');
  const subDir = join(t3Brain, 'conv-subagent', '.system_generated', 'logs');
  const geminiDir = join(home, '.gemini', 'antigravity', 'brain', 'conv-gemini-self', '.system_generated', 'logs');
  mkdirSync(neonDir, { recursive: true });
  mkdirSync(subDir, { recursive: true });
  mkdirSync(geminiDir, { recursive: true });

  const neonTranscript = join(neonDir, 'transcript.jsonl');
  const neonLines = [
    JSON.stringify({ step_index: 0, source: 'SYSTEM', type: 'SYSTEM_MESSAGE', created_at: iso(30), content: `Command Working Directory: ${repo}` }),
    JSON.stringify({ step_index: 1, source: 'USER_EXPLICIT', type: 'USER_INPUT', created_at: iso(29), content: '<USER_REQUEST>\n<t3_code_instructions>skip</t3_code_instructions>\nfix the editor caret\n</USER_REQUEST>' }),
    JSON.stringify({ step_index: 2, source: 'MODEL', type: 'PLANNER_RESPONSE', created_at: iso(1), model: 'gemini-4-neon-high', response: 'Checking caret logic.', tool_calls: [{ name: 'read_file' }, { name: 'run_command' }] }),
    JSON.stringify({ step_index: 3, source: 'SYSTEM', type: 'CHECKPOINT', created_at: iso(0.5), content: 'Compacted' }),
  ];
  writeFileSync(neonTranscript, `${neonLines.join('\n')}\n`);

  writeFileSync(
    join(subDir, 'transcript.jsonl'),
    `${JSON.stringify({ step_index: 0, source: 'SYSTEM', type: 'SYSTEM_MESSAGE', created_at: iso(30), content: 'You are running as a subagent invoked by parent.' })}\n`,
  );

  writeFileSync(
    join(geminiDir, 'transcript.jsonl'),
    `${JSON.stringify({ step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', created_at: iso(2), content: '<USER_REQUEST>\naudit sessions\n</USER_REQUEST>' })}\n`,
  );

  const env = { HOME: home, PSTACK_PULSE_HOME: join(home, 'no-pulse'), PSTACK_DOCTOR_HOME: join(home, 'doctor'), ANTIGRAVITY_CONVERSATION_ID: 'conv-gemini-self' };
  assert.equal(lastTypedAt(neonLines), JSON.parse(neonLines[1]).created_at);
  assert.deepEqual(
    transcriptTail(neonLines, 10).map((line) => line.replace(/^\S+ /u, '')),
    ['user: fix the editor caret', 'lead: Checking caret logic.', 'tools: read_file, run_command', 'compacted'],
  );

  const report = await facts(['--no-record'], env);
  assert.match(report, /^1 sessions: 1 older than 24 h/u);
  assert.match(report, /conv-neon-stuck/u);
  assert.match(report, /no landing for \d+ h while working/u);
  assert.doesNotMatch(report, /conv-subagent|conv-gemini-self/u);

  const selfReport = await facts(['--self', '--no-record'], env);
  assert.match(selfReport, /conv-gemini-self/u);
  assert.doesNotMatch(selfReport, /conv-neon-stuck/u);

  const tail = transcript(['conv-neon-stuck', '--last', '2'], env);
  assert.match(tail, /tools: read_file, run_command/u);
  assert.match(tail, /compacted/u);
});
