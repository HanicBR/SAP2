#!/usr/bin/env python3
import argparse
import json
import lzma
import os
import posixpath
import shutil
import struct
import tempfile
import time
import traceback
import zipfile
from pathlib import Path
from typing import BinaryIO, Dict, List, Optional, Tuple


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Extract Workshop payloads (.gma and legacy .bin) for GMod maps")
    parser.add_argument("--input-dir", required=True, dest="input_dir")
    parser.add_argument("--out-dir", required=True, dest="out_dir")
    parser.add_argument("--workshop-id", required=True, dest="workshop_id")
    parser.add_argument("--report", required=True, dest="report")
    parser.add_argument("--clean-out-dir", action="store_true", dest="clean_out_dir")
    return parser.parse_args()


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf8")


def read_u8(fp: BinaryIO) -> int:
    raw = fp.read(1)
    if len(raw) != 1:
        raise RuntimeError("unexpected_eof_u8")
    return raw[0]


def read_u32(fp: BinaryIO) -> int:
    raw = fp.read(4)
    if len(raw) != 4:
        raise RuntimeError("unexpected_eof_u32")
    return struct.unpack("<I", raw)[0]


def read_u64(fp: BinaryIO) -> int:
    raw = fp.read(8)
    if len(raw) != 8:
        raise RuntimeError("unexpected_eof_u64")
    return struct.unpack("<Q", raw)[0]


def read_cstring(fp: BinaryIO) -> str:
    data = bytearray()
    while True:
        ch = fp.read(1)
        if len(ch) != 1:
            raise RuntimeError("unexpected_eof_cstring")
        if ch == b"\x00":
            break
        data.extend(ch)
        if len(data) > 1024 * 1024:
            raise RuntimeError("cstring_too_large")
    return data.decode("utf8", errors="ignore")


def looks_like_gma(path: Path) -> bool:
    try:
        with path.open("rb") as fp:
            return fp.read(4) == b"GMAD"
    except Exception:
        return False


def try_decompress_lzma_alone(src_path: Path, tmp_root: Path) -> Optional[Path]:
    target = tmp_root / f"{src_path.name}.decompressed.gma"
    written = 0
    try:
        with lzma.open(src_path, "rb", format=lzma.FORMAT_ALONE) as src, target.open("wb") as dst:
            while True:
                chunk = src.read(1024 * 1024)
                if not chunk:
                    break
                dst.write(chunk)
                written += len(chunk)
    except Exception:
        # Legacy .bin payloads can contain LZMA data that Python's streaming
        # ALONE reader rejects near EOF; retry with FORMAT_AUTO on full bytes.
        try:
            raw = src_path.read_bytes()
            data = lzma.decompress(raw, format=lzma.FORMAT_AUTO)
            target.write_bytes(data)
            written = len(data)
        except Exception:
            try:
                target.unlink(missing_ok=True)  # type: ignore[arg-type]
            except Exception:
                pass
            return None

    if written <= 0:
        try:
            target.unlink(missing_ok=True)  # type: ignore[arg-type]
        except Exception:
            pass
        return None
    if not looks_like_gma(target):
        try:
            target.unlink(missing_ok=True)  # type: ignore[arg-type]
        except Exception:
            pass
        return None
    return target


def try_extract_gma_from_zip(src_path: Path, tmp_root: Path) -> Optional[Path]:
    try:
        with zipfile.ZipFile(src_path, "r") as zf:
            files = [name for name in zf.namelist() if not name.endswith("/")]
            if not files:
                return None
            prioritized = sorted(
                files,
                key=lambda name: (
                    0 if name.lower().endswith(".gma") else 1 if "." not in Path(name).name else 2,
                    len(name),
                ),
            )
            for member in prioritized:
                target = tmp_root / f"{src_path.name}.{Path(member).name}.gma"
                with zf.open(member, "r") as src, target.open("wb") as dst:
                    shutil.copyfileobj(src, dst, 1024 * 1024)
                if looks_like_gma(target):
                    return target
                try:
                    target.unlink(missing_ok=True)  # type: ignore[arg-type]
                except Exception:
                    pass
    except Exception:
        return None
    return None


def sanitize_rel_path(raw: str) -> Optional[str]:
    value = (raw or "").replace("\\", "/").strip()
    if not value:
        return None
    if value.startswith("/"):
        value = value[1:]
    normalized = posixpath.normpath(value)
    if normalized in ("", ".", ".."):
        return None
    if normalized.startswith("../"):
        return None
    if ":" in normalized:
        return None
    return normalized


def extract_gma(gma_path: Path, out_dir: Path) -> Tuple[Dict, List[str]]:
    result = {
        "header": {},
        "filesExtracted": 0,
        "bytesExtracted": 0,
        "bspFiles": [],
    }
    warnings: List[str] = []
    out_dir.mkdir(parents=True, exist_ok=True)

    with gma_path.open("rb") as fp:
        if fp.read(4) != b"GMAD":
            raise RuntimeError("invalid_gma_magic")
        version = read_u8(fp)
        steam_id = 0
        timestamp = 0
        if version >= 2:
            steam_id = read_u64(fp)
            timestamp = read_u64(fp)
        required_content = read_cstring(fp)
        addon_name = read_cstring(fp)
        addon_description = read_cstring(fp)
        addon_author = read_cstring(fp)
        addon_version = read_u32(fp)

        entries: List[Tuple[int, str, int, int]] = []
        while True:
            file_num = read_u32(fp)
            if file_num == 0:
                break
            file_name = read_cstring(fp)
            file_size = read_u64(fp)
            file_crc = read_u32(fp)
            entries.append((file_num, file_name, file_size, file_crc))

        result["header"] = {
            "version": version,
            "steamId": steam_id,
            "timestamp": timestamp,
            "requiredContent": required_content,
            "addonName": addon_name,
            "addonDescription": addon_description,
            "addonAuthor": addon_author,
            "addonVersion": addon_version,
            "entriesCount": len(entries),
        }

        for (_num, name, size, _crc) in entries:
            safe_rel = sanitize_rel_path(name)
            if not safe_rel:
                warnings.append(f"skipped_unsafe_path:{name}")
                fp.seek(size, os.SEEK_CUR)
                continue

            target = out_dir / safe_rel
            target.parent.mkdir(parents=True, exist_ok=True)
            remaining = int(size)
            with target.open("wb") as dst:
                while remaining > 0:
                    chunk_size = min(1024 * 1024, remaining)
                    chunk = fp.read(chunk_size)
                    if not chunk:
                        raise RuntimeError(f"unexpected_eof_file_data:{safe_rel}")
                    dst.write(chunk)
                    remaining -= len(chunk)
            result["filesExtracted"] += 1
            result["bytesExtracted"] += int(size)
            if safe_rel.lower().endswith(".bsp"):
                result["bspFiles"].append(safe_rel)

    result["bspFiles"] = sorted(result["bspFiles"])
    return result, warnings


def discover_candidates(input_dir: Path) -> List[Path]:
    all_files = [p for p in input_dir.rglob("*") if p.is_file()]
    gma_files = [p for p in all_files if p.suffix.lower() == ".gma"]
    bin_files = [p for p in all_files if p.suffix.lower() == ".bin"]
    zip_files = [p for p in all_files if p.suffix.lower() == ".zip"]
    extless_files = [p for p in all_files if p.suffix == ""]
    ordered = sorted(gma_files) + sorted(bin_files) + sorted(zip_files) + sorted(extless_files)
    unique: List[Path] = []
    seen = set()
    for p in ordered:
        key = str(p.resolve()).lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(p)
    return unique


def resolve_gma_source(candidate: Path, tmp_root: Path) -> Tuple[Optional[Path], str, Optional[str]]:
    if looks_like_gma(candidate):
        return candidate, "direct", None

    lzma_out = try_decompress_lzma_alone(candidate, tmp_root)
    if lzma_out is not None:
        return lzma_out, "legacy_bin_lzma", None

    zip_out = try_extract_gma_from_zip(candidate, tmp_root)
    if zip_out is not None:
        return zip_out, "legacy_zip_wrapped", None

    return None, "unsupported", "candidate_not_gma_lzma_or_zip"


def discover_direct_bsp(input_dir: Path) -> List[Path]:
    out: List[Path] = []
    for p in input_dir.rglob("*"):
        if not p.is_file():
            continue
        if p.suffix.lower() != ".bsp":
            continue
        out.append(p.resolve())
    return sorted(out)


def extract_zip_payload(src_path: Path, out_dir: Path) -> Tuple[Dict, List[str]]:
    result = {
        "filesExtracted": 0,
        "bytesExtracted": 0,
        "bspFiles": [],
    }
    warnings: List[str] = []
    out_dir.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(src_path, "r") as zf:
        members = [name for name in zf.namelist() if not name.endswith("/")]
        for member in members:
            safe_rel = sanitize_rel_path(member)
            if not safe_rel:
                warnings.append(f"zip_skipped_unsafe_path:{member}")
                continue

            target = out_dir / safe_rel
            target.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(member, "r") as src, target.open("wb") as dst:
                shutil.copyfileobj(src, dst, 1024 * 1024)
            result["filesExtracted"] += 1
            try:
                result["bytesExtracted"] += int(target.stat().st_size)
            except Exception:
                pass
            if safe_rel.lower().endswith(".bsp"):
                result["bspFiles"].append(safe_rel)

    result["bspFiles"] = sorted(result["bspFiles"])
    return result, warnings


def main() -> int:
    args = parse_args()
    started = time.time()

    input_dir = Path(args.input_dir).resolve()
    out_dir = Path(args.out_dir).resolve()
    report_path = Path(args.report).resolve()
    workshop_id = str(args.workshop_id).strip()

    payload_report = {
        "ok": False,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "durationMs": 0,
        "workshopId": workshop_id,
        "inputDir": str(input_dir),
        "outDir": str(out_dir),
        "candidatesScanned": 0,
        "payloads": [],
        "bspFiles": [],
        "warnings": [],
    }

    try:
        if not input_dir.exists() or not input_dir.is_dir():
            raise RuntimeError(f"input_dir_not_found:{input_dir}")

        if args.clean_out_dir and out_dir.exists():
            shutil.rmtree(out_dir, ignore_errors=True)
        out_dir.mkdir(parents=True, exist_ok=True)

        candidates = discover_candidates(input_dir)
        payload_report["candidatesScanned"] = len(candidates)

        extracted_any = False
        payload_index = 0
        extracted_bsp: List[str] = []
        all_warnings: List[str] = []

        with tempfile.TemporaryDirectory(prefix=f"workshop-{workshop_id}-", dir=str(out_dir)) as tmp_dir_raw:
            tmp_dir = Path(tmp_dir_raw)

            direct_gma_candidates = [c for c in candidates if c.suffix.lower() == ".gma"]
            fallback_candidates = [c for c in candidates if c.suffix.lower() != ".gma"]

            for group in (direct_gma_candidates, fallback_candidates):
                if extracted_any and group is fallback_candidates:
                    break
                for candidate in group:
                    gma_source, source_type, resolve_error = resolve_gma_source(candidate, tmp_dir)
                    if gma_source is None:
                        payload_report["payloads"].append(
                            {
                                "candidate": str(candidate),
                                "status": "skipped",
                                "sourceType": source_type,
                                "error": resolve_error,
                            }
                        )
                        continue

                    payload_index += 1
                    target_root = out_dir / f"payload_{payload_index:03d}"
                    try:
                        extract_result, extract_warnings = extract_gma(gma_source, target_root)
                        extracted_any = True
                        extract_result["bspFiles"] = sorted(extract_result.get("bspFiles", []))
                        for rel_bsp in extract_result["bspFiles"]:
                            extracted_bsp.append(str((target_root / rel_bsp).resolve()))
                        payload_report["payloads"].append(
                            {
                                "candidate": str(candidate),
                                "status": "ok",
                                "sourceType": source_type,
                                "gmaSourcePath": str(gma_source),
                                "extractRoot": str(target_root),
                                "extractSummary": extract_result,
                            }
                        )
                        all_warnings.extend(extract_warnings)
                    except Exception as ex:
                        payload_report["payloads"].append(
                            {
                                "candidate": str(candidate),
                                "status": "failed",
                                "sourceType": source_type,
                                "gmaSourcePath": str(gma_source),
                                "extractRoot": str(target_root),
                                "error": str(ex),
                            }
                        )

            payload_report["bspFiles"] = sorted(extracted_bsp)
            payload_report["warnings"] = sorted(all_warnings)
            if not extracted_any:
                zip_candidates = [c for c in candidates if zipfile.is_zipfile(c)]
                for candidate in zip_candidates:
                    payload_index += 1
                    target_root = out_dir / f"payload_{payload_index:03d}"
                    try:
                        extract_result, extract_warnings = extract_zip_payload(candidate, target_root)
                        if not extract_result.get("bspFiles"):
                            payload_report["payloads"].append(
                                {
                                    "candidate": str(candidate),
                                    "status": "skipped",
                                    "sourceType": "direct_zip_payload",
                                    "extractRoot": str(target_root),
                                    "error": "zip_without_bsp",
                                }
                            )
                            all_warnings.extend(extract_warnings)
                            continue

                        extracted_any = True
                        for rel_bsp in extract_result["bspFiles"]:
                            extracted_bsp.append(str((target_root / rel_bsp).resolve()))
                        payload_report["payloads"].append(
                            {
                                "candidate": str(candidate),
                                "status": "ok",
                                "sourceType": "direct_zip_payload",
                                "extractRoot": str(target_root),
                                "extractSummary": extract_result,
                            }
                        )
                        all_warnings.extend(extract_warnings)
                    except Exception as ex:
                        payload_report["payloads"].append(
                            {
                                "candidate": str(candidate),
                                "status": "failed",
                                "sourceType": "direct_zip_payload",
                                "extractRoot": str(target_root),
                                "error": str(ex),
                            }
                        )

                payload_report["bspFiles"] = sorted(extracted_bsp)
                payload_report["warnings"] = sorted(all_warnings)

            if not extracted_any:
                direct_bsp = discover_direct_bsp(input_dir)
                if direct_bsp:
                    payload_report["payloads"].append(
                        {
                            "candidate": str(input_dir),
                            "status": "ok",
                            "sourceType": "direct_bsp_fallback",
                            "extractRoot": str(input_dir),
                            "extractSummary": {
                                "header": {
                                    "mode": "direct_bsp_fallback",
                                    "entriesCount": len(direct_bsp),
                                },
                                "filesExtracted": 0,
                                "bytesExtracted": 0,
                                "bspFiles": [
                                    str(p.relative_to(input_dir)).replace("\\", "/")
                                    for p in direct_bsp
                                ],
                            },
                        }
                    )
                    payload_report["bspFiles"] = sorted([str(p) for p in direct_bsp])
                    payload_report["warnings"] = sorted(all_warnings + ["direct_bsp_fallback_used"])
                else:
                    raise RuntimeError("no_extractable_payload_found")

        payload_report["ok"] = True
        return 0
    except Exception as exc:
        payload_report["ok"] = False
        payload_report["error"] = str(exc)
        payload_report["traceback"] = traceback.format_exc(limit=4)
        return 1
    finally:
        payload_report["durationMs"] = int((time.time() - started) * 1000)
        write_json(report_path, payload_report)


if __name__ == "__main__":
    raise SystemExit(main())
