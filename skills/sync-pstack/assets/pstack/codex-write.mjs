#!/usr/bin/env node
// Usage: node .agents/pstack/codex-write.mjs --dir <run directory> --name <name> --prompt-file <file>
//          [--model <model>] [--effort <level>] [--timeout <seconds>] -- <path>...
// Lets Codex write a mechanical change in a throwaway export of the working tree and
// writes <dir>/<name>-a<N>.patch holding only the named paths, beside its
// <name>-a<N>.events.jsonl. Exits 0 with the patch; 3, with no patch, when Codex changed
// anything outside the named paths or made a deletion, binary, mode, symlink or submodule
// change; 1, with no patch, on any other failure; 2 on bad arguments. The export is removed
// on exit unless the process is killed. Installed by the sync-pstack skill.

import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, createWriteStream, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, readlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PREAMBLE =
  'You are editing a throwaway copy of a repository. Change only the files the task names. No dependencies are installed and nothing can be run or checked here, so do not try to install, build, test or commit. Make the edit exactly as specified and stop.\n\n';

// Git takes its repository, index, object store and config from these, so an inherited
// one could route the export's writes into the source checkout.
const ROUTING = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE', 'GIT_CEILING_DIRECTORIES', 'GIT_DISCOVERY_ACROSS_FILESYSTEM', 'GIT_CONFIG', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT'];
const { CLAUDECODE: _, ...inherited } = process.env;
const env = Object.fromEntries(Object.entries(inherited).filter(([key]) => !ROUTING.includes(key) && !key.startsWith('GIT_CONFIG_KEY_') && !key.startsWith('GIT_CONFIG_VALUE_')));

// Codex can write the export's .git, and git runs commands that repository config names,
// such as core.fsmonitor and core.hooksPath.
const git = (cwd, args, input) =>
  execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'core.pager=cat', '-c', 'core.autocrlf=false', ...args], { cwd, env, input, maxBuffer: 1 << 30 });
// A large repository's archive does not fit in memory, so it pipes straight into tar.
const extract = (root, exportDir) =>
  execFileSync('bash', ['-c', 'set -o pipefail; git -c core.hooksPath=/dev/null archive HEAD | tar -x -C "$1"', 'bash', exportDir], { cwd: root, env, stdio: ['ignore', 'ignore', 'inherit'] });
const lines = (buffer) => buffer.toString().split('\0').filter(Boolean);
const isDir = (path) => existsSync(path) && statSync(path).isDirectory();

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
  if (!dir || !name || !/^[A-Za-z0-9._-]+$/u.test(name) || !promptFile || paths.length === 0 || !(timeout > 0) || ['xhigh', 'max'].includes(effort)) return null;
  return options;
}

function copyEntry(from, to) {
  mkdirSync(dirname(to), { recursive: true });
  rmSync(to, { force: true });
  if (lstatSync(from).isSymbolicLink()) symlinkSync(readlinkSync(from), to);
  else copyFileSync(from, to);
}

function runCodex(cwd, prompt, { model, effort, timeout }, events, owned) {
  const args = ['exec', '--ignore-user-config', '-m', model, '-c', `model_reasoning_effort=${effort}`, '-c', 'approval_policy="never"', '-c', 'sandbox_mode="workspace-write"', '--disable', 'hooks', '--json', '--', PREAMBLE + prompt];
  return new Promise((done) => {
    const log = createWriteStream(events);
    const child = spawn('codex', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let failure;
    let stderr = '';
    const stopGroup = () => {
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
      owned.stop = undefined;
      log.end(() => {
        if (failure) done({ ok: false, why: failure });
        else done(code === 0 ? { ok: true } : { ok: false, why: `codex exited ${code}: ${stderr.trim().split('\n').slice(-5).join('\n')}` });
      });
    });
  });
}

const calledConnectorOrPlugin = (events) => /"type":"(mcp_tool_call|plugin_call)"|"server":"/u.test(existsSync(events) ? readFileSync(events, 'utf8') : '');

async function main(argv) {
  const options = parse(argv);
  if (!options) {
    console.error('Usage: node .agents/pstack/codex-write.mjs --dir <run directory> --name <name> --prompt-file <file> [--model <m>] [--effort <low|medium|high>] [--timeout <s>] -- <path>...');
    return 2;
  }
  const root = realpathSync(git(process.cwd(), ['rev-parse', '--show-toplevel']).toString().trim());
  const paths = options.paths.map((path) => normalize(path));
  const bad = paths.find((path) => isAbsolute(path) || path === '..' || path.startsWith('../') || isDir(join(root, path)));
  if (bad) {
    console.error(`each path must be a repository-relative file, not ${bad}`);
    return 2;
  }
  const dir = resolve(options.dir);
  mkdirSync(dir, { recursive: true });
  const inRepo = relative(root, realpathSync(dir));
  if (!inRepo.startsWith('..') && !isAbsolute(inRepo)) {
    try {
      git(root, ['check-ignore', '-q', '--no-index', inRepo]);
    } catch {
      console.error(`${dir} is inside the repository but not ignored; use the ignored run directory`);
      return 2;
    }
  }
  const exportDir = join(dir, `${options.name}-export`);
  if (existsSync(exportDir)) {
    console.error(`${exportDir} already exists; remove it or pick another --name`);
    return 1;
  }
  const taken = readdirSync(dir).map((file) => (file.startsWith(`${options.name}-a`) ? Number(file.slice(options.name.length + 2).match(/^(\d+)\.patch$/u)?.[1] ?? 0) : 0));
  const attempt = `${options.name}-a${Math.max(0, ...taken) + 1}`;
  const prompt = readFileSync(options.promptFile, 'utf8');
  const owned = {};
  const cleanup = () => {
    owned.stop?.();
    rmSync(exportDir, { recursive: true, force: true, maxRetries: 5 });
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      cleanup();
      process.exit(1);
    });
  }
  mkdirSync(exportDir);
  try {
    extract(root, exportDir);
    for (const file of lines(git(root, ['diff', '--no-ext-diff', 'HEAD', '--no-renames', '--name-only', '-z']))) {
      if (lstatSync(join(root, file), { throwIfNoEntry: false })) copyEntry(join(root, file), join(exportDir, file));
      else rmSync(join(exportDir, file), { force: true });
    }
    for (const file of lines(git(root, ['ls-files', '--others', '--exclude-standard', '-z']))) copyEntry(join(root, file), join(exportDir, file));
    git(exportDir, ['init', '-q']);
    const gitDir = realpathSync(git(exportDir, ['rev-parse', '--absolute-git-dir']).toString().trim());
    const top = realpathSync(git(exportDir, ['rev-parse', '--show-toplevel']).toString().trim());
    if (top !== realpathSync(exportDir) || dirname(gitDir) !== top) {
      console.error(`${exportDir} did not become its own repository; stopping before any git write`);
      return 1;
    }
    const commit = ['-c', 'user.name=pstack', '-c', 'user.email=pstack@local', '-c', 'commit.gpgsign=false'];
    git(exportDir, ['add', '-A', '--force']);
    git(exportDir, [...commit, 'commit', '-q', '--no-verify', '--allow-empty', '-m', 'base']);
    const base = git(exportDir, ['rev-parse', 'HEAD']).toString().trim();
    const configBefore = readFileSync(join(gitDir, 'config'), 'utf8');
    const events = join(dir, `${attempt}.events.jsonl`);
    const result = await runCodex(exportDir, prompt, options, events, owned);
    if (!result.ok) {
      console.error(result.why);
      return 1;
    }
    if (readFileSync(join(gitDir, 'config'), 'utf8') !== configBefore) {
      console.error('Codex changed the export repository config; no patch written');
      return 1;
    }
    if (calledConnectorOrPlugin(events)) {
      console.error(`Codex called a connector or plugin despite running without user config; see ${events}; no patch written`);
      return 1;
    }
    git(exportDir, ['add', '-A', '--force']);
    const raw = lines(git(exportDir, ['diff', '--no-ext-diff', '--cached', '--no-renames', '--raw', '-z', base]));
    const changes = [];
    for (let index = 0; index < raw.length; index += 2) changes.push({ meta: raw[index], path: raw[index + 1] });
    const outside = changes.filter(({ path }) => !paths.includes(normalize(path))).map(({ path }) => path);
    if (outside.length) {
      console.error(`Codex changed paths outside the named ones; no patch written:\n${outside.join('\n')}`);
      return 3;
    }
    const isPlainTextEdit = ({ meta }) => {
      const [oldMode, newMode, , , status] = meta.replace(/^:/u, '').split(' ');
      if (status === 'A') return oldMode === '000000' && newMode === '100644';
      return status === 'M' && oldMode === newMode && (newMode === '100644' || newMode === '100755');
    };
    const unreadable = changes.filter((change) => !isPlainTextEdit(change));
    const binary = lines(git(exportDir, ['diff', '--no-ext-diff', '--cached', '--no-renames', '--numstat', '-z', base])).some((record) => record.startsWith('-\t-\t'));
    if (unreadable.length || binary) {
      console.error(`Codex made a deletion, binary, mode, symlink or submodule change; no patch written:\n${unreadable.map(({ path }) => path).join('\n')}`);
      return 3;
    }
    const patch = git(exportDir, ['--literal-pathspecs', 'diff', '--no-ext-diff', '--cached', '--no-renames', '--binary', base, '--', ...paths]);
    if (!patch.length) {
      console.error('Codex changed none of the named paths; no patch written');
      return 1;
    }
    const out = join(dir, `${attempt}.patch`);
    writeFileSync(`${out}.partial`, patch);
    renameSync(`${out}.partial`, out);
    console.info(`wrote ${out} for ${changes.length} path(s)`);
    return 0;
  } finally {
    cleanup();
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
