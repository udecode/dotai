import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { realPs } from './test-ps.mjs';
import { sandbox } from './test-sandbox.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const HELPERS = join(HERE, '../assets/pstack');

test('cross runs a prompt file in the other runtime: Codex from Claude Code, Claude from Codex', () => {
  const { dir, home } = sandbox();
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\necho "claude: $*"\n', { mode: 0o755 });
  writeFileSync(join(bin, 'codex'), '#!/bin/sh\nwhile [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2 ;; *) last="$1"; shift ;; esac; done\necho "codex: $last" > "$out"\n', { mode: 0o755 });
  writeFileSync(join(dir, 'brief.md'), 'Review docs/plans/x.md for gaps.');
  const cross = (env) =>
    spawnSync(process.execPath, [join(HELPERS, 'cross.mjs'), '--prompt-file', join(dir, 'brief.md')], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, CLAUDECODE: '', ...env },
    });
  const fromClaude = cross({ CLAUDECODE: '1' });
  assert.equal(fromClaude.status, 0, fromClaude.stderr);
  assert.equal(fromClaude.stdout.trim(), 'codex: Review docs/plans/x.md for gaps.');
  const fromCodex = cross({});
  assert.equal(fromCodex.stdout.trim().replace(/--session-id [\da-f-]{36} /u, ''), 'claude: -p --model opus --settings {"disableAllHooks":true} --permission-mode plan -- Review docs/plans/x.md for gaps.');
  assert.match(fromCodex.stderr, /^seat: opus @default$/mu, 'a seat with no transcript and no --effort says its effort is the default');
});

test('a Claude seat hears that plan mode refuses its writes before the brief, and a Codex seat hears only the brief', () => {
  const { dir, home } = sandbox();
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\necho "claude: $*"\n', { mode: 0o755 });
  writeFileSync(join(bin, 'codex'), '#!/bin/sh\nwhile [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2 ;; *) last="$1"; shift ;; esac; done\necho "codex: $last" > "$out"\n', { mode: 0o755 });
  const answers = join(dir, 'answers');
  const result = spawnSync(process.execPath, [join(HELPERS, 'seats.mjs'), '--dir', answers, '--prompt', 'Break this diff.', 'one=claude:opus', 'two=codex:gpt-6.1-sol'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, CLAUDECODE: '' },
  });
  assert.equal(result.status, 0, result.stderr);
  const claude = readFileSync(join(answers, 'one.md'), 'utf8');
  assert.match(claude, /-- You run in plan mode[^]*name each probe that needs a write[^]*Break this diff\.\n$/u);
  const codex = readFileSync(join(answers, 'two.md'), 'utf8');
  assert.match(codex, /Break this diff\./u);
  assert.doesNotMatch(codex, /plan mode/u);
});

test('cross runs a Codex seat read-only on the model and effort it names', () => {
  const { dir, home } = sandbox();
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'codex'), '#!/bin/sh\nargs="$*"\nwhile [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2 ;; *) shift ;; esac; done\necho "$args" > "$out"\n', { mode: 0o755 });
  const seat = spawnSync(process.execPath, [join(HELPERS, 'cross.mjs'), '--to', 'codex', '--model', 'gpt-6-astra', '--effort', 'high', 'review it'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, CLAUDECODE: '' },
  });
  assert.equal(seat.status, 0, seat.stderr);
  assert.match(seat.stdout, /^exec --ignore-user-config --ignore-rules .* -m gpt-6-astra -c model_reasoning_effort=high --disable hooks --sandbox read-only /);
});

test('cross prints a whole reply longer than a pipe buffer before it exits', () => {
  const { dir, home } = sandbox();
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'codex'), '#!/bin/sh\nwhile [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2 ;; *) shift ;; esac; done\nhead -c 200000 /dev/zero | tr "\\000" a > "$out"\n', { mode: 0o755 });
  const seat = spawnSync(process.execPath, [join(HELPERS, 'cross.mjs'), '--to', 'codex', '--model', 'gpt-6-astra', 'review it'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, CLAUDECODE: '' },
  });
  assert.equal(seat.status, 0, seat.stderr);
  assert.equal(seat.stdout.trim().length, 200000, 'a piped reply keeps every byte past 65,536');
});

test("cross caps a seat's effort at the project's maxEffort, and runs a seat with no effort at the cap", () => {
  const { dir, home } = sandbox();
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'codex'), '#!/bin/sh\nargs="$*"\nwhile [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2 ;; *) shift ;; esac; done\necho "$args" > "$out"\n', { mode: 0o755 });
  const seat = (...args) =>
    spawnSync(process.execPath, [join(HELPERS, 'cross.mjs'), '--to', 'codex', '--model', 'gpt-6.1-sol', ...args, 'review it'], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, CLAUDECODE: '' },
    });
  assert.match(seat('--effort', 'xhigh').stdout, /-c model_reasoning_effort=xhigh /, 'a project with no cap');
  assert.doesNotMatch(seat().stdout, /model_reasoning_effort/, 'no cap and no effort leaves the runtime default');
  mkdirSync(join(dir, '.agents'));
  writeFileSync(join(dir, '.agents/pstack.json'), JSON.stringify({ maxEffort: 'high' }));
  assert.match(seat('--effort', 'xhigh').stdout, /-c model_reasoning_effort=high /);
  assert.match(seat('--effort', 'medium').stdout, /-c model_reasoning_effort=medium /, 'an effort under the cap stays');
  assert.match(seat().stdout, /-c model_reasoning_effort=high /);
});

test('cross --bypass runs a Codex worker on the owner config with hooks and no sandbox, and refuses any other runtime or lane', () => {
  const { dir, home } = sandbox();
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'codex'), '#!/bin/sh\nargs="$*"\nwhile [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2 ;; *) shift ;; esac; done\necho "$args PSTACK_READ_ONLY=${PSTACK_READ_ONLY:-unset}" > "$out"\n', { mode: 0o755 });
  const run = (args) =>
    spawnSync(process.execPath, [join(HELPERS, 'cross.mjs'), ...args, 'research it'], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, CLAUDECODE: '1', PSTACK_READ_ONLY: '1' },
    });
  const worker = run(['--to', 'codex', '--bypass']);
  assert.equal(worker.status, 0, worker.stderr);
  assert.match(worker.stdout.trim(), /^exec -m gpt-6\.2-sol --dangerously-bypass-approvals-and-sandbox -o \S+ -- research it PSTACK_READ_ONLY=unset$/u, 'a worker that writes is not marked read-only');
  for (const args of [['--to', 'claude', '--bypass'], ['--to', 'codex', '--bypass', '--ignore-user-config']]) {
    const refused = run(args);
    assert.equal(refused.status, 2, args.join(' '));
    assert.equal(refused.stdout, '', args.join(' '));
    assert.match(refused.stderr, /^--bypass runs only --to codex/u, args.join(' '));
  }
});

test('cross --reach runs a Codex seat on the owner config with network, writing only a scratch folder, and drops an inherited permission profile', () => {
  const { dir, home } = sandbox();
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'codex'), '#!/bin/sh\nargs="$*"\nwhile [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2 ;; *) shift ;; esac; done\nprintf "%s\\ncwd=%s\\nprofile=%s\\n" "$args" "$PWD" "$CODEX_PERMISSION_PROFILE" > "$out"\n', { mode: 0o755 });
  const run = (args) =>
    spawnSync(process.execPath, [join(HELPERS, 'cross.mjs'), ...args, 'review it'], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, CLAUDECODE: '1', CODEX_PERMISSION_PROFILE: ':danger-full-access' },
    });
  const seat = run(['--to', 'codex', '--reach', '--model', 'gpt-6-astra']);
  assert.equal(seat.status, 0, seat.stderr);
  assert.match(seat.stdout, /^exec --ignore-rules --skip-git-repo-check -c web_search="live" -m gpt-6-astra --disable hooks --sandbox workspace-write -c sandbox_workspace_write\.network_access=true -o \S+ -- Your working directory is a scratch folder you may write\. The project is \S+: read it by absolute path and never write it\. Your sandbox cannot run a browser[^\n]*never start or drive one[^\n]*so the lead can run it\.\n\nreview it\n\nPut your whole answer in your final message\. Nobody reads the files you write in the scratch folder, and it is deleted when you finish, so for each file you wrote there that your answer cites or runs, paste its full source and the commands that create any fixture it reads\.\n/u);
  assert.match(seat.stdout, /^cwd=\S*pstack-reach-\S+$/mu);
  assert.match(seat.stdout, /^profile=$/mu);
  const refused = run(['--to', 'codex', '--reach', '--bypass']);
  assert.equal(refused.status, 2);
  assert.equal(refused.stdout, '');
});

const FAKE_AGY = '#!/usr/bin/env node\nconsole.log(JSON.stringify({ event: "init" }));\nconsole.log(JSON.stringify({ event: "result", result: { status: "success", response: JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }) } }));\n';

test('cross runs an agy seat outside the sandbox from a scratch folder on the model for its effort, reading any file and denying its file tools every write outside that folder', () => {
  const { dir, home } = sandbox();
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'agy'), FAKE_AGY, { mode: 0o755 });
  const seat = spawnSync(process.execPath, [join(HELPERS, 'cross.mjs'), '--to', 'agy', '--effort', 'xhigh', 'review it'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, CLAUDECODE: '1' },
  });
  assert.equal(seat.status, 0, seat.stderr);
  const project = realpathSync(dir);
  const { args, cwd } = JSON.parse(seat.stdout);
  assert.match(cwd, /pstack-reach-/u);
  assert.equal(existsSync(cwd), false, 'the scratch folder is deleted once the seat answers');
  assert.deepEqual(args.slice(2), ['--model', 'gemini-4-neon-xhigh', '--settings', args[5], '--dangerously-skip-permissions', '--output-format', 'stream-json']);
  assert.equal(args[0], '-p');
  assert.ok(args[1].startsWith(`Your working directory is a scratch folder you may write. The project is ${project}: read it by absolute path and never write it. Your shell runs outside agy's sandbox and reaches the network`), args[1]);
  assert.match(args[1], /\n\nreview it\n\nPut your whole answer in your final message\./u);
  assert.deepEqual(JSON.parse(args[5]), {
    agentMode: '',
    toolPermission: 'proceed-in-sandbox',
    permissions: { allow: ['read_file(*)', `write_file(${cwd})`, 'read_url(*)', 'mcp(*)'], deny: [`write_file(${project})`, 'execute_url(*)'] },
  });
  assert.match(seat.stderr, /^seat: gemini-4-neon @xhigh$/mu);
});

test('seats runs an offline agy seat with no web, denies writes to every folder it may read, and skips a seat Gemini filters block or that fails', () => {
  const { dir, home } = sandbox();
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'agy'), FAKE_AGY, { mode: 0o755 });
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\necho "claude answered"\n', { mode: 0o755 });
  mkdirSync(join(dir, 'transcripts'));
  const answers = join(dir, 'answers');
  const seats = (env = {}) =>
    spawnSync(process.execPath, [join(HELPERS, 'seats.mjs'), '--dir', answers, '--prompt', 'Break this diff.', '--offline', '--read-dir', join(dir, 'transcripts'), 'neon=agy:gemini-4-neon@high', 'opus=claude:opus'], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, CLAUDECODE: '', ...env },
    });
  const offline = seats();
  assert.equal(offline.status, 0, offline.stderr);
  const { args } = JSON.parse(readFileSync(join(answers, 'neon.md'), 'utf8'));
  const { permissions } = JSON.parse(args[args.indexOf('--settings') + 1]);
  assert.equal(args[args.indexOf('--model') + 1], 'gemini-4-neon-high');
  assert.ok(args.includes('--sandbox') && !args.includes('--dangerously-skip-permissions'), 'an offline seat stays in the sandbox');
  assert.match(args[1], /Every shell command you run stays in agy's sandbox/u);
  assert.doesNotMatch(permissions.allow.join(' '), /read_url/u);
  assert.deepEqual(permissions.deny, [`write_file(${realpathSync(dir)})`, `write_file(${realpathSync(join(dir, 'transcripts'))})`, 'execute_url(*)', 'read_url(*)', 'mcp(*)']);
  writeFileSync(join(bin, 'agy'), "#!/bin/sh\necho \"This request was blocked by Gemini's filters. They can occasionally trigger by mistake.\"\n", { mode: 0o755 });
  const filtered = seats();
  assert.equal(filtered.status, 0, 'a round whose only failure is a provider refusal still passes');
  assert.match(filtered.stdout, /^neon: skipped, its provider refused the prompt for safety, seat: gemini-4-neon @high$/mu);
  assert.match(readFileSync(join(answers, 'neon.err'), 'utf8'), /^refused: safety$/mu);
  writeFileSync(join(bin, 'agy'), '#!/bin/sh\necho "error: Individual quota reached. Resets in 4m25s." >&2\nexit 3\n', { mode: 0o755 });
  const limited = seats();
  assert.equal(limited.status, 0, 'a round whose only failure is a Gemini seat still passes');
  assert.match(limited.stdout, /^neon: skipped, exit 3: error: Individual quota reached\. Resets in 4m25s\., seat: gemini-4-neon @high$/mu);
});

const FAKE_SEAT_AGY = `#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const args = process.argv.slice(2);
const prompt = args[1];
const touch = prompt.match(/TOUCH (\\S+)/u)?.[1];
if (touch) writeFileSync(touch, 'stray');
const push = spawnSync('git', ['push', 'origin', 'HEAD:refs/heads/seat'], { encoding: 'utf8' });
const answer = { args, cwd: process.cwd(), pushed: push.status === 0, token: process.env.GH_TOKEN ?? null, readOnly: process.env.PSTACK_READ_ONLY ?? null };
console.log(JSON.stringify({ event: 'result', result: { status: 'success', response: JSON.stringify(answer) } }));
`;

function unboxedSeatMachine() {
  const { dir, home } = sandbox();
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'agy'), FAKE_SEAT_AGY, { mode: 0o755 });
  const git = (cwd, ...args) => spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  const remote = join(dir, 'remote.git');
  const main = join(dir, 'main');
  git(dir, 'init', '-q', '--bare', remote);
  git(dir, 'init', '-q', main);
  writeFileSync(join(main, 'a.txt'), 'a');
  git(main, 'add', 'a.txt');
  git(main, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'a');
  git(main, 'remote', 'add', 'origin', remote);
  git(main, 'config', 'remote.origin.pushurl', remote);
  git(main, 'worktree', 'add', '-q', '-b', 'task', join(dir, 'task'));
  const worktree = realpathSync(join(dir, 'task'));
  const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, CLAUDECODE: '1', GH_TOKEN: 'secret' };
  return { env, main, worktree };
}

test('an agy seat outside the sandbox gets no GitHub token, and one run from a linked worktree that changes the main checkout fails, keeping the answer', () => {
  const { env, main, worktree } = unboxedSeatMachine();
  const seat = (prompt) => spawnSync(process.execPath, [join(HELPERS, 'cross.mjs'), '--to', 'agy', prompt], { cwd: worktree, encoding: 'utf8', env });
  const clean = seat('review it');
  assert.equal(clean.status, 0, clean.stderr);
  const answer = JSON.parse(clean.stdout);
  assert.equal(answer.token, null, 'the seat never sees the GitHub token');
  assert.equal(answer.readOnly, '1', 'project helpers still see a read-only run');
  const shared = seat(`review it, TOUCH ${join(main, 'shared.txt')}`);
  assert.equal(shared.status, 1);
  assert.match(shared.stderr, /the seat changed the main checkout [^\n]*; check it before using this answer\.\n\n\{"args"/u);
});

function browserMachine({ profiles = ['Ellie QA'], appVersion = '26.1', stubborn = false } = {}) {
  const { dir, home } = sandbox();
  const chrome = join(home, 'Library/Application Support/Google/Chrome');
  mkdirSync(join(chrome, 'NativeMessagingHosts'), { recursive: true });
  writeFileSync(join(chrome, 'NativeMessagingHosts/com.openai.codexextension.json'), '{}');
  const names = {};
  profiles.forEach((name, index) => {
    mkdirSync(join(chrome, `Profile ${index}`));
    writeFileSync(join(chrome, `Profile ${index}/Secure Preferences`), JSON.stringify({ extensions: { settings: { hehggadaopoacecdllhhajmbjkdcmajg: { disable_reasons: [] } } } }));
    names[`Profile ${index}`] = { name };
  });
  writeFileSync(join(chrome, 'Local State'), JSON.stringify({ profile: { info_cache: names } }));
  const app = join(dir, 'ChatGPT.app');
  mkdirSync(join(app, 'Contents'), { recursive: true });
  writeFileSync(join(app, 'Contents/Info.plist'), `<dict><key>CFBundleShortVersionString</key>\n<string>${appVersion}</string></dict>`);
  const plugin = join(home, '.codex/plugins/cache/openai-bundled/unified-computer-use/26.1');
  mkdirSync(plugin, { recursive: true });
  const env = { BROWSER_USE_CODEX_APP_VERSION: '26.1', SKY_CUA_SERVICE_PATH: '/desktop', NODE_REPL_TRUSTED_SERVICES: '{"browser":"b","sky":"s"}', CUA_REPL_ENABLED_SURFACES: 'browser,computer' };
  writeFileSync(join(plugin, '.mcp.json'), JSON.stringify({ mcpServers: { cua_repl: { command: join(app, 'Contents/Resources/node'), args: ['repl.mjs'], env, enabled_tools: ['js'] } } }));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const launched = join(dir, 'launched.json');
  writeFileSync(
    join(bin, 'codex'),
    `#!${process.execPath}
const fs = require('fs');
const args = process.argv.slice(2);
if (args[0] === 'mcp') {
  const off = args.filter((a) => /^mcp_servers\\.\\w+\\.enabled=false$/.test(a)).map((a) => a.split('.')[1]);
  const names = ['Sentry', 'cua_browser', ...(${stubborn} ? ['stubborn'] : [])];
  console.log(JSON.stringify(names.map((name) => ({ name, enabled: name === 'stubborn' || !off.includes(name) }))));
} else {
  fs.writeFileSync(${JSON.stringify(launched)}, JSON.stringify({ args, cwd: process.cwd() }));
  fs.writeFileSync(args[args.indexOf('-o') + 1], 'done');
  console.log(JSON.stringify({ type: 'turn.completed' }));
}
`,
    { mode: 0o755 },
  );
  const events = join(dir, 'events.jsonl');
  const cross = (extra = []) =>
    spawnSync(process.execPath, [join(HELPERS, 'cross.mjs'), '--to', 'codex', '--computer-use', events, '--chrome-profile', 'Ellie QA', ...extra, 'check tasks'], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, HOME: home, CODEX_HOME: join(home, '.codex'), PATH: `${bin}:${process.env.PATH}`, CLAUDECODE: '1' },
    });
  return { dir, chrome, events, launched, cross };
}

const MAC_ONLY = { skip: process.platform !== 'darwin' && 'the browser lane runs only on macOS' };

test('the browser lane runs Codex on one browser-only server with no desktop service or shell, from an empty folder, and saves its events', MAC_ONLY, () => {
  const machine = browserMachine();
  const run = machine.cross();
  assert.equal(run.status, 0, run.stderr);
  const { args, cwd } = JSON.parse(readFileSync(machine.launched, 'utf8'));
  assert.notEqual(realpathSync(cwd), realpathSync(machine.dir));
  assert.ok(args.includes('mcp_servers.Sentry.enabled=false'), args.join(' '));
  const server = args.find((arg) => arg.startsWith('mcp_servers.cua_browser='));
  assert.match(server, /"NODE_REPL_TRUSTED_SERVICES"="{\\"browser\\":\\"@oai\/browser-desktop\/service\\"}"/);
  assert.match(server, /"CUA_REPL_ENABLED_SURFACES"="browser"/);
  assert.doesNotMatch(server, /SKY_CUA_SERVICE_PATH|"sky"/);
  for (const flag of ['shell_tool', 'unified_exec', 'apps', 'remote_plugin', 'skill_mcp_dependency_install']) assert.ok(args.join(' ').includes(`--disable ${flag}`), flag);
  assert.ok(args.includes('--json') && args.includes('--ignore-rules') && args.join(' ').includes('--sandbox read-only'));
  assert.equal(readFileSync(machine.events, 'utf8').trim(), '{"type":"turn.completed"}');
});

test('the browser lane refuses when Codex extension is not enabled in the named Chrome profile', MAC_ONLY, () => {
  const machine = browserMachine({ profiles: ['Main'] });
  const run = machine.cross();
  assert.equal(run.status, 1);
  assert.match(run.stderr, /not enabled in the "Ellie QA" profile; it is enabled in .*\(Main\)/);
  assert.equal(existsSync(machine.launched), false);
});

test('the browser lane refuses when Codex still lists a server it cannot turn off', MAC_ONLY, () => {
  const machine = browserMachine({ stubborn: true });
  const run = machine.cross();
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Codex still enables cua_browser, stubborn/);
  assert.equal(existsSync(machine.launched), false);
});

test('the browser lane refuses when the cached plugin was built for another app version', MAC_ONLY, () => {
  const machine = browserMachine({ appVersion: '26.2' });
  const run = machine.cross();
  assert.equal(run.status, 1);
  assert.match(run.stderr, /cached computer-use plugin is for app 26\.1, but .* is 26\.2/);
  assert.equal(existsSync(machine.launched), false);
});

function browserRun(steps, { code = 'await tab.getAXState();', text = 'Browser tab: 7, Title: "Ellie", URL: "https://next-ellie.vercel.app/tasks".\n0 heading Tasks', extra = [] } = {}) {
  const meta = { 'codex/toolSurface': { extensionInstanceId: 'e1', openTabIds: ['7'] }, browser_use: { url: 'https://next-ellie.vercel.app/tasks' } };
  const call = (id, callCode, callText) => ({ type: 'item.completed', item: { id, type: 'mcp_tool_call', server: 'cua_browser', arguments: { code: callCode }, result: { content: [{ type: 'text', text: callText }], _meta: meta } } });
  return [call('item_1', code, text), ...extra.map((item, index) => ({ type: 'item.completed', item: { id: `x${index}`, ...item } })), { type: 'item.completed', item: { type: 'agent_message', text: `\`\`\`json\n${JSON.stringify(steps)}\n\`\`\`` } }]
    .map((event) => JSON.stringify(event))
    .join('\n');
}

const checkSteps = (events) => {
  const dir = mkdtempSync(join(tmpdir(), 'cua-steps-'));
  writeFileSync(join(dir, 'events.jsonl'), events);
  const run = spawnSync(process.execPath, [join(HELPERS, 'cua-steps.mjs'), join(dir, 'events.jsonl'), '--host', 'next-ellie.vercel.app'], { encoding: 'utf8' });
  return { status: run.status, steps: JSON.parse(run.stdout) };
};

const TASKS_PASS = [{ step: 1, result: 'PASS', url: 'https://next-ellie.vercel.app/tasks', checked: 'Tasks' }];

test('cua-steps keeps a PASS that a page read backs', () => {
  const { status, steps } = checkSteps(browserRun(TASKS_PASS));
  assert.equal(status, 0, JSON.stringify(steps));
  assert.equal(steps[0].result, 'PASS');
});

test('cua-steps downgrades a PASS backed only by text the run wrote itself', () => {
  const { steps } = checkSteps(browserRun(TASKS_PASS, { code: 'nodeRepl.write(`Tasks heading present: ${ok}`)', text: 'Tasks heading present: false' }));
  assert.equal(steps[0].result, 'UNPROVED');
  assert.match(steps[0].reason, /no page read shows "Tasks"/);
});

test('cua-steps voids every PASS in a run that listed tabs', () => {
  const { steps } = checkSteps(browserRun(TASKS_PASS, { code: 'await cua.listTabs({browser:"chrome"}); await tab.getAXState();' }));
  assert.equal(steps[0].result, 'UNPROVED');
  assert.match(steps[0].reason, /ran forbidden code/);
});

test('cua-steps voids every PASS in a run that ran a shell command', () => {
  const { steps } = checkSteps(browserRun(TASKS_PASS, { extra: [{ type: 'command_execution', command: 'id' }] }));
  assert.equal(steps[0].result, 'UNPROVED');
  assert.match(steps[0].reason, /ran a command_execution item/);
});

test('cua-steps voids every PASS in a run that reached a host outside the list', () => {
  const { steps } = checkSteps(browserRun(TASKS_PASS, { text: 'Browser tab: 7, Title: "QA", URL: "https://qa.example.com/tasks".\n0 heading Tasks' }));
  assert.equal(steps[0].result, 'UNPROVED');
  assert.match(steps[0].reason, /reached qa\.example\.com/);
});

test('cua-steps downgrades a PASS whose URL the runtime never reported', () => {
  const { steps } = checkSteps(browserRun([{ ...TASKS_PASS[0], url: 'https://next-ellie.vercel.app/tasks?search=x' }]));
  assert.equal(steps[0].result, 'UNPROVED');
  assert.match(steps[0].reason, /no page the runtime reported/);
});

test('cross refuses the retired write, events and resume flags before launching Codex', () => {
  const { dir, home } = sandbox();
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const launched = join(dir, 'launched');
  writeFileSync(join(bin, 'codex'), `#!/bin/sh\ntouch ${launched}\nwhile [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2 ;; *) shift ;; esac; done\necho ok > "$out"\n`, { mode: 0o755 });
  const run = (flags) =>
    spawnSync(process.execPath, [join(HELPERS, 'cross.mjs'), '--to', 'codex', ...flags, 'build it'], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, CLAUDECODE: '1' },
    });
  for (const flags of [['--write'], ['--events', join(dir, 'e.jsonl')], ['--resume', 't-1']]) {
    const result = run(flags);
    assert.equal(existsSync(launched), false, `${flags.join(' ')} launched Codex`);
    assert.equal(result.status, 2, flags.join(' '));
    assert.match(result.stderr, /is retired: cross\.mjs runs Codex read-only, or with no sandbox under --bypass/);
  }
  assert.equal(run([]).status, 0, 'the same call without a retired flag launches');
  assert.equal(existsSync(launched), true);
});

test('cross sets no time limit of its own, and stops only a run that shows no sign of work', () => {
  const { dir, home } = sandbox();
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const answer = 'while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2 ;; *) shift ;; esac; done\n';
  const fakes = {
    silent: '#!/bin/sh\nsleep 30\n',
    busy: `#!/bin/sh\n${answer}for i in 1 2 3 4 5 6 7 8 9 10; do echo step >&2; sleep 0.3; done\necho worked > "$out"\n`,
  };
  const ask = (fake, runtime = 'codex') => {
    writeFileSync(join(bin, runtime), fakes[fake] ?? fake, { mode: 0o755 });
    const drive = join(dir, 'drive.mjs');
    writeFileSync(drive, `import { ask } from ${JSON.stringify(pathToFileURL(join(HELPERS, 'cross.mjs')).href)};\nconsole.log(JSON.stringify(await ask(${JSON.stringify(runtime)}, 'review it', { cwd: process.cwd(), idle: 1 })));\n`);
    const run = spawnSync(process.execPath, [drive], { cwd: dir, encoding: 'utf8', env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, CLAUDECODE: '' } });
    assert.equal(run.status, 0, run.stderr);
    return JSON.parse(run.stdout);
  };
  const silent = ask('silent');
  assert.equal(silent.ok, false);
  assert.match(silent.text, /^no sign of work for 1 seconds: /u);
  const busy = ask('busy');
  assert.deepEqual([busy.ok, busy.text], [true, 'worked'], 'a run that keeps printing outlives the idle limit');
  const transcripts = join(home, '.claude/projects/p');
  const writing = `#!/bin/sh\nwhile [ $# -gt 0 ]; do case "$1" in --session-id) id="$2"; shift 2 ;; *) shift ;; esac; done\nmkdir -p ${transcripts}\nfor i in 1 2 3 4 5 6 7 8 9 10; do echo '{}' >> ${transcripts}/$id.jsonl; sleep 0.3; done\necho reviewed\n`;
  assert.deepEqual(ask(writing, 'claude'), { runtime: 'claude', ok: true, text: 'reviewed', seat: 'opus @default' }, 'a Claude run that only writes its transcript outlives the idle limit');
});

test('a stopped cross run kills a runtime that ignores SIGTERM, and deletes its folders', async () => {
  const { dir, home } = sandbox();
  const bin = join(dir, 'bin');
  const temp = join(dir, 'temp');
  mkdirSync(bin);
  mkdirSync(temp);
  const pidFile = join(dir, 'codex.pid');
  writeFileSync(join(bin, 'codex'), `#!/bin/sh\ntrap '' TERM\necho $$ > ${pidFile}\nwhile :; do sleep 1; done\n`, { mode: 0o755 });
  const cross = spawn(process.execPath, [join(HELPERS, 'cross.mjs'), '--to', 'codex', '--reach', 'review it'], {
    cwd: dir,
    env: { ...process.env, HOME: home, TMPDIR: temp, PATH: `${bin}:${process.env.PATH}`, CLAUDECODE: '' },
  });
  const deadline = Date.now() + 10000;
  while (!existsSync(pidFile) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
  const pid = Number(readFileSync(pidFile, 'utf8'));
  cross.kill('SIGTERM');
  await new Promise((resolve) => cross.on('exit', resolve));
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.throws(() => process.kill(pid, 0), /ESRCH/, 'a runtime that ignores SIGTERM outlived its stopped parent');
  assert.deepEqual(readdirSync(temp), []);
});

test('cross deletes its answer and scratch folders once a run ends', () => {
  const { dir, home } = sandbox();
  const bin = join(dir, 'bin');
  const temp = join(dir, 'temp');
  mkdirSync(bin);
  mkdirSync(temp);
  writeFileSync(join(bin, 'codex'), '#!/bin/sh\nwhile [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2 ;; *) shift ;; esac; done\necho "No findings." > "$out"\n', { mode: 0o755 });
  for (const lane of [[], ['--reach']]) {
    const seat = spawnSync(process.execPath, [join(HELPERS, 'cross.mjs'), '--to', 'codex', ...lane, 'review it'], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, HOME: home, TMPDIR: temp, PATH: `${bin}:${process.env.PATH}`, CLAUDECODE: '' },
    });
    assert.equal(seat.status, 0, seat.stderr);
    assert.equal(seat.stdout.trim(), 'No findings.');
    assert.deepEqual(readdirSync(temp), [], lane.join(' '));
  }
});

test('a cross run that answers stops what its runtime left running, in its process group or out of it', (t) => {
  realPs(t);
  const { dir, home } = sandbox();
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const idle = join(dir, 'idle.mjs');
  const pidFile = join(dir, 'left.pids');
  writeFileSync(idle, 'setTimeout(() => {}, 30000);\n');
  writeFileSync(
    join(bin, 'codex'),
    `#!/usr/bin/env node
const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const args = process.argv.slice(2);
const left = [false, true].map((detached) => spawn(process.execPath, [${JSON.stringify(idle)}], { detached, stdio: 'ignore' }));
for (const child of left) child.unref();
writeFileSync(${JSON.stringify(pidFile)}, left.map((child) => child.pid).join(' '));
writeFileSync(args[args.indexOf('-o') + 1], 'No findings.');
`,
    { mode: 0o755 },
  );
  const seat = spawnSync(process.execPath, [join(HELPERS, 'cross.mjs'), '--to', 'codex', '--reach', 'review it'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, CLAUDECODE: '' },
  });
  assert.equal(seat.status, 0, seat.stderr);
  assert.equal(seat.stdout.trim(), 'No findings.');
  for (const pid of readFileSync(pidFile, 'utf8').split(' ').map(Number)) {
    assert.throws(() => process.kill(pid, 0), /ESRCH/, `process ${pid} outlived the seat that started it`);
  }
});

test('cross passes a prompt that starts with dashes as the prompt, and gives up on a runtime that ignores its timeout', () => {
  const { dir, home } = sandbox();
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\nfor arg; do last="$arg"; done\necho "prompt=[$last] terminated=$([ \"$(eval echo \\${$(($#-1))})\" = \"--\" ] && echo yes || echo no)"\n', { mode: 0o755 });
  writeFileSync(join(bin, 'codex'), "#!/bin/sh\ntrap '' TERM\nsleep 30\n", { mode: 0o755 });
  const cross = (args) =>
    spawnSync(process.execPath, [join(HELPERS, 'cross.mjs'), ...args], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, CLAUDECODE: '' },
    });
  assert.equal(cross(['--to', 'claude', '--help me review']).stdout.trim(), 'prompt=[--help me review] terminated=yes');
  const started = Date.now();
  const hung = cross(['--to', 'codex', '--timeout', '1', 'review it']);
  assert.equal(hung.status, 1);
  assert.ok(Date.now() - started < 15000, `took ${Date.now() - started} ms`);
  assert.match(hung.stderr, /^no answer within 1 seconds: /mu);
});

test('cross reports a runtime that exits on its deadline as out of time, not as its exit code', () => {
  const { dir, home } = sandbox();
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'codex'), "#!/bin/sh\ntrap 'exit 143' TERM\nsleep 30 &\nwait\n", { mode: 0o755 });
  const late = spawnSync(process.execPath, [join(HELPERS, 'cross.mjs'), '--to', 'codex', '--timeout', '1', 'review it'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, CLAUDECODE: '' },
  });
  assert.equal(late.status, 1);
  assert.match(late.stderr, /^no answer within 1 seconds: /mu, late.stderr);
});

test('cross reports an answer a runtime writes once its deadline stops it as out of time', () => {
  const { dir, home } = sandbox();
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'codex'), "#!/bin/sh\nwhile [ $# -gt 0 ]; do case \"$1\" in -o) out=\"$2\"; shift 2 ;; *) shift ;; esac; done\ntrap 'echo late answer > \"$out\"; exit 0' TERM\nsleep 30 &\nwait\n", { mode: 0o755 });
  const late = spawnSync(process.execPath, [join(HELPERS, 'cross.mjs'), '--to', 'codex', '--timeout', '1', 'review it'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, CLAUDECODE: '' },
  });
  assert.equal(late.status, 1, late.stdout);
  assert.match(late.stderr, /^no answer within 1 seconds: /mu, late.stderr);
});

test('cross keeps the exit code of a runtime that failed before its deadline while a child it left holds the pipes', () => {
  const { dir, home } = sandbox();
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'codex'), '#!/bin/sh\nsleep 30 &\necho own failure >&2\nexit 7\n', { mode: 0o755 });
  const failed = spawnSync(process.execPath, [join(HELPERS, 'cross.mjs'), '--to', 'codex', '--timeout', '1', 'review it'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, CLAUDECODE: '' },
  });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /^exit 7: own failure$/mu, failed.stderr);
});

// A fake `codex exec` that fails the way Codex 0.169 does: its session log names
// the error's kind, and connector warnings follow the `ERROR:` line on stderr.
const refusingCodex = (bin, kind) => {
  const id = '019a8c3e-1f2b-7ae0-8c9b-00000000c0de';
  const event = JSON.stringify({ type: 'event_msg', payload: { type: 'task_complete', error: { message: 'This content was flagged for possible cybersecurity risk.', codex_error_info: kind } } });
  const script = [
    '#!/bin/sh',
    'day="${CODEX_HOME:-$HOME/.codex}/sessions/$(date +%Y/%m/%d)"',
    'mkdir -p "$day"',
    `echo '${event}' > "$day/rollout-2026-11-19T08-36-09-${id}.jsonl"`,
    `echo "session id: ${id}" >&2`,
    'echo \'ERROR:  relation "missing" does not exist\' >&2',
    'echo "ERROR: This content was flagged for possible cybersecurity risk." >&2',
    'for n in 1 2 3 4 5 6; do echo "WARN codex_mcp::rmcp_client: shutdown $n" >&2; done',
    'exit 1',
    '',
  ].join('\n');
  writeFileSync(join(bin, 'codex'), script, { mode: 0o755 });
};

test("cross names a Codex refusal by its session log's message, and marks a security refusal wherever Codex keeps its home", () => {
  for (const [kind, refused, lane, codexHome] of [
    ['cyber_policy', true, [], ''],
    ['usage_limit_exceeded', false, [], ''],
    ['cyber_policy', true, ['--reach'], '.'],
  ]) {
    const label = `${kind} ${lane.join(' ')} CODEX_HOME=${codexHome}`;
    const { dir, home } = sandbox();
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    refusingCodex(bin, kind);
    const seat = spawnSync(process.execPath, [join(HELPERS, 'cross.mjs'), '--to', 'codex', ...lane, '--model', 'gpt-6.1-sol', 'review it'], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, HOME: home, CODEX_HOME: codexHome, PATH: `${bin}:${process.env.PATH}`, CLAUDECODE: '' },
    });
    assert.equal(seat.status, 1, label);
    assert.match(seat.stderr, /^exit 1: This content was flagged for possible cybersecurity risk\.$/mu, `${label}\n${seat.stderr}`);
    assert.doesNotMatch(seat.stderr, /shutdown|relation/u, label);
    assert.equal(/^refused: security$/mu.test(seat.stderr), refused, label);
  }
});

test('seats skips a Codex seat its provider refuses for security, and fails a round where no seat answered', () => {
  const { dir, home } = sandbox();
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\necho "claude: found one gap"\n', { mode: 0o755 });
  refusingCodex(bin, 'cyber_policy');
  const answers = join(dir, 'answers');
  const seats = (folder, ...roster) =>
    spawnSync(process.execPath, [join(HELPERS, 'seats.mjs'), '--dir', folder, '--prompt', 'Break this diff.', ...roster], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, HOME: home, CODEX_HOME: '', PATH: `${bin}:${process.env.PATH}`, CLAUDECODE: '' },
    });
  const round = seats(answers, 'opus=claude:opus', 'sol=codex:gpt-6.1-sol');
  assert.equal(round.status, 0, round.stdout);
  assert.match(round.stdout, /^sol: skipped, its provider refused the prompt for security, seat: gpt-6\.1-sol @default$/mu);
  assert.match(readFileSync(join(answers, 'sol.err'), 'utf8'), /^refused: security$/mu);
  const unwritable = join(dir, 'unwritable');
  mkdirSync(join(unwritable, 'sol.md'), { recursive: true });
  const unwritten = seats(unwritable, 'opus=claude:opus', 'sol=codex:gpt-6.1-sol');
  assert.equal(unwritten.status, 1, 'a refused seat whose answer file cannot be written');
  assert.match(unwritten.stdout, /^sol: failed, EISDIR/mu, unwritten.stdout);
  assert.equal(seats(answers, 'sol=codex:gpt-6.1-sol').status, 1, 'a round whose only seat was refused has no answer');
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  assert.equal(seats(answers, 'opus=claude:opus', 'sol=codex:gpt-6.1-sol').status, 1, 'a failed seat beside a refused one');
});

test('seats runs a Codex seat on its fallback when Codex is missing or past its limit, and fails one without a fallback', () => {
  const { dir, home } = sandbox();
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\necho "claude: found one gap"\n', { mode: 0o755 });
  writeFileSync(join(bin, 'codex'), '#!/bin/sh\necho "codex: not logged in" >&2\nexit 1\n', { mode: 0o755 });
  const seats = (folder, ...roster) =>
    spawnSync(process.execPath, [join(HELPERS, 'seats.mjs'), '--dir', folder, '--prompt', 'Break this diff.', ...roster], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, HOME: home, CODEX_HOME: '', PATH: `${bin}:${process.env.PATH}`, CLAUDECODE: '' },
    });
  const missing = join(dir, 'missing');
  const round = seats(missing, 'opus=claude:opus', 'astra=codex:gpt-6.2-astra@high|claude:fable@high');
  assert.equal(round.status, 0, round.stdout);
  assert.match(round.stdout, /^astra: ok, on its fallback fable after gpt-6\.2-astra failed/mu, round.stdout);
  assert.match(readFileSync(join(missing, 'astra.md'), 'utf8'), /found one gap/u);
  assert.match(readFileSync(join(missing, 'astra.err'), 'utf8'), /^fallback: claude:fable@high, after gpt-6\.2-astra failed/mu);
  assert.equal(seats(join(dir, 'bare'), 'opus=claude:opus', 'astra=codex:gpt-6.2-astra@high').status, 1, 'a failed Codex seat without a fallback still fails the round');
  refusingCodex(bin, 'usage_limit_exceeded');
  const limited = seats(join(dir, 'limited'), 'opus=claude:opus', 'sol=codex:gpt-6.2-sol@xhigh|claude:opus@high');
  assert.equal(limited.status, 0, limited.stdout);
  assert.match(limited.stdout, /^sol: ok, on its fallback opus after gpt-6\.2-sol failed/mu, 'a seat past its usage limit runs its fallback instead of being skipped');
});

test('cross reports why a runtime failed when it prints the reason on stdout', () => {
  const { dir, home } = sandbox();
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'claude'), "#!/bin/sh\necho \"You've hit your weekly limit\"\nexit 1\n", { mode: 0o755 });
  const failed = spawnSync(process.execPath, [join(HELPERS, 'cross.mjs'), '--to', 'claude', 'review it'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, CLAUDECODE: '' },
  });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /^exit 1: You've hit your weekly limit$/mu);
});

test('cross prints its usage for --help and refuses an unknown flag, launching no runtime', () => {
  const { dir, home } = sandbox();
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const launched = join(dir, 'launched');
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\ntouch ${launched}\nfor arg; do last="$arg"; done\necho "prompt=[$last]"\n`, { mode: 0o755 });
  const cross = (args) =>
    spawnSync(process.execPath, [join(HELPERS, 'cross.mjs'), '--to', 'claude', ...args], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, CLAUDECODE: '' },
    });

  for (const flag of ['--help', '-h']) {
    const help = cross([flag]);
    assert.equal(help.status, 0, flag);
    assert.match(help.stdout, /^Usage: node \.agents\/pstack\/cross\.mjs /u, flag);
  }
  for (const flag of ['--modle', '-?', '---model']) {
    const unknown = cross([flag, 'review it']);
    assert.equal(unknown.status, 2, flag);
    assert.ok(unknown.stderr.startsWith(`unknown flag ${flag}\nUsage: node .agents/pstack/cross.mjs `), unknown.stderr);
  }
  const flagAsValue = cross(['--effort', '--modle', 'review it']);
  assert.equal(flagAsValue.status, 2);
  assert.match(flagAsValue.stderr, /^--effort needs a value\nUsage: node \.agents\/pstack\/cross\.mjs /u);
  writeFileSync(join(dir, 'brief.md'), 'review it');
  for (const args of [['--prompt', 'named', 'positional'], ['--prompt', 'named', '--prompt-file', 'brief.md'], ['positional', '--prompt-file', 'brief.md'], ['first', 'second']]) {
    const conflict = cross(args);
    assert.equal(conflict.status, 2, args.join(' '));
    assert.match(conflict.stderr, /^give one prompt: a positional prompt, --prompt or --prompt-file\n/u, args.join(' '));
  }
  const twice = cross(['--prompt', 'a', '--prompt', 'b']);
  assert.equal(twice.status, 2);
  assert.match(twice.stderr, /^--prompt given twice\n/u);
  assert.equal(existsSync(launched), false, 'a help, unknown-flag or flag-as-value call launched a runtime');

  const prompted = cross(['review it']);
  assert.equal(prompted.status, 0, prompted.stderr);
  assert.equal(prompted.stdout.trim(), 'prompt=[review it]');
  const named = cross(['--prompt', 'review it']);
  assert.equal(named.status, 0, named.stderr);
  assert.equal(named.stdout.trim(), 'prompt=[review it]');
  assert.equal(existsSync(launched), true);
});
