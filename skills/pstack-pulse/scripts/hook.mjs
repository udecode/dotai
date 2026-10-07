import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eventOf, HOME } from './lib/event.mjs';

try {
  const event = eventOf(process.argv[2] === 'codex' ? 'codex' : 'claude', JSON.parse(readFileSync(0, 'utf8')), process.env);
  if (event) {
    const inbox = join(HOME, 'inbox');
    mkdirSync(inbox, { recursive: true });
    const name = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
    writeFileSync(join(inbox, `${name}.tmp`), JSON.stringify(event), { mode: 0o600 });
    renameSync(join(inbox, `${name}.tmp`), join(inbox, `${name}.json`));
  }
} catch {}
