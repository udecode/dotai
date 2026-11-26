import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { defaultsRefusal, parsePlan, rail } from '../assets/pstack/plan-page.mjs';
import { brief, commit, LOG_HEAD, logRow, project, read, sandbox } from './test-sandbox.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HELPERS = join(HERE, '../assets/pstack');

const playbook = (extra = '') => `---\nextends: multi-phase-plan\nwhen: Use it to plan.\n${extra}---\n`;

test('parsePlan extracts frontmatter, header fields, title, sections, and stray fence line', () => {
  const source = [
    '---',
    'review_scopes: [dnd, table]',
    '---',
    '# Drag cleanup',
    'Status: building',
    'Topic: dnd',
    'Playbook: plan',
    '',
    'Lead paragraph.',
    '',
    '## Steps',
    '- [x] One',
    '- [ ] Two',
  ].join('\n');
  const parsed = parsePlan(source);
  assert.equal(parsed.title, 'Drag cleanup');
  assert.equal(parsed.meta.status, 'building');
  assert.equal(parsed.fields.topic, 'dnd');
  assert.deepEqual(parsed.lists.review_scopes, ['dnd', 'table']);
  assert.equal(parsed.sections.length, 1);
  assert.equal(parsed.sections[0].title, 'Steps');
  assert.equal(parsed.strayLine, 0);

  const broken = parsePlan('# Broken\n\n## Steps\n```ts\nconst x = 1;\n');
  assert.ok(broken.strayLine > 0);
});

test('defaultsRefusal validates Defaults tables on open plans and skips closed plans', () => {
  const { dir } = sandbox();
  const root = project(dir, 'app', {
    files: {
      'docs/plans/open-bad.md': '# Bad\nStatus: building\n\n## Defaults\nNot a table.\n',
      'docs/plans/open-impact.md': '# Impact\nStatus: building\n\n## Defaults\n| Decision | Pick | Alternative | Word | Impact |\n| --- | --- | --- | --- | --- |\n| X | A | B | flip | huge |\n',
      'docs/plans/open-ok.md': '# Good\nStatus: building\n\n## Defaults\n| Decision | Pick | Alternative | Word | Impact |\n| --- | --- | --- | --- | --- |\n| X | A | B | flip | big |\n',
      'docs/plans/done-bad.md': '# Done\nStatus: done\n\n## Defaults\nNot a table.\n',
    },
  });
  assert.match(defaultsRefusal(join(root, 'docs/plans/open-bad.md')), /needs a table whose columns start with Decision, Pick, Alternative and Word/);
  assert.match(defaultsRefusal(join(root, 'docs/plans/open-impact.md')), /write big or small/);
  assert.equal(defaultsRefusal(join(root, 'docs/plans/open-ok.md')), null);
  assert.equal(defaultsRefusal(join(root, 'docs/plans/done-bad.md')), null);
});

test('plan-page --check and --rail validate plans and emit stage JSON', () => {
  const { dir, run } = sandbox();
  const plan = `# Flow test\nStatus: building\nPlaybook: plan\n\n${brief()}## Steps\n- [x] One\n- [ ] Two\n`;
  const log = `${LOG_HEAD}${logRow('lead', 'gemini-4-neon @high')}${logRow('build', 'built step 1')}`;
  const root = project(dir, 'app', {
    files: {
      '.agents/playbooks/plan.md': playbook(),
      'docs/plans/2026-01-01-flow.md': plan,
      'docs/plans/2026-01-01-flow.decisions.tsv': log,
    },
  });
  const checked = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-flow.md', '--check'], root);
  assert.equal(checked.status, 0, checked.stderr);

  const railRun = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-flow.md', '--rail'], root);
  assert.equal(railRun.status, 0, railRun.stderr);
  const data = JSON.parse(railRun.stdout);
  assert.equal(data.valid, true);
  assert.equal(data.page, null);
  assert.deepEqual(data.steps, { checked: 1, total: 2 });
  assert.equal(data.stages.find((s) => s.label === 'Build')?.meta, '1/2');

  const invalid = rail(join(root, 'docs/plans/2026-01-01-flow.md'));
  assert.equal(invalid.valid, true);
});

test('plan-page --pr renders GitHub Markdown with diffs, playbook page-pr sections, --public, and --into preservation', () => {
  const { dir, run } = sandbox();
  const plan = [
    '# Rename helper',
    'Status: ready',
    'Playbook: plan',
    '',
    '## Brief',
    '### What will change?',
    'Renames foo to bar.',
    '',
    '### What could go wrong?',
    'Callers using foo fail to import.',
    '',
    '## Public API',
    '```ts before',
    '// src/api.ts',
    'export function foo() {}',
    '```',
    '```ts after',
    '// src/api.ts',
    'export function bar() {}',
    '```',
    '',
    '## Document shape',
    '```ts before',
    '// src/doc.ts',
    'type Old = 1;',
    '```',
    '```ts after',
    '// src/doc.ts',
    'type Next = 2;',
    '```',
    '',
    '## Defaults',
    '| Decision | Pick | Alternative | Word | Impact |',
    '| --- | --- | --- | --- | --- |',
    '| Keep alias | Drop it | Re-export | keep | big |',
    '| Log tag | Short | Long | long | small |',
    '',
    '## Verification',
    '- Ran unit tests.',
    '',
    '## Open work',
    '- Follow up on docs. owner: dev; stop: next release.',
  ].join('\n');
  const log = `${LOG_HEAD}${logRow('lead', 'gemini-4-neon @high')}`;
  const root = project(dir, 'app', {
    files: {
      '.agents/playbooks/plan.md': playbook('page-lead: What other editors do, Document shape\npage-pairs: Document shape\npage-pr: Document shape\n'),
      'docs/plans/2026-01-01-pr.md': plan,
      'docs/plans/2026-01-01-pr.decisions.tsv': log,
    },
  });
  run('git', ['remote', 'add', 'origin', 'https://github.com/o/r.git'], root);
  run('git', ['add', '-A'], root);
  commit(root, 'add plan');

  const pr = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-pr.md', '--pr'], root);
  assert.equal(pr.status, 0, pr.stderr);
  const body = read(root, 'docs/plans/artifacts/2026-01-01-pr.pr.md');
  assert.match(body, /<!-- plan-page:start -->/);
  assert.match(body, /Renames foo to bar\./);
  assert.match(body, /> \[!CAUTION\]/);
  assert.match(body, /```diff\n \/\/ src\/api\.ts\n-export function foo\(\) \{\}\n\+export function bar\(\) \{\}\n```/);
  assert.match(body, /## Document shape[\s\S]*-type Old = 1;\n\+type Next = 2;/);
  assert.match(body, /## Decisions[\s\S]*Keep alias/);
  assert.doesNotMatch(body, /Log tag/, 'small defaults stay out of PR body');
  assert.match(body, /## Plans[\s\S]*https:\/\/github\.com\/o\/r\/blob\/[0-9a-f]+\/docs\/plans\/2026-01-01-pr\.md/);

  const pub = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-pr.md', '--pr', '--public'], root);
  assert.equal(pub.status, 0, pub.stderr);
  const pubBody = read(root, 'docs/plans/artifacts/2026-01-01-pr.pr.md');
  assert.doesNotMatch(pubBody, /## Decisions|## Plans|gemini-4-neon/);

  const existing = join(root, 'existing.md');
  writeFileSync(existing, 'Header\n<!-- plan-page:start -->\nold\n<!-- plan-page:end -->\nFooter\n');
  const into = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-pr.md', '--pr', '--into', existing], root);
  assert.equal(into.status, 0, into.stderr);
  const merged = read(root, 'docs/plans/artifacts/2026-01-01-pr.pr.md');
  assert.ok(merged.startsWith('Header\n<!-- plan-page:start -->'));
  assert.ok(merged.endsWith('<!-- plan-page:end -->\nFooter\n'));
});

test('plan-page --pr refuses missing brief, PR number in title, or invalid page-pr playbook config', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', {
    files: {
      '.agents/playbooks/plan.md': playbook('page-lead: What other editors do\npage-pr: Stray section\n'),
      'docs/plans/no-brief.md': '# Clean title\nStatus: ready\n',
      'docs/plans/pr-title.md': `# Fix PR #12\nStatus: ready\n\n${brief()}`,
    },
  });
  const stray = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/no-brief.md', '--pr'], root);
  assert.equal(stray.status, 1);
  assert.match(stray.stderr, /lists Stray section on its page-pr line/);

  writeFileSync(join(root, '.agents/playbooks/plan.md'), playbook('page-lead: What other editors do\n'));
  const missing = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/no-brief.md', '--pr'], root);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /needs a ## Brief before --pr/);

  const titled = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/pr-title.md', '--pr'], root);
  assert.equal(titled.status, 1);
  assert.match(titled.stderr, /name the change instead of the PR/);
});

test('plan-page --comment renders compare link and On top of the PR, skipping clips already in --against', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', { files: { 'a.txt': 'one\n' } });
  run('git', ['remote', 'add', 'origin', 'https://github.com/o/r.git'], root);
  run('git', ['add', '-A'], root);
  commit(root, 'author commit');
  const author = run('git', ['rev-parse', 'HEAD'], root).stdout.trim();

  mkdirSync(join(root, 'docs/plans'), { recursive: true });
  writeFileSync(
    join(root, 'docs/plans/pr.md'),
    [
      '# Follow up',
      'Status: ready',
      '',
      '## On top of the PR',
      '- Kept parser, fixed edge case.',
      '',
      '## Demo',
      '1. Old step ![old](https://example.com/old.png)',
      '2. New step ![new](https://example.com/new.png)',
      '',
      '## Verification',
      '- Tests pass.',
    ].join('\n')
  );
  writeFileSync(join(root, 'description.md'), 'Already shows https://example.com/old.png\n');
  run('git', ['add', '-A'], root);
  commit(root, 'our commit');
  const head = run('git', ['rev-parse', 'HEAD'], root).stdout.trim();

  const res = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/pr.md', '--comment', author, '--against', 'description.md'], root);
  assert.equal(res.status, 0, res.stderr);
  const body = read(root, 'docs/plans/artifacts/pr.comment.md');
  assert.ok(body.includes(`[My commits after yours](https://diffshub.com/o/r/compare/${author}...${head})`));
  assert.match(body, /## On top of the PR/);
  assert.doesNotMatch(body, /old\.png/);
  assert.match(body, /new\.png/);

  const badSha = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/pr.md', '--comment', 'deadbeef'], root);
  assert.equal(badSha.status, 1);
  assert.match(badSha.stderr, /is not a commit in this checkout/);
});
