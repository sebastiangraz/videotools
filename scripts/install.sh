#!/bin/sh
# Fetches the videotools engine and opens it; it moves into ~/.videotools,
# starts, and on macOS starts at login from then on. Run again to update.
#
#   curl -fsSL https://raw.githubusercontent.com/sebastiangraz/videotools/main/scripts/install.sh | sh
#
# The site shows this with the commit it was built from in place of main.
set -eu

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) key=darwin-arm64 ;;
  Darwin-x86_64) key=darwin-x64 ;;
  Linux-x86_64) key=linux-x64 ;;
  *) echo "There is no videotools engine for $(uname -s) $(uname -m)." >&2; exit 1 ;;
esac

engine="$(mktemp -d)/videotools-engine"
echo "Downloading the videotools engine..."
curl -fL --progress-bar -o "$engine" \
  "https://github.com/sebastiangraz/videotools/releases/download/engine/videotools-engine-$key"
chmod +x "$engine"
# Apple silicon runs nothing unsigned; an ad-hoc signature is enough.
[ "$key" = linux-x64 ] || codesign --force --sign - "$engine" 2>/dev/null || true
"$engine"
rm -rf "$(dirname "$engine")"
echo "Back to the browser!"
