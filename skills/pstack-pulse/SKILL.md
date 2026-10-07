---
name: pstack-pulse
description: Show every Claude Code and Codex session on the iPhone lock screen through ActivitySmith and in the Mac menubar, with each plan page's pipeline, and buzz when a session needs you, ships or fails.
argument-hint: install | doctor | status | menubar | uninstall
disable-model-invocation: true
---

# pstack pulse

A daemon on this Mac turns hook events from every Claude Code and Codex session into ActivitySmith Live Activities. It shows one card per project, then fills the rest of the phone's five cards with one card per session. A session card shows the session's plan page stage bar. Sessions that need you, through a question or a permission prompt, get a card first, then working ones; idle sessions get none. A question turns the session's card orange and puts the question in its subtitle, without ending the card. A session that finishes its turn keeps its card for fifteen minutes before a working session can take it, because every new card spends one of the remote starts iOS allows. A project is every clone and worktree of one git origin, so two clones of plate share a card. A repository without an origin is its own project, and sessions outside any repository share one called other. A project card lists each session that needs you, failed or is working. Each one shows the session's name in large type, and under it, in small type, its plan page's stage, or Needs you or Failed, in its state color. Sessions that need you come first, then failed and working ones. Idle sessions, which are still open but finished their turn, are not listed. A project with only idle sessions shows one gray value, its idle count, so its card does not end and start again. A card with more than eight active sessions shows seven and a more value. While a session needs you, the card's subtitle shows its question and the card's one button opens that session. Otherwise the subtitle counts the failed and working sessions, and the button opens the session list. A card never changes type, so a question starts no new card. A project card keeps its slot until a project with a more urgent session needs it. It pushes a notification when a session needs you, ships or fails, and sets the app badge to the number of sessions that need you. You answer in the vendor's own app. Tapping a push opens the session's plan page when it has one, else the session. A push's Answer button opens a Claude session's Remote Control link, or the ChatGPT app for Codex. A Claude session with Remote Control off has no link the phone can open, so its pushes show no Answer button, and a card that asks for it opens the session list. ActivitySmith takes links only for a card's button, not for a tap on the card itself. That button takes only web and Shortcuts links, so a card that asks for a Codex session opens the session list too. `<skill>` below is this skill's base directory, and every command is `node <skill>/scripts/pulse.mjs <command>`.

## What it reports

- Claude sessions buzz for:
  - a question or plan approval, at once;
  - a permission prompt left unanswered for about six seconds. Claude reports it through its `permission_prompt` notification, which desktop sessions send from Claude Code 2.1.233 on; in a terminal, typing restarts the six seconds. A call that a rule allows, or that another hook allows within six seconds, stays silent. The push shows Claude's own notification text, which may not name the tool. Your next prompt or the end of the turn clears the card. No hook says when a prompt is answered, so the card stays on needs you for the rest of the turn after you answer. While one prompt or question waits, a second prompt does not buzz. After you deny a prompt, Claude stops and waits, so the card stays on needs you until your next prompt;
  - a push the remote branch has;
  - a required check still failing when the turn stops;
  - an API error;
  - a session that died while working.
- Codex sessions from the app or the CLI buzz for questions and permission prompts, and show their plan. Codex pushes, failed checks and lost processes are not observed, because Codex hooks carry no git result or tool failure.
- A required check counts only when the Bash command is the check itself, optionally with flags, such as `bun check --bail`. Any other form, such as `bun check | tail`, a chain or a second line, records nothing, because its exit status is not the check's. A configured check that is itself a chain never counts.
- A session is working while a turn runs. It stays working after the turn while a background shell, subagent or monitor it started still runs, because that work wakes it with a new turn. An open artifact page watch does not count, because it never wakes the session. A dev server left running in the background keeps the session working until the server stops.
- Panel seats, smoke runs, headless `claude -p` runs, subagents and Codex exec and review threads never show. A session started with `PSTACK_PULSE_OFF=1` in its environment never shows either.
- A turn that hands back a plan page buzzes once as "<session> replied", with the first line of its last message. It does not count as needing you, so the card and the badge stay as they are. A hand-back counts only when the turn published a page from the plans folder's artifacts while the session is bound to a plan.
- A buzz goes out at least once while its event still needs you. A refused push is retried until ActivitySmith accepts it; a question you answer first is never sent. If the daemon crashes, or the network drops, after ActivitySmith accepts a push but before the daemon saves that, the push goes out again, because the push API has no idempotency key.

## Install

1. Run `install`. It is done when it prints the hook files, `daemon: started`, `menubar: started` and the session list URL. The daemon picks up the key within 30 seconds of it being stored.
2. Hand the owner the three steps it prints, which only the owner can do:
   - Store the ActivitySmith key in the Keychain with the `security add-generic-password` line.
   - Publish the read-only session list with the `tailscale funnel` line. The list lives at a secret path and accepts no input.
   - In Codex, open `/hooks` once and trust the pstack-pulse hooks.
3. Ask the owner to turn off the Claude app's own "Push when actions required", so each question buzzes once.
4. Run `doctor`. It is done when every line reads `ok`.

## Status and repair

- `status` lists every live session with its state, then the cards on the phone and the badge.
- `doctor` checks the key, the daemon, the menubar, both hook files, the Claude session registry, that cc-same and cswap are on the daemon's PATH, and the list secret.
- The daemon logs to `~/Library/Logs/pstack-pulse.log` and keeps its state in `~/.pstack-pulse/`. An inbox file it cannot read as an event moves to `~/.pstack-pulse/inbox/bad/`.
- A card's pipeline comes from `node .agents/pstack/plan-page.mjs <plan> --rail` in the session's own repository. A repository synced before that mode existed shows "No plan" until its next sync-pstack run.
- `install` owns only the hook entries whose command ends in `--owner=pstack-pulse`. It keeps every other hook in the same group, saves a first backup of each settings file beside it, and writes through a temporary file, so a crash never leaves half a file; a change another program makes during that write is lost. Claude's `PreToolUse` hook runs only for `AskUserQuestion` and `ExitPlanMode`.
- Only one daemon runs at a time: it holds a socket under /tmp named for its state folder, and a second daemon that finds the socket answering exits.
- `uninstall` stops the daemon and the menubar, deletes their LaunchAgents and removes only its own hook entries. It ends its cards and clears the badge, says what is still on the phone if that fails, prints the line that stops the Funnel, and keeps the state folder.

## Menubar

The menubar puts the phone's sessions on the Mac, one row each. Its number counts the sessions that need you, in orange. With none, it counts failed sessions in red, then working ones. A moon means every session is idle, and a struck-through bolt means the daemon does not answer. Its menu shows the fleet totals, which the phone no longer shows, then a row for every live session: those that need you first, then failed, working and idle. Each row shows the session's title, state, project, stage and stage bar. Clicking a row opens the session when it needs you, else its plan page, and a row under it opens the other one. The phone shows at most five cards, but the menu has no limit.

`install` compiles `menubar/PulseMenu.swift` with Xcode's `swiftc` into `~/.pstack-pulse/bin/pstack-pulse-menu` and runs it as the `dev.pstack.pulse.menu` LaunchAgent. Without `swiftc` it prints that the menubar was not built and installs everything else. `menubar` rebuilds and restarts only the menubar. Quit stops it until the next login. Any other exit restarts it. It reads the daemon's `board.json` on the session list port every two seconds. About three seconds after it starts, it writes its menubar position, and whether macOS draws it, to `~/Library/Logs/pstack-pulse-menu.log`. There, `shown=false` means macOS is not drawing it right then. `--dump` prints the menu as text and quits, which checks it without screen recording access.

## Pet

The pet is paused while the menubar covers the Mac, so `install` never starts it. `node <skill>/scripts/pulse.mjs pet` opens a floating pet in the corner of the screen, above every window and on every Space, using the Codex desktop pet's sprite format and animations. It runs while any session works, waits with an orange badge counting the sessions that need you, plays its failed animation while one has failed, and jumps for ten seconds after a push ships. Click it for a tray that lists what needs you, with buttons that open the session or its plan page; drag it anywhere, and it keeps that spot. The first start fetches Electron through `npx` and the Codex sprite from OpenAI's pet CDN into `~/.pstack-pulse/pets/`. The pet reads the daemon's `state.json` on the session list port every two seconds. `--snapshot` saves `pet-snapshot.png` and `pet-snapshot-tray.png` in `~/.pstack-pulse/` and quits, which checks the render without screen recording access.

## Tests

`node --test <skill>/scripts/pulse.test.mjs`
