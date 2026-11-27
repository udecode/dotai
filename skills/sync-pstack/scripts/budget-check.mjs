#!/usr/bin/env node
// Structural budget gate for sync-pstack rules, helper scripts, and ustack skills.
// Enforces:
//  - principle-guard-the-context-window + principle-subtract-before-you-add:
//    per-rule-file byte cap, total rules byte cap, per-skill byte cap, total skill byte cap
//  - principle-subtract-before-you-add + principle-boundary-discipline:
//    helper .mjs file count cap and per-helper line cap (with shrinking baselines
//    only for existing large core engines)

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ASSETS = join(import.meta.dirname, '../assets/pstack');
const RULES = join(ASSETS, 'rules');
const SKILLS = join(import.meta.dirname, '../..');

const MAX_RULE_BYTES = 8192;
const MAX_TOTAL_RULE_BYTES = 80000;
const MAX_SKILL_BYTES = 16384;
const MAX_TOTAL_SKILL_BYTES = 100000;
const MAX_HELPER_FILES = 14;
const MAX_HELPER_LINES = 400;

// Existing core engines above 400 lines; ceilings may only shrink, never grow.
const LEGACY_LINE_CEILINGS = {
  'cross.mjs': 439,
  'land.mjs': 876,
  'lead.mjs': 456,
  'proof.mjs': 546,
  'status.mjs': 416,
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

const skillDirs = readdirSync(SKILLS, { withFileTypes: true }).filter((entry) => entry.isDirectory() && existsSync(join(SKILLS, entry.name, 'SKILL.md'))).map((entry) => entry.name).sort();
let totalSkillBytes = 0;
for (const name of skillDirs) {
  const bytes = statSync(join(SKILLS, name, 'SKILL.md')).size;
  totalSkillBytes += bytes;
  if (bytes > MAX_SKILL_BYTES) {
    failures.push(`skills/${name}/SKILL.md is ${bytes} bytes (max ${MAX_SKILL_BYTES}); keep well below agy's 24 KB cap (principle-guard-the-context-window + principle-subtract-before-you-add)`);
  }
}
if (totalSkillBytes > MAX_TOTAL_SKILL_BYTES) {
  failures.push(`skills/*/SKILL.md total ${totalSkillBytes} bytes (max ${MAX_TOTAL_SKILL_BYTES}); subtract before adding (principle-guard-the-context-window + principle-subtract-before-you-add)`);
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
console.log(`budgets ok: ${ruleFiles.length} rules (${totalRuleBytes}/${MAX_TOTAL_RULE_BYTES} bytes), ${skillDirs.length} skills (${totalSkillBytes}/${MAX_TOTAL_SKILL_BYTES} bytes, max ${MAX_SKILL_BYTES}/file), ${helperFiles.length}/${MAX_HELPER_FILES} helpers`);
