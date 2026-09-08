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
echo "powermetrics needs sudo; sampling ${secs}s in 5s — arrange the window now" >&2
sleep 5

tmp="$(mktemp -t chronicle-energy)"
# count distinct git processes that appear during the window (spawned by the poll)
( for _ in $(seq 1 "$secs"); do pgrep -f '^git -C' || true; sleep 1; done ) | sort -u | wc -l | tr -d ' ' > "$tmp.git" &
gitcount=$!
sudo powermetrics --samplers tasks --show-process-energy -i $((secs * 1000)) -n 1 > "$tmp" 2>/dev/null
wait "$gitcount"

# the tasks table: Name  ID  CPU ms/s  User%  Deadlines(<2ms,2-5ms)  Wakeups(Intr,PkgIdle)  GPU ms/s  Energy Impact
row="$(grep -iE '^(Chronicle|chronicle)\b' "$tmp" | head -1 || true)"
if [ -z "$row" ]; then
  echo "no Chronicle row in powermetrics output (is the process named Chronicle?)" >&2
  exit 1
fi
cpu="$(echo "$row" | awk '{print $3}')"
wake="$(echo "$row" | awk '{print $7}')"
energy="$(echo "$row" | awk '{print $NF}')"
printf '%s\t%s\t%s\t%s\t%s\n' "$label" "$cpu" "$wake" "$energy" "$(cat "$tmp.git")"
rm -f "$tmp" "$tmp.git"
