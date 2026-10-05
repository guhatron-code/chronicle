# Design benchmark

This folder holds the design benchmark: a set of briefs, the reference designs to compare against, and the results of each run.

- `briefs/` — one Markdown file per brief. Front matter has `id`, `kind`, `title` and `quick: true|false`; then a `## Brief` section and an optional `## Answers` section of `- <question>: <answer>` lines.
- `reference/<brief id>/` — a Claude Design export of the same brief, for comparison. It is git-ignored. To add one, design the brief in Claude Design, export it as HTML, and put the exported files in `reference/<brief id>/`.
- `results/` — each run writes `<name>.json` and `<name>.md` here.

## Running it

Open Chronicle on this repo, then from the repo folder:

```
chronicle designs bench --quick
```

`--quick` runs only the briefs marked `quick: true`. Narrow a run with `--brief <id>` or `--kind <kind>`. Each brief is designed in a throwaway project under Chronicle's config folder, never in your own, so a run can take a long time (the app waits up to three hours). Chronicle has to stay open on this project while it runs.

The run is unattended: the director is told so, and any permission ask (a shell command, say) is refused after five seconds; each brief's result counts how many were refused.

Testing with a second Chronicle instance: set BOTH `CHRONICLE_BRIDGE_SOCKET` and `CHRONICLE_BRIDGE_TOKEN` for it, otherwise it overwrites the installed app's shared `app.token`.
