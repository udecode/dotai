#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const AGY_RULE_SAFE_BYTES = 22_500;
export const AGY_SKILL_DESC_BUDGET = 16_000;

const T3_DEFAULTS = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../assets/t3-defaults.json'), 'utf8')
);

export const DEFAULT_PSTACK_MODELS = `# pstack model configuration (Antigravity)

Antigravity (\`gemini-4-neon @high\`) is the default lead. Native Antigravity subagents (\`invoke_subagent\`) always use \`inherit\`, never \`pro\`, \`flash\`, or \`flash_lite\`. Escalate Neon to \`@xhigh\` only for \`arena runners\`, stuck debugging after \`high\` fails, or deep architectural pivots. Route UI and visual work to Claude Opus (\`opus @high\`).

Panel and arena seats keep multi-family diversity through \`node .agents/pstack/cross.mjs\` when the project has \`sync-pstack\` helpers; otherwise panels run on \`inherit\`. Never dispatch \`pro\`, \`flash\`, \`flash_lite\`, \`sonnet\`, or \`haiku\`.

feature, refactoring: inherit
bug-fix: inherit
perf-issue: inherit
hillclimb: inherit
judgment and prose: inherit
strongest judgment: inherit
ui, visual: opus @high
arena runners: fable @high, codex:gpt-6.2-sol @xhigh or opus @high, agy:gemini-4-neon @xhigh
arena cross-judge pool: opus @high, agy:gemini-4-neon @high
swarm workers: inherit
interrogate reviewers: opus @high, codex:gpt-6.2-astra @high or fable @high, agy:gemini-4-neon @high
default effort: high
session hook: on
`;

function readJson(path) {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf8').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function fileNonEmpty(path) {
  try {
    return statSync(path).size > 0;
  } catch {
    return false;
  }
}

function dirHasEntries(path) {
  try {
    return readdirSync(path).length > 0;
  } catch {
    return false;
  }
}

function isSymlinkTo(linkPath, targetPath) {
  try {
    const stat = lstatSync(linkPath);
    if (!stat.isSymbolicLink()) return false;
    return resolve(dirname(linkPath), readlinkSync(linkPath)) === resolve(targetPath);
  } catch {
    return false;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function mergePreset(current, preset, nestedKeys = new Set()) {
  const next = isPlainObject(current) ? { ...current } : {};
  const updatedKeys = [];
  for (const [key, desired] of Object.entries(preset)) {
    if (nestedKeys.has(key) && isPlainObject(desired)) {
      const mergedNested = isPlainObject(next[key]) ? { ...next[key] } : {};
      let nestedChanged = false;
      for (const [subKey, subVal] of Object.entries(desired)) {
        if (!deepEqual(mergedNested[subKey], subVal)) {
          mergedNested[subKey] = subVal;
          nestedChanged = true;
        }
      }
      if (nestedChanged || !isPlainObject(next[key])) {
        next[key] = mergedNested;
        updatedKeys.push(key);
      }
    } else if (!deepEqual(next[key], desired)) {
      next[key] = desired;
      updatedKeys.push(key);
    }
  }
  return { next, updatedKeys };
}

export function convertClaudeMcpServer(entry) {
  if (!entry || typeof entry !== 'object') return null;
  if (typeof entry.serverUrl === 'string' || typeof entry.url === 'string') {
    const converted = { serverUrl: entry.serverUrl ?? entry.url };
    if (entry.headers && typeof entry.headers === 'object' && Object.keys(entry.headers).length > 0) {
      converted.headers = entry.headers;
    }
    return converted;
  }
  if (typeof entry.command === 'string') {
    const converted = { command: entry.command };
    if (Array.isArray(entry.args) && entry.args.length > 0) converted.args = entry.args;
    if (entry.env && typeof entry.env === 'object' && Object.keys(entry.env).length > 0) converted.env = entry.env;
    if (typeof entry.cwd === 'string' && entry.cwd.length > 0) converted.cwd = entry.cwd;
    return converted;
  }
  return null;
}

function collectClaudeMcpServers(home, cwd, platform) {
  const sources = [];
  const desktopConfig =
    platform === 'darwin'
      ? join(home, 'Library/Application Support/Claude/claude_desktop_config.json')
      : join(home, '.config/Claude/claude_desktop_config.json');
  const desktop = readJson(desktopConfig);
  if (desktop?.mcpServers && typeof desktop.mcpServers === 'object') {
    sources.push({ label: desktopConfig, servers: desktop.mcpServers });
  }
  const claudeJson = readJson(join(home, '.claude.json'));
  if (claudeJson?.mcpServers && typeof claudeJson.mcpServers === 'object') {
    sources.push({ label: join(home, '.claude.json'), servers: claudeJson.mcpServers });
  }
  const projectEntry = claudeJson?.projects?.[resolve(cwd)];
  if (projectEntry?.mcpServers && typeof projectEntry.mcpServers === 'object') {
    sources.push({ label: `${join(home, '.claude.json')} (${resolve(cwd)})`, servers: projectEntry.mcpServers });
  }
  const merged = {};
  for (const { servers } of sources) {
    for (const [name, entry] of Object.entries(servers)) {
      if (name in merged) continue;
      const converted = convertClaudeMcpServer(entry);
      if (converted) merged[name] = converted;
    }
  }
  return merged;
}

function pinnedPstack(cwd) {
  const settings = readJson(join(cwd, '.claude/settings.json'));
  for (const [plugin, enabled] of Object.entries(settings?.enabledPlugins ?? {})) {
    if (!enabled) continue;
    const [name, marketplace] = plugin.split('@');
    if (name !== 'pstack') continue;
    const source = settings.extraKnownMarketplaces?.[marketplace]?.source;
    if (source?.ref) {
      return {
        ref: source.ref,
        repo: source.repo ?? 'michael-denyer/pstack-claude',
        version: source.ref.replace(/^v/u, ''),
      };
    }
  }
  const pstackJson = readJson(join(cwd, '.agents/pstack.json'));
  if (typeof pstackJson?.tag === 'string') {
    return {
      ref: pstackJson.tag,
      repo: 'michael-denyer/pstack-claude',
      version: pstackJson.tag.replace(/^v/u, ''),
    };
  }
  return null;
}

function linkIntoProfile({ apply, dst, label, src, isDir = false }) {
  if (!existsSync(src)) return null;
  if (!isDir && !fileNonEmpty(src)) return null;
  if (isSymlinkTo(dst, src)) return { status: 'ok', message: `${label} linked` };

  let existingStat = null;
  try {
    existingStat = lstatSync(dst);
  } catch {
    existingStat = null;
  }

  const safeToReplace =
    !existingStat ||
    existingStat.isSymbolicLink() ||
    (!isDir && existingStat.isFile() && existingStat.size === 0) ||
    (isDir && existingStat.isDirectory() && !dirHasEntries(dst));

  if (!safeToReplace) {
    return {
      status: 'todo',
      message: `${label} is a non-empty local ${existingStat.isDirectory() ? 'directory' : 'file'}; merge or remove it, then re-run --apply`,
    };
  }

  if (!apply) {
    return { status: 'todo', message: `link ${label} -> ${src}` };
  }

  mkdirSync(dirname(dst), { recursive: true });
  if (existingStat) rmSync(dst, { force: true, recursive: true });
  symlinkSync(src, dst);
  return { status: 'changed', message: `linked ${label} -> ${src}` };
}

function applyT3Settings({ apply, changed, home, ok, todo }) {
  const userdataDir = join(home, '.t3/userdata');
  const settingsPath = join(userdataDir, 'settings.json');
  const clientPath = join(userdataDir, 'client-settings.json');

  const mergedSettings = mergePreset(
    readJson(settingsPath),
    T3_DEFAULTS.settings,
    new Set(['providerModelPreferences', 'providerInstances', 'storageCleanup'])
  );
  if (mergedSettings.updatedKeys.length > 0) {
    if (apply) {
      writeJson(settingsPath, mergedSettings.next);
      changed.push(`updated ~/.t3/userdata/settings.json (${mergedSettings.updatedKeys.join(', ')})`);
    } else {
      todo.push(`apply T3 defaults to ~/.t3/userdata/settings.json (${mergedSettings.updatedKeys.join(', ')})`);
    }
  } else {
    ok.push('~/.t3/userdata/settings.json matches curated defaults');
  }

  const mergedClient = mergePreset(readJson(clientPath), T3_DEFAULTS.clientSettings);
  if (mergedClient.updatedKeys.length > 0) {
    if (apply) {
      writeJson(clientPath, mergedClient.next);
      changed.push(`updated ~/.t3/userdata/client-settings.json (${mergedClient.updatedKeys.join(', ')})`);
    } else {
      todo.push(`apply T3 workflow defaults to ~/.t3/userdata/client-settings.json (${mergedClient.updatedKeys.join(', ')})`);
    }
  } else {
    ok.push('~/.t3/userdata/client-settings.json matches curated workflow defaults');
  }
}

export function runMigration({
  apply = false,
  checkBinaries = true,
  cwd = process.cwd(),
  home = homedir(),
  platform = process.platform,
  t3Only = false,
} = {}) {
  const ok = [];
  const changed = [];
  const todo = [];
  const manual = [];

  applyT3Settings({ apply, changed, home, ok, todo });
  if (t3Only) return { changed, manual, ok, todo };

  const record = (res) => {
    if (!res) return;
    if (res.status === 'ok') ok.push(res.message);
    else if (res.status === 'changed') changed.push(res.message);
    else if (res.status === 'todo') todo.push(res.message);
  };

  const geminiDir = join(home, '.gemini');
  const geminiConfig = join(geminiDir, 'config');
  const globalMcpPath = join(geminiConfig, 'mcp_config.json');
  const globalSkillsJson = join(geminiConfig, 'skills.json');
  const globalAgentsMd = join(geminiDir, 'AGENTS.md');
  const globalModelsMd = join(geminiConfig, 'pstack-models.md');
  const globalPluginsDir = join(geminiConfig, 'plugins');
  const globalOauthPath = join(geminiDir, 'antigravity-cli/mcp_oauth_tokens.json');

  const claudeServers = collectClaudeMcpServers(home, cwd, platform);
  const existingMcp = readJson(globalMcpPath) ?? {};
  const existingServers = existingMcp.mcpServers && typeof existingMcp.mcpServers === 'object' ? { ...existingMcp.mcpServers } : {};
  const missingServers = Object.keys(claudeServers).filter((name) => !(name in existingServers));
  if (missingServers.length > 0) {
    if (apply) {
      for (const name of missingServers) existingServers[name] = claudeServers[name];
      writeJson(globalMcpPath, { ...existingMcp, mcpServers: existingServers });
      changed.push(`merged ${missingServers.length} MCP server(s) into ~/.gemini/config/mcp_config.json (${missingServers.join(', ')})`);
    } else {
      todo.push(`merge ${missingServers.length} MCP server(s) into ~/.gemini/config/mcp_config.json (${missingServers.join(', ')})`);
    }
  } else if (Object.keys(existingServers).length > 0) {
    ok.push(`~/.gemini/config/mcp_config.json has ${Object.keys(existingServers).length} server(s)`);
  } else {
    ok.push('no local Claude Desktop or Claude Code MCP servers found to merge');
  }

  const wantedSkillPaths = ['~/.agents/skills'];
  if (existsSync(join(home, '.claude/skills'))) wantedSkillPaths.push('~/.claude/skills');
  const skillsConfig = readJson(globalSkillsJson) ?? {};
  const existingEntries = Array.isArray(skillsConfig.entries) ? [...skillsConfig.entries] : [];
  const hasEntry = (target) => {
    const resolvedTarget = resolve(target.replace(/^~(?=\/|$)/u, home));
    return existingEntries.some(
      (entry) =>
        typeof entry?.path === 'string' &&
        (entry.path === target || resolve(entry.path.replace(/^~(?=\/|$)/u, home)) === resolvedTarget)
    );
  };
  const missingSkillPaths = wantedSkillPaths.filter((p) => !hasEntry(p));
  if (missingSkillPaths.length > 0) {
    if (apply) {
      for (const p of missingSkillPaths) existingEntries.push({ path: p });
      writeJson(globalSkillsJson, { ...skillsConfig, entries: existingEntries });
      changed.push(`added ${missingSkillPaths.join(', ')} to ~/.gemini/config/skills.json`);
    } else {
      todo.push(`add ${missingSkillPaths.join(', ')} to ~/.gemini/config/skills.json`);
    }
  } else {
    ok.push('~/.gemini/config/skills.json includes shared skill directories');
  }

  const claudeMd = join(home, '.claude/CLAUDE.md');
  if (!fileNonEmpty(globalAgentsMd)) {
    if (fileNonEmpty(claudeMd)) {
      if (apply) {
        mkdirSync(geminiDir, { recursive: true });
        copyFileSync(claudeMd, globalAgentsMd);
        changed.push('copied ~/.claude/CLAUDE.md to ~/.gemini/AGENTS.md');
      } else {
        todo.push('copy ~/.claude/CLAUDE.md to ~/.gemini/AGENTS.md');
      }
    } else {
      ok.push('no ~/.claude/CLAUDE.md to seed ~/.gemini/AGENTS.md');
    }
  } else {
    ok.push('~/.gemini/AGENTS.md present');
  }

  if (!fileNonEmpty(globalModelsMd)) {
    if (apply) {
      mkdirSync(geminiConfig, { recursive: true });
      writeFileSync(globalModelsMd, DEFAULT_PSTACK_MODELS);
      changed.push('wrote Antigravity defaults to ~/.gemini/config/pstack-models.md');
    } else {
      todo.push('write Antigravity defaults to ~/.gemini/config/pstack-models.md');
    }
  } else {
    ok.push('~/.gemini/config/pstack-models.md present');
  }

  const pin = pinnedPstack(cwd);
  const pluginManifest = readJson(join(globalPluginsDir, 'pstack/.antigravity-plugin/plugin.json'));
  if (!pluginManifest) {
    const tag = pin?.ref ?? 'main';
    const repo = pin?.repo ?? 'michael-denyer/pstack-claude';
    todo.push(
      `install pstack plugin for Antigravity: git clone --depth 1 --branch ${tag} https://github.com/${repo} /tmp/pstack-claude && agy plugin install /tmp/pstack-claude/plugins/pstack && rm -rf /tmp/pstack-claude`
    );
  } else if (pin?.version && pluginManifest.version !== pin.version) {
    todo.push(
      `update Antigravity pstack plugin from ${pluginManifest.version} to ${pin.version}: git clone --depth 1 --branch ${pin.ref} https://github.com/${pin.repo} /tmp/pstack-claude && agy plugin install /tmp/pstack-claude/plugins/pstack && rm -rf /tmp/pstack-claude`
    );
  } else {
    ok.push(`Antigravity pstack plugin installed (${pluginManifest.version ?? 'unknown'})`);
  }

  const t3AgyRoot = join(home, '.t3/userdata/providers/antigravity');
  const profiles = existsSync(t3AgyRoot)
    ? readdirSync(t3AgyRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
    : [];
  if (profiles.length === 0) {
    todo.push('open T3 Code and start one Antigravity thread so T3 creates ~/.t3/userdata/providers/antigravity/<hash>/, then re-run --apply');
  } else {
    for (const name of profiles) {
      const profileDir = join(t3AgyRoot, name);
      const tag = `T3 profile ${name.slice(0, 12)}`;
      record(linkIntoProfile({ apply, dst: join(profileDir, 'AGENTS.md'), label: `${tag} AGENTS.md`, src: globalAgentsMd }));
      record(linkIntoProfile({ apply, dst: join(profileDir, 'config/mcp_config.json'), label: `${tag} mcp_config.json`, src: globalMcpPath }));
      record(linkIntoProfile({ apply, dst: join(profileDir, 'config/skills.json'), label: `${tag} skills.json`, src: globalSkillsJson }));
      record(linkIntoProfile({ apply, dst: join(profileDir, 'config/pstack-models.md'), label: `${tag} pstack-models.md`, src: globalModelsMd }));
      record(linkIntoProfile({ apply, dst: join(profileDir, 'config/plugins'), isDir: true, label: `${tag} plugins`, src: globalPluginsDir }));
      record(
        linkIntoProfile({
          apply,
          dst: join(profileDir, 'antigravity-acp/mcp_oauth_tokens.json'),
          label: `${tag} mcp_oauth_tokens.json`,
          src: globalOauthPath,
        })
      );
    }
  }

  if (checkBinaries) {
    const agyRun = spawnSync('agy', ['--version'], { encoding: 'utf8' });
    if (agyRun.status === 0) {
      ok.push(`agy CLI present (${(agyRun.stdout || '').trim()})`);
    } else {
      todo.push('install the agy (Antigravity) CLI and ensure it is on PATH');
    }
  }

  const repoAgents = join(cwd, 'AGENTS.md');
  const repoClaudeSettings = readJson(join(cwd, '.claude/settings.json'));
  if (existsSync(repoAgents) || repoClaudeSettings) {
    if (existsSync(repoAgents)) {
      const size = statSync(repoAgents).size;
      if (size > AGY_RULE_SAFE_BYTES) {
        todo.push(`repo AGENTS.md is ${size} bytes (safe cap ${AGY_RULE_SAFE_BYTES}; agy truncates past 24,000 bytes)`);
      } else {
        ok.push(`repo AGENTS.md fits agy cap (${size}/${AGY_RULE_SAFE_BYTES} bytes)`);
      }
    }
    if (repoClaudeSettings?.hooks && !existsSync(join(cwd, '.agents/hooks.json'))) {
      todo.push('repo has .claude/settings.json hooks but no .agents/hooks.json for Antigravity');
    }
    if (existsSync(join(cwd, '.mcp.json')) && !existsSync(join(cwd, '.agents/mcp_config.json'))) {
      todo.push('repo has .mcp.json but no .agents/mcp_config.json for Antigravity');
    }
    const repoSkillsDir = join(cwd, '.agents/skills');
    if (existsSync(repoSkillsDir)) {
      let totalDesc = 0;
      for (const entry of readdirSync(repoSkillsDir)) {
        const skillMd = join(repoSkillsDir, entry, 'SKILL.md');
        if (!existsSync(skillMd)) continue;
        const fm = readFileSync(skillMd, 'utf8').match(/^---\n([\s\S]*?)\n---/u)?.[1] ?? '';
        const desc = fm.match(/description:\s*([\s\S]*?)(?=\n[a-zA-Z0-9_-]+:|$)/u)?.[1]?.trim() ?? '';
        totalDesc += desc.length;
      }
      if (totalDesc > AGY_SKILL_DESC_BUDGET) {
        todo.push(`repo .agents/skills descriptions total ${totalDesc} chars (budget ${AGY_SKILL_DESC_BUDGET})`);
      } else {
        ok.push(`repo .agents/skills descriptions fit budget (${totalDesc}/${AGY_SKILL_DESC_BUDGET} chars)`);
      }
    }
  }

  manual.push('Quit and reopen T3 Code, then start a fresh Antigravity thread so MCPs, plugins, skills, AGENTS.md, and T3 settings load.');
  manual.push('Sign in to Claude (opus) and Codex in T3 Code so fallback, UI delegation, and multi-family panels work.');
  manual.push('Complete browser OAuth for remote MCP servers and add any Claude.ai cloud connectors (Linear, Slack, Notion) to ~/.gemini/config/mcp_config.json as {"serverUrl": "..."}.');
  if (platform === 'darwin') {
    manual.push(
      'Import signed-in Chrome profile: System Settings -> Privacy & Security -> Full Disk Access -> enable T3 Code -> quit Chrome (Cmd+Q) -> T3 Settings -> Browser -> Browser profiles -> + Add profile -> Import from Chrome -> allow Keychain.'
    );
  }
  manual.push('Add issue tracker API keys (such as Linear) in T3 Settings -> Source control & issues if used.');

  return { changed, manual, ok, todo };
}

function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const t3Only = args.includes('--t3-only');
  const asJson = args.includes('--json');
  const flag = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const home = flag('--home') ? resolve(flag('--home')) : homedir();
  const cwd = flag('--cwd') ? resolve(flag('--cwd')) : process.cwd();
  const checkBinaries = !args.includes('--no-bin-check');

  const result = runMigration({ apply, checkBinaries, cwd, home, t3Only });
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const line of result.changed) console.log(`changed: ${line}`);
    for (const line of result.ok) console.log(`ok: ${line}`);
    for (const line of result.todo) console.log(`todo: ${line}`);
    if (result.manual.length > 0) {
      console.log('\nmanual steps:');
      result.manual.forEach((line, index) => console.log(`${index + 1}. ${line}`));
    }
  }
  process.exit(result.todo.length === 0 ? 0 : 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
