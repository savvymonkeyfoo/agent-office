#!/bin/sh
# Runs Agent Office (cloud mode) in the background on macOS: starts at login, restarts if it stops.
#   scripts/launch-agent.sh install    set it up and start it now
#   scripts/launch-agent.sh uninstall  stop it and remove it
# Logs: ~/Library/Logs/agent-office.log
set -e
LABEL=com.savvymonkeyfoo.agent-office
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DIR=$(cd "$(dirname "$0")/.." && pwd)
NODE=$(command -v node)
# The office runs `claude auth status` to renew your login, so launchd needs claude on its PATH too.
CLAUDE_DIR=$(dirname "$(command -v claude || echo /usr/bin/claude)")
LOG="$HOME/Library/Logs/agent-office.log"

case "$1" in
  install)
    [ -n "$NODE" ] || { echo "Can't find node on your PATH."; exit 1; }
    mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
    cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$DIR/bin/agent-office.js</string></array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>EnvironmentVariables</key><dict>
    <key>CLOUD</key><string>1</string>
    <key>NODE_OPTIONS</key><string>--use-system-ca</string>
    <key>PATH</key><string>$(dirname "$NODE"):$CLAUDE_DIR:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict></plist>
PLIST
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    # bootout returns before the old copy has fully stopped; bootstrap then fails with "5: Input/output error".
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || break
      sleep 1
    done
    launchctl bootstrap "gui/$(id -u)" "$PLIST" || { sleep 2; launchctl bootstrap "gui/$(id -u)" "$PLIST"; }
    echo "Agent Office now runs in the background at http://127.0.0.1:4321 (log: $LOG)"
    ;;
  uninstall)
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "Agent Office no longer runs in the background."
    ;;
  *) echo "Usage: $0 install|uninstall"; exit 1 ;;
esac
