import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPLAY = join(dirname(fileURLToPath(import.meta.url)), '../assets/pstack/replay.mjs');
const DAY = 86_400_000;
const ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
  CLAUDECODE: '',
};

const git = (cwd, args, env = {}) => {
  const run = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...ENV, ...env } });
  assert.equal(run.status, 0, `git ${args.join(' ')}: ${run.stderr}`);
  return run.stdout.trim();
};

const FAKE_CLAUDE = `#!/usr/bin/env node
const { appendFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const env = process.env;
const prompt = process.argv.at(-1);
const judging = prompt.startsWith('You judge');
if (env.FAKE_MARKERS && !judging) writeFileSync(join(env.FAKE_MARKERS, 'claude-' + process.pid), '');
if (env.FAKE_ARGS && !judging) writeFileSync(join(env.FAKE_ARGS, 'claude-' + process.pid + '.json'), JSON.stringify(process.argv.slice(2)));
if (judging && env.FAKE_JUDGE_PROMPT) appendFileSync(env.FAKE_JUDGE_PROMPT, prompt + '\\n');
if ((env.FAKE_CLAUDE_SLEEP || (env.FAKE_SLEEP_ON && prompt.includes(env.FAKE_SLEEP_ON))) && !judging) {
  process.on('SIGTERM', () => {});
  setInterval(() => {}, 1000);
} else if (env.FAKE_CLAUDE_GIT && !judging) {
  const { execFileSync } = require('node:child_process');
  const run = (args) => {
    try {
      return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      return null;
    }
  };
  const dirs = process.argv.flatMap((arg, index) => (process.argv[index - 1] === '--add-dir' ? [arg] : []));
  console.log(JSON.stringify({
    commits: run(['rev-list', '--count', 'HEAD']),
    common: run(['rev-parse', '--path-format=absolute', '--git-common-dir']),
    dirs,
    changed: run(['show', '--format=', '--name-only', 'HEAD']).split('\\n'),
    before: run(['show', 'HEAD~1:limit.js']),
    after: run(['show', 'HEAD:limit.js']),
    files: [...run(['ls-tree', '-r', '--name-only', 'HEAD']).split('\\n'), ...run(['ls-tree', '-r', '--name-only', 'HEAD~1']).split('\\n')],
  }));
} else if (!judging) {
  setTimeout(() => console.log(env.FAKE_CLAUDE_SEAT), Number(env.FAKE_CLAUDE_DELAY ?? 0));
} else if (env.FAKE_JUDGE === 'garbage') {
  console.log('Seat a caught it, I think.');
} else {
  const seats = [...prompt.matchAll(/<(?:seat name|answer id)="([^"]+)">\\n([\\s\\S]*?)\\n<\\/(?:seat|answer)>/g)];
  const isCase = prompt.includes('<fix>');
  const verdict = Object.fromEntries(seats.map(([, name, answer]) => {
    const hit = answer.includes('off by one');
    const quote = env.FAKE_JUDGE === 'badquote' ? 'a passage no seat wrote' : answer;
    return [name, isCase ? { caught: hit, quote: hit ? quote : '' } : hit ? [{ finding: answer, real: false, reason: 'the bound is right' }] : []];
  }));
  console.log('Verdict follows.\\n\\n\`\`\`json\\n' + JSON.stringify(verdict) + '\\n\`\`\`');
}
`;

const FAKE_CODEX = `#!/usr/bin/env node
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
const env = process.env;
const args = process.argv.slice(2);
const out = args[args.indexOf('-o') + 1];
const prompt = args.at(-1);
if (env.FAKE_MARKERS) writeFileSync(join(env.FAKE_MARKERS, 'codex-' + process.pid), '');
if (env.FAKE_ARGS) writeFileSync(join(env.FAKE_ARGS, 'codex-' + process.pid + '.json'), JSON.stringify(args));
if (env.FAKE_CODEX_SLEEP) setInterval(() => {}, 1000);
else if (env.FAKE_CODEX_FAIL_ON && prompt.includes(env.FAKE_CODEX_FAIL_ON)) process.exit(1);
else writeFileSync(out, env.FAKE_CODEX_SEAT + '\\n');
`;

function trunkWithFakeRuntimes(config = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sync-pstack-replay-'));
  const remote = join(dir, 'remote.git');
  const clone = join(dir, 'clone');
  const home = join(dir, 'home');
  const bin = join(dir, 'bin');
  const temp = join(dir, 'temp');
  const seen = join(dir, 'seen');
  for (const folder of [home, bin, temp, seen]) mkdirSync(folder);
  git(dir, ['init', '--quiet', '--bare', '--initial-branch=next', remote]);
  git(dir, ['clone', '--quiet', remote, clone]);
  git(clone, ['config', 'pstack.delivery', 'push']);
  writeFileSync(join(bin, 'claude'), FAKE_CLAUDE, { mode: 0o755 });
  writeFileSync(join(bin, 'codex'), FAKE_CODEX, { mode: 0o755 });
  const land = (message, files, daysAgo = 0) => {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(clone, path)), { recursive: true });
      writeFileSync(join(clone, path), text);
    }
    const date = new Date(Date.now() - daysAgo * DAY).toISOString();
    git(clone, ['add', '--all']);
    git(clone, ['commit', '--quiet', '-m', message], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
    git(clone, ['push', '--quiet', 'origin', 'HEAD:next']);
    return git(clone, ['rev-parse', 'HEAD']);
  };
  land('chore: base', { '.agents/pstack.json': JSON.stringify({ branch: 'next', plans: 'docs/plans', ...config }), 'a.js': 'export const a = 1;\n' }, 60);
  const env = { ...ENV, HOME: home, TMPDIR: temp, PATH: `${bin}:${process.env.PATH}` };
  const replay = (args, extra = {}, out = join(dir, 'run')) =>
    spawnSync(process.execPath, [REPLAY, '--dir', out, ...args], { cwd: clone, encoding: 'utf8', env: { ...env, ...extra } });
  const leftovers = () => readdirSync(temp).filter((name) => /^pstack-(replay|cross|reach)-/u.test(name));
  const seenArgs = (runtime) => readdirSync(seen).filter((name) => name.startsWith(`${runtime}-`)).map((name) => JSON.parse(readFileSync(join(seen, name), 'utf8')));
  const packet = (prefix) => join(dir, 'run', readdirSync(join(dir, 'run')).find((name) => name.startsWith(prefix)));
  return { dir, clone, env, bin, temp, seen, run: join(dir, 'run'), land, replay, leftovers, seenArgs, packet };
}

const caseLines = (stdout) => stdout.split('\n').filter((line) => line.startsWith('case '));
const cleanLines = (stdout) => stdout.split('\n').filter((line) => line.startsWith('clean '));
const SEATS = ['--seat', 'a=claude:opus@high', '--seat', 'b=codex:gpt-6.1-sol@high'];
const row = (report, seat) => report.split('\n').find((line) => line.startsWith(`| ${seat} |`))?.split('|').slice(1, -1).map((cell) => cell.trim());

function traced(p, { name = 'limit', trailer = (intro) => `Introduced-by: ${intro}`, extra = {}, fixExtra = {} } = {}) {
  const intro = p.land(`feat(${name}): cap the list\n\nBeyond the ask: none\n\nPlan: docs/plans/2026-01-01-${name}.md`, {
    [`${name}.js`]: 'export const limit = (list, n) => list.slice(0, n + 1); // BUGGY\n',
    [`docs/plans/2026-01-01-${name}.md`]: '# Limit plan\n\nCap the list at n items.\n',
    [`docs/plans/2026-01-01-${name}.decisions.tsv`]: 'panel\tcritical: the slice keeps one item past n\tseat a\tproof: none\tdismissed: rare\n',
    ...extra,
  }, 40);
  const fix = p.land(`fix(${name}): stop one item past the bound\n\nBeyond the ask: none\n\n${trailer(intro)}`, {
    [`${name}.js`]: 'export const limit = (list, n) => list.slice(0, n); // FIXED\n',
    [`docs/plans/2026-01-01-${name}.decisions.tsv`]: 'panel\tcritical: the slice keeps one item past n\tseat a\tproof: none\tdismissed: rare\nfix\tFIX ROW\tescaped\tproof: none\tfixed\n',
    ...fixExtra,
  });
  return { intro, fix };
}

test('replay takes a case from each Introduced-by line of a fix commit, and none from a none line, a non-fix commit or a session revert', () => {
  const p = trunkWithFakeRuntimes();
  const { intro, fix } = traced(p);
  const other = p.land('feat(b): add b\n\nBeyond the ask: none', { 'b.js': 'export const b = 2;\n' }, 35);
  p.land('fix(c): repair c\n\nBeyond the ask: none\n\nIntroduced-by: none', { 'c.js': 'export const c = 3;\n' });
  p.land(`feat(d): add d\n\nBeyond the ask: none\n\nIntroduced-by: ${other}`, { 'd.js': 'export const d = 4;\n' });
  const revert = p.land(`fix(revert): undo session 0f3c9a71\n\nBeyond the ask: none\n\nIntroduced-by: ${other}`, { 'b.js': '' });

  const run = p.replay([...SEATS, '--clean', '0', '--dry-run']);
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(
    caseLines(run.stdout).map((line) => line.split(' ').slice(1, 4).join(' ')),
    [`${intro.slice(0, 10)} -> ${fix.slice(0, 10)}`],
  );
  assert.match(run.stdout, new RegExp(`^skipped: ${revert.slice(0, 10)} reverts a session, which names no single defect$`, 'mu'));
});

test('replay reads an Introduced-by line with more spaces or a tab after the colon, and trailing whitespace, as land.mjs accepts it', () => {
  const p = trunkWithFakeRuntimes();
  const spaced = traced(p, { name: 'spaced', trailer: (intro) => `Introduced-by:  ${intro}  ` });
  const tabbed = traced(p, { name: 'tabbed', trailer: (intro) => `Introduced-by: \t${intro}\t` });
  const run = p.replay([...SEATS, '--clean', '0', '--dry-run']);
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(
    caseLines(run.stdout).map((line) => line.split(' ').slice(1, 4).join(' ')).sort(),
    [spaced, tabbed].map(({ intro, fix }) => `${intro.slice(0, 10)} -> ${fix.slice(0, 10)}`).sort(),
  );
});

test('replay takes the mined cases first and fills the rest from --case pairs', () => {
  const p = trunkWithFakeRuntimes();
  const handIntro = p.land('feat(h): add h\n\nBeyond the ask: none', { 'h.js': 'export const h = 1;\n' }, 50);
  const handFix = p.land('chore(h): touch h\n\nBeyond the ask: none', { 'h.js': 'export const h = 2;\n' }, 45);
  const { intro, fix } = traced(p);
  const run = p.replay([...SEATS, '--case', `${handIntro}:${handFix}`, '--limit', '1', '--clean', '0', '--dry-run']);
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(caseLines(run.stdout).map((line) => line.split(' ').slice(1, 4).join(' ')), [`${intro.slice(0, 10)} -> ${fix.slice(0, 10)}`]);
  assert.match(run.stdout, /^Cases left past --limit: 1\.$/mu);
});

test('replay refuses a --case whose introducing commit is not an ancestor of the fix', () => {
  const p = trunkWithFakeRuntimes();
  const { intro, fix } = traced(p);
  const run = p.replay([...SEATS, '--case', `${fix}:${intro}`, '--dry-run']);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /is not an ancestor of/u);
  assert.equal(existsSync(p.run) && readdirSync(p.run).length > 0, false, 'a refused run writes no packet');
});

test('replay refuses a seat that names no effort, and a --timeout that would not leave the setup and the judge their share of the hour', () => {
  const p = trunkWithFakeRuntimes();
  traced(p);
  const bare = p.replay(['--seat', 'opus=claude:opus', '--dry-run']);
  assert.equal(bare.status, 2);
  assert.match(bare.stderr, /name each seat's effort as the panel runs it, such as opus=claude:opus@xhigh/u);
  const long = p.replay([...SEATS, '--timeout', '2500', '--dry-run']);
  assert.equal(long.status, 2);
  assert.match(long.stderr, /--timeout takes 1 to \d+ seconds/u);
});

test("a case's prompt holds the introducing commit's message, diff and plan, asks for every finding with its severity, and holds neither the fix, the decision log nor a commit sha", () => {
  const p = trunkWithFakeRuntimes();
  const { intro } = traced(p);
  const run = p.replay([...SEATS, '--clean', '0', '--dry-run']);
  assert.equal(run.status, 0, run.stderr);
  const prompt = readFileSync(join(p.packet('case-'), 'prompt.md'), 'utf8');
  assert.match(prompt, /feat\(limit\): cap the list/u);
  assert.match(prompt, /\+export const limit = \(list, n\) => list\.slice\(0, n \+ 1\); \/\/ BUGGY/u);
  assert.match(prompt, /Cap the list at n items\./u, 'the plan its Plan: line names');
  assert.match(prompt, /every finding/u);
  assert.match(prompt, /critical, warning or nit/u);
  assert.doesNotMatch(prompt, /FIXED|stop one item past the bound/u);
  assert.doesNotMatch(prompt, /the slice keeps one item past n|decisions\.tsv/u, "the original panel's rows stay out");
  assert.doesNotMatch(prompt, new RegExp(intro.slice(0, 7), 'u'));
});

test("the prompt leaves out the project's reviewPaths.skip paths, and a diff still over the cut gives every changed path and points at git show HEAD", () => {
  const p = trunkWithFakeRuntimes({ reviewPaths: { skip: ['generated/**'] } });
  traced(p, { extra: { 'generated/big.js': `// GENERATED\n${'x'.repeat(300_000)}\n` } });
  const run = p.replay([...SEATS, '--clean', '0', '--dry-run']);
  assert.equal(run.status, 0, run.stderr);
  const prompt = readFileSync(join(p.packet('case-'), 'prompt.md'), 'utf8');
  assert.doesNotMatch(prompt, /GENERATED/u);
  assert.match(prompt, /BUGGY/u);

  const q = trunkWithFakeRuntimes();
  traced(q, { extra: { 'aa-big.js': `${'export const x = 1;\n'.repeat(15_000)}` } });
  const cut = q.replay([...SEATS, '--clean', '0', '--dry-run']);
  assert.equal(cut.status, 0, cut.stderr);
  const long = readFileSync(join(q.packet('case-'), 'prompt.md'), 'utf8');
  assert.match(long, /^ aa-big\.js +\| /mu);
  assert.match(long, /^ limit\.js +\| /mu);
  assert.match(long, /git show HEAD/u);
});

test('clean commits are first-parent commits older than 30 days that change code and that no Introduced-by line names', () => {
  const p = trunkWithFakeRuntimes();
  const old = p.land('feat(c): add c\n\nBeyond the ask: none', { 'c.js': 'export const c = 3;\n' }, 45);
  const older = p.land('feat(e): add e\n\nBeyond the ask: none', { 'e.js': 'export const e = 5;\n' }, 40);
  const named = p.land('feat(f): add f\n\nBeyond the ask: none', { 'f.js': 'export const f = 6;\n' }, 38);
  p.land('docs(readme): explain\n\nBeyond the ask: none', { 'README.md': '# Readme\n' }, 35);
  p.land('feat(g): add g\n\nBeyond the ask: none', { 'g.js': 'export const g = 7;\n' }, 2);
  p.land(`fix(f): repair f\n\nBeyond the ask: none\n\nIntroduced-by: ${named}`, { 'f.js': 'export const f = 7;\n' });

  const run = p.replay([...SEATS, '--dry-run']);
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(
    cleanLines(run.stdout).map((line) => line.split(' ')[1]),
    [older.slice(0, 10), old.slice(0, 10)],
  );
});

test('clean picks skip fixes and reverts, and count only code outside the plans, the skip paths, TSV and Markdown', () => {
  const p = trunkWithFakeRuntimes({ reviewPaths: { skip: ['generated/**'] } });
  const base = git(p.clone, ['rev-parse', 'HEAD']);
  p.land('fix(x): repair x\n\nBeyond the ask: none\n\nIntroduced-by: none', { 'x.js': 'export const x = 1;\n' }, 50);
  p.land('Revert "feat(y): add y"', { 'y.js': 'export const y = 1;\n' }, 48);
  p.land('chore(log): record\n\nBeyond the ask: none', { 'docs/plans/a.decisions.tsv': 'a\tb\n', 'generated/g.js': 'export const g = 1;\n', 'data/rows.tsv': 'a\tb\n' }, 46);
  const code = p.land('feat(z): add z\n\nBeyond the ask: none', { 'z.js': 'export const z = 1;\n' }, 44);
  traced(p);
  const run = p.replay([...SEATS, '--dry-run']);
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(cleanLines(run.stdout).map((line) => line.split(' ')[1]), [code.slice(0, 10), base.slice(0, 10)]);
});

test('a dry run builds no copy and starts no runtime, and prints the size of each prompt', () => {
  const p = trunkWithFakeRuntimes();
  traced(p);
  p.land('feat(c): add c\n\nBeyond the ask: none', { 'c.js': 'export const c = 3;\n' }, 35);
  chmodSync(p.temp, 0o555);
  try {
    const run = p.replay([...SEATS, '--clean', '1', '--dry-run'], { FAKE_ARGS: p.seen });
    assert.equal(run.status, 0, run.stderr);
    for (const line of [...caseLines(run.stdout), ...cleanLines(run.stdout)]) assert.match(line, /, \d+ characters$/u, line);
    assert.equal(caseLines(run.stdout).length + cleanLines(run.stdout).length, 2);
  } finally {
    chmodSync(p.temp, 0o755);
  }
  assert.deepEqual(readdirSync(p.seen), []);
});

test('replay counts a seat that names the defect as caught and a seat that does not as missed', () => {
  const p = trunkWithFakeRuntimes();
  const { intro } = traced(p);
  const run = p.replay([...SEATS, '--clean', '0'], { FAKE_CLAUDE_SEAT: 'limit.js:1 slices one item past the bound, off by one.', FAKE_CODEX_SEAT: 'No findings.' });
  assert.equal(run.status, 0, run.stderr);
  const report = readFileSync(join(p.run, 'replay.md'), 'utf8');
  assert.equal(run.stdout.trim(), report.trim());
  assert.deepEqual(row(report, 'a').slice(2, 6), ['1 of 1', '0', '0', '0']);
  assert.deepEqual(row(report, 'b').slice(2, 6), ['0 of 1', '0', '0', '0']);
  assert.match(report, new RegExp(`^- ${intro.slice(0, 10)} -> \\S+ .*: a caught, b missed$`, 'mu'));
});

test('the judge reads the seats as cand-1 to cand-n, replay maps them back, and a caught verdict whose quote is not in the answer leaves the seat unjudged', () => {
  const p = trunkWithFakeRuntimes();
  traced(p);
  const judged = join(p.dir, 'judge.txt');
  const run = p.replay([...SEATS, '--clean', '0'], { FAKE_CLAUDE_SEAT: 'limit.js:1 off by one.', FAKE_CODEX_SEAT: 'No findings.', FAKE_JUDGE_PROMPT: judged });
  assert.equal(run.status, 0, run.stderr);
  assert.match(readFileSync(join(p.run, 'replay.md'), 'utf8'), /: a caught, b missed$/mu);
  const prompt = readFileSync(judged, 'utf8');
  assert.match(prompt, /"cand-1"/u);
  assert.match(prompt, /"cand-2"/u);
  assert.doesNotMatch(prompt, /"a"|"b"|opus|gpt-6/u);

  const q = trunkWithFakeRuntimes();
  traced(q);
  const quoted = q.replay([...SEATS, '--clean', '0'], { FAKE_CLAUDE_SEAT: 'limit.js:1 off by one.', FAKE_CODEX_SEAT: 'No findings.', FAKE_JUDGE: 'badquote' });
  assert.equal(quoted.status, 0, quoted.stderr);
  assert.match(readFileSync(join(q.run, 'replay.md'), 'utf8'), /: a unjudged, b missed$/mu);
});

test("the judge's fix block leaves out the plans and the skip paths, and the clean judge is not told that no fix named the commit", () => {
  const p = trunkWithFakeRuntimes({ reviewPaths: { skip: ['generated/**'] } });
  traced(p, { fixExtra: { 'generated/big.js': '// GENERATED\n' } });
  p.land('feat(c): add c\n\nBeyond the ask: none', { 'c.js': 'export const c = 3;\n' }, 35);
  const judged = join(p.dir, 'judge.txt');
  const run = p.replay([...SEATS, '--clean', '1'], { FAKE_CLAUDE_SEAT: 'limit.js:1 off by one.', FAKE_CODEX_SEAT: 'No findings.', FAKE_JUDGE_PROMPT: judged });
  assert.equal(run.status, 0, run.stderr);
  const prompt = readFileSync(judged, 'utf8');
  assert.match(prompt, /FIXED/u);
  assert.doesNotMatch(prompt, /FIX ROW|GENERATED/u);
  assert.doesNotMatch(prompt, /No fix has named/u);
});

test('a judge answer with no parsable JSON block leaves every seat unjudged, never caught', () => {
  const p = trunkWithFakeRuntimes();
  traced(p);
  const run = p.replay([...SEATS, '--clean', '0'], { FAKE_CLAUDE_SEAT: 'limit.js:1 off by one.', FAKE_CODEX_SEAT: 'limit.js:1 off by one.', FAKE_JUDGE: 'garbage' });
  assert.equal(run.status, 0, run.stderr);
  const report = readFileSync(join(p.run, 'replay.md'), 'utf8');
  assert.deepEqual(row(report, 'a').slice(2, 6), ['0 of 0', '0', '1', '0']);
  assert.match(report, /: a unjudged, b unjudged$/mu);
});

test('a seat whose answer names the fix commit or its subject counts as leaked, never caught', () => {
  const p = trunkWithFakeRuntimes();
  const { fix } = traced(p);
  const run = p.replay([...SEATS, '--clean', '0'], {
    FAKE_CLAUDE_SEAT: `limit.js:1 off by one; ${fix.slice(0, 8)} repairs it.`,
    FAKE_CODEX_SEAT: 'limit.js:1 off by one, as   fix(limit): stop one item\npast the bound says.',
  });
  assert.equal(run.status, 0, run.stderr);
  const report = readFileSync(join(p.run, 'replay.md'), 'utf8');
  assert.match(report, /: a leaked, b leaked$/mu);
  assert.deepEqual(row(report, 'a').slice(2, 6), ['0 of 0', '0', '0', '1']);
});

test('the report gives each seat its recall over the cases every seat was judged on, with its failed count beside it', () => {
  const p = trunkWithFakeRuntimes();
  traced(p);
  traced(p, { name: 'second' });
  const run = p.replay([...SEATS, '--clean', '0'], { FAKE_CLAUDE_SEAT: 'off by one.', FAKE_CODEX_SEAT: 'No findings.', FAKE_CODEX_FAIL_ON: 'second.js' });
  assert.equal(run.status, 0, run.stderr);
  const report = readFileSync(join(p.run, 'replay.md'), 'utf8');
  assert.deepEqual(row(report, 'a').slice(2, 6), ['1 of 1', '0', '0', '0']);
  assert.deepEqual(row(report, 'b').slice(2, 6), ['0 of 1', '1', '0', '0']);
});

test("replay runs each seat offline, at the effort the project's maxEffort caps, and reports the seat as it ran", () => {
  const p = trunkWithFakeRuntimes();
  traced(p);
  p.land('chore(config): cap effort\n\nBeyond the ask: none', { '.agents/pstack.json': JSON.stringify({ branch: 'next', plans: 'docs/plans', maxEffort: 'high' }) });
  const run = p.replay(['--seat', 'a=claude:opus@xhigh', '--seat', 'b=codex:gpt-6.1-sol@xhigh', '--clean', '0'], { FAKE_CLAUDE_SEAT: 'No findings.', FAKE_CODEX_SEAT: 'No findings.', FAKE_ARGS: p.seen });
  assert.equal(run.status, 0, run.stderr);
  const [claude] = p.seenArgs('claude');
  const [codex] = p.seenArgs('codex');
  assert.equal(claude[claude.indexOf('--effort') + 1], 'high');
  assert.equal(claude[claude.indexOf('--disallowed-tools') + 1], 'WebFetch,WebSearch');
  assert.ok(claude.includes('--strict-mcp-config'), claude.join(' '));
  assert.ok(codex.includes('model_reasoning_effort=high'), codex.join(' '));
  for (const flag of ['--ignore-user-config', 'web_search="disabled"', 'read-only']) assert.ok(codex.includes(flag), `${flag}: ${codex.join(' ')}`);
  assert.ok(!codex.some((arg) => /web_search="live"|network_access=true|workspace-write/u.test(arg)), codex.join(' '));
  const report = readFileSync(join(p.run, 'replay.md'), 'utf8');
  assert.deepEqual([row(report, 'a')[1], row(report, 'b')[1]], ['opus @high', 'gpt-6.1-sol @high']);
});

test("a seat reviews a two-commit copy, the reviewed commit's parent and then the commit, with no plans and no way back to the project's history or checkout", () => {
  const p = trunkWithFakeRuntimes({ reviewPaths: { skip: ['generated/**'] } });
  p.land('feat(limit): start the list\n\nBeyond the ask: none', { 'limit.js': 'export const limit = (list) => list;\n' }, 45);
  traced(p, { extra: { 'generated/big.js': '// GENERATED\n' } });
  const run = p.replay([...SEATS, '--clean', '0'], { FAKE_CLAUDE_GIT: '1', FAKE_CODEX_SEAT: 'No findings.' });
  assert.equal(run.status, 0, run.stderr);
  const seen = JSON.parse(readFileSync(join(p.packet('case-'), 'answers/a.md'), 'utf8'));
  const own = /\/temp\/pstack-replay-[^/]+(?:\/\.git)?$/u;
  assert.equal(seen.commits, '2', 'the copy holds the parent and the commit');
  assert.equal(seen.before, 'export const limit = (list) => list;');
  assert.match(seen.after, /BUGGY/u);
  assert.ok(seen.changed.includes('limit.js') && seen.changed.includes('generated/big.js'), seen.changed.join(' '));
  assert.ok(!seen.files.some((file) => file.startsWith('docs/plans/')), seen.files.join(' '));
  assert.match(seen.common, own, "the seat's git dir is the copy's own");
  assert.ok(seen.dirs.length > 0 && seen.dirs.every((dir) => own.test(dir)), `the seat may read ${seen.dirs.join(', ')}`);
});

test('replay deletes every packet folder and every folder its seats made, and keeps the prompts and answers', () => {
  const p = trunkWithFakeRuntimes();
  traced(p);
  p.land('feat(c): add c\n\nBeyond the ask: none', { 'c.js': 'export const c = 3;\n' }, 35);
  const run = p.replay([...SEATS, '--clean', '1'], { FAKE_CLAUDE_SEAT: 'No findings.', FAKE_CODEX_SEAT: 'No findings.' });
  assert.equal(run.status, 0, run.stderr);
  const packets = readdirSync(p.run).filter((name) => /^(case|clean)-/u.test(name));
  assert.equal(packets.length, 2, packets.join(' '));
  for (const packet of packets) {
    assert.ok(existsSync(join(p.run, packet, 'prompt.md')), packet);
    assert.equal(readFileSync(join(p.run, packet, 'answers/a.md'), 'utf8').trim(), 'No findings.');
  }
  assert.deepEqual(p.leftovers(), []);
});

test('a copy that fails to build is deleted', () => {
  const p = trunkWithFakeRuntimes();
  traced(p);
  const broken = join(p.dir, 'broken');
  mkdirSync(broken);
  writeFileSync(join(broken, 'tar'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const run = p.replay([...SEATS, '--clean', '0'], { PATH: `${broken}:${p.env.PATH}`, FAKE_CLAUDE_SEAT: 'No findings.', FAKE_CODEX_SEAT: 'No findings.' });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /tar could not unpack/u);
  assert.deepEqual(p.leftovers(), []);
});

test("a replay that fails while other packets' seats run stops those seats", async () => {
  const p = trunkWithFakeRuntimes();
  const { intro } = traced(p);
  traced(p, { name: 'second' });
  const markers = join(p.dir, 'markers');
  mkdirSync(markers);
  const child = spawn(process.execPath, [REPLAY, '--dir', p.run, '--seat', 'a=claude:opus@high', '--clean', '0'], {
    cwd: p.clone,
    env: { ...p.env, FAKE_SLEEP_ON: 'second.js', FAKE_CLAUDE_DELAY: '1500', FAKE_CLAUDE_SEAT: 'No findings.', FAKE_MARKERS: markers },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => (stderr += chunk));
  const closed = once(child, 'close');
  const deadline = Date.now() + 15000;
  const first = () => existsSync(p.run) && readdirSync(p.run).find((name) => name.startsWith(`case-${intro.slice(0, 10)}`));
  while (!(first() && readdirSync(markers).length === 2) && Date.now() < deadline) await new Promise((wake) => setTimeout(wake, 20));
  assert.ok(first(), 'the first packet started');
  mkdirSync(join(p.run, first(), 'seats.log'));
  const [code] = await closed;
  assert.equal(code, 1, stderr);
  assert.match(stderr, /EISDIR/u);
  const alive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const pids = readdirSync(markers).map((name) => Number(name.split('-')[1]));
  const gone = Date.now() + 3000;
  while (pids.some(alive) && Date.now() < gone) await new Promise((wake) => setTimeout(wake, 50));
  assert.deepEqual(pids.filter(alive), []);
  assert.deepEqual(p.leftovers(), []);
});

test('a replay stopped while its seats run stops every runtime, one that ignores SIGTERM included, and deletes every folder', async () => {
  const p = trunkWithFakeRuntimes();
  traced(p);
  const markers = join(p.dir, 'markers');
  mkdirSync(markers);
  const child = spawn(process.execPath, [REPLAY, '--dir', p.run, ...SEATS, '--clean', '0'], {
    cwd: p.clone,
    env: { ...p.env, FAKE_CLAUDE_SLEEP: '1', FAKE_CODEX_SLEEP: '1', FAKE_MARKERS: markers },
    stdio: 'ignore',
  });
  const closed = once(child, 'close');
  const wait = async (ready, ms) => {
    const deadline = Date.now() + ms;
    while (!ready() && Date.now() < deadline) await new Promise((wake) => setTimeout(wake, 50));
    return ready();
  };
  assert.ok(await wait(() => readdirSync(markers).length === 2, 15000), `runtimes started: ${readdirSync(markers).join(' ')}`);
  child.kill('SIGTERM');
  const [code, signal] = await closed;
  assert.notEqual(code, 0, `exit ${code ?? signal}`);
  const alive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const pids = readdirSync(markers).map((name) => Number(name.split('-')[1]));
  assert.ok(await wait(() => !pids.some(alive), 3000), `runtimes left: ${pids.filter(alive).join(' ')}`);
  assert.deepEqual(p.leftovers(), []);
});
