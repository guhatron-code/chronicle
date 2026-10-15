#!/usr/bin/env python3
"""The roadmap pane's first-open screen, redrawn. Three boards on the shipped chrome:
A · a quiet invitation, B · the roadmap ghosted in with the action where the current
phase will sit, C · the same screen while the roadmap is being written."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "runs"))
from gen import *  # the runs deck's chrome + chat-pane helpers (its boards only write under __main__)

ROOT = os.path.join(os.path.dirname(__file__), "project")

def btn_primary(label, size="md"):
    return btn(label, kind="primary", size=size)

def link(t, dim=False):
    col = "var(--text-dim)" if dim else "var(--text-secondary)"
    return f'<span style="font-size:12px;color:{col};text-decoration:underline;text-underline-offset:3px;text-decoration-color:var(--border-strong)">{t}</span>'

def agent_chip(name="Claude"):
    return f'<span style="display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 9px 0 7px;border-radius:8px;border:1px solid var(--border-hairline);font-size:11.5px;color:var(--text-muted)">{CLAUDE_STAR}with {name}{G["chevd"]}</span>'

def history(rows=None):
    rows = rows or [("Last save", "2 minutes ago", "scratch"), ("Uncommitted", "1 file", ""), ("Remote", "not on GitHub", ""), ("Last publish", "never published", "")]
    r = "".join(f'<div style="display:flex;align-items:center;gap:14px;height:46px;border-top:1px solid var(--divider)"><span style="width:14px;display:flex;color:var(--text-subtle)">{G["clock"] if i==0 else (G["check"] if i==1 else G["export"])}</span><span style="width:120px;font-size:13px;color:var(--text-muted)">{k}</span><span style="font-size:13px;color:var(--text-primary)">{v}</span>{mono(m, "var(--text-faint)", "11px") if m else ""}</div>' for i,(k,v,m) in enumerate(rows))
    return f'<div style="display:flex;flex-direction:column"><div style="font-size:15px;font-weight:600;padding-bottom:6px">Project history</div>{r}<div style="margin-top:10px;height:40px;border-radius:8px;border:1px solid var(--border-hairline);display:flex;align-items:center;justify-content:center;font-size:12.5px;color:var(--text-secondary)">View details ›</div></div>'

def needs_you_github():
    return f'''<div style="display:flex;flex-direction:column;gap:10px"><div style="font-size:15px;font-weight:600">What needs you</div>
<div style="display:flex;align-items:center;gap:14px;padding:14px 16px;border-radius:10px;border:1px solid var(--border-hairline);background:var(--surface-card)">
  <span style="width:36px;height:36px;border-radius:8px;border:1px solid var(--border-hairline);background:var(--fill-subtle);display:flex;align-items:center;justify-content:center;color:var(--text-subtle)">{G["export"]}</span>
  <div style="flex:1;display:flex;flex-direction:column;gap:4px"><div style="display:flex;align-items:center;gap:8px"><span style="font-size:13.5px;font-weight:500">Put this project on GitHub</span>{chip("Next up")}</div><span style="font-size:12.5px;color:var(--text-muted)">It has no online home yet. Chronicle creates a private repo under your account and publishes.</span></div>
  {btn("Put it on GitHub", kind="primary", size="md")}
</div></div>'''

def content(inner, pad="28px 36px"):
    return f'<div style="flex:1;min-width:0;display:flex;flex-direction:column;padding:{pad};gap:34px;overflow:hidden;max-width:980px">{inner}</div>'

def pane_empty():
    body = f'<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:9px;padding:20px;text-align:center"><span style="margin-bottom:4px">{CLAUDE_STAR.replace("width=\"12\" height=\"12\"", "width=\"40\" height=\"40\"")}</span><span style="font-size:15px;font-weight:600">Ask for anything.</span><span style="max-width:34ch;font-size:12.5px;line-height:1.55;color:var(--text-muted)">Chronicle asks before Chronigirl touches your project.</span></div>'
    return agent_pane(body, status=sw("ready", "success"), cost="$0.00", width=460, bottom=False)

# ---- A · the quiet invitation
def b_quiet():
    invite = f'''<div style="display:flex;flex-direction:column;gap:14px;padding:6px 0 2px">
  {eyebrow("Roadmap")}
  <div style="font-size:22px;font-weight:600;letter-spacing:-.01em;line-height:1.25;max-width:30ch">Let me map this project.</div>
  <div style="font-size:13.5px;line-height:1.65;color:var(--text-muted);max-width:52ch">I read the files in this folder and write its roadmap: the phases, where you are now, and what needs you. Nothing else changes.</div>
  <div style="display:flex;align-items:center;gap:12px;padding-top:4px">{btn_primary("Write the roadmap")}{agent_chip()}</div>
  <div style="display:flex;align-items:center;gap:14px">{link("Copy the instructions instead")}{link("Use the basic view", dim=True)}</div>
</div>'''
    return board_shell(content(invite + history() + needs_you_github()) + pane_empty(), sel="road")
boards["01-Quiet-invitation.dc.html"] = ("A · the quiet invitation", b_quiet, "dark")

# ---- B · the roadmap, ghosted
def ghost(w="100%", h="14px", extra=""):
    return f'<span style="display:block;width:{w};height:{h};border-radius:4px;background:var(--fill-subtle);{extra}"></span>'

def phase_ghost(n, name, state, cur=False):
    col = "var(--text-secondary)" if cur else "var(--text-dim)"
    bg = "border:1px solid var(--border-strong);background:var(--surface-card)" if cur else "border:1px dashed var(--border-hairline)"
    return f'<div style="flex:1;display:flex;flex-direction:column;gap:8px;padding:12px 14px;border-radius:10px;{bg};opacity:{1 if cur else .6}">{mono(n, "var(--text-faint)", "10.5px")}<span style="font-size:13px;font-weight:500;color:{col}">{name}</span><span style="font-size:11.5px;color:var(--text-dim)">{state}</span></div>'

def b_ghost(writing=False):
    if not writing:
        banner_body = f'''<div style="display:flex;flex-direction:column;gap:12px">
  <div style="font-size:20px;font-weight:600;letter-spacing:-.01em;line-height:1.25">Your current phase will sit here.</div>
  <div style="font-size:13.5px;line-height:1.65;color:var(--text-muted);max-width:54ch">I read the files in this folder and write the roadmap: the phases, where you are now, and what needs you. Nothing else changes.</div>
  <div style="display:flex;align-items:center;gap:12px;padding-top:2px">{btn_primary("Write the roadmap")}{agent_chip()}<span style="flex:1"></span>{link("Copy the instructions instead")}</div>
</div>'''
        rail_phases = phase_ghost("1", "First phase", "up next, once the roadmap is written", cur=True) + phase_ghost("2", "Second phase", "later") + phase_ghost("3", "Third phase", "later")
        needs = f'<div style="display:flex;flex-direction:column;gap:10px"><div style="display:flex;align-items:baseline;gap:10px"><span style="font-size:15px;font-weight:600">What needs you</span><span style="font-size:11.5px;color:var(--text-faint)">fills in as the roadmap is written</span></div><div style="height:72px;border-radius:10px;border:1px dashed var(--border-hairline);display:flex;align-items:center;padding:0 16px;gap:14px;opacity:.6">{ghost("36px","36px","border-radius:8px")}<div style="flex:1;display:flex;flex-direction:column;gap:8px">{ghost("38%")}{ghost("62%","10px")}</div></div></div>'
        status = sw("ready", "success")
    else:
        banner_body = f'''<div style="display:flex;flex-direction:column;gap:12px">
  <div style="display:flex;align-items:center;gap:10px"><span style="font-size:20px;font-weight:600;letter-spacing:-.01em;line-height:1.25">Writing the roadmap</span>{sw("working", "neutral", size="12px")}</div>
  <div style="font-size:13.5px;line-height:1.65;color:var(--text-muted);max-width:54ch">Read 42 files. Found a plan and a prompt in the docs folder; three phases so far. Usually a minute or two.</div>
  <div style="height:3px;border-radius:2px;background:var(--fill-hover);max-width:420px"><span style="display:block;width:46%;height:100%;border-radius:2px;background:var(--state-neutral)"></span></div>
  <div style="display:flex;align-items:center;gap:12px">{chat_btn("Stop", "quiet")}<span style="font-size:11.5px;color:var(--text-faint)">You can keep using the rest of Chronicle meanwhile.</span></div>
</div>'''
        rail_phases = phase_ghost("M0", "Plan sign-off", "set up the repo first", cur=True) + phase_ghost("M1", "The attention model runs", "later") + phase_ghost("3", "…", "being written")
        needs = f'<div style="display:flex;flex-direction:column;gap:10px"><div style="display:flex;align-items:baseline;gap:10px"><span style="font-size:15px;font-weight:600">What needs you</span></div><div style="display:flex;align-items:center;gap:14px;padding:14px 16px;border-radius:10px;border:1px solid var(--border-hairline);background:var(--surface-card)"><span style="width:36px;height:36px;border-radius:8px;border:1px solid var(--border-hairline);background:var(--fill-subtle);display:flex;align-items:center;justify-content:center;color:var(--text-subtle)">{G["repo"]}</span><div style="flex:1;display:flex;flex-direction:column;gap:4px"><div style="display:flex;align-items:center;gap:8px"><span style="font-size:13.5px;font-weight:500">Make this folder a git repo</span>{chip("From the roadmap · review before running")}</div><span style="font-size:12.5px;color:var(--text-muted)">Chronicle follows the build through its saves, and the kickoff expects one.</span></div>{btn("Execute…", kind="secondary", size="md")}</div></div>'
        status = sw("working", "neutral")
    banner = f'<div style="display:flex;flex-direction:column;gap:14px">{eyebrow("Current state")}{banner_body}</div>'
    rail_block = f'<div style="display:flex;flex-direction:column;gap:10px"><div style="display:flex;align-items:baseline;gap:10px"><span style="font-size:15px;font-weight:600">Phases</span><span style="font-size:11.5px;color:var(--text-faint)">{"as the roadmap finds them" if not writing else "3 so far"}</span></div><div style="display:flex;gap:10px">{rail_phases}</div></div>'
    pane = pane_empty() if not writing else agent_pane(
        chat_msg("Write the roadmap for this folder.", you=True) + chat_msg("Reading the folder. There is a plan and a kickoff prompt under docs/; I’ll turn those into phases and check them against git.") + tool_card("Read", "docs/eyes-v1-plan.md") + tool_card("Read", "docs/eyes-v1-claude-code-prompt.md") + tool_card("Bash", "git log --oneline | head -40", st="run"),
        status=sw("working", "neutral"), cost="$0.12 · 0m 41s", width=460, bottom=False, composer=chat_composer(placeholder="Ask for anything"))
    return board_shell(content(banner + rail_block + needs + history()) + pane, sel="road")
boards["02-Ghosted-roadmap.dc.html"] = ("B · the roadmap ghosted in, the action where the current phase will sit", b_ghost, "dark")
boards["03-Writing.dc.html"] = ("C · while the roadmap is being written", lambda: b_ghost(writing=True), "dark")

if __name__ == "__main__":
    import json
    os.makedirs(ROOT, exist_ok=True)
    mine = ["01-Quiet-invitation.dc.html", "02-Ghosted-roadmap.dc.html", "03-Writing.dc.html"]
    layout, order, x = {}, [], 0
    for name in mine:
        title, fn, theme = boards[name]
        open(os.path.join(ROOT, name), "w").write(page(fn(), theme=theme))
        layout[name] = {"x": x, "y": 0, "w": W, "h": H, "title": title}; order.append(name); x += W + 80
    json.dump({"v": 3, "createdOnFiles": {"v": 1, "at": "2026-10-15T00:50:00Z"}, "title": "Roadmap · first open", "launch": {"view": "canvas"}, "pages": [], "boards": layout, "order": order, "notes": {}, "designSystems": []}, open(os.path.join(ROOT, "canvas.json"), "w"), indent=1)
    print("\n".join(mine))
