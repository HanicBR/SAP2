#!/usr/bin/env python3
import argparse
import json
import sys
import time
import traceback
from pathlib import Path


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


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Extract Source1 BSP scene summary using SourceIO")
    parser.add_argument("--map-bsp", required=True, dest="map_bsp")
    parser.add_argument("--map-root", required=False, dest="map_root")
    parser.add_argument("--sourceio-root", required=False, dest="sourceio_root")
    parser.add_argument("--out", required=True, dest="out")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    out_path = Path(args.out).resolve()
    started = time.time()

    try:
        sourceio_root_path = None
        sourceio_import_mode = "python_env"
        sourceio_root_raw = str(args.sourceio_root or "").strip()
        if sourceio_root_raw:
            sourceio_root_path = Path(sourceio_root_raw).resolve()
            if not sourceio_root_path.exists():
                raise RuntimeError(f"sourceio_root_not_found: {sourceio_root_path}")
            sys.path.insert(0, str(sourceio_root_path.parent))
            sourceio_import_mode = "sourceio_root_path"

        map_bsp_path = Path(args.map_bsp).resolve()
        if not map_bsp_path.exists():
            raise RuntimeError(f"map_bsp_not_found: {map_bsp_path}")

        map_root_path = Path(args.map_root).resolve() if args.map_root else map_bsp_path.parent
        if not map_root_path.exists():
            raise RuntimeError(f"map_root_not_found: {map_root_path}")

        # Register Source1 lump classes before opening BSP.
        try:
            import SourceIO.library.source1.bsp.lumps  # noqa: F401
            from SourceIO.library.shared.content_manager import ContentManager
            from SourceIO.library.source1.bsp.bsp_file import open_bsp
            from SourceIO.library.utils import FileBuffer, TinyPath
        except Exception as import_err:
            raise RuntimeError(f"sourceio_import_failed:{type(import_err).__name__}:{import_err}") from import_err

        cm = ContentManager()
        cm.scan_for_content(TinyPath(str(map_root_path)))

        file_buffer = FileBuffer(TinyPath(str(map_bsp_path)))
        bsp = open_bsp(TinyPath(str(map_bsp_path)), file_buffer, cm)
        if bsp is None:
            raise RuntimeError("sourceio_open_bsp_failed")

        faces_lump = bsp.get_lump("LUMP_FACES")
        models_lump = bsp.get_lump("LUMP_MODELS")
        surf_edges_lump = bsp.get_lump("LUMP_SURFEDGES")
        edges_lump = bsp.get_lump("LUMP_EDGES")
        vertices_lump = bsp.get_lump("LUMP_VERTICES")
        disp_lump = bsp.get_lump("LUMP_DISPINFO")
        game_lump = bsp.get_lump("LUMP_GAME_LUMP")

        if not faces_lump or not models_lump or not surf_edges_lump or not edges_lump or not vertices_lump:
            raise RuntimeError("sourceio_required_lumps_missing")

        world_model = models_lump.models[0] if models_lump.models else None
        if world_model is None:
            raise RuntimeError("sourceio_world_model_missing")

        world_first_face = int(world_model.first_face)
        world_face_count = int(world_model.face_count)
        world_face_end = world_first_face + world_face_count

        surf_edges = surf_edges_lump.surf_edges
        edges = edges_lump.edges
        vertices = vertices_lump.vertices
        faces = faces_lump.faces

        world_faces = []
        invalid_world_faces = 0
        referenced_disp_ids = set()

        for face_index in range(world_first_face, world_face_end):
            if face_index < 0 or face_index >= len(faces):
                invalid_world_faces += 1
                continue
            face = faces[face_index]
            edge_count = int(face.edge_count)
            first_edge = int(face.first_edge)
            if edge_count <= 0 or first_edge < 0:
                invalid_world_faces += 1
                continue
            surf_end = first_edge + edge_count
            if surf_end > len(surf_edges):
                invalid_world_faces += 1
                continue

            sum_x = 0.0
            sum_y = 0.0
            sum_z = 0.0
            points = 0
            for surf_index in range(first_edge, surf_end):
                edge_ref = int(surf_edges[surf_index])
                if edge_ref >= 0:
                    if edge_ref >= len(edges):
                        continue
                    vertex_index = int(edges[edge_ref][0])
                else:
                    edge_id = -edge_ref
                    if edge_id >= len(edges):
                        continue
                    vertex_index = int(edges[edge_id][1])

                if vertex_index < 0 or vertex_index >= len(vertices):
                    continue
                vertex = vertices[vertex_index]
                sum_x += float(vertex[0])
                sum_y += float(vertex[1])
                sum_z += float(vertex[2])
                points += 1

            if points <= 0:
                invalid_world_faces += 1
                continue

            disp_info_id = int(face.disp_info_id)
            if disp_info_id >= 0:
                referenced_disp_ids.add(disp_info_id)

            tri_count = max(1, points - 2)
            byte_estimate = tri_count * 3 * 24
            world_faces.append([
                sum_x / points,
                sum_y / points,
                sum_z / points,
                int(face.tex_info_id),
                disp_info_id,
                int(points),
                int(tri_count),
                int(byte_estimate),
            ])

        world_faces_exported = len(world_faces)
        world_coverage_pct = (
            (float(world_faces_exported) * 100.0 / float(world_face_count))
            if world_face_count > 0
            else 0.0
        )

        static_props = []
        static_prop_models = []
        if game_lump and hasattr(game_lump, "game_lumps") and isinstance(game_lump.game_lumps, dict):
            sprp = game_lump.game_lumps.get("sprp")
            if sprp:
                static_prop_models = [normalize_model_name(name) for name in getattr(sprp, "model_names", [])]
                for prop in getattr(sprp, "static_props", []):
                    model_index = int(getattr(prop, "prop_type", -1))
                    model_name = (
                        static_prop_models[model_index]
                        if 0 <= model_index < len(static_prop_models)
                        else f"__missing_model_ref_{model_index}"
                    )
                    origin = list(getattr(prop, "origin", (0.0, 0.0, 0.0)))
                    rotation = list(getattr(prop, "rotation", (0.0, 0.0, 0.0)))
                    scaling = list(getattr(prop, "scaling", (1.0, 1.0, 1.0)))
                    if len(scaling) != 3:
                        scaling = [1.0, 1.0, 1.0]
                    static_props.append(
                        {
                            "model": model_name,
                            "modelIndex": model_index,
                            "origin": [float(origin[0]), float(origin[1]), float(origin[2])],
                            "angles": [float(rotation[0]), float(rotation[1]), float(rotation[2])],
                            "scale": [float(scaling[0]), float(scaling[1]), float(scaling[2])],
                        }
                    )

        disp_total = 0
        if disp_lump and hasattr(disp_lump, "infos"):
            disp_total = len(disp_lump.infos)

        payload = {
            "ok": True,
            "engine": "sourceio",
            "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "durationMs": int((time.time() - started) * 1000),
            "sourceio": {
                "importMode": sourceio_import_mode,
                **({"rootPath": str(sourceio_root_path)} if sourceio_root_path is not None else {}),
            },
            "map": {
                "bspPath": str(map_bsp_path),
                "mapRoot": str(map_root_path),
                "mapName": map_bsp_path.stem,
                "ident": str(getattr(bsp.info, "ident", "")),
                "versionMajor": int(bsp.info.version[0]) if bsp.info and bsp.info.version else 0,
                "versionMinor": int(bsp.info.version[1]) if bsp.info and bsp.info.version else 0,
            },
            "world": {
                "bounds": {
                    "min": [float(world_model.mins[0]), float(world_model.mins[1]), float(world_model.mins[2])],
                    "max": [float(world_model.maxs[0]), float(world_model.maxs[1]), float(world_model.maxs[2])],
                },
                "facesTotal": len(faces),
                "worldFacesTotal": world_face_count,
                "worldFacesExported": world_faces_exported,
                "worldFacesInvalid": invalid_world_faces,
                "worldCoveragePct": round(world_coverage_pct, 4),
                "displacementsTotal": int(disp_total),
                "displacementsReferencedByWorld": len(referenced_disp_ids),
                "faces": world_faces,
            },
            "staticProps": {
                "total": len(static_props),
                "uniqueModels": len({item["model"] for item in static_props}),
                "instances": static_props,
            },
            "warnings": [],
        }
        write_json(out_path, payload)
        return 0
    except Exception as err:
        payload = {
            "ok": False,
            "engine": "sourceio",
            "durationMs": int((time.time() - started) * 1000),
            "error": f"{type(err).__name__}: {err}",
            "trace": traceback.format_exc().splitlines()[-12:],
        }
        write_json(out_path, payload)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
