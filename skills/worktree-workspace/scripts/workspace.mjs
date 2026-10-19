#!/usr/bin/env node
// Writes a VS Code multi-root workspace with one folder per git worktree of a
// repository, each labeled by the agent session working in it.
//
//   node workspace.mjs [--repo <path>] [--sessions <file>] [--out <file>] [--all] [--open]
//
// --sessions takes a JSON array of sessions, each with cwd and title, and
// optionally isArchived and lastActivityAt. Without it the script reads the
// Claude desktop app's session store, when one exists.
// --all also lists worktrees outside <repo>/.claude/worktrees, such as scratch
// proof worktrees.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const DESKTOP_STORE = join(homedir(), 'Library', 'Application Support', 'Claude', 'claude-code-sessions');

function* storeFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* storeFiles(path);
    else if (/^local_.*\.json$/.test(entry.name)) yield path;
  }
}

export function readDesktopSessions(store = DESKTOP_STORE) {
  if (!existsSync(store)) return [];
  const sessions = [];
  for (const file of storeFiles(store)) {
    const session = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof session.cwd !== 'string') throw new Error(`no cwd in ${file}; the desktop app's session store changed`);
    sessions.push(session);
  }
  return sessions;
}

function real(path) {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function listWorktrees(repo) {
  const worktrees = [];
  let entry = {};
  for (const line of git(repo, 'worktree', 'list', '--porcelain').split('\n')) {
    if (line.startsWith('worktree ')) entry = { path: line.slice(9) };
    else if (line.startsWith('branch ')) entry.branch = line.slice(7).replace(/^refs\/heads\//, '');
    else if (line.startsWith('prunable')) entry.prunable = true;
    else if (line === '' && entry.path) {
      worktrees.push(entry);
      entry = {};
    }
  }
  return worktrees;
}

function lastCommitLabel(path) {
  const id = basename(path).replace(/^(agent-[0-9a-f]{6})[0-9a-f]+$/, '$1');
  const subject = git(path, 'log', '-1', '--format=%s').trim();
  return `${id} — ${subject.length > 60 ? `${subject.slice(0, 59)}…` : subject}`;
}

export function buildWorkspace({ repo, sessions, all = false }) {
  const main = git(resolve(repo), 'rev-parse', '--path-format=absolute', '--git-common-dir').trim().replace(/\/\.git$/, '');
  const agentDir = join(main, '.claude', 'worktrees');

  const latest = new Map();
  for (const session of sessions) {
    const cwd = real(session.cwd);
    const current = latest.get(cwd);
    if (!current || (session.lastActivityAt ?? 0) > (current.lastActivityAt ?? 0)) latest.set(cwd, session);
  }

  const folders = listWorktrees(main)
    .filter((w) => !w.prunable && existsSync(w.path))
    .filter((w) => w.path === main || all || w.path.startsWith(`${agentDir}/`))
    .map((w) => {
      const id = basename(w.path);
      const session = latest.get(real(w.path));
      let label;
      if (w.path === main) label = `${basename(main)} · ${w.branch ?? 'detached'}`;
      else if (session?.title) label = session.isArchived ? `${session.title} (archived)` : session.title;
      else label = lastCommitLabel(w.path);
      return { path: w.path, id, label, main: w.path === main, activity: session?.lastActivityAt ?? 0 };
    })
    .sort((a, b) => Number(b.main) - Number(a.main) || b.activity - a.activity);

  const counts = new Map();
  for (const f of folders) counts.set(f.label, (counts.get(f.label) ?? 0) + 1);
  for (const f of folders) if (counts.get(f.label) > 1 && !f.main) f.label = `${f.label} · ${f.id}`;

  const heavy = { '**/node_modules': true, '**/.next*': true, '**/dist': true, '**/.turbo': true };
  return {
    main,
    workspace: {
      folders: folders.map((f) => ({ name: f.label, path: f.path })),
      settings: {
        'files.watcherExclude': heavy,
        'search.exclude': heavy,
        // Overrides a user-level true, under which every root would list the whole worktree set again.
        'git.detectWorktrees': false,
      },
    },
  };
}

if (process.argv[1] && real(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const value = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const sessionsFile = value('--sessions');
  const sessions = sessionsFile ? JSON.parse(readFileSync(sessionsFile, 'utf8')) : readDesktopSessions();
  const { main, workspace } = buildWorkspace({ repo: value('--repo') ?? '.', sessions, all: argv.includes('--all') });
  const out = resolve(value('--out') ?? join(dirname(main), `${basename(main)}-worktrees.code-workspace`));

  writeFileSync(`${out}.tmp`, `${JSON.stringify(workspace, null, 2)}\n`);
  renameSync(`${out}.tmp`, out);
  for (const folder of workspace.folders) console.log(`${folder.name}\n    ${folder.path}`);
  console.log(`\n${workspace.folders.length} folders → ${out}`);
  if (argv.includes('--open')) execFileSync('code', [out], { stdio: 'inherit' });
}
