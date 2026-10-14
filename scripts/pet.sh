#!/bin/sh
# Agent Pet: a little office character that floats on your desktop (macOS). The office must be running.
#   scripts/pet.sh run        build it and start it now
#   scripts/pet.sh install    build it into ~/Applications and start it at login
#   scripts/pet.sh uninstall  stop it and remove it
# Needs swiftc from Xcode's command line tools (xcode-select --install).
set -e
DIR=$(cd "$(dirname "$0")/.." && pwd)
APP="$DIR/mac/build/Agent Pet.app"
INSTALLED="$HOME/Applications/Agent Pet.app"
LABEL=com.savvymonkeyfoo.agent-pet
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

build() {
  command -v swiftc >/dev/null || { echo "Can't find swiftc. Install Xcode's command line tools: xcode-select --install"; exit 1; }
  rm -rf "$APP"
  mkdir -p "$APP/Contents/MacOS"
  swiftc -O -parse-as-library -framework AppKit -framework WebKit "$DIR/mac/AgentPet.swift" -o "$APP/Contents/MacOS/AgentPet"
  cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Agent Pet</string>
  <key>CFBundleIdentifier</key><string>$LABEL</string>
  <key>CFBundleExecutable</key><string>AgentPet</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>LSUIElement</key><true/>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>
PLIST
  codesign --force --sign - "$APP" >/dev/null 2>&1 || true
  echo "Built $APP"
}

stop() {
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  pkill -x AgentPet 2>/dev/null || true
}

case "$1" in
  run)
    build
    pkill -x AgentPet 2>/dev/null || true
    open "$APP"
    echo "Agent Pet is on your desktop. Drag it anywhere; right-click for options."
    ;;
  install)
    build
    stop
    mkdir -p "$HOME/Applications" "$HOME/Library/LaunchAgents"
    rm -rf "$INSTALLED"
    cp -R "$APP" "$INSTALLED"
    # Starts at login. Quitting from its menu keeps it quit; if it crashes, it comes back.
    cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$INSTALLED/Contents/MacOS/AgentPet</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>30</integer>
</dict></plist>
PLIST
    for _ in 1 2 3 4 5; do launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || break; sleep 1; done
    launchctl bootstrap "gui/$(id -u)" "$PLIST" || { sleep 2; launchctl bootstrap "gui/$(id -u)" "$PLIST"; }
    echo "Agent Pet is installed and on your desktop. It starts at login; right-click it to quit."
    ;;
  uninstall)
    stop
    rm -f "$PLIST"
    rm -rf "$INSTALLED"
    echo "Agent Pet is removed."
    ;;
  *) echo "Usage: $0 run|install|uninstall"; exit 1 ;;
esac
