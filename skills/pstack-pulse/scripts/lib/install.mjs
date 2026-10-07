import { copyFileSync, existsSync, readFileSync, realpathSync } from 'node:fs';
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

export const plistOf = ({ label, node, script, log, path }) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${xml(label)}</string>
<key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(script)}</string><string>run</string></array>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(path)}</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>StandardOutPath</key><string>${xml(log)}</string><key>StandardErrorPath</key><string>${xml(log)}</string>
</dict></plist>
`;
