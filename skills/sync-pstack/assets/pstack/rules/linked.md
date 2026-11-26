<!-- # Shared rule file. sync-pstack renders it into each project's .agents/pstack/rules/; the grammar is in the skill's SKILL.md. -->
# Linked sessions

This file says how a session that another session started stays out of that session's way. The pstack block in `AGENTS.md` points here. The `sync-pstack` skill renders this file from its shared source in `udecode/dotai`, so change it there.

<!-- # overrides poteto-mode/worker.md "The bar in your kickoff is the whole bar. Add no check, gate, sign-off or review round above it." -->
- **Briefs.** A session that another session started follows `AGENTS.md` in full, even when its brief starts with pstack's `worker.md` line. That file's bar is a subagent's, so a session's brief never lifts a gate the project's rules set, such as its proof, writing passes, panels or landing.
<!-- # adds -->
- **Detach.** In Claude Code desktop, a session that another session started (`get_session` with `self` shows a `parentSessionId` without `detached: true`) detaches itself from that session as its first step with `detach_session` with `self`, because while linked each of its turn ends wakes the other session, and each wake re-reads that session's whole context. In T3 Code, top-level threads launched with `t3_thread_launch` do not auto-wake their parent, so no detach step is needed (cross-session messages use `t3_thread_search` + `t3_thread_send`). It messages that session only when the brief that started it says that session's run waits on its result, and then once, when it lands or stops; a follow-up, such as the next item of a queue, sends nothing back (owner's word, 2026-10-21). A lead that starts a session its run waits on says so in its brief.
