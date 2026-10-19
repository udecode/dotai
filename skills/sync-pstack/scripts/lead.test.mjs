import assert from 'node:assert/strict';
import { test } from 'node:test';
import { leadFromTranscripts } from '../assets/pstack/lead.mjs';

const marker = 'root.decisions.tsv';
const command = `node decisions-check.mjs append ${marker} --from queue.tsv`;
const transcript = (runtime, records) => ({ runtime, transcript: `${runtime}.jsonl`, text: records.map((record) => JSON.stringify(record)).join('\n') });
const context = { type: 'turn_context', payload: { model: 'gpt-6.1-sol', effort: 'high' } };
const codexCall = { type: 'response_item', payload: { type: 'function_call', name: 'exec_command', call_id: 'run', arguments: JSON.stringify({ cmd: command }) } };
const claudeCall = (name, input) => ({ type: 'assistant', effort: 'medium', message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: 'run', name, input }] } });

test('lead attribution keeps a long Codex turn and ignores a foreign review Read or prompt', () => {
  const codex = transcript('codex', [context, { type: 'event_msg', payload: { type: 'agent_message', message: 'x'.repeat(600_000) } }, codexCall]);
  const review = transcript('claude', [{ type: 'user', message: { content: `Review ${marker}` } }, claudeCall('Read', { file_path: marker })]);
  const lead = leadFromTranscripts(marker, [codex, review]);
  assert.equal(lead?.runtime, 'codex', 'a review must not replace the executing Codex lead');
  assert.equal(lead.model, 'gpt-6.1-sol');
  assert.equal(lead.effort, 'high');
});

test('lead attribution accepts Claude execution and refuses ambiguity or completed calls', () => {
  const claude = transcript('claude', [claudeCall('Bash', { command })]);
  assert.equal(leadFromTranscripts(marker, [claude])?.runtime, 'claude');
  assert.equal(leadFromTranscripts(marker, [claude, transcript('codex', [context, codexCall])]), null, 'two executing sessions stay ambiguous');
  assert.equal(leadFromTranscripts(marker, [transcript('codex', [context, codexCall, { type: 'response_item', payload: { type: 'function_call_output', call_id: 'run', output: marker } }])]), null, 'a finished call is not the executing lead');
  assert.equal(leadFromTranscripts(marker, [transcript('codex', [codexCall])]), null, 'missing turn metadata is unknown');
});

test('lead attribution pairs concurrent results with their calls and accepts Codex execution wrappers', () => {
  const wrapper = { type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'wrapper', input: `await tools.exec_command({cmd:${JSON.stringify(command)}})` } };
  const otherResult = { type: 'response_item', payload: { type: 'function_call_output', call_id: 'other', output: marker } };
  assert.equal(leadFromTranscripts(marker, [transcript('codex', [context, wrapper, otherResult])])?.runtime, 'codex');
  assert.equal(leadFromTranscripts(marker, [transcript('codex', [context, wrapper, { type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'wrapper', output: 'done' } }])]), null);
  assert.equal(leadFromTranscripts(marker, [transcript('claude', [claudeCall('Bash', { command }), { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'run', content: 'done' }] } }])]), null);
});
