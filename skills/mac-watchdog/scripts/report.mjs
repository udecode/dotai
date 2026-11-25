// Reads mac-watchdog's recorder log. Usage:
//   node report.mjs                       last 6 samples
//   node report.mjs --last 30
//   node report.mjs --from 10:30 --to 10:50 [--day 2026-11-18]   local times
//   node report.mjs --detail              also print groups and big processes per sample
// A sample in which the guard stopped a process prints a `kill:` line under it.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const detail = args.includes('--detail');
const localDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const day = opt('--day') ?? localDay(new Date());
const at = (hhmm) => (hhmm ? new Date(`${day}T${hhmm.length === 5 ? `${hhmm}:00` : hhmm}`).getTime() : undefined);
const from = at(opt('--from'));
const to = at(opt('--to'));

// Files are named by UTC day; a local day can span two of them.
const dir = join(homedir(), 'Library/Logs/mac-watchdog');
const base = new Date(`${day}T12:00:00`);
const files = [-1, 0, 1].map((d) => join(dir, `${new Date(base.getTime() + d * 86400e3).toISOString().slice(0, 10)}.jsonl`)).filter(existsSync);
let recs = files.flatMap((f) =>
  readFileSync(f, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((l) => {
      try {
        return [JSON.parse(l)];
      } catch {
        return [];
      }
    }),
);
recs.sort((a, b) => a.t.localeCompare(b.t));
if (from !== undefined || to !== undefined) recs = recs.filter((r) => (from === undefined || Date.parse(r.t) >= from) && (to === undefined || Date.parse(r.t) <= to));
else recs = recs.slice(-Number(opt('--last') ?? 6));

const gb = (mb) => (mb == null ? '?' : `${(mb / 1024).toFixed(1)}G`);
const label = (g) => g.title ?? g.g;
for (const r of recs) {
  const time = new Date(r.t).toLocaleTimeString('en-GB');
  const heads = r.groups.slice(0, 3).map((g) => `${label(g).slice(0, 28)} ${gb(g.mb)}`).join(' | ');
  console.log(
    `${time} free=${r.freePct}% ${r.pressure} swap=${gb(r.swapUsedMB)} in=${r.swapinsMBps ?? '-'} out=${r.swapoutsMBps ?? '-'}MB/s cmpr=${gb(r.compressorMB)} gap=${r.gapS ?? '-'}s took=${r.sampleMs}ms user=${gb(r.userFootprintMB)} claudes=${r.claudes}  ${heads}`,
  );
  if (r.app) for (const l of r.app) console.log(`    app: ${l}`);
  for (const k of r.kills ?? []) console.log(`    kill: ${k.signal} pid=${k.pid} ${gb(k.mb)} over ${gb(k.limitMB)} ${k.title ?? k.g} ${k.cmd.slice(0, 120)}`);
  if (detail) {
    for (const g of r.groups) console.log(`    group ${gb(g.mb).padStart(6)} n=${String(g.n).padStart(3)} ${label(g)} (${g.local ?? g.g}) biggest=${g.biggest}`);
    for (const b of r.big) console.log(`    big   ${gb(b.mb).padStart(6)} pid=${b.pid} age=${b.age} ${b.g} ${b.cmd.slice(0, 120)}`);
    if (r.top) {
      console.log(`    top   ${r.top.phys}`);
      for (const t of r.top.rows.slice(0, 6)) console.log(`    top   ${gb(t.mb).padStart(6)} +cmprs ${gb(t.cmprsMB)} pid=${t.pid} ${t.comm}`);
    }
  }
}
