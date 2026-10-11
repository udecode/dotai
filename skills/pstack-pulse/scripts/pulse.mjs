import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, unlinkSync } from 'node:fs';
import { createServer } from 'node:http';
import { connect, createServer as createSocketServer } from 'node:net';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeHash, editSettings, hookCommand, nextHeal, plistOf, stableNode, withHook, withoutHook } from './lib/install.mjs';
import { HOME } from './lib/event.mjs';
import { accounts, apiKey, claudeRegistry, loadConfig, loadState, probe, projectOf, railOf, readInbox, saveConfig, saveState, writeFileAtomic } from './lib/io.mjs';
import { firstNeed, incidentsOf, menuBoardOf, petOf, planBoard, reduce, shippedToday, titleStageOf } from './lib/model.mjs';
import { createClient, deliver, teardown } from './lib/phone.mjs';

const SCRIPTS = dirname(realpathSync(fileURLToPath(import.meta.url)));
const SKILL = dirname(SCRIPTS);
const MENU_SOURCE = join(SKILL, 'menubar', 'PulseMenu.swift');
const SKILLS = ['pstack-pulse', 'rca'];
const UPDATE_EVERY_MS = 24 * 3_600_000;
const UPDATED = join(HOME, 'updated.json');
const LABEL = 'dev.pstack.pulse';
const PLIST = join(homedir(), 'Library/LaunchAgents', `${LABEL}.plist`);
const LOG = join(homedir(), 'Library/Logs/pstack-pulse.log');
const MENU = { label: 'dev.pstack.pulse.menu', bin: join(HOME, 'bin/pstack-pulse-menu'), log: join(homedir(), 'Library/Logs/pstack-pulse-menu.log') };
const MENU_PLIST = join(homedir(), 'Library/LaunchAgents', `${MENU.label}.plist`);
const SETTINGS = { claude: join(homedir(), '.claude/settings.json'), codex: join(homedir(), '.codex/hooks.json') };
const EVENTS = {
  claude: [['SessionStart'], ['UserPromptSubmit'], ['PreToolUse', 'AskUserQuestion|ExitPlanMode'], ['PostToolUse'], ['PostToolUseFailure'], ['Notification', 'permission_prompt'], ['PermissionDenied'], ['Stop'], ['StopFailure'], ['SessionEnd']],
  codex: [['SessionStart'], ['UserPromptSubmit'], ['PermissionRequest'], ['PostToolUse'], ['Stop'], ['SessionEnd']],
};
const LOCK = `/tmp/pstack-pulse-${createHash('sha1').update(HOME).digest('hex').slice(0, 12)}.sock`;
const log = (...parts) => console.error(new Date().toISOString(), ...parts);
const launchctl = (...args) => spawnSync('launchctl', args, { encoding: 'utf8' });

let latestViews = [];
let latestMenu = { fleet: null, cards: [] };
let accountCache = { at: 0, value: { desktop: null, cli: null } };
let lastProblems = '';

function viewsOf(sessions) {
  if (Date.now() - accountCache.at > 60_000) accountCache = { at: Date.now(), value: accounts() };
  return Object.values(sessions)
    .filter((session) => session.audience === 'owner')
    .map((session) => {
      const view = {
        session,
        title: session.title ?? basename(session.cwd ?? 'session'),
        project: projectOf(session.cwd),
        account: session.runtime === 'codex' ? null : session.entrypoint === 'cli' ? accountCache.value.cli : accountCache.value.desktop,
        webUrl: session.runtime === 'claude' && session.bridge ? `https://claude.ai/code/${session.bridge}` : null,
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
  const context = { now, shippedToday: shippedToday(state.sessions, now), account: accountCache.value.desktop, listUrl: config.listUrl };
  latestMenu = menuBoardOf(views, context);
  const board = planBoard(views, state.phone, context);
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
      const { session, title, project, rail, account } = view;
      const { state } = session;
      const answerUrl = view.appUrl ?? view.webUrl;
      const stages = rail?.stages?.map(({ label, state }) => `<span class="${escapeHtml(state)}">${escapeHtml(label)}</span>`).join(' ') ?? '<span class="left">No plan</span>';
      const links = [rail?.page && `<a href="${escapeHtml(rail.page)}">Plan page</a>`, answerUrl && `<a href="${escapeHtml(answerUrl)}">Answer</a>`].filter(Boolean).join(' · ');
      const need = state === 'needs-you' ? `<p class="need">${escapeHtml(firstNeed(session).question)}</p>` : '';
      return `<li><h2>${escapeHtml(title)} <small>${escapeHtml(state)}</small></h2><p class="meta">${escapeHtml([project.name, session.runtime, account].filter(Boolean).join(' · '))} · last seen ${escapeHtml(session.lastHookAt.slice(11, 16))}</p><p class="rail">${stages}</p>${need}<p>${links}</p></li>`;
    })
    .join('');
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="refresh" content="15"><title>pstack sessions</title><style>body{font:15px/1.4 system-ui;margin:0 16px;background:#111;color:#eee}li{list-style:none;border-bottom:1px solid #333;padding:10px 0}ul{padding:0}h2{font-size:16px;margin:0}small{color:#f90;font-weight:400}.meta{color:#999;margin:2px 0}.rail span{font-size:12px;margin-right:4px}.done{color:#5c5}.now{color:#fc3}.waiting{color:#f90}.blocked{color:#f55}.skipped,.left{color:#666}.need{color:#f90}a{color:#8bf}</style><h1>pstack sessions</h1><ul>${rows || '<li>No live sessions.</li>'}</ul>`;
}

function serveList(config) {
  if (!config.listPort || !config.secret) return;
  const feeds = { [`/${config.secret}/state.json`]: () => petOf(latestViews, Date.now()), [`/${config.secret}/board.json`]: () => latestMenu };
  createServer((request, response) => {
    const feed = feeds[request.url?.split('?')[0]];
    if (request.method === 'GET' && feed) {
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(feed()));
      return;
    }
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
  let watch = { running: codeHash(SKILL), pending: null };
  for (let ticks = 1; ; ticks += 1) {
    try {
      await tick(state, config, client);
    } catch (error) {
      log('tick', error.stack ?? error.message);
      state = loadState();
    }
    if (ticks % 15 === 0) {
      watch = nextHeal(watch, codeHash(SKILL));
      if (watch.heal) heal();
      if (config.autoUpdate && Date.now() - lastUpdate() > UPDATE_EVERY_MS) spawn(process.execPath, [join(SCRIPTS, 'pulse.mjs'), 'update'], { stdio: 'inherit' });
    }
    await new Promise((done) => setTimeout(done, 2000));
  }
}

// launchd restarts the daemon on its new code; hooks and the menubar are rewritten first, because new code can change them.
function heal() {
  log('skill changed; rewriting hooks and restarting');
  writeHooks(stableNode());
  if (existsSync(MENU_PLIST) && loadConfig().menuSource !== sourceHash()) {
    if (buildMenu().status === 0) launchctl('kickstart', '-k', `gui/${process.getuid()}/${MENU.label}`);
    else log('menubar: rebuild failed; the old one keeps running');
  }
  process.exit(0);
}

const lastUpdate = () => (existsSync(UPDATED) ? JSON.parse(readFileSync(UPDATED, 'utf8')).at : 0);

function update() {
  writeFileAtomic(UPDATED, JSON.stringify({ at: Date.now() }));
  const installed = SKILLS.filter((name) => ['.agents/skills', '.claude/skills'].some((folder) => existsSync(join(homedir(), folder, name))));
  const result = spawnSync(join(dirname(process.execPath), 'npx'), ['--yes', 'skills', 'update', ...installed, '--global', '--yes'], { encoding: 'utf8', timeout: 300_000 });
  log(`update ${installed.join(' ')}: ${result.status === 0 ? 'done' : `failed (${(result.stderr || result.error?.message || '').trim().split('\n').at(-1)})`}`);
  process.exitCode = result.status === 0 ? 0 : 1;
}

function writeHooks(node) {
  for (const runtime of ['claude', 'codex']) editSettings(SETTINGS[runtime], (settings) => withHook(settings, EVENTS[runtime], hookCommand(node, join(SCRIPTS, 'hook.mjs'), runtime)));
}

function load(label, plist) {
  const uid = process.getuid();
  launchctl('bootout', `gui/${uid}/${label}`);
  for (let wait = 0; wait < 40 && launchctl('print', `gui/${uid}/${label}`).status === 0; wait += 1) spawnSync('sleep', ['0.25']);
  return launchctl('bootstrap', `gui/${uid}`, plist);
}

const sourceHash = () => createHash('sha1').update(readFileSync(MENU_SOURCE)).digest('hex');

function buildMenu() {
  mkdirSync(dirname(MENU.bin), { recursive: true });
  const source = sourceHash();
  const build = spawnSync('xcrun', ['swiftc', '-O', '-o', MENU.bin, MENU_SOURCE], { encoding: 'utf8' });
  if (build.status === 0) saveConfig({ ...loadConfig(), menuSource: source });
  return build;
}

function menubar() {
  const build = buildMenu();
  if (build.status !== 0) {
    process.exitCode = 1;
    console.log(`menubar: not built; it needs Xcode's swiftc (${(build.stderr || build.error?.message || '').trim().split('\n')[0]})`);
    return;
  }
  writeFileAtomic(MENU_PLIST, plistOf({ label: MENU.label, args: [MENU.bin], log: MENU.log, path: process.env.PATH, untilQuit: true }));
  const boot = load(MENU.label, MENU_PLIST);
  if (boot.status !== 0) process.exitCode = 1;
  console.log(`menubar: ${boot.status === 0 ? 'started' : `launchctl failed: ${boot.stderr.trim()}`} (${MENU.log})`);
}

function install() {
  const config = loadConfig();
  config.listPort ??= 47811;
  config.secret ??= randomBytes(24).toString('hex');
  const dns = JSON.parse(spawnSync('tailscale', ['status', '--json'], { encoding: 'utf8' }).stdout || '{}').Self?.DNSName?.replace(/\.$/u, '');
  if (dns) config.listUrl = `https://${dns}:8443/${config.secret}/`;
  if (process.argv.includes('--auto-update')) config.autoUpdate = true;
  if (process.argv.includes('--no-auto-update')) config.autoUpdate = false;
  saveConfig(config);
  const node = stableNode();
  writeHooks(node);
  writeFileAtomic(PLIST, plistOf({ label: LABEL, args: [node, join(SCRIPTS, 'pulse.mjs'), 'run'], log: LOG, path: process.env.PATH }));
  const boot = load(LABEL, PLIST);
  if (boot.status !== 0) process.exitCode = 1;
  console.log('hooks: ~/.claude/settings.json and ~/.codex/hooks.json (first backups beside them)');
  console.log(`daemon: ${boot.status === 0 ? 'started' : `launchctl failed: ${boot.stderr.trim()}`} (${LOG})`);
  menubar();
  console.log(`session list: ${config.listUrl ?? 'no tailnet name found'}`);
  console.log(`auto-update: ${config.autoUpdate ? 'on, daily' : 'off; install --auto-update turns it on'}`);
  console.log('still yours to do:');
  console.log('  security add-generic-password -s pstack-pulse -a activitysmith -w   (paste the ActivitySmith key)');
  console.log(`  tailscale funnel --bg --https=8443 http://127.0.0.1:${config.listPort}   (publishes the read-only list)`);
  console.log('  codex: open /hooks once and trust the pstack-pulse hooks');
}

async function uninstall() {
  for (const [label, plist] of [[LABEL, PLIST], [MENU.label, MENU_PLIST]]) {
    launchctl('bootout', `gui/${process.getuid()}/${label}`);
    if (existsSync(plist)) unlinkSync(plist);
  }
  for (const runtime of ['claude', 'codex']) if (existsSync(SETTINGS[runtime])) editSettings(SETTINGS[runtime], withoutHook);
  const state = loadState();
  const problems = await teardown(state.phone, createClient({ getKey: apiKey }), () => saveState(state));
  saveState(state);
  const left = Object.keys(state.phone.streams);
  const cleaned = !left.length && state.phone.badge === 0;
  console.log(`hooks removed, daemon and menubar stopped and their LaunchAgents deleted; ${HOME} keeps its state`);
  console.log(cleaned ? 'cards ended and badge cleared' : `still on the phone: ${left.length} cards, badge ${state.phone.badge ?? 'unknown'}${problems.length ? ` (${problems.join('; ')})` : ''}; rerun uninstall to retry`);
  console.log('to stop publishing the session list: tailscale funnel --https=8443 off');
}

function status() {
  const state = loadState();
  console.log(`daemon: ${launchctl('print', `gui/${process.getuid()}/${LABEL}`).status === 0 ? 'running' : 'stopped'}`);
  for (const session of Object.values(state.sessions).filter((entry) => entry.life === 'live')) {
    console.log(`${session.state.padEnd(9)} ${session.runtime.padEnd(6)} ${session.audience.padEnd(7)} ${projectOf(session.cwd).name.padEnd(12)} ${session.title ?? session.cwd}`);
  }
  console.log(`cards: ${Object.keys(state.phone.streams).join(', ') || 'none'} · badge ${state.phone.badge ?? 0}`);
}

function doctor() {
  const hooked = (path) => existsSync(path) && readFileSync(path, 'utf8').includes('--owner=pstack-pulse');
  const hookCommands = existsSync(SETTINGS.claude) ? Object.values(JSON.parse(readFileSync(SETTINGS.claude, 'utf8')).hooks ?? {}).flat().flatMap((group) => group.hooks ?? []).map((hook) => hook.command) : [];
  const hookNode = hookCommands.map((command) => /^"([^"]+)" "[^"]+hook\.mjs" claude --owner=pstack-pulse$/u.exec(command ?? '')?.[1]).find(Boolean);
  const plist = existsSync(PLIST) ? readFileSync(PLIST, 'utf8') : '';
  const daemonPath = plist.match(/<key>PATH<\/key><string>([^<]*)<\/string>/u)?.[1] ?? '';
  const onDaemonPath = (tool) => spawnSync('/bin/sh', ['-c', `command -v ${tool}`], { env: { PATH: daemonPath } }).status === 0;
  const checks = [
    ['ActivitySmith key', Boolean(apiKey())],
    ['daemon', launchctl('print', `gui/${process.getuid()}/${LABEL}`).status === 0],
    ['menubar', launchctl('print', `gui/${process.getuid()}/${MENU.label}`).status === 0],
    ['Claude hooks', hooked(SETTINGS.claude)],
    ['the hooks\' node', Boolean(hookNode && existsSync(hookNode))],
    ['Codex hooks', hooked(SETTINGS.codex)],
    ['Claude session registry', Object.keys(claudeRegistry()).length > 0],
    ['session list secret', Boolean(loadConfig().secret)],
  ];
  const hints = [
    ['a pstack session seen; cards show only sessions titled by the Session title rule of a repository synced by sync-pstack', Object.values(loadState().sessions).some(({ title }) => titleStageOf(title))],
    ['a session list URL; without Tailscale Funnel the All sessions buttons open nothing', Boolean(loadConfig().listUrl)],
    ['cc-same on the daemon PATH, for the account on the menubar', onDaemonPath('cc-same')],
    ['cswap on the daemon PATH, for the CLI account on the session list', onDaemonPath('cswap')],
    ['auto-update; install --auto-update turns it on', Boolean(loadConfig().autoUpdate)],
  ];
  for (const [name, ok] of checks) console.log(`${ok ? 'ok  ' : 'MISS'} ${name}`);
  for (const [name, ok] of hints) console.log(`${ok ? 'ok  ' : 'warn'} ${name}`);
  process.exitCode = checks.every(([, ok]) => ok) ? 0 : 1;
}

function pet() {
  const child = spawn('npx', ['--yes', 'electron@44', join(SCRIPTS, '..', 'desktop')], { detached: true, stdio: 'ignore' });
  child.unref();
  console.log('pet: starting the floating pet');
}

const commands = { run, install, uninstall, status, doctor, menubar, pet, update };
const command = commands[process.argv[2]];
if (!command) {
  console.error('usage: pulse.mjs install [--auto-update | --no-auto-update] | update | uninstall | status | doctor | menubar | run | pet');
  process.exit(2);
}
await command();
