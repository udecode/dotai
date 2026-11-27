<!-- # Shared rule file. sync-pstack renders it into each project's .agents/pstack/rules/; the grammar is in the skill's SKILL.md. -->
# Worktrees and landing

This file says how a task works in its own worktree and lands on `{{branch}}` in `trunk` delivery. The pstack block in `AGENTS.md` points here. Edit its shared source in `udecode/ustack`.

<!-- # overrides poteto-mode/playbooks/opening-a-pr.md "Work from a git worktree off trunk" -->
<!-- # relies poteto-mode/playbooks/feature.md "**Give every file-writing delegate its own worktree**" -->
- **Worktrees.** Each task works in its own worktree cut from `origin/{{branch}}` when it first needs to run or edit project files, not at intake. Never edit or commit in the main checkout while it is on `{{branch}}`
<!-- if protected -->
  or `{{protected}}`
<!-- end -->
  (except under `{{plans}}/artifacts/`, git-ignored for run directories and local queue artifacts). Keep temporary build/benchmark checkouts in a temp folder and remove them when done. After landing, finish any owed reflect and ask reread, merge run directories into the main checkout, and run `scan.mjs --landed <worktree>` (leaving the worktree for cleanup after a quiet day, or locking it if the scan fails). `setup.mjs --hook` on SessionStart copies untracked `.env`/`.env.local` files, runs `--install` in new worktrees, and fast-forwards the main checkout when safe.
<!-- # overrides poteto-mode/playbooks/feature.md "Run **Opening a PR**" -->
<!-- # overrides poteto-mode/playbooks/opening-a-pr.md "Invoked at the end of every other playbook." -->
<!-- # relies poteto-mode/playbooks/opening-a-pr.md "dropping empty ones: `## Why`" -->
<!-- # relies poteto-mode/playbooks/opening-a-pr.md "`## Blast Radius`, `## Verification`." -->
<!-- # overrides poteto-mode/playbooks/opening-a-pr.md "Rebase into small, landable commits." -->
<!-- # overrides poteto-mode/playbooks/opening-a-pr.md "Body: a one-minute briefing under 40 lines" -->
<!-- # overrides poteto-mode/playbooks/opening-a-pr.md "Open PRs ready, through the run's PR tool with `draft: false`." -->
- **Landing.** After writing passes and proof, land with `node .agents/pstack/land.mjs --message <file> [--check <command>]...`. Run with `--dry` in the foreground first to validate the message and `landChecks`, then run the real land in the background with a 60-minute timeout (ending with `land.mjs` itself so the exit code is preserved).
  - **Commit message.** One Conventional Commit (`feat|fix|docs|refactor|test|chore|perf(scope): subject`, imperative, no trailing period), short `Why` body describing final behavior, plus required lines `Beyond the ask:`, `Picks:`, and `Not checked:` (`none` when empty). A `fix` commit also requires `Introduced-by: <sha>` (or `none`). Never put closing keywords (`close`, `fix`, `resolve`) before `#<N>`, `<owner>/<repo>#<N>`, `GH-<N>`, or issue URLs; cite `<repo>#<N>` instead.
  - **Execution.** `land.mjs` squashes the worktree into one commit, rebases onto `origin/{{branch}}` (rebuilding `generated` entries on conflict or when marked `always`), runs `{{lintFix}}`, `landChecks`, and each `--check`, and delivers per `git config pstack.delivery`. In `push` mode it pushes `{{branch}}` (retrying up to 3 branch moves and backing off on GH006/network errors; exit 75 means retry up to 3 times with no `--message`). Without `push`, it pushes a topic branch, opens a PR (rendering `plan-page.mjs --pr` if one dated plan changed, else requiring `## Why` and `## Verification`), and arms GitHub auto-merge.
  - **Closing plans and signing.** In `push` mode, write `## Close`, tick completed boxes, and set the final `Status:` before the last `land.mjs` run; never name a commit's own SHA inside the plan. If GPG signing fails due to a locked signer, ask the owner once to unlock it and rerun `land.mjs`.
<!-- if protected -->
  - **Guard.** `guard.mjs` blocks force-push/delete of `{{branch}}` and `{{protected}}`, direct `git push` to `{{branch}}` (unless `--dry-run` or `PSTACK_RELEASE=1`), `gh pr create` into `{{branch}}`, workflow run approvals, and edits in the main checkout outside `{{plans}}/artifacts/`.
<!-- end -->
<!-- if !protected -->
  - **Guard.** `guard.mjs` blocks force-push/delete of `{{branch}}`, direct `git push` to `{{branch}}` (unless `--dry-run` or `PSTACK_RELEASE=1`), `gh pr create` into `{{branch}}`, workflow run approvals, and edits in the main checkout outside `{{plans}}/artifacts/`.
<!-- end -->
<!-- # adds -->
- **Companion repository.** When `.agents/pstack.json` configures `companion`, a second repo at `companion.dir` tracks `companion.list` files in the same folder (`git --git-dir=<companion.dir> --work-tree=.`). `land.mjs` rebases and checks both halves together, pushes `{{branch}}` first, then pushes the companion commit with `Lands-With: <sha>`. Stage intentional companion deletions with `rm --cached`. `guard.mjs` blocks `git clean -x/-X`, `git clean` via `companion.dir`, and moving to commits lacking `companion.list`.
<!-- # adds -->
- **Other people's PRs.** Fix another person's PR in a detached worktree at its head and push `HEAD:<head branch>` if the remote head matches. Keep your PR description (or latest comment on someone else's PR) true to the pushed diff. If maintainer edits are disabled, carry their commits into one commit with `Co-authored-by:` lines, land it, and close their PR linking the replacement.
<!-- # adds -->
- **Review.** `land.mjs` appends `Session:`, `Plan:` (when one dated plan changed), and `Lead:` trailers. Review unreviewed commits with `node .agents/pstack/review.mjs` (`--tier internal|all`, `--net <session>`, `--done <session>`, `--mark`, `--revert <session> [--stage]`). List every commit landed in this turn in the reply's link list.
<!-- if sourceless -->
  Commits must cite a source (repo/companion issue `<repo>#<N>` or `Plan:` path) unless the GitHub user is in `sourceless`.
<!-- end -->
