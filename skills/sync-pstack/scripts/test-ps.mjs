// To find what a seat left running, cross.mjs reads the environment of every process on the machine
// with ps -E, which took seconds a call on a busy host, so its give-up timer won races the tests
// assert on. Importing this file puts a stand-in ps first on PATH that lists no process for that
// scan and runs the real ps for every other use. A test of a process outside a seat's group calls
// realPs to reach the real scan.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PS = spawnSync('sh', ['-c', 'command -v ps'], { encoding: 'utf8' }).stdout.trim();
const BIN = mkdtempSync(join(tmpdir(), 'pstack-ps-'));
writeFileSync(join(BIN, 'ps'), `#!/bin/sh\ncase "$1" in -axEww) [ -z "$PSTACK_REAL_PS" ] && exit 0 ;; esac\nexec '${PS}' "$@"\n`, { mode: 0o755 });
process.env.PATH = `${BIN}:${process.env.PATH}`;

export const realPs = (t) => {
  process.env.PSTACK_REAL_PS = '1';
  t.after(() => delete process.env.PSTACK_REAL_PS);
};
