import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { asDarwinPsPrints, bashCommandOf, claudeInvocationRun, claudeSessionRun, invocationRun, ranAs } from '../assets/pstack/lead.mjs';

const identity = { runtime: 'codex', thread: 'child', session: 'parent', invocation: 'exec-12345678-1234-1234-1234-123456789abc' };
const meta = { type: 'session_meta', payload: { id: 'child', session_id: 'parent', parent_thread_id: 'parent' } };
const context = { type: 'turn_context', payload: { turn_id: 'turn', model: 'gpt-6.1-sol', effort: 'high' } };
const transcript = (records, path = 'child.jsonl') => ({ transcript: path, text: records.map(JSON.stringify).join('\n') });
const call = (type, name, command) => ({ type: 'response_item', payload: { type, name, call_id: 'run', arguments: JSON.stringify({ cmd: command }), input: command } });
const unknown = (result, message) => {
  assert.equal(result.run, undefined, message);
  assert.ok(result.miss, 'an unknown identity says which check failed');
};
const foreign = transcript([{ type: 'assistant', effort: 'medium', message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'cat root.decisions.tsv' } }] } }], 'foreign.jsonl');

test('runtime thread selects its own metadata through real wrapper and variable commands', () => {
  for (const command of ['await tools.exec_command({cmd: process.env.COMMAND})', 'node "$HELPER" append "$LOG" --from "$QUEUE"']) {
    const own = transcript([meta, context, call('custom_tool_call', 'exec', command)]);
    const { run } = invocationRun(identity, [foreign, own]);
    assert.equal(run?.model, 'gpt-6.1-sol');
    assert.equal(run.effort, 'high');
    assert.equal(run.transcript, 'child.jsonl');
  }
});

test('yielded output cannot select a foreign reader', () => {
  for (const [type, name, output] of [['custom_tool_call', 'exec', 'Script running with cell ID 3'], ['function_call', 'exec_command', JSON.stringify({ session_id: 42 })]]) {
    const own = transcript([meta, context, call(type, name, 'node "$HELPER" append "$LOG"'), { type: 'response_item', payload: { type: type + '_output', call_id: 'run', output } }]);
    assert.equal(invocationRun(identity, [foreign, own]).run?.transcript, 'child.jsonl');
    unknown(invocationRun({}, [foreign, own]));
  }
});

test('identity refuses missing, conflicting, inherited or duplicate metadata', () => {
  const own = transcript([meta, context]);
  for (const changed of [{ thread: undefined }, { session: 'other' }, { invocation: undefined }, { invocation: 'old-call' }, { runtime: 'claude' }, { thread: 'parent' }]) {
    unknown(invocationRun({ ...identity, ...changed }, [own, foreign]));
  }
  unknown(invocationRun(identity, [own, own]));
  unknown(invocationRun(identity, [transcript([meta, { ...meta, payload: { ...meta.payload, id: 'other' } }, context])]));
  unknown(invocationRun(identity, [transcript([meta])]));
  unknown(invocationRun(identity, [transcript([meta, { type: 'turn_context', payload: { model: 'model' } }])]));
});

test('recorded invocation must still be running in the same thread and turn', () => {
  const event = { type: 'event_msg', payload: { thread_id: 'child', turn_id: 'turn', item: { id: identity.invocation, type: 'CommandExecution', status: 'inProgress' } } };
  assert.equal(invocationRun(identity, [transcript([meta, context, event])]).run?.model, 'gpt-6.1-sol');
  for (const payload of [{ ...event.payload, thread_id: 'parent' }, { ...event.payload, turn_id: 'old' }, { ...event.payload, item: { ...event.payload.item, status: 'completed' } }]) {
    unknown(invocationRun(identity, [transcript([meta, context, { ...event, payload }])]));
  }
});

test('a Claude Code session is the one whose Bash call is still open', () => {
  const bash = (id, effort = 'high') => ({ type: 'assistant', effort, timestamp: 't', message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', id, name: 'Bash', input: { command: 'node "$HELPER" append "$LOG"' } }] } });
  const result = (id) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'done' }] } });
  const claude = (records, path) => ({ transcript: path, text: records.map(JSON.stringify).join('\n') });
  const lead = claude([bash('a', 'medium'), result('a'), bash('b')], 'session.jsonl');
  assert.deepEqual(claudeInvocationRun([lead]).run, { runtime: 'claude', model: 'claude-opus-5-5', effort: 'high', at: 't', transcript: 'session.jsonl' });
  const waiting = claude([bash('a'), result('a'), { type: 'assistant', effort: 'high', message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: 'c', name: 'Agent', input: {} }] } }], 'session.jsonl');
  const agent = claude([bash('d', 'low')], 'agent-x.jsonl');
  assert.equal(claudeInvocationRun([waiting, agent]).run?.transcript, 'agent-x.jsonl', "a subagent's call is the subagent's, not the lead's");
  unknown(claudeInvocationRun([lead, agent]), 'two open calls stay unknown');
  const message = claude([bash('a', 'medium'), result('a'), { ...bash('b'), timestamp: 'first' }, bash('c')], 'session.jsonl');
  assert.equal(claudeInvocationRun([message]).run?.at, 'first', "one message's open calls name the first of them");
  unknown(claudeInvocationRun([claude([bash('b'), bash('c', 'low')], 'session.jsonl')]), 'open calls at two efforts stay unknown');
  unknown(claudeInvocationRun([claude([bash('a'), result('a')], 'session.jsonl')]), 'a finished call is not the running one');
  unknown(claudeInvocationRun([claude([{ ...bash('a'), effort: undefined }], 'session.jsonl')]), 'a record without effort is unknown');
});

test('the running Claude call is the open one whose recorded command it runs', () => {
  const bash = (id, effort, command) => ({ type: 'assistant', effort, timestamp: id, message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } });
  const result = (id) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'done' }] } });
  const claude = (records, path) => ({ transcript: path, text: records.map(JSON.stringify).join('\n') });
  const own = 'node "$HELPER" append "$LOG"';
  const earlier = [bash('a', 'xhigh', 'git status'), result('a')];
  const orphan = claude([bash('o', 'low', 'sleep 600')], 'agent-x.jsonl');
  const before = claude(earlier, 'session.jsonl');
  const landed = claude([...earlier, bash('b', 'xhigh', own), bash('c', 'xhigh', 'pnpm test')], 'session.jsonl');
  unknown(claudeInvocationRun([before, orphan], own), "another agent's open call is not this command's while its own record has not landed");
  assert.deepEqual(claudeInvocationRun([landed, orphan], own).run, { runtime: 'claude', model: 'claude-opus-5-5', effort: 'xhigh', at: 'b', transcript: 'session.jsonl' });
  const helper = claude([bash('d', 'high', own)], 'agent-y.jsonl');
  assert.equal(claudeInvocationRun([before, orphan, helper], own).run?.transcript, 'agent-y.jsonl', "a subagent's command is the subagent's");
  unknown(claudeInvocationRun([landed, helper], own), 'one command open in two transcripts stays unknown');
  const recorded = `echo 'it'"'"'s' "x'y" >/dev/null; ps -ww -o command= -p $$ | rg -o "eval .{0,120}"`;
  const rewritten = claude([bash('e', 'xhigh', recorded)], 'session.jsonl');
  assert.equal(claudeInvocationRun([rewritten], recorded.replace('| rg', '| rtk rg')).run?.at, 'e', 'a hook that adds words still runs the recorded command');
});

test('a Bash call reads its command from the shell Claude Code runs it in', () => {
  const args = `/bin/zsh -c source /Users/x/.claude/shell-snapshots/snapshot-zsh-1.sh 2>/dev/null || true && setopt NO_EXTENDED_GLOB NO_BARE_GLOB_QUAL 2>/dev/null || true && eval 'echo '"'"'it'"'"'"'"'"'"'"'"'s'"'"' "x'"'"'y" >/dev/null; ps -ww -o command= -p $$ | rtk rg -o "eval .{0,120}"' < /dev/null && pwd -P >| /tmp/claude-1-cwd`;
  assert.equal(bashCommandOf(args), `echo 'it'"'"'s' "x'y" >/dev/null; ps -ww -o command= -p $$ | rtk rg -o "eval .{0,120}"`);
  assert.equal(bashCommandOf('/bin/zsh -c node a.mjs'), null);
});

test('a recorded command ran only as itself or with whole words added', () => {
  assert.ok(ranAs('git log -3 && rg -n x', 'rtk git log -3 && rtk rg -n x'));
  assert.ok(ranAs('git status', 'rtk git status'));
  assert.ok(!ranAs('ls', 'ls && node .agents/pstack/decisions-check.mjs append log --from queue'), 'a short command inside a long one is not it');
  assert.ok(!ranAs('git status && ls', 'ls && git status'), 'reordered words are another command');
});

test('a recorded command reads as macOS ps prints its control characters', () => {
  assert.equal(asDarwinPsPrints("cat > q.tsv <<'EOF'\r\na\tb\u001b\u007f\nEOF"), "cat > q.tsv <<'EOF'^M\\012a\\011b^[^?\\012EOF");
  assert.equal(asDarwinPsPrints(String.raw`printf '\012'`), String.raw`printf '\012'`, 'a typed backslash prints as itself');
});

test('macOS ps prints a multi-line command as the matcher reads it', { skip: process.platform !== 'darwin' && 'ps prints argv this way only on macOS' }, () => {
  const command = `: 'a\rb\u001bc\u007fd'\tx\nps -ww -o command= -p $$`;
  const argv = execFileSync('/bin/sh', ['-c', `true && eval '${command.replaceAll("'", `'"'"'`)}'`], { encoding: 'utf8' });
  assert.ok(ranAs(asDarwinPsPrints(command), bashCommandOf(argv)));
});

test("a typed escape in this command never matches another agent's call", () => {
  const foreign = { transcript: 'agent-x.jsonl', text: JSON.stringify({ type: 'assistant', effort: 'low', timestamp: 'f', message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: 'f', name: 'Bash', input: { command: "printf '%s' 'a b'; node lead.mjs" } }] } }) };
  unknown(claudeInvocationRun([foreign], String.raw`printf '%s' 'a\012b'; node lead.mjs`));
});

test('a finished Claude run reads its last record whole, whatever its characters', () => {
  const home = mkdtempSync(join(tmpdir(), 'lead-home-'));
  const previous = process.env.HOME;
  process.env.HOME = home;
  try {
    const folder = join(home, '.claude', 'projects', 'project');
    mkdirSync(folder, { recursive: true });
    const record = (effort, text) => JSON.stringify({ type: 'assistant', effort, timestamp: effort, message: { model: 'claude-opus-5-5', content: [{ type: 'text', text }] } });
    writeFileSync(join(folder, 'long.jsonl'), `${record('low', 'é'.repeat(700_000))}\n${record('high', 'é'.repeat(300_000))}\n`);
    assert.equal(claudeSessionRun('long')?.effort, 'high');
  } finally {
    process.env.HOME = previous;
  }
});
