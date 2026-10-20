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
const REGISTRY_URL = 'https://github.com/agentclientprotocol/registry/releases/latest/download/registry.json'
const args = process.argv.slice(2)
const dry = args.includes('--dry-run')
const take = new Set(args.flatMap((a, i) => (a === '--take' ? [args[i + 1]] : [])))

const pins = new Map([...profiles.matchAll(/id:\s*"([^"]+)",\s*name:\s*"[^"]*",\s*registry_version:\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]))
if (pins.size === 0) throw new Error('found no pins in profiles.rs — has its shape changed?')

const res = await fetch(REGISTRY_URL)
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
