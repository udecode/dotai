// Every session rereads the rendered pstack block, so this measures what a
// project receives, not the template: it renders assets/block.md for each
// delivery mode and every on/off combination of the other keys its conditions
// name, with no section skipped, and fails when the largest render exceeds the
// budget. Placeholder values are short fixtures, so a project's own lists, such
// as its playbooks and reviews, are not counted.
// Usage: node block-budget.mjs <budget bytes>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DELIVERIES, render } from './sync-pstack.mjs';

const template = readFileSync(join(import.meta.dirname, '../assets/block.md'), 'utf8');
const budget = Number(process.argv[2]);
if (!Number.isInteger(budget) || budget <= 0) throw new Error('usage: node block-budget.mjs <budget bytes>');

const conditions = [...template.matchAll(/^<!-- if (\S+) -->$/gmu)].map((match) => match[1]);
const keyed = conditions.filter((condition) => condition.includes('=') && !/^delivery!?=/u.test(condition));
if (keyed.length > 0) throw new Error(`block-budget measures only delivery comparisons, found: ${keyed.join(', ')}`);
const optional = [...new Set(conditions.map((condition) => condition.replace(/^!/u, '')).filter((key) => !key.startsWith('delivery')))];
const values = { tag: 'v0.0.0', branch: 'next', lintFix: 'lint', check: 'check', plans: 'docs/plans', protected: 'main', maxEffort: 'xhigh', glossary: 'docs/glossary.md', proof: 'verify' };
const placeholders = [...new Set([...template.matchAll(/\{\{(\w+)\}\}/gu)].map((match) => match[1]))];
const always = Object.fromEntries(placeholders.filter((key) => !optional.includes(key)).map((key) => [key, values[key] ?? 'x']));

let largest = { bytes: 0 };
for (const delivery of DELIVERIES) {
  let modeLargest = { bytes: 0 };
  for (let mask = 0; mask < 2 ** optional.length; mask += 1) {
    const on = optional.filter((_, bit) => mask & (2 ** bit));
    const config = { ...always, delivery, ...Object.fromEntries(on.map((key) => [key, values[key] ?? 'x'])) };
    const bytes = Buffer.byteLength(render(template, config));
    if (bytes > modeLargest.bytes) modeLargest = { bytes, delivery, on };
  }
  console.log(`${delivery}: ${modeLargest.bytes} bytes at most, with ${modeLargest.on.join(', ') || 'no optional key'} set`);
  if (modeLargest.bytes > largest.bytes) largest = modeLargest;
}
if (largest.bytes > budget) {
  console.log(`sync-pstack: the block renders to ${largest.bytes} bytes for delivery ${largest.delivery}, over its ${budget}-byte budget; move a rule's detail into a file under assets/pstack/rules/, register it in RULE_FILES and leave a bullet that says when to read it`);
  process.exit(1);
}
