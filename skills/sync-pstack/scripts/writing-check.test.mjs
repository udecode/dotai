import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const CHECK = join(dirname(fileURLToPath(import.meta.url)), '../assets/pstack/writing-check.mjs');
const check = (input, args = []) => spawnSync(process.execPath, [CHECK, ...args], { input, encoding: 'utf8' });

test('writing-check prints each prose line once per rule it breaks and skips code spans and closed fences', () => {
  const text = [
    'Plain answer first.',
    'It works — mostly.',
    'It works - mostly.',
    'It’s done.',
    'Mind the seam.',
    '**Certainly!** Here it is.',
    'We split it in order to ship.',
    'A pivotal change.',
    'The file serves as proof.',
    'Run `a — b` or ``c ` d — e`` or \\`f — g\\`.',
    '```js',
    'const seam = "—";',
    '```',
    '~~~',
    '```',
    'It’s inside.',
    '~~~',
    '```x``` then — go.',
    '```',
    'Still prose — here.',
  ].join('\n');
  const run = check(text);
  assert.equal(run.status, 1);
  assert.deepEqual(run.stdout.trim().split('\n'), [
    '-:2: long dash "—": It works — mostly.',
    '-:3: hyphen as dash "-": It works - mostly.',
    '-:4: curly quote "’": It’s done.',
    '-:5: the word "seam" "seam": Mind the seam.',
    '-:6: chatbot phrase "Certainly": **Certainly!** Here it is.',
    '-:7: filler phrase "in order to": We split it in order to ship.',
    '-:8: AI vocabulary "pivotal": A pivotal change.',
    '-:9: "is" in costume "serves as": The file serves as proof.',
    '-:10: long dash "—": Run `a — b` or ``c ` d — e`` or \\`f — g\\`.',
    '-:18: long dash "—": ```x``` then — go.',
    '-:20: long dash "—": Still prose — here.',
  ]);

  const clean = check('Plain answer first.\n');
  assert.equal(clean.status, 0);
  assert.equal(clean.stdout, '');
});

test('writing-check reads a block quote marker as no text, so a quoted list item is no dash', () => {
  const run = check(['> - A quoted item.', '>> - A nested one.', ' > > - A spaced nested one.', '> It works - mostly.'].join('\n'));
  assert.equal(run.status, 1);
  assert.deepEqual(run.stdout.trim().split('\n'), ['-:4: hyphen as dash "-": > It works - mostly.']);
});

test('writing-check still reads a dash after a code span that follows a quote marker', () => {
  const run = check('>`value` - the returned result.');
  assert.equal(run.status, 1);
  assert.equal(run.stdout.trim(), '-:1: hyphen as dash "-": >`value` - the returned result.');
});

test('writing-check reads a > indented four spaces as text, because it opens no block quote', () => {
  const run = check(['The operator is', '    > - greater than.'].join('\n'));
  assert.equal(run.status, 1);
  assert.equal(run.stdout.trim(), '-:2: hyphen as dash "-": > - greater than.');
});

test('writing-check exits 2, not the findings code 1, when a file cannot be read', () => {
  const run = check('', ['/nonexistent/writing-check-input.md']);
  assert.equal(run.status, 2);
  assert.equal(run.stdout, '');
});
