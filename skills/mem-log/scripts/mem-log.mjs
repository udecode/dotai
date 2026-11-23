// Memory flight recorder: one JSONL line every 10 s in ~/Library/Logs/mem-log/<day>.jsonl,
// so the next freeze leaves a record of what ran, who owned it, and how the kernel coped.
// Attribution walks each process up to its Claude Code CLI (`--resume=<id>`) and names the
// session from the desktop app's records. Footprint, not RSS, because swapped and compressed
// pages vanish from RSS (on one frozen Mac, RSS summed to 46 GB while footprint was 172 GB).
import { execFileSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, rmSync, statSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FOOTPRINT = join(HERE, 'footprint');
const LOG_DIR = join(homedir(), 'Library/Logs/mem-log');
const STORE = join(homedir(), 'Library/Application Support/Claude/claude-code-sessions');
const APP_LOG = join(homedir(), 'Library/Logs/Claude/main.log');
const INTERVAL_MS = 10_000;
const TOP_EVERY = 6; // root daemons (fseventsd, WindowServer) are only visible to top, which costs ~2 s of CPU
const KEEP_DAYS = 10;
const GROUP_MIN_MB = 256;
const BIG_MB = 1536;
const MB = 1024 * 1024;

const run = (cmd, args, timeout = 5000) => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', timeout, maxBuffer: 64 * MB });
  } catch {
    return '';
  }
};

// --- system counters -------------------------------------------------------
const PAGE = Number(run('sysctl', ['-n', 'hw.pagesize'])) || 16384;
const VM_KEYS = {
  'Pages free': 'freePages',
  'Pages stored in compressor': 'cmpStored',
  'Pages occupied by compressor': 'cmpOccupied',
  Pageins: 'pageins',
  Pageouts: 'pageouts',
  Swapins: 'swapins',
  Swapouts: 'swapouts',
  Compressions: 'compressions',
  Decompressions: 'decompressions',
};
const RATE_KEYS = ['pageins', 'pageouts', 'swapins', 'swapouts', 'compressions', 'decompressions'];

function vmStat() {
  const out = {};
  for (const line of run('vm_stat', []).split('\n')) {
    const m = line.match(/^([^:]+):\s+(\d+)\./);
    if (m && VM_KEYS[m[1]]) out[VM_KEYS[m[1]]] = Number(m[2]);
  }
  return out;
}

function sysctls() {
  const [level, pressure, swap, load] = run('sysctl', ['-n', 'kern.memorystatus_level', 'kern.memorystatus_vm_pressure_level', 'vm.swapusage', 'vm.loadavg']).split('\n');
  const used = swap?.match(/used = ([\d.]+)M/);
  const total = swap?.match(/total = ([\d.]+)M/);
  return {
    freePct: Number(level),
    pressure: { 1: 'normal', 2: 'warn', 4: 'critical' }[Number(pressure)] ?? pressure,
    swapUsedMB: used ? Math.round(Number(used[1])) : null,
    swapTotalMB: total ? Math.round(Number(total[1])) : null,
    load1: Number(load?.match(/[\d.]+/)?.[0]),
  };
}

// --- session names ---------------------------------------------------------
let sessions = new Map();
let sessionsAt = 0;
function sessionNames() {
  if (Date.now() - sessionsAt < 5 * 60_000) return sessions;
  const newest = new Map();
  try {
    for (const account of readdirSync(STORE, { withFileTypes: true })) {
      if (!account.isDirectory()) continue;
      for (const org of readdirSync(join(STORE, account.name), { withFileTypes: true })) {
        if (!org.isDirectory()) continue;
        const dir = join(STORE, account.name, org.name);
        for (const file of readdirSync(dir)) {
          if (!file.startsWith('local_') || !file.endsWith('.json')) continue;
          const path = join(dir, file);
          const mtime = statSync(path).mtimeMs;
          if ((newest.get(file)?.mtime ?? -1) < mtime) newest.set(file, { path, mtime });
        }
      }
    }
  } catch {}
  const next = new Map();
  for (const { path } of newest.values()) {
    try {
      const r = JSON.parse(readFileSync(path, 'utf8'));
      if (r.cliSessionId) next.set(r.cliSessionId, { local: r.sessionId, title: r.title, cwd: r.cwd });
    } catch {}
  }
  sessions = next;
  sessionsAt = Date.now();
  return sessions;
}

// --- processes -------------------------------------------------------------
const CLI = /\/claude\.app\/Contents\/MacOS\/claude\s.*?--(?:resume|session-id)[= ]([0-9a-f-]{36})/;
const APP = '/Applications/Claude.app/Contents/MacOS/Claude';

function processes() {
  const procs = new Map();
  for (const line of run(FOOTPRINT, []).split('\n')) {
    const [pid, ppid, fp, rss, ...comm] = line.split(' ');
    if (!pid) continue;
    procs.set(Number(pid), { pid: Number(pid), ppid: Number(ppid), fpMB: Math.round(Number(fp) / MB), rssMB: Math.round(Number(rss) / MB), comm: comm.join(' ') });
  }
  for (const line of run('ps', ['-axo', 'pid=,etime=,command=']).split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\S+)\s+(.*)$/);
    const p = m && procs.get(Number(m[1]));
    if (p) Object.assign(p, { age: m[2], cmd: m[3] });
  }
  return procs;
}

// Group = the Claude session a process descends from, else the top-level program under launchd.
function groupOf(procs, pid, memo) {
  const chain = [];
  let key = null;
  for (let p = procs.get(pid), hops = 0; p && hops < 64; p = procs.get(p.ppid), hops++) {
    if (memo.has(p.pid)) {
      key = memo.get(p.pid);
      break;
    }
    chain.push(p.pid);
    const cli = p.cmd?.match(CLI);
    if (cli) {
      key = `cli:${cli[1]}`;
      break;
    }
    if (/^claude -p\b/.test(p.cmd ?? '')) {
      key = `claude-p:${p.pid}`;
      break;
    }
    if (p.cmd?.startsWith(APP)) {
      key = chain.length === 1 ? 'app:Claude' : `app:${procs.get(chain.at(-2))?.comm ?? '?'}`;
      break;
    }
    if (p.ppid <= 1) {
      key = `top:${p.comm}`;
      break;
    }
  }
  key ??= `pid:${pid}`;
  for (const id of chain) memo.set(id, key);
  return key;
}

function attribute(procs) {
  const memo = new Map();
  const names = sessionNames();
  const groups = new Map();
  let fpMB = 0;
  const claudes = new Set();
  for (const p of procs.values()) {
    fpMB += p.fpMB;
    const cli = p.cmd?.match(CLI);
    if (cli) claudes.add(cli[1]);
    const g = groupOf(procs, p.pid, memo);
    const e = groups.get(g) ?? { g, mb: 0, n: 0, top: null };
    e.mb += p.fpMB;
    e.n++;
    if (!e.top || p.fpMB > e.top.fpMB) e.top = p;
    groups.set(g, e);
  }
  const named = (g) => {
    const s = g.startsWith('cli:') ? names.get(g.slice(4)) : null;
    return s ? { title: s.title, local: s.local } : {};
  };
  const top = [...groups.values()]
    .filter((e) => e.mb >= GROUP_MIN_MB)
    .sort((a, b) => b.mb - a.mb)
    .slice(0, 12)
    .map((e) => ({ g: e.g, ...named(e.g), mb: e.mb, n: e.n, biggest: `${e.top.comm}:${e.top.fpMB}` }));
  const big = [...procs.values()]
    .filter((p) => p.fpMB >= BIG_MB)
    .sort((a, b) => b.fpMB - a.fpMB)
    .map((p) => ({ pid: p.pid, ppid: p.ppid, mb: p.fpMB, rss: p.rssMB, age: p.age, g: memo.get(p.pid), cmd: (p.cmd ?? p.comm).slice(0, 220) }));
  return { userFootprintMB: fpMB, procs: procs.size, claudes: claudes.size, groups: top, big };
}

// Whole-machine view from top, including root daemons the helper cannot read.
function topSnapshot() {
  const out = run('top', ['-l', '1', '-n', '15', '-o', 'mem', '-stats', 'pid,mem,cmprs,command'], 8000);
  const rows = [];
  let header = false;
  const toMB = (s) => {
    const m = s?.match(/^([\d.]+)([BKMGT])\+?-?$/);
    return m ? Math.round(Number(m[1]) * { B: 1 / MB, K: 1 / 1024, M: 1, G: 1024, T: 1024 * 1024 }[m[2]]) : null;
  };
  for (const line of out.split('\n')) {
    if (/^\s*PID\s/.test(line)) {
      header = true;
      continue;
    }
    if (!header) continue;
    const [pid, mem, cmprs, ...cmd] = line.trim().split(/\s+/);
    if (pid) rows.push({ pid: Number(pid), mb: toMB(mem), cmprsMB: toMB(cmprs), comm: cmd.join(' ') });
  }
  const phys = out.match(/PhysMem: (.*)/)?.[1];
  return { phys, rows };
}

// --- Claude app stalls -----------------------------------------------------
let appLogAt = null;
function appStalls() {
  try {
    const size = statSync(APP_LOG).size;
    if (appLogAt === null || size < appLogAt) {
      appLogAt = size;
      return [];
    }
    const len = Math.min(size - appLogAt, 4 * MB);
    const buf = Buffer.alloc(len);
    const fd = openSync(APP_LOG, 'r');
    readSync(fd, buf, 0, len, size - len);
    closeSync(fd);
    appLogAt = size;
    return buf
      .toString('utf8')
      .split('\n')
      .filter((l) => /event-loop-stall|Starting app|process-memory\] app processes' footprint/.test(l))
      .map((l) => l.slice(0, 240));
  } catch {
    return [];
  }
}

// --- loop ------------------------------------------------------------------
mkdirSync(LOG_DIR, { recursive: true });
let day = '';
function logPath(now) {
  const d = now.toISOString().slice(0, 10);
  if (d !== day) {
    day = d;
    const cutoff = Date.now() - KEEP_DAYS * 86400e3;
    for (const f of readdirSync(LOG_DIR)) {
      if (/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f) && Date.parse(f.slice(0, 10)) < cutoff) rmSync(join(LOG_DIR, f), { force: true });
    }
  }
  return join(LOG_DIR, `${day}.jsonl`);
}

let prev = null;
let tick = 0;
function sample() {
  const started = Date.now();
  const now = new Date(started);
  const vm = vmStat();
  const rec = { t: now.toISOString(), ...sysctls() };
  if (prev) {
    const secs = (started - prev.at) / 1000;
    rec.gapS = Math.round(secs * 10) / 10; // well over 10 means this logger itself was starved
    for (const k of RATE_KEYS) if (vm[k] !== undefined && prev.vm[k] !== undefined) rec[`${k}MBps`] = Math.round((((vm[k] - prev.vm[k]) * PAGE) / MB / secs) * 10) / 10;
  }
  rec.freeMB = Math.round((vm.freePages * PAGE) / MB);
  rec.compressedMB = Math.round((vm.cmpStored * PAGE) / MB);
  rec.compressorMB = Math.round((vm.cmpOccupied * PAGE) / MB);
  Object.assign(rec, attribute(processes()));
  if (tick % TOP_EVERY === 0) rec.top = topSnapshot();
  const stalls = appStalls();
  if (stalls.length) rec.app = stalls;
  rec.sampleMs = Date.now() - started;
  appendFileSync(logPath(now), `${JSON.stringify(rec)}\n`);
  prev = { at: started, vm };
  tick++;
  setTimeout(sample, Math.max(1000, INTERVAL_MS - (Date.now() - started)));
}

appStalls(); // start at the current end of the app log
sample();
