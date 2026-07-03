#!/bin/zsh

set -euo pipefail

ROOT="${0:A:h:h}"
CONFIGURATION="${1:-release}"
APP_NAME="Activity Probe"
APP="$ROOT/build/$APP_NAME.app"
EXECUTABLE="$ROOT/.build/$CONFIGURATION/activity-probe"

cd "$ROOT"
swift build -c "$CONFIGURATION"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
mkdir -p "$APP/Contents/Resources/Dashboard/static"

ditto "$EXECUTABLE" "$APP/Contents/MacOS/activity-probe"
ditto "$ROOT/App/Info.plist" "$APP/Contents/Info.plist"
ditto "$ROOT/dashboard/server.py" "$APP/Contents/Resources/Dashboard/server.py"
ditto "$ROOT/dashboard/static" "$APP/Contents/Resources/Dashboard/static"

codesign --force --deep --sign - "$APP"

echo "$APP"
