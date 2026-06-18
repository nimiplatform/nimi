#!/usr/bin/env python
import argparse
import hashlib
import json
import re
from pathlib import Path

from psd_tools import PSDImage


def slug(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9._-]+", "_", value.strip()).strip("_")
    return cleaned or "layer"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def visible_bounds(image):
    alpha = image.getchannel("A")
    bbox = alpha.getbbox()
    if not bbox:
        return None, 0
    visible = sum(1 for value in alpha.getdata() if value > 0)
    return {
        "x": bbox[0],
        "y": bbox[1],
        "width": bbox[2] - bbox[0],
        "height": bbox[3] - bbox[1],
    }, visible


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-dir", required=True, help="see-through run directory containing <stem>.psd")
    parser.add_argument("--stem", default=None, help="input stem; defaults to the first PSD basename")
    parser.add_argument("--out-dir", default=None, help="output layer directory; defaults to run-dir/extracted-psd-layers")
    parser.add_argument("--meta-out", default=None, help="metadata JSON path; defaults to run-dir/extracted-psd-layers.json")
    args = parser.parse_args()

    run_dir = Path(args.run_dir).resolve()
    stem = args.stem
    if stem is None:
        psds = sorted(path for path in run_dir.glob("*.psd") if not path.name.endswith("_depth.psd"))
        if len(psds) != 1:
            raise SystemExit(f"Expected exactly one PSD in {run_dir}, found {len(psds)}.")
        psd_path = psds[0]
        stem = psd_path.stem
    else:
        psd_path = run_dir / f"{stem}.psd"
    if not psd_path.exists():
        raise SystemExit(f"Missing PSD: {psd_path}")

    out_dir = Path(args.out_dir).resolve() if args.out_dir else run_dir / "extracted-psd-layers"
    meta_out = Path(args.meta_out).resolve() if args.meta_out else run_dir / "extracted-psd-layers.json"
    out_dir.mkdir(parents=True, exist_ok=True)

    psd = PSDImage.open(psd_path)
    layers = []
    for index, layer in enumerate(psd):
        image = layer.composite(force=True).convert("RGBA")
        file_name = f"{index:02d}_{slug(layer.name)}.png"
        png_path = out_dir / file_name
        image.save(png_path)
        bounds, visible_pixels = visible_bounds(image)
        layers.append({
            "index": index,
            "name": layer.name,
            "png_ref": str(png_path.relative_to(run_dir)).replace("\\", "/"),
            "left": layer.left,
            "top": layer.top,
            "right": layer.right,
            "bottom": layer.bottom,
            "width": image.width,
            "height": image.height,
            "visible_bounds_local": bounds,
            "visible_pixels": visible_pixels,
            "sha256": sha256(png_path),
            "byte_size": png_path.stat().st_size,
        })

    meta = {
        "kind": "nimi2d.see_through.extracted_psd_layers",
        "schema_version": 1,
        "psd": str(psd_path),
        "depth_psd": str(run_dir / f"{stem}_depth.psd"),
        "psd_json": str(run_dir / f"{stem}.psd.json"),
        "canvas": {"width": psd.width, "height": psd.height},
        "layers": layers,
    }
    meta_out.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"status": "ok", "meta": str(meta_out), "layer_count": len(layers)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
