#!/bin/zsh
# Golden-equivalence test: the generic engine must derive exactly the states the
# bespoke Weave/Loupe Chronicle apps showed (verified by hand against both repos).
set -e
BIN="${1:-$(dirname $0)/../src-tauri/target/release/chronicle}"
[ -x "$BIN" ] || BIN="$(dirname $0)/../src-tauri/target/debug/chronicle"

"$BIN" --derive ~/Documents/weave        > /tmp/golden-weave.json
"$BIN" --derive ~/Downloads/loupe-master > /tmp/golden-loupe.json

python3 - <<'EOF'
import json, sys
w = json.load(open('/tmp/golden-weave.json'))["statuses"]
l = json.load(open('/tmp/golden-loupe.json'))["statuses"]
W = {s["id"]: (s["state"], s["label"]) for s in w}
L = {s["id"]: (s["state"], s["label"]) for s in l}
fails = []
def expect(m, k, state, label=None):
    got = m.get(k)
    if not got or got[0] != state or (label and got[1] != label):
        fails.append((k, got, (state, label)))
# weave — as of R-0 closed / R-1 dispatched (update when the build moves)
expect(W, "R-0", "done"); expect(W, "R-1", "now", "in design")
expect(W, "EL-1", "window", "when R-1 returns")
for k in ["R-2","R-9","W3a","W13","W12.7"]: expect(W, k, "later")
expect(W, "HW", "window", "ongoing")
# loupe — phases 0–4 signed, 5 current
for k in ["P0","P1","P2","P3","P4"]: expect(L, k, "done")
expect(L, "P5", "now", "up next"); expect(L, "P6", "later"); expect(L, "P7", "later")
print("GOLDEN: PASS ✓" if not fails else f"GOLDEN: FAIL {fails}")
sys.exit(1 if fails else 0)
EOF
