#!/usr/bin/env bash
# Chronicle energy baseline — samples the running Chronicle app for 60s with
# powermetrics and prints one tab-separated row. Needs sudo for powermetrics.
#
#   scripts/energy-baseline.sh idle-focused
#
# Stage the state yourself before running (see the spec §1): one project open
# and the window frontmost; the same with the window hidden (⌘H); or one
# terminal running `claude` mid-turn. The script waits 5s so you can arrange
# the window, then samples.
set -euo pipefail

label="${1:?usage: energy-baseline.sh <label>}"
secs="${SECS:-60}"
if ! pgrep -x Chronicle >/dev/null && ! pgrep -x chronicle >/dev/null; then
  echo "Chronicle isn't running — start the app (npm run tauri:dev or the .app) first" >&2
  exit 1
fi

tmp="$(mktemp -t chronicle-energy)"
trap 'rm -f "$tmp" "$tmp.git"' EXIT

# Ensure sudo password is cached before the sampling window
sudo -v

echo "powermetrics needs sudo; sampling ${secs}s in 5s — arrange the window now" >&2
sleep 5

# count distinct git processes that appear during the window (spawned by the poll)
# poll every 0.2s to get finer granularity
( end=$((SECONDS + secs)); while [ $SECONDS -lt $end ]; do pgrep -f '^git -C' || true; sleep 0.2; done ) | sort -u | wc -l | tr -d ' ' > "$tmp.git" &
gitcount=$!
sudo powermetrics --samplers tasks --show-process-energy -i $((secs * 1000)) -n 1 > "$tmp" 2>/dev/null
wait "$gitcount"

# the tasks table: Name  ID  CPU ms/s  User%  Deadlines(<2ms,2-5ms)  Wakeups(Intr,PkgIdle)  GPU ms/s  Energy Impact
# Fields are indexed right-to-left (from $NF backwards) because the Name column (first, may contain spaces) has variable width.
# A single-word name (like "Chronicle" or "git") means NF is consistent; multi-word names (like "Chronicle Helper") have more fields.
# Energy Impact ($NF), GPU ms/s $(NF-1), Wakeups Intr $(NF-3), CPU ms/s $(NF-7)
echo "powermetrics columns (check the layout once):" >&2
grep -m1 -E '^Name\s+ID\s+CPU ms/s' "$tmp" >&2 || true

# Parse powermetrics output using one awk pass for all three values
# Matches app row with case-insensitive first field "chronicle" and single token name (NF==9)
# Sums git children's CPU, handles error if no app row found
read -r cpu wake energy < <(awk '
  tolower($1) == "chronicle" && NF == 9 && !seen { app_cpu = $(NF-7); wake = $(NF-3); energy = $NF; seen = 1 }
  $1 == "git" && NF == 9 { git_cpu += $(NF-7) }
  END { if (!seen) { exit 1 } printf "%.2f %s %s\n", app_cpu + git_cpu, wake, energy }
' "$tmp") || { echo "couldn't find Chronicle in the powermetrics table — is the app running under the name 'Chronicle'?" >&2; exit 1; }

printf '%s\t%s\t%s\t%s\t%s\n' "$label" "$cpu" "$wake" "$energy" "$(cat "$tmp.git")"
