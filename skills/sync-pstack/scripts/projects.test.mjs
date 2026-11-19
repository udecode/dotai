import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CONFIG, commit, project, read, readJson } from './test-sandbox.mjs';
import { pstackRepo, sandbox } from './test-cli.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'sync-pstack.mjs');

const AUDIT = join(HERE, 'audit.mjs');

test('smoke runs each prompt in both runtimes from the project root, without CLAUDECODE, and prints only their answers', () => {
  const { dir, home } = sandbox();
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\necho "progress noise" >&2\necho "claude in $(pwd) CLAUDECODE=${CLAUDECODE:-unset} PSTACK_READ_ONLY=${PSTACK_READ_ONLY:-unset}: $*"\n', { mode: 0o755 });
  const codex = [
    '#!/bin/sh',
    'flags="$1 $2 $3 $4 $5 $6"',
    'while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2 ;; *) prompt="$1"; shift ;; esac; done',
    'echo "transcript noise"',
    'echo "progress noise" >&2',
    'if [ -p /dev/stdin ] || [ -S /dev/stdin ]; then echo "stdin was left open" > "$out"; else echo "codex in $(pwd) with $flags: $prompt" > "$out"; fi',
  ].join('\n');
  writeFileSync(join(bin, 'codex'), `${codex}\n`, { mode: 0o755 });
  const root = realpathSync(project(dir, 'app', { agents: '# App\n' }));
  const result = spawnSync(process.execPath, [SCRIPT, 'smoke', root, 'the toolbar closes'], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, CLAUDECODE: '1' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.replace(/--session-id [\da-f-]{36} /u, '').includes(`claude in ${root} CLAUDECODE=unset PSTACK_READ_ONLY=1: -p --model opus --add-dir ${home}/.claude/plugins --permission-mode plan -- the toolbar closes`), result.stdout);
  assert.ok(result.stdout.includes(`codex in ${root} with exec --ignore-rules -m gpt-6.2-sol --sandbox read-only: the toolbar closes`), result.stdout);
  assert.doesNotMatch(result.stdout, /noise/);
});

test('smoke fails when a runtime exits cleanly with no answer', () => {
  const { dir, home } = sandbox();
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\necho "a plan"\n', { mode: 0o755 });
  writeFileSync(join(bin, 'codex'), '#!/bin/sh\necho "progress, not an answer"\nexit 0\n', { mode: 0o755 });
  const root = project(dir, 'app', { agents: '# App\n' });
  const result = spawnSync(process.execPath, [SCRIPT, 'smoke', root, 'the toolbar closes'], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` },
  });
  assert.equal(result.status, 1, result.stdout);
});

test("corpus diffs the project's installed ledger helpers against this skill's copies over every managed project", () => {
  const { dir, env, cli } = sandbox();
  const ledger = [
    'ts\tphase\tdecision\twhy\tevidence\tresult',
    '2026-10-01T00:00:00Z\tchip\tt_0a1b2c3d Fix the corpus fixture\tA finding\twrites: src/a.ts; topic: corpus-fixture\toffered',
    '',
  ].join('\n');
  const root = project(dir, 'app', { config: CONFIG, agents: '# App\n', files: { 'docs/plans/suggested-tasks.decisions.tsv': ledger } });
  project(dir, 'bare', { agents: '# Bare\n' });
  assert.equal(cli('apply', root).status, 0);
  spawnSync('git', ['-C', root, 'add', '-A']);
  commit(root, 'app');
  writeFileSync(join(root, 'docs/plans/2026-10-01-x.decisions.tsv'), 'ts\tphase\tdecision\twhy\tevidence\tresult\n2026-10-01T00:00:00Z\tbuild\tA decision\tA reason\tsome evidence\tmaybe\n');
  spawnSync('git', ['-C', root, 'add', '-A']);
  commit(root, 'log');
  const installed = join(root, '.agents/pstack/decisions-check.mjs');
  cpSync(join(root, '.agents/pstack'), join(dir, 'baseline'), { recursive: true });

  const same = spawnSync(process.execPath, [SCRIPT, 'corpus', root, '--out', join(dir, 'same')], { encoding: 'utf8', env: { ...env, PSTACK_BASE: 'HEAD' } });
  assert.equal(same.status, 0, same.stderr);
  assert.match(same.stdout, /^\S+\/app\n {2}no difference$/m);
  assert.match(read(join(dir, 'same'), 'corpus-app-bundled.txt'), /2026-10-01-x\.decisions\.tsv/);

  writeFileSync(installed, "console.log('old', process.argv.slice(2).join(' '), process.cwd());\nif (process.argv[2] === '--all') throw new Error('boom');\n");
  const out = join(dir, 'out');
  const changed = cli('corpus', '--root', dir, '--session', 'local_1', '--out', out);
  assert.equal(changed.status, 0, changed.stderr);
  assert.doesNotMatch(changed.stdout, /bare/);
  assert.match(changed.stdout, /^ {2}-old chips --session local_1 <snapshot>\/suggested-tasks\.decisions\.tsv \S+\/app$/m);
  assert.match(changed.stdout, /^ {2}-old chips stale <snapshot>\/suggested-tasks\.decisions\.tsv \S+\/app$/m);
  assert.match(changed.stdout, /^ {2}\+\s+t_0a1b2c3d {2}Fix the corpus fixture/m);
  const old = read(out, 'corpus-app-installed.txt');
  assert.match(old, /file:\/\/<helpers>\/decisions-check\.mjs:2/);
  assert.equal(old.includes(installed), false);
  assert.equal(read(out, 'corpus-app-bundled.txt').includes('\nold '), false);

  assert.match(cli('corpus', root, '--installed', join(dir, 'baseline')).stdout, /^\S+\/app\n {2}no difference$/m);

  writeFileSync(installed, "import { randomBytes } from 'node:crypto';\nconsole.log(`offer t_${randomBytes(4).toString('hex')} beside t_0a1b2c3d`);\n");
  assert.equal(cli('corpus', root, '--out', join(dir, 'minted')).status, 0);
  assert.match(read(join(dir, 'minted'), 'corpus-app-installed.txt'), /^offer t_<new 1> beside t_0a1b2c3d$/mu, 'a freshly minted id is masked and a ledger id kept');

  writeFileSync(installed, "process.stdout.write('x'.repeat(200000) + '\\nwhole\\n');\nprocess.exit(0);\n");
  assert.equal(cli('corpus', root, '--out', join(dir, 'long')).status, 0);
  assert.match(read(join(dir, 'long'), 'corpus-app-installed.txt'), /^whole$/m, 'an installed helper that exits right after printing still compares whole');

  rmSync(installed);
  assert.match(cli('corpus', root).stdout, /^ {2}-absent$/m);
});

test('user-pin prints the project-scope update for each project whose install is older than the tag', () => {
  const { home, cli } = sandbox();
  mkdirSync(join(home, '.claude/plugins'), { recursive: true });
  const installs = [
    { scope: 'user', version: '0.9.110' },
    { scope: 'project', projectPath: '/work/old', version: '0.9.110' },
    { scope: 'project', projectPath: '/work/current', version: '0.9.117' },
  ];
  writeFileSync(join(home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ plugins: { 'pstack@pstack-claude': installs } }));
  const result = cli('user-pin', '--tag', 'v0.9.117', '--dry-run');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^ {2}cd \/work\/old && claude plugin update pstack@pstack-claude --scope project$/mu);
  assert.doesNotMatch(result.stdout, /\/work\/current/u, 'an install at the tag needs no update');
});

test('playbook prints each base with the project changes applied at their steps, in order', () => {
  const upstream = pstackRepo(mkdtempSync(join(tmpdir(), 'sync-pstack-upstream-')), {
    'v0.9.52': { 'poteto-mode/playbooks/feature.md': '### Feature\n\n1. Read the code.\n2. Design it.\n3. Write the code.\n   Keep it small.\n4. Verify it.\n\n**Reply:** done.\n' },
  });
  const { dir, cli } = sandbox({ upstream });
  const playbook = [
    '---\nextends: feature\nwhen: Use it to build.\n---\n',
    '- **Replace** "Design it": skip, the plan settled it.',
    '- **In** "Write the code": follow the plan slices.',
    '- **After** "Verify it": record the result.',
    '- **Before** "Read the code": reread the plan.',
    '- At the close, report the next item.\n',
  ].join('\n');
  const root = project(dir, 'app', { config: CONFIG, agents: '# App\n', files: { '.agents/playbooks/build.md': playbook } });
  const result = cli('playbook', root, 'build');
  assert.equal(result.status, 0, result.stderr);
  const order = ['reread the plan', 'Read the code', 'skip, the plan settled it', 'Keep it small', 'follow the plan slices', 'Verify it', 'record the result', 'report the next item'];
  const at = order.map((text) => result.stdout.indexOf(text));
  assert.ok(at.every((index, i) => index >= 0 && (i === 0 || index > at[i - 1])), result.stdout);
  assert.doesNotMatch(result.stdout.slice(0, at[2]), /2\. Design it/);
});

test('playbook flags two changes that replace one step, and keeps a change body that wraps', () => {
  const upstream = pstackRepo(mkdtempSync(join(tmpdir(), 'sync-pstack-upstream-')), {
    'v0.9.52': { 'poteto-mode/playbooks/feature.md': '1. Design it.\n2. Verify it.\n' },
  });
  const { dir, cli } = sandbox({ upstream });
  const playbook = '---\nextends: feature\nwhen: Use it to build.\n---\n- **Replace** "Design it": use the plan.\n- **Replace** "Design it": skip it.\n- **After** "Verify it": record the result\n  and report it.\n';
  const root = project(dir, 'app', { config: CONFIG, agents: '# App\n', files: { '.agents/playbooks/build.md': playbook } });
  const result = cli('playbook', root, 'build');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /two changes replace step 1/);
  assert.match(result.stdout, /record the result and report it\./);
});

test('status flags an upstream VERSION ahead of the newest tag', () => {
  const upstream = pstackRepo(mkdtempSync(join(tmpdir(), 'sync-pstack-upstream-')), { 'v0.9.52': {} });
  writeFileSync(join(upstream, 'VERSION'), '0.9.53\n');
  spawnSync('git', ['-C', upstream, 'add', '-A']);
  commit(upstream, 'bump without a tag');
  const { dir, cli } = sandbox({ upstream });
  const root = project(dir, 'app', { config: CONFIG, agents: '# App\n' });
  const result = cli('status', root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /upstream VERSION 0\.9\.53 is ahead of the newest tag v0\.9\.52/);
});

test('status finds managed, pinned and vendored pstack projects under a root', () => {
  const { dir, cli } = sandbox();
  const repos = join(dir, 'repos');
  const managed = project(repos, 'managed', { config: CONFIG, agents: '# A\n' });
  const pinned = project(repos, 'pinned', { settings: { enabledPlugins: { 'pstack@pstack-claude': true } } });
  const vendored = project(repos, 'vendored', { files: { '.agents/skills/poteto-mode/SKILL.md': '---\nname: poteto-mode\n---\n' } });
  project(repos, 'plain', { agents: '# Plain\n' });
  spawnSync('git', ['-C', managed, 'add', '-A']);
  commit(managed, 'managed');
  spawnSync('git', ['-C', managed, 'worktree', 'add', '-q', '--detach', join(repos, 'managed-proof')]);
  assert.ok(existsSync(join(repos, 'managed-proof/.agents/pstack.json')));
  const status = cli('status', '--root', repos, '--json', '--offline');
  assert.equal(status.status, 0, status.stderr);
  assert.deepEqual(
    JSON.parse(status.stdout).projects.map((state) => state.path),
    [managed, pinned, vendored],
  );
});

test('discover counts only what the user typed: Claude Code, Codex sessions and archives, once per forked turn', () => {
  const { dir, home, cli } = sandbox();
  const root = project(dir, 'app', { files: { '.agents/rules/task.mdc': '---\n---\n', '.agents/skills/patch/SKILL.md': '---\nname: patch\n---\n' } });
  const now = new Date().toISOString();
  const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const claude = join(home, '.claude/projects', root.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(claude, { recursive: true });
  writeFileSync(
    join(claude, 'session.jsonl'),
    [
      { type: 'user', timestamp: now, message: { role: 'user', content: '<command-name>/task</command-name>' } },
      { type: 'user', timestamp: now, isMeta: true, message: { role: 'user', content: 'Base directory for this skill. Run /task.' } },
      { type: 'user', timestamp: old, message: { role: 'user', content: [{ type: 'text', text: 'use $task here' }] } },
      { type: 'user', timestamp: now, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: '/task' }] } },
    ]
      .map((line) => JSON.stringify(line))
      .join('\n'),
  );
  const codex = join(home, '.codex/sessions/2026/09/30');
  mkdirSync(codex, { recursive: true });
  const typed = { type: 'item_completed', turn_id: 't1', item: { type: 'UserMessage', content: [{ type: 'text', text: 'run [$patch](/x/SKILL.md)' }] } };
  writeFileSync(
    join(codex, 'rollout.jsonl'),
    [
      { type: 'session_meta', payload: { cwd: root } },
      { timestamp: now, type: 'event_msg', payload: typed },
      { timestamp: now, type: 'event_msg', payload: typed },
      { timestamp: now, type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'AGENTS.md says $patch' }] } },
    ]
      .map((line) => JSON.stringify(line))
      .join('\n'),
  );
  const archived = (path, meta, ...messages) => {
    mkdirSync(join(home, path, '..'), { recursive: true });
    writeFileSync(
      join(home, path),
      [{ type: 'session_meta', payload: { cwd: root, ...meta } }, ...messages.map(([turn_id, message]) => ({ timestamp: old, type: 'event_msg', payload: { type: 'user_message', turn_id, message } }))]
        .map((line) => JSON.stringify(line))
        .join('\n'),
    );
  };
  const typedTask = ['a1', 'go [$task](/x/SKILL.md)'];
  archived('.codex/archived_sessions/2026/08/01/rollout-a.jsonl', {}, typedTask, ['a3', 'and [$task](/x/SKILL.md) again'], ['a2', '# Files pasted by the user:\n## "use [$patch](/x/SKILL.md) next…": /tmp/Pasted text.txt\n## My request: hhf']);
  archived('.codex/sessions/2026/09/30/rollout-fork.jsonl', {}, typedTask);
  archived('.codex/sessions/2026/09/30/rollout-sub.jsonl', { thread_source: 'subagent' }, ['b1', 'brief: run [$patch](/x/SKILL.md)']);
  const result = cli('discover', root);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).typed.counts, { patch: { all: 1, week: 1 }, task: { all: 4, week: 1 } });
});

test('discover counts a command the user typed, not text pasted after it or written by an agent', () => {
  const { dir, home, cli } = sandbox();
  const root = project(dir, 'app', {
    files: { '.agents/rules/sync-vision.mdc': '---\n---\n', '.agents/rules/ui-audit.mdc': '---\n---\n', '.agents/skills/typescript-advanced-types/SKILL.md': '---\nname: typescript-advanced-types\n---\n' },
  });
  const claude = join(home, '.claude/projects', root.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(claude, { recursive: true });
  const now = new Date().toISOString();
  const filler = 'The plan names its subject and its proof. '.repeat(200);
  const user = (content, extra = {}) => ({ type: 'user', timestamp: now, message: { role: 'user', content }, ...extra });
  writeFileSync(
    join(claude, 'session.jsonl'),
    [
      user(`Reviewer report follows.\n${filler}\nNext: [$sync-vision](/x/SKILL.md) sync`),
      user('also following [$typescript-advanced-types](/x/SKILL.md) here'),
      user(`/ui-audit documents ${filler}`),
      user('Run /ui-audit next.', { promptSource: 'system' }),
      user('Run /ui-audit next.', { origin: { kind: 'task-notification' } }),
      user('Run /ui-audit next.', { entrypoint: 'sdk-cli' }),
      user('please run /ui-audit on documents', { entrypoint: 'claude-desktop', promptSource: 'sdk', origin: { kind: 'human' } }),
      user(`<pasted_content id="7">\n${filler} $sync-vision\n</pasted_content id="7">\n/ui-audit go`),
      user('/typescript-advanced-types\n<pasted_content id="8">\n## My request for Codex:\n$sync-vision\n</pasted_content id="8">'),
    ]
      .map((line) => JSON.stringify(line))
      .join('\n'),
  );
  const codex = join(home, '.codex/sessions/2026/10/03');
  mkdirSync(codex, { recursive: true });
  const session = (name, meta, message) =>
    writeFileSync(
      join(codex, name),
      [{ type: 'session_meta', payload: { cwd: root, ...meta } }, { timestamp: now, type: 'event_msg', payload: { type: 'user_message', turn_id: name, message } }]
        .map((line) => JSON.stringify(line))
        .join('\n'),
    );
  session('rollout-exec.jsonl', { originator: 'Codex Desktop', source: 'exec' }, 'run $ui-audit read-only');
  session('rollout-automation.jsonl', { thread_source: 'automation' }, 'run $ui-audit');
  session('rollout-tui.jsonl', {}, `# Context from the in-app browser\n${filler}\n## My request for Codex:\n[$sync-vision](/x/SKILL.md) audit`);
  const result = cli('discover', root);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).typed.counts, {
    'sync-vision': { all: 1, week: 1 },
    'typescript-advanced-types': { all: 2, week: 2 },
    'ui-audit': { all: 3, week: 3 },
  });
});

test('audit counts a user-scope skill typed in any project, and not a link to a project copy of the same name', () => {
  const { dir, home: link } = sandbox();
  const home = realpathSync(link);
  const root = project(dir, 'app', { agents: '# App\n' });
  for (const [skills, name] of [['.agents/skills', 'security-triage'], ['.agents/skills', 'orchestrator'], ['.codex/skills', 'game-guides']]) {
    mkdirSync(join(home, skills, name), { recursive: true });
    writeFileSync(join(home, skills, name, 'SKILL.md'), `---\nname: ${name}\ndescription: x\n---\n`);
  }
  const elsewhere = join(home, '.claude/projects', join(dir, 'other').replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(elsewhere, { recursive: true });
  const now = new Date().toISOString();
  writeFileSync(
    join(elsewhere, 'session.jsonl'),
    [
      `run [$security-triage](${home}/.agents/skills/security-triage/SKILL.md)`,
      `use [$orchestrator](${dir}/other/.agents/skills/orchestrator/SKILL.md)`,
      `use [$orchestrator](<${dir}/a b/.agents/skills/orchestrator/SKILL.md>)`,
      `use [$orchestrator](${home}/.agents/../other/.agents/skills/orchestrator/SKILL.md)`,
      `use [$orchestrator](${home}/.codex/worktrees/demo/app/.agents/skills/orchestrator/SKILL.md)`,
      'use [$orchestrator](.agents/skills/orchestrator/SKILL.md)',
      `again [$security-triage](<${home}/.agents/skills/security-triage/my notes/../SKILL.md>)`,
      'play $game-guides',
    ]
      .map((text) => JSON.stringify({ type: 'user', timestamp: now, message: { role: 'user', content: text } }))
      .join('\n'),
  );
  const result = spawnSync(process.execPath, [AUDIT, root, '--json'], { cwd: home, encoding: 'utf8', env: { ...process.env, HOME: home } });
  assert.equal(result.status, 0, result.stderr);
  const user = Object.fromEntries(JSON.parse(result.stdout).userSkills.map((skill) => [skill.name, skill.typed.all]));
  assert.deepEqual(user, { 'game-guides': 1, orchestrator: 0, 'security-triage': 2 });
});

test('audit run from an installed copy reports dotai facts as unknown instead of comparing the copy with itself', () => {
  const { dir, home, run } = sandbox();
  const root = project(dir, 'app', { agents: '# App\n' });
  const installed = join(home, '.agents/skills/sync-pstack');
  cpSync(dirname(HERE), installed, { recursive: true });
  const result = run(process.execPath, [join(installed, 'scripts/audit.mjs'), root, '--json'], root);
  assert.equal(result.status, 0, result.stderr);
  const skill = JSON.parse(result.stdout).userSkills.find((entry) => entry.name === 'sync-pstack');
  assert.deepEqual([skill.inDotai, skill.stale], [null, null]);
});

test('the audit report shows block and pstack repeats ahead of a flood of project duplicates', () => {
  const { dir, home, run } = sandbox();
  const block = 'Every test must fail for a named, plausible defect and pass only once it is fixed.';
  const pstack = 'Verify against the real artifact, never a proxy that only compiles or type checks.';
  const pstackSkill = join(home, '.claude/plugins/cache/pstack-claude/pstack/9.9.9/skills/prove');
  mkdirSync(pstackSkill, { recursive: true });
  writeFileSync(join(pstackSkill, 'SKILL.md'), `# Prove\n\n${pstack}\n`);
  const sentence = (n, what) => `Rule ${n} keeps ${what} ${n} database free across every suite and runner today.`;
  const duplicates = Array.from({ length: 40 }, (_, n) => `${sentence(n, 'fixture')} ${sentence(n, 'mock')}`).join('\n\n');
  const root = project(dir, 'app', {
    agents: '# App\n',
    files: {
      '.agents/pstack.json': '{ "tag": "v9.9.9" }\n',
      '.agents/rules/a.mdc': `# A\n\n${duplicates}\n`,
      '.agents/rules/b.mdc': `# B\n\n${duplicates}\n\n${block}\n\n${pstack}\n`,
    },
  });
  const result = run(process.execPath, [AUDIT, root], root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\.agents\/rules\/b\.mdc:\d+ ~ rules\/tests\.md:\d+: Every test must fail/);
  assert.match(result.stdout, /\.agents\/rules\/b\.mdc:\d+ ~ pstack\/prove\/SKILL\.md:\d+: Verify against the real artifact/);
  assert.match(result.stdout, /repeated elsewhere in the project \(score >= 0\.5\): 80,/);
});

test('audit routes count whole skill names, not longer names, paths or plain common words', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', {
    agents: '# App\n\nVendor skills (sentry, rate-limiter-flexible) are references. Use `$cross-review` for a hand-off.\n',
    files: {
      '.agents/rules/best-api.mdc': '---\ndescription: api\n---\n# Best API\n',
      '.agents/rules/best-api-review.mdc': '---\ndescription: review\n---\nRun $best-api-review audit, then /task:checkout and import x from "/best-api.ts".\n',
      '.agents/rules/task.mdc': '---\ndescription: task\n---\n# Task\n',
      '.agents/rules/react.mdc': '---\ndescription: react\n---\nThe react docs and @trpc/react-query.\n',
      ...Object.fromEntries(['best-api', 'best-api-review', 'task', 'react', 'cross-review', 'rate-limiter-flexible'].map((name) => [`.agents/skills/${name}/SKILL.md`, `---\nname: ${name}\n---\n`])),
    },
  });
  const result = run(process.execPath, [AUDIT, root, '--json'], root);
  assert.equal(result.status, 0, result.stderr);
  const routes = Object.fromEntries(JSON.parse(result.stdout).skills.map((skill) => [skill.name, skill.routes]));
  assert.deepEqual(routes, { 'best-api': [], 'best-api-review': [], 'cross-review': ['AGENTS.md'], 'rate-limiter-flexible': ['AGENTS.md'], react: [], task: [] });
});

test('audit reads the rule files AGENTS.md names', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', {
    agents: '# App\n\nRead CODING_STANDARDS.md.\n',
    files: { 'CODING_STANDARDS.md': 'Use `$cross-review` for a hand-off.\n', '.agents/skills/cross-review/SKILL.md': '---\nname: cross-review\n---\n' },
  });
  const result = run(process.execPath, [AUDIT, root, '--json'], root);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).skills.find((skill) => skill.name === 'cross-review').routes, ['CODING_STANDARDS.md']);
});

test('audit reads a linked AGENTS.md once, outside its block, and none outside the project', () => {
  const { dir, run, cli } = sandbox();
  const root = project(dir, 'app', { config: CONFIG, agents: '# App\n' });
  cli('apply', root);
  writeFileSync(join(root, 'instructions.md'), read(root, 'AGENTS.md'));
  rmSync(join(root, 'AGENTS.md'));
  symlinkSync('instructions.md', join(root, 'AGENTS.md'));
  const inside = run(process.execPath, [AUDIT, root, '--json'], root);
  assert.equal(inside.status, 0, inside.stderr);
  assert.deepEqual(JSON.parse(inside.stdout).overlaps.filter((overlap) => overlap.with === 'block').map((overlap) => overlap.file), []);
  const outside = join(dir, 'outside.md');
  writeFileSync(outside, '# App\n\nUse `$cross-review` for a hand-off.\n');
  mkdirSync(join(root, '.agents/skills/cross-review'), { recursive: true });
  writeFileSync(join(root, '.agents/skills/cross-review/SKILL.md'), '---\nname: cross-review\n---\n');
  rmSync(join(root, 'AGENTS.md'));
  symlinkSync(outside, join(root, 'AGENTS.md'));
  const external = run(process.execPath, [AUDIT, root, '--json'], root);
  assert.equal(external.status, 0, external.stderr);
  assert.deepEqual(JSON.parse(external.stdout).skills.find((skill) => skill.name === 'cross-review').routes, []);
});

test('audit reads ../<name>/ as a skill route only in .agents/rules/', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', {
    agents: '# App\n\nRead docs/guide.md.\n',
    files: {
      'docs/guide.md': 'See [the lanes](../cross-review/lanes.md).\n',
      '.agents/rules/shipping.mdc': '---\ndescription: ship\n---\nHand off with [review](../cross-review/SKILL.md).\n',
      '.agents/skills/cross-review/SKILL.md': '---\nname: cross-review\n---\n',
    },
  });
  const result = run(process.execPath, [AUDIT, root, '--json'], root);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).skills.find((skill) => skill.name === 'cross-review').routes, ['.agents/rules/shipping.mdc']);
});

test('audit lists a project rule sentence that repeats the block, even wrapped across lines', () => {
  const { dir, run } = sandbox();
  const copied = 'Every test must fail for a named, plausible defect and pass only once it is fixed.';
  const wrapped = copied.replace('defect and', 'defect\nand');
  const root = project(dir, 'app', { agents: '# App\n', files: { '.agents/rules/qa.mdc': `---\ndescription: qa\n---\n# QA\n\n${wrapped} Keep the suite fast.\n` } });
  const result = run(process.execPath, [AUDIT, root, '--json'], root);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(JSON.parse(result.stdout).overlaps.some((overlap) => overlap.file === '.agents/rules/qa.mdc' && overlap.with === 'block'), result.stdout);
});

test('discover flags skills added in the last two weeks, even untyped ones', () => {
  const { dir, cli } = sandbox();
  const root = project(dir, 'app', { files: { '.agents/rules/old.mdc': '---\n---\n' } });
  const past = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  spawnSync('git', ['-C', root, 'add', '-A']);
  spawnSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'old'], { env: { ...process.env, GIT_AUTHOR_DATE: past, GIT_COMMITTER_DATE: past } });
  mkdirSync(join(root, '.agents/skills/fresh'), { recursive: true });
  writeFileSync(join(root, '.agents/skills/fresh/SKILL.md'), '---\nname: fresh\n---\n');
  const result = cli('discover', root);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).recent, ['fresh']);
});

test('sync writes only a clean checkout on the project branch', () => {
  const { dir, cli, run } = sandbox();
  const root = project(dir, 'app', { config: CONFIG, agents: '# App\n' });
  cli('apply', root);
  run('git', ['add', '.'], root);
  commit(root, 'setup');
  writeFileSync(join(root, 'AGENTS.md'), `${read(root, 'AGENTS.md')}\nAn owner's unfinished edit.\n`);

  const dirty = cli('sync', '--tag', 'v0.9.53', root);
  assert.equal(dirty.status, 1);
  assert.match(dirty.stdout, /uncommitted edits to files the sync writes/);
  assert.equal(readJson(root, '.claude/settings.json').extraKnownMarketplaces['pstack-claude'].source.ref, 'v0.9.52');

  run('git', ['checkout', '-q', '--', 'AGENTS.md'], root);
  run('git', ['checkout', '-q', '-b', 'topic'], root);
  const offBranch = cli('sync', '--tag', 'v0.9.53', root);
  assert.equal(offBranch.status, 1);
  assert.match(offBranch.stdout, /the checkout is on topic, not next/);
});

test('a project with autoSync false syncs only when a run names it', () => {
  const { dir, cli, run } = sandbox();
  const repos = join(dir, 'repos');
  const free = project(repos, 'free', { config: CONFIG, agents: '# Free\n' });
  const held = project(repos, 'held', { config: { ...CONFIG, autoSync: false }, agents: '# Held\n' });
  for (const root of [free, held]) {
    assert.equal(cli('apply', root).status, 0);
    run('git', ['add', '-A'], root);
    commit(root, 'setup');
  }
  const pin = (root) => readJson(root, '.claude/settings.json').extraKnownMarketplaces['pstack-claude'].source.ref;
  const heldLine = new RegExp(`^${held}\\n {2}held: autoSync is false; name it to sync$`, 'm');

  const status = cli('status', '--root', repos, '--offline');
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, heldLine);
  assert.match(status.stdout, new RegExp(`^${free}\\n {2}managed `, 'm'));
  assert.deepEqual(JSON.parse(cli('status', '--root', repos, '--json', '--offline').stdout).held, [held]);
  assert.match(cli('status', held, '--offline').stdout, new RegExp(`^${held}\\n {2}managed `, 'm'));

  const corpus = cli('corpus', '--root', repos);
  assert.match(corpus.stdout, heldLine);
  assert.doesNotMatch(corpus.stdout, new RegExp(`^${held}\\n {2}(?!held)`, 'm'));

  const sync = cli('sync', '--tag', 'v0.9.53', '--root', repos);
  assert.equal(sync.status, 0, sync.stdout);
  assert.match(sync.stdout, heldLine);
  assert.equal(pin(free), 'v0.9.53');
  assert.equal(pin(held), 'v0.9.52');
  assert.equal(run('git', ['status', '--porcelain'], held).stdout, '');

  const named = cli('sync', '--tag', 'v0.9.53', held);
  assert.equal(named.status, 0, named.stdout);
  assert.equal(pin(held), 'v0.9.53');
  assert.equal(readJson(held, '.agents/pstack.json').autoSync, false);
});

test('a malformed config fails only its own project in an unnamed run', () => {
  const { dir, cli, run } = sandbox();
  const repos = join(dir, 'repos');
  const free = project(repos, 'free', { config: CONFIG, agents: '# Free\n' });
  const broken = project(repos, 'broken', { config: CONFIG, agents: '# Broken\n' });
  for (const root of [free, broken]) {
    assert.equal(cli('apply', root).status, 0);
    run('git', ['add', '-A'], root);
    commit(root, 'setup');
  }
  writeFileSync(join(broken, '.agents/pstack.json'), '{"tag":');

  const status = cli('status', '--root', repos, '--offline');
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, new RegExp(`^${free}\\n {2}managed `, 'm'));
  assert.match(status.stdout, new RegExp(`^${broken}\\n {2}unreadable config .* error=\\.agents/pstack\\.json: `, 'm'));

  const sync = cli('sync', '--tag', 'v0.9.53', '--root', repos, '--dry-run');
  assert.notEqual(sync.status, 2, sync.stderr);
  assert.match(sync.stdout, new RegExp(free));
});
