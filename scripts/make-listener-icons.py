#!/usr/bin/env python3
"""Renders the Locally app icons from the listener mark (the owner's sketch), chosen on
27 Sep 2026 over the metallic plus. Two icons, both on a black ground:

  AppIcon        "Solid, plus in the cup": white silhouette, accent band and cup, plus cut into the cup
  AppIcon-Line   "Line art, profile": white line work, white headphones, accent plus in the cup

Writes the 1024 px app icon sets and 256 px picker previews into the iOS asset catalog,
the web icon.png (512) / apple-icon.png (180) / favicon.ico (16/32/48) / opengraph-image.png (1200x630).
Requires `rsvg-convert` (brew install librsvg) and Pillow 12+ for favicon/opengraph.
Reuses the geometry from make-brand-marks.py.

Usage:
  scripts/make-listener-icons.py [--accent 1E7DF0] [--preview DIR]
"""
import argparse, importlib.util, json, os, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATALOG = os.path.join(ROOT, "apps/ios/Locally/Resources/Assets.xcassets")
WEB_APP = os.path.join(ROOT, "apps/web/src/app")

spec = importlib.util.spec_from_file_location("marks", os.path.join(ROOT, "scripts/make-brand-marks.py"))
marks = importlib.util.module_from_spec(spec)
spec.loader.exec_module(marks)

# The mark's geometry spans roughly y 170..1100 in its 1024 box. Scale it down and centre it
# so the head sits comfortably in the icon with the neck ending inside the tile.
SCALE = 0.76
OFFSET_X = 512 - 512 * SCALE + 10
# Where the neck stops, in mark space; the mark is placed so this lands on the tile's
# bottom edge (a few px past it, so no hairline gap shows after scaling).
NECK_END = 1040
OFFSET_Y = 1030 - NECK_END * SCALE


def icon_svg(style, accent):
    g = marks.geometry()
    a = "#" + accent.lstrip("#")
    ink, ground = "#ffffff", "#000000"
    cx, cy, r = g["cup"]
    nl, nr = g["neck_l"], g["neck_r"]
    if style == "line":
        w = 24
        body = (f'<path d="{g["hair"]}" fill="none" stroke="{ink}" stroke-width="{w}" stroke-linejoin="round" stroke-linecap="round"/>'
                f'<path d="{g["face"]}" fill="none" stroke="{ink}" stroke-width="{w}" stroke-linejoin="round" stroke-linecap="round"/>'
                f'<path d="M {nl[0]} {nl[1]} L {nl[0] - 30} {NECK_END} M {nr[0]} {nr[1]} L {nr[0] + 30} {NECK_END}" fill="none" stroke="{ink}" stroke-width="{w}"/>'
                f'<path d="{g["band"]}" fill="none" stroke="{ink}" stroke-width="{w * 2.3}" stroke-linecap="round"/>'
                f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{ink}"/>'
                f'<rect x="{cx - r * .5}" y="{cy - r * .16}" width="{r}" height="{r * .32}" rx="{r * .16}" fill="{a}"/>'
                f'<rect x="{cx - r * .16}" y="{cy - r * .5}" width="{r * .32}" height="{r}" rx="{r * .16}" fill="{a}"/>')
    else:
        face_tail = g["face"][g["face"].index(" C"):]
        arm = r * 0.5
        bar = r * 0.16
        body = (f'<path d="{g["hair"]}{face_tail} Z" fill="{ink}"/>'
                f'<path d="M {nl[0]} {nl[1]} L {nl[0] - 30} {NECK_END} L {nr[0] + 30} {NECK_END} L {nr[0]} {nr[1]} Z" fill="{ink}"/>'
                f'<path d="{g["band"]}" fill="none" stroke="{ground}" stroke-width="66" stroke-linecap="round"/>'
                f'<path d="{g["band"]}" fill="none" stroke="{a}" stroke-width="42" stroke-linecap="round"/>'
                f'<circle cx="{cx}" cy="{cy}" r="{r + 16}" fill="{ground}"/>'
                f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{a}"/>'
                f'<rect x="{cx - arm}" y="{cy - bar}" width="{arm * 2}" height="{bar * 2}" rx="{bar}" fill="{ground}"/>'
                f'<rect x="{cx - bar}" y="{cy - arm}" width="{bar * 2}" height="{arm * 2}" rx="{bar}" fill="{ground}"/>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">'
            f'<rect width="1024" height="1024" fill="{ground}"/>'
            f'<g transform="translate({OFFSET_X:.1f} {OFFSET_Y}) scale({SCALE})">{body}</g></svg>')


def rsvg(svg_path, out, size):
    subprocess.run(["rsvg-convert", "-w", str(size), "-h", str(size), "-o", out, svg_path], check=True)


def write_appiconset(name, svg_path):
    d = os.path.join(CATALOG, f"{name}.appiconset")
    os.makedirs(d, exist_ok=True)
    rsvg(svg_path, os.path.join(d, "AppIcon.png"), 1024)
    with open(os.path.join(d, "Contents.json"), "w") as f:
        json.dump({"images": [{"filename": "AppIcon.png", "idiom": "universal", "platform": "ios", "size": "1024x1024"}],
                   "info": {"author": "xcode", "version": 1}}, f, indent=2)


def write_preview_set(name, svg_path):
    d = os.path.join(CATALOG, f"IconPreview-{name}.imageset")
    os.makedirs(d, exist_ok=True)
    rsvg(svg_path, os.path.join(d, "preview.png"), 256)
    with open(os.path.join(d, "Contents.json"), "w") as f:
        json.dump({"images": [{"filename": "preview.png", "idiom": "universal", "scale": "1x"},
                              {"idiom": "universal", "scale": "2x"}, {"idiom": "universal", "scale": "3x"}],
                   "info": {"author": "xcode", "version": 1}}, f, indent=2)


def write_favicon(svg_path):
    try:
        from PIL import Image
    except ImportError:
        print("error: Pillow required for favicon.ico; install with: pip install pillow", file=sys.stderr)
        sys.exit(1)

    # Render once at 48 px; Pillow downsamples for the 16 and 32 px entries.
    with tempfile.TemporaryDirectory() as tmp:
        png_path = os.path.join(tmp, "favicon-48.png")
        rsvg(svg_path, png_path, 48)
        # Next.js (Turbopack) rejects an ICO whose embedded PNGs are not RGBA.
        img = Image.open(png_path).convert("RGBA")
        img.save(os.path.join(WEB_APP, "favicon.ico"), format="ICO", sizes=[(16, 16), (32, 32), (48, 48)])


def write_opengraph_image(svg_path):
    try:
        from PIL import Image
    except ImportError:
        print("error: Pillow required for opengraph-image.png; install with: pip install pillow", file=sys.stderr)
        sys.exit(1)

    # The 512 px icon (own rounded black ground) centred on a 1200x630 black canvas.
    with tempfile.TemporaryDirectory() as tmp:
        png_path = os.path.join(tmp, "og-512.png")
        rsvg(svg_path, png_path, 512)
        icon_img = Image.open(png_path)
        og_img = Image.new("RGB", (1200, 630), color="#000000")
        origin = ((1200 - 512) // 2, (630 - 512) // 2)
        mask = icon_img.split()[3] if icon_img.mode == "RGBA" else None
        og_img.paste(icon_img.convert("RGB"), origin, mask)
        og_img.save(os.path.join(WEB_APP, "opengraph-image.png"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--accent", default="1E7DF0")
    ap.add_argument("--preview", help="also write 512 px previews into this folder")
    args = ap.parse_args()
    for name, style in (("AppIcon", "solid"), ("AppIcon-Line", "line")):
        svg_path = f"/tmp/locally-{name}.svg"
        with open(svg_path, "w") as f:
            f.write(icon_svg(style, args.accent))
        write_appiconset(name, svg_path)
        write_preview_set(name, svg_path)
        if name == "AppIcon":
            rsvg(svg_path, os.path.join(WEB_APP, "icon.png"), 512)
            rsvg(svg_path, os.path.join(WEB_APP, "apple-icon.png"), 180)
            write_favicon(svg_path)
            write_opengraph_image(svg_path)
        if args.preview:
            os.makedirs(args.preview, exist_ok=True)
            rsvg(svg_path, os.path.join(args.preview, f"{name}.png"), 512)
        print("wrote", name)


if __name__ == "__main__":
    sys.exit(main())
