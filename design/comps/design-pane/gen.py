#!/usr/bin/env python3
"""Generates the Design pane comps as .dc.html artboards + canvas.json.
Shared Chronicle chrome is composed here so every board matches; light-theme
boards are the same markup under the light token class."""
import json, os

ROOT = os.path.join(os.path.dirname(__file__), "project")
W, H = 1440, 900

# ---------------------------------------------------------------- tokens
DARK = """--surface-app:#0a0a0a;--surface-panel:#0d0d0d;--surface-sidebar:#131313;--surface-card:#101010;--surface-card-raised:#111111;--surface-input:#0b0b0b;--surface-overlay:#161616;
--text-primary:#ededed;--text-secondary:#cfcfcf;--text-muted:#9a9a9a;--text-subtle:#8a8a8a;--text-faint:#7e7e7e;--text-dim:#6e6e6e;--text-dimmer:#5a5a5a;
--border-hairline:rgba(255,255,255,.08);--border-strong:rgba(255,255,255,.12);--border-field:rgba(255,255,255,.09);--divider:rgba(255,255,255,.055);
--fill-hover:rgba(255,255,255,.06);--fill-subtle:rgba(255,255,255,.03);--primary:#ededed;--primary-fg:#0a0a0a;--selected-bg:#ffffff;--selected-fg:#0a0a0a;
--state-success:#7fae8a;--state-error:#cf8a86;--state-neutral:#9a9a9a;--state-warn:#d4b06a;--shadow-overlay:0 16px 40px rgba(0,0,0,.5);
--canvas-dot:rgba(255,255,255,.07);--frame-shadow:0 0 0 1px rgba(255,255,255,.06);--mark-1:#7c8a6b;"""
LIGHT = """--surface-app:#e9e9ec;--surface-panel:#ffffff;--surface-sidebar:#f4f4f6;--surface-card:#ffffff;--surface-card-raised:#ffffff;--surface-input:#f5f5f7;--surface-overlay:#ffffff;
--text-primary:#161616;--text-secondary:#363636;--text-muted:#5c5c5c;--text-subtle:#6e6e6e;--text-faint:#737373;--text-dim:#6b6b6b;--text-dimmer:#6e6e6e;
--border-hairline:rgba(0,0,0,.1);--border-strong:rgba(0,0,0,.15);--border-field:rgba(0,0,0,.12);--divider:rgba(0,0,0,.07);
--fill-hover:rgba(0,0,0,.045);--fill-subtle:rgba(0,0,0,.03);--primary:#1a1a1a;--primary-fg:#ffffff;--selected-bg:#161616;--selected-fg:#ffffff;
--state-success:#3f7d57;--state-error:#b3534d;--state-neutral:#6e6e6e;--state-warn:#8a6a1f;--shadow-overlay:0 12px 32px rgba(0,0,0,.12);
--canvas-dot:rgba(0,0,0,.09);--frame-shadow:0 1px 3px rgba(0,0,0,.08),0 8px 24px rgba(0,0,0,.06);--mark-1:#7c8a6b;"""

HELMET = """<helmet>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&amp;family=Geist+Mono:wght@400;500&amp;family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700&amp;family=IBM+Plex+Sans:wght@400;500;600&amp;display=swap">
  <style>
    body { margin: 0; background: #060606; }
    .t-dark { %s }
    .t-light { %s }
    a { color: var(--text-secondary); text-decoration: none; }
    a:hover { color: var(--text-primary); }
    @keyframes wv-pulse { 0%%,100%% { opacity: 1; } 50%% { opacity: .35; } }
    @keyframes wv-spin { to { transform: rotate(360deg); } }
    @keyframes shimmer { 0%% { opacity: .5; } 50%% { opacity: 1; } 100%% { opacity: .5; } }
    @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
  </style>
</helmet>""" % (DARK.replace("\n", ""), LIGHT.replace("\n", ""))

SANS = "font-family:'Geist',system-ui,-apple-system,sans-serif"
MONO = "font-family:'Geist Mono',ui-monospace,'SF Mono',monospace"

def page(body, w=W, h=H, theme="dark"):
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
{HELMET}
<div class="t-{theme}" style="width:{w}px;height:{h}px;box-sizing:border-box;overflow:hidden;position:relative;background:var(--surface-app);color:var(--text-primary);{SANS};font-size:12.5px;-webkit-font-smoothing:antialiased">
{body}
</div>
</x-dc>
<script data-dc-script data-props='{{"$preview":{{"width":{w},"height":{h}}}}}'>
class Component extends DCLogic {{
  renderVals() {{ return {{}}; }}
}}
</script>
</body>
</html>
"""

# ---------------------------------------------------------------- glyphs
def svg(inner, size=15, vb="0 0 16 16", sw="1.5", extra=""):
    return f'<svg width="{size}" height="{size}" viewBox="{vb}" fill="none" stroke="currentColor" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" {extra}>{inner}</svg>'

G = {
 "road": svg('<path d="M3 3v7.5M3 3c1.5 0 2 1 4 1s2.5-1 4-1 2 1 2 1v7.5s-.5-1-2-1-2.5 1-4 1-2.5-1-4-1"></path><path d="M3 13.5v-3"></path>'),
 "repo": svg('<circle cx="5" cy="4" r="1.8"></circle><circle cx="5" cy="12" r="1.8"></circle><circle cx="11" cy="8" r="1.8"></circle><path d="M5 5.8v4.4M6.8 11.3c2.4-.4 4.2-1.1 4.2-3.3v-.2"></path>'),
 "notes": svg('<path d="M6 3h9l4 4v14H6zM15 3v4h4M9 12h6M9 16h6"></path>', vb="0 0 24 24", sw="1.6"),
 "web": svg('<circle cx="8" cy="8" r="6"></circle><path d="M2 8h12M8 2c2 2.2 2 9.8 0 12M8 2c-2 2.2-2 9.8 0 12"></path>', sw="1.4"),
 "design": svg('<path d="M4.5 1.5v3h-3M11.5 1.5v3h3M4.5 14.5v-3h-3M11.5 14.5v-3h3"></path><rect x="6" y="6" width="4" height="4" rx=".6"></rect>', sw="1.4"),
 "pulse": svg('<path d="M1.8 8h2.4l1.3 3.4 2.4-7 1.3 3.6h3"></path>', sw="1.4"),
 "refresh": svg('<path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.8v3h-3"></path>', size=14),
 "plus": svg('<path d="M7 2.5v9M2.5 7h9"></path>', size=13, vb="0 0 14 14"),
 "search": svg('<circle cx="6" cy="6" r="4.2"></circle><path d="M9.4 9.4 12.5 12.5"></path>', size=13, vb="0 0 14 14"),
 "check": svg('<path d="M2 6.5 5 9.5 10 3"></path>', size=11, vb="0 0 12 12", sw="1.6"),
 "error": svg('<circle cx="6" cy="6" r="5"></circle><path d="M6 3.4v3M6 8.4v.1"></path>', size=12, vb="0 0 12 12"),
 "help": svg('<circle cx="8" cy="8" r="6"></circle><path d="M6.2 6.2c.2-1 1-1.6 1.9-1.6 1 0 1.9.7 1.9 1.7 0 1.3-1.9 1.4-1.9 2.7M8 11.4v.1"></path>', size=14),
 "chev": svg('<path d="M6 4l4 4-4 4"></path>', size=11),
 "chevd": svg('<path d="M4 6l4 4 4-4"></path>', size=11),
 "x": svg('<path d="m1.5 1.5 7 7M8.5 1.5l-7 7"></path>', size=9, vb="0 0 10 10"),
 "hand": svg('<path d="M5.5 8V3.5a1 1 0 0 1 2 0V7M7.5 7V2.5a1 1 0 0 1 2 0V7M9.5 7V3.5a1 1 0 0 1 2 0v5c0 3-2 5-4.5 5S3 12 2.5 10L1.8 7.8a1 1 0 0 1 1.8-.8L5.5 9.5"></path>', size=14, sw="1.3"),
 "cursor": svg('<path d="M3 2l10 5-4.3 1.2L7 13z"></path>', size=14, sw="1.3"),
 "comment": svg('<path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"></path>', size=14, sw="1.3"),
 "fit": svg('<path d="M2 5.5V2h3.5M10.5 2H14v3.5M14 10.5V14h-3.5M5.5 14H2v-3.5"></path>', size=14, sw="1.3"),
 "clock": svg('<circle cx="8" cy="8" r="6"></circle><path d="M8 4.5V8l2.3 1.6"></path>', size=14, sw="1.3"),
 "score": svg('<path d="M2.5 13.5h11M4 11V8M7 11V4.5M10 11V6.5M13 11V3"></path>', size=14, sw="1.4"),
 "system": svg('<circle cx="5" cy="5" r="2.5"></circle><circle cx="11" cy="5" r="2.5"></circle><circle cx="5" cy="11" r="2.5"></circle><rect x="8.5" y="8.5" width="5" height="5" rx="1"></rect>', size=14, sw="1.3"),
 "export": svg('<path d="M8 10V2.5M5 5.5l3-3 3 3M3 9.5V13h10V9.5"></path>', size=14, sw="1.4"),
 "attach": svg('<path d="M11 6.5 6.8 10.7a1.8 1.8 0 0 1-2.5-2.5l4.6-4.6a3 3 0 0 1 4.2 4.2L8.4 12.5"></path>', size=13, sw="1.3"),
 "arrowup": svg('<path d="M8 13V3M4 7l4-4 4 4"></path>', size=13, sw="1.6"),
 "image": svg('<rect x="2" y="3" width="12" height="10" rx="1.5"></rect><circle cx="6" cy="6.5" r="1.2"></circle><path d="m2.5 12 3.5-3.5 2.5 2.5 2-2 3 3"></path>', size=14, sw="1.3"),
 "deck": svg('<rect x="2" y="3" width="12" height="8" rx="1"></rect><path d="M8 11v2.5M5.5 13.5h5"></path>', size=14, sw="1.3"),
 "brand": svg('<circle cx="8" cy="8" r="5.5"></circle><path d="M8 2.5v11M2.5 8h11"></path>', size=14, sw="1.3"),
 "bag": svg('<path d="M3 5.5h10l-.8 8H3.8z"></path><path d="M5.8 5.5V4.3a2.2 2.2 0 0 1 4.4 0v1.2"></path>', size=14, sw="1.3"),
 "screen": svg('<rect x="1.8" y="2.5" width="12.4" height="9" rx="1.2"></rect><path d="M5.5 14h5"></path>', size=14, sw="1.3"),
 "megaphone": svg('<path d="M2.5 6.5v3h2l5 3v-9l-5 3zM12 5.5a3.5 3.5 0 0 1 0 5"></path>', size=14, sw="1.3"),
 "restore": svg('<path d="M2.8 8a5.2 5.2 0 1 0 1.6-3.7M2.5 2.5v2.8h2.8"></path>', size=13, sw="1.4"),
 "key": svg('<circle cx="5.5" cy="10.5" r="3"></circle><path d="m7.6 8.4 5.9-5.9M11.5 4.5l1.5 1.5"></path>', size=14, sw="1.3"),
 "link": svg('<path d="M6.5 9.5 9.5 6.5M7 4.5l1.2-1.2a2.5 2.5 0 0 1 3.5 3.5L10.5 8M9 11.5l-1.2 1.2a2.5 2.5 0 0 1-3.5-3.5L5.5 8"></path>', size=13, sw="1.4"),
 "wand": svg('<path d="m2.5 13.5 8-8M9 4l1-1 3 3-1 1M12 1.5v1.5M14.5 4H13M3.5 3v2M2.5 4h2"></path>', size=14, sw="1.3"),
}
KIND_ICON = {"App UI": "screen", "Marketing": "megaphone", "Deck": "deck", "Brand": "brand", "E-commerce": "bag"}

CLAUDE_STAR = '<svg width="12" height="12" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="46" fill="#D97757"></circle><path d="M50 18v64M18 50h64M27 27l46 46M73 27 27 73" stroke="#141413" stroke-width="7" stroke-linecap="round"></path></svg>'

def eyebrow(t, extra=""):
    return f'<span style="font-size:10px;text-transform:uppercase;letter-spacing:.09em;color:var(--text-faint);{extra}">{t}</span>'

def kbd(t):
    return f'<span style="border-radius:5px;background:var(--fill-subtle);padding:1px 5px;{MONO};font-size:10.5px;color:var(--text-faint)">{t}</span>'

def btn(label, kind="secondary", size="sm", icon="", extra=""):
    h = {"sm": "28px", "md": "33px", "lg": "36px"}[size]
    fs = {"sm": "11.5px", "md": "12.5px", "lg": "13px"}[size]
    if kind == "primary":
        st = "background:var(--primary);color:var(--primary-fg);border:1px solid var(--primary)"
    elif kind == "ghost":
        st = "background:transparent;color:var(--text-secondary);border:1px solid transparent"
    elif kind == "danger":
        st = "background:transparent;color:var(--state-error);border:1px solid var(--border-hairline)"
    else:
        st = "background:transparent;color:var(--text-primary);border:1px solid var(--border-strong)"
    return f'<button type="button" style="display:inline-flex;align-items:center;gap:6px;height:{h};padding:0 11px;border-radius:8px;{st};font-size:{fs};font-weight:500;{SANS};cursor:default;white-space:nowrap;{extra}">{icon}{label}</button>'

def dot(color, pulse=False):
    anim = "animation:wv-pulse 1.6s ease-in-out infinite;" if pulse else ""
    return f'<span style="width:5px;height:5px;border-radius:50%;background:{color};flex-shrink:0;{anim}"></span>'

def state_word(word, tone):
    col = {"success": "var(--state-success)", "error": "var(--state-error)", "warn": "var(--state-warn)", "neutral": "var(--state-neutral)"}[tone]
    return f'<span style="display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:{col}">{dot(col, tone=="neutral")}{word}</span>'

def chip(t, mono=False, extra=""):
    f = MONO + ";font-size:10.5px" if mono else "font-size:11px"
    return f'<span style="display:inline-flex;align-items:center;gap:5px;height:20px;padding:0 7px;border-radius:6px;background:var(--fill-subtle);color:var(--text-subtle);{f};white-space:nowrap;{extra}">{t}</span>'

def score_chip(v, passed=True):
    col = "var(--state-success)" if passed else "var(--state-warn)"
    return f'<span style="display:inline-flex;align-items:center;gap:4px;height:18px;padding:0 6px;border-radius:5px;background:var(--fill-subtle);{MONO};font-size:10.5px;color:{col}">{v}</span>'

# ---------------------------------------------------------------- chrome
def lights():
    d = "width:12px;height:12px;border-radius:50%;border:1px solid var(--border-strong);background:var(--fill-subtle)"
    return f'<div style="display:flex;gap:8px"><span style="{d}"></span><span style="{d}"></span><span style="{d}"></span></div>'

def titlebar():
    cluster = "".join(
        f'<span style="width:26px;height:22px;border-radius:5px;display:flex;align-items:center;justify-content:center;{bg}">'
        f'<svg width="13" height="11" viewBox="0 0 13 11" fill="none" stroke="currentColor" stroke-width="1.2"><rect x=".6" y=".6" width="11.8" height="9.8" rx="2"></rect><path d="{p}"></path></svg></span>'
        for p, bg in [("M4.5 .6v9.8", "background:var(--fill-hover);color:var(--text-primary)"), ("M8.5 .6v9.8", "color:var(--text-faint)"), ("M.6 7h11.8", "color:var(--text-faint)")])
    return f'''<div style="height:44px;display:flex;align-items:center;gap:12px;padding:0 14px;border-bottom:1px solid var(--divider);box-sizing:border-box">
  {lights()}
  <span style="width:28px;height:28px;display:flex;align-items:center;justify-content:center;color:var(--text-subtle)">{svg('<path d="M3 2.5h8.5l2 2V13.5H3zM5.5 6h5M5.5 8.5h5M5.5 11h3"></path>', size=15, sw="1.3")}</span>
  <div style="display:flex;align-items:center;gap:4px">
    <span style="display:flex;align-items:center;gap:8px;height:30px;padding:0 12px;border-radius:8px;border:1px solid var(--border-strong);background:var(--fill-hover)"><span style="width:8px;height:8px;border-radius:3px;background:var(--mark-1)"></span><span style="font-size:12.5px;font-weight:500">halden-shop</span></span>
    <span style="display:flex;align-items:center;gap:8px;height:30px;padding:0 12px;border-radius:8px;background:var(--fill-subtle)"><span style="width:8px;height:8px;border-radius:3px;background:#6b7c8a"></span><span style="font-size:12.5px;color:var(--text-muted)">chronicle</span></span>
    <span style="width:28px;height:28px;display:flex;align-items:center;justify-content:center;color:var(--text-faint)">{G["plus"]}</span>
  </div>
  <span style="flex:1"></span>
  <div style="display:flex;gap:2px;padding:2px;border-radius:7px;border:1px solid var(--border-hairline)">{cluster}</div>
  <span style="{MONO};font-size:11px;color:var(--text-faint)">Checked 14:02:31</span>
  <span style="width:1px;height:16px;background:var(--divider)"></span>
  <span style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-secondary)">{G["help"]}Need help?</span>
</div>'''

def rail(sel="design"):
    def b(k, label):
        if k == sel:
            st = "border:1px solid var(--selected-bg);background:var(--selected-bg);color:var(--selected-fg)"
        else:
            st = "border:1px solid var(--border-strong);color:var(--text-subtle)"
        return f'<button type="button" aria-label="{label}" style="width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;background:transparent;{st}">{G[k]}</button>'
    return f'''<div style="width:52px;flex-shrink:0;display:flex;flex-direction:column;align-items:center;gap:6px;padding:10px 0;border-right:1px solid var(--divider);box-sizing:border-box">
  {b("road","Roadmap")}{b("repo","Repo")}{b("notes","Notes")}{b("web","Web")}{b("design","Design")}
  <span style="flex:1"></span>
  <button type="button" aria-label="Setup and health" style="width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;background:transparent;border:1px solid var(--border-strong);color:var(--text-faint)">{G["pulse"]}</button>
  <button type="button" aria-label="Check again now" style="width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;background:transparent;border:1px solid var(--border-strong);color:var(--text-faint)">{G["refresh"]}</button>
</div>'''

def shell(inner, sel="design"):
    return f'''{titlebar()}
<div style="display:flex;height:{H-44}px">
  {rail(sel)}
  <div style="flex:1;min-width:0;display:flex">{inner}</div>
</div>'''

# ---------------------------------------------------------------- designs sidebar
DESIGNS = [
    ("E-commerce", [("Product page · Ethiopia Guji", "8.4", True, "open"), ("Checkout", "working", None, ""), ("Cart drawer", "7.2", False, "")]),
    ("Marketing", [("Spring subscription launch", "8.8", True, ""), ("Wholesale one-pager", "draft", None, "")]),
    ("Brand", [("Halden identity refresh", "9.1", True, "")]),
    ("Deck", [("Investor update · Q3", "8.2", True, "")]),
    ("App UI", [("Roaster dashboard", "8.0", True, "")]),
]

def sidebar(designs=DESIGNS, selected="Product page · Ethiopia Guji", empty=False):
    rows = []
    if not empty:
        for kind, items in designs:
            rows.append(f'<div style="display:flex;align-items:center;gap:6px;height:24px;padding:0 6px;margin-top:10px">{eyebrow(kind)}<span style="flex:1"></span><span style="{MONO};font-size:10px;color:var(--text-faint)">{len(items)}</span></div>')
            for name, st, passed, _ in items:
                sel = name == selected
                bg = "background:var(--fill-hover);color:var(--text-primary)" if sel else "color:var(--text-secondary)"
                if st == "working":
                    tail = f'<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--state-neutral)">{dot("var(--state-neutral)", True)}working</span>'
                elif st == "draft":
                    tail = f'<span style="font-size:11px;color:var(--text-faint)">draft</span>'
                else:
                    tail = score_chip(st, passed)
                bar = '<span style="position:absolute;left:-8px;top:6px;bottom:6px;width:2px;border-radius:1px;background:var(--text-primary)"></span>' if sel else ""
                rows.append(f'<div style="position:relative;display:flex;align-items:center;gap:8px;height:30px;padding:0 6px;border-radius:6px;{bg}">{bar}<span style="color:var(--text-subtle);display:flex">{G[KIND_ICON[kind]]}</span><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px">{name}</span>{tail}</div>')
    else:
        rows.append(f'<div style="padding:14px 8px;font-size:11.5px;line-height:1.55;color:var(--text-faint)">No designs yet. Anything you make lands here, saved in <span style="{MONO};font-size:10.5px">.chronicle/designs/</span>.</div>')
    swatches = "".join(f'<span style="width:14px;height:14px;border-radius:4px;background:{c};box-shadow:inset 0 0 0 1px rgba(128,128,128,.25)"></span>' for c in ["#1B1F1C", "#EEF0EC", "#7A3E1D", "#C9D3C4", "#2F5D50"])
    ds = (f'''<div style="border-top:1px solid var(--divider);padding:12px 14px;display:flex;flex-direction:column;gap:8px">
    <div style="display:flex;align-items:center;gap:6px">{eyebrow("Design system")}<span style="flex:1"></span>{state_word("in sync", "success")}</div>
    <div style="display:flex;align-items:center;gap:8px"><span style="color:var(--text-subtle);display:flex">{G["system"]}</span><span style="font-size:12.5px">Halden</span><span style="{MONO};font-size:10.5px;color:var(--text-faint)">DESIGN.md</span></div>
    <div style="display:flex;gap:4px">{swatches}</div>
  </div>''' if not empty else f'''<div style="border-top:1px solid var(--divider);padding:12px 14px;display:flex;flex-direction:column;gap:6px">
    {eyebrow("Design system")}
    <div style="font-size:11.5px;line-height:1.5;color:var(--text-muted)">None yet. The director reads your code and proposes one on the first design.</div>
  </div>''')
    return f'''<div style="width:248px;flex-shrink:0;display:flex;flex-direction:column;border-right:1px solid var(--border-hairline);box-sizing:border-box">
  <div style="height:40px;display:flex;align-items:center;gap:6px;padding:0 10px 0 14px;border-bottom:1px solid var(--border-hairline)">
    {eyebrow("Designs" + ("" if empty else f" · {sum(len(i) for _, i in designs)}"))}<span style="flex:1"></span>
    <span style="width:26px;height:26px;display:flex;align-items:center;justify-content:center;border-radius:6px;color:var(--text-subtle)">{G["search"]}</span>
    <span style="width:26px;height:26px;display:flex;align-items:center;justify-content:center;border-radius:6px;color:var(--text-subtle)">{G["plus"]}</span>
  </div>
  <div style="flex:1;overflow:hidden;padding:0 8px 8px">{"".join(rows)}</div>
  {ds}
</div>'''

# ---------------------------------------------------------------- the designed product (director output)
# Halden Roasters: Bricolage Grotesque display over IBM Plex Sans, stone ground,
# ink text, roast-brown accent, sage support. Deliberately not cream+serif+terracotta.
HD = {"bg": "#EEF0EC", "ink": "#1B1F1C", "muted": "#5B635D", "line": "#D5DAD3", "accent": "#7A3E1D", "sage": "#C9D3C4", "deep": "#2F5D50", "card": "#F7F8F5"}
DISP = "font-family:'Bricolage Grotesque',Georgia,serif"
BODY = "font-family:'IBM Plex Sans',system-ui,sans-serif"

def bag(w, h, label="GUJI"):
    return f'''<div style="width:{w}px;height:{h}px;background:{HD["sage"]};border-radius:6px;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden">
  <div style="width:{int(w*.44)}px;height:{int(h*.7)}px;background:{HD["deep"]};border-radius:{int(w*.02)}px {int(w*.02)}px {int(w*.03)}px {int(w*.03)}px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:{int(h*.02)}px;box-shadow:0 {int(h*.03)}px {int(h*.06)}px rgba(27,31,28,.25)">
    <div style="width:70%;height:{int(h*.2)}px;background:{HD["bg"]};border-radius:3px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px">
      <span style="{DISP};font-weight:700;font-size:{max(8,int(h*.05))}px;color:{HD["ink"]};letter-spacing:.02em">HALDEN</span>
      <span style="{BODY};font-size:{max(6,int(h*.025))}px;color:{HD["accent"]};letter-spacing:.14em">{label}</span>
    </div>
  </div>
</div>'''

def pdp_desktop(w=1440, mark=None, gift=False):
    """mark = (target, css color, label, scale): outline + label drawn inside the
    page so they land on the element at any zoom. targets: reviews, purchase, gift."""
    def mk(t):
        if not mark or mark[0] != t: return "", ""
        _, col, label, sc = mark[:4]
        where = mark[4] if len(mark) > 4 else "below"
        pos = {"below": f"left:0;top:100%;margin-top:{10/sc:.0f}px", "above": f"left:0;bottom:100%;margin-bottom:{10/sc:.0f}px", "right": f"left:100%;top:50%;transform:translateY(-50%);margin-left:{14/sc:.0f}px", "left": f"right:100%;top:0;margin-right:{10/sc:.0f}px", "below-right": f"right:0;top:100%;margin-top:{10/sc:.0f}px"}[where]
        ring = f"position:relative;outline:{2/sc:.1f}px solid {col};outline-offset:{4/sc:.1f}px;"
        lab = f'<span style="position:absolute;{pos};white-space:nowrap;padding:{3/sc:.0f}px {7/sc:.0f}px;border-radius:{5/sc:.0f}px;background:{col};color:#0a0a0a;font-family:Geist,system-ui,sans-serif;font-size:{10.5/sc:.0f}px;font-weight:500;z-index:5">{label}</span>'
        return ring, lab
    rv, rvl = mk("reviews"); pu, pul = mk("purchase"); gi, gil = mk("gift")
    pad = 80
    col = 628
    sizes = "".join(f'<span style="height:44px;padding:0 18px;display:inline-flex;align-items:center;border-radius:6px;border:1px solid {HD["ink"] if i==1 else HD["line"]};{BODY};font-size:15px;color:{HD["ink"]};background:{"#fff" if i==1 else "transparent"}">{s}</span>' for i, s in enumerate(["250 g", "500 g", "1 kg"]))
    grinds = "".join(f'<span style="height:44px;padding:0 16px;display:inline-flex;align-items:center;border-radius:6px;border:1px solid {HD["ink"] if i==0 else HD["line"]};{BODY};font-size:15px;color:{HD["ink"]};background:{"#fff" if i==0 else "transparent"}">{s}</span>' for i, s in enumerate(["Whole bean", "Filter", "Espresso"]))
    thumbs = "".join(f'<div style="width:96px;height:96px;border-radius:6px;background:{c};border:2px solid {HD["ink"] if i==0 else "transparent"}"></div>' for i, c in enumerate([HD["sage"], "#DCE2D9", "#CFD8CB", "#E3E7E0"]))
    notes = "".join(f'<div style="display:flex;flex-direction:column;gap:6px;padding:18px 0;border-top:1px solid {HD["line"]}"><span style="{BODY};font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:{HD["muted"]}">{k}</span><span style="{DISP};font-weight:500;font-size:22px;color:{HD["ink"]}">{v}</span></div>' for k, v in [("Tastes like", "Bergamot, white peach, jasmine"), ("Process", "Washed · 2,100 m"), ("Roast", "Light, for filter")])
    return f'''<div style="width:{w}px;height:1180px;background:{HD["bg"]};{BODY};color:{HD["ink"]};box-sizing:border-box">
  <div style="height:72px;display:flex;align-items:center;gap:36px;padding:0 {pad}px;border-bottom:1px solid {HD["line"]}">
    <span style="{DISP};font-weight:700;font-size:24px;letter-spacing:.01em">Halden</span>
    <span style="font-size:15px;color:{HD["muted"]}">Coffee</span><span style="font-size:15px;color:{HD["muted"]}">Subscriptions</span><span style="font-size:15px;color:{HD["muted"]}">Brew guides</span><span style="font-size:15px;color:{HD["muted"]}">Wholesale</span>
    <span style="flex:1"></span>
    <span style="height:40px;width:260px;border-radius:6px;border:1px solid {HD["line"]};display:flex;align-items:center;padding:0 14px;font-size:14px;color:{HD["muted"]};background:#fff">Search coffee</span>
    <span style="font-size:15px">Account</span><span style="font-size:15px;font-weight:600">Cart (1)</span>
  </div>
  <div style="padding:24px {pad}px 0;font-size:14px;color:{HD["muted"]}">Coffee / Single origin / <span style="color:{HD["ink"]}">Ethiopia Guji</span></div>
  <div style="display:flex;gap:64px;padding:24px {pad}px 0">
    <div style="display:flex;flex-direction:column;gap:16px">
      {bag(col, 600)}
      <div style="display:flex;gap:12px">{thumbs}</div>
    </div>
    <div style="flex:1;display:flex;flex-direction:column;gap:22px;padding-top:8px">
      <div style="display:flex;flex-direction:column;gap:10px">
        <span style="font-size:14px;letter-spacing:.06em;text-transform:uppercase;color:{HD["accent"]}">Single origin · Harvest 2026</span>
        <h1 style="margin:0;{DISP};font-weight:700;font-size:64px;line-height:1;letter-spacing:-.02em">Ethiopia Guji</h1>
        <div style="display:flex;align-items:center;gap:10px;font-size:15px"><span style="letter-spacing:2px;color:{HD["accent"]}">★★★★★</span><span style="text-decoration:underline;{rv}">4.8 · 312 reviews{rvl}</span></div>
      </div>
      <div style="display:flex;align-items:baseline;gap:12px"><span style="{DISP};font-weight:500;font-size:34px">$19.50</span><span style="font-size:15px;color:{HD["muted"]}">250 g · $7.80 per 100 g</span></div>
      <div style="display:flex;flex-direction:column;gap:10px"><span style="font-size:15px;font-weight:600">Size</span><div style="display:flex;gap:8px">{sizes}</div></div>
      <div style="display:flex;flex-direction:column;gap:10px"><span style="font-size:15px;font-weight:600">Grind</span><div style="display:flex;gap:8px">{grinds}</div></div>
      <div style="display:flex;flex-direction:column;gap:0;border:1px solid {HD["line"]};border-radius:8px;background:#fff;{pu}">{pul}
        <div style="display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid {HD["line"]}"><span style="width:18px;height:18px;border-radius:50%;border:5px solid {HD["ink"]};box-sizing:border-box"></span><span style="font-size:15px;flex:1">One-time purchase</span><span style="font-size:15px;font-weight:600">$19.50</span></div>
        <div style="display:flex;align-items:center;gap:12px;padding:14px 16px"><span style="width:18px;height:18px;border-radius:50%;border:1.5px solid {HD["muted"]};box-sizing:border-box"></span><span style="font-size:15px;flex:1">Subscribe, every 2 weeks · save 10%</span><span style="font-size:15px">$17.55</span></div>
        {f'<div style="display:flex;align-items:center;gap:12px;padding:14px 16px;border-top:1px solid {HD["line"]};{gi}"><span style="width:18px;height:18px;border-radius:4px;border:1.5px solid {HD["muted"]};box-sizing:border-box"></span><span style="font-size:15px;flex:1">It’s a gift: add a note, hide the price</span><span style="font-size:14px;color:{HD["muted"]}">free</span>{gil}</div>' if gift else ""}
      </div>
      <div style="display:flex;gap:10px">
        <span style="height:56px;width:120px;border-radius:8px;border:1px solid {HD["line"]};display:flex;align-items:center;justify-content:space-around;font-size:17px;background:#fff"><span>−</span><span>1</span><span>+</span></span>
        <span style="flex:1;height:56px;border-radius:8px;background:{HD["ink"]};color:{HD["bg"]};display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:600">Add to cart · $19.50</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;font-size:14.5px;color:{HD["ink"]}">
        <span>Roasted Monday, ships Tuesday · arrives by <b>Fri, Sep 25</b></span>
        <span style="color:{HD["muted"]}">Free shipping over $35 · $4.90 below · free returns on unopened bags</span>
      </div>
      <div style="display:flex;flex-direction:column">{notes}</div>
    </div>
  </div>
</div>'''

def pdp_mobile():
    return f'''<div style="width:390px;height:844px;background:{HD["bg"]};{BODY};color:{HD["ink"]};box-sizing:border-box;position:relative;overflow:hidden">
  <div style="height:56px;display:flex;align-items:center;justify-content:space-between;padding:0 20px;border-bottom:1px solid {HD["line"]}"><span style="font-size:22px">≡</span><span style="{DISP};font-weight:700;font-size:21px">Halden</span><span style="font-size:15px;font-weight:600">Cart (1)</span></div>
  {bag(390, 360)}
  <div style="padding:18px 20px;display:flex;flex-direction:column;gap:12px">
    <span style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:{HD["accent"]}">Single origin · Harvest 2026</span>
    <h1 style="margin:0;{DISP};font-weight:700;font-size:38px;line-height:1;letter-spacing:-.02em">Ethiopia Guji</h1>
    <div style="display:flex;gap:8px;font-size:14px"><span style="color:{HD["accent"]}">★★★★★</span><span style="text-decoration:underline">4.8 · 312</span></div>
    <div style="display:flex;align-items:baseline;gap:8px"><span style="{DISP};font-weight:500;font-size:26px">$19.50</span><span style="font-size:13px;color:{HD["muted"]}">250 g · $7.80/100 g</span></div>
    <div style="display:flex;gap:6px">{"".join(f'<span style="flex:1;height:44px;border-radius:6px;border:1px solid {HD["ink"] if i==0 else HD["line"]};display:flex;align-items:center;justify-content:center;font-size:14px;background:{"#fff" if i==0 else "transparent"}">{s}</span>' for i,s in enumerate(["250 g","500 g","1 kg"]))}</div>
    <span style="font-size:13.5px;color:{HD["muted"]}">Arrives by Fri, Sep 25 · free shipping over $35</span>
  </div>
  <div style="position:absolute;left:0;right:0;bottom:0;padding:12px 20px 28px;background:{HD["bg"]};border-top:1px solid {HD["line"]}"><div style="height:52px;border-radius:8px;background:{HD["ink"]};color:{HD["bg"]};display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:600">Add to cart · $19.50</div></div>
</div>'''

def pdp_tablet():
    return f'''<div style="width:768px;height:1024px;background:{HD["bg"]};{BODY};color:{HD["ink"]};box-sizing:border-box;overflow:hidden">
  <div style="height:64px;display:flex;align-items:center;gap:24px;padding:0 40px;border-bottom:1px solid {HD["line"]}"><span style="{DISP};font-weight:700;font-size:22px">Halden</span><span style="font-size:14px;color:{HD["muted"]}">Coffee</span><span style="font-size:14px;color:{HD["muted"]}">Subscriptions</span><span style="flex:1"></span><span style="font-size:14px;font-weight:600">Cart (1)</span></div>
  <div style="display:flex;gap:32px;padding:32px 40px">
    {bag(340, 420)}
    <div style="flex:1;display:flex;flex-direction:column;gap:14px">
      <span style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:{HD["accent"]}">Single origin</span>
      <h1 style="margin:0;{DISP};font-weight:700;font-size:44px;line-height:1">Ethiopia Guji</h1>
      <span style="font-size:14px"><span style="color:{HD["accent"]}">★★★★★</span> 4.8 · 312 reviews</span>
      <span style="{DISP};font-weight:500;font-size:28px">$19.50</span>
      <div style="display:flex;gap:6px">{"".join(f'<span style="height:44px;padding:0 14px;border-radius:6px;border:1px solid {HD["ink"] if i==0 else HD["line"]};display:flex;align-items:center;font-size:14px;background:{"#fff" if i==0 else "transparent"}">{s}</span>' for i,s in enumerate(["250 g","500 g","1 kg"]))}</div>
      <div style="height:52px;border-radius:8px;background:{HD["ink"]};color:{HD["bg"]};display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:600">Add to cart</div>
      <span style="font-size:13.5px;color:{HD["muted"]}">Arrives by Fri, Sep 25</span>
    </div>
  </div>
</div>'''

def hero_variant(v):
    if v == "A":
        return f'<div style="width:1440px;height:720px;background:{HD["bg"]};display:flex;align-items:center;gap:64px;padding:0 80px;box-sizing:border-box;{BODY};color:{HD["ink"]}">{bag(620,560)}<div style="display:flex;flex-direction:column;gap:18px"><span style="font-size:14px;letter-spacing:.06em;text-transform:uppercase;color:{HD["accent"]}">Single origin</span><span style="{DISP};font-weight:700;font-size:72px;line-height:1">Ethiopia Guji</span><span style="{DISP};font-size:34px">$19.50</span><span style="height:56px;width:340px;border-radius:8px;background:{HD["ink"]};color:{HD["bg"]};display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:600">Add to cart</span></div></div>'
    if v == "B":
        return f'<div style="width:1440px;height:720px;background:{HD["deep"]};display:flex;align-items:center;gap:64px;padding:0 80px;box-sizing:border-box;{BODY};color:{HD["bg"]}"><div style="display:flex;flex-direction:column;gap:18px;flex:1"><span style="font-size:14px;letter-spacing:.06em;text-transform:uppercase;color:{HD["sage"]}">Harvest 2026 · Washed</span><span style="{DISP};font-weight:700;font-size:96px;line-height:.95;letter-spacing:-.03em">Bergamot.<br>White peach.<br>Jasmine.</span><span style="font-size:18px;color:{HD["sage"]}">Ethiopia Guji · $19.50 for 250 g</span><span style="height:56px;width:300px;border-radius:8px;background:{HD["bg"]};color:{HD["ink"]};display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:600">Add to cart</span></div><div style="width:460px;height:560px;border-radius:8px;background:#244a40;display:flex;align-items:center;justify-content:center">{bag(400,500)}</div></div>'
    return f'<div style="width:1440px;height:720px;background:#fff;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));box-sizing:border-box;{BODY};color:{HD["ink"]}"><div style="background:{HD["sage"]};display:flex;align-items:center;justify-content:center">{bag(560,600)}</div><div style="display:flex;flex-direction:column;justify-content:flex-end;gap:16px;padding:64px"><span style="{DISP};font-weight:700;font-size:140px;line-height:.85;letter-spacing:-.04em">Guji</span><span style="font-size:20px;max-width:440px;line-height:1.45;color:{HD["muted"]}">A washed Ethiopian lot from 2,100 m. Bright, floral, made for filter.</span><div style="display:flex;gap:12px;align-items:center"><span style="height:56px;width:260px;border-radius:8px;background:{HD["ink"]};color:#fff;display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:600">Add to cart · $19.50</span></div></div></div>'

def scaled(content, cw, ch, scale):
    return f'<div style="width:{int(cw*scale)}px;height:{int(ch*scale)}px;overflow:hidden;position:relative;border-radius:2px;box-shadow:var(--frame-shadow)"><div style="width:{cw}px;height:{ch}px;transform:scale({scale});transform-origin:0 0">{content}</div></div>'

def frame_label(name, size, score=None, passed=True, sel=False, state=None):
    right = score_chip(score, passed) if score else ""
    if state:
        right = state
    col = "var(--text-primary)" if sel else "var(--text-subtle)"
    return f'<div style="display:flex;align-items:center;gap:8px;height:20px;margin-bottom:6px"><span style="font-size:11.5px;color:{col}">{name}</span><span style="{MONO};font-size:10.5px;color:var(--text-faint)">{size}</span><span style="flex:1"></span>{right}</div>'

# ---------------------------------------------------------------- canvas pieces
def canvas_toolbar(title="Product page · Ethiopia Guji", kind="E-commerce", tab="canvas"):
    tools = "".join(f'<span style="width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:6px;{"background:var(--fill-hover);color:var(--text-primary)" if i==0 else "color:var(--text-subtle)"}">{G[k]}</span>' for i, k in enumerate(["cursor", "hand", "comment"]))
    def seg(label, icon, on):
        st = "background:var(--fill-hover);color:var(--text-primary)" if on else "color:var(--text-muted)"
        return f'<span style="display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 9px;border-radius:6px;font-size:11.5px;{st}">{G[icon]}{label}</span>'
    return f'''<div style="height:40px;display:flex;align-items:center;gap:10px;padding:0 10px 0 14px;border-bottom:1px solid var(--border-hairline);box-sizing:border-box">
  <span style="font-size:12.5px;font-weight:600;white-space:nowrap">{title}</span>
  {chip(G[KIND_ICON[kind]].replace('width="14" height="14"','width="11" height="11"') + kind)}
  <span style="width:1px;height:16px;background:var(--divider);margin:0 2px"></span>
  <div style="display:flex;gap:2px">{tools}</div>
  <span style="flex:1"></span>
  <div style="display:flex;gap:2px">{seg("Scorecard","score",tab=="score")}{seg("History","clock",tab=="history")}{seg("System","system",tab=="system")}</div>
  <span style="width:1px;height:16px;background:var(--divider);margin:0 2px"></span>
  <button type="button" aria-label="Export" style="width:28px;height:28px;border-radius:8px;border:1px solid var(--border-strong);background:transparent;color:var(--text-secondary);display:flex;align-items:center;justify-content:center;flex-shrink:0">{G["export"]}</button>
</div>'''

def zoom_controls(pct="38%"):
    return f'''<div style="position:absolute;left:14px;bottom:14px;display:flex;align-items:center;gap:2px;padding:3px;border-radius:8px;border:1px solid var(--border-hairline);background:var(--surface-overlay)">
  <span style="width:26px;height:24px;display:flex;align-items:center;justify-content:center;color:var(--text-subtle);font-size:14px">−</span>
  <span style="{MONO};font-size:11px;color:var(--text-secondary);padding:0 6px">{pct}</span>
  <span style="width:26px;height:24px;display:flex;align-items:center;justify-content:center;color:var(--text-subtle);font-size:14px">+</span>
  <span style="width:1px;height:14px;background:var(--divider)"></span>
  <span style="width:26px;height:24px;display:flex;align-items:center;justify-content:center;color:var(--text-subtle)">{G["fit"]}</span>
</div>'''

def minimap():
    return f'''<div style="position:absolute;right:14px;bottom:14px;width:132px;height:84px;border-radius:8px;border:1px solid var(--border-hairline);background:var(--surface-overlay);padding:8px;box-sizing:border-box">
  <div style="position:relative;width:100%;height:100%">
    <span style="position:absolute;left:0;top:6px;width:52px;height:44px;border-radius:1px;background:var(--fill-hover)"></span>
    <span style="position:absolute;left:58px;top:6px;width:28px;height:36px;border-radius:1px;background:var(--fill-hover)"></span>
    <span style="position:absolute;left:92px;top:6px;width:14px;height:30px;border-radius:1px;background:var(--fill-hover)"></span>
    <span style="position:absolute;left:0;top:54px;width:106px;height:14px;border-radius:1px;background:var(--fill-subtle)"></span>
    <span style="position:absolute;left:-3px;top:2px;width:114px;height:52px;border-radius:3px;border:1px solid var(--text-muted)"></span>
  </div>
</div>'''

def canvas_bg_style():
    return "background-color:var(--surface-app);background-image:radial-gradient(var(--canvas-dot) 1px, transparent 1px);background-size:20px 20px"

# ---------------------------------------------------------------- thread pieces
def avatar_director():
    return f'<span style="width:26px;height:26px;border-radius:50%;border:1px solid var(--border-hairline);background:var(--surface-card-raised);display:flex;align-items:center;justify-content:center;color:#D97757;flex-shrink:0">{svg("<path d=\"M4.5 1.5v3h-3M11.5 1.5v3h3M4.5 14.5v-3h-3M11.5 14.5v-3h3\"></path><rect x=\"6\" y=\"6\" width=\"4\" height=\"4\" rx=\".6\" fill=\"currentColor\"></rect>", size=13, sw="1.4")}</span>'

def avatar_you():
    return f'<span style="width:26px;height:26px;border-radius:50%;border:1px solid var(--border-hairline);background:var(--fill-subtle);display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--text-subtle);flex-shrink:0">T</span>'

def msg(who, body, you=False):
    av = avatar_you() if you else avatar_director()
    return f'<div style="display:flex;gap:10px;padding:8px 14px"><div>{av}</div><div style="flex:1;min-width:0"><div style="font-size:12.5px;font-weight:600;margin-bottom:2px">{who}</div><div style="font-size:13px;line-height:1.65;color:var(--text-primary);text-wrap:pretty">{body}</div></div></div>'

def card(inner, extra=""):
    return f'<div style="margin:4px 14px 6px 50px;border-radius:8px;border:1px solid var(--border-hairline);background:var(--surface-card);{extra}">{inner}</div>'

def tool_row(label, detail, st="done"):
    if st == "done":
        s = f'<span style="color:var(--state-success);display:flex">{G["check"]}</span>'
    elif st == "run":
        s = f'<span style="width:10px;height:10px;border-radius:50%;border:1.5px solid var(--state-neutral);border-top-color:transparent;animation:wv-spin .7s linear infinite"></span>'
    elif st == "fail":
        s = f'<span style="color:var(--state-error);display:flex">{G["error"]}</span>'
    else:
        s = f'<span style="width:10px;height:10px;border-radius:50%;border:1.5px solid var(--border-strong)"></span>'
    return f'<div style="display:flex;align-items:center;gap:8px;height:28px;padding:0 10px"><span style="width:12px;display:flex;justify-content:center">{s}</span><span style="font-size:12px;color:var(--text-secondary);white-space:nowrap">{label}</span><span style="{MONO};font-size:10.5px;color:var(--text-faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{detail}</span></div>'

def token_plan_card():
    sw = "".join(f'<div style="display:flex;flex-direction:column;gap:4px;align-items:flex-start"><span style="width:30px;height:30px;border-radius:6px;background:{c};box-shadow:inset 0 0 0 1px rgba(128,128,128,.25)"></span><span style="{MONO};font-size:9.5px;color:var(--text-faint)">{n}</span></div>' for n, c in [("ink", HD["ink"]), ("stone", HD["bg"]), ("roast", HD["accent"]), ("sage", HD["sage"]), ("pine", HD["deep"])])
    inner = f'''<div style="padding:10px 12px;display:flex;flex-direction:column;gap:10px">
  <div style="display:flex;align-items:center;gap:6px">{eyebrow("Token plan")}<span style="flex:1"></span><span style="font-size:11px;color:var(--text-faint)">from DESIGN.md</span></div>
  <div style="display:flex;gap:10px">{sw}</div>
  <div style="display:flex;align-items:baseline;gap:10px"><span style="{DISP};font-weight:700;font-size:22px;color:var(--text-primary)">Aa</span><span style="font-size:11.5px;color:var(--text-muted)">Bricolage Grotesque 700 display</span></div>
  <div style="display:flex;align-items:baseline;gap:10px"><span style="{BODY};font-size:15px;color:var(--text-primary)">Aa</span><span style="font-size:11.5px;color:var(--text-muted)">IBM Plex Sans 400/600 body · 15/1.5</span></div>
  <div style="font-size:11.5px;line-height:1.5;color:var(--text-muted)">Rejected on purpose: cream + serif + terracotta (the 2026 AI default), purple gradients, card grids.</div>
</div>'''
    return card(inner)

def lint_card(state="pass"):
    if state == "pass":
        head = f'{state_word("passed", "success")}<span style="{MONO};font-size:10.5px;color:var(--text-faint)">0 severe · 3 minor</span>'
        rows = tool_row("Anti-pattern detector", "impeccable · 41 rules") + tool_row("Contrast + touch targets", "all ≥ 4.5:1 · ≥ 44 px") + tool_row("E-commerce rules", "price, delivery, returns above the fold")
    elif state == "run":
        head = f'{state_word("checking", "neutral")}'
        rows = tool_row("Anti-pattern detector", "impeccable · 41 rules") + tool_row("Contrast + touch targets", "3 frames", "run") + tool_row("E-commerce rules", "", "queued")
    else:
        head = f'{state_word("fixing 1 severe", "warn")}'
        rows = tool_row("Anti-pattern detector", "all-caps kicker repeated on every section", "fail") + tool_row("Fix pass 1 of 2", "frames/desktop.html", "run")
    inner = f'<div style="display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid var(--divider)">{eyebrow("Lint gate")}<span style="flex:1"></span>{head}</div><div style="padding:4px 0">{rows}</div>'
    return card(inner)

REVIEWERS = [("Art director", "craft, type, brand", "8.6", 1.0), ("UX director", "heuristics, task flow, e-com rules", "8.1", 1.0), ("Accessibility", "WCAG 2.2 AA, focus, targets", "9.0", 1.0), ("Copy", "clarity, voice, no filler", "7.8", 1.0)]

def critique_card(state="done"):
    rows = []
    for i, (name, focus, sc, _) in enumerate(REVIEWERS):
        if state == "run" and i >= 2:
            right = f'<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--state-neutral)">{dot("var(--state-neutral)", True)}{"reviewing" if i==2 else "queued"}</span>'
            bar = ""
        else:
            v = float(sc)
            right = score_chip(sc, v >= 8.0)
            bar = f'<div style="height:3px;border-radius:2px;background:var(--fill-hover);margin:4px 0 0 20px"><span style="display:block;height:100%;width:{int(v*10)}%;border-radius:2px;background:{"var(--state-success)" if v>=8 else "var(--state-warn)"}"></span></div>'
        rows.append(f'<div style="padding:7px 12px"><div style="display:flex;align-items:center;gap:8px"><span style="width:12px;height:12px;border-left:1px solid var(--border-strong);border-bottom:1px solid var(--border-strong);margin-top:-6px;flex-shrink:0"></span><span style="font-size:12px;color:var(--text-primary)">{name}</span><span style="font-size:11px;color:var(--text-faint);flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">{focus}</span>{right}</div>{bar}</div>')
    if state == "done":
        head = f'<span style="{MONO};font-size:11px;color:var(--text-faint)">round 2 of 3</span>{score_chip("8.4 / pass 8.0")}'
        foot = f'<div style="display:flex;align-items:center;gap:8px;padding:9px 12px;border-top:1px solid var(--divider)"><span style="font-size:11.5px;color:var(--text-muted);flex:1">Round 1 scored 7.6. Fixed: price-per-weight missing, delivery date below the fold.</span><span style="font-size:11.5px;color:var(--text-secondary);white-space:nowrap">Open scorecard</span></div>'
    else:
        head = f'<span style="{MONO};font-size:11px;color:var(--text-faint)">round 1 of 3</span>'
        foot = ""
    inner = f'<div style="display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid var(--divider)">{eyebrow("Critique panel")}<span style="flex:1"></span>{head}</div><div style="padding:3px 0">{"".join(rows)}</div>{foot}'
    return card(inner)

def composer(placeholder="Ask the director for a change, or click a frame to comment", chips=True):
    ch = ""
    if chips:
        ch = f'''<div style="display:flex;align-items:center;gap:6px;padding:8px 10px 0">
      <span style="display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 9px;border-radius:12px;background:var(--fill-subtle);font-size:11px;color:var(--text-subtle)">{G["system"].replace('width="14" height="14"','width="11" height="11"')}Halden system</span>
      <span style="display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 9px;border-radius:12px;background:var(--fill-subtle);font-size:11px;color:var(--text-subtle)">Critique on · pass 8.0</span>
    </div>'''
    return f'''<div style="margin:8px 12px 12px;border-radius:10px;border:1px solid var(--border-field);background:var(--surface-input)">
  {ch}
  <div style="padding:10px 12px;font-size:13px;color:var(--text-faint);min-height:40px">{placeholder}</div>
  <div style="display:flex;align-items:center;gap:6px;padding:0 8px 8px">
    <span style="width:26px;height:26px;display:flex;align-items:center;justify-content:center;color:var(--text-faint)">{G["attach"]}</span>
    <span style="display:inline-flex;align-items:center;gap:4px;height:26px;padding:0 8px;border-radius:8px;border:1px solid var(--border-hairline);font-size:11.5px;color:var(--text-muted)">Opus 4.8 {G["chevd"]}</span>
    <span style="display:inline-flex;align-items:center;gap:4px;height:26px;padding:0 8px;border-radius:8px;border:1px solid var(--border-hairline);font-size:11.5px;color:var(--text-muted)">Director · Execute {G["chevd"]}</span>
    <span style="flex:1"></span>
    <span style="width:28px;height:28px;border-radius:8px;background:var(--primary);color:var(--primary-fg);display:flex;align-items:center;justify-content:center">{G["arrowup"]}</span>
  </div>
</div>'''

def thread(body, title="Director", status=None, width=392):
    st = status or state_word("ready", "success")
    return f'''<div style="width:{width}px;flex-shrink:0;display:flex;flex-direction:column;border-left:1px solid var(--border-hairline);box-sizing:border-box;background:var(--surface-panel)">
  <div style="height:40px;display:flex;align-items:center;gap:8px;padding:0 12px 0 14px;border-bottom:1px solid var(--border-hairline);box-sizing:border-box">
    <span style="font-size:12.5px;font-weight:600">{title}</span>{st}<span style="flex:1"></span>
    <span style="{MONO};font-size:10.5px;color:var(--text-faint)">$0.00 · plan</span>
    <span style="width:26px;height:26px;display:flex;align-items:center;justify-content:center;color:var(--text-faint)">{G["clock"]}</span>
  </div>
  <div style="flex:1;overflow:hidden;padding:6px 0;display:flex;flex-direction:column;justify-content:flex-end;position:relative">{body}<span style="position:absolute;left:0;right:0;top:0;height:16px;background:linear-gradient(var(--surface-panel),transparent);pointer-events:none"></span></div>
  {composer()}
</div>'''

def divider_label(t):
    return f'<div style="display:flex;align-items:center;gap:8px;padding:6px 14px"><span style="flex:1;height:1px;background:var(--divider)"></span><span style="font-size:10.5px;color:var(--text-faint)">{t}</span><span style="flex:1;height:1px;background:var(--divider)"></span></div>'

# ================================================================ BOARDS
boards = {}

# ---- 1. At rest
def b_rest():
    frames = f'''<div style="position:absolute;left:32px;top:32px;display:flex;gap:28px;align-items:flex-start">
  <div>{frame_label("Desktop", "1440", "8.4", sel=True)}<div style="outline:2px solid var(--text-primary);outline-offset:3px;border-radius:2px">{scaled(pdp_desktop(), 1440, 1180, .22)}</div></div>
  <div>{frame_label("Tablet", "768", "8.3")}{scaled(pdp_tablet(), 768, 1024, .22)}</div>
  <div>{frame_label("Mobile", "390", "8.5")}{scaled(pdp_mobile(), 390, 844, .30)}</div>
</div>
<div style="position:absolute;left:32px;top:360px;display:flex;flex-direction:column;gap:8px">
  <div style="display:flex;align-items:center;gap:8px">{eyebrow("Variations · hero")}<span style="font-size:11px;color:var(--text-faint)">3 directions, same tokens</span></div>
  <div style="display:flex;gap:20px">
    <div>{frame_label("A · Product first", "1440", "8.4", sel=False, state=chip("chosen"))}{scaled(hero_variant("A"), 1440, 720, .14)}</div>
    <div>{frame_label("B · Tasting notes lead", "1440", "8.1")}{scaled(hero_variant("B"), 1440, 720, .14)}</div>
    <div>{frame_label("C · Editorial", "1440", "7.7", passed=False)}{scaled(hero_variant("C"), 1440, 720, .14)}</div>
  </div>
</div>'''
    canvas = f'''<div style="flex:1;min-width:0;display:flex;flex-direction:column">
  {canvas_toolbar()}
  <div style="flex:1;position:relative;overflow:hidden;{canvas_bg_style()}">{frames}{zoom_controls("22%")}{minimap()}</div>
</div>'''
    body = (msg("You", "Product page for our Ethiopia Guji. People buy it as a gift a lot, and half our traffic is phones. Use our system.", you=True)
            + msg("Design director", "Three breakpoints and three hero directions. I led with the bag and the price, kept delivery date and shipping cost next to Add to cart, and put tasting notes in the buyer’s words.")
            + lint_card("pass") + critique_card("done")
            + msg("Design director", "A passes at 8.4. Copy is the weakest reviewer (7.8): it wants the gift option named on the page. Want me to add a gift note toggle?"))
    return shell(sidebar() + canvas + thread(body))
boards["01-Rest.dc.html"] = ("At rest · a finished design", b_rest)

# ---- 2. Empty
def b_empty():
    kinds = [("App UI", "Screens, flows and clickable prototypes", "screen"), ("Marketing", "Landing pages, launches, social", "megaphone"), ("Deck", "Pitch and update decks with notes", "deck"), ("Brand", "Identity, palette, type, guidelines", "brand"), ("E-commerce", "Product, cart and checkout pages", "bag")]
    cards = "".join(f'<button type="button" style="display:flex;flex-direction:column;align-items:flex-start;gap:8px;padding:14px;border-radius:10px;border:1px solid {"var(--text-primary)" if k=="E-commerce" else "var(--border-hairline)"};background:{"var(--fill-hover)" if k=="E-commerce" else "var(--surface-card)"};color:var(--text-primary);text-align:left;{SANS};cursor:default"><span style="color:var(--text-secondary);display:flex">{G[ic]}</span><span style="font-size:12.5px;font-weight:600">{k}</span><span style="font-size:11.5px;line-height:1.45;color:var(--text-muted)">{d}</span></button>' for k, d, ic in kinds)
    center = f'''<div style="flex:1;min-width:0;display:flex;align-items:center;justify-content:center;{canvas_bg_style()}">
  <div style="width:720px;display:flex;flex-direction:column;gap:22px">
    <div style="display:flex;flex-direction:column;gap:8px">
      {eyebrow("Design")}
      <div style="font-size:24px;font-weight:600;letter-spacing:-.01em">What should we design?</div>
      <div style="font-size:13px;line-height:1.6;color:var(--text-muted);max-width:560px">Describe it the way you would to a design lead. The director asks what it needs to know, reads this project’s code for your colors and type, and shows you work that has already passed its own review.</div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px">{cards}</div>
    <div style="border-radius:12px;border:1px solid var(--border-field-focus,var(--border-strong));background:var(--surface-input)">
      <div style="padding:14px 16px;font-size:14px;line-height:1.6;color:var(--text-primary);min-height:72px">A product page for our Ethiopia Guji single origin. Lots of gift buyers, mostly on phones<span style="display:inline-block;width:1px;height:16px;background:var(--text-secondary);vertical-align:-3px;margin-left:1px"></span></div>
      <div style="display:flex;align-items:center;gap:8px;padding:0 10px 10px">
        <span style="display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border-radius:8px;border:1px solid var(--border-hairline);font-size:11.5px;color:var(--text-muted)">{G["attach"]}References</span>
        <span style="display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border-radius:8px;border:1px solid var(--border-hairline);font-size:11.5px;color:var(--text-muted)">{G["link"]}Capture a site</span>
        <span style="flex:1"></span>
        <span style="font-size:11px;color:var(--text-faint)">{kbd("↵")} to start</span>
        {btn("Start designing", kind="primary", size="md")}
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;background:var(--fill-subtle)">
      <span style="color:var(--text-subtle);display:flex">{G["system"]}</span>
      <span style="font-size:12px;color:var(--text-secondary);flex:1">No design system yet. The director will propose one from <span style="{MONO};font-size:11px">src/styles/tokens.css</span> and your components before it draws anything.</span>
      <span style="font-size:11.5px;color:var(--text-secondary)">Set one up first</span>
    </div>
  </div>
</div>'''
    return shell(sidebar(empty=True) + center)
boards["02-Empty.dc.html"] = ("No designs yet", b_empty)

# ---- 3. New design · clarifying form
def b_questions():
    def opt(label, on=False):
        st = "border:1px solid var(--text-primary);background:var(--fill-hover);color:var(--text-primary)" if on else "border:1px solid var(--border-hairline);color:var(--text-secondary)"
        return f'<span style="display:inline-flex;align-items:center;height:28px;padding:0 10px;border-radius:8px;font-size:12px;{st}">{label}</span>'
    def q(label, hint, opts):
        return f'<div style="display:flex;flex-direction:column;gap:7px;padding:10px 12px;border-top:1px solid var(--divider)"><div style="display:flex;align-items:baseline;gap:8px"><span style="font-size:12.5px;font-weight:500">{label}</span><span style="font-size:11px;color:var(--text-faint)">{hint}</span></div><div style="display:flex;flex-wrap:wrap;gap:6px">{opts}</div></div>'
    form = f'''<div style="margin:4px 14px 6px 50px;border-radius:10px;border:1px solid var(--border-strong);background:var(--surface-card)">
  <div style="display:flex;align-items:center;gap:8px;padding:10px 12px">{eyebrow("Before I draw")}<span style="flex:1"></span><span style="{MONO};font-size:10.5px;color:var(--text-faint)">4 questions · ~20 s</span></div>
  {q("Who is buying?", "shapes hierarchy and copy", opt("Regulars reordering") + opt("Gift buyers", True) + opt("New to specialty", True))}
  {q("Where do they shop?", "sets the lead breakpoint", opt("Mostly phone", True) + opt("Mostly desktop") + opt("Even split"))}
  {q("How should it feel?", "pick up to two", opt("Quiet and exact", True) + opt("Warm, hand-made") + opt("Bold, editorial", True) + opt("Playful"))}
  {q("Design system", "found in this repo", opt("Halden · DESIGN.md", True) + opt("Propose a new one") + opt("None, explore"))}
  <div style="display:flex;flex-direction:column;gap:7px;padding:10px 12px;border-top:1px solid var(--divider)">
    <span style="font-size:12.5px;font-weight:500">Anything to match or avoid?</span>
    <div style="display:flex;align-items:center;gap:8px;height:34px;padding:0 10px;border-radius:8px;border:1px solid var(--border-field);background:var(--surface-input);font-size:12.5px;color:var(--text-faint)">A site, a screenshot, or “not like …”</div>
    <div style="display:flex;gap:6px">{chip(G["image"].replace('width="14" height="14"','width="11" height="11"') + "shelf-photo.jpg")}{chip("counterculture.com", mono=True)}</div>
  </div>
  <div style="display:flex;align-items:center;gap:8px;padding:10px 12px;border-top:1px solid var(--divider)"><span style="font-size:11px;color:var(--text-faint);flex:1">Skip and I’ll decide, and say what I assumed.</span>{btn("Skip", kind="ghost")}{btn("Send answers", kind="primary")}</div>
</div>'''
    body = (msg("You", "A product page for our Ethiopia Guji single origin. Lots of gift buyers, mostly on phones.", you=True)
            + tool_row("Read design system", "DESIGN.md · tokens.css · 14 components")
            + tool_row("Looked at the live store", "halden.coffee/products/guji · 3 screenshots")
            + msg("Design director", "I have your system and the current page. Four quick answers and I’ll start.")
            + form)
    placeholders = "".join(f'<div>{frame_label(n, s)}<div style="width:{w}px;height:{h}px;border-radius:2px;border:1px dashed var(--border-strong);display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--text-faint)">waiting for your answers</div></div>' for n, s, w, h in [("Desktop", "1440", 317, 260), ("Tablet", "768", 169, 225), ("Mobile", "390", 117, 253)])
    canvas = f'''<div style="flex:1;min-width:0;display:flex;flex-direction:column">
  {canvas_toolbar("Untitled · product page")}
  <div style="flex:1;position:relative;overflow:hidden;{canvas_bg_style()}"><div style="position:absolute;left:32px;top:32px;display:flex;gap:28px">{placeholders}</div>{zoom_controls("22%")}</div>
</div>'''
    sb = sidebar(designs=[("E-commerce", [("Untitled · product page", "draft", None, "")])], selected="Untitled · product page")
    return shell(sb + canvas + thread(body, status=state_word("waiting on you", "warn")))
boards["03-Questions.dc.html"] = ("New design · the director asks first", b_questions)

# ---- 4. Generating
def b_generating():
    shimmer = lambda w, h: f'<div style="width:{w}px;height:{h}px;border-radius:2px;background:var(--fill-subtle);box-shadow:var(--frame-shadow);position:relative;overflow:hidden"><div style="position:absolute;inset:0;background:var(--fill-hover);animation:shimmer 1.6s ease-in-out infinite"></div><div style="position:absolute;left:16px;top:16px;right:16px;display:flex;flex-direction:column;gap:10px"><span style="height:10px;width:40%;border-radius:3px;background:var(--fill-hover)"></span><span style="height:120px;border-radius:3px;background:var(--fill-hover)"></span><span style="height:10px;width:70%;border-radius:3px;background:var(--fill-hover)"></span></div></div>'
    frames = f'''<div style="position:absolute;left:32px;top:32px;display:flex;gap:28px;align-items:flex-start">
  <div>{frame_label("Desktop", "1440", state=state_word("in review", "neutral"))}{scaled(pdp_desktop(mark=("purchase", "#d4b06a", "Gift option isn’t named", .22, "left")), 1440, 1180, .22)}</div>
  <div>{frame_label("Tablet", "768", state=f'<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--state-neutral)">{dot("var(--state-neutral)", True)}rendering</span>')}{shimmer(169, 225)}</div>
  <div>{frame_label("Mobile", "390", state='<span style="font-size:11px;color:var(--text-faint)">queued</span>')}<div style="width:117px;height:253px;border-radius:2px;border:1px dashed var(--border-strong)"></div></div>
</div>'''
    canvas = f'''<div style="flex:1;min-width:0;display:flex;flex-direction:column">
  {canvas_toolbar()}
  <div style="flex:1;position:relative;overflow:hidden;{canvas_bg_style()}">{frames}
    <div style="position:absolute;left:50%;bottom:14px;transform:translateX(-50%);display:flex;align-items:center;gap:10px;height:32px;padding:0 12px;border-radius:16px;border:1px solid var(--border-hairline);background:var(--surface-overlay);box-shadow:var(--shadow-overlay)">
      {dot("var(--state-neutral)", True)}<span style="font-size:12px;color:var(--text-secondary)">Critique round 1 · 2 of 4 reviewers in</span><span style="{MONO};font-size:10.5px;color:var(--text-faint)">1:48</span><span style="font-size:11.5px;color:var(--text-muted)">Stop</span>
    </div>
    {zoom_controls("22%")}{minimap()}
  </div>
</div>'''
    body = (msg("You", "Gift buyers, mostly phone, quiet and exact but bold type. Use Halden.", you=True)
            + msg("Design director", "Plan: bag and price first, delivery promise beside Add to cart, subscription as a clear second choice. Building desktop first, then tablet and mobile.")
            + token_plan_card()
            + card(f'<div style="padding:4px 0">{tool_row("Write", "frames/desktop.html · 412 lines")}{tool_row("Render", "desktop @1440 · 1.2 s")}{tool_row("Write", "frames/tablet.html", "run")}{tool_row("Write", "frames/mobile.html", "queued")}</div>')
            + lint_card("fix") + critique_card("run"))
    working = [(k, [(n, "working" if n == "Product page · Ethiopia Guji" else st, ps, o) for n, st, ps, o in items]) for k, items in DESIGNS]
    return shell(sidebar(designs=working, selected="Product page · Ethiopia Guji") + canvas + thread(body, status=state_word("working", "neutral")))
boards["04-Generating.dc.html"] = ("Generating · lint gate and critique, live", b_generating)

# ---- 5. Canvas: selection + variations focus
def b_canvas():
    big = f'''<div style="position:absolute;left:40px;top:36px;display:flex;flex-direction:column;gap:14px">
  <div style="display:flex;align-items:center;gap:8px">{eyebrow("Hero · 3 directions")}<span style="font-size:11px;color:var(--text-faint)">drag to reorder, pick one to carry across breakpoints</span></div>
  <div style="display:flex;gap:28px;align-items:flex-start">
    <div>{frame_label("A · Product first", "1440", "8.4", sel=True)}<div style="position:relative;outline:2px solid var(--text-primary);outline-offset:3px;border-radius:2px">{scaled(hero_variant("A"), 1440, 720, .22)}
      <span style="position:absolute;left:-5px;top:-5px;width:8px;height:8px;background:var(--surface-app);border:1.5px solid var(--text-primary)"></span><span style="position:absolute;right:-5px;top:-5px;width:8px;height:8px;background:var(--surface-app);border:1.5px solid var(--text-primary)"></span><span style="position:absolute;left:-5px;bottom:-5px;width:8px;height:8px;background:var(--surface-app);border:1.5px solid var(--text-primary)"></span><span style="position:absolute;right:-5px;bottom:-5px;width:8px;height:8px;background:var(--surface-app);border:1.5px solid var(--text-primary)"></span>
    </div></div>
    <div>{frame_label("B · Tasting notes lead", "1440", "8.1")}{scaled(hero_variant("B"), 1440, 720, .22)}</div>
  </div>
  <div style="display:flex;gap:28px;align-items:flex-start">
    <div>{frame_label("C · Editorial", "1440", "7.7", passed=False)}{scaled(hero_variant("C"), 1440, 720, .22)}</div>
    <div style="width:317px;height:158px;margin-top:26px;border-radius:2px;border:1px dashed var(--border-strong);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:var(--text-muted)"><span style="display:flex">{G["wand"]}</span><span style="font-size:12px">Another direction</span><span style="font-size:11px;color:var(--text-faint)">or describe one in the thread</span></div>
  </div>
</div>
<div style="position:absolute;left:40px;top:460px;display:flex;flex-direction:column;gap:2px;padding:4px;border-radius:10px;border:1px solid var(--border-hairline);background:var(--surface-overlay);box-shadow:var(--shadow-overlay);width:220px">
  {"".join(f'<div style="display:flex;align-items:center;gap:8px;height:28px;padding:0 8px;border-radius:6px;{"background:var(--fill-hover)" if i==0 else ""};font-size:12px;color:var(--text-primary)"><span style="flex:1">{t}</span><span style="{MONO};font-size:10.5px;color:var(--text-faint)">{k}</span></div>' for i,(t,k) in enumerate([("Use A across breakpoints","↵"),("Blend: A layout, B headline",""),("More like this","⌘D"),("Compare side by side","⌘\\\\"),("Show critique","S")]))}
</div>'''
    canvas = f'''<div style="flex:1;min-width:0;display:flex;flex-direction:column">
  {canvas_toolbar()}
  <div style="flex:1;position:relative;overflow:hidden;{canvas_bg_style()}">{big}{zoom_controls("22%")}{minimap()}</div>
</div>'''
    body = (msg("You", "Show me three hero directions before you do the rest.", you=True)
            + msg("Design director", "Three directions on the same tokens. A leads with the bag and price, B with the taste, C is editorial. C scores lowest because the price sits under a 140 px headline on mobile.")
            + critique_card("done"))
    return shell(sidebar() + canvas + thread(body))
boards["05-Canvas.dc.html"] = ("The canvas · variations, selection, actions", b_canvas)

# ---- 6. Scorecard
def b_scorecard():
    def reviewer(name, sc, focus, notes):
        v = float(sc)
        n = "".join(f'<li style="margin:0 0 4px;font-size:12px;line-height:1.5;color:var(--text-secondary)">{x}</li>' for x in notes)
        return f'''<div style="padding:12px 16px;border-top:1px solid var(--divider)">
  <div style="display:flex;align-items:center;gap:8px"><span style="font-size:13px;font-weight:600">{name}</span><span style="font-size:11px;color:var(--text-faint);flex:1">{focus}</span><span style="{MONO};font-size:15px;color:{"var(--state-success)" if v>=8 else "var(--state-warn)"}">{sc}</span></div>
  <div style="height:3px;border-radius:2px;background:var(--fill-hover);margin:8px 0"><span style="display:block;height:100%;width:{int(v*10)}%;border-radius:2px;background:{"var(--state-success)" if v>=8 else "var(--state-warn)"}"></span></div>
  <ul style="margin:0;padding-left:16px">{n}</ul>
</div>'''
    findings = [("minor", "Review count link has no focus style", "frames/desktop.html · a.reviews"), ("minor", "Two raw hex values outside the system", "frames/desktop.html:188"), ("minor", "Thumbnails lack visible focus ring", "frames/desktop.html · .thumb")]
    frows = "".join(f'<div style="display:flex;align-items:flex-start;gap:8px;padding:8px 16px;{"background:var(--fill-hover)" if i==0 else ""}"><span style="margin-top:4px">{dot("var(--state-warn)")}</span><div style="flex:1;min-width:0"><div style="font-size:12px;color:var(--text-primary)">{t}</div><div style="{MONO};font-size:10.5px;color:var(--text-faint)">{loc}</div></div><span style="font-size:11px;color:var(--text-secondary);white-space:nowrap">Fix</span></div>' for i, (sev, t, loc) in enumerate(findings))
    panel = f'''<div style="width:392px;flex-shrink:0;display:flex;flex-direction:column;border-left:1px solid var(--border-hairline);background:var(--surface-panel);box-sizing:border-box">
  <div style="height:40px;display:flex;align-items:center;gap:8px;padding:0 12px 0 16px;border-bottom:1px solid var(--border-hairline);box-sizing:border-box"><span style="font-size:12.5px;font-weight:600">Scorecard</span><span style="font-size:11.5px;color:var(--text-faint)">Desktop · round 2</span><span style="flex:1"></span><span style="width:24px;height:24px;display:flex;align-items:center;justify-content:center;color:var(--text-faint)">{G["x"]}</span></div>
  <div style="flex:1;overflow:hidden">
    <div style="padding:16px;display:flex;align-items:flex-end;gap:14px">
      <span style="{MONO};font-size:44px;line-height:1;color:var(--text-primary);letter-spacing:-.02em">8.4</span>
      <div style="display:flex;flex-direction:column;gap:4px;padding-bottom:4px">{state_word("passed · bar is 8.0", "success")}<span style="font-size:11px;color:var(--text-faint)">weighted: art 0.3 · UX 0.35 · a11y 0.2 · copy 0.15</span></div>
    </div>
    <div style="display:flex;align-items:flex-end;gap:6px;height:44px;padding:0 16px 12px">{"".join(f'<div style="display:flex;flex-direction:column;align-items:center;gap:3px"><span style="width:18px;height:{int((float(s)-6)*14)}px;border-radius:2px;background:{"var(--state-success)" if float(s)>=8 else "var(--fill-hover)"}"></span><span style="{MONO};font-size:9px;color:var(--text-faint)">r{i+1}</span></div>' for i,s in enumerate(["7.6","8.4"]))}<span style="font-size:11px;color:var(--text-faint);margin-left:6px;padding-bottom:12px">7.6 → 8.4 in 2 rounds · 4 min 10 s</span></div>
    {reviewer("UX director", "8.1", "Nielsen heuristics · e-com rules", ["Delivery date and shipping cost sit beside Add to cart.", "Per-weight price shown, which buyers compare across sizes.", "Gift buyers can’t tell a gift note is possible until checkout."])}
    {reviewer("Art director", "8.6", "craft, type, brand fit", ["Type scale holds from 64 to 38 px without crowding.", "Sage product field makes the bag the only saturated object."])}
    {reviewer("Accessibility", "9.0", "WCAG 2.2 AA, focus, targets", ["Every text pair passes 4.5:1; buttons are 44 px or taller."])}
    {reviewer("Copy", "7.8", "clarity, voice", ["“Tastes like” beats “Notes” for new buyers.", "Name the gift option on the page."])}
    <div style="padding:12px 16px 6px;border-top:1px solid var(--divider);display:flex;align-items:center;gap:8px">{eyebrow("Lint findings")}<span style="flex:1"></span><span style="{MONO};font-size:10.5px;color:var(--text-faint)">0 severe · 3 minor</span></div>
    {frows}
  </div>
  <div style="display:flex;gap:8px;padding:12px 16px;border-top:1px solid var(--border-hairline)">{btn("Fix all minor", kind="secondary", size="md")}{btn("Ask for round 3", kind="ghost", size="md")}</div>
</div>'''
    frames = f'''<div style="position:absolute;left:40px;top:40px">
  {frame_label("Desktop", "1440", "8.4", sel=True)}
  <div style="position:relative">{scaled(pdp_desktop(mark=("reviews", "#d4b06a", "Review count link has no focus style", .46, "right")), 1440, 1180, .46)}
  </div>
</div>'''
    canvas = f'''<div style="flex:1;min-width:0;display:flex;flex-direction:column">
  {canvas_toolbar(tab="score")}
  <div style="flex:1;position:relative;overflow:hidden;{canvas_bg_style()}">{frames}{zoom_controls("46%")}</div>
</div>'''
    return shell(sidebar() + canvas + panel)
boards["06-Scorecard.dc.html"] = ("Scorecard · reviewers and lint, pinned to the frame", b_scorecard)

# ---- 7. History
def b_history():
    versions = [("v7", "Gift note toggle added", "8.6", "now", True), ("v6", "Round 2 fixes: per-weight price, delivery date", "8.4", "12 min", False), ("v5", "Hero direction A carried across", "7.6", "18 min", False), ("v4", "Three hero directions", "—", "24 min", False), ("v3", "Mobile sticky Add to cart", "7.1", "31 min", False), ("v2", "First full draft", "6.8", "38 min", False), ("v1", "Brief and token plan", "—", "40 min", False)]
    rows = ""
    for i, (v, t, s, ago, cur) in enumerate(versions):
        compare = i in (0, 2)
        st = "background:var(--fill-hover)" if compare else ""
        rows += f'''<div style="display:flex;gap:10px;padding:0 16px;{st}">
  <div style="display:flex;flex-direction:column;align-items:center;width:10px"><span style="width:1px;height:12px;background:{"transparent" if i==0 else "var(--border-strong)"}"></span><span style="width:9px;height:9px;border-radius:50%;{"background:var(--text-primary)" if cur else "border:1.5px solid var(--text-muted);box-sizing:border-box"}"></span><span style="width:1px;flex:1;background:{"transparent" if i==len(versions)-1 else "var(--border-strong)"}"></span></div>
  <div style="flex:1;padding:8px 0;display:flex;flex-direction:column;gap:3px">
    <div style="display:flex;align-items:center;gap:8px"><span style="{MONO};font-size:11px;color:var(--text-secondary)">{v}</span><span style="font-size:11px;color:var(--text-faint)">{ago}</span><span style="flex:1"></span>{score_chip(s, s=="—" or float(s)>=8) if s!="—" else ""}{chip("comparing") if compare else ""}</div>
    <span style="font-size:12.5px;color:var(--text-primary)">{t}</span>
  </div>
</div>'''
    panel = f'''<div style="width:392px;flex-shrink:0;display:flex;flex-direction:column;border-left:1px solid var(--border-hairline);background:var(--surface-panel);box-sizing:border-box">
  <div style="height:40px;display:flex;align-items:center;gap:8px;padding:0 12px 0 16px;border-bottom:1px solid var(--border-hairline);box-sizing:border-box"><span style="font-size:12.5px;font-weight:600">History</span><span style="font-size:11.5px;color:var(--text-faint)">one snapshot per director turn</span><span style="flex:1"></span><span style="width:24px;height:24px;display:flex;align-items:center;justify-content:center;color:var(--text-faint)">{G["x"]}</span></div>
  <div style="flex:1;overflow:hidden;padding:6px 0">{rows}</div>
  <div style="padding:12px 16px;border-top:1px solid var(--border-hairline);display:flex;flex-direction:column;gap:8px">
    <span style="font-size:11.5px;line-height:1.5;color:var(--text-muted)">Restoring makes v5 the newest version. Nothing is deleted, and the files are saved with the project.</span>
    <div style="display:flex;gap:8px">{btn("Restore v5", kind="primary", size="md", icon=G["restore"])}{btn("Branch from v5", size="md")}</div>
  </div>
</div>'''
    split = f'''<div style="position:absolute;inset:0;display:flex">
  <div style="flex:1;position:relative;overflow:hidden;border-right:1px solid var(--border-strong)"><div style="position:absolute;left:40px;top:56px">{frame_label("v5 · 18 min ago", "1440", "7.6", passed=False)}{scaled(pdp_desktop(), 1440, 1180, .22)}</div><span style="position:absolute;left:40px;top:20px">{chip("v5", mono=True)}</span></div>
  <div style="flex:1;position:relative;overflow:hidden"><div style="position:absolute;left:40px;top:56px">{frame_label("v7 · now", "1440", "8.6", sel=True)}{scaled(pdp_desktop(gift=True, mark=("gift", "#7fae8a", "changed: gift note added", .22, "left")), 1440, 1180, .22)}</div><span style="position:absolute;left:40px;top:20px">{chip("v7 · current", mono=True)}</span></div>
  <div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:30px;height:30px;border-radius:50%;background:var(--surface-overlay);border:1px solid var(--border-strong);display:flex;align-items:center;justify-content:center;color:var(--text-secondary);font-size:12px">⇆</div>
</div>'''
    canvas = f'''<div style="flex:1;min-width:0;display:flex;flex-direction:column">
  {canvas_toolbar(tab="history")}
  <div style="flex:1;position:relative;overflow:hidden;{canvas_bg_style()}">{split}</div>
</div>'''
    later = [(k, [(n, "8.6" if n == "Product page · Ethiopia Guji" else st, ps, o) for n, st, ps, o in items]) for k, items in DESIGNS]
    return shell(sidebar(designs=later) + canvas + panel)
boards["07-History.dc.html"] = ("History · compare and restore", b_history)

# ---- 8. Design system
def b_system():
    colors = [("ink", HD["ink"], "text, primary action"), ("stone", HD["bg"], "page ground"), ("roast", HD["accent"], "accent, one per view"), ("sage", HD["sage"], "product field"), ("pine", HD["deep"], "feature bands"), ("muted", HD["muted"], "secondary text"), ("line", HD["line"], "dividers, fields"), ("card", HD["card"], "raised surface")]
    crow = "".join(f'<div style="display:flex;flex-direction:column;gap:6px"><span style="height:56px;border-radius:8px;background:{c};box-shadow:inset 0 0 0 1px rgba(128,128,128,.22)"></span><div style="display:flex;align-items:baseline;gap:6px"><span style="font-size:12px;font-weight:500">{n}</span><span style="{MONO};font-size:9.5px;color:var(--text-faint)">{c}</span></div><span style="font-size:11px;color:var(--text-muted)">{u}</span></div>' for n, c, u in colors)
    scale = [("Display", "64 / 1.0 · 700", 40, DISP), ("H2", "34 / 1.1 · 500", 28, DISP), ("Title", "22 / 1.3 · 500", 20, DISP), ("Body", "15 / 1.5 · 400", 15, BODY), ("Caption", "13 / 1.4 · 400", 13, BODY)]
    srow = "".join(f'<div style="display:flex;align-items:baseline;gap:16px;padding:8px 0;border-top:1px solid var(--divider)"><span style="width:80px;font-size:11.5px;color:var(--text-muted)">{n}</span><span style="{f};font-size:{px}px;font-weight:{"700" if n=="Display" else "500" if f==DISP else "400"};flex:1;white-space:nowrap;overflow:hidden">Guji</span><span style="{MONO};font-size:10.5px;color:var(--text-faint)">{spec}</span></div>' for n, spec, px, f in scale)
    sp = "".join(f'<div style="display:flex;flex-direction:column;align-items:flex-start;gap:4px"><span style="width:{v}px;height:{v}px;background:var(--fill-hover);border-radius:2px"></span><span style="{MONO};font-size:10px;color:var(--text-faint)">{v}</span></div>' for v in [4, 8, 12, 16, 24, 32, 48, 64])
    comps = f'''<div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;padding:16px;border-radius:10px;background:{HD["bg"]};{BODY}">
  <span style="height:48px;padding:0 22px;border-radius:8px;background:{HD["ink"]};color:{HD["bg"]};display:flex;align-items:center;font-size:15px;font-weight:600">Add to cart</span>
  <span style="height:48px;padding:0 22px;border-radius:8px;border:1px solid {HD["ink"]};color:{HD["ink"]};display:flex;align-items:center;font-size:15px">Subscribe</span>
  <span style="height:44px;padding:0 16px;border-radius:6px;border:1px solid {HD["ink"]};background:#fff;color:{HD["ink"]};display:flex;align-items:center;font-size:14px">250 g</span>
  <span style="height:44px;padding:0 16px;border-radius:6px;border:1px solid {HD["line"]};color:{HD["ink"]};display:flex;align-items:center;font-size:14px">500 g</span>
  <span style="height:24px;padding:0 9px;border-radius:12px;background:{HD["sage"]};color:{HD["deep"]};display:flex;align-items:center;font-size:12px;font-weight:600">Harvest 2026</span>
  <span style="font-size:14px;color:{HD["accent"]}">★★★★★ <span style="color:{HD["ink"]};text-decoration:underline">4.8 · 312</span></span>
</div>'''
    sources = "".join(f'<div style="display:flex;align-items:center;gap:8px;height:28px"><span style="color:var(--state-success);display:flex">{G["check"]}</span><span style="{MONO};font-size:11px;color:var(--text-secondary);flex:1">{p}</span><span style="font-size:11px;color:var(--text-faint)">{d}</span></div>' for p, d in [("src/styles/tokens.css", "8 colors, 5 type steps"), ("tailwind.config.ts", "spacing, radii"), ("src/components/ui/*", "14 components"), ("halden.coffee", "logo, photography style")])
    main = f'''<div style="flex:1;min-width:0;display:flex;flex-direction:column">
  {canvas_toolbar(tab="system")}
  <div style="flex:1;overflow:hidden;display:flex">
    <div style="flex:1;min-width:0;overflow:hidden;padding:24px 32px;display:flex;flex-direction:column;gap:22px">
      <div style="display:flex;align-items:flex-end;gap:12px">
        <div style="display:flex;flex-direction:column;gap:6px;flex:1">{eyebrow("Design system")}<span style="font-size:22px;font-weight:600;letter-spacing:-.01em">Halden</span><span style="font-size:12.5px;color:var(--text-muted)">Quiet and exact. One accent per view; the product is the only saturated object.</span></div>
        <span style="{MONO};font-size:11px;color:var(--text-faint)">.chronicle/designs/DESIGN.md</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px">{eyebrow("Color")}<div style="display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:12px">{crow}</div></div>
      <div style="display:flex;gap:32px">
        <div style="flex:1.4;display:flex;flex-direction:column;gap:6px">{eyebrow("Type · Bricolage Grotesque over IBM Plex Sans")}{srow}</div>
        <div style="flex:1;display:flex;flex-direction:column;gap:10px">{eyebrow("Spacing · radius 6 / 8 / 12")}<div style="display:flex;align-items:flex-end;gap:12px">{sp}</div>{eyebrow("Components", "margin-top:12px")}{comps}</div>
      </div>
    </div>
    <div style="width:340px;flex-shrink:0;border-left:1px solid var(--border-hairline);padding:20px;display:flex;flex-direction:column;gap:14px;background:var(--surface-panel)">
      <div style="display:flex;align-items:center;gap:8px">{eyebrow("Read from")}<span style="flex:1"></span>{state_word("in sync", "success")}</div>
      <div>{sources}</div>
      <div style="padding:10px 12px;border-radius:8px;background:var(--fill-subtle);display:flex;flex-direction:column;gap:6px">
        <span style="font-size:12px;font-weight:500">Kept in step with the code</span>
        <span style="font-size:11.5px;line-height:1.5;color:var(--text-muted)">When these files change, the director updates DESIGN.md and tells you which designs drifted. Last checked when you saved <span style="{MONO};font-size:10.5px">tokens.css</span> 2 h ago.</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:8px;border:1px solid var(--border-hairline)">{dot("var(--state-warn)")}<span style="font-size:12px;flex:1">2 designs use an old radius</span><span style="font-size:11.5px;color:var(--text-secondary)">Update them</span></div>
      <span style="flex:1"></span>
      <div style="display:flex;gap:8px">{btn("Edit with the director", size="md")}{btn("Import from Figma", kind="ghost", size="md")}</div>
    </div>
  </div>
</div>'''
    return shell(sidebar() + main)
boards["08-System.dc.html"] = ("Design system · read from the code, kept in sync", b_system)

# ---- 9. Errors and limits
def b_errors():
    def panel(title, sub, content):
        return f'<div style="display:flex;flex-direction:column;gap:10px"><div style="display:flex;flex-direction:column;gap:3px"><span style="font-size:13px;font-weight:600">{title}</span><span style="font-size:11.5px;color:var(--text-faint)">{sub}</span></div><div style="border-radius:10px;border:1px solid var(--border-hairline);background:var(--surface-panel);overflow:hidden">{content}</div></div>'
    limit = panel("Usage limit reached", "Claude plan limit; the work so far is saved",
        f'''<div style="padding:10px 0">{msg("Design director", "Tablet and mobile are drawn. I stopped before critique round 2.")}
  <div style="margin:4px 14px 10px 50px;display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border-radius:8px;border:1px solid var(--border-hairline);background:var(--surface-card)"><span style="color:var(--state-warn);margin-top:1px;display:flex">{G["error"]}</span><div style="display:flex;flex-direction:column;gap:6px;flex:1"><span style="font-size:12.5px">Your Claude plan’s 5-hour limit is used up.</span><span style="font-size:11.5px;color:var(--text-muted)">It resets at 4:10 pm. Everything up to v5 is saved. Continue then, or keep going on extra usage.</span><div style="display:flex;gap:8px;margin-top:2px">{btn("Remind me at 4:10")}{btn("Use extra usage", kind="ghost")}</div></div></div></div>''')
    render = panel("A frame didn’t render", "the HTML has an error the browser rejected",
        f'''<div style="height:208px;position:relative;{canvas_bg_style()}"><div style="position:absolute;left:24px;top:22px">{frame_label("Mobile", "390", state=state_word("didn’t render", "error"))}<div style="width:240px;height:150px;border-radius:2px;border:1px solid var(--border-strong);background:var(--surface-card);display:flex;flex-direction:column;gap:8px;padding:14px;box-sizing:border-box"><span style="font-size:12px">The page stopped at line 214.</span><span style="{MONO};font-size:10.5px;color:var(--text-faint);line-height:1.5">Unexpected token ‘}}’ in frames/mobile.html:214</span><div style="display:flex;gap:6px;margin-top:auto">{btn("Ask the director to fix it", kind="primary")}</div></div></div>
  <div style="position:absolute;right:24px;top:48px;width:200px;font-size:11.5px;line-height:1.55;color:var(--text-muted)">The other frames keep their last good version. The director already has the error; one click sends it.</div></div>''')
    tools = panel("Getting the review tools ready", "first design on this Mac: one-time download",
        f'''<div style="padding:14px 16px;display:flex;flex-direction:column;gap:10px">
  <div style="display:flex;align-items:center;gap:10px"><span style="font-size:12.5px;flex:1">Browser for rendering and screenshots</span><span style="{MONO};font-size:11px;color:var(--text-faint)">112 of 164 MB</span></div>
  <div style="height:3px;border-radius:2px;background:var(--fill-hover)"><span style="display:block;width:68%;height:100%;border-radius:2px;background:var(--state-neutral)"></span></div>
  <div style="display:flex;flex-direction:column;gap:2px">{tool_row("Design skills", "impeccable · frontend-design · e-com rules")}{tool_row("Icons", "iconify")}{tool_row("Browser", "playwright · chromium", "run")}{tool_row("Lighthouse checks", "chrome devtools", "queued")}</div>
  <span style="font-size:11.5px;color:var(--text-muted)">The director can start writing now. Review scores appear once the browser is ready.</span>
</div>''')
    notpass = panel("Critique didn’t pass after 3 rounds", "shows the best round and why, instead of looping",
        f'''<div style="padding:14px 16px;display:flex;flex-direction:column;gap:10px">
  <div style="display:flex;align-items:center;gap:10px"><span style="{MONO};font-size:28px;line-height:1;color:var(--state-warn)">7.7</span><div style="display:flex;flex-direction:column;gap:2px">{state_word("below the bar of 8.0", "warn")}<span style="font-size:11px;color:var(--text-faint)">best of 3 rounds · round 2 · 7.4 → 7.7 → 7.6</span></div></div>
  <div style="font-size:12px;line-height:1.55;color:var(--text-secondary)">The UX director keeps flagging the same trade-off: your brief asks for a 140 px headline, which pushes price and Add to cart below the fold on phones.</div>
  <div style="display:flex;flex-wrap:wrap;gap:8px">{btn("Keep the headline, accept 7.7")}{btn("Let the price move up", kind="primary")}{btn("Lower the bar for this design", kind="ghost")}</div>
</div>''')
    body = f'''<div style="flex:1;min-width:0;padding:28px 32px;overflow:hidden;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:28px;align-content:start">{limit}{render}{tools}{notpass}</div>'''
    return shell(sidebar() + body)
boards["09-Errors.dc.html"] = ("Errors and limits · each says what happened and the one next step", b_errors)

# ---- 10. Setup & health · Design group
def b_setup():
    def icon_box(inner):
        return f'<span style="width:30px;height:30px;border-radius:8px;border:1px solid var(--border-hairline);background:var(--fill-subtle);display:flex;align-items:center;justify-content:center;color:var(--text-subtle);flex-shrink:0">{inner}</span>'
    def ready(word="ready"):
        return f'<span style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:var(--state-success);white-space:nowrap">{G["check"]}{word}</span>'
    def optional():
        return f'<span style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:var(--text-muted);white-space:nowrap"><span style="width:6px;height:6px;border-radius:50%;border:1px solid var(--text-dim);box-sizing:border-box"></span>optional</span>'
    def row(ic, name, blurb, state, action="", extra="", first=False):
        return f'<div style="display:flex;align-items:flex-start;gap:15px;padding:15px 0;{"" if first else "border-top:1px solid var(--divider)"}">{icon_box(ic)}<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:6px"><span style="font-size:13px;font-weight:500">{name}</span><span style="font-size:12px;line-height:1.45;color:var(--text-faint)">{blurb}</span>{extra}</div>{state}{action}</div>'
    def bigbtn(t, quiet=False):
        st = "border:1px solid var(--border-hairline);color:var(--text-muted)" if quiet else "border:1px solid var(--border-strong);color:var(--text-primary)"
        return f'<button type="button" style="height:33px;padding:0 14px;border-radius:8px;background:transparent;{st};font-size:12.5px;font-weight:500;{SANS};white-space:nowrap;flex-shrink:0">{t}</button>'
    summary = f'<div style="display:flex;align-items:center;gap:15px;padding:12px 15px;border-radius:8px;border:1px solid var(--border-hairline);background:var(--surface-card)">{icon_box(CLAUDE_STAR)}<div style="flex:1;display:flex;flex-direction:column;gap:3px"><span style="font-size:13px;font-weight:500">Chronicle’s own tools</span><span style="font-size:12px;color:var(--text-faint)">The AI, sign-in, its engine, your online home and 3 more</span></div>{ready("7 of 7 ready")}{G["chevd"]}</div>'
    progress = f'<div style="display:flex;align-items:center;gap:10px;margin-top:2px"><span style="flex:1;height:3px;border-radius:2px;background:var(--fill-hover)"><span style="display:block;width:68%;height:100%;border-radius:2px;background:var(--state-neutral)"></span></span><span style="{MONO};font-size:11px;color:var(--text-subtle)">112.0 of 164.0 MB</span></div>'
    installing = f'<span style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:var(--state-neutral);white-space:nowrap">{dot("var(--state-neutral)", True)}installing · 68%</span>'
    keyform = f"""<div style="display:flex;flex-direction:column;gap:10px;margin-top:4px;padding:12px;border-radius:8px;border:1px solid var(--border-hairline);background:var(--surface-card)">
      <div style="display:flex;gap:2px;padding:2px;border-radius:8px;border:1px solid var(--border-hairline);align-self:flex-start">{''.join(f'<span style="height:24px;padding:0 10px;border-radius:6px;display:flex;align-items:center;font-size:11.5px;{"background:var(--fill-hover);color:var(--text-primary)" if i==0 else "color:var(--text-muted)"}">{t}</span>' for i,t in enumerate(["OpenAI","Google","fal"]))}</div>
      <label style="display:flex;flex-direction:column;gap:6px"><span style="font-size:11.5px;color:var(--text-muted)">Your OpenAI key</span><span style="display:flex;align-items:center;height:33px;padding:0 10px;border-radius:8px;border:1px solid var(--border-field);background:var(--surface-input);{MONO};font-size:12px;color:var(--text-secondary)">sk-proj-••••••••••••••••4f2a</span></label>
      <div style="display:flex;align-items:center;gap:8px"><span style="font-size:11.5px;line-height:1.45;color:var(--text-faint);flex:1">Kept in your Mac’s Keychain. You pay OpenAI for each picture, usually a few cents.</span>{btn("Cancel", kind="ghost")}{btn("Save key", kind="primary")}</div>
    </div>"""
    figma = f'<span style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:var(--state-success);white-space:nowrap">{G["check"]}connected</span>'
    design = "".join([
        row(G["screen"], "A browser for checking designs", "Opens each design the way a visitor would and checks contrast and tap sizes. Downloaded once.", installing, bigbtn("Cancel", quiet=True), progress, first=True),
        row(G["wand"], "Design skills", "The director’s taste and review rules, including shopping-page guidelines.", ready()),
        row(G["image"], "Pictures for your designs", "Photos and illustrations for marketing and brand work. Without a key, the director leaves labelled spaces.", optional(), "", keyform),
        row(svg('<rect x="5" y="1.8" width="3" height="4.1" rx="1.5"></rect><rect x="8" y="1.8" width="3" height="4.1" rx="1.5"></rect><rect x="5" y="5.9" width="3" height="4.1" rx="1.5"></rect><circle cx="9.5" cy="8" r="1.5"></circle><path d="M5 11.5a1.5 1.5 0 1 0 3 0V10H6.5A1.5 1.5 0 0 0 5 11.5z"></path>', size=14, sw="1.2"), "Figma", "Bring in a design system or frames, and send designs back. Signed in as tuneer@halden.coffee.", figma, bigbtn("Disconnect", quiet=True)),
        row(G["search"], "Mobbin", "Lets the director study how real apps handle a flow before drawing it. Needs a Mobbin plan.", optional(), bigbtn("Connect")),
    ])
    return f"""<div style="height:44px;display:flex;align-items:center;gap:12px;padding:0 14px;border-bottom:1px solid var(--divider);box-sizing:border-box">{lights()}<span style="flex:1"></span><span style="height:26px;padding:0 10px;border-radius:6px;display:flex;align-items:center;font-size:11.5px;color:var(--text-muted)">Done</span></div>
<div style="height:{H-44}px;overflow:hidden;display:flex;justify-content:center">
  <div style="width:640px;padding:24px 32px;display:flex;flex-direction:column;gap:14px;box-sizing:content-box">
    <div style="display:flex;flex-direction:column;gap:6px"><span style="font-size:20px;font-weight:600">Setup &amp; health</span><span style="font-size:12.5px;line-height:1.6;color:var(--text-muted);max-width:46ch">Everything Chronicle needs, in one place. Open this any time something stops working and re-check.</span></div>
    {summary}
    <div style="display:flex;flex-direction:column;gap:2px"><div style="display:flex;align-items:baseline;gap:10px;padding-bottom:6px">{eyebrow("For the Design pane")}<span style="font-size:11.5px;color:var(--text-faint)">the first two are needed, the rest are up to you</span></div>{design}</div>
  </div>
</div>"""
boards["10-Setup.dc.html"] = ("Setup & health · the Design group (rail → pulse icon)", b_setup)

# ---- 11. Critique settings popover, from the composer chip
def b_review_popover():
    base = b_rest()
    def toggle(on=True):
        return f'<span style="width:30px;height:18px;border-radius:9px;background:{"var(--primary)" if on else "var(--fill-hover)"};position:relative;flex-shrink:0;display:inline-block"><span style="position:absolute;top:2px;{"right:2px" if on else "left:2px"};width:14px;height:14px;border-radius:50%;background:{"var(--primary-fg)" if on else "var(--text-dim)"}"></span></span>'
    def stepper(v):
        return f'<span style="display:inline-flex;align-items:center;height:28px;border-radius:8px;border:1px solid var(--border-field);background:var(--surface-input)"><span style="width:26px;text-align:center;color:var(--text-subtle)">−</span><span style="{MONO};font-size:12px;min-width:30px;text-align:center">{v}</span><span style="width:26px;text-align:center;color:var(--text-subtle)">+</span></span>'
    def line(label, sub, ctrl):
        return f'<div style="display:flex;align-items:center;gap:12px;padding:10px 14px;border-top:1px solid var(--divider)"><div style="flex:1;display:flex;flex-direction:column;gap:2px"><span style="font-size:12.5px">{label}</span><span style="font-size:11px;line-height:1.45;color:var(--text-faint)">{sub}</span></div>{ctrl}</div>'
    scope = f'<div style="display:flex;gap:2px;padding:2px;border-radius:8px;border:1px solid var(--border-hairline)">{"".join(f"<span style=\"flex:1;height:24px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:11.5px;{st}\">{t}</span>" for t,st in [("This design","background:var(--fill-hover);color:var(--text-primary)"),("All designs in halden-shop","color:var(--text-muted)")])}</div>'
    pop = f"""<div style="position:absolute;left:1060px;top:390px;width:340px;border-radius:10px;border:1px solid var(--border-strong);background:var(--surface-overlay);box-shadow:var(--shadow-overlay)">
  <div style="display:flex;flex-direction:column;gap:8px;padding:12px 14px"><span style="font-size:12.5px;font-weight:600">Review before you see it</span>{scope}</div>
  {line("Critique panel", "Four reviewers score each design. Off is faster and uses less of your plan.", toggle(True))}
  {line("Passing score", "Below this, the director tries again.", stepper("8.0"))}
  {line("Most rounds", "Then it shows its best round and why.", stepper("3"))}
  {line("Lint gate", "Blocks known AI-looking patterns and failed contrast.", toggle(True))}
  <div style="display:flex;align-items:center;gap:8px;padding:10px 14px;border-top:1px solid var(--divider)"><span style="font-size:11px;color:var(--text-faint);flex:1">Connections live in Setup &amp; health</span><span style="font-size:11.5px;color:var(--text-secondary);white-space:nowrap">Open</span></div>
</div>
<div style="position:absolute;left:1186px;top:767px;width:123px;height:24px;border-radius:13px;box-shadow:0 0 0 1.5px var(--text-primary)"></div>"""
    return base + pop
boards["11-Review-settings.dc.html"] = ("Review settings · from the composer’s critique chip", b_review_popover)

# ---------------------------------------------------------------- write
os.makedirs(ROOT, exist_ok=True)
layout = {}
order = []
COLS = 6
GAPX, ROWGAP = 80, 320
names = list(boards.keys())
for i, name in enumerate(names):
    title, fn = boards[name]
    with open(os.path.join(ROOT, name), "w") as f:
        f.write(page(fn()))
    r, c = divmod(i, COLS)
    layout[name] = {"x": c * (W + GAPX), "y": r * (H + ROWGAP), "w": W, "h": H, "title": title}
    order.append(name)

# Main.dc.html = entry: same as rest (the canvas names its first artboard Main)
os.rename(os.path.join(ROOT, "01-Rest.dc.html"), os.path.join(ROOT, "Main.dc.html"))
layout["Main.dc.html"] = layout.pop("01-Rest.dc.html")
order[0] = "Main.dc.html"

row_w = COLS * W + (COLS - 1) * GAPX
notes = {
    "row1": {"x": 0, "y": -300, "text": "Design pane · the loop: brief → questions → generate with review → canvas", "kind": "title1", "maxW": row_w},
    "row2": {"x": 0, "y": (H + ROWGAP) - 300, "text": "Scorecard, history, design system, errors, settings", "kind": "title1", "maxW": row_w},
}
canvas = {"v": 3, "createdOnFiles": {"v": 1, "at": "2026-09-16T21:37:26Z"}, "title": "Design pane comps", "launch": {"view": "canvas"}, "pages": [], "boards": layout, "order": order, "notes": notes, "designSystems": []}
with open(os.path.join(ROOT, "canvas.json"), "w") as f:
    json.dump(canvas, f, indent=1)
print("\n".join(sorted(os.listdir(ROOT))))
