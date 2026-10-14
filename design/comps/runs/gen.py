#!/usr/bin/env python3
"""Deck 10 · Runs — the agent orchestrator's card and the fluid pane.
Boards R1–R6 from c-runs/DESIGN_PROMPT.md as .dc.html artboards. The chrome
(tokens, title bar, rail, thread atoms) is the design-pane deck's, so every
board matches the shipped app; see _chrome.py."""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from _chrome import *  # noqa: F401,F403

ROOT = os.path.join(os.path.dirname(__file__), "project")
PANE_W = 520

# ---------------------------------------------------------------- atoms the chat pane adds
G["agent"] = svg('<circle cx="7" cy="4.5" r="2.2"></circle><path d="M2.5 12c.6-2.4 2.3-3.6 4.5-3.6s3.9 1.2 4.5 3.6"></path>', size=12, vb="0 0 14 14", sw="1.4")
G["back"] = svg('<path d="M10 4 6 8l4 4"></path>', size=11)
G["lanes"] = svg('<path d="M3 2.5v11M8 2.5v11M13 2.5v11"></path>', size=12, sw="1.4")
G["warn"] = svg('<path d="M6 1.5 11 10.5H1z"></path><path d="M6 4.8v2.6M6 8.8v.1"></path>', size=12, vb="0 0 12 12", sw="1.3")
G["doc"] = svg('<path d="M3 1.5h6l3 3v10H3z"></path><path d="M9 1.5v3h3"></path>', size=13, sw="1.2")
G["spark"] = svg('<path d="M8 2v12M2 8h12M4 4l8 8M12 4l-8 8"></path>', size=12, sw="1.4")
G["connector"] = svg('<path d="M5 2.5v3a3 3 0 0 0 6 0v-3M8 8.5v5M5.5 13.5h5"></path>', size=14, sw="1.3")

def spinner(size=11):
    return f'<span style="width:{size}px;height:{size}px;border-radius:50%;border:1.5px solid var(--state-neutral);border-top-color:transparent;animation:wv-spin .7s linear infinite;flex-shrink:0;display:inline-block"></span>'

def sw(word, tone="neutral", pulse=None, size="11.5px"):
    """StateWord as the app draws it: check / error glyph, or a dot that pulses while running."""
    col = {"success": "var(--state-success)", "error": "var(--state-error)", "warn": "var(--state-warn)", "neutral": "var(--state-neutral)", "dim": "var(--text-dim)"}[tone]
    if tone == "success":
        lead = f'<span style="display:flex">{G["check"]}</span>'
    elif tone == "error":
        lead = f'<span style="display:flex">{G["error"]}</span>'
    elif tone == "warn":
        lead = f'<span style="display:flex">{G["warn"]}</span>'
    else:
        lead = dot(col, pulse if pulse is not None else tone == "neutral")
    return f'<span style="display:inline-flex;align-items:center;gap:5px;font-size:{size};color:{col};white-space:nowrap">{lead}{word}</span>'

def mono(t, color="var(--text-dim)", size="10.5px", extra=""):
    return f'<span style="{MONO};font-size:{size};color:{color};font-variant-numeric:tabular-nums;white-space:nowrap;{extra}">{t}</span>'

def tchip(t):
    return f'<span style="display:inline-flex;align-items:center;height:18px;padding:0 6px;border-radius:5px;background:var(--fill-subtle);{MONO};font-size:10px;color:var(--text-subtle);white-space:nowrap">{t}</span>'

def chat_btn(label, kind="secondary"):
    st = {"primary": "background:var(--primary);color:var(--primary-fg);border:1px solid var(--primary)",
          "secondary": "background:transparent;color:var(--text-primary);border:1px solid var(--border-strong)",
          "quiet": "background:transparent;color:var(--text-muted);border:1px solid var(--border-hairline)",
          "danger": "background:transparent;color:var(--state-error);border:1px solid var(--border-hairline)"}[kind]
    return f'<button type="button" style="height:26px;padding:0 11px;border-radius:8px;{st};font-size:11.5px;font-weight:500;{SANS};white-space:nowrap;cursor:default">{label}</button>'

# ---------------------------------------------------------------- the chat pane
def avatar_agent():
    return f'<span style="width:26px;height:26px;border-radius:50%;border:1px solid var(--border-hairline);background:var(--surface-card-raised);display:flex;align-items:center;justify-content:center;flex-shrink:0">{CLAUDE_STAR}</span>'

def chat_msg(body, you=False, who=None):
    av = avatar_you() if you else avatar_agent()
    name = who or ("You" if you else "Chronigirl")
    return f'<div style="display:flex;gap:10px;padding:8px 14px"><div>{av}</div><div style="flex:1;min-width:0"><div style="font-size:12.5px;font-weight:600;margin-bottom:2px">{name}</div><div style="font-size:13px;line-height:1.65;color:var(--text-primary);text-wrap:pretty">{body}</div></div></div>'

def chat_composer(run_toggle=False, placeholder="Ask for anything", disabled=False):
    toggle = ""
    if run_toggle:
        toggle = f'<span style="display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 9px;border-radius:8px;border:1px solid var(--border-strong);background:var(--fill-hover);font-size:11.5px;color:var(--text-primary)">{G["lanes"]}Run as a round</span>'
    col = "var(--text-dimmer)" if disabled else "var(--text-faint)"
    return f'''<div style="margin:8px 12px 12px;border-radius:10px;border:1px solid var(--border-field);background:var(--surface-input)">
  <div style="padding:10px 12px;font-size:13px;color:{col};min-height:40px">{placeholder}</div>
  <div style="display:flex;align-items:center;gap:6px;padding:0 8px 8px">
    <span style="width:26px;height:26px;display:flex;align-items:center;justify-content:center;color:var(--text-faint)">{G["attach"]}</span>
    <span style="display:inline-flex;align-items:center;gap:4px;height:26px;padding:0 8px;border-radius:8px;border:1px solid var(--border-hairline);font-size:11.5px;color:var(--text-muted)">Opus 4.8 {G["chevd"]}</span>
    <span style="display:inline-flex;align-items:center;gap:4px;height:26px;padding:0 8px;border-radius:8px;border:1px solid var(--border-hairline);font-size:11.5px;color:var(--text-muted)">Ask first {G["chevd"]}</span>
    {toggle}
    <span style="flex:1"></span>
    <span style="width:28px;height:28px;border-radius:8px;background:var(--primary);color:var(--primary-fg);display:flex;align-items:center;justify-content:center">{G["arrowup"]}</span>
  </div>
</div>'''

def pane_header(status, cost="$1.84 · 4m 12s", title="Agent"):
    return f'''<div style="height:40px;display:flex;align-items:center;gap:8px;padding:0 12px 0 14px;border-bottom:1px solid var(--border-hairline);box-sizing:border-box;flex-shrink:0">
    <span style="font-size:12.5px;font-weight:600">{title}</span>{status}<span style="flex:1"></span>
    {mono(cost, "var(--text-faint)")}
    <span style="width:26px;height:26px;display:flex;align-items:center;justify-content:center;color:var(--text-faint)">{G["clock"]}</span>
  </div>'''

def agent_pane(body, status=None, cost="$1.84 · 4m 12s", width=PANE_W, composer=None, bottom=True):
    st = status or sw("ready", "success")
    just = "flex-end" if bottom else "flex-start"
    return f'''<div style="width:{width}px;flex-shrink:0;display:flex;flex-direction:column;border-left:1px solid var(--border-hairline);box-sizing:border-box;background:var(--surface-panel)">
  {pane_header(st, cost)}
  <div style="flex:1;overflow:hidden;padding:6px 0;display:flex;flex-direction:column;justify-content:{just};gap:4px;position:relative">{body}<span style="position:absolute;left:0;right:0;top:0;height:16px;background:linear-gradient(var(--surface-panel),transparent);pointer-events:none"></span></div>
  {composer if composer is not None else chat_composer()}
</div>'''

# ---------------------------------------------------------------- the notes pane (content unit)
NOTES = [
    ("T-141", "Coalesce store notifies to one per frame", "done"),
    ("T-142", "Memoise thread rows by entry id", "working"),
    ("T-143", "Stream the reply through streamdown", "working"),
    ("T-144", "Scroll anchoring on a bottom sentinel", "checking"),
    ("T-145", "content-visibility on off-screen rows", "checking"),
    ("T-146", "Spawn the installed adapter directly", "in round"),
    ("T-147", "Pre-warm the session when the project opens", "in round"),
]

def status_chip(label):
    tone = {"done": ("var(--state-success)", "var(--state-success)"), "working": ("var(--state-neutral)", "var(--state-neutral)"), "checking": ("var(--state-neutral)", "var(--state-neutral)"), "in round": ("var(--text-dim)", "var(--border-strong)"), "needs you": ("var(--state-warn)", "var(--state-warn)"), "not done": ("var(--text-dim)", "var(--border-strong)")}[label]
    pulse = "animation:wv-pulse 1.6s ease-in-out infinite;" if label in ("working", "checking") else ""
    return f'<span style="display:inline-flex;align-items:center;gap:5px;height:18px;padding:0 6px;border-radius:4px;border:1px solid var(--border-hairline);font-size:10.5px;color:{tone[0]};white-space:nowrap"><span style="width:5px;height:5px;border-radius:50%;background:{tone[1]};{pulse}"></span>{label}</span>'

def notes_round_card(state="running", lanes=3, cost="$1.84", done=1, total=7, notes=NOTES, sub=None):
    word = {"running": sw("running", "neutral"), "needs you": sw("needs you", "warn"), "done": sw("done", "success")}[state]
    subline = sub or f"{lanes} lanes working · {done} of {total} done · {cost}"
    bar = f'<div style="margin:9px 0;height:2px;border-radius:1px;background:var(--fill-subtle)"><span style="display:block;height:100%;width:{int(done/total*100)}%;border-radius:1px;background:var(--state-neutral)"></span></div>' if state != "done" else ""
    rows = "".join(f'<div style="display:flex;align-items:center;gap:7px;height:26px;padding:0 4px;border-radius:5px;{"background:var(--fill-hover)" if i==3 else ""}"><span style="color:var(--text-subtle);display:flex">{G["doc"]}</span><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--text-secondary)">{t}</span>{status_chip(s)}</div>' for i, (_, t, s) in enumerate(notes))
    return f'''<div style="margin:6px 8px 8px;padding:10px 12px;border-radius:10px;border:1px solid var(--border-strong);background:var(--surface-card)">
  <div style="display:flex;align-items:center;gap:8px"><span style="font-size:12.5px;font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Round 10 · bug fixes</span>{word}</div>
  <div style="margin-top:3px;font-size:11px;color:var(--text-muted)">{subline}</div>
  {bar}
  <div style="display:flex;flex-direction:column;gap:1px;margin-top:{"8px" if state=="done" else "0"}">{rows}</div>
</div>'''

def notes_pane(round_card):
    tree = "".join([
        f'<div style="display:flex;align-items:center;gap:6px;height:24px;padding:0 10px;margin-top:8px">{eyebrow("Tasks")}<span style="flex:1"></span>{mono("7", "var(--text-faint)", "10px")}</div>',
        f'<div style="display:flex;align-items:center;gap:6px;height:24px;padding:0 10px;margin-top:8px">{eyebrow("Bugs")}<span style="flex:1"></span>{mono("2", "var(--text-faint)", "10px")}</div>',
        "".join(f'<div style="display:flex;align-items:center;gap:7px;height:26px;padding:0 10px"><span style="color:var(--text-subtle);display:flex">{G["doc"]}</span><span style="flex:1;font-size:12px;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{t}</span></div>' for t in ["Resume wipes the thread", "Subagent card loses its open state"]),
        f'<div style="display:flex;align-items:center;gap:6px;height:24px;padding:0 10px;margin-top:8px">{eyebrow("Ideas")}<span style="flex:1"></span>{mono("4", "var(--text-faint)", "10px")}</div>',
    ])
    editor = f'''<div style="flex:1;min-width:0;display:flex;flex-direction:column">
  <div style="height:40px;display:flex;align-items:center;gap:8px;padding:0 16px;border-bottom:1px solid var(--border-hairline);box-sizing:border-box">{eyebrow("Task")}{mono("T-144", "var(--text-faint)", "11px")}<span style="flex:1"></span>{status_chip("checking")}{chat_btn("Open file", "quiet")}</div>
  <div style="padding:26px 36px;display:flex;flex-direction:column;gap:14px;max-width:640px">
    <div style="font-size:22px;font-weight:600;letter-spacing:-.01em;line-height:1.25">Scroll anchoring on a bottom sentinel</div>
    <div style="font-size:13.5px;line-height:1.7;color:var(--text-secondary)">While you are at the bottom the thread should stay pinned there as content grows, without any scroll calls. One smooth glide only when you come back to the bottom. The “jump on chunk” path goes.</div>
    <div style="font-size:13.5px;line-height:1.7;color:var(--text-secondary)"><b style="font-weight:600;color:var(--text-primary)">Done when</b> a 300-entry thread streams at 60 fps with no visible jump, measured in the probe harness.</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">{tchip("src/screens/agent/AgentPane.tsx")}{tchip("src/index.css")}</div>
  </div>
</div>'''
    return f'''<div style="flex:1;min-width:0;display:flex">
  <div style="width:272px;flex-shrink:0;display:flex;flex-direction:column;border-right:1px solid var(--border-hairline);box-sizing:border-box">
    <div style="height:40px;display:flex;align-items:center;gap:6px;padding:0 10px 0 14px;border-bottom:1px solid var(--border-hairline)">{eyebrow("Notes · 13")}<span style="flex:1"></span><span style="width:26px;height:26px;display:flex;align-items:center;justify-content:center;color:var(--text-subtle)">{G["search"]}</span><span style="width:26px;height:26px;display:flex;align-items:center;justify-content:center;color:var(--text-subtle)">{G["plus"]}</span></div>
    {round_card}
    <div style="flex:1;overflow:hidden;padding:0 0 8px">{tree}</div>
  </div>
  {editor}
</div>'''

# ---------------------------------------------------------------- the run card
LANES = [
    dict(id="A", title="Pane store batching", items=["T-141", "T-142"], owns=["src/lib/agent-session.ts", "src/screens/agent/AgentPane.tsx"], state="working", cost="$0.62", attempt=1),
    dict(id="B", title="Streaming reply renderer", items=["T-143"], owns=["src/lib/mini-md.tsx", "src/screens/agent/AssistantMessage.tsx"], state="working", cost="$0.41", attempt=2),
    dict(id="C", title="Scroll anchoring", items=["T-144", "T-145"], owns=["src/screens/agent/thread-scroll.ts", "src/index.css"], state="being checked", cost="$0.55", attempt=1),
    dict(id="D", title="Adapter direct spawn", items=["T-146", "T-147"], owns=["src-tauri/src/acp.rs", "src-tauri/src/setup.rs"], state="waiting", cost="", attempt=1),
]

def lane_state(state):
    return {
        "waiting": sw("waiting", "dim", pulse=False),
        "working": sw("working", "neutral"),
        "being checked": sw("being checked", "neutral"),
        "fixing": sw("fixing", "warn"),
        "finished": sw("finished", "success"),
        "needs you": sw("needs you", "warn"),
        "stopped": sw("stopped", "error"),
    }[state]

def lane_row(l, open_=False, extra="", last=False):
    chips = "".join(tchip(i) for i in l["items"])
    attempt = mono(f'try {l["attempt"]} of 3', "var(--text-dim)") if l.get("attempt", 1) > 1 else ""
    cost = mono(l["cost"], "var(--text-dim)", "11px") if l["cost"] else ""
    chev = f'<span style="color:var(--text-dim);display:flex;transform:rotate({"90" if open_ else "0"}deg)">{G["chev"]}</span>'
    border = "" if last else "border-bottom:1px solid var(--divider);"
    return f'''<div style="display:flex;flex-direction:column;{border}">
  <div style="display:flex;align-items:center;gap:8px;height:34px;padding:0 2px">
    {mono(l["id"], "var(--text-faint)", "10.5px", "width:10px")}
    <span style="font-size:12.5px;color:var(--text-primary);white-space:nowrap">{l["title"]}</span>
    <span style="display:flex;gap:4px">{chips}</span>
    <span style="flex:1"></span>
    {attempt}{lane_state(l["state"])}{cost}{chev}
  </div>{extra}
</div>'''

def leak_notice(path, owner="lane C"):
    return f'<div style="display:flex;align-items:flex-start;gap:7px;margin:0 2px 8px 18px;padding:7px 10px;border-radius:6px;border:1px solid var(--border-hairline);background:var(--fill-subtle)"><span style="color:var(--state-warn);display:flex;margin-top:1px">{G["warn"]}</span><span style="font-size:11.5px;line-height:1.5;color:var(--text-muted)">Also changed {mono(path, "var(--text-secondary)", "10.5px")}, which {owner} owns — left unsaved for you.</span></div>'

def run_card(lanes, state="running", title="Round 10 · 7 items", cost="$1.84", elapsed="4m 12s", footer=None, after_lanes="", needs="", no_stop=False):
    word = {"running": sw("running", "neutral", size="12px"), "needs you": sw("needs you", "warn", size="12px"), "done": sw("done", "success", size="12px"), "checking": sw("final check", "neutral", size="12px")}[state]
    rows = "".join(lane_row(l, last=(i == len(lanes) - 1 and not after_lanes)) for i, l in enumerate(lanes))
    sentence = footer or "Nothing needs you. Chronicle saves each lane as it passes."
    foot_right = "" if no_stop else chat_btn("Stop", "quiet")
    return f'''<div data-run-card style="margin:4px 14px;border-radius:10px;border:1px solid var(--border-hairline);background:var(--surface-card-raised);padding:12px 14px 10px;display:flex;flex-direction:column;gap:8px">
  <div style="display:flex;align-items:center;gap:8px;white-space:nowrap">
    <span style="font-size:13px;font-weight:600">{title}</span>{word}
    <span style="flex:1"></span>
    <span style="display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:var(--text-muted)">{G["lanes"]}{len([l for l in lanes if l["state"] not in ("waiting",)])} of {len(lanes)} lanes</span>
    {mono(cost, "var(--text-muted)", "11px")}{mono(elapsed, "var(--text-dim)", "11px")}
  </div>
  <div style="display:flex;flex-direction:column">{rows}{after_lanes}</div>
  {needs}
  <div style="display:flex;align-items:center;gap:10px;padding-top:2px"><span style="font-size:11.5px;line-height:1.5;color:var(--text-muted);flex:1">{sentence}</span>{foot_right}</div>
</div>'''

def plan_row(text="Planned round 10 · 7 items into 4 lanes", cost="$0.26", st="done"):
    lead = f'<span style="color:var(--state-success);display:flex">{G["check"]}</span>' if st == "done" else spinner()
    return f'<div style="margin:4px 14px;display:flex;align-items:center;gap:8px;height:38px;padding:0 14px;border-radius:10px;border:1px solid var(--border-hairline);background:var(--surface-card-raised)">{lead}<span style="font-size:12.5px;color:var(--text-primary)">{text}</span><span style="flex:1"></span>{mono(cost, "var(--text-dim)", "11px")}<span style="font-size:11.5px;color:var(--text-secondary)">Open the plan ›</span></div>'

def decision_line(text, prob):
    return f'<div style="margin:2px 14px;display:flex;align-items:flex-start;gap:8px;padding:7px 11px;border-radius:6px;border:1px solid var(--border-hairline);background:var(--surface-card)"><span style="color:var(--text-subtle);display:flex;margin-top:1px">{G["spark"]}</span><span style="font-size:12px;line-height:1.55;color:var(--text-muted);flex:1">{text}</span>{mono(prob, "var(--text-dim)", "10.5px")}</div>'

# ---------------------------------------------------------------- gate pieces
def check_row(name, st, dur="", detail=""):
    if st == "pass":
        lead = f'<span style="color:var(--state-success);display:flex">{G["check"]}</span>'
    elif st == "fail":
        lead = f'<span style="color:var(--state-error);display:flex">{G["error"]}</span>'
    elif st == "run":
        lead = spinner(10)
    else:
        lead = '<span style="width:10px;height:10px;border-radius:50%;border:1.5px solid var(--border-strong);display:inline-block"></span>'
    word = {"pass": "passed", "fail": "failed", "run": "running", "queued": "queued"}[st]
    wcol = {"pass": "var(--text-muted)", "fail": "var(--state-error)", "run": "var(--text-muted)", "queued": "var(--text-dim)"}[st]
    return f'<div style="display:flex;align-items:center;gap:8px;height:26px"><span style="width:12px;display:flex;justify-content:center">{lead}</span>{mono(name, "var(--text-secondary)", "11px")}<span style="font-size:11.5px;color:{wcol}">{word}</span><span style="flex:1"></span>{mono(dur, "var(--text-dim)", "10.5px")}</div>'

def gate_card(checks, review=None, out=None, label="Checked after save", margin="6px 14px 4px 14px"):
    rv = ""
    if review:
        kind, text = review
        if kind == "pass":
            rv = f'<div style="display:flex;align-items:center;gap:8px;height:26px;border-top:1px solid var(--divider);margin-top:4px;padding-top:4px"><span style="width:12px;display:flex;justify-content:center;color:var(--state-success)">{G["check"]}</span><span style="font-size:11.5px;color:var(--text-muted)">{text}</span></div>'
        else:
            rv = f'<div style="display:flex;flex-direction:column;gap:4px;border-top:1px solid var(--divider);margin-top:4px;padding-top:6px"><div style="display:flex;align-items:center;gap:8px;height:22px"><span style="width:12px;display:flex;justify-content:center;color:var(--state-warn)">{G["warn"]}</span><span style="font-size:11.5px;color:var(--text-muted);flex:1">{text}</span><span style="color:var(--text-dim);display:flex;transform:rotate(90deg)">{G["chev"]}</span></div>{kind}</div>'
    o = f'<div style="margin-top:6px;padding:8px 10px;border-radius:6px;background:var(--surface-input);{MONO};font-size:10.5px;line-height:1.6;color:var(--text-muted);white-space:pre-wrap;overflow:hidden">{out}</div>' if out else ""
    return f'<div style="margin:{margin};padding:8px 12px 8px;border-radius:8px;border:1px solid var(--border-hairline);background:var(--surface-card)"><div style="display:flex;align-items:center;gap:8px;margin-bottom:2px">{eyebrow(label)}</div>{"".join(checks)}{o}{rv}</div>'

def subagent_card(title, calls, state="working", open_=True, report=None):
    lead = spinner() if state == "working" else (f'<span style="color:var(--state-success);display:flex">{G["check"]}</span>' if state == "done" else f'<span style="color:var(--state-error);display:flex">{G["error"]}</span>')
    rows = "".join(f'<div style="display:flex;align-items:center;gap:8px;height:26px;padding:0 10px;margin-left:12px;border-left:1px solid var(--border-hairline)"><span style="width:12px;display:flex;justify-content:center">{"<span style=\"color:var(--state-success);display:flex\">" + G["check"] + "</span>" if s=="done" else spinner(10)}</span><span style="font-size:12px;color:var(--text-secondary);white-space:nowrap">{n}</span>{mono(d, "var(--text-faint)", "10.5px", "overflow:hidden;text-overflow:ellipsis")}</div>' for n, d, s in calls)
    rep = f'<div style="margin:6px 0 2px 12px;padding:8px 10px;border-radius:6px;background:var(--surface-input);{MONO};font-size:10.5px;line-height:1.6;color:var(--text-muted)">{report}</div>' if report else ""
    return f'''<div style="margin:4px 14px;border-radius:8px;border:1px solid var(--border-hairline);background:var(--surface-card)">
  <div style="display:flex;align-items:center;gap:8px;height:34px;padding:0 11px"><span style="color:var(--text-dim);display:flex;transform:rotate({"90" if open_ else "0"}deg)">{G["chev"]}</span>{lead}<span style="color:var(--text-dim);display:flex">{G["agent"]}</span><span style="font-size:12.5px;font-weight:500">{title}</span>{mono(f"{len(calls)} calls", "var(--text-dim)", "11px")}<span style="flex:1"></span><span style="font-size:11.5px;color:var(--text-dim)">{state}</span></div>
  {f'<div style="padding:0 11px 8px">{rows}{rep}</div>' if open_ else ""}
</div>'''

def tool_card(name, detail, st="done"):
    lead = f'<span style="color:var(--state-success);display:flex">{G["check"]}</span>' if st == "done" else spinner(10)
    return f'<div style="margin:2px 14px;display:flex;align-items:center;gap:8px;height:30px;padding:0 11px;border-radius:8px;border:1px solid var(--border-hairline);background:var(--surface-card)"><span style="width:12px;display:flex;justify-content:center">{lead}</span><span style="font-size:12px;color:var(--text-secondary)">{name}</span>{mono(detail, "var(--text-faint)", "10.5px", "overflow:hidden;text-overflow:ellipsis")}</div>'

def board_shell(inner, sel="notes"):
    return shell(inner, sel=sel)

# ================================================================ BOARDS
boards = {}
LABEL = lambda t, x, y: f'<div style="position:absolute;left:{x}px;top:{y}px;display:flex;align-items:center;gap:8px"><span style="{MONO};font-size:10.5px;color:var(--text-faint);padding:2px 7px;border-radius:5px;background:var(--fill-subtle)">{t}</span></div>'

# ---- R1 · the run card, working
def thread_r1():
    return (chat_msg("Run a round from the queued notes. Keep the pane feeling fast while it works.", you=True)
            + plan_row()
            + chat_msg("Seven items, four lanes. A and B start now, C is already saved and being checked, D starts when a lane frees up. I’ll say something only if a lane can’t finish.")
            + decision_line("Lane B asked to run <span style=\"" + MONO + ";font-size:11px;color:var(--text-secondary)\">npx vitest run src/lib</span> — allowed, it reads only.", "0.93")
            + run_card(LANES))

def b_run(theme="dark"):
    return board_shell(notes_pane(notes_round_card()) + agent_pane(thread_r1(), status=sw("running", "neutral"), composer=chat_composer(run_toggle=True)))
boards["01-Run-dark.dc.html"] = ("R1 · the run card, working (dark)", b_run, "dark")
boards["02-Run-light.dc.html"] = ("R1 · the run card, working (light)", b_run, "light")

# ---- R2 · a lane opened
def b_lane():
    l = LANES[2]
    head = f'''<div style="margin:4px 14px 2px;display:flex;flex-direction:column;gap:8px">
  <div style="display:flex;align-items:center;gap:8px"><span style="display:inline-flex;align-items:center;gap:4px;font-size:11.5px;color:var(--text-secondary)">{G["back"]}Back to the run</span><span style="flex:1"></span>{mono("Round 10 · lane C", "var(--text-faint)", "10.5px")}</div>
  <div style="display:flex;align-items:center;gap:8px"><span style="font-size:14px;font-weight:600">Scroll anchoring</span>{lane_state("being checked")}<span style="flex:1"></span>{mono("$0.55 · 3m 50s", "var(--text-dim)", "11px")}</div>
  <div style="display:flex;gap:4px">{"".join(tchip(i) for i in l["items"])}<span style="font-size:11.5px;color:var(--text-muted);margin-left:4px">Scroll anchoring on a bottom sentinel · content-visibility on off-screen rows</span></div>
  <div style="display:flex;align-items:center;gap:6px;height:22px"><span style="color:var(--text-dim);display:flex;transform:rotate(90deg)">{G["chev"]}</span><span style="font-size:11px;color:var(--text-faint)">Owns 2 files</span></div>
  <div style="display:flex;flex-direction:column;gap:3px;margin:-4px 0 4px 17px">{"".join(mono(p, "var(--text-subtle)", "10.5px") for p in l["owns"])}</div>
</div>'''
    body = (head
            + divider_label("lane C · working")
            + chat_msg("Replacing the follow-scroll effect with a sentinel the browser anchors to. No scroll calls while you are at the bottom; one glide when you return.", who="Lane C")
            + tool_card("Read", "src/screens/agent/AgentPane.tsx")
            + tool_card("Edit", "src/screens/agent/thread-scroll.ts")
            + subagent_card("Check the thread at 300 entries", [("Bash", "npm run dev -- --port 1421", "done"), ("Bash", "node probe/scroll-trace.mjs --entries 300", "done"), ("Read", "probe/out/trace.json", "done")], state="done", report="60.0 fps over 12 s · 0 scroll calls while pinned · 1 glide on return (268 ms)")
            + tool_card("Edit", "src/index.css")
            + divider_label("saved · checked")
            + gate_card([check_row("test", "pass", "4.2 s"), check_row("typecheck", "pass", "2.0 s"), check_row("build", "run", "")], review=None, label="Checked after save")
            )
    return board_shell(notes_pane(notes_round_card()) + agent_pane(body, status=sw("running", "neutral"), bottom=False, composer=chat_composer(placeholder="Nudge lane C — it reads this between steps")))
boards["03-Lane.dc.html"] = ("R2 · a lane opened", b_lane, "dark")

# ---- R3 · failing → fixing → final check → done, and the leak
def b_sequence():
    W2 = PANE_W
    def frame(label, inner, x, y, h=None):
        hs = f"height:{h}px;" if h else ""
        return f'{LABEL(label, x, y-26)}<div style="position:absolute;left:{x}px;top:{y}px;width:{W2}px;{hs}border-radius:10px;border:1px solid var(--border-hairline);background:var(--surface-panel);padding:8px 0;box-sizing:border-box;overflow:hidden">{inner}</div>'
    fail_out = "src/screens/agent/AgentPane.tsx(612,9): error TS2339: Property &#39;anchor&#39; does not exist on type &#39;ThreadScroll&#39;.\n\nFound 1 error in 1 file."
    lanes1 = [dict(LANES[0]), dict(LANES[1]), dict(LANES[2], state="fixing", cost="$0.63", attempt=1), dict(LANES[3])]
    s1 = run_card(lanes1, footer="Lane C’s typecheck failed. It is fixing that now — fix 1 of 2.") + gate_card([check_row("test", "pass", "4.2 s"), check_row("typecheck", "fail", "2.1 s")], out=fail_out, label="Lane C · checked after save")
    lanes2 = [dict(LANES[0], state="finished", cost="$0.74"), dict(LANES[1]), dict(LANES[2], state="finished", cost="$0.71"), dict(LANES[3], state="working", cost="$0.12")]
    s2 = run_card(lanes2, cost="$2.02", elapsed="7m 05s", footer="Lane C passed on its fix. Two lanes still working.") + gate_card([check_row("test", "pass", "4.3 s"), check_row("typecheck", "pass", "2.0 s"), check_row("build", "pass", "9.8 s")], review=("pass", "Reviewed: looks right"), label="Lane C · fix 1 · checked after save")
    lanes3 = [dict(l, state="finished", cost=c) for l, c in zip(LANES, ["$0.74", "$0.66", "$0.71", "$0.58"])]
    final = f'<div style="margin-top:6px;padding:8px 2px 2px;border-top:1px solid var(--divider)"><div style="display:flex;align-items:center;gap:8px;height:26px">{spinner()}<span style="font-size:12.5px">Checking everything together</span><span style="flex:1"></span>{mono("4 checks", "var(--text-dim)", "11px")}</div><div style="margin-left:19px">{check_row("test", "pass", "4.4 s")}{check_row("typecheck", "pass", "2.1 s")}{check_row("build", "run")}{check_row("cargo test", "queued")}</div></div>'
    s3 = run_card(lanes3, state="checking", cost="$2.69", elapsed="11m 02s", after_lanes=final, footer="Every lane passed on its own. One last check of the whole project, then it’s saved.")
    s4 = run_card(lanes3, state="done", cost="$2.69", elapsed="11m 40s", footer="Saved as round 10. 7 items done.", no_stop=True) + chat_msg("Round 10 is saved. Seven items, four lanes, nothing left for you. The two notes that were bugs are closed too.")
    leak_lanes = [dict(LANES[0]), dict(LANES[1], state="finished", cost="$0.66"), dict(LANES[2]), dict(LANES[3])]
    leak_rows = "".join(lane_row(l, extra=(leak_notice("src/index.css") if l["id"] == "B" else ""), last=(i == 3)) for i, l in enumerate(leak_lanes))
    leak = f'<div style="margin:4px 14px;border-radius:10px;border:1px solid var(--border-hairline);background:var(--surface-card-raised);padding:12px 14px 10px;display:flex;flex-direction:column;gap:8px"><div style="display:flex;align-items:center;gap:8px"><span style="font-size:13px;font-weight:600">Round 10 · 7 items</span>{sw("running", "neutral", size="12px")}<span style="flex:1"></span>{mono("$2.02", "var(--text-muted)", "11px")}</div><div style="display:flex;flex-direction:column">{leak_rows}</div><div style="font-size:11.5px;line-height:1.5;color:var(--text-muted)">Lane B also touched a file lane C owns. That change is left unsaved and listed above; nothing is undone for you.</div></div>'
    inner = (LABEL("R3 · one lane, from a failed check to the saved round", 40, 28).replace("font-size:10.5px", "font-size:12px")
             + frame("1 · a check fails → fixing", s1, 40, 90)
             + frame("2 · the fix passes", s2, 40 + W2 + 40, 90)
             + frame("3 · the final check of the whole project", s3, 40, 590)
             + frame("4 · saved", s4, 40 + W2 + 40, 590)
             + frame("the leak notice · a lane changed a file it does not own", leak, 40 + 2 * (W2 + 40), 90))
    return f'<div style="position:relative;width:1720px;height:1100px;overflow:hidden;background:var(--surface-app)">{inner}</div>'
boards["04-Gate-sequence.dc.html"] = ("R3 · failing → fixing → final check → saved, plus the leak notice", b_sequence, "dark", 1720, 1100)

# ---- R4 · needs you
def b_needs():
    lanes = [dict(LANES[0], state="finished", cost="$0.74"), dict(LANES[1], state="finished", cost="$0.66"), dict(LANES[2], state="finished", cost="$0.71"), dict(LANES[3], state="needs you", cost="$0.41", attempt=2)]
    parked = f'''<div style="display:flex;flex-direction:column;gap:7px;padding:10px 12px;border-radius:8px;border:1px solid var(--border-hairline);background:var(--surface-card)">
  <div style="display:flex;align-items:center;gap:8px">{sw("needs you", "warn")}{tchip("T-147")}<span style="font-size:12.5px;font-weight:500">Pre-warm the session when the project opens</span></div>
  <div style="font-size:12px;line-height:1.55;color:var(--text-muted)">Lane D: “The pane starts the session when it mounts. Starting it when the project opens needs a hook in <span style="{MONO};font-size:11px;color:var(--text-secondary)">src/App.tsx</span>, which this lane doesn’t own.”</div>
  <div style="display:flex;align-items:center;gap:8px"><span style="color:var(--text-subtle);display:flex">{G["spark"]}</span><span style="font-size:11.5px;color:var(--text-muted);flex:1">likely impossible as written</span>{mono("0.86", "var(--text-dim)", "10.5px")}</div>
  <div style="display:flex;gap:6px">{chat_btn("Rewrite the item", "primary")}{chat_btn("Skip it", "secondary")}</div>
</div>'''
    refused = f'''<div style="display:flex;align-items:flex-start;gap:8px;padding:9px 12px;border-radius:8px;border:1px solid var(--border-hairline);background:var(--surface-card)">
  <span style="color:var(--state-warn);display:flex;margin-top:2px">{G["warn"]}</span>
  <div style="flex:1;display:flex;flex-direction:column;gap:3px"><span style="font-size:12.5px">The agent tried to publish. Chronicle doesn’t publish for you.</span><span style="font-size:11.5px;color:var(--text-muted)">Lane A, after its last save. Nothing left your Mac.</span></div>
  {chat_btn("Open the lane", "quiet")}
</div>'''
    needs = f'<div style="display:flex;flex-direction:column;gap:6px;padding-top:2px">{parked}{refused}</div>'
    card = run_card(lanes, state="needs you", cost="$2.52", elapsed="9m 31s", needs=needs, footer="One thing needs you: an item in lane D can’t be done as written. The other six are saved.")
    body = chat_msg("Six of seven are saved. One item in lane D can’t be done the way it is written — the fix lives in a file another lane owns. Rewrite it and I’ll run it as one more lane, or skip it and it stays in Notes.") + card
    notes = [(a, b, ("done" if a != "T-147" else "needs you")) for a, b, _ in NOTES]
    rc = notes_round_card(state="needs you", done=6, cost="$2.52", notes=notes, sub="needs you · 3 lanes saved · 6 of 7 done · $2.52")
    return board_shell(notes_pane(rc) + agent_pane(body, status=sw("needs you", "warn"), cost="$2.52 · 9m 31s"))
boards["05-Needs-you.dc.html"] = ("R4 · needs you: a parked item, a refused publish, and the notes card", b_needs, "dark")

# ---- R5 · the pane in motion
def b_motion():
    def col(title, sub, frames, x, y, w=300):
        fr = "".join(f'<div style="display:flex;flex-direction:column;gap:6px"><div style="border-radius:8px;border:1px solid var(--border-hairline);background:var(--surface-panel);padding:10px 12px;min-height:72px;box-sizing:border-box">{f}</div><span style="font-size:11px;color:var(--text-faint)">{c}</span></div>' for f, c in frames)
        return f'<div style="position:absolute;left:{x}px;top:{y}px;width:{w}px;display:flex;flex-direction:column;gap:10px"><div style="display:flex;flex-direction:column;gap:3px"><span style="font-size:13px;font-weight:600">{title}</span><span style="font-size:11.5px;line-height:1.5;color:var(--text-muted)">{sub}</span></div>{fr}</div>'
    # tokens block
    tok = f'''<div style="position:absolute;left:40px;top:84px;width:1360px;display:flex;gap:28px;align-items:flex-start">
  <div style="flex:1;display:flex;flex-direction:column;gap:8px;padding:14px 16px;border-radius:10px;border:1px solid var(--border-hairline);background:var(--surface-card)">
    {eyebrow("Tokens · defined once in index.css")}
    <div style="display:grid;grid-template-columns:250px 1fr;gap:6px 14px;font-size:12px;color:var(--text-secondary)">
      {mono("--ease-pane", "var(--text-primary)", "11.5px")}<span>cubic-bezier(.2, .8, .2, 1) — one curve for everything that moves in the pane</span>
      {mono("--dur-fast", "var(--text-primary)", "11.5px")}<span>140 ms — state words, chips, chevrons, dots</span>
      {mono("--dur-slow", "var(--text-primary)", "11.5px")}<span>260 ms — height, layout, rows arriving, trees opening</span>
      {mono("@media (prefers-reduced-motion)", "var(--text-primary)", "11.5px")}<span>both durations become 0 ms. Nothing is hidden, nothing waits.</span>
    </div>
  </div>
  <div style="width:360px;display:flex;flex-direction:column;gap:8px;padding:14px 16px;border-radius:10px;border:1px solid var(--border-hairline);background:var(--surface-card)">
    {eyebrow("Rules")}
    <div style="font-size:12px;line-height:1.6;color:var(--text-secondary)">Motion only shows a change that happened. Nothing loops but the running dot. Content never fades out, only in. The thread never scrolls itself while you are at the bottom.</div>
  </div>
</div>'''
    y = 230
    grow = [
        (f'<div style="display:flex;align-items:center;gap:8px;height:22px">{spinner()}<span style="font-size:12.5px;font-weight:500">Check the thread at 300 entries</span></div>', "0 ms · the card as it was"),
        (f'<div style="display:flex;align-items:center;gap:8px;height:22px">{spinner()}<span style="font-size:12.5px;font-weight:500">Check the thread at 300 entries</span></div><div style="margin-top:6px;height:34px;border-radius:6px;background:var(--surface-input);opacity:.45"></div>', "130 ms · height eases open (--dur-slow), content at 45%"),
        (f'<div style="display:flex;align-items:center;gap:8px;height:22px">{spinner()}<span style="font-size:12.5px;font-weight:500">Check the thread at 300 entries</span></div><div style="margin-top:6px;padding:7px 10px;border-radius:6px;background:var(--surface-input);{MONO};font-size:10.5px;color:var(--text-muted)">60.0 fps over 12 s · 0 scroll calls</div>', "260 ms · settled. Output faded in over the last 140 ms"),
    ]
    tree = [
        (f'<div style="display:flex;align-items:center;gap:8px;height:22px"><span style="color:var(--text-dim);display:flex">{G["chev"]}</span><span style="font-size:12.5px;font-weight:500">Subagent</span>{mono("3 calls", "var(--text-dim)", "11px")}</div>', "0 ms · closed"),
        (f'<div style="display:flex;align-items:center;gap:8px;height:22px"><span style="color:var(--text-dim);display:flex;transform:rotate(45deg)">{G["chev"]}</span><span style="font-size:12.5px;font-weight:500">Subagent</span>{mono("3 calls", "var(--text-dim)", "11px")}</div><div style="margin:4px 0 0 12px;border-left:1px solid var(--border-hairline);padding-left:10px;opacity:.4;transform:translateY(-4px)"><div style="height:22px;font-size:12px;color:var(--text-secondary);display:flex;align-items:center">Bash</div></div>', "130 ms · chevron turns (--dur-fast); children slide 4 px and fade"),
        (f'<div style="display:flex;align-items:center;gap:8px;height:22px"><span style="color:var(--text-dim);display:flex;transform:rotate(90deg)">{G["chev"]}</span><span style="font-size:12.5px;font-weight:500">Subagent</span>{mono("3 calls", "var(--text-dim)", "11px")}</div><div style="margin:4px 0 0 12px;border-left:1px solid var(--border-hairline);padding-left:10px">{"".join(f"<div style=\"height:22px;font-size:12px;color:var(--text-secondary);display:flex;align-items:center\">{n}</div>" for n in ["Bash","Bash","Read"])}</div>', "260 ms · open"),
    ]
    word = [
        (f'<div style="display:flex;align-items:center;gap:8px;height:22px"><span style="font-size:12.5px">Scroll anchoring</span><span style="flex:1"></span>{sw("being checked", "neutral")}</div>', "0 ms"),
        (f'<div style="display:flex;align-items:center;gap:8px;height:22px"><span style="font-size:12.5px">Scroll anchoring</span><span style="flex:1"></span><span style="opacity:.5">{sw("finished", "success")}</span></div>', "70 ms · the old word is gone, the new one at half; no slide, no scale"),
        (f'<div style="display:flex;align-items:center;gap:8px;height:22px"><span style="font-size:12.5px">Scroll anchoring</span><span style="flex:1"></span>{sw("finished", "success")}</div>', "140 ms · the new word, settled"),
    ]
    row = [
        (f'<div style="display:flex;gap:10px;opacity:.0"><div>{avatar_agent()}</div><div style="font-size:13px;line-height:1.6">Lane C passed on its fix.</div></div>', "0 ms · a new row arrives at opacity 0, 6 px low"),
        (f'<div style="display:flex;gap:10px;opacity:.55;transform:translateY(3px)"><div>{avatar_agent()}</div><div style="font-size:13px;line-height:1.6">Lane C passed on its fix.</div></div>', "130 ms · .wv-enter, as the pane already does it"),
        (f'<div style="display:flex;gap:10px"><div>{avatar_agent()}</div><div style="font-size:13px;line-height:1.6">Lane C passed on its fix.</div></div>', "260 ms · in place. The thread did not move: the sentinel held the bottom"),
    ]
    reduced = f'''<div style="position:absolute;left:40px;top:770px;width:1360px;display:flex;align-items:center;gap:16px;padding:14px 16px;border-radius:10px;border:1px solid var(--border-hairline);background:var(--surface-card)">
  {eyebrow("Reduced motion")}
  <span style="font-size:12px;line-height:1.55;color:var(--text-secondary);flex:1">Every frame above collapses to its last one. Cards are at their final height the moment output lands, trees open in one step, state words swap, rows appear. The running dot stops pulsing and stays lit. Nothing is lost; only the in-betweens go.</span>
  <span style="display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:var(--state-neutral)">{dot("var(--state-neutral)", False)}running</span>
</div>'''
    inner = (LABEL("R5 · the pane in motion", 40, 28).replace("font-size:10.5px", "font-size:12px") + tok
             + col("A card grows", "Output lands in a subagent card.", grow, 40, y)
             + col("A tree opens", "The subagent’s calls unfold.", tree, 40 + 340, y)
             + col("A state word changes", "being checked → finished.", word, 40 + 680, y)
             + col("A row arrives", "A new message in the thread.", row, 40 + 1020, y, w=340)
             + reduced)
    return f'<div style="position:relative;width:{W}px;height:{H}px;overflow:hidden;background:var(--surface-app)">{inner}</div>'
boards["06-Motion.dc.html"] = ("R5 · the pane in motion: tokens, four moments, reduced motion", b_motion, "dark")

# ---- R6 · starting a session, and the two Setup rows
def b_start():
    def mini_pane(status, body, x, y, h=372, composer_disabled=True, cost="$0.00"):
        return f'''<div style="position:absolute;left:{x}px;top:{y}px;width:400px;height:{h}px;border-radius:10px;border:1px solid var(--border-hairline);background:var(--surface-panel);display:flex;flex-direction:column;overflow:hidden">
  {pane_header(status, cost)}
  <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:9px;padding:20px;text-align:center">{body}</div>
  {chat_composer(disabled=composer_disabled, placeholder="Ask for anything")}
</div>'''
    empty = f'<span style="margin-bottom:4px">{CLAUDE_STAR.replace("width=\"12\" height=\"12\"", "width=\"40\" height=\"40\"")}</span><span style="font-size:15px;font-weight:600">Ask for anything.</span><span style="max-width:34ch;font-size:12.5px;line-height:1.55;color:var(--text-muted)">Chronicle asks before Chronigirl touches your project.</span>'
    y = 110
    panes = (LABEL("warming · the session started when the project opened", 40, y - 26) + mini_pane(sw("warming", "neutral"), empty + f'<span style="font-size:11px;color:var(--text-faint)">Ready in a moment — you can type now</span>', 40, y, composer_disabled=False)
             + LABEL("ready · typically under 1.5 s after the project opened", 480, y - 26) + mini_pane(sw("ready", "success"), empty, 480, y, composer_disabled=False)
             + LABEL("starting · nothing was warm (first open, or after a stop)", 920, y - 26) + mini_pane(f'<span style="display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:var(--state-neutral)">{spinner(10)}starting</span>', empty + f'<span style="font-size:11px;color:var(--text-faint)">Starting the agent’s connector…</span>', 920, y, composer_disabled=True))
    # setup rows (the b_setup vocabulary)
    def icon_box(inner):
        return f'<span style="width:30px;height:30px;border-radius:8px;border:1px solid var(--border-hairline);background:var(--fill-subtle);display:flex;align-items:center;justify-content:center;color:var(--text-subtle);flex-shrink:0">{inner}</span>'
    def ready(word="ready"):
        return f'<span style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:var(--state-success);white-space:nowrap">{G["check"]}{word}</span>'
    def row(ic, name, blurb, state, action="", extra="", first=False):
        return f'<div style="display:flex;align-items:flex-start;gap:15px;padding:15px 0;{"" if first else "border-top:1px solid var(--divider)"}">{icon_box(ic)}<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:6px"><span style="font-size:13px;font-weight:500">{name}</span><span style="font-size:12px;line-height:1.45;color:var(--text-faint)">{blurb}</span>{extra}</div>{state}{action}</div>'
    def bigbtn(t, quiet=False, primary=False):
        st = "border:1px solid var(--border-hairline);color:var(--text-muted)" if quiet else ("background:var(--primary);color:var(--primary-fg);border:1px solid var(--primary)" if primary else "border:1px solid var(--border-strong);color:var(--text-primary)")
        return f'<button type="button" style="height:33px;padding:0 14px;border-radius:8px;{"" if primary else "background:transparent;"}{st};font-size:12.5px;font-weight:500;{SANS};white-space:nowrap;flex-shrink:0">{t}</button>'
    installing = f'<span style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:var(--state-neutral);white-space:nowrap">{dot("var(--state-neutral)", True)}installing</span>'
    progress = f'<div style="display:flex;align-items:center;gap:10px;margin-top:2px"><span style="flex:1;height:3px;border-radius:2px;background:var(--fill-hover)"><span style="display:block;width:52%;height:100%;border-radius:2px;background:var(--state-neutral)"></span></span>{mono("4.1 of 7.9 MB", "var(--text-subtle)", "11px")}</div>'
    failed = f'<span style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:var(--state-error);white-space:nowrap">{G["error"]}couldn’t finish</span>'
    keyform = f"""<div style="display:flex;flex-direction:column;gap:10px;margin-top:4px;padding:12px;border-radius:8px;border:1px solid var(--border-hairline);background:var(--surface-card)">
      <div style="display:flex;gap:2px;padding:2px;border-radius:8px;border:1px solid var(--border-hairline);align-self:flex-start">{''.join(f'<span style="height:24px;padding:0 10px;border-radius:6px;display:flex;align-items:center;font-size:11.5px;{"background:var(--fill-hover);color:var(--text-primary)" if i==0 else "color:var(--text-muted)"}">{t}</span>' for i,t in enumerate(["TypeSafe","OpenRouter"]))}</div>
      <label style="display:flex;flex-direction:column;gap:6px"><span style="font-size:11.5px;color:var(--text-muted)">Your TypeSafe key</span><span style="display:flex;align-items:center;height:33px;padding:0 10px;border-radius:8px;border:1px solid var(--border-field);background:var(--surface-input);{MONO};font-size:12px;color:var(--text-faint)">Paste it here</span></label>
      <div style="display:flex;align-items:center;gap:8px"><span style="font-size:11.5px;line-height:1.45;color:var(--text-faint);flex:1">Saved in your Keychain, never in the project.</span>{btn("Cancel", kind="ghost")}{btn("Save key", kind="primary")}</div>
    </div>"""
    nokey = f'<div style="margin-top:2px;display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:6px;background:var(--fill-subtle)"><span style="color:var(--text-subtle);display:flex">{G["spark"]}</span><span style="font-size:11.5px;line-height:1.5;color:var(--text-muted)">Without a key Chronicle answers these with Claude. Runs still work.</span></div>'
    rows_a = f'''<div style="display:flex;flex-direction:column;gap:2px"><div style="display:flex;align-items:baseline;gap:10px;padding-bottom:6px">{eyebrow("The agent’s connector · three states")}</div>
      {row(G["connector"], "The agent’s connector", "The small program Chronicle talks to the AI through. Installed once, so sessions start fast.", installing, bigbtn("Cancel", quiet=True), progress, first=True)}
      {row(G["connector"], "The agent’s connector", "The small program Chronicle talks to the AI through. Installed once, so sessions start fast.", ready())}
      {row(G["connector"], "The agent’s connector", "Couldn’t download it — check your internet connection and try again. Sessions still start, a little slower.", failed, bigbtn("Try again"))}
    </div>'''
    rows_b = f'''<div style="display:flex;flex-direction:column;gap:2px"><div style="display:flex;align-items:baseline;gap:10px;padding-bottom:6px">{eyebrow("Decisions · two states")}<span style="font-size:11.5px;color:var(--text-faint)">not counted in “ready”</span></div>
      {row(G["spark"], "Decisions", "A small, fast model answers the agent’s small questions during a run: may this command run, is this item really impossible, which lane broke the build. Only those questions leave your Mac — a command’s text, a line from the plan, a failing check’s output. Never your files.", f'<span style="font-size:12.5px;color:var(--text-muted)">optional</span>', "", keyform, first=True)}
      {row(G["spark"], "Decisions", "Only the agent’s small questions leave your Mac — a command’s text, a line from the plan, a failing check’s output. Never your files.", ready("key saved"), bigbtn("Remove key", quiet=True), nokey.replace("Without a key Chronicle answers these with Claude. Runs still work.", "Kept in your Keychain. Remove it and Chronicle answers these with Claude instead."))}
    </div>'''
    setup = f'''<div style="position:absolute;left:40px;top:550px;width:1360px;display:flex;gap:40px;align-items:flex-start">
  <div style="flex:1;min-width:0">{rows_a}</div>
  <div style="flex:1;min-width:0">{rows_b}</div>
</div>'''
    inner = LABEL("R6 · starting a session, and the two new Setup rows", 40, 28).replace("font-size:10.5px", "font-size:12px") + panes + setup
    return f'<div style="position:relative;width:1440px;height:1120px;overflow:hidden;background:var(--surface-app)">{inner}</div>'
boards["07-Start-and-setup.dc.html"] = ("R6 · session start states and the two Setup rows", b_start, "dark", 1440, 1120)

# ---------------------------------------------------------------- write
if __name__ == "__main__":
    os.makedirs(ROOT, exist_ok=True)
    layout, order = {}, []
    x = 0
    for name, spec in boards.items():
        title, fn, theme = spec[0], spec[1], spec[2]
        w, h = (spec[3], spec[4]) if len(spec) > 4 else (W, H)
        html = page(fn(), w=w, h=h, theme=theme)
        with open(os.path.join(ROOT, name), "w") as f:
            f.write(html)
        layout[name] = {"x": x, "y": 0, "w": w, "h": h, "title": title}
        order.append(name)
        x += w + 80
    canvas = {"v": 3, "createdOnFiles": {"v": 1, "at": "2026-10-14T13:30:00Z"}, "title": "Runs · Deck 10", "launch": {"view": "canvas"}, "pages": [], "boards": layout, "order": order,
              "notes": {"row1": {"x": 0, "y": -300, "text": "Runs · the card, a lane, the gate, needs-you, motion, session start", "kind": "title1", "maxW": x}}, "designSystems": []}
    with open(os.path.join(ROOT, "canvas.json"), "w") as f:
        json.dump(canvas, f, indent=1)
    print("\n".join(f"{n}  {os.path.getsize(os.path.join(ROOT, n))//1024} KB" for n in sorted(os.listdir(ROOT))))
