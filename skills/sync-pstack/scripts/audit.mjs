#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discover, localSkills, locateBlock, markdownFiles, RULE_FILES, skillMention, unmarkedRules, USER_SKILL_DIRS, userTypedInvocations } from './sync-pstack.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DOTAI_CHECKOUT = existsSync(resolve(HERE, '../../../workflow-manifest.json')) ? resolve(HERE, '../../..') : null;
const TEMPLATE = resolve(HERE, '../assets/block.md');
const RULES = resolve(HERE, '../assets/pstack/rules');
const SHARED_FILES = new Set(['block', ...Object.keys(RULE_FILES).map((name) => `rules/${name}`)]);
const SHINGLE = 3;
const MIN_WORDS = 6;
const STOP_WORDS = new Set('a an and any are as at be by each every for from if in into is it its no not of on one only or so than that the their then this to when with'.split(' '));

const readJson = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {});

function* files(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else if (entry.isFile()) yield path;
  }
}

const sameTree = (a, b) => {
  const listing = (dir) => [...files(dir)].map((path) => relative(dir, path)).sort();
  const left = listing(a);
  const right = listing(b);
  return left.length === right.length && left.every((path, index) => path === right[index] && readFileSync(join(a, path)).equals(readFileSync(join(b, path))));
};

function pstackSkillsDir(root) {
  const tag = readJson(join(root, '.agents/pstack.json')).tag?.replace(/^v/u, '');
  const dir = tag && join(homedir(), '.claude/plugins/cache/pstack-claude/pstack', tag, 'skills');
  return { tag: tag ?? null, dir: dir && existsSync(dir) ? dir : null };
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

function audit(root, minScore) {
  const facts = discover(root);
  const projectFiles = [
    ...markdownFiles(join(root, '.agents/rules')),
    ...markdownFiles(join(root, '.agents/playbooks')),
    ...[...markdownFiles(join(root, '.agents'))].filter((path) => !/\/\.agents\/(?:rules|playbooks|skills|pstack)\//u.test(path)),
  ];
  const project = [];
  for (const path of [...new Set(projectFiles)]) project.push(...shingledSentences(readFileSync(path, 'utf8'), relative(root, path)));
  if (existsSync(join(root, 'AGENTS.md'))) {
    const text = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    const block = locateBlock(text);
    const lines = text.split('\n');
    const outside = block ? lines.map((line, at) => (at >= block.begin && at <= block.end ? '' : line)).join('\n') : text;
    project.push(...shingledSentences(outside, 'AGENTS.md'));
  }

  const blockText = readFileSync(TEMPLATE, 'utf8');
  const shared = [
    ...shingledSentences(blockText, 'block'),
    ...Object.keys(RULE_FILES).flatMap((name) => shingledSentences(readFileSync(join(RULES, name), 'utf8'), `rules/${name}`)),
  ];
  const pstackText = pstackSkillsDir(root);
  const pstack = pstackText.dir ? [...markdownFiles(pstackText.dir)].flatMap((path) => shingledSentences(readFileSync(path, 'utf8'), `pstack/${relative(pstackText.dir, path)}`)) : [];
  const references = { pstack: [pstack, index(pstack)], block: [shared, index(shared)], project: [project, index(project)] };

  const overlaps = [];
  const pairs = new Set();
  const compare = (sentence, kind, skip) => {
    const [corpus, byShingle] = references[kind];
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

  const routeFiles = [join(root, 'AGENTS.md'), ...projectFiles].filter((path) => existsSync(path));
  const routeTexts = routeFiles.map((path) => [relative(root, path), readFileSync(path, 'utf8')]);
  const routes = (name) => {
    const pattern = skillMention(name);
    const own = (path) => path === `.agents/rules/${name}.mdc` || path.startsWith(`.agents/rules/${name}/`);
    return routeTexts.filter(([path, text]) => !own(path) && pattern.test(text)).map(([path]) => path);
  };
  const dotaiCopy = (name) => join(DOTAI_CHECKOUT, 'skills', name);
  const inDotai = (name) => (DOTAI_CHECKOUT ? existsSync(join(dotaiCopy(name), 'SKILL.md')) : null);
  const stale = (installed, name) => (DOTAI_CHECKOUT ? inDotai(name) && !sameTree(installed, dotaiCopy(name)) : null);

  const lock = readJson(join(root, 'skills-lock.json')).skills ?? {};
  const skills = facts.skills.map((skill) => {
    const dir = join(root, '.agents/skills', skill.name);
    return {
      name: skill.name,
      source: skill.source,
      typed: facts.typed.counts[skill.name] ?? { all: 0, week: 0 },
      routes: routes(skill.name),
      stale: /dotai/u.test(lock[skill.name]?.source ?? '') && existsSync(dir) ? stale(dir, skill.name) : false,
    };
  });

  const userLock = readJson(join(homedir(), '.agents/.skill-lock.json')).skills ?? {};
  const userNames = localSkills(homedir(), USER_SKILL_DIRS);
  const userTyped = userTypedInvocations(userNames);
  const userSkills = userNames.map((name) => {
    const dir = USER_SKILL_DIRS.map((skills) => join(homedir(), skills, name)).find((path) => existsSync(join(path, 'SKILL.md')));
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

  return { root, minScore, dotai: DOTAI_CHECKOUT, skills, userSkills, overlaps, unmarkedRules: unmarkedRules(blockText), pstack: pstackText };
}

const PER_KIND = 40;

function report(result) {
  const yesNo = (value) => (value === null ? '?' : value ? 'yes' : '');
  const missing = result.pstack.tag ? `v${result.pstack.tag} is not in the Claude plugin cache` : 'no tag in .agents/pstack.json';
  const pstack = result.pstack.dir ?? `${missing}, so nothing was compared with pstack`;
  const out = [`Skill-drift facts for ${result.root}`, `pstack text: ${pstack}`, `dotai checkout: ${result.dotai ?? 'unknown; run from the dotai checkout for source facts'}`];
  out.push('', '## Project skills', 'name | source | typed all (week) | routes | stale copy');
  for (const skill of result.skills) out.push(`${skill.name} | ${skill.source ?? '?'} | ${skill.typed.all} (${skill.typed.week}) | ${skill.routes.length} | ${yesNo(skill.stale)}`);
  out.push('', '## User-scope skills', 'name | source | typed anywhere | in dotai | stale copy');
  for (const skill of result.userSkills) out.push(`${skill.name} | ${skill.source ?? '?'} | ${skill.typed.all} | ${yesNo(skill.inDotai) || 'no'} | ${yesNo(skill.stale)}`);
  out.push('', `## Block rules with no overrides note or adds marker: ${result.unmarkedRules.join(', ') || 'none'}`);
  const kinds = [
    ['Block sentences that repeat pstack', (overlap) => SHARED_FILES.has(overlap.file), true],
    ['Project sentences that repeat pstack', (overlap) => !SHARED_FILES.has(overlap.file) && overlap.with === 'pstack', true],
    ['Project sentences that repeat the block', (overlap) => overlap.with === 'block', false],
    ['Project sentences repeated elsewhere in the project', (overlap) => overlap.with === 'project', false],
  ];
  for (const [title, matches, needsPstack] of kinds) {
    if (needsPstack && !result.pstack.dir) {
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
