#!/bin/zsh
# Restarts fseventsd when its resident memory passes LIMIT_MB, working around the macOS 15.6 to 27.x
# sweeper leak the fseventsd-watchdog skill describes. install.sh runs it as root every 2 minutes
# and passes the user whose log and notifications it uses: watchdog.sh <user>
LIMIT_MB=1024
MIN_GAP_S=3600
USER_NAME=$1
[[ -n $USER_NAME ]] || { print -u2 "usage: watchdog.sh <user>"; exit 1; }
HOME_DIR=$(dscl . -read "/Users/$USER_NAME" NFSHomeDirectory | sed 's/^NFSHomeDirectory: //')
LOG=$HOME_DIR/Library/Logs/fseventsd-watchdog.log
STAMP=/var/run/fseventsd-watchdog.last
BIN=/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/FSEvents.framework/Versions/A/Support/fseventsd

log() {
  print -r -- "$(date '+%F %T') $*" >> "$LOG"
  chown "$USER_NAME" "$LOG" 2>/dev/null
}
# to <secs> <cmd...>: macOS has no timeout(1), and launchctl or docker can hang while the machine thrashes.
to() { local s=$1; shift; /usr/bin/perl -e 'alarm shift; exec @ARGV' "$s" "$@"; }

# The pid launchd runs as com.apple.fseventsd, and only if it is still the root-owned system binary
# (guards against pid reuse between the check and the signal).
launchd_pid() { to 15 launchctl print system/com.apple.fseventsd 2>/dev/null | sed -nE 's/^[[:blank:]]pid = ([0-9]+)$/\1/p'; }
is_fseventsd() { [[ "$(ps -o uid=,comm= -p "$1" 2>/dev/null | sed -E 's/^ *//')" == "0 $BIN" ]]; }
# Resident memory, not footprint: as root under launchd, `top -l 1` walks every process and ran past
# 15 s. RSS undercounts a swapped-out leak (19 GB RSS at 44 GB footprint) but is far over the limit
# whenever the leak is running.
rss_mb() {
  local kb
  kb=$(ps -o rss= -p "$1" 2>/dev/null | tr -d ' ')
  [[ $kb == <-> ]] && print $(( kb / 1024 ))
}
notify() {
  launchctl asuser "$(id -u "$USER_NAME")" sudo -u "$USER_NAME" osascript -e "display notification \"$1\" with title \"fseventsd watchdog\"" 2>/dev/null
}

pid=$(launchd_pid)
if [[ -z $pid ]]; then
  log "skip: launchd reports no fseventsd pid"
  exit 0
fi
if ! is_fseventsd "$pid"; then
  log "skip: pid=$pid is not the system fseventsd ($(ps -o uid=,comm= -p "$pid" 2>/dev/null))"
  exit 0
fi
mb=$(rss_mb "$pid")
if [[ -z $mb ]]; then
  log "skip: cannot read memory of pid=$pid"
  exit 0
fi
(( mb >= LIMIT_MB )) || exit 0

now=$(date +%s)
last=$(cat "$STAMP" 2>/dev/null || print 0)
if (( now - last < MIN_GAP_S )); then
  log "over limit pid=$pid rss=${mb}MB but last restart was $(( now - last ))s ago; waiting"
  exit 0
fi
print "$now" > "$STAMP"

# Evidence first: a restart wipes the state that shows what happened.
log "restarting pid=$pid rss=${mb}MB uptime=$(ps -o etime= -p "$pid" | tr -d ' ') history_files=$(ls /System/Volumes/Data/.fseventsd 2>/dev/null | wc -l | tr -d ' ') swap=\"$(sysctl -n vm.swapusage)\""

# SIP refuses `launchctl kickstart -k` for this service, so signal it and let launchd respawn it.
kill -TERM "$pid"
for _ in {1..10}; do is_fseventsd "$pid" || break; sleep 1; done
if is_fseventsd "$pid"; then
  log "pid=$pid ignored SIGTERM for 10s; sending SIGKILL"
  kill -KILL "$pid"
fi
# launchd throttles respawns after a SIGKILL, so allow it up to 30 s.
new=
for _ in {1..30}; do
  sleep 1
  new=$(launchd_pid)
  [[ -n $new && $new != "$pid" ]] && break
  new=
done
if [[ -z $new ]]; then
  log "ERROR no new fseventsd after 30s; check: launchctl print system/com.apple.fseventsd"
  notify "fseventsd did not come back after a restart. Check the watchdog log."
  exit 1
fi

# Docker Desktop's file sharing holds FSEvents streams, and one report says it fails after a
# restart (RuslanTar/fseventsd-guard), so check it and say so if it broke.
docker=skipped
if pgrep -xq com.docker.backend; then
  docker=no-cli
  for cli in /usr/local/bin/docker "$HOME_DIR/.docker/bin/docker"; do
    [[ -x $cli ]] || continue
    if to 20 sudo -u "$USER_NAME" "$cli" info >/dev/null 2>&1; then docker=ok; else docker=FAILED; fi
    break
  done
fi
log "restarted new_pid=$new freed≈${mb}MB docker=$docker"
if [[ $docker == FAILED ]]; then
  notify "Restarted fseventsd (freed ${mb} MB) but Docker stopped answering. Restart Docker Desktop."
else
  notify "Restarted fseventsd, freed ${mb} MB."
fi
