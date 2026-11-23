#!/bin/zsh
# zsh install.sh              install, or apply an edit to mem-log.mjs
# zsh install.sh uninstall    stop the recorder; its logs stay in ~/Library/Logs/mem-log
# The job runs a copy in Application Support, because the skill folder changes when the skill updates.
set -e
SRC=${0:A:h}
LABEL=dev.dotai.mem-log
HOME_DIR=${HOME:?}
DEST="$HOME_DIR/Library/Application Support/mem-log"
PLIST="$HOME_DIR/Library/LaunchAgents/$LABEL.plist"
LOGS="$HOME_DIR/Library/Logs/mem-log"
DOMAIN=gui/$(id -u)

launchctl bootout $DOMAIN/$LABEL 2>/dev/null || true
if [[ $1 == uninstall ]]; then
  rm -f "$PLIST"
  rm -rf "$DEST"
  print "uninstalled; logs kept in $LOGS"
  exit 0
fi

# Two recorders would write one log twice.
other=$(pgrep -fl 'mem-log\.mjs' | grep -vF "$DEST/" || true)
if [[ -n $other ]]; then
  print -u2 "another mem-log recorder already runs, so this one would log twice:\n$other"
  exit 1
fi

NODE=$(command -v node) || { print -u2 "node is not on PATH"; exit 1; }
command -v cc >/dev/null || { print -u2 "cc is missing: run xcode-select --install, then this again"; exit 1; }

mkdir -p "$DEST" "$LOGS" "${PLIST:h}"
cp "$SRC/mem-log.mjs" "$DEST/"
cc -O2 -o "$DEST/footprint" "$SRC/footprint.c"

# ProcessType Interactive keeps launchd from throttling the recorder while the machine struggles.
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$DEST/mem-log.mjs</string></array>
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
node "$SRC/mem-report.mjs" --last 1
