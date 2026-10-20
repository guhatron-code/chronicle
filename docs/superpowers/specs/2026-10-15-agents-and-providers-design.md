# Any agent, any provider · design

Date: 2026-10-15. Status: **draft, written for the user's review** at the user's request that the whole
program ships in the next update. Brainstorm questions were answered by the user on 2026-10-15 ("any agent
in the pane" and "any provider for Chronicle's own calls"); the choices this spec made on its own are in
§12 for the user to confirm or overturn. Plans: `docs/superpowers/plans/2026-10-15-agents-and-providers.md`
(this spec) and `docs/superpowers/plans/2026-10-15-runs.md` (the Runs spec, which builds on this one).

## 1 · What this is for

Chronicle talks to its coding agent through the Agent Client Protocol, but six places still assume the
agent is Claude Code. The user wants two things:

- **Any agent in the pane.** A user picks their agent in Setup, and the chat pane and Runs' lanes work with
  it. First set: Claude Code (today), Codex, Gemini CLI, OpenCode. All four are in the ACP Registry.
- **Any provider for Chronicle's own calls.** The calls Chronicle makes on its own behalf, the Runs judge
  and the review verdict, go through a provider layer the user configures in Setup, with keys in the
  Keychain, and work without any key by riding the user's agent.

Out of scope: a model picker inside Claude Code beyond what the session's config option already gives;
bring-your-own-key for the agent itself (the agent's own login stays the agent's business); the parked
Design pane.

## 2 · Ground truth (verified 2026-10-15)

- **The seam.** `src-tauri/src/acp.rs` spawns one adapter per session (`AdapterLaunch::{Direct, Npx}`,
  `adapter_command_for`), speaks ACP over stdio, and emits `acp-update` events the store reduces
  (`src/lib/agent-session.ts`). The managed install lives at `~/.chronicle/tools/adapter` (Task 7 of the
  pane plan); `setup::adapter_launch()` picks direct or npx.
- **The six Claude assumptions.** (1) `ADAPTER_PACKAGE`/`ADAPTER_VERSION` pin `@agentclientprotocol/claude-agent-acp@0.75.1`.
  (2) The store reads `_meta.claudeCode.parentToolUseId` and `_meta.claudeCode.toolName` to build the
  subagent tree and name tools (`agent-session.ts` ~452, `acp.rs` ~728/809/830). (3) Mode ids `acceptEdits`
  and `bypassPermissions` are the composer's "Execute" and "Unattended" (`Composer.tsx` ~431-463,
  `agent-session.ts` ~960). (4) `needs-login` is answered by typing `claude /login` into a terminal tab
  (`AgentPane.tsx` ~507-526; `acp.rs` ~1324-1333 maps the adapter's auth failure to that phase).
  (5) Lane extras ride `_meta.claudeCode.options` (plugins, settings); MCP servers also go in `session/new`
  `mcpServers`, which is standard ACP. (6) The limits chip reads `_meta["_claude/rateLimit"]`.
- **Codex today** runs only the roadmap writer, as `codex exec --json` (`main.rs` ~1566-1600), chosen by
  `config.json` `agent` (`agents_available`, `set_default_agent`). It never enters the pane.
- **The ACP Registry** publishes `registry.json` per release (`agentclientprotocol/registry`, latest
  v2026.10.15, 42 agents). Shape: `{ version, agents: [{ id, name, version, description, repository,
  license, distribution: { npx: { package, args? } | binary: { "<os>-<arch>": { archive, cmd, args?,
  sha256 } } | uvx: {...} }, icon }] }`. Entries this spec uses: `claude-acp` (npx
  `@agentclientprotocol/claude-agent-acp@0.90.1-preview.15`, args `--hide-claude-auth`), `codex-acp` (npx
  `@agentclientprotocol/codex-acp@2.2.3-preview.10`), `gemini` (npx `@google/gemini-cli@0.64.0`, args
  `--acp`), `opencode` (binary per platform, `./opencode acp`, sha256). A copy is bundled at
  `src-tauri/resources/acp-registry.json`.
- **Setup & health** (`setup.rs`, `setup-store.ts`, `CheckRow.tsx`): one row per check id, `detect` /
  `install` arms, `REQUIRED = 6`, the connector row added by the pane plan. Downloads already verify a
  sha256 before unpacking (the design browser installer, `download` + `sha256_file` + `extract_*`).
- **Chronicle's own model calls today**: none outside an agent. The roadmap writer is an agent subprocess;
  the Runs judge (spec §6) and review verdict (spec §3) are designed but not built.
- **Keychain**: nothing uses it yet; the `security` CLI is available on every Mac.

## 3 · Agent profiles

An **agent profile** is data, in Rust, one per supported agent:

```rust
pub struct AgentProfile {
    pub id: &'static str,              // the registry id: "claude-acp" | "codex-acp" | "gemini" | "opencode"
    pub name: &'static str,            // "Claude Code" | "Codex" | "Gemini CLI" | "OpenCode"
    pub registry_version: &'static str,// the registry entry version Chronicle tested against
    pub login: Login,                  // how a signed-out user signs in (§5)
    pub modes: Modes,                  // the agent's mode ids for Chronicle's three stances (§6)
    pub meta: MetaKeys,                // where this agent puts subagent/tool/rate-limit facts (§7)
    pub extras: Extras,                // what a session may be given beyond the prompt (§8)
}
```

Launch instructions are **not** in the profile: they come from the bundled registry entry for `id`
pinned at `registry_version` (`npx` package + args, or the platform's `binary` archive + cmd + args +
sha256). A newer registry entry than the pinned version is ignored until a Chronicle release moves the
pin: Chronicle ships what it tested. The bundled registry file is refreshed by a script at release time
(`scripts/acp-registry.mjs` downloads the latest release asset and rewrites the file; the pins are
reviewed by hand).

`ADAPTER_PACKAGE`/`ADAPTER_VERSION` go away; the Claude profile's pin is `0.90.1-preview.15` from the
registry **only after** the probe (§11) passes on it — the plan starts the Claude profile at the known-good
`0.75.1` and moves it as a separate, tested step.

**Where profiles are used.** `setup::agent_launch(id) -> Option<AdapterLaunch>` (direct from the managed
install, npx/binary fallback as today), `acp::start(…, profile, …)`, the store's `AgentSessionState.agent`
(the id), and the TypeScript side's `AGENT_META` for names and marks.

**Choosing the agent.** `config.json` `agent` becomes the agent id (migration: `"claude"` → `"claude-acp"`,
`"codex"` → `"codex-acp"`). A Setup row **Your agent** lists the four with their state (not installed /
installed, signed out / ready) and sets the default. A project can override it from the composer's agent
picker (the current "runs with" chips move there); the pane header shows the agent's mark and name
instead of "Chronigirl" when the agent is not Claude. Switching an agent while a session is live ends the
session after a confirm, then starts the new one.

## 4 · Installing an agent

The connector row from the pane plan generalises: **"The agent's connector"** becomes one row per chosen
agent, **"<Agent>'s connector"**, installed into `~/.chronicle/tools/agents/<id>/`:

- `npx` distributions: `npm install --prefix <dir> --no-audit --no-fund --no-package-lock <package>` and
  the entry script resolved from the package's `bin`, launched by `node` directly (as Task 7 does).
- `binary` distributions: download the platform archive, verify its `sha256`, unpack into `<dir>`, launch
  `cmd` with `args`. Same installer machinery as the design browser.
- Without a managed install, `npx` distributions fall back to `npx --yes -- <package> <args>` as today;
  `binary` distributions have no fallback and the row says "Install".

The agent's own CLI (`claude`, `codex`, `gemini`) is still required where the adapter needs it (claude-acp
wraps the Claude Code CLI; codex-acp bundles the Codex core; gemini is the CLI itself). The profile says
which, and the **Your agent** row's detail line names what is missing.

## 5 · Signing in

ACP's `initialize` reply lists `authMethods`; an `authenticate` request runs one. Profiles carry:

```rust
pub enum Login {
    Terminal { command: &'static str },   // claude-acp: "claude /login"; codex-acp: "codex login"
    AuthMethod { id: &'static str },      // when the adapter's authenticate works headless (gemini's
                                          // OAuth opens a browser from the adapter's side)
    None,                                 // opencode: keys/config handled by the agent
}
```

The pane's `needs-login` banner and the Setup sign-in rows use the profile: a `Terminal` login types that
command into a terminal tab (today's flow, generalised); an `AuthMethod` login calls `authenticate` and
waits; `None` shows the agent's own instructions. Each agent's actual `authMethods` and the right
`Login` value are recorded by the probe (§11) before the profile is pinned.

## 6 · Modes: three stances, mapped

Chronicle has three stances a user can pick in the composer: **Ask first**, **Execute** (edits happen,
commands ask), **Unattended**. Each profile maps them to the agent's mode ids:

| Stance | claude-acp | codex-acp | gemini | opencode |
|---|---|---|---|---|
| Ask first | `default` | *(probe)* | *(probe)* | *(probe)* |
| Execute | `acceptEdits` | *(probe)* | *(probe)* | *(probe)* |
| Unattended | `bypassPermissions` | *(probe)* | *(probe)* | *(probe)* |

A stance an agent has no mode for is hidden in the composer for that agent; Ask first always exists
(every ACP agent asks through `session/request_permission`). The store keeps the stance, not the id;
`agent_set_mode` translates. Runs' lanes run in Ask first with Chronicle answering by policy, which is
agent-independent.

## 7 · Reading the wire without a namespace

The store's subagent tree, tool names and rate limits come from `MetaKeys`:

```rust
pub struct MetaKeys { pub parent_tool_use: Option<&'static str>, pub tool_name: Option<&'static str>, pub rate_limit: Option<&'static str> }
// claude-acp: Some("/_meta/claudeCode/parentToolUseId"), Some("/_meta/claudeCode/toolName"), Some("/_meta/_claude/rateLimit")
// others: None until the probe shows a namespace; the standard ACP fields (`toolCall.title`, `kind`,
// `status`, `locations`) carry the rest.
```

Rust normalises on the way out: every `tool_call` update Chronicle emits to the pane carries
`_chronicle: { parentId?, toolName?, agent }`, filled from the profile's pointers, so the TypeScript store
reads one shape for every agent and the `claudeCode` reads disappear from `agent-session.ts`. Without a
parent pointer the pane shows a flat tool list (no subagent cards); without a rate-limit key the limits
chip stays hidden. The fence and guard in `acp.rs` already read standard fields (`rawInput.file_path`,
`kind`, `title`) and keep working; the one `claudeCode.toolName` read there becomes the normalised name.

## 8 · What a session may be given

`Extras { mcp_servers: bool, plugins: bool, settings: bool }`. MCP servers are standard (`session/new`
`mcpServers`): every profile has `true`. Plugins and settings are Claude-only (`_meta.claudeCode.options`).
Runs therefore puts lane instructions in the prompt and its tools in MCP, never in a plugin; the Design
pane's plugin stays Claude-only behind its flag.

## 9 · The provider layer

Chronicle's own calls go through `src-tauri/src/providers/`:

```rust
pub enum Provider {
    Agent,                       // a one-turn session on the project's agent — the default, no key
    Anthropic { key },           // Messages API, model per call
    OpenAI { key },              // Responses API
    OpenRouter { key },          // OpenAI-compatible; also hosts typesafe/jev-1.13 for decisions
    TypeSafe { key },            // Jev, native decisions
    Local { base_url },          // an OpenAI-compatible local server (Ollama, LM Studio)
}
pub trait Calls {
    fn complete_json(&self, req: CompleteRequest) -> Result<serde_json::Value, String>; // schema-checked
    fn decide(&self, req: DecisionRequest) -> Result<Decision, String>;                  // §10
}
```

Two roles, chosen separately in Setup, both defaulting to `Agent`:

- **Review**: the Runs reviewer reads a diff and check output and returns a schema-checked verdict.
- **Decisions**: the Runs judge's four bounded decisions.

`Agent` runs a one-turn ACP session (a reviewer session, `Lane::Reviewer`, Ask-first with reads only) and
parses the JSON the agent returns; it needs no key and rides the user's login. `TypeSafe` answers
`decide` natively (Choice / Score / Noul with probabilities and confidence). Every other provider
emulates `decide` through `complete_json` with a schema `{ choice, probabilities, confidence }`, and the
run record marks such confidences `self_reported: true` so the REFLEX bands (Runs spec §6) treat them as
one band stricter.

**Keys** are stored with `security add-generic-password -s chronicle.provider.<id> -a <user>` and read
with `find-generic-password -w`; never in a repo file. The Setup row **Providers** lists the five, each
with a paste field, "Saved in your Keychain", and a one-line statement of what leaves the Mac for each
role (as the Decisions row on board R6 says it). Removing a key falls the role back to `Agent`.

## 10 · Decisions, as a type

```rust
pub struct DecisionRequest { pub state: String, pub instructions: String, pub criteria: Vec<Criterion> }
pub enum Criterion { Choice { name, options: Vec<String> }, Score { name, min: i32, max: i32 }, Noul { name } }
pub struct Decision { pub answers: HashMap<String, Answer>, pub model: String, pub self_reported: bool }
pub enum Answer { Choice { choice: String, probabilities: HashMap<String, f32>, confidence: f32 }, Score { value: i32, confidence: f32 }, Noul { yes: f32 } }
```

This is the Runs spec §6 contract; the judge module there calls `Provider::decide` and nothing else.

## 11 · The probe (first task of the plan)

Before any profile is pinned, one throwaway probe per agent, run like the engine spike: launch the
registry distribution, `initialize`, `session/new` on a toy repo, one prompt that reads and writes a file,
and record from the wire: `authMethods`, the `modes` list, the `_meta` keys on `tool_call` updates and on
permission requests, whether `session/load` is offered, and the stderr lines it logs. The profile table
is written from that evidence; an agent whose probe fails to run on this Mac is shipped as "not yet
supported" in the Your agent row rather than guessed at.

### Probe result (2026-10-20)

Run on this Mac with `probe.mjs` against a toy repo. Cells without a marker are read from a `summary.json`; cells marked † are inferred or taken from the agent's docs, not observed.
The four agents were probed in parallel against the same toy repo. Gemini was **deferred**: it answered
`initialize` with auth methods and refused `session/new` with `{"code":-32000,"message":"Gemini API key is missing or not configured."}`
(no sign-in was attempted, per the never-wait rule). Codex `authenticate` was not called (it opens a browser),
so its `Login` is the terminal command, not an observed AuthMethod flow.

| | claude-acp | codex-acp | gemini | opencode |
|---|---|---|---|---|
| version run | 0.75.1 | 2.2.3-preview.10 | 0.64.0 (initialize only) | 1.19.0 |
| authMethods ids | *(none)* | `api-key`, `chat-gpt` | `oauth-personal`, `gemini-api-key`, `vertex-ai`, `gateway` | `opencode-login` |
| Login † | Terminal "claude /login" | Terminal "codex login" | Terminal "gemini" (deferred, not observed) | Terminal "opencode auth login" |
| availableModes ids | `default`, `acceptEdits`, `plan`, `auto`, `bypassPermissions` | `read-only`, `workspace-write`, `agent`, `agent-full-access` | — (session/new refused) | — (no `modes`; configOption `mode` offers `build`, `plan`, which are agents, not permission stances) |
| Ask first → † | default | read-only | — | — |
| Execute → † | acceptEdits | workspace-write | — | — |
| Auto → † | auto | agent | — | — |
| Unattended → † | bypassPermissions | agent-full-access | — | — |
| `_meta` paths by event | tool_call: `/_meta/claudeCode/toolName`; tool_call_update: `/_meta/claudeCode/toolName`, `/_meta/claudeCode/toolResponse/*`, `/_meta/claudeCode/title` | tool_call: none; tool_call_update: `/_meta/terminal_output_delta/data`, `/_meta/terminal_output_delta/terminal_id` | — | none on either |
| permission `_meta` paths | none (one request, `kind: edit`, no `_meta`) | none seen (default mode `agent` never asked) | — | none seen (no request) |
| loadSession | true | true | true (from initialize) | true |
| credentials file when signed in | Keychain "Claude Code-credentials" † (not observed) | `~/.codex/auth.json` was present on the Mac before the probe; whether signing in writes it was not observed | — | none found (ran on its free models without an auth file) |
| verdict | shipped | shipped | not yet supported | shipped |

Claude Code 0.90.1-preview.15 (the registry's entry): FAIL — with the registry's `--hide-claude-auth` arg `session/new` is refused with `{"code":-32000,"message":"Authentication required: This integration does not support using claude.ai subscriptions.","data":{"reason":"claude_subscription_not_supported"}}`; run without that flag the turn completes (`end_turn`), `tool_call` `_meta` keeps `claudeCode.toolName`, and the modes keep all five (`default`, `acceptEdits`, `plan`, `auto`, `bypassPermissions`); `claudeCode.parentToolUseId` was not seen in either version (the prompt used no subagent).

## 12 · Choices this spec made on its own (confirm or overturn)

1. **Four agents first**, from the registry's tested set: Claude Code, Codex, Gemini CLI, OpenCode. The
   other 38 registry agents are not offered in this release.
2. **Pins ship with Chronicle**, not live from the registry: what the user gets is what was probed.
3. **The reviewer and the judge default to the user's agent**, so both work with no key; keys are an
   upgrade, not a requirement. Jev stays the best judge where a key exists.
4. **Normalise in Rust, not TypeScript**: the pane reads one `_chronicle` shape for every agent.
5. **Plugins are not portable**, so Runs carries its instructions in the prompt and its tools in MCP.
6. **The Claude pin moves to the registry's version only after the probe passes on it.**
7. **Lanes run on the project's agent**, not a separately chosen one: one agent per project.

## 13 · Testing

Rust: profile table completeness (every id has a registry entry at its pinned version in the bundled
file); launch command per distribution kind (npx, binary with sha256 check, direct after install);
normalisation of `tool_call` meta for each profile from recorded wire lines; the provider trait against
recorded HTTP responses (no network in tests); `Decision` parsing for native and emulated shapes; Keychain
wrapper behind a trait with a fake. TypeScript: the stance↔mode translation, the agent picker store, the
`_chronicle` shape in the reducer with replay fixtures per agent (recorded by the probe). Live: the four
probes, then one real turn per agent in the pane.

## 14 · Boards

Two, in the Deck 10 style before build: (1) Setup with the **Your agent** row (four agents, their states)
and the **Providers** row (two roles, five providers, the key field); (2) the pane on a non-Claude agent:
the header mark and name, the composer's agent picker, a flat tool list, the sign-in banner with that
agent's command.
