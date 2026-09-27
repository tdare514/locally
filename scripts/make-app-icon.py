#!/usr/bin/env python3
"""Draws the Locally app icon (1024x1024) into the asset catalog.

Design: near-black background, an orange location pin (the app is about
files that live *locally*) carrying a dark music note. Orange, not Spotify
green, per the branding rules in docs/ios-plan.md. iOS applies its own
rounded mask, so the canvas is a full-bleed square.
"""
from PIL import Image, ImageDraw
import math, os

SIZE = 1024
BG = (0x12, 0x12, 0x12)
ORANGE = (0xFF, 0x7A, 0x00)
DARK = (0x18, 0x18, 0x18)

img = Image.new("RGB", (SIZE, SIZE), BG)
d = ImageDraw.Draw(img)

# Pin: circle head + tapered point, drawn at 4x and downsampled for smooth edges.
S = 4
big = Image.new("RGBA", (SIZE * S, SIZE * S), (0, 0, 0, 0))
bd = ImageDraw.Draw(big)
cx, cy, r = 512 * S, 430 * S, 250 * S
bd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=ORANGE)
# Tangent point: tip at (cx, cy + 2.05r); tangents from the tip to the circle.
tip = (cx, cy + int(2.05 * r))
dist = tip[1] - cy
ang = math.asin(r / dist)
for sign in (-1, 1):
    pass
# Tangent contact points on the circle.
t = math.acos(r / dist)
p1 = (cx - int(r * math.sin(t)), cy + int(r * math.cos(t)))
p2 = (cx + int(r * math.sin(t)), cy + int(r * math.cos(t)))
bd.polygon([p1, p2, tip], fill=ORANGE)

# Music note inside the head, in the dark background colour.
nx, ny = cx - 40 * S, cy + 70 * S
hr = 62 * S
bd.ellipse([nx - hr, ny - hr * 0.72, nx + hr, ny + hr * 0.72], fill=DARK)
stem_w = 26 * S
stem_h = 250 * S
bd.rectangle([nx + hr - stem_w, ny - stem_h, nx + hr, ny], fill=DARK)
# Flag: a curved sweep from the stem top, approximated with a thick arc.
fx = nx + hr - stem_w // 2
fy = ny - stem_h
bd.polygon([
    (fx - stem_w // 2, fy), (fx + stem_w // 2, fy),
    (fx + 120 * S, fy + 70 * S), (fx + 118 * S, fy + 165 * S),
    (fx + 90 * S, fy + 120 * S), (fx + 60 * S, fy + 90 * S),
    (fx + stem_w // 2, fy + 60 * S), (fx - stem_w // 2, fy + 60 * S),
], fill=DARK)

big = big.resize((SIZE, SIZE), Image.LANCZOS)
img.paste(big, (0, 0), big)

out = os.path.join(os.path.dirname(__file__), "..", "apps/ios/Locally/Resources/Assets.xcassets/AppIcon.appiconset")
os.makedirs(out, exist_ok=True)
img.save(os.path.join(out, "AppIcon.png"))
with open(os.path.join(out, "Contents.json"), "w") as f:
    f.write('''{
  "images" : [
    { "filename" : "AppIcon.png", "idiom" : "universal", "platform" : "ios", "size" : "1024x1024" }
  ],
  "info" : { "author" : "xcode", "version" : 1 }
}
''')
print("wrote", os.path.abspath(os.path.join(out, "AppIcon.png")))
