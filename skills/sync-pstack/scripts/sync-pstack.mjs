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
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ask } from '../assets/pstack/cross.mjs';

const SKILL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = join(SKILL, 'assets/block.md');
const HELPERS = join(SKILL, 'assets/pstack');
const CONFIG = '.agents/pstack.json';
const HELPER_DIR = '.agents/pstack';
const CORE_HELPERS = ['cross.mjs'];
const SECTION_HELPERS = { plans: ['decisions-check.mjs', 'plan-open.mjs', 'plan-page.mjs', 'status.mjs'] };
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
const PLAYBOOKS = '.agents/playbooks';
const UPSTREAM_SKILLS = 'plugins/pstack/skills';
const CHANGE = /^\s*[-*]\s+\*\*(?:After|Before|Replace|In)\*\*\s+"([^"]+)"/u;
const CHANGE_VERB = /^\s*[-*]\s+\*\*(?:After|Before|Replace|In)\*\*/u;
const OVERRIDES = /^<!-- # overrides (\S+) "([^"]+)" -->$/u;

const sha = (text) => createHash('sha256').update(text).digest('hex');
const flat = (text) => text.replace(/\s+/gu, ' ');
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

export function projectPlaybooks(root) {
  const dir = join(root, PLAYBOOKS);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => {
      const text = readFileSync(join(dir, name), 'utf8');
      const front = text.match(/^---\n([\s\S]*?)\n---\n/u)?.[1] ?? '';
      const field = (key) => front.match(new RegExp(`^${key}:[ \\t]*(.*)$`, 'mu'))?.[1].trim() ?? '';
      const list = (key) => field(key).split(',').map((entry) => entry.trim()).filter(Boolean);
      return {
        path: `${PLAYBOOKS}/${name}`,
        extends: list('extends'),
        when: field('when'),
        page: { lead: list('page-lead'), pairs: list('page-pairs'), require: list('page-require') },
        anchors: text.split('\n').flatMap((line) => line.match(CHANGE)?.[1] ?? []),
        unanchored: text.split('\n').filter((line) => CHANGE_VERB.test(line) && !CHANGE.test(line)).map((line) => line.trim()),
      };
    });
}

function playbookLines(root) {
  return projectPlaybooks(root)
    .map((playbook) => {
      if (!playbook.when) throw new Error(`${playbook.path} needs a "when:" line in its frontmatter`);
      const stems = playbook.extends.map((stem) => `\`${stem}\``).join(' and ');
      const base = stems ? `on top of pstack's ${stems}` : 'standing alone';
      return `  - \`${playbook.path}\`, ${base}. ${playbook.when}`;
    })
    .join('\n');
}

const withPlaybooks = (root, config) => ({ ...config, projectPlaybooks: playbookLines(root) });

const upstreamUrl = () => process.env.SYNC_PSTACK_UPSTREAM ?? `https://github.com/${REPO}.git`;

function upstream() {
  const url = upstreamUrl();
  const cache = join(homedir(), '.cache/sync-pstack', `${sha(url).slice(0, 12)}.git`);
  const has = (tag) => git(cache, 'rev-parse', '-q', '--verify', `refs/tags/${tag}`) !== null;
  const ensure = () => {
    if (existsSync(cache)) return;
    mkdirSync(dirname(cache), { recursive: true });
    const cloned = spawnSync('git', ['clone', '-q', '--bare', '--filter=blob:none', url, cache], { encoding: 'utf8' });
    if (cloned.status !== 0) throw new Error(`cannot clone ${url}: ${cloned.stderr.trim()}`);
  };
  return {
    file(tag, path) {
      ensure();
      if (!has(tag)) spawnSync('git', ['-C', cache, 'fetch', '-q', '--tags', '--force', url]);
      if (!has(tag)) throw new Error(`${url} has no tag ${tag}`);
      return gitRaw(cache, 'show', `${tag}:${UPSTREAM_SKILLS}/${path}`);
    },
    diff: (from, to, path) => gitRaw(cache, 'diff', '--no-color', from, to, '--', `${UPSTREAM_SKILLS}/${path}`)?.trimEnd() || null,
    version() {
      ensure();
      const fetched = spawnSync('git', ['-C', cache, 'fetch', '-q', url, 'HEAD'], { encoding: 'utf8' });
      if (fetched.status !== 0) throw new Error(`cannot fetch ${url}: ${fetched.stderr.trim()}`);
      return git(cache, 'show', 'FETCH_HEAD:VERSION');
    },
  };
}

const anchoredPaths = (root) => [
  ...new Set([
    ...overrideAnchors(readFileSync(TEMPLATE, 'utf8')).map((note) => note.path),
    ...projectPlaybooks(root).flatMap((playbook) => playbook.extends.map((stem) => `poteto-mode/playbooks/${stem}.md`)),
  ]),
];

function bumpDiff(root, from, to) {
  const source = upstream();
  return anchoredPaths(root).map((path) => source.diff(from, to, path)).filter(Boolean).join('\n') || null;
}

export const overrideAnchors = (template) =>
  template.split('\n').flatMap((line) => {
    const match = line.trim().match(OVERRIDES);
    return match ? [{ path: match[1], anchor: match[2] }] : [];
  });

export function anchorProblems(root, tag) {
  const source = upstream();
  const texts = new Map();
  const read = (path) => {
    if (!texts.has(path)) texts.set(path, source.file(tag, path));
    return texts.get(path);
  };
  const problems = [];
  try {
    for (const { path, anchor } of overrideAnchors(readFileSync(TEMPLATE, 'utf8'))) {
      const text = read(path);
      if (text === null) problems.push({ reason: `the block overrides ${path}, which pstack ${tag} no longer has` });
      else if (!flat(text).includes(flat(anchor))) {
        problems.push({ reason: `the block overrides "${anchor}" in ${path}, which pstack ${tag} no longer says; rewrite or drop that override` });
      }
    }
    for (const playbook of projectPlaybooks(root)) {
      for (const line of playbook.unanchored) {
        problems.push({ reason: `${playbook.path} has a change with no straight-quoted pstack text to anchor on: ${line.slice(0, 80)}` });
      }
      const bases = playbook.extends.map((stem) => {
        const path = `poteto-mode/playbooks/${stem}.md`;
        return { path, stem, text: read(path) };
      });
      for (const base of bases) {
        if (base.text === null) problems.push({ reason: `${playbook.path} extends \`${base.stem}\`, which pstack ${tag} does not have` });
      }
      for (const anchor of playbook.anchors) {
        if (bases.some((base) => base.text && flat(base.text).includes(flat(anchor)))) continue;
        problems.push({ reason: `${playbook.path} anchors a change on "${anchor}", which no playbook it extends says at pstack ${tag}` });
      }
    }
  } catch (error) {
    problems.push({ reason: `cannot read pstack ${tag}: ${error.message}` });
  }
  return problems;
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
  const config = withPlaybooks(root, { ...stored, ...(tag ? { tag } : {}) });
  validate(config);
  const body = render(readFileSync(TEMPLATE, 'utf8'), config);
  const changes = [];
  const refusals = [];
  const synced = { block: sha(body), files: {} };
  const older = olderSource(stored);
  if (older && !force) refusals.push({ path: 'shared source', reason: older });
  let pstackDiff = null;
  if (tag && tag !== stored.tag) {
    for (const problem of anchorProblems(root, tag)) refusals.push({ path: 'pstack anchors', forceable: false, ...problem });
    pstackDiff = bumpDiff(root, stored.tag, tag);
  }

  const agentsPath = join(root, 'AGENTS.md');
  const agents = existsSync(agentsPath) ? readFileSync(agentsPath, 'utf8') : '';
  const current = locateBlock(agents);
  if (current?.body !== body) {
    const detail = diff(current?.body ?? '', body);
    if (current && !force && sha(current.body) !== stored.synced?.block) {
      const last = lastVersion(stored, 'assets/block.md', (text) => render(text, withPlaybooks(root, stored)), stored.synced?.block);
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
  for (const [section, names] of [[null, CORE_HELPERS], ...Object.entries(SECTION_HELPERS)]) {
    for (const name of names) {
      const path = `${HELPER_DIR}/${name}`;
      const present = existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : null;
      const edited = present !== null && sha(present) !== stored.synced?.files?.[path];
      if (!section || !skipped.has(section)) {
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
  // shared commit does not make every project's config stale. A null record
  // came from uncommitted shared edits and is replaced once they land.
  const same = stored.synced?.block === synced.block && JSON.stringify(stored.synced?.files ?? {}) === JSON.stringify(synced.files);
  // A null source means the last sync came from uncommitted shared edits, which a clean source would silently drop.
  if (!same && !force && stored.synced && 'source' in stored.synced && stored.synced.source === null && sourceRevision() !== null) {
    refusals.push({ path: 'shared source', reason: 'the project was last synced from uncommitted shared edits; commit them in the dotai checkout, then rerun' });
  }
  synced.source = same && stored.synced?.source ? stored.synced.source : sourceRevision();
  // The renderer refuses a config that still sets these lists, so they leave it in the write that installs the renderer, once the playbooks carry them.
  const pages = projectPlaybooks(root).map((playbook) => playbook.page);
  const declared = (key) => new Set(pages.flatMap((page) => page[key]).map((title) => title.toLowerCase()));
  const uncovered = [
    ['pageLead', stored.pageLead, 'lead'],
    ['pagePairs', stored.pagePairs, 'pairs'],
    ['pageTopic.require', stored.pageTopic?.require, 'require'],
  ].flatMap(([key, titles = [], page]) => titles.filter((title) => !declared(page).has(title.toLowerCase())).map((title) => `${key} "${title}"`));
  if (uncovered.length > 0 && !skipped.has('plans')) {
    refusals.push({
      path: CONFIG,
      forceable: false,
      reason: `the plan page renderer no longer reads ${uncovered.join(', ')}; add each to the page-lead, page-pairs or page-require frontmatter of the playbook whose plans write it, then rerun`,
    });
  }
  const kept = Object.fromEntries(Object.entries(stored).filter(([key]) => key !== 'pageLead' && key !== 'pagePairs'));
  if (kept.pageTopic) kept.pageTopic = Object.fromEntries(Object.entries(kept.pageTopic).filter(([key]) => key !== 'require'));
  const next = { ...kept, tag: config.tag, synced };
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
  return { root, changes, refusals, pstackDiff };
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

const distinctiveName = (name) => /[-\d]/u.test(name);

export function skillMention(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const end = '(?![\\w:-]|[./]\\w)';
  const invocation = `(?<![\\w./:@-])[$/]${escaped}${end}`;
  const path = `(?:skills|rules|\\.\\.)/${escaped}(?:/|\\.mdc(?![\\w.]))`;
  const bareName = `(?<![\\w./:@$-])${escaped}${end}`;
  return new RegExp([invocation, path, ...(distinctiveName(name) ? [bareName] : [])].join('|'), 'u');
}

export const USER_SKILL_DIRS = ['.agents/skills', '.claude/skills', '.codex/skills'];

export function localSkills(root, dirs = ['.agents/skills', '.claude/skills']) {
  const names = new Set();
  for (const dir of dirs) {
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

// Yields a file's lines through a fixed buffer, because Codex sessions can
// exceed the largest string V8 can hold.
function* fileLines(path) {
  const fd = openSync(path, 'r');
  const buffer = Buffer.alloc(1 << 20);
  let rest = '';
  try {
    for (let read; (read = readSync(fd, buffer, 0, buffer.length, null)) > 0; ) {
      const lines = (rest + buffer.subarray(0, read).toString('utf8')).split('\n');
      rest = lines.pop();
      yield* lines;
    }
    if (rest) yield rest;
  } finally {
    closeSync(fd);
  }
}

function sessionMeta(path) {
  for (const line of fileLines(path)) {
    const payload = parseLine(line)?.payload ?? {};
    return {
      cwd: payload.cwd ?? null,
      subagent: payload.thread_source === 'subagent' || JSON.stringify(payload.source ?? '').includes('subagent'),
      headless: payload.source === 'exec' || payload.originator === 'codex_exec' || payload.thread_source === 'automation',
    };
  }
  return { cwd: null, subagent: false, headless: false };
}

const COMMAND_WINDOW = 200;
const SHORT_REQUEST = 2000;
const typedNotPasted = (index, request) => index < COMMAND_WINDOW || request.length <= SHORT_REQUEST;
const TYPED = /(?:^|[\s([>"'`])[/$](?<name>[a-z][\w:-]*)(?<link>\]\((?:<(?<angled>[^>]*)>|(?<path>[^)\s]*))[^)]*\))?(?:[ \t]+(?<mode>[a-z][\w-]*))?/gu;
const REQUEST = /^## My request(?: for [^:\n]+)?:/gmu;
const PASTED = /<pasted_content\b[^>]*>[\s\S]*?<\/pasted_content\b[^>]*>/gu;
const writtenByAgent = (record) =>
  record.entrypoint === 'sdk-cli' || record.promptSource === 'system' || (record.origin?.kind !== undefined && record.origin.kind !== 'human');
const EVERY_PROJECT = Symbol('every project');

function* typedMessages(root, files = { claude: 0, codex: 0 }) {
  const projects = join(homedir(), '.claude/projects');
  const claudeDirs =
    root !== EVERY_PROJECT
      ? [join(projects, root.replace(/[^a-zA-Z0-9]/gu, '-'))]
      : existsSync(projects)
      ? readdirSync(projects).map((name) => join(projects, name))
      : [];
  for (const claudeDir of claudeDirs.filter((path) => existsSync(path) && statSync(path).isDirectory())) {
    for (const name of readdirSync(claudeDir).filter((file) => file.endsWith('.jsonl'))) {
      files.claude += 1;
      for (const line of fileLines(join(claudeDir, name))) {
        if (!line.includes('"type":"user"') || line.includes('"tool_use_id"')) continue;
        const record = parseLine(line);
        if (!record || record.type !== 'user' || record.isMeta || record.isCompactSummary || record.isSidechain || writtenByAgent(record)) continue;
        const content = record.message?.content;
        const text = typeof content === 'string' ? content : (content ?? []).filter((block) => block.type === 'text').map((block) => block.text).join('\n');
        yield { text, time: Date.parse(record.timestamp) };
      }
    }
  }

  // Codex records a typed message as a `user_message` event (older CLIs) or a
  // completed `UserMessage` item, sometimes twice within one turn, and a forked
  // session replays its parent's turns, so a turn yields once.
  const seen = new Set();
  for (const dir of ['.codex/sessions', '.codex/archived_sessions']) {
    for (const path of codexSessions(join(homedir(), dir))) {
      const { cwd, subagent, headless } = sessionMeta(path);
      if (subagent || headless || (root !== EVERY_PROJECT && cwd !== root && !cwd?.startsWith(`${root}/`))) continue;
      files.codex += 1;
      for (const line of fileLines(path)) {
        if (!line.includes('"user_message"') && !line.includes('"UserMessage"')) continue;
        const record = parseLine(line);
        const payload = record?.payload;
        const text =
          payload?.type === 'user_message'
            ? payload.message
            : payload?.item?.type === 'UserMessage'
              ? (payload.item.content ?? []).map((block) => block.text ?? '').join('\n')
              : null;
        const key = `${payload?.turn_id ?? record?.timestamp}\0${text}`;
        if (!text || seen.has(key)) continue;
        seen.add(key);
        yield { text, time: Date.parse(record.timestamp) };
      }
    }
  }
}

function* typedNames(text) {
  const typed = text.replace(PASTED, ' ');
  const header = [...typed.matchAll(REQUEST)].at(-1);
  const request = (header ? typed.slice(header.index + header[0].length) : typed).trimStart();
  for (const { groups, index } of request.matchAll(TYPED)) {
    if (!typedNotPasted(index, request)) continue;
    const path = groups.link ? (groups.angled ?? groups.path) : null;
    yield { name: groups.name, path };
    if (groups.mode) yield { name: `${groups.name} ${groups.mode}`, path };
  }
}

const tally = (messages, counts, now, accept = () => true) => {
  for (const { text, time } of messages) {
    for (const hit of typedNames(text)) {
      if (!Object.hasOwn(counts, hit.name) || !accept(hit)) continue;
      counts[hit.name].all += 1;
      if (time >= now - 7 * DAY) counts[hit.name].week += 1;
    }
  }
  return counts;
};

const zero = (names) => Object.fromEntries(names.map((name) => [name, { all: 0, week: 0 }]));

export function typedInvocations(root, names, now = Date.now()) {
  const files = { claude: 0, codex: 0 };
  const counts = tally(typedMessages(root, files), zero(names), now);
  return { files, counts };
}

export function userTypedInvocations(names, now = Date.now()) {
  const home = homedir();
  const roots = USER_SKILL_DIRS.map((dir) => `${join(home, dir)}/`);
  const userScope = (path) => {
    if (path === null) return true;
    const expanded = path.startsWith('~/') ? join(home, path.slice(2)) : path;
    return isAbsolute(expanded) && roots.some((root) => resolve(expanded).startsWith(root));
  };
  return tally(typedMessages(EVERY_PROJECT), zero(names), now, (hit) => userScope(hit.path));
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
  const modes = rules.flatMap((name) => hintModes(readFileSync(join(rulesDir, `${name}.mdc`), 'utf8')).map((mode) => `${name} ${mode}`));
  const typed = typedInvocations(root, [...new Set([...skills, ...rules, ...modes])].sort());
  const added = [
    git(root, 'log', '--since=14.days', '--diff-filter=A', '--name-only', '--format=', '--', '.agents/rules', '.agents/skills'),
    git(root, 'ls-files', '--others', '--exclude-standard', '--', '.agents/rules', '.agents/skills'),
  ].join('\n');
  const recent = new Set();
  for (const path of added.split('\n')) {
    const match = path.match(/^\.agents\/(?:rules\/([^/]+?)(?:\.mdc$|\/)|skills\/([^/]+)\/)/u);
    if (match) recent.add(match[1] ?? match[2]);
  }
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
    plans: ['docs/plans', 'plans', '.plans']
      .filter((dir) => existsSync(join(root, dir)))
      .map((dir) => ({ dir, files: readdirSync(join(root, dir)).length })),
    recent: [...recent].sort(),
    typed: {
      files: typed.files,
      counts: Object.fromEntries(Object.entries(typed.counts).filter(([, count]) => count.all > 0)),
      never: Object.entries(typed.counts).filter(([, count]) => count.all === 0).map(([name]) => name),
    },
  };
}

const resolvesGlobally = (name, plugin) =>
  ['.agents/skills', '.claude/skills'].some((dir) => existsSync(join(homedir(), dir, name, 'SKILL.md'))) || (plugin ?? []).includes(name);

function skillNames(paths) {
  const names = new Set();
  for (const path of paths) {
    const match = path.match(/^\.agents\/rules\/([^/]+)\.mdc$|^\.(?:agents|claude)\/skills\/([^/]+)\/SKILL\.md$/u);
    if (match) names.add(match[1] ?? match[2]);
  }
  return names;
}

export function hintModes(rule) {
  const hint = rule?.match(/^argument-hint:\s*(.*)$/mu)?.[1].trim().replace(/^(['"])(.*)\1$/u, '$2') ?? '';
  return hint
    .replace(/<[^>]*>/gu, '')
    .replace(/[[\]]/gu, ' ')
    .split('|')
    .map((part) => part.trim().split(/\s+/u)[0])
    .filter((word) => /^[a-z][\w-]*$/u.test(word ?? ''));
}

function playbookSteps(text) {
  const steps = [];
  for (const line of text.split('\n')) {
    const item = line.match(/^\d+\.\s+(.*)$/u);
    if (item) steps.push({ lines: [item[1]], before: [], after: [], in: [], replace: null });
    else if (steps.length > 0 && /^\s+\S/u.test(line)) steps.at(-1).lines.push(line.trim());
    else if (steps.length > 0 && line.trim()) break;
  }
  return steps;
}

export function renderPlaybook(root, name) {
  const playbook = projectPlaybooks(root).find((entry) => entry.path === `${PLAYBOOKS}/${name.replace(/\.md$/u, '')}.md`);
  if (!playbook) throw new Error(`${PLAYBOOKS}/${name}.md does not exist`);
  const { tag } = readJson(join(root, CONFIG));
  const changes = [];
  const loose = [];
  for (const line of readFileSync(join(root, playbook.path), 'utf8').replace(/^---\n[\s\S]*?\n---\n/u, '').split('\n')) {
    const change = line.match(/^\s*[-*]\s+\*\*(After|Before|Replace|In)\*\*\s+"([^"]+)":?\s*(.*)$/u);
    if (change) changes.push({ verb: change[1], anchor: change[2], body: change[3] });
    else if (/^[-*]\s+\S/u.test(line)) loose.push(line.replace(/^[-*]\s+/u, ''));
    else if (/^\s+\S/u.test(line) && changes.length > 0) changes.at(-1).body += ` ${line.trim()}`;
  }
  const source = upstream();
  const out = [];
  for (const stem of playbook.extends) {
    out.push(`## ${playbook.path} on pstack \`${stem}\` at ${tag}`);
    const text = source.file(tag, `poteto-mode/playbooks/${stem}.md`);
    if (text === null) {
      out.push(`pstack ${tag} has no \`${stem}\` playbook`, '');
      continue;
    }
    const steps = playbookSteps(text);
    const unplaced = [];
    const clashes = [];
    for (const change of changes) {
      const step = steps.find((entry) => flat(entry.lines.join(' ')).includes(flat(change.anchor)));
      if (!step) unplaced.push(change.anchor);
      else if (change.verb !== 'Replace') step[change.verb.toLowerCase()].push(change.body);
      else if (step.replace) clashes.push(`two changes replace step ${steps.indexOf(step) + 1}; only the first shows`);
      else step.replace = change.body;
    }
    for (const [index, step] of steps.entries()) {
      out.push(...step.before.map((body) => `+ ${body}`));
      if (step.replace) out.push(`${index + 1}. ${step.replace} [replaces: ${step.lines[0].slice(0, 70)}]`);
      else out.push(`${index + 1}. ${step.lines[0]}`, ...step.lines.slice(1).map((line) => `   ${line}`));
      out.push(...step.in.map((body) => `   + ${body}`), ...step.after.map((body) => `+ ${body}`));
    }
    out.push(...clashes);
    if (unplaced.length > 0) out.push(`Not in this base: ${unplaced.map((anchor) => `"${anchor}"`).join(', ')}`);
    out.push('');
  }
  if (loose.length > 0) out.push('Also from the project playbook:', ...loose.map((line) => `- ${line}`));
  return out.join('\n').trimEnd();
}

export function smoke(root, prompts, { timeout = 900 } = {}) {
  return Promise.all(
    prompts.flatMap((prompt) => ['claude', 'codex'].map((runtime) => ask(runtime, prompt, { cwd: root, timeout, hooks: true }).then((answer) => ({ ...answer, prompt })))),
  );
}

export function* markdownFiles(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* markdownFiles(path);
    else if (/\.(?:md|mdc)$/u.test(entry.name)) yield path;
  }
}

const RULE = /^- \*\*([^*]+?)\.\*\*/u;
const MARKER = /^<!-- # (?:overrides |adds -->)/u;

const markedAbove = (lines, index) => {
  for (let above = index - 1; above >= 0 && lines[above].startsWith('<!--'); above -= 1) if (MARKER.test(lines[above])) return true;
  return false;
};

export function unmarkedRules(template) {
  const lines = template.split('\n');
  const marked = new Map();
  for (const [index, line] of lines.entries()) {
    const name = line.match(RULE)?.[1];
    if (name) marked.set(name, marked.get(name) || markedAbove(lines, index));
  }
  return [...marked].filter(([, any]) => !any).map(([name]) => name);
}

export function verify(root) {
  const problems = [];
  const rel = (path) => path.slice(root.length + 1);
  const config = existsSync(join(root, CONFIG)) ? readJson(join(root, CONFIG)) : {};
  const dropped = new Set(config.dropped ?? []);
  if (existsSync(join(root, CONFIG))) {
    const result = apply(root, { write: false });
    if (result.changes.length > 0 || result.refusals.length > 0) problems.push('pstack block or helpers differ from the shared source; run `apply`');
    problems.push(...anchorProblems(root, config.tag).map((problem) => problem.reason));
    for (const name of unmarkedRules(readFileSync(TEMPLATE, 'utf8'))) problems.push(`block rule "${name}" has no overrides note or adds marker`);
  }

  const plugin = pluginSkills();
  const lock = existsSync(join(root, 'skills-lock.json')) ? (readJson(join(root, 'skills-lock.json')).skills ?? {}) : {};
  const rulesDir = join(root, '.agents/rules');
  const rules = existsSync(rulesDir) ? readdirSync(rulesDir).filter((name) => name.endsWith('.mdc')).map((name) => name.slice(0, -4)) : [];
  const current = new Set([...localSkills(root), ...rules]);
  const before = skillNames((git(root, 'ls-tree', '-r', '--name-only', 'HEAD', '--', '.agents/rules', '.agents/skills', '.claude/skills') ?? '').split('\n'));
  const retired = [...before].filter((name) => !current.has(name) && !dropped.has(name) && !resolvesGlobally(name, plugin)).sort();
  if (retired.length > 0) {
    const typed = typedInvocations(root, retired).counts;
    for (const name of retired) {
      if (typed[name].all > 0) problems.push(`typed command \`${name}\` (typed ${typed[name].all} times) no longer resolves; keep a thin entry point, or list it under "dropped" in ${CONFIG} once the owner says to drop it`);
    }
    const mentions = retired.map((name) => [name, skillMention(name)]);
    for (const path of [join(root, 'AGENTS.md'), ...markdownFiles(rulesDir)]) {
      if (!existsSync(path)) continue;
      for (const [index, line] of readFileSync(path, 'utf8').split('\n').entries()) {
        for (const [name, mention] of mentions) {
          if (mention.test(line)) problems.push(`${rel(path)}:${index + 1}: names retired \`${name}\``);
        }
      }
    }
  }

  const cutModes = rules.flatMap((name) => {
    const path = `.agents/rules/${name}.mdc`;
    const kept = new Set(hintModes(readFileSync(join(root, path), 'utf8')));
    return hintModes(gitRaw(root, 'show', `HEAD:./${path}`)).filter((mode) => !kept.has(mode)).map((mode) => `${name} ${mode}`);
  }).filter((name) => !dropped.has(name));
  if (cutModes.length > 0) {
    const typed = typedInvocations(root, cutModes).counts;
    for (const name of cutModes) {
      if (typed[name].all > 0) problems.push(`typed mode \`${name}\` (typed ${typed[name].all} times) was cut from its argument hint; keep it, or list it under "dropped" in ${CONFIG} once the owner says to drop it`);
    }
  }

  // In a project that generates skills from rules, only rule-backed skills are
  // its own; a vendored skill's links point into its upstream repository.
  const owned = localSkills(root).filter((name) => (rules.length > 0 ? rules.includes(name) : !lock[name]));
  for (const name of owned) {
    for (const path of markdownFiles(join(root, '.agents/skills', name))) {
      const text = readFileSync(path, 'utf8').replace(/```[\s\S]*?```/gu, '');
      for (const [, target] of text.matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/gu)) {
        if (/^(?:[a-z]+:|\/|<)/u.test(target)) continue;
        const resolved = resolve(dirname(path), target);
        const inSkills = resolved.startsWith(join(root, '.agents')) || resolved.startsWith(join(root, '.claude')) || target.endsWith('SKILL.md');
        if (inSkills && !existsSync(resolved)) problems.push(`${rel(path)}: dead link ${target}`);
      }
    }
  }

  // Plans are history; an install line there does not make a skill public.
  const plans = config.plans ?? 'docs/plans';
  const installs = (git(root, 'grep', '-h', 'skills add', '--', ':!.agents', ':!.claude', `:!${plans}`) ?? '').split('\n');
  const local = [
    ['.agents/pstack/', /\.agents\/pstack\//u],
    ['poteto-mode', /\bpoteto-mode\b/u],
    ['pstack: skills', /\bpstack:/u],
    ['AGENTS.md', /\bAGENTS\.md\b/u],
    [`${plans}/`, new RegExp(`${plans.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}/`, 'u')],
  ];
  for (const name of localSkills(root)) {
    if (!installs.some((line) => new RegExp(`(?:^|[\\s/=])${name}(?:$|[\\s\`'"])`, 'u').test(line))) continue;
    for (const path of markdownFiles(join(root, '.agents/skills', name))) {
      const hit = local.find(([, pattern]) => pattern.test(readFileSync(path, 'utf8')));
      if (hit) problems.push(`public skill \`${name}\` depends on ${hit[0]} in ${rel(path)}`);
    }
  }
  return problems;
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

const versionParts = (version) => version.replace(/^v/u, '').split('.').map(Number);
const compareVersions = (a, b) => versionParts(a).reduce((order, part, index) => order || part - versionParts(b)[index], 0);

function untaggedVersion(latest) {
  const version = upstream().version();
  return version && compareVersions(version, latest) > 0 ? version : null;
}

export function latestTag() {
  const result = spawnSync('git', ['ls-remote', '--tags', '--refs', upstreamUrl()], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ls-remote failed: ${result.stderr.trim()}`);
  const tags = [...result.stdout.matchAll(/refs\/tags\/(v\d+\.\d+\.\d+)$/gmu)].map((match) => match[1]);
  return tags.sort(compareVersions).at(-1) ?? null;
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

function report({ root, changes, refusals, pstackDiff }, mode) {
  const lines = [root];
  if (pstackDiff && mode !== 'check') {
    lines.push('  pstack changed in files this project anchors on; read it for steps that kept their quoted text:');
    lines.push(pstackDiff.replace(/^/gmu, '    '));
  }
  for (const refusal of refusals) {
    lines.push(`  refused ${refusal.path}: ${refusal.reason}`);
    if (refusal.diff) lines.push(refusal.diff.replace(/^/gmu, '    '));
  }
  for (const change of changes) {
    lines.push(`  ${mode === 'check' ? 'stale' : change.remove ? 'remove' : 'write'} ${change.path}`);
    if (mode === 'dry-run' && change.diff) lines.push(change.diff.replace(/^/gmu, '    '));
  }
  if (changes.length === 0 && refusals.length === 0) lines.push('  in sync');
  else if (refusals.some((refusal) => refusal.forceable === false)) lines.push('  nothing written; resolve each refusal');
  else if (refusals.length > 0) lines.push('  nothing written; resolve each refusal, or rerun with --force to discard the project edit');
  else if (mode === 'dry-run') lines.push('  dry run; nothing written');
  return lines.join('\n');
}

const HELP = `Usage: node sync-pstack.mjs <command> [options]

  discover <project>               Facts for the setup interview, as JSON. Read-only.
  status [project...]              State of pstack projects; finds local ones when none are named. Read-only.
  apply <project>                  Render the block, helpers and plugin pin from <project>/${CONFIG}.
                                   A bump refuses when pstack dropped text an override or playbook anchors on.
  check <project>                  Exit 1 when apply would change anything. Read-only.
  verify <project>                 Exit 1 when typed commands or modes, skill links, retired names, public skills,
                                   the block or pstack anchors are broken. Read-only.
  sync --tag <tag> [project...]    apply --tag to every managed project, or to the named ones. Refuses a checkout
                                   off its branch or with uncommitted edits to the files it writes.
  playbook <project> <name>        Print each pstack base of .agents/playbooks/<name>.md with its changes applied.
  smoke <project> <prompt>...      Run each prompt read-only in Claude Code and Codex from <project>; print the answers.
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
  const positional = [];
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--tag') flags.tag = rest[++index];
    else if (arg === '--root') flags.roots.push(resolve(rest[++index]));
    else if (SWITCHES[arg]) flags[SWITCHES[arg]] = true;
    else if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}`);
    else positional.push(arg);
  }
  const projects = positional.map((arg) => resolve(arg));
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
      let ahead = null;
      if (latest && !latest.startsWith('unknown')) {
        try {
          ahead = untaggedVersion(latest);
        } catch (error) {
          ahead = `unknown (${error.message})`;
        }
      }
      const result = { latest, untagged: ahead, userPins: userPins(), projects: list };
      if (flags.json) {
        console.info(json(result).trimEnd());
        return 0;
      }
      console.info(`latest ${REPO} tag: ${latest ?? 'not checked'}`);
      if (ahead?.startsWith('unknown')) console.info(`upstream VERSION: ${ahead}`);
      else if (ahead) console.info(`upstream VERSION ${ahead} is ahead of the newest tag ${latest}; pin only a pushed tag`);
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
    case 'verify': {
      const problems = verify(one());
      console.info(problems.length > 0 ? `${problems.length} problem(s):\n${problems.join('\n')}` : 'verified: typed commands and modes resolve, skill links resolve, no retired names, public skills self-contained, block in sync, pstack anchors hold');
      return problems.length > 0 ? 1 : 0;
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
    case 'playbook': {
      if (positional.length !== 2) throw new Error('playbook takes a project path and a playbook name');
      console.info(renderPlaybook(resolve(positional[0]), positional[1]));
      return 0;
    }
    case 'smoke': {
      if (positional.length < 2) throw new Error('smoke takes a project path and at least one prompt');
      return smoke(resolve(positional[0]), positional.slice(1)).then((answers) => {
        for (const answer of answers) console.info(`## ${answer.runtime}: ${answer.prompt.slice(0, 80)}\n${answer.text}\n`);
        return answers.every((answer) => answer.ok) ? 0 : 1;
      });
    }
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
  Promise.resolve()
    .then(() => main(process.argv.slice(2)))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 2;
    });
}
