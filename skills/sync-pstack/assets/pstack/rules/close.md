<!-- # Shared rule file. sync-pstack renders it into each project's .agents/pstack/rules/; the grammar is in the skill's SKILL.md. -->
# Todo list and close, and Decision-trail review

This file says how a run closes in non-trunk delivery: gate order, subagent replies, counts, and the decision-trail review. The pstack block in `AGENTS.md` points here. Edit its shared source in `udecode/dotai`.

- **Todo list and close.** Close every todo with its proving artifact (skill run, test log, path, commit, or `skip: <reason>`). Re-verify `skip:` reasons if the design changes. Close in order: cheap proofs that can still force code edits, writing passes, panel review and fixes, lint fix, repeated acceptance proof on final bytes, decision-trail review (when triggered), immutable ledger/log records, `/pstack:reflect` (when asked), then `chips` Close.
<!-- if delivery=push|pr|trunk -->
  Walk the run's commit ledger during the closing reread so every commit has its proof and decision-log row.
<!-- end -->
  - **Subagents.** After editing an instruction file (`AGENTS.md`, skills, models sheet), tell later subagents to re-read those files from disk. Wait for background subagents by doing other work or ending the turn, never with a sleep/poll loop. Save important subagent replies verbatim into the run directory so compaction cannot lose them.
  - **Partial proofs and counts.** A close with more than ten items reports done, partial, skipped, blocked, and open counts summing to the total. A step whose approved proof did not pass stays unchecked until it passes or a `look` Defaults row accepts a narrower proof that still meets the user's goal. A resume or wakeup prompt carries the goal, gate, and plan path, pointing at the first open gate.
<!-- # overrides show-me-your-work/SKILL.md "spawn a subagent on a model from another family" -->
- **Decision-trail review.** Run a cross-family trail review (`codex:gpt-6.2-sol` from Claude Code, `opus` from Codex) only for unattended runs, multi-session runs, panels that dismissed/narrowed/left open a critical finding, or new/changed shared scripts. The reviewer checks the log against the transcript (cited by path and line range, never copied) and the user's verbatim asks. Fix or refute critical findings with real transcript citations, and include the review's Attention section in `## Close`.
