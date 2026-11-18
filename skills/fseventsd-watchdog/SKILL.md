---
name: fseventsd-watchdog
description: Restart macOS fseventsd when its memory leak passes 1 GB, from a root launchd job. Use when fseventsd holds GBs of memory, a Mac with many worktrees swaps or freezes, or to install, check or remove the watchdog.
---

# fseventsd watchdog

macOS 15.6 to 27.x has an fseventsd leak. The sweeper that prunes its event table keeps its place in a 32-bit counter, which stops advancing after about 8.4 million runs. Once the table is at its 262,144-bucket maximum, every newly changed path leaks about 350 bytes, lookups slow down, and event delivery can stop without an error. Apple budgets fseventsd 30 MB. A leaking one reaches tens of GB within days on a Mac that installs `node_modules` into many worktrees, each about 170,000 new paths. Turning Spotlight off and `no_log` files do not stop it. A restart does, because a fresh fseventsd starts with a small table. Sources: Hixie/contraptions fseventsd-watchdog, Apple developer forums thread 849819, anthropics/claude-code#98769.

The watchdog checks fseventsd every 2 minutes, in about 50 ms. At 1 GB resident memory it logs the evidence, sends SIGTERM, then SIGKILL after 10 s, and waits for launchd to respawn it, at most once an hour. SIP refuses `launchctl kickstart -k` for this service, which is why it signals.

## Check

1. Read fseventsd's memory: `ps -axo pid=,rss=,etime=,comm= | grep '/fseventsd$'`. RSS is in KB. A healthy fseventsd stays under 200 MB, and the leak is over 1 GB. RSS undercounts a leak that has swapped out.
2. Read `~/Library/Logs/fseventsd-watchdog.log`. Each restart writes a `restarting` line with the RSS, uptime and swap it saw, then a `restarted` line with the new pid and Docker's state. A `skip:` line says why a check could not read fseventsd. No log file means no restart was needed.
3. Confirm the job is loaded: `launchctl print system/dev.dotai.fseventsd-watchdog` prints it with its last exit code.

## Install, update or remove

The installer needs root, so the user runs it. Give them the command.

1. To install, or to apply an edit to `scripts/watchdog.sh`, run `sudo zsh <this skill>/scripts/install.sh`. It copies the watchdog to `/usr/local/sbin` as root-owned, writes `/Library/LaunchDaemons/dev.dotai.fseventsd-watchdog.plist` for the user who ran `sudo`, starts the job, waits for its first check, then prints the log, fseventsd's memory and the leak's onset line from the last 7 days (`event table has grown too large`).
2. To remove it, run `sudo zsh <this skill>/scripts/install.sh uninstall`.

## Docker Desktop

Docker Desktop's file sharing holds FSEvents streams, and one report says it fails after a restart. After each restart the watchdog runs `docker info` and logs `docker=ok` or `docker=FAILED`. On a failure it posts a notification to restart Docker Desktop.
