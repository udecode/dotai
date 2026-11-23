---
name: mem-log
description: Record a Mac's memory every 10 seconds, per process and per Claude Code session, from a user launchd job, so the next freeze leaves a record of what used the memory. Use to install, check or remove the recorder, after a Mac freezes or swaps hard, or to find which session or process used the memory.
---

# mem-log

A frozen Mac leaves almost nothing behind. macOS logs that memory ran out, not what used it. The recorder writes one JSON line every 10 seconds to `~/Library/Logs/mem-log/<UTC day>.jsonl`, and keeps 10 days, about 30 MB a day. Each line holds the kernel's free-memory level and pressure, swap use and swap traffic, the compressor's size, and the processes grouped by the Claude Code session or top-level program they run under, with each group's footprint. Every sixth line adds `top`'s view, which alone sees root daemons such as fseventsd and WindowServer. A `gapS` well over 10 means the recorder itself was starved.

It reads footprint, not RSS, through the small `footprint` helper it compiles, because swapped and compressed pages drop out of RSS. It names sessions from the Claude desktop app's session records.

`<skill>` is this skill's base directory.

## Install, update or remove

1. To install, or to apply an edit to `scripts/mem-log.mjs`, run `zsh <skill>/scripts/install.sh`. It needs no sudo. It copies the recorder to `~/Library/Application Support/mem-log`, compiles `footprint` with `cc`, writes `~/Library/LaunchAgents/dev.dotai.mem-log.plist` with the `node` on PATH, starts the job and prints the first sample. It refuses when another recorder already runs, and when `cc` is missing, which `xcode-select --install` fixes. Done when it prints a sample line.
2. To remove it, run `zsh <skill>/scripts/install.sh uninstall`. The logs stay.

## Check

`launchctl print gui/$(id -u)/dev.dotai.mem-log` shows the job and its last exit code, and `node <skill>/scripts/mem-report.mjs --last 3` prints the latest samples. A sample older than a minute means the job stopped. `~/Library/Logs/mem-log/stderr.log` says why, such as a `node` path that moved after a Node upgrade, which a new install fixes.

## Read a freeze

1. Find when it froze. After a forced restart, `sysctl -n kern.boottime` gives the boot time, and the last sample before it is where the recorder stopped. A freeze the Mac came back from shows as a large `gap=`.
2. Print the 15 minutes before it: `node <skill>/scripts/mem-report.mjs --from <HH:MM> --to <HH:MM> --detail`, in local time, with `--day <YYYY-MM-DD>` for another day. Each line shows free memory, pressure, swap, swap in and out in MB/s, the compressor, the gap, the user's total footprint, the Claude session count and the three largest groups. `--detail` adds every large group, each process over 1.5 GB and `top`'s rows.
3. List what macOS wrote at that time: `ls -lt /Library/Logs/DiagnosticReports ~/Library/Logs/DiagnosticReports`, looking for `JetsamEvent`, `panic`, `.hang` and `.shutdownStall` files.
4. Name the cause: the group or process whose footprint climbs before the freeze, and the session it belongs to. When `top`'s rows show fseventsd at several GB, the `fseventsd-watchdog` skill fixes it. Done when the cause names a process or session and the samples that show it climbing.

The report names sessions and shows command lines, so read it before sharing it.
