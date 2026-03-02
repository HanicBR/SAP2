#!/usr/bin/env python3
import argparse
import hashlib
import json
import sys
import time
import traceback
from pathlib import Path

import numpy as np

try:
    from PIL import Image
except Exception:
    Image = None


def normalize_material_name(raw: str) -> str:
    value = (raw or "").strip().replace("\\", "/").lower()
    value = value.lstrip("./")
    if value.startswith("/"):
        value = value[1:]
    if value.startswith("materials/"):
        value = value[len("materials/") :]
    if value.endswith(".vmt"):
        value = value[: -len(".vmt")]
    if value.endswith(".vtf"):
        value = value[: -len(".vtf")]
    return value


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export Source1 material base textures via SourceIO")
    parser.add_argument("--sourceio-root", required=True, dest="sourceio_root")
    parser.add_argument("--materials-json", required=True, dest="materials_json")
    parser.add_argument("--map-root", required=False, dest="map_root")
    parser.add_argument("--content-root", action="append", dest="content_roots", default=[])
    parser.add_argument("--out-dir", required=True, dest="out_dir")
    parser.add_argument("--out", required=True, dest="out")
    parser.add_argument("--max-size", required=False, type=int, default=1024, dest="max_size")
    return parser.parse_args()


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf8")


def dedupe_paths(items: list[str]) -> list[Path]:
    out: list[Path] = []
    seen: set[str] = set()
    for raw in items:
        p = Path(raw).resolve()
        key = str(p).lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(p)
    return out


def to_rgba8(raw: np.ndarray) -> np.ndarray:
    arr = raw
    if arr.dtype != np.uint8:
        if np.issubdtype(arr.dtype, np.floating):
            max_v = float(np.nanmax(arr)) if arr.size else 1.0
            if max_v <= 1.001:
                arr = arr * 255.0
        arr = np.clip(arr, 0, 255).astype(np.uint8)

    if arr.ndim == 2:
        arr = np.stack([arr, arr, arr, np.full_like(arr, 255)], axis=2)
    elif arr.ndim == 3 and arr.shape[2] == 3:
        alpha = np.full((arr.shape[0], arr.shape[1], 1), 255, dtype=np.uint8)
        arr = np.concatenate([arr, alpha], axis=2)
    elif arr.ndim == 3 and arr.shape[2] >= 4:
        arr = arr[:, :, :4]
    else:
        raise RuntimeError("unsupported_image_shape")

    return arr


def sanitize_filename(base_texture: str) -> str:
    digest = hashlib.sha1(base_texture.encode("utf8", errors="ignore")).hexdigest()[:18]
    safe_tail = base_texture.replace("/", "_").replace("\\", "_")
    safe_tail = "".join(ch for ch in safe_tail if ch.isalnum() or ch in ("_", "-"))[:36]
    if not safe_tail:
        safe_tail = "mat"
    return f"{safe_tail}_{digest}.png"


def main() -> int:
    args = parse_args()
    out_json = Path(args.out).resolve()
    out_dir = Path(args.out_dir).resolve()
    started = time.time()

    try:
        sourceio_root = Path(args.sourceio_root).resolve()
        if not sourceio_root.exists():
            raise RuntimeError(f"sourceio_root_not_found: {sourceio_root}")

        materials_path = Path(args.materials_json).resolve()
        if not materials_path.exists():
            raise RuntimeError(f"materials_json_not_found: {materials_path}")

        materials_raw = json.loads(materials_path.read_text(encoding="utf8"))
        if isinstance(materials_raw, dict):
            materials_input = materials_raw.get("materials", [])
        else:
            materials_input = materials_raw
        if not isinstance(materials_input, list):
            raise RuntimeError("materials_json_invalid_format")

        materials = sorted({normalize_material_name(str(item)) for item in materials_input if normalize_material_name(str(item))})

        sys.path.insert(0, str(sourceio_root.parent))

        from SourceIO.library.shared.content_manager import ContentManager
        from SourceIO.library.source1.vmt import VMT
        from SourceIO.library.source1.vtf import load_texture
        from SourceIO.library.utils import TinyPath

        cm = ContentManager()

        roots_raw: list[str] = []
        if args.map_root:
            roots_raw.append(str(args.map_root))
        roots_raw.extend(args.content_roots or [])
        roots = [p for p in dedupe_paths(roots_raw) if p.exists() and p.is_dir()]
        if not roots:
            raise RuntimeError("no_valid_content_roots")

        for root in roots:
            cm.scan_for_content(TinyPath(str(root)))

        out_dir.mkdir(parents=True, exist_ok=True)

        warnings: list[str] = []
        if Image is None:
            warnings.append("pillow_not_available")

        by_base_texture: dict[str, str] = {}
        results: list[dict] = []

        for material in materials:
            entry: dict = {
                "material": material,
                "status": "unknown",
            }
            try:
                vmt_rel = f"materials/{material}.vmt"
                vmt_file = cm.find_file(TinyPath(vmt_rel))
                if vmt_file is None:
                    entry["status"] = "missing_vmt"
                    results.append(entry)
                    continue

                vmt = VMT(vmt_file, material, cm)
                base = (
                    vmt.get_string("$basetexture", None)
                    or vmt.get_string("$hdrbasetexture", None)
                    or vmt.get_string("$hdrcompressedtexture", None)
                )
                if not base:
                    entry["status"] = "no_basetexture"
                    results.append(entry)
                    continue

                base_texture = normalize_material_name(str(base))
                entry["resolvedBaseTexture"] = base_texture
                entry["sourcePath"] = vmt_rel

                cached_file = by_base_texture.get(base_texture)
                if cached_file:
                    entry["status"] = "ok"
                    entry["textureFile"] = cached_file
                    results.append(entry)
                    continue

                if Image is None:
                    entry["status"] = "pillow_missing"
                    results.append(entry)
                    continue

                vtf_rel = f"materials/{base_texture}.vtf"
                vtf_file = cm.find_file(TinyPath(vtf_rel))
                if vtf_file is None:
                    entry["status"] = "missing_vtf"
                    results.append(entry)
                    continue

                rgba_data, height, width = load_texture(vtf_file)
                if rgba_data is None or width <= 0 or height <= 0:
                    entry["status"] = "vtf_decode_failed"
                    results.append(entry)
                    continue

                rgba = np.array(rgba_data).reshape((height, width, 4))
                rgba8 = to_rgba8(rgba)
                image = Image.fromarray(rgba8, mode="RGBA")
                max_size = max(0, int(args.max_size or 0))
                if max_size > 0 and max(image.size) > max_size:
                    image.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)

                file_name = sanitize_filename(base_texture)
                out_file = out_dir / file_name
                if not out_file.exists():
                    image.save(out_file, format="PNG", optimize=True)

                by_base_texture[base_texture] = file_name
                entry["status"] = "ok"
                entry["textureFile"] = file_name
                entry["textureWidth"] = int(image.size[0])
                entry["textureHeight"] = int(image.size[1])
                results.append(entry)
            except Exception as mat_err:
                entry["status"] = "error"
                entry["error"] = f"{type(mat_err).__name__}: {mat_err}"
                results.append(entry)

        payload = {
            "ok": True,
            "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "durationMs": int((time.time() - started) * 1000),
            "rootsScanned": [str(root) for root in roots],
            "materialsRequested": len(materials),
            "materialsWithTexture": sum(1 for item in results if item.get("status") == "ok"),
            "texturesExported": len(by_base_texture),
            "warnings": warnings,
            "materials": results,
        }
        write_json(out_json, payload)
        return 0
    except Exception as err:
        payload = {
            "ok": False,
            "durationMs": int((time.time() - started) * 1000),
            "error": f"{type(err).__name__}: {err}",
            "trace": traceback.format_exc().splitlines()[-12:],
        }
        write_json(out_json, payload)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
