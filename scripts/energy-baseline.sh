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
# Energy Impact ($NF), GPU ms/s $(NF-1), Wakeups Pkg idle $(NF-2), Wakeups Intr $(NF-3),
# Deadlines 2-5ms $(NF-4), Deadlines <2ms $(NF-5), User% $(NF-6), CPU ms/s $(NF-7), ID $(NF-8)
echo "powermetrics columns (check the layout once):" >&2
grep -m1 -E '^Name\s+ID\s+CPU ms/s' "$tmp" >&2 || true

# Parse powermetrics output using right-anchored fields
# cpu = sum of Chronicle's CPU ms/s and all git children's CPU ms/s
cpu="$(awk '
  /^Chronicle[[:space:]]/ { cpu_chronicle = $(NF-7) }
  /^git[[:space:]]/ { cpu_git += $(NF-7) }
  END {
    printf "%.2f", (cpu_chronicle + cpu_git)
  }
' "$tmp")"

# wake = Chronicle's interrupt wakeups per second
wake="$(awk '/^Chronicle[[:space:]]/ { print $(NF-3); exit }' "$tmp")"

# energy = Chronicle's energy impact
energy="$(awk '/^Chronicle[[:space:]]/ { print $NF; exit }' "$tmp")"

if [ -z "$cpu" ] || [ -z "$wake" ] || [ -z "$energy" ]; then
  echo "couldn't find Chronicle in the powermetrics table — is the app running under the name 'Chronicle'?" >&2
  exit 1
fi

printf '%s\t%s\t%s\t%s\t%s\n' "$label" "$cpu" "$wake" "$energy" "$(cat "$tmp.git")"
