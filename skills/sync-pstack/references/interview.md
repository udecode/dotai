# Setup interview

The interview is the first step the user sees in a setup. Prepare it from evidence, ask only the decisions that are really open, and record the answers in `.agents/pstack.json`.

## Prepare

1. Run `discover <project>` and read its JSON. It reports:
   - the branch, the default branch and the package scripts;
   - commit style, merge and author counts, hooks and PR templates;
   - rules, installed skills with their sources, and pstack pins;
   - vendored pstack copies and skills orphaned by dotai cuts;
   - plan directories, a glossary and proof skills;
   - every local skill or rule the user typed as `/name` or `$name`, over all history and the last seven days, and every skill added in the last two weeks (`recent`).
2. Read the project's `AGENTS.md` in full, plus every workflow rule it routes work through, such as a task, patch, improve or maintain-workflow rule. Skim domain rules (framework, product, API law) only far enough to classify them.
3. Classify each workflow rule, skill and hook as one of these.
   - Covered by pstack: a vendored copy of a plugin skill, or a method poteto-mode owns (intake, playbooks, principles, reflection).
   - Covered by the shared block: a generic override the block already states.
   - Project policy: an answer to one of the questions below.
   - Domain method: keep it, and do not ask about it.

## Ask

- In Claude Code, use `AskUserQuestion`, at most four questions per call, with the recommended option first and labeled "(Recommended)". In Codex, ask in plain text with numbered options.
- Recommend the reference setup (Ellie's answers, listed first in each row below) unless the project's evidence argues otherwise. Cite that evidence in the option description: the rule's own words, the hook, typed counts, merge counts.
- Ask when the project's current rule conflicts with the recommendation, or when no evidence decides it and either answer costs something. Otherwise apply the recommendation and list it in the setup summary with the one word that reverses it.
- Always ask about delivery. It changes the most text, and it is the question the owner cares about most. Name the working branch and the protected branch in it, so the answer confirms both. `discover` guesses the protected branch from the origin's default branch, which is wrong when the origin is another local checkout.

## Questions

| # | Decision | Options, reference first | Evidence | Sets |
| --- | --- | --- | --- | --- |
| 1 | How finished work lands | Push `<branch>` after each task. A PR into `<branch>` per change, from a topic branch. The user commits, and the agent leaves changes in the working tree. | Commit and PR rules in `AGENTS.md`; Stop hooks that stage paths; `merges90d`; `authors90d` | `delivery`, `branch`, `protected` |
| 2 | Who owns engineering intake, asked only when a local controller exists (a task-like rule that owns intake, implementation and proof, a standing goal controller, an orchestrator) | poteto-mode owns intake and the controller is retired. The controller stays as a typed entry point that hands work to poteto-mode. The controller stays the owner and pstack skills are methods it selects. | The routing table in `AGENTS.md`; `typed.counts` for the controller | Adaptation only |
| 3 | Tests | The shared Tests rule: pstack's test-first bug fixes without redundant tests. Keep the project's test rule. | The project's test rule, quoted | `skip: ["tests"]` |
| 4 | Review | A panel review, `/pstack:interrogate` with Opus and Codex seats, on high-risk changes, with categories drafted from the codebase (auth or access, data writes, migrations, payments, customer sends, public API, releases). Only when the user asks. Never. Either of the first two can add a review before every PR. | Existing review rules | `risk`, `reviewPr`, `skip: ["review"]` |
| 5 | Plans and trails | The shared plan and decision-log rules in `<plans dir>`. Keep the project's plan system. | `plans` from discover; the project's plan rules | `plans`, `skip: ["plans"]` |
| 6 | Long runs | pstack's Autonomous run with `/loop` in Claude Code and `/goal` in Codex. Keep the project's own goal controller, if it has one. | Goal and pause rules in `AGENTS.md` | `skip: ["long-runs"]` |
| 7 | Commit and PR text, asked when the commit style or a PR template conflicts with the shared shape | The shared Conventional Commits and PR sections, with the template rewritten to match. The project's own convention. | `conventionalCommits` and `prTemplates` from discover, with the template's sections | `skip: ["commits"]` |
| 8 | What to retire, as one multi-select | Each local workflow skill or rule that pstack or the block now covers, each skill orphaned by a dotai cut, and each project rule named like a plugin skill; never a domain method | Typed counts over all history and the last seven days; `dotaiOrphans`; rule names that match `pstack.vendored` | Adaptation only |
| 9 | The routing table, as one confirmation with the drafted table as a preview | A table of decision or work type to owner skill, drafted from the project's skills, their descriptions and the routing already in `AGENTS.md`, with the project's domain owners first and poteto-mode playbooks for the rest. Only the owner's corrections are asked. | Skill descriptions; existing routing sections; typed counts | Written outside the block as the project's Routing section |
| 10 | The proof skill, asked only when `discover` finds none | Create one now with `pstack:create-verification-skill`, named `verify` so pstack finds it. Fall back to pstack's `run` for now. | `proofSkills` from discover; the app's run and test scripts | `proof` |

For question 9, the routing table is what makes poteto-mode hand domain work to the project's own skills instead of its generic playbooks; a project without one gets the rules but not the routing. Keep each row to one owner. For question 10, a project with a UI or a runnable app gets a proof skill; a library with a test suite may answer the second option.

For question 8, show each candidate's typed count (`typed.counts`, which covers archived Codex history and skips forks, subagent briefs and pasted text) and mark any skill in `recent`, added in the last two weeks. A typed or recent method is offered as "keep as a thin entry point" (recommended) or "drop the command"; only the owner's "drop the command" removes it, recorded under `dropped`, and even then only into a replacement that already works in this setup, per the block's Agent files rule. A vendored copy of a plugin skill installed by the Skills CLI is not a question: it duplicates the plugin, so setup removes it.

## Settled, never asked

The owner settled these for every project. Report them as applied.

- The lead writes the code; subagents research, review and fan out read-only.
- Messages to another person need explicit authorization, and a "can we X?" question gets a proposal, not the action. Spending a shared resource, or widening an access grant, needs a go-ahead per target.
- Claude Code runs every pstack role on Opus except Codex panel seats; Codex roles inherit the session model.
- No per-delegate worktrees.
- Panels seat Opus, `codex:gpt-6-astra @high` and `codex:gpt-6.1-sol @xhigh`, read-only through `cross.mjs`, and a critical finding is the blocking ceiling.
- Principles are read, not named in replies.
- One writing pass per kind of change, with `deslop` and `no-comments` before any review.
- A `codex:gpt-6.1-sol @xhigh` seat reviews decision trails from Claude Code, and an Opus seat from Codex.
- The blocked budget, and the todo list and close discipline.
- Production deploys and releases need an explicit request.
- The plugin pin follows the latest upstream tag.

Delivery confirms `branch` and `protected`. The other values that discover reports (`lintFix`, `check`, `glossary`, a proof skill, skiller) are confirmed only when missing or ambiguous.

## Record

Write `.agents/pstack.json`. The script adds `synced` on the first apply. This example is a project where the user owns commits, reviews only on request and keeps its own goal controller.

```json
{
  "tag": "v0.9.52",
  "branch": "next",
  "protected": "main",
  "delivery": "user",
  "lintFix": "pnpm lint:fix",
  "check": "pnpm check",
  "plans": "docs/plans",
  "risk": "",
  "proof": "verify-app",
  "skiller": true,
  "skip": ["long-runs"]
}
```

| Field | Meaning |
| --- | --- |
| `tag` | The pstack-claude tag every pin uses. Required. |
| `branch` | The branch agents work on and deliver to; in `pr` mode, the PR base. Required. |
| `protected` | A branch agents never edit or push without a request, usually the default branch. It must differ from `branch`; leave it out when agents work on the default branch. |
| `delivery` | `push`, `pr` or `user`. Required. |
| `lintFix` | The last check a completed task runs. Required. |
| `check` | The broad check for a settled change, used by the Tests and Commit rules. Required. |
| `plans` | The directory for plans and decision logs, used by the Plans rule and its helpers. Required unless `plans` is skipped. |
| `risk` | The high-risk categories that trigger the panel review beyond big work. Empty means only big work and the user's asks get one. |
| `reviewPr` | `true` to also run the panel review before opening any PR. Optional. |
| `proof` | The project's proof skill: pstack's driver skill for reproducing and verifying, and the replacement for its swarm lanes. Optional. |
| `glossary` | A glossary file whose words agents use. Optional. |
| `skiller` | `true` when the project generates skills from `.agents/rules` with skiller. Optional. |
| `regen` | The project's command that regenerates skills from rules when `bunx skiller@latest apply` alone is not enough, such as `pnpm install` when a prepare script also syncs rule resources. Optional; used only with `skiller`. |
| `dropped` | Typed commands the owner chose to drop without an entry point; `verify` stops flagging them. Optional. |
| `pageLead` | Section titles the project's own skills write into plans, rendered by `plan-page.mjs` right after Public API in this order, such as an editor comparison. Not set by the interview; the owning skill's project adds it. Optional. |
| `pagePairs` | Section titles, beyond Public API, that `plan-page.mjs` refuses to render unless each `before` fence is followed directly by its `after` fence, such as a stored document shape. Optional. |
| `pageTopic` | `{ "field": "<frontmatter list>", "hub": "<path with {topic}>" }`: a plan without a `Topic:` line takes its subject from the first entry of that list, and the page links the subject's history at `hub`; `require` lists sections a subject must carry when its hub exists, such as an editor comparison for every ledger scope. For a project whose plans already name a ledger scope. Optional. |
| `bigWork` | What else counts as big work in this project and earns the panel review, beyond public API, architecture, high-risk and long-run work, naming concrete places, such as "a change to a package export or a review_scopes ledger decision, or a plan with more than one phase". Optional. |
| `skip` | Block sections the project keeps as its own rule: `tests`, `review`, `plans`, `long-runs`, `commits`. |

Answers to questions 2 and 8 have no field. Carry them into the adaptation and the setup summary.
