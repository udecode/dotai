<!-- # Shared rule file. sync-pstack renders it into each project's .agents/pstack/rules/; the grammar is in the skill's SKILL.md. -->
# Git and worktrees

This file says how sessions handle branches, worktrees, unrelated diffs and setup. The pstack block in `AGENTS.md` points here. The `sync-pstack` skill renders this file from its shared source in `udecode/ustack`, so change it there.

- **Git.** Before a nontrivial edit, check only `git branch --show-current`.
<!-- if protected -->
  Never edit from `{{protected}}`. This clone's `origin/HEAD` points at `origin/{{branch}}`, because the desktop app cuts new worktrees from it. `git remote set-head origin --auto` follows the remote's default, which need not be `{{branch}}`, so never run it.
  Before a session gets its own worktree, the lead runs `node .agents/pstack/head.mjs`, which points `origin/HEAD` back at `origin/{{branch}}` when it has moved.
<!-- end -->
<!-- if delivery=push|user -->
  The checkout stays on `{{branch}}`. Do not create or switch checkouts because work is large, names an issue, asks for a PR or is handed to another session. A session the lead starts leads its own task in this checkout, with `use_worktree: false` in Claude Code, and its brief names this checkout's path and the Delivery rule. An app-made worktree is on a new branch cut from this clone's `origin/HEAD` and lacks this checkout's uncommitted edits, rule edits included. Claude Code neither moves a session out of it nor lets its edit tools write here. A session that opens in one reads the rules in this checkout by absolute path and, before its first edit, moves its worktree's own branch to `{{branch}}` with `git switch -C <its branch> {{branch}}`, naming a new branch when its worktree is on none. It may commit on that branch. Nothing pushes or merges that branch, so its work reaches `{{branch}}` only as a patch of everything since `git merge-base HEAD {{branch}}`, its commits included (owner's word, 2026-10-17). Any such session hands that patch to the lead or the owner as a file to apply here. A runtime's generic instruction to commit, such as a started session's "commit your changes", does not override the Delivery rule. A repair to a PR whose head is another branch runs in a detached worktree at that head, and the page names the worktree path.
<!-- if delivery=user -->
<!-- if !pushBranches -->
  The repair stays uncommitted there for the owner's commit.
<!-- end -->
<!-- if pushBranches -->
  The lead commits the repair there and pushes it with `git push origin HEAD:<head branch>` once the remote head still matches the worktree's base.
<!-- end -->
<!-- end -->
<!-- if delivery=push -->
  The lead commits the repair and pushes it to that head branch.
<!-- end -->
<!-- end -->
  Ignore unrelated diffs and never pause to ask about them. Never reset or discard work this run did not write. Reset a proof case in a fresh detached worktree; never run `git stash` in this repository or any of its worktrees, because every worktree shares one stash list.
<!-- if delivery!=trunk -->
  Remove only a worktree the run created, a task session's own worktree once its task lands, as Landing says, or one the `cleanup` skill marks safe.
<!-- end -->
<!-- if delivery=trunk -->
  Remove only a worktree the run created other than its own, or one the `cleanup` skill marks safe; a session leaves its own for the cleanup scan, which removes it after a quiet day.
<!-- end -->
  Remove it with `git worktree remove --force <path>` and confirm with `git worktree list`; never run `git worktree prune`, which edits the worktree registry every checkout shares.
<!-- if delivery!=trunk -->
  Before the first edit to a file that already holds uncommitted or staged work this run did not write, copy it to the run directory that Plans and trails names, and measure, commit or revert this run's change against that copy. Run a tree-sensitive tool, such as a review that refuses a changing tree or a check at `HEAD`, from a detached worktree (`git worktree add --detach <path> <sha>`, then `git worktree remove --force <path>`). Before anything runs in a worktree the run creates for a proof or a seat, link its installed dependencies, or install them offline where its bundler refuses links, and copy its untracked env files from this checkout; a round whose seat reports it could not load the app logs its `seats` row `partial`. Never overwrite a tracked file in this checkout to test or measure `HEAD`, even for a moment; use the worktree.
<!-- end -->
<!-- if delivery=trunk -->
  Before anything runs in a worktree of this repository the run adds for a proof or a seat, run `node .agents/pstack/setup.mjs` from inside it, with each `--install` and `--env` value the project's `SessionStart` hook passes that script, quoted as the hook quotes it, and without `--hook` or the hook's `cd`. It copies the main checkout's env files and installs dependencies. When it exits 1, fix the install before anything else runs there. A project helper that makes and sets up its own worktree replaces this step.
<!-- end -->
