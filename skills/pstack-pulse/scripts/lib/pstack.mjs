import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

// These copy sync-pstack's lead.mjs, levels.mjs and pinned(), because one installed skill cannot import another's;
// pulse.test.mjs fails when the copies drift from lead.mjs.
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const rank = (effort) => EFFORTS.indexOf(effort);
const capEffort = (effort, max) => (max && rank(effort) > rank(max) ? max : effort);
const seatKey = (model) => model.replace(/^codex:/u, '').replace(/^claude-([a-z]+)-.*$/u, '$1');
const PLUGIN = 'pstack@pstack-claude';
const MARKETPLACE = 'pstack-claude';
const REPO = 'michael-denyer/pstack-claude';

const SETTINGS = new Set(['default effort', 'session hook']);
const PARENT = new Set(['inherit-parent', 'auto']);
const ROW = /^([a-z][a-z ,-]*?):\s+(\S.*?)\s*$/u;
const RESCAN_MS = 60_000;

const files = new Map();
// A file is parsed again only when its inode, size or mtime changed; a missing one reads as undefined.
function read(path, parse) {
  let stamp = null;
  let entry;
  try {
    const stat = statSync(path, { throwIfNoEntry: false });
    stamp = stat ? `${stat.ino}:${stat.size}:${stat.mtimeMs}` : 'missing';
    const hit = files.get(path);
    if (hit?.stamp === stamp) return hit.entry;
    entry = { value: stat ? parse(readFileSync(path, 'utf8')) : undefined };
  } catch (error) {
    entry = { value: undefined, problem: error.message };
  }
  files.set(path, { stamp, entry });
  return entry;
}

function rowsOf(text) {
  const rows = new Map();
  const twice = new Set();
  for (const line of text.split(/\r?\n/u)) {
    const [, key, value] = ROW.exec(line) ?? [];
    if (!key) continue;
    if (rows.has(key)) twice.add(key);
    else rows.set(key, value);
  }
  return { rows, twice };
}

function sheetOf(text) {
  const { rows, twice } = rowsOf(text);
  const problems = [...twice].map((key) => `"${key}" is set twice`);
  for (const [key, value] of rows) {
    if (key === 'session hook') continue;
    const efforts = key === 'default effort' ? [value].filter((effort) => effort !== 'session') : value.split(',').flatMap((entry) => /\s@(\S+)$/u.exec(entry.trim())?.[1] ?? []);
    for (const effort of efforts) if (rank(effort) < 0) problems.push(`"${key}" names effort ${effort}`);
  }
  return { rows, problems };
}

function codexPinOf(text) {
  let inTable = false;
  let ref = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('[')) inTable = /^\[marketplaces\.(?:"pstack-claude"|pstack-claude)\]/u.test(line);
    else if (inTable) ref = line.match(/^ref\s*=\s*"([^"]+)"/u)?.[1] ?? ref;
  }
  return ref;
}

const marketplaceOf = (settings) => settings?.extraKnownMarketplaces?.[MARKETPLACE]?.source;
const isMainCheckout = (path) => statSync(join(path, '.git'), { throwIfNoEntry: false })?.isDirectory() ?? false;

const roots = new Map();
function rootOf(cwd) {
  const hit = roots.get(cwd);
  if (hit && Date.now() - hit.at < RESCAN_MS) return hit.root;
  let root = null;
  for (let dir = cwd; dir !== dirname(dir) && !root; dir = dirname(dir)) if (existsSync(join(dir, '.agents/pstack.json'))) root = dir;
  roots.set(cwd, { root, at: Date.now() });
  return root;
}

let scan = { key: null, at: 0, found: [] };
// Finds managed projects the way sync-pstack status does: the configured repositories and the main checkouts beside them.
function discover(home, live) {
  const sets = read(join(home, '.agents/config.json'), JSON.parse).value?.syncedRepositories?.sets ?? {};
  const repos = Object.values(sets).flatMap((set) => set.repos ?? []);
  const dirs = [...new Set([...repos, ...live.filter(isMainCheckout)].map((path) => dirname(path)))].toSorted();
  const key = dirs.join('\n');
  if (scan.key === key && Date.now() - scan.at < RESCAN_MS) return scan.found;
  const found = dirs.filter(existsSync).flatMap((dir) =>
    readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(dir, entry.name))
      .filter((path) => isMainCheckout(path) && existsSync(join(path, '.agents/pstack.json'))),
  );
  scan = { key, at: Date.now(), found };
  return found;
}

function projectOf(root, problems) {
  const config = read(join(root, '.agents/pstack.json'), JSON.parse);
  const settings = read(join(root, '.claude/settings.json'), JSON.parse);
  const name = basename(root);
  if (config.problem) problems.push(`${name}: .agents/pstack.json: ${config.problem}`);
  if (settings.problem) problems.push(`${name}: .claude/settings.json: ${settings.problem}`);
  const maxEffort = config.value?.maxEffort ?? null;
  if (maxEffort !== null && rank(maxEffort) < 0) problems.push(`${name}: maxEffort is ${maxEffort}`);
  const source = marketplaceOf(settings.value);
  const pinned = settings.value?.enabledPlugins?.[PLUGIN] === true && source?.source === 'github' && source.repo === REPO;
  return { name, listed: isMainCheckout(root), tag: config.value?.tag ?? null, maxEffort: rank(maxEffort) < 0 ? null : maxEffort, installed: pinned ? source.ref : null };
}

/** Everything pulse shows about the pstack setup, read from the files setup-pstack and sync-pstack write. A bad file becomes a problem, not an error. */
export function readPstack(cwds, home = homedir()) {
  const problems = [];
  const tilde = (path) => `~${path.slice(home.length)}`;
  const sheetAt = (path) => {
    const { value, problem } = read(path, sheetOf);
    if (problem || !value) problems.push(problem ? `${tilde(path)}: ${problem}` : `No models sheet at ${tilde(path)}`);
    else problems.push(...value.problems.map((text) => `${tilde(path)}: ${text}`));
    return value ?? null;
  };
  const claudeSettings = read(join(home, '.claude/settings.json'), JSON.parse);
  if (claudeSettings.problem) problems.push(`~/.claude/settings.json: ${claudeSettings.problem}`);
  const claude = {
    sheet: sheetAt(join(home, '.claude/pstack-models.md')),
    includes: /^@.*pstack-models\.md\s*$/mu.test(read(join(home, '.claude/CLAUDE.md'), String).value ?? ''),
    userPin: marketplaceOf(claudeSettings.value)?.ref ?? null,
    newSessions: claudeSettings.value?.effortLevel ?? null,
  };
  const codexHome = join(home, '.codex');
  const codex = existsSync(codexHome)
    ? {
        sheet: sheetAt(join(codexHome, 'pstack-models.md')),
        copied: rowsOf(read(join(codexHome, 'AGENTS.md'), String).value ?? '').rows,
        userPin: read(join(codexHome, 'config.toml'), codexPinOf).value ?? null,
      }
    : null;
  const live = [...new Set(cwds.filter(Boolean))];
  const cwdRoots = new Map(live.map((cwd) => [cwd, rootOf(cwd)]));
  const liveRoots = [...cwdRoots.values()].filter(Boolean);
  const projects = new Map([...new Set([...discover(home, liveRoots), ...liveRoots])].map((root) => [root, projectOf(root, problems)]));
  return { claude, codex, projects, roots: cwdRoots, problems };
}

const firstModel = (value) => value?.split(',')[0].trim().split(/\s+@/u)[0] ?? null;

/** A session row's model and effort, orange when the lead misses its sheet's strongest-judgment model or effort floor. */
export function levelRowOf(session, config) {
  const { level } = session;
  if (!level) return null;
  const shown = `${level.model.replace(/^claude-/u, '')} @${level.effort}`;
  if (rank(level.effort) < 0) return { title: shown, color: 'gray' };
  const sheet = config[session.runtime]?.sheet;
  const cap = config.projects.get(config.roots.get(session.cwd))?.maxEffort ?? null;
  // No config line names a lead's level, so pulse holds a lead to the strongest-judgment model and to the default effort its helpers start at.
  const model = firstModel(sheet?.rows.get('strongest judgment'));
  const defaultEffort = sheet?.rows.get('default effort');
  const floor = rank(defaultEffort) < 0 ? null : capEffort(defaultEffort, cap);
  const offModel = Boolean(model) && !PARENT.has(model) && seatKey(level.model) !== seatKey(model);
  const below = Boolean(floor) && rank(level.effort) < rank(floor);
  const notes = [offModel && `↓ ${seatKey(model)}`, below && `↓ ${floor}`, cap && rank(level.effort) > rank(cap) && `(cap ${cap})`].filter(Boolean);
  return { title: [shown, ...notes].join(' '), color: offModel || below ? 'orange' : 'gray' };
}

const listedOf = (config) => [...config.projects.values()].filter(({ listed }) => listed).toSorted((a, b) => a.name.localeCompare(b.name));

function findingsOf(config) {
  const { claude, codex } = config;
  const findings = config.problems.map((title) => ({ title }));
  if (codex?.sheet) {
    const same = (a, b) => a?.replace(/\s+/gu, ' ') === b.replace(/\s+/gu, ' ');
    const drift = [...codex.sheet.rows].filter(([key, value]) => key !== 'session hook' && !same(codex.copied.get(key), value)).map(([key, value]) => `${key}: ${codex.copied.get(key) ?? 'missing'}  (sheet: ${value})`);
    if (drift.length) findings.push({ title: `Codex instructions differ from its sheet on ${drift.length === 1 ? '1 row' : `${drift.length} rows`}`, details: ['~/.codex/AGENTS.md against ~/.codex/pstack-models.md', ...drift] });
  }
  if (!claude.includes) findings.push({ title: 'Claude sessions do not load the models sheet', details: ['~/.claude/CLAUDE.md has no @ include of pstack-models.md'] });
  if (codex && claude.userPin !== codex.userPin) findings.push({ title: 'The user pins differ', details: [`Claude ${claude.userPin ?? 'none'}`, `Codex ${codex.userPin ?? 'none'}`] });
  for (const project of listedOf(config)) {
    if (project.tag !== project.installed) findings.push({ title: `${project.name} pins ${project.installed ?? 'no pstack'}, but its config says ${project.tag}` });
    else if (project.tag !== claude.userPin) findings.push({ title: `${project.name} is on ${project.tag}, your user pin is ${claude.userPin ?? 'none'}` });
  }
  return findings;
}

function runtimeRow(name, sheet, extra) {
  if (!sheet) return { title: `${name} · no models sheet` };
  const title = [name, `default ${sheet.rows.get('default effort') ?? 'session'}`, `hook ${sheet.rows.get('session hook') ?? 'on'}`, extra].filter(Boolean).join(' · ');
  return { title, items: [...sheet.rows].filter(([key]) => !SETTINGS.has(key)).map(([role, value]) => ({ title: `${role}: ${value}` })) };
}

/** The menubar's pstack row: findings first, then each runtime's roles, each project's pin and cap, and the user pins. A null item is a separator. */
export function pstackSectionOf(config) {
  const findings = findingsOf(config);
  const { claude, codex } = config;
  const listed = listedOf(config);
  return {
    title: `pstack ${claude.userPin ?? codex?.userPin ?? 'unpinned'} · ${findings.length === 0 ? 'all clear' : findings.length === 1 ? '1 finding' : `${findings.length} findings`}`,
    color: findings.length ? 'orange' : 'gray',
    items: [
      ...findings.map(({ title, details = [] }) => ({ title: `⚠ ${title}`, color: 'orange', items: details.map((detail) => ({ title: detail })) })),
      ...(findings.length ? [null] : []),
      runtimeRow('Claude', claude.sheet, claude.newSessions && `new sessions ${claude.newSessions}`),
      ...(codex ? [runtimeRow('Codex', codex.sheet)] : []),
      null,
      ...listed.map(({ name, tag, maxEffort }) => ({ title: `${name} · ${tag ?? 'no tag'} · ${maxEffort ? `cap ${maxEffort}` : 'no cap'}` })),
      ...(listed.length ? [null] : []),
      { title: ['User pins', `Claude ${claude.userPin ?? 'none'}`, codex && `Codex ${codex.userPin ?? 'none'}`].filter(Boolean).join(' · ') },
    ],
  };
}
