// A project with a suggested-task ledger, driven through decisions-check.mjs, for the chips and
// decisions-check test files.
import { spawnSync } from 'node:child_process';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commit, project, sandbox } from './test-sandbox.mjs';

const HELPERS = fileURLToPath(new URL('../assets/pstack', import.meta.url));
const CHECK = join(HELPERS, 'decisions-check.mjs');

export const chipLedger = ({ config = {}, files = {} } = {}) => {
  const { dir, env, run } = sandbox();
  const root = project(dir, 'app', { files: { 'docs/plans/.keep': '', '.agents/pstack.json': JSON.stringify({ branch: 'next', ...config }), ...files } });
  spawnSync('git', ['-C', root, 'remote', 'add', 'origin', join(dir, 'origin.git')]);
  const LEDGER = 'docs/plans/suggested-tasks.decisions.tsv';
  const helper = (...args) => run(process.execPath, [CHECK, ...args], root);
  const appendTo = (log, phase, decision, evidence, result) => helper('append', log, phase, decision, 'why', evidence, result);
  // A new offer must name its priority, so the helpers give each offer that names
  // none a P1 bug's evidence, keeping every test's task listed in full on the board.
  const tagged = (result, evidence) => (/^offered\b/u.test(result) && !/(?:^|[\s;])priority:/u.test(evidence) ? `${evidence}; priority: P1; repro: steps` : evidence);
  const chip = (decision, result, evidence = 'evidence') => appendTo(LEDGER, 'chip', decision, tagged(result, evidence), result);
  const offer = (decision, writes = 'README.md', more = 'topic: docs') => chip(decision, 'offered', `writes: ${writes}; ${more}`);
  const batch = (rows) => {
    writeFileSync(join(root, 'batch.tsv'), rows.map(([decision, result, evidence = 'evidence']) => ['chip', decision, 'why', tagged(result, evidence), result].join('\t')).join('\n') + '\n');
    return helper('append', LEDGER, '--from', 'batch.tsv');
  };
  const chips = (...args) => helper('chips', ...args);
  const merge = (subject) => {
    spawnSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', subject]);
    spawnSync('git', ['-C', root, 'update-ref', 'refs/remotes/origin/next', 'HEAD']);
  };
  const outside = (name) => join(dir, 'shared', name);
  return { LEDGER, appendTo, batch, chip, chips, dir, env, helper, merge, offer, outside, root, run };
};

export const linkedWorktree = (delivery, card) => {
  const context = chipLedger();
  const { dir, root, run } = context;
  const LEDGER = delivery === 'trunk' ? 'docs/plans/artifacts/suggested-tasks.decisions.tsv' : context.LEDGER;
  writeFileSync(join(root, '.agents/pstack.json'), JSON.stringify({ branch: 'next', delivery }));
  writeFileSync(join(root, '.gitignore'), 'docs/plans/artifacts/\n');
  mkdirSync(dirname(join(root, LEDGER)), { recursive: true });
  writeFileSync(join(root, LEDGER), 'ts\tphase\tdecision\twhy\tevidence\tresult\n');
  spawnSync('git', ['-C', root, 'add', '-A']);
  commit(root, 'base');
  const worktree = card ? join(realpathSync(root), '.claude', 'worktrees', card) : join(dir, 'wt');
  spawnSync('git', ['-C', root, 'worktree', 'add', '-q', '--detach', worktree]);
  const helper = (...args) => run(process.execPath, [CHECK, ...args], worktree);
  const offerHere = (decision, evidence) => helper('append', LEDGER, 'chip', decision, 'why', `${evidence}; priority: P1; repro: steps`, 'offered');
  return { ...context, LEDGER, helper, offerHere, worktree };
};


export const daysAgo = (days) => new Date(Date.now() - days * 86_400_000).toISOString();
export const LOG_HEADER = 'ts\tphase\tdecision\twhy\tevidence\tresult\n';
export const planRow = (when) => `${when}\tbuild\tStep\twhy\tscope: x\tdone\n`;
export const commitAt = (root, days, ...paths) => {
  const when = daysAgo(days);
  spawnSync('git', ['-C', root, 'add', ...paths]);
  spawnSync('git', ['-C', root, 'commit', '-qm', `touch ${paths[0]}`], { env: { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } });
};


export const stalePlanLedger = (config = {}, files = {}) => {
  const ledger = chipLedger({ config: { chips: { scopes: 'docs/scopes', ...config }, pageTopic: { field: 'review_scopes' } }, files: { 'docs/scopes/parser.json': '{}\n', ...files } });
  const stalePlan = (name, scope, days = 10) => {
    const path = `docs/plans/${name}.md`;
    writeFileSync(join(ledger.root, path), `---\nreview_scopes: [${scope}]\n---\n\n# ${name}\n\nStatus: building: step 2\n`);
    commitAt(ledger.root, days, path);
    return path;
  };
  const timed = (args) => spawnSync(process.execPath, [join(HELPERS, 'decisions-check.mjs'), ...args], { cwd: ledger.root, encoding: 'utf8', env: ledger.env, timeout: 30_000 });
  return { ...ledger, stalePlan, timed };
};


export const ledgerRows = (rows) => `ts\tphase\tdecision\twhy\tevidence\tresult\n${rows.map(([decision, evidence, result]) => ['2026-01-01T10:00:00Z', 'chip', decision, 'why', evidence, result].join('\t')).join('\n')}\n`;

export const triagedLedger = (files = {}) =>
  chipLedger({ config: { triage: { experimental: ['pagination'] }, chips: { scopes: 'scopes' } }, files: { 'scopes/editor.json': '{}', 'scopes/native.json': '{}', 'scopes/pagination.json': '{}', ...files } });

