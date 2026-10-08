#!/usr/bin/env node
// Usage: node .agents/pstack/codex-write.mjs --dir <run directory> --name <name> --prompt-file <file>
//          [--model <model>] [--effort <level>] [--timeout <seconds>] -- <path>...
// Lets Codex write a mechanical change in a throwaway copy of the working tree and writes
// <dir>/<name>-a<N>.patch holding only the named paths, beside <name>-a<N>.events.jsonl.
// Exits 0 with the patch; 3, with no patch, when Codex changed anything outside the named
// paths, deleted a file, changed a mode or wrote anything that is not UTF-8 text; 1, with no
// patch, on any other failure; 2 on bad arguments. The copy is removed on exit unless the
// process is killed. Installed by the sync-pstack skill.

import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, createWriteStream, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ISOLATED_CODEX_ARGS, managedCodexConfig } from './codex-isolation.mjs';

const PREAMBLE =
  'You are editing a throwaway copy of a repository. Change only the files the task names. No dependencies are installed and nothing can be run or checked here, so do not try to install, build, test or commit. Make the edit exactly as specified and stop.\n\n';

// Git takes its repository, index, object store and config from these, so an inherited
// one could route a write into the source checkout.
const ROUTING = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE', 'GIT_CEILING_DIRECTORIES', 'GIT_DISCOVERY_ACROSS_FILESYSTEM', 'GIT_CONFIG', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_CONFIG_NOSYSTEM', 'GIT_TEMPLATE_DIR', 'GIT_REPLACE_REF_BASE'];
const { CLAUDECODE: _, ...inherited } = process.env;
const baseEnv = Object.fromEntries(Object.entries(inherited).filter(([key]) => !ROUTING.includes(key) && !key.startsWith('GIT_CONFIG_KEY_') && !key.startsWith('GIT_CONFIG_VALUE_')));

const sourceGit = (cwd, args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args], { cwd, env: baseEnv, maxBuffer: 1 << 30 });

const patchEnv = { ...baseEnv, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TEMPLATE_DIR: '', GIT_NO_REPLACE_OBJECTS: '1' };
const patchGit = (cwd, args) => execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.attributesFile=/dev/null', ...args], { cwd, env: patchEnv, maxBuffer: 1 << 30 });

const lines = (buffer) => buffer.toString().split('\0').filter(Boolean);
const isDir = (path) => existsSync(path) && statSync(path).isDirectory();
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function parse(argv) {
  const options = { model: 'gpt-6.1-sol', effort: 'high', timeout: 1800, paths: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      options.paths = argv.slice(index + 1);
      break;
    }
    const value = argv[++index];
    if (arg === '--dir') options.dir = value;
    else if (arg === '--name') options.name = value;
    else if (arg === '--prompt-file') options.promptFile = value;
    else if (arg === '--model') options.model = value;
    else if (arg === '--effort') options.effort = value;
    else if (arg === '--timeout') options.timeout = Number(value);
    else return null;
  }
  const { dir, name, promptFile, paths, timeout, effort } = options;
  if (!dir || !name || !/^[A-Za-z0-9._-]+$/u.test(name) || !promptFile || paths.length === 0 || !(timeout > 0) || !['low', 'medium', 'high'].includes(effort)) return null;
  return options;
}

function manifest(root, skip) {
  const entries = new Map();
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const key = relative(root, path).split(sep).join('/');
      if (skip.has(key)) continue;
      const stat = lstatSync(path);
      if (stat.isDirectory()) walk(path);
      else entries.set(key, { kind: stat.isSymbolicLink() ? 'link' : stat.isFile() ? 'file' : 'other', mode: stat.mode & 0o777, hash: stat.isFile() ? sha256(readFileSync(path)) : '' });
    }
  };
  walk(root);
  return entries;
}

function commitStartingBytes(repo, exportDir, paths) {
  mkdirSync(repo);
  patchGit(repo, ['init', '-q']);
  for (const key of paths.filter((path) => existsSync(join(exportDir, path)))) {
    mkdirSync(dirname(join(repo, key)), { recursive: true });
    copyFileSync(join(exportDir, key), join(repo, key));
  }
  patchGit(repo, ['add', '-A']);
  patchGit(repo, ['-c', 'user.name=pstack', '-c', 'user.email=pstack@local', '-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '--allow-empty', '-m', 'base']);
}

const isText = (bytes) => !bytes.includes(0) && Buffer.from(bytes.toString('utf8'), 'utf8').equals(bytes);

function runCodex(cwd, scratch, prompt, { model, effort, timeout }, events, owned) {
  const args = [
    'exec',
    ...ISOLATED_CODEX_ARGS,
    '--skip-git-repo-check',
    '-m',
    model,
    '-c',
    `model_reasoning_effort=${effort}`,
    '-c',
    'approval_policy="never"',
    '-c',
    'sandbox_mode="workspace-write"',
    '-c',
    'sandbox_workspace_write.writable_roots=[]',
    '-c',
    'sandbox_workspace_write.exclude_slash_tmp=true',
    '-c',
    'sandbox_workspace_write.exclude_tmpdir_env_var=true',
    '--disable',
    'hooks',
    '--json',
    '--',
    PREAMBLE + prompt,
  ];
  const env = { ...baseEnv, TMPDIR: scratch };
  return new Promise((done) => {
    const log = createWriteStream(events, { flags: 'wx' });
    const child = spawn('codex', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let failure;
    let stderr = '';
    const stopGroup = () => {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    };
    owned.stop = stopGroup;
    const timer = setTimeout(() => {
      failure = `no result within ${timeout} seconds`;
      stopGroup();
    }, timeout * 1000);
    log.on('error', (error) => {
      failure = `cannot write ${events}: ${error.message}`;
      stopGroup();
    });
    child.stdout.pipe(log);
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', (error) => {
      failure = error.message;
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      stopGroup();
      log.end(() => {
        if (failure) done({ ok: false, why: failure });
        else done(code === 0 ? { ok: true } : { ok: false, why: `codex exited ${code}: ${stderr.trim().split('\n').slice(-5).join('\n')}` });
      });
    });
  });
}

const calledConnectorOrPlugin = (events) => /"type":"(mcp_tool_call|plugin_call)"|"server":"/u.test(existsSync(events) ? readFileSync(events, 'utf8') : '');

function nextAttempt(dir, name) {
  const used = readdirSync(dir).map((file) => (file.startsWith(`${name}-a`) ? Number(file.slice(name.length + 2).match(/^(\d+)\./u)?.[1] ?? 0) : 0));
  return `${name}-a${Math.max(0, ...used) + 1}`;
}

async function main(argv) {
  const options = parse(argv);
  if (!options) {
    console.error('Usage: node .agents/pstack/codex-write.mjs --dir <run directory> --name <name> --prompt-file <file> [--model <m>] [--effort <low|medium|high>] [--timeout <s>] -- <path>...');
    return 2;
  }
  const root = realpathSync(sourceGit(process.cwd(), ['rev-parse', '--show-toplevel']).toString().trim());
  const paths = options.paths.map((path) => normalize(path).split(sep).join('/'));
  const bad = paths.find((path) => isAbsolute(path) || path === '..' || path.startsWith('../') || path === '.codex' || path.startsWith('.codex/') || isDir(join(root, path)));
  if (bad) {
    console.error(`each path must be a repository-relative file outside .codex/, not ${bad}`);
    return 2;
  }
  const dir = resolve(options.dir);
  const inRepo = relative(root, dir);
  if (!inRepo.startsWith('..') && !isAbsolute(inRepo)) {
    try {
      sourceGit(root, ['check-ignore', '-q', '--no-index', `${inRepo}/`]);
    } catch {
      console.error(`${dir} is inside the repository but not ignored; use the ignored run directory`);
      return 2;
    }
  }
  const managed = managedCodexConfig();
  if (managed) {
    console.error(`${managed} would still load under --ignore-user-config; refusing to run`);
    return 1;
  }
  mkdirSync(dir, { recursive: true });
  const attempt = nextAttempt(dir, options.name);
  const prompt = readFileSync(options.promptFile, 'utf8');
  // Outside every repository, so Codex finds no ancestor .codex/ config or git root.
  const work = mkdtempSync(join(realpathSync(tmpdir()), 'pstack-codex-write-'));
  const exportDir = join(work, 'export');
  const patchRepo = join(work, 'patch');
  const owned = {};
  const cleanup = () => {
    owned.stop?.();
    rmSync(work, { recursive: true, force: true, maxRetries: 5 });
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      cleanup();
      process.exit(1);
    });
  }
  try {
    mkdirSync(exportDir);
    const files = new Set([...lines(sourceGit(root, ['ls-files', '-z'])), ...lines(sourceGit(root, ['ls-files', '--others', '--exclude-standard', '-z']))]);
    for (const file of files) {
      if (file === '.codex' || file.startsWith('.codex/')) continue;
      const from = join(root, file);
      const stat = lstatSync(from, { throwIfNoEntry: false });
      if (!stat?.isFile()) continue;
      mkdirSync(dirname(join(exportDir, file)), { recursive: true });
      copyFileSync(from, join(exportDir, file));
    }
    commitStartingBytes(patchRepo, exportDir, paths);
    const scratch = mkdtempSync(join(exportDir, '.tmp-'));
    const skip = new Set([relative(exportDir, scratch)]);
    const before = manifest(exportDir, skip);
    const events = join(dir, `${attempt}.events.jsonl`);
    const result = await runCodex(exportDir, scratch, prompt, options, events, owned);
    if (!result.ok) {
      console.error(result.why);
      return 1;
    }
    if (calledConnectorOrPlugin(events)) {
      console.error(`Codex called a connector or plugin; see ${events}; no patch written`);
      return 1;
    }
    const after = manifest(exportDir, skip);
    const changed = [...new Set([...before.keys(), ...after.keys()])].filter((key) => JSON.stringify(before.get(key)) !== JSON.stringify(after.get(key)));
    const outside = changed.filter((key) => !paths.includes(key));
    if (outside.length) {
      console.error(`Codex changed paths outside the named ones; no patch written:\n${outside.join('\n')}`);
      return 3;
    }
    const written = new Map();
    const notText = changed.filter((key) => {
      const old = before.get(key);
      const now = after.get(key);
      if (!now || now.kind !== 'file') return true;
      if (old ? old.kind !== 'file' || old.mode !== now.mode : (now.mode & 0o111) !== 0) return true;
      if (old && !isText(readFileSync(join(patchRepo, key)))) return true;
      const bytes = readFileSync(join(exportDir, key));
      written.set(key, bytes);
      return !isText(bytes);
    });
    if (notText.length) {
      console.error(`Codex deleted a file, changed a mode or wrote something that is not UTF-8 text; no patch written:\n${notText.join('\n')}`);
      return 3;
    }
    if (!changed.length) {
      console.error('Codex changed none of the named paths; no patch written');
      return 1;
    }
    for (const [key, bytes] of written) {
      if (sha256(bytes) !== after.get(key).hash) {
        console.error(`${key} changed after Codex exited; no patch written`);
        return 1;
      }
      mkdirSync(dirname(join(patchRepo, key)), { recursive: true });
      writeFileSync(join(patchRepo, key), bytes);
    }
    patchGit(patchRepo, ['add', '-A']);
    const patch = patchGit(patchRepo, ['diff-index', '-p', '--cached', '--no-renames', '--full-index', 'HEAD', '--']);
    cleanup();
    const out = join(dir, `${attempt}.patch`);
    writeFileSync(`${out}.partial`, patch);
    renameSync(`${out}.partial`, out);
    console.info(`wrote ${out} for ${changed.length} path(s)`);
    return 0;
  } finally {
    cleanup();
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
