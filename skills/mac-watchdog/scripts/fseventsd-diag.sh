#!/bin/zsh
# Read-only diagnosis of fseventsd memory. Run once: sudo zsh fseventsd-diag.sh
# Changes nothing. vmmap pauses fseventsd for a few seconds while it reads the memory map.
[[ $EUID -ne 0 ]] && { print "run with sudo"; exit 1; }
USER_NAME=${SUDO_USER:?run with sudo from your own account}
LOGS=$(dscl . -read "/Users/$USER_NAME" NFSHomeDirectory | sed 's/^NFSHomeDirectory: //')/Library/Logs/mac-watchdog
mkdir -p "$LOGS"
OUT=$LOGS/fseventsd-diag-$(date +%Y%m%d-%H%M%S).txt
PID=$(pgrep -x fseventsd | head -1)
exec > "$OUT" 2>&1

section() { print "\n===== $1"; }

section "fseventsd pid=$PID"
ps -o pid=,etime=,lstart=,rss= -p "$PID"

section "persistent event log (/System/Volumes/Data/.fseventsd)"
du -sh /System/Volumes/Data/.fseventsd
ls -la /System/Volumes/Data/.fseventsd | tail -5
ls /System/Volumes/Data/.fseventsd | wc -l

section "memory map summary (where the footprint sits)"
vmmap -summary "$PID" | sed -n '/^Physical footprint/,/^Writable regions/p;/REGION TYPE/,/^TOTAL/p;/MALLOC ZONE/,/^TOTAL/p'

section "open files (count and non-system ones)"
lsof -p "$PID" | wc -l
lsof -p "$PID" | awk 'NR>1 && $NF !~ /^\/(System|usr|dev|private\/var\/db)/' | head -30

section "fseventsd log, last 3h (errors, drops, clients)"
log show --last 3h --style compact --predicate 'process == "fseventsd"' 2>/dev/null \
  | grep -iE 'error|fail|drop|overflow|client|queue|limit|memory|too many' | tail -80

section "file-system calls by process, 15 s sample (who generates events)"
fs_usage -w -f filesys -t 15 2>/dev/null \
  | awk '/ (write|pwrite|WrData|rename|renameat|unlink|unlinkat|mkdir|mkdirat|rmdir|symlink|symlinkat|link|linkat|truncate|ftruncate|chmod|fchmod|setattrlist|fsetattrlist|utimes|futimes|clonefile|clonefileat|exchangedata)/ {
      p = $NF; sub(/\.[0-9]+$/, "", p); n[p]++
    } END { for (k in n) print n[k], k }' \
  | sort -rn | head -30

chmod 644 "$OUT"
chown "$USER_NAME" "$LOGS" "$OUT"
print "wrote $OUT" > /dev/tty
