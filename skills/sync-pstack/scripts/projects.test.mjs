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

test('smoke runs Claude by default, supports both runtimes without CLAUDECODE, and fails on empty answer', () => {
  const { dir, home } = sandbox();
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\necho "progress noise" >&2\necho "claude in $(pwd) CLAUDECODE=${CLAUDECODE:-unset} PSTACK_READ_ONLY=${PSTACK_READ_ONLY:-unset}: $*"\n', { mode: 0o755 });
  writeFileSync(
    join(bin, 'codex'),
    '#!/bin/sh\nflags="$1 $2 $3 $4 $5 $6"\nwhile [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2 ;; *) prompt="$1"; shift ;; esac; done\necho "transcript noise"\n[ -n "$EMPTY_CODEX" ] && exit 0\nif [ -p /dev/stdin ] || [ -S /dev/stdin ]; then echo "stdin open" > "$out"; else echo "codex in $(pwd) with $flags: $prompt" > "$out"; fi\n',
    { mode: 0o755 },
  );
  const root = realpathSync(project(dir, 'app', { agents: '# App\n' }));
  const run = (flags, extraEnv = {}) =>
    spawnSync(process.execPath, [SCRIPT, 'smoke', root, 'the toolbar closes', ...flags], {
      encoding: 'utf8',
      env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, CLAUDECODE: '1', ...extraEnv },
    });

  const both = run(['--runtime', 'both']);
  assert.equal(both.status, 0, both.stderr);
  assert.ok(both.stdout.replace(/--session-id [\da-f-]{36} /u, '').includes(`claude in ${root} CLAUDECODE=unset PSTACK_READ_ONLY=1: -p --model opus --add-dir ${home}/.claude/plugins --permission-mode plan -- the toolbar closes`), both.stdout);
  assert.ok(both.stdout.includes(`codex in ${root} with exec --ignore-rules -m gpt-6.2-sol --sandbox read-only: the toolbar closes`), both.stdout);
  assert.doesNotMatch(both.stdout, /noise/);

  const def = run([]);
  assert.equal(def.status, 0, def.stdout);
  assert.doesNotMatch(def.stdout, /## codex/);
  assert.equal(run(['--runtime', 'both'], { EMPTY_CODEX: '1' }).status, 1);
});

test('corpus diffs installed vs bundled ledger helpers, masks minted ids, and flags absent helpers', () => {
  const { dir, env, cli } = sandbox();
  const ledger = 'ts\tphase\tdecision\twhy\tevidence\tresult\n2026-10-01T00:00:00Z\tchip\tt_0a1b2c3d Fix the corpus fixture\tA finding\twrites: src/a.ts; topic: corpus-fixture\toffered\n';
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
  assert.match(changed.stdout, /^ {2}\+\s+t_0a1b2c3d {2}Fix the corpus fixture/m);
  assert.match(read(out, 'corpus-app-installed.txt'), /file:\/\/<helpers>\/decisions-check\.mjs:2/);
  assert.match(cli('corpus', root, '--installed', join(dir, 'baseline')).stdout, /^\S+\/app\n {2}no difference$/m);

  writeFileSync(installed, "import { randomBytes } from 'node:crypto';\nconsole.log(`offer t_${randomBytes(4).toString('hex')} beside t_0a1b2c3d`);\n");
  assert.equal(cli('corpus', root, '--out', join(dir, 'minted')).status, 0);
  assert.match(read(join(dir, 'minted'), 'corpus-app-installed.txt'), /^offer t_<new 1> beside t_0a1b2c3d$/mu);

  rmSync(installed);
  assert.match(cli('corpus', root).stdout, /^ {2}-absent$/m);
});

test('user-pin prints project-scope update commands only for lagging installs', () => {
  const { home, cli } = sandbox();
  mkdirSync(join(home, '.claude/plugins'), { recursive: true });
  writeFileSync(
    join(home, '.claude/plugins/installed_plugins.json'),
    JSON.stringify({
      plugins: {
        'pstack@pstack-claude': [
          { scope: 'user', version: '0.9.110' },
          { scope: 'project', projectPath: '/work/old', version: '0.9.110' },
          { scope: 'project', projectPath: '/work/current', version: '0.9.117' },
        ],
      },
    }),
  );
  const result = cli('user-pin', '--tag', 'v0.9.117', '--dry-run');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^ {2}cd \/work\/old && claude plugin update pstack@pstack-claude --scope project$/mu);
  assert.doesNotMatch(result.stdout, /\/work\/current/u);
});

test('playbook renders project edits in order, wraps bodies, and flags conflicting replacements', () => {
  const upstream = pstackRepo(mkdtempSync(join(tmpdir(), 'sync-pstack-upstream-')), {
    'v0.9.52': { 'poteto-mode/playbooks/feature.md': '### Feature\n\n1. Read the code.\n2. Design it.\n3. Write the code.\n   Keep it small.\n4. Verify it.\n\n**Reply:** done.\n' },
  });
  const { dir, cli } = sandbox({ upstream });
  const build = [
    '---\nextends: feature\nwhen: Use it to build.\n---\n',
    '- **Replace** "Design it": skip, the plan settled it.',
    '- **In** "Write the code": follow the plan slices.',
    '- **After** "Verify it": record the result\n  and report it.',
    '- **Before** "Read the code": reread the plan.',
    '- At the close, report the next item.\n',
  ].join('\n');
  const clash = '---\nextends: feature\nwhen: Use it to clash.\n---\n- **Replace** "Design it": one.\n- **Replace** "Design it": two.\n';
  const root = project(dir, 'app', { config: CONFIG, agents: '# App\n', files: { '.agents/playbooks/build.md': build, '.agents/playbooks/clash.md': clash } });
  const result = cli('playbook', root, 'build');
  assert.equal(result.status, 0, result.stderr);
  const order = ['reread the plan', 'Read the code', 'skip, the plan settled it', 'Keep it small', 'follow the plan slices', 'Verify it', 'record the result and report it.', 'report the next item'];
  const at = order.map((text) => result.stdout.indexOf(text));
  assert.ok(at.every((index, i) => index >= 0 && (i === 0 || index > at[i - 1])), result.stdout);
  assert.doesNotMatch(result.stdout.slice(0, at[2]), /2\. Design it/);
  assert.match(cli('playbook', root, 'clash').stdout, /two changes replace step 2/);
});

test('status discovers managed, pinned and vendored projects (skipping worktrees) and flags upstream VERSION ahead of tag', () => {
  const upstream = pstackRepo(mkdtempSync(join(tmpdir(), 'sync-pstack-upstream-')), { 'v0.9.52': {} });
  writeFileSync(join(upstream, 'VERSION'), '0.9.53\n');
  spawnSync('git', ['-C', upstream, 'add', '-A']);
  commit(upstream, 'bump without a tag');
  const { dir, cli } = sandbox({ upstream });
  const repos = join(dir, 'repos');
  const managed = project(repos, 'managed', { config: CONFIG, agents: '# A\n' });
  const pinned = project(repos, 'pinned', { settings: { enabledPlugins: { 'pstack@pstack-claude': true } } });
  const vendored = project(repos, 'vendored', { files: { '.agents/skills/poteto-mode/SKILL.md': '---\nname: poteto-mode\n---\n' } });
  project(repos, 'plain', { agents: '# Plain\n' });
  spawnSync('git', ['-C', managed, 'add', '-A']);
  commit(managed, 'managed');
  spawnSync('git', ['-C', managed, 'worktree', 'add', '-q', '--detach', join(repos, 'managed-proof')]);

  const online = cli('status', managed);
  assert.equal(online.status, 0, online.stderr);
  assert.match(online.stdout, /upstream VERSION 0\.9\.53 is ahead of the newest tag v0\.9\.52/);

  const status = cli('status', '--root', repos, '--json', '--offline');
  assert.equal(status.status, 0, status.stderr);
  assert.deepEqual(JSON.parse(status.stdout).projects.map((state) => state.path), [managed, pinned, vendored]);
});

test('discover counts only user-typed invocations across Claude and Codex and flags recent skills', () => {
  const { dir, home, cli } = sandbox();
  const root = project(dir, 'app', {
    files: {
      '.agents/rules/task.mdc': '---\n---\n',
      '.agents/rules/ui-audit.mdc': '---\n---\n',
      '.agents/skills/patch/SKILL.md': '---\nname: patch\n---\n',
    },
  });
  const now = new Date().toISOString();
  const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  spawnSync('git', ['-C', root, 'add', '-A']);
  spawnSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'old'], { env: { ...process.env, GIT_AUTHOR_DATE: old, GIT_COMMITTER_DATE: old } });
  mkdirSync(join(root, '.agents/skills/fresh'), { recursive: true });
  writeFileSync(join(root, '.agents/skills/fresh/SKILL.md'), '---\nname: fresh\n---\n');

  const claude = join(home, '.claude/projects', root.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(claude, { recursive: true });
  const filler = 'The plan names its subject and its proof. '.repeat(200);
  const user = (content, extra = {}) => ({ type: 'user', timestamp: now, message: { role: 'user', content }, ...extra });
  writeFileSync(
    join(claude, 'session.jsonl'),
    [
      user('<command-name>/task</command-name>'),
      user('Base directory for this skill. Run /task.', { isMeta: true }),
      user([{ type: 'text', text: 'use $task here' }], { timestamp: old }),
      user([{ type: 'tool_result', tool_use_id: 'x', content: '/task' }]),
      user(`Reviewer report follows.\n${filler}\nNext: [$task](/x/SKILL.md)`),
      user(`/ui-audit documents ${filler}`),
      user('Run /ui-audit next.', { promptSource: 'system' }),
      user('Run /ui-audit next.', { origin: { kind: 'task-notification' } }),
      user('Run /ui-audit next.', { entrypoint: 'sdk-cli' }),
      user('please run /ui-audit on documents', { entrypoint: 'claude-desktop', promptSource: 'sdk', origin: { kind: 'human' } }),
      user(`<pasted_content id="7">\n${filler} $task\n</pasted_content id="7">\n/ui-audit go`),
    ].map(JSON.stringify).join('\n'),
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
    ].map(JSON.stringify).join('\n'),
  );
  const archived = (path, meta, ...messages) => {
    mkdirSync(join(home, path, '..'), { recursive: true });
    writeFileSync(
      join(home, path),
      [{ type: 'session_meta', payload: { cwd: root, ...meta } }, ...messages.map(([turn_id, message]) => ({ timestamp: old, type: 'event_msg', payload: { type: 'user_message', turn_id, message } }))]
        .map(JSON.stringify).join('\n'),
    );
  };
  const typedTask = ['a1', 'go [$task](/x/SKILL.md)'];
  archived('.codex/archived_sessions/2026/08/01/rollout-a.jsonl', {}, typedTask, ['a3', 'and [$task](/x/SKILL.md) again']);
  archived('.codex/sessions/2026/09/30/rollout-fork.jsonl', {}, typedTask);
  archived('.codex/sessions/2026/09/30/rollout-sub.jsonl', { thread_source: 'subagent' }, ['b1', 'brief: run [$patch](/x/SKILL.md)']);
  archived('.codex/sessions/2026/10/03/rollout-exec.jsonl', { originator: 'Codex Desktop', source: 'exec' }, ['e1', 'run $ui-audit read-only']);

  const result = cli('discover', root);
  assert.equal(result.status, 0, result.stderr);
  const data = JSON.parse(result.stdout);
  assert.deepEqual(data.typed.counts, { patch: { all: 1, week: 1 }, task: { all: 4, week: 1 }, 'ui-audit': { all: 3, week: 3 } });
  assert.deepEqual(data.recent, ['fresh']);
});

test('audit detects user skills, installed copy dotai=null, overlaps, routes, and symlink boundaries', () => {
  const { dir, home: link, run, cli } = sandbox();
  const home = realpathSync(link);
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
      `again [$security-triage](<${home}/.agents/skills/security-triage/my notes/../SKILL.md>)`,
      'play $game-guides',
    ].map((text) => JSON.stringify({ type: 'user', timestamp: now, message: { role: 'user', content: text } })).join('\n'),
  );

  const block = 'Every test must fail for a named, plausible defect and pass only once it is fixed.';
  const pstack = 'Verify against the real artifact, never a proxy that only compiles or type checks.';
  const pstackSkill = join(home, '.claude/plugins/cache/pstack-claude/pstack/9.9.9/skills/prove');
  mkdirSync(pstackSkill, { recursive: true });
  writeFileSync(join(pstackSkill, 'SKILL.md'), `# Prove\n\n${pstack}\n`);
  const sentence = (n, what) => `Rule ${n} keeps ${what} ${n} database free across every suite and runner today.`;
  const duplicates = Array.from({ length: 40 }, (_, n) => `${sentence(n, 'fixture')} ${sentence(n, 'mock')}`).join('\n\n');
  const root = project(dir, 'app', {
    agents: '# App\n\nRead CODING_STANDARDS.md and docs/guide.md. Vendor skills (rate-limiter-flexible) are references.\n',
    files: {
      '.agents/pstack.json': '{ "tag": "v9.9.9" }\n',
      'CODING_STANDARDS.md': 'Use `$cross-review` for a hand-off.\n',
      'docs/guide.md': 'See [the lanes](../only-rule-rel/lanes.md).\n',
      '.agents/rules/a.mdc': `# A\n\n${duplicates}\n`,
      '.agents/rules/b.mdc': `# B\n\n${duplicates}\n\n${block.replace('defect and', 'defect\nand')}\n\n${pstack}\n`,
      '.agents/rules/shipping.mdc': '---\ndescription: ship\n---\nHand off with [review](../only-rule-rel/SKILL.md). The react docs and @trpc/react-query.\n',
      ...Object.fromEntries(['cross-review', 'only-rule-rel', 'rate-limiter-flexible', 'react'].map((name) => [`.agents/skills/${name}/SKILL.md`, `---\nname: ${name}\n---\n`])),
    },
  });

  const textRes = run(process.execPath, [AUDIT, root], root);
  assert.equal(textRes.status, 0, textRes.stderr);
  assert.match(textRes.stdout, /\.agents\/rules\/b\.mdc:\d+ ~ rules\/tests\.md:\d+: Every test must fail/);
  assert.match(textRes.stdout, /\.agents\/rules\/b\.mdc:\d+ ~ pstack\/prove\/SKILL\.md:\d+: Verify against the real artifact/);
  assert.match(textRes.stdout, /repeated elsewhere in the project \(score >= 0\.5\): 80,/);

  const jsonRes = spawnSync(process.execPath, [AUDIT, root, '--json'], { cwd: home, encoding: 'utf8', env: { ...process.env, HOME: home } });
  assert.equal(jsonRes.status, 0, jsonRes.stderr);
  const data = JSON.parse(jsonRes.stdout);
  assert.deepEqual(Object.fromEntries(data.userSkills.map((s) => [s.name, s.typed.all])), { 'game-guides': 1, orchestrator: 0, 'security-triage': 2 });
  assert.deepEqual(Object.fromEntries(data.skills.map((s) => [s.name, s.routes])), {
    'cross-review': ['CODING_STANDARDS.md'],
    'only-rule-rel': ['.agents/rules/shipping.mdc'],
    'rate-limiter-flexible': ['AGENTS.md'],
    react: [],
  });

  // Installed copy reports dotai facts as unknown.
  const installed = join(home, '.agents/skills/sync-pstack');
  cpSync(dirname(HERE), installed, { recursive: true });
  const inst = run(process.execPath, [join(installed, 'scripts/audit.mjs'), root, '--json'], root);
  assert.equal(inst.status, 0, inst.stderr);
  const self = JSON.parse(inst.stdout).userSkills.find((e) => e.name === 'sync-pstack');
  assert.deepEqual([self.inDotai, self.stale], [null, null]);

  // Symlinked AGENTS.md inside project skips its own block; symlink outside project is ignored.
  const sym = project(dir, 'sym', { config: CONFIG, agents: '# App\n', files: { '.agents/skills/cross-review/SKILL.md': '---\nname: cross-review\n---\n' } });
  cli('apply', sym);
  writeFileSync(join(sym, 'instructions.md'), read(sym, 'AGENTS.md'));
  rmSync(join(sym, 'AGENTS.md'));
  symlinkSync('instructions.md', join(sym, 'AGENTS.md'));
  assert.deepEqual(JSON.parse(run(process.execPath, [AUDIT, sym, '--json'], sym).stdout).overlaps.filter((o) => o.with === 'block'), []);
  const outside = join(dir, 'outside.md');
  writeFileSync(outside, '# App\n\nUse `$cross-review`.\n');
  rmSync(join(sym, 'AGENTS.md'));
  symlinkSync(outside, join(sym, 'AGENTS.md'));
  assert.deepEqual(JSON.parse(run(process.execPath, [AUDIT, sym, '--json'], sym).stdout).skills.find((s) => s.name === 'cross-review').routes, []);
});

test('sync enforces clean working branch, respects autoSync false, and isolates malformed configs', () => {
  const { dir, cli, run } = sandbox();
  const repos = join(dir, 'repos');
  const free = project(repos, 'free', { config: CONFIG, agents: '# Free\n' });
  const held = project(repos, 'held', { config: { ...CONFIG, autoSync: false }, agents: '# Held\n' });
  const broken = project(repos, 'broken', { config: CONFIG, agents: '# Broken\n' });
  for (const root of [free, held, broken]) {
    assert.equal(cli('apply', root).status, 0);
    run('git', ['add', '.'], root);
    commit(root, 'setup');
  }
  const pin = (root) => readJson(root, '.claude/settings.json').extraKnownMarketplaces['pstack-claude'].source.ref;

  // Dirty and off-branch refusals.
  writeFileSync(join(free, 'AGENTS.md'), `${read(free, 'AGENTS.md')}\nEdit.\n`);
  assert.match(cli('sync', '--tag', 'v0.9.53', free).stdout, /uncommitted edits to files the sync writes/);
  run('git', ['checkout', '-q', '--', 'AGENTS.md'], free);
  run('git', ['checkout', '-q', '-b', 'topic'], free);
  assert.match(cli('sync', '--tag', 'v0.9.53', free).stdout, /the checkout is on topic, not next/);
  run('git', ['checkout', '-q', 'next'], free);

  // autoSync false holds until named; malformed config fails only its own project.
  const heldLine = new RegExp(`^${held}\\n {2}held: autoSync is false; name it to sync$`, 'm');
  assert.match(cli('corpus', '--root', repos).stdout, heldLine);
  writeFileSync(join(broken, '.agents/pstack.json'), '{"tag":');
  const status = cli('status', '--root', repos, '--offline');
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, heldLine);
  assert.match(status.stdout, new RegExp(`^${broken}\\n {2}unreadable config .* error=\\.agents/pstack\\.json: `, 'm'));

  const sync = cli('sync', '--tag', 'v0.9.53', '--root', repos);
  assert.notEqual(sync.status, 2, sync.stderr);
  assert.match(sync.stdout, heldLine);
  assert.equal(pin(free), 'v0.9.53');
  assert.equal(pin(held), 'v0.9.52');

  const named = cli('sync', '--tag', 'v0.9.53', held);
  assert.equal(named.status, 0, named.stdout);
  assert.equal(pin(held), 'v0.9.53');
  assert.equal(readJson(held, '.agents/pstack.json').autoSync, false);
});
