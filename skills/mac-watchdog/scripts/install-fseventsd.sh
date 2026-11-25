#!/bin/zsh
# sudo zsh install-fseventsd.sh              install, or apply an edit to fseventsd.sh
# sudo zsh install-fseventsd.sh uninstall
# The watchdog is copied to a root-owned path, because a root job must never run a file a user can edit.
set -e
[[ $EUID -ne 0 ]] && { print "run with sudo"; exit 1; }
USER_NAME=${SUDO_USER:?run with sudo from your own account}
SRC=${0:A:h}
LABEL=dev.dotai.mac-watchdog.fseventsd
PLIST=/Library/LaunchDaemons/$LABEL.plist
BIN=/usr/local/sbin/mac-watchdog-fseventsd
HOME_DIR=$(dscl . -read "/Users/$USER_NAME" NFSHomeDirectory | sed 's/^NFSHomeDirectory: //')
LOGS=$HOME_DIR/Library/Logs/mac-watchdog
LOG=$LOGS/fseventsd.log

launchctl bootout system/$LABEL 2>/dev/null || true
# This watchdog was the fseventsd-watchdog skill before; two would restart fseventsd twice.
launchctl bootout system/dev.dotai.fseventsd-watchdog 2>/dev/null || true
rm -f /Library/LaunchDaemons/dev.dotai.fseventsd-watchdog.plist /usr/local/sbin/fseventsd-watchdog
if [[ $1 == uninstall ]]; then
  rm -f "$PLIST" "$BIN"
  print "uninstalled"
  exit 0
fi

mkdir -p "$LOGS"
chown "$USER_NAME" "$LOGS"
[[ -f $HOME_DIR/Library/Logs/fseventsd-watchdog.log && ! -e $LOG ]] && mv "$HOME_DIR/Library/Logs/fseventsd-watchdog.log" "$LOG"
mkdir -p /usr/local/sbin
install -o root -g wheel -m 755 "$SRC/fseventsd.sh" "$BIN"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/zsh</string><string>$BIN</string><string>$USER_NAME</string></array>
  <key>StartInterval</key><integer>120</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardErrorPath</key><string>/var/log/mac-watchdog-fseventsd.err</string>
</dict>
</plist>
EOF
chown root:wheel "$PLIST"
chmod 644 "$PLIST"
launchctl bootstrap system "$PLIST"

print "installed; waiting for the first check (a restart takes up to a minute)..."
for _ in {1..70}; do
  sleep 1
  launchctl print system/$LABEL 2>/dev/null | grep -q 'state = running' || break
done
print "fseventsd watchdog log:"
tail -5 "$LOG" 2>/dev/null || print "(empty: fseventsd is under the limit)"
pid=$(launchctl print system/com.apple.fseventsd | sed -nE 's/^[[:blank:]]pid = ([0-9]+)$/\1/p')
print "fseventsd now: pid=$pid rss=$(( $(ps -o rss= -p "$pid") / 1024 ))MB uptime=$(ps -o etime= -p "$pid" | tr -d ' ')"
print "the leak's onset line in the last 7 days:"
log show --last 7d --style compact --predicate 'process == "fseventsd" AND eventMessage CONTAINS "grown too large"' 2>/dev/null | tail -2
