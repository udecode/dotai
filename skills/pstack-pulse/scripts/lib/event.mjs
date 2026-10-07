import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export const HOME = join(homedir(), '.pstack-pulse');
export const QUESTION_TOOLS = ['AskUserQuestion', 'ExitPlanMode'];
const PLAN_SIGNALS = [/Appended (?:a row|\d+ rows) to (\S+?\.decisions\.tsv)/gu, /(\S+\/artifacts\/[^\s/]+\.html)\s*$/gmu];
const PLAN_PAGE = /\/artifacts\/(?:topics\/)?[^/]+\.html$/u;
const clip = (text, size) => (typeof text === 'string' ? text.slice(0, size) : null);

export const planMatches = (text) => PLAN_SIGNALS.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => match[1]));
const planSignals = (cwd, text) => (typeof text === 'string' ? planMatches(text).map((path) => resolve(cwd ?? '/', path)) : []);

function checkOf(cwd) {
  for (let dir = cwd; dir !== dirname(dir); dir = dirname(dir)) {
    const config = join(dir, '.agents/pstack.json');
    if (!existsSync(config)) continue;
    try {
      return JSON.parse(readFileSync(config, 'utf8')).check ?? null;
    } catch {
      return null;
    }
  }
  return null;
}

const isCheckRun = (command, check) => new RegExp(`^${check.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(?: +-[\\w=.:/,@-]+)*$`, 'u').test(command.trim());

function pushOf(response, cwd) {
  const push = response.gitOperation?.push;
  if (!push?.branch) return null;
  const sha = response.gitOperation.commit?.sha ?? spawnSync('git', ['-C', cwd, 'rev-parse', `refs/remotes/origin/${push.branch}`], { encoding: 'utf8', timeout: 2000 }).stdout?.trim();
  return sha ? { branch: push.branch, sha, cwd } : null;
}

export function eventOf(runtime, input, env, at = new Date().toISOString()) {
  if (env.CLAUDE_CODE_SESSION_ATTENDED === '0' || env.PSTACK_PULSE_OFF === '1' || input.agent_id || !input.session_id) return null;
  const event = input.hook_event_name;
  const tool = input.tool_name ?? null;
  const toolInput = input.tool_input ?? {};
  const response = input.tool_response ?? {};
  const cwd = input.cwd ?? null;
  const questions = QUESTION_TOOLS.includes(tool) && Array.isArray(toolInput.questions) ? toolInput.questions.map((question) => ({ question: clip(String(question?.question ?? question?.title ?? ''), 300), options: (question?.options ?? []).map((option) => clip(String(option?.label ?? option), 80)) })) : null;
  const command = typeof toolInput.command === 'string' ? toolInput.command : null;
  const check = command && cwd && ['PostToolUse', 'PostToolUseFailure'].includes(event) ? checkOf(cwd) : null;
  return {
    v: 2,
    at,
    runtime,
    session: input.session_id,
    event,
    cwd,
    transcript: input.transcript_path ?? null,
    title: clip(input.session_title, 120),
    source: input.source ?? null,
    tool,
    toolUseId: input.tool_use_id ?? null,
    questions: questions?.length ? questions : null,
    plans: planSignals(cwd, response.stdout),
    push: event === 'PostToolUse' && cwd ? pushOf(response, cwd) : null,
    check: check && isCheckRun(command, check) ? { ok: event === 'PostToolUse' } : null,
    published: event === 'PostToolUse' && tool === 'Artifact' && [undefined, 'publish'].includes(toolInput.action) && PLAN_PAGE.test(toolInput.file_path ?? ''),
    lastMessage: event === 'Stop' ? clip(input.last_assistant_message, 150) : null,
    background: Array.isArray(input.background_tasks) ? input.background_tasks.length : 0,
    pid: Number(env.CLAUDE_PID) || null,
    bridge: env.CLAUDE_CODE_BRIDGE_SESSION_ID ?? null,
  };
}
