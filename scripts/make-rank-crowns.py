#!/usr/bin/env python3
"""Draws the five rank crowns for the Stats fan (#145) as SVG. Gothic ink (white line art round dark
ink, hatching on the shadow side), spires with gems, metal by medal, gems by rank, an icy pave row and
glints. Number one is the grandest (five spires). Each rank has a full drawing and a simpler small one
for under 64px.

Outputs (crown-1.svg .. crown-5.svg and crown-1-small.svg .. crown-5-small.svg):
  apps/web/public/crowns/

Usage: python3 -I scripts/make-rank-crowns.py apps/web/public/crowns [--preview]
  --preview also writes preview.html into the out dir (keep that out of the repo).
"""
import sys, os

OUT = sys.argv[1]
PREVIEW = "--preview" in sys.argv[2:]
os.makedirs(OUT, exist_ok=True)

METALS = {
    "gold":   ["#fffbe6", "#ffe58a", "#e8b030", "#fff6cc", "#c08414", "#6a4206"],
    "silver": ["#ffffff", "#eef2f7", "#aeb7c4", "#ffffff", "#7d8797", "#343a46"],
    "bronze": ["#fff0e0", "#f2b880", "#b0682e", "#fde0c2", "#8c4a1c", "#43210a"],
}
GEMS = {
    "ruby":     ("#ff3148", "#ffa3ad", "#7d0414"),
    "sapphire": ("#2f97ff", "#b3e0ff", "#082f78"),
    "emerald":  ("#14cf83", "#aaf7d6", "#04512f"),
    "amethyst": ("#a052ff", "#dfc2ff", "#3f0f85"),
    "rose":     ("#ff55b0", "#ffc8e7", "#86104f"),
}
RANKS = [(1, "gold", "ruby"), (2, "silver", "sapphire"), (3, "bronze", "emerald"), (4, "silver", "amethyst"), (5, "silver", "rose")]
INK = "#120e17"

def f(n):
    return f"{n:.2f}".rstrip("0").rstrip(".")

def spire(bl, br, tx, ty, by, bend=0.55):
    """A gothic spire: concave sides that flare at the base and pinch to a sharp tip."""
    cx = (bl + br) / 2
    h = by - ty
    return (f"M{f(bl)} {f(by)} "
            f"C{f(bl + (cx - bl) * 0.55)} {f(by - h * 0.25)} {f(tx - (tx - bl) * bend * 0.35)} {f(ty + h * 0.45)} {f(tx)} {f(ty)} "
            f"C{f(tx + (br - tx) * bend * 0.35)} {f(ty + h * 0.45)} {f(br - (br - cx) * 0.55)} {f(by - h * 0.25)} {f(br)} {f(by)} Z")

def gem(cx, cy, w, h, key, gid):
    base, light, dark = GEMS[key]
    t, b, l, r = cy - h * 0.5, cy + h * 0.5, cx - w * 0.5, cx + w * 0.5
    g = cy - h * 0.1
    return (f'<path d="M{f(cx)} {f(t)} L{f(r)} {f(g)} L{f(cx)} {f(b)} L{f(l)} {f(g)} Z" fill="url(#{gid})" stroke="{INK}" stroke-width="1.5" stroke-linejoin="round"/>'
            f'<path d="M{f(cx)} {f(t)} L{f(r)} {f(g)} L{f(cx)} {f(g + h * .1)} Z" fill="{light}" opacity=".6"/>'
            f'<path d="M{f(l)} {f(g)} L{f(cx)} {f(g + h * .1)} L{f(cx)} {f(b)} Z" fill="{dark}" opacity=".6"/>'
            f'<path d="M{f(l)} {f(g)} L{f(r)} {f(g)}" stroke="{INK}" stroke-width=".6" opacity=".55"/>'
            f'<circle cx="{f(cx - w * .17)}" cy="{f(g - h * .16)}" r="{f(max(.8, w * .1))}" fill="#fff"/>')

def stud(cx, cy, r):
    return (f'<circle cx="{f(cx)}" cy="{f(cy)}" r="{f(r)}" fill="url(#ice)" stroke="{INK}" stroke-width=".8"/>'
            f'<circle cx="{f(cx - r * .35)}" cy="{f(cy - r * .35)}" r="{f(r * .38)}" fill="#fff"/>')

def sparkle(cx, cy, s, op=1.0):
    k = s * 0.14
    return (f'<path d="M{f(cx)} {f(cy - s)} C{f(cx + k)} {f(cy - k)} {f(cx + k)} {f(cy - k)} {f(cx + s)} {f(cy)} '
            f'C{f(cx + k)} {f(cy + k)} {f(cx + k)} {f(cy + k)} {f(cx)} {f(cy + s)} C{f(cx - k)} {f(cy + k)} {f(cx - k)} {f(cy + k)} {f(cx - s)} {f(cy)} '
            f'C{f(cx - k)} {f(cy - k)} {f(cx - k)} {f(cy - k)} {f(cx)} {f(cy - s)} Z" fill="#fff" opacity="{op}"/>')

def crown(rank, metal, gemkey):
    m = METALS[metal]
    grand = rank == 1
    # (base left, base right, tip x, tip y, base y, is_main)
    spires = [(14, 42, 19, 12, 60, True), (42, 78, 60, 2, 56, True), (78, 106, 101, 12, 60, True)]
    if grand:
        spires = [(34, 50, 41, 24, 58, False), (70, 86, 79, 24, 58, False)] + spires
    back = "M14 58 Q60 40 106 58 L104 64 Q60 50 16 64 Z"   # the inside of the band, seen between spires
    band = "M10 60 Q60 73 110 60 L108 78 Q60 93 12 78 Z"
    shapes = "".join(f'<path d="{spire(*s[:5])}"/>' for s in spires)
    # hatching only on each spire's shadow (right) side, clipped to that spire
    defs, hatch = [], []
    for i, (bl, br, tx, ty, by, main) in enumerate(spires):
        cid = f"s{rank}{i}"
        defs.append(f'<clipPath id="{cid}"><path d="{spire(bl, br, tx, ty, by)}"/></clipPath>')
        x0 = tx + 1.5
        lines = "".join(f'<path d="M{f(x)} {f(ty - 4)} L{f(x - 9)} {f(by + 4)}"/>' for x in [x0 + j * 2.6 for j in range(int((br - x0) / 2.6) + 4)])
        hatch.append(f'<g clip-path="url(#{cid})">{lines}</g>')
    # white ink highlight along each spire's lit (left) edge
    lit = "".join(
        f'<path d="M{f(bl + 3)} {f(by - 3)} C{f(bl + (tx - bl) * .45 + 2)} {f(by - (by - ty) * .3)} {f(tx - (tx - bl) * .2 + 1)} {f(ty + (by - ty) * .4)} {f(tx + .4)} {f(ty + 4)}"/>'
        for (bl, br, tx, ty, by, main) in spires if main)
    gems, gdefs = [], []
    for i, (bl, br, tx, ty, by, main) in enumerate(spires):
        if not main:
            continue
        gid = f"g{rank}{i}"
        base, light, dark = GEMS[gemkey]
        gdefs.append(f'<radialGradient id="{gid}" cx="38%" cy="32%" r="78%"><stop offset="0" stop-color="{light}"/><stop offset=".45" stop-color="{base}"/><stop offset="1" stop-color="{dark}"/></radialGradient>')
        gx = tx + ((bl + br) / 2 - tx) * .55
        gy = by - (by - ty) * .36
        size = 19 if bl == 42 else 14.5
        gems.append(gem(gx, gy, size * .74, size, gemkey, gid))
    gid = f"g{rank}band"
    base, light, dark = GEMS[gemkey]
    gdefs.append(f'<radialGradient id="{gid}" cx="38%" cy="32%" r="78%"><stop offset="0" stop-color="{light}"/><stop offset=".45" stop-color="{base}"/><stop offset="1" stop-color="{dark}"/></radialGradient>')
    band_gem = gem(60, 74.5, 13, 15, gemkey, gid)
    pave = "".join(stud(x, 69.5 + 4.6 * (1 - ((x - 60) / 50) ** 2) - 0.5, 1.9 if grand else 1.7)
                   for x in ([18, 25, 32, 39, 46, 74, 81, 88, 95, 102] if grand else [22, 31, 40, 80, 89, 98]))
    glints = sparkle(60, 2, 7 if grand else 5) + sparkle(106, 30, 4, .9) + sparkle(13, 40, 3, .8) + (sparkle(84, 66, 3.2, .95) if grand else "")
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -8 128 108" width="128" height="108">
  <defs>
    <linearGradient id="m{rank}" x1="0" y1="0" x2="1" y2=".25">
      <stop offset="0" stop-color="{m[1]}"/><stop offset=".22" stop-color="{m[2]}"/><stop offset=".5" stop-color="{m[5]}"/>
      <stop offset="1" stop-color="#17121c"/>
    </linearGradient>
    <linearGradient id="b{rank}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="{m[3]}"/><stop offset=".3" stop-color="{m[1]}"/><stop offset=".65" stop-color="{m[4]}"/><stop offset="1" stop-color="{m[5]}"/>
    </linearGradient>
    <linearGradient id="in{rank}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{m[5]}"/><stop offset="1" stop-color="{m[4]}"/></linearGradient>
    <radialGradient id="ice" cx="35%" cy="35%" r="70%"><stop offset="0" stop-color="#fff"/><stop offset=".55" stop-color="#d6efff"/><stop offset="1" stop-color="#7895ad"/></radialGradient>
    {"".join(defs)}{"".join(gdefs)}
  </defs>
  <!-- white line art round the dark ink, as on the reference cover -->
  <g fill="none" stroke="#f4f1ea" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" stroke-dasharray="14 5 3 6" opacity=".7">{shapes}<path d="{band}"/></g>
  <path d="{back}" fill="url(#in{rank})" stroke="{INK}" stroke-width="2" stroke-linejoin="round"/>
  <g fill="url(#m{rank})" stroke="{INK}" stroke-width="2.4" stroke-linejoin="round">{shapes}</g>
  <g stroke="#f4f1ea" stroke-width=".5" opacity=".22">{"".join(hatch)}</g>
  <g fill="none" stroke="{m[0]}" stroke-width="1.4" stroke-linecap="round" opacity=".95">{lit}</g>
  <path d="{band}" fill="url(#b{rank})" stroke="{INK}" stroke-width="2.4" stroke-linejoin="round"/>
  <path d="M14 63.5 Q60 76 106 63.5" fill="none" stroke="#fff" stroke-width="1" opacity=".6"/>
  <path d="M15 76 Q60 89 105 76" fill="none" stroke="{INK}" stroke-width=".9" opacity=".55"/>
  {"".join(gems)}{pave}{band_gem}
  {glints}
</svg>'''

def crown_small(rank, metal, gemkey):
    m = METALS[metal]
    grand = rank == 1
    spires = [(14, 42, 19, 12, 60), (42, 78, 60, 2, 56), (78, 106, 101, 12, 60)]
    if grand:
        spires = [(34, 50, 41, 24, 58), (70, 86, 79, 24, 58)] + spires
    band = "M10 60 Q60 73 110 60 L108 80 Q60 95 12 80 Z"
    shapes = "".join(f'<path d="{spire(*s)}"/>' for s in spires)
    base, light, dark = GEMS[gemkey]
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -8 128 108" width="128" height="108">
  <defs>
    <linearGradient id="sm{rank}" x1="0" y1="0" x2="1" y2=".25"><stop offset="0" stop-color="{m[1]}"/><stop offset=".3" stop-color="{m[2]}"/><stop offset="1" stop-color="{m[5]}"/></linearGradient>
    <linearGradient id="sb{rank}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{m[3]}"/><stop offset=".4" stop-color="{m[1]}"/><stop offset="1" stop-color="{m[4]}"/></linearGradient>
    <radialGradient id="sg{rank}" cx="38%" cy="32%" r="78%"><stop offset="0" stop-color="{light}"/><stop offset=".45" stop-color="{base}"/><stop offset="1" stop-color="{dark}"/></radialGradient>
  </defs>
  <g fill="url(#sm{rank})" stroke="{INK}" stroke-width="5" stroke-linejoin="round">{shapes}</g>
  <path d="{band}" fill="url(#sb{rank})" stroke="{INK}" stroke-width="5" stroke-linejoin="round"/>
  <path d="M60 64 L71 76 L60 90 L49 76 Z" fill="url(#sg{rank})" stroke="{INK}" stroke-width="3.5" stroke-linejoin="round"/>
</svg>'''

for rank, metal, g in RANKS:
    with open(os.path.join(OUT, f"crown-{rank}.svg"), "w") as fh:
        fh.write(crown(rank, metal, g))
    with open(os.path.join(OUT, f"crown-{rank}-small.svg"), "w") as fh:
        fh.write(crown_small(rank, metal, g))
if PREVIEW:
    cells = "".join(f'<figure><img src="crown-{r}.svg" style="width:{w}px"><figcaption>#{r} full {w}px</figcaption></figure>' for w in (230, 96, 64) for r, m, g in RANKS)
    cells += "".join(f'<figure class="{bg}"><img src="crown-{r}-small.svg" style="width:{w}px"><figcaption>#{r} small {w}px</figcaption></figure>' for bg in ("dark", "pale") for w in (56, 30) for r, m, g in RANKS)
    with open(os.path.join(OUT, "preview.html"), "w") as fh:
        fh.write(f'<!doctype html><meta charset="utf-8"><style>body{{margin:0;padding:24px;background:#0e0b14;color:#9a95a3;font:12px -apple-system;display:grid;grid-template-columns:repeat(5,1fr);gap:16px;align-items:end}} figure{{margin:0;text-align:center;padding:8px 0;border-radius:6px}} .pale{{background:#efe3c8;color:#5b5040}} .dark{{background:#2a1f33}} img{{display:block;margin:0 auto 6px}}</style>{cells}')
print("ok")
