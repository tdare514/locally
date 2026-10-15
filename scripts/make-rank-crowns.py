#!/usr/bin/env python3
"""Draws the five rank crowns for the Stats fan (#145) as SVG. Each spire is a dagger blade (a ridge,
a bright and a dark bevel, a needle tip, guard spikes at the base), barbed tattoo-style hooks sweep off
the band ends, and the band is bevelled metal with a cut gem. Metal by medal, gems by rank: gold and
ruby, silver and sapphire, bronze and emerald, silver and amethyst, silver and rose. Number one has
five blades. Each rank has a full drawing and a simpler small one for under 64px.

Outputs (crown-1.svg .. crown-5.svg and crown-1-small.svg .. crown-5-small.svg):
  apps/web/public/crowns/

Usage: python3 -I scripts/make-rank-crowns.py apps/web/public/crowns [--preview]
  --preview also writes preview.html into the out dir (keep that out of the repo).
"""
import sys, os, math

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
INK = "#0c0a10"
METALS = {
    #          specular   light      mid        dark       deep
    "gold":   ["#fffbe8", "#ffe07a", "#d9a024", "#8a5a0c", "#3d2604"],
    "silver": ["#ffffff", "#e8edf4", "#a9b3c1", "#5b6575", "#1f242d"],
    "bronze": ["#fff1e2", "#f0b37a", "#b56a2c", "#6e3612", "#2e1606"],
}
GEMS = {
    "ruby":     ("#ff2a44", "#ffb0b9", "#6e0010"),
    "sapphire": ("#2b8fff", "#bfe4ff", "#06286a"),
    "emerald":  ("#10c67c", "#b3f8da", "#03462a"),
    "amethyst": ("#9a48ff", "#e2c8ff", "#360a78"),
    "rose":     ("#ff4fac", "#ffcbe8", "#7a0c46"),
}
RANKS = [(1, "gold", "ruby"), (2, "silver", "sapphire"), (3, "bronze", "emerald"), (4, "silver", "amethyst"), (5, "silver", "rose")]

def f(n): return f"{n:.2f}".rstrip("0").rstrip(".")

def blade(bx, by, hw, tx, ty):
    """Returns (outline, left facet, right facet, ridge, edge streak) for a dagger blade with a needle tip."""
    h = by - ty
    # edges run nearly straight, pinching hard in the last fifth so the tip is a needle
    lx1, ly1 = bx - hw * 0.92, by - h * 0.45
    lx2, ly2 = tx - hw * 0.38 + (tx - bx) * 0.12, ty + h * 0.2
    rx1, ry1 = bx + hw * 0.92, by - h * 0.45
    rx2, ry2 = tx + hw * 0.38 + (tx - bx) * 0.12, ty + h * 0.2
    outline = (f"M{f(bx - hw)} {f(by)} C{f(lx1)} {f(ly1)} {f(lx2)} {f(ly2)} {f(tx)} {f(ty)} "
               f"C{f(rx2)} {f(ry2)} {f(rx1)} {f(ry1)} {f(bx + hw)} {f(by)} Z")
    left = (f"M{f(bx - hw)} {f(by)} C{f(lx1)} {f(ly1)} {f(lx2)} {f(ly2)} {f(tx)} {f(ty)} L{f(bx)} {f(by)} Z")
    right = (f"M{f(bx)} {f(by)} L{f(tx)} {f(ty)} C{f(rx2)} {f(ry2)} {f(rx1)} {f(ry1)} {f(bx + hw)} {f(by)} Z")
    ridge = f"M{f(bx)} {f(by)} L{f(tx)} {f(ty)}"
    streak = f"M{f(bx - hw * .55)} {f(by - 3)} C{f(bx - hw * .5)} {f(by - h * .4)} {f(tx - hw * .2)} {f(ty + h * .3)} {f(tx - .3)} {f(ty + 2.5)}"
    # guard spikes: two little sharp barbs flaring out of the blade's base
    gy = by - 2
    guard = (f"M{f(bx - hw * .85)} {f(gy)} L{f(bx - hw - 8)} {f(gy - 9)} L{f(bx - hw * .45)} {f(gy - 4)} Z "
             f"M{f(bx + hw * .85)} {f(gy)} L{f(bx + hw + 8)} {f(gy - 9)} L{f(bx + hw * .45)} {f(gy - 4)} Z") if hw >= 8 else ""
    return outline, left, right, ridge, streak, guard

def thorn(x, y, side, s):
    """A barbed thorn: a long hook that sweeps out and up from the band, with a second small barb
    on its inner curve, like cybersigil tattoo linework. side -1 left, 1 right."""
    tipx, tipy = x + side * s * 1.25, y - s * 1.55
    body = (f"M{f(x - side * s * .2)} {f(y)} C{f(x + side * s * .05)} {f(y - s * .7)} {f(x + side * s * .6)} {f(y - s * 1.15)} {f(tipx)} {f(tipy)} "
            f"C{f(x + side * s * .78)} {f(y - s * .95)} {f(x + side * s * .5)} {f(y - s * .45)} {f(x + side * s * .42)} {f(y)} Z")
    bx, by = x + side * s * .3, y - s * .62
    barb = f"M{f(bx)} {f(by)} L{f(bx - side * s * .42)} {f(by - s * .5)} L{f(bx + side * s * .08)} {f(by - s * .2)} Z"
    return body + " " + barb

def gem(cx, cy, w, h, key, gid):
    base, light, dark = GEMS[key]
    t, b, l, r = cy - h * .5, cy + h * .5, cx - w * .5, cx + w * .5
    g = cy - h * .12
    return (f'<path d="M{f(cx)} {f(t)} L{f(r)} {f(g)} L{f(cx)} {f(b)} L{f(l)} {f(g)} Z" fill="url(#{gid})" stroke="{INK}" stroke-width="1.3" stroke-linejoin="miter"/>'
            f'<path d="M{f(cx)} {f(t)} L{f(r)} {f(g)} L{f(cx + w * .12)} {f(g)} Z" fill="{light}" opacity=".75"/>'
            f'<path d="M{f(l)} {f(g)} L{f(cx)} {f(b)} L{f(cx - w * .1)} {f(g)} Z" fill="{dark}" opacity=".65"/>'
            f'<path d="M{f(cx - w * .14)} {f(t + h * .2)} L{f(cx - w * .02)} {f(g - h * .02)}" stroke="#fff" stroke-width="1" stroke-linecap="round"/>')

def glint(cx, cy, s, op=1.0):
    k = s * .1
    return (f'<path d="M{f(cx)} {f(cy - s)} L{f(cx + k)} {f(cy - k)} L{f(cx + s)} {f(cy)} L{f(cx + k)} {f(cy + k)} L{f(cx)} {f(cy + s)} '
            f'L{f(cx - k)} {f(cy + k)} L{f(cx - s)} {f(cy)} L{f(cx - k)} {f(cy - k)} Z" fill="#fff" opacity="{op}"/>')

def blades_for(rank):
    # (base x, base y, half width, tip x, tip y): the centre blade tallest; outer blades lean out
    main = [(30, 58, 9, 20, 10), (60, 56, 11, 60, -6), (90, 58, 9, 100, 10)]
    if rank == 1:
        main = [(30, 58, 9, 18, 8), (60, 56, 11.5, 60, -9), (90, 58, 9, 102, 8), (45, 58, 6, 41, 22), (75, 58, 6, 79, 22)]
    return main

def crown(rank, metal, gemkey):
    m = METALS[metal]
    base, light, dark = GEMS[gemkey]
    defs = [
        f'<linearGradient id="L{rank}" x1="0" y1="1" x2=".35" y2="0"><stop offset="0" stop-color="{m[2]}"/><stop offset=".55" stop-color="{m[1]}"/><stop offset="1" stop-color="{m[0]}"/></linearGradient>',
        f'<linearGradient id="R{rank}" x1="0" y1="1" x2=".2" y2="0"><stop offset="0" stop-color="{m[4]}"/><stop offset=".6" stop-color="{m[3]}"/><stop offset="1" stop-color="{m[2]}"/></linearGradient>',
        f'<linearGradient id="B{rank}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{m[0]}"/><stop offset=".18" stop-color="{m[1]}"/><stop offset=".5" stop-color="{m[2]}"/><stop offset=".58" stop-color="{m[1]}"/><stop offset=".85" stop-color="{m[3]}"/><stop offset="1" stop-color="{m[4]}"/></linearGradient>',
        f'<linearGradient id="T{rank}" x1="0" y1="1" x2=".4" y2="0"><stop offset="0" stop-color="{m[3]}"/><stop offset=".55" stop-color="{m[2]}"/><stop offset="1" stop-color="{m[0]}"/></linearGradient>',
        f'<radialGradient id="G{rank}" cx="40%" cy="30%" r="80%"><stop offset="0" stop-color="{light}"/><stop offset=".45" stop-color="{base}"/><stop offset="1" stop-color="{dark}"/></radialGradient>',
    ]
    bl = blades_for(rank)
    # draw back blades (the small ones on #1) first, then the main ones
    order = sorted(range(len(bl)), key=lambda i: -(bl[i][4]))  # lower tips first = further back
    parts = []
    thorns = []
    for x, side in ((16, -1), (104, 1)):
        thorns.append(thorn(x, 63, side, 17))
    parts.append(f'<g fill="url(#T{rank})" stroke="{INK}" stroke-width="1.5" stroke-linejoin="miter">' + "".join(f'<path d="{t}"/>' for t in thorns) + '</g>')
    for i in order:
        bx, by, hw, tx, ty = bl[i]
        outline, left, right, ridge, streak, guard = blade(bx, by, hw, tx, ty)
        parts.append(
            (f'<path d="{guard}" fill="url(#T{rank})" stroke="{INK}" stroke-width="1.2" stroke-linejoin="miter"/>' if guard else "") +
            f'<path d="{left}" fill="url(#L{rank})"/><path d="{right}" fill="url(#R{rank})"/>'
            f'<path d="{outline}" fill="none" stroke="{INK}" stroke-width="1.7" stroke-linejoin="miter" stroke-miterlimit="12"/>'
            f'<path d="{ridge}" stroke="{INK}" stroke-width=".7" opacity=".55"/>'
            f'<path d="{streak}" fill="none" stroke="{m[0]}" stroke-width="1" stroke-linecap="round" opacity=".95"/>')
    band = "M8 58 Q60 70 112 58 L110 76 Q60 90 10 76 Z"
    parts.append(f'<path d="{band}" fill="url(#B{rank})" stroke="{INK}" stroke-width="1.8" stroke-linejoin="miter"/>')
    parts.append(f'<path d="M12 62 Q60 74 108 62" fill="none" stroke="{m[0]}" stroke-width=".9" opacity=".8"/>')
    parts.append(f'<path d="M12 73 Q60 86 108 73" fill="none" stroke="{INK}" stroke-width=".8" opacity=".6"/>')
    # sharp diamond rivets along the band
    for x in (20, 32, 88, 100):
        y = 67.5 + 3.4 * (1 - ((x - 60) / 52) ** 2)
        parts.append(f'<path d="M{f(x)} {f(y - 3.2)} L{f(x + 2.4)} {f(y)} L{f(x)} {f(y + 3.2)} L{f(x - 2.4)} {f(y)} Z" fill="{m[0]}" stroke="{INK}" stroke-width=".8"/>')
    parts.append(gem(60, 71, 15, 17, gemkey, f"G{rank}"))
    # blade gems: small cut stones set at each main blade's base
    for (bx, by, hw, tx, ty) in bl[:3]:
        parts.append(gem(bx + (tx - bx) * .18, by - 9, 6.5, 8, gemkey, f"G{rank}"))
    parts.append(glint(60, -7 if rank != 1 else -10, 6 if rank == 1 else 4.5))
    parts.append(glint(104, 22, 3, .85))
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="-6 -16 132 112" width="132" height="112">
  <defs>{"".join(defs)}</defs>
  {"".join(parts)}
</svg>'''

def crown_small(rank, metal, gemkey):
    m = METALS[metal]
    base, light, dark = GEMS[gemkey]
    bl = blades_for(rank)[:3] if rank != 1 else blades_for(rank)
    shapes = "".join(f'<path d="{blade(*b)[0]}"/>' for b in bl)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="-6 -16 132 112" width="132" height="112">
  <defs>
    <linearGradient id="sL{rank}" x1="0" y1="1" x2=".3" y2="0"><stop offset="0" stop-color="{m[3]}"/><stop offset=".5" stop-color="{m[2]}"/><stop offset="1" stop-color="{m[0]}"/></linearGradient>
    <linearGradient id="sB{rank}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{m[0]}"/><stop offset=".45" stop-color="{m[1]}"/><stop offset="1" stop-color="{m[3]}"/></linearGradient>
    <radialGradient id="sG{rank}" cx="40%" cy="30%" r="80%"><stop offset="0" stop-color="{light}"/><stop offset=".45" stop-color="{base}"/><stop offset="1" stop-color="{dark}"/></radialGradient>
  </defs>
  <g fill="url(#sL{rank})" stroke="{INK}" stroke-width="4.5" stroke-linejoin="miter" stroke-miterlimit="14">{shapes}</g>
  <path d="M8 58 Q60 70 112 58 L110 78 Q60 92 10 78 Z" fill="url(#sB{rank})" stroke="{INK}" stroke-width="4.5" stroke-linejoin="miter"/>
  <path d="M60 61 L72 74 L60 89 L48 74 Z" fill="url(#sG{rank})" stroke="{INK}" stroke-width="3.2" stroke-linejoin="miter"/>
</svg>'''

for rank, metal, g in RANKS:
    open(os.path.join(OUT, f"crown-{rank}.svg"), "w").write(crown(rank, metal, g))
    open(os.path.join(OUT, f"crown-{rank}-small.svg"), "w").write(crown_small(rank, metal, g))

if "--preview" in sys.argv[2:]:
    cells = "".join(f'<figure><img src="crown-{r}.svg" style="width:{w}px"><figcaption>#{r} full {w}px</figcaption></figure>' for w in (240, 100) for r, m, g in RANKS)
    cells += "".join(f'<figure class="{bg}"><img src="crown-{r}-small.svg" style="width:{w}px"><figcaption>#{r} small {w}px</figcaption></figure>' for bg in ("dark", "pale") for w in (56, 32) for r, m, g in RANKS)
    open(os.path.join(OUT, "preview.html"), "w").write(f'<!doctype html><meta charset="utf-8"><style>body{{margin:0;padding:24px;background:#0e0b14;color:#9a95a3;font:12px -apple-system;display:grid;grid-template-columns:repeat(5,1fr);gap:14px;align-items:end}} figure{{margin:0;text-align:center;padding:8px 0;border-radius:6px}} .pale{{background:#efe3c8;color:#5b5040}} .dark{{background:#2a1f33}} img{{display:block;margin:0 auto 6px}}</style>{cells}')
print("ok")
