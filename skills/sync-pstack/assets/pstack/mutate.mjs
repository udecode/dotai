#!/usr/bin/env node
// Installed by the sync-pstack skill.
// Usage: node .agents/pstack/mutate.mjs --dir <run-dir> <spec.json>
// spec: { "commit": "<frozen sha>", "test": ["node", "--test", "a.test.mjs"],
//         "timeout": 900,
//         "mutations": [{ "name": "drop-guard", "file": "src/a.mjs", "from": "<exact text>",
//                         "to": "<replacement>", "expect": "<the named assertion's own message>",
//                         "test": ["<optional per-mutation command>"] }] }
// Shows that each test fails when its fix is reverted. Run it from the
// repository that holds the commit, one run per run directory at a time: it
// makes a fresh worktree at the commit under <run-dir>/mutate/ with git worktree
// add, and removes it after the mutations run, unless the run is killed. Packages
// resolve from that path, so a tree inside a checkout uses that checkout's
// node_modules. A mutated file whose real path lies outside the worktree is
// refused. Each distinct test command first runs on the unmutated files and
// must pass. A mutation runs only when its file is valid UTF-8, its anchor
// matches exactly once and the control run's output does not hold its expected
// text. It then replaces its anchor, runs its test and restores the file, and
// counts as caught when the test exited non-zero, its output holds the expected
// text and the file's bytes came back unchanged. Only the last 16 MB of each
// run's output is searched, and a match proves the text appeared, not which
// assertion printed it, so read the mutant's log. Every test run is logged
// through proof.mjs and stops after the spec's timeout in seconds, 900 by
// default. Exits 0 only when every mutation is caught and the worktree is gone.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { prove } from './proof.mjs';

function problemWith(mutation, control, original) {
  const text = original.toString('utf8');
  const anchors = text.split(mutation.from).length - 1;
  if (!mutation.expect) return 'it names no expected text';
  if (control.output.includes(mutation.expect)) return 'its expected text also appears in the passing control run; name text only the failing assertion prints';
  if (!Buffer.from(text).equals(original)) return `${mutation.file} is not valid UTF-8`;
  if (anchors !== 1) return `its anchor matches ${anchors} times in ${mutation.file}, not once`;
  return null;
}

function check(dir, spec, tree) {
  const timeout = spec.timeout ?? 900;
  const controls = new Map();
  const lines = [];
  let ok = true;
  for (const mutation of spec.mutations) {
    const command = mutation.test ?? spec.test;
    if (!Array.isArray(command) || command.length === 0) {
      lines.push(`${mutation.name}: not run, it names no test command`);
      ok = false;
      continue;
    }
    const key = JSON.stringify(command);
    if (!controls.has(key)) {
      const control = prove({ dir, name: `mutate/control-${controls.size + 1}`, command, cwd: tree, timeout });
      controls.set(key, control);
      lines.push(`control ${command.join(' ')}: exit=${control.exit} log ${control.path}`);
      if (control.exit !== 0) ok = false;
    }
    const control = controls.get(key);
    if (control.exit !== 0) {
      lines.push(`${mutation.name}: not run, its control run failed`);
      continue;
    }
    const path = resolve(tree, mutation.file ?? '');
    if (!existsSync(path) || !realpathSync(path).startsWith(realpathSync(tree) + sep)) {
      lines.push(`${mutation.name}: not run, ${mutation.file} is outside the worktree`);
      ok = false;
      continue;
    }
    const original = readFileSync(path);
    const problem = problemWith(mutation, control, original);
    if (problem) {
      lines.push(`${mutation.name}: not run, ${problem}`);
      ok = false;
      continue;
    }
    let run;
    try {
      writeFileSync(path, original.toString('utf8').replace(mutation.from, () => mutation.to));
      run = prove({ dir, name: `mutate/${mutation.name}`, command, cwd: tree, timeout });
    } finally {
      writeFileSync(path, original);
    }
    const restored = readFileSync(path).equals(original);
    const named = run.exit !== 0 && run.output.includes(mutation.expect);
    const why = run.exit === 0 ? 'survived: the test passed' : named ? 'caught' : 'failed without the expected text';
    lines.push(`${mutation.name}: ${restored ? why : `${why}, and the file was not restored`} (exit=${run.exit}) log ${run.path}`);
    ok &&= named && restored;
  }
  return { lines, ok };
}

const args = process.argv.slice(2);
const dirAt = args.indexOf('--dir');
const dir = dirAt === -1 ? undefined : args[dirAt + 1];
const specPath = args.find((arg, index) => index !== dirAt && index !== dirAt + 1);
if (!dir || !specPath) {
  console.error('Usage: node .agents/pstack/mutate.mjs --dir <run-dir> <spec.json>');
  process.exit(2);
}
const spec = JSON.parse(readFileSync(specPath, 'utf8'));
if (!spec.commit || !(spec.mutations?.length > 0)) {
  console.error('the spec names no commit or lists no mutations');
  process.exit(1);
}
let attempt = 1;
while (existsSync(join(dir, 'mutate', `tree-a${attempt}`))) attempt++;
const tree = resolve(dir, 'mutate', `tree-a${attempt}`);
const removeTree = () => !existsSync(tree) || spawnSync('git', ['worktree', 'remove', '--force', tree]).status === 0;
const made = prove({ dir, name: 'mutate/tree', command: ['git', 'worktree', 'add', '--detach', tree, spec.commit] });
if (made.exit !== 0) {
  console.error(`could not make a worktree at ${spec.commit}; log ${made.path}${removeTree() ? '' : `; remove ${tree} by hand`}`);
  process.exit(1);
}
let result;
let removed = false;
try {
  result = check(dir, spec, tree);
} finally {
  removed = removeTree();
}
console.log([...result.lines, ...(removed ? [] : [`could not remove ${tree}; remove it with git worktree remove --force`])].join('\n'));
process.exit(result.ok && removed ? 0 : 1);
