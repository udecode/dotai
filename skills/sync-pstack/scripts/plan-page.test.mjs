import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { BRIEF_ANSWERS, CONFIG, LOG_HEAD, brief, logRow, project, read, sandbox } from './test-sandbox.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const HELPERS = join(HERE, '../assets/pstack');

test('plan-open reports an open box outside code and ignores one inside a fence', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', { files: { 'plan.md': '# Plan\n\n- [x] done: `bun test ./a.test.ts`\n- [ ] ship it\n\n```md\n- [ ] example\n```\n' } });
  const result = run(process.execPath, [join(HELPERS, 'plan-open.mjs'), 'plan.md'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^1 open item\(s\):\nplan\.md:4: - \[ \] ship it$/m);
});

test('plan-open reads a checkbox nested in a numbered step', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', { files: { 'plan.md': '# Plan\n\n1. - [x] **Build.** Proof: `bun test ./a.test.ts`.\n2. - [ ] **Ship.**\n' } });
  const result = run(process.execPath, [join(HELPERS, 'plan-open.mjs'), 'plan.md'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^1 open item\(s\):\nplan\.md:4: 2\. - \[ \] \*\*Ship\.\*\*$/m);
});

test('plan-open reads past a comment opener inside a code span', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', { files: { 'plan.md': '# Plan\n\nA note opens with `<!--` and ``a `<!--` b``.\n\n- [ ] ship it\n' } });
  const result = run(process.execPath, [join(HELPERS, 'plan-open.mjs'), 'plan.md'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^1 open item\(s\):\nplan\.md:5: - \[ \] ship it$/m);
});

test('plan-open treats a fence inside a comment as part of the comment', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', { files: { 'plan.md': '# Plan\n\n<!--\n```\n- [ ] example\n-->\n\n- [ ] ship it\n' } });
  const result = run(process.execPath, [join(HELPERS, 'plan-open.mjs'), 'plan.md'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^1 open item\(s\):\nplan\.md:8: - \[ \] ship it$/m);
});

const FIVE_ROW_BRIEF = [
  ['What did you find?', 'The page hides its answer.'],
  BRIEF_ANSWERS[0],
  ['What do you need from me?', 'Pick build or hold.'],
  ['What happens if I say go?', 'The renderer changes.'],
  BRIEF_ANSWERS[1],
];

const MEMO = '### Build\n\nBuild the memo now?\n\nWhy it needs you: The renderer is shared by every project.\n\n- Another session changed it this morning.\n\n- **Build now** (recommended): I build it today. Cost: A design mistake shows up after the build.\n- **Hold**: Nothing changes. Cost: Needs you stays hard to read.\n\nWhy I pick it: The prototype settled the design.\n\nAttention: look\n\nIf you say go: I build the memo renderer.\n';
const playbook = (fields) => `---\nextends: multi-phase-plan\nwhen: Use it for a plan.\n${fields}---\n\n# Plan\n`;

test("plan-page renders a playbook's page-lead sections right after Public API", () => {
  const { dir, run } = sandbox();
  const plan = '# Plan\n\nStatus: planning\n\n## Main changes\n\n- Moves the owner.\n\n## What other editors do\n\n- Lexical keeps it in the node.\n\n## Public API\n\n```ts before\nold()\n```\n\n```ts after\nnext()\n```\n' + brief();
  const root = project(dir, 'app', { files: { '.agents/playbooks/plan.md': playbook('page-lead: What other editors do\n'), 'docs/plans/plan.md': plan } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const html = read(root, 'docs/plans/artifacts/plan.html');
  const at = (title) => html.indexOf(`<h2>${title}</h2>`);
  assert.ok(at('Public API') < at('What other editors do') && at('What other editors do') < at('Main changes'));
});

test('plan-page refuses a before fence that prose separates from its after fence', () => {
  const { dir, run } = sandbox();
  const plan = '# Plan\n\nStatus: done\n\n## Public API\n\n```ts before\nold()\n```\n\nIt now takes a type.\n\n```ts after\nnext()\n```\n';
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Public API needs each before fence followed directly by its after fence/);
});

const renderPlan = (plan) => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan } });
  return { root, result: run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root) };
};

test('plan-page keeps a fence that holds heading and field lines inside its section', () => {
  const fenced = '```md\n# Plate docs\n## Not a section\nStatus: not a field\n```';
  const quoted = '````md\n## Usage\n```ts\nconst docs = 1;\n```\n## Not a section either\n````';
  const indented = '```mdx\n## Setup\n    ```ts\n    const orm = 1;\n    ```\n## Not a section after it\n```';
  const { root, result } = renderPlan(`# Plan\n\nStatus: planning\n\n${brief()}## Main changes\n\n- Writes the index.\n\n${fenced}\n\n${quoted}\n\n${indented}\n\n- Lists each page.\n`);
  assert.equal(result.status, 0, result.stderr);
  const html = read(root, 'docs/plans/artifacts/plan.html');
  assert.doesNotMatch(html, /<h2>(?:Not a section|Usage|Not a section either|Setup|Not a section after it)<\/h2>/u);
  const main = html.slice(html.indexOf('<h2>Main changes</h2>'));
  assert.match(main, /## Not a section[\s\S]*Status: not a field[\s\S]*## Usage[\s\S]*## Not a section either[\s\S]*## Not a section after it[\s\S]*Lists each page/u, 'every fence and the list after them stay in Main changes');
});

test('plan-page refuses an open plan whose fence never closes or holds another opening line, and a done plan still splits its sections', () => {
  const stray = (status, rest) => `# Plan\n\nStatus: ${status}\n\n${brief()}## Main changes\n\n- Writes the index.\n\n\`\`\`md\n\n${rest}`;
  const unclosed = renderPlan(stray('planning', '## Open work\n\n- Lists each page.\n'));
  assert.equal(unclosed.result.status, 1);
  assert.match(unclosed.result.stderr, /docs\/plans\/plan\.md line \d+ opens a fence that never closes/u);
  const paired = renderPlan(stray('planning', '## Open work\n\n```sh\nnode build.mjs\n```\n\n## Limits\n\n- None.\n'));
  assert.equal(paired.result.status, 1, 'a stray marker that a later fence closes is refused too');
  assert.match(paired.result.stderr, /line \d+ opens a fence that never closes or that holds another fence's opening line/u);
  const done = renderPlan(stray('done', '## Open work\n\n- Lists each page.\n'));
  assert.equal(done.result.status, 0, done.result.stderr);
  assert.match(read(done.root, 'docs/plans/artifacts/plan.html'), /<h2>Open work<\/h2>[\s\S]*Lists each page/u, 'a done plan with a stray marker hides no later section');
});

test('plan-page reads a fenced ### line in the brief as code, not as a question', () => {
  const [changes, risks] = BRIEF_ANSWERS.slice(-2);
  const { result } = renderPlan(`# Plan\n\nStatus: planning\n\n${brief([[changes[0], `${changes[1]}\n\n\`\`\`md\n### Not an answer\n\`\`\``], risks])}## Main changes\n\n- Writes the index.\n`);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /## Brief in docs\/plans\/plan\.md holds code ```md/u);
});

test('plan-page reads a fenced ### line in an open question as code, not as another question', () => {
  const memo = MEMO.replace('If you say go:', '~~~md\n### Not a question\n~~~\n\nIf you say go:');
  const { result } = renderPlan(`# Plan\n\nStatus: waiting for the owner\n\n${brief()}## Main changes\n\n- Writes the index.\n\n## Open questions\n\n${memo}`);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /## Open questions in docs\/plans\/plan\.md holds code ~~~md/u);
});

test('plan-page checks pairs in a project section only when a playbook pairs it', () => {
  const { dir, run } = sandbox();
  const plan = '# Plan\n\nStatus: done\n\n## Document shape\n\n- A signed document keeps its template id.\n';
  const plain = project(dir, 'plain', { files: { 'docs/plans/plan.md': plan } });
  assert.equal(run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], plain).status, 0);
  const paired = project(dir, 'paired', { files: { '.agents/playbooks/plan.md': playbook('page-pairs: Document shape\n'), 'docs/plans/plan.md': plan } });
  assert.equal(run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], paired).status, 1);
});

test('plan-page refuses a pstack.json that still sets the page lists', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', { config: { pageLead: ['What other editors do'] }, files: { 'docs/plans/plan.md': '# Plan\n\nStatus: planning\n' + brief() } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /still sets pageLead; move each list into the frontmatter of the playbook/);
});

test('plan-page shows the Demo steps in order right after the brief, inlines each screenshot and names a missing one', () => {
  const { dir, run } = sandbox();
  const demo = '## Demo\n\n1. Open **Settings → Migration**. The view says Not pulled yet.\n   ![before](shots/before.png) ![after](shots/after.png)\n2. Click Start onboarding. Its two steps appear.\n   ![after](shots/gone.png)\n';
  const plan = `# Plan\n\nStatus: building\n\n${brief()}\n${demo}\n## Open questions\n\n## Steps\n\n- [ ] Ship.\n`;
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan } });
  mkdirSync(join(root, 'docs/plans/shots'), { recursive: true });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==', 'base64');
  writeFileSync(join(root, 'docs/plans/shots/before.png'), png);
  writeFileSync(join(root, 'docs/plans/shots/after.png'), png);
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const html = read(root, 'docs/plans/artifacts/plan.html');
  const demoAt = html.indexOf('class="demo');
  assert.ok(demoAt > html.indexOf('class="brief'), 'Demo follows the brief');
  assert.ok(demoAt < html.indexOf('class="source"'), 'Demo sits on the page, not in the plan files note');
  assert.ok(html.indexOf('The view says Not pulled yet') < html.indexOf('Its two steps appear'), 'steps keep their order');
  assert.equal([...html.matchAll(/<img src="data:image\/png;base64,/g)].length, 2);
  assert.match(html, /<figcaption>Before<\/figcaption>/);
  assert.match(html, /shots\/gone\.png/);
  assert.equal([...html.matchAll(/<dialog class="lightbox"/g)].length, 1, 'a frame opens full size in one shared viewer');
});

test('plan-page refuses an open plan with more than 8 unticked step boxes, or more than its planBoxes baseline', () => {
  const { dir, run } = sandbox();
  const boxes = (open, done) => [...Array.from({ length: done }, (_, n) => `- [x] Done ${n}.`), ...Array.from({ length: open }, (_, n) => `- [ ] Step ${n}.`)].join('\n');
  const plan = (open, done = 0, status = 'building') => `# Plan\n\nStatus: ${status}\n\n${brief()}\n## Open questions\n\n## Steps\n\n${boxes(open, done)}\n`;
  const root = project(dir, 'app', {
    config: { ...CONFIG, planBoxes: { 'old.md': { max: 12, owner: 'zbeyens' } } },
    files: { 'docs/plans/eight.md': plan(8, 5), 'docs/plans/nine.md': plan(9), 'docs/plans/done.md': plan(9, 0, 'executed'), 'docs/plans/old.md': plan(12) },
  });
  const check = (name) => run(process.execPath, [join(HELPERS, 'plan-page.mjs'), `docs/plans/${name}`, '--check'], root);
  assert.equal(check('eight.md').status, 0, check('eight.md').stderr);
  const nine = check('nine.md');
  assert.equal(nine.status, 1);
  assert.match(nine.stderr, /nine\.md has 9 unticked step boxes under ## Steps, past the cap of 8; give only the next phase step boxes/);
  assert.equal(check('done.md').status, 0, 'a finished plan keeps its boxes');
  assert.equal(check('old.md').status, 0, 'a baseline plan at its count renders');
  writeFileSync(join(root, 'docs/plans/old.md'), plan(13));
  assert.match(check('old.md').stderr, /old\.md has 13 unticked step boxes under ## Steps, past its planBoxes baseline of 12/, 'a baseline plan that gains a box is refused');
});

test('plan-page adds the full-size viewer only to a page that shows frames', () => {
  const { dir, run } = sandbox();
  const plan = `# Plan\n\nStatus: building\n\n${brief()}\n## Demo\n\n1. Open the page. It loads.\n`;
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(read(root, 'docs/plans/artifacts/plan.html'), /class="lightbox"/);
});

test('plan-page refuses a Demo with no numbered step', () => {
  const { dir, run } = sandbox();
  const plan = `# Plan\n\nStatus: building\n\n${brief()}\n## Demo\n\nOpen the page and look around.\n`;
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /## Demo in docs\/plans\/plan\.md needs numbered steps/);
});

test('plan-page diffs a before and after pair line by line', () => {
  const { dir, run } = sandbox();
  const plan = '# Plan\n\nStatus: done\n\n## Public API\n\n```ts before\nsetup()\nold()\n```\n\n```ts after\nsetup()\nnext()\n```\n';
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const html = read(root, 'docs/plans/artifacts/plan.html');
  const rows = (kind) => [...html.matchAll(new RegExp(`class="row ${kind}"><span class="num">\\d+</span><span class="sign">[^<]*</span><code class="language-ts">([^<]*)</code>`, 'gu'))].map((match) => match[1]);
  assert.deepEqual([rows('same'), rows('del'), rows('add')], [['setup()', 'setup()'], ['old()'], ['next()']]);
});

test('plan-page renders a short-dash table and a stray pipe line instead of hanging', () => {
  const { dir } = sandbox();
  const plan = '# Plan\n\nStatus: done\n\n## Notes\n\n| # | Pass |\n| -: | --- |\n| 1 | ground |\n\n| a pipe that starts no table\n';
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan } });
  const result = spawnSync(process.execPath, ['--max-old-space-size=64', join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], { cwd: root, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  const html = read(root, 'docs/plans/artifacts/plan.html');
  assert.match(html, /<td>ground<\/td>/);
  assert.match(html, /a pipe that starts no table/);
});

test('plan-page renders a topic plan as its subject page, led by that plan, and names both files', () => {
  const { dir, run } = sandbox();
  const topic = '# Workflow\n\nPage: https://example.test/page\n\n## Main changes\n\n- Pages follow subjects.\n';
  const first = '# First pass\n\nStatus: done\nTopic: workflow\n\n## Main changes\n\n- Moved the renderer.\n';
  const second = '# Second pass\n\nStatus: planning\nTopic: workflow\n\n## Open questions\n\n- Keep the old pages?\n' + brief();
  const other = '# Unrelated\n\nStatus: done\n';
  const root = project(dir, 'app', { files: { 'docs/plans/topics/workflow.md': topic, 'docs/plans/2026-01-01-first.md': first.replace('Status: done', 'Status: awaiting review'), 'docs/plans/2026-02-01-second.md': second, 'docs/plans/2026-01-15-other.md': other } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-02-01-second.md'], root);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.trim().endsWith('docs/plans/artifacts/topics/workflow.html'), result.stdout);
  const html = read(root, 'docs/plans/artifacts/topics/workflow.html');
  const text = html.replace(/<[^>]+>/gu, '');
  assert.ok(text.includes('Plan Second pass') && text.includes('Keep the old pages?'), 'the rendered iteration leads with its question');
  assert.match(text, /review rounds are in docs\/plans\/2026-02-01-second\.md and docs\/plans\/topics\/workflow\.md/);
  assert.ok(!html.includes('Unrelated'));
});

test('plan-page --index renders every subject page locally and lists it with its state and iteration count, subjects that wait on the owner first, a refused page with its reason, and hub topics with no page yet', () => {
  const { dir, run } = sandbox();
  const files = {
    'docs/plans/topics/README.md': '# Topics\n\nPage: https://example.test/index\n',
    'docs/plans/topics/quiet.md': '# Quiet topic\n\nPage: https://example.test/quiet\n\nThe quiet lead.\n\n## Main changes\n\n- Settled.\n',
    'docs/plans/topics/busy.md': '# Busy topic\n\nPage: https://example.test/busy\n\nThe busy lead.\n\n## Main changes\n\n- Moving.\n',
    'docs/plans/2026-03-01-quiet-pass.md': '# Quiet pass\n\nStatus: executed\nTopic: quiet\n\n## Main changes\n\n- Done.\n',
    'docs/plans/2026-01-01-busy-one.md': '# Busy one\n\nStatus: executed\nTopic: busy\n\n## Main changes\n\n- One.\n',
    'docs/plans/2026-01-02-busy-two.md': '# Busy two\n\nStatus: planning, waiting for Build now\nTopic: busy\n\n## Open questions\n\n' + MEMO + brief(),
    'docs/plans/topics/broken.md': '# Broken topic\n\nThe broken lead.\n\n## Main changes\n\n- Stuck.\n',
    'docs/plans/2026-01-03-broken-pass.md': '# Broken pass\n\nStatus: someday maybe\nTopic: broken\n\n## Main changes\n\n- Stuck.\n',
    'docs/research/features/busy.md': '# Busy feature\n',
    'docs/research/features/quiet.md': '# Quiet feature\n',
    'docs/research/features/fresh.md': '# Fresh feature\n',
  };
  const root = project(dir, 'app', { files, config: { plans: 'docs/plans', pageTopic: { hub: 'docs/research/features/{topic}.md' } } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), '--index'], root);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.trim().endsWith('docs/plans/artifacts/topics/index.html'), result.stdout);
  const html = read(root, 'docs/plans/artifacts/topics/index.html');
  assert.ok(html.includes('href="busy.html"') && existsSync(join(root, 'docs/plans/artifacts/topics/busy.html')), 'a subject links its locally rendered page');
  assert.match(html.replace(/<[^>]+>/gu, ''), /planning waiting for Build now/, 'a subject shows its leading status');
  assert.match(html, /Broken topic[\s\S]*?refused[\s\S]*?state word/, 'a page the renderer refuses shows the refusal instead of a link');
  assert.match(html, /Busy topic[\s\S]*?2 iterations/, 'a subject counts its iterations');
  assert.ok(html.indexOf('Busy topic') < html.indexOf('Quiet topic'), 'a subject that waits on the owner comes before a newer settled one');
  assert.match(html, /Fresh feature[\s\S]*?no page yet/, 'a hub with no subject file is a topic with no page yet');
  assert.ok(!html.includes('>Topics<'), 'the index file is not a subject');
});

test('plan-page keeps an older iteration\'s open question in Needs you under a newer open plan', () => {
  const { dir, run } = sandbox();
  const topic = '# Workflow\n\n## Main changes\n\n- Pages follow subjects.\n';
  const built = '# Built\n\nStatus: executed\nTopic: workflow\n\n## Main changes\n\n- Moved the renderer.\n\n## Open questions\n\n### Lessons\n\nApply the reflect lessons?\n\n- **apply** (recommended): apply them.\n- **skip**: drop them.\n\n## Close\n\n- Landed.\n';
  const next = '# Next\n\nStatus: planning, waiting for Build now\nTopic: workflow\n\n## Main changes\n\n- Index every subject.\n' + brief();
  const root = project(dir, 'app', { files: { 'docs/plans/topics/workflow.md': topic, 'docs/plans/2026-01-01-built.md': built, 'docs/plans/2026-02-01-next.md': next } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-02-01-next.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const html = read(root, 'docs/plans/artifacts/topics/workflow.html');
  assert.match(html, /It opens with a brief\.[\s\S]*Apply the reflect lessons\?/, 'the older question stays under the newer plan');
  assert.match(html, /Apply the reflect lessons\?[\s\S]*?from[\s\S]*?Built/, 'the question names the plan it belongs to');
});

const reviewRow = (phase, decision, result) => `2026-01-01T00:00:00Z\t${phase}\t${decision}\twhy\tevidence\t${result}`;

test('plan-page shows a skipped seat as skipped, never as a seat that answered', () => {
  const { dir, run } = sandbox();
  const plan = '# Plan\n\nStatus: executed\n\n## Main changes\n\n- Seat Codex.\n';
  const log = ['ts\tphase\tdecision\twhy\tevidence\tresult', reviewRow('panel', 'seats claude-opus-5-5 @xhigh, gpt-6.1-sol @xhigh skipped', 'recorded'), reviewRow('panel', 'seats claude-opus-5-5 @xhigh, gpt-6.1-sol @xhigh', 'recorded')].join('\n');
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan, 'docs/plans/plan.decisions.tsv': `${log}\n` } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const html = read(root, 'docs/plans/artifacts/plan.html');
  const header = html.slice(html.indexOf('<header'), html.indexOf('</header>')).replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ');
  assert.match(header, /Reviews claude-opus-5-5 xhigh ×2 gpt-6\.1-sol xhigh skipped gpt-6\.1-sol xhigh /);
});

test("plan-page counts each seat's rounds in the header and lists every round at the bottom by priority", () => {
  const { dir, run } = sandbox();
  const plan = '# Plan\n\nStatus: executed\n\n## Main changes\n\n- Seat Codex.\n';
  const log = [
    'ts\tphase\tdecision\twhy\tevidence\tresult',
    reviewRow('plan', 'Pick seats', 'decided'),
    reviewRow('panel', 'seats opus, codex:gpt-6-astra @high', 'recorded'),
    reviewRow('panel', 'nit Rename the flag', 'dismissed: churn'),
    reviewRow('panel', 'critical The seat writes files', 'applied: read-only brief'),
    reviewRow('review-response', 'Accepted the hand-off edits', 'kept'),
    reviewRow('panel', 'seats opus, codex:gpt-6.1-sol @xhigh missing', 'recorded'),
    reviewRow('panel', 'nit Tidy the label', 'dismissed: churn'),
    reviewRow('panel', 'warning: The roster lists a stale seat', 'applied: dropped'),
    reviewRow('panel', 'warning Fallback hides a missing seat', 'applied: reported missing'),
  ].join('\n');
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan, 'docs/plans/plan.decisions.tsv': `${log}\n` } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const html = read(root, 'docs/plans/artifacts/plan.html');
  const header = html.slice(html.indexOf('<header'), html.indexOf('</header>')).replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ');
  assert.match(header, /Reviews opus ×2 gpt-6-astra high gpt-6\.1-sol xhigh missing /, 'a seat counts its rounds, and a missing seat says so');
  const history = html.slice(html.lastIndexOf('Review history')).replace(/<[^>]+>/gu, '');
  const order = ['Round 1', 'critical The seat writes files', 'nit Rename the flag', 'Accepted the hand-off edits', 'Round 2', 'The roster lists a stale seat', 'warning Fallback hides a missing seat', 'nit Tidy the label'].map((text) => history.indexOf(text));
  assert.ok(order.every((index, at) => index > (order[at - 1] ?? -1)), JSON.stringify(order));
  assert.ok(!html.includes('Pick seats'));
});

test('plan-page draws a finding whose severity a colon follows like one a space follows', () => {
  const { dir, run } = sandbox();
  const plan = '# Plan\n\nStatus: executed\n\n## Main changes\n\n- Seat Codex.\n';
  const log = [
    'ts\tphase\tdecision\twhy\tevidence\tresult',
    reviewRow('panel', 'seats opus', 'recorded'),
    reviewRow('panel', 'warning: The roster lists a stale seat', 'applied: dropped'),
    reviewRow('panel', 'warning :root selector is too broad', 'dismissed: checked'),
    reviewRow('panel', 'critical [opus]: The seat writes files', 'applied: read-only brief'),
  ].join('\n');
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan, 'docs/plans/plan.decisions.tsv': `${log}\n` } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const html = read(root, 'docs/plans/artifacts/plan.html');
  const history = html.slice(html.lastIndexOf('Review history')).replace(/<[^>]+>/gu, '');
  assert.ok(history.includes('warning The roster lists a stale seat'), history.slice(0, 400));
  assert.ok(history.includes('warning :root selector is too broad'), history.slice(0, 400));
  assert.ok(history.includes('critical [opus]: The seat writes files'), history.slice(0, 400));
});

test("plan-page draws the flow rail from the log's stage phases and the Status, never from words inside a row", () => {
  const { dir, run } = sandbox();
  const plan = '# Plan\n\nStatus: waiting for the owner\nPlaybook: audit\n\n## Main changes\n\n- Draw the rail.\n' + brief();
  const log = [
    'ts\tphase\tdecision\twhy\tevidence\tresult',
    reviewRow('plan', 'Run architect now and reflect after ship', 'decided'),
    reviewRow('architect', 'Seat three runners', 'decided'),
    reviewRow('panel', 'seats opus, codex:gpt-6-astra @high', 'recorded'),
    reviewRow('build', 'Port the rail', 'fixed'),
    reviewRow('writing', 'Run deslop and no-comments', 'fixed'),
    reviewRow('panel', 'seats opus', 'recorded'),
    reviewRow('panel', 'seats opus', 'recorded'),
    reviewRow('verify', 'Prove the rail', 'verified'),
    reviewRow('review', 'Accept the hand-off', 'kept'),
  ].join('\n');
  const files = { '.agents/playbooks/audit.md': '---\nextends: autonomous-run\nwhen: Use it to audit.\n---\n', 'docs/plans/plan.md': plan, 'docs/plans/plan.decisions.tsv': `${log}\n` };
  const root = project(dir, 'app', { files });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const html = read(root, 'docs/plans/artifacts/plan.html');
  const rail = [...html.matchAll(/<li class="fs (\w+)"[^>]*>(.*?)<\/li>/gu)].map(([, state, body]) => `${state}:${body.replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ').trim()}`);
  assert.deepEqual(rail, [
    'done:Plan audit autonomous-run',
    'done:Design architect',
    'done:Plan review interrogate',
    'done:Build',
    'done:Writing deslop no-comments',
    'done:Code review ×2 interrogate',
    'waiting:Verify',
    'done:Audit show-me-your-work',
    'left:Ship',
    'left:Reflect',
  ]);
});

const railStates = (run, root, plan) => {
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), plan, '--rail'], root);
  assert.equal(result.status, 0, result.stderr);
  return Object.fromEntries(JSON.parse(result.stdout).stages.map(({ label, state }) => [label, state]));
};
const phaseLog = (phases) => `${['ts\tphase\tdecision\twhy\tevidence\tresult', ...phases.map((phase) => reviewRow(phase, phase === 'panel' ? 'seats opus' : 'Step', 'decided'))].join('\n')}\n`;

test("plan-page's rail marks the newest work row's stage as the current one", () => {
  const { dir, run } = sandbox();
  const railOf = (name, status, phases) => {
    const files = { 'docs/plans/plan.md': `# Plan\n\nStatus: ${status}\n\n## Main changes\n\n- Draw the rail.\n${brief()}`, 'docs/plans/plan.decisions.tsv': phaseLog(phases) };
    return railStates(run, project(dir, name, { files }), 'docs/plans/plan.md');
  };
  const building = railOf('building', 'building', ['build']);
  assert.deepEqual([building.Build, building.Writing], ['now', 'left'], 'a page published mid-build shows Build as current');
  const back = railOf('back', 'building', ['build', 'verify', 'panel', 'build']);
  assert.deepEqual([back.Build, back.Writing, back['Code review'], back.Verify], ['now', 'left', 'done', 'done'], 'a run back in Build after review stays in Build');
  const planned = railOf('planned', 'waiting for the owner', ['plan']);
  assert.deepEqual([planned.Plan, planned.Design], ['waiting', 'left'], 'a plan waiting on the owner waits at Plan');
  const reviewed = railOf('reviewed', 'building: phase 1 next', ['panel', 'trail', 'plan', 'owner']);
  assert.deepEqual([reviewed['Plan review'], reviewed.Audit, reviewed.Ship], ['now', 'done', 'left'], 'audit and stageless rows leave the current stage at the last work row');
  assert.equal(railOf('prose', 'planning', ['architect', 'writing']).Design, 'now', 'a prose pass on the plan before any build leaves the rail at Design');
  assert.equal(railOf('audited', 'building', ['trail']).Plan, 'now', 'a log with no work row sits at Plan');
});

test("plan-page keeps the leading plan's current stage on a rail that folds in the plans it carries", () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', {
    files: {
      'docs/plans/pr.md': `# PR\n\nStatus: building\nPlans: a.md\n\n## Main changes\n\n- Carry a plan.\n${brief()}`,
      'docs/plans/pr.decisions.tsv': phaseLog(['build']),
      'docs/plans/a.md': '# A\n\nStatus: executed\n\n## Main changes\n\n- One.\n',
      'docs/plans/a.decisions.tsv': phaseLog(['build', 'verify']),
    },
  });
  const states = railStates(run, root, 'docs/plans/pr.md');
  assert.deepEqual([states.Build, states.Verify], ['now', 'done']);
});

test('plan-page --rail prints the rail the page draws', () => {
  const { dir, run } = sandbox();
  const plan = '# Plan\n\nStatus: building\nPage: https://claude.ai/artifact/x\nPlaybook: audit\n\n## Main changes\n\n- Draw the rail.\n\n## Steps\n\n1. - [x] One.\n2. - [ ] Two.\n' + brief();
  const log = ['ts\tphase\tdecision\twhy\tevidence\tresult', reviewRow('architect', 'Seat runners', 'decided'), reviewRow('panel', 'seats opus', 'recorded'), reviewRow('build', 'Port', 'fixed')].join('\n');
  const files = { '.agents/playbooks/audit.md': '---\nextends: autonomous-run\nwhen: Use it to audit.\n---\n', 'docs/plans/plan.md': plan, 'docs/plans/plan.decisions.tsv': `${log}\n` };
  const root = project(dir, 'app', { files });
  assert.equal(run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root).status, 0);
  const html = read(root, 'docs/plans/artifacts/plan.html');
  const drawn = [...html.matchAll(/<li class="fs (\w+)"[^>]*>(.*?)<\/li>/gu)].map(([, state, body]) => `${state}:${body.replace(/<span class="fs-meta">.*?<\/span>|<span class="tool">.*?<\/span>/gu, '').replace(/<[^>]+>/gu, '').trim()}`);
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md', '--rail'], root);
  assert.equal(result.status, 0, result.stderr);
  const rail = JSON.parse(result.stdout);
  assert.deepEqual(rail.stages.map(({ state, label }) => `${state}:${label}`), drawn);
  assert.deepEqual([rail.valid, rail.page, rail.steps], [true, 'https://claude.ai/artifact/x', { checked: 1, total: 2 }]);
});

test('plan-page --rail still prints the rail of a plan the page refuses, with the reason', () => {
  const { dir, run } = sandbox();
  const plan = '# Plan\n\nStatus: building\n\n## Main changes\n\n- Draft.\n\n## Defaults\n\nNo table yet.\n' + brief();
  const log = ['ts\tphase\tdecision\twhy\tevidence\tresult', reviewRow('build', 'Port', 'fixed')].join('\n');
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan, 'docs/plans/plan.decisions.tsv': `${log}\n` } });
  assert.equal(run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md', '--check'], root).status, 1);
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md', '--rail'], root);
  assert.equal(result.status, 0, result.stderr);
  const rail = JSON.parse(result.stdout);
  assert.equal(rail.valid, false);
  assert.match(rail.reason, /## Defaults/);
  assert.equal(rail.stages.find(({ label }) => label === 'Build').state, 'now');
});

test('plan-page --rail reports the rail of the plan it is given, not a newer open iteration', () => {
  const { dir, run } = sandbox();
  const older = '# First pass\n\nStatus: executed\nTopic: workflow\n\n## Main changes\n\n- Seats.\n';
  const newer = '# Second pass\n\nStatus: building\nTopic: workflow\n\n## Main changes\n\n- More seats.\n' + brief();
  const root = project(dir, 'app', {
    files: {
      'docs/plans/topics/workflow.md': '# Workflow\nPage: https://claude.ai/artifact/topic\n\n## Main changes\n\n- Seats.\n',
      'docs/plans/2026-01-01-first.md': older,
      'docs/plans/2026-02-01-second.md': newer,
    },
  });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-first.md', '--rail'], root);
  assert.equal(result.status, 0, result.stderr);
  const rail = JSON.parse(result.stdout);
  assert.deepEqual([rail.requestedPlan, rail.status, rail.page], ['docs/plans/2026-01-01-first.md', 'executed', 'https://claude.ai/artifact/topic']);
  assert.equal(rail.stages.find(({ label }) => label === 'Ship').state, 'done', 'the executed plan shows its own shipped rail');
});

test('plan-page keeps a subject\'s latest review in its header and history after newer unreviewed iterations', () => {
  const { dir, run } = sandbox();
  const plan = '# Seat Codex\n\nStatus: executed\nTopic: workflow\n\n## Main changes\n\n- Seats.\n';
  const log = ['ts\tphase\tdecision\twhy\tevidence\tresult', reviewRow('panel', 'seats opus', 'recorded'), reviewRow('panel', 'critical History vanishes', 'applied: kept')].join('\n');
  const root = project(dir, 'app', {
    files: {
      'docs/plans/topics/workflow.md': '# Workflow\n\n## Main changes\n\n- Seats.\n',
      'docs/plans/2026-01-01-seats.md': plan,
      'docs/plans/2026-01-01-seats.decisions.tsv': `${log}\n`,
      'docs/plans/2026-02-01-later.md': '# Later pass\n\nStatus: executed\nTopic: workflow\n\n## Main changes\n\n- Seats.\n',
      'docs/plans/2026-02-01-later.decisions.tsv': `ts\tphase\tdecision\twhy\tevidence\tresult\n${reviewRow('review', 'Hand-off edit', 'applied: kept')}\n`,
    },
  });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-02-01-later.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const page = read(root, 'docs/plans/artifacts/topics/workflow.html');
  assert.match(page.slice(page.indexOf('<header'), page.indexOf('</header>')).replace(/<[^>]+>/gu, ''), /Review round 1.*Seat Codex/su);
  const html = page.replace(/<[^>]+>/gu, '');
  assert.match(html, /critical History vanishes/);
});

test('plan-page keeps a scoped plan on its own page until its subject file exists', () => {
  const { dir, run } = sandbox();
  const plan = '---\nreview_scopes: [uploads]\n---\n# Upload drafts\n\nStatus: building\n\n' + brief();
  const root = project(dir, 'app', { config: { pageTopic: { field: 'review_scopes' } }, files: { 'docs/plans/2026-01-01-drafts.md': plan } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-drafts.md'], root);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.trim().endsWith('docs/plans/artifacts/2026-01-01-drafts.html'), result.stdout);
  assert.match(result.stderr, /create docs\/plans\/topics\/uploads\.md/);
});

test('plan-page takes the subject from the first entry of the configured frontmatter list', () => {
  const { dir, run } = sandbox();
  const plan = '---\nreview_scopes:\n  - dnd\n  - clipboard\n---\n# Transfer\n\nStatus: done\n';
  const root = project(dir, 'app', { config: { pageTopic: { field: 'review_scopes' } }, files: { 'docs/plans/topics/dnd.md': '# Drag and drop\n', 'docs/plans/2026-01-01-transfer.md': plan } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-transfer.md'], root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(read(root, 'docs/plans/artifacts/topics/dnd.html'), /Transfer/);
});

test('plan-page ignores a frontmatter topic field and keeps a legacy plan on its own page', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', { files: { 'docs/plans/2026-01-01-old.md': '---\ntopic: old-proof-plan\nstatus: blocked\n---\n# Old proof\n\n' + brief() } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-old.md'], root);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.trim().endsWith('docs/plans/artifacts/2026-01-01-old.html'), result.stdout);
});

test("plan-page refuses a ledger-scope subject page that lacks a section its plan's playbook requires", () => {
  const { dir, run } = sandbox();
  const config = { pageTopic: { field: 'review_scopes', hub: 'docs/hubs/{topic}.md' } };
  const plan = '---\nreview_scopes: [dnd]\n---\n# Transfer\n\nStatus: done\nPlaybook: plan\n';
  const files = {
    '.agents/playbooks/bug-fix.md': playbook(''),
    '.agents/playbooks/plan.md': playbook('page-require: What other editors do\n'),
    'docs/hubs/dnd.md': '# Drag and drop\n',
    'docs/plans/2026-01-01-transfer.md': plan,
    'docs/plans/topics/dnd.md': '# Drag and drop\n\n## Main changes\n\n- One transfer action.\n',
  };
  const root = project(dir, 'app', { config, files });
  const refused = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-transfer.md'], root);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /dnd needs ## What other editors do/);
  writeFileSync(join(root, 'docs/plans/2026-01-01-transfer.md'), plan.replace('Playbook: plan', 'Playbook: bug-fix'));
  assert.equal(run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-transfer.md'], root).status, 0);
  writeFileSync(join(root, 'docs/plans/2026-01-01-transfer.md'), plan);
  writeFileSync(join(root, 'docs/plans/topics/dnd.md'), files['docs/plans/topics/dnd.md'] + '\n## What other editors do\n\n- Lexical keeps drag in the view.\n');
  assert.equal(run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-transfer.md'], root).status, 0);
  writeFileSync(join(root, 'docs/plans/topics/workflow.md'), '# Workflow\n\n## Main changes\n\n- Pages follow subjects.\n');
  writeFileSync(join(root, 'docs/plans/2026-01-02-pass.md'), '# Pass\n\nStatus: planning\nTopic: workflow\n' + brief());
  assert.equal(run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-02-pass.md'], root).status, 0);
});

test('plan-page names the subject file to create when a topic has none', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', { files: { 'docs/plans/2026-01-01-pass.md': '# Pass\n\nStatus: planning\nTopic: workflow\n' + brief() } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-pass.md'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /create docs\/plans\/topics\/workflow\.md/);
});

const CLOSE = '\n## Close\n\n- Landed the schema landing.\n';
const DELTA_TOPIC = '# Drag\n\n## Public API\n\n```ts\nold();\n```\n\n## Layer and owner\n\n| Change | Layer |\n| --- | --- |\n| Column landing | Plate |\n| Upload veto | Plate |\n';
const DELTA_PLAN = '# Landing\n\nStatus: planning\nTopic: drag\n\n## Public API\n\n```ts before\nold();\n```\n\n```ts after\nnext();\n```\n\n## Layer and owner\n\n| Delta | Change | Layer |\n| --- | --- | --- |\n| added | Schema landing | Plite |\n| changed | Upload veto | Plite |\n| removed | Column landing | Plate |\n' + brief();
const deltaProject = (dir, topic, plan) =>
  project(dir, 'app', {
    files: { '.agents/playbooks/plan.md': playbook('page-lead: Layer and owner\n'), 'docs/plans/topics/drag.md': topic, 'docs/plans/2026-01-01-landing.md': plan },
  });

test('plan-page refuses a Delta row whose key the subject file does not have', () => {
  const { dir, run } = sandbox();
  const root = deltaProject(dir, DELTA_TOPIC, DELTA_PLAN.replace('| changed | Upload veto |', '| changed | Upload vetoes |'));
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-landing.md'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /marks "Upload vetoes" changed, but docs\/plans\/topics\/drag\.md has no such row/);
});

test("plan-page --folded refuses an executed plan until the subject file holds its delta", () => {
  const { dir, run } = sandbox();
  const done = DELTA_PLAN.replace('Status: planning', 'Status: executed, awaiting cross-review') + CLOSE;
  const folded = '# Drag\n\n## Public API\n\n```ts\nfirst();\nnext();\n```\n\n## Layer and owner\n\n| Change | Layer |\n| --- | --- |\n| Schema landing | Plite |\n| Upload veto | Plite |\n';
  const render = (topic) => {
    const root = deltaProject(mkdtempSync(join(dir, 'case-')), topic, done);
    return { root, result: run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-landing.md', '--folded'], root) };
  };
  const unfolded = render(DELTA_TOPIC).result;
  assert.equal(unfolded.status, 1);
  assert.match(unfolded.stderr, /does not show the added row "Schema landing"/);
  const apiLeft = render(folded.replace('next();', 'old();')).result;
  assert.equal(apiLeft.status, 1);
  assert.match(apiLeft.stderr, /does not show the after line/);
  const prefixed = render(folded.replace('next();', 'editor.next();')).result;
  assert.equal(prefixed.status, 1);
  assert.match(prefixed.stderr, /does not show the after line/);
  const oldKept = render(folded.replace('next();', 'next();\nold();')).result;
  assert.equal(oldKept.status, 1);
  assert.match(oldKept.stderr, /still shows the before line/);
  const { root, result } = render(folded);
  assert.equal(result.status, 0, result.stderr);
  writeFileSync(join(root, 'docs/plans/2026-01-01-landing.md'), done.replace(CLOSE, ''));
  const unclosed = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-landing.md', '--folded'], root);
  assert.equal(unclosed.status, 1, 'a fold without its Close');
  assert.match(unclosed.stderr, /needs a ## Close before --folded/);
});

test("plan-page shows the leader's Close after Needs you, keeps it on top once executed, and drops it when newer work opens", () => {
  const { dir, run } = sandbox();
  const topic = '# Workflow\n\nThe subject lead.\n\n## Main changes\n\n- Pages follow subjects.\n';
  const built = '# Built\n\nStatus: executed\nTopic: workflow\n\n## Main changes\n\n- Moved the renderer.\n\n## Close\n\n- Landed the renderer move, 3 done and 0 open.\n';
  const root = project(dir, 'app', { files: { 'docs/plans/topics/workflow.md': topic, 'docs/plans/2026-01-01-built.md': built } });
  const render = (plan) => {
    const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), plan], root);
    assert.equal(result.status, 0, result.stderr);
    return read(root, 'docs/plans/artifacts/topics/workflow.html');
  };
  const executed = render('docs/plans/2026-01-01-built.md');
  assert.ok(executed.includes('Landed the renderer move'), 'an executed leader keeps its Close on the page');
  assert.ok(executed.indexOf('Landed the renderer move') < executed.indexOf('The subject lead.'), 'the Close leads the subject state');
  writeFileSync(join(root, 'docs/plans/2026-01-01-built.md'), built + '\n## Open questions\n\n### Lessons\n\nApply the reflect lessons?\n\n- **apply** (recommended): apply them.\n- **skip**: drop them.\n');
  const asking = render('docs/plans/2026-01-01-built.md');
  assert.ok(asking.includes('Needs you') && asking.indexOf('Apply the reflect lessons?') < asking.indexOf('Landed the renderer move'), 'an executed leader still asks its open question');
  writeFileSync(join(root, 'docs/plans/2026-02-01-next.md'), '# Next\n\nStatus: planning\nTopic: workflow\n\n## Open questions\n\n' + MEMO + brief());
  assert.ok(!render('docs/plans/2026-02-01-next.md').includes('Landed the renderer move'), 'newer open work replaces the old Close');
  const oneOff = '# Fix\n\nStatus: executed\n\nThe fix lead.\n\n## Open questions\n\n### Ship\n\nShip it?\n\n- **ship** (recommended): ship.\n- **hold**: wait.\n\n## Close\n\n- Fixed the caret, 1 done.\n';
  writeFileSync(join(root, 'docs/plans/2026-03-01-fix.md'), oneOff);
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-03-01-fix.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const page = readFileSync(result.stdout.trim(), 'utf8');
  assert.ok(page.indexOf('Ship it?') < page.indexOf('Fixed the caret') && page.indexOf('Fixed the caret') < page.indexOf('The fix lead.'), 'a one-off plan shows its Close between Needs you and its lead');
});

test('plan-page leads a subject page with the plan it renders, under an older open plan that waits on the owner', () => {
  const { dir, run } = sandbox();
  const topic = '# Workflow\n\n## Main changes\n\n- Pages follow subjects.\n';
  const waiting = '# Waiting\n\nStatus: planning, waiting for Build now\nTopic: workflow\n\n## Open questions\n\n' + MEMO + brief([['What will change?', 'The waiting plan changes.'], ['What could go wrong?', 'The waiting plan breaks.']]);
  const built = '# Built\n\nStatus: executed\nTopic: workflow\n\n' + brief([['What will change?', 'The built plan landed.'], ['What could go wrong?', 'The built plan regresses.']]) + '## Main changes\n\n- Moved the renderer.\n\n## Close\n\n- Landed the renderer move.\n';
  const root = project(dir, 'app', { files: { 'docs/plans/topics/workflow.md': topic, 'docs/plans/2026-01-01-waiting.md': waiting, 'docs/plans/2026-02-01-built.md': built } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-02-01-built.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const text = read(root, 'docs/plans/artifacts/topics/workflow.html').replace(/<[^>]+>/gu, '');
  assert.ok(text.includes('Plan Built') && text.includes('The built plan landed.'), 'the handed-back plan leads its page');
  assert.ok(!text.includes('The waiting plan changes.'), 'the older open plan does not take over the brief');
  assert.match(text, /Build the memo now\?[\s\S]*?from[\s\S]*?Waiting/, 'the older plan still asks its question under its own name');
});

test('plan-page names the plan it renders in the header of a subject page without a brief', () => {
  const { dir, run } = sandbox();
  const topic = '# Workflow\n\n## Main changes\n\n- Pages follow subjects.\n';
  const waiting = '# Waiting\n\nStatus: planning, waiting for Build now\nTopic: workflow\n\n## Open questions\n\n' + MEMO + brief();
  const built = '# Built\n\nStatus: executed\nTopic: workflow\n\n## Main changes\n\n- Moved the renderer.\n\n## Close\n\n- Landed the renderer move.\n';
  const root = project(dir, 'app', { files: { 'docs/plans/topics/workflow.md': topic, 'docs/plans/2026-01-01-waiting.md': waiting, 'docs/plans/2026-02-01-built.md': built } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-02-01-built.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const html = read(root, 'docs/plans/artifacts/topics/workflow.html');
  const header = html.slice(html.indexOf('<header'), html.indexOf('</header>')).replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ');
  assert.match(header, /Executed .*Plan Built/u, 'the header names the executed plan and its status');
  assert.ok(html.replace(/<[^>]+>/gu, '').includes('Landed the renderer move.'), 'the page shows that plan\'s Close');
});

test("plan-page lists another plan's unheaded question after the rendered plan's question cards", () => {
  const { dir, run } = sandbox();
  const topic = '# Workflow\n\n## Main changes\n\n- Pages follow subjects.\n';
  const built = '# Built\n\nStatus: executed\nTopic: workflow\n\n' + brief() + '## Open questions\n\n' + MEMO + '\n## Close\n\n- Landed the renderer move.\n';
  const waiting = '# Waiting\n\nStatus: planning, waiting for the owner\nTopic: workflow\n\n## Open questions\n\n- Keep the old pages?\n';
  const root = project(dir, 'app', { files: { 'docs/plans/topics/workflow.md': topic, 'docs/plans/2026-01-01-built.md': built, 'docs/plans/2026-02-01-waiting.md': waiting } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-built.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const text = read(root, 'docs/plans/artifacts/topics/workflow.html').replace(/<[^>]+>/gu, '');
  assert.ok(text.indexOf('Build the memo now?') < text.indexOf('Keep the old pages?'), "the rendered plan's question comes before the other plan's");
});

test('plan-page shows the Status of another open plan that waits on the owner without an Open questions section', () => {
  const { dir, run } = sandbox();
  const topic = '# Workflow\n\n## Main changes\n\n- Pages follow subjects.\n';
  const held = '# Held\n\nStatus: waiting: built, uncommitted until you say push\nTopic: workflow\n\n## Main changes\n\n- Moved the rail.\n';
  const shipped = '# Shipped\n\nStatus: executed: waiting on your commit\nTopic: workflow\n\n## Main changes\n\n- Moved the index.\n';
  const built = '# Built\n\nStatus: executed\nTopic: workflow\n\n' + brief() + '## Main changes\n\n- Moved the renderer.\n\n## Close\n\n- Landed the renderer move.\n';
  const files = { 'docs/plans/topics/workflow.md': topic, 'docs/plans/2026-01-01-held.md': held, 'docs/plans/2026-01-15-shipped.md': shipped, 'docs/plans/2026-02-01-built.md': built };
  const root = project(dir, 'app', { files });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-02-01-built.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const html = read(root, 'docs/plans/artifacts/topics/workflow.html');
  const start = html.indexOf('<section class="needs"');
  assert.ok(start >= 0, 'the page has a Needs you section');
  const needs = html.slice(start, html.indexOf('</section>', start)).replace(/<[^>]+>/gu, '');
  assert.match(needs, /from Held[\s\S]*?until you say push/u, "the held plan's Status shows under its name");
  assert.ok(!needs.includes('waiting on your commit'), "a finished plan's Status stays off Needs you");
});

test("plan-page names the plan of another plan's unheaded question when no question on the page has a heading", () => {
  const { dir, run } = sandbox();
  const topic = '# Workflow\n\n## Main changes\n\n- Pages follow subjects.\n';
  const built = '# Built\n\nStatus: executed\nTopic: workflow\n\n## Main changes\n\n- Moved the renderer.\n';
  const waiting = '# Waiting\n\nStatus: planning, waiting for the owner\nTopic: workflow\n\n## Open questions\n\n- Keep the old pages?\n';
  const root = project(dir, 'app', { files: { 'docs/plans/topics/workflow.md': topic, 'docs/plans/2026-01-01-built.md': built, 'docs/plans/2026-02-01-waiting.md': waiting } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-built.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const html = read(root, 'docs/plans/artifacts/topics/workflow.html');
  const needs = html.slice(html.indexOf('<section class="needs"'), html.indexOf('</section>', html.indexOf('<section class="needs"'))).replace(/<[^>]+>/gu, '');
  assert.match(needs, /from Waiting[\s\S]*?Keep the old pages\?/u, "the newer plan's question shows under its name");
});

test('plan-page shows the Demo, Teach and picks of an executed plan it renders on a subject page without a brief', () => {
  const { dir, run } = sandbox();
  const topic = '# Workflow\n\n## Main changes\n\n- Pages follow subjects.\n';
  const built = '# Built\n\nStatus: executed\nTopic: workflow\n\n## Main changes\n\n- Moved the renderer.\n\n## Demo\n\n1. Open the subject page. The built plan leads.\n\n## Teach\n\nA subject page is led by the plan it renders.\n\n## Defaults\n\n| Decision | Pick | Alternative | Word | Impact |\n| --- | --- | --- | --- | --- |\n| Page lead | The rendered plan | The newest open plan | newest lead | big |\n\n## Close\n\n- Landed the renderer move.\n';
  const waiting = '# Waiting\n\nStatus: planning, waiting for Build now\nTopic: workflow\n\n## Open questions\n\n' + MEMO + brief();
  const root = project(dir, 'app', { files: { 'docs/plans/topics/workflow.md': topic, 'docs/plans/2026-01-01-waiting.md': waiting, 'docs/plans/2026-02-01-built.md': built } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-02-01-built.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const text = read(root, 'docs/plans/artifacts/topics/workflow.html').replace(/<[^>]+>/gu, '');
  const missing = ['The built plan leads.', 'A subject page is led by the plan it renders.', 'The rendered plan'].filter((line) => !text.includes(line));
  assert.deepEqual(missing, [], "the page shows the rendered plan's Demo, Teach and picks");
});

test('plan-page shows both Open questions sections of an open plan under Needs you on every page layout', () => {
  const topic = '# Workflow\n\n## Main changes\n\n- Pages follow subjects.\n';
  const second = MEMO.replace('### Build', '### Ship').replace('Build the memo now?', 'Ship the memo today?');
  const waiting = '# Waiting\n\nStatus: planning, waiting for Build now\nTopic: workflow\n\n## Open questions\n\n' + MEMO + brief() + '## Open questions\n\n' + second;
  const built = (head) => `# Built\n\nStatus: executed\nTopic: workflow\n\n${head}## Main changes\n\n- Moved the renderer.\n`;
  const cases = [
    ['an executed plan without a brief', built(''), 'docs/plans/2026-02-01-built.md'],
    ['an executed plan with a brief', built(brief()), 'docs/plans/2026-02-01-built.md'],
    ['the open plan itself', built(''), 'docs/plans/2026-01-01-waiting.md'],
  ];
  const missing = cases.flatMap(([name, plan, rendered]) => {
    const { dir, run } = sandbox();
    const root = project(dir, 'app', { files: { 'docs/plans/topics/workflow.md': topic, 'docs/plans/2026-01-01-waiting.md': waiting, 'docs/plans/2026-02-01-built.md': plan } });
    const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), rendered], root);
    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
    const html = read(root, 'docs/plans/artifacts/topics/workflow.html');
    const start = html.indexOf('<section class="needs"');
    const needs = start < 0 ? '' : html.slice(start, html.indexOf('</section>', start)).replace(/<[^>]+>/gu, '');
    return ['Build the memo now?', 'Ship the memo today?'].filter((question) => !needs.includes(question)).map((question) => `${name}: ${question}`);
  });
  assert.deepEqual(missing, [], 'Needs you shows each Open questions section');
});

test("plan-page refuses a malformed question in a plan's second Open questions section", () => {
  const { dir, run } = sandbox();
  const plan = '# Plan\n\nStatus: planning, waiting for Build now\n\n## Open questions\n\n' + MEMO + brief() + '## Open questions\n\n### Ship\n\nShip it?\n';
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /"Ship" in docs\/plans\/plan\.md needs/u);
});

test("plan-page keeps an unheaded question in a later Open questions section out of the memo above it", () => {
  const { dir, run } = sandbox();
  const legacy = 'Keep the backup?\n\n- **Retain** (recommended): Keep it. Cost: Disk space.\n- **Drop**: Delete it. Cost: No way back.\n';
  const plan = '# Built\n\nStatus: executed\n\n## Main changes\n\n- Moved the renderer.\n\n## Open questions\n\n' + MEMO + '\n## Open questions\n\n' + legacy;
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const html = read(root, 'docs/plans/artifacts/plan.html');
  const cards = html.split('<article class="q"').slice(1);
  assert.deepEqual(cards.filter((card) => card.includes('Build now') && card.includes('Retain')), [], "the backup's options stay out of the Build memo");
  assert.match(html.replace(/<[^>]+>/gu, ''), /Keep the backup\?/u, 'the unheaded question still shows under Needs you');
});

test("plan-page refuses code in a plan's second Open questions section", () => {
  const { dir, run } = sandbox();
  const second = MEMO.replace('### Build', '### Ship').replace('Build the memo now?', 'Ship `main` now?');
  const plan = '# Plan\n\nStatus: planning, waiting for Build now\n\n## Open questions\n\n' + MEMO + brief() + '## Open questions\n\n' + second;
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /## Open questions in docs\/plans\/plan\.md holds code `main`/u);
});

test("plan-page refuses a plan's second Defaults section without its table", () => {
  const { dir, run } = sandbox();
  const plan = `# Plan\n\nStatus: planning\n\n${brief()}## Defaults\n\n| Decision | Pick | Alternative | Word |\n| --- | --- | --- | --- |\n| Page look | One line per choice. | The old table | keep table |\n\n## Defaults\n\n- Keep the old pages.\n`;
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /## Defaults in docs\/plans\/plan\.md needs a table whose columns start with Decision/u);
});

test('plan-page --index leads a subject page with its older open plan over a newer executed one', () => {
  const { dir, run } = sandbox();
  const topic = '# Workflow\n\n## Main changes\n\n- Pages follow subjects.\n';
  const waiting = '# Waiting\n\nStatus: planning, waiting for Build now\nTopic: workflow\n\n## Open questions\n\n' + MEMO + brief();
  const built = '# Built\n\nStatus: executed\nTopic: workflow\n\n## Main changes\n\n- Moved the renderer.\n';
  const root = project(dir, 'app', { files: { 'docs/plans/topics/workflow.md': topic, 'docs/plans/2026-01-01-waiting.md': waiting, 'docs/plans/2026-02-01-built.md': built } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), '--index'], root);
  assert.equal(result.status, 0, result.stderr);
  const html = read(root, 'docs/plans/artifacts/topics/workflow.html');
  const header = html.slice(html.indexOf('<header'), html.indexOf('</header>')).replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ');
  assert.match(header, /Plan Waiting/u, 'the index leads with the open plan');
});

test("plan-page accepts a hub's required section from the open plan it renders while a newer open plan lacks it", () => {
  const { dir, run } = sandbox();
  const files = {
    '.agents/playbooks/bug-fix.md': playbook(''),
    '.agents/playbooks/plan.md': playbook('page-require: What other editors do\n'),
    'docs/hubs/dnd.md': '# Drag and drop\n',
    'docs/plans/topics/dnd.md': '# Drag and drop\n\n## Main changes\n\n- One transfer action.\n',
    'docs/plans/2026-01-01-transfer.md': '# Transfer\n\nStatus: planning\nTopic: dnd\nPlaybook: plan\n\n' + brief() + '## What other editors do\n\n- Lexical keeps drag in the view.\n',
    'docs/plans/2026-02-01-fix.md': '# Fix\n\nStatus: planning\nTopic: dnd\nPlaybook: bug-fix\n',
  };
  const root = project(dir, 'app', { config: { pageTopic: { hub: 'docs/hubs/{topic}.md' } }, files });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-transfer.md'], root);
  assert.equal(result.status, 0, result.stderr);
});

test("plan-page refuses a hub's required section that only an open plan off the page holds", () => {
  const { dir, run } = sandbox();
  const files = {
    '.agents/playbooks/plan.md': playbook('page-require: What other editors do\n'),
    'docs/hubs/dnd.md': '# Drag and drop\n',
    'docs/plans/topics/dnd.md': '# Drag and drop\n\n## Main changes\n\n- One transfer action.\n',
    'docs/plans/2026-01-01-transfer.md': '# Transfer\n\nStatus: planning\nTopic: dnd\nPlaybook: plan\n\n' + brief() + '## What other editors do\n\n- Lexical keeps drag in the view.\n',
    'docs/plans/2026-02-01-drop.md': '# Drop\n\nStatus: planning\nTopic: dnd\nPlaybook: plan\n\n' + brief(),
  };
  const root = project(dir, 'app', { config: { pageTopic: { hub: 'docs/hubs/{topic}.md' } }, files });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-02-01-drop.md'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /needs ## What other editors do in docs\/plans\/topics\/dnd\.md or docs\/plans\/2026-02-01-drop\.md/u);
});

test("plan-page refuses a hub's required section that only an executed plan without a brief holds", () => {
  const { dir, run } = sandbox();
  const files = {
    '.agents/playbooks/plan.md': playbook('page-lead: What other editors do\npage-require: What other editors do\n'),
    'docs/hubs/dnd.md': '# Drag and drop\n',
    'docs/plans/topics/dnd.md': '# Drag and drop\n\n## Main changes\n\n- One transfer action.\n',
    'docs/plans/2026-02-01-built.md': '# Built\n\nStatus: executed\nTopic: dnd\nPlaybook: plan\n\n## Main changes\n\n- One transfer action.\n\n## What other editors do\n\n- Lexical keeps drag in the view.\n',
  };
  const root = project(dir, 'app', { config: { pageTopic: { hub: 'docs/hubs/{topic}.md' } }, files });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-02-01-built.md'], root);
  assert.equal(result.status, 1, 'the page without a brief shows only the subject file');
  assert.match(result.stderr, /needs ## What other editors do in docs\/plans\/topics\/dnd\.md, the sources its page shows/u);
});

test('plan-page lists a hand-off review row whose phase starts with a capital', () => {
  const { dir, run } = sandbox();
  const plan = '# Plan\n\nStatus: executed\n\n## Main changes\n\n- Seat Codex.\n';
  const log = ['ts\tphase\tdecision\twhy\tevidence\tresult', reviewRow('panel', 'seats opus', 'recorded'), reviewRow('Review-trail', 'warning The trail cites a missing log', 'recorded')].join('\n');
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan, 'docs/plans/plan.decisions.tsv': `${log}\n` } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(read(root, 'docs/plans/artifacts/plan.html').includes('The trail cites a missing log'));
});

test('plan-page renders a plan reopened after its delta was folded', () => {
  const { dir, run } = sandbox();
  const folded = '# Drag\n\n## Public API\n\n```ts\nnext();\n```\n\n## Layer and owner\n\n| Change | Layer |\n| --- | --- |\n| Schema landing | Plite |\n| Upload veto | Plite |\n';
  const root = deltaProject(dir, folded, DELTA_PLAN.replace('Status: planning', 'Status: reopened; the execution review found a gap'));
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-landing.md'], root);
  assert.equal(result.status, 0, result.stderr);
});

test('plan-page refuses a subject folded while its plan is still open', () => {
  const { dir, run } = sandbox();
  const render = (topic) =>
    run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-landing.md'], deltaProject(mkdtempSync(join(dir, 'case-')), topic, DELTA_PLAN));
  const rows = render(DELTA_TOPIC.replace('| Upload veto | Plate |', '| Upload veto | Plite |'));
  assert.equal(rows.status, 1);
  assert.match(rows.stderr, /docs\/plans\/topics\/drag\.md already shows the changed row "Upload veto" of ## Layer and owner from docs\/plans\/2026-01-01-landing\.md, which is still open/);
  const api = render(DELTA_TOPIC.replace('old();', 'next();'));
  assert.equal(api.status, 1);
  assert.match(api.stderr, /already shows the after side of a ## Public API pair/);
  const cased = (topic, plan) =>
    run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-landing.md'], deltaProject(mkdtempSync(join(dir, 'case-')), topic, plan));
  const recase = DELTA_PLAN.replace('```ts after\nnext();', '```ts after\nOld();').replace('| changed | Upload veto | Plite |', '| changed | Upload veto | PLATE |');
  assert.equal(cased(DELTA_TOPIC, recase).status, 0, 'a change of case alone is a real change');
  assert.equal(cased(DELTA_TOPIC.replace('old();', 'Old();'), recase).status, 1);
  const order = DELTA_PLAN.replace('```ts before\nold();', '```ts before\nold();\nnext();').replace('```ts after\nnext();', '```ts after\nnext();\nold();');
  assert.equal(cased(DELTA_TOPIC.replace('old();', 'old();\nnext();'), order).status, 0);
  assert.equal(cased(DELTA_TOPIC.replace('old();', 'next();\nold();'), order).status, 1);
  const gone = render(DELTA_TOPIC.replace(/\n## Layer and owner[\s\S]*$/, '\n'));
  assert.equal(gone.status, 1, 'a subject without the section already shows the removed row as removed');
  const unlisted = DELTA_PLAN.replace('```ts before\nold();\n```\n\n```ts after\nnext();\n```', '```ts before\nother();\n```\n\n```ts after\n```');
  assert.equal(cased(DELTA_TOPIC, unlisted).status, 0, 'deleting a call the subject never listed is not a fold');
  const folding = deltaProject(mkdtempSync(join(dir, 'case-')), DELTA_TOPIC.replace('old();', 'next();'), DELTA_PLAN);
  const fold = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-landing.md', '--folded'], folding);
  assert.equal(fold.status, 1, 'the fold check still runs');
  assert.doesNotMatch(fold.stderr, /already shows/);
  const pair = (before, after) => DELTA_PLAN.replace('```ts before\nold();\n```\n\n```ts after\nnext();\n```', `\`\`\`ts before\n${before}\n\`\`\`\n\n\`\`\`ts after\n${after}\n\`\`\``);
  const subject = (code) => DELTA_TOPIC.replace('old();', code);
  const moved = ['if (on) {\n  start();\n}\nfinish();', 'if (on) {\n  start();\n  finish();\n}'];
  assert.equal(cased(subject(moved[0]), pair(...moved)).status, 0, 'a brace move is a real change');
  const spaced = ['title("a b");', 'title("a  b");'];
  assert.equal(cased(subject(spaced[0]), pair(...spaced)).status, 0, 'spacing inside a literal is a real change');
  const deps = ['useThing(() => {\n  run();\n});', 'useThing(() => {\n  run();\n}, []);'];
  assert.equal(cased(subject(deps[0]), pair(...deps)).status, 0, 'a punctuation-only change is a real change');
  assert.equal(cased(subject(deps[1]), pair(...deps)).status, 1);
  const ordinary = DELTA_PLAN + '\n## Ownership\n\n| Delta | Owner | Layer |\n| --- | --- | --- |\n| removed | Upload | Plate |\n';
  assert.equal(cased(DELTA_TOPIC, ordinary).status, 1, 'a removed row in a section the subject lacks is already folded');
});

test('plan-page skips a line another iteration also changes, and --folded checks the order of the after block', () => {
  const { dir, run } = sandbox();
  const plan = (status, before, after) => `# Plan\n\nStatus: ${status}\nTopic: drag\n\n## Public API\n\n\`\`\`ts before\n${before}\n\`\`\`\n\n\`\`\`ts after\n${after}\n\`\`\`\n${CLOSE}` + brief();
  const root = deltaProject(dir, DELTA_TOPIC.replace('old();', 'run();\nreplacement();'), plan('building', 'run();\nlegacy();', 'run();'));
  writeFileSync(join(root, 'docs/plans/2025-12-01-replace.md'), plan('executed', 'legacy();', 'replacement();'));
  assert.equal(run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-landing.md'], root).status, 0);
  const order = deltaProject(mkdtempSync(join(dir, 'case-')), DELTA_TOPIC.replace('old();', 'end();\nbegin();'), plan('building', 'old();', 'begin();\nend();'));
  const folded = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-landing.md', '--folded'], order);
  assert.equal(folded.status, 1);
  assert.match(folded.stderr, /does not show the after block of a ## Public API pair in order/);
  const spacing = deltaProject(mkdtempSync(join(dir, 'case-')), DELTA_TOPIC.replace('old();', 'title("a b");\ntitle("a  b");'), plan('building', 'title("a b");', 'title("a  b");'));
  const stale = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-landing.md', '--folded'], spacing);
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /still shows the before line "title\("a b"\);"/);
});

test("plan-page applies each iteration's own refusals whichever iteration renders the page", () => {
  const { dir, run } = sandbox();
  const older = (body) => `# Older\n\nStatus: building\nTopic: drag\n${body}` + brief();
  const render = (plan) => {
    const topic = DELTA_TOPIC.replace('| Upload veto | Plate |\n', '| Upload veto | Plate |\n| Drop veto | Plate |\n');
    const root = deltaProject(mkdtempSync(join(dir, 'case-')), topic, DELTA_PLAN);
    writeFileSync(join(root, 'docs/plans/2025-12-15-older.md'), plan);
    return run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-landing.md'], root);
  };
  assert.match(render(older('\n## Defaults\n\n- **Local only.**\n')).stderr, /## Defaults in docs\/plans\/2025-12-15-older\.md needs a table/);
  assert.match(render(older('Playbook: plna\n')).stderr, /2025-12-15-older\.md names playbook plna/);
  assert.equal(render(older('Playbook: feature\n')).status, 0, "a pstack playbook's name renders");
  assert.match(render(older('\n## Public API\n\n```ts before\nlater();\n```\n\nIt moved.\n\n```ts after\nlatest();\n```\n')).stderr, /needs each before fence followed directly by its after fence/);
  assert.match(render(older('\n## Layer and owner\n\n| Delta | Change | Layer |\n| --- | --- | --- |\n| changed | Drop veto | Plate |\n')).stderr, /already shows the changed row "Drop veto"/);
  assert.match(render(older('\n## Layer and owner\n\n| Delta | Change | Layer |\n| --- | --- | --- |\n| modified | Drop veto | Plite |\n')).stderr, /A Delta cell in ## Layer and owner of docs\/plans\/2025-12-15-older\.md is added, changed or removed, not "modified"/);
  assert.equal(render(older('Playbook: retired\n').replace('Status: building', 'Status: executed')).status, 0, 'an executed iteration keeps rendering after its playbook is renamed');
  const history = deltaProject(mkdtempSync(join(dir, 'case-')), DELTA_TOPIC, DELTA_PLAN.replace('Status: planning', 'Status: executed\nPlaybook: retired'));
  assert.equal(run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-landing.md'], history).status, 0, 'an executed leader keeps rendering after its playbook is renamed');
  const root = deltaProject(mkdtempSync(join(dir, 'case-')), DELTA_TOPIC, DELTA_PLAN);
  writeFileSync(join(root, 'docs/plans/2025-12-15-older.md'), older('Playbook: plna\n'));
  assert.match(run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2025-12-15-older.md'], root).stderr, /2025-12-15-older\.md names playbook plna/, 'the older path refuses the same way');
});

test('plan-page --check refuses an open plan whose Defaults is not the decision table, and writes nothing', () => {
  const { dir, run } = sandbox();
  const plan = (defaults) => `# Plan\n\nStatus: planning\n\n## Defaults\n\n${defaults}` + brief();
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan('- **Local only.** Reverse with "ci lane".\n') } });
  const listed = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md', '--check'], root);
  assert.equal(listed.status, 1);
  assert.match(listed.stderr, /## Defaults in docs\/plans\/plan\.md needs a table whose columns start with Decision, Pick, Alternative and Word/);
  writeFileSync(join(root, 'docs/plans/plan.md'), plan('| Decision | Pick | Alternative | Word |\n| --- | --- | --- | --- |\n| Where it runs | Locally | A nightly runner | ci lane |\n'));
  assert.equal(run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md', '--check'], root).status, 0);
  assert.ok(!existsSync(join(root, 'docs/plans/artifacts/plan.html')));
});

test('plan-page opens an open plan with its brief, its open questions and its changes, and leaves proof and steps to the plan file', () => {
  const { dir, run } = sandbox();
  const plan = `# Plan\n\nStatus: planning\n\n${brief()}## Open questions\n\n${MEMO}\n## Main changes\n\n- Moves the owner.\n\n## Steps\n\n- [ ] Ship the owner move.\n\n## Close\n\n- Landed nothing yet.\n`;
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const html = read(root, 'docs/plans/artifacts/plan.html');
  assert.ok(html.indexOf('It opens with a brief.') < html.indexOf('Build the memo now?'), 'the brief leads the page');
  assert.ok(html.indexOf('Old plans need a brief.') < html.indexOf('Build the memo now?'), 'every answer stays above the open questions');
  assert.ok(html.indexOf('Build the memo now?') < html.indexOf('Moves the owner.'), 'Main changes shows after the open questions');
  assert.ok(!html.includes('Ship the owner move.') && !html.includes('Landed nothing yet.'), 'Steps and Close stay in the plan file');
  assert.match(html.replace(/<[^>]+>/gu, ''), /review rounds are in docs\/plans\/plan\.md/);
});

test('plan-page shows Teach as How it works right after the brief and before the open questions', () => {
  const { dir, run } = sandbox();
  const plan = `# Plan\n\nStatus: planning\n\n${brief()}## Teach\n\nA page is the one place the owner reads.\n\n## Open questions\n\n${MEMO}\n## Main changes\n\n- Moves the owner.\n`;
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const html = read(root, 'docs/plans/artifacts/plan.html');
  assert.ok(html.includes('<h2>How it works</h2>'), 'Teach shows under its page title');
  assert.ok(html.indexOf('Old plans need a brief.') < html.indexOf('A page is the one place the owner reads.'), 'Teach follows the brief');
  assert.ok(html.indexOf('A page is the one place the owner reads.') < html.indexOf('Build the memo now?'), 'Teach comes before the open questions');
});

test('plan-page shows each Defaults row as its decision over the pick in bold and the alternative marked (alt), with the word that switches it', () => {
  const { dir, run } = sandbox();
  const plan = `# Plan\n\nStatus: planning\n\n${brief()}## Defaults\n\n| Decision | Pick | Alternative | Word | Impact |\n| --- | --- | --- | --- | --- |\n| Page look | One line per choice. | The old table | keep table | big |\n`;
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const html = read(root, 'docs/plans/artifacts/plan.html');
  assert.ok(html.includes('<li>Page look<ul><li><strong>One line per choice</strong></li><li class="alt">The old table (alt) · say <code>keep table</code></li></ul></li>'));
  assert.ok(!html.includes('<th>Decision</th>'), 'the table no longer shows');
});

test('plan-page shows only the big Defaults rows and the picks marked (look) or (answer), then counts the rest, when the table has an Impact column', () => {
  const { dir, run } = sandbox();
  const plan = `# Plan\n\nStatus: planning\n\n${brief()}## Defaults\n\n| Decision | Pick | Alternative | Word | Impact |\n| --- | --- | --- | --- | --- |\n| Button color | Blue | Green | green | detail |\n| Storage | One file | A database | database | big |\n| Sort order | Newest first | Oldest first | oldest | small |\n| Retries | Three (look) | One | one retry | small |\n`;
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const picked = read(root, 'docs/plans/artifacts/plan.html').split('<h2>Picked for you</h2>')[1];
  assert.match(picked, /^<ul class="picks"><li>Storage<ul>.*?<\/ul><\/li><li>Retries<ul>.*?<\/ul><\/li><\/ul><p class="more">2 other picks stay in the plan file\.<\/p>/);
  assert.ok(!picked.includes('Button color') && !picked.includes('Sort order'), 'a small or detail pick with no level stays in the plan file');
});

test('plan-page shows only the picks marked (look) or (answer) from a Defaults table that rates no impact', () => {
  const { dir, run } = sandbox();
  const plan = `# Plan\n\nStatus: planning\n\n${brief()}## Defaults\n\n| Decision | Pick | Alternative | Word |\n| --- | --- | --- | --- |\n| Sort order | Newest first | Oldest first | oldest |\n| Retries | Three (look) | One | one retry |\n`;
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const picked = read(root, 'docs/plans/artifacts/plan.html').split('<h2>Picked for you</h2>')[1];
  assert.match(picked, /^<ul class="picks"><li>Retries<ul>.*?<\/ul><\/li><\/ul><p class="more">1 other pick stays in the plan file\.<\/p>/);
});

test('plan-page refuses an open plan whose Defaults impact is not big or small', () => {
  const { dir, run } = sandbox();
  const plan = `# Plan\n\nStatus: planning\n\n${brief()}## Defaults\n\n| Decision | Pick | Alternative | Word | Impact |\n| --- | --- | --- | --- | --- |\n| Storage | One file | A database | database | high |\n`;
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md', '--check'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /## Defaults in .* gives "Storage" the impact "high"; write big or small/);
});

test('plan-page shows a Teach picture inline, with one viewer for the whole page', () => {
  const { dir, run } = sandbox();
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg>';
  const plan = `# Plan\n\nStatus: planning\n\n${brief()}## Demo\n\n1. Open the page. ![after](after.svg)\n\n## Teach\n\nA page is the one place the owner reads.\n\n![before](before.svg) ![after](after.svg)\n`;
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan, 'docs/plans/before.svg': svg, 'docs/plans/after.svg': svg } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const html = read(root, 'docs/plans/artifacts/plan.html');
  const teach = html.slice(html.indexOf('<h2>How it works</h2>'), html.indexOf('</section>', html.indexOf('<h2>How it works</h2>')));
  assert.match(teach, /<div class="shots"><figure class="shot"><img src="data:image\/svg\+xml;base64,[^"]+" alt="Before"><figcaption>Before<\/figcaption><\/figure><figure class="shot"><img src="data:image\/svg\+xml;base64,/);
  assert.equal(html.split('<dialog class="lightbox">').length - 1, 1, 'Demo and Teach share one viewer');
});

test('plan-page refuses an open plan whose Teach runs past three paragraphs', () => {
  const { dir, run } = sandbox();
  const plan = `# Plan\n\nStatus: planning\n\n${brief()}## Teach\n\nOne.\n\nTwo.\n\nThree.\n\nFour.\n`;
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md', '--check'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /## Teach in .* runs 4 paragraphs and 4 words, where 3 paragraphs and 160 words are the most/);
});

test('plan-page refuses an open plan whose Teach runs past 160 words in three paragraphs', () => {
  const { dir, run } = sandbox();
  const paragraph = (words) => Array.from({ length: words }, () => 'word').join(' ');
  const plan = `# Plan\n\nStatus: planning\n\n${brief()}## Teach\n\n${paragraph(60)}\n\n${paragraph(60)}\n\n${paragraph(41)}\n`;
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md', '--check'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /## Teach in .* runs 3 paragraphs and 161 words/);
});

test('plan-page refuses an open plan whose Teach puts a picture inside a sentence', () => {
  const { dir, run } = sandbox();
  const plan = `# Plan\n\nStatus: planning\n\n${brief()}## Teach\n\nThe page looks like this ![after](after.svg) now.\n`;
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md', '--check'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /## Teach in .* puts a picture inside a sentence/);
});

test('plan-page refuses an open plan whose Teach holds a code block', () => {
  const { dir, run } = sandbox();
  const plan = `# Plan\n\nStatus: planning\n\n${brief()}## Teach\n\nIt draws the page.\n\n\`\`\`js\nrender(page);\n\`\`\`\n`;
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md', '--check'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /## Teach in .* holds code \`\`\`js/);
});

test('plan-page renders an open question as a decision memo the owner answers in chat: why it needs you, the facts, each option with what happens and its cost, the pick marked, and its reason', () => {
  const { dir, run } = sandbox();
  const plan = `# Plan\n\nStatus: planning\n\n${brief()}## Open questions\n\n${MEMO}`;
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const html = read(root, 'docs/plans/artifacts/plan.html');
  const needs = html.slice(html.indexOf('Needs you'));
  const order = ['Build the memo now?', 'The renderer is shared by every project.', 'Another session changed it this morning.', 'I build it today.', 'A design mistake shows up after the build.', 'The prototype settled the design.', 'Nothing changes.', 'Needs you stays hard to read.'];
  order.forEach((text) => assert.ok(needs.includes(text), `the memo shows "${text}"`));
  assert.match(needs, /<li class="pick"><b>Build now<\/b> <span class="mine">my pick<\/span> I build it today\./, 'my pick is marked');
  assert.ok(!needs.includes('<input') && !needs.includes('<button'), 'the page holds no form to answer in');
});

test('plan-page refuses an open question that skips a memo part, accepts one with no pick, and renders an executed plan\'s old question', () => {
  const { dir, run } = sandbox();
  const render = (root) => run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  const old = '### Ship\n\nShip it?\n\n- **ship** (recommended): ship.\n- **hold**: wait.\n';
  const refused = render(project(dir, 'old', { files: { 'docs/plans/plan.md': `# Plan\n\nStatus: planning\n\n${brief()}## Open questions\n\n${old}` } }));
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /"Ship" in docs\/plans\/plan\.md needs Why it needs you:, a Cost: on every option, Why I pick it: and Attention: safe, look or answer/);
  const noPick = MEMO.replace(' (recommended)', '').replace('\nWhy I pick it: The prototype settled the design.\n', '').replace('I build the memo renderer.', 'go leaves this open.');
  const accepted = render(project(dir, 'nopick', { files: { 'docs/plans/plan.md': `# Plan\n\nStatus: planning\n\n${brief()}## Open questions\n\n${noPick}` } }));
  assert.equal(accepted.status, 0, accepted.stderr);
  const executed = project(dir, 'executed', { files: { 'docs/plans/plan.md': `# Plan\n\nStatus: executed\n\n## Open questions\n\n${old}\n## Close\n\n- Shipped.\n` } });
  assert.equal(render(executed).status, 0);
  assert.ok(read(executed, 'docs/plans/artifacts/plan.html').includes('Ship it?'), 'an executed plan keeps its old question');
  const legacy = project(dir, 'legacy', { files: { 'docs/plans/plan.md': `# Plan\n\n## Open questions\n\n${old}\n### Resolve before planning\n\n- Should the doc ship alone, or\n  with an appendix?\n` } });
  assert.equal(render(legacy).status, 0, 'a plan with no Status: line keeps its old question');
  assert.ok(read(legacy, 'docs/plans/artifacts/plan.html').includes('Should the doc ship alone, or with an appendix?'), 'a question with no options renders its text whole');
});

test("plan-page shows the subject's page-lead section, marked current, when the open plan has none", () => {
  const { dir, run } = sandbox();
  const topic = '# Workflow\n\nPage: https://example.test/page\n\n## What other editors do\n\n- Lexical keeps it in the node.\n\n## Main changes\n\n- Pages follow subjects.\n';
  const second = '# Second pass\n\nStatus: planning\nTopic: workflow\n\n## Main changes\n\n- Moves the owner.\n' + brief();
  const root = project(dir, 'app', { files: { '.agents/playbooks/plan.md': playbook('page-lead: What other editors do\n'), 'docs/plans/topics/workflow.md': topic, 'docs/plans/2026-02-01-second.md': second } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-02-01-second.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const text = read(root, 'docs/plans/artifacts/topics/workflow.html').replace(/<[^>]+>/gu, '');
  assert.match(text, /What other editors do current\s*Lexical keeps it in the node\./);
  assert.ok(text.indexOf('Lexical keeps it') < text.indexOf('Moves the owner.') && !text.includes('Pages follow subjects'), "the plan's changes show, and the subject's own Main changes stays in its file");
});

test('plan-page refuses code in an open plan\'s brief, questions or defaults, and renders an executed plan that has it', () => {
  const { dir, run } = sandbox();
  const render = (root) => run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  const coded = brief().replace('Old plans need a brief.', 'Old plans need a `## Brief`.');
  const open = render(project(dir, 'open', { files: { 'docs/plans/plan.md': `# Plan\n\nStatus: planning\n\n${coded}` } }));
  assert.equal(open.status, 1);
  assert.match(open.stderr, /## Brief in docs\/plans\/plan\.md holds code `## Brief`; the page shows this section, so write it in plain words/);
  const executed = render(project(dir, 'executed', { files: { 'docs/plans/plan.md': `# Plan\n\nStatus: executed\n\n${coded}## Close\n\n- Shipped.\n` } }));
  assert.equal(executed.status, 0, executed.stderr);
});

test('plan-page keeps the open questions in plan order and says what go does for a question with no pick', () => {
  const { dir, run } = sandbox();
  const safe = MEMO.replace('### Build', '### Safe one').replace('Build the memo now?', 'Ship the safe part now?').replace('Attention: look', 'Attention: safe');
  const open = '### Order\n\nWhich page moves first?\n\nWhy it needs you: I have no reason to prefer one.\n\n- **History**: I move history today. Cost: Reads waits.\n- **Reads**: I move reads today. Cost: History waits.\n\nIf you say go: go leaves this question open.\n';
  const plan = `# Plan\n\nStatus: planning\n\n${brief()}## Open questions\n\n${safe}\n${open}`;
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const html = read(root, 'docs/plans/artifacts/plan.html');
  assert.ok(html.indexOf('Ship the safe part now?') < html.indexOf('Which page moves first?'), 'a question with no pick does not jump ahead');
  assert.ok(html.includes('<p class="nopick">go leaves this question open.</p>'));
});

test('plan-page refuses an open question with a pick but no Attention line, or two picks', () => {
  const { dir, run } = sandbox();
  const render = (name, memo) => run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], project(dir, name, { files: { 'docs/plans/plan.md': `# Plan\n\nStatus: planning\n\n${brief()}## Open questions\n\n${memo}` } }));
  const unrated = render('unrated', MEMO.replace('\nAttention: look\n', ''));
  assert.equal(unrated.status, 1);
  assert.match(unrated.stderr, /"Build" in docs\/plans\/plan\.md needs Attention: safe, look or answer/);
  const twoPicks = render('two', MEMO.replace('- **Hold**:', '- **Hold** (recommended):'));
  assert.equal(twoPicks.status, 1);
  assert.match(twoPicks.stderr, /needs at most one \(recommended\) option/);
});

test('plan-page ends a superseded plan\'s rail at its status word instead of Ship', () => {
  const { dir, run } = sandbox();
  const plan = '# Plan\n\nStatus: superseded by the next plan\n\n## Main changes\n\n- Draw the rail.\n';
  const log = ['ts\tphase\tdecision\twhy\tevidence\tresult', reviewRow('build', 'Port the rail', 'fixed')].join('\n');
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan, 'docs/plans/plan.decisions.tsv': `${log}\n` } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const rail = [...read(root, 'docs/plans/artifacts/plan.html').matchAll(/<li class="fs (\w+)"[^>]*>(.*?)<\/li>/gu)].map(([, state, body]) => `${state}:${body.replace(/<[^>]+>/gu, '')}`);
  assert.deepEqual(rail.slice(3, 6), ['done:Build', 'stopped:Superseded', 'skipped:Writing']);
  assert.ok(rail.includes('skipped:Ship'), 'a superseded plan never shows Ship as done');
});

test('plan-page refuses an open plan that leads its page without a brief, and renders executed plans and plans it does not lead without one', () => {
  const { dir, run } = sandbox();
  const render = (root, plan) => run(process.execPath, [join(HELPERS, 'plan-page.mjs'), plan], root);
  const open = project(dir, 'open', { files: { 'docs/plans/plan.md': '# Plan\n\nStatus: planning\n\n## Main changes\n\n- Moves the owner.\n' } });
  const refused = render(open, 'docs/plans/plan.md');
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /docs\/plans\/plan\.md leads its page while open, so it needs a ## Brief/);
  const executed = project(dir, 'executed', { files: { 'docs/plans/plan.md': '# Plan\n\nStatus: executed\n\n## Main changes\n\n- Moved the owner.\n' } });
  assert.equal(render(executed, 'docs/plans/plan.md').status, 0);
  const reopened = project(dir, 'reopened', { files: { 'docs/plans/plan.md': '# Plan\n\nStatus: reopened after the fold\n\n## Main changes\n\n- Moves the owner again.\n' } });
  assert.equal(render(reopened, 'docs/plans/plan.md').status, 1, 'a reopened plan owes its brief again');
  const topic = '# Workflow\n\n## Main changes\n\n- Pages follow subjects.\n';
  const older = '# Older\n\nStatus: planning\nTopic: workflow\n\n## Main changes\n\n- An older open pass.\n';
  const newer = `# Newer\n\nStatus: planning\nTopic: workflow\n\n${brief()}## Main changes\n\n- The newer pass.\n`;
  const subject = project(dir, 'subject', { files: { 'docs/plans/topics/workflow.md': topic, 'docs/plans/2026-01-01-older.md': older, 'docs/plans/2026-02-01-newer.md': newer } });
  const result = render(subject, 'docs/plans/2026-02-01-newer.md');
  assert.equal(result.status, 0, result.stderr);
  const leading = render(subject, 'docs/plans/2026-01-01-older.md');
  assert.equal(leading.status, 1, 'the older open plan owes a brief once it leads its own render');
  assert.match(leading.stderr, /docs\/plans\/2026-01-01-older\.md leads its page while open, so it needs a ## Brief/);
});

test('plan-page refuses a brief that skips or reorders a question, leaves one empty or runs long', () => {
  const { dir, run } = sandbox();
  const cases = [
    [BRIEF_ANSWERS.slice(0, 1), /asks .* but it needs a ## Brief/],
    [[BRIEF_ANSWERS[1], BRIEF_ANSWERS[0]], /asks .* but it needs a ## Brief/],
    [BRIEF_ANSWERS.map(([question, answer], index) => [question, index === 1 ? '' : answer]), /leaves "What could go wrong\?" unanswered/],
    [BRIEF_ANSWERS.map(([question, answer], index) => [question, index === 0 ? 'word '.repeat(41) : answer]), /answers "What will change\?" in 41 words; keep each answer to 40/],
    [FIVE_ROW_BRIEF, /drop "What did you find\?", "What do you need from me\?" and "What happens if I say go\?"; an ask that is not a decision goes on the Status: line/],
  ];
  for (const [index, [answers, message]] of cases.entries()) {
    const root = project(dir, `case-${index}`, { files: { 'docs/plans/plan.md': `# Plan\n\nStatus: planning\n\n${brief(answers)}` } });
    const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md', '--check'], root);
    assert.equal(result.status, 1, `case ${index} renders`);
    assert.match(result.stderr, message);
  }
});

test("plan-page shows an open plan's Status sentence in the page header", () => {
  const { dir, run } = sandbox();
  const plan = `# Plan\n\nStatus: waiting on your answer, then your commit of the guide\n\n${brief()}## Open questions\n\n${MEMO}`;
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const header = read(root, 'docs/plans/artifacts/plan.html').match(/<header[\s\S]*?<\/header>/u)?.[0] ?? '';
  assert.match(header.replace(/<[^>]+>/gu, ''), /Waiting on your answer, then your commit of the guide/);
});

test("plan-page shows only Changes and Risks from an executed plan's five-row brief", () => {
  const { dir, run } = sandbox();
  const plan = `# Plan\n\nStatus: executed\n\n${brief(FIVE_ROW_BRIEF)}## Main changes\n\n- Moved the owner.\n`;
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const card = read(root, 'docs/plans/artifacts/plan.html').match(/<section class="brief card">[\s\S]*?<\/section>/u)?.[0] ?? '';
  assert.deepEqual([...card.matchAll(/<h2[^>]*>([^<]+)<\/h2>/gu)].map((match) => match[1]), ['Changes', 'Risks']);
  assert.ok(!card.includes('Pick build or hold.') && !card.includes('The renderer changes.'), 'the cut rows stay in the plan file');
});

test("plan-page shows only the leading plan's own review round on a brief page", () => {
  const { dir, run } = sandbox();
  const topic = '# Workflow\n\n## Main changes\n\n- Pages follow subjects.\n';
  const older = '# Older\n\nStatus: executed\nTopic: workflow\n\n## Main changes\n\n- An older pass.\n';
  const log = 'ts\tphase\tdecision\twhy\tevidence\tresult\n2026-01-01T00:00:00Z\tpanel\tseats opus\tround 1\tcommit abc\trecorded: answered\n';
  const newer = `# Newer\n\nStatus: planning\nTopic: workflow\n\n${brief()}`;
  const root = project(dir, 'app', {
    files: {
      'docs/plans/topics/workflow.md': topic,
      'docs/plans/2026-01-01-older.md': older,
      'docs/plans/2026-01-01-older.decisions.tsv': log,
      'docs/plans/2026-02-01-newer.md': newer,
    },
  });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-02-01-newer.md'], root);
  assert.equal(result.status, 0, result.stderr);
  const html = read(root, 'docs/plans/artifacts/topics/workflow.html');
  assert.ok(!html.slice(html.indexOf('<header'), html.indexOf('</header>')).includes('Review round'), 'the header names no other plan\'s round');
});

test('plan-page --index leads a subject page with the same-day iteration whose log moved last', () => {
  const { dir, run } = sandbox();
  const plan = (title) => `# ${title}\n\nStatus: executed\nTopic: workflow\n\n## Main changes\n\n- ${title} work.\n\n## Close\n\n- Closed ${title}.\n`;
  const log = (stamp) => `ts\tphase\tdecision\twhy\tevidence\tresult\n${stamp}\tbuild\tdid it\twhy\tevidence\trecorded\n`;
  const root = project(dir, 'app', {
    files: {
      'docs/plans/topics/workflow.md': '# Workflow\n\n## Main changes\n\n- Pages follow subjects.\n',
      'docs/plans/2026-01-01-alpha.md': plan('alpha'),
      'docs/plans/2026-01-01-alpha.decisions.tsv': log('2026-01-01T18:00:00Z'),
      'docs/plans/2026-01-01-beta.md': plan('beta'),
      'docs/plans/2026-01-01-beta.decisions.tsv': log('2026-01-01T09:00:00Z'),
    },
  });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), '--index'], root);
  assert.equal(result.status, 0, result.stderr);
  const page = read(root, 'docs/plans/artifacts/topics/workflow.html');
  assert.ok(page.includes('Closed alpha') && !page.includes('Closed beta'), 'the iteration whose log moved last leads');
});

test("plan-page reads a subject iteration's state from the first word of its Status", () => {
  const { dir, run } = sandbox();
  const status = (line) => {
    const root = deltaProject(mkdtempSync(join(dir, 'case-')), DELTA_TOPIC, DELTA_PLAN.replace('Status: planning', `Status: ${line}`));
    return { ...run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-landing.md'], root), root };
  };
  const unknown = status('Not done yet');
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /needs a Status: line that starts with a state word/);
  const reopened = status('Re-opened after the execution review');
  assert.equal(reopened.status, 0, reopened.stderr);
});

test('plan-page --index leads a subject page with the dated open iteration over an undated issue plan', () => {
  const { dir, run } = sandbox();
  const root = deltaProject(dir, DELTA_TOPIC, DELTA_PLAN);
  writeFileSync(join(root, 'docs/plans/4731-old-issue.md'), '# Old issue\n\nStatus: planning\nTopic: drag\n\n## Main changes\n\n- Old work.\n' + brief());
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), '--index'], root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(read(root, 'docs/plans/artifacts/topics/drag.html'), /<span>Plan <strong>Landing<\/strong>/);
});

test('plan-open --done sweeps an executed plan that still has an open box', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', { files: { 'docs/plans/2026-01-01-shipped.md': '# Shipped\n\nStatus: executed, awaiting review\n\n- [ ] Close the gate\n', 'docs/plans/2026-01-02-gone.md': '# Gone\n\nStatus: superseded by shipped\n\n- [ ] Never done\n' } });
  const result = run(process.execPath, [join(HELPERS, 'plan-open.mjs'), '--done'], root);
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /2026-01-01-shipped\.md/);
  assert.doesNotMatch(result.stdout + result.stderr, /2026-01-02-gone\.md/);
});

test('plan-page refuses a subject file that keeps a before and after pair', () => {
  const { dir, run } = sandbox();
  const topic = DELTA_TOPIC.replace('```ts\nold();\n```', '```ts before\nold();\n```\n\n```ts after\nnext();\n```');
  const root = deltaProject(dir, topic, DELTA_PLAN);
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/2026-01-01-landing.md'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Public API in docs\/plans\/topics\/drag\.md holds the current state as plain fences/);
});

test('plan-page reads a Delta column as a plain table on a one-off plan', () => {
  const { dir, run } = sandbox();
  const plan = '# Audit\n\nStatus: done\n\n## Notes\n\n| Delta | Owner |\n| --- | --- |\n| DOM ledger | Plite |\n';
  const root = project(dir, 'app', { files: { 'docs/plans/plan.md': plan } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/plan.md'], root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(read(root, 'docs/plans/artifacts/plan.html'), /<td>DOM ledger<\/td>/);
});

test('plan-open fails a gate row that leaves Applies, evidence or another column pending', () => {
  const { dir, run } = sandbox();
  const plan = '# Plan\n\nCompletion Gates:\n| Gate | Applies | Required action | Evidence |\n|---|---|---|---|\n| Package proof | yes | Run the package proof | `bun test ./a.test.ts` passed |\n| Scale proof | pending | Run the probe | pending |\n';
  const root = project(dir, 'app', { files: { 'plan.md': plan } });
  const result = run(process.execPath, [join(HELPERS, 'plan-open.mjs'), 'plan.md'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /plan\.md:7: .*Scale proof/);
  assert.doesNotMatch(result.stderr, /Package proof/);
});

test('plan-open makes a newly closed box name its artifact and a deferred finding name its owner and stop', () => {
  const { dir, run } = sandbox();
  const legacy = '# Plan\n\nStatus: In progress.\n\n- [x] shipped long ago\n';
  const root = project(dir, 'app', { files: { 'plan.md': legacy } });
  run('git', ['add', '.'], root);
  run('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'plan'], root);
  const check = () => run(process.execPath, [join(HELPERS, 'plan-open.mjs'), 'plan.md'], root);

  writeFileSync(join(root, 'plan.md'), `${legacy}- [x] writing passes ran\n- [x] tests pass: \`bun test ./src/a.test.ts\`\n- [x] docs: skip: no docs changed\n\n## Deferred\n\n- schema check\n- ledger merge, owner: issue-harvester in docs/plans/next.md, stop: when the merged ledger's check passes\n`);
  const result = check();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /plan\.md:6: .*writing passes ran/);
  assert.match(result.stderr, /plan\.md:12: .*schema check/);
  assert.doesNotMatch(result.stderr, /:5:|:7:|:8:|:13:/);
});

test('plan-open reads a closed box artifact from a line indented directly under it', () => {
  const { dir, run } = sandbox();
  const legacy = '# Plan\n\nStatus: In progress.\n\n- [x] shipped long ago\n';
  const root = project(dir, 'app', { files: { 'plan.md': legacy } });
  run('git', ['add', '.'], root);
  run('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'plan'], root);

  writeFileSync(join(root, 'plan.md'), `${legacy}- [x] step one\n  Closed by \`scripts/check.mjs\`.\n- [x] step two\n\n  Closed by \`scripts/other.mjs\`.\n`);
  const result = run(process.execPath, [join(HELPERS, 'plan-open.mjs'), 'plan.md'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /plan\.md:8: .*step two \(name the artifact/);
  assert.doesNotMatch(result.stderr, /plan\.md:6:/);
});

test('plan-open does not let a closed box borrow a nested box artifact', () => {
  const { dir, run } = sandbox();
  const legacy = '# Plan\n\nStatus: In progress.\n\n';
  const root = project(dir, 'app', { files: { 'plan.md': legacy } });
  run('git', ['add', '.'], root);
  run('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'plan'], root);

  writeFileSync(join(root, 'plan.md'), `${legacy}- [x] finish A\n  - [x] finish B \`scripts/b.mjs\`\n`);
  const result = run(process.execPath, [join(HELPERS, 'plan-open.mjs'), 'plan.md'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /plan\.md:5: .*finish A \(name the artifact/);
  assert.doesNotMatch(result.stderr, /plan\.md:6:/);
});

test('plan-open does not take a closing artifact from an indented line committed before the box closed', () => {
  const { dir, run } = sandbox();
  const before = '# Plan\n\nStatus: In progress.\n\n- [ ] step one\n  Proof: `pnpm test x`\n';
  const root = project(dir, 'app', { files: { 'plan.md': before } });
  run('git', ['add', '.'], root);
  run('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'plan'], root);

  writeFileSync(join(root, 'plan.md'), before.replace('- [ ] step one', '- [x] step one'));
  const result = run(process.execPath, [join(HELPERS, 'plan-open.mjs'), 'plan.md'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /plan\.md:5: .*step one \(name the artifact/);
});

test('plan-open makes a closed Open work box name its owner and stop when its artifact is on an indented line', () => {
  const { dir, run } = sandbox();
  const legacy = '# Plan\n\nStatus: In progress.\n\n## Open work\n\n';
  const root = project(dir, 'app', { files: { 'plan.md': legacy } });
  run('git', ['add', '.'], root);
  run('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'plan'], root);

  writeFileSync(join(root, 'plan.md'), `${legacy}- [x] ledger merge\n  Closed by \`scripts/merge.mjs\`.\n- [x] schema check, owner: zbeyens\n  Closed by \`scripts/check.mjs\`, stop: 2026-11-08.\n`);
  const result = run(process.execPath, [join(HELPERS, 'plan-open.mjs'), 'plan.md'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /plan\.md:7: .*ledger merge \(name its owner:/);
  assert.doesNotMatch(result.stderr, /plan\.md:9:/);
});

test('plan-open makes an Open work item added since HEAD name its owner and its stop', () => {
  const { dir, run } = sandbox();
  const legacy = '# Plan\n\nStatus: In progress.\n\n## Open work\n\n- old backlog item\n';
  const root = project(dir, 'app', { files: { 'plan.md': legacy } });
  run('git', ['add', '.'], root);
  run('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'plan'], root);

  writeFileSync(join(root, 'plan.md'), `${legacy}- split the ledger, owner: lead in docs/plans/topics/ledger.md\n- drop the dossier, owner: lead in docs/plans/topics/ledger.md, stop: when slate mode is retired\n`);
  const result = run(process.execPath, [join(HELPERS, 'plan-open.mjs'), 'plan.md'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /plan\.md:8: .*split the ledger.*stop:/);
  assert.doesNotMatch(result.stderr, /:7:|:9:/);
});

test('decisions-check and plan-open judge rows and boxes since PSTACK_BASE, and refuse a base that names no commit', () => {
  const { dir, env: clean, run } = sandbox();
  const header = 'ts\tphase\tdecision\twhy\tevidence\tresult';
  const root = project(dir, 'app', { files: { 'log.decisions.tsv': `${header}\n`, 'plan.md': '# Plan\n\nStatus: building\n' } });
  run('git', ['add', '.'], root);
  run('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'intake'], root);
  const base = run('git', ['rev-parse', 'HEAD'], root).stdout.trim();
  writeFileSync(join(root, 'log.decisions.tsv'), `${header}\n2026-09-02T00:00:00Z\tbuild\tfix\twhy\tscope: x; docs/plans/artifacts/run/gone-a1.log\tverified\n`);
  writeFileSync(join(root, 'plan.md'), '# Plan\n\nStatus: building\n\n- [x] tests: `docs/plans/artifacts/run/gone-a1.log`\n');
  run('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qam', 'owner sweep'], root);
  const check = (script, file, env) => spawnSync(process.execPath, [join(HELPERS, script), file], { cwd: root, encoding: 'utf8', env: { ...clean, ...env } });

  assert.equal(check('decisions-check.mjs', 'log.decisions.tsv', {}).status, 0, 'against HEAD the swept row looks committed');
  assert.match(check('decisions-check.mjs', 'log.decisions.tsv', { PSTACK_BASE: base }).stderr, /gone-a1\.log, which does not exist/);
  assert.match(check('plan-open.mjs', 'plan.md', { PSTACK_BASE: base }).stderr, /gone-a1\.log, which does not exist/);
  assert.equal(check('plan-open.mjs', 'plan.md', { PSTACK_BASE: '0'.repeat(40) }).status, 1, 'an unresolvable base fails closed');
  assert.equal(check('decisions-check.mjs', 'log.decisions.tsv', { PSTACK_BASE: '' }).status, 1, 'an empty base fails closed');
});

test('plan-open refuses a newly closed box whose cited proof is missing or records no exit status', () => {
  const { dir, run } = sandbox();
  const legacy = '# Plan\n\nStatus: building\n\n- [x] old step: `docs/plans/artifacts/run/gone-a1.log`\n';
  const root = project(dir, 'app', {
    files: {
      'plan.md': legacy,
      'docs/plans/artifacts/run/pass-a1.log': '$ (.) node --test\nok\nexit=0\n',
      'docs/plans/artifacts/run/bare-a1.log': 'ok 1 - parser\n',
    },
  });
  run('git', ['add', 'plan.md'], root);
  run('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'plan'], root);
  const check = (lines) => {
    writeFileSync(join(root, 'plan.md'), `${legacy}${lines}`);
    return run(process.execPath, [join(HELPERS, 'plan-open.mjs'), 'plan.md'], root);
  };

  assert.equal(check('- [x] tests pass: `docs/plans/artifacts/run/pass-a1.log`\n').status, 0, 'an existing log that records its exit, and a committed box citing a gone log');
  assert.match(check('- [x] typecheck: `docs/plans/artifacts/run/typecheck-a1.log`\n').stderr, /typecheck-a1\.log, which does not exist/);
  assert.match(check('- [x] lint: `docs/plans/artifacts/run/bare-a1.log`\n').stderr, /bare-a1\.log, which records no exit status/);
  assert.match(check('- [x] tests: `node --test`\n  Log: `docs/plans/artifacts/run/missing-a1.log`\n').stderr, /plan\.md:6: .*missing-a1\.log, which does not exist/, 'a citation on an indented line under the box');
  assert.match(check('- [x] parent: `docs/plans/artifacts/run/missing-a1.log`\n  - [x] child: `docs/plans/artifacts/run/pass-a1.log`\n').stderr, /plan\.md:6: .*missing-a1\.log, which does not exist/, 'a parent box before a nested closed box');
  assert.match(check('- [x] dotted: `./docs/plans/artifacts/run/missing-a1.log`\n').stderr, /missing-a1\.log, which does not exist/, 'a citation that starts with ./');
});

test('plan-open accepts a log with a line that reads exactly exit=<code> and refuses every other exit form', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', { files: { 'plan.md': '# Plan\n\nStatus: building\n' } });
  run('git', ['add', 'plan.md'], root);
  run('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'plan'], root);
  const verdict = (log) => {
    writeFileSync(join(root, 'docs/plans/artifacts/run/x-a1.log'), log);
    writeFileSync(join(root, 'plan.md'), '# Plan\n\nStatus: building\n\n- [x] step: `docs/plans/artifacts/run/x-a1.log`\n');
    return run(process.execPath, [join(HELPERS, 'plan-open.mjs'), 'plan.md'], root).status;
  };
  mkdirSync(join(root, 'docs/plans/artifacts/run'), { recursive: true });

  for (const [log, why] of [
    ['$ (.) missing-command\nexit=ENOENT\n', 'a spawn error'],
    ['$ (wt) node apply.mjs\n  write AGENTS.md\nexit=0\nleaked notes: 0\n', 'an exit line mid-file'],
    [`$ (.) node test.mjs\n${'x'.repeat(5000)}\nexit=0\n${'x'.repeat(70_000)}\n`, 'an exit line past the first 64 KB chunk'],
  ]) assert.equal(verdict(log), 0, why);
  for (const [log, why] of [
    ['$ (.) node check.mjs && echo exit=0\npartial output\n', 'exit=0 inside the command line'],
    ['$ (.) node test.mjs\nok 1 - handles exit=0\nprocess crashed\n', 'a test title'],
    ['$ (.) node check.mjs\nexpected exit=0\n', 'an exit named at the end of a sentence'],
    ['$ (.) node check.mjs\nchild exited with code 0\n', 'an exited-with sentence'],
    ['$ node check.mjs\n# exit 1\n', 'a commented exit'],
    ['Ran 1 test across 1 file.\nexit=1 seconds=67\n', 'an exit line with trailing fields'],
    ['> www typecheck\nExit status 1\n', "pnpm's exit status line"],
  ]) assert.equal(verdict(log), 1, why);
});

const prPlan = (fields, body = '') =>
  `# PR\n\nStatus: executed\nPlaybook: feature\n${fields}\n${brief()}## Teach\n\nThe page is the plan.\n\n## Demo\n\n1. Open the page. ![after](shots/after.png)\n2. Scroll down. ![before](https://github.com/user-attachments/assets/v1)\n\n## Defaults\n\n| Decision | Pick | Alternative | Word | Impact |\n| --- | --- | --- | --- | --- |\n| Body shape | The page | A hand-written body | hand body | big |\n\n## Public API\n\n\`\`\`ts before\nold()\n\`\`\`\n\n\`\`\`ts after\nnext()\n\`\`\`\n\n## Main changes\n\n- Moves the owner.\n\n## Steps\n\n- [x] Build it. Proof: the test.\n${body}`;

test('plan-page --pr writes the models, brief, frames, picks and API diff between markers', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', {
    files: {
      'docs/plans/pr.md': prPlan('', '\n## Design\n\nInternal only.\n\n## Notes\n\nLeft in the plan.\n'),
      'docs/plans/shots/after.png': 'png',
      'docs/plans/pr.decisions.tsv': LOG_HEAD + logRow('lead', 'claude-opus-5-5 @xhigh') + logRow('panel', 'seats claude-opus-5-5 @high, codex:gpt-6.1-sol @xhigh missing') + logRow('build', 'built it') + logRow('writing', 'deslop and unslop') + logRow('panel', 'seats claude-opus-5-5 @high, codex:gpt-6.1-sol @xhigh missing'),
    },
  });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/pr.md', '--pr'], root);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split('\n').slice(1), ['--attach ./docs/plans/shots/after.png']);
  const body = read(root, 'docs/plans/artifacts/pr.pr.md');
  assert.ok(
    body.startsWith('<!-- plan-page:start -->\n- `claude-opus-5-5 xhigh` · `feature` · not run: design, verify, audit\n  - `claude-opus-5-5` `high` ×2\n  - `gpt-6.1-sol` `xhigh` missing ×2\n\nIt opens with a brief.\n\n> [!CAUTION]\n> Old plans need a brief.\n'),
    'each lead with the playbook and the checks that did not run, its seats with their rounds, then Changes and Risks'
  );
  assert.match(body, /\n1\. Open the page\.\n\nAfter\n\n<!-- frame: \.\/docs\/plans\/shots\/after\.png -->\n!\[after\]\(\.\/docs\/plans\/shots\/after\.png\)\n/);
  assert.match(body, /\n2\. Scroll down\.\n\nBefore\n\nhttps:\/\/github\.com\/user-attachments\/assets\/v1\n/);
  assert.ok(body.includes('\n## Decisions\n\n- Body shape\n  - **The page**\n  - A hand-written body (alt)\n'));
  assert.match(body, /\n```diff\n-old\(\)\n\+next\(\)\n```\n/);
  assert.doesNotMatch(body, /Left in the plan|Internal only|Moves the owner|Status:/, 'engineer sections and the Status line stay in the plan');
  assert.ok(body.indexOf('## How it works') < body.indexOf('## Demo') && body.indexOf('## Decisions') < body.indexOf('## Public API'));
  assert.ok(body.endsWith('\n## Plans\n\n- PR (`docs/plans/pr.md`)\n\n<!-- plan-page:end -->\n'));
  assert.equal(run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/pr.md'], root).status, 0);
  assert.match(read(root, 'docs/plans/artifacts/pr.html'), /<a href="https:\/\/github\.com\/user-attachments\/assets\/v1">/, 'the page links a frame it cannot inline');
});

test("plan-page --pr --public leaves out the run's models and stages, open questions, Defaults and plan link", () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', {
    files: {
      'docs/plans/pr.md': prPlan('', '\n## Open questions\n\n- Keep the old name?\n'),
      'docs/plans/shots/after.png': 'png',
      'docs/plans/pr.decisions.tsv': LOG_HEAD + logRow('lead', 'claude-opus-5-5 @xhigh') + logRow('build', 'built it'),
      '.agents/playbooks/custom.md': playbook('page-lead: Defaults, Open questions\npage-pr: Defaults, Open questions\n'),
    },
  });
  const render = (...flags) => run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/pr.md', ...flags], root);
  assert.equal(render('--pr', '--public').status, 0);
  const body = read(root, 'docs/plans/artifacts/pr.pr.md');
  assert.ok(body.startsWith('<!-- plan-page:start -->\n\nIt opens with a brief.\n'), 'the body opens with the brief');
  assert.doesNotMatch(body, /claude-opus|`feature`|not run:|## Open questions|## Decisions|## Plans|docs\/plans\/pr\.md/);
  assert.match(body, /\n## Demo\n[\s\S]*\n```diff\n-old\(\)\n\+next\(\)\n```\n/, 'what a reviewer reads stays');
  assert.equal(render('--public').status, 2, '--public shapes only a PR body');
  writeFileSync(join(root, 'docs/plans/pr.md'), read(root, 'docs/plans/pr.md').replace('Playbook: feature', 'Playbook: custom'));
  assert.equal(render('--pr', '--public').status, 0);
  assert.doesNotMatch(read(root, 'docs/plans/artifacts/pr.pr.md'), /## Defaults|## Open questions|Keep the old name|hand body/, 'a playbook that leads with those sections does not bring them back');
});

test('plan-page --pr --into replaces only its region and reuses an uploaded frame', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', { files: { 'docs/plans/pr.md': prPlan(''), 'docs/plans/shots/after.png': 'png' } });
  const uploaded = '![after](https://github.com/user-attachments/assets/abc)';
  writeFileSync(
    join(root, 'body.md'),
    `<!-- auto-release:start -->\n- [ ] Auto release\n<!-- auto-release:end -->\n\n<!-- plan-page:start -->\nOld region.\n<!-- frame: ./docs/plans/shots/after.png -->\n${uploaded}\n<!-- plan-page:end -->\n\n## Videos\n\nKept by hand.\n`
  );
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/pr.md', '--pr', '--into', 'body.md'], root);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /--attach/, 'an uploaded frame is not attached again');
  const body = read(root, 'docs/plans/artifacts/pr.pr.md');
  assert.match(body, /^<!-- auto-release:start -->\n- \[ \] Auto release\n<!-- auto-release:end -->\n\n<!-- plan-page:start -->\n`feature` · not run: /);
  assert.ok(body.includes(`<!-- frame: ./docs/plans/shots/after.png -->\n${uploaded}\n`));
  assert.doesNotMatch(body, /Old region\.|!\[after\]\(\.\//);
  assert.match(body, /<!-- plan-page:end -->\n\n## Videos\n\nKept by hand\.\n$/);
  writeFileSync(join(root, 'plain.md'), 'Hand-written body.\n');
  assert.equal(run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/pr.md', '--pr', '--into', 'plain.md'], root).status, 0);
  assert.match(read(root, 'docs/plans/artifacts/pr.pr.md'), /<!-- plan-page:end -->\n\nHand-written body\.\n$/, 'a body without the markers keeps its text below the region');
});

test('plan-page --pr folds the plans a PR plan lists into its rail and models', () => {
  const { dir, run } = sandbox();
  const child = '# A\n\nStatus: executed\nPlaybook: bug-fix\n\n## Steps\n\n- [x] One.\n- [x] Two.\n';
  const root = project(dir, 'app', {
    files: {
      'docs/plans/pr.md': prPlan('Plans: a.md'),
      'docs/plans/shots/after.png': 'png',
      'docs/plans/a.md': child,
      'docs/plans/pr.decisions.tsv': LOG_HEAD + logRow('lead', 'claude-opus-5-5 @xhigh'),
      'docs/plans/a.decisions.tsv': LOG_HEAD + logRow('lead', 'gpt-6.1-sol @xhigh') + logRow('build', 'built') + logRow('panel', 'seats gpt-6-astra @xhigh'),
    },
  });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/pr.md', '--pr'], root);
  assert.equal(result.status, 0, result.stderr);
  const body = read(root, 'docs/plans/artifacts/pr.pr.md');
  assert.ok(body.includes('\n## Plans\n\n- PR (`docs/plans/pr.md`)\n- A (`docs/plans/a.md`)\n'));
  assert.ok(
    body.includes('\n- `claude-opus-5-5 xhigh` · `feature`, `bug-fix` · not run: design, plan review, verify, audit\n- `gpt-6.1-sol xhigh`\n  - `gpt-6-astra` `xhigh`\n'),
    "the carried plan's playbook, review and lead count"
  );
  writeFileSync(join(root, 'docs/plans/pr.md'), prPlan('Plans: a.md, gone.md'));
  const missing = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/pr.md', '--pr'], root);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /lists docs\/plans\/gone\.md on its Plans: line, but that plan does not exist/);
});

test('plan-page --pr refuses a plan titled with a PR number', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', { files: { 'docs/plans/pr.md': prPlan('').replace('# PR\n', '# PR 5165 redo\n'), 'docs/plans/shots/after.png': 'png' } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/pr.md', '--pr'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /is titled "PR 5165 redo"; the PR body links its plan by title, so name the change instead of the PR/);
});

test('plan-page --pr refuses a plan without a brief, even an executed one', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', { files: { 'docs/plans/pr.md': '# PR\n\nStatus: executed\n\n## Main changes\n\n- Moves the owner.\n' } });
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/pr.md', '--pr'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /needs a ## Brief before --pr, because the PR body opens with its Changes and Risks/);
  assert.equal(run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/pr.md'], root).status, 0, 'the page still renders without a brief');
});

test("plan-page --pr shows the sections the playbook's page-pr line names, from each carried plan when the PR plan has none", () => {
  const { dir, run } = sandbox();
  const shape = '\n## Document shape\n\n```json before\n{ "level": 1 }\n```\n\n```json after\n{ "level": 2 }\n```\n\n## Layer and owner\n\nPlite owns the level.\n';
  const root = project(dir, 'app', {
    files: {
      '.agents/playbooks/plan.md': playbook('page-lead: What other editors do, Document shape, Layer and owner\npage-pairs: Document shape\npage-pr: Document shape, What other editors do\n'),
      'docs/plans/pr.md': prPlan('Plans: a.md', shape),
      'docs/plans/shots/after.png': 'png',
      'docs/plans/a.md': '# A\n\nStatus: executed\nPlaybook: plan\n\n## What other editors do\n\nLexical drops the key.\n',
    },
  });
  const pr = () => run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/pr.md', '--pr'], root);
  assert.equal(pr().status, 0);
  const body = read(root, 'docs/plans/artifacts/pr.pr.md');
  assert.ok(body.includes('\n## What other editors do\n\n### A\n\nLexical drops the key.\n'), "the carried plan's section shows under its title");
  assert.ok(body.includes('\n## Document shape\n\n```diff\n-{ "level": 1 }\n+{ "level": 2 }\n```\n'), 'a paired section shows as one diff');
  assert.ok(body.indexOf('## Public API') < body.indexOf('## What other editors do') && body.indexOf('## What other editors do') < body.indexOf('## Document shape'), 'page-lead order, after Public API');
  assert.doesNotMatch(body, /Layer and owner|Plite owns the level/, 'a section the line leaves out stays in the plan');
  writeFileSync(join(root, '.agents/playbooks/babysit.md'), playbook(''));
  writeFileSync(join(root, 'docs/plans/pr.md'), prPlan('Plans: a.md', shape).replace('Playbook: feature', 'Playbook: babysit'));
  assert.equal(pr().status, 0);
  assert.match(read(root, 'docs/plans/artifacts/pr.pr.md'), /\n## What other editors do\n\n### A\n/, "a carried plan's playbook names sections for a PR plan whose own playbook names none");
  writeFileSync(join(root, '.agents/playbooks/plan.md'), playbook('page-lead: What other editors do\npage-pr: Native behavior and proof\n'));
  const stray = pr();
  assert.equal(stray.status, 1);
  assert.match(stray.stderr, /lists Native behavior and proof on its page-pr line; the PR body shows only page-lead sections/);
});

test("plan-page --comment covers only the commits after the author's, without the clips the description already shows or what only the owner reads", () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', {
    files: {
      'docs/plans/pr.md': prPlan('', '\n## On top of the PR\n\n- Kept\n  - The title fix\n- Dropped\n  - The private scroll zone\n\n## Verification\n\n- The browser test passed.\n\n## Open work\n\n- The merge. owner: o. stop: s.\n'),
      'docs/plans/pr.decisions.tsv': LOG_HEAD + logRow('lead', 'claude-opus-5-5 @xhigh'),
      'docs/plans/shots/after.png': 'png',
      'description.md': 'The author demo: ![before](https://github.com/user-attachments/assets/v1)\n',
    },
  });
  const git = (...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root, encoding: 'utf8' });
  git('remote', 'add', 'origin', 'https://github.com/o/r.git');
  git('commit', '-q', '--allow-empty', '-m', 'author');
  const author = git('rev-parse', 'HEAD').stdout.trim();
  git('commit', '-q', '--allow-empty', '-m', 'mine');
  const head = git('rev-parse', 'HEAD').stdout.trim();
  const comment = (...extra) => run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/pr.md', ...extra], root);
  const result = comment('--comment', author, '--against', 'description.md');
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.split('\n')[0].endsWith('/docs/plans/artifacts/pr.comment.md'), result.stdout);
  const body = read(root, 'docs/plans/artifacts/pr.comment.md');
  assert.ok(body.startsWith(`<!-- plan-page:start -->\n\n[My commits after yours](https://diffshub.com/o/r/compare/${author}...${head})\n\n## On top of the PR\n`), 'the compare link spans exactly the commits after the author, with no models line above it and no brief below it');
  assert.ok(body.includes('\n## On top of the PR\n\n- Kept\n  - The title fix\n- Dropped\n  - The private scroll zone\n'));
  assert.ok(body.indexOf('## On top of the PR') < body.indexOf('## Demo') && body.indexOf('## Demo') < body.indexOf('## Public API') && body.indexOf('## Public API') < body.indexOf('## Verification'));
  assert.doesNotMatch(body, /claude-opus-5-5|It opens with a brief|Old plans need a brief|CAUTION|How it works|The page is the plan|## Decisions|## Out of scope|The merge|## Plans/, 'what the author wrote or only the owner reads stays out');
  assert.match(body, /\n## Demo\n\n1\. Open the page\.\n/);
  assert.doesNotMatch(body, /Scroll down|assets\/v1/, 'a step whose clips the description shows stays out');
  const plan = read(root, 'docs/plans/pr.md');
  for (const [label, text] of [
    ['missing', plan.replace(/\n## On top of the PR\n[\s\S]*?(?=\n## Verification)/, '').replace(/## Demo\n[\s\S]*?(?=## Defaults)/, '')],
    ['empty', plan.replace(/(## On top of the PR\n)[\s\S]*?(?=\n## Verification)/, '$1')],
  ]) {
    writeFileSync(join(root, 'docs/plans/pr.md'), text);
    assert.match(comment('--comment', author).stderr, /needs a non-empty ## On top of the PR before --comment/, `a comment refuses a ${label} On top of the PR`);
  }
  writeFileSync(join(root, 'docs/plans/pr.md'), plan.replace(/## Brief\n[\s\S]*?(?=## Teach)/, ''));
  assert.equal(comment('--comment', author).status, 0, 'a comment shows no brief, so it needs none');
  writeFileSync(join(root, 'docs/plans/pr.md'), plan);
  assert.match(comment('--comment', 'deadbeef').stderr, /--comment names deadbeef, which is not a commit in this checkout/);
  git('checkout', '-q', '--orphan', 'other');
  git('commit', '-q', '--allow-empty', '-m', 'unrelated');
  assert.match(comment('--comment', author).stderr, new RegExp(`--comment names ${author}, which this checkout's HEAD does not contain`));
  assert.equal(comment('--pr', '--comment', author).status, 2, '--pr and --comment write different bodies');
  assert.equal(comment('--against', 'description.md').status, 2, '--against needs --comment');
});

test('plan-page --pr links a plan the current commit holds and names an uncommitted one by path', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', {
    files: {
      'docs/plans/pr.md': prPlan('Plans: a.md'),
      'docs/plans/shots/after.png': 'png',
      'docs/plans/a.md': '# A\n\nStatus: executed\n\n## Steps\n\n- [x] One.\n',
    },
  });
  const git = (...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root, encoding: 'utf8' });
  git('remote', 'add', 'origin', 'https://github.com/o/r.git');
  git('add', 'docs/plans/pr.md');
  git('commit', '-q', '-m', 'plan');
  const sha = git('rev-parse', 'HEAD').stdout.trim();
  assert.equal(run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/pr.md', '--pr'], root).status, 0);
  assert.ok(read(root, 'docs/plans/artifacts/pr.pr.md').includes(`\n## Plans\n\n- [PR](https://github.com/o/r/blob/${sha}/docs/plans/pr.md)\n- A (\`docs/plans/a.md\`)\n`));
});

const STAGE_TOPIC = '# Stage\n\nPage: https://claude.ai/artifact/stage\n\n## Main changes\n\n- Pages go live.\n';
const stagePlan = (title, status, extra = '') => `# ${title}\n\nStatus: ${status}\nTopic: stage\n\n## Main changes\n\n- ${title}.\n${brief()}${extra}`;
const gitAt = (root) => (...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root, encoding: 'utf8' });

function pushed(dir, name, files) {
  const root = project(dir, name, { files, config: { branch: 'next' } });
  const git = gitAt(root);
  git('add', '-A');
  git('commit', '-qm', 'base');
  spawnSync('git', ['init', '-q', '--bare', join(dir, `${name}.git`)]);
  spawnSync('git', ['--git-dir', join(dir, `${name}.git`), 'config', 'receive.autogc', 'false']);
  git('remote', 'add', 'origin', join(dir, `${name}.git`));
  git('push', '-q', 'origin', 'next');
  return { root, git };
}
const worktree = (git, dir, name) => {
  git('worktree', 'add', '-q', '-b', name, join(dir, name));
  return realpathSync(join(dir, name));
};

test("plan-page binds a checkout to its own Page: line while only it moved from the fork point's or origin's line is one the clone found gone, else to origin's", () => {
  const { dir, run } = sandbox();
  const topic = (url) => STAGE_TOPIC.replace('https://claude.ai/artifact/stage', url);
  const { root, git } = pushed(dir, 'app', { 'docs/plans/topics/stage.md': topic('https://claude.ai/artifact/a'), 'docs/plans/live.md': stagePlan('Live', 'building') });
  const rebound = worktree(git, dir, 'rebound');
  const behind = worktree(git, dir, 'behind');
  const render = (tree, ...flags) => run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/live.md', ...flags], tree);
  writeFileSync(join(rebound, 'docs/plans/topics/stage.md'), topic('https://claude.ai/artifact/b'));
  gitAt(rebound)('commit', '-qam', 'rebind mid-run');
  assert.equal(JSON.parse(render(rebound, '--rail').stdout).page, 'https://claude.ai/artifact/b', 'a line changed since the fork point stays bound after a commit');
  writeFileSync(join(root, 'docs/plans/topics/stage.md'), topic('https://claude.ai/artifact/c'));
  git('commit', '-qam', 'rebind on next');
  git('push', '-q', 'origin', 'next');
  assert.equal(JSON.parse(render(rebound, '--rail').stdout).page, 'https://claude.ai/artifact/c', 'once origin rebinds too, every checkout publishes to one page');
  assert.equal(JSON.parse(render(behind, '--rail').stdout).page, 'https://claude.ai/artifact/c', "a worktree that has not pulled uses origin's line");
  const plain = render(behind);
  assert.equal(plain.status, 0, plain.stderr);
  assert.equal(plain.stdout.split('\n')[0], 'Page: https://claude.ai/artifact/c (publish through page-stop.mjs)', plain.stdout);
  writeFileSync(join(root, '.git/pstack-pages-gone'), 'https://claude.ai/artifact/c\n');
  assert.equal(JSON.parse(render(rebound, '--rail').stdout).page, 'https://claude.ai/artifact/b', "a rebind stands once the clone found origin's line gone, so the next publish does not make another page");
  assert.equal(JSON.parse(render(behind, '--rail').stdout).page, 'https://claude.ai/artifact/c', 'a checkout that never rebound still tries the gone line, and its failed publish makes the new page');
});

test('plan-page keeps the plan anchors on the local page, with no deck, mount or data block, and keeps the anchors out of the PR body and comment', () => {
  const { dir, run } = sandbox();
  const asking = '# Asking\n\nStatus: waiting for the owner\nTopic: stage\n\n## Main changes\n\n- Ask.\n\n## Open questions\n\n' + MEMO;
  const root = project(dir, 'app', {
    files: {
      'docs/plans/topics/stage.md': STAGE_TOPIC,
      'docs/plans/2026-01-01-asking.md': asking,
      'docs/plans/2026-02-01-live.md': stagePlan('Live', 'building', `\n## Open questions\n\n${MEMO}`),
      'docs/plans/pr.md': prPlan('', '\n## On top of the PR\n\n- Kept\n  - The title fix\n'),
      'docs/plans/shots/after.png': 'png',
    },
  });
  const render = (...args) => run(process.execPath, [join(HELPERS, 'plan-page.mjs'), ...args], root);
  assert.equal(render('docs/plans/2026-02-01-live.md').status, 0);
  const html = read(root, 'docs/plans/artifacts/topics/stage.html');
  assert.doesNotMatch(html, /plan-page-(?:data|live|others|deck)|window\.claude/u, 'the local page has no deck, mount or database');
  assert.match(html, /<header id="run-2026-02-01-live"/u);
  const items = [...html.matchAll(/<(?:article class="q"|p class="from")[^>]*>/gu)].map(([item]) => item);
  assert.ok(items.length >= 3 && items.every((item) => / data-plan="docs\/plans\/2026-0[12]-0\d-\w+\.md"/u.test(item)), items.join('\n'));
  assert.deepEqual(items.filter((item) => item.includes('id="run-')).map((item) => item.match(/id="(run-[^"]+)"/u)[1]), ['run-2026-01-01-asking'], "another plan's first item carries its anchor");
  const git = gitAt(root);
  git('add', '-A');
  git('commit', '-qm', 'author');
  const author = git('rev-parse', 'HEAD').stdout.trim();
  assert.equal(render('docs/plans/pr.md', '--pr').status, 0);
  assert.equal(render('docs/plans/pr.md', '--comment', author).status, 0);
  for (const body of ['pr.pr.md', 'pr.comment.md']) {
    assert.doesNotMatch(read(root, `docs/plans/artifacts/${body}`), /data-plan|id="run-/u, body);
  }
});

test("plan-page inlines a frame its worktree lacks from the main checkout's run directory and names one that exists nowhere", () => {
  const { dir, run } = sandbox();
  const plan = `# Demo\n\nStatus: building\n\n${brief()}\n## Demo\n\n1. Open it. ![after](artifacts/demo/after.png) ![before](artifacts/demo/gone.png)\n`;
  const { root, git } = pushed(dir, 'app', { 'docs/plans/demo.md': plan });
  mkdirSync(join(root, 'docs/plans/artifacts/demo'), { recursive: true });
  writeFileSync(join(root, 'docs/plans/artifacts/demo/after.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==', 'base64'));
  const tree = worktree(git, dir, 'work');
  const result = run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/demo.md'], tree);
  assert.equal(result.status, 0, result.stderr);
  const html = readFileSync(join(tree, 'docs/plans/artifacts/demo.html'), 'utf8');
  assert.equal([...html.matchAll(/<img src="data:image\/png;base64,/gu)].length, 1);
  assert.match(html, /<code>artifacts\/demo\/gone\.png<\/code> is not on this machine/u);
});

test('the page header counts each lead seat across rounds and carries the plans a PR plan lists', () => {
  const { dir, run } = sandbox();
  const root = project(dir, 'app', {
    files: {
      'docs/plans/pr.md': prPlan('Plans: a.md'),
      'docs/plans/shots/after.png': 'png',
      'docs/plans/a.md': '# A\n\nStatus: executed\nPlaybook: bug-fix\n\n## Steps\n\n- [x] One.\n- [x] Two.\n',
      'docs/plans/pr.decisions.tsv': LOG_HEAD + logRow('lead', 'claude-opus-5-5 @xhigh') + logRow('panel', 'seats claude-opus-5-5 @high, codex:gpt-6.1-sol @xhigh missing') + logRow('build', 'built it') + logRow('panel', 'seats #12 round 3: claude-opus-5-5 @high, codex:gpt-6.1-sol @xhigh (round 2, delta only) missing'),
      'docs/plans/a.decisions.tsv': LOG_HEAD + logRow('lead', 'gpt-6.1-sol @xhigh') + logRow('panel', 'seats gpt-6-astra @xhigh'),
    },
  });
  assert.equal(run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/pr.md'], root).status, 0);
  const html = read(root, 'docs/plans/artifacts/pr.html');
  const meta = html.match(/<div class="meta">(.*?)<\/div>/)[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').replace(/ Updated .*$/, '').trim();
  assert.equal(meta, 'Plans A Lead claude-opus-5-5 xhigh Reviews claude-opus-5-5 high ×2 gpt-6.1-sol xhigh missing ×2 Lead gpt-6.1-sol xhigh Reviews gpt-6-astra xhigh', 'a label or note around a seat stays out of its name');
  assert.match(html, /Build<span class="fs-meta">3\/3<\/span>/, "the rail counts the carried plan's steps");
  assert.match(html, /<li class="fs done"[^>]*>Plan review<span class="fs-meta">×2<\/span>/, 'review rounds from both plans add up');
});

test('a finished page shows its Verification, then its Open work last', () => {
  const { dir, run } = sandbox();
  const tail = '\n## Open work\n\n- Push it.\n\n## Verification\n\n- Rendered every plan.\n\n## Design\n\nInternal only.\n';
  const root = project(dir, 'app', { files: { 'docs/plans/pr.md': prPlan('', tail), 'docs/plans/shots/after.png': 'png' } });
  const order = () => {
    assert.equal(run(process.execPath, [join(HELPERS, 'plan-page.mjs'), 'docs/plans/pr.md'], root).status, 0);
    return [...read(root, 'docs/plans/artifacts/pr.html').matchAll(/<h2>([^<]+)<\/h2>/g)].map(([, title]) => title).filter((title) => ['Main changes', 'Design', 'Verification', 'Open work'].includes(title));
  };
  assert.deepEqual(order(), ['Main changes', 'Design', 'Verification', 'Open work']);
  writeFileSync(join(root, 'docs/plans/pr.md'), prPlan('', tail).replace('Status: executed', 'Status: building: step two'));
  assert.deepEqual(order(), ['Main changes', 'Design', 'Open work'], 'proof stays in the plan file while work runs');
});
