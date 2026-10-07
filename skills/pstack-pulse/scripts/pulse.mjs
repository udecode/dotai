import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, unlinkSync } from 'node:fs';
import { createServer } from 'node:http';
import { connect, createServer as createSocketServer } from 'node:net';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { editSettings, hookCommand, plistOf, withHook, withoutHook } from './lib/install.mjs';
import { HOME } from './lib/event.mjs';
import { accounts, apiKey, claudeRegistry, loadConfig, loadState, probe, railOf, readInbox, repoOf, saveConfig, saveState, writeFileAtomic } from './lib/io.mjs';
import { firstNeed, incidentsOf, keyOf, planBoard, reduce, shippedToday } from './lib/model.mjs';
import { createClient, deliver, teardown } from './lib/phone.mjs';

const SCRIPTS = dirname(realpathSync(fileURLToPath(import.meta.url)));
const LABEL = 'dev.pstack.pulse';
const PLIST = join(homedir(), 'Library/LaunchAgents', `${LABEL}.plist`);
const LOG = join(homedir(), 'Library/Logs/pstack-pulse.log');
const SETTINGS = { claude: join(homedir(), '.claude/settings.json'), codex: join(homedir(), '.codex/hooks.json') };
const EVENTS = {
  claude: [['SessionStart'], ['UserPromptSubmit'], ['PreToolUse', 'AskUserQuestion|ExitPlanMode'], ['PostToolUse'], ['PostToolUseFailure'], ['Notification', 'permission_prompt'], ['PermissionDenied'], ['Stop'], ['StopFailure'], ['SessionEnd']],
  codex: [['SessionStart'], ['UserPromptSubmit'], ['PermissionRequest'], ['PostToolUse'], ['Stop'], ['SessionEnd']],
};
const LOCK = `/tmp/pstack-pulse-${createHash('sha1').update(HOME).digest('hex').slice(0, 12)}.sock`;
const log = (...parts) => console.error(new Date().toISOString(), ...parts);
const launchctl = (...args) => spawnSync('launchctl', args, { encoding: 'utf8' });

let latestViews = [];
let accountCache = { at: 0, value: { desktop: null, cli: null } };
let lastProblems = '';

function viewsOf(sessions) {
  if (Date.now() - accountCache.at > 60_000) accountCache = { at: Date.now(), value: accounts() };
  return Object.values(sessions)
    .filter((session) => session.audience === 'owner')
    .map((session) => {
      const root = repoOf(session.cwd);
      const view = {
        session,
        title: session.title ?? basename(session.cwd ?? 'session'),
        repo: root ? basename(root) : null,
        account: session.runtime === 'codex' ? null : session.entrypoint === 'cli' ? accountCache.value.cli : accountCache.value.desktop,
        webUrl: session.runtime === 'codex' ? null : session.bridge ? `https://claude.ai/code/${session.bridge}` : 'https://claude.ai/code',
        appUrl: session.runtime === 'codex' ? 'chatgpt://' : null,
        rail: session.life === 'live' ? railOf(session.plan) : null,
      };
      return view;
    });
}

async function tick(state, config, client) {
  const now = Date.now();
  const problems = [];
  const batch = readInbox(state.applied);
  for (const { event } of batch) reduce(state.sessions, { kind: 'hook', ...event });
  for (const observation of probe(state.sessions, now, problems)) reduce(state.sessions, observation);
  reduce(state.sessions, { kind: 'clock', at: new Date(now).toISOString() });
  state.applied = batch.map(({ name }) => name);
  saveState(state);
  const views = viewsOf(state.sessions);
  latestViews = views;
  const board = planBoard(views, state.phone, { now, shippedToday: shippedToday(state.sessions, now), account: accountCache.value.desktop, listUrl: config.listUrl });
  problems.push(...(await deliver(state.phone, { cards: board.cards, badge: board.badge, incidents: incidentsOf(views), listUrl: config.listUrl }, { client, save: () => saveState(state) })));
  saveState(state);
  const summary = problems.join('; ');
  if (summary && summary !== lastProblems) log(summary);
  lastProblems = summary;
}

const escapeHtml = (text) => String(text ?? '').replace(/[&<>"']/gu, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

function listHtml() {
  const rows = latestViews
    .filter(({ session }) => session.life === 'live')
    .toSorted((a, b) => b.session.lastHookAt.localeCompare(a.session.lastHookAt))
    .map((view) => {
      const { session, title, repo, rail, account } = view;
      const { state } = session;
      const answerUrl = view.appUrl ?? view.webUrl;
      const stages = rail?.stages?.map(({ label, state }) => `<span class="${escapeHtml(state)}">${escapeHtml(label)}</span>`).join(' ') ?? '<span class="left">No plan</span>';
      const links = [rail?.page && `<a href="${escapeHtml(rail.page)}">Plan page</a>`, answerUrl && `<a href="${escapeHtml(answerUrl)}">Answer</a>`].filter(Boolean).join(' · ');
      const need = state === 'needs-you' ? `<p class="need">${escapeHtml(firstNeed(session).question)}</p>` : '';
      return `<li><h2>${escapeHtml(title)} <small>${escapeHtml(state)}</small></h2><p class="meta">${escapeHtml([repo, session.runtime, account].filter(Boolean).join(' · '))} · last seen ${escapeHtml(session.lastHookAt.slice(11, 16))}</p><p class="rail">${stages}</p>${need}<p>${links}</p></li>`;
    })
    .join('');
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="refresh" content="15"><title>pstack sessions</title><style>body{font:15px/1.4 system-ui;margin:0 16px;background:#111;color:#eee}li{list-style:none;border-bottom:1px solid #333;padding:10px 0}ul{padding:0}h2{font-size:16px;margin:0}small{color:#f90;font-weight:400}.meta{color:#999;margin:2px 0}.rail span{font-size:12px;margin-right:4px}.done{color:#5c5}.now{color:#fc3}.waiting{color:#f90}.blocked{color:#f55}.skipped,.left{color:#666}.need{color:#f90}a{color:#8bf}</style><h1>pstack sessions</h1><ul>${rows || '<li>No live sessions.</li>'}</ul>`;
}

function serveList(config) {
  if (!config.listPort || !config.secret) return;
  createServer((request, response) => {
    if (request.method === 'GET' && request.url?.split('?')[0].replace(/\/$/u, '') === `/${config.secret}`) {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
      response.end(listHtml());
      return;
    }
    response.writeHead(404);
    response.end();
  })
    .on('error', (error) => log('session list off:', error.message))
    .listen(config.listPort, '127.0.0.1');
}

const listenOn = (server, path) =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(path, resolve);
  });

async function lockOrExit() {
  mkdirSync(HOME, { recursive: true });
  const lock = createSocketServer((socket) => socket.end());
  try {
    await listenOn(lock, LOCK);
    return;
  } catch (error) {
    if (error.code !== 'EADDRINUSE') throw error;
  }
  const held = await new Promise((resolve) => {
    const socket = connect(LOCK);
    socket.once('connect', () => resolve(true)).once('error', () => resolve(false));
  });
  if (held) {
    log('another pstack-pulse daemon holds the lock; exiting');
    process.exit(0);
  }
  unlinkSync(LOCK);
  await listenOn(lock, LOCK);
}

async function run() {
  const config = loadConfig();
  await lockOrExit();
  let state = loadState();
  const client = createClient({ getKey: apiKey });
  serveList(config);
  log('pstack-pulse running', SCRIPTS);
  for (;;) {
    try {
      await tick(state, config, client);
    } catch (error) {
      log('tick', error.stack ?? error.message);
      state = loadState();
    }
    await new Promise((done) => setTimeout(done, 2000));
  }
}

function install() {
  const config = loadConfig();
  config.listPort ??= 47811;
  config.secret ??= randomBytes(24).toString('hex');
  const dns = JSON.parse(spawnSync('tailscale', ['status', '--json'], { encoding: 'utf8' }).stdout || '{}').Self?.DNSName?.replace(/\.$/u, '');
  if (dns) config.listUrl = `https://${dns}:8443/${config.secret}/`;
  saveConfig(config);
  for (const runtime of ['claude', 'codex']) editSettings(SETTINGS[runtime], (settings) => withHook(settings, EVENTS[runtime], hookCommand(process.execPath, join(SCRIPTS, 'hook.mjs'), runtime)));
  writeFileAtomic(PLIST, plistOf({ label: LABEL, node: process.execPath, script: join(SCRIPTS, 'pulse.mjs'), log: LOG, path: process.env.PATH }));
  const uid = process.getuid();
  launchctl('bootout', `gui/${uid}/${LABEL}`);
  for (let wait = 0; wait < 40 && launchctl('print', `gui/${uid}/${LABEL}`).status === 0; wait += 1) spawnSync('sleep', ['0.25']);
  const boot = launchctl('bootstrap', `gui/${uid}`, PLIST);
  if (boot.status !== 0) process.exitCode = 1;
  console.log('hooks: ~/.claude/settings.json and ~/.codex/hooks.json (first backups beside them)');
  console.log(`daemon: ${boot.status === 0 ? 'started' : `launchctl failed: ${boot.stderr.trim()}`} (${LOG})`);
  console.log(`session list: ${config.listUrl ?? 'no tailnet name found'}`);
  console.log('still yours to do:');
  console.log('  security add-generic-password -s pstack-pulse -a activitysmith -w   (paste the ActivitySmith key)');
  console.log(`  tailscale funnel --bg --https=8443 http://127.0.0.1:${config.listPort}   (publishes the read-only list)`);
  console.log('  codex: open /hooks once and trust the pstack-pulse hooks');
}

async function uninstall() {
  launchctl('bootout', `gui/${process.getuid()}/${LABEL}`);
  if (existsSync(PLIST)) unlinkSync(PLIST);
  for (const runtime of ['claude', 'codex']) if (existsSync(SETTINGS[runtime])) editSettings(SETTINGS[runtime], withoutHook);
  const state = loadState();
  const problems = await teardown(state.phone, createClient({ getKey: apiKey }), () => saveState(state));
  saveState(state);
  const left = Object.keys(state.phone.streams);
  const cleaned = !left.length && state.phone.badge === 0;
  console.log(`hooks removed, daemon stopped and its LaunchAgent deleted; ${HOME} keeps its state`);
  console.log(cleaned ? 'cards ended and badge cleared' : `still on the phone: ${left.length} cards, badge ${state.phone.badge ?? 'unknown'}${problems.length ? ` (${problems.join('; ')})` : ''}; rerun uninstall to retry`);
  console.log('to stop publishing the session list: tailscale funnel --https=8443 off');
}

function status() {
  const state = loadState();
  console.log(`daemon: ${launchctl('print', `gui/${process.getuid()}/${LABEL}`).status === 0 ? 'running' : 'stopped'}`);
  for (const session of Object.values(state.sessions).filter((entry) => entry.life === 'live')) {
    console.log(`${session.state.padEnd(9)} ${session.runtime.padEnd(6)} ${session.audience.padEnd(7)} ${keyOf(session)} ${session.title ?? session.cwd}`);
  }
  console.log(`cards: ${Object.keys(state.phone.streams).join(', ') || 'none'} · badge ${state.phone.badge ?? 0}`);
}

function doctor() {
  const hooked = (path) => existsSync(path) && readFileSync(path, 'utf8').includes('--owner=pstack-pulse');
  const plist = existsSync(PLIST) ? readFileSync(PLIST, 'utf8') : '';
  const daemonPath = plist.match(/<key>PATH<\/key><string>([^<]*)<\/string>/u)?.[1] ?? '';
  const onDaemonPath = (tool) => spawnSync('/bin/sh', ['-c', `command -v ${tool}`], { env: { PATH: daemonPath } }).status === 0;
  const checks = [
    ['ActivitySmith key', Boolean(apiKey())],
    ['daemon', launchctl('print', `gui/${process.getuid()}/${LABEL}`).status === 0],
    ['Claude hooks', hooked(SETTINGS.claude)],
    ['Codex hooks', hooked(SETTINGS.codex)],
    ['Claude session registry', Object.keys(claudeRegistry()).length > 0],
    ['cc-same on the daemon PATH', onDaemonPath('cc-same')],
    ['cswap on the daemon PATH', onDaemonPath('cswap')],
    ['session list secret', Boolean(loadConfig().secret)],
  ];
  for (const [name, ok] of checks) console.log(`${ok ? 'ok  ' : 'MISS'} ${name}`);
  process.exitCode = checks.every(([, ok]) => ok) ? 0 : 1;
}

const commands = { run, install, uninstall, status, doctor };
const command = commands[process.argv[2]];
if (!command) {
  console.error('usage: pulse.mjs install | uninstall | status | doctor | run');
  process.exit(2);
}
await command();
