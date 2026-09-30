#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const GENERIC_TOKENS = new Set([
  'agent',
  'agents',
  'automation',
  'browser',
  'change',
  'changes',
  'ci',
  'code',
  'debug',
  'docs',
  'documentation',
  'e2e',
  'github',
  'issue',
  'issues',
  'maintainer',
  'plan',
  'proof',
  'review',
  'security',
  'skill',
  'skills',
  'test',
  'testing',
  'triage',
  'workflow',
]);

const PRODUCT_TOKENS = new Set([
  '1password',
  'acpx',
  'apple',
  'clawhub',
  'crabbox',
  'discord',
  'feishu',
  'gog',
  'himalaya',
  'imsg',
  'lobster',
  'mcporter',
  'notion',
  'openclaw',
  'qqbot',
  'slack',
  'sonoscli',
  'spotify',
  'telegram',
  'trello',
  'weather',
]);

const STOP_WORDS = new Set([
  'and',
  'are',
  'for',
  'from',
  'into',
  'our',
  'the',
  'this',
  'that',
  'use',
  'uses',
  'when',
  'with',
  'you',
  'your',
]);

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

const targetRoot = path.resolve(args.target || process.cwd());
const openclawRoot = path.resolve(
  args.openclawRoot || path.join(path.dirname(targetRoot), 'openclaw')
);
const globalSkillsRoot = path.resolve(
  args.globalSkills || path.join(homedir(), '.agents', 'skills')
);
const maxRows = Number.parseInt(args.max || '120', 10);
const decisionsPath = path.resolve(
  args.decisions || path.join(targetRoot, 'docs', 'sync', 'openclaw', 'decisions.json')
);

if (!existsSync(openclawRoot)) {
  fail(`OpenClaw root not found: ${openclawRoot}`);
}

if (!existsSync(targetRoot)) {
  fail(`Target root not found: ${targetRoot}`);
}

const sourceRepos = findRepos(openclawRoot);

if (args.refresh) {
  for (const repo of sourceRepos) {
    refreshRepo(repo);
  }
}

const targetAssets = [
  ...scanRepo(targetRoot, 'target'),
  ...scanGlobalSkills(globalSkillsRoot),
];
const sourceAssets = sourceRepos.flatMap((repo) => scanRepo(repo, 'openclaw'));
const decisions = loadDecisions(decisionsPath);
const rows = buildRows(sourceAssets, targetAssets, decisions);
const sortedRows = sortRows(rows);
const summary = summarize(sortedRows, sourceRepos);
const markdown = renderMarkdown(summary, sortedRows, maxRows, {
  decisionsPath,
  globalSkillsRoot,
  openclawRoot,
  targetRoot,
});
const json = JSON.stringify({ summary, rows: sortedRows }, null, 2);

if (args.out) {
  writeFile(args.out, markdown);
}

if (args.json) {
  writeFile(args.json, json);
}

console.log(markdown);

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }

    if (arg === '--refresh') {
      parsed.refresh = true;
      continue;
    }

    const key = arg.startsWith('--') ? arg.slice(2) : '';

    if (!key) {
      fail(`Unexpected argument: ${arg}`);
    }

    const value = argv[index + 1];

    if (!value || value.startsWith('--')) {
      fail(`Missing value for ${arg}`);
    }

    parsed[toCamel(key)] = value;
    index += 1;
  }

  return parsed;
}

function toCamel(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function findRepos(root) {
  const repos = [];

  if (existsSync(path.join(root, '.git'))) {
    repos.push(root);
  }

  for (const entry of safeReadDir(root)) {
    const full = path.join(root, entry.name);

    if (!entry.isDirectory() || shouldSkipDir(entry.name)) {
      continue;
    }

    if (existsSync(path.join(full, '.git'))) {
      repos.push(full);
    }
  }

  return [...new Set(repos)].sort();
}

function refreshRepo(repo) {
  const result = spawnSync('git', ['-C', repo, 'pull', '--ff-only', '--quiet'], {
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    console.error(
      `[openclaw-sync] refresh failed for ${repo}: ${(result.stderr || result.stdout || '').trim()}`
    );
  }
}

function scanGlobalSkills(root) {
  if (!existsSync(root)) {
    return [];
  }

  return safeReadDir(root)
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name, 'SKILL.md'))
    .filter((file) => existsSync(file))
    .map((file) => assetFromFile(file, root, 'global', 'skill'));
}

function scanRepo(root, origin) {
  const files = [];
  walk(root, files);

  return files
    .filter((file) => isAgentAsset(root, file))
    .map((file) => assetFromFile(file, root, origin, classifyKind(root, file)));
}

function walk(dir, files) {
  for (const entry of safeReadDir(dir)) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!shouldSkipDir(entry.name)) {
        walk(full, files);
      }
      continue;
    }

    if (entry.isFile()) {
      files.push(full);
    }
  }
}

function safeReadDir(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function shouldSkipDir(name) {
  return [
    '.git',
    'node_modules',
    '.next',
    '.turbo',
    'dist',
    'build',
    'coverage',
    'vendor',
    '.venv',
  ].includes(name);
}

function isAgentAsset(root, file) {
  const rel = slash(path.relative(root, file));
  const base = path.basename(file);

  if (base === 'SKILL.md') {
    return true;
  }

  if (rel === 'AGENTS.md' || rel === '.agents/AGENTS.md') {
    return true;
  }

  if (base === 'VISION.md' || base === 'CLAUDE.md') {
    return true;
  }

  if (rel === '.github/pull_request_template.md') {
    return true;
  }

  if (rel.startsWith('.agents/rules/') && rel.endsWith('.mdc')) {
    return true;
  }

  if (rel.startsWith('docs/plans/templates/') && rel.endsWith('.md')) {
    return true;
  }

  if (!rel.endsWith('.md')) {
    return false;
  }

  return /(^|\/)(docs|specs|qa)\//.test(rel) &&
    /(agent|runtime|maintainer|triage|review|proof|qa|test|testing|ci|security|vision|skill|workflow|automation)/i.test(
      rel
    );
}

function classifyKind(root, file) {
  const rel = slash(path.relative(root, file));

  if (path.basename(file) === 'SKILL.md') {
    return 'skill';
  }

  if (rel.startsWith('.agents/rules/') && rel.endsWith('.mdc')) {
    return 'rule';
  }

  if (rel.startsWith('docs/plans/templates/') && rel.endsWith('.md')) {
    return 'template';
  }

  if (rel.endsWith('AGENTS.md')) {
    return 'agents-doc';
  }

  if (path.basename(file) === 'VISION.md') {
    return 'vision-doc';
  }

  return 'doc';
}

function assetFromFile(file, root, origin, kind) {
  const rel = slash(path.relative(root, file));
  const text = readFileSync(file, 'utf8');
  const meta = parseMeta(text);
  const name = inferName(file, rel, kind, meta);
  const description = compact(
    meta.description || firstHeading(text) || firstNonEmptyLine(text) || ''
  );
  const tokens = tokenize(`${name} ${description} ${rel}`);

  return {
    origin,
    root,
    repo: path.basename(root),
    kind,
    name,
    rel,
    abs: file,
    description,
    hash: sha(text),
    tokens,
  };
}

function parseMeta(text) {
  const match = /^---\n([\s\S]*?)\n---/.exec(text);

  if (!match) {
    return {};
  }

  const meta = {};

  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);

    if (!pair) {
      continue;
    }

    meta[pair[1]] = pair[2].replace(/^["']|["']$/g, '').trim();
  }

  return meta;
}

function inferName(file, rel, kind, meta) {
  if (meta.name) {
    return meta.name;
  }

  if (kind === 'skill') {
    return path.basename(path.dirname(file));
  }

  if (kind === 'rule') {
    return path.basename(file, '.mdc');
  }

  return rel.replace(/\.(md|mdc)$/i, '');
}

function firstHeading(text) {
  const match = /^#\s+(.+)$/m.exec(text);
  return match ? match[1].trim() : '';
}

function firstNonEmptyLine(text) {
  return (
    text
      .replace(/^---\n[\s\S]*?\n---/, '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith('#')) || ''
  );
}

function buildRows(sources, targets) {
  return sources.map((source) => {
    const exact = targets.find(
      (target) => target.kind === source.kind && target.name === source.name
    );
    const fuzzy = exact || bestFuzzy(source, targets);
    const productScore = score(source, PRODUCT_TOKENS);
    const genericScore = score(source, GENERIC_TOKENS);
    const sameHash = exact && exact.hash === source.hash;
    const rawAction = chooseAction({ exact, fuzzy, genericScore, productScore, sameHash, source });
    const rawReason = chooseReason({ action: rawAction, exact, fuzzy, genericScore, productScore, sameHash });
    const decision = decisions.get(decisionKey(source));
    const action = normalizeDecisionAction(decision?.action) || rawAction;
    const reason = decision
      ? formatDecisionReason(decision, rawReason)
      : rawReason;

    return {
      action,
      rawAction,
      kind: source.kind,
      name: source.name,
      sourceRepo: source.repo,
      sourceRel: source.rel,
      sourcePath: slash(source.abs),
      targetMatch: decision?.owner || (fuzzy ? `${fuzzy.origin}:${fuzzy.rel}` : ''),
      genericScore,
      productScore,
      reason,
      description: source.description,
      decisionKey: decisionKey(source),
      decision: decision || null,
    };
  });
}

function loadDecisions(file) {
  if (!existsSync(file)) {
    return new Map();
  }

  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    const entries = data.decisions || {};

    if (Array.isArray(entries)) {
      return new Map(
        entries
          .filter((entry) => entry.key)
          .map((entry) => [entry.key, entry])
      );
    }

    return new Map(Object.entries(entries));
  } catch (error) {
    fail(`Could not parse decisions file ${file}: ${error.message}`);
  }
}

function decisionKey(asset) {
  return `${asset.repo}:${asset.kind}:${asset.name}:${asset.rel}`;
}

function normalizeDecisionAction(action) {
  if (!action) {
    return '';
  }

  if (['accepted', 'covered', 'quarantine', 'reject'].includes(action)) {
    return action;
  }

  fail(
    `Invalid decision action "${action}". Expected accepted, covered, quarantine, or reject.`
  );
}

function formatDecisionReason(decision, rawReason) {
  const parts = [];

  if (decision.reason) {
    parts.push(decision.reason);
  }

  if (decision.owner) {
    parts.push(`owner: ${decision.owner}`);
  }

  parts.push(`raw: ${rawReason}`);

  return parts.join(' | ');
}

function bestFuzzy(source, targets) {
  let best = null;
  let bestScore = 0;

  for (const target of targets) {
    if (target.kind !== source.kind && !(source.kind === 'doc' && target.kind.endsWith('doc'))) {
      continue;
    }

    const overlap = jaccard(source.tokens, target.tokens);

    if (overlap > bestScore) {
      best = target;
      bestScore = overlap;
    }
  }

  return bestScore >= 0.42 ? best : null;
}

function chooseAction({ exact, fuzzy, genericScore, productScore, sameHash, source }) {
  if (sameHash) {
    return 'reject';
  }

  if (exact || fuzzy) {
    return 'smart-merge';
  }

  if (isClearlyProduct(source) || productScore > genericScore + 1) {
    return 'reject';
  }

  if (genericScore >= 2) {
    return 'new';
  }

  return 'reject';
}

function chooseReason({ action, exact, fuzzy, genericScore, productScore, sameHash }) {
  if (sameHash) {
    return 'already covered by identical local asset';
  }

  if (action === 'smart-merge') {
    return exact
      ? 'same owner exists locally; inspect source for stronger rule or proof gate'
      : 'similar local owner exists; merge invariant, not wording';
  }

  if (action === 'new') {
    return 'generic agent-workflow signal with no local owner';
  }

  if (productScore > genericScore + 1) {
    return 'product-specific OpenClaw plumbing; reject unless a local owner asks for it';
  }

  if (fuzzy) {
    return 'weak similarity only; inspect manually before creating work';
  }

  return 'low reusable-agent signal';
}

function isClearlyProduct(asset) {
  return /(^|[-/])(openclaw|clawhub|crabbox|discord|telegram|feishu|qqbot|gog|lobster|acpx|mcporter)([-/]|$)/i.test(
    `${asset.name}/${asset.rel}`
  );
}

function sortRows(rows) {
  const rank = {
    'smart-merge': 0,
    new: 1,
    quarantine: 2,
    accepted: 3,
    covered: 4,
    reject: 5,
  };

  return rows.sort((a, b) => {
    const rankDiff = (rank[a.action] ?? 99) - (rank[b.action] ?? 99);

    if (rankDiff !== 0) {
      return rankDiff;
    }

    const scoreDiff =
      b.genericScore - b.productScore - (a.genericScore - a.productScore);

    if (scoreDiff !== 0) {
      return scoreDiff;
    }

    return `${a.kind}:${a.name}:${a.sourcePath}`.localeCompare(
      `${b.kind}:${b.name}:${b.sourcePath}`
    );
  });
}

function summarize(rows, repos) {
  const counts = {};

  for (const row of rows) {
    counts[row.action] = (counts[row.action] || 0) + 1;
  }

  return {
    counts,
    repoCount: repos.length,
    repos: repos.map((repo) => slash(repo)),
    rowCount: rows.length,
  };
}

function renderMarkdown(summary, rows, max, roots) {
  const displayed = rows.slice(0, max);
  const counts = Object.entries(summary.counts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([action, count]) => `${action}=${count}`)
    .join(', ');

  return [
    '# OpenClaw Agent Setup Sync Report',
    '',
    `OpenClaw root: \`${slash(roots.openclawRoot)}\``,
    `Target root: \`${slash(roots.targetRoot)}\``,
    `Global skills: \`${slash(roots.globalSkillsRoot)}\``,
    `Decision ledger: \`${slash(roots.decisionsPath)}\``,
    '',
    `Repos scanned: ${summary.repoCount}`,
    `Rows: ${summary.rowCount}`,
    `Counts: ${counts}`,
    '',
    `Showing ${displayed.length} of ${rows.length} rows. Use \`--max\` or the JSON artifact for more.`,
    '',
    '| Action | Raw | Kind | Name | Source | Target match | Reason |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...displayed.map((row) =>
      [
        row.action,
        row.rawAction,
        row.kind,
        code(row.name),
        code(`${row.sourceRepo}:${shortPath(row.sourcePath, roots.openclawRoot)}`),
        row.targetMatch ? code(row.targetMatch) : '',
        escapeCell(row.reason),
      ].join(' | ')
    ).map((line) => `| ${line} |`),
    '',
    'Next step: inspect unresolved `new` and `smart-merge` source files, then patch or record a decision at section level. Do not copy product-specific OpenClaw prose.',
    '',
  ].join('\n');
}

function shortPath(file, root) {
  return slash(path.relative(root, file));
}

function score(asset, needles) {
  const haystack = new Set(asset.tokens);
  let total = 0;

  for (const needle of needles) {
    if (haystack.has(needle)) {
      total += 1;
    }
  }

  return total;
}

function jaccard(a, b) {
  const left = new Set(a);
  const right = new Set(b);
  const intersection = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;

  return union === 0 ? 0 : intersection / union;
}

function tokenize(value) {
  return compact(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function compact(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function sha(text) {
  return createHash('sha256').update(text).digest('hex');
}

function writeFile(file, contents) {
  const resolved = path.resolve(file);
  mkdirSync(path.dirname(resolved), { recursive: true });
  writeFileSync(resolved, contents);
}

function code(value) {
  return `\`${escapeCell(value)}\``;
}

function escapeCell(value) {
  return String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function slash(value) {
  return value.split(path.sep).join('/');
}

function fail(message) {
  console.error(`[openclaw-sync] ${message}`);
  process.exit(1);
}

function printHelp() {
  console.log(`Usage:
  node openclaw-sync-report.mjs [options]

Options:
  --openclaw-root <path>  Local OpenClaw clone folder. Defaults to ../openclaw
  --target <path>         Repo to compare against. Defaults to cwd
  --global-skills <path>  Global skills folder. Defaults to ~/.agents/skills
  --refresh               Run git pull --ff-only in each OpenClaw repo first
  --max <n>               Max rows printed in Markdown. Defaults to 120
  --decisions <path>      Decision ledger. Defaults to docs/sync/openclaw/decisions.json
  --out <path>            Write Markdown report
  --json <path>           Write full JSON report
`);
}
