#!/usr/bin/env node
// Prints the skill test files that the working tree's changes can affect, one path per line,
// for scripts/validate-skills. With --all it prints every test file.
//
// A test file runs when it changed, when it names a changed file, or when it names a script
// that reaches one. A script reaches each script it names in a path string, such as an import
// or join(HERE, 'land.mjs'), and what that one reaches. A changed template, any other file under
// a skill's assets folder, reaches the scripts that name that folder and render from it; test
// support in test-*.mjs never counts as one. Within a skill a file names another by basename,
// which holds whether a test imports a helper, spawns it or runs an installed copy; across
// skills it names the path from the skills folder, such as sync-pstack/assets/pstack/lead.mjs.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SKILLS = join(ROOT, 'skills');
// A change to the selector or the gate itself could hide a failure, so it runs everything.
const RUN_ALL = new Set(['scripts/affected-tests.mjs', 'scripts/validate-skills']);
const SCRIPT = /\.(?:mjs|cjs|js|sh|py)$/u;
const TEST = /\.test\.mjs$/u;
// Test support, such as a shared sandbox, lives in test-*.mjs and never renders a template.
const SUPPORT = /(?:^|\/)test-[\w-]+\.mjs$/u;

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

const files = walk(SKILLS).map((path) => {
  const rel = relative(SKILLS, path);
  const skill = rel.split('/')[0];
  return { rel, skill, test: TEST.test(rel) && dirname(rel) === `${skill}/scripts`, script: SCRIPT.test(rel), text: readFileSync(path, 'utf8') };
});
const tests = files.filter((file) => file.test);

if (process.argv.includes('--all')) {
  for (const file of tests) console.log(`skills/${file.rel}`);
  process.exit(0);
}

function changedPaths() {
  const status = spawnSync('git', ['-C', ROOT, 'status', '--porcelain=v1', '-z', '--untracked-files=all'], { encoding: 'utf8' });
  if (status.status !== 0) throw new Error(`git status failed: ${status.stderr.trim()}`);
  const fields = status.stdout.split('\0').filter(Boolean);
  const paths = [];
  for (let index = 0; index < fields.length; index++) {
    paths.push(fields[index].slice(3));
    // A rename or copy entry is followed by its source path.
    if (/^[RC]/u.test(fields[index])) paths.push(fields[++index]);
  }
  return paths;
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const mention = (name) => new RegExp(`(?<![\\w.-])${escape(name)}(?![\\w-])`, 'u');
// A script reaches another through a string that is a path to it, such as an import specifier or
// join(HERE, 'land.mjs'), not through prose that mentions it in a message.
const pathLiteral = (name) => new RegExp(`['"\`](?:[\\w.@\${}-]*/)*${escape(name)}['"\`]`, 'u');
// Whether `file`'s text names the skill file at `rel`: a test by any mention, a script by a path.
function names(file, rel) {
  const own = file.skill === rel.split('/')[0];
  const pattern = file.test ? mention : pathLiteral;
  return (own && pattern(basename(rel)).test(file.text)) || pattern(rel).test(file.text);
}
const readsAssets = (file) => /['"`/]assets['"`/]/u.test(file.text);

// --path <path> stands in for the working tree's changes, to see what one edit would run.
const given = process.argv.flatMap((arg, index, argv) => (argv[index - 1] === '--path' ? [arg] : []));
const changed = given.length > 0 ? given : changedPaths();
if (changed.some((path) => RUN_ALL.has(path))) {
  for (const file of tests) console.log(`skills/${file.rel}`);
  process.exit(0);
}

// Each selected test maps to the chain of files that reached it, which --why prints.
const selected = new Map();
for (const path of changed) {
  if (!path.startsWith('skills/')) continue;
  const rel = path.slice('skills/'.length);
  const skill = rel.split('/')[0];
  if (tests.some((file) => file.rel === rel)) {
    selected.set(rel, [rel]);
    continue;
  }
  const via = new Map([[rel, null]]);
  // Only a script passes a change on to the scripts that name it; a template reaches the scripts
  // that render its folder.
  const queue = SCRIPT.test(rel) ? [rel] : [];
  if (!SCRIPT.test(rel) && rel.startsWith(`${skill}/assets/`)) {
    for (const file of files) {
      if (file.skill !== skill || !file.script || file.test || SUPPORT.test(file.rel) || !readsAssets(file)) continue;
      via.set(file.rel, rel);
      queue.push(file.rel);
    }
  }
  while (queue.length > 0) {
    const target = queue.shift();
    for (const file of files) {
      if (!file.script || file.test || via.has(file.rel) || !names(file, target)) continue;
      via.set(file.rel, target);
      queue.push(file.rel);
    }
  }
  const chain = (target) => (target === null ? [] : [...chain(via.get(target)), target]);
  for (const file of tests) {
    if (selected.has(file.rel)) continue;
    const target = [...via.keys()].find((name) => names(file, name));
    if (target) selected.set(file.rel, chain(target));
  }
}
const why = process.argv.includes('--why');
for (const [rel, chain] of [...selected].sort(([a], [b]) => a.localeCompare(b))) console.log(why ? `skills/${rel} <- ${chain.reverse().join(' <- ')}` : `skills/${rel}`);
