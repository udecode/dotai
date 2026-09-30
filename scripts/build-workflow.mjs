#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const forbiddenIndex = process.argv.indexOf('--forbid');
const forbidden = forbiddenIndex < 0 ? null : new RegExp(process.argv[forbiddenIndex + 1], 'i');
const sha = (data) => createHash('sha256').update(data).digest('hex');
const upstream = JSON.parse(readFileSync(join(root, 'upstream-skills.json'), 'utf8'));
const groups = {
  'Execution': ['autogoal'],
  'Review and design': ['best-api-review', 'prototype'],
  'Communication': ['show-me', 'walkthrough', 'video-transcripts'],
  'Maintenance': ['sync-pstack', 'find-skills'],
};
const explicitDependencies = {};
const requirements = {
  autogoal: ['Native goal tools for native goals; otherwise a file plan'],
  'sync-pstack': ['Node.js 18+ and Git; the Claude Code and Codex CLIs for plugin pins and smoke tests'],
  'video-transcripts': ['ffmpeg, curl, jq and authorized Gemini credentials'],
  walkthrough: ['Real final-state captures, Node.js and the configured annotation tool'],
};

function walk(dir) {
  const paths = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['__pycache__', '.DS_Store'].includes(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Bundle must be self-contained; symlink: ${path}`);
    if (entry.isDirectory()) paths.push(...walk(path));
    else if (entry.isFile()) paths.push(path);
    else throw new Error(`Unsupported bundle entry: ${path}`);
  }
  return paths.sort();
}

function emit(path, text) {
  const destination = join(root, path);
  if (check) {
    if (!existsSync(destination) || readFileSync(destination, 'utf8') !== text) throw new Error(`Stale generated file: ${path}; run node scripts/build-workflow.mjs`);
  } else writeFileSync(destination, text);
}

const bundled = readdirSync(join(root, 'skills'), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
if (upstream.skills.some((skill) => bundled.includes(skill.name))) throw new Error('Unchanged upstream skills must not have duplicate local skill directories');
const entries = [...bundled, ...upstream.skills.map((skill) => skill.name)].sort();
const categorized = Object.values(groups).flat();
if (new Set(categorized).size !== categorized.length || JSON.stringify([...categorized].sort()) !== JSON.stringify(entries)) throw new Error('Catalog must classify every actual skill exactly once');
const files = walk(join(root, 'skills'));
const skills = entries.map((name) => {
  const remote = upstream.skills.find((skill) => skill.name === name);
  if (remote) {
    if (!remote.files?.['SKILL.md'] || !/^[a-f0-9]{40}$/.test(remote.revision)) throw new Error(`Missing pinned upstream evidence: ${name}`);
    return { ...remote, distribution: 'remote', dependencies: explicitDependencies[name] || [], installSource: `https://github.com/${remote.source}/tree/${remote.revision}${remote.sourceDirectory ? '/' + remote.sourceDirectory : ''}` };
  }
  const directory = join(root, 'skills', name);
  const text = readFileSync(join(directory, 'SKILL.md'), 'utf8');
  const frontmatter = text.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatter) throw new Error(`Missing frontmatter: ${name}`);
  const clean = (value) => value?.trim().replace(/^['"]|['"]$/g, '');
  if (clean(frontmatter[1].match(/^name:\s*(.+)$/m)?.[1]) !== name) throw new Error(`Skill name mismatch: ${name}`);
  const description = clean(frontmatter[1].match(/^description:\s*(.+)$/m)?.[1]);
  if (!description) throw new Error(`Missing description: ${name}`);
  const dependencyNames = new Set(explicitDependencies[name] || []);
  for (const file of files.filter((file) => file.startsWith(directory + sep) && file.endsWith('.md'))) {
    const content = readFileSync(file, 'utf8').replace(/```[^\n]*\n[\s\S]*?```/g, '');
    for (const match of content.matchAll(/(?<!!)\[[^\]\n]+\]\(([^\s)]+)(?:\s+[^)]*)?\)/g)) {
      const link = match[1].split('#')[0];
      if (!link || link.includes(':') || link.startsWith('/') || /[<>{}*]/.test(link) || ['url', '...'].includes(link)) continue;
      const target = resolve(dirname(file), link);
      const dep = relative(join(root, 'skills'), target).split(sep)[0];
      const external = upstream.skills.find((skill) => skill.name === dep);
      const externalPath = relative(join(root, 'skills', dep), target).split(sep).join('/');
      if (!existsSync(target) && !external?.files?.[externalPath]) throw new Error(`Broken skill reference: ${relative(root, file)} -> ${link}`);
      if (dep !== name && entries.includes(dep)) dependencyNames.add(dep);
    }
  }
  for (const dep of dependencyNames) if (!entries.includes(dep)) throw new Error(`Missing dependency: ${name} -> ${dep}`);
  const provenance = existsSync(join(directory, 'UPSTREAM.json')) ? `${name}/UPSTREAM.json` : existsSync(join(directory, 'VENDOR.json')) ? `${name}/VENDOR.json` : null;
  return { name, distribution: 'bundled', description, category: Object.entries(groups).find(([, names]) => names.includes(name))[0], dependencies: [...dependencyNames].sort(), capabilities: requirements[name] || [], provenance };
});

let catalog = `# dotai skills\n\n${skills.length} skills: ${bundled.length} maintained in dotai, plus ${upstream.skills.length} unchanged upstream skills installed with named npx skills add commands. The engineering method (poteto-mode, its playbooks, the principle skills and pstack's review skills) comes from the pstack plugin, not from dotai. Methods load only when relevant; tool access is separate from installation.\n`;
for (const [category, names] of Object.entries(groups)) {
  catalog += `\n## ${category} (${names.length})\n\n| Skill | Purpose |\n| --- | --- |\n`;
  for (const name of names) {
    const skill = skills.find((skill) => skill.name === name);
    const url = skill.distribution === 'remote' ? `https://github.com/${skill.source}/blob/${skill.revision}/${skill.path}/SKILL.md` : `skills/${name}/SKILL.md`;
    catalog += `| [${name}](${url}) | ${skill.description.replaceAll('|', '\\|')} |\n`;
  }
}
catalog += '\n## Unchanged upstream installation\n\nFor a project-local install, run these from the project directory and name each agent; use `--global` only for an explicitly requested user-wide install. Skip a skill whose pinned contents already match.\n\n```sh\n';
for (const skill of upstream.skills) catalog += `npx --yes skills@${upstream.skillsCliVersion} add https://github.com/${skill.source}/tree/${skill.revision}${skill.sourceDirectory ? '/' + skill.sourceDirectory : ''} --skill ${skill.name} --agent codex -y\n`;
catalog += '```\n\nProject rules govern testing, native tools and publication; do not fork an unchanged method just to add a routing sentence.\n';
catalog += '\n## Capability requirements\n\nThese skills remain installed when a tool is absent; an unavailable live action or independent review is reported, never marked as passed.\n\n';
for (const skill of skills.filter((skill) => skill.capabilities.length)) catalog += `- **${skill.name}:** ${skill.capabilities.join('; ')}.\n`;
catalog += '\n## Deliberate boundaries\n\ndotai holds shared methods that pstack does not cover. It excludes product-specific schemas, routes, fixtures, provider adapters, release environments and personal configuration; those belong to each project. Framework packages (React, Next.js, Prisma, tRPC and the like) are stack-specific: use Find Skills and install named official packages after source review. The skills contain no accounts, credentials, personal histories or connector configuration.\n';
emit('SKILLS.md', catalog);

const distribution = ['README.md', 'SKILLS.md', 'upstream-skills.json', 'scripts/build-workflow.mjs', 'scripts/validate-skills'];
const all = [...files, ...distribution.map((file) => join(root, file))].sort();
const manifest = { schemaVersion: 1, source: 'udecode/dotai', skillsCliVersion: upstream.skillsCliVersion, skills, files: {} };
for (const file of all) {
  const bytes = readFileSync(file);
  if (forbidden?.test(bytes.toString('utf8'))) throw new Error(`Forbidden content in distribution: ${relative(root, file)}`);
  manifest.files[relative(root, file).split(sep).join('/')] = { sha256: sha(bytes), mode: statSync(file).mode & 0o111 ? 0o755 : 0o644 };
}
emit('workflow-manifest.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(`${check ? 'Verified' : 'Built'} ${skills.length} skills, ${all.length} complete bundle files, resolved skill dependencies and local Markdown references.`);
