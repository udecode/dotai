#!/usr/bin/env node
// Writes artifacts/<plan name>.html beside the plan and prints its path.
// Installed by the sync-pstack skill.
// Usage: node .agents/pstack/plan-page.mjs <plan.md>

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';

// The owner reads the top of the page and rarely opens the details.
const ROLES = [
  [/^open questions$/i, 'needs'],
  [/^public api$/i, 'api'],
  [/^main changes$/i, 'main'],
  [/^defaults$/i, 'picked'],
  [/^(scope|steps|evidence|proof|claims|asks|verification|notes)$/i, 'details'],
];
const roleOf = (section, lead) =>
  lead.includes(section.title.toLowerCase())
    ? 'lead'
    : (ROLES.find(([pattern]) => pattern.test(section.title))?.[1] ?? 'idea');

function titles(config, key) {
  const value = config[key] ?? [];
  if (!Array.isArray(value)) {
    throw new Error(`${key} in .agents/pstack.json must be a list of section titles`);
  }
  return value.map((title) => title.toLowerCase());
}

function pageConfig(root) {
  const path = join(root, '.agents/pstack.json');
  const config = existsSync(path) ? JSON.parse(readFileSync(path, 'utf-8')) : {};
  return {
    lead: titles(config, 'pageLead'),
    pairs: ['public api', ...titles(config, 'pagePairs')],
  };
}

function fencePairs(lines) {
  const pairs = [];
  const unpaired = [];
  let index = 0;
  while (index < lines.length) {
    if (!isFence(lines[index])) {
      index += 1;
      continue;
    }
    const pair = readFencePair(lines, index);
    index = pair.next;
    if (pair.after) pairs.push(pair);
    else if (pair.first.tag) unpaired.push(pair.first);
  }
  return { pairs, unpaired };
}

function assertPairs(sections, paired) {
  for (const section of sections.filter((entry) => paired.includes(entry.title.toLowerCase()))) {
    const { pairs, unpaired } = fencePairs(section.lines);
    if (pairs.length === 0 || unpaired.length > 0) {
      throw new Error(
        `${section.title} needs each before fence followed directly by its after fence, at least once; remove the section when nothing in it changes`
      );
    }
  }
}

const escapeHtml = (text) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

function inline(text) {
  const codes = [];
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, (_, code) => `\uE000${codes.push(code) - 1}\uE000`)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) =>
      /^https?:\/\//.test(href) ? `<a href="${href}">${label}</a>` : label
    )
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(
      /\uE000(\d+)\uE000/g,
      (_, index) => `<code>${codes[index]}</code>`
    );
}

function parseFence(line) {
  const match = line.match(/^\s*(```|~~~)(.*)$/);
  if (!match || (match[1] === '```' && match[2].includes('`'))) return null;
  const words = match[2].trim().split(/\s+/).filter(Boolean);
  const tag = ['before', 'after'].includes(words.at(-1)) ? words.pop() : undefined;
  return { marker: match[1], lang: words[0] ?? '', tag };
}
const isFence = (line) => parseFence(line) !== null;

function readFence(lines, start) {
  const { marker, lang, tag } = parseFence(lines[start]);
  const body = [];
  let index = start + 1;
  for (
    ;
    index < lines.length && !lines[index].trim().startsWith(marker);
    index += 1
  ) {
    body.push(lines[index]);
  }
  return { lang, tag, body: body.join('\n'), next: index + 1 };
}

function readFencePair(lines, start) {
  const first = readFence(lines, start);
  let index = first.next;
  while (index < lines.length && !lines[index].trim()) index += 1;
  const second =
    first.tag === 'before' && isFence(lines[index] ?? '')
      ? readFence(lines, index)
      : null;
  return second?.tag === 'after'
    ? { first, after: second, next: second.next }
    : { first, after: null, next: first.next };
}

const codeHtml = ({ lang, body }) =>
  `<div class="scroll"><pre><code${lang ? ` class="language-${lang}"` : ''}>${escapeHtml(body)}</code></pre></div>`;

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function cells(row) {
  return row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((cell) => inline(cell.trim().replaceAll('\\|', '|')));
}

function itemHtml(text) {
  const task = text.match(/^(?:[-*+]\s+)?\[( |x|X)\]\s+([\s\S]*)$/);
  if (!task) return inline(text);
  const done = task[1] !== ' ';
  return `<span class="box${done ? ' done' : ''}" aria-label="${done ? 'done' : 'open'}"></span>${inline(task[2])}`;
}

function listHtml(items, start) {
  const { indent, ordered } = items[start];
  let html = '';
  let index = start;
  while (index < items.length && items[index].indent >= indent) {
    let body = itemHtml(items[index].text);
    index += 1;
    if (index < items.length && items[index].indent > indent) {
      const nested = listHtml(items, index);
      body += nested.html;
      index = nested.next;
    }
    html += `<li>${body}</li>`;
  }
  return {
    html: ordered ? `<ol>${html}</ol>` : `<ul>${html}</ul>`,
    next: index,
  };
}

function blocksHtml(lines) {
  const html = [];
  let index = 0;
  const startsBlock = (line) =>
    isFence(line) ||
    /^#{1,6}\s/.test(line) ||
    LIST_ITEM.test(line) ||
    /^\s*>/.test(line) ||
    /^\s*\|/.test(line);
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (isFence(line)) {
      const pair = readFencePair(lines, index);
      index = pair.next;
      html.push(
        pair.after
          ? `<div class="compare"><div><span class="side">Before</span>${codeHtml(pair.first)}</div><div><span class="side">After</span>${codeHtml(pair.after)}</div></div>`
          : codeHtml(pair.first)
      );
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = Math.max(3, Math.min(heading[1].length + 1, 5));
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }
    if (/^\s*\|/.test(line) && TABLE_RULE.test(lines[index + 1] ?? '')) {
      const head = cells(line);
      const rows = [];
      for (
        index += 2;
        index < lines.length && /^\s*\|/.test(lines[index]);
        index += 1
      ) {
        rows.push(cells(lines[index]));
      }
      html.push(
        `<div class="scroll"><table><thead><tr>${head.map((cell) => `<th>${cell}</th>`).join('')}</tr></thead><tbody>${rows
          .map(
            (row) =>
              `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`
          )
          .join('')}</tbody></table></div>`
      );
      continue;
    }
    if (LIST_ITEM.test(line)) {
      const items = [];
      while (index < lines.length) {
        const current = lines[index];
        const item = current.match(LIST_ITEM);
        if (item) {
          items.push({
            indent: item[1].length,
            ordered: /\d/.test(item[2]),
            text: item[3],
          });
        } else if (
          current.trim() &&
          (/^\s/.test(current) || !startsBlock(current))
        ) {
          items.at(-1).text += ` ${current.trim()}`;
        } else if (
          !current.trim() &&
          /^\s+\S|^\s*([-*+]|\d+[.)])\s/.test(lines[index + 1] ?? '')
        ) {
          // A blank line between items keeps the list going.
        } else {
          break;
        }
        index += 1;
      }
      html.push(listHtml(items, 0).html);
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote = [];
      for (; index < lines.length && /^\s*>/.test(lines[index]); index += 1) {
        quote.push(lines[index].replace(/^\s*>\s?/, ''));
      }
      html.push(`<blockquote>${inline(quote.join(' '))}</blockquote>`);
      continue;
    }
    const paragraph = [line.trim()];
    for (
      index += 1;
      index < lines.length && lines[index].trim() && !startsBlock(lines[index]);
      index += 1
    ) {
      paragraph.push(lines[index].trim());
    }
    html.push(`<p>${inline(paragraph.join(' '))}</p>`);
  }
  return html.join('\n');
}

function parsePlan(source) {
  const meta = {};
  let lines = source.split('\n');
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    for (const line of lines.slice(1, end)) {
      const pair = line.match(/^([\w-]+):\s*(.*)$/);
      if (pair) {
        meta[pair[1].toLowerCase()] = pair[2].replace(/^["']|["']$/g, '');
      }
    }
    lines = lines.slice(end + 1);
  }
  let title = '';
  const lead = [];
  const sections = [];
  for (const line of lines) {
    const field = line.match(/^(Status|Page):\s*(.*)$/);
    if (field && sections.length === 0) {
      meta[field[1].toLowerCase()] = field[2].trim();
      continue;
    }
    if (!title && /^#\s+/.test(line)) {
      title = line.replace(/^#\s+/, '').trim();
      continue;
    }
    const heading = line.match(/^##\s+(.*)$/);
    if (heading) sections.push({ title: heading[1].trim(), lines: [] });
    else (sections.at(-1)?.lines ?? lead).push(line);
  }
  return { meta, title, lead, sections };
}

function reviewRows(planPath) {
  const log = planPath.replace(/\.md$/, '.decisions.tsv');
  if (!existsSync(log)) return [];
  return readFileSync(log, 'utf-8')
    .split('\n')
    .slice(1)
    .map((row) => row.split('\t'))
    .filter((row) => /^review/i.test(row[1] ?? ''))
    .map((row) => ({ decision: row[2], result: row[5] ?? '' }));
}

function statusTone(status) {
  if (/done|complete|shipped/i.test(status)) return 'done';
  if (/execut|build|progress/i.test(status)) return 'active';
  if (/block|paused/i.test(status)) return 'held';
  return 'planning';
}

function page(planPath) {
  const plan = parsePlan(readFileSync(planPath, 'utf-8'));
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: dirname(planPath),
    encoding: 'utf-8',
  }).trim();
  const repoPath = relative(root, planPath);
  const status = plan.meta.status ?? 'unknown';
  const { lead, pairs } = pageConfig(root);
  assertPairs(plan.sections, pairs);
  const hasContent = (section) => section?.lines.some((line) => line.trim());
  const byRole = (role) =>
    plan.sections.filter(
      (section) => roleOf(section, lead) === role && hasContent(section)
    );
  const sectionHtml = (section, className = 'plan') =>
    `<section class="${className}"><h2>${inline(section.title)}</h2>${blocksHtml(section.lines)}</section>`;
  const [needs] = byRole('needs');
  const reviews = reviewRows(planPath);
  const reviewList = reviews.length
    ? `<section class="plan"><h2>Review edits <span class="count">${reviews.length}</span></h2><ul>${reviews
        .map(
          (row) =>
            `<li>${inline(row.decision)}${row.result ? ` <span class="count">${inline(row.result)}</span>` : ''}</li>`
        )
        .join('')}</ul></section>`
    : '';
  const updated = new Date(statSync(planPath).mtimeMs)
    .toISOString()
    .slice(0, 16)
    .replace('T', ' ');
  const handOff = `$cross-review ${repoPath}`;
  const title = escapeHtml(plan.title || basename(planPath, '.md'));

  return `<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap">
<style>
:root {
  --ground: #f6f7f8; --paper: #ffffff; --ink: #1b2026; --muted: #5b6672; --rule: #dde2e7;
  --accent: #2c5b8f; --accent-soft: #e6eef7; --amber: #9a5b00; --amber-soft: #fbf1df; --green: #2f6b3f; --green-soft: #e5f2e8; --code: #eef1f4;
  --kw: #8a3f9e; --str: #3d6b21; --fn: #2c5b8f; --num: #a24d12;
  --sans: "Schibsted Grotesk", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --ground: #121518; --paper: #1a1e23; --ink: #e4e8ec; --muted: #9aa5b1; --rule: #2c333b;
  --accent: #8db6e6; --accent-soft: #1f2d3d; --amber: #f0b45c; --amber-soft: #33270f; --green: #8fcf9f; --green-soft: #18291d; --code: #232931; --kw: #d7a1e6; --str: #a8d48a; --fn: #8db6e6; --num: #f0a66e; color-scheme: dark;
} }
:root[data-theme="dark"] {
  --ground: #121518; --paper: #1a1e23; --ink: #e4e8ec; --muted: #9aa5b1; --rule: #2c333b;
  --accent: #8db6e6; --accent-soft: #1f2d3d; --amber: #f0b45c; --amber-soft: #33270f; --green: #8fcf9f; --green-soft: #18291d; --code: #232931; --kw: #d7a1e6; --str: #a8d48a; --fn: #8db6e6; --num: #f0a66e; color-scheme: dark;
}
body { background: var(--ground); color: var(--ink); font: 15px/1.6 var(--sans); padding: 0 16px; }
main { max-width: 760px; margin: 0 auto; padding-block: 32px 64px; display: grid; gap: 28px; }
header { display: grid; gap: 8px; }
h1 { font-size: 1.75rem; line-height: 1.2; margin: 0; text-wrap: balance; font-weight: 700; }
h2 { font-size: 1.15rem; margin: 0 0 8px; text-wrap: balance; }
h3, h4, h5 { font-size: 1rem; margin: 16px 0 4px; }
.meta { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; color: var(--muted); font-size: 0.85rem; }
.pill { font-size: 0.72rem; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; padding: 2px 10px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); }
.pill.done { background: var(--green-soft); color: var(--green); }
.pill.held, .pill.planning { background: var(--amber-soft); color: var(--amber); }
.panel { background: var(--paper); border: 1px solid var(--rule); border-radius: 10px; padding: 16px 18px; min-width: 0; }
.panel.needs { border-color: var(--amber); }
.panel h2 { display: flex; gap: 10px; align-items: baseline; }
.count { font-size: 0.8rem; color: var(--muted); font-weight: 500; }
.quiet { color: var(--muted); margin: 0; }
.handoff { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.handoff code { flex: 1 1 260px; min-width: 0; overflow-wrap: anywhere; padding: 8px 10px; }
button { font: 500 0.85rem var(--sans); color: var(--accent); background: var(--accent-soft); border: 1px solid transparent; border-radius: 8px; padding: 7px 14px; cursor: pointer; }
button:focus-visible, a:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
section.plan { display: grid; gap: 4px; min-width: 0; }
section.plan + section.plan { border-top: 1px solid var(--rule); padding-top: 20px; }
p { margin: 0 0 10px; max-width: 68ch; }
ul, ol { margin: 0 0 10px; padding-left: 1.4em; }
li { margin: 3px 0; }
li > ul, li > ol { margin: 4px 0; }
code { font: 0.86em var(--mono); background: var(--code); padding: 1px 5px; border-radius: 4px; }
pre { margin: 0; padding: 12px 14px; background: var(--code); border-radius: 8px; }
pre code { padding: 0; background: none; }
.scroll { overflow-x: auto; margin: 0 0 12px; }
table { border-collapse: collapse; font-size: 0.9rem; min-width: 100%; }
th, td { text-align: left; vertical-align: top; padding: 7px 10px; border-bottom: 1px solid var(--rule); }
th { font-weight: 600; color: var(--muted); font-size: 0.78rem; letter-spacing: 0.04em; text-transform: uppercase; }
blockquote { margin: 0 0 10px; padding-left: 12px; border-left: 3px solid var(--rule); color: var(--muted); }
a { color: var(--accent); }
.box { display: inline-block; width: 0.85em; height: 0.85em; border: 1.5px solid var(--muted); border-radius: 3px; margin-right: 8px; vertical-align: -0.08em; }
.box.done { background: var(--green); border-color: var(--green); }
.compare { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin: 6px 0 14px; }
.compare > div { min-width: 0; display: grid; gap: 4px; align-content: start; }
.compare .scroll { margin: 0; }
.side { font-size: 0.72rem; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
@media (max-width: 640px) { .compare { grid-template-columns: minmax(0, 1fr); } }
.details { border-top: 1px solid var(--rule); padding-top: 14px; display: grid; gap: 20px; }
.details > summary { cursor: pointer; color: var(--muted); font-size: 0.9rem; }
.hljs-keyword, .hljs-built_in, .hljs-type { color: var(--kw); }
.hljs-string, .hljs-regexp { color: var(--str); }
.hljs-title, .hljs-title.function_, .hljs-title.class_ { color: var(--fn); }
.hljs-number, .hljs-literal { color: var(--num); }
.hljs-attr, .hljs-property, .hljs-params { color: var(--ink); }
.hljs-comment { color: var(--muted); font-style: italic; }
</style>
<main>
  <header>
    <h1>${title}</h1>
    <div class="meta"><span class="pill ${statusTone(status)}">${escapeHtml(status)}</span><code>${escapeHtml(repoPath)}</code><span>Updated ${updated} UTC</span></div>
    <div class="handoff"><code id="handoff">${escapeHtml(handOff)}</code><button id="copy" type="button">Copy</button></div>
  </header>
  ${needs ? `<section class="panel needs"><h2>Needs you</h2>${blocksHtml(needs.lines)}</section>` : ''}
  ${byRole('api')
    .map((section) => sectionHtml(section, 'panel'))
    .join('\n  ')}
  ${byRole('lead')
    .sort((a, b) => lead.indexOf(a.title.toLowerCase()) - lead.indexOf(b.title.toLowerCase()))
    .map((section) => sectionHtml(section, 'panel'))
    .join('\n  ')}
  ${byRole('main')
    .map((section) => sectionHtml(section, 'panel'))
    .join('\n  ')}
  ${byRole('picked')
    .map((section) => sectionHtml({ ...section, title: 'Picked for you' }))
    .join('\n  ')}
  ${plan.lead.some((line) => line.trim()) ? `<section class="plan">${blocksHtml(plan.lead)}</section>` : ''}
  ${byRole('idea')
    .map((section) => sectionHtml(section))
    .join('\n  ')}
  ${
    byRole('details').length || reviewList
      ? `<details class="details"><summary>Details: ${byRole('details')
          .map((section) => escapeHtml(section.title.toLowerCase()))
          .concat(reviewList ? ['review edits'] : [])
          .join(', ')}</summary>${byRole('details')
          .map((section) => sectionHtml(section))
          .join('')}${reviewList}</details>`
      : ''
  }
</main>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
<script>
window.hljs?.highlightAll();
</script>
<script>
document.getElementById('copy').addEventListener('click', async (event) => {
  const text = document.getElementById('handoff').textContent;
  try {
    await navigator.clipboard.writeText(text);
    event.target.textContent = 'Copied';
  } catch {
    const range = document.createRange();
    range.selectNodeContents(document.getElementById('handoff'));
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    event.target.textContent = 'Selected';
  }
});
</script>
`;
}

const planPath = process.argv[2] && resolve(process.argv[2]);
if (!planPath || !existsSync(planPath)) {
  console.error('Usage: node .agents/pstack/plan-page.mjs <plan.md>');
  process.exit(2);
}
const out = join(
  dirname(planPath),
  'artifacts',
  `${basename(planPath, '.md')}.html`
);
let html;
try {
  html = page(planPath);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.info(out);
