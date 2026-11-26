#!/bin/zsh
# zsh install.sh              install the recorder and runaway guard, or apply an edit to recorder.mjs
# zsh install.sh uninstall    stop them; the logs stay in ~/Library/Logs/mac-watchdog
# MAC_WATCHDOG_KILL_GB=64 zsh install.sh   sets the kill limit; 0 turns the guard off
# The job runs a copy in Application Support, because the skill folder changes when the skill updates.
set -e
SRC=${0:A:h}
LABEL=dev.ustack.mac-watchdog
HOME_DIR=${HOME:?}
DEST="$HOME_DIR/Library/Application Support/mac-watchdog"
PLIST="$HOME_DIR/Library/LaunchAgents/$LABEL.plist"
LOGS="$HOME_DIR/Library/Logs/mac-watchdog"
DOMAIN=gui/$(id -u)

launchctl bootout $DOMAIN/$LABEL 2>/dev/null || true
if [[ $1 == uninstall ]]; then
  rm -f "$PLIST"
  rm -rf "$DEST"
  print "uninstalled; logs kept in $LOGS"
  exit 0
fi

# Remove prior label names so two jobs never log twice.
launchctl bootout $DOMAIN/dev.dotai.mac-watchdog 2>/dev/null || true
rm -f "$HOME_DIR/Library/LaunchAgents/dev.dotai.mac-watchdog.plist"
launchctl bootout $DOMAIN/dev.dotai.mem-log 2>/dev/null || true
rm -f "$HOME_DIR/Library/LaunchAgents/dev.dotai.mem-log.plist"
rm -rf "$HOME_DIR/Library/Application Support/mem-log"
[[ -d $HOME_DIR/Library/Logs/mem-log && ! -e $LOGS ]] && mv "$HOME_DIR/Library/Logs/mem-log" "$LOGS"

# Two recorders would write one log twice.
other=$(pgrep -fl 'mem-log\.mjs|recorder\.mjs' | grep -vF "$DEST/" || true)
if [[ -n $other ]]; then
  print -u2 "another recorder already runs, so this one would log twice; stop its launchd job first:\n$other"
  exit 1
fi

NODE=$(command -v node) || { print -u2 "node is not on PATH"; exit 1; }
command -v cc >/dev/null || { print -u2 "cc is missing: run xcode-select --install, then this again"; exit 1; }

mkdir -p "$DEST" "$LOGS" "${PLIST:h}"
cp "$SRC/recorder.mjs" "$DEST/"
cc -O2 -o "$DEST/footprint" "$SRC/footprint.c"

ENV=
[[ -n ${MAC_WATCHDOG_KILL_GB+x} ]] && ENV="<key>EnvironmentVariables</key><dict><key>MAC_WATCHDOG_KILL_GB</key><string>$MAC_WATCHDOG_KILL_GB</string></dict>"
# ProcessType Interactive keeps launchd from throttling the recorder while the machine struggles.
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$DEST/recorder.mjs</string></array>
  $ENV
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>$LOGS/stdout.log</string>
  <key>StandardErrorPath</key><string>$LOGS/stderr.log</string>
</dict>
</plist>
EOF
launchctl bootstrap $DOMAIN "$PLIST"

print "installed; waiting for the first sample..."
today=$(date -u +%F)
for _ in {1..20}; do
  sleep 1
  [[ -s $LOGS/$today.jsonl ]] && break
done
node "$SRC/report.mjs" --last 1
launchctl print system/dev.ustack.mac-watchdog.fseventsd >/dev/null 2>&1 || print "the fseventsd watchdog is not installed; it needs root: sudo zsh $SRC/install-fseventsd.sh"
