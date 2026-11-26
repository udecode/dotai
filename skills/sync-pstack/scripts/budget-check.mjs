#!/usr/bin/env node
// Structural budget gate for sync-pstack rules and helper scripts.
// Enforces:
//  - principle-guard-the-context-window + principle-subtract-before-you-add:
//    per-rule-file byte cap and total rules byte cap
//  - principle-subtract-before-you-add + principle-boundary-discipline:
//    helper .mjs file count cap and per-helper line cap (with shrinking baselines
//    only for existing large core engines)

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ASSETS = join(import.meta.dirname, '../assets/pstack');
const RULES = join(ASSETS, 'rules');

const MAX_RULE_BYTES = 8192;
const MAX_TOTAL_RULE_BYTES = 80000;
const MAX_HELPER_FILES = 19;
const MAX_HELPER_LINES = 400;

// Existing core engines above 400 lines; ceilings may only shrink, never grow.
const LEGACY_LINE_CEILINGS = {
  'cross.mjs': 444,
  'land.mjs': 1143,
  'lead.mjs': 458,
  'plan-page.mjs': 2684,
  'proof.mjs': 546,
  'status.mjs': 416,
  'tasks.mjs': 1699,
};

const failures = [];

const ruleFiles = readdirSync(RULES).filter((name) => name.endsWith('.md')).sort();
let totalRuleBytes = 0;
for (const name of ruleFiles) {
  const bytes = statSync(join(RULES, name)).size;
  totalRuleBytes += bytes;
  if (bytes > MAX_RULE_BYTES) {
    failures.push(`rules/${name} is ${bytes} bytes (max ${MAX_RULE_BYTES}); compress or delete redundant prose (principle-guard-the-context-window + principle-subtract-before-you-add)`);
  }
}
if (totalRuleBytes > MAX_TOTAL_RULE_BYTES) {
  failures.push(`assets/pstack/rules/*.md total ${totalRuleBytes} bytes (max ${MAX_TOTAL_RULE_BYTES}); subtract before adding (principle-guard-the-context-window + principle-subtract-before-you-add)`);
}

const helperFiles = readdirSync(ASSETS).filter((name) => name.endsWith('.mjs')).sort();
if (helperFiles.length > MAX_HELPER_FILES) {
  failures.push(`assets/pstack has ${helperFiles.length} .mjs helpers (max ${MAX_HELPER_FILES}); delete or merge before adding (principle-subtract-before-you-add + principle-boundary-discipline)`);
}
for (const name of helperFiles) {
  const lines = readFileSync(join(ASSETS, name), 'utf8').split('\n').length - 1;
  const cap = LEGACY_LINE_CEILINGS[name] ?? MAX_HELPER_LINES;
  if (lines > cap) {
    failures.push(`assets/pstack/${name} is ${lines} lines (max ${cap}); guard boundaries only and subtract before adding (principle-subtract-before-you-add + principle-boundary-discipline)`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`budget-check: ${failure}`);
  process.exit(1);
}
console.log(`budgets ok: ${ruleFiles.length} rules (${totalRuleBytes}/${MAX_TOTAL_RULE_BYTES} bytes, max ${MAX_RULE_BYTES}/file), ${helperFiles.length}/${MAX_HELPER_FILES} helpers`);
