#!/usr/bin/env node
// Refresh the bundled ACP registry at release time (spec §3).
//   node scripts/acp-registry.mjs [--dry-run] [--take <id>]...
// Pinned agents keep their bundled entry (Chronicle ships what it probed);
// every other entry is replaced by the latest release's. --take <id> takes
// the latest entry for a pinned agent — then move its pin in profiles.rs,
// probe it (plan Task 1's probe.mjs), and update its fixture.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const usage = 'usage: node scripts/acp-registry.mjs [--dry-run] [--take <id>]...'
const fail = (msg) => { throw new Error(msg) }

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const file = path.join(root, 'src-tauri/resources/acp-registry.json')
const REGISTRY_URL = 'https://github.com/agentclientprotocol/registry/releases/latest/download/registry.json'

let dry = false
const take = new Set()
const args = process.argv.slice(2)
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--dry-run') dry = true
  else if (args[i] === '--take') {
    const id = args[++i]
    if (!id || id.startsWith('--')) fail(`--take needs an agent id\n${usage}`)
    take.add(id)
  } else fail(`unknown argument ${args[i]}\n${usage}`)
}

// Pins: id/name/registry_version in profiles.rs, comments stripped. The count of
// `registry_version: "…"` occurrences must equal the pins parsed, so a reorder,
// an escaped quote or an odd layout fails loudly instead of un-pinning an agent.
const profiles = fs.readFileSync(path.join(root, 'src-tauri/src/agents/profiles.rs'), 'utf8').replace(/\/\/.*$/gm, '')
const found = [...profiles.matchAll(/id:\s*"([^"]+)",\s*name:\s*"[^"]*",\s*registry_version:\s*"([^"]+)",\s*pinned_npx:\s*(?:Some\(PinnedNpx\s*\{\s*package:\s*"([^"]+)"|None)/g)]
const expected = (profiles.match(/registry_version:\s*"/g) ?? []).length
const expectedNpx = (profiles.match(/pinned_npx:\s*(?:Some|None)\b/g) ?? []).length
if (found.length !== expectedNpx) fail(`parsed ${found.length} pins but profiles.rs has ${expectedNpx} pinned_npx fields — has the shape changed?`)
if (found.length === 0) fail('found no pins in profiles.rs — has its shape changed?')
if (found.length !== expected) fail(`parsed ${found.length} pins but profiles.rs has ${expected} registry_version entries — has the shape changed?`)
// A profile with pinned_npx launches from that package@version, so its bundled entry
// is kept verbatim and no entry at registry_version is required; the others must ship at their pin.
const pins = new Map()
const npx = new Map()
for (const m of found) {
  if (pins.has(m[1])) fail(`duplicate pin for ${m[1]} in profiles.rs`)
  pins.set(m[1], m[2])
  if (m[3]) npx.set(m[1], m[3])
}
for (const id of take) if (!pins.has(id)) console.warn(`warning: --take ${id} is not a pinned agent (its latest entry is taken anyway)`)

const res = await fetch(REGISTRY_URL, { signal: AbortSignal.timeout(30_000) })
if (!res.ok) fail(`registry download failed: ${res.status}`)
const latest = await res.json()
if (!Array.isArray(latest?.agents) || latest.agents.length === 0) fail('downloaded registry has no agents array')
for (const a of latest.agents) {
  if (typeof a?.id !== 'string' || typeof a?.version !== 'string') fail(`downloaded registry has a malformed entry: ${JSON.stringify(a)?.slice(0, 120)}`)
}
const bundled = JSON.parse(fs.readFileSync(file, 'utf8'))
const byId = new Map(bundled.agents.map((a) => [a.id, a]))

const newer = (fresh, pin) => {
  const f = fresh.split('.').map(Number), p = pin.split('.').map(Number)
  for (let i = 0; i < Math.max(f.length, p.length); i++) { const d = (f[i] ?? 0) - (p[i] ?? 0); if (d !== 0) return d > 0 }
  return false
}

const out = latest.agents.map((fresh) => {
  const pin = pins.get(fresh.id)
  const old = byId.get(fresh.id)
  if (!pin) return fresh
  if (take.has(fresh.id)) { console.log(`${fresh.id}: taken ${fresh.version} (move its pin from ${pin}, then probe it)`); return fresh }
  if (npx.has(fresh.id)) {
    if (!old) fail(`${fresh.id}: launched from pinned_npx ${npx.get(fresh.id)} but has no bundled entry`)
    console.log(`kept bundled entry for ${fresh.id} (launched from pinned_npx ${npx.get(fresh.id)})`)
    return old
  }
  if (old && old.version === pin) {
    console.log(fresh.version === pin ? `${fresh.id}: kept ${pin}` : newer(fresh.version, pin) ? `${fresh.id}: kept ${pin} — newer available: ${fresh.version}` : `${fresh.id}: kept ${pin} — registry latest is ${fresh.version}`)
    return old
  }
  return fail(`${fresh.id}: pinned ${pin} but bundled ${old?.version ?? 'none'} (latest ${fresh.version}) — fix the pin or the bundle, or --take ${fresh.id}`)
})
for (const [id, pin] of pins) {
  if (!out.some((a) => a.id === id)) {
    if (npx.has(id) && !byId.has(id)) fail(`${id}: launched from pinned_npx ${npx.get(id)} but has no bundled entry`)
    if (!byId.has(id)) fail(`${id}: pinned ${pin} but absent from both the bundle and the latest registry`)
    console.log(`${id}: gone from the registry — kept ${pin}`); out.push(byId.get(id))
  }
}
// Pins ship: every pin must resolve to an entry at exactly that version (except an explicit --take).
for (const [id, pin] of pins) {
  const e = out.find((a) => a.id === id)
  if (!e) fail(`${id}: pinned ${pin} but missing from the output`)
  if (e.version !== pin && !take.has(id) && !npx.has(id)) fail(`${id}: pinned ${pin} but the output has ${e.version}`)
}
const next = { ...latest, agents: out }
if (dry) console.log(`dry run: ${out.length} agents, nothing written`)
else {
  fs.writeFileSync(file + '.tmp', JSON.stringify(next, null, 2) + '\n')
  fs.renameSync(file + '.tmp', file)
  console.log(`wrote ${path.relative(root, file)}: ${out.length} agents`)
}
