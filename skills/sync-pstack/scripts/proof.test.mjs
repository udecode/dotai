import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { read } from './test-sandbox.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HELPERS = join(HERE, '../assets/pstack');

process.env.TMPDIR = mkdtempSync(join(tmpdir(), 'sync-pstack-proof-pool-'));
delete process.env.PSTACK_SLOT;

const unbooted = (log) => log.replace(/^boot=\d{4}-\d\d-\d\dT[\d:.]+Z\n/mu, '');
const until = async (done) => {
  for (const begun = Date.now(); !done() && Date.now() - begun < 10_000; ) await new Promise((wake) => setTimeout(wake, 50));
};
const gone = async (pid) => {
  const alive = () => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  await until(() => !alive());
  return !alive();
};

const corePool = (prefix, holders) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const env = { ...process.env, TMPDIR: join(dir, 'tmp') };
  delete env.PSTACK_SLOT;
  mkdirSync(join(dir, 'tmp/pstack-slots'), { recursive: true });
  for (const holder of holders) writeFileSync(join(dir, `tmp/pstack-slots/${holder.pid}.json`), JSON.stringify({ label: 'other session', ...holder }));
  const args = (name, command) => [join(HELPERS, 'proof.mjs'), '--dir', join(dir, 'run'), '--name', name, '--timeout', '30', '--', command];
  return { dir, env, args };
};

const idle = spawn('sleep', ['3600'], { stdio: 'ignore' });
idle.unref();
process.on('exit', () => idle.kill());

const background = (argv, options) => {
  const proof = spawn(process.execPath, argv, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
  proof.stderr.setEncoding('utf8');
  proof.waited = '';
  proof.stderr.on('data', (chunk) => (proof.waited += chunk));
  proof.exited = new Promise((done) => proof.on('exit', done));
  return proof;
};

test('proof logs attempts under pipefail, refuses stale pre-boot/over-budget/over-stress runs, and handles --force/--stress', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-pstack-proof-'));
  const prove = (name, flags, ...command) => spawnSync(process.execPath, [join(HELPERS, 'proof.mjs'), '--dir', join(dir, 'run'), '--name', name, ...flags, '--', ...command], { cwd: dir, encoding: 'utf8' });

  const failing = prove('lint', [], 'echo found 2 problems; false | cat');
  assert.equal(failing.status, 1);
  assert.match(failing.stdout, /log: .*lint-a1\.log exit=1/);
  assert.equal(unbooted(read(dir, 'run/lint-a1.log')), `$ (${realpathSync(dir)}) echo found 2 problems; false | cat\nfound 2 problems\nexit=1\n`);
  assert.equal(prove('lint', [], process.execPath, '-e', 'console.log("clean")').status, 0);
  assert.match(prove('lint', [], "echo 'héllo—x'").stdout, /^héllo—x\n/u);

  // Reboot guard: unended log from earlier boot refused until --force.
  writeFileSync(join(dir, 'run/big-a1.log'), '$ (.) pnpm check:big\nboot=2000-01-01T00:00:00.000Z\nshard 3\n');
  assert.equal(prove('big', [], 'true').status, 2);
  assert.equal(existsSync(join(dir, 'run/big-a2.log')), false);
  assert.equal(prove('big', ['--force'], 'true').status, 0);
  const boot = read(dir, 'run/big-a2.log').match(/^boot=\S+$/mu)[0];
  writeFileSync(join(dir, 'run/big-a3.log'), `$ (.) pnpm check:big\n${boot}\nrunning\n`);
  assert.equal(prove('big', [], 'true').status, 0);

  // Time budget and --stress core cap.
  assert.equal(prove('slow', ['--timeout', '3601'], 'true').status, 2);
  assert.equal(existsSync(join(dir, 'run/slow-a1.log')), false);
  assert.equal(prove('slow', ['--timeout', '3601', '--stress'], 'true').status, 0);
  const half = Math.max(1, Math.floor(availableParallelism() / 2));
  assert.equal(prove('over', ['--stress', '--cores', String(half + 1)], 'true').status, 2);
  assert.equal(prove('half', ['--stress', '--cores', String(half)], 'true').status, 0);
});

test('proof kills timed-out, SIGTERM-stopped, and supervisor-killed commands and their children cleanly', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-pstack-proof-kill-'));

  // Timed-out command that traps TERM and exits 0 still records ETIMEDOUT and kills children.
  const graceful = spawnSync(process.execPath, [join(HELPERS, 'proof.mjs'), '--dir', join(dir, 'run'), '--name', 'graceful', '--timeout', '1', '--', "trap 'exit 0' TERM; sh -c 'sleep 2; echo late' & wait"], { cwd: dir, encoding: 'utf8' });
  assert.equal(graceful.status, 1);
  assert.match(graceful.stdout, /exit=ETIMEDOUT/);

  // SIGTERM on proof logs SIGTERM exit.
  const stopped = spawn(process.execPath, [join(HELPERS, 'proof.mjs'), '--dir', join(dir, 'run'), '--name', 'stopped', '--', 'echo ready; sleep 20'], { cwd: dir, detached: true, stdio: 'ignore' });
  await until(() => existsSync(join(dir, 'run/stopped-a1.log')) && read(dir, 'run/stopped-a1.log').includes('\nready\n'));
  process.kill(-stopped.pid, 'SIGTERM');
  await until(() => read(dir, 'run/stopped-a1.log').includes('exit='));
  assert.match(read(dir, 'run/stopped-a1.log'), /exit=SIGTERM\n$/);

  // Killing supervisor kills command leader.
  writeFileSync(join(dir, 'leader.mjs'), 'console.log(process.pid);\nsetInterval(() => {}, 1000);\n');
  const sup = spawn(process.execPath, [join(HELPERS, 'proof.mjs'), '--dir', join(dir, 'run'), '--name', 'sup', '--', process.execPath, join(dir, 'leader.mjs')], { cwd: dir, stdio: 'ignore' });
  const exited = new Promise((done) => sup.on('exit', done));
  const log = () => (existsSync(join(dir, 'run/sup-a1.log')) ? read(dir, 'run/sup-a1.log') : '');
  await until(() => /^\d+$/mu.test(log()));
  const leader = Number(log().match(/^(\d+)$/mu)[1]);
  const supervisor = Number(spawnSync('pgrep', ['-P', String(sup.pid)], { encoding: 'utf8' }).stdout.trim());
  process.kill(supervisor, 'SIGKILL');
  await exited;
  try {
    assert.ok(await gone(leader));
  } finally {
    spawnSync('kill', ['-9', String(leader)]);
  }
});

test('core pool queues behind full pool / waiting landing / 5m waiter, backfills under 5m, and frees dead/vanished holders', async () => {
  // Full pool wait and release.
  const p1 = corePool('sync-pstack-proof-pool-', [{ pid: idle.pid, cores: availableParallelism() }]);
  const queued = background(p1.args('queued', 'echo ran'), { cwd: p1.dir, env: p1.env });
  await until(() => queued.waited.includes('waiting'));
  assert.equal(queued.exitCode, null);
  rmSync(join(p1.dir, `tmp/pstack-slots/${idle.pid}.json`));
  assert.equal(await queued.exited, 0);

  // Waiting landing blocks proof even when cores fit.
  const p2 = corePool('sync-pstack-proof-lwait-', []);
  const lTicket = join(p2.dir, `tmp/pstack-slots/${idle.pid}.wait`);
  writeFileSync(lTicket, JSON.stringify({ pid: idle.pid, cores: 1, label: 'land.mjs', since: 0, first: true }));
  const beside = background(p2.args('beside', 'echo ran'), { cwd: p2.dir, env: p2.env });
  await until(() => beside.waited.includes('waiting') || beside.exitCode !== null);
  assert.equal(beside.exitCode, null);
  assert.match(beside.waited, /a waiting landing enters before any proof$/m);
  rmSync(lTicket);
  assert.equal(await beside.exited, 0);

  // Small proof backfills behind <5m waiter, waits behind >=5m waiter.
  const p3 = corePool('sync-pstack-proof-bf-', [{ pid: idle.pid, cores: 1, since: 0 }]);
  const bigTicket = join(p3.dir, `tmp/pstack-slots/${idle.pid}.wait`);
  writeFileSync(bigTicket, JSON.stringify({ pid: idle.pid, cores: availableParallelism(), label: 'large', since: Date.now() - 60_000 }));
  assert.equal(spawnSync(process.execPath, p3.args('small', 'echo ran'), { cwd: p3.dir, env: p3.env, encoding: 'utf8', timeout: 15_000 }).status, 0);
  writeFileSync(bigTicket, JSON.stringify({ pid: idle.pid, cores: availableParallelism(), label: 'large', since: Date.now() - 6 * 60_000 }));
  const held = background(p3.args('small2', 'echo ran'), { cwd: p3.dir, env: p3.env });
  await until(() => held.waited.includes('waiting') || held.exitCode !== null);
  assert.equal(held.exitCode, null);
  rmSync(bigTicket);
  assert.equal(await held.exited, 0);

  // Dead holder freed, vanished holder skipped, corrupt holder refused, nested proof reuses parent share.
  const { pid: deadPid } = spawnSync('true');
  const p4 = corePool('sync-pstack-proof-clean-', [{ pid: deadPid, cores: availableParallelism() }]);
  symlinkSync(join(p4.dir, 'gone'), join(p4.dir, 'tmp/pstack-slots/1.json'));
  assert.equal(spawnSync(process.execPath, p4.args('ok', 'true'), { cwd: p4.dir, env: p4.env, encoding: 'utf8' }).status, 0);
  writeFileSync(join(p4.dir, 'tmp/pstack-slots/2.json'), 'not json');
  assert.match(spawnSync(process.execPath, p4.args('bad', 'true'), { cwd: p4.dir, env: p4.env, encoding: 'utf8' }).stderr, /not valid JSON/);
  rmSync(join(p4.dir, 'tmp/pstack-slots/2.json'));
  writeFileSync(join(p4.dir, `tmp/pstack-slots/${idle.pid}.json`), JSON.stringify({ pid: idle.pid, cores: availableParallelism() - 0.5, label: 'other' }));
  const inner = p4.args('inner', 'true').map((a) => `'${a}'`).join(' ');
  assert.equal(spawnSync(process.execPath, p4.args('outer', `'${process.execPath}' ${inner}`), { cwd: p4.dir, env: p4.env, encoding: 'utf8' }).status, 0);
});

test('landing enters full/low-memory pool immediately, land check bypasses full pool, and pool measures busy workers', async () => {
  // Landing first + low memory floor + PSTACK_LAND_CHECK=1.
  const p1 = corePool('sync-pstack-proof-land-', [{ pid: idle.pid, cores: availableParallelism() }]);
  const fake = join(p1.dir, 'low-memory.mjs');
  writeFileSync(
    fake,
    "import childProcess from 'node:child_process';\nimport os from 'node:os';\nimport { syncBuiltinESMExports } from 'node:module';\nconst spawnSync = childProcess.spawnSync;\nchildProcess.spawnSync = (cmd, ...rest) => (cmd === 'sysctl' ? { status: 0, stdout: '5\\n' } : spawnSync(cmd, ...rest));\nos.freemem = () => os.totalmem() / 20;\nsyncBuiltinESMExports();\n",
  );
  const lowEnv = { ...p1.env, NODE_OPTIONS: `--import ${fake}` };
  const empty = corePool('sync-pstack-proof-lowmem-', []);
  const starved = background(empty.args('starved', 'echo ran'), { cwd: empty.dir, env: { ...empty.env, NODE_OPTIONS: lowEnv.NODE_OPTIONS } });
  await until(() => starved.waited.includes('waiting') || starved.exitCode !== null);
  starved.kill();
  assert.match(starved.waited, /free memory is 5%, under 15%/);

  const landing = join(p1.dir, 'landing.mjs');
  writeFileSync(landing, `import { reserve } from ${JSON.stringify(pathToFileURL(join(HELPERS, 'proof.mjs')).href)};\nreserve(1, 'land.mjs', { first: true });\n`);
  assert.equal(spawnSync(process.execPath, [landing], { cwd: p1.dir, env: lowEnv, encoding: 'utf8', timeout: 15_000 }).status, 0);
  const check = join(p1.dir, 'check.mjs');
  writeFileSync(check, `import { reserve } from ${JSON.stringify(pathToFileURL(join(HELPERS, 'proof.mjs')).href)};\nreserve(1, 'pnpm check');\n`);
  assert.equal(spawnSync(process.execPath, [check], { cwd: p1.dir, env: { ...p1.env, PSTACK_LAND_CHECK: '1' }, encoding: 'utf8', timeout: 15_000 }).status, 0);

  // Pool measures real busy workers beyond the 0.5-core ask and holds back a later proof.
  const p2 = corePool('sync-pstack-proof-measured-', [{ pid: idle.pid, cores: Math.max(0, availableParallelism() - 1) }]);
  const busy = spawn(process.execPath, p2.args('busy', 'echo started; for n in 1 2 3; do (while :; do :; done) & done; wait'), { cwd: p2.dir, detached: true, env: p2.env, stdio: 'ignore' });
  await until(() => existsSync(join(p2.dir, 'run/busy-a1.log')) && read(p2.dir, 'run/busy-a1.log').includes('\nstarted\n'));
  const later = background(p2.args('later', 'echo ran'), { cwd: p2.dir, env: p2.env });
  await until(() => later.waited.includes('held by') || later.exitCode !== null);
  assert.equal(later.exitCode, null);
  assert.match(later.waited, /proof\.mjs busy \(\d+, [\d.]+ in use, asked 0\.5\)/);
  process.kill(-busy.pid, 'SIGTERM');
  assert.equal(await later.exited, 0);
});
