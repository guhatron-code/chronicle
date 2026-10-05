---
name: chronicle-icons
description: Lucide icons as inline SVG, bundled; no icon service.
---

The icon set is in `icons/`; `ICONS.txt` lists every name. Find one with `grep -i <word> ICONS.txt` (a read, no permission), then inline the SVG's contents into the page with `width`, `height`, `stroke="currentColor"` and `aria-hidden="true"`, or `role="img"` and a `<title>` when it carries meaning. Never link an icon font or CDN.
