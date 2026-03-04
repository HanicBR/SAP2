#!/usr/bin/env python3
import argparse
import hashlib
import json
import re
import sys
import time
import traceback
from pathlib import Path
from typing import Optional, Set, Tuple

import numpy as np

try:
    from PIL import Image
except Exception:
    Image = None


_DIR_ENTRIES_CACHE: dict[str, dict[str, str]] = {}


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
    parser.add_argument("--sourceio-root", required=False, dest="sourceio_root")
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


def _dir_entries_ci(directory: Path) -> dict[str, str]:
    key = str(directory)
    cached = _DIR_ENTRIES_CACHE.get(key)
    if cached is not None:
        return cached
    out: dict[str, str] = {}
    try:
        for item in directory.iterdir():
            lowered = item.name.lower()
            if lowered not in out:
                out[lowered] = item.name
    except Exception:
        out = {}
    _DIR_ENTRIES_CACHE[key] = out
    return out


def resolve_ci_path(root: Path, rel_path: str) -> Optional[Path]:
    normalized = rel_path.replace("\\", "/").strip().lstrip("/")
    if not normalized:
        return None
    parts = [part for part in normalized.split("/") if part]
    if not parts:
        return None
    current = root
    for part in parts:
        exact = current / part
        if exact.exists():
            current = exact
            continue
        if not current.exists() or not current.is_dir():
            return None
        entries = _dir_entries_ci(current)
        matched = entries.get(part.lower())
        if not matched:
            return None
        current = current / matched
    if current.exists() and current.is_file():
        return current
    return None


def resolve_relative_to_root(found: Path, roots: list[Path]) -> Optional[str]:
    for root in roots:
        try:
            return found.relative_to(root).as_posix()
        except Exception:
            continue
    return None


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


def is_special_material(material: str) -> bool:
    key = normalize_material_name(material)
    if key.startswith("tools/") or key.startswith("editor/"):
        return True
    if "toolsskybox" in key:
        return True
    if "skybox" in key:
        return True
    if "water" in key:
        return True
    return False


def find_fs_file(roots: list[Path], rel_path: str) -> Optional[Path]:
    normalized = rel_path.replace("\\", "/").strip().lstrip("/")
    if not normalized:
        return None
    for root in roots:
        candidate = resolve_ci_path(root, normalized)
        if candidate is not None:
            return candidate
    return None


def _extract_vmt_pairs(vmt_text: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for raw_line in (vmt_text or "").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("//"):
            continue
        if "//" in line:
            line = line.split("//", 1)[0].strip()
        if not line:
            continue
        # "key" "value" or key value
        m = re.match(r'^"?([a-zA-Z0-9_$/.-]+)"?\s+"?([^"]+?)"?$', line)
        if not m:
            continue
        key = str(m.group(1) or "").strip().lower()
        value = str(m.group(2) or "").strip()
        if not key or not value:
            continue
        out[key] = value
    return out


def _normalize_include_material(raw: str) -> str:
    value = normalize_material_name(raw)
    return value


def resolve_basetexture_from_vmt_text(vmt_text: str) -> Tuple[Optional[str], Optional[str]]:
    pairs = _extract_vmt_pairs(vmt_text)
    for base_key in ("$basetexture", "$hdrbasetexture", "$hdrcompressedtexture"):
        raw = pairs.get(base_key)
        if raw:
            normalized = normalize_material_name(raw)
            if normalized:
                return normalized, None

    # Light fallback for patch-style replacement blocks.
    replace_match = re.search(
        r'\$basetexture\s*"?\s*"?([^"\s]+)',
        vmt_text or "",
        flags=re.IGNORECASE,
    )
    if replace_match:
        normalized = normalize_material_name(str(replace_match.group(1) or ""))
        if normalized:
            return normalized, None

    return None, "no_basetexture_in_text"


def resolve_basetexture_from_vmt_fs(
    roots: list[Path],
    material: str,
    visited: Optional[Set[str]] = None,
    max_depth: int = 8,
) -> Tuple[Optional[str], Optional[str]]:
    if visited is None:
        visited = set()
    key = normalize_material_name(material)
    if not key:
        return None, "empty_material_key"
    if key in visited:
        return None, "include_cycle"
    if len(visited) >= max_depth:
        return None, "include_depth_limit"
    visited.add(key)

    rel_vmt = f"materials/{key}.vmt"
    fs_vmt = find_fs_file(roots, rel_vmt)
    if fs_vmt is None:
        return None, "vmt_not_found_on_fs"

    try:
        text = fs_vmt.read_text(encoding="latin1", errors="ignore")
    except Exception:
        return None, "vmt_read_failed"

    resolved, parse_err = resolve_basetexture_from_vmt_text(text)
    if resolved:
        return resolved, None

    pairs = _extract_vmt_pairs(text)
    include_raw = pairs.get("include") or pairs.get("$include")
    if include_raw:
        include_mat = _normalize_include_material(include_raw)
        if include_mat:
            resolved, include_err = resolve_basetexture_from_vmt_fs(
                roots=roots,
                material=include_mat,
                visited=visited,
                max_depth=max_depth,
            )
            if resolved:
                return resolved, None
            return None, include_err or "include_without_basetexture"

    return None, parse_err or "no_basetexture_in_text"


def main() -> int:
    args = parse_args()
    out_json = Path(args.out).resolve()
    out_dir = Path(args.out_dir).resolve()
    started = time.time()

    try:
        sourceio_root = None
        sourceio_import_mode = "python_env"
        sourceio_root_raw = str(args.sourceio_root or "").strip()
        if sourceio_root_raw:
            sourceio_root = Path(sourceio_root_raw).resolve()
            if not sourceio_root.exists():
                raise RuntimeError(f"sourceio_root_not_found: {sourceio_root}")
            sys.path.insert(0, str(sourceio_root.parent))
            sourceio_import_mode = "sourceio_root_path"

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

        try:
            from SourceIO.library.shared.content_manager import ContentManager
            from SourceIO.library.source1.vmt import VMT
            from SourceIO.library.source1.vtf import load_texture
            from SourceIO.library.utils import FileBuffer, TinyPath
        except Exception as import_err:
            raise RuntimeError(f"sourceio_import_failed:{type(import_err).__name__}:{import_err}") from import_err

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
                entry["searchedVmt"] = vmt_rel
                vmt_file = cm.find_file(TinyPath(vmt_rel))
                vmt_fs_path = find_fs_file(roots, vmt_rel)
                if vmt_file is None and vmt_fs_path is not None:
                    rel_vmt_fs = resolve_relative_to_root(vmt_fs_path, roots)
                    if rel_vmt_fs:
                        entry["searchedVmtResolved"] = rel_vmt_fs
                        vmt_file = cm.find_file(TinyPath(rel_vmt_fs))
                if vmt_file is None and vmt_fs_path is None:
                    if is_special_material(material):
                        entry["status"] = "missing_vmt_special"
                    else:
                        entry["status"] = "missing_vmt"
                    results.append(entry)
                    continue

                base_texture: Optional[str] = None
                parse_error: Optional[str] = None

                if vmt_file is not None:
                    try:
                        vmt = VMT(vmt_file, material, cm)
                        base = (
                            vmt.get_string("$basetexture", None)
                            or vmt.get_string("$hdrbasetexture", None)
                            or vmt.get_string("$hdrcompressedtexture", None)
                        )
                        if base:
                            base_texture = normalize_material_name(str(base))
                    except Exception as parse_err:
                        parse_error = f"{type(parse_err).__name__}: {parse_err}"

                if not base_texture:
                    inline_fallback_err: Optional[str] = None
                    if vmt_file is not None:
                        try:
                            raw_inline = vmt_file.read()
                            if isinstance(raw_inline, bytes):
                                inline_text = raw_inline.decode("latin1", errors="ignore")
                            else:
                                inline_text = str(raw_inline or "")
                            fallback_inline, inline_fallback_err = resolve_basetexture_from_vmt_text(inline_text)
                            if fallback_inline:
                                base_texture = normalize_material_name(fallback_inline)
                                entry["parseFallback"] = "vmt_text_inline"
                        except Exception as inline_err:
                            inline_fallback_err = f"inline_vmt_read_failed:{type(inline_err).__name__}"

                if not base_texture:
                    fallback_base, fallback_err = resolve_basetexture_from_vmt_fs(
                        roots=roots,
                        material=material,
                    )
                    if fallback_base:
                        base_texture = normalize_material_name(fallback_base)
                        entry["parseFallback"] = "vmt_text"
                    elif fallback_err:
                        entry["parseFallbackError"] = fallback_err
                    elif inline_fallback_err:
                        entry["parseFallbackError"] = inline_fallback_err

                if not base_texture:
                    if is_special_material(material):
                        entry["status"] = "no_basetexture_special"
                    elif parse_error:
                        entry["status"] = "vmt_parse_error"
                        entry["error"] = parse_error
                    else:
                        entry["status"] = "no_basetexture"
                    results.append(entry)
                    continue

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
                entry["searchedVtf"] = vtf_rel
                vtf_file = cm.find_file(TinyPath(vtf_rel))
                vtf_fs = find_fs_file(roots, vtf_rel)
                if vtf_file is None and vtf_fs is not None:
                    rel_vtf_fs = resolve_relative_to_root(vtf_fs, roots)
                    if rel_vtf_fs:
                        entry["searchedVtfResolved"] = rel_vtf_fs
                        vtf_file = cm.find_file(TinyPath(rel_vtf_fs))
                if vtf_file is None and vtf_fs is not None:
                    try:
                        entry["searchedVtfResolvedFs"] = str(vtf_fs)
                        vtf_file = FileBuffer(TinyPath(str(vtf_fs)))
                    except Exception:
                        vtf_file = None
                if vtf_file is None:
                    if vtf_fs is not None:
                        entry["sourcePath"] = str(vtf_fs)
                    if is_special_material(material):
                        entry["status"] = "missing_vtf_special"
                    else:
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
                error_msg = f"{type(mat_err).__name__}: {mat_err}"
                if is_special_material(material):
                    entry["status"] = "special_error"
                    entry["error"] = error_msg
                else:
                    entry["status"] = "error"
                    entry["error"] = error_msg
                results.append(entry)

        payload = {
            "ok": True,
            "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "durationMs": int((time.time() - started) * 1000),
            "sourceio": {
                "importMode": sourceio_import_mode,
                **({"rootPath": str(sourceio_root)} if sourceio_root is not None else {}),
            },
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
