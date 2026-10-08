import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { writeFileAtomic } from './io.mjs';

const OWNER = '--owner=pstack-pulse';

export const hookCommand = (node, script, runtime) => `"${node}" "${script}" ${runtime} ${OWNER}`;
const ownsHook = (hook) => typeof hook?.command === 'string' && hook.command.endsWith(` ${OWNER}`);

export function withoutHook(settings) {
  const hooks = settings.hooks ?? {};
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    const kept = groups.flatMap((group) => {
      if (!group?.hooks?.some(ownsHook)) return [group];
      const rest = group.hooks.filter((hook) => !ownsHook(hook));
      return rest.length ? [{ ...group, hooks: rest }] : [];
    });
    if (kept.length) hooks[event] = kept;
    else if (groups.length) delete hooks[event];
  }
  return settings;
}

export function withHook(settings, events, command) {
  withoutHook(settings);
  settings.hooks ??= {};
  for (const [event, matcher] of events) settings.hooks[event] = [...(settings.hooks[event] ?? []), { ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command, timeout: 5 }] }];
  return settings;
}

export function editSettings(path, edit) {
  const target = existsSync(path) ? realpathSync(path) : path;
  const exists = existsSync(target);
  const next = edit(exists ? JSON.parse(readFileSync(target, 'utf8')) : {});
  if (exists && !existsSync(`${path}.pstack-pulse.bak`)) copyFileSync(target, `${path}.pstack-pulse.bak`);
  writeFileAtomic(target, `${JSON.stringify(next, null, 2)}\n`);
}

const xml = (text) => String(text).replace(/[&<>"']/gu, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);

export const plistOf = ({ label, args, log, path, untilQuit = false }) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${xml(label)}</string>
<key>ProgramArguments</key><array>${args.map((arg) => `<string>${xml(arg)}</string>`).join('')}</array>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(path)}</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key>${untilQuit ? '<dict><key>SuccessfulExit</key><false/></dict>' : '<true/>'}
<key>StandardOutPath</key><string>${xml(log)}</string><key>StandardErrorPath</key><string>${xml(log)}</string>
</dict></plist>
`;

export function codeHash(dir) {
  const hash = createHash('sha1');
  const walk = (folder) => {
    for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) hash.update(`${path.slice(dir.length)}\0`).update(readFileSync(path));
    }
  };
  walk(dir);
  return hash.digest('hex');
}

// A changed skill must read the same twice before the daemon restarts on it, so an update still copying files never loads half of them.
export function nextHeal(watch, current) {
  if (current === watch.running) return { running: watch.running, pending: null, heal: false };
  return { running: watch.running, pending: current, heal: current === watch.pending };
}

const nodeMajor = (node) => Number(spawnSync(node, ['-p', 'process.versions.node'], { encoding: 'utf8' }).stdout?.split('.')[0]);

// Hooks and the daemon outlive the shell that ran install, so they use a node path that survives a version upgrade.
export function stableNode() {
  const candidates = [join(homedir(), '.local/share/fnm/aliases/default/bin/node'), '/opt/homebrew/bin/node', '/usr/local/bin/node'];
  return candidates.find((node) => existsSync(node) && nodeMajor(node) >= 22) ?? process.execPath;
}
