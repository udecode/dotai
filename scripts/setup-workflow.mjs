#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const bundle = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const begin = '<!-- BEGIN DOTAI WORKFLOW -->';
const end = '<!-- END DOTAI WORKFLOW -->';

function parse(argv) {
  const args = { scope: 'project', apply: false, verify: false, standingGoals: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help') return { help: true };
    if (arg === '--apply') args.apply = true;
    else if (arg === '--verify') args.verify = true;
    else if (arg === '--standing-goals') args.standingGoals = true;
    else if (['--target', '--scope', '--agent', '--instructions'].includes(arg)) {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      args[arg.slice(2)] = value;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.target || !isAbsolute(args.target)) throw new Error('--target must be an explicit absolute directory');
  if (!['project', 'global'].includes(args.scope)) throw new Error('--scope must be project or global');
  if (!['codex', 'claude-code'].includes(args.agent)) throw new Error('--agent must be codex or claude-code');
  if (args.apply && args.verify) throw new Error('Choose --apply or --verify, not both');
  args.target = resolve(args.target);
  if (!existsSync(args.target) || !statSync(args.target).isDirectory()) throw new Error('Target directory does not exist');
  return args;
}

function assertPlainPath(path) {
  let cursor = resolve(path);
  while (true) {
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) throw new Error(`Symlink destination requires source reconciliation: ${cursor}`);
    // lstat also detects dangling links, which existsSync deliberately follows.
    try {
      if (lstatSync(cursor).isSymbolicLink()) throw new Error(`Symlink destination requires source reconciliation: ${cursor}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
}

function listFiles(root) {
  if (!existsSync(root)) return [];
  assertPlainPath(root);
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symlink is outside bundle copy ownership: ${path}`);
    if (entry.isDirectory()) files.push(...listFiles(path));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`Unsupported file type: ${path}`);
  }
  return files.sort();
}

function safeRelative(value) {
  return typeof value === 'string' && value.length > 0 && !isAbsolute(value) && !value.includes('\\') && value.split('/').every((part) => part && part !== '.' && part !== '..');
}

function readManifest() {
  const manifest = JSON.parse(readFileSync(join(bundle, 'workflow-manifest.json'), 'utf8'));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.skills) || !manifest.skills.length || !manifest.files) throw new Error('Invalid workflow manifest');
  const names = manifest.skills.map((skill) => skill.name);
  if (new Set(names).size !== names.length || names.some((name) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name))) throw new Error('Invalid or duplicate skill names');
  for (const skill of manifest.skills) {
    for (const dep of skill.dependencies || []) if (!names.includes(dep)) throw new Error(`${skill.name}: missing skill dependency ${dep}`);
    if (skill.distribution === 'remote') {
      if (manifest.files[`skills/${skill.name}/SKILL.md`] || !skill.files?.['SKILL.md'] || !/^https:\/\/github.com\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+\/tree\/[a-f0-9]{40}(?:\/[a-zA-Z0-9_-]+)*$/.test(skill.installSource)) throw new Error(`Invalid or duplicated upstream skill: ${skill.name}`);
      for (const [path, digest] of Object.entries(skill.files)) if (!safeRelative(path) || !/^[a-f0-9]{64}$/.test(digest)) throw new Error(`Invalid upstream file: ${skill.name}/${path}`);
    } else if (!manifest.files[`skills/${skill.name}/SKILL.md`]) throw new Error(`Missing entrypoint: ${skill.name}`);
  }
  for (const [path, info] of Object.entries(manifest.files)) {
    if (!safeRelative(path) || !/^[a-f0-9]{64}$/.test(info.sha256) || ![420, 493].includes(info.mode)) throw new Error(`Invalid manifest entry: ${path}`);
    const source = join(bundle, path);
    assertPlainPath(source);
    if (hash(readFileSync(source)) !== info.sha256) throw new Error(`Bundle integrity mismatch: ${path}. Rebuild the reviewed manifest before installation.`);
  }
  const skillFiles = listFiles(join(bundle, 'skills')).map((path) => relative(bundle, path).split(sep).join('/'));
  const declared = Object.keys(manifest.files).filter((path) => path.startsWith('skills/')).sort();
  if (JSON.stringify(skillFiles.sort()) !== JSON.stringify(declared)) throw new Error('Manifest does not cover the exact complete skill tree');
  return manifest;
}

function upstreamStatus(skill, skillsRoot, previous, args, cliVersion) {
  const directory = join(skillsRoot, skill.name);
  const actualRoot = existsSync(directory) ? realpathSync(directory) : directory;
  const actual = Object.fromEntries(listFiles(actualRoot).map((path) => [relative(actualRoot, path).split(sep).join('/'), hash(readFileSync(path))]));
  const matching = Object.keys(actual).length === Object.keys(skill.files).length && Object.entries(skill.files).every(([path, digest]) => actual[path] === digest);
  const previouslyBundled = Object.keys(previous?.files || {}).some((path) => path.startsWith(`${skill.name}/`));
  const safeMigration = previouslyBundled && Object.entries(actual).every(([path, digest]) => previous.files[`${skill.name}/${path}`]?.sha256 === digest);
  const status = previouslyBundled ? safeMigration ? 'migrate-to-upstream' : 'conflict' : matching ? 'installed' : Object.keys(actual).length ? 'conflict' : 'missing';
  const command = ['npx', '--yes', `skills@${cliVersion}`, 'add', skill.installSource, '--skill', skill.name, '--agent', args.agent, '-y', ...(args.scope === 'global' ? ['--global'] : [])];
  return { name: skill.name, status, directory, command: status === 'installed' ? null : command.join(' '), cwd: args.target };
}

function instructionPath(args) {
  if (args.instructions) {
    if (!isAbsolute(args.instructions)) throw new Error('--instructions must be an absolute owned source path');
    return resolve(args.instructions);
  }
  if (args.agent === 'claude-code') return join(args.target, ...(args.scope === 'global' ? ['.claude', 'CLAUDE.md'] : ['CLAUDE.md']));
  const root = args.scope === 'global' ? resolve(process.env.CODEX_HOME || join(args.target, '.codex')) : args.target;
  const override = join(root, 'AGENTS.override.md');
  return existsSync(override) && readFileSync(override, 'utf8').trim() ? override : join(root, 'AGENTS.md');
}

function routing(skillsRoot, standingGoals) {
  return `${begin}
Use the generic dotai workflow skills for matching requests. Read the runtime adapter at ${join(skillsRoot, 'setup-workflow/references/runtime.md')} when applying a preserved vendor method. Current user/runtime/project instructions take precedence over examples.

- Task owns engineering work from source and acceptance through implementation, honest proof and authorized delivery. A short question or edit stays short; do not load the whole skill catalog.
- Keep one plan for sustained work. Preserve every source-linked acceptance item, human assignment, decision, evidence gap and next step across interruptions. Finish authorized scope without repeated confirmation.
- ${standingGoals ? 'The user requests native goals for long-running work when supported, unless they opt out. Use Autogoal with the existing plan. If native goals are unavailable, retain the same work in a file plan and state the capability limit.' : 'Use Autogoal/native goals only for a direct or applicable standing user request. Otherwise use a file plan when continuity is needed.'}
- A direct pause immediately persists Status: Paused and the saved next step, then stops. Automatic continuation does not resume paused work.
- Use current source evidence and complete affected callers. Diagnose the real reported failure before fixing its owner; preserve the baseline and compare reportedly working references.
- Prefer deletion, reuse and clear ownership. Do not add speculative abstractions, compatibility layers, caches or dependencies.
- Use existing focused proof first. Add a test only for a named costly regression not adequately covered by existing checks or direct proof, or when the user explicitly requests tests. Avoid source-text tests and implementation mirrors.
- Verify App owns real operation, artifact and environment evidence. Keep local edits, passing checks, commit/push, deployment and received delivery distinct. Never claim a missing check passed.
- Autoreview runs on explicit request or one actual PR closeout, with bounded correction rounds. Missing independent tools are reported honestly.
- Use Maintain Workflow for reusable instruction/helper changes and Sync Skills for source-aware updates. Preserve project-owned templates and generated-source ownership; never overwrite a local adaptation during installation.
- Read an existing .agents/workflow.md in the active project for its commands, proof surfaces and delivery policy. Discover facts from that project; do not infer another project's paths, services or branch names.
- Scope does not grant publication, external messages, scheduled jobs, model changes, security-setting changes or new checkouts. Use only available tools under current authority.
${end}`;
}

function extractBlock(text) {
  const first = text.indexOf(begin);
  const last = text.indexOf(end);
  if (first === -1 && last === -1) return null;
  if (first === -1 || last < first || text.indexOf(begin, first + begin.length) !== -1 || text.indexOf(end, last + end.length) !== -1) throw new Error('Malformed or duplicate dotai routing block; reconcile the instruction source first');
  return { text: text.slice(first, last + end.length), start: first, end: last + end.length };
}

function adapter(target) {
  const manifestPath = join(target, 'package.json');
  let facts = 'No package.json found at this project root. Inspect its actual build/runtime owners when work requires them.';
  if (existsSync(manifestPath)) {
    const pkg = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const manager = pkg.packageManager?.split('@')[0] || (existsSync(join(target, 'bun.lock')) || existsSync(join(target, 'bun.lockb')) ? 'bun' : existsSync(join(target, 'pnpm-lock.yaml')) ? 'pnpm' : existsSync(join(target, 'yarn.lock')) ? 'yarn' : 'npm');
    facts = `Observed package manager: ${manager}.\nAvailable package script names: ${Object.keys(pkg.scripts || {}).join(', ') || 'none'}.\nThese names were read from package.json; no command was executed.`;
  }
  return `# Project workflow adaptation

This file is project-owned. Setup seeds it only when missing; updates preserve edits. Current user and existing project instructions remain authoritative.

## Observed project facts

${facts}

## Complete from this project's sources

- Authored source and generated-file owners: inspect the actual project.
- Relevant start/check/build/proof commands: use observed project commands, not guessed defaults.
- Runtime, authentication, sanctioned fixtures and existing verification/catalog owners: discover when applicable; never copy credentials here.
- Plans, product decisions and source authority: use the existing document owners.
- Git, tracker, deployment targets and status semantics: follow explicit project/user policy; installation grants no publication authority.
- Model-role configuration and external capabilities: use available tools and inherit the model unless explicitly configured.

Do not create empty infrastructure or run every command to fill this file. Mark an absent surface not applicable, and a necessary unknown as an exact missing fact.
`;
}

function main() {
  const args = parse(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/setup-workflow.mjs --target <absolute-directory> --scope project|global --agent codex|claude-code [--instructions <absolute-owned-file>] [--standing-goals] [--apply | --verify]\nDefault: dry-run. No network, dependency installation, model/permission changes or publication.');
    return;
  }
  const manifest = readManifest();
  const bundledSkills = manifest.skills.filter((skill) => skill.distribution !== 'remote');
  const skillsRoot = join(args.target, args.agent === 'codex' ? '.agents' : '.claude', 'skills');
  const statePath = join(args.target, '.agents', `dotai-${args.scope}-install-${args.agent}.json`);
  const instructions = instructionPath(args);
  for (const path of [skillsRoot, statePath, instructions]) assertPlainPath(path);
  const previous = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : null;
  if (previous && (previous.schemaVersion !== 1 || previous.target !== args.target || previous.scope !== args.scope || previous.agent !== args.agent || !previous.files || previous.instructions.path !== instructions)) throw new Error('Installation record does not match the selected destination/instruction owner');
  const desired = new Map();
  for (const [path, info] of Object.entries(manifest.files)) {
    if (!path.startsWith('skills/')) continue;
    const rel = path.slice('skills/'.length);
    desired.set(rel, { ...info, source: join(bundle, path), target: join(skillsRoot, rel) });
  }
  const operations = [];
  const conflicts = [];
  const upstream = manifest.skills.filter((skill) => skill.distribution === 'remote').map((skill) => upstreamStatus(skill, skillsRoot, previous, args, manifest.skillsCliVersion));
  conflicts.push(...upstream.filter((skill) => skill.status === 'conflict').map((skill) => `${skill.directory} (existing upstream skill differs; reconcile before npx skills add)`));
  for (const [rel, item] of desired) {
    assertPlainPath(item.target);
    const current = existsSync(item.target) ? hash(readFileSync(item.target)) : null;
    if (current === item.sha256 && (statSync(item.target).mode & 0o777) === item.mode) continue;
    if (current !== null && current !== previous?.files[rel]?.sha256 && current !== item.sha256) conflicts.push(item.target);
    else operations.push({ kind: 'write', ...item, bytes: readFileSync(item.source) });
  }
  for (const [rel, old] of Object.entries(previous?.files || {})) {
    if (!safeRelative(rel) || !/^[a-f0-9]{64}$/.test(old.sha256)) throw new Error('Invalid installed file record');
    if (desired.has(rel)) continue;
    const target = join(skillsRoot, rel);
    assertPlainPath(target);
    if (!existsSync(target)) continue;
    if (hash(readFileSync(target)) !== old.sha256) conflicts.push(target);
    else operations.push({ kind: 'remove', target });
  }
  for (const skill of bundledSkills) {
    for (const file of listFiles(join(skillsRoot, skill.name))) {
      const rel = relative(skillsRoot, file).split(sep).join('/');
      if (!desired.has(rel) && !previous?.files[rel]) conflicts.push(file);
    }
  }
  const currentInstructions = existsSync(instructions) ? readFileSync(instructions, 'utf8') : '';
  if (/generated by|automatically generated|<!--\s*generated/i.test(currentInstructions) && !args.instructions) throw new Error(`Generated instruction surface: ${instructions}. Select its real owned source with --instructions, then regenerate using the project's generator.`);
  const currentBlock = extractBlock(currentInstructions);
  const standingGoals = args.standingGoals || previous?.standingGoals || false;
  const nextBlock = routing(skillsRoot, standingGoals);
  if (currentBlock && currentBlock.text !== nextBlock && hash(currentBlock.text) !== previous?.instructions.blockHash) conflicts.push(`${instructions} (edited routing block)`);
  if (!currentBlock && previous) conflicts.push(`${instructions} (managed routing was removed)`);
  if (currentBlock?.text !== nextBlock) {
    const text = currentBlock ? currentInstructions.slice(0, currentBlock.start) + nextBlock + currentInstructions.slice(currentBlock.end) : currentInstructions + (currentInstructions.endsWith('\n') || !currentInstructions ? '' : '\n') + '\n' + nextBlock + '\n';
    operations.push({ kind: 'write', target: instructions, bytes: Buffer.from(text), mode: existsSync(instructions) ? statSync(instructions).mode & 0o777 : 0o644 });
  }
  const adapterPath = join(args.target, '.agents', 'workflow.md');
  if (args.scope === 'project') {
    assertPlainPath(adapterPath);
    if (!existsSync(adapterPath)) operations.push({ kind: 'write', target: adapterPath, bytes: Buffer.from(adapter(args.target)), mode: 0o644 });
  }
  const nextState = {
    schemaVersion: 1, source: manifest.source, manifestHash: hash(readFileSync(join(bundle, 'workflow-manifest.json'))),
    target: args.target, scope: args.scope, agent: args.agent, standingGoals,
    skills: bundledSkills.map((skill) => skill.name),
    remoteSkills: upstream.map((skill) => skill.name),
    files: Object.fromEntries([...desired].map(([rel, item]) => [rel, { sha256: item.sha256, mode: item.mode }])),
    instructions: { path: instructions, blockHash: hash(nextBlock) },
  };
  const stateBytes = Buffer.from(JSON.stringify(nextState, null, 2) + '\n');
  if (!existsSync(statePath) || !readFileSync(statePath).equals(stateBytes)) operations.push({ kind: 'write', target: statePath, bytes: stateBytes, mode: 0o644 });
  console.log(JSON.stringify({ mode: args.verify ? 'verify' : args.apply ? 'apply' : 'dry-run', target: args.target, scope: args.scope, agent: args.agent, skills: manifest.skills.length, bundledSkills: bundledSkills.length, upstream, files: desired.size, instructions, changes: operations.length, conflicts: [...new Set(conflicts)], capabilityChecks: 'Filesystem only; native goals, browser, review, provider access and runtime discovery require the active agent.' }, null, 2));
  if (conflicts.length) throw new Error('No files changed. Reconcile the listed local modifications with sync-skills before retrying.');
  if (args.verify) {
    if (operations.length) throw new Error('Installation is missing, changed or from another bundle; preview/reconcile before applying');
    if (upstream.some((skill) => skill.status !== 'installed')) throw new Error('Complete setup is pending. Run the printed named npx skills add commands, then rerun --verify. Do not copy or vendor unchanged upstream skills.');
    console.log(`Verified ${manifest.skills.length}/${manifest.skills.length} skills, complete file hashes, modes and routing. Project adapter content remains user-owned.`);
    return;
  }
  if (!args.apply) return;
  const backups = [];
  try {
    for (const operation of operations) {
      assertPlainPath(operation.target);
      backups.push({ target: operation.target, bytes: existsSync(operation.target) ? readFileSync(operation.target) : null, mode: existsSync(operation.target) ? statSync(operation.target).mode & 0o777 : 0o644 });
      if (operation.kind === 'remove') rmSync(operation.target);
      else {
        mkdirSync(dirname(operation.target), { recursive: true });
        const temporary = `${operation.target}.dotai-${process.pid}.tmp`;
        try {
          writeFileSync(temporary, operation.bytes, { flag: 'wx', mode: operation.mode });
          chmodSync(temporary, operation.mode);
          renameSync(temporary, operation.target);
        } finally {
          if (existsSync(temporary)) rmSync(temporary);
        }
      }
    }
    for (const item of desired.values()) if (hash(readFileSync(item.target)) !== item.sha256 || (statSync(item.target).mode & 0o777) !== item.mode) throw new Error(`Read-back failed: ${item.target}`);
    if (extractBlock(readFileSync(instructions, 'utf8'))?.text !== nextBlock || !readFileSync(statePath).equals(stateBytes)) throw new Error('Instruction/state read-back failed');
  } catch (error) {
    const rollbackErrors = [];
    for (const saved of backups.reverse()) {
      try {
        if (saved.bytes === null) rmSync(saved.target, { force: true });
        else { writeFileSync(saved.target, saved.bytes); chmodSync(saved.target, saved.mode); }
      } catch (rollbackError) { rollbackErrors.push(`${saved.target}: ${rollbackError.message}`); }
    }
    if (rollbackErrors.length) throw new Error(`${error.message}\nRollback needs attention:\n${rollbackErrors.join('\n')}`);
    throw new Error(`${error.message}\nWritten files rolled back; newly created empty directories may remain.`);
  }
  console.log(`Installed and read back ${bundledSkills.length} bundled skills. ${upstream.filter((skill) => skill.status !== 'installed').length} upstream skills still need the printed npx skills add commands. Finish those, then run --verify for all ${manifest.skills.length} skills and confirm native discovery/project adaptation.`);
}

try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
