#!/usr/bin/env python3
"""Zip up extension/ into dist/context-extractor-extension.zip for distribution.

For local dev, you don't need this — just "Load unpacked" and point Chrome or
Brave straight at the extension/ folder. This script is only useful if you
want a shareable zip (e.g. to hand to someone else, or side-load elsewhere).
"""

import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "extension"
DIST = ROOT / "dist"


def main() -> None:
    DIST.mkdir(exist_ok=True)
    out_path = DIST / "context-extractor-extension.zip"
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(SRC.rglob("*")):
            if path.is_file():
                zf.write(path, path.relative_to(SRC))
    print(f"Wrote {out_path} ({out_path.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
