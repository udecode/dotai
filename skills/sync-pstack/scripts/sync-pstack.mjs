#!/usr/bin/env node
// Sets up pstack in a project and keeps pstack projects on one plugin tag and
// one shared overrides block. Run with `help` for the commands. The block
// template and the helper scripts it installs live in ../assets.

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = join(SKILL, 'assets/block.md');
const HELPERS = join(SKILL, 'assets/pstack');
const CONFIG = '.agents/pstack.json';
const HELPER_DIR = '.agents/pstack';
const SECTION_HELPERS = { plans: ['decisions-check.mjs', 'plan-open.mjs'] };
const PLUGIN = 'pstack@pstack-claude';
const MARKETPLACE = 'pstack-claude';
const REPO = 'michael-denyer/pstack-claude';
const BEGIN =
  '<!-- pstack:begin (rendered by the sync-pstack skill from udecode/dotai; edit that source, or add a rule outside this block) -->';
const END = '<!-- pstack:end -->';
const DELIVERIES = ['push', 'pr', 'user'];
const REQUIRED = ['tag', 'branch', 'delivery', 'lintFix', 'check'];
const DAY = 24 * 60 * 60 * 1000;
const SWITCHES = { '--force': 'force', '--dry-run': 'dryRun', '--json': 'json', '--offline': 'offline', '--allow-dirty': 'allowDirty' };

const sha = (text) => createHash('sha256').update(text).digest('hex');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

function gitRaw(root, ...args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout : null;
}

const git = (root, ...args) => gitRaw(root, ...args)?.trim() ?? null;

// Transcript lines are external data; a torn or foreign line is skipped.
function parseLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

export function render(template, config) {
  const skip = new Set(config.skip ?? []);
  const sections = new Set();
  const regions = [];
  const out = [];
  for (const [index, raw] of template.split('\n').entries()) {
    const line = raw.trim();
    if (line.startsWith('<!-- #')) continue;
    const open = line.match(/^<!-- (if|section) (\S+) -->$/u);
    if (open) {
      if (open[1] === 'section') sections.add(open[2]);
      regions.push(open[1] === 'section' ? !skip.has(open[2]) : holds(open[2], config));
      continue;
    }
    if (line === '<!-- end -->') {
      if (regions.pop() === undefined) throw new Error(`Template line ${index + 1}: <!-- end --> closes nothing`);
      continue;
    }
    if (regions.every(Boolean)) out.push(raw.replace(/\{\{(\w+)\}\}/gu, (_, key) => fill(key, config, index)));
  }
  if (regions.length > 0) throw new Error('Template ends inside an open region');
  const unknown = [...skip].filter((id) => !sections.has(id));
  if (unknown.length > 0) {
    throw new Error(`skip names unknown sections: ${unknown.join(', ')} (sections: ${[...sections].join(', ')})`);
  }
  return out.join('\n').replace(/\n{3,}/gu, '\n\n').trim();
}

function holds(expression, config) {
  const match = expression.match(/^(!?)(\w+)(?:(!?=)(.+))?$/u);
  if (!match) throw new Error(`Bad template condition: ${expression}`);
  const [, negate, key, operator, values] = match;
  const actual = config[key];
  let result = Array.isArray(actual) ? actual.length > 0 : Boolean(actual);
  if (operator) {
    const hit = values.split('|').includes(String(actual));
    result = operator === '=' ? hit : !hit;
  }
  return negate ? !result : result;
}

function fill(key, config, index) {
  const value = config[key];
  if (value === undefined || value === null || value === '') {
    throw new Error(`Template line ${index + 1} needs "${key}" in ${CONFIG}`);
  }
  return String(value);
}

function validate(config) {
  const missing = REQUIRED.filter((key) => !config[key]);
  if (missing.length > 0) throw new Error(`${CONFIG} is missing ${missing.join(', ')}`);
  if (!DELIVERIES.includes(config.delivery)) throw new Error(`delivery must be one of ${DELIVERIES.join(', ')}`);
  if (!/^v\d+\.\d+\.\d+$/u.test(config.tag)) throw new Error(`tag must look like v0.9.52, got ${config.tag}`);
  if (config.protected && config.protected === config.branch) {
    throw new Error('protected must differ from branch; leave it empty when agents work on the default branch');
  }
  if (config.skip !== undefined && !Array.isArray(config.skip)) throw new Error('skip must be a list of section ids');
}

export function locateBlock(text) {
  const lines = text.split('\n');
  const begins = lines.flatMap((line, index) => (line.startsWith('<!-- pstack:begin') ? [index] : []));
  const ends = lines.flatMap((line, index) => (line.trim() === END ? [index] : []));
  if (begins.length === 0 && ends.length === 0) return null;
  if (begins.length !== 1 || ends.length !== 1 || ends[0] < begins[0]) {
    throw new Error('AGENTS.md must hold exactly one pstack:begin ... pstack:end block');
  }
  return { begin: begins[0], end: ends[0], body: lines.slice(begins[0] + 1, ends[0]).join('\n').trim() };
}

// A new block goes before the first section heading, after the file's intro.
function withBlock(text, body) {
  const block = [BEGIN, body, END];
  const lines = text.split('\n');
  const found = locateBlock(text);
  if (found) {
    lines.splice(found.begin, found.end - found.begin + 1, ...block);
    return lines.join('\n');
  }
  let fenced = false;
  const at = lines.findIndex((line) => {
    if (/^\s*(?:```|~~~)/u.test(line)) fenced = !fenced;
    return !fenced && line.startsWith('## ');
  });
  if (at === -1) return `${text.trimEnd()}${text.trim() ? '\n\n' : ''}${block.join('\n')}\n`;
  lines.splice(at, 0, ...(at > 0 && lines[at - 1].trim() !== '' ? [''] : []), ...block, '');
  return lines.join('\n');
}

function diff(before, after) {
  const dir = mkdtempSync(join(tmpdir(), 'sync-pstack-'));
  try {
    writeFileSync(join(dir, 'current'), `${before}\n`);
    writeFileSync(join(dir, 'rendered'), `${after}\n`);
    const { stdout } = spawnSync('git', ['diff', '--no-index', '--no-color', '--', join(dir, 'current'), join(dir, 'rendered')], {
      encoding: 'utf8',
    });
    return stdout
      .split('\n')
      .filter((line) => !/^(?:diff --git|index |--- |\+\+\+ )/u.test(line))
      .join('\n')
      .trimEnd();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function pinned(settings, tag) {
  const source = settings.extraKnownMarketplaces?.[MARKETPLACE]?.source;
  return settings.enabledPlugins?.[PLUGIN] === true && source?.source === 'github' && source.repo === REPO && source.ref === tag;
}

// Writes JSON in the settings file's own array style, so a first pin does not
// reformat the file: short arrays of plain values stay on one line when the
// file already prints them that way.
function formatJson(value, collapse, indent = '', used = 0) {
  const inner = `${indent}  `;
  if (Array.isArray(value) && value.length > 0) {
    const flat = `[${value.map((item) => JSON.stringify(item)).join(', ')}]`;
    if (collapse && value.every((item) => item === null || typeof item !== 'object') && used + flat.length < 80) return flat;
    return `[\n${value.map((item) => `${inner}${formatJson(item, collapse, inner, inner.length)}`).join(',\n')}\n${indent}]`;
  }
  if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0) {
    const entries = Object.entries(value).map(([key, item]) => {
      const head = `${inner}${JSON.stringify(key)}: `;
      return head + formatJson(item, collapse, inner, head.length);
    });
    return `{\n${entries.join(',\n')}\n${indent}}`;
  }
  return JSON.stringify(value);
}

// A tag bump moves only the ref, leaving the rest of the file as it was.
function settingsText(text, settings, tag) {
  if (text && settings.enabledPlugins?.[PLUGIN] === true) {
    const moved = text.replace(/("pstack-claude"\s*:\s*\{\s*"source"\s*:\s*\{[^{}]*?"ref"\s*:\s*")[^"]*(")/u, `$1${tag}$2`);
    if (moved !== text && pinned(JSON.parse(moved), tag)) return moved;
  }
  const collapse = /\[[^\n\]]+\]/u.test(text) && !/\[\n\s*[^\s{[]/u.test(text);
  return `${formatJson(pin(settings, tag), collapse)}\n`;
}

function pin(settings, tag) {
  return {
    ...settings,
    enabledPlugins: { ...settings.enabledPlugins, [PLUGIN]: true },
    extraKnownMarketplaces: {
      ...settings.extraKnownMarketplaces,
      [MARKETPLACE]: { source: { source: 'github', repo: REPO, ref: tag } },
    },
  };
}

// The last commit that changed the shared assets, recorded so a later sync can
// rebuild exactly what it wrote. Unknown for a copy outside git or with
// uncommitted assets.
function sourceRevision() {
  if (git(SKILL, 'rev-parse', '--show-prefix') === null) return null;
  if (git(SKILL, 'status', '--porcelain', '--', 'assets')) return null;
  return git(SKILL, 'log', '-1', '--format=%H', '--', 'assets') || null;
}

function sourceFile(rev, path) {
  const prefix = git(SKILL, 'rev-parse', '--show-prefix');
  return prefix === null ? null : gitRaw(SKILL, 'show', `${rev}:${prefix}${path}`);
}

// Rebuilds what the last sync wrote, so a refusal shows exactly what changed in
// the project rather than mixing it with changes to the shared source.
function lastVersion(stored, path, build, expected) {
  const text = stored.synced?.source && expected ? sourceFile(stored.synced.source, path) : null;
  if (text === null) return null;
  try {
    const built = build(text);
    return sha(built) === expected ? built : null;
  } catch {
    // An older template may not render with the current config; the caller
    // then compares against the new render instead.
    return null;
  }
}

// An older copy of the shared source would silently undo newer shared rules.
function olderSource(stored) {
  const rev = stored.synced?.source;
  if (!rev) return null;
  const head = git(SKILL, 'rev-parse', 'HEAD');
  const short = rev.slice(0, 7);
  if (head === null) return `the project was last synced from ${short}, and this copy of sync-pstack is outside git; run the dotai checkout's script`;
  const { status } = spawnSync('git', ['-C', SKILL, 'merge-base', '--is-ancestor', rev, 'HEAD']);
  if (status === 0) return null;
  return status === 1
    ? `the project was last synced from ${short}, which this source (${head.slice(0, 7)}) does not include`
    : `the project was last synced from ${short}, which this checkout does not have; fetch it first`;
}

// Plans the writes that bring a project to its config; writes them only when
// nothing was refused. A block or helper whose hash differs from the last sync
// was edited in the project, and is kept until --force.
export function apply(root, { tag, force = false, write = true } = {}) {
  const configPath = join(root, CONFIG);
  if (!existsSync(configPath)) throw new Error(`${configPath} is missing; set the project up first`);
  const stored = readJson(configPath);
  const config = { ...stored, ...(tag ? { tag } : {}) };
  validate(config);
  const body = render(readFileSync(TEMPLATE, 'utf8'), config);
  const changes = [];
  const refusals = [];
  const synced = { block: sha(body), files: {} };
  const older = olderSource(stored);
  if (older && !force) refusals.push({ path: 'shared source', reason: older });

  const agentsPath = join(root, 'AGENTS.md');
  const agents = existsSync(agentsPath) ? readFileSync(agentsPath, 'utf8') : '';
  const current = locateBlock(agents);
  if (current?.body !== body) {
    const detail = diff(current?.body ?? '', body);
    if (current && !force && sha(current.body) !== stored.synced?.block) {
      const last = lastVersion(stored, 'assets/block.md', (text) => render(text, stored), stored.synced?.block);
      refusals.push({
        path: 'AGENTS.md',
        reason: 'the block was edited since the last sync',
        diff: last === null ? `current block against the new render:\n${detail}` : `the project's edit since the last sync:\n${diff(last, current.body)}`,
      });
    } else {
      changes.push({ path: 'AGENTS.md', text: withBlock(agents, body), diff: detail });
    }
  }

  const skipped = new Set(config.skip ?? []);
  for (const [section, names] of Object.entries(SECTION_HELPERS)) {
    for (const name of names) {
      const path = `${HELPER_DIR}/${name}`;
      const present = existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : null;
      const edited = present !== null && sha(present) !== stored.synced?.files?.[path];
      if (!skipped.has(section)) {
        const source = readFileSync(join(HELPERS, name), 'utf8');
        synced.files[path] = sha(source);
        if (present === source) continue;
        if (edited && !force) {
          const last = lastVersion(stored, `assets/pstack/${name}`, (text) => text, stored.synced?.files?.[path]);
          refusals.push({
            path,
            reason: 'the helper was edited since the last sync',
            diff: last === null ? `current helper against the shared one:\n${diff(present, source)}` : `the project's edit since the last sync:\n${diff(last, present)}`,
          });
        }
        else changes.push({ path, text: source, executable: true });
      } else if (present !== null) {
        if (edited && !force) refusals.push({ path, reason: `the helper was edited, and its section "${section}" is now skipped` });
        else changes.push({ path, remove: true });
      }
    }
  }

  const settingsPath = join(root, '.claude/settings.json');
  const settingsSource = existsSync(settingsPath) ? readFileSync(settingsPath, 'utf8') : '';
  const settings = settingsSource ? JSON.parse(settingsSource) : {};
  if (!pinned(settings, config.tag)) changes.push({ path: '.claude/settings.json', text: settingsText(settingsSource, settings, config.tag) });

  // Keep the recorded source while the output is unchanged, so an unrelated
  // shared commit does not make every project's config stale.
  const same = stored.synced?.block === synced.block && JSON.stringify(stored.synced?.files ?? {}) === JSON.stringify(synced.files);
  synced.source = same && stored.synced?.source !== undefined ? stored.synced.source : sourceRevision();
  const next = { ...stored, tag: config.tag, synced };
  if (JSON.stringify(next) !== JSON.stringify(stored)) changes.push({ path: CONFIG, text: json(next) });

  if (write && refusals.length === 0) {
    for (const change of changes) {
      const path = join(root, change.path);
      if (change.remove) {
        rmSync(path);
        continue;
      }
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, change.text);
      if (change.executable) chmodSync(path, 0o755);
    }
  }
  return { root, changes, refusals };
}

function pluginSkills() {
  const installed = join(homedir(), '.claude/plugins/installed_plugins.json');
  if (!existsSync(installed)) return null;
  for (const entry of readJson(installed).plugins?.[PLUGIN] ?? []) {
    const dir = join(entry.installPath ?? '', 'skills');
    if (existsSync(dir)) return readdirSync(dir).filter((name) => existsSync(join(dir, name, 'SKILL.md')));
  }
  return null;
}

function localSkills(root) {
  const names = new Set();
  for (const dir of ['.agents/skills', '.claude/skills']) {
    const path = join(root, dir);
    if (!existsSync(path)) continue;
    for (const name of readdirSync(path)) if (existsSync(join(path, name, 'SKILL.md'))) names.add(name);
  }
  return [...names].sort();
}

function dotaiCatalog() {
  const manifest = join(SKILL, '../../workflow-manifest.json');
  return existsSync(manifest) ? readJson(manifest).skills.map((skill) => skill.name) : null;
}

function userPins() {
  const settingsPath = join(homedir(), '.claude/settings.json');
  const claude = existsSync(settingsPath) ? (readJson(settingsPath).extraKnownMarketplaces?.[MARKETPLACE]?.source?.ref ?? null) : null;
  const tomlPath = join(homedir(), '.codex/config.toml');
  let codex = null;
  if (existsSync(tomlPath)) {
    let inTable = false;
    for (const line of readFileSync(tomlPath, 'utf8').split('\n')) {
      if (line.startsWith('[')) inTable = /^\[marketplaces\.(?:"pstack-claude"|pstack-claude)\]/u.test(line);
      else if (inTable) codex = line.match(/^ref\s*=\s*"([^"]+)"/u)?.[1] ?? codex;
    }
  }
  return { claude, codex };
}

function* codexSessions(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* codexSessions(path);
    else if (entry.name.endsWith('.jsonl')) yield path;
  }
}

function sessionCwd(path) {
  const buffer = Buffer.alloc(8192);
  const fd = openSync(path, 'r');
  try {
    const read = readSync(fd, buffer, 0, buffer.length, 0);
    const match = buffer.subarray(0, read).toString('utf8').match(/"cwd":"((?:[^"\\]|\\.)*)"/u);
    return match ? JSON.parse(`"${match[1]}"`) : null;
  } finally {
    closeSync(fd);
  }
}

// Counts the commands and skills the user typed (`/name` or `$name`) in this
// project's Claude Code transcripts and Codex sessions, over all history and
// the last seven days. Injected skill bodies, summaries and tool output are
// not typed, so they do not count.
export function typedInvocations(root, names, now = Date.now()) {
  const wanted = new Set(names);
  const counts = Object.fromEntries(names.map((name) => [name, { all: 0, week: 0 }]));
  const files = { claude: 0, codex: 0 };
  const count = (text, time) => {
    for (const match of text.matchAll(/(?:^|[\s([>"'`])[/$]([a-z][\w:-]*)/gu)) {
      if (!wanted.has(match[1])) continue;
      counts[match[1]].all += 1;
      if (time >= now - 7 * DAY) counts[match[1]].week += 1;
    }
  };

  const claudeDir = join(homedir(), '.claude/projects', root.replace(/[^a-zA-Z0-9]/gu, '-'));
  if (existsSync(claudeDir)) {
    for (const name of readdirSync(claudeDir).filter((file) => file.endsWith('.jsonl'))) {
      files.claude += 1;
      for (const line of readFileSync(join(claudeDir, name), 'utf8').split('\n')) {
        if (!line.includes('"type":"user"') || line.includes('"tool_use_id"')) continue;
        const record = parseLine(line);
        if (!record || record.type !== 'user' || record.isMeta || record.isCompactSummary || record.isSidechain) continue;
        const content = record.message?.content;
        const text = typeof content === 'string' ? content : (content ?? []).filter((block) => block.type === 'text').map((block) => block.text).join('\n');
        count(text, Date.parse(record.timestamp));
      }
    }
  }

  // Codex records a typed message as a `user_message` event (older CLIs) or a
  // completed `UserMessage` item, sometimes twice within one turn.
  for (const path of codexSessions(join(homedir(), '.codex/sessions'))) {
    const cwd = sessionCwd(path);
    if (cwd !== root && !cwd?.startsWith(`${root}/`)) continue;
    files.codex += 1;
    const seen = new Set();
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (!line.includes('"user_message"') && !line.includes('"UserMessage"')) continue;
      const record = parseLine(line);
      const payload = record?.payload;
      const text =
        payload?.type === 'user_message'
          ? payload.message
          : payload?.item?.type === 'UserMessage'
            ? (payload.item.content ?? []).map((block) => block.text ?? '').join('\n')
            : null;
      if (!text || seen.has(`${payload.turn_id}\0${text}`)) continue;
      seen.add(`${payload.turn_id}\0${text}`);
      count(text, Date.parse(record.timestamp));
    }
  }
  return { files, counts };
}

export function discover(root) {
  const read = (path) => (existsSync(join(root, path)) ? readJson(join(root, path)) : {});
  const pkg = read('package.json');
  const lockfile = [
    ['bun.lock', 'bun'],
    ['bun.lockb', 'bun'],
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['package-lock.json', 'npm'],
  ].find(([file]) => existsSync(join(root, file)))?.[1];
  const manager = pkg.packageManager?.split('@')[0] ?? lockfile ?? null;
  const script = (...names) => {
    const name = names.find((candidate) => pkg.scripts?.[candidate]);
    if (!name) return null;
    return manager === 'npm' ? `npm run ${name}` : manager === 'bun' ? `bun run ${name}` : `${manager ?? 'npm run'} ${name}`;
  };
  const subjects = (git(root, 'log', '-50', '--format=%s') ?? '').split('\n').filter(Boolean);
  const conventional = subjects.filter((subject) => /^(?:feat|fix|docs|refactor|test|chore|perf|style|build|ci|revert)(?:\([^)]+\))?!?: /u.test(subject));
  const rulesDir = join(root, '.agents/rules');
  const rules = existsSync(rulesDir) ? readdirSync(rulesDir).filter((name) => name.endsWith('.mdc')).map((name) => name.slice(0, -4)) : [];
  const skills = localSkills(root);
  const lock = read('skills-lock.json').skills ?? {};
  const plugin = pluginSkills();
  const catalog = dotaiCatalog();
  const agents = existsSync(join(root, 'AGENTS.md')) ? readFileSync(join(root, 'AGENTS.md'), 'utf8') : '';
  const typed = typedInvocations(root, [...new Set([...skills, ...rules])].sort());
  return {
    root,
    branch: git(root, 'branch', '--show-current'),
    defaultBranch: git(root, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD')?.replace(/^origin\//u, '') ?? null,
    packageManager: manager,
    commands: {
      lintFix: script('lint:fix', 'fix', 'format'),
      check: script('check', 'verify'),
      typecheck: script('typecheck'),
      test: script('test'),
    },
    authors90d: new Set((git(root, 'log', '--since=90.days', '--format=%ae') ?? '').split('\n').filter(Boolean)).size,
    merges90d: (git(root, 'log', '--merges', '--since=90.days', '--format=%h') ?? '').split('\n').filter(Boolean).length,
    conventionalCommits: `${conventional.length}/${subjects.length}`,
    instructions: ['AGENTS.md', 'CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.override.md', '.claude/CLAUDE.md'].filter((path) => existsSync(join(root, path))),
    skiller: ['.agents/skiller.toml', '.skiller.toml', 'skiller.toml'].find((path) => existsSync(join(root, path))) ?? null,
    hooks: {
      claude: Object.keys(read('.claude/settings.json').hooks ?? {}),
      codex: Object.keys(read('.codex/hooks.json').hooks ?? {}),
    },
    rules,
    skills: skills.map((name) => ({ name, source: lock[name]?.source ?? (rules.includes(name) ? 'rule' : null) })),
    pstack: {
      config: existsSync(join(root, CONFIG)),
      block: locateBlock(agents) !== null,
      projectPin: read('.claude/settings.json').extraKnownMarketplaces?.[MARKETPLACE]?.source?.ref ?? null,
      userPins: userPins(),
      vendored: plugin ? skills.filter((name) => plugin.includes(name)) : 'unknown: the Claude Code plugin is not installed',
    },
    dotaiOrphans: catalog
      ? skills.filter((name) => /dotai/u.test(lock[name]?.source ?? '') && !catalog.includes(name) && !(plugin ?? []).includes(name))
      : 'unknown: run from the dotai checkout',
    glossary: ['CONTEXT.md', 'GLOSSARY.md', 'docs/glossary.md'].find((path) => existsSync(join(root, path))) ?? null,
    prTemplates: ['.github', 'docs', '.'].flatMap((dir) =>
      existsSync(join(root, dir))
        ? readdirSync(join(root, dir))
            .filter((name) => /^pull_request_template(?:\.md)?$/iu.test(name))
            .map((name) => join(dir, name))
        : [],
    ),
    proofSkills: skills.filter((name) => /^verify/u.test(name)),
    autoreview: existsSync(join(root, '.agents/skills/autoreview')) ? (lock.autoreview?.source ?? 'unlocked copy') : null,
    plans: ['docs/plans', 'plans', '.plans']
      .filter((dir) => existsSync(join(root, dir)))
      .map((dir) => ({ dir, files: readdirSync(join(root, dir)).length })),
    typed: {
      files: typed.files,
      counts: Object.fromEntries(Object.entries(typed.counts).filter(([, count]) => count.all > 0)),
      never: Object.entries(typed.counts).filter(([, count]) => count.all === 0).map(([name]) => name),
    },
  };
}

function usesPstack(root) {
  if (existsSync(join(root, CONFIG)) || existsSync(join(root, '.agents/skills/poteto-mode/SKILL.md'))) return true;
  const settings = join(root, '.claude/settings.json');
  return existsSync(settings) && readFileSync(settings, 'utf8').includes(PLUGIN);
}

function candidates(roots) {
  const configured = [];
  const configPath = join(homedir(), '.agents/config.json');
  if (existsSync(configPath)) {
    for (const set of Object.values(readJson(configPath).syncedRepositories?.sets ?? {})) configured.push(...(set.repos ?? []));
  }
  const found = new Set(configured.filter((repo) => existsSync(repo)));
  for (const dir of new Set([...roots, ...configured.map((repo) => dirname(repo))])) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory() && existsSync(join(path, '.git')) && usesPstack(path)) found.add(path);
    }
  }
  return [...found].sort();
}

function projectState(root, plugin) {
  const state = { path: root, managed: existsSync(join(root, CONFIG)) };
  try {
    const settingsPath = join(root, '.claude/settings.json');
    state.pin = existsSync(settingsPath) ? (readJson(settingsPath).extraKnownMarketplaces?.[MARKETPLACE]?.source?.ref ?? null) : null;
    state.vendored = plugin ? localSkills(root).filter((name) => plugin.includes(name)).length : null;
    if (state.managed) {
      const config = readJson(join(root, CONFIG));
      Object.assign(state, { tag: config.tag, delivery: config.delivery, skip: config.skip ?? [], source: config.synced?.source?.slice(0, 7) ?? null });
      const { changes, refusals } = apply(root, { write: false });
      state.drift = [...refusals.map((refusal) => `${refusal.path} edited`), ...changes.map((change) => `${change.path} stale`)];
    }
  } catch (error) {
    state.error = error.message;
  }
  return state;
}

// A sync writes into a live checkout, so it must be on the project's branch and
// must not mix its change with uncommitted edits to the files it writes.
function preflight(root, { allowDirty }) {
  const config = readJson(join(root, CONFIG));
  const refusals = [];
  const branch = git(root, 'branch', '--show-current');
  if (config.delivery !== 'pr' && branch !== config.branch) {
    refusals.push({ path: 'git', reason: `the checkout is on ${branch || 'a detached HEAD'}, not ${config.branch}` });
  }
  const dirty = allowDirty ? '' : gitRaw(root, 'status', '--porcelain', '--', 'AGENTS.md', CONFIG, HELPER_DIR, '.claude/settings.json');
  if (dirty?.trim()) {
    refusals.push({ path: 'git', reason: `uncommitted edits to files the sync writes; commit them or pass --allow-dirty:\n${dirty.trimEnd().replace(/^/gmu, '    ')}` });
  }
  return refusals;
}

export function latestTag() {
  const result = spawnSync('git', ['ls-remote', '--tags', '--refs', `https://github.com/${REPO}.git`], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ls-remote failed: ${result.stderr.trim()}`);
  const version = (tag) => tag.slice(1).split('.').map(Number);
  const tags = [...result.stdout.matchAll(/refs\/tags\/(v\d+\.\d+\.\d+)$/gmu)].map((match) => match[1]);
  return tags.sort((a, b) => version(a).reduce((order, part, index) => order || part - version(b)[index], 0)).at(-1) ?? null;
}

function userPin(tag, { write }) {
  const lines = [];
  const path = join(homedir(), '.claude/settings.json');
  const settings = existsSync(path) ? readJson(path) : null;
  if (!settings?.extraKnownMarketplaces?.[MARKETPLACE]) lines.push(`${path} has no user-scope pstack marketplace; nothing to pin.`);
  else if (pinned(settings, tag)) lines.push(`${path} already pins ${tag}.`);
  else {
    if (write) writeFileSync(path, json(pin(settings, tag)));
    lines.push(`${write ? 'Pinned' : 'Would pin'} ${path} to ${tag}.`);
  }
  lines.push(
    'Then, from the home directory:',
    `  claude plugin marketplace update ${MARKETPLACE} && claude plugin update ${PLUGIN}`,
    `  codex plugin marketplace remove ${MARKETPLACE} && codex plugin marketplace add ${REPO} --ref ${tag} && codex plugin add ${PLUGIN}`,
    'Codex asks to trust the pstack session hook again in /hooks when its file changed.',
  );
  return lines;
}

function source() {
  const revision = git(SKILL, 'rev-parse', '--short', 'HEAD');
  const dirty = revision && git(SKILL, 'status', '--porcelain', '--', '.');
  return `rendering from ${SKILL}${revision ? ` (git ${revision}${dirty ? ', uncommitted changes' : ''})` : ' (not a git checkout)'}`;
}

function report({ root, changes, refusals }, mode) {
  const lines = [root];
  for (const refusal of refusals) {
    lines.push(`  refused ${refusal.path}: ${refusal.reason}`);
    if (refusal.diff) lines.push(refusal.diff.replace(/^/gmu, '    '));
  }
  for (const change of changes) {
    lines.push(`  ${mode === 'check' ? 'stale' : change.remove ? 'remove' : 'write'} ${change.path}`);
    if (mode === 'dry-run' && change.diff) lines.push(change.diff.replace(/^/gmu, '    '));
  }
  if (changes.length === 0 && refusals.length === 0) lines.push('  in sync');
  else if (refusals.length > 0) lines.push('  nothing written; resolve each refusal, or rerun with --force to discard the project edit');
  else if (mode === 'dry-run') lines.push('  dry run; nothing written');
  return lines.join('\n');
}

const HELP = `Usage: node sync-pstack.mjs <command> [options]

  discover <project>               Facts for the setup interview, as JSON. Read-only.
  status [project...]              State of pstack projects; finds local ones when none are named. Read-only.
  apply <project>                  Render the block, helpers and plugin pin from <project>/${CONFIG}.
  check <project>                  Exit 1 when apply would change anything. Read-only.
  sync --tag <tag> [project...]    apply --tag to every managed project, or to the named ones. Refuses a checkout
                                   off its branch or with uncommitted edits to the files it writes.
  user-pin --tag <tag>             Pin the user-scope Claude Code marketplace; print the refresh commands.
  latest                           Newest upstream ${REPO} tag.

  --tag <tag>     apply and sync: pin this tag
  --dry-run       apply, sync and user-pin: show the changes, write nothing
  --force         apply and sync: overwrite a block or helper edited since the last sync, or render
                  from a source older than the project's last sync
  --allow-dirty   sync: write files that have uncommitted edits
  --root <dir>    status and sync: also scan the repositories directly under <dir>
  --json          status: print JSON
  --offline       status: skip the upstream tag lookup`;

function main(argv) {
  const [command, ...rest] = argv;
  const flags = { roots: [] };
  const projects = [];
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--tag') flags.tag = rest[++index];
    else if (arg === '--root') flags.roots.push(resolve(rest[++index]));
    else if (SWITCHES[arg]) flags[SWITCHES[arg]] = true;
    else if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}`);
    else projects.push(resolve(arg));
  }
  const needTag = () => {
    if (!flags.tag) throw new Error(`${command} needs --tag <tag>`);
    return flags.tag;
  };
  const one = () => {
    if (projects.length !== 1) throw new Error(`${command} takes one project path`);
    return projects[0];
  };

  switch (command) {
    case 'discover':
      console.info(json(discover(one())).trimEnd());
      return 0;
    case 'status': {
      const plugin = pluginSkills();
      const list = (projects.length > 0 ? projects : candidates(flags.roots)).map((root) => projectState(root, plugin));
      let latest = null;
      if (!flags.offline) {
        try {
          latest = latestTag();
        } catch (error) {
          latest = `unknown (${error.message})`;
        }
      }
      const result = { latest, userPins: userPins(), projects: list };
      if (flags.json) {
        console.info(json(result).trimEnd());
        return 0;
      }
      console.info(`latest ${REPO} tag: ${latest ?? 'not checked'}`);
      console.info(`user pins: Claude Code ${result.userPins.claude ?? 'none'}, Codex ${result.userPins.codex ?? 'none'}`);
      for (const state of list) {
        const facts = state.managed
          ? `managed tag=${state.tag} delivery=${state.delivery} skip=[${state.skip.join(',')}] source=${state.source ?? 'unknown'} drift=${state.drift?.length ? state.drift.join('; ') : 'none'}`
          : 'unmanaged';
        console.info(`${state.path}\n  ${facts} pin=${state.pin ?? 'none'} vendored=${state.vendored ?? 'unknown'}${state.error ? ` error=${state.error}` : ''}`);
      }
      return 0;
    }
    case 'apply': {
      console.error(source());
      const result = apply(one(), { tag: flags.tag, force: flags.force, write: !flags.dryRun });
      console.info(report(result, flags.dryRun ? 'dry-run' : 'write'));
      return result.refusals.length > 0 ? 1 : 0;
    }
    case 'check': {
      const result = apply(one(), { write: false });
      console.info(report(result, 'check'));
      return result.changes.length > 0 || result.refusals.length > 0 ? 1 : 0;
    }
    case 'sync': {
      console.error(source());
      const tag = needTag();
      const found = projects.length > 0 ? projects : candidates(flags.roots);
      let failed = 0;
      for (const root of found) {
        if (!existsSync(join(root, CONFIG))) {
          console.info(`${root}\n  unmanaged; set it up with the Setup mode first`);
          continue;
        }
        try {
          const blocked = preflight(root, flags);
          const result = apply(root, { tag, force: flags.force, write: !flags.dryRun && blocked.length === 0 });
          result.refusals.unshift(...blocked);
          failed += result.refusals.length > 0 ? 1 : 0;
          console.info(report(result, flags.dryRun ? 'dry-run' : 'write'));
        } catch (error) {
          failed += 1;
          console.info(`${root}\n  error: ${error.message}`);
        }
      }
      const pins = userPins();
      if (pins.claude !== tag || pins.codex !== tag) {
        console.info(`user pins still at Claude Code ${pins.claude ?? 'none'}, Codex ${pins.codex ?? 'none'}; run user-pin --tag ${tag}`);
      }
      return failed > 0 ? 1 : 0;
    }
    case 'user-pin':
      console.info(userPin(needTag(), { write: !flags.dryRun }).join('\n'));
      return 0;
    case 'latest':
      console.info(latestTag() ?? 'no tags found');
      return 0;
    case undefined:
    case 'help':
    case '--help':
      console.info(HELP);
      return 0;
    default:
      throw new Error(`Unknown command ${command}\n\n${HELP}`);
  }
}

// Node runs a symlinked install from its real path, so compare real paths.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
