#!/bin/zsh
# Golden test — HERMETIC. Builds a throwaway fixture repo exercising every condition
# type, derives it with the real binary, and asserts every phase's state AND label.
# Also asserts the error exit code and the can't-be-checked warnings.
# The legacy live check against the real weave repo runs ONLY if that folder exists
# (clearly labeled optional at the end).
set -e

BIN="${1:-$(dirname $0)/../src-tauri/target/release/chronicle}"
[ -x "$BIN" ] || BIN="$(dirname $0)/../src-tauri/target/debug/chronicle"
BIN="${BIN:A}" # absolute — the script cds into the fixture
if [ ! -x "$BIN" ]; then
  echo "GOLDEN: FAIL — no chronicle binary (build with: cargo build --manifest-path src-tauri/Cargo.toml)" >&2
  exit 1
fi

FIX="$(mktemp -d /tmp/chronicle-golden.XXXXXX)"
trap 'rm -rf "$FIX" "$FIX-side"' EXIT
cd "$FIX"

# ---- the fixture repo ----
git init -q -b main .
git -c user.email=t@t -c user.name=t commit -q --allow-empty -m "feat: phase-2 signed off"
git tag phase-1
mkdir -p reports docs
printf 'Status: **CLOSED**\n' > reports/P3_REPORT.md
printf 'handoff bundle\n' > docs/design-handoff.md
git add -A && git -c user.email=t@t -c user.name=t commit -q -m "docs: fixture files"
git worktree add -q -b side "$FIX-side" >/dev/null 2>&1

cat > chronicle.json <<'JSON'
{
  "chronicleVersion": 1,
  "name": "golden-fixture",
  "description": "hermetic fixture exercising every condition type",
  "roots": { "repo": "." },
  "stages": [ { "title": "All rules", "phases": [
    { "id": "T1", "name": "tag rule",
      "status": { "done_when": [ { "tag": "phase-1" } ] } },
    { "id": "T2", "name": "commit_subject rule",
      "status": { "done_when": [ { "commit_subject": "(?i)phase-2 signed" } ] } },
    { "id": "T3", "name": "file_matches rule",
      "status": { "done_when": [ { "file_matches": { "path": "reports/P3_REPORT.md", "pattern": "^Status: \\*\\*CLOSED\\*\\*" } } ] } },
    { "id": "T4", "name": "file_glob rule",
      "status": { "done_when": [ { "file_glob": { "dir": "docs", "contains": "handoff" } } ] } },
    { "id": "T5", "name": "current with label",
      "status": { "done_when": [ { "tag": "never-a-tag" } ],
                  "current_labels": [ { "when": [ { "worktree_branch": "side" } ], "label": "in a side workspace" } ],
                  "default_label": "should not be used" } },
    { "id": "T6", "name": "negation holds it open",
      "status": { "done_when": [ { "file_exists": "reports/P3_REPORT.md", "not": true } ] } },
    { "id": "W1", "name": "a window", "window": true,
      "status": { "done_when": [ { "tag": "never" } ], "default_label": "running alongside" } },
    { "id": "POOL1", "name": "ideas", "pool": true }
  ] } ],
  "actions": [
    { "text": "Always-on row — omitted when means always." },
    { "when": [ { "worktree_branch": "side" } ], "text": "Side workspace exists — clean it up later." }
  ]
}
JSON

"$BIN" --derive "$FIX" > derive.json
python3 - "$FIX" <<'EOF'
import json, sys
d = json.load(open(sys.argv[1] + "/derive.json"))
S = {s["id"]: (s["state"], s["label"]) for s in d["statuses"]}
fails = []
def expect(k, state, label=None):
    got = S.get(k)
    if not got or got[0] != state or (label is not None and got[1] != label):
        fails.append((k, got, (state, label)))
# every condition type derives done
for k in ["T1", "T2", "T3", "T4"]: expect(k, "done", "done")
# the first not-done phase is now, with the worktree-driven label
expect("T5", "now", "in a side workspace")
# negated existing file = not done => later (T5 already took "now")
expect("T6", "later", "later")
expect("W1", "window", "running alongside")
expect("POOL1", "pool", "ideas")
if d.get("warnings"): fails.append(("warnings-should-be-empty", d["warnings"], []))
if fails:
    print(f"GOLDEN(fixture): FAIL {fails}"); sys.exit(1)
print("GOLDEN(fixture): PASS ✓  (8 phases, every condition type + labels)")
EOF

# ---- warnings + error exit ----
printf '{ "chronicleVersion": 1, "name": "warnfix", "stages": [ { "phases": [ { "id": "X", "status": { "done_when": [ { "file_exist": "typo.md" } ] } } ] } ] }' > chronicle.json
"$BIN" --derive "$FIX" > warn.json
python3 - "$FIX" <<'EOF'
import json, sys
w = json.load(open(sys.argv[1] + "/warn.json")).get("warnings", [])
assert any("exactly one known rule key" in x for x in w), f"typo rule not flagged: {w}"
print("GOLDEN(warnings): PASS ✓  (typo rule surfaced)")
EOF
rm chronicle.json
if "$BIN" --derive "$FIX" >/dev/null 2>&1; then
  echo "GOLDEN(exit): FAIL — --derive returned 0 for a missing manifest"; exit 1
fi
echo "GOLDEN(exit): PASS ✓  (missing manifest exits non-zero)"

# ---- optional: the live weave repo, when present on this machine ----
if [ -f ~/Documents/weave/chronicle.json ]; then
  "$BIN" --derive ~/Documents/weave > /tmp/golden-weave.json
  python3 - <<'EOF'
import json
w = {s["id"]: (s["state"], s["label"]) for s in json.load(open("/tmp/golden-weave.json"))["statuses"]}
assert w.get("R-0", ("", ""))[0] == "done", f'weave R-0: {w.get("R-0")}'
print("GOLDEN(live-weave, optional): PASS ✓")
EOF
fi
echo "GOLDEN: ALL PASS ✓"
