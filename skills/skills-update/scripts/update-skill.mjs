#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

function expandHome(value) {
  if (!value) return value;
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return path.join(homedir(), value.slice(2));
  return value;
}

function takeValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error("Missing value for " + flag);
  }
  return value;
}

export function parseArgs(argv) {
  const out = {
    all: false,
    apply: false,
    config: process.env.AGENTS_CONFIG || "~/.agents/config.json",
    dryRunExplicit: false,
    set: undefined,
    skill: undefined,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--config") {
      out.config = takeValue(argv, i, arg);
      i += 1;
    } else if (arg === "--set") {
      out.set = takeValue(argv, i, arg);
      i += 1;
    } else if (arg === "--apply") {
      out.apply = true;
    } else if (arg === "--dry-run") {
      out.dryRunExplicit = true;
    } else if (arg === "--all") {
      out.all = true;
    } else if (arg.startsWith("-")) {
      throw new Error("Unknown option: " + arg);
    } else if (!out.skill) {
      out.skill = arg;
    } else {
      throw new Error("Unexpected argument: " + arg);
    }
  }

  if (out.apply && out.dryRunExplicit) {
    throw new Error("Choose either --apply or --dry-run, not both");
  }
  if (out.skill && out.all) {
    throw new Error("Choose one named skill or --all, not both");
  }
  if (!out.skill && !out.all) {
    throw new Error("Pass one skill name, or pass --all explicitly");
  }

  return out;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function usage() {
  console.error(
    [
      "Usage:",
      "  update-skill.mjs <skill-name> [--set <set-name>] [--config <path>] [--apply]",
      "  update-skill.mjs --all [--set <set-name>] [--config <path>] [--apply]",
      "",
      "The default is a dry run. Mutation requires --apply.",
    ].join("\n"),
  );
}

function getSet(config, name) {
  const syncConfig = config.syncedRepositories;
  if (!syncConfig) {
    throw new Error("Missing config section: syncedRepositories");
  }

  const sets = syncConfig.sets || {};
  const setName = name || syncConfig.defaultSet || Object.keys(sets)[0];
  if (!setName || !sets[setName]) {
    throw new Error("Unknown target set: " + (setName || "(none)"));
  }

  return { name: setName, value: sets[setName] };
}

export function normalizeAgents(targetSet) {
  if (Object.hasOwn(targetSet, "agent")) {
    throw new Error(
      "Legacy target-set field 'agent' is forbidden; configure an explicit agents array",
    );
  }

  const raw = targetSet.agents;

  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(
      "Target set must declare a non-empty agents array; implicit agent detection is forbidden",
    );
  }

  const agents = [...new Set(raw)];
  if (
    agents.some(
      (agent) =>
        typeof agent !== "string" ||
        agent.length === 0 ||
        agent === "*" ||
        agent === "--all" ||
        agent.startsWith("-"),
    )
  ) {
    throw new Error(
      "Unsafe agent target. Use explicit Skills CLI agent identifiers; '*' and broad flags are forbidden",
    );
  }

  return agents;
}

function readLock(repo) {
  const lockPath = path.join(repo, "skills-lock.json");
  if (!existsSync(lockPath)) return {};
  return readJson(lockPath).skills || {};
}

function sourceOptionArgs(config, source) {
  const options = config.syncedRepositories.sourceOptions?.[source] || {};
  if (options.dangerouslyAcceptOpenclawRisks) {
    return ["--dangerously-accept-openclaw-risks"];
  }
  return [];
}

export function assertTargetedCommand(args) {
  if (args[0] !== "skills" || args[1] !== "add") {
    throw new Error(
      "Only targeted 'skills add' is allowed; Skills CLI update is an unscopable global update",
    );
  }

  const forbidden = new Set(["update", "upgrade", "--all", "*", "-g", "--global"]);
  const found = args.find((arg, index) => index > 0 && forbidden.has(arg));
  if (found) {
    throw new Error("Unsafe Skills CLI argument: " + found);
  }

  const skillIndex = args.indexOf("--skill");
  const agentIndex = args.indexOf("--agent");
  if (
    skillIndex < 0 ||
    !args[skillIndex + 1] ||
    agentIndex < 0 ||
    !args[agentIndex + 1]
  ) {
    throw new Error("Targeted add requires one --skill and explicit --agent values");
  }
}

export function buildTargetedAddArgs({
  agents,
  config,
  skill,
  source,
}) {
  if (!source || !skill || skill === "*") {
    throw new Error("Targeted add requires an explicit source and skill");
  }

  const normalizedAgents = normalizeAgents({ agents });
  const args = [
    "skills",
    "add",
    source,
    "--skill",
    skill,
    "--agent",
    ...normalizedAgents,
    "-y",
    ...sourceOptionArgs(config, source),
  ];

  assertTargetedCommand(args);
  return args;
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:@-]+$/.test(value)) return value;
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

function run(repo, args, apply) {
  assertTargetedCommand(args);
  console.log("\n" + repo);
  console.log("$ npx " + args.map(shellQuote).join(" "));

  if (!apply) return { output: "", status: 0 };

  const result = spawnSync("npx", args, {
    cwd: repo,
    encoding: "utf8",
    stdio: "pipe",
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  return {
    output: String(result.stdout || "") + String(result.stderr || ""),
    status: result.status ?? 1,
  };
}

function refreshSkill({
  agents,
  apply,
  config,
  repos,
  skill,
  source,
}) {
  let failures = 0;

  for (const rawRepo of repos) {
    const repo = expandHome(rawRepo);

    if (!existsSync(repo)) {
      console.error("\n" + repo + "\nmissing repo");
      failures += 1;
      continue;
    }

    const bundleOwned = agents.some((agent) => {
      const record = path.join(repo, ".agents", `dotai-project-install-${agent}.json`);
      return existsSync(record) && readJson(record).skills?.includes(skill);
    });
    if (bundleOwned) {
      console.error(`${repo}\n${skill} is owned by a dotai bundle installation; use setup-workflow to preserve its integrity record and local changes`);
      failures += 1;
      continue;
    }

    const existing = readLock(repo)[skill];
    const refreshSource = existing?.source || source;

    if (!refreshSource) {
      console.error(
        "\n" + repo + "\n" + skill + " has no configured or locked source",
      );
      failures += 1;
      continue;
    }

    const command = buildTargetedAddArgs({
      agents,
      config,
      skill,
      source: refreshSource,
    });
    const result = run(repo, command, apply);
    if (result.status !== 0) failures += 1;
  }

  return failures;
}

export function selectSkills(args, config) {
  if (args.skill) return [args.skill];

  const skills = Object.keys(
    config.syncedRepositories?.skillSources || {},
  );
  if (skills.length === 0) {
    throw new Error(
      "--all was requested but syncedRepositories.skillSources is empty",
    );
  }
  return skills;
}

export function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    usage();
    console.error("\n" + error.message);
    return 2;
  }

  const configPath = expandHome(args.config);
  if (!existsSync(configPath)) {
    console.error("Missing config: " + configPath);
    return 2;
  }

  let config;
  let target;
  let agents;
  let skills;
  try {
    config = readJson(configPath);
    target = getSet(config, args.set);
    agents = normalizeAgents(target.value);
    skills = selectSkills(args, config);
  } catch (error) {
    console.error(error.message);
    return 2;
  }

  const repos = target.value.repos || [];
  if (!Array.isArray(repos) || repos.length === 0) {
    console.error("No repos configured for set: " + target.name);
    return 2;
  }

  console.log(args.apply ? "APPLY" : "DRY RUN");
  console.log("set: " + target.name);
  console.log("agents: " + agents.join(", "));

  let failures = 0;
  for (const skill of skills) {
    console.log("\n== " + skill + " ==");
    const source =
      config.syncedRepositories.skillSources?.[skill] || target.value.source;
    failures += refreshSkill({
      agents,
      apply: args.apply,
      config,
      repos,
      skill,
      source,
    });
  }

  if (failures > 0) {
    console.error("\nfailed: " + failures);
    return 1;
  }

  if (!args.apply) {
    console.log("\ndry run only; inspect every repo, source, skill, and agent, then rerun with --apply");
  } else {
    console.log("\nskills updated");
  }

  return 0;
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  process.exitCode = main();
}
