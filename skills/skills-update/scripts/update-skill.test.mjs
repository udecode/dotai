import assert from "node:assert/strict";
import test from "node:test";

import {
  assertTargetedCommand,
  buildTargetedAddArgs,
  normalizeAgents,
  parseArgs,
  selectSkills,
} from "./update-skill.mjs";

const config = {
  syncedRepositories: {
    skillSources: {
      autogoal: "udecode/dotai",
      tdd: "udecode/dotai",
    },
    sourceOptions: {},
  },
};

test("named refresh is a dry run unless --apply is explicit", () => {
  assert.deepEqual(parseArgs(["autogoal"]), {
    all: false,
    apply: false,
    config: process.env.AGENTS_CONFIG || "~/.agents/config.json",
    dryRunExplicit: false,
    set: undefined,
    skill: "autogoal",
  });
  assert.equal(parseArgs(["autogoal", "--apply"]).apply, true);
});

test("broad refresh requires --all and cannot hide behind an empty invocation", () => {
  assert.throws(() => parseArgs([]), /--all explicitly/);
  assert.throws(
    () => parseArgs(["autogoal", "--all"]),
    /one named skill or --all/,
  );
  assert.deepEqual(selectSkills(parseArgs(["--all"]), config), [
    "autogoal",
    "tdd",
  ]);
});

test("agent targets must be an explicit allowlist", () => {
  assert.deepEqual(
    normalizeAgents({ agents: ["codex", "claude-code", "codex"] }),
    ["codex", "claude-code"],
  );
  assert.throws(() => normalizeAgents({ agent: "*" }), /Legacy target-set field/);
  assert.throws(() => normalizeAgents({ agent: "codex" }), /Legacy target-set field/);
  assert.throws(
    () => normalizeAgents({ agents: ["codex", "*"] }),
    /Unsafe agent target/,
  );
  assert.throws(() => normalizeAgents({}), /non-empty agents array/);
});

test("refresh command can only be a targeted project add", () => {
  const command = buildTargetedAddArgs({
    agents: ["codex", "claude-code"],
    config,
    skill: "autogoal",
    source: "udecode/dotai",
  });

  assert.deepEqual(command, [
    "skills",
    "add",
    "udecode/dotai",
    "--skill",
    "autogoal",
    "--agent",
    "codex",
    "claude-code",
    "-y",
  ]);
  assert.doesNotThrow(() => assertTargetedCommand(command));
  assert.throws(
    () => assertTargetedCommand(["skills", "update", "autogoal"]),
    /Only targeted 'skills add'/,
  );
  assert.throws(
    () =>
      assertTargetedCommand([
        "skills",
        "add",
        "udecode/dotai",
        "--skill",
        "autogoal",
        "--agent",
        "*",
      ]),
    /Unsafe Skills CLI argument/,
  );
  assert.throws(
    () =>
      assertTargetedCommand([
        "skills",
        "add",
        "udecode/dotai",
        "--skill",
        "autogoal",
        "--agent",
        "codex",
        "-g",
      ]),
    /Unsafe Skills CLI argument/,
  );
});
