Round kind: bug fixes

# Round 5 — the deep code review (waves 3+4): backend + frontend defects

Backend (src-tauri/src/main.rs): B1 phantom-round guard order + settle-by-state; B2 atomic board writes + corrupt-refusal (both sides of the seam); B3 .chronicle/ paths resolve against the manifest dir; H1 process groups + group kill; H3 symlink refusal in kanban_detach; H5 branch-name validation; H6 pty insert-before-reader; H7 tasks via file (ARG_MAX); D1 allowlist gating on init_status/init_cancel; D3 cached agent_paths; D5 5MB file_matches cap; D6 multi-key conditions unknown; D7 SystemTime timestamps.

Frontend: per-project pane remounts (key={dir}); interval tick dir guards + onPollNow ref; stale run-flag verification; loader mode guards; cache eviction on close; thumbnail failure retry; id-at-save; poll in-flight + seq guards; render caps; scroll-on-change only; typed InitStatusData; IMG_MIME dedupe; satisfies-checked banner; fresh-disk mutateKanban.

Verified: 19 rust tests + 16 Playwright probe suites green; tsc + vite build clean.
