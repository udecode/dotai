// A project with a suggested-task ledger, driven through decisions-check.mjs, for the chips and
// decisions-check test files.
import { spawnSync } from 'node:child_process';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commit, project, sandbox } from './test-sandbox.mjs';

const CHECK = fileURLToPath(new URL('../assets/pstack/decisions-check.mjs', import.meta.url));

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
