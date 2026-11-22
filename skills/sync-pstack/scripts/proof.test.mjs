import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { commit, read } from './test-sandbox.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const HELPERS = join(HERE, '../assets/pstack');

process.env.TMPDIR = mkdtempSync(join(tmpdir(), 'sync-pstack-proof-pool-'));
delete process.env.PSTACK_SLOT;

// Drops the line that names when the machine last started.
const unbooted = (log) => log.replace(/^boot=\d{4}-\d\d-\d\dT[\d:.]+Z\n/mu, '');

test('proof writes each run to the next attempt log with its command and exit status, under pipefail', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-pstack-proof-'));
  const prove = (...command) => spawnSync(process.execPath, [join(HELPERS, 'proof.mjs'), '--dir', join(dir, 'run'), '--name', 'lint', '--', ...command], { cwd: dir, encoding: 'utf8' });

  const failing = prove('echo found 2 problems; false | cat');
  assert.equal(failing.status, 1, 'pipefail keeps the failure of a piped command');
  assert.match(failing.stdout, /log: .*lint-a1\.log exit=1/);
  const passing = prove(process.execPath, '-e', 'console.log("clean")');
  assert.equal(passing.status, 0, passing.stderr);
  assert.equal(unbooted(read(dir, 'run/lint-a1.log')), `$ (${realpathSync(dir)}) echo found 2 problems; false | cat\nfound 2 problems\nexit=1\n`);
  assert.notEqual(unbooted(read(dir, 'run/lint-a1.log')), read(dir, 'run/lint-a1.log'), 'the log does not name when the machine last started');
  assert.match(read(dir, 'run/lint-a2.log'), /^\$ \(.*\) .*-e 'console\.log\("clean"\)'\nboot=\S+\nclean\nexit=0\n$/);
  assert.match(prove("echo 'héllo—x'").stdout, /^héllo—x\n/u, 'a command line with multibyte text stays out of the output');
});

test('proof refuses a run whose last attempt logged no exit before the machine last started, unless --force', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-pstack-proof-reboot-'));
  const prove = (...flags) => spawnSync(process.execPath, [join(HELPERS, 'proof.mjs'), '--dir', join(dir, 'run'), '--name', 'big', ...flags, '--', 'true'], { cwd: dir, encoding: 'utf8' });
  mkdirSync(join(dir, 'run'));
  writeFileSync(join(dir, 'run/big-a1.log'), '$ (.) pnpm check:big\nboot=2000-01-01T00:00:00.000Z\nshard 3: case 900\n');

  const refused = prove();
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /big-a1\.log logged no exit, and this machine has started again since that run/);
  assert.equal(existsSync(join(dir, 'run/big-a2.log')), false, 'a refused proof writes no log');
  assert.equal(prove('--force').status, 0, 'a forced proof did not run');
  assert.equal(prove().status, 0, 'a run whose last attempt logged its exit was refused');
  const boot = read(dir, 'run/big-a3.log').match(/^boot=\S+$/mu)[0];
  writeFileSync(join(dir, 'run/big-a4.log'), `$ (.) pnpm check:big\n${boot}\nshard 3: case 900\n`);
  assert.equal(prove().status, 0, 'a run whose last attempt still runs under this boot was refused');
});

test('proof refuses a --timeout over the hour time budget unless --stress, and writes no log for a refused run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-pstack-proof-budget-'));
  const prove = (flags) => spawnSync(process.execPath, [join(HELPERS, 'proof.mjs'), '--dir', join(dir, 'run'), '--name', 'slow', ...flags, '--', 'true'], { cwd: dir, encoding: 'utf8' });

  const refused = prove(['--timeout', '3601']);
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /--timeout 3601 is over the 3600-second time budget/);
  assert.equal(existsSync(join(dir, 'run/slow-a1.log')), false, 'a refused proof writes no log');
  assert.equal(prove(['--timeout', '3601', '--stress']).status, 0, 'a stress proof past the budget runs');
});

const proveWithTimeout = (dir, name, command) =>
  spawnSync(process.execPath, [join(HELPERS, 'proof.mjs'), '--dir', join(dir, 'run'), '--name', name, '--timeout', '1', '--', command], { cwd: dir, encoding: 'utf8' });

test('proof stops every process a timed-out command started, so none writes to its log afterwards', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-pstack-proof-late-'));

  assert.equal(proveWithTimeout(dir, 'late', 'sh -c "sleep 2; echo late-write"; true').status, 1);
  spawnSync('sleep', ['3']);
  assert.equal(unbooted(read(dir, 'run/late-a1.log')), `$ (${realpathSync(dir)}) sh -c "sleep 2; echo late-write"; true\ntimed out after 1 seconds\nexit=ETIMEDOUT\n`, 'a process the command started wrote after the timeout');
});

const until = async (done) => {
  for (const begun = Date.now(); !done() && Date.now() - begun < 10_000; ) await new Promise((wake) => setTimeout(wake, 50));
};

test('proof logs the exit when it is stopped before its command ends', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-pstack-proof-stopped-'));
  const proof = spawn(process.execPath, [join(HELPERS, 'proof.mjs'), '--dir', join(dir, 'run'), '--name', 'stopped', '--', 'echo ready; sleep 20'], { cwd: dir, detached: true, stdio: 'ignore' });

  await until(() => existsSync(join(dir, 'run/stopped-a1.log')) && read(dir, 'run/stopped-a1.log').includes('\nready\n'));
  process.kill(-proof.pid, 'SIGTERM');
  await until(() => read(dir, 'run/stopped-a1.log').includes('exit='));
  assert.match(read(dir, 'run/stopped-a1.log'), /\nready\n\nproof\.mjs stopped by SIGTERM\nexit=SIGTERM\n$/);
});

test('proof logs the exit of a command that outlives its parent proof.mjs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-pstack-proof-orphan-'));
  const proof = spawn(process.execPath, [join(HELPERS, 'proof.mjs'), '--dir', join(dir, 'run'), '--name', 'orphan', '--', 'echo ready; sleep 1'], { cwd: dir, stdio: 'ignore' });

  await until(() => existsSync(join(dir, 'run/orphan-a1.log')) && read(dir, 'run/orphan-a1.log').includes('\nready\n'));
  proof.kill('SIGKILL');
  await until(() => read(dir, 'run/orphan-a1.log').includes('exit='));
  assert.match(read(dir, 'run/orphan-a1.log'), /\nready\n\nproof\.mjs ended before its command\nexit=0\n$/);
});

test('proof stops a timed-out command whose leader catches SIGTERM while its process scans are slow', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-pstack-proof-blocked-'));
  mkdirSync(join(dir, 'bin'));
  writeFileSync(join(dir, 'bin/ps'), '#!/bin/sh\nexec sleep 30\n', { mode: 0o755 });
  writeFileSync(join(dir, 'leader.mjs'), "process.on('SIGTERM', () => {});\nconsole.log(process.pid, Date.now());\nsetInterval(() => {}, 1000);\n");
  const timeout = 3;
  const grace = 5;
  const proof = spawnSync(process.execPath, [join(HELPERS, 'proof.mjs'), '--dir', join(dir, 'run'), '--name', 'blocked', '--timeout', String(timeout), '--', process.execPath, join(dir, 'leader.mjs')], { cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}` } });

  assert.equal(proof.status, 1);
  const [, leaderPid, begun] = read(dir, 'run/blocked-a1.log').match(/^(\d+) (\d+)$/mu) ?? [];
  assert.ok(Date.now() - Number(begun) < (timeout + 2 * grace) * 1000, `proof stopped the command ${Date.now() - Number(begun)} ms after it started`);
  const leader = Number(leaderPid);
  assert.ok(leader > 0, 'the leader printed no pid');
  try {
    assert.throws(() => process.kill(leader, 0), { code: 'ESRCH' }, 'the timed-out command outlived proof.mjs');
  } finally {
    spawnSync('kill', ['-9', String(leader)]);
  }
  assert.match(read(dir, 'run/blocked-a1.log'), /\ntimed out after 3 seconds\nexit=ETIMEDOUT\n$/);
});

test('proof stops its command when its supervisor dies before reporting', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-pstack-proof-supervisor-'));
  writeFileSync(join(dir, 'leader.mjs'), "console.log(process.pid);\nsetInterval(() => {}, 1000);\n");
  const proof = spawn(process.execPath, [join(HELPERS, 'proof.mjs'), '--dir', join(dir, 'run'), '--name', 'supervisor', '--', process.execPath, join(dir, 'leader.mjs')], { cwd: dir, stdio: 'ignore' });
  const exited = new Promise((done) => proof.on('exit', done));
  const log = () => (existsSync(join(dir, 'run/supervisor-a1.log')) ? read(dir, 'run/supervisor-a1.log') : '');
  await until(() => /^\d+$/mu.test(log()));
  const leader = Number(log().match(/^(\d+)$/mu)[1]);
  const supervisor = Number(spawnSync('pgrep', ['-P', String(proof.pid)], { encoding: 'utf8' }).stdout.trim());
  process.kill(supervisor, 'SIGKILL');
  await exited;
  try {
    assert.throws(() => process.kill(leader, 0), { code: 'ESRCH' }, 'the command outlived its supervisor');
  } finally {
    spawnSync('kill', ['-9', String(leader)]);
  }
});

// A scratch TMPDIR gives each test its own core pool, so the machine's real proofs neither block it nor count in it.
const corePool = (prefix, holders) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const env = { ...process.env, TMPDIR: join(dir, 'tmp') };
  delete env.PSTACK_SLOT;
  mkdirSync(join(dir, 'tmp/pstack-slots'), { recursive: true });
  for (const holder of holders) writeFileSync(join(dir, `tmp/pstack-slots/${holder.pid}.json`), JSON.stringify({ label: 'other session', ...holder }));
  const args = (name, command) => [join(HELPERS, 'proof.mjs'), '--dir', join(dir, 'run'), '--name', name, '--timeout', '30', '--', command];
  return { dir, env, args };
};

// An idle process stands in for another session's holder. The pool counts the workers that run under each holder, and under the test runner's own pid it would count these tests.
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

const busyWorkers = (count) => `echo started; for n in $(seq ${count}); do (while :; do :; done) & done; wait`;
const started = (dir, name) => existsSync(join(dir, `run/${name}-a1.log`)) && read(dir, `run/${name}-a1.log`).includes('\nstarted\n');

test('proof waits while other sessions hold the whole core pool and runs once a share frees', async () => {
  const { dir, env, args } = corePool('sync-pstack-proof-pool-', [{ pid: idle.pid, cores: availableParallelism() }]);
  const proof = spawn(process.execPath, args('queued', 'echo ran'), { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  proof.stderr.on('data', (chunk) => (stderr += chunk));
  const exited = new Promise((done) => proof.on('exit', done));

  await until(() => stderr.includes('waiting'));
  assert.match(stderr, /proof\.mjs queued: waiting for 0\.5 of this machine's cores; \d+ of \d+ cores held by other session/);
  assert.equal(proof.exitCode, null, 'a proof ran while the pool was full');
  rmSync(join(dir, `tmp/pstack-slots/${idle.pid}.json`));
  assert.equal(await exited, 0);
  assert.match(read(dir, 'run/queued-a1.log'), /\nran\nexit=0\n$/);
});

// Under `--import` of the module this writes, a process reads free memory as 5%, under the pool's 15% floor.
const lowMemory = (dir) => {
  const fake = join(dir, 'low-memory.mjs');
  writeFileSync(
    fake,
    "import childProcess from 'node:child_process';\nimport os from 'node:os';\nimport { syncBuiltinESMExports } from 'node:module';\n" +
      'const spawnSync = childProcess.spawnSync;\n' +
      "childProcess.spawnSync = (command, ...rest) => (command === 'sysctl' ? { status: 0, stdout: '5\\n' } : spawnSync(command, ...rest));\n" +
      'os.freemem = () => os.totalmem() / 20;\nsyncBuiltinESMExports();\n'
  );
  return `--import ${fake}`;
};

test('a landing enters at once while other sessions hold every core and free memory is under the floor, and a proof waiting before it keeps waiting', async () => {
  const { dir, env, args } = corePool('sync-pstack-proof-landing-first-', [{ pid: idle.pid, cores: availableParallelism() }]);
  const proof = background(args('early', 'echo ran'), { cwd: dir, env });
  await until(() => proof.waited.includes('waiting'));
  const lowEnv = { ...env, NODE_OPTIONS: lowMemory(dir) };
  const empty = corePool('sync-pstack-proof-low-memory-', []);
  const starved = background(empty.args('starved', 'echo ran'), { cwd: empty.dir, env: { ...empty.env, NODE_OPTIONS: lowEnv.NODE_OPTIONS } });
  await until(() => starved.waited.includes('waiting') || starved.exitCode !== null);
  starved.kill();
  assert.match(starved.waited, /free memory is 5%, under 15%/, 'the low-memory fake does not reach the pool');
  const took = join(dir, 'took');
  const landing = join(dir, 'landing.mjs');
  writeFileSync(
    landing,
    `import { writeFileSync } from 'node:fs';\nimport { reserve } from ${JSON.stringify(pathToFileURL(join(HELPERS, 'proof.mjs')).href)};\n` +
      `const release = reserve(${Math.ceil(availableParallelism() / 2)}, 'land.mjs', { first: true });\nwriteFileSync(${JSON.stringify(took)}, String(release.waited));\n`
  );

  const land = spawnSync(process.execPath, [landing], { cwd: dir, env: lowEnv, encoding: 'utf8', timeout: 15_000 });
  assert.equal(land.status, 0, land.stderr);
  assert.doesNotMatch(land.stderr, /waiting/, 'the landing waited in the pool');
  assert.equal(readFileSync(took, 'utf8'), '0');
  assert.equal(proof.exitCode, null, 'the proof entered a full pool');
  rmSync(join(dir, `tmp/pstack-slots/${idle.pid}.json`));
  assert.equal(await proof.exited, 0);
});

test('no proof enters while a landing waits, even where both shares fit, because its workers can outgrow its ask', async () => {
  const { dir, env, args } = corePool('sync-pstack-proof-landing-waits-', []);
  const ticket = join(dir, `tmp/pstack-slots/${idle.pid}.wait`);
  writeFileSync(ticket, JSON.stringify({ pid: idle.pid, cores: Math.ceil(availableParallelism() / 2) / 2, label: 'land.mjs', since: 0, first: true }));
  const proof = background(args('beside', 'echo ran'), { cwd: dir, env });

  await until(() => proof.waited.includes('waiting') || proof.exitCode !== null);
  assert.equal(proof.exitCode, null, 'a proof entered while a landing waited');
  assert.match(proof.waited, /proof\.mjs beside: waiting for 0\.5 of this machine's cores; land\.mjs \(\d+\) waits for [\d.]+ cores, and a waiting landing enters before any proof$/m);
  rmSync(ticket);
  assert.equal(await proof.exited, 0);
});

test('a small proof enters past a larger waiter that has waited under five minutes when the free cores fit it now', () => {
  const { dir, env, args } = corePool('sync-pstack-proof-backfill-', [{ pid: idle.pid, cores: 1, since: 0 }]);
  const ticket = { pid: idle.pid, cores: availableParallelism(), label: 'large proof', since: Date.now() - 60_000 };
  writeFileSync(join(dir, `tmp/pstack-slots/${idle.pid}.wait`), JSON.stringify(ticket));

  const small = spawnSync(process.execPath, args('small', 'echo ran'), { cwd: dir, env, encoding: 'utf8', timeout: 15_000 });
  assert.equal(small.status, 0, `the one-core proof waited behind a waiter that cannot enter yet:\n${small.stderr}`);
});

test('a small proof waits behind a larger waiter that has waited five minutes or more', async () => {
  const { dir, env, args } = corePool('sync-pstack-proof-no-backfill-', [{ pid: idle.pid, cores: 1, since: 0 }]);
  const ticket = join(dir, `tmp/pstack-slots/${idle.pid}.wait`);
  writeFileSync(ticket, JSON.stringify({ pid: idle.pid, cores: availableParallelism(), label: 'large proof', since: Date.now() - 6 * 60_000 }));
  const small = background(args('small', 'echo ran'), { cwd: dir, env });

  await until(() => small.waited.includes('waiting') || small.exitCode !== null);
  assert.equal(small.exitCode, null, 'a proof entered past a waiter that had waited six minutes');
  assert.match(small.waited, /and \d+ asked for by 1 waiter ahead$/m);
  rmSync(ticket);
  assert.equal(await small.exited, 0);
});

test("a land check's own share enters at once while other sessions hold every core", () => {
  const { dir, env } = corePool('sync-pstack-proof-land-check-', [{ pid: idle.pid, cores: availableParallelism() }]);
  const check = join(dir, 'check.mjs');
  writeFileSync(check, `import { reserve } from ${JSON.stringify(pathToFileURL(join(HELPERS, 'proof.mjs')).href)};\nreserve(1, 'pnpm check');\n`);

  const run = spawnSync(process.execPath, [check], { cwd: dir, env: { ...env, PSTACK_LAND_CHECK: '1' }, encoding: 'utf8', timeout: 15_000 });
  assert.equal(run.status, 0, run.stderr);
  assert.doesNotMatch(run.stderr, /waiting/, 'the land check waited in a full pool');
});

test('a holder does not count the workers of a holder under it, so a land check that takes its own share is counted once', async () => {
  const outer = spawn('sh', ['-c', `sh -c '${busyWorkers(4)}' & wait`], { stdio: 'ignore', detached: true });
  try {
    let inner;
    await until(() => (inner = Number(spawnSync('pgrep', ['-P', String(outer.pid)], { encoding: 'utf8' }).stdout.trim().split('\n')[0])) > 0);
    const { dir, env, args } = corePool('sync-pstack-proof-nested-holder-', [
      { pid: outer.pid, cores: 0.5, since: 0, label: 'land.mjs' },
      { pid: inner, cores: 0.5, since: 0, label: 'pnpm check' },
    ]);
    const argv = args('beside', 'echo ran');
    argv.splice(argv.indexOf('--'), 0, '--cores', String(2 * (availableParallelism() - 3)));

    const beside = spawnSync(process.execPath, argv, { cwd: dir, env, encoding: 'utf8', timeout: 15_000 });
    assert.equal(beside.status, 0, `the pool counted the inner holder's workers under the outer holder too:\n${beside.stderr}`);
  } finally {
    process.kill(-outer.pid, 'SIGKILL');
  }
});

test('proof skips a holder whose file vanished after the pool was listed and still refuses a corrupt one', () => {
  const { dir, env, args } = corePool('sync-pstack-proof-vanished-', []);
  // A dangling link is listed and then reads ENOENT, as a file its holder's release removes between the two does.
  symlinkSync(join(dir, 'gone'), join(dir, 'tmp/pstack-slots/1.json'));

  assert.equal(spawnSync(process.execPath, args('vanished', 'true'), { cwd: dir, env, encoding: 'utf8', timeout: 20_000 }).status, 0);

  writeFileSync(join(dir, 'tmp/pstack-slots/2.json'), 'not json');
  const corrupt = spawnSync(process.execPath, args('corrupt', 'true'), { cwd: dir, env, encoding: 'utf8', timeout: 20_000 });
  assert.notEqual(corrupt.status, 0);
  assert.match(corrupt.stderr, /not valid JSON/);

  rmSync(join(dir, 'tmp/pstack-slots/2.json'));
  mkdirSync(join(dir, 'tmp/pstack-slots/2.json'));
  const unreadable = spawnSync(process.execPath, args('unreadable', 'true'), { cwd: dir, env, encoding: 'utf8', timeout: 20_000 });
  assert.notEqual(unreadable.status, 0);
  assert.match(unreadable.stderr, /EISDIR/);
});

test('proof frees the share of a holder that died without releasing it', () => {
  const { pid } = spawnSync('true');
  const { dir, env, args } = corePool('sync-pstack-proof-dead-', [{ pid, cores: availableParallelism() }]);

  assert.equal(spawnSync(process.execPath, args('after-crash', 'true'), { cwd: dir, env, encoding: 'utf8', timeout: 20_000 }).status, 0);
});

test('a proof started inside a proof runs on its parent share instead of waiting for one', () => {
  const { dir, env, args } = corePool('sync-pstack-proof-nested-', [{ pid: idle.pid, cores: availableParallelism() - 0.5 }]);
  const inner = args('inner', 'true').map((arg) => `'${arg}'`).join(' ');

  assert.equal(spawnSync(process.execPath, args('outer', `'${process.execPath}' ${inner}`), { cwd: dir, env, encoding: 'utf8', timeout: 20_000 }).status, 0);
  assert.match(read(dir, 'run/inner-a1.log'), /exit=0\n$/);
});

const stressArgs = (args, name, cores) => {
  const argv = args(name, `echo ${name}`);
  argv.splice(argv.indexOf('--'), 0, '--stress', '--cores', String(cores));
  return argv;
};

test('proof refuses a stress run with more workers than half the cores before it logs, and runs one with half', () => {
  const { dir, env, args } = corePool('sync-pstack-proof-stress-cap-', []);
  const half = Math.max(1, Math.floor(availableParallelism() / 2));
  const stress = (name, cores) => spawnSync(process.execPath, stressArgs(args, name, cores), { cwd: dir, env, encoding: 'utf8', timeout: 20_000 });

  const refused = stress('over', half + 1);
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, new RegExp(`^--stress with --cores ${half + 1} is over half of this machine's ${availableParallelism()} cores; run the command with at most ${half} workers and pass --cores ${half}$`, 'm'));
  assert.equal(existsSync(join(dir, 'run/over-a1.log')), false, 'a refused stress proof wrote a log');
  assert.equal(stress('half', half).status, 0, 'a stress proof with half the cores runs');
});

test('a stress proof holds a whole core for each worker, so it waits where only half a core is free', async () => {
  const { dir, env, args } = corePool('sync-pstack-proof-stress-share-', [{ pid: idle.pid, cores: availableParallelism() - 0.5 }]);
  const stress = spawn(process.execPath, stressArgs(args, 'stress', 1), { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  stress.stderr.on('data', (chunk) => (stderr += chunk));
  const exited = new Promise((done) => stress.on('exit', done));

  await until(() => stderr.includes('waiting') || stress.exitCode !== null);
  assert.equal(stress.exitCode, null, 'a stress proof ran on half a core');
  assert.match(stderr, /proof\.mjs stress: waiting for 1 of this machine's cores; /);
  rmSync(join(dir, `tmp/pstack-slots/${idle.pid}.json`));
  assert.equal(await exited, 0);
});

test('the pool counts the workers a running proof really runs, so a later proof waits where the first one asked for half a core', async () => {
  const { dir, env, args } = corePool('sync-pstack-proof-measured-', [{ pid: idle.pid, cores: Math.max(0, availableParallelism() - 1) }]);
  const busy = spawn(process.execPath, args('busy', busyWorkers(3)), { cwd: dir, detached: true, env, stdio: 'ignore' });
  await until(() => started(dir, 'busy'));
  const later = background(args('later', 'echo ran'), { cwd: dir, env });

  await until(() => later.waited.includes('held by') || later.exitCode !== null);
  assert.equal(later.exitCode, null, 'a proof ran beside three busy workers that held half a core between them');
  assert.match(later.waited, /proof\.mjs later: waiting for 0\.5 of this machine's cores; [\d.]+ of \d+ cores held by .*proof\.mjs busy \(\d+, [\d.]+ in use, asked 0\.5\)/);
  process.kill(-busy.pid, 'SIGTERM');
  assert.equal(await later.exited, 0);
});

test('the pool admits the next proof once it has counted the workers of the one before, and an idle proof holds only its ask', async () => {
  const { dir, env, args } = corePool('sync-pstack-proof-watch-', [{ pid: idle.pid, cores: Math.max(0, availableParallelism() - 1) }]);
  const quiet = spawn(process.execPath, args('quiet', 'echo started; sleep 25'), { cwd: dir, detached: true, env, stdio: 'ignore' });
  await until(() => started(dir, 'quiet'));
  const later = background(args('later', 'echo ran'), { cwd: dir, env });

  assert.equal(await later.exited, 0);
  assert.equal(quiet.exitCode, null, 'a proof waited for an idle one to end');
  assert.match(later.waited, /proof\.mjs later: waiting for 0\.5 of this machine's cores; proof\.mjs quiet \(\d+\) started \d+ seconds? ago, and the pool counts the workers of a new command for \d+ seconds before it admits the next$/m);
  process.kill(-quiet.pid, 'SIGTERM');
});

test('a stress proof holds a whole core for each worker the pool counts, so two workers fill two cores', async () => {
  const { dir, env, args } = corePool('sync-pstack-proof-stress-measured-', [{ pid: idle.pid, cores: Math.max(0, availableParallelism() - 2) }]);
  const argv = args('stress', busyWorkers(2));
  argv.splice(argv.indexOf('--'), 0, '--stress', '--cores', '1');
  const stress = spawn(process.execPath, argv, { cwd: dir, detached: true, env, stdio: 'ignore' });
  await until(() => started(dir, 'stress'));
  const later = background(args('later', 'echo ran'), { cwd: dir, env });

  await until(() => later.waited.includes('held by') || later.exitCode !== null);
  assert.equal(later.exitCode, null, 'a proof ran on the core a second stress worker used');
  process.kill(-stress.pid, 'SIGTERM');
  assert.equal(await later.exited, 0);
});

test('proof fails a timed-out command that exits 0 on its timeout signal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-pstack-proof-graceful-'));
  const graceful = proveWithTimeout(dir, 'graceful', "trap 'exit 0' TERM; sleep 20 & wait");

  assert.match(graceful.stdout, /exit=ETIMEDOUT/, 'a timed-out command that exits 0 was logged as passing');
  assert.equal(graceful.status, 1);
});

test('proof stops a timed-out command that ignores its timeout signal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-pstack-proof-stubborn-'));
  const started = Date.now();

  assert.equal(proveWithTimeout(dir, 'stubborn', "trap '' TERM; sleep 20").status, 1);
  assert.ok(Date.now() - started < 12_000, 'a command that ignores its timeout signal ran past the timeout and its grace');
});

test('prove refuses a timeout that is not a positive number before it writes a log', async () => {
  const { prove } = await import(pathToFileURL(join(HELPERS, 'proof.mjs')));
  const dir = mkdtempSync(join(tmpdir(), 'sync-pstack-prove-zero-'));

  for (const timeout of [0, -5, Number.NaN]) {
    assert.throws(() => prove({ dir, name: 'bad', command: ['true'], timeout }), /takes a positive number of seconds/, `prove accepted a timeout of ${timeout}`);
  }
  assert.deepEqual(readdirSync(dir), [], 'a refused proof wrote a log');
});

test('prove runs a command under the hour time budget by default and with no timeout under stress', async () => {
  const { prove } = await import(pathToFileURL(join(HELPERS, 'proof.mjs')));
  const dir = mkdtempSync(join(tmpdir(), 'sync-pstack-prove-default-'));
  const supervisorArgs = (options) => prove({ dir, name: 'supervisor', command: ['ps -o args= -p $PPID'], ...options }).output;

  assert.match(supervisorArgs({}), /--supervise-group 3600 bash/);
  assert.match(supervisorArgs({ stress: true }), /--supervise-group 0 bash/);
});

test('mutate refuses a spec timeout over the hour time budget before exporting anything', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-pstack-mutate-budget-'));
  writeFileSync(join(dir, 'spec.json'), JSON.stringify({ commit: 'HEAD', timeout: 5400, test: ['true'], mutations: [{ name: 'm', file: 'a.js', from: 'a', to: 'b', expect: 'x' }] }));
  const result = spawnSync(process.execPath, [join(HELPERS, 'mutate.mjs'), '--dir', join(dir, 'run'), join(dir, 'spec.json')], { cwd: dir, encoding: 'utf8' });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /within the 3600-second time budget, got 5400/);
  assert.equal(existsSync(join(dir, 'run')), false, 'a refused spec exports nothing');
});

test('mutate links each workspace node_modules into its worktree', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-pstack-mutate-links-'));
  const repo = join(dir, 'repo');
  spawnSync('git', ['init', '-q', repo]);
  mkdirSync(join(repo, 'pkg/node_modules/dep'), { recursive: true });
  writeFileSync(join(repo, '.gitignore'), 'node_modules\n');
  writeFileSync(join(repo, 'pkg/package.json'), '{ "type": "module" }\n');
  writeFileSync(join(repo, 'pkg/node_modules/dep/package.json'), '{ "type": "module", "main": "index.js" }\n');
  writeFileSync(join(repo, 'pkg/node_modules/dep/index.js'), 'export const base = 10;\n');
  writeFileSync(join(repo, 'pkg/sum.mjs'), "import { base } from 'dep';\nexport const sum = (a) => a + base;\n");
  writeFileSync(
    join(repo, 'pkg/sum.test.mjs'),
    "import assert from 'node:assert/strict';\nimport { mkdirSync, writeFileSync } from 'node:fs';\nimport { test } from 'node:test';\nimport { sum } from './sum.mjs';\nmkdirSync(new URL('./node_modules/.vite', import.meta.url), { recursive: true });\nwriteFileSync(new URL('./node_modules/.vite/written', import.meta.url), 'cache');\ntest('sum adds the base', () => assert.equal(sum(1), 11, 'sum lost its base'));\n",
  );
  spawnSync('git', ['-C', repo, 'add', '-A']);
  commit(repo, 'base');
  const sha = spawnSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  writeFileSync(
    join(dir, 'spec.json'),
    JSON.stringify({ commit: sha, test: [process.execPath, '--test', 'pkg/sum.test.mjs'], mutations: [{ name: 'minus', file: 'pkg/sum.mjs', from: 'a + base', to: 'a - base', expect: 'sum lost its base' }] }),
  );
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT'));
  const result = spawnSync(process.execPath, [join(HELPERS, 'mutate.mjs'), '--dir', join(dir, 'run'), join(dir, 'spec.json')], { cwd: repo, encoding: 'utf8', env });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /minus: caught/);
  assert.equal(existsSync(join(repo, 'pkg/node_modules/dep/index.js')), true, 'removing the worktree keeps the checkout\'s packages');
  assert.equal(existsSync(join(repo, 'pkg/node_modules/.vite/written')), false, 'a test cache stays in the worktree');
});

test('mutate counts a mutation caught only when its named assertion fails, in an export it makes and removes, leaving no worktree', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-pstack-mutate-'));
  const repo = join(dir, 'repo');
  const outside = join(dir, 'outside');
  spawnSync('git', ['init', '-q', repo]);
  mkdirSync(outside);
  const source = 'export const add = (a, b) => a + b;\nexport const zero = 0;\nexport const one = 1;\n';
  writeFileSync(join(outside, 'add.mjs'), source);
  writeFileSync(join(repo, 'add.mjs'), source);
  writeFileSync(
    join(repo, 'add.test.mjs'),
    "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { add, zero } from './add.mjs';\ntest('add sums its arguments', () => assert.equal(add(1, 2), 3, 'add returned the wrong sum'));\ntest('zero starts at zero', () => assert.equal(zero, 0, 'zero moved'));\n",
  );
  symlinkSync(outside, join(repo, 'ext'));
  spawnSync('git', ['-C', repo, 'add', '-A']);
  commit(repo, 'base');
  const sha = spawnSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  const mutate = (mutation) => {
    writeFileSync(join(dir, 'spec.json'), JSON.stringify({ commit: sha, test: [process.execPath, '--test', 'add.test.mjs'], mutations: [mutation] }));
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT'));
    return spawnSync(process.execPath, [join(HELPERS, 'mutate.mjs'), '--dir', join(dir, 'run'), join(dir, 'spec.json')], { cwd: repo, encoding: 'utf8', env });
  };
  const subtract = { name: 'subtract', file: 'add.mjs', from: 'a + b', to: 'a - b', expect: 'add returned the wrong sum' };

  const caught = mutate(subtract);
  assert.equal(caught.status, 0, caught.stdout + caught.stderr);
  assert.match(caught.stdout, /subtract: caught \(exit=1\)/);
  assert.equal(spawnSync('git', ['-C', repo, 'worktree', 'list'], { encoding: 'utf8' }).stdout.trim().split('\n').length, 1, 'the worktree it made is gone');
  assert.equal(read(repo, 'add.mjs'), source, 'the checkout it ran from is untouched');

  assert.match(mutate({ ...subtract, name: 'unused', from: 'zero = 0', to: 'zero = 0 + 0' }).stdout, /unused: survived/);
  assert.match(mutate({ ...subtract, name: 'syntax', to: 'a +' }).stdout, /syntax: failed without the expected text/, 'a crash is not the named failure');
  assert.match(mutate({ ...subtract, name: 'title', from: 'zero = 0', to: 'zero = 2', expect: 'add sums its arguments' }).stdout, /title: not run, its expected text also appears in the passing control run/, 'a passing test title is not a failure');
  assert.match(mutate({ ...subtract, name: 'twice', from: 'export const', to: 'const' }).stdout, /anchor matches 3 times/);
  const escaped = mutate({ ...subtract, name: 'escape', file: 'ext/add.mjs' });
  assert.match(escaped.stdout, /escape: not run, ext\/add\.mjs is outside the export/, 'a mutation through a link out of the export is refused');
  assert.equal(read(outside, 'add.mjs'), source);

  writeFileSync(join(dir, 'spec.json'), JSON.stringify({ commit: '0'.repeat(40), test: [process.execPath, '--test', 'add.test.mjs'], mutations: [subtract] }));
  const failed = spawnSync(process.execPath, [join(HELPERS, 'mutate.mjs'), '--dir', join(dir, 'run'), join(dir, 'spec.json')], { cwd: repo, encoding: 'utf8' });
  assert.match(failed.stderr, /could not export 0{40}/, 'a commit the repository lacks');
});
