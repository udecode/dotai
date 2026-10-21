import assert from 'node:assert/strict';
import { test } from 'node:test';
import { claudeInvocationRun, invocationRun } from '../assets/pstack/lead.mjs';

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
  unknown(claudeInvocationRun([claude([bash('a'), result('a')], 'session.jsonl')]), 'a finished call is not the running one');
  unknown(claudeInvocationRun([claude([{ ...bash('a'), effort: undefined }], 'session.jsonl')]), 'a record without effort is unknown');
});
