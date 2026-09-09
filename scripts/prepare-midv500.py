#!/usr/bin/env python3
"""Convert MIDV-500 TIFF/JSON pairs into compact grayscale JSONL records.

Requires Pillow only for the one-time offline preparation step:
  python3 -m pip install --user Pillow
"""

import base64
import json
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError as exc:
    raise SystemExit("Pillow is required only for dataset preparation: python3 -m pip install Pillow") from exc


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: prepare-midv500.py DATASET_ROOT OUTPUT_JSONL")
    root = Path(sys.argv[1]).resolve()
    output = Path(sys.argv[2]).resolve()
    annotations = sorted(root.glob("**/ground_truth/**/*.json"))
    if not annotations:
        raise SystemExit(f"no ground_truth JSON files found below {root}")
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8") as stream:
        for annotation_path in annotations:
            relative = annotation_path.relative_to(root)
            image_path = root / str(relative).replace("ground_truth", "images").replace(".json", ".tif")
            if not image_path.exists():
                continue
            annotation = json.loads(annotation_path.read_text(encoding="utf-8"))
            quad = annotation.get("quad")
            if not quad or len(quad) != 4:
                continue
            with Image.open(image_path) as image:
                image = image.convert("L")
                scale = min(1.0, 800.0 / max(image.width, image.height))
                size = (max(1, round(image.width * scale)), max(1, round(image.height * scale)))
                image = image.resize(size, Image.Resampling.LANCZOS)
                pixels = base64.b64encode(image.tobytes()).decode("ascii")
            group = relative.parts[0] if relative.parts else image_path.stem
            record = {
                "id": str(relative),
                "group": group,
                "width": size[0],
                "height": size[1],
                "pixels": pixels,
                "quad": [[float(x) * scale, float(y) * scale] for x, y in quad],
            }
            stream.write(json.dumps(record, separators=(",", ":")) + "\n")
    print(f"wrote {output}")


if __name__ == "__main__":
    main()
