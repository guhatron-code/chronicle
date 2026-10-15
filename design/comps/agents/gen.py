#!/usr/bin/env python3
"""Agents and providers (spec 2026-10-15 §3-§9, §14). Two boards on the shipped chrome:
1 · Setup & health with the Your agent and Providers groups, 2 · the agent pane running Codex."""
import os, sys, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "runs"))
from gen import *  # the runs deck's chrome + chat-pane helpers (its boards only write under __main__)

ROOT = os.path.join(os.path.dirname(__file__), "project")
BW, BH1 = 1440, 1500

# ---------------------------------------------------------------- Setup vocabulary (from design-pane b_setup / runs b_start)
def icon_box(inner):
    return f'<span style="width:30px;height:30px;border-radius:8px;border:1px solid var(--border-hairline);background:var(--fill-subtle);display:flex;align-items:center;justify-content:center;color:var(--text-subtle);flex-shrink:0">{inner}</span>'
def ready(word="ready"):
    return f'<span style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:var(--state-success);white-space:nowrap">{G["check"]}{word}</span>'
def optional():
    return '<span style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:var(--text-muted);white-space:nowrap"><span style="width:6px;height:6px;border-radius:50%;border:1px solid var(--text-dim);box-sizing:border-box"></span>optional</span>'
def needs_you(word="needs you"):
    return f'<span style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:var(--state-warn);white-space:nowrap">{G["warn"]}{word}</span>'
def dimword(word):
    return f'<span style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:var(--text-dim);white-space:nowrap">{word}</span>'
def bigbtn(t, quiet=False):
    st = "border:1px solid var(--border-hairline);color:var(--text-muted)" if quiet else "border:1px solid var(--border-strong);color:var(--text-primary)"
    return f'<button type="button" style="height:33px;padding:0 14px;border-radius:8px;background:transparent;{st};font-size:12.5px;font-weight:500;{SANS};white-space:nowrap;flex-shrink:0">{t}</button>'
def row(ic, name, blurb, state, action="", extra="", first=False, dim=False, lead=""):
    op = "opacity:.55;" if dim else ""
    return f'<div style="display:flex;align-items:flex-start;gap:15px;padding:15px 0;{op}{"" if first else "border-top:1px solid var(--divider)"}">{lead}{icon_box(ic)}<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:6px"><span style="font-size:13px;font-weight:500">{name}</span><span style="font-size:12px;line-height:1.45;color:var(--text-faint)">{blurb}</span>{extra}</div>{state}{action}</div>'
def radio(on):
    inner = '<span style="width:6px;height:6px;border-radius:50%;background:var(--primary-fg)"></span>' if on else ""
    st = "background:var(--primary);border:1px solid var(--primary)" if on else "border:1px solid var(--border-strong)"
    return f'<span style="width:16px;height:16px;border-radius:50%;{st};display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:7px;box-sizing:border-box">{inner}</span>'
def mark(letter):
    return f'<span style="{MONO};font-size:12px;font-weight:600;color:var(--text-secondary)">{letter}</span>'
def group(title, note, body):
    return f'<div style="display:flex;flex-direction:column;gap:2px"><div style="display:flex;align-items:baseline;gap:10px;padding-bottom:6px">{eyebrow(title)}<span style="font-size:11.5px;color:var(--text-faint)">{note}</span></div>{body}</div>'
def select(label, value):
    return f'<span style="display:inline-flex;align-items:center;justify-content:space-between;gap:10px;height:33px;min-width:200px;padding:0 10px;border-radius:8px;border:1px solid var(--border-field);background:var(--surface-input);font-size:12.5px;color:var(--text-primary)"><span>{value}</span>{G["chevd"]}</span>'
def keyform(name, filled=False, sentence=""):
    field = f'<span style="{MONO};font-size:12px;color:var(--text-secondary)">ts-••••••••••••••••9c1e</span>' if filled else f'<span style="{MONO};font-size:12px;color:var(--text-faint)">Paste it here</span>'
    return f"""<div style="display:flex;flex-direction:column;gap:10px;margin-top:4px;padding:12px;border-radius:8px;border:1px solid var(--border-hairline);background:var(--surface-card)">
      <label style="display:flex;flex-direction:column;gap:6px"><span style="font-size:11.5px;color:var(--text-muted)">Your {name} key</span><span style="display:flex;align-items:center;height:33px;padding:0 10px;border-radius:8px;border:1px solid var(--border-field);background:var(--surface-input)">{field}</span></label>
      <div style="display:flex;align-items:center;gap:8px"><span style="font-size:11.5px;line-height:1.45;color:var(--text-faint);flex:1">Saved in your Keychain, never in the project.</span>{btn("Cancel", kind="ghost")}{btn("Save key", kind="primary")}</div>
    </div>"""
def leaves(text):
    return f'<div style="margin-top:2px;display:flex;align-items:flex-start;gap:8px;padding:8px 10px;border-radius:6px;background:var(--fill-subtle)"><span style="color:var(--text-subtle);display:flex;padding-top:2px">{G["spark"]}</span><span style="font-size:11.5px;line-height:1.5;color:var(--text-muted)">{text}</span></div>'

# ---------------------------------------------------------------- board 1
def b_setup():
    summary = f'<div style="display:flex;align-items:center;gap:15px;padding:12px 15px;border-radius:8px;border:1px solid var(--border-hairline);background:var(--surface-card)">{icon_box(CLAUDE_STAR)}<div style="flex:1;display:flex;flex-direction:column;gap:3px"><span style="font-size:13px;font-weight:500">Chronicle’s own tools</span><span style="font-size:12px;color:var(--text-faint)">Sign-in, its engine, your online home and 4 more</span></div>{ready("7 of 7 ready")}{G["chevd"]}</div>'
    connector = f'<div style="display:flex;align-items:center;gap:10px;margin:0 0 12px 61px;padding:9px 12px;border-radius:8px;border:1px solid var(--border-hairline);background:var(--surface-card)"><span style="color:var(--text-subtle);display:flex">{G["connector"]}</span><span style="font-size:12.5px;font-weight:500">Claude Code’s connector</span>{mono("0.90.1", "var(--text-subtle)", "11px")}<span style="flex:1;font-size:11.5px;color:var(--text-faint)">installed by Chronicle, kept up to date</span>{ready()}</div>'
    agents = "".join([
        row(CLAUDE_STAR, "Claude Code", "Anthropic’s agent. The default for new projects.", ready(), "", f'<span style="font-size:11.5px;color:var(--text-muted)">signed in</span>', first=True, lead=radio(True)),
        connector,
        row(mark("Cx"), "Codex", f'OpenAI’s agent. Installed. Sign in with {mono("codex login", "var(--text-secondary)", "11.5px")}', needs_you(), bigbtn("Sign in"), lead=radio(False)),
        row(mark("Gm"), "Gemini CLI", "Google’s agent. Not on this Mac yet.", dimword("missing"), bigbtn("Install"), lead=radio(False)),
        row(mark("Oc"), "OpenCode", "An open-source agent. Didn’t pass Chronicle’s check on this Mac.", dimword("not yet supported"), "", dim=True, lead=radio(False)),
    ])
    roles = f'''<div style="display:flex;flex-direction:column;gap:10px;padding:6px 0 14px">
      <div style="display:flex;align-items:center;gap:15px"><div style="flex:1;display:flex;flex-direction:column;gap:3px"><span style="font-size:13px;font-weight:500">Review</span><span style="font-size:12px;color:var(--text-faint)">Who looks over a design or a round’s result.</span></div>{select("Review", "with your agent")}</div>
      <div style="display:flex;align-items:center;gap:15px"><div style="flex:1;display:flex;flex-direction:column;gap:3px"><span style="font-size:13px;font-weight:500">Decisions</span><span style="font-size:12px;color:var(--text-faint)">Who answers the agent’s small questions during a run.</span></div>{select("Decisions", "TypeSafe")}</div>
      {leaves("Review with your agent sends nothing new: it rides the agent you already chose. A provider receives only the text of what it is asked to review.")}
    </div>'''
    sentence = "Only the agent’s small questions leave your Mac — a command’s text, a line from the plan, a failing check’s output. Never your files."
    provs = "".join([
        row(CLAUDE_STAR if False else G["agent"], "Your agent", "No key needed — it rides your sign-in.", ready(), "", first=True),
        row(mark("An"), "Anthropic", "Claude models, with your own key.", optional(), bigbtn("Add key")),
        row(mark("Oa"), "OpenAI", "GPT models, with your own key.", optional(), bigbtn("Add key")),
        row(mark("Or"), "OpenRouter", "Many models through one key.", ready("key saved"), bigbtn("Remove key", quiet=True)),
        row(G["spark"], "TypeSafe", "A small, fast model for the agent’s small questions.", ready("key saved"), bigbtn("Remove key", quiet=True), keyform("TypeSafe", filled=True) + leaves(sentence)),
        row(mark("Lo"), "Local", f'A model running on this Mac, at an address like {mono("http://localhost:11434", "var(--text-secondary)", "11.5px")}', optional(), bigbtn("Add address")),
    ])
    inner = f"""<div style="height:44px;display:flex;align-items:center;gap:12px;padding:0 14px;border-bottom:1px solid var(--divider);box-sizing:border-box">{lights()}<span style="flex:1"></span><span style="height:26px;padding:0 10px;border-radius:6px;display:flex;align-items:center;font-size:11.5px;color:var(--text-muted)">Done</span></div>
<div style="height:{BH1-44}px;overflow:hidden;display:flex;justify-content:center">
  <div style="width:640px;padding:24px 32px;display:flex;flex-direction:column;gap:14px;box-sizing:content-box">
    <div style="display:flex;flex-direction:column;gap:6px"><span style="font-size:20px;font-weight:600">Setup &amp; health</span><span style="font-size:12.5px;line-height:1.6;color:var(--text-muted);max-width:46ch">Everything Chronicle needs, in one place. Open this any time something stops working and re-check.</span></div>
    {summary}
    {group("Your agent", "the one that works in your projects", agents)}
    {group("Providers", "who answers when it isn’t your agent", roles + provs)}
  </div>
</div>"""
    return inner

# ---------------------------------------------------------------- board 2
def codex_tile(size=26, fs=10.5):
    return f'<span style="width:{size}px;height:{size}px;border-radius:50%;border:1px solid var(--border-hairline);background:var(--surface-card-raised);display:flex;align-items:center;justify-content:center;flex-shrink:0;{MONO};font-size:{fs}px;font-weight:600;color:var(--text-secondary)">Cx</span>'

def codex_msg(body):
    return f'<div style="display:flex;gap:10px;padding:8px 14px"><div>{codex_tile()}</div><div style="flex:1;min-width:0"><div style="font-size:12.5px;font-weight:600;margin-bottom:2px">Codex</div><div style="font-size:13px;line-height:1.65;color:var(--text-primary);text-wrap:pretty">{body}</div></div></div>'

def permission_card():
    return f'''<div style="margin:6px 14px;border-radius:8px;border:1px solid var(--border-strong);background:var(--surface-card);padding:11px 12px;display:flex;flex-direction:column;gap:10px">
  <div style="display:flex;align-items:center;gap:8px"><span style="color:var(--state-warn);display:flex">{G["warn"]}</span><span style="font-size:12.5px;line-height:1.5">Codex wants to run {mono("npm test", "var(--text-secondary)", "11.5px")}</span></div>
  <div style="font-size:11.5px;color:var(--text-faint)">It runs the project’s checks. Nothing is written outside the project.</div>
  <div style="display:flex;gap:8px">{chat_btn("Allow once", "primary")}{chat_btn("Always")}{chat_btn("Deny", "danger")}</div>
</div>'''

def codex_composer():
    chip_st = "display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 8px;border-radius:8px;border:1px solid var(--border-hairline);font-size:11.5px;color:var(--text-muted)"
    return f'''<div style="margin:8px 12px 12px;border-radius:10px;border:1px solid var(--border-field);background:var(--surface-input)">
  <div style="padding:10px 12px;font-size:13px;color:var(--text-faint);min-height:40px">Ask for anything</div>
  <div style="display:flex;align-items:center;gap:6px;padding:0 8px 8px">
    <span style="width:26px;height:26px;display:flex;align-items:center;justify-content:center;color:var(--text-faint)">{G["attach"]}</span>
    <span style="{chip_st};color:var(--text-primary);border-color:var(--border-strong)">{codex_tile(16, 8)}Codex {G["chevd"]}</span>
    <span style="{chip_st}">Ask first {G["chevd"]}</span>
    <span style="flex:1"></span>
    <span style="width:28px;height:28px;border-radius:8px;background:var(--primary);color:var(--primary-fg);display:flex;align-items:center;justify-content:center">{G["arrowup"]}</span>
  </div>
</div>'''

def codex_header(status):
    return f'''<div style="height:40px;display:flex;align-items:center;gap:8px;padding:0 12px 0 14px;border-bottom:1px solid var(--border-hairline);box-sizing:border-box;flex-shrink:0">
    {codex_tile(20, 9)}<span style="font-size:12.5px;font-weight:600">Codex</span>{status}<span style="flex:1"></span>
    {mono("$0.42 · 1m 38s", "var(--text-faint)")}
    <span style="width:26px;height:26px;display:flex;align-items:center;justify-content:center;color:var(--text-faint)">{G["clock"]}</span>
  </div>'''

def banner_frame(x, y):
    body = f'''<div style="margin:12px;padding:14px;border-radius:10px;border:1px solid var(--border-strong);background:var(--surface-card);display:flex;flex-direction:column;gap:10px">
  <div style="display:flex;align-items:center;gap:8px">{codex_tile(20, 9)}<span style="font-size:13px;font-weight:600">Codex needs you to sign in</span>{needs_you()}</div>
  <div style="font-size:12px;line-height:1.55;color:var(--text-muted)">Run this once, then come back. Chronicle notices on its own.</div>
  <div style="display:flex;align-items:center;height:33px;padding:0 10px;border-radius:8px;background:var(--surface-input);border:1px solid var(--border-field)">{mono("codex login", "var(--text-primary)", "12px")}</div>
  <div style="display:flex;gap:8px">{bigbtn("Open a terminal")}{bigbtn("Check again", quiet=True)}</div>
</div>'''
    comp = codex_composer().replace("Ask for anything", "Sign in to ask Codex").replace("color:var(--text-faint);min-height", "color:var(--text-dimmer);min-height")
    return f'''<div style="position:absolute;left:{x}px;top:{y}px;width:420px;border-radius:10px;border:1px solid var(--border-hairline);background:var(--surface-panel);display:flex;flex-direction:column;overflow:hidden">
  {codex_header(needs_you())}{body}{comp}
</div>'''

boards = {}
boards["01-Setup-agents-providers.dc.html"] = ("1 · Setup & health — Your agent and Providers", b_setup, "dark", BW, BH1)

def b_codex_board():
    thread = (chat_msg("Make the notes list keep its scroll position when a note is saved.", you=True)
        + codex_msg("The list re-mounts on every save, which resets its scroll. I’ll keep the scroller outside the keyed subtree and run the tests.")
        + tool_card("Read", "src/panes/notes/NotesList.tsx")
        + tool_card("Edit", "src/panes/notes/NotesList.tsx")
        + tool_card("Bash", "git diff --stat")
        + permission_card())
    pane = f'''<div style="width:{PANE_W}px;flex-shrink:0;display:flex;flex-direction:column;border-left:1px solid var(--border-hairline);box-sizing:border-box;background:var(--surface-panel)">
  {codex_header(sw("working", "neutral"))}
  <div style="flex:1;overflow:hidden;padding:6px 0;display:flex;flex-direction:column;justify-content:flex-end;gap:4px">{thread}</div>
  {codex_composer()}
</div>'''
    base = board_shell(notes_pane(notes_round_card()) + pane, sel="notes")
    over = LABEL("sign-in banner · when Codex isn’t signed in yet", 456, 390) + banner_frame(456, 418) + LABEL("working · a flat tool list, then a permission card", 940, 340)
    return f'<div style="position:relative;width:{W}px;height:{H}px;overflow:hidden">{base}{over}</div>'

boards["02-Pane-on-codex.dc.html"] = ("2 · The agent pane running Codex", b_codex_board, "dark", W, H)

if __name__ == "__main__":
    os.makedirs(ROOT, exist_ok=True)
    layout, order, x = {}, [], 0
    for name, (title, fn, theme, w, h) in boards.items():
        open(os.path.join(ROOT, name), "w").write(page(fn(), w=w, h=h, theme=theme))
        layout[name] = {"x": x, "y": 0, "w": w, "h": h, "title": title}; order.append(name); x += w + 80
    json.dump({"v": 3, "createdOnFiles": {"v": 1, "at": "2026-10-15T12:00:00Z"}, "title": "Agents and providers", "launch": {"view": "canvas"}, "pages": [], "boards": layout, "order": order, "notes": {}, "designSystems": []}, open(os.path.join(ROOT, "canvas.json"), "w"), indent=1)
    print("\n".join(boards))
