#!/usr/bin/env python3
"""Regenerate all app icons from src-tauri/icons/icon_alpha.png with nearest-neighbor scaling."""
from __future__ import annotations

from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC  = ROOT / "src-tauri" / "icons" / "icon_alpha.png"
DST  = SRC.parent
APP  = ROOT / "app"

im = Image.open(SRC).convert("RGBA")
W, H = im.size
assert W == H == 512, f"Unexpected source size {im.size}"

def resize_nearest(src: Image.Image, size: int) -> Image.Image:
    return src.resize((size, size), Image.Resampling.NEAREST)

# ── Desktop PNGs (transparent corners) ──────────────────────────────────────
desktop = {
    "32x32.png":            32,
    "64x64.png":            64,
    "128x128.png":         128,
    "128x128@2x.png":      256,
    "icon.png":            512,
    "Square30x30Logo.png": 30,
    "Square44x44Logo.png": 44,
    "Square71x71Logo.png": 71,
    "Square89x89Logo.png": 89,
    "Square107x107Logo.png": 107,
    "Square142x142Logo.png": 142,
    "Square150x150Logo.png": 150,
    "Square284x284Logo.png": 284,
    "Square310x310Logo.png": 310,
    "StoreLogo.png":        50,
}
for name, size in desktop.items():
    path = DST / name
    out = resize_nearest(im, size)
    out.save(path, compress_level=9)
    print(f"  {name}  {out.size}")

# ── icon.ico (multi-size) ────────────────────────────────────────────────────
ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (256, 256)]
frames_ico = [resize_nearest(im, s[0]) for s in ico_sizes]
path = DST / "icon.ico"
frames_ico[0].save(
    path,
    format="ICO",
    sizes=ico_sizes,
    append_images=frames_ico[1:],
)
print(f"  icon.ico  ({len(frames_ico)} frames)")

# ── icon.icns (Pillow writes 32/64/128/256/512/1024) ────────────────────────
icns_sizes = [32, 64, 128, 256, 512, 1024]
frames_icns = [resize_nearest(im, s) for s in icns_sizes]
path = DST / "icon.icns"
frames_icns[0].save(
    path,
    format="ICNS",
    append_images=frames_icns[1:],
)
print(f"  icon.icns  ({len(frames_icns)} entries)")

# ── iOS icons (white opaque background) ─────────────────────────────────────
WHITE = (255, 255, 255, 255)
ios_specs = [
    ("AppIcon-20x20@1x.png",             20),
    ("AppIcon-20x20@2x.png",             40),
    ("AppIcon-20x20@2x-1.png",           40),
    ("AppIcon-20x20@3x.png",             60),
    ("AppIcon-29x29@1x.png",             29),
    ("AppIcon-29x29@2x.png",             58),
    ("AppIcon-29x29@2x-1.png",           58),
    ("AppIcon-29x29@3x.png",             87),
    ("AppIcon-40x40@1x.png",             40),
    ("AppIcon-40x40@2x.png",             80),
    ("AppIcon-40x40@2x-1.png",           80),
    ("AppIcon-40x40@3x.png",            120),
    ("AppIcon-512@2x.png",             1024),
    ("AppIcon-60x60@2x.png",            120),
    ("AppIcon-60x60@3x.png",            180),
    ("AppIcon-76x76@1x.png",             76),
    ("AppIcon-76x76@2x.png",            152),
    ("AppIcon-83.5x83.5@2x.png",        167),
]
ios_dir = DST / "ios"
ios_dir.mkdir(parents=True, exist_ok=True)
for name, size in ios_specs:
    tmp = resize_nearest(im, size)
    bg = Image.new("RGBA", (size, size), WHITE)
    out = Image.alpha_composite(bg, tmp)
    path = ios_dir / name
    out.save(path, compress_level=9)
    print(f"  ios/{name}  {out.size}")

# ── Android icons ────────────────────────────────────────────────────────────
android_dir = DST / "android"
DENSITIES = [
    ("mdpi",     48, 108),
    ("hdpi",     49, 162),
    ("xhdpi",    96, 216),
    ("xxhdpi",  144, 324),
    ("xxxhdpi", 192, 432),
]
DARK_BG = (20, 21, 23, 255)

for dens, launcher_size, fg_size in DENSITIES:
    # ic_launcher + ic_launcher_round: transparent NEAREST resize
    for icon_name in ("ic_launcher.png", "ic_launcher_round.png"):
        out = resize_nearest(im, launcher_size)
        path = android_dir / f"mipmap-{dens}" / icon_name
        out.save(path, compress_level=9)
        print(f"  android/{dens}/{icon_name}  {out.size}")

    # ic_launcher_foreground: dark opaque bg + NEAREST-resized source
    out = resize_nearest(im, fg_size)
    bg = Image.new("RGBA", (fg_size, fg_size), DARK_BG)
    out = Image.alpha_composite(bg, out)
    path = android_dir / f"mipmap-{dens}" / "ic_launcher_foreground.png"
    out.save(path, compress_level=9)
    print(f"  android/{dens}/ic_launcher_foreground.png  {out.size}")

# ── PWA / web icons ──────────────────────────────────────────────────────────
for name, size in (("icon-192.png", 192), ("icon-512.png", 512)):
    out = resize_nearest(im, size)
    path = APP / name
    out.save(path, compress_level=9)
    print(f"  app/{name}  {out.size}")

print("Done.")
