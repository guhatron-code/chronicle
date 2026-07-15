#!/bin/bash
# One-command Chronicle release: signed + notarized + OTA-capable.
#   ./release.sh 0.2.3 "One-line release notes"
# Needs .sign.env (Apple + updater keys) beside this script.
set -euo pipefail
cd "$(dirname "$0")"

VERSION="${1:?usage: ./release.sh <version> \"<notes>\"}"
NOTES="${2:?usage: ./release.sh <version> \"<notes>\"}"
TAG="v$VERSION"

# 1 · version stamps (both files must agree)
python3 - "$VERSION" <<'PYEOF'
import json, re, sys
v = sys.argv[1]
for p in ['package.json', 'src-tauri/tauri.conf.json']:
    s = open(p).read()
    s = re.sub(r'"version": "[0-9.]+"', f'"version": "{v}"', s, count=1)
    open(p, 'w').write(s)
PYEOF

# 2 · signed + notarized build with updater artifacts
source .sign.env
PATH="$HOME/.cargo/bin:$PATH" npm run tauri:build

APP_DIR="src-tauri/target/release/bundle/macos"
DMG="src-tauri/target/release/bundle/dmg/Chronicle_${VERSION}_aarch64.dmg"
TARBALL="$APP_DIR/Chronicle.app.tar.gz"
SIG="$APP_DIR/Chronicle.app.tar.gz.sig"
test -f "$DMG" && test -f "$TARBALL" && test -f "$SIG"

# 3 · Gatekeeper must accept before anything ships
spctl -a "$APP_DIR/Chronicle.app"

# 4 · the OTA manifest — the updater polls releases/latest/download/latest.json
python3 - "$VERSION" "$NOTES" "$SIG" <<'PYEOF'
import json, sys, datetime
v, notes, sig = sys.argv[1], sys.argv[2], sys.argv[3]
manifest = {
    "version": v,
    "notes": notes,
    "pub_date": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "platforms": {
        "darwin-aarch64": {
            "signature": open(sig).read().strip(),
            "url": f"https://github.com/guhatron-code/chronicle/releases/download/v{v}/Chronicle.app.tar.gz",
        }
    },
}
json.dump(manifest, open("src-tauri/target/release/bundle/latest.json", "w"), indent=2)
PYEOF

# 5 · commit the stamps, tag, push, release
git add package.json src-tauri/tauri.conf.json
git commit -q -m "chore: v$VERSION" || true
git push -q . "$(git branch --show-current)":main || true
git push -q origin main "$(git branch --show-current)" || true
git tag "$TAG" main
git push -q origin "$TAG"
gh release create "$TAG" --title "Chronicle $VERSION" --notes "$NOTES" \
  "$DMG" "$TARBALL" "$SIG" "src-tauri/target/release/bundle/latest.json"

echo "Released $TAG — installed copies will see it on their next daily check."
