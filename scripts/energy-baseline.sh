#!/usr/bin/env bash
# Chronicle energy baseline — samples the running Chronicle app for 60s and
# prints one tab-separated row:
#
#   label  cpu_ms_per_s  wakeups_per_s  energy_impact  git_children_seen
#
#   scripts/energy-baseline.sh idle-focused
#
# Two ways to sample. With sudo available, `powermetrics` gives CPU ms/s
# (app + git children), interrupt wakeups/s and Energy Impact. Without it
# (no tty, or MODE=top), `top` gives the app's %CPU over the window and its
# idle wakeups/s; Energy Impact is then "n/a" and git children's CPU is not
# folded in (they are still counted).
#
# Stage the state yourself before running (see the spec §1): one project open
# and the window frontmost; the same with the window hidden (⌘H); or one
# terminal running `claude` mid-turn. The script waits 5s so you can arrange
# the window, then samples.
set -euo pipefail

label="${1:?usage: energy-baseline.sh <label>}"
secs="${SECS:-60}"
# PID=<pid> picks one instance when several are running (e.g. the installed app
# next to a freshly built binary); otherwise the first Chronicle process wins.
pid="${PID:-}"
[ -n "$pid" ] || pid="$(pgrep -x Chronicle | head -1 || true)"
[ -n "$pid" ] || pid="$(pgrep -x chronicle | head -1 || true)"
if [ -z "$pid" ]; then
  echo "Chronicle isn't running — start the app (npm run tauri:dev or the .app) first" >&2
  exit 1
fi

tmp="$(mktemp -t chronicle-energy)"
trap 'rm -f "$tmp" "$tmp.git"' EXIT

# Pick the sampler: powermetrics when sudo is cached or can prompt on a tty,
# top otherwise (or when MODE=top is set explicitly).
mode="${MODE:-}"
if [ -z "$mode" ]; then
  if sudo -n true 2>/dev/null; then
    mode=powermetrics
  elif [ -t 0 ]; then
    sudo -v && mode=powermetrics || mode=top
  else
    mode=top
  fi
fi
[ "$mode" = powermetrics ] || echo "no sudo here — sampling with top (no Energy Impact column)" >&2

echo "sampling ${secs}s in 5s (mode: $mode) — arrange the window now" >&2
sleep 5

# count distinct git processes that appear during the window (spawned by the poll).
# A `git rev-parse` lives for a few milliseconds, so poll as fast as pgrep
# itself runs (~20ms): the count is a floor, but a 0 vs. many signal is solid.
( end=$((SECONDS + secs)); while [ $SECONDS -lt $end ]; do pgrep -f '^git -C' || true; sleep 0.02; done ) | sort -u | wc -l | tr -d ' ' > "$tmp.git" &
gitcount=$!

if [ "$mode" = powermetrics ]; then
  sudo powermetrics --samplers tasks --show-process-energy -i $((secs * 1000)) -n 1 > "$tmp" 2>/dev/null
  wait "$gitcount"

  # the tasks table: Name  ID  CPU ms/s  User%  Deadlines(<2ms,2-5ms)  Wakeups(Intr,PkgIdle)  GPU ms/s  Energy Impact
  # Fields are indexed right-to-left (from $NF backwards) because the Name column (first, may contain spaces) has variable width.
  # A one-token name (like "Chronicle" or "git") plus nine numeric fields = NF == 10.
  # Multi-word names have more fields. Energy Impact ($NF), GPU ms/s $(NF-1), Wakeups Intr $(NF-3), CPU ms/s $(NF-7)
  echo "powermetrics columns (check the layout once):" >&2
  grep -m1 -E '^Name\s+ID\s+CPU ms/s' "$tmp" >&2 || true

  # Parse powermetrics output using one awk pass for all three values
  # Matches app row with case-insensitive first field "chronicle" and single token name (NF==10)
  # Sums git children's CPU, handles error if no app row found
  read -r cpu wake energy < <(awk '
    tolower($1) == "chronicle" && NF == 10 && !seen { app_cpu = $(NF-7); wake = $(NF-3); energy = $NF; seen = 1 }
    $1 == "git" && NF == 10 { git_cpu += $(NF-7) }
    END { if (!seen) { exit 1 } printf "%.2f %s %s\n", app_cpu + git_cpu, wake, energy }
  ' "$tmp") || { echo "couldn't find Chronicle in the powermetrics table — is the app running under the name 'Chronicle'?" >&2; exit 1; }
else
  # top prints two samples: the second's %CPU is the average over the window,
  # and IDLEW is a cumulative idle-wakeup counter (trailing "+"), so the
  # difference over the window divided by secs is wakeups/s. 1% CPU = 10 ms/s.
  top -l 2 -s "$secs" -pid "$pid" -stats pid,cpu,idlew > "$tmp"
  wait "$gitcount"
  read -r cpu wake < <(awk -v pid="$pid" -v secs="$secs" '
    $1 == pid { n++; cpu = $2; w[n] = $3 }
    END {
      if (n < 2) { exit 1 }
      gsub(/\+/, "", w[1]); gsub(/\+/, "", w[2])
      printf "%.2f %.2f\n", cpu * 10, (w[2] - w[1]) / secs
    }
  ' "$tmp") || { echo "top didn't report pid $pid twice — did the app quit mid-sample?" >&2; exit 1; }
  energy="n/a"
fi

printf '%s\t%s\t%s\t%s\t%s\n' "$label" "$cpu" "$wake" "$energy" "$(cat "$tmp.git")"
