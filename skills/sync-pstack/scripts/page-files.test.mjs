import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, 'fixtures/page-files');
const { CODE_VERSION, page, pageFile, parsePageFile, runBody, runHeader, slugOf, viewerCode } = await import(pathToFileURL(join(HERE, '../assets/pstack/plan-page.mjs')).href);

const { cli: pageStop } = await import(pathToFileURL(join(HERE, '../assets/pstack/page-stop.mjs')).href);

const fixture = (name) => readFileSync(join(FIXTURES, name), 'utf8');
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const wrap = (sent) => fixture('refusal-prefix.html') + sent + fixture('refusal-suffix.html');

// The viewer runs in its own realm, as in the browser; its results come back as plain data so deepEqual compares values.
const plain = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

function viewer() {
  const context = {};
  vm.runInNewContext(viewerCode().js, context);
  const api = context.pstackViewer;
  const wrapped = Object.fromEntries(Object.entries(api).map(([name, fn]) => [name, (...args) => plain(fn(...args))]));
  wrapped.draftStore = (storage) => {
    const store = api.draftStore(storage);
    return { read: (name) => plain(store.read(name)), write: (name, value) => store.write(name, value) };
  };
  return wrapped;
}

const SENT_STAGES = { 'probe-a': 'Build', 'probe-b': 'Plan' };
const sentRuns = () => parsePageFile(fixture('sent.html')).data.runs.map(({ supersedes, ...entry }) => entry);

test('pageFile sorts entries by key, one per line, and parsePageFile reads its runs and list back', () => {
  const built = pageFile({ title: 'Page files probe', subject: 'page-files-probe', code: 1, runs: [...sentRuns()].reverse(), stages: SENT_STAGES });
  assert.equal(pageFile({ title: 'Page files probe', subject: 'page-files-probe', code: 1, runs: sentRuns(), lead: ['probe-a', 'probe-b'], stages: SENT_STAGES }), built, 'the lead defaults to the viewer order');
  const parsed = parsePageFile(built);
  assert.equal(parsed.ok, true, parsed.reason);
  assert.deepEqual(parsed.data.runs, sentRuns());
  assert.equal(parsed.data.runs[0].title, 'Probe A </script> title', 'a title holding a closing script tag survives the round trip');
  assert.deepEqual(parsed.list, [
    { slug: 'probe-a', title: 'Probe A </script> title', stage: 'build' },
    { slug: 'probe-b', title: 'Probe B', stage: 'plan' },
  ]);
  const block = built.slice(built.indexOf('"runs":[\n') + '"runs":[\n'.length, built.indexOf('\n]}\n'));
  assert.deepEqual(block.split('\n').map((line) => JSON.parse(line.replace(/,$/u, '')).key), ['probe-a.s-one', 'probe-b.s-two'], 'each entry sits on its own line');
  assert.doesNotMatch(block, /<\/script/u);
  const empty = pageFile({ title: 'Empty', subject: 'empty', runs: [] });
  assert.match(empty, /\{"v":1,"code":1,"subject":"empty","runs":\[\n\]\}\n/u);
  assert.match(empty, /<link rel="stylesheet" href="code\/1\.css">\n[\s\S]*<script src="code\/1\.js"><\/script>\n$/u);
  assert.equal(parsePageFile(empty).ok, true);
});

test("parsePageFile reads the runs from the stored fixtures, with the tool's skeleton and injected scripts around them", () => {
  const sent = fixture('sent.html');
  for (const [name, stored] of Object.entries({ sent, 'stored-read.html': fixture('stored-read.html'), refusal: wrap(sent) })) {
    const parsed = parsePageFile(stored);
    assert.equal(parsed.ok, true, `${name}: ${parsed.reason}`);
    assert.deepEqual(parsed.data.runs.map(({ supersedes, ...entry }) => entry), sentRuns(), name);
    assert.deepEqual(parsed.list.map(({ slug }) => slug), ['probe-a', 'probe-b'], name);
  }
});

test('a page without a data block, or with one that does not parse or lists no runs, fails with a reason', () => {
  const stored = fixture('stored-read.html');
  const failures = {
    'no data block': stored.replace('id="pstack-page"', 'id="other"'),
    'bad JSON': stored.replace('"runs":[', '"runs":[,'),
    'no runs': stored.replace('"runs":[', '"rows":['),
  };
  for (const [name, text] of Object.entries(failures)) {
    const parsed = parsePageFile(text);
    assert.equal(parsed.ok, false, name);
    assert.equal(typeof parsed.reason, 'string', name);
  }
});

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-18T12:00:00Z');
const ago = (days) => new Date(NOW - days * DAY).toISOString();
const entry = (plan, session, fields = {}) => {
  const slug = slugOf(plan);
  return { key: `${slug}.${session}`, session, plan, slug, title: slug, added: ago(5), at: ago(1), handback: null, done: false, ...fields };
};
const header = (run, fields = {}) => ({ v: 1, code: CODE_VERSION, key: run.key, session: run.session, plan: run.plan, slug: run.slug, title: run.title, state: 'working', stage: 'Build', since: run.at, at: run.at, steps: { done: 1, total: 3 }, asks: [], picks: '', handback: run.handback, ...fields });

function corpus() {
  const dotted = 'docs/plans/2026-10-18.dotted.md';
  const tilde = 'docs/plans/b~c.md';
  const runs = {
    olderDotted: entry(dotted, 's0', { handback: 1, added: ago(9), at: ago(9) }),
    dottedStop: entry(dotted, 's1', { handback: 3, added: ago(6), at: ago(2) }),
    dottedStage: entry(dotted, 's2', { added: ago(3), at: ago(0.5) }),
    tildeStop: entry(tilde, 'sb', { handback: 3, added: ago(7), at: ago(3) }),
    newerStage: entry('docs/plans/stage.md', 'st', { added: ago(0.1), at: ago(0.1) }),
    asker: entry('docs/plans/asker.md', 'sa', { handback: 2, at: ago(1) }),
    olderAsker: entry('docs/plans/asker.md', 'sz', { handback: 1, at: ago(2) }),
    blocked: entry('docs/plans/blocked.md', 'sk', { at: ago(1.5) }),
    oldDone: entry('docs/plans/old-done.md', 'so', { done: true, at: ago(3.01) }),
    newDone: entry('docs/plans/new-done.md', 'sn', { done: true, at: ago(2.9) }),
    oldWorking: entry('docs/plans/old-working.md', 'sw', { at: ago(10) }),
    unread: entry('docs/plans/unread.md', 'su', { at: ago(1) }),
  };
  const headers = Object.fromEntries(Object.values(runs).filter((run) => run !== runs.unread).map((run) => [run.key, header(run)]));
  headers[runs.asker.key] = header(runs.asker, { state: 'waiting', stage: 'Plan review', asks: [{ title: 'Ship', digest: 'a'.repeat(64) }] });
  headers[runs.olderAsker.key] = header(runs.olderAsker, { state: 'waiting', asks: [{ title: 'Old', digest: 'b'.repeat(64) }] });
  headers[runs.dottedStage.key] = header(runs.dottedStage, { state: 'waiting', asks: [{ title: 'Lead ask', digest: 'c'.repeat(64) }] });
  headers[runs.blocked.key] = header(runs.blocked, { state: 'blocked' });
  headers[runs.oldDone.key] = header(runs.oldDone, { state: 'done', stage: 'Ship' });
  headers[runs.newDone.key] = header(runs.newDone, { state: 'done', stage: 'Ship' });
  headers[runs.tildeStop.key] = { v: 1, code: 0, key: runs.tildeStop.key, title: 'Older code', state: 'working', stage: 'Verify' };
  return { runs, headers, data: { v: 1, subject: 'probe', runs: Object.values(runs) } };
}

test('the viewer model leads with the highest serial, ties by added, orders each plan newest first and folds by the clock', () => {
  const { viewerModel } = viewer();
  const { runs, headers, data } = corpus();
  const model = viewerModel({ data, headers, now: NOW });
  const dotted = 'docs/plans/2026-10-18.dotted.md';
  assert.equal(model.lead, dotted, 'serial 3 ties with b~c, and the later added entry leads; a newer stage publish never does');
  assert.deepEqual(model.sections.map(({ slug, open }) => [slug, open]).slice(0, 2), [['2026-10-18.dotted', true], ['b-c', false]]);
  const lead = model.sections[0];
  assert.deepEqual(lead.entries.map(({ key }) => key), [runs.dottedStage.key, runs.dottedStop.key, runs.olderDotted.key], 'every run of the plan shows, newest first');
  const swapped = viewerModel({ data: { runs: [runs.dottedStop, { ...runs.tildeStop, added: ago(5) }] }, now: NOW });
  assert.equal(swapped.lead, 'docs/plans/b~c.md', 'the tie goes the other way once b~c was added later');
  const asker = model.sections.find((section) => section.plan === 'docs/plans/asker.md');
  assert.deepEqual(asker.entries.map(({ key }) => key), [runs.asker.key, runs.olderAsker.key]);
  const folded = (plan) => model.sections.find((section) => section.plan === plan).entries[0].folded;
  assert.deepEqual([folded('docs/plans/old-done.md'), folded('docs/plans/new-done.md'), folded('docs/plans/old-working.md')], [true, false, false], 'only a done run last published more than 3 days ago folds');
  const later = viewerModel({ data, headers, now: NOW + DAY });
  assert.equal(later.sections.find((section) => section.plan === 'docs/plans/new-done.md').entries[0].folded, true, 'the fold follows the clock it is given');
  const older = model.sections.find((section) => section.slug === 'b-c').entries[0];
  assert.deepEqual([older.title, older.stage, older.steps, older.loaded], ['Older code', 'Verify', null, true], 'a header from an older code version still reads');
});

test('the viewer gives run-<slug> to each section and run~<slug>~<session> to each entry, lands either hash, links each strip row to its own anchor, and fills Also waiting from loaded headers', () => {
  const { viewerModel, parseHash } = viewer();
  const { runs, headers, data } = corpus();
  assert.equal(slugOf('docs/plans/b~c.md'), 'b-c', 'a tilde maps to a dash, so the two anchor forms never collide');
  assert.equal(slugOf('docs/plans/2026-10-18.dotted.md'), '2026-10-18.dotted', 'a dot stays');
  const model = viewerModel({ data, headers, now: NOW });
  const ids = model.sections.flatMap((section) => [section.id, ...section.entries.map((each) => each.id)]);
  assert.equal(new Set(ids).size, ids.length, 'every anchor is unique');
  assert.ok(ids.includes('run-2026-10-18.dotted') && ids.includes('run~2026-10-18.dotted~s1') && ids.includes('run-b-c') && ids.includes('run~b-c~sb'), ids.join(' '));
  assert.deepEqual(parseHash('#run~b-c~sb'), { kind: 'entry', slug: 'b-c', session: 'sb' });
  assert.deepEqual(parseHash('#run-2026-10-18.dotted'), { kind: 'section', slug: '2026-10-18.dotted' });
  assert.deepEqual(parseHash(`#${encodeURIComponent('run~b-c~sb')}`), { kind: 'entry', slug: 'b-c', session: 'sb' });
  assert.equal(parseHash('#elsewhere'), null);
  const byEntry = viewerModel({ data, headers, now: NOW, hash: '#run~b-c~sb' });
  assert.deepEqual(byEntry.target, { section: 'run-b-c', entry: 'run~b-c~sb' });
  assert.equal(byEntry.sections.find((section) => section.slug === 'b-c').open, true, 'the hash opens a section that is not the lead');
  const bySection = viewerModel({ data, headers, now: NOW, hash: '#run-asker' });
  assert.deepEqual(bySection.target, { section: 'run-asker', entry: null });
  assert.ok(model.strip.every((row) => row.href === `#${row.id}`), 'each strip row links its own entry');
  assert.deepEqual(model.strip.slice(0, 4).map(({ key }) => key), [runs.dottedStage.key, runs.asker.key, runs.olderAsker.key, runs.blocked.key], 'waiting runs first, newest first, then blocked');
  assert.deepEqual(model.alsoWaiting.map(({ key }) => key), [runs.asker.key, runs.olderAsker.key], 'only waiting runs outside the lead plan; a header that did not load stays out');
  assert.equal(model.strip.find((row) => row.key === runs.unread.key).loaded, false);
});

const BRIEF = '## Brief\n\n### What will change?\n\nIt opens with a brief.\n\n### What could go wrong?\n\nOld plans need a brief.\n';
const MEMO = '### Build\n\nBuild the memo now?\n\nWhy it needs you: The renderer is shared by every project.\n\n- Another session changed it this morning.\n\n- **Build now** (recommended): I build it today. Cost: A design mistake shows up after the build.\n- **Hold**: Nothing changes. Cost: Needs you stays hard to read.\n\nWhy I pick it: The prototype settled the design.\n\nAttention: look\n\nIf you say go: I build the memo renderer.\n';
const OTHER = '### Other\n\nShip the other run?\n\nWhy it needs you: It is public.\n\n- **Ship** (recommended): It ships. Cost: None.\n- **Wait**: Nothing ships. Cost: A day.\n\nWhy I pick it: It is ready.\n\nAttention: look\n';
const DEFAULTS = (look) => `\n## Defaults\n\n| Decision | Pick | Alternative | Word | Impact |\n| --- | --- | --- | --- | --- |\n| Line | ${look} (look) | Republish | republish | big |\n| Link | Anchor (answer) | Bare | bare | small |\n| Pictures | Inline (safe) | Files | files | detail |\n`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==', 'base64');
const livePlan = (step, look = 'Live line') => `# Live\n\nStatus: building: step ${step}\nTopic: stage\n\n${BRIEF}\n## Demo\n\n1. Open the page. It loads. ![after](shots/after.png)\n\n## Open questions\n\n${MEMO}${DEFAULTS(look)}\n## Main changes\n\n- Live.\n\n## Steps\n\n- [x] One.\n- [ ] Two.\n`;

function project() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'page-files-')));
  const git = (...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root, encoding: 'utf8' });
  git('init', '-q', '-b', 'next');
  const write = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  write('docs/plans/topics/stage.md', '# Stage\n\nPage: https://claude.ai/artifact/stage\n\n## Main changes\n\n- Pages go live.\n');
  write('docs/plans/2026-01-01-other.md', `# Other\n\nStatus: waiting for the owner\nTopic: stage\n\n${BRIEF}\n## Main changes\n\n- Other.\n\n## Open questions\n\n${OTHER}`);
  write('docs/plans/shots/after.png', PNG);
  write('docs/plans/plain.md', `# Plain\n\nStatus: building\n\n${BRIEF}\n## Demo\n\n1. Open it. ![after](shots/after.png)\n\n## Open questions\n\n${MEMO}\n## Main changes\n\n- Plain.\n`);
  for (const step of [1, 2, 3]) {
    write('docs/plans/2026-02-01-live.md', livePlan(step));
    git('add', '-A');
    git('commit', '-qm', `step ${step}`);
  }
  return { root, git, write, live: join(root, 'docs/plans/2026-02-01-live.md') };
}

const needsOf = (html) => html.match(/<section class="needs"[\s\S]*?<\/section>/u)?.[0] ?? '';

test('a body links each picture as a shots/ file and holds its own questions and History, and a header holds the asks and the picks digest', () => {
  const { root, write, live } = project();
  const key = '2026-02-01-live.session-one';
  const { html, shots } = runBody(live, { key });
  const hash = sha256(PNG);
  assert.deepEqual(shots, [{ path: `shots/${hash}.png`, source: join(root, 'docs/plans/shots/after.png'), sha256: hash, ext: 'png' }]);
  assert.ok(html.startsWith(`<section class="run" data-key="${key}">`) && html.endsWith('</section>\n'), html.slice(0, 80));
  assert.match(html, new RegExp(`<img src="shots/${hash}\\.png" alt="After">`, 'u'));
  assert.doesNotMatch(html, /data:image|<script|id="run-/u, 'no inlined picture, no script and no anchor the viewer owns');
  assert.match(needsOf(html), /Build the memo now\?/u);
  assert.doesNotMatch(needsOf(html), /Ship the other run\?/u, "another plan's question comes from its own body");
  assert.match(html, /<h2>History <span class="count">2<\/span><\/h2>/u);
  assert.ok(html.split('\n').length > 10, 'one element per line where the renderer can');
  const head = runHeader(live, { session: 'session-one', at: '2026-10-18T12:00:00.000Z', handback: 3 });
  assert.deepEqual(Object.keys(head), ['v', 'code', 'key', 'session', 'plan', 'slug', 'title', 'status', 'state', 'stage', 'occurrence', 'since', 'at', 'steps', 'asks', 'picks', 'handback']);
  assert.deepEqual([head.key, head.plan, head.slug, head.title, head.status, head.state, head.stage, head.since, head.handback], [key, 'docs/plans/2026-02-01-live.md', '2026-02-01-live', 'Live', 'building: step 3', 'working', 'Build', '2026-10-18T12:00:00.000Z', 3]);
  assert.deepEqual(head.steps, { done: 1, total: 2 });
  const digests = [...html.matchAll(/data-digest="([0-9a-f]{64})"/gu)].map(([, digest]) => digest);
  assert.deepEqual(head.asks, [{ title: 'Build', digest: digests[0] }], "the header's question digest is the one the body carries");
  write('docs/plans/2026-02-01-live.md', livePlan(3).replace('Inline (safe)', 'Linked (safe)'));
  assert.equal(runHeader(live, { session: 's' }).picks, head.picks, 'a safe pick is not in the digest');
  write('docs/plans/2026-02-01-live.md', livePlan(3, 'Every stage'));
  assert.notEqual(runHeader(live, { session: 's' }).picks, head.picks, 'a look pick is');
  assert.equal(head.picks, sha256(['Line | Live line (look) | Republish | republish | big', 'Link | Anchor (answer) | Bare | bare | small'].join('\n')));
});

test('two bodies of one plan keep separate inputs and copied answers', () => {
  const { live } = project();
  const { answerText } = viewer();
  const one = runBody(live, { key: '2026-02-01-live.one' }).html;
  const two = runBody(live, { key: '2026-02-01-live.two' }).html;
  const names = (html) => new Set([...html.matchAll(/<input [^>]*name="([^"]+)"/gu)].map(([, name]) => name));
  assert.deepEqual([...names(one)], ['2026-02-01-live.one:q0']);
  assert.deepEqual([...names(two)], ['2026-02-01-live.two:q0'], 'radio groups of two bodies never merge');
  const digest = one.match(/data-asks="([0-9a-f]{12})"/u)[1];
  const ask = (chosen) => [{ title: 'Build', multi: false, defaults: ['Build now'], chosen }];
  assert.deepEqual(answerText({ subject: 'stage', slug: '2026-02-01-live', digest, asks: ask(['Build now']) }), { state: 'default', text: `go stage/2026-02-01-live @${digest}` });
  assert.deepEqual(answerText({ subject: 'stage', slug: '2026-02-01-live', digest, asks: ask(['Hold']) }), { state: 'changed', text: `go stage/2026-02-01-live @${digest}, except Build: Hold` });
  assert.deepEqual(answerText({ subject: 'stage', slug: '2026-02-01-live', digest, asks: ask([]) }), { state: 'missing', text: 'Answer Build' });
});

test('drafts are keyed by subject, key and question digest, and a storage that throws loses only the draft', () => {
  const { draftKey, draftStore } = viewer();
  const keys = [draftKey('stage', 'live.one', 'd1'), draftKey('stage', 'live.two', 'd1'), draftKey('stage', 'live.one', 'd2'), draftKey('other', 'live.one', 'd1')];
  assert.equal(new Set(keys).size, 4);
  const saved = new Map();
  const store = draftStore({ getItem: (name) => saved.get(name) ?? null, setItem: (name, value) => saved.set(name, value) });
  store.write(keys[0], ['Hold']);
  assert.deepEqual([store.read(keys[0]), store.read(keys[1])], [['Hold'], null]);
  const broken = draftStore({
    getItem: () => {
      throw new Error('SecurityError');
    },
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
  });
  assert.doesNotThrow(() => broken.write(keys[0], ['Hold']));
  assert.equal(broken.read(keys[0]), null);
  assert.equal(draftStore(null).read(keys[0]), null, 'no storage at all');
});

test('a render without options keeps the whole local page and matches the body apart from its pictures', () => {
  const { root } = project();
  const plain = join(root, 'docs/plans/plain.md');
  const local = page(plain).html;
  assert.doesNotMatch(local, /plan-page-(?:data|live|others|deck)|window\.claude|pstack-page/u, 'no deck, mount or data block');
  assert.match(local, /^<title>Plain<\/title>\n<meta charset="utf-8">/u);
  assert.match(local, /<header id="run-plain" data-plan="docs\/plans\/plain\.md">/u);
  const { html } = runBody(plain, { key: 'plain.s' });
  const text = (markup) =>
    markup
      .replace(/<script[\s\S]*?<\/script>/gu, '')
      .replace(/<dialog[\s\S]*?<\/dialog>/gu, '')
      .replace(/<[^>]+>/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
  const main = local.slice(local.indexOf('<main>'), local.indexOf('</main>') + '</main>'.length);
  assert.equal(text(html), text(main));
  const pictures = (markup) => [...markup.matchAll(/<img src="([^"]+)" alt="([^"]*)">/gu)].map(([, src, alt]) => [src.slice(0, 15), alt]);
  assert.deepEqual(pictures(main), [['data:image/png;', 'After']]);
  assert.deepEqual(pictures(html), [[`shots/${sha256(PNG)}`.slice(0, 15), 'After']]);
});

test('the viewer code file carries the model the tests run and the page styles in both themes', () => {
  const { version, js, css } = viewerCode();
  assert.equal(version, CODE_VERSION);
  assert.deepEqual(Object.keys(viewer()).sort(), ['answerText', 'draftKey', 'draftStore', 'parseHash', 'viewerModel']);
  assert.match(js, /navigator\.clipboard\?\.writeText/u);
  assert.match(js, /addEventListener\('hashchange'/u);
  assert.match(css, /^@import url\("https:\/\/fonts\.googleapis\.com\//u);
  assert.match(css, /@media \(prefers-color-scheme: dark\) \{ :root:not\(\[data-theme="light"\]\)/u);
  assert.match(css, /:root\[data-theme="dark"\]/u);
  assert.match(css, /padding: 0 max\(16px, env\(safe-area-inset-right\)\) 0 max\(16px, env\(safe-area-inset-left\)\)/u);
});

const CLAUDE = { CLAUDECODE: '1' };
const callOf = (lines) => JSON.parse(lines.find((line) => line.startsWith('Artifact ')).slice('Artifact '.length));
const runsOf = (call) => parsePageFile(readFileSync(call.file_path, 'utf8')).data.runs.map(({ key, handback }) => [key, handback]);

test("page-stop sends the page file and this run's files, sends nothing when the stage did not move, and a stop takes the next serial and prints the reply link", () => {
  const { root, write, live } = project();
  assert.match(pageStop(['stage', live], {}).lines[0], /outside Claude Code/u);
  assert.equal(pageStop(['stage', live], CLAUDE).code, 2, 'a session id is required');
  const first = pageStop(['stage', live, '--session', 'one'], CLAUDE);
  assert.equal(first.code, 0, first.error);
  const out = join(root, 'docs/plans/artifacts/pages/stage');
  const call = callOf(first.lines);
  assert.deepEqual([call.url, call.file_path, call.root], ['https://claude.ai/artifact/stage', join(out, 'index.html'), out]);
  const runFiles = ['runs/2026-02-01-live.one.json', 'runs/2026-02-01-live.one.html', `shots/${sha256(PNG)}.png`];
  assert.deepEqual(call.files, [...runFiles, 'code/1.js', 'code/1.css'], 'the first publish sends the body, its picture and the viewer code');
  assert.equal(first.lines[0], `Read in full, and view each picture, before you send: ${['index.html', ...call.files].map((path) => join(out, path)).join(' ')}`);
  assert.deepEqual(runsOf(call), [['2026-02-01-live.one', null]]);
  assert.deepEqual(parsePageFile(readFileSync(call.file_path, 'utf8')).list, [{ slug: '2026-02-01-live', title: 'Live', stage: 'build' }]);
  assert.ok(!first.lines.some((line) => line.includes('#run-')), 'a stage prints no reply');
  assert.deepEqual(pageStop(['stage', live, '--session', 'one'], CLAUDE).lines, ['Nothing to send: the page already shows this stage']);
  write('docs/plans/2026-02-01-live.md', livePlan(4));
  assert.deepEqual(callOf(pageStop(['stage', live, '--session', 'one'], CLAUDE).lines).files, ['runs/2026-02-01-live.one.json'], 'a new status sends only the header');
  const stop = pageStop(['stop', live, '--session', 'one'], CLAUDE);
  assert.deepEqual(callOf(stop.lines).files, runFiles, 'a stop sends the body again');
  assert.deepEqual(runsOf(callOf(stop.lines)), [['2026-02-01-live.one', 1]]);
  assert.equal(stop.lines.at(-1), 'Once the publish goes through, reply with 📄 https://claude.ai/artifact/stage#run-2026-02-01-live');
});

test('after a refusal, --base composes on the live page, an old page lists only this run, and --new makes a new page', () => {
  const { root, live } = project();
  const other = { key: 'other.two', session: 'two', plan: 'docs/plans/2026-01-01-other.md', slug: '2026-01-01-other', title: 'Other', added: '2026-10-01T00:00:00Z', at: '2026-10-01T00:00:00Z', handback: 3, done: false };
  const refused = join(root, 'refused.html');
  writeFileSync(refused, wrap(pageFile({ title: 'Stage', subject: 'stage', runs: [other], stages: { '2026-01-01-other': 'Plan review' } })));
  const stop = pageStop(['stop', live, '--session', 'one', '--base', refused], CLAUDE);
  const call = callOf(stop.lines);
  assert.deepEqual(runsOf(call), [['2026-02-01-live.one', 4], ['other.two', 3]], "the other run stays and the stop's serial follows the highest");
  assert.deepEqual(parsePageFile(readFileSync(call.file_path, 'utf8')).list.map(({ slug, stage }) => [slug, stage]), [['2026-02-01-live', 'build'], ['2026-01-01-other', 'plan review']], 'the highest serial leads');
  assert.ok(!call.files.some((path) => path.startsWith('code/')), 'the live page already has this viewer code');
  writeFileSync(refused, wrap('<title>Old</title>\n<main>An old page.</main>\n'));
  const old = pageStop(['stage', live, '--session', 'one', '--base', refused], CLAUDE);
  assert.match(old.lines[0], /^The base lists no runs/u);
  assert.deepEqual(runsOf(callOf(old.lines)), [['2026-02-01-live.one', null]]);
  assert.ok(callOf(old.lines).files.includes('code/1.js'));
  const fresh = pageStop(['stage', live, '--session', 'one', '--new'], CLAUDE);
  assert.equal(callOf(fresh.lines).url, undefined);
  assert.ok(fresh.lines.some((line) => line.startsWith('This publish makes the page')));
  assert.equal(pageStop(['stage', live, '--session', 'one', '--base', join(root, 'missing.html')], CLAUDE).code, 2);
});
