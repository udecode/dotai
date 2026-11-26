import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { claudeSessionRun, effectiveModelsSheet, invocationRun, pluginLag } from '../assets/pstack/lead.mjs';

const LEAD = fileURLToPath(new URL('../assets/pstack/lead.mjs', import.meta.url));
const identity = { runtime: 'codex', thread: 'child', session: 'parent', invocation: 'exec-12345678-1234-1234-1234-123456789abc' };
const meta = { type: 'session_meta', payload: { id: 'child', session_id: 'parent', parent_thread_id: 'parent' } };
const context = { type: 'turn_context', payload: { turn_id: 'turn', model: 'gpt-6.1-sol', effort: 'high' } };
const transcript = (records, path = 'child.jsonl') => ({ transcript: path, text: records.map(JSON.stringify).join('\n') });
const call = (type, name, command) => ({ type: 'response_item', payload: { type, name, call_id: 'run', arguments: JSON.stringify({ cmd: command }), input: command } });
const unknown = (result, message) => {
  assert.equal(result.run, undefined, message);
  assert.ok(result.miss);
};
const foreign = transcript([{ type: 'assistant', effort: 'medium', message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'cat root.decisions.tsv' } }] } }], 'foreign.jsonl');

test('Codex invocationRun resolves matching thread/invocation and rejects missing, foreign, completed or ambiguous metadata', () => {
  for (const command of ['await tools.exec_command({cmd: process.env.COMMAND})', 'node "$HELPER" append "$LOG" --from "$QUEUE"']) {
    const { run } = invocationRun(identity, [foreign, transcript([meta, context, call('custom_tool_call', 'exec', command)])]);
    assert.deepEqual([run?.model, run?.effort, run?.transcript], ['gpt-6.1-sol', 'high', 'child.jsonl']);
  }
  const yielded = transcript([meta, context, call('function_call', 'exec_command', 'node "$HELPER" append "$LOG"'), { type: 'response_item', payload: { type: 'function_call_output', call_id: 'run', output: JSON.stringify({ session_id: 42 }) } }]);
  assert.equal(invocationRun(identity, [foreign, yielded]).run?.transcript, 'child.jsonl');
  unknown(invocationRun({}, [foreign, yielded]));

  const own = transcript([meta, context]);
  for (const changed of [{ thread: undefined }, { session: 'other' }, { invocation: undefined }, { invocation: 'old-call' }, { runtime: 'claude' }, { thread: 'parent' }]) {
    unknown(invocationRun({ ...identity, ...changed }, [own, foreign]));
  }
  unknown(invocationRun(identity, [own, own]));
  unknown(invocationRun(identity, [transcript([meta])]));

  const event = { type: 'event_msg', payload: { thread_id: 'child', turn_id: 'turn', item: { id: identity.invocation, type: 'CommandExecution', status: 'inProgress' } } };
  assert.equal(invocationRun(identity, [transcript([meta, context, event])]).run?.model, 'gpt-6.1-sol');
  for (const payload of [{ ...event.payload, thread_id: 'parent' }, { ...event.payload, turn_id: 'old' }, { ...event.payload, item: { ...event.payload.item, status: 'completed' } }]) {
    unknown(invocationRun(identity, [transcript([meta, context, { ...event, payload }])]));
  }
});

function leadInSession(records, subagentRecords = null) {
  const home = mkdtempSync(join(tmpdir(), 'lead-main-'));
  const session = '11111111-2222-4333-8444-555555555555';
  const dir = join(home, '.claude', 'projects', 'p');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${session}.jsonl`), `${records.map(JSON.stringify).join('\n')}\n`);
  if (subagentRecords) {
    mkdirSync(join(dir, session, 'subagents'), { recursive: true });
    writeFileSync(join(dir, session, 'subagents', 'agent-x.jsonl'), `${subagentRecords.map(JSON.stringify).join('\n')}\n`);
  }
  symlinkSync(process.execPath, join(home, 'claude'));
  writeFileSync(join(home, 'runtime.mjs'), "import { spawnSync } from 'node:child_process';\nprocess.exit(spawnSync(process.execPath, [process.argv[2]], { stdio: 'inherit' }).status ?? 1);\n");
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(CLAUDE|CODEX)/u.test(key)));
  return spawnSync(join(home, 'claude'), [join(home, 'runtime.mjs'), LEAD], { encoding: 'utf8', env: { ...env, HOME: home, CLAUDE_CODE_SESSION_ID: session } });
}
const bashCall = (id, input, effort = 'xhigh') => ({ type: 'assistant', effort, timestamp: id, message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', id, name: 'Bash', input }] } });
const resultOf = (id, content, extra = {}) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content, ...extra }] } });
const noticeFor = (id, output = '/tmp/b1.output') => `<task-notification>\n<task-id>b1</task-id>\n<tool-use-id>${id}</tool-use-id>\n<output-file>${output}</output-file>\n<status>completed</status>\n</task-notification>`;

test('lead CLI tracks open foreground, subagent, and background Bash calls until task notification or output exit line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lead-output-'));
  const output = join(dir, 'b1.output');
  writeFileSync(output, 'still going\n');
  const started = [bashCall('bg', { command: 'pnpm test', run_in_background: true }), resultOf('bg', `Command running in background with ID: b1. Output is being written to: ${output}.`)];
  assert.equal(leadInSession(started).stdout.trim(), 'claude-opus-5-5 @xhigh');
  assert.equal(leadInSession([...started, { type: 'user', message: { content: noticeFor('bg', output) } }]).status, 1);

  writeFileSync(output, 'still going\n[exited with code 0]\n');
  assert.equal(leadInSession(started).status, 1);

  // Subagent's open Bash call resolves to subagent effort while lead waits on Agent.
  const waiting = [bashCall('a', { command: 'ls' }), resultOf('a', 'done'), { type: 'assistant', effort: 'high', message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: 'c', name: 'Agent', input: {} }] } }];
  assert.equal(leadInSession(waiting, [bashCall('d', { command: 'pnpm test' }, 'low')]).stdout.trim(), 'claude-opus-5-5 @low');
  // Foreground finished call exits 1.
  assert.equal(leadInSession([bashCall('fg', { command: 'pnpm test' }), resultOf('fg', 'done')]).status, 1);
});

test('claudeSessionRun reads the last record whole on large multibyte transcripts', () => {
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

test('pluginLag checks main checkout install for worktrees, user fallback, and Codex plugin cache', () => {
  const home = mkdtempSync(join(tmpdir(), 'lag-home-'));
  const main = realpathSync(mkdtempSync(join(tmpdir(), 'lag-main-')));
  execFileSync('git', ['init', '-q', main]);
  mkdirSync(join(main, '.claude'));
  writeFileSync(join(main, '.claude/settings.json'), JSON.stringify({ extraKnownMarketplaces: { 'pstack-claude': { source: { source: 'github', repo: 'michael-denyer/pstack-claude', ref: 'v0.9.145' } } } }));
  mkdirSync(join(home, '.claude/plugins'), { recursive: true });
  const installs = (entries) => writeFileSync(join(home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'pstack@pstack-claude': entries } }));
  const env = { HOME: home };
  execFileSync('git', ['-C', main, 'add', '.claude']);
  execFileSync('git', ['-C', main, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'pin']);
  const worktree = join(main, 'wt');
  execFileSync('git', ['-C', main, 'worktree', 'add', '-q', worktree]);

  installs([{ scope: 'user', version: '0.9.145' }, { scope: 'project', projectPath: main, version: '0.9.99' }]);
  assert.equal(pluginLag('claude', worktree, env)?.cwd, main);
  assert.deepEqual(pluginLag('claude', main, env), { pin: '0.9.145', installed: '0.9.99', cwd: main, command: 'claude plugin marketplace add michael-denyer/pstack-claude#v0.9.145 && claude plugin update pstack@pstack-claude --scope project' });
  installs([{ scope: 'project', projectPath: worktree, version: '0.9.99' }, { scope: 'project', projectPath: main, version: '0.9.145' }]);
  assert.equal(pluginLag('claude', worktree, env), null);
  installs([{ scope: 'user', version: '0.9.145' }]);
  assert.equal(pluginLag('claude', main, env), null);
  installs([]);
  assert.match(pluginLag('claude', main, env).command, /claude plugin install pstack@pstack-claude --scope project$/u);
  assert.equal(pluginLag(null, main, env), null);

  mkdirSync(join(home, '.codex/plugins/cache/pstack-claude/pstack/0.9.143'), { recursive: true });
  assert.equal(pluginLag('codex', main, env).installed, '0.9.143');
  mkdirSync(join(home, '.codex/plugins/cache/pstack-claude/pstack/0.9.145'));
  assert.equal(pluginLag('codex', main, env), null);
});

test('effectiveModelsSheet merges main checkout local overrides in trunk Claude worktrees only', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'sheet-git-')));
  const main = join(dir, 'main');
  const git = (...args) => execFileSync('git', ['-C', main, ...args], { encoding: 'utf8' });
  const committed = '# sheet\n\nswarm workers: opus @high\nclip: opus @high\ndefault effort: high\n';
  mkdirSync(join(main, '.claude'), { recursive: true });
  mkdirSync(join(main, '.agents'));
  git('init', '-q');
  writeFileSync(join(main, '.agents/pstack.json'), JSON.stringify({ delivery: 'trunk' }));
  writeFileSync(join(main, '.claude/pstack-models.md'), committed);
  git('add', '.');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
  const tree = join(dir, 'tree');
  git('worktree', 'add', '-q', '--detach', tree);

  assert.deepEqual(effectiveModelsSheet('claude', { HOME: dir }, tree), { paths: [join(tree, '.claude/pstack-models.md')], text: committed });
  writeFileSync(join(main, '.claude/pstack-models.local.md'), 'Why I run these.\nclip: opus @medium\nvideo transcripts: opus @low\n');
  assert.equal(effectiveModelsSheet('claude', { HOME: dir }, tree).text, '# sheet\n\nswarm workers: opus @high\nclip: opus @medium\ndefault effort: high\nvideo transcripts: opus @low\n');
  assert.equal(effectiveModelsSheet('codex', { HOME: dir }, tree).text, null);

  writeFileSync(join(tree, '.agents/pstack.json'), JSON.stringify({ delivery: 'pr' }));
  assert.equal(effectiveModelsSheet('claude', { HOME: dir }, tree).text, committed);
});
