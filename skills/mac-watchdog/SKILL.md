---
name: mac-watchdog
description: Keep a Mac from freezing under agent workloads. A user launchd job records memory every 10 seconds, per process and per Claude Code session, and stops any process that grows past 40% of RAM, and a root job restarts fseventsd when its memory leak passes 1 GB. Use to install, check or remove them, after a Mac freezes, swaps hard or logs the user out, when fseventsd holds GBs of memory, or to find which session or process used the memory.
---

# mac-watchdog

A frozen Mac leaves almost nothing behind. macOS logs that memory ran out, not what used it, and a long enough freeze makes it kill WindowServer, which logs the user out and closes every app. This skill runs two launchd jobs that record what happens and step in before the freeze.

| Job | Runs as | Does |
| --- | --- | --- |
| `dev.dotai.mac-watchdog` | the user | Records memory every 10 seconds and stops runaway processes |
| `dev.dotai.mac-watchdog.fseventsd` | root | Restarts fseventsd when its leak passes 1 GB |

They are two jobs because restarting fseventsd needs root, and a root job must never run a file the user can edit, such as Node or the recorder. Both write to `~/Library/Logs/mac-watchdog/`.

`<skill>` is this skill's base directory.

## Install, update or remove

1. To install the recorder, or to apply an edit to `scripts/recorder.mjs`, run `zsh <skill>/scripts/install.sh`. It needs no sudo. It copies the recorder to `~/Library/Application Support/mac-watchdog`, compiles the `footprint` helper with `cc`, writes `~/Library/LaunchAgents/dev.dotai.mac-watchdog.plist` with the `node` on PATH, starts the job and prints the first sample. It refuses when another recorder already runs, and when `cc` is missing, which `xcode-select --install` fixes. It also removes the job of `mem-log`, this skill's old name, and moves its logs here. Done when it prints a sample line.
2. To install the fseventsd watchdog, or to apply an edit to `scripts/fseventsd.sh`, the user runs `sudo zsh <skill>/scripts/install-fseventsd.sh`, because it needs root; give them the command. It copies the watchdog to `/usr/local/sbin` as root-owned, writes `/Library/LaunchDaemons/dev.dotai.mac-watchdog.fseventsd.plist`, removes the job of `fseventsd-watchdog`, this part's old name, starts the job, then prints its log, fseventsd's memory and the leak's onset line from the last 7 days (`event table has grown too large`).
3. To remove them, run `zsh <skill>/scripts/install.sh uninstall` and `sudo zsh <skill>/scripts/install-fseventsd.sh uninstall`. The logs stay.

## Check

- `launchctl print gui/$(id -u)/dev.dotai.mac-watchdog` and `launchctl print system/dev.dotai.mac-watchdog.fseventsd` show each job and its last exit code.
- `node <skill>/scripts/report.mjs --last 3` prints the latest samples. A sample older than a minute means the recorder stopped, and `~/Library/Logs/mac-watchdog/stderr.log` says why, such as a `node` path that moved after a Node upgrade, which a new install fixes.

## The recorder

The recorder writes one JSON line every 10 seconds to `~/Library/Logs/mac-watchdog/<UTC day>.jsonl`, and keeps 10 days, about 30 MB a day. Each line holds the kernel's free-memory level and pressure, swap use and swap traffic, the compressor's size, and the processes grouped by the Claude Code session or top-level program they run under, with each group's footprint. Every sixth line adds `top`'s view, which alone sees root daemons such as fseventsd and WindowServer. A `gapS` well over 10 means the recorder itself was starved. It reads footprint, not RSS, because swapped and compressed pages drop out of RSS, and it names sessions from the Claude desktop app's session records.

## Runaway processes

When one of the user's processes passes the kill limit, the recorder sends it SIGTERM, then SIGKILL if it is still over the limit 10 seconds later. The limit is 40% of RAM, 51 GB on a 128 GB Mac. A leaking test once grew to 214 GB on such a Mac, and no healthy process gets near the limit. Apps and system programs are never signalled: a command under an `.app` bundle, `/System`, `/usr`, `/bin`, `/sbin` or `/Library/Apple`, so Claude, Chrome and the virtual machines are safe.

Each kill posts a notification and appends a line to `~/Library/Logs/mac-watchdog/kills.jsonl`, with the process's command line, its footprint and the Claude session that started it. `report.mjs` prints it as a `kill:` line under its sample. Tell that session what was stopped, so it fixes the leak before it runs the same command again.

To change the limit, reinstall with `MAC_WATCHDOG_KILL_GB=<GB> zsh <skill>/scripts/install.sh`. `0` turns the guard off.

## The fseventsd leak

macOS 15.6 to 27.x has an fseventsd leak. The sweeper that prunes its event table keeps its place in a 32-bit counter, which stops advancing after about 8.4 million runs. Once the table is at its 262,144-bucket maximum, every newly changed path leaks about 350 bytes, lookups slow down, and event delivery can stop without an error. Apple budgets fseventsd 30 MB. A leaking one reaches tens of GB within days on a Mac that installs `node_modules` into many worktrees, each about 170,000 new paths. Turning Spotlight off and `no_log` files do not stop it. A restart does, because a fresh fseventsd starts with a small table. Sources: Hixie/contraptions fseventsd-watchdog, Apple developer forums thread 849819, anthropics/claude-code#98769.

The root job checks fseventsd every 2 minutes, in about 50 ms. At 1 GB resident memory it logs the evidence, sends SIGTERM, then SIGKILL after 10 s, and waits for launchd to respawn it, at most once an hour. SIP refuses `launchctl kickstart -k` for this service, which is why it signals. Each restart writes a `restarting` line to `~/Library/Logs/mac-watchdog/fseventsd.log` with the RSS, uptime and swap it saw, then a `restarted` line with the new pid and Docker's state. A `skip:` line says why a check could not read fseventsd.

To see where a leaking fseventsd's memory sits and which processes generate its events, the user runs `sudo zsh <skill>/scripts/fseventsd-diag.sh`. It changes nothing and writes a report into the log folder.

Docker Desktop's file sharing holds FSEvents streams, and one report says it fails after a restart. After each restart the watchdog runs `docker info` and logs `docker=ok` or `docker=FAILED`. On a failure it posts a notification to restart Docker Desktop.

## Read a freeze

1. Find when it happened. After a forced restart, `sysctl -n kern.boottime` gives the boot time, and the last sample before it is where the recorder stopped. When the user was logged out but the Mac did not restart, look for a `WindowServer_*.userspace_watchdog_timeout.spin` report and use its time. A freeze the Mac came back from shows as a large `gap=`.
2. Print the 15 minutes before it: `node <skill>/scripts/report.mjs --from <HH:MM> --to <HH:MM> --detail`, in local time, with `--day <YYYY-MM-DD>` for another day. Each line shows free memory, pressure, swap, swap in and out in MB/s, the compressor, the gap, the user's total footprint, the Claude session count and the three largest groups. `--detail` adds every large group, each process over 1.5 GB and `top`'s rows.
3. List what macOS wrote at that time: `ls -lt /Library/Logs/DiagnosticReports ~/Library/Logs/DiagnosticReports`, looking for `JetsamEvent`, `panic`, `.hang`, `.shutdownStall` and `userspace_watchdog_timeout` files.
4. Name the cause: the group or process whose footprint climbs before the freeze, and the session it belongs to, or fseventsd at several GB in `top`'s rows. Done when the cause names a process or session and the samples that show it climbing.

The report names sessions and shows command lines, so read it before sharing it.
