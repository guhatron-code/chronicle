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
