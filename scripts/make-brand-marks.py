#!/usr/bin/env python3
"""Renders the Locally listener mark (the owner's sketch: hair cloud, band, cup, profile)
for both apps, from the geometry settled in the "Locally Mark Studies" page.

Outputs:
  apps/ios/Locally/Resources/Assets.xcassets/ListenerSolid.imageset/listener-solid.pdf   (vector, any size)
  apps/ios/Locally/Resources/Assets.xcassets/ListenerLine.imageset/listener-line.pdf
  apps/web/public/brand/listener-solid.svg
  apps/web/public/brand/listener-line.svg

Both variants have a transparent ground; the accent colour is baked in for the cup
(pass --accent to change it). Requires `rsvg-convert` (brew install librsvg).
"""
import argparse, json, math, os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATALOG = os.path.join(ROOT, "apps/ios/Locally/Resources/Assets.xcassets")
WEB_BRAND = os.path.join(ROOT, "apps/web/public/brand")


def geometry(fullness=1.0):
    cx, cy, rx, ry = 480, 470, 300 * fullness, 300 * fullness
    start_deg, end_deg = 62, 338
    n = round(22 * fullness)
    seed = 11

    def rnd():
        nonlocal seed
        seed = (seed * 9301 + 49297) % 233280
        return seed / 233280

    pts = []
    for i in range(n + 1):
        deg = start_deg + (end_deg - start_deg) * i / n
        t = math.radians(deg)
        w = 1 if i in (0, n) else 0.9 + rnd() * 0.2
        pts.append((cx + math.cos(t) * rx * w, cy + math.sin(t) * ry * w))
    hair = f"M{pts[0][0]:.1f} {pts[0][1]:.1f}"
    for i in range(n):
        a, b = pts[i], pts[i + 1]
        r = math.hypot(b[0] - a[0], b[1] - a[1]) * 0.58
        hair += f" A{r:.1f} {r:.1f} 0 0 1 {b[0]:.1f} {b[1]:.1f}"
    F, J = pts[n], pts[0]
    face = (f"M{F[0]:.1f} {F[1]:.1f}"
            f" C {F[0] + 32} {F[1] + 42}, {F[0] + 30} {F[1] + 74}, {F[0] + 16} {F[1] + 100}"
            f" C {F[0] + 46} {F[1] + 120}, {F[0] + 62} {F[1] + 146}, {F[0] + 50} {F[1] + 166}"
            f" C {F[0] + 40} {F[1] + 176}, {F[0] + 32} {F[1] + 186}, {F[0] + 34} {F[1] + 200}"
            f" C {F[0] + 80} {F[1] + 232}, {F[0] + 78} {F[1] + 322}, {J[0] + 44} {J[1] - 12}"
            f" C {J[0] + 26} {J[1] + 2}, {J[0] + 10} {J[1] + 4}, {J[0]:.1f} {J[1]:.1f}")
    cup = (cx + 95, cy + 90, 92)
    band = f"M {cup[0] - 10} {cup[1] - 80} C {cup[0] + 20} {cy - 120}, {cx + 40} {cy - ry - 10}, {cx - 60} {cy - ry + 20}"
    neck_l = (cx + 40, cy + ry - 10)
    neck_r = (J[0] + 30, J[1] + 10)
    return dict(hair=hair, face=face, cup=cup, band=band, neck_l=neck_l, neck_r=neck_r)


def svg(style, accent, ink="#ffffff", hole="#000000"):
    """`style` is "line" or "solid". Transparent ground, 1024 box.
    `hole` is the colour the band and cup cut-outs use in the solid version: on the
    black app background it is black, which reads as negative space."""
    g = geometry()
    a = "#" + accent.lstrip("#")
    cx, cy, r = g["cup"]
    nl, nr = g["neck_l"], g["neck_r"]
    if style == "line":
        w = 24
        body = (f'<path d="{g["hair"]}" fill="none" stroke="{ink}" stroke-width="{w}" stroke-linejoin="round" stroke-linecap="round"/>'
                f'<path d="{g["face"]}" fill="none" stroke="{ink}" stroke-width="{w}" stroke-linejoin="round" stroke-linecap="round"/>'
                f'<path d="M {nl[0]} {nl[1]} L {nl[0] - 30} 1100 M {nr[0]} {nr[1]} L {nr[0] + 30} 1100" fill="none" stroke="{ink}" stroke-width="{w}"/>'
                f'<path d="{g["band"]}" fill="none" stroke="{ink}" stroke-width="{w * 2.3}" stroke-linecap="round"/>'
                f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{a}" stroke="{ink}" stroke-width="{w}"/>'
                f'<circle cx="{cx}" cy="{cy}" r="{r * .42}" fill="none" stroke="{ink}" stroke-width="{w * .8}"/>')
    else:
        face_tail = g["face"][g["face"].index(" C"):]
        body = (f'<path d="{g["hair"]}{face_tail} Z" fill="{ink}"/>'
                f'<path d="M {nl[0]} {nl[1]} L {nl[0] - 30} 1100 L {nr[0] + 30} 1100 L {nr[0]} {nr[1]} Z" fill="{ink}"/>'
                f'<path d="{g["band"]}" fill="none" stroke="{hole}" stroke-width="66" stroke-linecap="round"/>'
                f'<path d="{g["band"]}" fill="none" stroke="{a}" stroke-width="42" stroke-linecap="round"/>'
                f'<circle cx="{cx}" cy="{cy}" r="{r + 16}" fill="{hole}"/>'
                f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{a}"/>'
                f'<circle cx="{cx}" cy="{cy}" r="{r * .4}" fill="{hole}" opacity=".9"/>')
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">{body}</svg>'


def write_imageset(name, pdf_src):
    d = os.path.join(CATALOG, f"{name}.imageset")
    os.makedirs(d, exist_ok=True)
    os.replace(pdf_src, os.path.join(d, f"{name}.pdf"))
    with open(os.path.join(d, "Contents.json"), "w") as f:
        json.dump({"images": [{"filename": f"{name}.pdf", "idiom": "universal"}],
                   "info": {"author": "xcode", "version": 1},
                   "properties": {"preserves-vector-representation": True}}, f, indent=2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--accent", default="1E7DF0")
    args = ap.parse_args()
    os.makedirs(WEB_BRAND, exist_ok=True)
    for style, ios_name in (("solid", "ListenerSolid"), ("line", "ListenerLine")):
        markup = svg(style, args.accent)
        svg_path = f"/tmp/listener-{style}.svg"
        with open(svg_path, "w") as f:
            f.write(markup)
        with open(os.path.join(WEB_BRAND, f"listener-{style}.svg"), "w") as f:
            f.write(markup)
        pdf_path = f"/tmp/{ios_name}.pdf"
        subprocess.run(["rsvg-convert", "-f", "pdf", "-o", pdf_path, svg_path], check=True)
        write_imageset(ios_name, pdf_path)
        print("wrote", ios_name, "and", f"listener-{style}.svg")


if __name__ == "__main__":
    sys.exit(main())
