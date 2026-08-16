#!/usr/bin/env python3
"""Regenerate all app icons from src-tauri/icons/icon_alpha.png with nearest-neighbor scaling."""
from __future__ import annotations

from pathlib import Path
from PIL import Image
import struct, io

ROOT = Path(__file__).resolve().parent.parent
SRC  = ROOT / "src-tauri" / "icons" / "icon.png"
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
    "128x128.png":         128,
    "128x128@2x.png":      256,
}
for name, size in desktop.items():
    path = DST / name
    out = resize_nearest(im, size)
    out.save(path, compress_level=9)
    print(f"  {name}  {out.size}")

# ── icon.ico (multi-size, manually constructed to avoid Pillow 12 bug) ──────
ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (256, 256)]
frames_ico = [resize_nearest(im, s[0]) for s in ico_sizes]
png_buffers = []
for f in frames_ico:
    buf = io.BytesIO()
    f.save(buf, format="PNG")
    png_buffers.append(buf.getvalue())
data_offset = 6 + 16 * len(ico_sizes)
dir_entries = b""
for buf, (w, h) in zip(png_buffers, ico_sizes):
    # ICO dir entry uses 0 to encode 256
    dw, dh = (0, 0) if w == 256 else (w, h)
    dir_entries += struct.pack(
        "<BBBBHHII",
        dw, dh,     # width, height (0 = 256)
        0,          # color count (0 = no palette)
        0,          # reserved
        1,          # color planes
        32,         # bits per pixel (RGBA)
        len(buf),   # image data size
        data_offset,
    )
    data_offset += len(buf)
header = struct.pack("<HHH", 0, 1, len(ico_sizes))
path = DST / "icon.ico"
path.write_bytes(header + dir_entries + b"".join(png_buffers))
print(f"  icon.ico  ({len(ico_sizes)} frames, {path.stat().st_size} bytes)")

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

# ── Android icons ────────────────────────────────────────────────────────────
android_dir = DST / "android"
DENSITIES = [
    ("mdpi",     48, 108),
    ("hdpi",     49, 162),
    ("xhdpi",    96, 216),
    ("xxhdpi",  144, 324),
    ("xxxhdpi", 192, 432),
]
for dens, launcher_size, fg_size in DENSITIES:
    # ic_launcher + ic_launcher_round: transparent NEAREST resize
    for icon_name in ("ic_launcher.png", "ic_launcher_round.png"):
        out = resize_nearest(im, launcher_size)
        path = android_dir / f"mipmap-{dens}" / icon_name
        out.save(path, compress_level=9)
        print(f"  android/{dens}/{icon_name}  {out.size}")

    # ic_launcher_foreground: 裁剪源图空白边框，缩放到安全区(66.7%)，居中放置
    # 先找到源图的实际内容边界
    src_rgba = im.load()
    src_min_x, src_min_y = 512, 512
    src_max_x, src_max_y = 0, 0
    for x in range(512):
        for y in range(512):
            if src_rgba[x, y][3] > 0:
                src_min_x = min(src_min_x, x)
                src_min_y = min(src_min_y, y)
                src_max_x = max(src_max_x, x)
                src_max_y = max(src_max_y, y)
    src_cw = src_max_x - src_min_x + 1
    src_ch = src_max_y - src_min_y + 1
    crop_size = max(src_cw, src_ch)
    cx = (src_min_x + src_max_x) // 2
    cy = (src_min_y + src_max_y) // 2
    cropped = im.crop((
        cx - crop_size // 2, cy - crop_size // 2,
        cx + crop_size // 2, cy + crop_size // 2,
    ))
    safe = int(fg_size * 2 / 5)
    content = resize_nearest(cropped, safe)
    canvas = Image.new('RGBA', (fg_size, fg_size), (0, 0, 0, 0))
    paste_at = (fg_size - safe) // 2
    canvas.paste(content, (paste_at, paste_at))
    path = android_dir / f"mipmap-{dens}" / "ic_launcher_foreground.png"
    canvas.save(path, compress_level=9)
    print(f"  android/{dens}/ic_launcher_foreground.png  {canvas.size}  safe={safe}")

# ── PWA / web icons ──────────────────────────────────────────────────────────
for name, size in (("icon-192.png", 192), ("icon-512.png", 512)):
    out = resize_nearest(im, size)
    path = APP / name
    out.save(path, compress_level=9)
    print(f"  app/{name}  {out.size}")

print("Done.")
