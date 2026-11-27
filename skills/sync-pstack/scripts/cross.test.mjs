import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { realPs } from './test-ps.mjs';
import { sandbox } from './test-sandbox.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HELPERS = join(HERE, '../assets/pstack');

test('cross routes between Claude and Codex, enforces read-only/maxEffort/--bypass/--reach/retired/help flags, and streams >64KB replies', () => {
  const { dir, home } = sandbox();
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\n[ -n "$FAIL_CLAUDE" ] && { echo "You\'ve hit your weekly limit"; exit 1; }\necho "claude: $*"\n', { mode: 0o755 });
  writeFileSync(
    join(bin, 'codex'),
    '#!/bin/sh\nargs="$*"\nwhile [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2 ;; *) last="$1"; shift ;; esac; done\nif [ -n "$BIG_CODEX" ]; then head -c 100000 /dev/zero | tr "\\000" a > "$out"; else printf "%s\\ncwd=%s\\nprofile=%s\\nro=%s\\n" "$args" "$PWD" "$CODEX_PERMISSION_PROFILE" "${PSTACK_READ_ONLY:-unset}" > "$out"; fi\n',
    { mode: 0o755 },
  );
  const run = (args, extraEnv = {}) =>
    spawnSync(process.execPath, [join(HELPERS, 'cross.mjs'), ...args], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, CLAUDECODE: '', ...extraEnv },
    });

  // Prompt file routing both directions + dash-prefixed prompt.
  writeFileSync(join(dir, 'brief.md'), 'Review docs/plans/x.md for gaps.');
  assert.match(run(['--prompt-file', join(dir, 'brief.md')], { CLAUDECODE: '1' }).stdout, /--sandbox read-only .*Review docs\/plans\/x\.md/);
  const fromCodex = run(['--prompt-file', join(dir, 'brief.md')]);
  assert.equal(fromCodex.stdout.trim().replace(/--session-id [\da-f-]{36} /u, ''), 'claude: -p --model opus --settings {"disableAllHooks":true} --permission-mode plan -- Review docs/plans/x.md for gaps.');
  assert.match(fromCodex.stderr, /^seat: opus @default$/mu);
  assert.match(run(['--to', 'claude', '--help me review']).stdout.trim(), /-- --help me review$/);

  // >64KB reply intact + stdout failure reporting.
  assert.equal(run(['--to', 'codex', 'review it'], { BIG_CODEX: '1' }).stdout.trim().length, 100000);
  const claudeFail = run(['--to', 'claude', 'review it'], { FAIL_CLAUDE: '1' });
  assert.equal(claudeFail.status, 1);
  assert.match(claudeFail.stderr, /^exit 1: You've hit your weekly limit$/mu);

  // Effort cap from .agents/pstack.json.
  mkdirSync(join(dir, '.agents'));
  writeFileSync(join(dir, '.agents/pstack.json'), JSON.stringify({ maxEffort: 'high' }));
  assert.match(run(['--to', 'codex', '--model', 'gpt-6.1-sol', '--effort', 'xhigh', 'review it']).stdout, /-c model_reasoning_effort=high /);
  assert.match(run(['--to', 'codex', '--model', 'gpt-6.1-sol', 'review it']).stdout, /-c model_reasoning_effort=high /);

  // --bypass and --reach lanes + mutually exclusive / retired / unknown flags.
  const worker = run(['--to', 'codex', '--bypass', 'research it'], { PSTACK_READ_ONLY: '1' });
  assert.equal(worker.status, 0, worker.stderr);
  assert.match(worker.stdout, /^exec -m gpt-6\.2-sol -c model_reasoning_effort=high --dangerously-bypass-approvals-and-sandbox /u);
  assert.match(worker.stdout, /^ro=unset$/mu);

  const reach = run(['--to', 'codex', '--reach', '--model', 'gpt-6-astra', 'review it'], { CODEX_PERMISSION_PROFILE: ':danger-full-access' });
  assert.equal(reach.status, 0, reach.stderr);
  assert.match(reach.stdout, /--sandbox workspace-write -c sandbox_workspace_write\.network_access=true/);
  assert.match(reach.stdout, /^cwd=\S*pstack-reach-\S+$/mu);
  assert.match(reach.stdout, /^profile=$/mu);

  assert.equal(run(['--help']).status, 0);
  for (const bad of [['--to', 'claude', '--bypass', 'x'], ['--to', 'codex', '--reach', '--bypass', 'x'], ['--to', 'codex', '--write', 'x'], ['--to', 'codex', '--resume', 't-1', 'x'], ['--to', 'claude', '--modle', 'x'], ['--to', 'claude', '--prompt', 'a', 'b']]) {
    assert.equal(run(bad).status, 2, bad.join(' '));
  }
});

const FAKE_AGY = '#!/usr/bin/env node\nconsole.log(JSON.stringify({ event: "result", result: { status: "success", response: JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), token: process.env.GH_TOKEN ?? null, readOnly: process.env.PSTACK_READ_ONLY ?? null }) } }));\n';

test('cross and seats run agy seats (online/offline, no GH_TOKEN, dirty main checkout refusal) and handle provider refusals and fallbacks', () => {
  const { dir, home } = sandbox();
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'agy'), FAKE_AGY, { mode: 0o755 });
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\necho "claude: $*"\n', { mode: 0o755 });
  const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, CLAUDECODE: '1', GH_TOKEN: 'secret' };

  // Online agy seat strips GH_TOKEN, sets PSTACK_READ_ONLY=1, deletes scratch dir after run.
  const seat = spawnSync(process.execPath, [join(HELPERS, 'cross.mjs'), '--to', 'agy', '--effort', 'xhigh', 'review it'], { cwd: dir, encoding: 'utf8', env });
  assert.equal(seat.status, 0, seat.stderr);
  const parsed = JSON.parse(seat.stdout);
  assert.equal(existsSync(parsed.cwd), false);
  assert.equal(parsed.token, null);
  assert.equal(parsed.readOnly, '1');
  assert.equal(parsed.args[parsed.args.indexOf('--model') + 1], 'gemini-4-neon-xhigh');
  assert.match(seat.stderr, /^seat: gemini-4-neon @xhigh$/mu);

  // Offline seats.mjs passes --sandbox, denies writes to project & read-dir, adds plan-mode brief to Claude only.
  mkdirSync(join(dir, 'transcripts'));
  const answers = join(dir, 'answers');
  const seats = (folder, extra, ...roster) =>
    spawnSync(process.execPath, [join(HELPERS, 'seats.mjs'), '--dir', folder, '--prompt', 'Break this diff.', ...extra, ...roster], { cwd: dir, encoding: 'utf8', env: { ...env, CODEX_HOME: '' } });

  const off = seats(answers, ['--offline', '--read-dir', join(dir, 'transcripts')], 'neon=agy:gemini-4-neon@high', 'opus=claude:opus');
  assert.equal(off.status, 0, off.stderr);
  const neonArgs = JSON.parse(readFileSync(join(answers, 'neon.md'), 'utf8')).args;
  assert.ok(neonArgs.includes('--sandbox') && !neonArgs.includes('--dangerously-skip-permissions'));
  assert.deepEqual(JSON.parse(neonArgs[neonArgs.indexOf('--settings') + 1]).permissions.deny, [`write_file(${realpathSync(dir)})`, `write_file(${realpathSync(join(dir, 'transcripts'))})`, 'execute_url(*)', 'read_url(*)', 'mcp(*)']);
  assert.match(readFileSync(join(answers, 'opus.md'), 'utf8'), /You run in plan mode[\s\S]*Break this diff\./u);

  // Gemini safety filter and quota errors are skipped cleanly.
  writeFileSync(join(bin, 'agy'), "#!/bin/sh\necho \"This request was blocked by Gemini's filters.\"\n", { mode: 0o755 });
  assert.match(seats(answers, [], 'neon=agy:gemini-4-neon@high', 'opus=claude:opus').stdout, /^neon: skipped, its provider refused the prompt for safety/mu);
  writeFileSync(join(bin, 'agy'), '#!/bin/sh\necho "error: Individual quota reached." >&2\nexit 3\n', { mode: 0o755 });
  assert.match(seats(answers, [], 'neon=agy:gemini-4-neon@high', 'opus=claude:opus').stdout, /^neon: skipped, exit 3:/mu);

  // Codex security refusal vs usage limit fallback.
  const refusingCodex = (kind) => {
    const id = '019a8c3e-1f2b-7ae0-8c9b-00000000c0de';
    const event = JSON.stringify({ type: 'event_msg', payload: { type: 'task_complete', error: { message: 'This content was flagged for possible cybersecurity risk.', codex_error_info: kind } } });
    writeFileSync(join(bin, 'codex'), `#!/bin/sh\nday="\${CODEX_HOME:-$HOME/.codex}/sessions/$(date +%Y/%m/%d)"\nmkdir -p "$day"\necho '${event}' > "$day/rollout-2026-11-19T08-36-09-${id}.jsonl"\necho "session id: ${id}" >&2\necho "ERROR: This content was flagged for possible cybersecurity risk." >&2\nexit 1\n`, { mode: 0o755 });
  };
  refusingCodex('cyber_policy');
  const sec = seats(join(dir, 'sec'), [], 'opus=claude:opus', 'sol=codex:gpt-6.1-sol');
  assert.equal(sec.status, 0, sec.stdout);
  assert.match(sec.stdout, /^sol: skipped, its provider refused the prompt for security/mu);
  assert.equal(seats(join(dir, 'only-sec'), [], 'sol=codex:gpt-6.1-sol').status, 1);

  refusingCodex('usage_limit_exceeded');
  const fb = seats(join(dir, 'fb'), [], 'opus=claude:opus', 'sol=codex:gpt-6.2-sol@xhigh|claude:opus@high');
  assert.equal(fb.status, 0, fb.stdout);
  assert.match(fb.stdout, /^sol: ok, on its fallback opus after gpt-6\.2-sol failed/mu);
  const skipLimit = seats(join(dir, 'skip-limit'), [], 'opus=claude:opus', 'astra=codex:gpt-6.2-astra@high');
  assert.equal(skipLimit.status, 0, skipLimit.stdout);
  assert.match(skipLimit.stdout, /^astra: skipped, its usage limit ran out/mu);
  assert.equal(seats(join(dir, 'only-limit'), [], 'astra=codex:gpt-6.2-astra@high').status, 1);

  writeFileSync(join(bin, 'codex'), '#!/bin/sh\necho "not logged in" >&2\nexit 1\n', { mode: 0o755 });
  const skipUnavailable = seats(join(dir, 'skip-unavail'), [], 'opus=claude:opus', 'sol=codex:gpt-6.2-sol@xhigh');
  assert.equal(skipUnavailable.status, 0, skipUnavailable.stdout);
  assert.match(skipUnavailable.stdout, /^sol: skipped, exit 1:/mu);
  assert.equal(seats(join(dir, 'only-unavail'), [], 'sol=codex:gpt-6.2-sol@xhigh').status, 1);

  // Unboxed agy seat from a linked worktree fails if it dirties the main checkout.
  const git = (cwd, ...args) => spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  const main = join(dir, 'main');
  git(dir, 'init', '-q', main);
  writeFileSync(join(main, 'a.txt'), 'a');
  git(main, 'add', 'a.txt');
  git(main, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'a');
  git(main, 'worktree', 'add', '-q', '-b', 'task', join(dir, 'task'));
  writeFileSync(join(bin, 'agy'), `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(join(main, 'shared.txt'))}, 'stray');\nconsole.log(JSON.stringify({ event: 'result', result: { status: 'success', response: 'ok' } }));\n`, { mode: 0o755 });
  const dirty = spawnSync(process.execPath, [join(HELPERS, 'cross.mjs'), '--to', 'agy', 'review it'], { cwd: join(dir, 'task'), encoding: 'utf8', env });
  assert.equal(dirty.status, 1);
  assert.match(dirty.stderr, /the seat changed the main checkout/);
});

test('cross enforces idle watchdog, timeout kill, exit code with lingering child, SIGTERM cleanup, and orphan process reaping', async (t) => {
  realPs(t);
  const { dir, home } = sandbox();
  const bin = join(dir, 'bin');
  const temp = join(dir, 'temp');
  mkdirSync(bin);
  mkdirSync(temp);
  const env = { ...process.env, HOME: home, TMPDIR: temp, PATH: `${bin}:${process.env.PATH}`, CLAUDECODE: '' };

  // Idle watchdog stops silent runtime and allows active stdout/transcript runtime.
  const drive = join(dir, 'drive.mjs');
  const ask = (runtime, script) => {
    writeFileSync(join(bin, runtime), script, { mode: 0o755 });
    writeFileSync(drive, `import { ask } from ${JSON.stringify(pathToFileURL(join(HELPERS, 'cross.mjs')).href)};\nconsole.log(JSON.stringify(await ask(${JSON.stringify(runtime)}, 'review it', { cwd: process.cwd(), idle: 1 })));\n`);
    const run = spawnSync(process.execPath, [drive], { cwd: dir, encoding: 'utf8', env });
    assert.equal(run.status, 0, run.stderr);
    return JSON.parse(run.stdout);
  };
  assert.match(ask('codex', '#!/bin/sh\nsleep 30\n').text, /^no sign of work for 1 seconds: /u);
  assert.deepEqual(
    ask('codex', '#!/bin/sh\nwhile [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2 ;; *) shift ;; esac; done\nfor i in 1 2 3 4; do echo step >&2; sleep 0.35; done\necho worked > "$out"\n'),
    { runtime: 'codex', ok: true, text: 'worked', seat: 'gpt-6.2-sol @default' },
  );

  // Timeout kills a stubborn runtime that traps TERM (and ignores a late answer written on TERM).
  writeFileSync(join(bin, 'codex'), '#!/bin/sh\nwhile [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2 ;; *) shift ;; esac; done\ntrap \'echo late > "$out"; exit 0\' TERM\nsleep 30 &\nwait\n', { mode: 0o755 });
  const late = spawnSync(process.execPath, [join(HELPERS, 'cross.mjs'), '--to', 'codex', '--timeout', '1', 'review it'], { cwd: dir, encoding: 'utf8', env });
  assert.equal(late.status, 1);
  assert.match(late.stderr, /^no answer within 1 seconds: /mu);

  // Runtime that fails before deadline keeps exit code even if child holds pipes.
  writeFileSync(join(bin, 'codex'), '#!/bin/sh\nsleep 30 &\necho own failure >&2\nexit 7\n', { mode: 0o755 });
  const failed = spawnSync(process.execPath, [join(HELPERS, 'cross.mjs'), '--to', 'codex', '--timeout', '1', 'review it'], { cwd: dir, encoding: 'utf8', env });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /^exit 7: own failure$/mu);

  // Completed run reaps detached & attached orphan descendants and removes temp dirs.
  const idleScript = join(dir, 'idle.mjs');
  const pidFile = join(dir, 'left.pids');
  writeFileSync(idleScript, 'setTimeout(() => {}, 30000);\n');
  writeFileSync(
    join(bin, 'codex'),
    `#!/usr/bin/env node
const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const args = process.argv.slice(2);
const left = [false, true].map((detached) => spawn(process.execPath, [${JSON.stringify(idleScript)}], { detached, stdio: 'ignore' }));
for (const child of left) child.unref();
writeFileSync(${JSON.stringify(pidFile)}, left.map((c) => c.pid).join(' '));
writeFileSync(args[args.indexOf('-o') + 1], 'No findings.');
`,
    { mode: 0o755 },
  );
  const done = spawnSync(process.execPath, [join(HELPERS, 'cross.mjs'), '--to', 'codex', '--reach', 'review it'], { cwd: dir, encoding: 'utf8', env });
  assert.equal(done.status, 0, done.stderr);
  assert.equal(done.stdout.trim(), 'No findings.');
  for (const pid of readFileSync(pidFile, 'utf8').split(' ').map(Number)) assert.throws(() => process.kill(pid, 0), /ESRCH/);
  assert.deepEqual(readdirSync(temp), []);

  // SIGTERM on cross.mjs kills a runtime that ignores SIGTERM and cleans temp dirs.
  const codexPid = join(dir, 'codex.pid');
  writeFileSync(join(bin, 'codex'), `#!/bin/sh\ntrap '' TERM\necho $$ > ${codexPid}\nwhile :; do sleep 1; done\n`, { mode: 0o755 });
  const child = spawn(process.execPath, [join(HELPERS, 'cross.mjs'), '--to', 'codex', '--reach', 'review it'], { cwd: dir, env });
  const deadline = Date.now() + 10000;
  while (!existsSync(codexPid) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  const pid = Number(readFileSync(codexPid, 'utf8'));
  child.kill('SIGTERM');
  await new Promise((r) => child.on('exit', r));
  await new Promise((r) => setTimeout(r, 300));
  assert.throws(() => process.kill(pid, 0), /ESRCH/);
  assert.deepEqual(readdirSync(temp), []);
});
