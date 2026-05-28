#!/bin/bash
# Replace /Applications/AWSsist.app with the freshly built bundle and relaunch.
#
# Keeps macOS LaunchServices, Launchpad, Spotlight, and the Dock pointed at a
# single canonical install path — running `open dist/mac-arm64/AWSsist.app`
# after every rebuild would otherwise register a second copy.
set -euo pipefail

SRC="dist/mac-arm64/AWSsist.app"
DEST="/Applications/AWSsist.app"

if [ ! -d "$SRC" ]; then
  echo "error: $SRC does not exist — run a build first (e.g. npm run dist:mac)" >&2
  exit 1
fi

# Make sure the running instance is gone before we replace its on-disk bundle.
pkill -9 -f "AWSsist.app/Contents/MacOS" >/dev/null 2>&1 || true
sleep 1

echo "→ removing $DEST"
rm -rf "$DEST"

echo "→ copying $SRC → $DEST"
cp -R "$SRC" "$DEST"

# Strip any quarantine attribute Gatekeeper may have stamped on. Harmless if
# nothing's set; vital for unsigned dev builds copied from a download path.
xattr -cr "$DEST" >/dev/null 2>&1 || true

# Drop any LaunchServices record pointing at the dev path so it doesn't accumulate
# as a phantom duplicate next to /Applications/AWSsist.app in Launchpad/Spotlight.
LS=/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister
if [ -x "$LS" ]; then
  "$LS" -u "$PWD/$SRC" >/dev/null 2>&1 || true
fi

# Detach any leftover DMG mount from electron-builder's verification step.
hdiutil detach -quiet "/Volumes/AWSsist 0.1.0-arm64" >/dev/null 2>&1 || true

echo "→ launching $DEST"
open "$DEST"

echo "✔ installed."
