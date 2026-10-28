#!/bin/sh
# Installs the videotools engine into ~/.videotools and starts it; on macOS it
# also starts at login from then on. Run again to update.
#
#   curl -fsSL https://videotools-client.vercel.app/install.sh | sh
set -eu

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) key=darwin-arm64 ;;
  Darwin-x86_64) key=darwin-x64 ;;
  Linux-x86_64) key=linux-x64 ;;
  *) echo "There is no videotools engine for $(uname -s) $(uname -m)." >&2; exit 1 ;;
esac

dir="$HOME/.videotools"
mkdir -p "$dir"
pkill -x videotools-engine 2>/dev/null || true
echo "Downloading the videotools engine..."
curl -fL --progress-bar -o "$dir/videotools-engine" \
  "https://github.com/sebastiangraz/videotools/releases/download/engine/videotools-engine-$key"
chmod +x "$dir/videotools-engine"

if [ "$key" = linux-x64 ]; then
  (cd "$dir" && nohup ./videotools-engine >engine.log 2>&1 &)
  echo "The videotools engine is running (log: $dir/engine.log). Back to the browser!"
  exit 0
fi

# Apple silicon runs nothing unsigned; an ad-hoc signature is enough.
codesign --force --sign - "$dir/videotools-engine" 2>/dev/null || true
plist="$HOME/Library/LaunchAgents/io.graz.videotools-engine.plist"
mkdir -p "$(dirname "$plist")"
cat >"$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>io.graz.videotools-engine</string>
  <key>ProgramArguments</key><array><string>$dir/videotools-engine</string></array>
  <key>WorkingDirectory</key><string>$dir</string>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$dir/engine.log</string>
  <key>StandardErrorPath</key><string>$dir/engine.log</string>
</dict>
</plist>
EOF
launchctl bootout "gui/$(id -u)" "$plist" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$plist"
echo "The videotools engine is running and starts at login (log: $dir/engine.log). Back to the browser!"
