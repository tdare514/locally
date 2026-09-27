#!/usr/bin/env python3
"""Renders the Locally app icons (main + alternates) into the iOS asset catalog.

The mark is a metallic plus with a shimmer band running off-centre, on a ground that
depends on the variant. Same geometry as the "Locally Mark Studies" page, so what was
chosen there is what ships. Requires `rsvg-convert` (brew install librsvg).

Usage:
  scripts/make-app-icons.py --accent 1E7DF0 --corner 0 [--shimmer 42] [--tilt -18] [--preview DIR]

Variants written (name in the asset catalog):
  AppIcon             chrome plus on black, accent-tinted shimmer   (main)
  AppIcon-Accent      accent-coloured metal plus on black
  AppIcon-Gunmetal    gunmetal plus on the accent ground
  AppIcon-Card        chrome plus on the card grey, accent shimmer
  AppIcon-Tone        accent metal plus on the accent ground
"""
import argparse, json, os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATALOG = os.path.join(ROOT, "apps/ios/Locally/Resources/Assets.xcassets")

VARIANTS = [
    ("AppIcon", "black", "chrome", "accent"),
    ("AppIcon-Accent", "black", "accent", "white"),
    ("AppIcon-Gunmetal", "accent", "gunmetal", "white"),
    ("AppIcon-Card", "card", "chrome", "accent"),
    ("AppIcon-Tone", "accent", "accent", "white"),
]


def hex_to_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def rgb_to_hex(r, g, b):
    return "#%02x%02x%02x" % tuple(max(0, min(255, round(v))) for v in (r, g, b))


def mix(a, b, t):
    x, y = hex_to_rgb(a), hex_to_rgb(b)
    return rgb_to_hex(*(x[i] + (y[i] - x[i]) * t for i in range(3)))


PLUS_VERTICES = [(392, 192), (632, 192), (632, 392), (832, 392), (832, 632), (632, 632),
                 (632, 832), (392, 832), (392, 632), (192, 632), (192, 392), (392, 392)]


def plus(r):
    """One closed outline of the plus, clockwise, corners rounded by radius r (0 = sharp).
    A single path means the bevel stroke has no interior seams where two bars would overlap."""
    if r <= 0:
        return '<path d="M' + " L".join(f"{x} {y}" for x, y in PLUS_VERTICES) + ' Z"/>'
    n = len(PLUS_VERTICES)
    d = []
    for i, (vx, vy) in enumerate(PLUS_VERTICES):
        px, py = PLUS_VERTICES[i - 1]
        nx, ny = PLUS_VERTICES[(i + 1) % n]
        ax, ay = (px - vx), (py - vy)
        bx, by = (nx - vx), (ny - vy)
        la, lb = (ax * ax + ay * ay) ** .5, (bx * bx + by * by) ** .5
        sx, sy = vx + ax / la * r, vy + ay / la * r
        ex, ey = vx + bx / lb * r, vy + by / lb * r
        convex = (-ax) * by - (-ay) * bx > 0  # right turn in y-down coordinates
        sweep = 1 if convex else 0
        d.append((f"M{sx} {sy}" if i == 0 else f"L{sx} {sy}") + f" A{r} {r} 0 0 {sweep} {ex} {ey}")
    return '<path d="' + " ".join(d) + ' Z"/>'


def svg(accent, corner, shimmer, tilt, ground, metal, shimmer_kind):
    a = "#" + accent.lstrip("#")
    sx = 1024 * shimmer / 100
    if metal == "accent":
        stops = [(0, mix(a, "#ffffff", .55)), (.22, mix(a, "#000000", .05)), (.45, mix(a, "#ffffff", .35)),
                 (.55, mix(a, "#000000", .35)), (.78, mix(a, "#ffffff", .1)), (1, mix(a, "#000000", .55))]
    elif metal == "gunmetal":
        stops = [(0, "#6a6a6a"), (.22, "#2e2e2e"), (.45, "#5c5c5c"), (.55, "#1b1b1b"), (.78, "#3a3a3a"), (1, "#101010")]
    else:
        stops = [(0, "#fbfbfb"), (.22, "#c4c4c4"), (.45, "#f4f4f4"), (.55, "#9a9a9a"), (.78, "#d6d6d6"), (1, "#6f6f6f")]
    shine = mix(a, "#ffffff", .45) if shimmer_kind == "accent" else "#ffffff"
    if ground == "accent":
        ground_el = '<rect width="1024" height="1024" fill="url(#ground)"/>'
    elif ground == "card":
        ground_el = '<rect width="1024" height="1024" fill="#121212"/>'
    else:
        ground_el = '<rect width="1024" height="1024" fill="#000"/>'
    stop_els = "".join(f'<stop offset="{o}" stop-color="{c}"/>' for o, c in stops)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
<defs>
  <linearGradient id="metal" gradientUnits="userSpaceOnUse" x1="200" y1="150" x2="820" y2="900">{stop_els}</linearGradient>
  <linearGradient id="edge" gradientUnits="userSpaceOnUse" x1="192" y1="192" x2="832" y2="832">
    <stop offset="0" stop-color="#fff" stop-opacity=".85"/><stop offset=".5" stop-color="#fff" stop-opacity=".05"/><stop offset="1" stop-color="#000" stop-opacity=".55"/>
  </linearGradient>
  <linearGradient id="shine" gradientUnits="userSpaceOnUse" x1="{sx - 150}" y1="0" x2="{sx + 150}" y2="0" gradientTransform="rotate({tilt} {sx} 512)">
    <stop offset="0" stop-color="{shine}" stop-opacity="0"/><stop offset=".42" stop-color="{shine}" stop-opacity=".95"/><stop offset=".5" stop-color="{shine}" stop-opacity="1"/><stop offset=".58" stop-color="{shine}" stop-opacity=".95"/><stop offset="1" stop-color="{shine}" stop-opacity="0"/>
  </linearGradient>
  <linearGradient id="shine2" gradientUnits="userSpaceOnUse" x1="{sx + 200}" y1="0" x2="{sx + 300}" y2="0" gradientTransform="rotate({tilt} {sx} 512)">
    <stop offset="0" stop-color="{shine}" stop-opacity="0"/><stop offset=".5" stop-color="{shine}" stop-opacity=".5"/><stop offset="1" stop-color="{shine}" stop-opacity="0"/>
  </linearGradient>
  <radialGradient id="ground" cx="35%" cy="25%" r="95%"><stop offset="0" stop-color="{mix(a, '#ffffff', .12)}"/><stop offset="1" stop-color="{mix(a, '#000000', .28)}"/></radialGradient>
  <clipPath id="clip">{plus(corner)}</clipPath>
  <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="28" stdDeviation="26" flood-color="#000" flood-opacity=".45"/></filter>
</defs>
{ground_el}
<g fill="url(#metal)" filter="url(#shadow)">{plus(corner)}</g>
<g clip-path="url(#clip)"><rect x="-200" y="-200" width="1424" height="1424" fill="url(#shine)" opacity=".9"/><rect x="-200" y="-200" width="1424" height="1424" fill="url(#shine2)"/></g>
<g fill="none" stroke="url(#edge)" stroke-width="14" clip-path="url(#clip)">{plus(corner)}</g>
</svg>'''


def write_set(name, png_bytes_path):
    d = os.path.join(CATALOG, f"{name}.appiconset")
    os.makedirs(d, exist_ok=True)
    os.replace(png_bytes_path, os.path.join(d, "AppIcon.png"))
    with open(os.path.join(d, "Contents.json"), "w") as f:
        json.dump({"images": [{"filename": "AppIcon.png", "idiom": "universal", "platform": "ios", "size": "1024x1024"}],
                   "info": {"author": "xcode", "version": 1}}, f, indent=2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--accent", required=True, help="hex without #, e.g. 1E7DF0")
    ap.add_argument("--corner", type=int, default=0, help="corner radius of the plus, 0 = sharp, 52 = rounded")
    ap.add_argument("--shimmer", type=float, default=42, help="shimmer position, percent across")
    ap.add_argument("--tilt", type=float, default=-18, help="shimmer tilt in degrees")
    ap.add_argument("--preview", help="also write 256 px previews into this folder")
    args = ap.parse_args()

    for name, ground, metal, shimmer_kind in VARIANTS:
        markup = svg(args.accent, args.corner, args.shimmer, args.tilt, ground, metal, shimmer_kind)
        svg_path = f"/tmp/{name}.svg"
        with open(svg_path, "w") as f:
            f.write(markup)
        png_path = f"/tmp/{name}.png"
        subprocess.run(["rsvg-convert", "-w", "1024", "-h", "1024", "-b", "#000000", "-o", png_path, svg_path], check=True)
        if args.preview:
            os.makedirs(args.preview, exist_ok=True)
            subprocess.run(["rsvg-convert", "-w", "256", "-h", "256", "-o", os.path.join(args.preview, f"{name}.png"), svg_path], check=True)
        write_set(name, png_path)
        print("wrote", name)


if __name__ == "__main__":
    sys.exit(main())
