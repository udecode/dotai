#!/usr/bin/env node
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DOTAI_CHECKOUT = existsSync(resolve(HERE, '../../../upstream-skills.json')) ? resolve(HERE, '../../..') : null;
const USER_SKILL_DIRS = ['.agents/skills', '.claude/skills', '.codex/skills'];
const DAY = 24 * 60 * 60 * 1000;
const SHINGLE = 3;
const MIN_WORDS = 6;
const STOP_WORDS = new Set('a an and any are as at be by each every for from if in into is it its no not of on one only or so than that the their then this to when with'.split(' '));
const PER_KIND = 40;
const BINARY_ASSET_EXT = /\.(?:ttf|otf|woff2?|png|jpe?g|webp|gif|mp4|webm|ico|pdf)$/iu;

export const SIZE_BUDGETS = {
  playbookFile: 14_000,
  playbooksTotal: 70_000,
  ruleFile: 14_000,
  skillFile: 20_000,
  skillDir: 40_000,
};

export const DOTAI_BUDGETS = {
  skillFile: 16_384,
  skillsTotal: 100_000,
  ruleFile: 8_192,
  rulesTotal: 80_000,
  helperFiles: 18,
};

const readJson = (path) => {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
};

function* walkFiles(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkFiles(path);
    else if (entry.isFile()) yield path;
  }
}

function* markdownFiles(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && (entry.name === 'node_modules' || entry.name === 'scripts')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* markdownFiles(path);
    else if (/\.(?:md|mdc)$/u.test(entry.name)) yield path;
  }
}

const sameTree = (a, b) => {
  const listing = (dir) => [...walkFiles(dir)].map((path) => relative(dir, path)).sort();
  const left = listing(a);
  const right = listing(b);
  return left.length === right.length && left.every((path, index) => path === right[index] && readFileSync(join(a, path)).equals(readFileSync(join(b, path))));
};

const END_BLOCK = '<!-- pstack:end -->';

function locateBlock(text) {
  const lines = text.split('\n');
  const begins = lines.flatMap((line, index) => (line.startsWith('<!-- pstack:begin') ? [index] : []));
  const ends = lines.flatMap((line, index) => (line.trim() === END_BLOCK ? [index] : []));
  if (begins.length === 0 && ends.length === 0) return null;
  if (begins.length !== 1 || ends.length !== 1 || ends[0] < begins[0]) return null;
  return { begin: begins[0], end: ends[0], body: lines.slice(begins[0] + 1, ends[0]).join('\n').trim() };
}

function localSkills(root, dirs = ['.agents/skills', '.claude/skills']) {
  const names = new Set();
  for (const dir of dirs) {
    const path = join(root, dir);
    if (!existsSync(path)) continue;
    for (const name of readdirSync(path)) if (existsSync(join(path, name, 'SKILL.md'))) names.add(name);
  }
  return [...names].sort();
}

function repoTopSkills(root) {
  const dir = join(root, 'skills');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
    .sort();
}

const isDotaiRepo = (root) =>
  existsSync(join(root, 'skills/sync-pstack/assets/pstack/rules')) || existsSync(join(root, 'upstream-skills.json'));

const distinctiveName = (name) => /[-\d]/u.test(name);

function skillMention(name, { siblingLinks = true } = {}) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const end = '(?![\\w:-]|[./]\\w)';
  const invocation = `(?<![\\w./:@-])[$/]${escaped}${end}`;
  const codeSpan = `(?<![\`\\w./:@-])\`${escaped}\`(?![\`\\w:-])`;
  const path = `(?:skills|rules${siblingLinks ? '|\\.\\.' : ''})/${escaped}(?:/|\\.mdc(?![\\w.]))`;
  const bareName = `(?<![\\w./:@$-])${escaped}${end}`;
  return new RegExp([invocation, codeSpan, path, ...(distinctiveName(name) ? [bareName] : [])].join('|'), 'u');
}

function hintModes(rule) {
  const hint = rule?.match(/^argument-hint:\s*(.*)$/mu)?.[1].trim().replace(/^(['"])(.*)\1$/u, '$2') ?? '';
  return hint
    .replace(/<[^>]*>/gu, '')
    .replace(/[[\]]/gu, ' ')
    .split('|')
    .map((part) => part.trim().split(/\s+/u)[0])
    .filter((word) => /^[a-z][\w-]*$/u.test(word ?? ''));
}

const MARKDOWN_END = /\.mdc?(?![\p{L}\p{N}]|\.[\p{L}\p{N}])/giu;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const IMPORT = /(?<![\p{L}\p{N}])@([^\s`'"()<>[\]{}]+)/gu;
const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

const fromCodePoint = (value, reference) => (value <= 0x10ffff ? String.fromCodePoint(value) : reference);

const decodeLine = (line) =>
  line
    .replace(/\\([!-/:-@[-`{-~])/gu, '$1')
    .replace(/&(?:#(\d+)|#x([\da-f]+)|(amp|lt|gt|quot|apos));/giu, (reference, decimal, hex, name) =>
      decimal ? fromCodePoint(Number(decimal), reference) : hex ? fromCodePoint(Number.parseInt(hex, 16), reference) : XML_ENTITIES[name.toLowerCase()],
    )
    .replace(/(?:%[\da-f]{2})+/giu, (run) => {
      try {
        return decodeURIComponent(run);
      } catch {
        return run;
      }
    });

const longestNamedSpan = (line, earliestStart, extensionStart, stop, named) => {
  for (let start = earliestStart; start < extensionStart; start += 1) {
    if (start > 0 && LETTER_OR_DIGIT.test(line[start - 1])) continue;
    const file = named(line.slice(start, stop));
    if (file) return file;
  }
  return null;
};

function projectRuleFiles(root) {
  const real = realpathSync.native(root);
  const inside = (target) => {
    const rel = relative(real, target);
    return rel.split(sep)[0] !== '..' && !isAbsolute(rel);
  };
  const resolved = new Map();
  const inProject = (path) => {
    if (!resolved.has(path)) {
      const target = existsSync(path) ? realpathSync.native(path) : null;
      resolved.set(path, target && inside(target) && statSync(target).isFile() ? relative(real, target) : null);
    }
    return resolved.get(path);
  };
  const named = (path, dir = root) => inProject(resolve(dir, path)) ?? inProject(join(dir, path));
  const files = new Set();
  const ruleContext = new Set();
  const skills = join(root, '.agents/skills');
  const skipped = existsSync(skills) ? realpathSync.native(skills) : null;
  const ruleFolder = (dir) => /^\.agents\/(?:rules|playbooks)(?:\/|$)/u.test(relative(root, dir));
  const walked = new Set();
  const walk = (dir, rule) => {
    const target = realpathSync.native(dir);
    const key = `${rule} ${target}`;
    if ((target === skipped && !ruleFolder(dir)) || walked.has(key) || !inside(target)) return;
    walked.add(key);
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (existsSync(path) && statSync(path).isDirectory()) walk(path, rule);
      else if (/\.mdc?$/iu.test(entry)) {
        const file = inProject(path);
        if (!file) continue;
        files.add(file);
        if (rule) ruleContext.add(file);
      }
    }
  };
  for (const [dir, rule] of [['.agents', false], ['.agents/rules', true]]) {
    if (existsSync(join(root, dir))) walk(join(root, dir), rule);
  }
  const agents = inProject(join(root, 'AGENTS.md'));
  if (agents) files.add(agents);
  for (const current of files) {
    const dir = current === agents ? root : dirname(join(real, current));
    for (const raw of readFileSync(join(real, current), 'utf8').split('\n')) {
      for (const line of new Set([raw, decodeLine(raw)])) {
        if (current === agents) {
          let earliestStart = 0;
          for (const { index, 0: end } of line.matchAll(MARKDOWN_END)) {
            const stop = index + end.length;
            const file = longestNamedSpan(line, earliestStart, index, stop, named);
            if (file) files.add(file);
            earliestStart = stop;
          }
        }
        for (const { 1: path } of line.matchAll(IMPORT)) {
          const file = named(path.replace(/[.,;:!?]+$/u, ''), dir);
          if (file) files.add(file);
        }
      }
    }
  }
  return { agents, files: [...files].sort(), siblingLinks: (file) => file.startsWith('.agents/rules/') || ruleContext.has(file) };
}

function parseLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function* codexSessions(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* codexSessions(path);
    else if (entry.name.endsWith('.jsonl')) yield path;
  }
}

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

function* typedMessages(root) {
  const projects = join(homedir(), '.claude/projects');
  const claudeDirs =
    root !== EVERY_PROJECT
      ? [join(projects, root.replace(/[^a-zA-Z0-9]/gu, '-'))]
      : existsSync(projects)
        ? readdirSync(projects).map((name) => join(projects, name))
        : [];
  for (const claudeDir of claudeDirs.filter((path) => existsSync(path) && statSync(path).isDirectory())) {
    for (const name of readdirSync(claudeDir).filter((file) => file.endsWith('.jsonl'))) {
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

  const seen = new Set();
  for (const dir of ['.codex/sessions', '.codex/archived_sessions']) {
    for (const path of codexSessions(join(homedir(), dir))) {
      const { cwd, subagent, headless } = sessionMeta(path);
      if (subagent || headless || (root !== EVERY_PROJECT && cwd !== root && !cwd?.startsWith(`${root}/`))) continue;
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

function typedInvocations(root, names, now = Date.now()) {
  return tally(typedMessages(root), zero(names), now);
}

function userTypedInvocations(names, now = Date.now()) {
  const home = homedir();
  const roots = USER_SKILL_DIRS.map((dir) => `${join(home, dir)}/`);
  const userScope = (path) => {
    if (path === null) return true;
    const expanded = path.startsWith('~/') ? join(home, path.slice(2)) : path;
    return isAbsolute(expanded) && roots.some((root) => resolve(expanded).startsWith(root));
  };
  return tally(typedMessages(EVERY_PROJECT), zero(names), now, (hit) => userScope(hit.path));
}

const RULE = /^- \*\*([^*]+?)\.\*\*/u;
const MARKER = /^<!-- # (?:overrides |relies |adds -->)/u;
const isDirectiveOrContinuation = (line) => line.startsWith('<!--') || line.startsWith(' ');

const isNoted = (lines, index, name) => {
  for (let above = index - 1; above >= 0; above -= 1) {
    if (MARKER.test(lines[above])) return true;
    if (isDirectiveOrContinuation(lines[above])) continue;
    return lines[above].match(RULE)?.[1] === name && isNoted(lines, above, name);
  }
  return false;
};

export function unmarkedRules(template) {
  const lines = template.split('\n');
  const unmarked = new Set();
  for (const [index, line] of lines.entries()) {
    const name = line.match(RULE)?.[1];
    if (name && !isNoted(lines, index, name)) unmarked.add(name);
  }
  return [...unmarked];
}

function pstackSkillsDir(root, dotaiTarget) {
  const configPath = join(root, '.agents/pstack.json');
  const hasConfig = existsSync(configPath);
  let tag = hasConfig ? readJson(configPath).tag?.replace(/^v/u, '') : null;
  let source = hasConfig ? 'project' : 'none';
  if (!tag && dotaiTarget) {
    const userRef = readJson(join(homedir(), '.claude/settings.json')).extraKnownMarketplaces?.['pstack-claude']?.source?.ref;
    if (userRef) {
      tag = userRef.replace(/^v/u, '');
      source = 'user';
    }
  }
  const dir = tag && join(homedir(), '.claude/plugins/cache/pstack-claude/pstack', tag, 'skills');
  return { tag: tag ?? null, dir: dir && existsSync(dir) ? dir : null, source };
}

function resolveSharedSource(root) {
  const candidates = [
    join(root, 'skills/sync-pstack/assets'),
    DOTAI_CHECKOUT && join(DOTAI_CHECKOUT, 'skills/sync-pstack/assets'),
    resolve(HERE, '../../sync-pstack/assets'),
    ...USER_SKILL_DIRS.map((dir) => join(homedir(), dir, 'sync-pstack/assets')),
  ].filter(Boolean);
  for (const assetsDir of candidates) {
    const blockPath = join(assetsDir, 'block.md');
    const rulesDir = join(assetsDir, 'pstack/rules');
    if (existsSync(blockPath) && existsSync(rulesDir)) {
      const ruleNames = readdirSync(rulesDir).filter((name) => name.endsWith('.md')).sort();
      return {
        kind: 'template',
        blockText: readFileSync(blockPath, 'utf8'),
        rules: ruleNames.map((name) => ({ name, text: readFileSync(join(rulesDir, name), 'utf8') })),
      };
    }
  }
  const agentsPath = join(root, 'AGENTS.md');
  const block = existsSync(agentsPath) ? locateBlock(readFileSync(agentsPath, 'utf8')) : null;
  const localRulesDir = join(root, '.agents/pstack/rules');
  const localRules = existsSync(localRulesDir)
    ? readdirSync(localRulesDir).filter((name) => name.endsWith('.md')).sort().map((name) => ({ name, text: readFileSync(join(localRulesDir, name), 'utf8') }))
    : [];
  if (block || localRules.length > 0) {
    return { kind: 'rendered', blockText: block?.body ?? '', rules: localRules };
  }
  return null;
}

function paragraphs(text) {
  const out = [];
  let current = null;
  let fenced = false;
  for (const [index, line] of text.split('\n').entries()) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) fenced = !fenced;
    if (fenced || !trimmed || trimmed.startsWith('<!--') || trimmed.startsWith('```')) {
      current = null;
      continue;
    }
    if (!current || /^(?:#|\||[-*] |\d+\. )/u.test(trimmed)) {
      current = { line: index + 1, text: trimmed };
      out.push(current);
    } else current.text += ` ${trimmed}`;
  }
  return out;
}

const contentWords = (text) => (text.toLowerCase().match(/[a-z0-9]+/gu) ?? []).filter((word) => !STOP_WORDS.has(word));

function shingledSentences(text, file) {
  const out = [];
  for (const paragraph of paragraphs(text)) {
    for (const part of paragraph.text.split(/(?<=[.!?])\s+/u)) {
      const words = contentWords(part);
      if (words.length < MIN_WORDS) continue;
      const shingles = new Set();
      for (let start = 0; start + SHINGLE <= words.length; start += 1) shingles.add(words.slice(start, start + SHINGLE).join(' '));
      out.push({ file, line: paragraph.line, text: part.trim(), shingles });
    }
  }
  return out;
}

function index(corpus) {
  const byShingle = new Map();
  for (const [id, sentence] of corpus.entries()) {
    for (const shingle of sentence.shingles) {
      if (!byShingle.has(shingle)) byShingle.set(shingle, []);
      byShingle.get(shingle).push(id);
    }
  }
  return byShingle;
}

function best(sentence, corpus, byShingle, skip = () => false) {
  const shared = new Map();
  for (const shingle of sentence.shingles) {
    for (const id of byShingle.get(shingle) ?? []) if (!skip(corpus[id])) shared.set(id, (shared.get(id) ?? 0) + 1);
  }
  let top = null;
  for (const [id, count] of shared) {
    const score = count / sentence.shingles.size;
    if (!top || score > top.score) top = { score, match: corpus[id] };
  }
  return top;
}

export function sizeAudit(root) {
  const over = [];
  let playbooksTotal = 0;
  let rulesTotal = 0;
  let skillsTotal = 0;

  const playbooksDir = join(root, '.agents/playbooks');
  if (existsSync(playbooksDir)) {
    const playbookPaths = [...walkFiles(playbooksDir)].filter((path) => path.endsWith('.md')).sort();
    for (const path of playbookPaths) {
      const bytes = statSync(path).size;
      playbooksTotal += bytes;
      if (bytes > SIZE_BUDGETS.playbookFile) {
        over.push({ kind: 'playbook-file', path: relative(root, path), bytes, limit: SIZE_BUDGETS.playbookFile });
      }
    }
    if (playbooksTotal > SIZE_BUDGETS.playbooksTotal) {
      over.push({ kind: 'playbooks-total', path: '.agents/playbooks', bytes: playbooksTotal, limit: SIZE_BUDGETS.playbooksTotal });
    }
  }

  const rulesDir = join(root, '.agents/rules');
  if (existsSync(rulesDir)) {
    const rulePaths = [...walkFiles(rulesDir)].filter((path) => path.endsWith('.mdc')).sort();
    for (const path of rulePaths) {
      const bytes = statSync(path).size;
      rulesTotal += bytes;
      if (bytes > SIZE_BUDGETS.ruleFile) {
        over.push({ kind: 'rule-file', path: relative(root, path), bytes, limit: SIZE_BUDGETS.ruleFile });
      }
    }
  }

  const skillsDir = join(root, '.agents/skills');
  if (existsSync(skillsDir)) {
    const entries = readdirSync(skillsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const dir = join(skillsDir, entry.name);
      const skillFile = join(dir, 'SKILL.md');
      if (existsSync(skillFile)) {
        const bytes = statSync(skillFile).size;
        if (bytes > SIZE_BUDGETS.skillFile) {
          over.push({ kind: 'skill-file', path: relative(root, skillFile), bytes, limit: SIZE_BUDGETS.skillFile });
        }
      }
      let dirBytes = 0;
      for (const path of walkFiles(dir)) {
        const rel = relative(dir, path);
        if (rel === 'scripts' || rel.startsWith('scripts/')) continue;
        if (BINARY_ASSET_EXT.test(rel)) continue;
        dirBytes += statSync(path).size;
      }
      skillsTotal += dirBytes;
      if (dirBytes > SIZE_BUDGETS.skillDir) {
        over.push({ kind: 'skill-dir', path: relative(root, dir), bytes: dirBytes, limit: SIZE_BUDGETS.skillDir });
      }
    }
  }

  let dotai = null;
  const repoSkills = repoTopSkills(root);
  const dotaiTarget = isDotaiRepo(root);
  if (repoSkills.length > 0) {
    const fileLimit = dotaiTarget ? DOTAI_BUDGETS.skillFile : SIZE_BUDGETS.skillFile;
    let repoSkillBytes = 0;
    for (const name of repoSkills) {
      const skillFile = join(root, 'skills', name, 'SKILL.md');
      const bytes = statSync(skillFile).size;
      repoSkillBytes += bytes;
      if (bytes > fileLimit) {
        over.push({ kind: dotaiTarget ? 'dotai-skill-file' : 'skill-file', path: relative(root, skillFile), bytes, limit: fileLimit });
      }
    }
    if (dotaiTarget && repoSkillBytes > DOTAI_BUDGETS.skillsTotal) {
      over.push({ kind: 'dotai-skills-total', path: 'skills/*/SKILL.md', bytes: repoSkillBytes, limit: DOTAI_BUDGETS.skillsTotal });
    }
    let dotaiRuleBytes = 0;
    const dotaiRulesDir = join(root, 'skills/sync-pstack/assets/pstack/rules');
    if (existsSync(dotaiRulesDir)) {
      for (const name of readdirSync(dotaiRulesDir).filter((file) => file.endsWith('.md')).sort()) {
        const path = join(dotaiRulesDir, name);
        const bytes = statSync(path).size;
        dotaiRuleBytes += bytes;
        if (bytes > DOTAI_BUDGETS.ruleFile) {
          over.push({ kind: 'dotai-rule-file', path: relative(root, path), bytes, limit: DOTAI_BUDGETS.ruleFile });
        }
      }
      if (dotaiRuleBytes > DOTAI_BUDGETS.rulesTotal) {
        over.push({ kind: 'dotai-rules-total', path: 'skills/sync-pstack/assets/pstack/rules', bytes: dotaiRuleBytes, limit: DOTAI_BUDGETS.rulesTotal });
      }
    }
    const blockPath = join(root, 'skills/sync-pstack/assets/block.md');
    const blockBytes = existsSync(blockPath) ? statSync(blockPath).size : 0;
    const helpersDir = join(root, 'skills/sync-pstack/assets/pstack');
    const helpersCount = existsSync(helpersDir) ? readdirSync(helpersDir).filter((file) => file.endsWith('.mjs')).length : 0;
    if (dotaiTarget && helpersCount > DOTAI_BUDGETS.helperFiles) {
      over.push({ kind: 'dotai-helpers', path: 'skills/sync-pstack/assets/pstack', bytes: helpersCount, limit: DOTAI_BUDGETS.helperFiles });
    }
    if (dotaiTarget) {
      dotai = { skills: repoSkillBytes, rules: dotaiRuleBytes, block: blockBytes, helpers: helpersCount };
    } else {
      skillsTotal += repoSkillBytes;
    }
  }

  over.sort((a, b) => a.kind.localeCompare(b.kind) || b.bytes - a.bytes || a.path.localeCompare(b.path));
  return { limits: SIZE_BUDGETS, totals: { playbooks: playbooksTotal, rules: rulesTotal, skills: skillsTotal }, ...(dotai ? { dotai } : {}), over };
}

export function audit(root, minScore = 0.5) {
  const dotaiTarget = isDotaiRepo(root);
  const hasPstackConfig = existsSync(join(root, '.agents/pstack.json'));
  const rulesDir = join(root, '.agents/rules');
  const ruleNames = existsSync(rulesDir) ? readdirSync(rulesDir).filter((name) => name.endsWith('.mdc')).map((name) => name.slice(0, -4)) : [];
  const localNames = localSkills(root);
  const topNames = repoTopSkills(root);
  const lock = readJson(join(root, 'skills-lock.json')).skills ?? {};
  const projectSkillEntries = [
    ...localNames.map((name) => ({ name, source: lock[name]?.source ?? (ruleNames.includes(name) ? 'rule' : null), dir: join(root, '.agents/skills', name) })),
    ...topNames.filter((name) => !localNames.includes(name)).map((name) => ({ name, source: 'repo', dir: join(root, 'skills', name) })),
  ].sort((a, b) => a.name.localeCompare(b.name));

  const modes = ruleNames.flatMap((name) => hintModes(readFileSync(join(rulesDir, `${name}.mdc`), 'utf8')).map((mode) => `${name} ${mode}`));
  const typedCounts = typedInvocations(root, [...new Set([...projectSkillEntries.map((s) => s.name), ...ruleNames, ...modes])].sort());

  const { agents, files, siblingLinks } = projectRuleFiles(root);
  const projectFiles = files.filter((file) => file !== agents && !file.startsWith('.agents/pstack/')).map((file) => join(root, file));
  for (const name of topNames) {
    const skillDir = join(root, 'skills', name);
    for (const path of markdownFiles(skillDir)) {
      const rel = relative(skillDir, path);
      if (rel === 'assets' || rel.startsWith('assets/')) continue;
      projectFiles.push(path);
    }
  }
  const project = [];
  for (const path of projectFiles) project.push(...shingledSentences(readFileSync(path, 'utf8'), relative(root, path)));
  if (agents) {
    const text = readFileSync(join(root, agents), 'utf8');
    const block = locateBlock(text);
    const lines = text.split('\n');
    const outside = block ? lines.map((line, at) => (at >= block.begin && at <= block.end ? '' : line)).join('\n') : text;
    project.push(...shingledSentences(outside, 'AGENTS.md'));
  }

  const sharedSource = hasPstackConfig || dotaiTarget ? resolveSharedSource(root) : null;
  const sharedFileSet = new Set(sharedSource ? ['block', ...sharedSource.rules.map((rule) => `rules/${rule.name}`)] : []);
  const shared = sharedSource
    ? [
        ...shingledSentences(sharedSource.blockText, 'block'),
        ...sharedSource.rules.flatMap((rule) => shingledSentences(rule.text, `rules/${rule.name}`)),
      ]
    : [];
  const pstackText = pstackSkillsDir(root, dotaiTarget);
  const pstack = pstackText.dir ? [...markdownFiles(pstackText.dir)].flatMap((path) => shingledSentences(readFileSync(path, 'utf8'), `pstack/${relative(pstackText.dir, path)}`)) : [];
  const references = { pstack: [pstack, index(pstack)], block: [shared, index(shared)], project: [project, index(project)] };

  const overlaps = [];
  const pairs = new Set();
  const compare = (sentence, kind, skip) => {
    const [corpus, byShingle] = references[kind];
    if (corpus.length === 0) return;
    const top = best(sentence, corpus, byShingle, skip);
    if (!top || top.score < minScore) return;
    const source = `${top.match.file}:${top.match.line}`;
    if (kind === 'project') {
      const pair = [sentence, top.match].map((side) => `${side.file}:${side.line}:${side.text}`).sort().join('\0');
      if (pairs.has(pair)) return;
      pairs.add(pair);
    }
    overlaps.push({ file: sentence.file, line: sentence.line, with: kind, source, score: Math.round(top.score * 100) / 100, text: sentence.text });
  };
  for (const sentence of project) {
    compare(sentence, 'pstack');
    compare(sentence, 'block');
    compare(sentence, 'project', (other) => other.file === sentence.file);
  }
  for (const sentence of shared) compare(sentence, 'pstack');
  overlaps.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.line - b.line);

  const pstackRuleFiles = files
    .filter((file) => file.startsWith('.agents/pstack/rules/') && file.endsWith('.md'))
    .map((file) => join(root, file));
  const dotaiRuleFiles = dotaiTarget
    ? [
        ...(existsSync(join(root, 'skills/sync-pstack/assets/block.md')) ? [join(root, 'skills/sync-pstack/assets/block.md')] : []),
        ...(existsSync(join(root, 'skills/sync-pstack/assets/pstack/rules'))
          ? readdirSync(join(root, 'skills/sync-pstack/assets/pstack/rules'))
              .filter((file) => file.endsWith('.md'))
              .sort()
              .map((file) => join(root, 'skills/sync-pstack/assets/pstack/rules', file))
          : []),
      ]
    : [];
  const routeFiles = [...(agents ? [join(root, agents)] : []), ...projectFiles, ...pstackRuleFiles, ...dotaiRuleFiles];
  const routeTexts = routeFiles.map((path) => [relative(root, path), readFileSync(path, 'utf8')]);
  const routes = (name) => {
    const [inRules, elsewhere] = [true, false].map((links) => skillMention(name, { siblingLinks: links }));
    const own = (path) => path === `.agents/rules/${name}.mdc` || path.startsWith(`.agents/rules/${name}/`) || path.startsWith(`skills/${name}/`);
    return routeTexts.filter(([path, text]) => !own(path) && (siblingLinks(path) ? inRules : elsewhere).test(text)).map(([path]) => path);
  };
  const dotaiCopy = (name) => join(DOTAI_CHECKOUT, 'skills', name);
  const inDotai = (name) => (DOTAI_CHECKOUT ? existsSync(join(dotaiCopy(name), 'SKILL.md')) : null);
  const stale = (installed, name) => (DOTAI_CHECKOUT ? inDotai(name) && !sameTree(installed, dotaiCopy(name)) : null);

  const skills = projectSkillEntries.map((skill) => ({
    name: skill.name,
    source: skill.source,
    typed: typedCounts[skill.name] ?? { all: 0, week: 0 },
    routes: routes(skill.name),
    stale: /dotai/u.test(lock[skill.name]?.source ?? '') && existsSync(skill.dir) ? stale(skill.dir, skill.name) : false,
  }));

  const userLock = readJson(join(homedir(), '.agents/.skill-lock.json')).skills ?? {};
  const userNames = localSkills(homedir(), USER_SKILL_DIRS);
  const userTyped = userTypedInvocations(userNames);
  const userSkills = userNames.map((name) => {
    const dir = USER_SKILL_DIRS.map((dirName) => join(homedir(), dirName, name)).find((path) => existsSync(join(path, 'SKILL.md')));
    const body = readFileSync(join(dir, 'SKILL.md'), 'utf8');
    const source = userLock[name]?.source ?? body.match(/^\s*source:\s*(\S+)/mu)?.[1] ?? null;
    const real = realpathSync(dir);
    const linkedToDotai = DOTAI_CHECKOUT && (real === realpathSync(DOTAI_CHECKOUT) || real.startsWith(`${realpathSync(DOTAI_CHECKOUT)}/`));
    return {
      name,
      source,
      typed: userTyped[name],
      inDotai: inDotai(name),
      stale: linkedToDotai ? false : stale(dir, name),
    };
  });

  const sizeBudgets = sizeAudit(root);
  const unmarked = sharedSource?.kind === 'template' ? unmarkedRules(sharedSource.blockText) : null;
  return {
    root,
    minScore,
    dotai: DOTAI_CHECKOUT,
    hasPstackConfig,
    hasSharedSource: sharedSource !== null,
    skills,
    userSkills,
    sizeBudgets,
    overlaps,
    unmarkedRules: unmarked,
    pstack: pstackText,
    sharedFiles: [...sharedFileSet],
  };
}

export function report(result) {
  const yesNo = (value) => (value === null ? '?' : value ? 'yes' : '');
  const sharedFiles = new Set(result.sharedFiles ?? []);
  const missing = result.pstack.tag
    ? `v${result.pstack.tag} is not in the Claude plugin cache`
    : result.hasPstackConfig
      ? 'no tag in .agents/pstack.json'
      : 'no .agents/pstack.json (non-pstack repo)';
  const pstack = result.pstack.dir ?? `${missing}, so nothing was compared with pstack`;
  const out = [`Skill-drift facts for ${result.root}`, `pstack text: ${pstack}`, `dotai checkout: ${result.dotai ?? 'unknown; run from the dotai checkout for source facts'}`];
  out.push('', '## Project skills', 'name | source | typed all (week) | routes | stale copy');
  for (const skill of result.skills) out.push(`${skill.name} | ${skill.source ?? '?'} | ${skill.typed.all} (${skill.typed.week}) | ${skill.routes.length} | ${yesNo(skill.stale)}`);
  out.push('', '## User-scope skills', 'name | source | typed anywhere | in dotai | stale copy');
  for (const skill of result.userSkills) out.push(`${skill.name} | ${skill.source ?? '?'} | ${skill.typed.all} | ${yesNo(skill.inDotai) || 'no'} | ${yesNo(skill.stale)}`);
  out.push('', `## Size budgets (over cap: ${result.sizeBudgets.over.length})`);
  if (result.sizeBudgets.over.length === 0) {
    if (result.sizeBudgets.dotai) {
      const d = result.sizeBudgets.dotai;
      out.push(`none (skills ${d.skills}/${DOTAI_BUDGETS.skillsTotal} B, rules ${d.rules}/${DOTAI_BUDGETS.rulesTotal} B, block.md ${d.block} B raw, helpers ${d.helpers}/${DOTAI_BUDGETS.helperFiles})`);
    } else {
      out.push(`none (playbooks total ${result.sizeBudgets.totals.playbooks}/${SIZE_BUDGETS.playbooksTotal} B)`);
    }
  } else {
    out.push('kind | path | bytes | limit');
    for (const item of result.sizeBudgets.over) out.push(`${item.kind} | ${item.path} | ${item.bytes} | ${item.limit}`);
  }
  const unmarkedLine = result.unmarkedRules === null ? 'not checked (no shared block template)' : result.unmarkedRules.join(', ') || 'none';
  out.push('', `## Block rules with no overrides note or adds marker: ${unmarkedLine}`);
  const kinds = [
    ['Block sentences that repeat pstack', (overlap) => sharedFiles.has(overlap.file), true, true],
    ['Project sentences that repeat pstack', (overlap) => !sharedFiles.has(overlap.file) && overlap.with === 'pstack', true, false],
    ['Project sentences that repeat the block', (overlap) => overlap.with === 'block', false, true],
    ['Project sentences repeated elsewhere in the project', (overlap) => overlap.with === 'project', false, false],
  ];
  for (const [title, matches, needsPstack, needsBlock] of kinds) {
    if ((needsPstack && !result.pstack.dir) || (needsBlock && !result.hasSharedSource)) {
      out.push('', `## ${title}: not compared`);
      continue;
    }
    const found = result.overlaps.filter(matches);
    out.push('', `## ${title} (score >= ${result.minScore}): ${found.length}${found.length > PER_KIND ? `, top ${PER_KIND} shown` : ''}`);
    for (const overlap of found.slice(0, PER_KIND)) out.push(`${overlap.score} ${overlap.file}:${overlap.line} ~ ${overlap.source}: ${overlap.text.slice(0, 140)}`);
  }
  return out.join('\n');
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const minIndex = args.indexOf('--min');
  const minScore = minIndex < 0 ? 0.5 : Number(args[minIndex + 1]);
  const target = args.find((arg, index) => !arg.startsWith('--') && args[index - 1] !== '--min');
  if (!target || !existsSync(target) || !statSync(target).isDirectory() || !(minScore > 0 && minScore <= 1)) {
    console.error('Usage: node audit.mjs <project> [--json] [--min <score from 0 to 1>]');
    process.exit(2);
  }
  const result = audit(realpathSync(target), minScore);
  console.info(args.includes('--json') ? JSON.stringify(result, null, 2) : report(result));
}
