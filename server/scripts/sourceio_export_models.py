#!/usr/bin/env python3
import argparse
import hashlib
import json
import sys
import time
import traceback
from pathlib import Path

import numpy as np


def normalize_model_name(raw: str) -> str:
    value = (raw or "").strip().replace("\\", "/").lower()
    value = value.lstrip("./")
    if value.startswith("/"):
        value = value[1:]
    if value.startswith("models/"):
        value = value[len("models/") :]
    if value.endswith(".mdl"):
        value = value[: -len(".mdl")]
    return value


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
    parser = argparse.ArgumentParser(description="Export Source1 prop model meshes via SourceIO")
    parser.add_argument("--sourceio-root", required=True, dest="sourceio_root")
    parser.add_argument("--models-json", required=True, dest="models_json")
    parser.add_argument("--map-root", required=False, dest="map_root")
    parser.add_argument("--content-root", action="append", dest="content_roots", default=[])
    parser.add_argument("--out-dir", required=True, dest="out_dir")
    parser.add_argument("--out", required=True, dest="out")
    parser.add_argument("--lod", required=False, type=int, default=1, dest="lod")
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


def sanitize_model_file_name(model: str) -> str:
    digest = hashlib.sha1(model.encode("utf8", errors="ignore")).hexdigest()[:18]
    safe = model.replace("/", "_").replace("\\", "_")
    safe = "".join(ch for ch in safe if ch.isalnum() or ch in ("_", "-"))[:48]
    if not safe:
        safe = "model"
    return f"{safe}_{digest}.json"


def merge_strip_groups(vtx_mesh):
    indices_accumulator = []
    vertex_accumulator = []
    vertex_offset = 0
    for strip_group in getattr(vtx_mesh, "strip_groups", []) or []:
        strip_indices = np.asarray(getattr(strip_group, "indices", []), dtype=np.uint32)
        if strip_indices.size == 0:
            continue
        indices_accumulator.append(strip_indices + np.uint32(vertex_offset))
        src_vertices = np.asarray(
            strip_group.vertexes["original_mesh_vertex_index"].reshape(-1),
            dtype=np.uint32,
        )
        vertex_accumulator.append(src_vertices)
        vertex_offset += int(sum(int(getattr(strip, "vertex_count", 0)) for strip in strip_group.strips))

    if not indices_accumulator:
        return (
            np.zeros((0,), dtype=np.uint32),
            np.zeros((0,), dtype=np.uint32),
            0,
        )

    return (
        np.concatenate(indices_accumulator).astype(np.uint32, copy=False),
        np.concatenate(vertex_accumulator).astype(np.uint32, copy=False),
        int(vertex_offset),
    )


def merge_meshes(mdl_model, vtx_model_lod):
    vtx_vertices = []
    acc = 0
    mat_arrays = []
    indices_array = []

    vtx_meshes = list(getattr(vtx_model_lod, "meshes", []) or [])
    mdl_meshes = list(getattr(mdl_model, "meshes", []) or [])

    for vtx_mesh, mesh in zip(vtx_meshes, mdl_meshes):
        if not getattr(vtx_mesh, "strip_groups", None):
            continue

        vertex_start = int(getattr(mesh, "vertex_index_start", 0))
        indices, vertices, offset = merge_strip_groups(vtx_mesh)
        if indices.size == 0:
            continue
        indices = indices + np.uint32(acc)
        material_index = int(getattr(mesh, "material_index", 0))
        mat_array = np.full(indices.shape[0] // 3, material_index, dtype=np.int32)
        mat_arrays.append(mat_array)
        vtx_vertices.append(vertices + np.uint32(vertex_start))
        indices_array.append(indices)
        acc += int(offset)

    if not indices_array or not vtx_vertices or not mat_arrays:
        return (
            np.zeros((0,), dtype=np.uint32),
            np.zeros((0,), dtype=np.uint32),
            np.zeros((0,), dtype=np.int32),
        )

    return (
        np.concatenate(vtx_vertices).astype(np.uint32, copy=False),
        np.concatenate(indices_array).astype(np.uint32, copy=False),
        np.concatenate(mat_arrays).astype(np.int32, copy=False),
    )


def pick_lod(model_lods, requested_lod: int):
    if not model_lods:
        return None, None
    max_lod = len(model_lods) - 1
    candidate = min(max(0, int(requested_lod)), max_lod)
    if getattr(model_lods[candidate], "meshes", None):
        return candidate, model_lods[candidate]
    for idx, lod in enumerate(model_lods):
        if getattr(lod, "meshes", None):
            return idx, lod
    return None, None


def load_mdl_from_buffer(buffer):
    from SourceIO.library.models.mdl.v2531 import MdlV2531
    from SourceIO.library.models.mdl.v36 import MdlV36
    from SourceIO.library.models.mdl.v44 import MdlV44
    from SourceIO.library.models.mdl.v49 import MdlV49
    from SourceIO.library.models.mdl.v52.mdl_file import MdlV52

    with buffer.save_current_offset():
        ident = buffer.read_fourcc()
        version = int(buffer.read_int32())
        buffer.seek(0)
    if ident != "IDST":
        raise RuntimeError(f"invalid_mdl_ident:{ident}")

    if version == 2531:
        return MdlV2531.from_buffer(buffer), version
    if version == 52:
        return MdlV52.from_buffer(buffer), version
    if 45 <= version <= 51:
        return MdlV49.from_buffer(buffer), version
    if version >= 44:
        return MdlV44.from_buffer(buffer), version
    if version >= 36:
        return MdlV36.from_buffer(buffer), version
    raise RuntimeError(f"unsupported_mdl_version:{version}")


def export_model_mesh(model: str, cm, requested_lod: int):
    from SourceIO.library.models.vtx import open_vtx
    from SourceIO.library.models.vvd import Vvd
    from SourceIO.library.utils.path_utilities import collect_full_material_names, find_vtx_cm
    from SourceIO.library.utils.tiny_path import TinyPath

    model_rel = TinyPath(f"models/{model}.mdl")
    mdl_buffer = cm.find_file(model_rel)
    searched_mdl = f"models/{model}.mdl"
    searched_vtx = f"models/{model}.dx90.vtx"
    searched_vvd = f"models/{model}.vvd"
    if mdl_buffer is None:
        return {"status": "missing_mdl", "searchedMdl": searched_mdl}

    vtx_buffer = find_vtx_cm(model_rel, cm)
    vvd_buffer = cm.find_file(model_rel.with_suffix(".vvd"))
    if vtx_buffer is None or vvd_buffer is None:
        return {
            "status": "missing_vtx_or_vvd",
            "searchedMdl": searched_mdl,
            "searchedVtx": searched_vtx,
            "searchedVvd": searched_vvd,
        }

    mdl, mdl_version = load_mdl_from_buffer(mdl_buffer)
    vtx = open_vtx(vtx_buffer)
    vvd = Vvd.from_buffer(vvd_buffer)

    if not getattr(vvd, "lod_data", None):
        return {
            "status": "vvd_lod_missing",
            "mdlVersion": mdl_version,
            "searchedMdl": searched_mdl,
            "searchedVtx": searched_vtx,
            "searchedVvd": searched_vvd,
        }

    all_vertices = vvd.lod_data[0]
    if all_vertices is None or len(all_vertices) == 0:
        return {
            "status": "vvd_vertices_missing",
            "mdlVersion": mdl_version,
            "searchedMdl": searched_mdl,
            "searchedVtx": searched_vtx,
            "searchedVvd": searched_vvd,
        }

    materials = [str(getattr(mat, "name", "") or "") for mat in getattr(mdl, "materials", [])]
    mat_paths = [str(item) for item in getattr(mdl, "materials_paths", [])]
    full_material_names = collect_full_material_names(materials, mat_paths, cm)

    buckets: dict[str, dict[str, list[np.ndarray] | int]] = {}
    lod_used = None
    total_triangles = 0
    total_vertices = 0
    bounds_min = np.array([np.inf, np.inf, np.inf], dtype=np.float64)
    bounds_max = np.array([-np.inf, -np.inf, -np.inf], dtype=np.float64)

    body_parts = list(getattr(mdl, "body_parts", []) or [])
    vtx_body_parts = list(getattr(vtx, "body_parts", []) or [])
    for vtx_body_part, body_part in zip(vtx_body_parts, body_parts):
        for vtx_model, mdl_model in zip(getattr(vtx_body_part, "models", []) or [], getattr(body_part, "models", []) or []):
            vertex_count = int(getattr(mdl_model, "vertex_count", 0))
            vertex_offset = int(getattr(mdl_model, "vertex_offset", 0))
            if vertex_count <= 0:
                continue
            if vertex_offset < 0 or vertex_offset + vertex_count > len(all_vertices):
                continue

            lod_idx, lod = pick_lod(getattr(vtx_model, "model_lods", []), requested_lod)
            if lod is None:
                continue
            lod_used = lod_idx if lod_used is None else min(lod_used, lod_idx)

            vtx_vertices, indices_array, material_indices_array = merge_meshes(mdl_model, lod)
            if indices_array.size == 0 or vtx_vertices.size == 0:
                continue
            if material_indices_array.size == 0 or (indices_array.size // 3) != material_indices_array.size:
                continue

            model_vertices = all_vertices[vertex_offset: vertex_offset + vertex_count]
            if np.max(vtx_vertices, initial=0) >= model_vertices.shape[0]:
                continue

            vertices = model_vertices[vtx_vertices]
            positions = np.asarray(vertices["vertex"], dtype=np.float32)
            uvs = np.asarray(vertices["uv"], dtype=np.float32).copy()
            if uvs.ndim == 2 and uvs.shape[1] >= 2:
                uvs[:, 1] = 1.0 - uvs[:, 1]

            tris = indices_array.reshape((-1, 3))
            unique_materials = np.unique(material_indices_array)
            for mat_id in unique_materials:
                tri_mask = material_indices_array == mat_id
                tri_subset = tris[tri_mask]
                if tri_subset.size == 0:
                    continue
                tri_subset_flat = tri_subset.reshape(-1)
                unique_vertices, inverse = np.unique(tri_subset_flat, return_inverse=True)
                if unique_vertices.size == 0:
                    continue
                sub_positions = positions[unique_vertices]
                sub_uvs = uvs[unique_vertices] if uvs.shape[0] == positions.shape[0] else np.zeros((unique_vertices.size, 2), dtype=np.float32)
                sub_indices = inverse.astype(np.uint32)

                mat_idx = int(mat_id)
                if 0 <= mat_idx < len(materials):
                    mat_name = normalize_material_name(full_material_names.get(materials[mat_idx], materials[mat_idx]))
                else:
                    mat_name = "__missing_material"
                if not mat_name:
                    mat_name = "__missing_material"

                bucket = buckets.get(mat_name)
                if bucket is None:
                    bucket = {
                        "positions": [],
                        "uvs": [],
                        "indices": [],
                        "vertex_offset": 0,
                        "tri_count": 0,
                    }
                    buckets[mat_name] = bucket

                voffset = int(bucket["vertex_offset"])
                bucket["positions"].append(sub_positions.astype(np.float32, copy=False))
                bucket["uvs"].append(sub_uvs.astype(np.float32, copy=False))
                bucket["indices"].append((sub_indices + np.uint32(voffset)).astype(np.uint32, copy=False))
                bucket["vertex_offset"] = voffset + int(sub_positions.shape[0])
                bucket["tri_count"] = int(bucket["tri_count"]) + int(sub_indices.size // 3)

                total_triangles += int(sub_indices.size // 3)
                total_vertices += int(sub_positions.shape[0])
                bounds_min = np.minimum(bounds_min, np.min(sub_positions, axis=0))
                bounds_max = np.maximum(bounds_max, np.max(sub_positions, axis=0))

    if not buckets:
        return {
            "status": "no_mesh_data",
            "mdlVersion": mdl_version,
            "searchedMdl": searched_mdl,
            "searchedVtx": searched_vtx,
        }

    sub_meshes = []
    byte_estimate = 0
    for material, bucket in sorted(buckets.items(), key=lambda item: item[0]):
        positions_blocks = bucket["positions"]
        uv_blocks = bucket["uvs"]
        index_blocks = bucket["indices"]
        if not positions_blocks or not index_blocks:
            continue
        positions_arr = np.concatenate(positions_blocks, axis=0).astype(np.float32, copy=False)
        uvs_arr = np.concatenate(uv_blocks, axis=0).astype(np.float32, copy=False)
        indices_arr = np.concatenate(index_blocks, axis=0).astype(np.uint32, copy=False)
        tri_count = int(bucket["tri_count"])
        vertex_count = int(positions_arr.shape[0])

        byte_estimate += int(positions_arr.size * 4 + uvs_arr.size * 4 + indices_arr.size * 4)
        sub_meshes.append(
            {
                "material": material,
                "materialId": material,
                "placeholderMaterial": material == "__missing_material",
                "triCount": tri_count,
                "vertexCount": vertex_count,
                "positions": positions_arr.reshape(-1).astype(np.float32).tolist(),
                "uvs": uvs_arr.reshape(-1).astype(np.float32).tolist(),
                "indices": indices_arr.reshape(-1).astype(np.uint32).tolist(),
            }
        )

    if not sub_meshes:
        return {
            "status": "no_sub_meshes",
            "mdlVersion": mdl_version,
            "searchedMdl": searched_mdl,
            "searchedVtx": searched_vtx,
        }

    if not np.isfinite(bounds_min).all() or not np.isfinite(bounds_max).all():
        bounds_min = np.array([0.0, 0.0, 0.0], dtype=np.float64)
        bounds_max = np.array([0.0, 0.0, 0.0], dtype=np.float64)

    return {
        "status": "ok",
        "searchedMdl": searched_mdl,
        "searchedVtx": searched_vtx,
        "searchedVvd": searched_vvd,
        "mdlVersion": mdl_version,
        "lodUsed": int(lod_used) if lod_used is not None else int(max(0, requested_lod)),
        "triCount": int(total_triangles),
        "vertexCount": int(total_vertices),
        "subMeshCount": len(sub_meshes),
        "byteEstimate": int(byte_estimate),
        "bounds": {
            "min": [float(bounds_min[0]), float(bounds_min[1]), float(bounds_min[2])],
            "max": [float(bounds_max[0]), float(bounds_max[1]), float(bounds_max[2])],
        },
        "subMeshes": sub_meshes,
    }


def main() -> int:
    args = parse_args()
    out_json = Path(args.out).resolve()
    out_dir = Path(args.out_dir).resolve()
    started = time.time()

    try:
        sourceio_root = Path(args.sourceio_root).resolve()
        if not sourceio_root.exists():
            raise RuntimeError(f"sourceio_root_not_found: {sourceio_root}")

        models_path = Path(args.models_json).resolve()
        if not models_path.exists():
            raise RuntimeError(f"models_json_not_found: {models_path}")

        models_raw = json.loads(models_path.read_text(encoding="utf8"))
        if isinstance(models_raw, dict):
            models_input = models_raw.get("models", [])
        else:
            models_input = models_raw
        if not isinstance(models_input, list):
            raise RuntimeError("models_json_invalid_format")

        requested_models = sorted(
            {
                normalize_model_name(str(item))
                for item in models_input
                if normalize_model_name(str(item))
            }
        )

        sys.path.insert(0, str(sourceio_root.parent))

        from SourceIO.library.shared.content_manager import ContentManager
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

        results: list[dict] = []
        warnings: list[str] = []

        for model in requested_models:
            entry = {
                "model": model,
                "status": "unknown",
                "sourcePath": f"models/{model}.mdl",
            }
            try:
                exported = export_model_mesh(model, cm, int(args.lod or 0))
                status = str(exported.get("status") or "unknown")
                entry["status"] = status
                if status == "ok":
                    mesh_payload = {
                        "id": model,
                        "sourceModel": model,
                        "lod": int(exported.get("lodUsed", max(0, int(args.lod or 0)))),
                        "bounds": exported["bounds"],
                        "stats": {
                            "triCount": int(exported.get("triCount", 0)),
                            "vertexCount": int(exported.get("vertexCount", 0)),
                            "subMeshCount": int(exported.get("subMeshCount", 0)),
                            "byteEstimate": int(exported.get("byteEstimate", 0)),
                        },
                        "subMeshes": exported["subMeshes"],
                    }
                    mesh_file = sanitize_model_file_name(model)
                    write_json(out_dir / mesh_file, mesh_payload)

                    entry["meshFile"] = mesh_file
                    entry["lodUsed"] = mesh_payload["lod"]
                    entry["mdlVersion"] = int(exported.get("mdlVersion", 0))
                    entry["triCount"] = mesh_payload["stats"]["triCount"]
                    entry["vertexCount"] = mesh_payload["stats"]["vertexCount"]
                    entry["subMeshCount"] = mesh_payload["stats"]["subMeshCount"]
                    entry["byteEstimate"] = mesh_payload["stats"]["byteEstimate"]
                    entry["bounds"] = mesh_payload["bounds"]
                    entry["materials"] = [item.get("material", "__missing_material") for item in mesh_payload["subMeshes"]]
                    if "searchedMdl" in exported:
                        entry["searchedMdl"] = str(exported["searchedMdl"])
                    if "searchedVtx" in exported:
                        entry["searchedVtx"] = str(exported["searchedVtx"])
                    if "searchedVvd" in exported:
                        entry["searchedVvd"] = str(exported["searchedVvd"])
                else:
                    if "mdlVersion" in exported:
                        entry["mdlVersion"] = int(exported["mdlVersion"])
                    if "searchedMdl" in exported:
                        entry["searchedMdl"] = str(exported["searchedMdl"])
                    if "searchedVtx" in exported:
                        entry["searchedVtx"] = str(exported["searchedVtx"])
                    if "searchedVvd" in exported:
                        entry["searchedVvd"] = str(exported["searchedVvd"])
                    if "error" in exported:
                        entry["error"] = str(exported["error"])
            except Exception as model_err:
                entry["status"] = "error"
                entry["error"] = f"{type(model_err).__name__}: {model_err}"
                warnings.append(f"model_export_error:{model}:{type(model_err).__name__}")
            results.append(entry)

        payload = {
            "ok": True,
            "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "durationMs": int((time.time() - started) * 1000),
            "rootsScanned": [str(root) for root in roots],
            "modelsRequested": len(requested_models),
            "modelsExported": sum(1 for item in results if item.get("status") == "ok"),
            "warnings": warnings,
            "models": results,
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
