# Any agent, any provider · implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user picks Claude Code, Codex, Gemini CLI or OpenCode in Setup and the chat pane works with it; Chronicle's own model calls (review, decisions) go through a provider layer that works with no key by riding that agent, and with a Keychain-held key for Anthropic, OpenAI, OpenRouter, TypeSafe or a local server.

**Architecture:** Each supported agent becomes an `AgentProfile` (Rust data in `src-tauri/src/agents/`), launched from the bundled ACP registry entry at the profile's pinned version. `acp::start` takes the profile; Rust stamps a `_chronicle` object on every tool call, permission and usage update from the profile's JSON pointers, so `agent-session.ts` reads one shape for every agent and its `claudeCode` reads go. Modes become stances (`ask`/`execute`/`auto`/`unattended`) translated per profile on the Rust side; sign-in follows the profile's `Login`. The provider layer (`src-tauri/src/providers/`) is a `Calls` trait with an `Agent` implementation (a one-turn `Lane::Reviewer` ACP session, reads only) and five HTTP implementations over a `curl` transport, keys in the macOS Keychain behind a `Secrets` trait.

**Tech Stack:** Rust/Tauri 2 (`serde_json`, `sha2` — no new crates; HTTP through the `curl` binary, the Keychain through the `security` binary), React 19.2.7 + TypeScript, vitest (node, pure modules), the ACP registry snapshot at `src-tauri/resources/acp-registry.json`.

**Spec:** `docs/superpowers/specs/2026-10-15-agents-and-providers-design.md` — every section; §11 is Task 1, §14 is Task 0, §12.6 is Task 17. Boards: `design/comps/agents/project/01-Setup-agents-providers.dc.html` and `02-Pane-on-codex.dc.html` (drawn in commit `58b2bf5`, generator `design/comps/agents/gen.py`).

## Global Constraints

- Branch in place on `react-shadcn`; never a worktree for development (the 1.2 GB `src-tauri/target`). Stage by explicit path; never `git add -A`, `stash`, `reset`, `checkout --`, `clean`.
- The installed Chronicle app runs on this repo and writes `.chronicle/` live: never touch `.chronicle/`, never delete `.chronicle/kanban.json` from the index.
- vitest runs `src/**/*.test.ts` in the **node** environment. No component tests, no jsdom/happy-dom, no new dev dependencies. Pure logic goes in `src/lib/*.ts` so it can be tested.
- No new runtime dependencies, Rust or npm. HTTP goes through `curl` (as `setup.rs` already does), the Keychain through `security`. Saying so in a task is not enough to add one; this plan needs none.
- Pins ship with Chronicle (spec §12.2): an agent launches only from the bundled registry entry at its profile's `registry_version`, or from the profile's `pinned_npx` while the pin is not in the registry (Claude Code until Task 17). A newer registry entry is ignored.
- Chronicle holds no agent key: the agent's own login stays the agent's business. A profile's `blank_env` (Claude Code: `ANTHROPIC_API_KEY`) is blanked and `CLAUDECODE` removed on every spawn. Provider keys live only in the Keychain under service `chronicle.provider.<id>`, never in a repo file, never on a process command line.
- The design lane stays Claude Code only (spec §8): `Lane::Design` always uses `agents::claude()`, whatever agent the project chose.
- Vocabulary law for user-facing copy: sentence case; save/publish, never commit/push. The pane's state words stay `warming`, `starting`, `ready`, `working`, `idle`, `needs login`, `stopped`, `ended`. Stance names: **Ask first**, **Execute**, **Auto**, **Unattended**.
- Design tokens only (`var(--…)` / Tailwind token classes); no raw hex. Every animation is off under `prefers-reduced-motion: reduce`.
- Tests stay offline: recorded HTTP bodies for providers, a fake `Secrets`, the bundled registry file, probe fixtures for the wire, a Python mock agent for sessions. Live checks are `#[ignore]` tests gated by an env var, run by hand in Task 19.
- Checks: `npm run typecheck`, `npx vitest run`, `npm run build`, and `cd src-tauri && cargo test` (PATH needs `$HOME/.cargo/bin`). Release binary for live checks: `cargo build --release --features tauri/custom-protocol`.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

Inputs the spec implies but no task's tests would otherwise exercise; each has its test pinned to the owning task.

1. **A `binary` agent whose download does not match its registry `sha256`** (a tampered or truncated archive) — nothing is installed, a previous good install of that agent survives untouched, and the row says it couldn't finish because the download didn't match its checksum. Pinned in Task 3: `a_checksum_mismatch_installs_nothing_and_keeps_the_old_install`.
2. **A `binary` distribution with no entry for this Mac's platform** (e.g. a registry entry that ships only Linux builds) — the agent has no launch, the Your agent row says it isn't supported on this Mac yet with no Install button, and nothing panics. Pinned in Task 2: `a_binary_with_no_entry_for_this_platform_has_no_launch`; in Task 10: the `agentRows` "unsupported" test.
3. **An agent whose `modes` list is empty or absent** — no stance select appears, `session/set_mode` is never sent, Ask first is the implicit stance (every ACP agent asks through `session/request_permission`). Pinned in Task 8: `an_agent_with_no_modes_offers_no_stances` (Rust) and `availableStances` on an empty map (TS).
4. **A session started on agent A while the project's agent is switched to B** — the live session keeps A's profile (normalisation, stances, sign-in) until it ends; the switch asks first, ends A, then starts B. Pinned in Task 5: `a_live_session_keeps_its_own_agent`; in Task 11: `agentSwitchPlan`.
5. **A provider key revoked mid-run** (HTTP 401/403 on a call that worked yesterday) — that call falls back to the agent provider and the decision's `model` says why; any other provider error is returned, not masked. Pinned in Task 14: `a_refused_key_falls_back_to_the_agent_and_says_so`.

## File structure

| Path | Responsibility | Task |
|---|---|---|
| `.superpowers/sdd/2026-10-15-agents-and-providers/probe.mjs`, `fixture.mjs` | throwaway probe + fixture builder (gitignored) | 1 |
| `src/lib/__fixtures__/acp-<id>.raw.jsonl` | the wire each agent produced, as received, scrubbed | 1 |
| `src/lib/__fixtures__/acp-<id>.jsonl` | the same lines after Rust normalisation — what the pane sees | 6 |
| `src-tauri/src/agents/mod.rs`, `profiles.rs`, `registry.rs` | profile table, registry loader, launch spec | 2 |
| `src-tauri/src/agents/normalize.rs` | `_chronicle` stamping | 6 |
| `src-tauri/src/setup.rs` | per-agent install, `agent_launch`, connector row, sign-in detection | 3, 9 |
| `src-tauri/src/acp.rs` | `AdapterLaunch` reshape, `start(profile)`, normalised reads, login, `Lane::Reviewer` | 3, 5, 6, 9, 12 |
| `src-tauri/src/main.rs` | config migration, agent choice commands, stance command, provider commands | 4, 5, 8, 15 |
| `src-tauri/src/providers/mod.rs`, `schema.rs`, `http.rs`, `agent.rs`, `keys.rs`, `config.rs`, `fixtures/*.json` | the provider layer | 13–15 |
| `src/lib/agents.ts`, `agents-store.ts` | agent names/marks, project agent choice | 10, 11 |
| `src/lib/agent-stances.ts`, `agent-login.ts` | stance↔mode, sign-in banner (pure) | 8, 9 |
| `src/lib/agent-session.ts` | reads `_chronicle`, `agent`, `stances`, `login` | 7–9 |
| `src/lib/setup-store.ts`, `src/screens/setup/AgentGroup.tsx`, `ProvidersGroup.tsx` | Setup rows | 10, 16 |
| `src/components/chrome/AgentMark.tsx`, `src/screens/agent/*` | header mark, picker, banner | 9, 11 |
| `scripts/acp-registry.mjs` | release-time registry refresh | 18 |
| `c-runs/PROGRESS.md` | the closing matrix | 0, 1, 19 |

---

### Task 0: The two boards — approval gate (§14)

The boards are already drawn: commit `58b2bf5` added `design/comps/agents/gen.py` (which imports the chrome from `design/comps/runs/gen.py` and `_chrome.py`, as the roadmap-first-open generator does) and its two `.dc.html` boards. This task checks them against §14, regenerates only if the user asks for changes, and records the user's approval. **No task from Task 2 onward starts until the user has approved both boards in writing.** Tasks 1 (the probe) may run meanwhile; it touches no product code.

**Files:**
- Modify (only if the user asks for changes): `design/comps/agents/gen.py`, then regenerate `design/comps/agents/project/01-Setup-agents-providers.dc.html`, `02-Pane-on-codex.dc.html`, `canvas.json`
- Modify: `c-runs/PROGRESS.md` (append the approval line)

**Interfaces:**
- Consumes: spec §14.
- Produces: an approved visual reference for Tasks 9, 10, 11, 16. Copy and layout in those tasks follow the boards: Setup has a **Your agent** group (one radio row per agent, the chosen agent's connector nested under it) and a **Providers** group (Review and Decisions selects, one row per provider, the key form, the "what leaves your Mac" sentence); the pane shows the agent's mark and name in the header, an agent chip and a stance chip in the composer, a flat tool list, and a sign-in banner naming the agent's command.

- [ ] **Step 1: Regenerate and confirm the boards are current**

```bash
cd /Users/tuneerguha/Downloads/chronicle
python3 design/comps/agents/gen.py
git status --short design/comps/agents
```

Expected: prints the two board names; `git status` shows nothing for the two `.dc.html` files and `canvas.json` (the generator's output matches the commit). `design/comps/agents/project/support.js` may show as untracked — leave it alone; it is copied by the viewer, not by the generator.

- [ ] **Step 2: Check the §14 list against the boards**

Open both files in a browser (`open design/comps/agents/project/01-Setup-agents-providers.dc.html`). Tick each item in the scratch list below; anything missing goes back to the user before approval.

```
Board 1 — Setup
[ ] Your agent group: Claude Code, Codex, Gemini CLI, OpenCode, each with its state
[ ]   states drawn: ready + signed in · needs you + sign-in command · missing + Install · not yet supported (dimmed, no button)
[ ]   the chosen agent's connector nested under it with its version
[ ] Providers group: Review and Decisions selects (default "with your agent")
[ ]   rows: Your agent, Anthropic, OpenAI, OpenRouter, TypeSafe, Local
[ ]   the key field ("Paste it here", "Saved in your Keychain, never in the project")
[ ]   the "what leaves your Mac" sentence
Board 2 — the pane on Codex
[ ] header: the agent's mark and name instead of Chronigirl
[ ] composer: the agent chip ("Codex ▾") and the stance chip ("Ask first ▾")
[ ] a flat tool list (no subagent cards)
[ ] the sign-in banner with the agent's command ("codex login"), "Open a terminal", "Check again"
```

Board 1 also collapses the existing setup rows into a "Chronicle's own tools" summary card. The spec does not ask for that and this plan does not build it; raise it with the user as a question when asking for approval.

- [ ] **Step 3: Ask the user for approval and record it**

Ask: "The two agents-and-providers boards are in `design/comps/agents/project/`. Do you approve them as the reference for the build? One question: board 1 folds the existing setup rows into a 'Chronicle's own tools' card — build that too, or keep today's list?" Apply any changes the user asks for in `gen.py`, rerun Step 1, and commit those files by path before recording approval. Then append to `c-runs/PROGRESS.md`:

```markdown

## Any agent, any provider (RN-4)

- 2026-10-DD · boards approved by the user: `design/comps/agents/project/01-Setup-agents-providers.dc.html`, `02-Pane-on-codex.dc.html`. Summary card: <the user's answer, verbatim>.
```

- [ ] **Step 4: Commit**

```bash
git add c-runs/PROGRESS.md
git commit -m "docs(agents): the boards are approved — the build may start

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

(If Step 3 changed the boards, `git add design/comps/agents/gen.py design/comps/agents/project/01-Setup-agents-providers.dc.html design/comps/agents/project/02-Pane-on-codex.dc.html design/comps/agents/project/canvas.json` in a commit of its own first, `docs(agents): comps revised — <what changed>`.)

---

### Task 1: The probe, one run per agent (§11)

A throwaway Node script speaks ACP to each agent launched from its registry distribution, on a toy repo, and logs every line. Its products are the filled profile table (written into the spec) and four replay fixtures. Claude Code is probed twice: at the shipped pin `0.75.1` (its fixture) and at the registry's `0.90.1-preview.15` (the evidence for Task 17).

**Files:**
- Create (gitignored, not committed): `.superpowers/sdd/2026-10-15-agents-and-providers/probe.mjs`, `.superpowers/sdd/2026-10-15-agents-and-providers/fixture.mjs`, output folders `probe-<id>[-<version>]/`
- Create (outside the repo): `~/chronicle-probe/` (a toy git repo)
- Create: `src/lib/__fixtures__/acp-claude-acp.raw.jsonl`, `acp-codex-acp.raw.jsonl`, `acp-gemini.raw.jsonl`, `acp-opencode.raw.jsonl`
- Modify: `docs/superpowers/specs/2026-10-15-agents-and-providers-design.md` (append `### Probe result (2026-10-DD)` at the end of §11)
- Modify: `c-runs/PROGRESS.md`

**Interfaces:**
- Consumes: `src-tauri/resources/acp-registry.json` (the four entries quoted in spec §2); the user's logins for each agent.
- Produces, read by Tasks 2, 6, 7, 8, 9, 17:
  - Each raw fixture is JSON lines in **transcript shape** (what `transcript::append` stores): line 1 `{"method":"_chronicle/probe","params":{"agent","version","authMethods","loadSession"}}`; line 2 a `_chronicle/session_state` `ready` line carrying the `session/new` response's `modes`, `configOptions`, and `agentCaps` (the `initialize` result); line 3 `_chronicle/user_message`; then the agent's `session/update` notifications and `session/request_permission` requests exactly as received (scrubbed); last line `_chronicle/turn_end`.
  - The spec's probe table, one row per agent: version, `authMethods` ids, the `Login` value, `availableModes` ids, the stance→mode mapping, the `_meta` paths on `tool_call` and on permission `toolCall`, `loadSession`, the credentials file a signed-in agent leaves, and the verdict (`shipped` or `not yet supported`). Task 2 copies these values into `profiles.rs` and its test reads the fixtures to prove they agree.
  - A verdict line for Claude Code `0.90.1-preview.15`: `PASS` or `FAIL`, read by Task 17.

- [ ] **Step 1: Build the toy repo**

```bash
mkdir -p ~/chronicle-probe && cd ~/chronicle-probe && git init -q
printf '# probe\nA toy repo for the agents probe.\n' > README.md
git add README.md && git commit -qm "probe" && echo ok
```

(A throwaway repo outside Chronicle; nothing in the Chronicle repo is staged by this step.)

- [ ] **Step 2: Write the probe script**

Create `.superpowers/sdd/2026-10-15-agents-and-providers/probe.mjs`:

```js
// The agents probe (spec §11). Throwaway. Usage:
//   node probe.mjs <registry-id> [version-override]
// Launches the agent from the bundled registry entry, runs initialize →
// session/new → one prompt on ~/chronicle-probe, answers every permission
// with allow_once, and writes wire.jsonl (every line received), sent.jsonl,
// stderr.log and summary.json into ./probe-<id>[-<version>]/.
import { spawn, execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const here = path.dirname(new URL(import.meta.url).pathname)
const repo = path.resolve(here, '../../..')
const [id, override] = process.argv.slice(2)
if (!id) { console.error('usage: node probe.mjs <registry-id> [version]'); process.exit(64) }
const reg = JSON.parse(fs.readFileSync(path.join(repo, 'src-tauri/resources/acp-registry.json'), 'utf8'))
const entry = reg.agents.find((a) => a.id === id)
if (!entry) throw new Error(`no registry entry for ${id}`)
const out = path.join(here, `probe-${id}${override ? '-' + override : ''}`)
fs.mkdirSync(out, { recursive: true })
const toy = path.join(os.homedir(), 'chronicle-probe')
const PROMPT = 'Read README.md, then create a file named probe.txt containing the single word probe, then run the command `ls`, then reply with one short sentence.'

let cmd, args, version = entry.version
if (entry.distribution.npx) {
  let pkg = entry.distribution.npx.package
  if (override) { pkg = pkg.replace(/@[^@]+$/, '@' + override); version = override }
  // an overridden (older) version may not know the registry's flags
  cmd = 'npx'; args = ['--yes', '--', pkg, ...(override ? [] : entry.distribution.npx.args ?? [])]
} else {
  const plat = `darwin-${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}`
  const t = entry.distribution.binary?.[plat]
  if (!t) throw new Error(`${id} has no binary for ${plat}`)
  const archive = path.join(out, path.basename(t.archive))
  if (!fs.existsSync(archive)) execFileSync('curl', ['-fsSL', '-o', archive, t.archive])
  const sha = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex')
  if (sha !== t.sha256) throw new Error(`sha256 mismatch: got ${sha}, registry says ${t.sha256}`)
  const bin = path.join(out, 'bin')
  fs.mkdirSync(bin, { recursive: true })
  if (archive.endsWith('.zip')) execFileSync('ditto', ['-x', '-k', archive, bin])
  else execFileSync('tar', ['-xzf', archive, '-C', bin])
  cmd = path.join(bin, t.cmd.replace(/^\.\//, '')); args = t.args ?? []
}

const env = { ...process.env }
if (id === 'claude-acp') env.ANTHROPIC_API_KEY = ''
delete env.CLAUDECODE
const wire = fs.createWriteStream(path.join(out, 'wire.jsonl'))
const sent = fs.createWriteStream(path.join(out, 'sent.jsonl'))
const errlog = fs.createWriteStream(path.join(out, 'stderr.log'))
const p = spawn(cmd, args, { env, cwd: toy, stdio: ['pipe', 'pipe', 'pipe'] })
p.stderr.pipe(errlog)
let nextId = 0
const pending = new Map()
const write = (o) => { const l = JSON.stringify(o); sent.write(l + '\n'); p.stdin.write(l + '\n') }
const send = (method, params) => new Promise((res) => { const i = ++nextId; pending.set(i, res); write({ jsonrpc: '2.0', id: i, method, params }) })
const summary = { agent: id, version, toolCallMeta: new Set(), permissionMeta: new Set(), permissions: [] }
const metaPaths = (o, base = '/_meta', depth = 0, acc = new Set()) => {
  if (!o || typeof o !== 'object' || depth > 3) return acc
  for (const [k, v] of Object.entries(o)) {
    const ptr = `${base}/${k.replace(/~/g, '~0').replace(/\//g, '~1')}`
    acc.add(ptr)
    if (v && typeof v === 'object' && !Array.isArray(v)) metaPaths(v, ptr, depth + 1, acc)
  }
  return acc
}
let buf = ''
p.stdout.on('data', (d) => {
  buf += d
  let n
  while ((n = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, n); buf = buf.slice(n + 1)
    if (!line.trim()) continue
    wire.write(line + '\n')
    let m; try { m = JSON.parse(line) } catch { continue }
    if (m.method === 'session/update') {
      const u = m.params?.update ?? {}
      if (u.sessionUpdate === 'tool_call' || u.sessionUpdate === 'tool_call_update') metaPaths(u._meta).forEach((x) => summary.toolCallMeta.add(x))
    }
    if (m.method && m.id !== undefined) {
      if (m.method === 'session/request_permission') {
        metaPaths(m.params?.toolCall?._meta).forEach((x) => summary.permissionMeta.add(x))
        summary.permissions.push({ kind: m.params?.toolCall?.kind, title: m.params?.toolCall?.title, options: m.params?.options })
        const o = m.params.options.find((x) => x.kind === 'allow_once') ?? m.params.options[0]
        write({ jsonrpc: '2.0', id: m.id, result: { outcome: { outcome: 'selected', optionId: o.optionId } } })
      } else if (m.method === 'fs/write_text_file') {
        fs.mkdirSync(path.dirname(m.params.path), { recursive: true }); fs.writeFileSync(m.params.path, m.params.content)
        write({ jsonrpc: '2.0', id: m.id, result: {} })
      } else if (m.method === 'fs/read_text_file') {
        let c = ''; try { c = fs.readFileSync(m.params.path, 'utf8') } catch {}
        write({ jsonrpc: '2.0', id: m.id, result: { content: c } })
      } else {
        write({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'method not supported by this client' } })
      }
    } else if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  }
})
const finish = (code) => {
  summary.toolCallMeta = [...summary.toolCallMeta]; summary.permissionMeta = [...summary.permissionMeta]
  summary.credentials = ['.codex/auth.json', '.gemini/oauth_creds.json', '.local/share/opencode/auth.json', '.claude/.credentials.json']
    .filter((rel) => fs.existsSync(path.join(os.homedir(), rel)))
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2))
  p.kill(); process.exit(code)
}
setTimeout(() => { summary.timeout = true; finish(2) }, 6 * 60 * 1000)

const init = await send('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } }, clientInfo: { name: 'Chronicle', version: 'probe' } })
summary.initialize = init.result ?? init.error
summary.authMethods = init.result?.authMethods ?? []
summary.loadSession = !!init.result?.agentCapabilities?.loadSession
const ns = await send('session/new', { cwd: toy, mcpServers: [] })
if (ns.error) { summary.sessionNewError = ns.error; finish(3) }
summary.sessionId = ns.result.sessionId
summary.modes = ns.result.modes ?? null
summary.configOptions = ns.result.configOptions ?? null
summary.prompt = PROMPT
const pr = await send('session/prompt', { sessionId: ns.result.sessionId, prompt: [{ type: 'text', text: PROMPT }] })
summary.stopReason = pr.result?.stopReason ?? null
summary.promptError = pr.error ?? null
setTimeout(() => finish(0), 2000)
```

- [ ] **Step 3: Write the fixture builder**

Create `.superpowers/sdd/2026-10-15-agents-and-providers/fixture.mjs`:

```js
// Turns one probe folder into src/lib/__fixtures__/acp-<id>.raw.jsonl —
// transcript-shaped lines, scrubbed, capped at 80 lines.
//   node fixture.mjs <probe-folder> <registry-id>
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const here = path.dirname(new URL(import.meta.url).pathname)
const repo = path.resolve(here, '../../..')
const [folder, id] = process.argv.slice(2)
const dir = path.resolve(here, folder)
const summary = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8'))
const wire = fs.readFileSync(path.join(dir, 'wire.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
const home = os.homedir()
const scrub = (v) => JSON.parse(JSON.stringify(v)
  .replaceAll(path.join(home, 'chronicle-probe'), '/Users/me/chronicle-probe')
  .replaceAll(home, '/Users/me')
  .replaceAll(summary.sessionId ?? '\u0000', 'probe-session'))
const cut = (v) => {
  if (typeof v === 'string') return v.length > 400 ? v.slice(0, 400) : v
  if (Array.isArray(v)) return v.map(cut)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, cut(x)]))
  return v
}
const keep = new Set(['tool_call', 'tool_call_update', 'agent_message_chunk', 'agent_thought_chunk', 'usage_update', 'plan', 'current_mode_update'])
const caps = { agent_message_chunk: 6, agent_thought_chunk: 3 }
const seen = {}
const lines = [
  { method: '_chronicle/probe', params: { agent: id, version: summary.version, authMethods: summary.authMethods, loadSession: summary.loadSession } },
  { method: '_chronicle/session_state', params: { state: 'ready', sessionId: 'probe-session', resumed: false, modes: summary.modes, configOptions: summary.configOptions, agentCaps: summary.initialize } },
  { method: '_chronicle/user_message', params: { text: summary.prompt, ts: 0 } },
]
for (const m of wire) {
  if (lines.length >= 79) break
  if (m.method === 'session/request_permission') { lines.push(m); continue }
  if (m.method !== 'session/update') continue
  const kind = m.params?.update?.sessionUpdate
  if (!keep.has(kind)) continue
  seen[kind] = (seen[kind] ?? 0) + 1
  if (caps[kind] && seen[kind] > caps[kind]) continue
  lines.push(m)
}
lines.push({ method: '_chronicle/turn_end', params: { stopReason: summary.stopReason, usage: null } })
const target = path.join(repo, 'src/lib/__fixtures__', `acp-${id}.raw.jsonl`)
fs.writeFileSync(target, lines.map((l) => JSON.stringify(cut(scrub(l)))).join('\n') + '\n')
console.log(`${target}: ${lines.length} lines`)
```

- [ ] **Step 4: Run the probe for each agent; sign in where it asks**

```bash
cd /Users/tuneerguha/Downloads/chronicle/.superpowers/sdd/2026-10-15-agents-and-providers
for a in claude-acp codex-acp gemini opencode; do node probe.mjs "$a"; echo "$a exit $?"; done
node probe.mjs claude-acp 0.75.1; echo "claude-acp 0.75.1 exit $?"
```

Exit `0` is a completed turn. Exit `3` with `sessionNewError.code == -32000` in `summary.json` means the agent wants a login: record `summary.authMethods`, sign in with the agent's own tool in a terminal (`claude /login`, `codex login`, `gemini` then follow its sign-in, `opencode auth login`), and rerun that agent. Exit `2` is a timeout. Note: the first loop runs Claude at the registry's `0.90.1-preview.15` (folder `probe-claude-acp`); the last line runs the shipped pin (folder `probe-claude-acp-0.75.1`).

- [ ] **Step 5: Build the four fixtures**

```bash
cd /Users/tuneerguha/Downloads/chronicle/.superpowers/sdd/2026-10-15-agents-and-providers
node fixture.mjs probe-claude-acp-0.75.1 claude-acp
node fixture.mjs probe-codex-acp codex-acp
node fixture.mjs probe-gemini gemini
node fixture.mjs probe-opencode opencode
head -c 600 ../../../src/lib/__fixtures__/acp-codex-acp.raw.jsonl
```

Expected: four `…: N lines` lines (N ≤ 80). Open each file and check no home path, email address, token or session id survived the scrub; fix `scrub` and rerun if one did. An agent whose probe never completed gets no fixture; it ships as not yet supported (Step 6).

- [ ] **Step 6: Write the probe result into the spec**

Append to §11 of the spec, under `### Probe result (2026-10-DD)`, this table filled from each `summary.json` (every cell is a value read from a file, never a guess):

```markdown
| | claude-acp | codex-acp | gemini | opencode |
|---|---|---|---|---|
| version run | 0.75.1 | 2.2.3-preview.10 | 0.64.0 | 1.19.0 |
| authMethods ids | … | … | … | … |
| Login | Terminal "claude /login" | … | … | … |
| availableModes ids | … | … | … | … |
| Ask first → | default | … | … | … |
| Execute → | acceptEdits | … | … | … |
| Auto → | auto | … | … | … |
| Unattended → | bypassPermissions | … | … | … |
| tool_call `_meta` paths | … | … | … | … |
| permission `_meta` paths | … | … | … | … |
| loadSession | … | … | … | … |
| credentials file when signed in | Keychain "Claude Code-credentials" | … | … | … |
| verdict | shipped | shipped / not yet supported | … | … |

Claude Code 0.90.1-preview.15 (the registry's entry): PASS / FAIL — <one sentence: did the turn complete, did the tool_call `_meta` keep `claudeCode.parentToolUseId` and `claudeCode.toolName`, did the modes list keep `default`/`acceptEdits`/`bypassPermissions`>.
```

Rules for the mapping rows: a stance maps to a mode only when the mode's own name/description in `availableModes` means that stance (Execute = edits without asking, commands still ask; Auto = the agent approves routine actions and asks about risky ones; Unattended = nothing asks). A stance with no such mode is `—`. If `availableModes` is empty or absent, every row is `—`. `Login` is `AuthMethod "<id>"` only when calling `authenticate` with that id opens the browser from the agent's side and needs no terminal; otherwise `Terminal "<the command the agent's docs give>"`; `None` when the agent reports no auth methods and runs on its own config.

- [ ] **Step 7: Commit**

```bash
cd /Users/tuneerguha/Downloads/chronicle
printf -- '- 2026-10-DD · probe: claude-acp %s, codex-acp %s, gemini %s, opencode %s (see the spec, §11 probe result); Claude 0.90.1-preview.15: %s\n' "<verdict>" "<verdict>" "<verdict>" "<verdict>" "<PASS|FAIL>" >> c-runs/PROGRESS.md
git add src/lib/__fixtures__/acp-claude-acp.raw.jsonl src/lib/__fixtures__/acp-codex-acp.raw.jsonl src/lib/__fixtures__/acp-gemini.raw.jsonl src/lib/__fixtures__/acp-opencode.raw.jsonl docs/superpowers/specs/2026-10-15-agents-and-providers-design.md c-runs/PROGRESS.md
git commit -m "docs(agents): probe result — each agent's sign-in, modes and wire, recorded as fixtures

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

(Replace each `<verdict>` in the `printf` with the table's verdict before running it. Leave out the `git add` path of any fixture that was not produced.)

---

### Task 2: The profile table and the registry loader (Rust)

**Files:**
- Create: `src-tauri/src/agents/mod.rs`, `src-tauri/src/agents/profiles.rs`, `src-tauri/src/agents/registry.rs`
- Modify: `src-tauri/src/main.rs` (add `mod agents;` beside `mod acp;`, line 8)
- Test: in-file `#[cfg(test)]` modules of `profiles.rs` and `registry.rs`

**Interfaces:**
- Consumes: `src-tauri/resources/acp-registry.json` (compiled in with `include_str!`), the four raw fixtures and the spec's probe table from Task 1.
- Produces (every later Rust task uses these names):
  - `agents::profiles::{AgentProfile, Login, Modes, MetaKeys, Extras, Credentials, PinnedNpx, Stance, PROFILES, NO_META}`
  - `pub fn profile(id: &str) -> Option<&'static AgentProfile>`; `pub fn claude() -> &'static AgentProfile`
  - `pub fn canonical_id(s: &str) -> Option<&'static str>` — `"claude"`/`"claude-acp"` → `"claude-acp"`, `"codex"`/`"codex-acp"` → `"codex-acp"`, `"gemini"`, `"opencode"`; anything else `None`
  - `pub fn chosen_in(cfg: &Value, project: Option<&str>) -> &'static AgentProfile` — `cfg.project_agents[project]`, then `cfg.agent`, then Claude Code; unknown or unshipped ids fall through
  - `pub fn migrate_config(cfg: &mut Value) -> bool` — rewrites a legacy `agent` value to its id; true when it changed something
  - `pub fn login_json(l: Login) -> Value` — `{"kind":"terminal","command"}` | `{"kind":"auth_method","id"}` | `{"kind":"none"}`
  - `pub fn mode_for(p: &AgentProfile, s: Stance) -> Option<&'static str>`; `pub fn stances(p: &AgentProfile, modes: &Value) -> Value` (used from Task 8)
  - `agents::registry::{Registry, Entry, Distribution, NpxDist, BinaryTarget, LaunchSpec}`; `pub fn parse(text: &str) -> Result<Registry, String>`; `pub fn bundled() -> &'static Registry`; `pub fn platform_key() -> String`; `pub fn launch_spec_in(reg: &Registry, p: &AgentProfile, platform: &str) -> Option<LaunchSpec>`; `pub fn launch_spec(p: &AgentProfile) -> Option<LaunchSpec>`
  - `pub enum LaunchSpec { Npx { package: String, args: Vec<String> }, Binary { version: String, target: BinaryTarget } }`

The values for Codex, Gemini CLI and OpenCode below are what the probe is expected to show. **The spec's §11 probe table is the authority**: copy its values over these before running the tests; `profiles_agree_with_the_probe_fixtures` reads the fixtures and fails on any mode id or auth method id the agent did not advertise. An agent the table marks "not yet supported" gets `shipped: false` (it keeps its row in Setup, with no Install).

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/src/agents/registry.rs` with only its test module for now (the implementation goes above it in Step 3):

```rust
#[cfg(test)]
mod registry_tests {
    use super::*;
    use crate::agents::profiles::{claude, profile, PROFILES};

    #[test]
    fn the_bundled_registry_parses_and_lists_the_four() {
        let reg = bundled();
        for id in ["claude-acp", "codex-acp", "gemini", "opencode"] {
            assert!(reg.agents.iter().any(|e| e.id == id), "{id} is in the bundled registry");
        }
    }

    #[test]
    fn every_shipped_profile_launches_on_both_mac_architectures() {
        for p in PROFILES.iter().filter(|p| p.shipped) {
            for plat in ["darwin-aarch64", "darwin-x86_64"] {
                assert!(launch_spec_in(bundled(), p, plat).is_some(), "{} has a launch on {plat}", p.id);
            }
        }
    }

    #[test]
    fn claude_launches_its_pinned_npx_until_the_pin_moves() {
        // the registry carries 0.90.1-preview.15; the profile ships 0.75.1 until Task 17
        let spec = launch_spec_in(bundled(), claude(), "darwin-aarch64").unwrap();
        assert_eq!(spec, LaunchSpec::Npx { package: "@agentclientprotocol/claude-agent-acp@0.75.1".into(), args: vec![] });
    }

    #[test]
    fn a_newer_registry_entry_is_ignored() {
        let reg = parse(r#"{"version":"x","agents":[{"id":"codex-acp","name":"Codex","version":"9.9.9",
            "distribution":{"npx":{"package":"@agentclientprotocol/codex-acp@9.9.9"}}}]}"#).unwrap();
        assert_eq!(launch_spec_in(&reg, profile("codex-acp").unwrap(), "darwin-aarch64"), None);
    }

    #[test]
    fn a_binary_with_no_entry_for_this_platform_has_no_launch() {
        let oc = profile("opencode").unwrap();
        assert_eq!(launch_spec_in(bundled(), oc, "freebsd-riscv64"), None);
        let linux_only = parse(&format!(r#"{{"version":"x","agents":[{{"id":"opencode","name":"OpenCode","version":"{}",
            "distribution":{{"binary":{{"linux-x86_64":{{"archive":"https://x/o.tar.gz","cmd":"./opencode","args":["acp"],"sha256":"00"}}}}}}}}]}}"#, oc.registry_version)).unwrap();
        assert_eq!(launch_spec_in(&linux_only, oc, "darwin-aarch64"), None);
    }

    #[test]
    fn a_binary_launch_carries_its_checksum_and_args() {
        let oc = profile("opencode").unwrap();
        let Some(LaunchSpec::Binary { version, target }) = launch_spec_in(bundled(), oc, "darwin-aarch64") else { panic!("opencode is a binary") };
        assert_eq!(version, oc.registry_version);
        assert_eq!(target.cmd, "./opencode");
        assert_eq!(target.sha256.len(), 64);
        assert!(target.archive.starts_with("https://"));
    }

    #[test]
    fn the_platform_key_is_darwin_on_a_mac() {
        let k = platform_key();
        assert!(k == "darwin-aarch64" || k == "darwin-x86_64", "{k}");
    }
}
```

Create `src-tauri/src/agents/profiles.rs` with only its test module for now:

```rust
#[cfg(test)]
mod profile_tests {
    use super::*;
    use serde_json::json;

    fn fixture(id: &str) -> Vec<Value> {
        let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("../src/lib/__fixtures__/acp-{id}.raw.jsonl"));
        std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("{}: {e}", p.display()))
            .lines().filter(|l| !l.trim().is_empty()).map(|l| serde_json::from_str(l).unwrap()).collect()
    }

    #[test]
    fn ids_are_unique_and_lookup_works() {
        let mut ids: Vec<&str> = PROFILES.iter().map(|p| p.id).collect();
        ids.sort(); ids.dedup();
        assert_eq!(ids.len(), PROFILES.len());
        assert_eq!(claude().id, "claude-acp");
        assert_eq!(profile("gemini").map(|p| p.name), Some("Gemini CLI"));
        assert!(profile("amp-acp").is_none(), "the other registry agents are not offered");
    }

    #[test]
    fn every_profile_is_pinned_to_something_it_can_launch() {
        let reg = crate::agents::registry::bundled();
        for p in PROFILES.iter() {
            let in_registry = reg.agents.iter().any(|e| e.id == p.id && e.version == p.registry_version);
            let pinned = p.pinned_npx.map(|n| n.package.ends_with(&format!("@{}", p.registry_version))).unwrap_or(false);
            assert!(in_registry || pinned, "{}: {} is neither in the bundled registry nor a pinned npx package", p.id, p.registry_version);
        }
    }

    #[test]
    fn profiles_agree_with_the_probe_fixtures() {
        for p in PROFILES.iter().filter(|p| p.shipped) {
            let lines = fixture(p.id);
            let probe = lines.iter().find(|l| l["method"] == "_chronicle/probe").expect("a probe line");
            assert_eq!(probe["params"]["agent"], p.id);
            let ready = lines.iter().find(|l| l["method"] == "_chronicle/session_state" && l["params"]["state"] == "ready").expect("a ready line");
            let ids: Vec<&str> = ready["params"]["modes"]["availableModes"].as_array().map(|a| a.iter().filter_map(|m| m["id"].as_str()).collect()).unwrap_or_default();
            for m in [p.modes.ask, p.modes.execute, p.modes.auto, p.modes.unattended].into_iter().flatten() {
                assert!(ids.contains(&m), "{}: mode {m} is not among the probe's {ids:?}", p.id);
            }
            if !ids.is_empty() { assert!(p.modes.ask.is_some(), "{}: the agent has modes, so Ask first maps to one", p.id); }
            if let Login::AuthMethod { id } = p.login {
                let methods: Vec<&str> = probe["params"]["authMethods"].as_array().map(|a| a.iter().filter_map(|m| m["id"].as_str()).collect()).unwrap_or_default();
                assert!(methods.contains(&id), "{}: auth method {id} is not among {methods:?}", p.id);
            }
        }
    }

    #[test]
    fn legacy_agent_names_migrate_to_ids() {
        let mut cfg = json!({ "agent": "codex", "other": 1 });
        assert!(migrate_config(&mut cfg));
        assert_eq!(cfg, json!({ "agent": "codex-acp", "other": 1 }));
        assert!(!migrate_config(&mut cfg), "a second pass changes nothing");
        let mut c2 = json!({ "agent": "claude" });
        assert!(migrate_config(&mut c2));
        assert_eq!(c2["agent"], "claude-acp");
        let mut empty = json!({});
        assert!(!migrate_config(&mut empty));
    }

    #[test]
    fn the_project_choice_wins_then_the_default_then_claude() {
        let cfg = json!({ "agent": "gemini", "project_agents": { "/p/a": "codex-acp", "/p/bad": "amp-acp" } });
        assert_eq!(chosen_in(&cfg, Some("/p/a")).id, "codex-acp");
        assert_eq!(chosen_in(&cfg, Some("/p/other")).id, "gemini");
        assert_eq!(chosen_in(&cfg, Some("/p/bad")).id, "gemini", "an unknown project choice falls through");
        assert_eq!(chosen_in(&json!({}), None).id, "claude-acp");
        assert_eq!(chosen_in(&json!({ "agent": "codex" }), None).id, "codex-acp", "a legacy name still reads");
    }

    #[test]
    fn login_json_names_the_kind() {
        assert_eq!(login_json(Login::Terminal { command: "codex login" }), json!({ "kind": "terminal", "command": "codex login" }));
        assert_eq!(login_json(Login::AuthMethod { id: "oauth-personal" }), json!({ "kind": "auth_method", "id": "oauth-personal" }));
        assert_eq!(login_json(Login::None), json!({ "kind": "none" }));
    }
}
```

Create `src-tauri/src/agents/mod.rs`:

```rust
//! The agents Chronicle can drive through ACP (spec 2026-10-15 §3-§8): one
//! profile per agent, launched from the bundled registry at a pinned version.
pub mod profiles;
pub mod registry;

pub use profiles::{claude, profile, AgentProfile, PROFILES};
```

Add `mod agents;` to `src-tauri/src/main.rs` after `mod acp;` (line 8).

- [ ] **Step 2: Run them to see them fail**

Run: `export PATH="$HOME/.cargo/bin:$PATH" && cd src-tauri && cargo test agents:: 2>&1 | tail -20`
Expected: compile errors — `bundled`, `launch_spec_in`, `PROFILES`, `migrate_config` … not found.

- [ ] **Step 3: `profiles.rs` — the table**

Above the test module in `src-tauri/src/agents/profiles.rs`:

```rust
//! Agent profiles — what Chronicle knows about each agent, as data. Launch
//! instructions are NOT here: they come from the bundled ACP registry entry
//! for `id` at `registry_version` (registry.rs). The Codex, Gemini CLI and
//! OpenCode values were recorded by the probe (spec §11, "Probe result").

use serde_json::{json, Value};

/// How a signed-out user signs in (spec §5).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Login {
    /// Type this into a terminal tab; the session restarts when that tab exits.
    Terminal { command: &'static str },
    /// The adapter's own `authenticate` with this method id works headless.
    AuthMethod { id: &'static str },
    /// The agent runs on its own keys and config.
    None,
}

/// The agent's mode id for each of Chronicle's stances (spec §6). `None`: no such mode.
#[derive(Debug, Clone, Copy)]
pub struct Modes {
    pub ask: Option<&'static str>,
    pub execute: Option<&'static str>,
    pub auto: Option<&'static str>,
    pub unattended: Option<&'static str>,
}

/// JSON pointers into a tool call / usage update (spec §7). Relative to the
/// update object; `~1` escapes a `/` inside a key, as RFC 6901 says.
#[derive(Debug, Clone, Copy)]
pub struct MetaKeys {
    pub parent_tool_use: Option<&'static str>,
    pub tool_name: Option<&'static str>,
    /// A boolean the agent sets on a call that IS a subagent.
    pub subagent: Option<&'static str>,
    /// Tool names that are subagents even without the flag.
    pub subagent_tools: &'static [&'static str],
    pub rate_limit: Option<&'static str>,
}

pub const NO_META: MetaKeys = MetaKeys { parent_tool_use: None, tool_name: None, subagent: None, subagent_tools: &[], rate_limit: None };

/// What a session may be given beyond the prompt (spec §8).
#[derive(Debug, Clone, Copy)]
pub struct Extras { pub mcp_servers: bool, pub plugins: bool, pub settings: bool }

/// Where a signed-in agent leaves its login, for the Setup row (probe-recorded).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Credentials { ClaudeKeychain, HomeFile(&'static str), Unknown }

/// An npx package to run while the profile's pin is not in the bundled registry.
#[derive(Debug, Clone, Copy)]
pub struct PinnedNpx { pub package: &'static str, pub args: &'static [&'static str] }

#[derive(Debug)]
pub struct AgentProfile {
    pub id: &'static str,
    pub name: &'static str,
    pub registry_version: &'static str,
    pub pinned_npx: Option<PinnedNpx>,
    /// false: the probe did not pass on this Mac — listed as "not yet supported".
    pub shipped: bool,
    pub login: Login,
    pub modes: Modes,
    pub meta: MetaKeys,
    pub extras: Extras,
    /// The agent's own CLI the adapter needs on this Mac (claude-acp wraps `claude`).
    pub requires_cli: Option<&'static str>,
    /// Env vars blanked on spawn so the agent uses its own login, never a stray key.
    pub blank_env: &'static [&'static str],
    pub credentials: Credentials,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stance { Ask, Execute, Auto, Unattended }

impl Stance {
    pub const ALL: [Stance; 4] = [Stance::Ask, Stance::Execute, Stance::Auto, Stance::Unattended];
    pub fn parse(s: &str) -> Option<Stance> {
        match s { "ask" => Some(Stance::Ask), "execute" => Some(Stance::Execute), "auto" => Some(Stance::Auto), "unattended" => Some(Stance::Unattended), _ => None }
    }
    pub fn as_str(self) -> &'static str {
        match self { Stance::Ask => "ask", Stance::Execute => "execute", Stance::Auto => "auto", Stance::Unattended => "unattended" }
    }
}

const ALL_EXTRAS: Extras = Extras { mcp_servers: true, plugins: true, settings: true };
const MCP_ONLY: Extras = Extras { mcp_servers: true, plugins: false, settings: false };

pub static PROFILES: [AgentProfile; 4] = [
    AgentProfile {
        id: "claude-acp",
        name: "Claude Code",
        registry_version: "0.75.1",
        pinned_npx: Some(PinnedNpx { package: "@agentclientprotocol/claude-agent-acp@0.75.1", args: &[] }),
        shipped: true,
        login: Login::Terminal { command: "claude /login" },
        modes: Modes { ask: Some("default"), execute: Some("acceptEdits"), auto: Some("auto"), unattended: Some("bypassPermissions") },
        meta: MetaKeys {
            parent_tool_use: Some("/_meta/claudeCode/parentToolUseId"),
            tool_name: Some("/_meta/claudeCode/toolName"),
            subagent: Some("/_meta/claudeCode/subagent"),
            subagent_tools: &["Agent", "Task"],
            rate_limit: Some("/_meta/_claude~1rateLimit"),
        },
        extras: ALL_EXTRAS,
        requires_cli: Some("claude"),
        blank_env: &["ANTHROPIC_API_KEY"],
        credentials: Credentials::ClaudeKeychain,
    },
    AgentProfile {
        id: "codex-acp",
        name: "Codex",
        registry_version: "2.2.3-preview.10",
        pinned_npx: None,
        shipped: true,
        login: Login::Terminal { command: "codex login" },
        modes: Modes { ask: Some("read-only"), execute: None, auto: Some("auto"), unattended: Some("full-access") },
        meta: NO_META,
        extras: MCP_ONLY,
        requires_cli: None,
        blank_env: &[],
        credentials: Credentials::HomeFile(".codex/auth.json"),
    },
    AgentProfile {
        id: "gemini",
        name: "Gemini CLI",
        registry_version: "0.64.0",
        pinned_npx: None,
        shipped: true,
        login: Login::AuthMethod { id: "oauth-personal" },
        modes: Modes { ask: Some("default"), execute: Some("autoEdit"), auto: None, unattended: Some("yolo") },
        meta: NO_META,
        extras: MCP_ONLY,
        requires_cli: None,
        blank_env: &[],
        credentials: Credentials::HomeFile(".gemini/oauth_creds.json"),
    },
    AgentProfile {
        id: "opencode",
        name: "OpenCode",
        registry_version: "1.19.0",
        pinned_npx: None,
        shipped: true,
        login: Login::None,
        modes: Modes { ask: None, execute: None, auto: None, unattended: None },
        meta: NO_META,
        extras: MCP_ONLY,
        requires_cli: None,
        blank_env: &[],
        credentials: Credentials::HomeFile(".local/share/opencode/auth.json"),
    },
];

pub fn profile(id: &str) -> Option<&'static AgentProfile> {
    PROFILES.iter().find(|p| p.id == id)
}

pub fn claude() -> &'static AgentProfile {
    &PROFILES[0]
}

/// A stored agent name (old or new) → the profile id.
pub fn canonical_id(s: &str) -> Option<&'static str> {
    match s {
        "claude" | "claude-acp" => Some("claude-acp"),
        "codex" | "codex-acp" => Some("codex-acp"),
        "gemini" => Some("gemini"),
        "opencode" => Some("opencode"),
        _ => None,
    }
}

fn shipped_by_name(s: Option<&str>) -> Option<&'static AgentProfile> {
    s.and_then(canonical_id).and_then(profile).filter(|p| p.shipped)
}

/// The agent for a project: its own choice, else the default, else Claude Code.
pub fn chosen_in(cfg: &Value, project: Option<&str>) -> &'static AgentProfile {
    let own = project.and_then(|k| cfg.pointer("/project_agents").and_then(|m| m.get(k))).and_then(Value::as_str);
    shipped_by_name(own)
        .or_else(|| shipped_by_name(cfg.get("agent").and_then(Value::as_str)))
        .unwrap_or_else(claude)
}

/// `"claude"` → `"claude-acp"`, `"codex"` → `"codex-acp"` (spec §3). True when it changed something.
pub fn migrate_config(cfg: &mut Value) -> bool {
    let Some(cur) = cfg.get("agent").and_then(Value::as_str).map(String::from) else { return false };
    match canonical_id(&cur) {
        Some(id) if id != cur => { cfg["agent"] = json!(id); true }
        _ => false,
    }
}

pub fn login_json(l: Login) -> Value {
    match l {
        Login::Terminal { command } => json!({ "kind": "terminal", "command": command }),
        Login::AuthMethod { id } => json!({ "kind": "auth_method", "id": id }),
        Login::None => json!({ "kind": "none" }),
    }
}

pub fn mode_for(p: &AgentProfile, s: Stance) -> Option<&'static str> {
    match s { Stance::Ask => p.modes.ask, Stance::Execute => p.modes.execute, Stance::Auto => p.modes.auto, Stance::Unattended => p.modes.unattended }
}

/// `{ "<stance>": "<mode id>" }` for each stance whose mode the session advertised.
pub fn stances(p: &AgentProfile, modes: &Value) -> Value {
    let advertised: Vec<&str> = modes.get("availableModes").and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|m| m.get("id").and_then(Value::as_str)).collect()).unwrap_or_default();
    let mut out = serde_json::Map::new();
    for s in Stance::ALL {
        if let Some(id) = mode_for(p, s).filter(|id| advertised.contains(id)) {
            out.insert(s.as_str().into(), json!(id));
        }
    }
    Value::Object(out)
}
```

Then copy each cell of the spec's §11 probe table over the Codex, Gemini CLI and OpenCode values (and Claude's, if the table differs): `login`, `modes`, `meta` (a namespace the probe found becomes `Some("/_meta/<path>")`), `credentials`, `shipped`.

- [ ] **Step 4: `registry.rs` — the loader**

Above the test module in `src-tauri/src/agents/registry.rs`:

```rust
//! The bundled ACP registry (agentclientprotocol/registry, refreshed at release
//! time by scripts/acp-registry.mjs). Chronicle launches an agent only from the
//! entry at its profile's pinned version: what ships is what was probed.

use super::profiles::AgentProfile;
use serde::Deserialize;
use std::collections::HashMap;

#[derive(Debug, Deserialize)]
pub struct Registry { pub version: String, pub agents: Vec<Entry> }

#[derive(Debug, Deserialize)]
pub struct Entry {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub distribution: Distribution,
}

#[derive(Debug, Default, Deserialize)]
pub struct Distribution {
    pub npx: Option<NpxDist>,
    pub binary: Option<HashMap<String, BinaryTarget>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NpxDist { pub package: String, #[serde(default)] pub args: Vec<String> }

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct BinaryTarget {
    pub archive: String,
    pub cmd: String,
    #[serde(default)]
    pub args: Vec<String>,
    pub sha256: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum LaunchSpec {
    Npx { package: String, args: Vec<String> },
    Binary { version: String, target: BinaryTarget },
}

pub fn parse(text: &str) -> Result<Registry, String> {
    serde_json::from_str(text).map_err(|e| format!("the agent registry didn't parse: {e}"))
}

pub fn bundled() -> &'static Registry {
    static REG: std::sync::OnceLock<Registry> = std::sync::OnceLock::new();
    REG.get_or_init(|| parse(include_str!("../../resources/acp-registry.json")).expect("the bundled registry is valid JSON"))
}

/// The registry's platform token: `darwin-aarch64`, `darwin-x86_64`, `linux-…`.
pub fn platform_key() -> String {
    let os = match std::env::consts::OS { "macos" => "darwin", other => other };
    format!("{os}-{}", std::env::consts::ARCH)
}

pub fn launch_spec_in(reg: &Registry, p: &AgentProfile, platform: &str) -> Option<LaunchSpec> {
    if let Some(e) = reg.agents.iter().find(|e| e.id == p.id && e.version == p.registry_version) {
        if let Some(n) = &e.distribution.npx {
            return Some(LaunchSpec::Npx { package: n.package.clone(), args: n.args.clone() });
        }
        return e.distribution.binary.as_ref()?.get(platform)
            .map(|t| LaunchSpec::Binary { version: e.version.clone(), target: t.clone() });
    }
    p.pinned_npx.map(|n| LaunchSpec::Npx { package: n.package.to_string(), args: n.args.iter().map(|s| s.to_string()).collect() })
}

/// The launch for this Mac, or None: not shipped, not pinned in the registry, or no build for this platform.
pub fn launch_spec(p: &AgentProfile) -> Option<LaunchSpec> {
    if !p.shipped { return None; }
    launch_spec_in(bundled(), p, &platform_key())
}
```

- [ ] **Step 5: Run the tests**

Run: `export PATH="$HOME/.cargo/bin:$PATH" && cd src-tauri && cargo test agents:: 2>&1 | tail -20`
Expected: 13 tests pass. If `profiles_agree_with_the_probe_fixtures` fails, the profile disagrees with what the agent advertised: correct the profile from the spec's probe table, never the fixture. `cargo build` may warn that `mode_for`, `stances`, `Stance::ALL` are unused; they are used from Task 8.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/agents/mod.rs src-tauri/src/agents/profiles.rs src-tauri/src/agents/registry.rs src-tauri/src/main.rs
git commit -m "feat(agents): four agent profiles from the probe, launched from the bundled registry at their pinned versions

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Installing and launching an agent per distribution (§4)

The connector generalises from one pinned package to "the chosen agent's connector", installed into `~/.chronicle/tools/agents/<id>/`: npm packages by `npm install --prefix` and launched by node directly; binaries downloaded, checked against the registry's sha256 and unpacked. `ADAPTER_PACKAGE`/`ADAPTER_VERSION` go away.

**Files:**
- Modify: `src-tauri/src/acp.rs` (lines 20-31: remove the pin constants; lines 926-962: `AdapterLaunch`, `adapter_command_for`, remove `adapter_command`; tests at ~2206-2270 and ~2735)
- Modify: `src-tauri/src/setup.rs` (lines 664-702: replace `adapter_dir`/`adapter_entry_in`/`adapter_launch`/`install_adapter`; `detect` arm `"connector"`; `install`; tests ~805-845)
- Modify: `src-tauri/src/main.rs` (`agent_session_start` line ~3414 and `agent_session_resume` ~3440)
- Test: in-file `#[cfg(test)]` modules of `setup.rs` and `acp.rs`

**Interfaces:**
- Consumes: `agents::registry::{launch_spec, LaunchSpec, BinaryTarget}`, `agents::profiles::{chosen_in, claude, profile, AgentProfile}` (Task 2); `download`, `sha256_file`, `extract_zip`, `extract_tar_gz`, `resolve`, `tool_env_path`, `emit_state` (setup.rs, existing).
- Produces, in `acp.rs`:
  - `pub enum AdapterLaunch { Direct { node: String, entry: PathBuf, args: Vec<String> }, Npx { npx: String, package: String, args: Vec<String> }, Binary { program: PathBuf, args: Vec<String> } }`
  - `pub fn adapter_command_for(launch: &AdapterLaunch, profile: &AgentProfile) -> std::process::Command` — blanks `profile.blank_env`, removes `CLAUDECODE`, sets the child PATH from the launched tool's dir
- Produces, in `setup.rs`:
  - `pub fn agent_dir(id: &str) -> PathBuf` = `~/.chronicle/tools/agents/<id>`
  - `pub fn split_package(spec: &str) -> Option<(&str, &str)>` — `"@a/b@1.2"` → `("@a/b", "1.2")`
  - `pub fn npx_entry_in(dir: &Path, spec: &str) -> Option<PathBuf>` — the package's `bin` entry, only when the installed version is exactly `spec`'s
  - `pub fn binary_entry_in(dir: &Path, version: &str, cmd: &str) -> Option<PathBuf>` — only when `<dir>/.chronicle-version` reads `version`
  - `pub fn verify_sha256(path: &Path, want: &str) -> Result<(), String>`; `pub fn unpack_verified(archive: &Path, dir: &Path, version: &str, t: &BinaryTarget) -> Result<(), String>` — unpacks into `<dir>.staging` and swaps only after the checksum and the program check pass
  - `pub fn agent_launch_in(dir: &Path, spec: &LaunchSpec, node: Option<String>, npx: Option<String>) -> Option<AdapterLaunch>`; `pub fn agent_launch(id: &str) -> Option<AdapterLaunch>`; `pub fn migrate_legacy_adapter()`
  - `pub fn installed_version(dir: &Path, spec: &LaunchSpec) -> Option<String>`
  - `pub fn chosen_agent_for(project: Option<&str>) -> &'static AgentProfile` (reads `config.json` through `crate::config_dir()`); `pub fn chosen_agent() -> &'static AgentProfile`
  - check `"connector"` = the chosen agent's connector, its JSON carries `"agent": <id>`; install ids `"connector"` and `"agent:<id>"`; progress events use the same id

- [ ] **Step 1: Write the failing tests**

In `src-tauri/src/setup.rs` `mod setup_tests`, replace `fake_adapter`, `adapter_entry_resolves_the_pinned_install` and `adapter_entry_ignores_a_stale_install` (lines ~805-831) with:

```rust
    const CLAUDE_PIN: &str = "@agentclientprotocol/claude-agent-acp@0.75.1";

    fn fake_npm_install(dir: &Path, name: &str, version: &str, bin: &str, script: &str) {
        let pkg = dir.join("node_modules").join(name);
        std::fs::create_dir_all(pkg.join(bin).parent().unwrap()).unwrap();
        let short = name.rsplit('/').next().unwrap();
        std::fs::write(pkg.join("package.json"), format!(r#"{{"name":"{name}","version":"{version}","bin":{{"{short}":"{bin}"}}}}"#)).unwrap();
        std::fs::write(pkg.join(bin), script).unwrap();
    }

    #[test]
    fn a_package_spec_splits_at_its_last_at() {
        assert_eq!(split_package(CLAUDE_PIN), Some(("@agentclientprotocol/claude-agent-acp", "0.75.1")));
        assert_eq!(split_package("@google/gemini-cli@0.64.0"), Some(("@google/gemini-cli", "0.64.0")));
        assert_eq!(split_package("@scoped/only"), None);
    }

    #[test]
    fn an_npm_install_resolves_its_bin_only_at_the_pinned_version() {
        let d = tmp("npx-entry");
        fake_npm_install(&d, "@agentclientprotocol/claude-agent-acp", "0.75.1", "dist/index.js", "#!/usr/bin/env node\n");
        let e = npx_entry_in(&d, CLAUDE_PIN).expect("the pinned install resolves");
        assert!(e.ends_with("dist/index.js"), "{e:?}");
        // a stale install after a pin bump must look like no install
        assert!(npx_entry_in(&d, "@agentclientprotocol/claude-agent-acp@0.90.1-preview.15").is_none());
    }

    #[test]
    fn a_node_bin_runs_under_node_and_a_native_bin_runs_as_itself() {
        let d = tmp("launch-npx");
        fake_npm_install(&d, "@agentclientprotocol/claude-agent-acp", "0.75.1", "dist/index.js", "#!/usr/bin/env node\n");
        let spec = LaunchSpec::Npx { package: CLAUDE_PIN.into(), args: vec!["--x".into()] };
        let l = agent_launch_in(&d, &spec, Some("/n/node".into()), Some("/n/npx".into())).unwrap();
        assert!(matches!(&l, crate::acp::AdapterLaunch::Direct { node, args, .. } if node == "/n/node" && args == &vec!["--x".to_string()]), "{l:?}");
        // no managed install: the npx fallback carries the package and args
        let empty = tmp("launch-npx-empty");
        let f = agent_launch_in(&empty, &spec, Some("/n/node".into()), Some("/n/npx".into())).unwrap();
        assert_eq!(f, crate::acp::AdapterLaunch::Npx { npx: "/n/npx".into(), package: CLAUDE_PIN.into(), args: vec!["--x".into()] });
        assert!(agent_launch_in(&empty, &spec, None, None).is_none(), "no node, no npx, no launch");
        // a package whose bin is a native program launches as itself, node or not
        let native = tmp("launch-native");
        fake_npm_install(&native, "@agentclientprotocol/codex-acp", "2.2.3-preview.10", "bin/codex-acp", "\x7fELF");
        let nspec = LaunchSpec::Npx { package: "@agentclientprotocol/codex-acp@2.2.3-preview.10".into(), args: vec![] };
        assert!(matches!(agent_launch_in(&native, &nspec, None, None), Some(crate::acp::AdapterLaunch::Binary { .. })));
    }

    fn tarball_with(d: &Path, name: &str, body: &str) -> PathBuf {
        let src = d.join("src");
        std::fs::create_dir_all(&src).unwrap();
        std::fs::write(src.join(name), body).unwrap();
        let arc = d.join("agent.tar.gz");
        assert!(std::process::Command::new("tar").args(["-czf"]).arg(&arc).arg("-C").arg(&src).arg(name).output().unwrap().status.success());
        arc
    }

    fn target(archive: &str, sha: String) -> crate::agents::registry::BinaryTarget {
        crate::agents::registry::BinaryTarget { archive: archive.into(), cmd: "./opencode".into(), args: vec!["acp".into()], sha256: sha }
    }

    #[test]
    fn a_verified_archive_unpacks_and_launches_as_a_binary() {
        let d = tmp("unpack-ok");
        let arc = tarball_with(&d, "opencode", "#!/bin/sh\necho hi\n");
        let sha = sha256_file(&arc).unwrap();
        let dir = d.join("agents/opencode");
        unpack_verified(&arc, &dir, "1.19.0", &target("https://x/opencode.tar.gz", sha.clone())).unwrap();
        assert!(binary_entry_in(&dir, "1.19.0", "./opencode").is_some());
        assert!(binary_entry_in(&dir, "1.20.0", "./opencode").is_none(), "another version is not this install");
        assert!(!arc.exists(), "the archive is removed after unpacking");
        let spec = LaunchSpec::Binary { version: "1.19.0".into(), target: target("https://x/opencode.tar.gz", sha) };
        assert!(matches!(agent_launch_in(&dir, &spec, None, None), Some(crate::acp::AdapterLaunch::Binary { args, .. }) if args == vec!["acp".to_string()]));
    }

    #[test]
    fn a_checksum_mismatch_installs_nothing_and_keeps_the_old_install() {
        let d = tmp("unpack-bad");
        let dir = d.join("agents/opencode");
        // a good older install is already there
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("opencode"), "old").unwrap();
        std::fs::write(dir.join(".chronicle-version"), "1.18.0").unwrap();
        let arc = tarball_with(&d, "opencode", "tampered");
        let err = unpack_verified(&arc, &dir, "1.19.0", &target("https://x/opencode.tar.gz", "0".repeat(64))).unwrap_err();
        assert!(err.contains("checksum"), "{err}");
        assert!(!arc.exists(), "a bad download is deleted");
        assert!(!dir.with_extension("staging").exists(), "nothing half-unpacked is left");
        assert_eq!(std::fs::read_to_string(dir.join("opencode")).unwrap(), "old", "the old install survives");
        assert!(binary_entry_in(&dir, "1.18.0", "./opencode").is_some());
    }

    #[test]
    fn an_archive_without_the_listed_program_is_refused() {
        let d = tmp("unpack-noprog");
        let arc = tarball_with(&d, "something-else", "x");
        let sha = sha256_file(&arc).unwrap();
        let dir = d.join("agents/opencode");
        let err = unpack_verified(&arc, &dir, "1.19.0", &target("https://x/opencode.tar.gz", sha)).unwrap_err();
        assert!(err.contains("isn't where"), "{err}");
        assert!(!dir.exists());
    }

    #[test]
    fn the_legacy_adapter_folder_moves_under_agents() {
        let tools = tmp("legacy");
        std::fs::create_dir_all(tools.join("adapter/node_modules")).unwrap();
        migrate_legacy_adapter_in(&tools);
        assert!(tools.join("agents/claude-acp/node_modules").is_dir());
        assert!(!tools.join("adapter").exists());
        migrate_legacy_adapter_in(&tools); // idempotent
        assert!(tools.join("agents/claude-acp/node_modules").is_dir());
    }
```

And in `the_connector_row_is_never_required_and_joins_the_list` (line ~834), after `let c = detect("connector");` add:

```rust
        assert!(crate::agents::profile(c["agent"].as_str().unwrap()).is_some(), "the row names the agent it is for: {c}");
        assert!(["ready", "missing", "blocked"].contains(&c["state"].as_str().unwrap()));
```

(keep the existing `if c["state"] == "missing"` line, but change it to `if c["state"] == "missing" && crate::agents::registry::launch_spec(crate::agents::profile(c["agent"].as_str().unwrap()).unwrap()).is_some() { assert_eq!(c["action"], "install"); }`).

Add `use crate::agents::registry::LaunchSpec;` at the top of `mod setup_tests`.

In `src-tauri/src/acp.rs` `mod acp_tests`, replace `a_direct_launch_runs_node_on_the_entry_with_the_same_env_as_npx`, `an_npx_launch_is_unchanged` and `adapter_command_puts_node_on_the_child_path` (~2206-2270) with:

```rust
    fn args_of(cmd: &std::process::Command) -> Vec<String> {
        cmd.get_args().map(|a| a.to_string_lossy().to_string()).collect()
    }
    fn env_of(cmd: &std::process::Command, key: &str) -> Option<Option<String>> {
        cmd.get_envs().find(|(k, _)| *k == std::ffi::OsStr::new(key)).map(|(_, v)| v.map(|v| v.to_string_lossy().to_string()))
    }

    #[test]
    fn a_direct_launch_runs_node_on_the_entry_with_its_args() {
        let cmd = adapter_command_for(&AdapterLaunch::Direct { node: "/x/bin/node".into(), entry: PathBuf::from("/x/agents/claude-acp/dist/index.js"), args: vec!["--hide-claude-auth".into()] }, crate::agents::claude());
        assert_eq!(cmd.get_program(), std::ffi::OsStr::new("/x/bin/node"));
        assert_eq!(args_of(&cmd), vec!["/x/agents/claude-acp/dist/index.js".to_string(), "--hide-claude-auth".to_string()]);
        assert!(env_of(&cmd, "PATH").flatten().unwrap().starts_with("/x/bin"), "node's own dir leads the PATH");
        assert_eq!(env_of(&cmd, "ANTHROPIC_API_KEY"), Some(Some(String::new())), "Claude's profile blanks the key");
        assert_eq!(env_of(&cmd, "CLAUDECODE"), Some(None));
    }

    #[test]
    fn an_npx_launch_names_the_package_then_its_args() {
        let cmd = adapter_command_for(&AdapterLaunch::Npx { npx: "/opt/homebrew/bin/npx".into(), package: "@google/gemini-cli@0.64.0".into(), args: vec!["--acp".into()] }, crate::agents::profile("gemini").unwrap());
        assert_eq!(args_of(&cmd), vec!["--yes", "--", "@google/gemini-cli@0.64.0", "--acp"]);
        assert!(env_of(&cmd, "PATH").flatten().unwrap().starts_with("/opt/homebrew/bin"), "npx's own dir leads the PATH, so its node shebang resolves");
        assert_eq!(env_of(&cmd, "ANTHROPIC_API_KEY"), None, "only Claude's profile touches that variable");
    }

    #[test]
    fn a_binary_launch_runs_the_program_itself() {
        let cmd = adapter_command_for(&AdapterLaunch::Binary { program: PathBuf::from("/t/agents/opencode/opencode"), args: vec!["acp".into()] }, crate::agents::profile("opencode").unwrap());
        assert_eq!(cmd.get_program(), std::ffi::OsStr::new("/t/agents/opencode/opencode"));
        assert_eq!(args_of(&cmd), vec!["acp"]);
        assert_eq!(env_of(&cmd, "CLAUDECODE"), Some(None));
    }
```

- [ ] **Step 2: Run them to see them fail**

Run: `export PATH="$HOME/.cargo/bin:$PATH" && cd src-tauri && cargo test setup_tests 2>&1 | tail -20`
Expected: compile errors — `split_package`, `npx_entry_in`, `agent_launch_in`, `unpack_verified`, `migrate_legacy_adapter_in` not found, `AdapterLaunch::Direct` has no field `args`.

- [ ] **Step 3: `acp.rs` — the launch enum and the command**

Delete lines 20-31 (the pin comment and `ADAPTER_PACKAGE`/`ADAPTER_VERSION`). Replace the `AdapterLaunch` enum, `adapter_command_for` and `adapter_command` (lines ~926-962) with:

```rust
/// How an agent process is started. Setup decides which is possible
/// (setup::agent_launch); the command is built the same way for all three.
#[derive(Debug, Clone, PartialEq)]
pub enum AdapterLaunch {
    /// A managed npm install, run by node directly (0.2 s).
    Direct { node: String, entry: PathBuf, args: Vec<String> },
    /// `npx --yes -- <package> <args>` — the fallback for npm distributions (2 s).
    Npx { npx: String, package: String, args: Vec<String> },
    /// A managed binary install, or an npm package whose bin is a native program.
    Binary { program: PathBuf, args: Vec<String> },
}

/// Build the spawn for a launch under a profile. The profile's `blank_env`
/// (Claude Code: ANTHROPIC_API_KEY) is blanked so the agent uses its own
/// login (verified: Zed does exactly this).
pub fn adapter_command_for(launch: &AdapterLaunch, profile: &crate::agents::AgentProfile) -> std::process::Command {
    let (program, args): (String, Vec<String>) = match launch {
        AdapterLaunch::Direct { node, entry, args } => (node.clone(), std::iter::once(entry.to_string_lossy().to_string()).chain(args.iter().cloned()).collect()),
        AdapterLaunch::Npx { npx, package, args } => (npx.clone(), ["--yes".to_string(), "--".to_string(), package.clone()].into_iter().chain(args.iter().cloned()).collect()),
        AdapterLaunch::Binary { program, args } => (program.to_string_lossy().to_string(), args.clone()),
    };
    let mut cmd = std::process::Command::new(&program);
    cmd.args(args);
    for k in profile.blank_env {
        cmd.env(k, "");
    }
    // the adapter's inner claude refuses to launch when it thinks it's
    // nested in another Claude Code session — Chronicle's session is a
    // deliberate, independent child, not a nested one
    cmd.env_remove("CLAUDECODE")
        // CRUCIAL for a Finder-launched app: our PATH is minimal
        // (/usr/bin:/bin:/usr/sbin:/sbin), but `npx` is a Node script whose
        // `#!/usr/bin/env node` shebang needs `node` ON THE CHILD'S PATH.
        // Prepend the tool's own dir (node sits beside npx) + the well-known dirs.
        .env("PATH", child_path(&program));
    cmd
}
```

In `acp_real_adapter_round_trip` (~2735) replace `let Some(npx) = crate::find_tool("npx") else { … };` and `adapter_command(&npx)` with:

```rust
        let Some(launch) = crate::setup::agent_launch("claude-acp") else {
            eprintln!("skipped: no way to launch Claude Code's connector on this Mac");
            return;
        };
```

and `adapter_command_for(&launch, crate::agents::claude())` as the last `start` argument.

- [ ] **Step 4: `setup.rs` — install, detect, launch**

Replace lines 664-702 (`/* ===== the agent's connector …` through `install_adapter`) with:

```rust
/* ================= agents' connectors (spec §4) ================= */

use crate::agents::registry::{BinaryTarget, LaunchSpec};

const VERSION_FILE: &str = ".chronicle-version";

fn agents_dir() -> PathBuf { tools_dir().join("agents") }
pub fn agent_dir(id: &str) -> PathBuf { agents_dir().join(id) }

/// `"@scope/name@1.2.3"` → `("@scope/name", "1.2.3")`.
pub fn split_package(spec: &str) -> Option<(&str, &str)> {
    let at = spec.rfind('@').filter(|&i| i > 0)?;
    Some((&spec[..at], &spec[at + 1..]))
}

/// The package's bin entry under an `npm install --prefix <dir>`, only when the
/// installed version is exactly the spec's: a stale install must look like none.
pub fn npx_entry_in(dir: &Path, spec: &str) -> Option<PathBuf> {
    let (name, version) = split_package(spec)?;
    let pkg = dir.join("node_modules").join(name);
    let v: Value = serde_json::from_str(&std::fs::read_to_string(pkg.join("package.json")).ok()?).ok()?;
    if v.get("version").and_then(Value::as_str) != Some(version) { return None; }
    let short = name.rsplit('/').next().unwrap_or(name);
    let bin = match v.get("bin")? {
        Value::String(s) => s.clone(),
        Value::Object(m) => m.get(short).or_else(|| m.values().next())?.as_str()?.to_string(),
        _ => return None,
    };
    let entry = pkg.join(bin);
    entry.is_file().then_some(entry)
}

/// A JavaScript entry (run it with node) rather than a native program.
fn is_node_script(p: &Path) -> bool {
    if matches!(p.extension().and_then(|e| e.to_str()), Some("js" | "mjs" | "cjs")) { return true; }
    let head = std::fs::read(p).map(|b| b.into_iter().take(64).collect::<Vec<u8>>()).unwrap_or_default();
    let head = String::from_utf8_lossy(&head);
    head.starts_with("#!") && head.lines().next().unwrap_or("").contains("node")
}

pub fn binary_entry_in(dir: &Path, version: &str, cmd: &str) -> Option<PathBuf> {
    if std::fs::read_to_string(dir.join(VERSION_FILE)).ok()?.trim() != version { return None; }
    let p = dir.join(cmd.trim_start_matches("./"));
    p.is_file().then_some(p)
}

pub fn verify_sha256(path: &Path, want: &str) -> Result<(), String> {
    match sha256_file(path) {
        Some(got) if got.eq_ignore_ascii_case(want) => Ok(()),
        Some(_) => Err("the download didn't match its published checksum, so nothing was installed".into()),
        None => Err("couldn't read the download".into()),
    }
}

/// Check, unpack beside the install, check the program is there, then swap.
/// A failure at any step leaves the previous install exactly as it was.
pub fn unpack_verified(archive: &Path, dir: &Path, version: &str, t: &BinaryTarget) -> Result<(), String> {
    if let Err(e) = verify_sha256(archive, &t.sha256) {
        let _ = std::fs::remove_file(archive);
        return Err(e);
    }
    let staging = dir.with_extension("staging");
    let _ = std::fs::remove_dir_all(&staging);
    let unpacked = if t.archive.ends_with(".zip") { extract_zip(archive, &staging) } else { extract_tar_gz(archive, &staging) };
    let _ = std::fs::remove_file(archive);
    if let Err(e) = unpacked {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(format!("couldn't unpack the download — {e}"));
    }
    let program = staging.join(t.cmd.trim_start_matches("./"));
    if !program.is_file() {
        let _ = std::fs::remove_dir_all(&staging);
        return Err("the download unpacked, but the agent's program isn't where its listing says".into());
    }
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o755));
    std::fs::write(staging.join(VERSION_FILE), version).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_dir_all(dir);
    if let Some(parent) = dir.parent() { std::fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
    std::fs::rename(&staging, dir).map_err(|e| e.to_string())
}

pub fn agent_launch_in(dir: &Path, spec: &LaunchSpec, node: Option<String>, npx: Option<String>) -> Option<crate::acp::AdapterLaunch> {
    use crate::acp::AdapterLaunch;
    match spec {
        LaunchSpec::Npx { package, args } => {
            if let Some(entry) = npx_entry_in(dir, package) {
                if !is_node_script(&entry) { return Some(AdapterLaunch::Binary { program: entry, args: args.clone() }); }
                if let Some(node) = node { return Some(AdapterLaunch::Direct { node, entry, args: args.clone() }); }
            }
            npx.map(|npx| AdapterLaunch::Npx { npx, package: package.clone(), args: args.clone() })
        }
        LaunchSpec::Binary { version, target } => binary_entry_in(dir, version, &target.cmd)
            .map(|program| AdapterLaunch::Binary { program, args: target.args.clone() }),
    }
}

/// The pane plan installed Claude's adapter at tools/adapter; it now lives with the others.
fn migrate_legacy_adapter_in(tools: &Path) {
    let old = tools.join("adapter");
    let new = tools.join("agents").join("claude-acp");
    if old.is_dir() && !new.exists() {
        let _ = std::fs::create_dir_all(tools.join("agents"));
        let _ = std::fs::rename(&old, &new);
    }
}

/// Called once at app start (main's setup hook): never from a lookup, so a
/// test run never moves the folder the installed app is using.
pub fn migrate_legacy_adapter() { migrate_legacy_adapter_in(&tools_dir()) }

/// Direct from the managed install, npx as the fallback for npm agents, None otherwise.
pub fn agent_launch(id: &str) -> Option<crate::acp::AdapterLaunch> {
    let p = crate::agents::profile(id)?;
    let spec = crate::agents::registry::launch_spec(p)?;
    agent_launch_in(&agent_dir(p.id), &spec, resolve("node"), resolve("npx"))
}

pub fn installed_version(dir: &Path, spec: &LaunchSpec) -> Option<String> {
    match spec {
        LaunchSpec::Npx { package, .. } => npx_entry_in(dir, package).and(split_package(package)).map(|(_, v)| v.to_string()),
        LaunchSpec::Binary { version, target } => binary_entry_in(dir, version, &target.cmd).map(|_| version.clone()),
    }
}

fn read_config() -> Value {
    std::fs::read_to_string(crate::config_dir().join("config.json")).ok()
        .and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_else(|| json!({}))
}

/// The agent a project runs (its own choice, else the default, else Claude Code).
pub fn chosen_agent_for(project: Option<&str>) -> &'static crate::agents::AgentProfile {
    crate::agents::profiles::chosen_in(&read_config(), project)
}
pub fn chosen_agent() -> &'static crate::agents::AgentProfile { chosen_agent_for(None) }

/// The "<Agent>'s connector" row: always about the chosen agent.
fn connector_row(id: &str) -> Value {
    let p = chosen_agent();
    let Some(spec) = crate::agents::registry::launch_spec(p) else {
        return json!({ "id": id, "agent": p.id, "state": "missing", "detail": format!("{} isn't supported on this Mac yet.", p.name), "action": "" });
    };
    if matches!(spec, LaunchSpec::Npx { .. }) && resolve("node").is_none() {
        return json!({ "id": id, "agent": p.id, "state": "blocked", "detail": "Install the engine first.", "action": "" });
    }
    match installed_version(&agent_dir(p.id), &spec) {
        Some(v) => json!({ "id": id, "agent": p.id, "state": "ready", "detail": v, "action": "" }),
        None => json!({ "id": id, "agent": p.id, "state": "missing", "detail": "", "action": "install" }),
    }
}

/// Install one agent's connector; progress is emitted under `check` ("connector" or "agent:<id>").
fn install_agent(check: &str, agent: &str, emit: &Emit, cancel: &AtomicBool) -> Result<(), String> {
    let p = crate::agents::profile(agent).ok_or("Chronicle doesn't know that agent")?;
    let spec = crate::agents::registry::launch_spec(p).ok_or_else(|| format!("{} isn't supported on this Mac yet", p.name))?;
    let dir = agent_dir(p.id);
    match &spec {
        LaunchSpec::Npx { package, .. } => {
            let npm = resolve("npm").ok_or("the engine isn't installed yet — install it first")?;
            emit_state(emit, check, json!({ "state": "installing", "pct": Value::Null }));
            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            let out = std::process::Command::new(&npm)
                .args(["install", "--prefix"]).arg(&dir)
                .args(["--no-audit", "--no-fund", "--no-package-lock", package])
                .env("PATH", tool_env_path())
                .stdin(std::process::Stdio::null())
                .output()
                .map_err(|e| e.to_string())?;
            if !out.status.success() {
                return Err(format!("couldn't install {}'s connector: {}", p.name, String::from_utf8_lossy(&out.stderr).lines().last().unwrap_or("npm failed")));
            }
            npx_entry_in(&dir, package).map(|_| ()).ok_or_else(|| "installed, but the connector's files aren't where expected".to_string())
        }
        LaunchSpec::Binary { version, target } => {
            let archive = agents_dir().join(format!("{}.download", p.id));
            download(&target.archive, &archive, check, emit, cancel)?;
            unpack_verified(&archive, &dir, version, target)
        }
    }
}
```

In `detect`, replace the whole `"connector" => { … }` arm with `"connector" => return connector_row(id),`.

In `install`, replace `"connector" => install_adapter(emit, cancel),` with:

```rust
        "connector" => install_agent("connector", chosen_agent().id, emit, cancel),
        other if other.starts_with("agent:") => install_agent(other, &other["agent:".len()..], emit, cancel),
```

`emit_done(emit, id)` for an `agent:<id>` check calls `detect("agent:<id>")`, which returns `state: "unknown"`; give `detect` one more arm before `_`:

```rust
        other if other.starts_with("agent:") => {
            let Some(p) = crate::agents::profile(&other["agent:".len()..]) else { return json!({ "id": id, "state": "unknown" }) };
            let ready = crate::agents::registry::launch_spec(p).and_then(|s| installed_version(&agent_dir(p.id), &s));
            return match ready {
                Some(v) => json!({ "id": id, "agent": p.id, "state": "ready", "detail": v, "action": "" }),
                None => json!({ "id": id, "agent": p.id, "state": "missing", "detail": "", "action": "install" }),
            };
        }
```

- [ ] **Step 5: `main.rs` — the legacy folder, and the two spawn sites (still Claude Code; Task 5 makes them per project)**

In main's `.setup(|app| …)` hook, on the line after the existing `setup::set_resource_dir(…)` call, add:

```rust
            setup::migrate_legacy_adapter(); // tools/adapter → tools/agents/claude-acp, once
```


In `agent_session_start` and `agent_session_resume`, replace

```rust
    let launch = setup::adapter_launch().ok_or("the agent needs Node.js — install it from Setup & health, then try again")?;
```

with

```rust
    let profile = agents::claude();
    let launch = setup::agent_launch(profile.id).ok_or("the agent needs Node.js — install it from Setup & health, then try again")?;
```

and `acp::adapter_command_for(&launch)` with `acp::adapter_command_for(&launch, profile)`.

- [ ] **Step 6: Run the Rust tests**

Run: `export PATH="$HOME/.cargo/bin:$PATH" && cd src-tauri && cargo test 2>&1 | tail -5`
Expected: all pass, including the 7 new setup tests and the 3 rewritten acp launch tests. `grep -n "ADAPTER_\|adapter_launch()\|adapter_entry_in\|install_adapter" src-tauri/src/*.rs` prints nothing.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/acp.rs src-tauri/src/setup.rs src-tauri/src/main.rs
git commit -m "feat(agents): each agent's connector installs into the managed tools from its registry entry; binaries are checksum-verified and swapped in only when whole

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Choosing the agent — config migration, the project's agent, and the status the UI reads (§3)

**Files:**
- Modify: `src-tauri/src/main.rs` (`load_config` line ~429, `agents_available` ~436, `set_default_agent` ~451, new `save_config`, `set_project_agent`, `agents_status`, `agent_row`; the `generate_handler!` list ~4039; a new test module `agents_choice_tests`)
- Modify: `src-tauri/src/setup.rs` (new `pub fn signed_in(p) -> Option<bool>`)
- Modify: `src/lib/ipc.ts` (`agentsAvailable`, new `agentsStatus`, `setProjectAgent`, types)
- Modify: `src/App.tsx` (line ~609), `src/lib/agent-session.ts` (`warmAgentSession`, line ~882), `src/lib/agent-session.warm.test.ts` (the `agentsAvailable` mock, line 14)

**Interfaces:**
- Consumes: `agents::profiles::{migrate_config, chosen_in, canonical_id, login_json, PROFILES}` (Task 2); `setup::{agent_launch, resolve, chosen_agent_for}` (Task 3); `canon_key(dir) -> Result<(String, PathBuf), String>` (main.rs, existing).
- Produces:
  - `config.json` shape: `agent: "<id>"` (the default), `project_agents: { "<canonical project path>": "<id>" }`
  - Tauri `agents_available(dir: Option<String>) -> { claude, codex, default: <id>, project: <id>, launchable: bool }` (`claude`/`codex` keep their CLI paths for the roadmap writer)
  - Tauri `agents_status(dir: Option<String>) -> { agents: [{ id, name, supported, launchable, installed, missing, signedIn, login }], default, project }`
  - Tauri `set_default_agent(agent)` accepts old names and ids; `set_project_agent(dir, agent: Option<String>)` (`None` clears the project's own choice)
  - `setup::signed_in(p: &AgentProfile) -> Option<bool>` (`None` = can't tell)
  - TS: `agentsAvailable(dir?: string)`, `agentsStatus(dir: string | null): Promise<AgentsStatus>`, `setProjectAgent(dir, agent | null)`, `interface AgentStatusRow`, `interface AgentsStatus`

- [ ] **Step 1: Write the failing tests**

At the end of `src-tauri/src/main.rs` add:

```rust
#[cfg(test)]
mod agents_choice_tests {
    use super::*;

    #[test]
    fn an_agent_row_says_what_the_ui_needs() {
        let row = agent_row(agents::claude());
        for k in ["id", "name", "supported", "launchable", "installed", "missing", "signedIn", "login"] {
            assert!(row.get(k).is_some(), "{k} in {row}");
        }
        assert_eq!(row["login"]["kind"], "terminal");
        assert_eq!(row["login"]["command"], "claude /login");
    }

    #[test]
    fn a_project_choice_is_written_and_cleared_by_canonical_path() {
        let mut cfg = json!({ "agent": "claude-acp" });
        write_project_agent(&mut cfg, "/p/one", Some("codex")).unwrap();
        assert_eq!(cfg["project_agents"]["/p/one"], "codex-acp", "old names are stored as ids");
        assert!(write_project_agent(&mut cfg, "/p/one", Some("amp-acp")).is_err(), "only the four");
        write_project_agent(&mut cfg, "/p/one", None).unwrap();
        assert!(cfg["project_agents"].get("/p/one").is_none());
    }
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `export PATH="$HOME/.cargo/bin:$PATH" && cd src-tauri && cargo test agents_choice_tests 2>&1 | tail -20`
Expected: compile errors — `agent_row`, `write_project_agent` not found.

- [ ] **Step 3: `main.rs` — config, choice and status**

Replace `load_config`, `agents_available` and `set_default_agent` (lines ~429-458) with:

```rust
fn load_config() -> Value {
    let mut cfg = std::fs::read_to_string(config_dir().join("config.json"))
        .ok().and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| json!({}));
    // "claude"/"codex" → the registry ids, once, on the first read after the update
    if agents::profiles::migrate_config(&mut cfg) { let _ = save_config(&cfg); }
    cfg
}

fn save_config(cfg: &Value) -> Result<(), String> {
    let _ = std::fs::create_dir_all(config_dir());
    std::fs::write(config_dir().join("config.json"), serde_json::to_string_pretty(cfg).unwrap_or_default()).map_err(|e| e.to_string())
}

/// The canonical key a project's own agent choice is stored under.
fn project_key(dir: &str) -> Option<String> { canon_key(dir).ok().map(|(k, _)| k) }

#[tauri::command]
fn agents_available(dir: Option<String>) -> Value {
    let (claude, codex) = agent_paths();
    let cfg = load_config();
    let default = agents::profiles::chosen_in(&cfg, None);
    let project = agents::profiles::chosen_in(&cfg, dir.as_deref().and_then(project_key).as_deref());
    let cli_ok = project.requires_cli.map(|c| setup::resolve(c).is_some()).unwrap_or(true);
    let launchable = cli_ok && setup::agent_launch(project.id).is_some();
    json!({ "claude": claude, "codex": codex, "default": default.id, "project": project.id, "launchable": launchable })
}

#[tauri::command]
fn set_default_agent(agent: String) -> Result<(), String> {
    let id = agents::profiles::canonical_id(&agent).ok_or_else(|| format!("Chronicle doesn't know an agent called {agent}"))?;
    let mut cfg = load_config();
    if let Some(obj) = cfg.as_object_mut() { obj.insert("agent".into(), json!(id)); }
    save_config(&cfg)
}

/// Pure: set or clear one project's agent in the config value.
fn write_project_agent(cfg: &mut Value, key: &str, agent: Option<&str>) -> Result<(), String> {
    if !cfg.get("project_agents").map(Value::is_object).unwrap_or(false) { cfg["project_agents"] = json!({}); }
    let map = cfg["project_agents"].as_object_mut().ok_or("bad config")?;
    match agent {
        Some(a) => { let id = agents::profiles::canonical_id(a).ok_or_else(|| format!("Chronicle doesn't know an agent called {a}"))?; map.insert(key.into(), json!(id)); }
        None => { map.remove(key); }
    }
    Ok(())
}

#[tauri::command]
fn set_project_agent(dir: String, agent: Option<String>) -> Result<(), String> {
    let key = project_key(&dir).ok_or("that project can't be found")?;
    let mut cfg = load_config();
    write_project_agent(&mut cfg, &key, agent.as_deref())?;
    save_config(&cfg)
}

/// One agent as the Your agent row and the composer's picker see it.
fn agent_row(p: &'static agents::AgentProfile) -> Value {
    let supported = agents::registry::launch_spec(p).is_some();
    let launch = setup::agent_launch(p.id);
    let installed = matches!(launch, Some(acp::AdapterLaunch::Direct { .. }) | Some(acp::AdapterLaunch::Binary { .. }));
    let missing = p.requires_cli.filter(|c| setup::resolve(c).is_none());
    json!({
        "id": p.id, "name": p.name, "supported": supported,
        "launchable": launch.is_some() && missing.is_none(),
        "installed": installed, "missing": missing,
        "signedIn": setup::signed_in(p),
        "login": agents::profiles::login_json(p.login),
    })
}

#[tauri::command]
async fn agents_status(dir: Option<String>) -> Value {
    let cfg = load_config();
    let key = dir.as_deref().and_then(project_key);
    let rows: Vec<Value> = agents::PROFILES.iter().map(agent_row).collect();
    json!({ "agents": rows, "default": agents::profiles::chosen_in(&cfg, None).id, "project": agents::profiles::chosen_in(&cfg, key.as_deref()).id })
}
```

(`agents_status` is `async` because `signed_in` may run `claude auth status`; Tauri runs async commands off the main thread.) Add `agents_status, set_project_agent,` to the `generate_handler!` list after `set_default_agent,`.

In `init_start` (line ~1571), make the codex branch read either form of the name:

```rust
    let use_codex = matches!(agent.as_deref(), Some("codex") | Some("codex-acp"))
```

- [ ] **Step 4: `setup.rs` — signed in, per profile**

Below `claude_signed_in`:

```rust
/// Is this agent signed in? `None` when Chronicle can't tell (the pane's own
/// needs-login flow is the safety net, so "can't tell" never nags).
pub fn signed_in(p: &crate::agents::AgentProfile) -> Option<bool> {
    use crate::agents::profiles::Credentials;
    match p.credentials {
        Credentials::ClaudeKeychain => resolve("claude").map(|_| claude_signed_in()),
        Credentials::HomeFile(rel) => Some(home().join(rel).exists()),
        Credentials::Unknown => None,
    }
}
```

- [ ] **Step 5: Run the Rust tests**

Run: `export PATH="$HOME/.cargo/bin:$PATH" && cd src-tauri && cargo test 2>&1 | tail -5`
Expected: all pass, including the 2 new tests and Task 2's `legacy_agent_names_migrate_to_ids`.

- [ ] **Step 6: The TypeScript side**

In `src/lib/ipc.ts`, replace the `agentsAvailable` line (166) and add below `setDefaultAgent`:

```ts
export const agentsAvailable = (dir?: string) => invoke<AgentsData>("agents_available", { dir: dir ?? null });

/** One agent as Setup's Your agent row and the composer's picker see it (Rust `agent_row`). */
export interface AgentStatusRow {
  id: string;
  name: string;
  /** false: no launch for this Mac (not pinned, not probed, or no build for this platform) */
  supported: boolean;
  launchable: boolean;
  /** a managed install exists (npm agents can still run through npx without one) */
  installed: boolean;
  /** the agent's own CLI the connector needs, when it is missing */
  missing: string | null;
  /** null: Chronicle can't tell */
  signedIn: boolean | null;
  login: { kind: "terminal"; command: string } | { kind: "auth_method"; id: string } | { kind: "none" };
}
export interface AgentsStatus { agents: AgentStatusRow[]; default: string; project: string }
export const agentsStatus = (dir: string | null) => invoke<AgentsStatus>("agents_status", { dir });
export const setProjectAgent = (dir: string, agent: string | null) => invoke<void>("set_project_agent", { dir, agent });
```

Change the `AgentsData` comment (line 139) to `// agents_available → { claude, codex, default, project, launchable }`.

In `src/App.tsx` line ~609, the roadmap writer's agent reads the new ids:

```ts
        if (d) setAgent(d === "codex-acp" || d === "codex" ? "codex" : "claude");
```

In `src/lib/agent-session.ts` `warmAgentSession`, replace the two lines

```ts
  const a = (await agentsAvailable().catch(() => null)) as { claude?: string | null } | null;
  if (!a?.claude) return;
```

with

```ts
  const a = (await agentsAvailable(splitKey(dir).dir).catch(() => null)) as { launchable?: boolean } | null;
  if (!a?.launchable) return; // the project's agent can't start on this Mac yet: no banner, no spinner
```

and update the doc comment above it: "…otherwise starts one, once, and only when the project's agent can launch — an unconfigured Mac must not open into an error banner."

In `src/lib/agent-session.warm.test.ts` line 14, the mock answers the new shape:

```ts
  agentsAvailable: vi.fn(async () => ({ claude, codex: null, default: claude ? "claude-acp" : "", project: "claude-acp", launchable: !!claude })),
```

- [ ] **Step 7: Run the TypeScript checks**

Run: `npm run typecheck && npx vitest run src/lib/agent-session.warm.test.ts && npx vitest run`
Expected: typecheck clean; the warm tests pass unchanged in meaning ("never warm without Claude installed" now reads `launchable`); the whole suite passes.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/main.rs src-tauri/src/setup.rs src/lib/ipc.ts src/App.tsx src/lib/agent-session.ts src/lib/agent-session.warm.test.ts
git commit -m "feat(agents): the config names agents by registry id, a project can choose its own, and Setup can ask every agent's state

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `acp::start` takes a profile; the chat lane runs the project's agent

**Files:**
- Modify: `src-tauri/src/acp.rs` (`start` signature ~1023; `AcpSession` ~868 gains `profile`; `handshake` extras gating ~1260-1285 and the `ready` emit ~1297; `current_state` ~1896; every `start(` call in `acp_tests`; `design_session` test helper ~2995)
- Modify: `src-tauri/src/main.rs` (`agent_session_start`, `agent_session_resume`)
- Test: `acp_tests`

**Interfaces:**
- Consumes: `agents::AgentProfile`, `agents::claude()`, `setup::{agent_launch, chosen_agent_for}`, `acp::adapter_command_for(&launch, profile)` (Tasks 2-3).
- Produces:
  - `pub fn start(state: &AcpState, emit: Emit, key: String, lane: Lane, profile: &'static AgentProfile, cwd: PathBuf, project_dir: PathBuf, roots: Vec<PathBuf>, designs_root: Option<PathBuf>, extras: LaneExtras, resume: Option<String>, cmd: std::process::Command) -> Result<bool, String>`
  - `impl AcpSession { pub fn profile(&self) -> &'static AgentProfile }`
  - the `ready` state event and `current_state()` carry `"agent": "<id>"`
  - `session/new`/`session/load` send `mcpServers` only when `profile.extras.mcp_servers` and the Claude `_meta` (plugin, design prompt) only when `profile.extras.plugins`

- [ ] **Step 1: Write the failing tests**

In `acp_tests`, below `start_mock`, add a variant that takes the profile, and the two tests:

```rust
    fn start_mock_as(name: &str, profile: &'static crate::agents::AgentProfile, lane: Lane, extras: LaneExtras) -> Option<Harness> {
        let py = python3()?;
        let dir = tmp(name);
        let script = dir.join(".mock-agent.py");
        std::fs::write(&script, MOCK_AGENT).unwrap();
        let mut cmd = std::process::Command::new(py);
        cmd.arg(&script).arg(&dir);
        let (tx, rx) = mpsc::channel::<Value>();
        let emit: Emit = Arc::new(move |v| { let _ = tx.send(v); });
        let state = AcpState::new();
        let key = lane.key(&dir.to_string_lossy());
        let designs = if lane == Lane::Design { Some(dir.join(".chronicle/designs")) } else { None };
        assert!(start(&state, emit, key.clone(), lane, profile, dir.clone(), dir.clone(), vec![dir.clone()], designs, extras, None, cmd).unwrap());
        Some(Harness { state, rx, key, dir })
    }

    #[test]
    fn a_live_session_keeps_its_own_agent() {
        let codex = crate::agents::profile("codex-acp").unwrap();
        let Some(h) = start_mock_as("own-agent", codex, Lane::Chat, LaneExtras::default()) else { return };
        let ready = wait_for(&h.rx, 20, |v| state_is(v, "ready"));
        assert_eq!(ready.pointer("/message/params/agent").and_then(|v| v.as_str()), Some("codex-acp"));
        let s = h.state.get(&h.key).unwrap();
        assert_eq!(s.profile().id, "codex-acp");
        // whatever the config says from now on, this session's agent is fixed until it ends
        assert_eq!(s.current_state()["agent"], "codex-acp");
        h.state.drain();
    }

    #[test]
    fn an_agent_without_plugins_never_gets_claudes_meta() {
        let codex = crate::agents::profile("codex-acp").unwrap();
        let extras = LaneExtras { mcp_servers: vec![json!({ "name": "x", "command": "/usr/bin/true", "args": [], "env": [] })], plugin_dir: Some(PathBuf::from("/nowhere/design-plugin")) };
        let Some(h) = start_mock_as("no-plugins", codex, Lane::Design, extras) else { return };
        wait_for(&h.rx, 20, |v| state_is(v, "ready"));
        let log = std::fs::read_to_string(h.dir.join(".mock-requests.jsonl")).unwrap_or_default();
        let new_req = log.lines().filter_map(|l| serde_json::from_str::<Value>(l).ok()).find(|v| v["method"] == "session/new").unwrap();
        assert!(new_req["params"].get("_meta").is_none(), "plugins and settings are Claude-only: {new_req}");
        assert_eq!(new_req["params"]["mcpServers"][0]["name"], "x", "MCP servers are standard ACP");
        h.state.drain();
    }
```

- [ ] **Step 2: Run them to see them fail**

Run: `export PATH="$HOME/.cargo/bin:$PATH" && cd src-tauri && cargo test acp_tests 2>&1 | tail -20`
Expected: compile errors — `start` takes 11 arguments but 12 were supplied; no method `profile`.

- [ ] **Step 3: The session carries its profile**

In `src-tauri/src/acp.rs`:

1. In `struct AcpSession` after `lane: Lane,` add:

```rust
    /// The agent this session runs, fixed for its whole life (spec §3): the
    /// project switching agents ends this session first, never re-profiles it.
    profile: &'static crate::agents::AgentProfile,
```

2. `start`'s signature gains `profile: &'static crate::agents::AgentProfile,` right after `lane: Lane,`, and the `AcpSession { … }` literal inside it gains `profile,` after `lane,`.

3. Add to `impl AcpSession` (beside `is_alive`):

```rust
    pub fn profile(&self) -> &'static crate::agents::AgentProfile { self.profile }
```

4. In `handshake`, gate the extras. In the `session/load` arm replace

```rust
                let mut load = json!({ "sessionId": old_sid, "cwd": cwd, "mcpServers": self.extras.mcp_servers });
                if let Some(root) = &self.designs_root {
```

with

```rust
                let servers = if self.profile.extras.mcp_servers { self.extras.mcp_servers.clone() } else { Vec::new() };
                let mut load = json!({ "sessionId": old_sid, "cwd": cwd, "mcpServers": servers });
                if let (Some(root), true) = (&self.designs_root, self.profile.extras.plugins) {
```

and in the `session/new` arm replace

```rust
                if !self.extras.mcp_servers.is_empty() {
                    v["mcpServers"] = Value::Array(self.extras.mcp_servers.clone());
                }
                if let Some(root) = &self.designs_root {
```

with

```rust
                if self.profile.extras.mcp_servers && !self.extras.mcp_servers.is_empty() {
                    v["mcpServers"] = Value::Array(self.extras.mcp_servers.clone());
                }
                if let (Some(root), true) = (&self.designs_root, self.profile.extras.plugins) {
```

5. In the `ready` `emit_state` add `"agent": self.profile.id,` after `"state": "ready",`. In `current_state` add `"agent": self.profile.id,` after `"alive"`.

6. Update every `start(` call in `acp_tests` to pass Claude's profile after the lane (7 call sites):

```bash
cd /Users/tuneerguha/Downloads/chronicle
perl -0pi -e 's/(start\(&(?:h\.)?state, emit, [a-z.()]+, Lane::(?:Chat|Design), )/$1crate::agents::claude(), /g' src-tauri/src/acp.rs
grep -cE "Lane::(Chat|Design), crate::agents::claude\(\)" src-tauri/src/acp.rs
```

Expected: `7`. (The two new tests above pass their profile explicitly and are not touched by the substitution because they call `start(&state, emit, key.clone(), lane, profile, …)`.)

7. In the `design_session` test helper add `profile: crate::agents::claude(),` after `lane: Lane::Design,`.

- [ ] **Step 4: `main.rs` — the project's agent for the chat lane, Claude Code for the design lane**

In `agent_session_start`, replace the two lines Task 3 wrote

```rust
    let profile = agents::claude();
    let launch = setup::agent_launch(profile.id).ok_or("the agent needs Node.js — install it from Setup & health, then try again")?;
```

with

```rust
    let profile = session_profile(&dir, lane)?;
    let launch = setup::agent_launch(profile.id).ok_or_else(|| launch_refusal(profile))?;
```

and pass `profile` to `acp::start` after `lane`. Do the same in `agent_session_resume`. Add above `agent_session_start`:

```rust
/// The agent a lane runs: the design lane is Claude Code's alone (spec §8);
/// the chat lane runs the project's chosen agent. Refuses an agent whose own
/// CLI is missing, before any process is spawned.
fn session_profile(dir: &str, lane: acp::Lane) -> Result<&'static agents::AgentProfile, String> {
    let profile = if lane == acp::Lane::Design { agents::claude() } else { setup::chosen_agent_for(project_key(dir).as_deref()) };
    if let Some(cli) = profile.requires_cli.filter(|c| setup::resolve(c).is_none()) {
        return Err(format!("{} needs `{cli}` installed first — Setup & health can install it", profile.name));
    }
    Ok(profile)
}

fn launch_refusal(p: &agents::AgentProfile) -> String {
    match agents::registry::launch_spec(p) {
        None => format!("{} isn't supported on this Mac yet", p.name),
        Some(agents::registry::LaunchSpec::Binary { .. }) => format!("{} isn't installed yet — install it from Setup & health, then try again", p.name),
        Some(_) => "the agent needs Node.js — install it from Setup & health, then try again".into(),
    }
}
```

- [ ] **Step 5: Run the Rust tests**

Run: `export PATH="$HOME/.cargo/bin:$PATH" && cd src-tauri && cargo test 2>&1 | tail -5`
Expected: all pass, including the 2 new tests; `the_design_lane_sends_its_servers_and_plugin_and_the_chat_lane_sends_none` still passes (Claude's profile has `plugins: true`).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/acp.rs src-tauri/src/main.rs
git commit -m "feat(agents): a session runs one agent profile for its whole life; the chat lane starts the project's agent, the design lane stays on Claude Code

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Reading the wire without a namespace — `_chronicle` in Rust (§7)

Rust stamps `_chronicle: { agent, parentId?, toolName?, subagent? }` on every `tool_call`/`tool_call_update` and on a permission ask's `toolCall`, and `_chronicle: { agent, rateLimit? }` on `usage_update`, from the profile's pointers. Stamping happens before the transcript append and before the emit, so live events and stored transcripts carry the same shape. Transcripts written before this update (always Claude Code) are stamped on read. The three `claudeCode.toolName` reads in `acp.rs` become `normalize::tool_name`.

**Files:**
- Create: `src-tauri/src/agents/normalize.rs`
- Modify: `src-tauri/src/agents/mod.rs` (`pub mod normalize;`)
- Modify: `src-tauri/src/acp.rs` (`reader_loop` ~1408, `permission_tool_name` ~725, `design_write_decision` ~806, `design_exit_plan_outcome` ~827, the `ready` emit; tests ~3101 and ~3176)
- Modify: `src-tauri/src/main.rs` (`agent_history_read` ~3474)
- Create (generated by the test in Step 5): `src/lib/__fixtures__/acp-claude-acp.jsonl`, `acp-codex-acp.jsonl`, `acp-gemini.jsonl`, `acp-opencode.jsonl`
- Modify (regenerated by the same test): `src/lib/__fixtures__/agent-fanout.jsonl`, `design-lane.jsonl`, `design-director.jsonl`
- Test: `normalize.rs` `#[cfg(test)]`

**Interfaces:**
- Consumes: `AgentProfile.meta` (Task 2), `AcpSession.profile` (Task 5), the raw fixtures (Task 1).
- Produces:
  - `pub fn normalize(msg: &mut Value, p: &AgentProfile)` — idempotent; a message whose target already has `_chronicle` is left alone
  - `pub fn normalize_permission(params: &mut Value, p: &AgentProfile)` — the same for a bare permission `params`
  - `pub fn tool_name(call: &Value) -> Option<&str>` — the call's `name`, else `_chronicle.toolName`
  - `pub fn ready_extras(msg: &mut Value, p: &AgentProfile)` — adds `agent` (and from Task 8 `stances`) to a `_chronicle/session_state` `ready` line; the handshake's own `ready` emit goes through it so the fixtures and the live event can't drift
  - the normalised fixtures `acp-<id>.jsonl` that Task 7's TypeScript tests replay

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/src/agents/normalize.rs` with its test module:

```rust
#[cfg(test)]
mod normalize_tests {
    use super::*;
    use crate::agents::{claude, profile, PROFILES};
    use serde_json::json;
    use std::path::{Path, PathBuf};

    fn update(u: Value) -> Value { json!({ "jsonrpc": "2.0", "method": "session/update", "params": { "sessionId": "s", "update": u } }) }

    #[test]
    fn claude_parent_name_and_subagent_come_from_its_namespace() {
        let mut m = update(json!({ "sessionUpdate": "tool_call", "toolCallId": "c1", "title": "Bash",
            "_meta": { "claudeCode": { "toolName": "Bash", "parentToolUseId": "T1" } } }));
        normalize(&mut m, claude());
        assert_eq!(m["params"]["update"]["_chronicle"], json!({ "agent": "claude-acp", "parentId": "T1", "toolName": "Bash" }));
        let mut t = update(json!({ "sessionUpdate": "tool_call", "toolCallId": "T1", "_meta": { "claudeCode": { "toolName": "Task" } } }));
        normalize(&mut t, claude());
        assert_eq!(t["params"]["update"]["_chronicle"]["subagent"], true, "a Task is a subagent by name");
        let mut f = update(json!({ "sessionUpdate": "tool_call_update", "toolCallId": "T2", "_meta": { "claudeCode": { "subagent": true, "parentToolUseId": "T2" } } }));
        normalize(&mut f, claude());
        assert_eq!(f["params"]["update"]["_chronicle"], json!({ "agent": "claude-acp", "subagent": true }), "never its own parent");
    }

    #[test]
    fn the_rate_limit_key_with_a_slash_in_it_is_read() {
        let mut m = update(json!({ "sessionUpdate": "usage_update", "used": 1, "size": 2,
            "_meta": { "_claude/rateLimit": { "status": "allowed_warning", "utilization": 71 } } }));
        normalize(&mut m, claude());
        assert_eq!(m["params"]["update"]["_chronicle"]["rateLimit"]["utilization"], 71);
    }

    #[test]
    fn an_agent_without_a_namespace_gets_only_what_the_standard_fields_say() {
        let codex = profile("codex-acp").unwrap();
        let mut m = update(json!({ "sessionUpdate": "tool_call", "toolCallId": "c1", "title": "Run ls", "kind": "execute",
            "_meta": { "claudeCode": { "parentToolUseId": "T1", "toolName": "Bash" } } }));
        normalize(&mut m, codex);
        assert_eq!(m["params"]["update"]["_chronicle"], json!({ "agent": "codex-acp" }), "another agent's namespace is never read");
    }

    #[test]
    fn a_permission_ask_names_its_tool_and_a_name_field_wins() {
        let mut p = json!({ "jsonrpc": "2.0", "id": 7, "method": "session/request_permission", "params": {
            "toolCall": { "toolCallId": "w1", "_meta": { "claudeCode": { "toolName": "Write" } } }, "options": [] } });
        normalize(&mut p, claude());
        assert_eq!(tool_name(&p["params"]["toolCall"]), Some("Write"));
        let named = json!({ "toolCallId": "w2", "name": "Edit", "_chronicle": { "toolName": "Write" } });
        assert_eq!(tool_name(&named), Some("Edit"));
    }

    #[test]
    fn normalising_twice_changes_nothing() {
        let mut m = update(json!({ "sessionUpdate": "tool_call", "toolCallId": "c1", "_meta": { "claudeCode": { "toolName": "Read" } } }));
        normalize(&mut m, claude());
        let once = m.clone();
        normalize(&mut m, profile("gemini").unwrap());
        assert_eq!(m, once, "a stamped line keeps the agent that produced it");
    }

    fn fixtures() -> PathBuf { Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/lib/__fixtures__") }
    fn read_lines(p: &Path) -> Vec<Value> {
        std::fs::read_to_string(p).unwrap_or_else(|e| panic!("{}: {e}", p.display()))
            .lines().filter(|l| !l.trim().is_empty()).map(|l| serde_json::from_str(l).unwrap()).collect()
    }
    fn render(lines: &[Value]) -> String { lines.iter().map(|l| serde_json::to_string(l).unwrap() + "\n").collect() }
    /// Compare with the committed file, or write it with CHRONICLE_WRITE_FIXTURES=1.
    fn check_or_write(path: &Path, text: &str) {
        if std::env::var("CHRONICLE_WRITE_FIXTURES").ok().as_deref() == Some("1") {
            std::fs::write(path, text).unwrap();
        } else {
            let have = std::fs::read_to_string(path).unwrap_or_default();
            assert_eq!(have, text, "{} is stale — run CHRONICLE_WRITE_FIXTURES=1 cargo test normalize_tests", path.display());
        }
    }

    #[test]
    fn every_probe_fixture_normalises_to_its_committed_pane_shape() {
        for p in PROFILES.iter().filter(|p| p.shipped) {
            let mut lines = read_lines(&fixtures().join(format!("acp-{}.raw.jsonl", p.id)));
            for l in lines.iter_mut() { normalize(l, p); ready_extras(l, p); }
            for l in &lines {
                let u = &l["params"]["update"];
                if matches!(u["sessionUpdate"].as_str(), Some("tool_call" | "tool_call_update")) {
                    assert_eq!(u["_chronicle"]["agent"], p.id, "every tool call carries its agent");
                    if p.meta.parent_tool_use.is_none() { assert!(u["_chronicle"].get("parentId").is_none(), "{}: a flat agent never gets a parent", p.id); }
                }
            }
            check_or_write(&fixtures().join(format!("acp-{}.jsonl", p.id)), &render(&lines));
        }
    }

    #[test]
    fn transcripts_from_before_the_update_read_as_claude() {
        // the pane replays these exactly as agent_history_read now serves them
        for name in ["agent-fanout.jsonl", "design-lane.jsonl", "design-director.jsonl"] {
            let mut lines = read_lines(&fixtures().join(name));
            for l in lines.iter_mut() { normalize(l, claude()); }
            check_or_write(&fixtures().join(name), &render(&lines));
        }
    }
}
```

Add `pub mod normalize;` to `src-tauri/src/agents/mod.rs`.

- [ ] **Step 2: Run them to see them fail**

Run: `export PATH="$HOME/.cargo/bin:$PATH" && cd src-tauri && cargo test normalize_tests 2>&1 | tail -20`
Expected: compile errors — `normalize`, `tool_name`, `ready_extras` not found.

- [ ] **Step 3: Write `normalize.rs`**

Above the test module:

```rust
//! One shape for every agent (spec §7). Rust reads each agent's own `_meta`
//! through its profile's pointers and stamps `_chronicle` on what the pane
//! reads; the TypeScript store never looks inside an agent's namespace.

use super::profiles::AgentProfile;
use serde_json::{json, Map, Value};

fn read_str<'a>(v: &'a Value, ptr: Option<&str>) -> Option<&'a str> {
    ptr.and_then(|p| v.pointer(p)).and_then(Value::as_str).filter(|s| !s.is_empty())
}

/// The tool a call is for: the call's own `name`, else the stamped name.
pub fn tool_name(call: &Value) -> Option<&str> {
    call.get("name").and_then(Value::as_str).filter(|s| !s.is_empty())
        .or_else(|| call.pointer("/_chronicle/toolName").and_then(Value::as_str))
}

fn stamp_tool(call: &mut Value, p: &AgentProfile) {
    if !call.is_object() || call.get("_chronicle").is_some() { return; }
    let mut ch = Map::new();
    ch.insert("agent".into(), json!(p.id));
    let id = call.get("toolCallId").and_then(Value::as_str).unwrap_or("");
    if let Some(parent) = read_str(call, p.meta.parent_tool_use) {
        // a Task's own progress updates carry the Task's own id: never its own parent
        if parent != id { ch.insert("parentId".into(), json!(parent)); }
    }
    let name = call.get("name").and_then(Value::as_str).filter(|s| !s.is_empty())
        .or_else(|| read_str(call, p.meta.tool_name)).map(String::from);
    let flagged = p.meta.subagent.and_then(|ptr| call.pointer(ptr)).and_then(Value::as_bool).unwrap_or(false);
    if flagged || name.as_deref().map(|n| p.meta.subagent_tools.contains(&n)).unwrap_or(false) {
        ch.insert("subagent".into(), json!(true));
    }
    if let Some(n) = name { ch.insert("toolName".into(), json!(n)); }
    call["_chronicle"] = Value::Object(ch);
}

fn stamp_usage(update: &mut Value, p: &AgentProfile) {
    if !update.is_object() || update.get("_chronicle").is_some() { return; }
    let mut ch = Map::new();
    ch.insert("agent".into(), json!(p.id));
    if let Some(rl) = p.meta.rate_limit.and_then(|ptr| update.pointer(ptr)).cloned() {
        ch.insert("rateLimit".into(), rl);
    }
    update["_chronicle"] = Value::Object(ch);
}

pub fn normalize(msg: &mut Value, p: &AgentProfile) {
    match msg.get("method").and_then(Value::as_str) {
        Some("session/update") => {
            let Some(update) = msg.pointer_mut("/params/update") else { return };
            match update.get("sessionUpdate").and_then(Value::as_str) {
                Some("tool_call") | Some("tool_call_update") => stamp_tool(update, p),
                Some("usage_update") => stamp_usage(update, p),
                _ => {}
            }
        }
        Some("session/request_permission") => {
            if let Some(params) = msg.get_mut("params") { normalize_permission(params, p); }
        }
        _ => {}
    }
}

pub fn normalize_permission(params: &mut Value, p: &AgentProfile) {
    if let Some(call) = params.get_mut("toolCall") { stamp_tool(call, p); }
}

/// What a `ready` state line carries beyond the session response.
pub fn ready_extras(msg: &mut Value, p: &AgentProfile) {
    if msg.get("method").and_then(Value::as_str) != Some("_chronicle/session_state") { return; }
    let Some(params) = msg.get_mut("params") else { return };
    if params.get("state").and_then(Value::as_str) != Some("ready") { return; }
    params["agent"] = json!(p.id);
}
```

- [ ] **Step 4: Wire it into `acp.rs` and `main.rs`**

In `reader_loop`, right after `let Ok(msg) = serde_json::from_str::<Value>(&line) else { continue };`, add:

```rust
            let mut msg = msg;
            // one shape for every agent, before anything stores or forwards it (spec §7)
            crate::agents::normalize::normalize(&mut msg, self.profile);
```

Replace the bodies of the three name reads:

```rust
fn permission_tool_name(params: &Value) -> Option<&str> {
    crate::agents::normalize::tool_name(params.get("toolCall")?)
}
```

In `design_write_decision` and `design_exit_plan_outcome`, replace

```rust
    let name = call.get("name").and_then(|v| v.as_str())
        .or_else(|| call.pointer("/_meta/claudeCode/toolName").and_then(|v| v.as_str()))?;
```

with

```rust
    let name = crate::agents::normalize::tool_name(call)?;
```

Change the doc comment on `permission_tool_name` to "The tool a permission ask is for: the call's `name`, or the name Rust stamped from the agent's own `_meta`."

In `handshake`, build the ready event through `ready_extras` so it is the same function the fixtures use. Replace `self.emit_state(json!({ "state": "ready", "agent": self.profile.id, … }))` (the line Task 5 wrote) with:

```rust
                let mut ready = json!({ "method": "_chronicle/session_state", "params": {
                    "state": "ready",
                    "sessionId": sid,
                    "resumed": self.resume.is_some(),
                    "modes": resp.get("modes").cloned().unwrap_or(Value::Null),
                    "configOptions": resp.get("configOptions").cloned().unwrap_or(Value::Null),
                    "agentCaps": caps,
                } });
                crate::agents::normalize::ready_extras(&mut ready, self.profile);
                self.emit_state(ready["params"].take());
```

In the tests: in `leaving_plan_mode_is_answered_with_the_reject_option` (~3101), after the `via_meta["toolCall"] = …` line add `crate::agents::normalize::normalize_permission(&mut via_meta, crate::agents::claude());`. In `mcp_tools_from_the_sessions_own_servers_are_allowed_without_asking` (~3176), make it `let mut via_meta = …;` and add the same line after it.

In `main.rs` `agent_history_read`, replace the last line with:

```rust
    let mut lines = acp::transcript::read(&lane.store(&p.dir), &id);
    // transcripts written before the agents update are Claude Code's and carry
    // only its own namespace; stamping is idempotent, so new lines pass through
    for l in lines.iter_mut() { agents::normalize::normalize(l, agents::claude()); }
    Ok(json!({ "lines": lines }))
```

- [ ] **Step 5: Generate the normalised fixtures, then run every Rust test**

```bash
export PATH="$HOME/.cargo/bin:$PATH" && cd src-tauri
CHRONICLE_WRITE_FIXTURES=1 cargo test normalize_tests 2>&1 | tail -3
cargo test 2>&1 | tail -5
cd .. && git diff --stat src/lib/__fixtures__/
```

Expected: the first run writes `acp-<id>.jsonl` for every shipped agent and stamps `_chronicle` into the three older fixtures; the second run passes everything with no env var. The diff of the three older fixtures adds a `_chronicle` object to each tool call, permission and usage line. serde_json may also re-order keys within a line; that is expected and changes no value — confirm with `git diff --word-diff src/lib/__fixtures__/agent-fanout.jsonl | grep -c '_chronicle'` (non-zero) and by the TypeScript replay tests in Task 7.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/agents/normalize.rs src-tauri/src/agents/mod.rs src-tauri/src/acp.rs src-tauri/src/main.rs src/lib/__fixtures__/acp-claude-acp.jsonl src/lib/__fixtures__/acp-codex-acp.jsonl src/lib/__fixtures__/acp-gemini.jsonl src/lib/__fixtures__/acp-opencode.jsonl src/lib/__fixtures__/agent-fanout.jsonl src/lib/__fixtures__/design-lane.jsonl src/lib/__fixtures__/design-director.jsonl
git commit -m "feat(agents): Rust stamps one _chronicle shape on tool calls, permissions and usage for every agent, older transcripts included

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

(Leave out any `acp-<id>.jsonl` that was not generated because its agent is not shipped.)

---

### Task 7: The store reads `_chronicle`, and knows its agent (TypeScript)

**Files:**
- Modify: `src/lib/agent-session.ts` (`AgentSessionState` ~160 and `blank` ~218: `agent`; `applyLinkage` ~454; the `usage_update` branch ~806; the `ready` branch ~539; `adoptAgentSession` ~891)
- Modify: `src/lib/agent-session.tree.test.ts` (the `call` helper and three inline `_meta` objects), `src/lib/agent-session.limits.test.ts` (`rateLimited`, line 36)
- Create: `src/lib/agent-session.agents.test.ts`

**Interfaces:**
- Consumes: the normalised fixtures and the `_chronicle` shape (Task 6); the `ready` event's `agent` (Task 5).
- Produces: `AgentSessionState.agent: string` (a profile id; `"claude-acp"` until a `ready` says otherwise). `agent-session.ts` contains no `claudeCode` and no `_claude/rateLimit` string.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/agent-session.agents.test.ts
/*
 * Every agent's probe turn, as Rust hands it to the pane (`_chronicle`
 * stamped, `agent` on ready), replays through the ONE reducer. The reducer
 * reads no agent's own namespace: an agent with no parent pointer gives a
 * flat tool list, and the session knows which agent it is.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("./ipc", () => ({
  agentsAvailable: vi.fn(async () => ({ claude: null, codex: null, default: "", project: "claude-acp", launchable: false })),
  onAcpUpdate: vi.fn(async () => () => {}),
  agentPrompt: vi.fn(), roundRunMessage: vi.fn(), agentSessionStart: vi.fn(),
  roundPlanBegin: vi.fn(), roundPlanCancel: vi.fn(), roundPlanSettle: vi.fn(),
  agentCancel: vi.fn(), agentEdits: vi.fn(), agentHistoryRead: vi.fn(),
  agentSetConfigOption: vi.fn(), agentRespondPermission: vi.fn(), agentSessionResume: vi.fn(),
  agentSessionState: vi.fn(), agentSessionStop: vi.fn(), agentSessionsList: vi.fn(),
  agentSetMode: vi.fn(),
}));
vi.mock("./notes-store", () => ({
  indexFor: () => ({ notes: [], rounds: [], generation: 0, vault: "", borrowed: false }),
  refreshNotes: vi.fn(), roundGenerating: vi.fn(() => false), roundNotesFor: vi.fn(() => []), setRoundGenerating: vi.fn(),
}));
vi.mock("./journal", () => ({ announce: vi.fn() }));
vi.mock("@/overlays/toasts", () => ({ toastAction: vi.fn(), toastError: vi.fn() }));

const { groupEntries, reduceLines } = await import("./agent-session");
type Raw = Record<string, any>;

const dir = path.join(__dirname, "__fixtures__");
const agents = readdirSync(dir).filter((f) => /^acp-.+\.jsonl$/.test(f) && !f.endsWith(".raw.jsonl")).map((f) => f.slice(4, -6));
const read = (id: string): Raw[] => readFileSync(path.join(dir, `acp-${id}.jsonl`), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

describe("every probed agent replays through the reducer", () => {
  it("has a fixture for at least Claude Code", () => {
    expect(agents).toContain("claude-acp");
  });

  for (const id of agents) {
    describe(id, () => {
      const lines = read(id);
      const s = reduceLines("/Users/me/chronicle-probe", lines);
      const calls = lines.filter((l) => l.method === "session/update" && l.params.update.sessionUpdate === "tool_call");

      it("knows which agent it is", () => {
        expect(s.agent).toBe(id);
      });

      it("makes one tool row per tool call, in wire order", () => {
        const tools = s.entries.filter((e) => e.kind === "tool");
        expect(tools.map((t) => (t as Raw).toolCallId)).toEqual(calls.map((c) => c.params.update.toolCallId));
      });

      it("links a call to a parent exactly when Rust stamped one", () => {
        for (const c of calls) {
          const entry = s.entries.find((e) => e.kind === "tool" && (e as Raw).toolCallId === c.params.update.toolCallId) as Raw;
          expect(entry.parentId).toBe(c.params.update._chronicle.parentId);
        }
        if (calls.every((c) => !c.params.update._chronicle.parentId && !c.params.update._chronicle.subagent)) {
          expect(groupEntries(s.entries).some((i) => i.kind === "subagent")).toBe(false);
        }
      });

      it("keeps every permission ask as a card", () => {
        const asks = lines.filter((l) => l.method === "session/request_permission").length;
        expect(s.entries.filter((e) => e.kind === "perm")).toHaveLength(asks);
      });
    });
  }
});

describe("the reducer reads no agent's own namespace", () => {
  it("ignores a claudeCode parent that Rust did not stamp", () => {
    const s = reduceLines("/p", [
      { method: "session/update", params: { update: { sessionUpdate: "tool_call", toolCallId: "a", title: "a", kind: "execute", status: "pending",
        _meta: { claudeCode: { parentToolUseId: "T1", toolName: "Bash" } }, _chronicle: { agent: "codex-acp" } } } },
    ]);
    expect("parentId" in s.entries[0]).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/agent-session.agents.test.ts`
Expected: FAIL — `s.agent` is `undefined`; "ignores a claudeCode parent" fails (`parentId` is `"T1"`).

- [ ] **Step 3: Read `_chronicle` in the store**

In `src/lib/agent-session.ts`:

1. In `AgentSessionState` after `lane: Lane;` add:

```ts
  /** the agent this session runs (a registry id: "claude-acp" | "codex-acp" | "gemini" | "opencode") */
  agent: string;
```

and in `blank()` add `agent: "claude-acp",` after `lane: "chat",`.

2. Replace `applyLinkage` and its comment:

```ts
/** The linkage Rust stamps on every tool update (`_chronicle`, from the
 *  agent's profile — spec §7): which subagent card a call belongs to, and
 *  whether the call IS one. Absent for an agent whose wire names no parent:
 *  its thread is a flat list. */
function applyLinkage(entry: Extract<AgentEntry, { kind: "tool" }>, tc: Raw) {
  const ch = (tc._chronicle ?? {}) as Raw;
  const parent = str(ch.parentId);
  if (parent && parent !== entry.toolCallId) entry.parentId = parent;
  if (ch.subagent === true) entry.subagent = true;
}
```

3. In the `usage_update` branch replace the last two lines with:

```ts
      // the account's limits ride along when the agent reports them; only a
      // LIVE reading may paint the title bar (limits-store.ts)
      const ch = (update._chronicle ?? {}) as Raw;
      if (live && ch.rateLimit) recordRateLimit(ch.rateLimit);
```

4. In the `ready` branch, after `s.endedReason = null;` add `s.agent = str(params.agent) || s.agent;`. In `adoptAgentSession`, after `s.sessionId = …;` add `s.agent = str(raw.agent) || s.agent;`.

5. In the `installing` branch's `Object.assign(s, blank(), { … })`, keep the agent across the reset: add `agent: s.agent,` to the object.

- [ ] **Step 4: Move the older tests onto the stamped shape**

In `src/lib/agent-session.tree.test.ts`, replace the `call` helper (line ~35):

```ts
type Linkage = { toolName?: string; parentToolUseId?: string; subagent?: boolean };
/** What Rust's normalize.rs stamps for Claude Code: the shape the reducer reads. */
const stamped = (id: string, m: Linkage) => ({
  agent: "claude-acp",
  ...(m.parentToolUseId && m.parentToolUseId !== id ? { parentId: m.parentToolUseId } : {}),
  ...(m.subagent || m.toolName === "Agent" || m.toolName === "Task" ? { subagent: true } : {}),
  ...(m.toolName ? { toolName: m.toolName } : {}),
});
const call = (id: string, meta: Linkage, extra: Record<string, unknown> = {}) =>
  update({ sessionUpdate: "tool_call", toolCallId: id, kind: "execute", title: id, status: "pending", _chronicle: stamped(id, meta), ...extra });
```

and in the three inline `update({ sessionUpdate: "tool_call_update", … _meta: { claudeCode: {…} } })` calls (lines ~88 and ~99) replace `_meta: { claudeCode: X }` with `_chronicle: stamped("<that update's toolCallId>", X)` — `stamped("T1", { toolName: "Agent", subagent: true })` and `stamped("T3", { toolName: "Agent", parentToolUseId: "T3" })`. Rename the `describe` to `"the reducer reads the linkage Rust stamps in _chronicle"`. The test "ignores a parent id equal to the call's own id" keeps passing: `stamped` drops it as Rust does, and the reducer keeps its own guard.

In `src/lib/agent-session.limits.test.ts` line 36:

```ts
const rateLimited = usage({ _chronicle: { agent: "claude-acp", rateLimit: { status: "allowed_warning", utilization: 71, resetsAt: 1_800_000_600, rateLimitType: "five_hour" } } });
```

- [ ] **Step 5: Run the whole suite**

Run: `npx vitest run && npm run typecheck && grep -n "claudeCode\|_claude/rateLimit" src/lib/agent-session.ts`
Expected: every file passes (the replay, design and director fixture tests read the `_chronicle` Task 6 stamped into their fixtures); typecheck clean; the grep prints nothing.

- [ ] **Step 6: Commit**

```bash
git add src/lib/agent-session.ts src/lib/agent-session.agents.test.ts src/lib/agent-session.tree.test.ts src/lib/agent-session.limits.test.ts
git commit -m "feat(agents): the pane's store reads one _chronicle shape and knows its agent; the claudeCode reads are gone

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Modes as stances, on both sides (§6)

The composer offers **Ask first**, **Execute**, **Auto** (Claude Code's classifier mode, offered today), **Unattended** — each only when the agent's profile maps it to a mode the session advertised. The store keeps the stance; Rust translates. The spec names three stances; this plan keeps Auto as a fourth because the shipped composer already offers Claude Code's `auto` mode and dropping it would take a feature away.

**Files:**
- Modify: `src-tauri/src/agents/profiles.rs` (tests), `src-tauri/src/agents/normalize.rs` (`ready_extras` adds `stances`)
- Modify: `src-tauri/src/acp.rs` (`current_state` adds `stances`)
- Modify: `src-tauri/src/main.rs` (`agent_set_mode` ~3628 takes a stance)
- Create: `src/lib/agent-stances.ts`, `src/lib/agent-stances.test.ts`
- Modify: `src/lib/agent-session.ts` (`stances` on the state; `setAgentMode` → `setAgentStance`), `src/lib/ipc.ts` (`agentSetMode` parameter name), `src/screens/agent/Composer.tsx` (`switchMode` ~427-466 and the selects ~616-640)
- Regenerate: `src/lib/__fixtures__/acp-*.jsonl`

**Interfaces:**
- Consumes: `profiles::{Stance, mode_for, stances}` (Task 2), `normalize::ready_extras` (Task 6), `AcpSession::profile()` (Task 5).
- Produces:
  - the `ready` event and `current_state()` carry `stances: { "<stance>": "<mode id>" }` (only advertised modes; `{}` when the agent has none)
  - Tauri `agent_set_mode(dir, mode, lane)`: `mode` is now a stance word (`ask` | `execute` | `auto` | `unattended`); the IPC name stays so the existing test mocks keep matching
  - TS `type Stance`, `type StanceMap`, `STANCE_ORDER`, `STANCE_COPY`, `parseStances(raw): StanceMap`, `availableStances(map): Stance[]`, `currentStance(map, currentModeId): Stance`, `stanceNeedsConfirm(stance, s): boolean`
  - `AgentSessionState.stances: StanceMap`; `setAgentStance(dir, stance): Promise<void>` replaces `setAgentMode`

- [ ] **Step 1: Write the failing tests**

In `src-tauri/src/agents/profiles.rs` `mod profile_tests`:

```rust
    #[test]
    fn stances_are_the_advertised_modes_only() {
        let modes = json!({ "currentModeId": "default", "availableModes": [ { "id": "default" }, { "id": "acceptEdits" }, { "id": "plan" } ] });
        assert_eq!(stances(claude(), &modes), json!({ "ask": "default", "execute": "acceptEdits" }), "no auto or bypass when the session didn't offer them");
        assert_eq!(mode_for(claude(), Stance::Unattended), Some("bypassPermissions"));
        assert_eq!(Stance::parse("unattended"), Some(Stance::Unattended));
        assert_eq!(Stance::parse("plan"), None);
    }

    #[test]
    fn an_agent_with_no_modes_offers_no_stances() {
        assert_eq!(stances(claude(), &Value::Null), json!({}));
        assert_eq!(stances(claude(), &json!({ "availableModes": [] })), json!({}));
        let none = profile("opencode").unwrap();
        if none.modes.ask.is_none() { assert_eq!(stances(none, &json!({ "availableModes": [ { "id": "build" } ] })), json!({})); }
    }
```

Create `src/lib/agent-stances.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { availableStances, currentStance, parseStances, stanceNeedsConfirm, STANCE_COPY } from "./agent-stances";

describe("stances", () => {
  const claude = parseStances({ ask: "default", execute: "acceptEdits", unattended: "bypassPermissions", bogus: "x" });

  it("keeps only the four stance words, with string ids", () => {
    expect(claude).toEqual({ ask: "default", execute: "acceptEdits", unattended: "bypassPermissions" });
    expect(parseStances(null)).toEqual({});
    expect(parseStances({ ask: 3 })).toEqual({});
  });

  it("lists what the agent offers, in the composer's order", () => {
    expect(availableStances(claude)).toEqual(["ask", "execute", "unattended"]);
    expect(availableStances({ unattended: "yolo", ask: "default" })).toEqual(["ask", "unattended"]);
  });

  it("offers nothing to pick for an agent with no modes", () => {
    expect(availableStances({})).toEqual([]);
    expect(currentStance({}, null)).toBe("ask");
  });

  it("reads the current stance back from the session's mode id", () => {
    expect(currentStance(claude, "acceptEdits")).toBe("execute");
    expect(currentStance(claude, "plan")).toBe("ask"); // a mode no stance maps to reads as asking
  });

  it("asks once per session before the stances that stop asking", () => {
    const fresh = { worksFreelyConfirmed: false, autoConfirmed: false, fullAutoConfirmed: false };
    expect(stanceNeedsConfirm("ask", fresh)).toBe(false);
    expect(stanceNeedsConfirm("execute", fresh)).toBe(true);
    expect(stanceNeedsConfirm("execute", { ...fresh, worksFreelyConfirmed: true })).toBe(false);
    expect(stanceNeedsConfirm("unattended", { ...fresh, fullAutoConfirmed: true })).toBe(false);
  });

  it("names every stance in sentence case", () => {
    expect(STANCE_COPY.ask.name).toBe("Ask first");
    expect(STANCE_COPY.unattended.name).toBe("Unattended");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `export PATH="$HOME/.cargo/bin:$PATH" && (cd src-tauri && cargo test profile_tests 2>&1 | tail -5); npx vitest run src/lib/agent-stances.test.ts`
Expected: the Rust tests pass already if Task 2's `stances` is in (they pin it); the vitest run fails — cannot find module `./agent-stances`.

- [ ] **Step 3: Rust — stances on the wire, stance in, mode out**

In `normalize.rs` `ready_extras`, after `params["agent"] = json!(p.id);` add:

```rust
    let modes = params.get("modes").cloned().unwrap_or(Value::Null);
    params["stances"] = super::profiles::stances(p, &modes);
```

In `acp.rs` `current_state`, add `"stances": crate::agents::profiles::stances(self.profile, &self.modes.lock().map(|g| g.clone()).unwrap_or(Value::Null)),` after `"agent"`.

In `main.rs`, replace `agent_set_mode`:

```rust
/// Switch the session's stance (spec §6). The store keeps the stance; this
/// translates it through the session's own profile to the agent's mode id.
#[tauri::command]
async fn agent_set_mode(roots: State<'_, OpenRoots>, agents: State<'_, acp::AcpState>, dir: String, mode: String, lane: Option<String>) -> Result<(), String> {
    let lane = acp::Lane::parse(lane.as_deref())?;
    let s = agent_for(&roots, &agents, &dir, lane)?;
    let stance = agents::profiles::Stance::parse(&mode).ok_or_else(|| format!("there's no stance called {mode}"))?;
    let id = agents::profiles::mode_for(s.profile(), stance).ok_or_else(|| format!("{} has no mode for that", s.profile().name))?;
    s.set_mode(id)
}
```

(`set_mode` still refuses a mode the session didn't advertise, and the design lane's lock still refuses anything but `default`.)

Regenerate the fixtures and run every Rust test:

```bash
export PATH="$HOME/.cargo/bin:$PATH" && cd src-tauri
CHRONICLE_WRITE_FIXTURES=1 cargo test normalize_tests 2>&1 | tail -3
cargo test 2>&1 | tail -5
```

Expected: the `ready` line of each `acp-<id>.jsonl` now carries `stances`; everything passes.

- [ ] **Step 4: TypeScript — the pure module**

Create `src/lib/agent-stances.ts`:

```ts
/*
 * Chronicle's stances (spec §6): what the user picks in the composer. Each
 * agent maps them to its own mode ids in Rust (profiles.rs); the ready event
 * carries that map for the modes the session actually advertised. The store
 * keeps the stance; `agent_set_mode` translates it.
 */
export type Stance = "ask" | "execute" | "auto" | "unattended";
export type StanceMap = Partial<Record<Stance, string>>;

export const STANCE_ORDER: Stance[] = ["ask", "execute", "auto", "unattended"];

export const STANCE_COPY: Record<Stance, { name: string; description: string }> = {
  ask: { name: "Ask first", description: "The agent asks before editing files or running commands." },
  execute: { name: "Execute", description: "File edits happen without asking. Commands still ask." },
  auto: { name: "Auto", description: "The agent approves routine edits and commands itself and still asks about risky ones." },
  unattended: { name: "Unattended", description: "Edits and commands both run without asking — nothing is confirmed." },
};

export function parseStances(raw: unknown): StanceMap {
  const out: StanceMap = {};
  if (!raw || typeof raw !== "object") return out;
  for (const k of STANCE_ORDER) {
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v === "string" && v) out[k] = v;
  }
  return out;
}

/** The stances to offer, in order. Empty when the agent has no modes: it always asks. */
export function availableStances(map: StanceMap): Stance[] {
  return STANCE_ORDER.filter((k) => map[k] != null);
}

/** The stance the session is in, read back from its current mode id; anything unmapped reads as asking. */
export function currentStance(map: StanceMap, currentModeId: string | null | undefined): Stance {
  return STANCE_ORDER.find((k) => currentModeId != null && map[k] === currentModeId) ?? "ask";
}

/** The once-per-session confirm before a stance that stops asking. */
export function stanceNeedsConfirm(
  stance: Stance,
  s: { worksFreelyConfirmed: boolean; autoConfirmed: boolean; fullAutoConfirmed: boolean },
): boolean {
  if (stance === "execute") return !s.worksFreelyConfirmed;
  if (stance === "auto") return !s.autoConfirmed;
  if (stance === "unattended") return !s.fullAutoConfirmed;
  return false;
}
```

- [ ] **Step 5: TypeScript — the store and the composer**

In `src/lib/agent-session.ts`:

1. `import { parseStances, type Stance, type StanceMap } from "./agent-stances";`
2. `AgentSessionState` gains, after `modes`:

```ts
  /** stance → this agent's mode id, for the modes the session advertised (Rust profiles.rs) */
  stances: StanceMap;
```

and `blank()` gains `stances: {},`.
3. In the `ready` branch after `s.configOptions = …` add `s.stances = parseStances(params.stances);`; in `adoptAgentSession` after `s.configOptions = …` add `s.stances = parseStances(raw.stances);`.
4. Replace `setAgentMode` with:

```ts
export async function setAgentStance(dir: string, stance: Stance): Promise<void> {
  const s = agentSessionFor(dir);
  await agentSetMode(dir, stance);
  const id = s.stances[stance];
  if (s.modes && id) s.modes.currentModeId = id;
  if (stance === "execute") s.worksFreelyConfirmed = true;
  if (stance === "auto") s.autoConfirmed = true;
  if (stance === "unattended") s.fullAutoConfirmed = true;
  notify();
}
```

In `src/lib/ipc.ts` line 555: `export const agentSetMode = (dir: string, stance: string) => invoke("agent_set_mode", { ...laneArgs(dir), mode: stance });`

In `src/screens/agent/Composer.tsx`, change the import `setAgentMode,` to `setAgentStance,`, add `import { availableStances, currentStance, stanceNeedsConfirm, STANCE_COPY, type Stance } from "@/lib/agent-stances";`, and replace `switchMode` through the `const current = s.modes?.currentModeId;` line (~427-467) with:

```tsx
  const CONFIRMS: Record<Exclude<Stance, "ask">, { title: string; body: string; cancelLabel: string; confirmLabel: string }> = {
    execute: {
      title: "Switch to Execute?",
      body: "File edits happen without asking, for the rest of this session. Commands still ask every time. Every change stays reviewable and undoable. This lasts for this session only — the next session starts in Ask first again.",
      cancelLabel: "Stay in Ask first",
      confirmLabel: "Execute this session",
    },
    auto: {
      title: "Turn on Auto?",
      body: "The agent approves routine edits and commands itself and still asks about anything risky. Every change stays reviewable and undoable. This lasts for this session only — the next session starts in Ask first again.",
      cancelLabel: "Keep confirming",
      confirmLabel: "Turn on Auto",
    },
    unattended: {
      title: "Turn on Unattended?",
      body: "Edits and commands both run without asking — nothing is confirmed, not even risky commands. Every change still stays reviewable and undoable. This lasts for this session only — the next session starts in Ask first again.",
      cancelLabel: "Keep confirming",
      confirmLabel: "Turn on Unattended",
    },
  };

  const stances = availableStances(s.stances);
  const current = currentStance(s.stances, s.modes?.currentModeId);

  const switchStance = (next: string) => {
    const stance = next as Stance;
    if (stance === current || !stances.includes(stance)) return;
    const apply = () =>
      void setAgentStance(dir, stance).catch((e) => toastError("Couldn't switch the mode", String(e).slice(0, 90)));
    if (stance !== "ask" && stanceNeedsConfirm(stance, s)) onConfirm({ ...CONFIRMS[stance], onConfirm: apply });
    else apply();
  };
```

and replace the two `ModeSelect` blocks (~616-640) with:

```tsx
        {designLane && stances.includes("ask") && (
          <ModeSelect
            current="ask"
            disabled={disabled}
            onPick={switchStance}
            options={[
              // ask-first only: every other mode would take the design session past its fence
              { value: "ask", name: "Ask first", description: "The design session asks before running commands. It never changes files outside the designs folder." },
            ]}
          />
        )}
        {!designLane && stances.length > 1 && (
          <ModeSelect
            current={current}
            disabled={disabled}
            onPick={switchStance}
            options={stances.map((k) => ({ value: k, ...STANCE_COPY[k] }))}
          />
        )}
```

In `ModeSelect`, change the fallback label `{cur?.name ?? "Plan"}` to `{cur?.name ?? "Ask first"}`.

- [ ] **Step 6: Run the checks**

Run: `npx vitest run && npm run typecheck && grep -n "acceptEdits\|bypassPermissions" src/screens/agent/Composer.tsx src/lib/agent-session.ts`
Expected: all files pass (6 new stance tests); typecheck clean; the grep prints nothing — no mode id is named on the TypeScript side.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/agents/profiles.rs src-tauri/src/agents/normalize.rs src-tauri/src/acp.rs src-tauri/src/main.rs src/lib/agent-stances.ts src/lib/agent-stances.test.ts src/lib/agent-session.ts src/lib/ipc.ts src/screens/agent/Composer.tsx src/lib/__fixtures__/acp-claude-acp.jsonl src/lib/__fixtures__/acp-codex-acp.jsonl src/lib/__fixtures__/acp-gemini.jsonl src/lib/__fixtures__/acp-opencode.jsonl
git commit -m "feat(agents): the composer offers stances — Ask first, Execute, Auto, Unattended — and each agent's profile maps them to its own modes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Signing in, per profile (§5)

`needs-login` carries the agent and its `Login`. A `Terminal` login types the profile's command into a terminal tab (today's flow, generalised). An `AuthMethod` login is answered in Rust: the handshake calls `authenticate` with that method id, says it is waiting, and retries `session/new` once. `None` shows the agent's own words from its `authMethods`.

**Files:**
- Modify: `src-tauri/src/acp.rs` (`handshake` around `session/new`/`session/load` ~1286-1335; `AUTH_TIMEOUT` beside `NEW_SESSION_TIMEOUT`; `MOCK_AGENT` gains an auth branch; new tests)
- Modify: `src-tauri/src/main.rs` (`setup_open_login` ~3716 accepts `agent:<id>`)
- Create: `src/lib/agent-login.ts`, `src/lib/agent-login.test.ts`, `src/lib/agents.ts`, `src/lib/agents.test.ts`
- Modify: `src/lib/agent-session.ts` (`login`, `loginWaiting`, `authMethods` on the state; the `needs-login` branch), `src/screens/agent/AgentPane.tsx` (the needs-login banner ~507-600), `src/lib/term-sessions.ts` (`SpawnOpts.agent` accepts any id)

**Interfaces:**
- Consumes: `profiles::{Login, login_json}` (Task 2), `AcpSession.profile` (Task 5), `AgentStatusRow.login` (Task 4).
- Produces:
  - the `needs-login` state event: `{ state: "needs-login", agent, login: <login_json>, waiting: bool, authMethods }`. `waiting: true` means Rust is running `authenticate` and the session continues by itself on success
  - Tauri `setup_open_login(kind)`: `kind` is `"claude"`, `"github"`, or `"agent:<id>"` (a `Terminal` profile's command, run in Terminal.app)
  - TS `type AgentLogin`, `parseLogin(raw): AgentLogin | null`, `loginBanner(input): { title, body, command, action: "terminal" | "wait" | "none" }`
  - `AgentSessionState.login: AgentLogin | null`, `.loginWaiting: boolean`, `.authMethods: { id: string; name: string; description?: string }[]`
  - `src/lib/agents.ts`: `interface AgentMeta { id, name, headerName, short, blurb }`, `AGENT_META`, `AGENT_ORDER`, `agentMeta(id): AgentMeta` — the TypeScript side's names and marks (spec §3), used by Tasks 10, 11

- [ ] **Step 1: Write the failing tests**

In `acp.rs`'s `MOCK_AGENT`, replace the `initialize` and `session/new` branches with:

```python
    if m == "initialize":
        methods = [{"id":"oauth-personal","name":"Log in with Google"}] if os.path.exists(os.path.join(project, ".needs-auth")) else []
        send({"jsonrpc":"2.0","id":msg["id"],"result":{"protocolVersion":1,
            "agentCapabilities":{"loadSession":False},"authMethods":methods}})
    elif m == "authenticate":
        state["authed"] = msg["params"].get("methodId")
        send({"jsonrpc":"2.0","id":msg["id"],"result":{}})
    elif m == "session/new":
        if os.path.exists(os.path.join(project, ".needs-auth")) and not state.get("authed"):
            send({"jsonrpc":"2.0","id":msg["id"],"error":{"code":-32000,"message":"Authentication required"}})
            continue
        send({"jsonrpc":"2.0","id":msg["id"],"result":{"sessionId":"sess-1",
            "modes":{"currentModeId":"default","availableModes":[
                {"id":"default","name":"Always Ask"},
                {"id":"acceptEdits","name":"Accept Edits"},
                {"id":"bypassPermissions","name":"Bypass"}]}}})
```

In `acp_tests`, extend `start_mock_as` (Task 5) with a `prep` hook by adding a second helper, and add the tests:

```rust
    fn start_mock_prepped(name: &str, profile: &'static crate::agents::AgentProfile, prep: impl Fn(&Path)) -> Option<Harness> {
        let py = python3()?;
        let dir = tmp(name);
        prep(&dir);
        let script = dir.join(".mock-agent.py");
        std::fs::write(&script, MOCK_AGENT).unwrap();
        let mut cmd = std::process::Command::new(py);
        cmd.arg(&script).arg(&dir);
        let (tx, rx) = mpsc::channel::<Value>();
        let emit: Emit = Arc::new(move |v| { let _ = tx.send(v); });
        let state = AcpState::new();
        let key = dir.to_string_lossy().to_string();
        assert!(start(&state, emit, key.clone(), Lane::Chat, profile, dir.clone(), dir.clone(), vec![dir.clone()], None, LaneExtras::default(), None, cmd).unwrap());
        Some(Harness { state, rx, key, dir })
    }

    static AUTH_AGENT: crate::agents::AgentProfile = crate::agents::AgentProfile {
        id: "auth-test", name: "Auth Test", registry_version: "0", pinned_npx: None, shipped: true,
        login: crate::agents::profiles::Login::AuthMethod { id: "oauth-personal" },
        modes: crate::agents::profiles::Modes { ask: Some("default"), execute: None, auto: None, unattended: None },
        meta: crate::agents::profiles::NO_META,
        extras: crate::agents::profiles::Extras { mcp_servers: true, plugins: false, settings: false },
        requires_cli: None, blank_env: &[], credentials: crate::agents::profiles::Credentials::Unknown,
    };

    #[test]
    fn a_terminal_login_names_the_agents_command_and_ends() {
        let Some(h) = start_mock_prepped("login-terminal", crate::agents::claude(), |d| std::fs::write(d.join(".needs-auth"), "").unwrap()) else { return };
        let ev = wait_for(&h.rx, 20, |v| state_is(v, "needs-login"));
        assert_eq!(ev.pointer("/message/params/agent").and_then(|v| v.as_str()), Some("claude-acp"));
        assert_eq!(ev.pointer("/message/params/login/kind").and_then(|v| v.as_str()), Some("terminal"));
        assert_eq!(ev.pointer("/message/params/login/command").and_then(|v| v.as_str()), Some("claude /login"));
        assert_eq!(ev.pointer("/message/params/waiting"), Some(&json!(false)));
        wait_for(&h.rx, 20, |v| state_is(v, "ended"));
        let log = std::fs::read_to_string(h.dir.join(".mock-requests.jsonl")).unwrap_or_default();
        assert!(!log.contains("\"authenticate\""), "a terminal login never calls authenticate");
    }

    #[test]
    fn an_auth_method_login_authenticates_and_carries_on() {
        let Some(h) = start_mock_prepped("login-method", &AUTH_AGENT, |d| std::fs::write(d.join(".needs-auth"), "").unwrap()) else { return };
        let waiting = wait_for(&h.rx, 20, |v| state_is(v, "needs-login"));
        assert_eq!(waiting.pointer("/message/params/waiting"), Some(&json!(true)));
        assert_eq!(waiting.pointer("/message/params/login/id").and_then(|v| v.as_str()), Some("oauth-personal"));
        let ready = wait_for(&h.rx, 20, |v| state_is(v, "ready"));
        assert_eq!(ready.pointer("/message/params/agent").and_then(|v| v.as_str()), Some("auth-test"));
        let log = std::fs::read_to_string(h.dir.join(".mock-requests.jsonl")).unwrap_or_default();
        let auth = log.lines().filter_map(|l| serde_json::from_str::<Value>(l).ok()).find(|v| v["method"] == "authenticate").expect("authenticate was sent");
        assert_eq!(auth["params"]["methodId"], "oauth-personal");
        h.state.drain();
    }
```

Create `src/lib/agent-login.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loginBanner, parseLogin } from "./agent-login";

describe("sign-in, per agent", () => {
  it("parses the three kinds and refuses anything else", () => {
    expect(parseLogin({ kind: "terminal", command: "codex login" })).toEqual({ kind: "terminal", command: "codex login" });
    expect(parseLogin({ kind: "auth_method", id: "oauth-personal" })).toEqual({ kind: "auth_method", id: "oauth-personal" });
    expect(parseLogin({ kind: "none" })).toEqual({ kind: "none" });
    expect(parseLogin({ kind: "terminal" })).toBeNull();
    expect(parseLogin(null)).toBeNull();
  });

  it("a terminal login names the agent and its command", () => {
    const b = loginBanner({ name: "Codex", login: { kind: "terminal", command: "codex login" }, waiting: false, authMethods: [] });
    expect(b).toEqual({ title: "Codex needs you to sign in", body: "Run this once in a terminal. Chronicle starts the session again when it finishes.", command: "codex login", action: "terminal" });
  });

  it("an auth-method login says the browser is open while Rust waits", () => {
    const b = loginBanner({ name: "Gemini CLI", login: { kind: "auth_method", id: "oauth-personal" }, waiting: true, authMethods: [] });
    expect(b.action).toBe("wait");
    expect(b.title).toBe("Finish signing in to Gemini CLI in your browser");
  });

  it("an agent that signs itself in shows its own words", () => {
    const b = loginBanner({ name: "OpenCode", login: { kind: "none" }, waiting: false, authMethods: [{ id: "x", name: "Set a provider key", description: "Run opencode auth login to add a provider key." }] });
    expect(b).toMatchObject({ action: "none", body: "Run opencode auth login to add a provider key.", command: null });
  });

  it("an unknown login still reads as a plain sign-in for that agent", () => {
    expect(loginBanner({ name: "Claude Code", login: null, waiting: false, authMethods: [] }).title).toBe("Claude Code isn't signed in");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `export PATH="$HOME/.cargo/bin:$PATH" && (cd src-tauri && cargo test login 2>&1 | tail -8); npx vitest run src/lib/agent-login.test.ts`
Expected: the Rust tests fail (`/message/params/login` is absent; the auth-method test times out waiting for `ready`); vitest fails — cannot find module `./agent-login`.

- [ ] **Step 3: Rust — the handshake signs in by profile**

Beside `NEW_SESSION_TIMEOUT` add:

```rust
const AUTH_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(300); // a browser sign-in takes a person's time
```

In `handshake`, replace `match self.request_blocking(method, params, NEW_SESSION_TIMEOUT) {` with:

```rust
        let is_auth = |e: &str| serde_json::from_str::<Value>(e).ok()
            .and_then(|v| v.get("code").and_then(|c| c.as_i64())) == Some(AUTH_REQUIRED_CODE);
        let mut attempt = 0;
        let outcome = loop {
            match self.request_blocking(method, params.clone(), NEW_SESSION_TIMEOUT) {
                Err(e) if is_auth(&e) && attempt == 0 => {
                    // an AuthMethod profile signs in from here: the adapter opens the
                    // browser itself; we wait for it, then ask for the session again
                    let crate::agents::profiles::Login::AuthMethod { id } = self.profile.login else { break Err(e) };
                    attempt += 1;
                    self.emit_needs_login(true);
                    if self.request_blocking("authenticate", json!({ "methodId": id }), AUTH_TIMEOUT).is_err() { break Err(e); }
                }
                other => break other,
            }
        };
        match outcome {
```

(the existing `Ok(resp) => { … }` and `Err(e) => { … }` arms stay as the arms of `match outcome`). In the `Err(e)` arm, replace

```rust
                let is_auth = serde_json::from_str::<Value>(&e).ok()
                    .and_then(|v| v.get("code").and_then(|c| c.as_i64()))
                    == Some(AUTH_REQUIRED_CODE);
                if is_auth {
                    let methods = self.agent_caps.lock().ok()
                        .and_then(|g| g.get("authMethods").cloned())
                        .unwrap_or(Value::Null);
                    self.emit_state(json!({ "state": "needs-login", "authMethods": methods }));
                    self.shutdown(None, None);
```

with

```rust
                if is_auth(&e) {
                    self.emit_needs_login(false);
                    self.shutdown(None, None);
```

and update the comment above it: "auth_required (-32000): surface needs-login with this agent's own sign-in (spec §5) and end; a Terminal login restarts the session when its terminal tab exits."

Add to `impl AcpSession`:

```rust
    fn emit_needs_login(&self, waiting: bool) {
        let methods = self.agent_caps.lock().ok().and_then(|g| g.get("authMethods").cloned()).unwrap_or(Value::Null);
        self.emit_state(json!({
            "state": "needs-login",
            "agent": self.profile.id,
            "login": crate::agents::profiles::login_json(self.profile.login),
            "waiting": waiting,
            "authMethods": methods,
        }));
    }
```

- [ ] **Step 4: Rust — Setup's sign-in opens any Terminal login**

In `main.rs` `setup_open_login`, replace the `let (bin_name, args, title) = match kind.as_str() { … };` with:

```rust
    let agent_cmd = kind.strip_prefix("agent:").and_then(agents::profile).and_then(|p| match p.login {
        agents::profiles::Login::Terminal { command } => Some((command, p.name)),
        _ => None,
    });
    let (bin_name, args, title): (&str, &str, String) = match (kind.as_str(), agent_cmd) {
        ("claude", _) => ("claude", "/login", "claude · sign-in".into()),
        ("github", _) => ("gh", "auth login", "github · sign-in".into()),
        (_, Some((command, name))) => {
            let (bin, rest) = command.split_once(' ').unwrap_or((command, ""));
            (bin, rest, format!("{} · sign-in", name.to_lowercase()))
        }
        _ => return Err("unknown sign-in".into()),
    };
```

Run: `export PATH="$HOME/.cargo/bin:$PATH" && cd src-tauri && cargo test 2>&1 | tail -5`
Expected: all pass, including the two login tests.

- [ ] **Step 5: TypeScript — the pure module**

Create `src/lib/agent-login.ts`:

```ts
/*
 * How a signed-out agent signs in (spec §5), as the pane's banner says it.
 * Rust's needs-login event carries the agent's Login from its profile.
 */
export type AgentLogin = { kind: "terminal"; command: string } | { kind: "auth_method"; id: string } | { kind: "none" };
export type AuthMethod = { id: string; name: string; description?: string };

export function parseLogin(raw: unknown): AgentLogin | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.kind === "terminal" && typeof r.command === "string" && r.command) return { kind: "terminal", command: r.command };
  if (r.kind === "auth_method" && typeof r.id === "string" && r.id) return { kind: "auth_method", id: r.id };
  if (r.kind === "none") return { kind: "none" };
  return null;
}

export function parseAuthMethods(raw: unknown): AuthMethod[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m): m is Record<string, unknown> => !!m && typeof m === "object")
    .map((m) => ({ id: String(m.id ?? ""), name: String(m.name ?? ""), ...(typeof m.description === "string" ? { description: m.description } : {}) }))
    .filter((m) => m.id);
}

export function loginBanner(input: { name: string; login: AgentLogin | null; waiting: boolean; authMethods: AuthMethod[] }): {
  title: string;
  body: string;
  command: string | null;
  action: "terminal" | "wait" | "none";
} {
  const { name, login, waiting, authMethods } = input;
  if (login?.kind === "auth_method") {
    return waiting
      ? { title: `Finish signing in to ${name} in your browser`, body: "Chronicle carries on by itself when you're done.", command: null, action: "wait" }
      : { title: `${name} isn't signed in`, body: "The sign-in didn't finish. Start the session again to try once more.", command: null, action: "none" };
  }
  if (login?.kind === "none") {
    const own = authMethods.find((m) => m.description)?.description ?? authMethods[0]?.name;
    return { title: `${name} needs its own setup`, body: own ?? `Set ${name} up the way it asks, then start the session again.`, command: null, action: "none" };
  }
  if (login?.kind === "terminal") {
    return { title: `${name} needs you to sign in`, body: "Run this once in a terminal. Chronicle starts the session again when it finishes.", command: login.command, action: "terminal" };
  }
  return { title: `${name} isn't signed in`, body: "Sign in, then start the session again.", command: null, action: "none" };
}
```

Create `src/lib/agents.test.ts`:

```ts
import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_ORDER, agentMeta } from "./agents";

describe("agent names and marks", () => {
  it("names every probed agent", () => {
    const ids = readdirSync(path.join(__dirname, "__fixtures__")).filter((f) => /^acp-.+\.raw\.jsonl$/.test(f)).map((f) => f.slice(4, -10));
    for (const id of ids) expect(AGENT_ORDER).toContain(id);
  });
  it("keeps Chronigirl for Claude Code and the agent's own name for the others", () => {
    expect(agentMeta("claude-acp").headerName).toBe("Chronigirl");
    expect(agentMeta("codex-acp")).toMatchObject({ name: "Codex", headerName: "Codex", short: "Cx" });
  });
  it("never throws on an id it doesn't know", () => {
    expect(agentMeta("amp-acp")).toMatchObject({ name: "amp-acp", short: "am" });
  });
});
```

Create `src/lib/agents.ts`:

```ts
/*
 * The TypeScript side's names and marks for the four agents (spec §3). Rust's
 * profiles.rs is the source of truth for what an agent can do; this is only
 * how it is named and drawn. Ids are the ACP registry's.
 */
export interface AgentMeta {
  id: string;
  name: string;
  /** the pane header's name: Claude Code keeps Chronigirl; every other agent is itself */
  headerName: string;
  /** the letters on its mark ("" for Claude Code, which draws Chronigirl) */
  short: string;
  blurb: string;
}

export const AGENT_ORDER = ["claude-acp", "codex-acp", "gemini", "opencode"] as const;

export const AGENT_META: Record<string, AgentMeta> = {
  "claude-acp": { id: "claude-acp", name: "Claude Code", headerName: "Chronigirl", short: "", blurb: "Anthropic’s agent. The default for new projects." },
  "codex-acp": { id: "codex-acp", name: "Codex", headerName: "Codex", short: "Cx", blurb: "OpenAI’s agent." },
  gemini: { id: "gemini", name: "Gemini CLI", headerName: "Gemini CLI", short: "Gm", blurb: "Google’s agent." },
  opencode: { id: "opencode", name: "OpenCode", headerName: "OpenCode", short: "Oc", blurb: "An open-source agent." },
};

export function agentMeta(id: string): AgentMeta {
  return AGENT_META[id] ?? { id, name: id, headerName: id, short: id.slice(0, 2), blurb: "" };
}
```

- [ ] **Step 6: TypeScript — the store and the banner**

In `src/lib/agent-session.ts`:

1. `import { parseAuthMethods, parseLogin, type AgentLogin, type AuthMethod } from "./agent-login";`
2. `AgentSessionState` gains, after `errorMessage`:

```ts
  /** how this agent signs in, from the needs-login event (null until one arrives) */
  login: AgentLogin | null;
  /** Rust is running the agent's own authenticate (an AuthMethod login): the browser is open */
  loginWaiting: boolean;
  authMethods: AuthMethod[];
```

and `blank()` gains `login: null, loginWaiting: false, authMethods: [],`.
3. The `needs-login` branch becomes:

```ts
    } else if (state === "needs-login") {
      s.phase = "needs-login";
      s.turnActive = false;
      s.agent = str(params.agent) || s.agent;
      s.login = parseLogin(params.login);
      s.loginWaiting = params.waiting === true;
      s.authMethods = parseAuthMethods(params.authMethods);
      // nothing queued is going anywhere until someone signs in and the session
      // is restarted, and a restart drops the queue: the card ends now rather
      // than reading "waiting for the pane" for the rest of the session
      if (live && lane === "chat") dropQueuedPrompts(s, dir);
```

In `src/lib/term-sessions.ts`, widen `SpawnOpts.agent` to `agent?: string;` (it is a label; `"claude"`/`"codex"` still work).

In `src/screens/agent/AgentPane.tsx`:

1. `import { loginBanner } from "@/lib/agent-login";` and `import { agentMeta } from "@/lib/agents";`.
2. Replace `signIn`:

```tsx
  const login = loginBanner({ name: agentMeta(s.agent).name, login: s.login, waiting: s.loginWaiting, authMethods: s.authMethods });
  const signIn = () => {
    if (!login.command) return;
    onRevealTerminal();
    // terminals belong to the project, not to a session lane
    const projectDir = splitLaneKey(dir).dir;
    spawnTerm(projectDir, { title: "sign-in", agent: s.agent, autoType: login.command })
      .then((sess) => {
        setActiveTermFor(projectDir, sess.id);
        setLoginTermId(sess.id);
      })
      .catch((e) => toastError("Couldn't open the sign-in terminal", String(e).slice(0, 90)));
  };
```

3. Replace the whole `if (s.phase === "needs-login") return ( … );` block with:

```tsx
    if (s.phase === "needs-login")
      return (
        <div data-agent-banner="needs-login" className="mx-3 mb-2 flex flex-col gap-2 rounded-md bg-fill-subtle px-[11px] py-[9px]">
          <div className="flex items-center gap-[9px]">
            <span className="inline-flex items-center gap-1.5 text-[12.5px] text-text-secondary">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" className="shrink-0 text-text-subtle">
                <rect x="2.5" y="5" width="7" height="5.5" rx="1" />
                <path d="M4 5V3.6a2 2 0 0 1 4 0V5" />
              </svg>
              {login.title}
            </span>
            <span className="flex-1" />
            {login.action === "terminal" && loginTermId == null && (
              <BtnPrimary size="sm" onClick={signIn} className="whitespace-nowrap">Open a terminal</BtnPrimary>
            )}
            {login.action === "none" && (
              <BtnSecondary size="sm" onClick={start} className="whitespace-nowrap">Check again</BtnSecondary>
            )}
          </div>
          <span className="text-[11.5px] leading-[1.5] text-text-muted">{login.body}</span>
          {login.command && loginTermId == null && (
            <span data-selectable className="w-max rounded-xs bg-surface-input px-1.5 font-mono text-[11.5px] text-text-primary">{login.command}</span>
          )}
          {(loginTermId != null || login.action === "wait") && (
            <div className="flex items-center gap-2">
              <Spinner size={11} />
              <span className="text-[11.5px] text-text-muted">{login.action === "wait" ? "Waiting for the browser" : "Waiting for the sign-in to finish in"}</span>
              {loginTermId != null && (
                <span className="rounded-xs bg-fill-subtle px-1.5 font-mono text-[10.5px] text-text-subtle">{agentMeta(s.agent).name.toLowerCase()} · sign-in</span>
              )}
            </div>
          )}
        </div>
      );
```

Change the comment above the `loginTermId` state to "needs-login: run the agent's own sign-in command in a terminal tab; when that tab's session exits, retry the agent session (the plan's retry contract)".

- [ ] **Step 7: Run the checks**

Run: `npx vitest run && npm run typecheck && npm run build 2>&1 | tail -3`
Expected: all files pass (5 login tests, 3 agents tests); typecheck and build clean.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/acp.rs src-tauri/src/main.rs src/lib/agent-login.ts src/lib/agent-login.test.ts src/lib/agents.ts src/lib/agents.test.ts src/lib/agent-session.ts src/lib/term-sessions.ts src/screens/agent/AgentPane.tsx
git commit -m "feat(agents): sign-in follows the agent — its terminal command, its browser sign-in answered by Chronicle, or its own instructions

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: The Your agent group in Setup & health (§3, §4; board 1)

**Files:**
- Modify: `src/lib/setup-store.ts` (agents status, `agentRows`, `chooseDefaultAgent`, `installAgent`, `signInAgent`), `src/lib/setup-store.test.ts`
- Create: `src/screens/setup/AgentGroup.tsx`, `src/components/chrome/AgentMark.tsx`
- Modify: `src/screens/setup/SetupScreen.tsx` (render the group; the connector row moves into it)

**Interfaces:**
- Consumes: `agentsStatus`, `setDefaultAgent`, `setupInstall`, `setupOpenLogin`, `AgentsStatus`, `AgentStatusRow` (Task 4, ipc.ts); install ids `agent:<id>` and the `connector` check carrying `agent` (Task 3); `setup_open_login("agent:<id>")` (Task 9); `agentMeta`, `AGENT_ORDER` (Task 9).
- Produces:
  - `interface AgentRowView { id; name; blurb; chosen: boolean; selectable: boolean; state: "ready" | "needs_you" | "missing" | "blocked" | "unsupported" | "installing"; word: string; detail: string; action: "install" | "signin" | ""; pct: number | null }`
  - `export function agentRows(status: AgentsStatus | null, progress: (checkId: string) => SetupCheck | undefined): AgentRowView[]` (pure)
  - `export function connectorName(agentName: string): string` — `"<Agent>’s connector"`
  - `agentsState(): AgentsStatus | null`, `refreshAgentsStatus(dir)`, `chooseDefaultAgent(id, dir)`, `installAgent(id, dir)`, `signInAgent(id, dir)`
  - `AgentMark({ agent, size })` — Chronigirl for Claude Code, a lettered round tile for the others (Task 11 uses it in the pane)

- [ ] **Step 1: Write the failing tests**

In `src/lib/setup-store.test.ts`, extend the two import lines at the top to

```ts
import { agentRows, agentsRowFor, agentsRowForError, connectorName } from "./setup-store";
import type { AgentsAccessStatus, AgentsStatus, AgentStatusRow, SetupCheck } from "./ipc";
```

and append:

```ts
const row = (over: Partial<AgentStatusRow>): AgentStatusRow => ({
  id: "codex-acp", name: "Codex", supported: true, launchable: true, installed: true, missing: null, signedIn: true,
  login: { kind: "terminal", command: "codex login" }, ...over,
});
const status = (agents: AgentStatusRow[], def = "claude-acp"): AgentsStatus => ({ agents, default: def, project: def });
const none = () => undefined;

describe("agentRows", () => {
  it("is empty until the status arrives", () => {
    expect(agentRows(null, none)).toEqual([]);
  });

  it("marks the chosen agent and keeps the registry order", () => {
    const rows = agentRows(status([row({ id: "opencode", name: "OpenCode" }), row({ id: "claude-acp", name: "Claude Code", login: { kind: "terminal", command: "claude /login" } })]), none);
    expect(rows.map((r) => r.id)).toEqual(["claude-acp", "opencode"]);
    expect(rows[0].chosen).toBe(true);
    expect(rows[1].chosen).toBe(false);
  });

  it("asks a signed-out terminal agent to sign in, naming its command", () => {
    const [r] = agentRows(status([row({ signedIn: false })]), none);
    expect(r).toMatchObject({ state: "needs_you", word: "needs you", action: "signin", detail: "Installed. Sign in with codex login." });
  });

  it("offers Install for an agent not on this Mac", () => {
    const [r] = agentRows(status([row({ installed: false })]), none);
    expect(r).toMatchObject({ state: "missing", action: "install", word: "missing" });
    expect(r.detail).toContain("Not on this Mac yet.");
  });

  it("an agent with no build for this Mac is not yet supported, with nothing to press and nothing to choose", () => {
    const [r] = agentRows(status([row({ id: "opencode", name: "OpenCode", supported: false, installed: false, launchable: false })]), none);
    expect(r).toMatchObject({ state: "unsupported", word: "not yet supported", action: "", selectable: false });
  });

  it("says which of the agent's own tools is missing", () => {
    const [r] = agentRows(status([row({ id: "claude-acp", name: "Claude Code", missing: "claude", launchable: false })]), none);
    expect(r).toMatchObject({ state: "blocked", action: "", detail: "Anthropic’s agent. The default for new projects. Needs claude installed first." });
  });

  it("shows an install in progress from its setup-update events", () => {
    const progress = (id: string): SetupCheck | undefined => (id === "agent:gemini" ? { id, state: "installing", pct: 40 } : undefined);
    const [r] = agentRows(status([row({ id: "gemini", name: "Gemini CLI", installed: false, login: { kind: "auth_method", id: "oauth-personal" } })]), progress);
    expect(r).toMatchObject({ state: "installing", word: "installing", pct: 40, action: "" });
  });

  it("a browser sign-in agent says it signs in from the pane", () => {
    const [r] = agentRows(status([row({ id: "gemini", name: "Gemini CLI", signedIn: false, login: { kind: "auth_method", id: "oauth-personal" } })]), none);
    expect(r).toMatchObject({ state: "needs_you", action: "", detail: "Installed. Signs in from the pane the first time you use it." });
  });

  it("names the connector after its agent", () => {
    expect(connectorName("Claude Code")).toBe("Claude Code’s connector");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/setup-store.test.ts`
Expected: FAIL — `agentRows` and `connectorName` are not exported.

- [ ] **Step 3: The store**

In `src/lib/setup-store.ts`, extend the ipc import with `agentsStatus, setDefaultAgent, type AgentsStatus,` and add `import { AGENT_ORDER, agentMeta } from "./agents";`. Then add, after `waitingSignin`:

```ts
/* ---------- the Your agent group (spec §3-§4, board 1) ----------
 * Fetched with the open project's dir, like the agents row; mapped here so the
 * mapping is testable without a Tauri runtime. Installs report through the
 * ordinary setup-update stream under the check id `agent:<id>`. */

export interface AgentRowView {
  id: string;
  name: string;
  blurb: string;
  chosen: boolean;
  selectable: boolean;
  state: "ready" | "needs_you" | "missing" | "blocked" | "unsupported" | "installing";
  word: string;
  detail: string;
  action: "install" | "signin" | "";
  pct: number | null;
}

export const connectorName = (agentName: string) => `${agentName}’s connector`;

export function agentRows(status: AgentsStatus | null, progress: (checkId: string) => SetupCheck | undefined): AgentRowView[] {
  if (!status) return [];
  const order = (id: string) => { const i = (AGENT_ORDER as readonly string[]).indexOf(id); return i < 0 ? 99 : i; };
  return [...status.agents].sort((a, b) => order(a.id) - order(b.id)).map((a) => {
    const meta = agentMeta(a.id);
    const base = { id: a.id, name: a.name, blurb: meta.blurb, chosen: a.id === status.default, selectable: a.supported, pct: null as number | null };
    const live = progress(`agent:${a.id}`);
    if (!a.supported) return { ...base, state: "unsupported", word: "not yet supported", detail: `${meta.blurb} Not supported on this Mac yet.`, action: "" };
    if (live?.state === "installing") return { ...base, state: "installing", word: "installing", detail: meta.blurb, action: "", pct: live.pct ?? null };
    if (a.missing) return { ...base, state: "blocked", word: "needs you", detail: `${meta.blurb} Needs ${a.missing} installed first.`, action: "" };
    if (!a.installed) return { ...base, state: "missing", word: "missing", detail: `${meta.blurb} Not on this Mac yet.`, action: "install" };
    if (a.signedIn === false) {
      if (a.login.kind === "terminal") return { ...base, state: "needs_you", word: "needs you", detail: `Installed. Sign in with ${a.login.command}.`, action: "signin" };
      if (a.login.kind === "auth_method") return { ...base, state: "needs_you", word: "needs you", detail: "Installed. Signs in from the pane the first time you use it.", action: "" };
      return { ...base, state: "needs_you", word: "needs you", detail: "Installed. It signs in with its own setup.", action: "" };
    }
    return { ...base, state: "ready", word: "ready", detail: a.signedIn ? `${meta.blurb} Signed in.` : meta.blurb, action: "" };
  }) as AgentRowView[];
}

let agents: AgentsStatus | null = null;
export function agentsState(): AgentsStatus | null {
  return agents;
}

export async function refreshAgentsStatus(dir: string | null): Promise<void> {
  try {
    agents = await agentsStatus(dir);
  } catch {
    /* keep the last-known rows */
  }
  notify();
}

export async function chooseDefaultAgent(id: string, dir: string | null): Promise<void> {
  await setDefaultAgent(id);
  await refreshAgentsStatus(dir);
  await refreshDoctor(); // the connector row follows the chosen agent
}

export async function installAgent(id: string, dir: string | null): Promise<void> {
  await installCheck(`agent:${id}`);
  await refreshAgentsStatus(dir);
}

/** Open Terminal with the agent's own sign-in command and poll until it reads signed in. */
export async function signInAgent(id: string, dir: string | null): Promise<void> {
  const key = `agent:${id}`;
  await setupOpenLogin(key);
  state.waitingSignins.add(key);
  notify();
  const started = Date.now();
  signinStops.get(key)?.();
  let stop: () => void = () => {};
  const finish = () => {
    stop();
    signinStops.delete(key);
    state.waitingSignins.delete(key);
    notify();
  };
  stop = every(3500, async () => {
    await refreshAgentsStatus(dir);
    if (agents?.agents.find((a) => a.id === id)?.signedIn) { finish(); return; }
    if (Date.now() - started > 5 * 60_000) finish();
  });
  signinStops.set(key, finish);
}
```

- [ ] **Step 4: Run the store tests**

Run: `npx vitest run src/lib/setup-store.test.ts`
Expected: PASS (the 9 new tests and the existing ones).

- [ ] **Step 5: The group component**

Create `src/screens/setup/AgentGroup.tsx`:

```tsx
/*
 * Setup's Your agent group (board 1): one radio row per agent, its state and
 * at most one action; the chosen agent's connector nested under it. The rows
 * come from `agentRows` (setup-store), which is where their logic is tested.
 */
import { useEffect } from "react";
import {
  agentRows,
  agentsState,
  checkFor,
  chooseDefaultAgent,
  connectorName,
  installAgent,
  installCheck,
  refreshAgentsStatus,
  signInAgent,
  waitingSignin,
  type AgentRowView,
} from "@/lib/setup-store";
import { toastError } from "@/overlays/toasts";
import { AgentMark } from "@/components/chrome/AgentMark";
import { ClaudeStar } from "@/components/chrome/icons";
import { cn } from "@/lib/utils";

const WORD_TONE: Record<AgentRowView["state"], string> = {
  ready: "text-state-success",
  needs_you: "text-state-warn",
  blocked: "text-state-warn",
  missing: "text-text-dim",
  unsupported: "text-text-dim",
  installing: "text-state-neutral",
};

function Radio({ on, disabled, onPick, label }: { on: boolean; disabled: boolean; onPick: () => void; label: string }) {
  return (
    <button
      role="radio"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onPick}
      className={cn(
        "mt-[7px] flex size-4 shrink-0 items-center justify-center rounded-full border disabled:opacity-50",
        on ? "border-primary bg-primary" : "border-border-strong hover:border-text-muted",
      )}
    >
      {on && <span className="size-1.5 rounded-full bg-primary-foreground" />}
    </button>
  );
}

function ConnectorLine({ agentName }: { agentName: string }) {
  const c = checkFor("connector");
  return (
    <div data-check-row="connector" data-check-state={c.state} className="mb-3 ml-[61px] flex items-center gap-2.5 rounded-lg border border-border-hairline bg-surface-card px-3 py-[9px]">
      <span className="text-[12.5px] font-medium text-text-primary">{connectorName(agentName)}</span>
      {c.state === "ready" && <span className="font-mono text-[11px] text-text-subtle">{c.detail}</span>}
      <span className="flex-1 text-[11.5px] text-text-faint">
        {c.state === "ready" ? "installed by Chronicle, so sessions start fast" : c.state === "installing" ? `installing${c.pct != null ? ` · ${c.pct}%` : ""}` : c.detail || "not installed yet — sessions start slower until it is"}
      </span>
      {c.state === "missing" && c.action === "install" && (
        <button data-check-action="install" onClick={() => void installCheck("connector").catch((e) => toastError("Couldn't install it", String(e).slice(0, 90)))} className="h-[28px] shrink-0 rounded-lg border border-border-strong px-3 text-[12px] font-medium text-text-primary hover:bg-fill-hover">
          Install
        </button>
      )}
    </div>
  );
}

export function AgentGroup({ dir }: { dir: string | null }) {
  useEffect(() => { void refreshAgentsStatus(dir); }, [dir]);
  const rows = agentRows(agentsState(), (id) => checkFor(id));
  if (rows.length === 0) return null;
  const err = (what: string) => (e: unknown) => toastError(what, String(e).slice(0, 90));
  return (
    <div className="flex flex-col gap-0.5" data-setup-group="agent">
      <div className="flex items-baseline gap-2.5 pb-1.5">
        <span className="text-[10px] uppercase tracking-[0.09em] text-text-subtle">Your agent</span>
        <span className="text-[11.5px] text-text-muted">the one that works in your projects</span>
      </div>
      <div className="flex flex-col" role="radiogroup" aria-label="Your agent">
        {rows.map((r, i) => (
          <div key={r.id}>
            <div data-agent-row={r.id} data-agent-state={r.state} className={cn("flex items-start gap-[15px] py-[15px]", i > 0 && "border-t border-divider", r.state === "unsupported" && "opacity-55")}>
              <Radio on={r.chosen} disabled={!r.selectable} label={r.name} onPick={() => void chooseDefaultAgent(r.id, dir).catch(err("Couldn't choose that agent"))} />
              <span className="flex size-[30px] shrink-0 items-center justify-center rounded-lg border border-border-hairline bg-fill-subtle">
                {r.id === "claude-acp" ? <ClaudeStar size={15} /> : <AgentMark agent={r.id} size={13} />}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="text-[13px] font-medium text-text-primary">{r.name}</span>
                <span className="text-[12px] leading-snug text-text-dim">{r.detail}</span>
                {r.state === "installing" && (
                  <span className="mt-0.5 block h-[3px] overflow-hidden rounded-[2px] bg-fill-hover">
                    <span className="block h-full rounded-[2px] bg-state-neutral" style={{ width: `${r.pct ?? 8}%` }} />
                  </span>
                )}
                {waitingSignin(`agent:${r.id}`) && <span className="text-[11.5px] text-text-muted">Waiting for you to finish signing in…</span>}
              </div>
              <span className={cn("inline-flex shrink-0 items-center whitespace-nowrap text-[12.5px]", WORD_TONE[r.state])}>{r.word}</span>
              {r.action === "install" && (
                <button data-check-action="install" onClick={() => void installAgent(r.id, dir).catch(err("Couldn't install it"))} className="h-[33px] shrink-0 whitespace-nowrap rounded-lg border border-border-strong px-[14px] text-[12.5px] font-medium text-text-primary hover:bg-fill-hover">
                  Install
                </button>
              )}
              {r.action === "signin" && !waitingSignin(`agent:${r.id}`) && (
                <button data-check-action="signin" onClick={() => void signInAgent(r.id, dir).catch(err("Couldn't open the sign-in"))} className="h-[33px] shrink-0 whitespace-nowrap rounded-lg border border-border-strong px-[14px] text-[12.5px] font-medium text-text-primary hover:bg-fill-hover">
                  Sign in
                </button>
              )}
            </div>
            {r.chosen && <ConnectorLine agentName={r.name} />}
          </div>
        ))}
      </div>
    </div>
  );
}
```

Create `src/components/chrome/AgentMark.tsx` (the pane header, the assistant avatar and the composer's picker use it from Task 11):

```tsx
/*
 * An agent's mark: Chronigirl for Claude Code (the app's own character), a
 * lettered round tile for every other agent (board 2's "Cx"). Tokens only.
 */
import { Chronigirl } from "@/components/chrome/icons";
import { agentMeta } from "@/lib/agents";

export function AgentMark({ agent, size = 16 }: { agent: string; size?: number }) {
  if (agent === "claude-acp") return <Chronigirl size={size} />;
  const box = size + 4;
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full border border-border-hairline bg-surface-card-raised font-mono font-semibold text-text-secondary"
      style={{ width: box, height: box, fontSize: Math.max(8, Math.round(size * 0.5)) }}
    >
      {agentMeta(agent).short}
    </span>
  );
}
```

- [ ] **Step 6: Put the group on the screen**

In `src/screens/setup/SetupScreen.tsx`, `import { AgentGroup } from "./AgentGroup";`, and in `Checklist` replace

```tsx
      <div className="flex flex-col">{CHECK_META.filter((m) => !DESIGN_META.includes(m)).map((m) => rowFor(m.id))}</div>
```

with

```tsx
      <div className="flex flex-col">{CHECK_META.filter((m) => !DESIGN_META.includes(m) && m.id !== "connector").map((m) => rowFor(m.id))}</div>
      <AgentGroup dir={dir} />
```

(The connector is drawn under the chosen agent now; its check, its install and its place in "Set everything up for me" are unchanged.)

- [ ] **Step 7: Run the checks and look at it**

Run: `npx vitest run && npm run typecheck && npm run build 2>&1 | tail -3`
Expected: all pass. Then `npm run tauri dev`, open Setup & health: the Your agent group lists the four agents in board 1's order with the states this Mac has, the connector line sits under the chosen agent, choosing another agent moves the connector line and its install state.

- [ ] **Step 8: Commit**

```bash
git add src/lib/setup-store.ts src/lib/setup-store.test.ts src/screens/setup/AgentGroup.tsx src/components/chrome/AgentMark.tsx src/screens/setup/SetupScreen.tsx
git commit -m "feat(setup): the Your agent group — four agents with their state, one action each, the chosen agent's connector under it

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: The composer's agent picker and the agent in the header (§3; board 2)

**Files:**
- Create: `src/lib/agents-store.ts`, `src/lib/agents-store.test.ts`
- Modify: `src/screens/agent/Composer.tsx` (a new `AgentPicker` beside `ModeSelect`; rendered in the chips row, chat lane only)
- Modify: `src/screens/agent/AgentSection.tsx` (header and collapsed strip, lines ~170-188), `src/screens/agent/AgentPane.tsx` (empty state ~666-675; `Entry` passes the agent to `AssistantMessage` ~359), `src/screens/agent/AssistantMessage.tsx`, `src/screens/agent/rows.tsx` (`AssistantAvatar`)

**Interfaces:**
- Consumes: `agentsStatus`, `setProjectAgent`, `AgentsStatus` (Task 4); `agentMeta` (Task 9); `AgentMark` (Task 10); `startAgentSession`, `endAgentSession`, `agentSessionFor`, `AgentPhase` (agent-session.ts).
- Produces:
  - `type SwitchPlan = "noop" | "start" | "confirm-restart"`; `agentSwitchPlan(input: { phase: AgentPhase; current: string; next: string }): SwitchPlan` (pure)
  - `switchProjectAgent(dir: string, next: string, confirm: (spec: ConfirmSpec) => void): Promise<void>` — sets the project's agent; starts at once when nothing is live; asks first, then ends and restarts, when a session is live
  - `AssistantMessage` takes `agent: string`; `AssistantAvatar` takes `agent?: string`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/agents-store.test.ts
/*
 * Switching a project's agent: nothing live → set it and start; a session
 * live on the old agent → ask first, then end it and start the new one. The
 * live session keeps its own agent until it ends (Rust holds its profile).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
let phase = "none";
vi.mock("./ipc", () => ({ setProjectAgent: vi.fn(async (_d: string, a: string | null) => { calls.push(`set:${a}`); }) }));
vi.mock("./agent-session", () => ({
  agentSessionFor: () => ({ phase, agent: "claude-acp", turnActive: false }),
  startAgentSession: vi.fn(async () => { calls.push("start"); }),
  endAgentSession: vi.fn(async () => { calls.push("end"); }),
}));

const { agentSwitchPlan, switchProjectAgent } = await import("./agents-store");

describe("agentSwitchPlan", () => {
  it("does nothing for the agent already running", () => {
    expect(agentSwitchPlan({ phase: "ready", current: "codex-acp", next: "codex-acp" })).toBe("noop");
  });
  it("starts at once when no session is live", () => {
    for (const p of ["none", "ended", "error", "needs-login"] as const) expect(agentSwitchPlan({ phase: p, current: "claude-acp", next: "gemini" })).toBe("start");
  });
  it("asks first when a session is live or starting", () => {
    for (const p of ["installing", "starting", "ready"] as const) expect(agentSwitchPlan({ phase: p, current: "claude-acp", next: "gemini" })).toBe("confirm-restart");
  });
});

describe("switchProjectAgent", () => {
  beforeEach(() => { calls.length = 0; });

  it("sets and starts when nothing is live", async () => {
    phase = "none";
    const confirm = vi.fn();
    await switchProjectAgent("/p", "codex-acp", confirm);
    expect(confirm).not.toHaveBeenCalled();
    expect(calls).toEqual(["set:codex-acp", "start"]);
  });

  it("asks first, and only on yes ends the old session and starts the new one", async () => {
    phase = "ready";
    let spec = null as { title: string; onConfirm: () => void } | null; // assigned in the callback
    await switchProjectAgent("/p", "codex-acp", (s) => { spec = s as typeof spec; });
    expect(calls).toEqual([]); // nothing changes before the answer
    expect(spec!.title).toBe("Switch to Codex?");
    await (spec!.onConfirm as () => Promise<void>)();
    expect(calls).toEqual(["set:codex-acp", "end", "start"]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/agents-store.test.ts`
Expected: FAIL — cannot find module `./agents-store`.

- [ ] **Step 3: Write `agents-store.ts`**

```ts
/*
 * The project's agent, as the composer's picker changes it (spec §3). A live
 * session is never re-pointed: it ends after a confirm and the new agent's
 * session starts. Rust keeps each session's own profile until it ends.
 */
import { setProjectAgent } from "./ipc";
import { agentSessionFor, endAgentSession, startAgentSession, type AgentPhase } from "./agent-session";
import { agentMeta } from "./agents";
import type { ConfirmSpec } from "@/overlays/ConfirmDialog";

export type SwitchPlan = "noop" | "start" | "confirm-restart";

export function agentSwitchPlan(input: { phase: AgentPhase; current: string; next: string }): SwitchPlan {
  if (input.next === input.current) return "noop";
  if (input.phase === "installing" || input.phase === "starting" || input.phase === "ready") return "confirm-restart";
  return "start";
}

export async function switchProjectAgent(dir: string, next: string, confirm: (spec: ConfirmSpec) => void): Promise<void> {
  const s = agentSessionFor(dir);
  const plan = agentSwitchPlan({ phase: s.phase, current: s.agent, next });
  if (plan === "noop") return;
  if (plan === "start") {
    await setProjectAgent(dir, next);
    await startAgentSession(dir);
    return;
  }
  const to = agentMeta(next).name;
  confirm({
    title: `Switch to ${to}?`,
    body: s.turnActive
      ? `The agent is still working. Switching ends this session — changes it already made are kept and stay reviewable — and starts a new one with ${to}.`
      : `This ends the current session. Changes it made are kept and stay reviewable. The new session starts fresh with ${to}.`,
    cancelLabel: `Keep ${agentMeta(s.agent).name}`,
    confirmLabel: `Switch to ${to}`,
    onConfirm: async () => {
      await setProjectAgent(dir, next);
      await endAgentSession(dir);
      await startAgentSession(dir);
    },
  });
}
```

If `ConfirmSpec.onConfirm` is typed `() => void`, an `async` function still satisfies it.

- [ ] **Step 4: Run it**

Run: `npx vitest run src/lib/agents-store.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: The picker in the composer**

In `src/screens/agent/Composer.tsx` add imports `import { agentsStatus, type AgentsStatus } from "@/lib/ipc";` (merge into the existing ipc import), `import { switchProjectAgent } from "@/lib/agents-store";`, `import { AgentMark } from "@/components/chrome/AgentMark";`, and below `ModeSelect`:

```tsx
/** The project's agent (spec §3; board 2's "Codex ▾"). Lists the agents this
 *  Mac can run; picking one switches the project (asking first when live). */
function AgentPicker({ dir, projectDir, current, onConfirm }: { dir: string; projectDir: string; current: string; onConfirm: (spec: ConfirmSpec) => void }) {
  const [status, setStatus] = useState<AgentsStatus | null>(null);
  useEffect(() => { void agentsStatus(projectDir).then(setStatus).catch(() => {}); }, [projectDir, current]);
  const choices = (status?.agents ?? []).filter((a) => a.supported);
  if (choices.length < 2) return null; // one agent on this Mac: nothing to pick
  const cur = choices.find((a) => a.id === current);
  return (
    <DropdownMenu>
      <Hint label="The agent that works in this project">
        <DropdownMenuTrigger asChild>
          <button data-agent-picker className="inline-flex h-[26px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-border-strong px-2 text-[11.5px] text-text-primary">
            <AgentMark agent={current} size={12} />
            <span className="max-w-[110px] truncate">{cur?.name ?? current}</span>
            <svg className="shrink-0" width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m3 4.5 3 3 3-3" /></svg>
          </button>
        </DropdownMenuTrigger>
      </Hint>
      <DropdownMenuContent data-config-menu="agent-picker" align="start" side="top" className="w-[260px]">
        <DropdownMenuRadioGroup
          value={current}
          onValueChange={(id) => void switchProjectAgent(dir, id, onConfirm).catch((e) => toastError("Couldn't switch the agent", String(e).slice(0, 90)))}
        >
          {choices.map((a) => (
            <DropdownMenuRadioItem key={a.id} value={a.id} disabled={!a.launchable} className={CONFIG_ROW}>
              <span className="text-[12.5px] text-text-primary">{a.name}</span>
              <span className="text-[11px] leading-snug text-text-dim">{a.launchable ? (a.signedIn === false ? "needs you to sign in" : "ready") : "set it up in Setup & health first"}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

In the chips row, right after the attach button block and before the stance selects, add:

```tsx
        {!designLane && <AgentPicker dir={dir} projectDir={projectDir} current={s.agent} onConfirm={onConfirm} />}
```

(The picker stays usable while the composer is disabled — a session that ended or failed is exactly when a user switches.)

- [ ] **Step 6: The agent's mark and name in the header, the avatar and the empty state**

In `src/screens/agent/AgentSection.tsx`, replace `import { Chronigirl, HistoryClockGlyph } from "@/components/chrome/icons";` with `import { HistoryClockGlyph } from "@/components/chrome/icons";`, add `import { AgentMark } from "@/components/chrome/AgentMark";` and `import { agentMeta } from "@/lib/agents";`, and replace both pairs

```tsx
        <Chronigirl size={15} />
        <span className="text-[11.5px] font-medium text-text-secondary">Chronigirl</span>
```
```tsx
        <Chronigirl size={16} />
        <span className="text-[12.5px] font-medium text-text-primary">Chronigirl</span>
```

with

```tsx
        <AgentMark agent={s.agent} size={15} />
        <span className="text-[11.5px] font-medium text-text-secondary">{agentMeta(s.agent).headerName}</span>
```
```tsx
        <AgentMark agent={s.agent} size={16} />
        <span data-agent-name className="text-[12.5px] font-medium text-text-primary">{agentMeta(s.agent).headerName}</span>
```

In `src/screens/agent/rows.tsx`, replace `AssistantAvatar`:

```tsx
export function AssistantAvatar({ agent = "claude-acp" }: { agent?: string }) {
  return (
    <span className="flex size-[26px] shrink-0 items-center justify-center rounded-full border border-border-hairline bg-surface-card-raised">
      <AgentMark agent={agent} size={agent === "claude-acp" ? 17 : 14} />
    </span>
  );
}
```

with `import { AgentMark } from "@/components/chrome/AgentMark";` replacing the `Chronigirl` import.

In `src/screens/agent/AssistantMessage.tsx`, the signature becomes `export function AssistantMessage({ text, streaming, agent }: { text: string; streaming: boolean; agent: string })`, add `import { agentMeta } from "@/lib/agents";`, and the row opens with `<MessageRow who={agentMeta(agent).headerName} avatar={<AssistantAvatar agent={agent} />}>`.

In `src/screens/agent/AgentPane.tsx`:
- line ~359: `return <AssistantMessage text={entry.text} streaming={entry.streaming} agent={agentSessionFor(dir).agent} />;`
- the empty state: replace `<span className="mb-1.5"><Chronigirl size={48} /></span>` with `<span className="mb-1.5"><AgentMark agent={s.agent} size={44} /></span>` and the line `Chronicle asks before Chronigirl touches your project.` with `{`Chronicle asks before ${agentMeta(s.agent).headerName} touches your project.`}`; import `AgentMark`; drop `Chronigirl` from the icons import if nothing else in the file uses it.
- the "thinking" beat: `<AssistantAvatar />` becomes `<AssistantAvatar agent={s.agent} />`.

- [ ] **Step 7: Run the checks and look at it**

Run: `npx vitest run && npm run typecheck && npm run build 2>&1 | tail -3`
Expected: all pass. Then `npm run tauri dev` with Codex installed: the composer shows "Codex ▾" beside the stance chip; picking Codex with a live Claude session asks "Switch to Codex?"; after yes the header reads "Codex" with the Cx mark, replies are signed "Codex", and the thread shows a flat tool list.

- [ ] **Step 8: Commit**

```bash
git add src/lib/agents-store.ts src/lib/agents-store.test.ts src/screens/agent/Composer.tsx src/screens/agent/AgentSection.tsx src/screens/agent/AgentPane.tsx src/screens/agent/AssistantMessage.tsx src/screens/agent/rows.tsx
git commit -m "feat(agents): the composer picks the project's agent, asking before it ends a live session; the header and replies carry that agent's mark and name

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: `Lane::Reviewer` — a one-turn session that only reads (§9)

The `Agent` provider (Task 13) rides the user's agent through a session that can read the project and nothing else: writes are refused at `fs/write_text_file`, permission asks are answered in Rust (reads and searches allowed once, everything else rejected once, never an "always"), no checkpoint, no ledger, Ask first.

**Files:**
- Modify: `src-tauri/src/acp.rs` (`Lane` ~43-63; `emit_msg` ~1166; `handle_agent_request` ~1469; `handle_fs_write` ~1595; `prompt` ~1645; `handle_response` ~1438; `handshake` ready block; `MOCK_AGENT`; tests)
- Modify: `src-tauri/src/main.rs` (`agent_for`'s lane match ~3608)

**Interfaces:**
- Consumes: `start(…, profile, …)` (Task 5), `profiles::mode_for` (Task 2).
- Produces:
  - `Lane::Reviewer` — key `<canon>#review`, store `<project>/.chronicle/agent/reviews/`, events carry `"lane": "review"`
  - `pub fn reviewer_outcome(params: &Value) -> Value` — the outcome Rust sends for a reviewer's permission ask

- [ ] **Step 1: Write the failing tests**

In `MOCK_AGENT`, add a branch to the `session/prompt` handling, before `elif "DESIGN-FENCE" in text:`:

```python
        elif "REVIEWER-FENCE" in text:
            turn -= 1
            send({"jsonrpc":"2.0","id":500,"method":"fs/write_text_file","params":{
                "sessionId":sid,"path":project+"/reviewer-wrote.txt","content":"no"}})
            opts = [{"optionId":"once","name":"Allow","kind":"allow_once"},
                    {"optionId":"always","name":"Always","kind":"allow_always"},
                    {"optionId":"no","name":"Reject","kind":"reject_once"}]
            send({"jsonrpc":"2.0","id":501,"method":"session/request_permission","params":{
                "sessionId":sid,"toolCall":{"toolCallId":"r1","kind":"edit","title":"Edit a file"},"options":opts}})
            send({"jsonrpc":"2.0","id":502,"method":"session/request_permission","params":{
                "sessionId":sid,"toolCall":{"toolCallId":"r2","kind":"read","title":"Read a file"},"options":opts}})
            state["waiting"] = {"500","501","502"}
            state["review"] = {}
```

and in the response handling (`elif m is None and "id" in msg:`), before `if rid == "102":`:

```python
            if rid in ("500", "501", "502"):
                state["review"][rid] = msg.get("error", {}).get("message") if rid == "500" else msg.get("result", {}).get("outcome", {}).get("optionId")
                w.discard(rid)
                if not w:
                    with open(project + "/.reviewer-answers.json", "w") as f:
                        json.dump(state["review"], f)
                    send({"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"sess-1",
                        "update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"{\"ok\":true}"}}}})
                    send({"jsonrpc":"2.0","id":state["prompt_id"],"result":{"stopReason":"end_turn"}})
                continue
```

In `acp_tests`:

```rust
    #[test]
    fn the_reviewer_lane_reads_and_never_writes() {
        let Some(h) = start_mock_as("reviewer", crate::agents::claude(), Lane::Reviewer, LaneExtras::default()) else { return };
        let ready = wait_for(&h.rx, 20, |v| state_is(v, "ready"));
        assert_eq!(ready.pointer("/lane").and_then(|v| v.as_str()), Some("review"));
        let s = h.state.get(&h.key).unwrap();
        s.prompt(vec![json!({ "type": "text", "text": "REVIEWER-FENCE" })], "review".into()).unwrap();
        let mut saw_checkpoint = false;
        loop {
            let v = h.rx.recv_timeout(Duration::from_secs(20)).expect("the review turn ends");
            if method_is(&v, "_chronicle/checkpoint") { saw_checkpoint = true; }
            if method_is(&v, "_chronicle/turn_end") { break; }
        }
        let answers: Value = serde_json::from_str(&std::fs::read_to_string(h.dir.join(".reviewer-answers.json")).unwrap()).unwrap();
        assert!(answers["500"].as_str().unwrap_or("").contains("reads only"), "the write is refused: {answers}");
        assert_eq!(answers["501"], "no", "an edit ask is rejected once, never shown");
        assert_eq!(answers["502"], "once", "a read is allowed once, never always");
        assert!(!h.dir.join("reviewer-wrote.txt").exists());
        assert!(!saw_checkpoint, "the reviewer takes no checkpoint");
        h.state.drain();
    }

    #[test]
    fn reviewer_outcomes_by_kind() {
        let ask = |kind: &str, opts: Value| json!({ "toolCall": { "toolCallId": "t", "kind": kind }, "options": opts });
        let both = json!([{ "optionId": "y", "kind": "allow_once" }, { "optionId": "a", "kind": "allow_always" }, { "optionId": "n", "kind": "reject_once" }]);
        assert_eq!(reviewer_outcome(&ask("search", both.clone())), json!({ "outcome": "selected", "optionId": "y" }));
        assert_eq!(reviewer_outcome(&ask("execute", both.clone())), json!({ "outcome": "selected", "optionId": "n" }));
        assert_eq!(reviewer_outcome(&ask("read", json!([{ "optionId": "a", "kind": "allow_always" }]))), json!({ "outcome": "cancelled" }), "never an always");
    }
```

- [ ] **Step 2: Run them to see them fail**

Run: `export PATH="$HOME/.cargo/bin:$PATH" && cd src-tauri && cargo test reviewer 2>&1 | tail -10`
Expected: compile errors — no variant `Lane::Reviewer`, `reviewer_outcome` not found.

- [ ] **Step 3: The lane**

In `acp.rs`, `pub enum Lane { Chat, Design, Reviewer }` and:

```rust
    pub fn as_str(self) -> &'static str { match self { Lane::Chat => "chat", Lane::Design => "design", Lane::Reviewer => "review" } }
    pub fn key(self, canon: &str) -> String {
        match self { Lane::Chat => canon.to_string(), Lane::Design => format!("{canon}#design"), Lane::Reviewer => format!("{canon}#review") }
    }
    /// Where this lane's transcripts, ledger and `current` pointer live.
    pub fn store(self, project: &Path) -> PathBuf {
        match self {
            Lane::Chat => ledger::agent_dir(project),
            Lane::Design => crate::designs::designs_root(project).join(".threads"),
            Lane::Reviewer => ledger::agent_dir(project).join("reviews"),
        }
    }
```

(`Lane::parse` stays as is: the frontend never opens a reviewer.) Update the comment above `enum Lane`: "Which of a project's agent sessions a key belongs to: the chat lane, the design lane, and the reviewer — a one-turn, read-only session the provider layer opens (spec §9)."

`emit_msg`: `let dir = self.key.strip_suffix("#design").or_else(|| self.key.strip_suffix("#review")).unwrap_or(&self.key);`

Above `design_mcp_decision` add:

```rust
/// The reviewer's permission answer (spec §9): reads, searches, fetches and
/// thinking are allowed once; everything else is rejected once; with no
/// once-only option the ask is cancelled. Never an "always".
pub fn reviewer_outcome(params: &Value) -> Value {
    let kind = params.pointer("/toolCall/kind").and_then(|v| v.as_str()).unwrap_or("other");
    let reads = matches!(kind, "read" | "search" | "fetch" | "think");
    let options = params.get("options").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let pick = |k: &str| options.iter().find(|o| o["kind"] == k).and_then(|o| o["optionId"].as_str()).map(String::from);
    match pick(if reads { "allow_once" } else { "reject_once" }) {
        Some(option_id) => json!({ "outcome": "selected", "optionId": option_id }),
        None => json!({ "outcome": "cancelled" }),
    }
}
```

In `handle_agent_request`'s `"session/request_permission"` arm, first thing:

```rust
                if self.lane == Lane::Reviewer {
                    let tool_call_id = params.pointer("/toolCall/toolCallId").cloned().unwrap_or(Value::Null);
                    let outcome = reviewer_outcome(&params);
                    let allowed = outcome.get("optionId").is_some() && matches!(params.pointer("/toolCall/kind").and_then(|v| v.as_str()), Some("read" | "search" | "fetch" | "think"));
                    self.respond_ok(&id, json!({ "outcome": outcome }));
                    let guard = json!({ "method": "_chronicle/guard", "params": {
                        "toolCallId": tool_call_id, "allowed": allowed, "path": "", "reason": if allowed { "" } else { "The reviewer reads only." } } });
                    self.append_transcript(&guard);
                    self.emit_msg(guard);
                    return;
                }
```

In `handle_fs_write`, right after the request parses:

```rust
        if self.lane == Lane::Reviewer {
            return self.respond_err(id, -32602, "the reviewer reads only — it can't change files");
        }
```

In `prompt`, wrap the checkpoint `match checkpoint::create_as(…) { … }` in `if self.lane != Lane::Reviewer { … }`.

In `handle_response`'s `Pending::TurnEnd` arm, replace `if self.designs_root.is_some() { self.reconcile_design_turn_end(); } else { self.reconcile_turn_end(); }` with:

```rust
                if self.designs_root.is_some() { self.reconcile_design_turn_end(); }
                else if self.lane != Lane::Reviewer { self.reconcile_turn_end(); }
```

In `handshake`'s `Ok(resp)` arm, replace `ledger::set_current_session(&self.store, &sid);` and `checkpoint::prune_old(&self.repo);` with:

```rust
                if self.lane != Lane::Reviewer {
                    ledger::set_current_session(&self.store, &sid);
                    checkpoint::prune_old(&self.repo);
                }
```

and after the design lane's mode walk-back block add:

```rust
                // the reviewer runs in Ask first, so every non-read reaches reviewer_outcome
                if self.lane == Lane::Reviewer {
                    if let Some(ask) = crate::agents::profiles::mode_for(self.profile, crate::agents::profiles::Stance::Ask) {
                        if resp.pointer("/modes/currentModeId").and_then(|v| v.as_str()) != Some(ask) {
                            let ms = self.clone();
                            std::thread::spawn(move || { let _ = ms.set_mode(ask); });
                        }
                    }
                }
```

In `main.rs` `agent_for`, add the arm `acp::Lane::Reviewer => "the review session isn't running".to_string(),`.

- [ ] **Step 4: Run the Rust tests**

Run: `export PATH="$HOME/.cargo/bin:$PATH" && cd src-tauri && cargo test 2>&1 | tail -5`
Expected: all pass, including the 2 reviewer tests.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/acp.rs src-tauri/src/main.rs
git commit -m "feat(agents): a reviewer lane — one turn on the project's agent that can read and never write

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: The provider layer's core, and the `Agent` provider (§9, §10)

**Files:**
- Create: `src-tauri/src/providers/mod.rs`, `src-tauri/src/providers/schema.rs`, `src-tauri/src/providers/agent.rs`
- Modify: `src-tauri/src/main.rs` (`mod providers;` after `mod agents;`)
- Test: in-file `#[cfg(test)]` modules

**Interfaces:**
- Consumes: `acp::{start, AcpState, Emit, Lane::Reviewer, LaneExtras, adapter_command_for}`, `AcpSession::prompt`, `setup::agent_launch`, `AgentProfile` (Tasks 2-12).
- Produces (the Runs plan's judge and reviewer call exactly these):
  - `pub enum Provider { Agent, Anthropic { key: String }, OpenAI { key: String }, OpenRouter { key: String }, TypeSafe { key: String }, Local { base_url: String } }` with `fn id(&self) -> &'static str`
  - `pub struct CompleteRequest { pub system: String, pub prompt: String, pub schema: Value, pub max_tokens: u32 }`
  - `pub struct DecisionRequest { pub state: String, pub instructions: String, pub criteria: Vec<Criterion> }`
  - `pub enum Criterion { Choice { name, options: Vec<String> }, Score { name, min: i32, max: i32 }, Noul { name } }` (serde tag `type`, snake_case)
  - `pub struct Decision { pub answers: HashMap<String, Answer>, pub model: String, pub self_reported: bool }`
  - `pub enum Answer { Choice { choice, probabilities: HashMap<String, f32>, confidence: f32 }, Score { value: i32, confidence: f32 }, Noul { yes: f32 } }`
  - `pub enum CallError { KeyRefused(String), Failed(String) }` (Display = the message)
  - `pub trait Calls: Send + Sync { fn complete_json(&self, req: &CompleteRequest) -> Result<Value, CallError>; fn decide(&self, req: &DecisionRequest) -> Result<Decision, CallError>; fn model(&self) -> String; }`
  - `pub fn emulate_decide(c: &dyn Calls, req: &DecisionRequest) -> Result<Decision, CallError>` — `self_reported: true`
  - `pub fn decide_with_fallback(primary: &dyn Calls, fallback: &dyn Calls, req: &DecisionRequest) -> Result<Decision, CallError>`; `pub fn complete_with_fallback(primary, fallback, req) -> Result<(Value, Option<String>), CallError>`
  - `schema::{extract_json, check_schema, decision_schema, parse_answers}`
  - `agent::AgentCalls { profile, repo, project_dir, spawn, timeout }` with `AgentCalls::for_project(profile, repo, project_dir)`

The spec's trait returns `Result<_, String>`; this plan returns `CallError` instead, because the fallback in Review Focus 5 must tell a refused key from every other failure without matching on message text. `CallError` displays as the plain message, so callers that only show it lose nothing.

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/src/providers/schema.rs` with its test module:

```rust
#[cfg(test)]
mod schema_tests {
    use super::*;
    use crate::providers::Criterion;
    use serde_json::json;

    fn crit() -> Vec<Criterion> {
        vec![
            Criterion::Choice { name: "action".into(), options: vec!["allow".into(), "confirm".into(), "refuse".into()] },
            Criterion::Score { name: "lanes".into(), min: 1, max: 6 },
            Criterion::Noul { name: "writes_outside".into() },
        ]
    }

    #[test]
    fn json_is_found_in_a_fenced_or_chatty_reply() {
        assert_eq!(extract_json("```json\n{\"a\":1}\n```").unwrap(), json!({ "a": 1 }));
        assert_eq!(extract_json("Sure — here it is: {\"a\": {\"b\": 2}} hope that helps").unwrap(), json!({ "a": { "b": 2 } }));
        assert!(extract_json("no json here").is_err());
    }

    #[test]
    fn the_schema_check_names_what_is_wrong() {
        let s = json!({ "type": "object", "required": ["verdict"], "properties": { "verdict": { "type": "string", "enum": ["pass", "fail"] }, "notes": { "type": "array", "items": { "type": "string" } } } });
        assert!(check_schema(&json!({ "verdict": "pass", "notes": ["ok"] }), &s).is_ok());
        assert_eq!(check_schema(&json!({}), &s).unwrap_err(), "$.verdict is missing");
        assert!(check_schema(&json!({ "verdict": "maybe" }), &s).unwrap_err().contains("allowed"));
        assert!(check_schema(&json!({ "verdict": "pass", "notes": [3] }), &s).unwrap_err().contains("$.notes[0]"));
    }

    #[test]
    fn a_decision_parses_every_criterion() {
        let v = json!({
            "action": { "choice": "confirm", "probabilities": { "allow": 0.2, "confirm": 0.7, "refuse": 0.1 }, "confidence": 0.6 },
            "lanes": { "value": 3, "confidence": 0.8 },
            "writes_outside": { "yes": 0.05 },
        });
        let a = parse_answers(&v, &crit()).unwrap();
        assert_eq!(a["lanes"], crate::providers::Answer::Score { value: 3, confidence: 0.8 });
        assert_eq!(a["writes_outside"], crate::providers::Answer::Noul { yes: 0.05 });
        let crate::providers::Answer::Choice { choice, probabilities, .. } = &a["action"] else { panic!() };
        assert_eq!(choice, "confirm");
        assert_eq!(probabilities["confirm"], 0.7);
    }

    #[test]
    fn an_answer_outside_its_bounds_is_refused() {
        let base = json!({
            "action": { "choice": "allow", "probabilities": { "allow": 1.0, "confirm": 0.0, "refuse": 0.0 }, "confidence": 0.9 },
            "lanes": { "value": 9, "confidence": 0.8 },
            "writes_outside": { "yes": 0.0 },
        });
        assert!(parse_answers(&base, &crit()).unwrap_err().contains("between 1 and 6"));
        let mut p = base.clone();
        p["lanes"]["value"] = json!(2);
        p["writes_outside"]["yes"] = json!(1.4);
        assert!(parse_answers(&p, &crit()).unwrap_err().contains("0–1"));
        let mut c = base.clone();
        c["lanes"]["value"] = json!(2);
        c["action"]["choice"] = json!("maybe");
        assert!(parse_answers(&c, &crit()).is_err());
    }
}
```

Create `src-tauri/src/providers/mod.rs` ending with this test module:

```rust
#[cfg(test)]
mod provider_tests {
    use super::*;
    use serde_json::json;

    struct Canned { reply: Result<Value, CallError>, name: &'static str }
    impl Calls for Canned {
        fn complete_json(&self, _req: &CompleteRequest) -> Result<Value, CallError> { self.reply.clone() }
        fn decide(&self, req: &DecisionRequest) -> Result<Decision, CallError> { emulate_decide(self, req) }
        fn model(&self) -> String { self.name.into() }
    }

    fn noul() -> DecisionRequest {
        DecisionRequest { state: "rm -rf build/".into(), instructions: "Does this command write outside the owned files?".into(), criteria: vec![Criterion::Noul { name: "outside".into() }] }
    }

    #[test]
    fn an_emulated_decision_is_marked_self_reported() {
        let c = Canned { reply: Ok(json!({ "outside": { "yes": 0.1 } })), name: "anthropic/claude-opus-5-5" };
        let d = c.decide(&noul()).unwrap();
        assert!(d.self_reported, "only a native decision model's confidence is not self-reported");
        assert_eq!(d.model, "anthropic/claude-opus-5-5");
        assert_eq!(d.answers["outside"], Answer::Noul { yes: 0.1 });
    }

    #[test]
    fn a_refused_key_falls_back_and_any_other_failure_does_not() {
        let refused = Canned { reply: Err(CallError::KeyRefused("Anthropic refused the saved key".into())), name: "anthropic/x" };
        let broken = Canned { reply: Err(CallError::Failed("Anthropic answered 500".into())), name: "anthropic/x" };
        let agent = Canned { reply: Ok(json!({ "outside": { "yes": 0.3 } })), name: "agent/claude-acp" };
        let d = decide_with_fallback(&refused, &agent, &noul()).unwrap();
        assert_eq!(d.model, "agent/claude-acp (Anthropic refused the saved key)");
        assert!(matches!(decide_with_fallback(&broken, &agent, &noul()), Err(CallError::Failed(m)) if m.contains("500")));
    }

    #[test]
    fn criteria_serialise_with_their_type_tag() {
        let c = Criterion::Choice { name: "action".into(), options: vec!["allow".into()] };
        assert_eq!(serde_json::to_value(&c).unwrap(), json!({ "type": "choice", "name": "action", "options": ["allow"] }));
    }
}
```

Create `src-tauri/src/providers/agent.rs` ending with:

```rust
#[cfg(test)]
mod agent_provider_tests {
    use super::*;
    use crate::providers::{Answer, Calls, CompleteRequest, Criterion, DecisionRequest};
    use serde_json::json;

    const MOCK_REVIEWER: &str = r#"
import sys, json
reply, mode = sys.argv[1], sys.argv[2]
def send(o):
    sys.stdout.write(json.dumps(o) + "\n"); sys.stdout.flush()
for line in sys.stdin:
    m = json.loads(line); meth = m.get("method")
    if meth == "initialize":
        send({"jsonrpc":"2.0","id":m["id"],"result":{"protocolVersion":1,"agentCapabilities":{},"authMethods":[]}})
    elif meth == "session/new":
        if mode == "signed-out":
            send({"jsonrpc":"2.0","id":m["id"],"error":{"code":-32000,"message":"Authentication required"}})
        else:
            send({"jsonrpc":"2.0","id":m["id"],"result":{"sessionId":"r1","modes":{"currentModeId":"default","availableModes":[{"id":"default","name":"Ask"}]}}})
    elif meth == "session/set_mode":
        send({"jsonrpc":"2.0","id":m["id"],"result":{}})
    elif meth == "session/prompt":
        send({"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"r1","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":reply}}}})
        send({"jsonrpc":"2.0","id":m["id"],"result":{"stopReason":"end_turn"}})
"#;

    fn mock(name: &str, reply: &str, mode: &str) -> Option<AgentCalls> {
        let py = ["/usr/bin/python3", "/opt/homebrew/bin/python3", "/usr/local/bin/python3"].iter().find(|p| std::path::Path::new(p).exists())?.to_string();
        let dir = std::env::temp_dir().join(format!("chronicle-review-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let dir = dir.canonicalize().unwrap();
        let script = dir.join(".mock-reviewer.py");
        std::fs::write(&script, MOCK_REVIEWER).unwrap();
        let (reply, mode) = (reply.to_string(), mode.to_string());
        Some(AgentCalls {
            profile: crate::agents::claude(),
            repo: dir.clone(),
            project_dir: dir,
            spawn: std::sync::Arc::new(move || { let mut c = std::process::Command::new(&py); c.arg(&script).arg(&reply).arg(&mode); Ok(c) }),
            timeout: std::time::Duration::from_secs(20),
        })
    }

    #[test]
    fn the_agent_answers_a_schema_checked_json_turn() {
        let Some(a) = mock("json", "Here you go:\n```json\n{\"verdict\":\"pass\",\"notes\":[]}\n```", "ok") else { return };
        let schema = json!({ "type": "object", "required": ["verdict", "notes"], "properties": { "verdict": { "type": "string" }, "notes": { "type": "array" } } });
        let v = a.complete_json(&CompleteRequest { system: "You review diffs.".into(), prompt: "diff --git …".into(), schema, max_tokens: 2000 }).unwrap();
        assert_eq!(v["verdict"], "pass");
        assert_eq!(a.model(), "agent/claude-acp");
    }

    #[test]
    fn the_agent_decides_by_emulation() {
        let Some(a) = mock("decide", "{\"outside\":{\"yes\":0.2}}", "ok") else { return };
        let d = a.decide(&DecisionRequest { state: "ls".into(), instructions: "Does it write?".into(), criteria: vec![Criterion::Noul { name: "outside".into() }] }).unwrap();
        assert!(d.self_reported);
        assert_eq!(d.answers["outside"], Answer::Noul { yes: 0.2 });
    }

    #[test]
    fn a_signed_out_agent_says_so() {
        let Some(a) = mock("signed-out", "{}", "signed-out") else { return };
        let e = a.complete_json(&CompleteRequest { system: String::new(), prompt: "x".into(), schema: json!({ "type": "object" }), max_tokens: 100 }).unwrap_err();
        assert!(e.to_string().contains("isn't signed in"), "{e}");
    }

    #[test]
    fn a_reply_that_breaks_the_schema_is_an_error_not_a_guess() {
        let Some(a) = mock("bad", "{\"verdict\":3}", "ok") else { return };
        let schema = json!({ "type": "object", "required": ["verdict"], "properties": { "verdict": { "type": "string" } } });
        assert!(a.complete_json(&CompleteRequest { system: String::new(), prompt: "x".into(), schema, max_tokens: 100 }).is_err());
    }
}
```

Add `mod providers;` to `main.rs` after `mod agents;`.

- [ ] **Step 2: Run them to see them fail**

Run: `export PATH="$HOME/.cargo/bin:$PATH" && cd src-tauri && cargo test providers:: 2>&1 | tail -20`
Expected: compile errors — `Calls`, `Criterion`, `extract_json`, `AgentCalls` … not found.

- [ ] **Step 3: `providers/mod.rs`**

Above its test module:

```rust
//! Chronicle's own model calls (spec 2026-10-15 §9-§10): the Runs reviewer's
//! verdict and the judge's bounded decisions. Every provider answers the same
//! two calls; `Agent` needs no key and rides the user's agent.
pub mod agent;
pub mod schema;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

pub enum Provider {
    /// A one-turn reviewer session on the project's agent — the default, no key.
    Agent,
    Anthropic { key: String },
    OpenAI { key: String },
    OpenRouter { key: String },
    /// Jev: native decisions only.
    TypeSafe { key: String },
    /// An OpenAI-compatible server on this Mac (Ollama, LM Studio).
    Local { base_url: String },
}

impl Provider {
    pub fn id(&self) -> &'static str {
        match self {
            Provider::Agent => "agent",
            Provider::Anthropic { .. } => "anthropic",
            Provider::OpenAI { .. } => "openai",
            Provider::OpenRouter { .. } => "openrouter",
            Provider::TypeSafe { .. } => "typesafe",
            Provider::Local { .. } => "local",
        }
    }
}

pub struct CompleteRequest { pub system: String, pub prompt: String, pub schema: Value, pub max_tokens: u32 }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Criterion {
    Choice { name: String, options: Vec<String> },
    Score { name: String, min: i32, max: i32 },
    Noul { name: String },
}

impl Criterion {
    pub fn name(&self) -> &str {
        match self { Criterion::Choice { name, .. } | Criterion::Score { name, .. } | Criterion::Noul { name } => name }
    }
}

pub struct DecisionRequest { pub state: String, pub instructions: String, pub criteria: Vec<Criterion> }

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Answer {
    Choice { choice: String, probabilities: HashMap<String, f32>, confidence: f32 },
    Score { value: i32, confidence: f32 },
    Noul { yes: f32 },
}

#[derive(Debug, Clone, Serialize)]
pub struct Decision {
    pub answers: HashMap<String, Answer>,
    pub model: String,
    /// true when the confidence is the model's own claim (every provider but a
    /// native decision model): the REFLEX bands treat it one band stricter.
    pub self_reported: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum CallError {
    /// HTTP 401/403: the saved key no longer works. The caller falls back to the agent.
    KeyRefused(String),
    Failed(String),
}

impl std::fmt::Display for CallError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self { CallError::KeyRefused(m) | CallError::Failed(m) => f.write_str(m) }
    }
}

pub trait Calls: Send + Sync {
    /// One schema-checked JSON answer.
    fn complete_json(&self, req: &CompleteRequest) -> Result<Value, CallError>;
    /// The judge's bounded decisions (spec §10).
    fn decide(&self, req: &DecisionRequest) -> Result<Decision, CallError>;
    /// What answered, for the run record: "<provider>/<model>".
    fn model(&self) -> String;
}

const DECIDE_SYSTEM: &str = "You make small, bounded decisions for a coding tool. For each named criterion give your answer, a probability for every option, and how confident you are, as numbers from 0 to 1. Answer with JSON only.";

/// A decision through `complete_json`, for every provider without native decisions.
pub fn emulate_decide(c: &dyn Calls, req: &DecisionRequest) -> Result<Decision, CallError> {
    let schema = schema::decision_schema(&req.criteria);
    let v = c.complete_json(&CompleteRequest {
        system: DECIDE_SYSTEM.into(),
        prompt: format!("{}\n\n## State\n{}", req.instructions, req.state),
        schema,
        max_tokens: 2000,
    })?;
    let answers = schema::parse_answers(&v, &req.criteria).map_err(CallError::Failed)?;
    Ok(Decision { answers, model: c.model(), self_reported: true })
}

/// A refused key (and only that) falls back; the decision says why.
pub fn decide_with_fallback(primary: &dyn Calls, fallback: &dyn Calls, req: &DecisionRequest) -> Result<Decision, CallError> {
    match primary.decide(req) {
        Err(CallError::KeyRefused(why)) => fallback.decide(req).map(|mut d| { d.model = format!("{} ({why})", d.model); d }),
        other => other,
    }
}

pub fn complete_with_fallback(primary: &dyn Calls, fallback: &dyn Calls, req: &CompleteRequest) -> Result<(Value, Option<String>), CallError> {
    match primary.complete_json(req) {
        Err(CallError::KeyRefused(why)) => fallback.complete_json(req).map(|v| (v, Some(why))),
        other => other.map(|v| (v, None)),
    }
}
```

- [ ] **Step 4: `providers/schema.rs`**

Above its test module:

```rust
//! JSON out of a model's reply, checked against the request's schema — a
//! reply that breaks the schema is an error, never a guess.
use super::{Answer, Criterion};
use serde_json::{json, Map, Value};
use std::collections::HashMap;

pub fn extract_json(text: &str) -> Result<Value, String> {
    let t = text.trim();
    let unfenced = t.strip_prefix("```json").or_else(|| t.strip_prefix("```")).map(|s| s.trim_end().trim_end_matches("```").trim()).unwrap_or(t);
    if let Ok(v) = serde_json::from_str::<Value>(unfenced) { return Ok(v); }
    let (Some(a), Some(b)) = (t.find('{'), t.rfind('}')) else { return Err("the reply had no JSON in it".into()) };
    if b < a { return Err("the reply had no JSON in it".into()); }
    serde_json::from_str(&t[a..=b]).map_err(|e| format!("the reply's JSON didn't parse: {e}"))
}

pub fn check_schema(v: &Value, schema: &Value) -> Result<(), String> { check_at(v, schema, "$") }

fn check_at(v: &Value, s: &Value, at: &str) -> Result<(), String> {
    if let Some(allowed) = s.get("enum").and_then(Value::as_array) {
        if !allowed.contains(v) { return Err(format!("{at} is not one of the allowed values")); }
    }
    let ok = |b: bool, what: &str| if b { Ok(()) } else { Err(format!("{at} should be {what}")) };
    match s.get("type").and_then(Value::as_str) {
        Some("object") => {
            let o = v.as_object().ok_or(format!("{at} should be an object"))?;
            for k in s.get("required").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str) {
                if !o.contains_key(k) { return Err(format!("{at}.{k} is missing")); }
            }
            if let Some(props) = s.get("properties").and_then(Value::as_object) {
                for (k, ps) in props {
                    if let Some(x) = o.get(k) { check_at(x, ps, &format!("{at}.{k}"))?; }
                }
            }
            Ok(())
        }
        Some("array") => {
            let a = v.as_array().ok_or(format!("{at} should be an array"))?;
            if let Some(items) = s.get("items") {
                for (i, x) in a.iter().enumerate() { check_at(x, items, &format!("{at}[{i}]"))?; }
            }
            Ok(())
        }
        Some("string") => ok(v.is_string(), "a string"),
        Some("integer") => ok(v.is_i64() || v.is_u64(), "a whole number"),
        Some("number") => ok(v.is_number(), "a number"),
        Some("boolean") => ok(v.is_boolean(), "true or false"),
        _ => Ok(()),
    }
}

/// The schema an emulated decision must match (strict-mode friendly: every
/// object closed, every property required).
pub fn decision_schema(criteria: &[Criterion]) -> Value {
    let mut props = Map::new();
    let mut required = Vec::new();
    for c in criteria {
        required.push(json!(c.name()));
        let s = match c {
            Criterion::Choice { options, .. } => {
                let probs: Map<String, Value> = options.iter().map(|o| (o.clone(), json!({ "type": "number" }))).collect();
                json!({ "type": "object", "additionalProperties": false, "required": ["choice", "probabilities", "confidence"], "properties": {
                    "choice": { "type": "string", "enum": options },
                    "probabilities": { "type": "object", "additionalProperties": false, "required": options, "properties": probs },
                    "confidence": { "type": "number" } } })
            }
            Criterion::Score { .. } => json!({ "type": "object", "additionalProperties": false, "required": ["value", "confidence"], "properties": {
                "value": { "type": "integer" }, "confidence": { "type": "number" } } }),
            Criterion::Noul { .. } => json!({ "type": "object", "additionalProperties": false, "required": ["yes"], "properties": { "yes": { "type": "number" } } }),
        };
        props.insert(c.name().to_string(), s);
    }
    json!({ "type": "object", "additionalProperties": false, "required": required, "properties": props })
}

fn unit(x: &Value, what: &str) -> Result<f32, String> {
    let f = x.as_f64().ok_or(format!("{what} isn't a number"))?;
    if !(0.0..=1.0).contains(&f) { return Err(format!("{what} is outside 0–1")); }
    Ok(f as f32)
}

pub fn parse_answers(v: &Value, criteria: &[Criterion]) -> Result<HashMap<String, Answer>, String> {
    check_schema(v, &decision_schema(criteria))?;
    let mut out = HashMap::new();
    for c in criteria {
        let a = &v[c.name()];
        let answer = match c {
            Criterion::Choice { name, options } => {
                let mut probabilities = HashMap::new();
                for o in options { probabilities.insert(o.clone(), unit(&a["probabilities"][o], &format!("{name}.probabilities.{o}"))?); }
                Answer::Choice { choice: a["choice"].as_str().unwrap_or_default().to_string(), probabilities, confidence: unit(&a["confidence"], &format!("{name}.confidence"))? }
            }
            Criterion::Score { name, min, max } => {
                let value = a["value"].as_i64().unwrap_or(i64::MIN);
                if value < *min as i64 || value > *max as i64 { return Err(format!("{name} must be between {min} and {max}")); }
                Answer::Score { value: value as i32, confidence: unit(&a["confidence"], &format!("{name}.confidence"))? }
            }
            Criterion::Noul { name } => Answer::Noul { yes: unit(&a["yes"], &format!("{name}.yes"))? },
        };
        out.insert(c.name().to_string(), answer);
    }
    Ok(out)
}
```

- [ ] **Step 5: `providers/agent.rs`**

Above its test module:

```rust
//! The `Agent` provider: one Ask-first, read-only turn (Lane::Reviewer) on the
//! project's own agent, its JSON reply schema-checked. No key; it rides the
//! user's agent login (spec §9).
use super::{emulate_decide, schema, CallError, Calls, CompleteRequest, Decision, DecisionRequest};
use crate::acp::{AcpState, Emit, Lane, LaneExtras};
use crate::agents::AgentProfile;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::{mpsc, Arc};
use std::time::{Duration, Instant};

pub struct AgentCalls {
    pub profile: &'static AgentProfile,
    pub repo: PathBuf,
    pub project_dir: PathBuf,
    pub spawn: Arc<dyn Fn() -> Result<std::process::Command, String> + Send + Sync>,
    pub timeout: Duration,
}

impl AgentCalls {
    pub fn for_project(profile: &'static AgentProfile, repo: PathBuf, project_dir: PathBuf) -> AgentCalls {
        AgentCalls {
            profile,
            repo,
            project_dir,
            spawn: Arc::new(move || {
                let launch = crate::setup::agent_launch(profile.id).ok_or_else(|| format!("{} isn't set up on this Mac", profile.name))?;
                Ok(crate::acp::adapter_command_for(&launch, profile))
            }),
            timeout: Duration::from_secs(180),
        }
    }

    /// Start a reviewer session, send one prompt, return the reply's text.
    fn one_turn(&self, text: String) -> Result<String, CallError> {
        struct Drain(AcpState);
        impl Drop for Drain { fn drop(&mut self) { self.0.drain(); } }
        let state = Drain(AcpState::new());
        let (tx, rx) = mpsc::channel::<Value>();
        let emit: Emit = Arc::new(move |v| { let _ = tx.send(v); });
        let n = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        let key = format!("{}#review-{n}", self.repo.display());
        let cmd = (self.spawn)().map_err(CallError::Failed)?;
        let roots = vec![self.repo.clone(), self.project_dir.clone()];
        crate::acp::start(&state.0, emit, key.clone(), Lane::Reviewer, self.profile, self.repo.clone(), self.project_dir.clone(), roots, None, LaneExtras::default(), None, cmd)
            .map_err(CallError::Failed)?;
        let deadline = Instant::now() + self.timeout;
        let next = || rx.recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .map_err(|_| CallError::Failed(format!("{} didn't answer in time", self.profile.name)));
        let state_word = |v: &Value| (v.pointer("/message/method").and_then(Value::as_str) == Some("_chronicle/session_state"))
            .then(|| v.pointer("/message/params/state").and_then(Value::as_str).unwrap_or("").to_string());
        loop {
            let v = next()?;
            match state_word(&v).as_deref() {
                Some("ready") => break,
                Some("needs-login") if v.pointer("/message/params/waiting") == Some(&json!(true)) => {}
                Some("needs-login") => return Err(CallError::Failed(format!("{} isn't signed in", self.profile.name))),
                Some("error") | Some("ended") => {
                    let why = v.pointer("/message/params/message").and_then(Value::as_str).unwrap_or("the session ended");
                    return Err(CallError::Failed(format!("{} couldn't start a review: {why}", self.profile.name)));
                }
                _ => {}
            }
        }
        let s = state.0.get(&key).ok_or_else(|| CallError::Failed("the review session ended before it started".into()))?;
        s.prompt(vec![json!({ "type": "text", "text": text })], "review".into()).map_err(CallError::Failed)?;
        let mut out = String::new();
        loop {
            let v = next()?;
            if v.pointer("/message/params/update/sessionUpdate").and_then(Value::as_str) == Some("agent_message_chunk") {
                if let Some(t) = v.pointer("/message/params/update/content/text").and_then(Value::as_str) { out.push_str(t); }
            }
            if v.pointer("/message/method").and_then(Value::as_str) == Some("_chronicle/turn_end") {
                if let Some(e) = v.pointer("/message/params/error") { return Err(CallError::Failed(format!("the review turn failed: {e}"))); }
                return Ok(out);
            }
            if state_word(&v).as_deref() == Some("ended") { return Err(CallError::Failed("the review session ended mid-turn".into())); }
        }
    }
}

impl Calls for AgentCalls {
    fn complete_json(&self, req: &CompleteRequest) -> Result<Value, CallError> {
        let text = format!(
            "{}\n\n{}\n\nAnswer with one JSON object and nothing else. It must match this JSON Schema:\n{}",
            req.system, req.prompt, serde_json::to_string(&req.schema).unwrap_or_default()
        );
        let reply = self.one_turn(text)?;
        let v = schema::extract_json(&reply).map_err(CallError::Failed)?;
        schema::check_schema(&v, &req.schema).map_err(CallError::Failed)?;
        Ok(v)
    }
    fn decide(&self, req: &DecisionRequest) -> Result<Decision, CallError> { emulate_decide(self, req) }
    fn model(&self) -> String { format!("agent/{}", self.profile.id) }
}
```

- [ ] **Step 6: Run the tests**

Run: `export PATH="$HOME/.cargo/bin:$PATH" && cd src-tauri && cargo test providers:: 2>&1 | tail -20`
Expected: 11 tests pass (4 schema, 3 provider, 4 agent). `cargo build` may warn that `Provider`, `complete_with_fallback` and `AgentCalls::for_project` are unused; Task 15 uses them.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/providers/mod.rs src-tauri/src/providers/schema.rs src-tauri/src/providers/agent.rs src-tauri/src/main.rs
git commit -m "feat(providers): the provider layer's calls and decision types, and the Agent provider — a read-only turn on your own agent, no key

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: The HTTP providers — Anthropic, OpenAI, OpenRouter, TypeSafe, Local (§9)

Every HTTP call goes through a `Transport` trait. The real one runs `curl -K -` with the URL and headers on stdin (so a key never appears on a process command line) and the body in a 0600 temp file. Tests use a fake transport that records the request and answers with a recorded body.

**Files:**
- Create: `src-tauri/src/providers/http.rs`
- Create: `src-tauri/src/providers/fixtures/anthropic-messages.json`, `openai-responses.json`, `chat-completions.json`, `typesafe-systemone.json`, `error-401.json`
- Modify: `src-tauri/src/providers/mod.rs` (`pub mod http;`)
- Test: `http.rs` `#[cfg(test)]`

**Interfaces:**
- Consumes: `Calls`, `CallError`, `CompleteRequest`, `DecisionRequest`, `Decision`, `emulate_decide`, `decide_with_fallback`, `schema::{extract_json, check_schema, parse_answers}` (Task 13).
- Produces:
  - `pub struct HttpReply { pub status: u16, pub body: Value }`; `pub trait Transport: Send + Sync { fn post_json(&self, url: &str, headers: &[(&str, String)], body: &Value) -> Result<HttpReply, String>; }`
  - `pub struct CurlTransport;` `pub fn curl_config(url, headers, body_file) -> String`; `pub fn parse_curl_output(out: &str) -> Result<HttpReply, String>`
  - `pub struct AnthropicCalls { key, model, t }`, `OpenAICalls { key, model, t }`, `ChatCompatCalls { url, key: Option<String>, model, label, t }` (OpenRouter and Local), `TypeSafeCalls { key, model, t }` — all `t: Arc<dyn Transport>`
  - `pub const OPENROUTER_URL`, `pub fn local_url(base: &str) -> String`

Request shapes, as each API documents them: Anthropic Messages `POST https://api.anthropic.com/v1/messages` with `x-api-key`, `anthropic-version: 2023-06-01`, structured output in `output_config.format` (`{"type":"json_schema","schema":…}`), reply text in `content[].text`, `stop_reason: "refusal"` checked before reading. OpenAI Responses `POST https://api.openai.com/v1/responses` with `text.format` (`{"type":"json_schema","name","schema","strict":true}`), reply text in `output[].content[]` items of type `output_text`. OpenRouter and Local speak Chat Completions with `response_format: {"type":"json_schema","json_schema":{name,schema,strict}}`, reply in `choices[0].message.content`. TypeSafe Jev `POST https://api.typesafe.ai/v1/systemone` with `model`, `state`, `instructions`, `criteria` (Runs spec §5); the response's field names are not in either spec — this plan reads `answers` keyed by criterion name in the same shape as an emulated decision, the fixture records that assumption, and the Task 19 live check confirms or corrects it (correct `parse_jev` and the fixture together).

- [ ] **Step 1: Write the fixtures**

`src-tauri/src/providers/fixtures/anthropic-messages.json`:

```json
{"id":"msg_01Probe","type":"message","role":"assistant","model":"claude-opus-5-5","content":[{"type":"text","text":"{\"outside\":{\"yes\":0.12}}"}],"stop_reason":"end_turn","usage":{"input_tokens":212,"output_tokens":14}}
```

`openai-responses.json`:

```json
{"id":"resp_probe","object":"response","model":"gpt-5","output":[{"type":"reasoning","id":"rs_1","summary":[]},{"type":"message","id":"msg_1","role":"assistant","content":[{"type":"output_text","text":"{\"outside\":{\"yes\":0.2}}","annotations":[]}]}],"usage":{"input_tokens":190,"output_tokens":12}}
```

`chat-completions.json`:

```json
{"id":"gen-probe","object":"chat.completion","model":"openai/gpt-5","choices":[{"index":0,"finish_reason":"stop","message":{"role":"assistant","content":"{\"outside\":{\"yes\":0.3}}"}}],"usage":{"prompt_tokens":180,"completion_tokens":11}}
```

`typesafe-systemone.json`:

```json
{"model":"jev-1.13.0","answers":{"outside":{"yes":0.04}},"usage":{"input_tokens":96}}
```

`error-401.json`:

```json
{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}
```

- [ ] **Step 2: Write the failing tests**

Create `src-tauri/src/providers/http.rs` with its test module:

```rust
#[cfg(test)]
mod http_tests {
    use super::*;
    use crate::providers::{decide_with_fallback, Answer, Calls, CompleteRequest, Criterion, DecisionRequest};
    use serde_json::json;
    use std::sync::Mutex;

    struct Fake { status: u16, body: Value, seen: Mutex<Vec<(String, Vec<(String, String)>, Value)>> }
    impl Fake {
        fn new(status: u16, body: &str) -> Arc<Fake> { Arc::new(Fake { status, body: serde_json::from_str(body).unwrap(), seen: Mutex::new(Vec::new()) }) }
    }
    impl Transport for Fake {
        fn post_json(&self, url: &str, headers: &[(&str, String)], body: &Value) -> Result<HttpReply, String> {
            self.seen.lock().unwrap().push((url.into(), headers.iter().map(|(k, v)| (k.to_string(), v.clone())).collect(), body.clone()));
            Ok(HttpReply { status: self.status, body: self.body.clone() })
        }
    }
    fn header(h: &[(String, String)], k: &str) -> Option<String> { h.iter().find(|(n, _)| n == k).map(|(_, v)| v.clone()) }
    fn noul() -> DecisionRequest {
        DecisionRequest { state: "ls -la".into(), instructions: "Does it write outside?".into(), criteria: vec![Criterion::Noul { name: "outside".into() }] }
    }

    #[test]
    fn anthropic_sends_the_messages_shape_and_reads_the_text() {
        let t = Fake::new(200, include_str!("fixtures/anthropic-messages.json"));
        let c = AnthropicCalls { key: "sk-ant-x".into(), model: "claude-opus-5-5".into(), t: t.clone() };
        let d = c.decide(&noul()).unwrap();
        assert_eq!(d.answers["outside"], Answer::Noul { yes: 0.12 });
        assert!(d.self_reported);
        assert_eq!(d.model, "anthropic/claude-opus-5-5");
        let (url, headers, body) = t.seen.lock().unwrap()[0].clone();
        assert_eq!(url, "https://api.anthropic.com/v1/messages");
        assert_eq!(header(&headers, "x-api-key").as_deref(), Some("sk-ant-x"));
        assert_eq!(header(&headers, "anthropic-version").as_deref(), Some("2023-06-01"));
        assert_eq!(body["output_config"]["format"]["type"], "json_schema");
        assert_eq!(body["messages"][0]["role"], "user");
    }

    #[test]
    fn a_refusal_is_an_error_not_an_answer() {
        let t = Fake::new(200, r#"{"type":"message","content":[],"stop_reason":"refusal","stop_details":{"type":"refusal","category":"cyber"}}"#);
        let c = AnthropicCalls { key: "k".into(), model: "claude-opus-5-5".into(), t };
        assert!(matches!(c.decide(&noul()), Err(CallError::Failed(m)) if m.contains("declined")));
    }

    #[test]
    fn openai_sends_the_responses_shape_and_reads_output_text() {
        let t = Fake::new(200, include_str!("fixtures/openai-responses.json"));
        let c = OpenAICalls { key: "sk-x".into(), model: "gpt-5".into(), t: t.clone() };
        assert_eq!(c.decide(&noul()).unwrap().answers["outside"], Answer::Noul { yes: 0.2 });
        let (url, headers, body) = t.seen.lock().unwrap()[0].clone();
        assert_eq!(url, "https://api.openai.com/v1/responses");
        assert_eq!(header(&headers, "authorization").as_deref(), Some("Bearer sk-x"));
        assert_eq!(body["text"]["format"]["type"], "json_schema");
        assert_eq!(body["text"]["format"]["strict"], true);
    }

    #[test]
    fn openrouter_and_local_speak_chat_completions() {
        let t = Fake::new(200, include_str!("fixtures/chat-completions.json"));
        let or = ChatCompatCalls { url: OPENROUTER_URL.into(), key: Some("or-x".into()), model: "openai/gpt-5".into(), label: "openrouter", t: t.clone() };
        assert_eq!(or.decide(&noul()).unwrap().answers["outside"], Answer::Noul { yes: 0.3 });
        let local = ChatCompatCalls { url: local_url("http://localhost:11434/"), key: None, model: "llama3.1".into(), label: "local", t: t.clone() };
        local.decide(&noul()).unwrap();
        let seen = t.seen.lock().unwrap();
        assert_eq!(seen[0].0, "https://openrouter.ai/api/v1/chat/completions");
        assert_eq!(header(&seen[0].1, "authorization").as_deref(), Some("Bearer or-x"));
        assert_eq!(seen[1].0, "http://localhost:11434/v1/chat/completions");
        assert_eq!(header(&seen[1].1, "authorization"), None, "a local server gets no key");
        assert_eq!(seen[1].2["response_format"]["type"], "json_schema");
        assert_eq!(local_url("http://localhost:1234/v1"), "http://localhost:1234/v1/chat/completions");
    }

    #[test]
    fn typesafe_decides_natively_and_does_not_review() {
        let t = Fake::new(200, include_str!("fixtures/typesafe-systemone.json"));
        let c = TypeSafeCalls { key: "ts-x".into(), model: "jev-1.13.0".into(), t: t.clone() };
        let d = c.decide(&noul()).unwrap();
        assert!(!d.self_reported, "Jev's confidence is its own measurement");
        assert_eq!(d.model, "typesafe/jev-1.13.0");
        assert_eq!(d.answers["outside"], Answer::Noul { yes: 0.04 });
        let (url, _, body) = t.seen.lock().unwrap()[0].clone();
        assert_eq!(url, "https://api.typesafe.ai/v1/systemone");
        assert_eq!(body["criteria"][0], json!({ "type": "noul", "name": "outside" }));
        assert_eq!(body["state"], "ls -la");
        assert!(c.complete_json(&CompleteRequest { system: String::new(), prompt: String::new(), schema: json!({}), max_tokens: 1 }).is_err());
    }

    #[test]
    fn a_refused_key_falls_back_to_the_agent_and_says_so() {
        let t = Fake::new(401, include_str!("fixtures/error-401.json"));
        let anthropic = AnthropicCalls { key: "revoked".into(), model: "claude-opus-5-5".into(), t };
        assert!(matches!(anthropic.decide(&noul()), Err(CallError::KeyRefused(_))));
        // the fallback is a canned agent here; Task 13 tests the real Agent provider
        struct AgentStub;
        impl Calls for AgentStub {
            fn complete_json(&self, _: &CompleteRequest) -> Result<Value, CallError> { Ok(json!({ "outside": { "yes": 0.5 } })) }
            fn decide(&self, r: &DecisionRequest) -> Result<crate::providers::Decision, CallError> { crate::providers::emulate_decide(self, r) }
            fn model(&self) -> String { "agent/claude-acp".into() }
        }
        let d = decide_with_fallback(&anthropic, &AgentStub, &noul()).unwrap();
        assert_eq!(d.model, "agent/claude-acp (Anthropic refused the saved key)");
    }

    #[test]
    fn a_server_error_is_not_masked_as_a_key_problem() {
        let t = Fake::new(529, r#"{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}"#);
        let c = AnthropicCalls { key: "k".into(), model: "m".into(), t };
        assert!(matches!(c.decide(&noul()), Err(CallError::Failed(m)) if m.contains("529") && m.contains("Overloaded")));
    }

    #[test]
    fn the_curl_config_carries_headers_never_argv_and_escapes_quotes() {
        let c = curl_config("https://x/y", &[("authorization", "Bearer a\"b".into())], std::path::Path::new("/tmp/body.json"));
        assert!(c.contains("url = \"https://x/y\""));
        assert!(c.contains("header = \"authorization: Bearer a\\\"b\""));
        assert!(c.contains("data-binary = \"@/tmp/body.json\""));
        assert!(c.contains("write-out = \"\\n%{http_code}\""));
    }

    #[test]
    fn curl_output_splits_into_body_and_status() {
        let r = parse_curl_output("{\"ok\":true}\n200").unwrap();
        assert_eq!(r.status, 200);
        assert_eq!(r.body, json!({ "ok": true }));
        let e = parse_curl_output("<html>bad gateway</html>\n502").unwrap();
        assert_eq!(e.status, 502);
        assert_eq!(e.body, json!({ "error": { "message": "<html>bad gateway</html>" } }));
        assert!(parse_curl_output("").is_err());
    }
}
```

Add `pub mod http;` to `providers/mod.rs`.

- [ ] **Step 3: Run them to see them fail**

Run: `export PATH="$HOME/.cargo/bin:$PATH" && cd src-tauri && cargo test http_tests 2>&1 | tail -20`
Expected: compile errors — `AnthropicCalls`, `Transport`, `curl_config` … not found.

- [ ] **Step 4: Write `http.rs`**

Above the test module:

```rust
//! The keyed providers, over `curl` (no HTTP crate in the build). The key goes
//! to curl in a config read from stdin, the body in a 0600 temp file: neither
//! shows up in `ps`.
use super::{emulate_decide, schema, CallError, Calls, CompleteRequest, Decision, DecisionRequest};
use serde_json::{json, Value};
use std::io::Write;
use std::path::Path;
use std::sync::Arc;

pub struct HttpReply { pub status: u16, pub body: Value }

pub trait Transport: Send + Sync {
    fn post_json(&self, url: &str, headers: &[(&str, String)], body: &Value) -> Result<HttpReply, String>;
}

fn q(s: &str) -> String { s.replace('\\', "\\\\").replace('"', "\\\"") }

pub fn curl_config(url: &str, headers: &[(&str, String)], body_file: &Path) -> String {
    let mut c = format!("url = \"{}\"\nrequest = \"POST\"\nsilent\nshow-error\nmax-time = 120\nwrite-out = \"\\n%{{http_code}}\"\n", q(url));
    for (k, v) in headers { c.push_str(&format!("header = \"{}: {}\"\n", q(k), q(v))); }
    c.push_str(&format!("data-binary = \"@{}\"\n", q(&body_file.to_string_lossy())));
    c
}

/// curl's stdout with `write-out "\n%{http_code}"`: the body, a newline, the status.
pub fn parse_curl_output(out: &str) -> Result<HttpReply, String> {
    let (body, code) = out.rsplit_once('\n').ok_or("the provider sent nothing back")?;
    let status: u16 = code.trim().parse().map_err(|_| "the provider's answer had no status".to_string())?;
    let body = serde_json::from_str(body).unwrap_or_else(|_| json!({ "error": { "message": body.trim().chars().take(200).collect::<String>() } }));
    Ok(HttpReply { status, body })
}

pub struct CurlTransport;

impl Transport for CurlTransport {
    fn post_json(&self, url: &str, headers: &[(&str, String)], body: &Value) -> Result<HttpReply, String> {
        use std::os::unix::fs::OpenOptionsExt;
        let n = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        let path = std::env::temp_dir().join(format!("chronicle-provider-{}-{n}.json", std::process::id()));
        {
            let mut f = std::fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(&path).map_err(|e| e.to_string())?;
            f.write_all(serde_json::to_string(body).map_err(|e| e.to_string())?.as_bytes()).map_err(|e| e.to_string())?;
        }
        let run = || -> Result<HttpReply, String> {
            let mut child = std::process::Command::new("curl").args(["-K", "-"])
                .stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped())
                .spawn().map_err(|e| format!("couldn't run curl: {e}"))?;
            child.stdin.take().ok_or("no stdin")?.write_all(curl_config(url, headers, &path).as_bytes()).map_err(|e| e.to_string())?;
            let out = child.wait_with_output().map_err(|e| e.to_string())?;
            if out.stdout.is_empty() {
                return Err(format!("couldn't reach the provider: {}", String::from_utf8_lossy(&out.stderr).trim()));
            }
            parse_curl_output(&String::from_utf8_lossy(&out.stdout))
        };
        let r = run();
        let _ = std::fs::remove_file(&path);
        r
    }
}

fn check_status(r: &HttpReply, who: &str) -> Result<(), CallError> {
    match r.status {
        200..=299 => Ok(()),
        401 | 403 => Err(CallError::KeyRefused(format!("{who} refused the saved key"))),
        s => Err(CallError::Failed(format!("{who} answered {s}: {}", r.body.pointer("/error/message").and_then(Value::as_str).unwrap_or("no detail")))),
    }
}

fn finish(text: &str, req: &CompleteRequest) -> Result<Value, CallError> {
    let v = schema::extract_json(text).map_err(CallError::Failed)?;
    schema::check_schema(&v, &req.schema).map_err(CallError::Failed)?;
    Ok(v)
}

pub struct AnthropicCalls { pub key: String, pub model: String, pub t: Arc<dyn Transport> }

impl Calls for AnthropicCalls {
    fn complete_json(&self, req: &CompleteRequest) -> Result<Value, CallError> {
        let body = json!({
            "model": self.model,
            "max_tokens": req.max_tokens,
            "system": req.system,
            "messages": [{ "role": "user", "content": req.prompt }],
            "output_config": { "format": { "type": "json_schema", "schema": req.schema } },
        });
        let r = self.t.post_json("https://api.anthropic.com/v1/messages",
            &[("x-api-key", self.key.clone()), ("anthropic-version", "2023-06-01".into()), ("content-type", "application/json".into())], &body)
            .map_err(CallError::Failed)?;
        check_status(&r, "Anthropic")?;
        if r.body["stop_reason"] == "refusal" { return Err(CallError::Failed("Anthropic declined to answer this one".into())); }
        let text: String = r.body["content"].as_array().into_iter().flatten()
            .filter(|b| b["type"] == "text").filter_map(|b| b["text"].as_str()).collect();
        finish(&text, req)
    }
    fn decide(&self, req: &DecisionRequest) -> Result<Decision, CallError> { emulate_decide(self, req) }
    fn model(&self) -> String { format!("anthropic/{}", self.model) }
}

pub struct OpenAICalls { pub key: String, pub model: String, pub t: Arc<dyn Transport> }

impl Calls for OpenAICalls {
    fn complete_json(&self, req: &CompleteRequest) -> Result<Value, CallError> {
        let body = json!({
            "model": self.model,
            "instructions": req.system,
            "input": req.prompt,
            "max_output_tokens": req.max_tokens,
            "text": { "format": { "type": "json_schema", "name": "chronicle", "schema": req.schema, "strict": true } },
        });
        let r = self.t.post_json("https://api.openai.com/v1/responses",
            &[("authorization", format!("Bearer {}", self.key)), ("content-type", "application/json".into())], &body)
            .map_err(CallError::Failed)?;
        check_status(&r, "OpenAI")?;
        let text: String = r.body["output"].as_array().into_iter().flatten()
            .filter(|o| o["type"] == "message")
            .flat_map(|o| o["content"].as_array().cloned().unwrap_or_default())
            .filter(|c| c["type"] == "output_text").filter_map(|c| c["text"].as_str().map(String::from)).collect();
        finish(&text, req)
    }
    fn decide(&self, req: &DecisionRequest) -> Result<Decision, CallError> { emulate_decide(self, req) }
    fn model(&self) -> String { format!("openai/{}", self.model) }
}

pub const OPENROUTER_URL: &str = "https://openrouter.ai/api/v1/chat/completions";

/// A local server's chat endpoint from the address the user typed.
pub fn local_url(base: &str) -> String {
    let b = base.trim().trim_end_matches('/');
    if b.ends_with("/v1") { format!("{b}/chat/completions") } else { format!("{b}/v1/chat/completions") }
}

pub struct ChatCompatCalls { pub url: String, pub key: Option<String>, pub model: String, pub label: &'static str, pub t: Arc<dyn Transport> }

impl Calls for ChatCompatCalls {
    fn complete_json(&self, req: &CompleteRequest) -> Result<Value, CallError> {
        let body = json!({
            "model": self.model,
            "max_tokens": req.max_tokens,
            "messages": [{ "role": "system", "content": req.system }, { "role": "user", "content": req.prompt }],
            "response_format": { "type": "json_schema", "json_schema": { "name": "chronicle", "schema": req.schema, "strict": true } },
        });
        let mut headers = vec![("content-type", "application/json".to_string())];
        if let Some(k) = &self.key { headers.push(("authorization", format!("Bearer {k}"))); }
        let who = if self.label == "local" { "The local server" } else { "OpenRouter" };
        let r = self.t.post_json(&self.url, &headers, &body).map_err(CallError::Failed)?;
        check_status(&r, who)?;
        finish(r.body.pointer("/choices/0/message/content").and_then(Value::as_str).unwrap_or(""), req)
    }
    fn decide(&self, req: &DecisionRequest) -> Result<Decision, CallError> { emulate_decide(self, req) }
    fn model(&self) -> String { format!("{}/{}", self.label, self.model) }
}

pub struct TypeSafeCalls { pub key: String, pub model: String, pub t: Arc<dyn Transport> }

/// Jev's reply → answers. ASSUMED shape (not in either spec): `answers` keyed
/// by criterion name, each in the emulated decision's shape. Confirmed live in Task 19.
fn parse_jev(body: &Value, req: &DecisionRequest) -> Result<std::collections::HashMap<String, super::Answer>, String> {
    schema::parse_answers(body.get("answers").ok_or("Jev's answer had no answers in it")?, &req.criteria)
}

impl Calls for TypeSafeCalls {
    fn complete_json(&self, _req: &CompleteRequest) -> Result<Value, CallError> {
        Err(CallError::Failed("TypeSafe answers decisions only — choose another provider for review".into()))
    }
    fn decide(&self, req: &DecisionRequest) -> Result<Decision, CallError> {
        let body = json!({ "model": self.model, "state": req.state, "instructions": req.instructions, "criteria": req.criteria });
        let r = self.t.post_json("https://api.typesafe.ai/v1/systemone",
            &[("authorization", format!("Bearer {}", self.key)), ("content-type", "application/json".into())], &body)
            .map_err(CallError::Failed)?;
        check_status(&r, "TypeSafe")?;
        let answers = parse_jev(&r.body, req).map_err(CallError::Failed)?;
        let model = r.body["model"].as_str().unwrap_or(&self.model).to_string();
        Ok(Decision { answers, model: format!("typesafe/{model}"), self_reported: false })
    }
    fn model(&self) -> String { format!("typesafe/{}", self.model) }
}
```

- [ ] **Step 5: Run the tests**

Run: `export PATH="$HOME/.cargo/bin:$PATH" && cd src-tauri && cargo test providers:: 2>&1 | tail -20`
Expected: 20 tests pass (11 from Task 13, 9 here).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/providers/http.rs src-tauri/src/providers/mod.rs src-tauri/src/providers/fixtures/anthropic-messages.json src-tauri/src/providers/fixtures/openai-responses.json src-tauri/src/providers/fixtures/chat-completions.json src-tauri/src/providers/fixtures/typesafe-systemone.json src-tauri/src/providers/fixtures/error-401.json
git commit -m "feat(providers): Anthropic, OpenAI, OpenRouter, TypeSafe and a local server behind one trait, over curl with keys off the command line; a refused key falls back to your agent

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 15: Keys in the Keychain, the two roles, and the provider commands (§9)

**Files:**
- Create: `src-tauri/src/providers/keys.rs`, `src-tauri/src/providers/config.rs`
- Modify: `src-tauri/src/providers/mod.rs` (`pub mod config; pub mod keys;`)
- Modify: `src-tauri/src/main.rs` (commands `providers_status`, `provider_key_set`, `provider_key_remove`, `provider_role_set`, `provider_local_set`; `provider_calls`; the handler list)
- Modify: `src/lib/ipc.ts` (bindings and types)
- Test: `keys.rs`, `config.rs` `#[cfg(test)]`; one `#[ignore]` live test in `config.rs`

**Interfaces:**
- Consumes: `Provider`, `Calls`, `AgentCalls::for_project` (Task 13); `AnthropicCalls`, `OpenAICalls`, `ChatCompatCalls`, `TypeSafeCalls`, `CurlTransport`, `Transport`, `local_url`, `OPENROUTER_URL` (Task 14); `load_config`, `save_config`, `project_key` (Task 4); `setup::chosen_agent_for` (Task 3).
- Produces:
  - `keys::Secrets` trait (`get`, `has`, `set`, `remove`), `keys::Keychain`, `#[cfg(test)] keys::FakeSecrets`, `keys::service(id) -> "chronicle.provider.<id>"`, `keys::add_command(service, account, secret) -> Result<String, String>`
  - `config::{Role, KEY_PROVIDERS, model_for, role_choice, effective_choice, resolve, set_role, forget_key, set_local, calls_for, status}`
  - `config.json` shape: `providers: { review: "<id>", decisions: "<id>", local_base_url: "http://…", models: { "<id>": "<model>" } }` — absent means `agent` and the default models
  - Tauri `providers_status() -> { roles: { review, decisions }, providers: [{ id, name, saved, address? }] }`, `provider_key_set(id, key)`, `provider_key_remove(id)` (a role that used it falls back to `agent`), `provider_role_set(role, provider)`, `provider_local_set(baseUrl: Option<String>)`
  - `main.rs`: `pub(crate) fn provider_calls(p: &Project, dir: &str, role: providers::config::Role) -> (Box<dyn providers::Calls>, Box<dyn providers::Calls>)` — the role's provider and the agent to fall back to (the Runs plan calls it)
  - TS: `ProvidersStatus`, `providersStatus()`, `providerKeySet(id, key)`, `providerKeyRemove(id)`, `providerRoleSet(role, provider)`, `providerLocalSet(baseUrl)`

The default models are this plan's choice (the spec names none) and live in one table in `config.rs`; a `providers.models` entry in `config.json` overrides any of them: Anthropic `claude-opus-5-5`, OpenAI `gpt-5`, OpenRouter `openai/gpt-5`, TypeSafe `jev-1.13.0`, Local `llama3.1`.

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/src/providers/keys.rs` with:

```rust
#[cfg(test)]
mod keys_tests {
    use super::*;

    #[test]
    fn the_add_command_quotes_and_refuses_what_it_cannot_store() {
        assert_eq!(add_command("chronicle.provider.anthropic", "tg", "sk-ant-1").unwrap(),
            "add-generic-password -U -s \"chronicle.provider.anthropic\" -a \"tg\" -w \"sk-ant-1\"\n");
        assert!(add_command("s", "a", "we\"ird\\key").unwrap().contains("-w \"we\\\"ird\\\\key\""));
        assert!(add_command("s", "a", "  ").is_err());
        assert!(add_command("s", "a", "two\nlines").is_err());
    }

    #[test]
    fn the_service_name_is_per_provider() {
        assert_eq!(service("openrouter"), "chronicle.provider.openrouter");
    }

    #[test]
    fn the_fake_keeps_and_forgets() {
        let f = FakeSecrets::new();
        assert!(!f.has("anthropic"));
        f.set("anthropic", " sk-1 ").unwrap();
        assert_eq!(f.get("anthropic").as_deref(), Some("sk-1"));
        f.remove("anthropic").unwrap();
        assert!(f.get("anthropic").is_none());
    }
}
```

Create `src-tauri/src/providers/config.rs` with:

```rust
#[cfg(test)]
mod config_tests {
    use super::*;
    use crate::providers::keys::{FakeSecrets, Secrets};
    use serde_json::json;

    #[test]
    fn both_roles_default_to_the_agent() {
        let cfg = json!({});
        let s = FakeSecrets::new();
        assert_eq!(role_choice(&cfg, Role::Review), "agent");
        assert_eq!(resolve(&cfg, Role::Decisions, &s).id(), "agent");
    }

    #[test]
    fn a_role_needs_its_key_first_and_typesafe_never_reviews() {
        let mut cfg = json!({});
        let s = FakeSecrets::new();
        assert!(set_role(&mut cfg, Role::Review, "anthropic", &s).unwrap_err().contains("Anthropic key"));
        s.set("anthropic", "sk-1").unwrap();
        set_role(&mut cfg, Role::Review, "anthropic", &s).unwrap();
        assert_eq!(cfg["providers"]["review"], "anthropic");
        assert!(matches!(resolve(&cfg, Role::Review, &s), crate::providers::Provider::Anthropic { key } if key == "sk-1"));
        s.set("typesafe", "ts-1").unwrap();
        assert!(set_role(&mut cfg, Role::Review, "typesafe", &s).unwrap_err().contains("decisions only"));
        set_role(&mut cfg, Role::Decisions, "typesafe", &s).unwrap();
        assert_eq!(resolve(&cfg, Role::Decisions, &s).id(), "typesafe");
        assert!(set_role(&mut cfg, Role::Review, "gemini", &s).is_err());
    }

    #[test]
    fn removing_a_key_falls_its_roles_back_to_the_agent() {
        let mut cfg = json!({ "providers": { "review": "openai", "decisions": "openai" } });
        assert!(forget_key(&mut cfg, "openai"));
        assert_eq!(cfg["providers"], json!({ "review": "agent", "decisions": "agent" }));
        assert!(!forget_key(&mut cfg, "openai"));
    }

    #[test]
    fn a_key_gone_from_the_keychain_reads_as_the_agent() {
        let cfg = json!({ "providers": { "decisions": "openrouter" } });
        let s = FakeSecrets::new();
        assert_eq!(resolve(&cfg, Role::Decisions, &s).id(), "agent");
        assert_eq!(effective_choice(&cfg, Role::Decisions, &s), "agent");
    }

    #[test]
    fn a_local_server_needs_an_http_address() {
        let mut cfg = json!({});
        let s = FakeSecrets::new();
        assert!(set_role(&mut cfg, Role::Decisions, "local", &s).is_err());
        assert!(set_local(&mut cfg, Some("localhost:11434")).is_err());
        set_local(&mut cfg, Some("http://localhost:11434")).unwrap();
        set_role(&mut cfg, Role::Decisions, "local", &s).unwrap();
        assert!(matches!(resolve(&cfg, Role::Decisions, &s), crate::providers::Provider::Local { base_url } if base_url == "http://localhost:11434"));
        set_local(&mut cfg, None).unwrap();
        assert_eq!(role_choice(&cfg, Role::Decisions), "agent", "clearing the address falls the role back");
    }

    #[test]
    fn models_default_and_override() {
        assert_eq!(model_for(&json!({}), "anthropic"), "claude-opus-5-5");
        assert_eq!(model_for(&json!({ "providers": { "models": { "anthropic": "claude-sonnet-5-5" } } }), "anthropic"), "claude-sonnet-5-5");
    }

    #[test]
    fn the_status_lists_five_providers_and_never_a_key() {
        let s = FakeSecrets::new();
        s.set("openrouter", "or-secret").unwrap();
        let st = status(&json!({ "providers": { "local_base_url": "http://localhost:1234" } }), &s);
        let ids: Vec<&str> = st["providers"].as_array().unwrap().iter().map(|p| p["id"].as_str().unwrap()).collect();
        assert_eq!(ids, ["anthropic", "openai", "openrouter", "typesafe", "local"]);
        assert_eq!(st["providers"][2]["saved"], true);
        assert_eq!(st["providers"][4]["address"], "http://localhost:1234");
        assert!(!st.to_string().contains("or-secret"), "a key never leaves Rust");
        assert_eq!(st["roles"], json!({ "review": "agent", "decisions": "agent" }));
    }

    /// Live: one decision from every provider that has a key saved on this Mac.
    /// CHRONICLE_PROVIDER_LIVE=1 cargo test live_providers -- --ignored --nocapture
    #[test]
    #[ignore]
    fn live_providers_answer_one_decision() {
        if std::env::var("CHRONICLE_PROVIDER_LIVE").ok().as_deref() != Some("1") { eprintln!("skipped"); return; }
        let keys = crate::providers::keys::Keychain;
        let t: std::sync::Arc<dyn crate::providers::http::Transport> = std::sync::Arc::new(crate::providers::http::CurlTransport);
        let req = crate::providers::DecisionRequest {
            state: "git status".into(),
            instructions: "Does this shell command change any file?".into(),
            criteria: vec![crate::providers::Criterion::Noul { name: "writes".into() }, crate::providers::Criterion::Choice { name: "action".into(), options: vec!["allow".into(), "refuse".into()] }],
        };
        for (id, _) in KEY_PROVIDERS {
            let Some(key) = keys.get(id) else { eprintln!("{id}: no key saved"); continue };
            let p = match id { "anthropic" => crate::providers::Provider::Anthropic { key }, "openai" => crate::providers::Provider::OpenAI { key }, "openrouter" => crate::providers::Provider::OpenRouter { key }, _ => crate::providers::Provider::TypeSafe { key } };
            let agent = crate::providers::agent::AgentCalls::for_project(crate::agents::claude(), std::env::temp_dir(), std::env::temp_dir());
            let c = calls_for(&p, &json!({}), t.clone(), agent);
            match c.decide(&req) { Ok(d) => eprintln!("{id}: {} {:?}", d.model, d.answers), Err(e) => eprintln!("{id}: FAILED {e}") }
        }
    }
}
```

Add `pub mod config;` and `pub mod keys;` to `providers/mod.rs`.

- [ ] **Step 2: Run them to see them fail**

Run: `export PATH="$HOME/.cargo/bin:$PATH" && cd src-tauri && cargo test providers:: 2>&1 | tail -20`
Expected: compile errors — `add_command`, `FakeSecrets`, `Role`, `resolve` … not found.

- [ ] **Step 3: `keys.rs`**

Above its test module:

```rust
//! Provider keys in the macOS Keychain (spec §9): service
//! `chronicle.provider.<id>`, account = the user. Written through
//! `security -i` on stdin so a key is never on a command line; read with
//! `find-generic-password -w`. Never in a repo file, never in config.json.
use std::io::Write;
use std::process::{Command, Stdio};

pub trait Secrets: Send + Sync {
    fn get(&self, id: &str) -> Option<String>;
    /// Is a key saved? (No secret read — the Setup row only needs yes or no.)
    fn has(&self, id: &str) -> bool { self.get(id).is_some() }
    fn set(&self, id: &str, secret: &str) -> Result<(), String>;
    fn remove(&self, id: &str) -> Result<(), String>;
}

pub fn service(id: &str) -> String { format!("chronicle.provider.{id}") }

fn account() -> String { std::env::var("USER").unwrap_or_else(|_| "chronicle".into()) }

/// One `security -i` line that saves (or replaces, `-U`) a key.
pub fn add_command(service: &str, account: &str, secret: &str) -> Result<String, String> {
    let secret = secret.trim();
    if secret.is_empty() { return Err("paste a key first".into()); }
    if secret.contains('\n') || secret.contains('\r') { return Err("a key is a single line".into()); }
    let q = |s: &str| format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""));
    Ok(format!("add-generic-password -U -s {} -a {} -w {}\n", q(service), q(account), q(secret)))
}

pub struct Keychain;

impl Secrets for Keychain {
    fn get(&self, id: &str) -> Option<String> {
        let out = Command::new("security").args(["find-generic-password", "-s", &service(id), "-a", &account(), "-w"])
            .stdin(Stdio::null()).stderr(Stdio::null()).output().ok()?;
        if !out.status.success() { return None; }
        let k = String::from_utf8_lossy(&out.stdout).trim().to_string();
        (!k.is_empty()).then_some(k)
    }
    fn has(&self, id: &str) -> bool {
        Command::new("security").args(["find-generic-password", "-s", &service(id), "-a", &account()])
            .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
            .status().map(|s| s.success()).unwrap_or(false)
    }
    fn set(&self, id: &str, secret: &str) -> Result<(), String> {
        let line = add_command(&service(id), &account(), secret)?;
        let mut child = Command::new("security").arg("-i")
            .stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::piped())
            .spawn().map_err(|e| format!("couldn't reach your Keychain: {e}"))?;
        child.stdin.take().ok_or("no stdin")?.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
        let out = child.wait_with_output().map_err(|e| e.to_string())?;
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        if !out.status.success() || !err.is_empty() { return Err(format!("couldn't save the key in your Keychain: {err}")); }
        if self.get(id).as_deref() != Some(secret.trim()) { return Err("the Keychain didn't keep the key".into()); }
        Ok(())
    }
    fn remove(&self, id: &str) -> Result<(), String> {
        // not found is fine: the key is gone either way
        let _ = Command::new("security").args(["delete-generic-password", "-s", &service(id), "-a", &account()])
            .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).status();
        Ok(())
    }
}

/// The Keychain's stand-in for tests: nothing touches the real one.
#[cfg(test)]
pub struct FakeSecrets(std::sync::Mutex<std::collections::HashMap<String, String>>);

#[cfg(test)]
impl FakeSecrets {
    pub fn new() -> FakeSecrets { FakeSecrets(std::sync::Mutex::new(std::collections::HashMap::new())) }
}

#[cfg(test)]
impl Secrets for FakeSecrets {
    fn get(&self, id: &str) -> Option<String> { self.0.lock().unwrap().get(id).cloned() }
    fn set(&self, id: &str, secret: &str) -> Result<(), String> {
        add_command("s", "a", secret)?;
        self.0.lock().unwrap().insert(id.into(), secret.trim().into());
        Ok(())
    }
    fn remove(&self, id: &str) -> Result<(), String> { self.0.lock().unwrap().remove(id); Ok(()) }
}
```

- [ ] **Step 4: `config.rs`**

Above its test module:

```rust
//! Which provider answers each role (spec §9), read from config.json, with
//! keys from the Keychain. A role whose key or address is missing is the agent.
use super::agent::AgentCalls;
use super::http::{local_url, AnthropicCalls, ChatCompatCalls, OpenAICalls, Transport, TypeSafeCalls, OPENROUTER_URL};
use super::keys::Secrets;
use super::{Calls, Provider};
use serde_json::{json, Value};
use std::sync::Arc;

pub const KEY_PROVIDERS: [(&str, &str); 4] = [("anthropic", "Anthropic"), ("openai", "OpenAI"), ("openrouter", "OpenRouter"), ("typesafe", "TypeSafe")];

const DEFAULT_MODELS: [(&str, &str); 5] = [
    ("anthropic", "claude-opus-5-5"),
    ("openai", "gpt-5"),
    ("openrouter", "openai/gpt-5"),
    ("typesafe", "jev-1.13.0"),
    ("local", "llama3.1"),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role { Review, Decisions }

impl Role {
    pub fn parse(s: &str) -> Option<Role> { match s { "review" => Some(Role::Review), "decisions" => Some(Role::Decisions), _ => None } }
    pub fn as_str(self) -> &'static str { match self { Role::Review => "review", Role::Decisions => "decisions" } }
}

fn name_of(id: &str) -> &'static str {
    KEY_PROVIDERS.iter().find(|(p, _)| *p == id).map(|(_, n)| *n).unwrap_or("Local")
}

pub fn model_for(cfg: &Value, id: &str) -> String {
    cfg.pointer(&format!("/providers/models/{id}")).and_then(Value::as_str).map(String::from)
        .unwrap_or_else(|| DEFAULT_MODELS.iter().find(|(p, _)| *p == id).map(|(_, m)| m.to_string()).unwrap_or_default())
}

pub fn role_choice(cfg: &Value, role: Role) -> String {
    cfg.pointer(&format!("/providers/{}", role.as_str())).and_then(Value::as_str).unwrap_or("agent").to_string()
}

fn local_base(cfg: &Value) -> Option<String> {
    cfg.pointer("/providers/local_base_url").and_then(Value::as_str).filter(|s| !s.is_empty()).map(String::from)
}

fn allowed(role: Role, id: &str) -> bool { !(role == Role::Review && id == "typesafe") }

/// The provider that will actually answer: the chosen one when its key or address is there, else the agent.
pub fn resolve(cfg: &Value, role: Role, secrets: &dyn Secrets) -> Provider {
    let id = role_choice(cfg, role);
    if !allowed(role, &id) { return Provider::Agent; }
    let p = match id.as_str() {
        "anthropic" => secrets.get("anthropic").map(|key| Provider::Anthropic { key }),
        "openai" => secrets.get("openai").map(|key| Provider::OpenAI { key }),
        "openrouter" => secrets.get("openrouter").map(|key| Provider::OpenRouter { key }),
        "typesafe" => secrets.get("typesafe").map(|key| Provider::TypeSafe { key }),
        "local" => local_base(cfg).map(|base_url| Provider::Local { base_url }),
        _ => None,
    };
    p.unwrap_or(Provider::Agent)
}

/// `resolve` without reading a secret: what the Setup row shows as the role's provider.
pub fn effective_choice(cfg: &Value, role: Role, secrets: &dyn Secrets) -> String {
    let id = role_choice(cfg, role);
    let ok = allowed(role, &id) && match id.as_str() {
        "local" => local_base(cfg).is_some(),
        "agent" => true,
        other => KEY_PROVIDERS.iter().any(|(p, _)| *p == other) && secrets.has(other),
    };
    if ok { id } else { "agent".into() }
}

fn providers_obj(cfg: &mut Value) -> &mut serde_json::Map<String, Value> {
    if !cfg.is_object() { *cfg = json!({}); }
    if !cfg.get("providers").map(Value::is_object).unwrap_or(false) { cfg["providers"] = json!({}); }
    cfg["providers"].as_object_mut().expect("just made an object")
}

pub fn set_role(cfg: &mut Value, role: Role, id: &str, secrets: &dyn Secrets) -> Result<(), String> {
    match id {
        "agent" => {}
        "local" => { if local_base(cfg).is_none() { return Err("add the local server's address first".into()); } }
        k if KEY_PROVIDERS.iter().any(|(p, _)| *p == k) => {
            if !allowed(role, k) { return Err("TypeSafe answers decisions only".into()); }
            if !secrets.has(k) { return Err(format!("add your {} key first", name_of(k))); }
        }
        other => return Err(format!("there's no provider called {other}")),
    }
    providers_obj(cfg).insert(role.as_str().into(), json!(id));
    Ok(())
}

/// A key (or the local address) went away: every role that used it is the agent again.
pub fn forget_key(cfg: &mut Value, id: &str) -> bool {
    let mut changed = false;
    for role in [Role::Review, Role::Decisions] {
        if role_choice(cfg, role) == id {
            providers_obj(cfg).insert(role.as_str().into(), json!("agent"));
            changed = true;
        }
    }
    changed
}

pub fn set_local(cfg: &mut Value, base: Option<&str>) -> Result<(), String> {
    match base.map(str::trim).filter(|s| !s.is_empty()) {
        Some(b) if b.starts_with("http://") || b.starts_with("https://") => { providers_obj(cfg).insert("local_base_url".into(), json!(b)); Ok(()) }
        Some(_) => Err("the address starts with http:// — for example http://localhost:11434".into()),
        None => { providers_obj(cfg).remove("local_base_url"); forget_key(cfg, "local"); Ok(()) }
    }
}

pub fn calls_for(p: &Provider, cfg: &Value, t: Arc<dyn Transport>, agent: AgentCalls) -> Box<dyn Calls> {
    match p {
        Provider::Agent => Box::new(agent),
        Provider::Anthropic { key } => Box::new(AnthropicCalls { key: key.clone(), model: model_for(cfg, "anthropic"), t }),
        Provider::OpenAI { key } => Box::new(OpenAICalls { key: key.clone(), model: model_for(cfg, "openai"), t }),
        Provider::OpenRouter { key } => Box::new(ChatCompatCalls { url: OPENROUTER_URL.into(), key: Some(key.clone()), model: model_for(cfg, "openrouter"), label: "openrouter", t }),
        Provider::TypeSafe { key } => Box::new(TypeSafeCalls { key: key.clone(), model: model_for(cfg, "typesafe"), t }),
        Provider::Local { base_url } => Box::new(ChatCompatCalls { url: local_url(base_url), key: None, model: model_for(cfg, "local"), label: "local", t }),
    }
}

/// What the Providers rows show. Says whether a key is saved — never the key.
pub fn status(cfg: &Value, secrets: &dyn Secrets) -> Value {
    let mut rows: Vec<Value> = KEY_PROVIDERS.iter().map(|(id, name)| json!({ "id": id, "name": name, "saved": secrets.has(id) })).collect();
    rows.push(json!({ "id": "local", "name": "Local", "saved": local_base(cfg).is_some(), "address": local_base(cfg) }));
    json!({
        "roles": { "review": effective_choice(cfg, Role::Review, secrets), "decisions": effective_choice(cfg, Role::Decisions, secrets) },
        "providers": rows,
    })
}
```

- [ ] **Step 5: `main.rs` — the commands and the call builder**

Below `agents_status`:

```rust
#[tauri::command]
async fn providers_status() -> Value {
    providers::config::status(&load_config(), &providers::keys::Keychain)
}

#[tauri::command]
async fn provider_key_set(id: String, key: String) -> Result<(), String> {
    use providers::keys::Secrets;
    if !providers::config::KEY_PROVIDERS.iter().any(|(p, _)| *p == id) { return Err(format!("there's no provider called {id}")); }
    providers::keys::Keychain.set(&id, &key)
}

/// Removing a key falls every role that used it back to the agent (spec §9).
#[tauri::command]
async fn provider_key_remove(id: String) -> Result<(), String> {
    use providers::keys::Secrets;
    providers::keys::Keychain.remove(&id)?;
    let mut cfg = load_config();
    if providers::config::forget_key(&mut cfg, &id) { save_config(&cfg)?; }
    Ok(())
}

#[tauri::command]
async fn provider_role_set(role: String, provider: String) -> Result<(), String> {
    let role = providers::config::Role::parse(&role).ok_or_else(|| format!("there's no role called {role}"))?;
    let mut cfg = load_config();
    providers::config::set_role(&mut cfg, role, &provider, &providers::keys::Keychain)?;
    save_config(&cfg)
}

#[tauri::command]
async fn provider_local_set(base_url: Option<String>) -> Result<(), String> {
    let mut cfg = load_config();
    providers::config::set_local(&mut cfg, base_url.as_deref())?;
    save_config(&cfg)
}

/// The role's provider for a project, and its agent to fall back to on a
/// refused key. The Runs plan's judge and reviewer call this.
#[allow(dead_code)]
pub(crate) fn provider_calls(p: &Project, dir: &str, role: providers::config::Role) -> (Box<dyn providers::Calls>, Box<dyn providers::Calls>) {
    let cfg = load_config();
    let profile = setup::chosen_agent_for(project_key(dir).as_deref());
    let agent = || providers::agent::AgentCalls::for_project(profile, p.repo.clone(), p.dir.clone());
    let chosen = providers::config::resolve(&cfg, role, &providers::keys::Keychain);
    let t: Arc<dyn providers::http::Transport> = Arc::new(providers::http::CurlTransport);
    (providers::config::calls_for(&chosen, &cfg, t, agent()), Box::new(agent()))
}
```

Add `providers_status, provider_key_set, provider_key_remove, provider_role_set, provider_local_set,` to `generate_handler!` after `agents_status, set_project_agent,`.

- [ ] **Step 6: The TypeScript bindings**

In `src/lib/ipc.ts`, below `setProjectAgent`:

```ts
/** Rust providers::config::status — whether a key is saved, never the key. */
export interface ProviderRow { id: "anthropic" | "openai" | "openrouter" | "typesafe" | "local"; name: string; saved: boolean; address?: string | null }
export interface ProvidersStatus { roles: { review: string; decisions: string }; providers: ProviderRow[] }
export const providersStatus = () => invoke<ProvidersStatus>("providers_status");
export const providerKeySet = (id: string, key: string) => invoke<void>("provider_key_set", { id, key });
export const providerKeyRemove = (id: string) => invoke<void>("provider_key_remove", { id });
export const providerRoleSet = (role: "review" | "decisions", provider: string) => invoke<void>("provider_role_set", { role, provider });
export const providerLocalSet = (baseUrl: string | null) => invoke<void>("provider_local_set", { baseUrl });
```

- [ ] **Step 7: Run the checks**

Run: `export PATH="$HOME/.cargo/bin:$PATH" && (cd src-tauri && cargo test 2>&1 | tail -5) && npm run typecheck`
Expected: all Rust tests pass (10 new, 1 ignored); typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/providers/keys.rs src-tauri/src/providers/config.rs src-tauri/src/providers/mod.rs src-tauri/src/main.rs src/lib/ipc.ts
git commit -m "feat(providers): keys live in the Keychain, review and decisions each pick a provider, and a missing key means your agent

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 16: The Providers group in Setup & health (§9; board 1)

**Files:**
- Modify: `src/lib/setup-store.ts` (providers state, `providerRows`, `roleOptions`, `leavesSentence`, actions), `src/lib/setup-store.test.ts`
- Create: `src/screens/setup/ProvidersGroup.tsx`
- Modify: `src/screens/setup/SetupScreen.tsx` (render it under the Your agent group)

**Interfaces:**
- Consumes: `providersStatus`, `providerKeySet`, `providerKeyRemove`, `providerRoleSet`, `providerLocalSet`, `ProvidersStatus` (Task 15).
- Produces:
  - `interface ProviderRowView { id: string; name: string; blurb: string; word: string; tone: "ready" | "optional"; action: "add_key" | "remove_key" | "add_address" | "remove_address" | "" }`
  - `providerRows(status: ProvidersStatus | null): ProviderRowView[]`; `roleOptions(status, role): { value: string; label: string }[]`; `leavesSentence(role, provider): string` (all pure)
  - `providersState()`, `refreshProviders()`, `saveProviderKey(id, key)`, `removeProviderKey(id)`, `chooseRole(role, provider)`, `saveLocalAddress(url | null)`

- [ ] **Step 1: Write the failing tests**

Extend the imports at the top of `src/lib/setup-store.test.ts` with `leavesSentence, providerRows, roleOptions` (from `./setup-store`) and `ProvidersStatus` (type, from `./ipc`), then append:

```ts
const prov = (saved: Partial<Record<string, boolean>>, address: string | null = null, roles = { review: "agent", decisions: "agent" }): ProvidersStatus => ({
  roles,
  providers: [
    { id: "anthropic", name: "Anthropic", saved: !!saved.anthropic },
    { id: "openai", name: "OpenAI", saved: !!saved.openai },
    { id: "openrouter", name: "OpenRouter", saved: !!saved.openrouter },
    { id: "typesafe", name: "TypeSafe", saved: !!saved.typesafe },
    { id: "local", name: "Local", saved: !!address, address },
  ],
});

describe("the Providers group", () => {
  it("lists your agent first, then the five providers", () => {
    const rows = providerRows(prov({}));
    expect(rows.map((r) => r.id)).toEqual(["agent", "anthropic", "openai", "openrouter", "typesafe", "local"]);
    expect(rows[0]).toMatchObject({ word: "ready", action: "", blurb: "No key needed — it rides your sign-in." });
    expect(rows[1]).toMatchObject({ word: "optional", tone: "optional", action: "add_key" });
    expect(rows[5]).toMatchObject({ action: "add_address" });
  });

  it("a saved key reads as saved and offers its removal", () => {
    const rows = providerRows(prov({ typesafe: true }, "http://localhost:11434"));
    expect(rows.find((r) => r.id === "typesafe")).toMatchObject({ word: "key saved", tone: "ready", action: "remove_key" });
    expect(rows.find((r) => r.id === "local")).toMatchObject({ word: "address saved", action: "remove_address" });
  });

  it("offers a role only the providers that can answer it", () => {
    const s = prov({ anthropic: true, typesafe: true }, "http://localhost:11434");
    expect(roleOptions(s, "review").map((o) => o.value)).toEqual(["agent", "anthropic", "local"]);
    expect(roleOptions(s, "decisions").map((o) => o.value)).toEqual(["agent", "anthropic", "typesafe", "local"]);
    expect(roleOptions(s, "review")[0].label).toBe("with your agent");
  });

  it("says in one line what leaves the Mac, per role and provider", () => {
    expect(leavesSentence("decisions", "typesafe")).toBe("Only the agent’s small questions leave your Mac — a command’s text, a line from the plan, a failing check’s output. Never your files.");
    expect(leavesSentence("review", "agent")).toBe("Review with your agent sends nothing new: it rides the agent you already chose.");
    expect(leavesSentence("decisions", "local")).toBe("Nothing leaves your Mac: the server on this Mac answers.");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/setup-store.test.ts`
Expected: FAIL — `providerRows`, `roleOptions`, `leavesSentence` are not exported.

- [ ] **Step 3: The store**

In `src/lib/setup-store.ts`, extend the ipc import with `providersStatus, providerKeySet, providerKeyRemove, providerRoleSet, providerLocalSet, type ProvidersStatus,` and append:

```ts
/* ---------- the Providers group (spec §9, board 1) ----------
 * Two roles (review, decisions), each answered by your agent unless a
 * provider with a saved key or address is chosen. Keys go straight to the
 * Keychain through Rust; this store only ever learns "saved" or not. */

export type Role = "review" | "decisions";

export interface ProviderRowView {
  id: string;
  name: string;
  blurb: string;
  word: string;
  tone: "ready" | "optional";
  action: "add_key" | "remove_key" | "add_address" | "remove_address" | "";
}

const PROVIDER_BLURB: Record<string, string> = {
  anthropic: "Claude models, with your own key.",
  openai: "GPT models, with your own key.",
  openrouter: "Many models through one key.",
  typesafe: "A small, fast model for the agent’s small questions.",
  local: "A model running on this Mac, at an address like http://localhost:11434.",
};

export function providerRows(status: ProvidersStatus | null): ProviderRowView[] {
  if (!status) return [];
  const agent: ProviderRowView = { id: "agent", name: "Your agent", blurb: "No key needed — it rides your sign-in.", word: "ready", tone: "ready", action: "" };
  return [
    agent,
    ...status.providers.map((p): ProviderRowView => {
      const local = p.id === "local";
      return {
        id: p.id,
        name: p.name,
        blurb: PROVIDER_BLURB[p.id] ?? "",
        word: p.saved ? (local ? "address saved" : "key saved") : "optional",
        tone: p.saved ? "ready" : "optional",
        action: p.saved ? (local ? "remove_address" : "remove_key") : local ? "add_address" : "add_key",
      };
    }),
  ];
}

export function roleOptions(status: ProvidersStatus | null, role: Role): { value: string; label: string }[] {
  const saved = (status?.providers ?? []).filter((p) => p.saved && !(role === "review" && p.id === "typesafe"));
  return [{ value: "agent", label: "with your agent" }, ...saved.map((p) => ({ value: p.id, label: p.name }))];
}

export function leavesSentence(role: Role, provider: string): string {
  if (provider === "local") return "Nothing leaves your Mac: the server on this Mac answers.";
  if (provider === "agent")
    return role === "review"
      ? "Review with your agent sends nothing new: it rides the agent you already chose."
      : "Decisions with your agent send nothing new: they ride the agent you already chose.";
  return role === "review"
    ? "A provider receives only the text of what it is asked to review — a diff and a check’s output. Never your whole project."
    : "Only the agent’s small questions leave your Mac — a command’s text, a line from the plan, a failing check’s output. Never your files.";
}

let providers: ProvidersStatus | null = null;
export function providersState(): ProvidersStatus | null {
  return providers;
}

export async function refreshProviders(): Promise<void> {
  try {
    providers = await providersStatus();
  } catch {
    /* keep the last-known rows */
  }
  notify();
}

export async function saveProviderKey(id: string, key: string): Promise<void> {
  try { await providerKeySet(id, key); } finally { await refreshProviders(); }
}
export async function removeProviderKey(id: string): Promise<void> {
  try { await providerKeyRemove(id); } finally { await refreshProviders(); }
}
export async function chooseRole(role: Role, provider: string): Promise<void> {
  try { await providerRoleSet(role, provider); } finally { await refreshProviders(); }
}
export async function saveLocalAddress(url: string | null): Promise<void> {
  try { await providerLocalSet(url); } finally { await refreshProviders(); }
}
```

- [ ] **Step 4: Run the store tests**

Run: `npx vitest run src/lib/setup-store.test.ts`
Expected: PASS.

- [ ] **Step 5: The group component**

Create `src/screens/setup/ProvidersGroup.tsx`:

```tsx
/*
 * Setup's Providers group (board 1): the two roles with their provider
 * select and the one-line "what leaves your Mac", then one row per provider
 * with an inline key (or address) form. Logic lives in setup-store.
 */
import { useEffect, useState } from "react";
import {
  chooseRole,
  leavesSentence,
  providerRows,
  providersState,
  refreshProviders,
  removeProviderKey,
  roleOptions,
  saveLocalAddress,
  saveProviderKey,
  type ProviderRowView,
  type Role,
} from "@/lib/setup-store";
import { toastError } from "@/overlays/toasts";
import { cn } from "@/lib/utils";

const err = (what: string) => (e: unknown) => toastError(what, String(e).slice(0, 90));

function RoleRow({ role, title, blurb }: { role: Role; title: string; blurb: string }) {
  const s = providersState();
  const current = s?.roles[role] ?? "agent";
  return (
    <div className="flex items-center gap-[15px]">
      <div className="flex flex-1 flex-col gap-[3px]">
        <span className="text-[13px] font-medium text-text-primary">{title}</span>
        <span className="text-[12px] text-text-faint">{blurb}</span>
      </div>
      <select
        data-provider-role={role}
        value={current}
        onChange={(e) => void chooseRole(role, e.target.value).catch(err("Couldn't change that"))}
        className="h-[33px] min-w-[200px] rounded-lg border border-border-field bg-surface-input px-2.5 text-[12.5px] text-text-primary"
      >
        {roleOptions(s, role).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function KeyForm({ row, onDone }: { row: ProviderRowView; onDone: () => void }) {
  const [value, setValue] = useState("");
  const isLocal = row.id === "local";
  const save = () =>
    void (isLocal ? saveLocalAddress(value) : saveProviderKey(row.id, value))
      .then(onDone)
      .catch(err(isLocal ? "Couldn't save the address" : "Couldn't save the key"));
  return (
    <div className="mt-1 flex flex-col gap-2.5 rounded-lg border border-border-hairline bg-surface-card p-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-[11.5px] text-text-muted">{isLocal ? "The server's address" : `Your ${row.name} key`}</span>
        <input
          autoFocus
          type={isLocal ? "url" : "password"}
          value={value}
          placeholder={isLocal ? "http://localhost:11434" : "Paste it here"}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && value.trim()) save(); }}
          className="h-[33px] rounded-lg border border-border-field bg-surface-input px-2.5 font-mono text-[12px] text-text-primary placeholder:text-text-faint"
        />
      </label>
      <div className="flex items-center gap-2">
        <span className="flex-1 text-[11.5px] leading-[1.45] text-text-faint">{isLocal ? "Saved in Chronicle's settings on this Mac." : "Saved in your Keychain, never in the project."}</span>
        <button onClick={onDone} className="h-[28px] rounded-md px-2.5 text-[12px] text-text-muted hover:bg-fill-hover">Cancel</button>
        <button disabled={!value.trim()} onClick={save} className="h-[28px] rounded-md bg-primary px-3 text-[12px] font-semibold text-primary-foreground disabled:opacity-50">
          {isLocal ? "Save address" : "Save key"}
        </button>
      </div>
    </div>
  );
}

export function ProvidersGroup() {
  useEffect(() => { void refreshProviders(); }, []);
  const [open, setOpen] = useState<string | null>(null);
  const s = providersState();
  const rows = providerRows(s);
  if (!s) return null;
  return (
    <div className="flex flex-col gap-0.5" data-setup-group="providers">
      <div className="flex items-baseline gap-2.5 pb-1.5">
        <span className="text-[10px] uppercase tracking-[0.09em] text-text-subtle">Providers</span>
        <span className="text-[11.5px] text-text-muted">who answers when it isn’t your agent</span>
      </div>
      <div className="flex flex-col gap-2.5 pb-3.5 pt-1.5">
        <RoleRow role="review" title="Review" blurb="Who looks over a round’s result." />
        <RoleRow role="decisions" title="Decisions" blurb="Who answers the agent’s small questions during a run." />
        <div className="mt-0.5 flex flex-col gap-1 rounded-md bg-fill-subtle px-2.5 py-2 text-[11.5px] leading-[1.5] text-text-muted">
          <span>{leavesSentence("review", s.roles.review)}</span>
          <span>{leavesSentence("decisions", s.roles.decisions)}</span>
        </div>
      </div>
      <div className="flex flex-col">
        {rows.map((r, i) => (
          <div key={r.id} data-provider-row={r.id} className={cn("flex items-start gap-[15px] py-[15px]", i > 0 && "border-t border-divider")}>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="text-[13px] font-medium text-text-primary">{r.name}</span>
              <span className="text-[12px] leading-snug text-text-faint">{r.blurb}</span>
              {open === r.id && <KeyForm row={r} onDone={() => setOpen(null)} />}
            </div>
            <span className={cn("shrink-0 whitespace-nowrap text-[12.5px]", r.tone === "ready" ? "text-state-success" : "text-text-muted")}>{r.word}</span>
            {(r.action === "add_key" || r.action === "add_address") && open !== r.id && (
              <button onClick={() => setOpen(r.id)} className="h-[33px] shrink-0 whitespace-nowrap rounded-lg border border-border-strong px-[14px] text-[12.5px] font-medium text-text-primary hover:bg-fill-hover">
                {r.action === "add_key" ? "Add key" : "Add address"}
              </button>
            )}
            {(r.action === "remove_key" || r.action === "remove_address") && (
              <button
                onClick={() => void (r.action === "remove_key" ? removeProviderKey(r.id) : saveLocalAddress(null)).catch(err("Couldn't remove it"))}
                className="h-[33px] shrink-0 whitespace-nowrap rounded-lg border border-border-hairline px-[14px] text-[12.5px] font-medium text-text-muted hover:bg-fill-hover hover:text-text-primary"
              >
                {r.action === "remove_key" ? "Remove key" : "Remove address"}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Put it on the screen**

In `src/screens/setup/SetupScreen.tsx`, `import { ProvidersGroup } from "./ProvidersGroup";` and add `<ProvidersGroup />` on the line after `<AgentGroup dir={dir} />`.

- [ ] **Step 7: Run the checks and look at it**

Run: `npx vitest run && npm run typecheck && npm run build 2>&1 | tail -3`
Expected: all pass. Then `npm run tauri dev`, Setup & health: the Providers group shows Review and Decisions both "with your agent"; "Add key" on OpenRouter opens the form; saving a key flips the row to "key saved" and adds OpenRouter to both selects; `security find-generic-password -s chronicle.provider.openrouter -a "$USER"` in a terminal finds the item; "Remove key" removes it and both roles read "with your agent" again.

- [ ] **Step 8: Commit**

```bash
git add src/lib/setup-store.ts src/lib/setup-store.test.ts src/screens/setup/ProvidersGroup.tsx src/screens/setup/SetupScreen.tsx
git commit -m "feat(setup): the Providers group — review and decisions on your agent by default, a key field per provider, and what leaves your Mac said plainly

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 17: Claude Code's pin moves to the registry's version — only if its probe passed (§12.6)

**Gate:** read the `Claude Code 0.90.1-preview.15` line of the spec's §11 probe result (Task 1). If it says `FAIL`, do Step 1 only (record the skip) and stop: Claude Code ships on `0.75.1` through `pinned_npx`. If it says `PASS`, do every step. This task comes after Tasks 2-16 because the pin lives in the profile table and launches through the registry path those tasks built; moving `ADAPTER_VERSION` in Task 1 would have been thrown away by Task 3.

**Files:**
- Modify: `src-tauri/src/agents/profiles.rs` (the `claude-acp` profile), `src-tauri/src/agents/registry.rs` (the pinned-npx test)
- Regenerate: `src/lib/__fixtures__/acp-claude-acp.raw.jsonl` (from Task 1's `probe-claude-acp` folder), `src/lib/__fixtures__/acp-claude-acp.jsonl`
- Modify: `c-runs/PROGRESS.md`

**Interfaces:**
- Consumes: the probe verdict and the `probe-claude-acp/` output (Task 1); `fixture.mjs` (Task 1); the normalisation fixture test (Task 6).
- Produces: `claude().registry_version == "0.90.1-preview.15"`, `claude().pinned_npx == None`; Claude launches from the registry entry with its `--hide-claude-auth` arg.

- [ ] **Step 1: Record the gate**

```bash
cd /Users/tuneerguha/Downloads/chronicle
grep -n "0.90.1-preview.15" docs/superpowers/specs/2026-10-15-agents-and-providers-design.md
```

If the line reads FAIL, append `- 2026-10-DD · Claude Code pin stays at 0.75.1: the registry's 0.90.1-preview.15 failed its probe (spec §11).` to `c-runs/PROGRESS.md`, commit that one path (`docs(agents): Claude Code's pin stays — the newer adapter failed its probe`, with the trailer) and stop here.

- [ ] **Step 2: Write the failing test**

In `registry.rs`, replace `claude_launches_its_pinned_npx_until_the_pin_moves` with:

```rust
    #[test]
    fn claude_launches_from_its_registry_entry() {
        let spec = launch_spec_in(bundled(), claude(), "darwin-aarch64").unwrap();
        assert_eq!(spec, LaunchSpec::Npx { package: "@agentclientprotocol/claude-agent-acp@0.90.1-preview.15".into(), args: vec!["--hide-claude-auth".into()] });
        assert!(claude().pinned_npx.is_none(), "the pin is the registry's now");
    }
```

Run: `export PATH="$HOME/.cargo/bin:$PATH" && cd src-tauri && cargo test claude_launches 2>&1 | tail -5`
Expected: FAIL — the spec is still the `0.75.1` pinned package.

- [ ] **Step 3: Move the pin**

In `profiles.rs`, the `claude-acp` profile becomes:

```rust
        registry_version: "0.90.1-preview.15",
        pinned_npx: None,
```

If the probe's table row for 0.90.1 showed different mode ids or `_meta` paths from 0.75.1, update `modes` and `meta` to match it in the same edit.

- [ ] **Step 4: Re-record Claude's fixture from the 0.90.1 probe**

```bash
cd /Users/tuneerguha/Downloads/chronicle/.superpowers/sdd/2026-10-15-agents-and-providers
node fixture.mjs probe-claude-acp claude-acp
cd /Users/tuneerguha/Downloads/chronicle/src-tauri
export PATH="$HOME/.cargo/bin:$PATH"
CHRONICLE_WRITE_FIXTURES=1 cargo test normalize_tests 2>&1 | tail -3
cargo test 2>&1 | tail -5
cd .. && npx vitest run
```

Expected: every Rust test passes (`profiles_agree_with_the_probe_fixtures` now reads the 0.90.1 fixture; `every_profile_is_pinned_to_something_it_can_launch` finds the registry entry); every vitest file passes (the agents replay test reads the re-recorded fixture).

- [ ] **Step 5: Check the install path once, by hand**

```bash
rm -rf ~/.chronicle/tools/agents/claude-acp
```

Open Setup & health in `npm run tauri dev`, install Claude Code's connector, then open a project and send one message. Expected: the connector row reads `0.90.1-preview.15`, the pane reaches `ready` and answers. If the managed install cannot find the package's entry (`npx_entry_in` returns None because the package's `bin` moved), the row stays "missing" — fix the entry resolution, not the pin.

- [ ] **Step 6: Commit**

```bash
cd /Users/tuneerguha/Downloads/chronicle
printf -- '- 2026-10-DD · Claude Code pin moved to the registry'"'"'s 0.90.1-preview.15 after its probe passed; fixture re-recorded.\n' >> c-runs/PROGRESS.md
git add src-tauri/src/agents/profiles.rs src-tauri/src/agents/registry.rs src/lib/__fixtures__/acp-claude-acp.raw.jsonl src/lib/__fixtures__/acp-claude-acp.jsonl c-runs/PROGRESS.md
git commit -m "feat(agents): Claude Code launches from its registry entry at 0.90.1-preview.15, the version its probe passed on

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 18: The release-time registry refresh (§3)

The registry publishes only each agent's latest entry, so a blind refresh would delete the pinned versions Chronicle ships. The script keeps the bundled entry of every pinned agent whose pin is still the bundled version, replaces everything else, reports newer versions it did not take, and takes one only when told to.

**Files:**
- Create: `scripts/acp-registry.mjs`

**Interfaces:**
- Consumes: `src-tauri/src/agents/profiles.rs` (the pins, read by a regex over `id: "…", name: "…", registry_version: "…"`), `src-tauri/resources/acp-registry.json`, the registry's latest release asset.
- Produces: a rewritten `src-tauri/resources/acp-registry.json`; on stdout one line per pinned agent (`kept`, `newer available`, `taken`).

- [ ] **Step 1: Write the script**

```js
#!/usr/bin/env node
// Refresh the bundled ACP registry at release time (spec §3).
//   node scripts/acp-registry.mjs [--dry-run] [--take <id>]...
// Pinned agents keep their bundled entry (Chronicle ships what it probed);
// every other entry is replaced by the latest release's. --take <id> takes
// the latest entry for a pinned agent — then move its pin in profiles.rs,
// probe it (plan Task 1's probe.mjs), and update its fixture.
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const file = path.join(root, 'src-tauri/resources/acp-registry.json')
const profiles = fs.readFileSync(path.join(root, 'src-tauri/src/agents/profiles.rs'), 'utf8')
const URL = 'https://github.com/agentclientprotocol/registry/releases/latest/download/registry.json'
const args = process.argv.slice(2)
const dry = args.includes('--dry-run')
const take = new Set(args.flatMap((a, i) => (a === '--take' ? [args[i + 1]] : [])))

const pins = new Map([...profiles.matchAll(/id:\s*"([^"]+)",\s*name:\s*"[^"]*",\s*registry_version:\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]))
if (pins.size === 0) throw new Error('found no pins in profiles.rs — has its shape changed?')

const res = await fetch(URL)
if (!res.ok) throw new Error(`registry download failed: ${res.status}`)
const latest = await res.json()
const bundled = JSON.parse(fs.readFileSync(file, 'utf8'))
const byId = new Map(bundled.agents.map((a) => [a.id, a]))

const out = latest.agents.map((fresh) => {
  const pin = pins.get(fresh.id)
  const old = byId.get(fresh.id)
  if (!pin) return fresh
  if (take.has(fresh.id)) { console.log(`${fresh.id}: taken ${fresh.version} (move its pin from ${pin}, then probe it)`); return fresh }
  if (old && old.version === pin) {
    console.log(fresh.version === pin ? `${fresh.id}: kept ${pin}` : `${fresh.id}: kept ${pin} — newer available: ${fresh.version}`)
    return old
  }
  console.log(`${fresh.id}: pinned ${pin}, bundled ${old?.version ?? 'none'}, latest ${fresh.version} — left as bundled`)
  return old ?? fresh
})
for (const [id, pin] of pins) {
  if (!out.some((a) => a.id === id) && byId.has(id)) { console.log(`${id}: gone from the registry — kept ${pin}`); out.push(byId.get(id)) }
}
const next = { ...latest, agents: out }
if (dry) console.log(`dry run: ${out.length} agents, nothing written`)
else { fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n'); console.log(`wrote ${path.relative(root, file)}: ${out.length} agents`) }
```

- [ ] **Step 2: Run it dry, then prove a refresh can't drop a pin**

```bash
cd /Users/tuneerguha/Downloads/chronicle
node scripts/acp-registry.mjs --dry-run
node scripts/acp-registry.mjs
export PATH="$HOME/.cargo/bin:$PATH" && (cd src-tauri && cargo test agents:: 2>&1 | tail -5)
git diff --stat src-tauri/resources/acp-registry.json
```

Expected: one line per pinned agent (`kept …`, possibly `newer available`); the Rust agents tests still pass (every pin still resolves). If `git diff` shows changes, they are entries of agents Chronicle does not offer, plus the top-level `version`. Keep the refreshed file only if the Rust tests pass; it is release-time data and may be committed with this task.

- [ ] **Step 3: Commit**

```bash
git add scripts/acp-registry.mjs src-tauri/resources/acp-registry.json
git commit -m "chore(agents): a release-time registry refresh that keeps every pinned agent's probed entry

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

(If Step 2 left `acp-registry.json` unchanged, `git add` of it is a no-op; leave it in the command.)

---

### Task 19: The live check — one real turn per agent, the providers answered, and PROGRESS

**Files:**
- Modify: `c-runs/PROGRESS.md` (the closing matrix)
- Modify: `docs/superpowers/specs/2026-10-15-agents-and-providers-design.md` (status line: implemented, with the matrix's date)
- Modify (only if a live answer disagrees with a fixture): `src-tauri/src/providers/http.rs` `parse_jev` and `src-tauri/src/providers/fixtures/typesafe-systemone.json`

**Interfaces:**
- Consumes: every task.
- Produces: the matrix; the commit whose subject the roadmap's RN-4 proof matches (`chronicle.json`: `done_when.commit_subject` = `(?i)^docs\(agents\): agents live check`).

- [ ] **Step 1: Build the release binary**

```bash
cd /Users/tuneerguha/Downloads/chronicle
export PATH="$HOME/.cargo/bin:$PATH"
npm run build && (cd src-tauri && cargo build --release --features tauri/custom-protocol)
```

Launch `src-tauri/target/release/chronicle` from a terminal.

- [ ] **Step 2: One real turn per agent**

For each shipped agent: in Setup & health choose it under Your agent, install its connector, sign in if the row asks; open `~/chronicle-probe` (Task 1's toy repo); in the composer, send exactly:

```
Read README.md and tell me its first line. Then create notes.txt containing the word live.
```

Allow the edit when asked. Record, per agent: did the pane reach `ready`; the header's mark and name; the stances the composer offered; did the thread show the tool rows (flat for every agent but Claude Code); did the permission card appear and the edit land; did "End session" and a new session work; the sign-in path if it was needed (terminal / browser / its own setup). Then switch the project's agent from the composer's picker while a session is live and confirm it asks first and restarts on the new agent (Review Focus 4).

- [ ] **Step 3: The providers, live**

Save a key for each provider you have (Anthropic, OpenAI, OpenRouter, TypeSafe) in the Providers group, and a Local address if a local server runs. Then:

```bash
cd /Users/tuneerguha/Downloads/chronicle/src-tauri
CHRONICLE_PROVIDER_LIVE=1 cargo test live_providers -- --ignored --nocapture 2>&1 | grep -E "^(anthropic|openai|openrouter|typesafe):"
```

Expected: one line per saved key with its model and two answers. A `typesafe: FAILED` that mentions "no answers" means Jev's real response shape differs from the assumed one: correct `parse_jev` and `fixtures/typesafe-systemone.json` to the real body (scrubbed), rerun `cargo test http_tests`, and include both files in this task's commit. Then remove one key in the Keychain by hand (`security delete-generic-password -s chronicle.provider.anthropic -a "$USER"`) with the Decisions role on Anthropic, reopen Setup: the role reads "with your agent" (Review Focus 5's offline twin is Task 14's test).

- [ ] **Step 4: Write the matrix**

Append to `c-runs/PROGRESS.md`:

```markdown
### Any agent, any provider · live check (2026-10-DD)

| | Claude Code | Codex | Gemini CLI | OpenCode |
|---|---|---|---|---|
| version | … | … | … | … |
| installed from Setup | yes/no | yes/no | yes/no | yes/no |
| sign-in path | … | … | … | … |
| ready, one turn answered | yes/no | yes/no | yes/no | yes/no |
| header mark and name | … | … | … | … |
| stances offered | … | … | … | … |
| tool rows (tree / flat) | … | … | … | … |
| permission card, edit landed | yes/no | yes/no | yes/no | yes/no |
| switch from the picker asked first | yes/no | — | — | — |

| Provider | role tried | answered | model | note |
|---|---|---|---|---|
| Your agent | review + decisions | yes/no | agent/… | |
| Anthropic | decisions | yes/no/no key | … | |
| OpenAI | decisions | yes/no/no key | … | |
| OpenRouter | decisions | yes/no/no key | … | |
| TypeSafe | decisions | yes/no/no key | … | response shape confirmed / corrected |
| Local | decisions | yes/no/none running | … | |
```

Every cell is something you saw. A row that failed is written as `no` with what happened in the note column; it is not reworded.

- [ ] **Step 5: The spec's status line**

In the spec's header, replace `Status: **draft, written for the user's review**` with `Status: **implemented** — live check 2026-10-DD in c-runs/PROGRESS.md`.

- [ ] **Step 6: Commit**

```bash
git add c-runs/PROGRESS.md docs/superpowers/specs/2026-10-15-agents-and-providers-design.md
git commit -m "docs(agents): agents live check — one real turn per agent in the pane, and every provider with a key answered a decision

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

(Add `src-tauri/src/providers/http.rs src-tauri/src/providers/fixtures/typesafe-systemone.json` to the `git add` if Step 3 corrected them.)

---

## Self-review (done while writing)

- **Spec coverage.** §1 goals: Tasks 2-11 (any agent), 12-16 (any provider). §2 the six Claude assumptions: (1) pin constants removed, Task 3; (2) `claudeCode` reads moved to Rust, Tasks 6-7; (3) mode ids → stances, Task 8; (4) `claude /login` → per-profile login, Task 9; (5) plugins/settings gated by `Extras`, Task 5; (6) rate-limit key read through the profile, Tasks 6-7. Codex in the roadmap writer keeps working with the new ids, Task 4. §3 profiles and choosing, Tasks 2, 4, 5, 10, 11. §4 install per distribution, Task 3. §5 sign-in, Task 9. §6 stances, Task 8. §7 normalisation, Tasks 6-7. §8 extras, Task 5. §9 provider layer, keys, Setup row, Tasks 12-16. §10 decision types, Task 13. §11 probe, Task 1. §12.6 pin move, Task 17. §13 tests: profile completeness (Task 2), launch per distribution with sha256 (Task 3), normalisation from recorded wire (Task 6), providers against recorded HTTP (Task 14), Decision parsing native and emulated (Tasks 13-14), Keychain behind a fake (Task 15), stance↔mode (Task 8), agent picker store (Task 11), `_chronicle` replay per agent (Task 7), live checks (Task 19). §14 boards, Task 0. The registry refresh script (§3), Task 18.
- **Placeholders.** None in code steps. Cells marked `…` in the probe table (Task 1), the PROGRESS lines and the live matrix (Task 19) are observed values the executor writes, by instruction; `2026-10-DD` is the date of the run.
- **Types.** `AgentProfile`/`Login`/`Modes`/`MetaKeys`/`Stance` are defined in Task 2 and used under those names in Tasks 3-17; `AdapterLaunch { Direct { node, entry, args }, Npx { npx, package, args }, Binary { program, args } }` from Task 3 is what `agent_launch`, `adapter_command_for` and `agent_row` match on; `start(state, emit, key, lane, profile, …)` from Task 5 is the signature Tasks 9, 12, 13 call; `normalize`/`tool_name`/`ready_extras` from Task 6 are used in Tasks 6 and 8; `CallError`/`Calls`/`Decision` from Task 13 are what Tasks 14-15 implement; the TS `AgentStatusRow`/`AgentsStatus` (Task 4) feed `agentRows` (Task 10) and the picker (Task 11); `parseStances`/`availableStances`/`currentStance` (Task 8) and `parseLogin`/`loginBanner` (Task 9) are used by the store and the composer/pane under those names; `agentMeta` (Task 9) and `AgentMark` (Task 10) are used by Tasks 10-11.
- **Review Focus.** All five pinned: Task 3 (checksum mismatch), Tasks 2 and 10 (no platform entry), Task 8 (no modes), Tasks 5 and 11 (agent switch while live), Task 14 (refused key).
- **Deviations from the spec, said where they happen:** `Auto` kept as a fourth stance (Task 8); `Calls` returns `CallError` instead of `String` (Task 13); `MetaKeys` gains `subagent` and `subagent_tools` (Task 2) because the store's subagent detection used both; the rate-limit pointer is `/_meta/_claude~1rateLimit` (RFC 6901 escaping of the key's `/`) rather than the spec's `/_meta/_claude/rateLimit`; Claude Code's pre-move launch rides `pinned_npx` because the bundled registry only holds `0.90.1-preview.15` (Task 2); OpenRouter emulates decisions rather than calling its decisions endpoint (spec §9 lists only TypeSafe as native).
