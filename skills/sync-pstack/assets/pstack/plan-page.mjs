#!/usr/bin/env node
// Installed by the sync-pstack skill.
// Usage: node .agents/pstack/plan-page.mjs <plan.md>

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
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
    topic: config.pageTopic ?? {},
  };
}

function subjectOf(plan, topic) {
  if (plan.fields.topic) return plan.fields.topic;
  return topic.field ? (plan.lists[topic.field.toLowerCase()]?.[0] ?? null) : null;
}

function iterationsOf(plansDir, subject, topic) {
  return readdirSync(plansDir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => ({ path: join(plansDir, name), plan: parsePlan(readFileSync(join(plansDir, name), 'utf-8')) }))
    .filter(({ plan }) => subjectOf(plan, topic) === subject)
    .sort((a, b) => basename(b.path).localeCompare(basename(a.path)));
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

function lineDiff(before, after) {
  const a = before.split('\n');
  const b = after.split('\n');
  const common = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      common[i][j] = a[i] === b[j] ? common[i + 1][j + 1] + 1 : Math.max(common[i + 1][j], common[i][j + 1]);
    }
  }
  const rows = [];
  let removed = [];
  let added = [];
  const flush = () => {
    for (let k = 0; k < Math.max(removed.length, added.length); k += 1) {
      rows.push([removed[k] ?? null, added[k] ?? null]);
    }
    removed = [];
    added = [];
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      flush();
      rows.push([{ kind: 'same', n: i + 1, text: a[i] }, { kind: 'same', n: j + 1, text: b[j] }]);
      i += 1;
      j += 1;
    } else if (j < b.length && (i === a.length || common[i][j + 1] >= common[i + 1][j])) {
      added.push({ kind: 'add', n: j + 1, text: b[j] });
      j += 1;
    } else {
      removed.push({ kind: 'del', n: i + 1, text: a[i] });
      i += 1;
    }
  }
  flush();
  return rows;
}

function diffHtml(before, after) {
  const rows = lineDiff(before.body, after.body);
  const lang = after.lang || before.lang;
  const line = (cell, sign) =>
    cell
      ? `<div class="row ${cell.kind}"><span class="num">${cell.n}</span><span class="sign">${cell.kind === 'same' ? '' : sign}</span><code${lang ? ` class="language-${lang}"` : ''}>${escapeHtml(cell.text) || ' '}</code></div>`
      : '<div class="row filler"><span class="num"></span><span class="sign"></span><code> </code></div>';
  const pane = (index, label, sign, kind) =>
    `<div class="pane"><div class="pane-head"><span class="side">${label}</span><span class="tally ${kind}">${sign}${rows.filter((row) => row[index]?.kind === kind).length}</span></div><div class="pane-body"><div class="diff">${rows.map((row) => line(row[index], sign)).join('')}</div></div></div>`;
  return `<div class="compare">${pane(0, 'Before', '\u2212', 'del')}${pane(1, 'After', '+', 'add')}</div>`;
}

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
          ? diffHtml(pair.first, pair.after)
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

const OPTION = /^\s*[-*+]\s+\*\*(.+?)\*\*(\s*\(recommended\))?\s*(?::\s*(.*))?$/i;

// Open questions written as `### Header`, a one-line question and bold-labeled
// options render like Claude's question tool; anything else renders as text.
function needsHtml(lines) {
  const intro = [];
  const groups = [];
  for (const line of lines) {
    const heading = line.match(/^###\s+(.*)$/);
    if (heading) groups.push({ header: heading[1].trim(), lines: [] });
    else (groups.at(-1)?.lines ?? intro).push(line);
  }
  if (groups.length === 0) return blocksHtml(lines);
  const questions = groups.map((group, index) => {
    const question = [];
    const options = [];
    const more = [];
    let stage = 'question';
    for (const line of group.lines) {
      if (stage === 'options' && !line.trim()) stage = 'more';
      const option = stage === 'more' ? null : line.match(OPTION);
      if (option) {
        const description = option[3]?.trim() ?? '';
        const trailing = /\s*\(recommended\)$/i;
        options.push({
          description: description.replace(trailing, ''),
          label: option[1].trim(),
          recommended: Boolean(option[2]) || trailing.test(description),
        });
        stage = 'options';
      } else if (stage === 'options' && /^\s+\S/.test(line)) {
        options.at(-1).description += ` ${line.trim()}`;
      } else if (stage === 'question' && line.trim()) {
        question.push(line.trim());
      } else if (stage === 'more' || line.trim() || question.length > 0) {
        if (line.trim() || more.length > 0) more.push(line);
        if (line.trim()) stage = 'more';
      }
    }
    const recommended = options.findIndex((option) => option.recommended);
    const ordered = recommended < 0 ? options : [options[recommended], ...options.filter((_, i) => i !== recommended)];
    const id = `needs-${index + 1}`;
    const optionHtml = ordered
      .map((option, i) => {
        const picked = recommended >= 0 && i === 0;
        const value = picked ? '' : option.label.replace(/[`*]/g, '');
        return `<label class="option"><input type="radio" name="${id}" value="${escapeHtml(value)}"${picked ? ' checked' : ''}><span class="option-body"><span class="option-label">${inline(option.label)}${picked && ordered.length > 1 ? ' <span class="rec">Recommended</span>' : ''}</span>${option.description ? `<span class="option-desc">${inline(option.description)}</span>` : ''}</span></label>`;
      })
      .join('');
    const moreHtml = more.some((line) => line.trim())
      ? `<details class="more"><summary>More</summary>${blocksHtml(more)}</details>`
      : '';
    return `<div class="question" role="radiogroup" aria-labelledby="${id}" data-header="${escapeHtml(group.header.replace(/[`*]/g, ''))}"><p class="question-text" id="${id}"><span class="chip">${inline(group.header)}</span>${inline(question.join(' '))}</p>${optionHtml}${moreHtml}</div>`;
  });
  return `<p><strong>go</strong> takes every recommendation.</p>${blocksHtml(intro)}${questions.join('')}<div class="answer" hidden><code></code><button type="button">Copy answer</button></div>`;
}

function parsePlan(source) {
  const meta = {};
  const fields = {};
  const lists = {};
  let lines = source.split('\n');
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    let key = null;
    for (const line of lines.slice(1, end)) {
      const pair = line.match(/^([\w-]+):\s*(.*)$/);
      const item = line.match(/^\s+-\s+(.*)$/);
      if (pair) {
        key = pair[1].toLowerCase();
        meta[key] = pair[2].replace(/^["']|["']$/g, '');
        const inline = pair[2].match(/^\[(.*)\]$/);
        lists[key] = inline ? inline[1].split(',').map((entry) => entry.trim()).filter(Boolean) : [];
      } else if (item && key) {
        lists[key].push(item[1].trim());
      }
    }
    lines = lines.slice(end + 1);
  }
  let title = '';
  const lead = [];
  const sections = [];
  for (const line of lines) {
    const field = line.match(/^(Status|Page|Topic):\s*(.*)$/);
    if (field && sections.length === 0) {
      meta[field[1].toLowerCase()] = field[2].trim();
      fields[field[1].toLowerCase()] = field[2].trim();
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
  return { meta, fields, lists, title, lead, sections };
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
  const { lead, pairs, topic } = pageConfig(root);
  const plansDir = dirname(planPath);
  let subject = subjectOf(plan, topic);
  const missing = subject && !existsSync(join(plansDir, 'topics', `${subject}.md`));
  if (missing) {
    const hint = `create ${relative(root, join(plansDir, 'topics', `${subject}.md`))} with a # title and its ## Main changes; the first publish adds its Page: line`;
    if (plan.fields.topic) throw new Error(`${repoPath} belongs to topic ${subject}; ${hint}`);
    console.error(`${repoPath} renders its own page until its subject has a file: ${hint}`);
    subject = null;
  }
  const subjectPath = subject && join(plansDir, 'topics', `${subject}.md`);
  const doc = subjectPath ? parsePlan(readFileSync(subjectPath, 'utf-8')) : plan;
  const iterations = subject ? iterationsOf(plansDir, subject, topic) : [];
  assertPairs(plan.sections, pairs);
  if (doc !== plan) assertPairs(doc.sections, pairs);
  const hasContent = (section) => section?.lines.some((line) => line.trim());
  const byRole = (role, source = doc) =>
    source.sections.filter(
      (section) => roleOf(section, lead) === role && hasContent(section)
    );
  const sectionHtml = (section, className = 'plan') =>
    `<section class="${className}"><h2>${inline(section.title)}</h2>${blocksHtml(section.lines)}</section>`;
  const [needs] = byRole('needs', plan);
  const iterationHtml = ({ path, plan: iteration }) => {
    const iterationStatus = iteration.meta.status ?? 'unknown';
    const open = statusTone(iterationStatus) !== 'done' && path !== planPath;
    const shown = iteration.sections.filter(
      (section) =>
        hasContent(section) &&
        (/^main changes$/i.test(section.title) ||
          (open && /^(open questions|defaults)$/i.test(section.title)))
    );
    const head = `<span class="pill ${statusTone(iterationStatus)}">${escapeHtml(iterationStatus)}</span> <strong>${inline(iteration.title || basename(path, '.md'))}</strong> <code>${escapeHtml(relative(root, path))}</code>`;
    const body =
      shown.map((section) => `<h3>${inline(section.title)}</h3>${blocksHtml(section.lines)}`).join('') +
      (open ? `<p><code>${escapeHtml(`$cross-review ${relative(root, path)}`)}</code></p>` : '');
    return body
      ? `<details class="iteration"${path === planPath || open ? ' open' : ''}><summary>${head}</summary>${body}</details>`
      : `<p class="iteration">${head}</p>`;
  };
  const iterationList = iterations.length
    ? `<section class="plan"><h2>Iterations <span class="count">${iterations.length}</span></h2>${iterations.map(iterationHtml).join('')}</section>`
    : '';
  const hubPath = subject && topic.hub ? topic.hub.replaceAll('{topic}', subject) : null;
  const hub = hubPath && existsSync(join(root, hubPath)) ? hubPath : null;
  if (hub) {
    for (const required of titles(topic, 'require')) {
      if (!doc.sections.some((section) => section.title.toLowerCase() === required && hasContent(section))) {
        throw new Error(`${subject} needs ## ${topic.require.find((title) => title.toLowerCase() === required)} in ${relative(root, subjectPath)}, because it is a ledger scope`);
      }
    }
  }
  const reviews = reviewRows(planPath);
  const reviewList = reviews.length
    ? `<section class="plan"><h2>Review edits <span class="count">${reviews.length}</span></h2><ul>${reviews
        .map(
          (row) =>
            `<li>${inline(row.decision)}${row.result ? ` <span class="count">${inline(row.result)}</span>` : ''}</li>`
        )
        .join('')}</ul></section>`
    : '';
  const updated = new Date(
    Math.max(statSync(planPath).mtimeMs, subjectPath ? statSync(subjectPath).mtimeMs : 0)
  )
    .toISOString()
    .slice(0, 16)
    .replace('T', ' ');
  const handOff = `$cross-review ${repoPath}`;
  const title = escapeHtml(doc.title || basename(planPath, '.md'));
  const where = subjectPath ? relative(root, subjectPath) : repoPath;

  const html = `<title>${title}</title>
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
.question { display: grid; gap: 8px; margin: 0 0 18px; min-width: 0; }
.question-text { margin: 0 0 2px; font-weight: 600; display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; max-width: none; }
.chip { font: 600 0.72rem var(--sans); letter-spacing: 0.04em; text-transform: uppercase; color: var(--amber); background: var(--amber-soft); border-radius: 999px; padding: 2px 8px; }
.option { display: flex; gap: 10px; align-items: flex-start; padding: 9px 12px; border: 1px solid var(--rule); border-radius: 8px; cursor: pointer; min-width: 0; }
.option:has(input:checked) { border-color: var(--accent); background: var(--accent-soft); }
.option input { margin: 4px 0 0; accent-color: var(--accent); flex: none; }
.option-body { display: grid; gap: 2px; min-width: 0; }
.option-label { font-weight: 600; overflow-wrap: anywhere; }
.option-desc { color: var(--muted); font-size: 0.88rem; }
.rec { font: 600 0.68rem var(--sans); letter-spacing: 0.04em; text-transform: uppercase; color: var(--green); margin-left: 6px; }
.more summary { color: var(--muted); font-size: 0.85rem; cursor: pointer; }
.answer { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.answer[hidden] { display: none; }
.answer code { flex: 1 1 260px; min-width: 0; overflow-wrap: anywhere; padding: 8px 10px; }
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
.compare { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; margin: 6px 0 14px; }
.pane { min-width: 0; border: 1px solid var(--rule); border-radius: 8px; overflow: hidden; background: var(--code); }
.pane-head { display: flex; justify-content: space-between; align-items: center; padding: 5px 12px; border-bottom: 1px solid var(--rule); }
.tally { font: 600 0.78rem var(--mono); }
.tally.del, .diff .del .sign { color: var(--red, #a3352b); }
.tally.add, .diff .add .sign { color: var(--green); }
.pane-body { overflow-x: auto; }
.diff { display: grid; min-width: 100%; width: max-content; padding: 6px 0; font: 0.86em/1.6 var(--mono); }
.diff .row { display: grid; grid-template-columns: 4ch 2.5ch 1fr; }
.diff .row code { font: inherit; background: none; padding: 0 14px 0 0; border-radius: 0; white-space: pre; }
.diff .num { color: var(--muted); text-align: right; padding-right: 1ch; opacity: 0.7; user-select: none; }
.diff .sign { text-align: center; user-select: none; }
.diff .del { background: color-mix(in srgb, var(--red, #a3352b) 15%, transparent); }
.diff .add { background: color-mix(in srgb, var(--green) 15%, transparent); }
.diff .filler { display: none; }
.side { font-size: 0.72rem; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
@media (min-width: 1280px) {
  main > :has(.compare) { --wide: min(1200px, calc(100vw - 64px)); box-sizing: border-box; width: var(--wide); margin-inline: calc((100% - var(--wide)) / 2); }
  .compare { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .diff .filler { display: grid; background: repeating-linear-gradient(135deg, transparent 0 6px, color-mix(in srgb, var(--rule) 45%, transparent) 6px 7px); }
}
.details { border-top: 1px solid var(--rule); padding-top: 14px; display: grid; gap: 20px; }
.details > summary { cursor: pointer; color: var(--muted); font-size: 0.9rem; }
.iteration { margin: 8px 0; }
details.iteration > summary { cursor: pointer; }
details.iteration[open] > summary { margin-bottom: 6px; }
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
    <div class="meta"><span class="pill ${statusTone(status)}">${escapeHtml(status)}</span><code>${escapeHtml(where)}</code>${hub ? `<span>History <code>${escapeHtml(hub)}</code></span>` : ''}<span>Updated ${updated} UTC</span></div>
    <div class="handoff"><code id="handoff">${escapeHtml(handOff)}</code><button id="copy" type="button">Copy</button></div>
  </header>
  ${needs ? `<section class="panel needs"><h2>Needs you</h2>${needsHtml(needs.lines)}</section>` : ''}
  ${byRole('api')
    .map((section) => sectionHtml(section, 'panel'))
    .join('\n  ')}
  ${doc !== plan && statusTone(status) !== 'done'
    ? byRole('api', plan)
        .map((section) => sectionHtml({ ...section, title: 'Public API proposed in this iteration' }, 'panel'))
        .join('\n  ')
    : ''}
  ${byRole('lead')
    .sort((a, b) => lead.indexOf(a.title.toLowerCase()) - lead.indexOf(b.title.toLowerCase()))
    .map((section) => sectionHtml(section, 'panel'))
    .join('\n  ')}
  ${byRole('main')
    .map((section) => sectionHtml(section, 'panel'))
    .join('\n  ')}
  ${byRole('picked', plan)
    .map((section) => sectionHtml({ ...section, title: 'Picked for you' }))
    .join('\n  ')}
  ${doc.lead.some((line) => line.trim()) ? `<section class="plan">${blocksHtml(doc.lead)}</section>` : ''}
  ${byRole('idea')
    .map((section) => sectionHtml(section))
    .join('\n  ')}
  ${iterationList}
  ${
    byRole('details', plan).length || reviewList
      ? `<details class="details"><summary>Details: ${byRole('details', plan)
          .map((section) => escapeHtml(section.title.toLowerCase()))
          .concat(reviewList ? ['review edits'] : [])
          .join(', ')}</summary>${byRole('details', plan)
          .map((section) => sectionHtml(section))
          .join('')}${reviewList}</details>`
      : ''
  }
</main>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
<script>
window.hljs?.highlightAll();
document.querySelectorAll('.diff code').forEach((element) => window.hljs?.highlightElement(element));
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
<script>
(() => {
  const panel = document.querySelector('.panel.needs');
  const box = panel && panel.querySelector('.answer');
  if (!box) return;
  const code = box.querySelector('code');
  const button = box.querySelector('button');
  const update = () => {
    const questions = [...panel.querySelectorAll('.question')];
    const open = questions.filter((question) => !question.querySelector('input:checked')).map((question) => question.dataset.header);
    const changes = questions
      .map((question) => [question.dataset.header, (question.querySelector('input:checked') || {}).value || ''])
      .filter((change) => change[1]);
    box.hidden = open.length === 0 && changes.length === 0;
    button.hidden = open.length > 0;
    code.textContent = open.length > 0
      ? 'Pick an answer for ' + open.join(', ')
      : 'go, except ' + changes.map((change) => change[0] + ': ' + change[1]).join('; ');
    button.textContent = 'Copy answer';
  };
  panel.addEventListener('change', update);
  update();
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(code.textContent);
      button.textContent = 'Copied';
    } catch {
      const range = document.createRange();
      range.selectNodeContents(code);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      button.textContent = 'Selected';
    }
  });
})();
</script>
`;
  return { html, name: subject ? join('topics', subject) : basename(planPath, '.md') };
}

const planPath = process.argv[2] && resolve(process.argv[2]);
if (!planPath || !existsSync(planPath)) {
  console.error('Usage: node .agents/pstack/plan-page.mjs <plan.md>');
  process.exit(2);
}
let rendered;
try {
  rendered = page(planPath);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const out = join(dirname(planPath), 'artifacts', `${rendered.name}.html`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, rendered.html);
console.info(out);
