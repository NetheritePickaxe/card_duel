#!/usr/bin/env python3
"""Convert mp3 source files to OGG Vorbis and update sound.json."""

import json
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
BASE = PROJECT_ROOT / "app" / "card_duel" / "assets" / "sound"
SOUND_JSON = BASE / "sound.json"

# bitrate by top-level directory
BITRATES = {
    "bgm": 192,
    "sfx": 96,
    "voice": 64,
}

DEFAULT_BITRATE = 192

# existing bgm sub-section configs (copied for new sections of same type)
DEFAULT_BGM_SECTION = {"stream": True, "volume": 1.0}


def get_bitrate(mp3_path: Path) -> int:
    rel = mp3_path.relative_to(BASE)
    for part in rel.parts[:-1]:  # exclude filename
        if part in BITRATES:
            return BITRATES[part]
    return DEFAULT_BITRATE


def convert(mp3_path: Path, bitrate: int) -> None:
    ogg_path = mp3_path.with_suffix(".ogg")
    print(f"  Converting: {mp3_path.name} ({bitrate}kbps)")
    subprocess.run(
        [
            "ffmpeg", "-i", str(mp3_path),
            "-map_metadata", "-1",
            "-c:a", "libvorbis",
            "-b:a", f"{bitrate}k",
            str(ogg_path),
            "-y",
            "-loglevel", "error",
        ],
        check=True,
    )
    mp3_path.unlink()
    print(f"  Done: {ogg_path.name}")


def update_sound_json(converted_files: list[str]) -> None:
    with open(SOUND_JSON, "r", encoding="utf-8") as f:
        data = json.load(f)

    # Build lookup: file_path -> (type, section_name)
    existing = {}
    for sec_name, sec in data.get("bgm", {}).items():
        for t in sec.get("tracks", []):
            existing[t["file"]] = ("bgm", sec_name)
    for t in data.get("sfx", {}).get("tracks", []):
        existing[t["file"]] = ("sfx", None)
    for t in data.get("voice", {}).get("tracks", []):
        existing[t["file"]] = ("voice", None)

    for ogg_rel in converted_files:
        parts = ogg_rel.split("/")
        sound_type = parts[0]  # bgm / sfx / voice
        rest = parts[1:]       # e.g. ["boss", "sao_aic.ogg"]

        if sound_type not in ("bgm", "sfx", "voice"):
            print(f"  Warning: unknown type '{sound_type}', skipping {ogg_rel}")
            continue

        file_key = f"card_duel/assets/sound/{ogg_rel}"
        track_entry = {"file": file_key, "weight": 1, "volume": 1.0}

        # Check if track already exists
        if file_key in existing:
            print(f"  Skipped (already exists): {file_key}")
            continue

        if sound_type == "bgm":
            # Determine or create section name
            if len(rest) == 1:
                # Directly under bgm/ (e.g. bgm/tutorial.ogg)
                sec_name = rest[0].rsplit(".", 1)[0]  # "tutorial"
                data["bgm"][sec_name] = {
                    **DEFAULT_BGM_SECTION,
                    "tracks": [track_entry],
                }
            else:
                # Under bgm/<subfolder>/ (e.g. bgm/boss/song.ogg)
                sec_name = rest[0]  # "boss"
                if sec_name not in data["bgm"]:
                    data["bgm"][sec_name] = {
                        **DEFAULT_BGM_SECTION,
                        "tracks": [],
                    }
                data["bgm"][sec_name]["tracks"].append(track_entry)

            print(f"  Added to bgm/{sec_name}: {file_key}")

        elif sound_type == "sfx":
            data.setdefault("sfx", {}).setdefault("tracks", []).append(track_entry)
            print(f"  Added to sfx: {file_key}")

        elif sound_type == "voice":
            data.setdefault("voice", {}).setdefault("tracks", []).append(track_entry)
            print(f"  Added to voice: {file_key}")

    with open(SOUND_JSON, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


def main() -> None:
    mp3_files = sorted(BASE.rglob("*.mp3"))
    if not mp3_files:
        print("No MP3 files found. Nothing to do.")
        return

    print(f"Found {len(mp3_files)} MP3 file(s):")
    converted = []

    for mp3_path in mp3_files:
        bitrate = get_bitrate(mp3_path)
        print(f"\n[{bitrate}kbps] {mp3_path}")
        try:
            convert(mp3_path, bitrate)
            ogg_rel = str(mp3_path.relative_to(BASE)).replace("\\", "/")
            converted.append(ogg_rel)
        except subprocess.CalledProcessError:
            print(f"  ERROR: conversion failed for {mp3_path.name}")
            sys.exit(1)

    print(f"\nUpdating sound.json...")
    update_sound_json(converted)
    print(f"Done. Converted {len(converted)} file(s).")


if __name__ == "__main__":
    main()
