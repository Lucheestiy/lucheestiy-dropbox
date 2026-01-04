from __future__ import annotations

import ipaddress
import json
import mimetypes
import os
import re
from urllib.parse import quote

from flask import request

from ..config import parse_bool

IMAGE_EXTS = {"jpg", "jpeg", "png", "gif", "webp", "bmp", "heic", "heif", "avif"}
VIDEO_EXTS = {
    "3g2",
    "3gp",
    "asf",
    "avi",
    "flv",
    "m2ts",
    "m2v",
    "m4v",
    "mkv",
    "mov",
    "mp4",
    "mpe",
    "mpeg",
    "mpg",
    "mts",
    "mxf",
    "ogv",
    "ts",
    "vob",
    "webm",
    "wmv",
}

SHARE_HASH_RE = re.compile(r"^[A-Za-z0-9_-]+$")
MAX_SHARE_HASH_LENGTH = 64

INVALID_UPLOAD_PATH_CHARS_RE = re.compile(r"[\x00-\x1f\x7f]")

mimetypes.add_type("image/avif", ".avif")
mimetypes.add_type("image/heic", ".heic")
mimetypes.add_type("image/heif", ".heif")
mimetypes.add_type("video/mp2t", ".m2ts")
mimetypes.add_type("video/mp2t", ".ts")

DEFAULT_ALLOWED_EXTS = sorted(IMAGE_EXTS | VIDEO_EXTS)
UPLOAD_ALLOWED_EXTS_RAW = (os.environ.get("DROPPR_UPLOAD_ALLOWED_EXTS") or "").strip()
UPLOAD_ALLOW_ALL_EXTS = False
if UPLOAD_ALLOWED_EXTS_RAW:
    if UPLOAD_ALLOWED_EXTS_RAW.lower() in {"*", "all", "any"}:
        UPLOAD_ALLOW_ALL_EXTS = True
        UPLOAD_ALLOWED_EXTS = set()
    else:
        UPLOAD_ALLOWED_EXTS = {
            part.lstrip(".").lower()
            for part in re.split(r"[,\s]+", UPLOAD_ALLOWED_EXTS_RAW)
            if part and part.strip()
        }
else:
    UPLOAD_ALLOWED_EXTS = set(DEFAULT_ALLOWED_EXTS)

try:
    UPLOAD_MAX_BYTES = int(
        os.environ.get("DROPPR_REQUEST_MAX_UPLOAD_BYTES") or os.environ.get("DROPPR_UPLOAD_MAX_BYTES") or "0"
    )
except (TypeError, ValueError):
    UPLOAD_MAX_BYTES = 0
UPLOAD_MAX_BYTES = max(0, UPLOAD_MAX_BYTES)

UPLOAD_ALLOW_OCTET_STREAM = parse_bool(os.environ.get("DROPPR_UPLOAD_ALLOW_OCTET_STREAM", "false"))

EXTENSION_MIME_OVERRIDES = {
    "heic": {"image/heic", "image/heif"},
    "heif": {"image/heif", "image/heic"},
    "m2ts": {"video/mp2t"},
    "vob": {"video/dvd", "video/mp2t"},
}

_mime_exts = UPLOAD_ALLOWED_EXTS if UPLOAD_ALLOWED_EXTS else set(DEFAULT_ALLOWED_EXTS)
EXTENSION_MIME_TYPES: dict[str, set[str]] = {}
for ext in sorted(_mime_exts):
    mimes = set()
    mimes.update(EXTENSION_MIME_OVERRIDES.get(ext, set()))
    guessed, _ = mimetypes.guess_type(f"file.{ext}")
    if guessed:
        mimes.add(guessed)
    EXTENSION_MIME_TYPES[ext] = mimes

ALLOWED_MIME_TYPES = set()
for ext_mimes in EXTENSION_MIME_TYPES.values():
    ALLOWED_MIME_TYPES.update(ext_mimes)

UPLOAD_SESSION_DIRNAME = ".droppr_uploads"
CHUNK_UPLOAD_ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")


class UploadValidationError(ValueError):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


def _safe_rel_path(value: str) -> str | None:
    if value is None:
        return None
    value = str(value)
    if value.startswith("/") or value.startswith("\\"):
        return None
    if "\\" in value:
        return None

    parts = [p for p in value.split("/") if p]
    if not parts:
        return None
    if any(p == ".." for p in parts):
        return None
    return "/".join(parts)


def is_valid_share_hash(share_hash: str) -> bool:
    if not share_hash or len(share_hash) > MAX_SHARE_HASH_LENGTH:
        return False
    return bool(SHARE_HASH_RE.fullmatch(share_hash))


def _normalize_upload_rel_path(value: str | None) -> str | None:
    if value is None:
        return None
    value = str(value).strip().replace("\\", "/")
    if not value:
        return None
    if value.startswith("/"):
        return None

    parts = []
    for part in value.split("/"):
        if not part or part == ".":
            continue
        if part == "..":
            return None
        if INVALID_UPLOAD_PATH_CHARS_RE.search(part):
            return None
        parts.append(part)
    if not parts:
        return None
    return "/".join(parts)


def _safe_root_path(value: str) -> str | None:
    if value is None:
        return None

    value = str(value).strip()
    if not value:
        return None
    if "\\" in value:
        return None

    if not value.startswith("/"):
        value = "/" + value

    value = re.sub(r"/+", "/", value)
    parts = [p for p in value.split("/") if p]
    if not parts:
        return "/"
    if any(p == ".." for p in parts):
        return None
    return "/" + "/".join(parts)


def _encode_share_path(value: str) -> str | None:
    if value is None:
        return None

    value = str(value).strip()
    if not value:
        return None
    if "\\" in value:
        return None

    if not value.startswith("/"):
        value = "/" + value

    value = re.sub(r"/+", "/", value)
    parts = [p for p in value.split("/") if p]
    if not parts:
        return "/"
    if any(p == ".." for p in parts):
        return None

    return "/" + "/".join(quote(p, safe="") for p in parts)


def _safe_join(base: str, *parts: str) -> str | None:
    base_abs = os.path.abspath(base)
    target = os.path.abspath(os.path.join(base_abs, *parts))
    if target == base_abs or target.startswith(base_abs + os.sep):
        return target
    return None


def _normalize_ip(value: str | None) -> str | None:
    if not value:
        return None

    value = (value.split(",")[0] if "," in value else value).strip()

    if value.startswith("[") and "]" in value:
        value = value[1 : value.index("]")]
    elif re.fullmatch(r"\d+\.\d+\.\d+\.\d+:\d+", value):
        value = value.split(":")[0]

    try:
        return str(ipaddress.ip_address(value))
    except ValueError:
        return None


def _extract_extension(path: str) -> str | None:
    base = os.path.basename(path or "")
    if not base:
        return None
    ext = os.path.splitext(base)[1].lstrip(".").lower()
    return ext or None


def _normalize_mime_type(value: str | None) -> str | None:
    if not value:
        return None
    return value.split(";", 1)[0].strip().lower() or None


def _peek_stream(stream, size: int = 32) -> bytes:
    if not hasattr(stream, "tell") or not hasattr(stream, "seek"):
        return b""
    try:
        pos = stream.tell()
    except Exception:
        return b""
    try:
        data = stream.read(size)
    except Exception:
        return b""
    finally:
        try:
            stream.seek(pos)
        except Exception:
            pass
    return data or b""


def _sniff_mime_type(sample: bytes) -> str | None:
    if not sample:
        return None

    if sample.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if sample.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if sample.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if sample.startswith(b"BM"):
        return "image/bmp"
    if len(sample) >= 12 and sample[0:4] == b"RIFF" and sample[8:12] == b"WEBP":
        return "image/webp"
    if sample.startswith(b"OggS"):
        return "video/ogg"
    if sample.startswith(b"\x1a\x45\xdf\xa3"):
        return "video/x-matroska"
    if len(sample) >= 12 and sample[0:4] == b"RIFF" and sample[8:12] == b"AVI ":
        return "video/x-msvideo"
    if len(sample) >= 12 and sample[4:8] == b"ftyp":
        brand = sample[8:12].decode("latin1", "ignore")
        if brand in {"avif", "avis"}:
            return "image/avif"
        if brand in {"heic", "heix", "hevc", "hevx", "mif1", "msf1"}:
            return "image/heif"
        if brand.strip().startswith("qt"):
            return "video/quicktime"
        return "video/mp4"

    return None


def _validate_upload_type(file_storage, rel_path: str) -> None:
    ext = _extract_extension(rel_path)
    if not ext:
        raise UploadValidationError("Missing file extension", 400)
    if not UPLOAD_ALLOW_ALL_EXTS and ext not in UPLOAD_ALLOWED_EXTS:
        raise UploadValidationError("Unsupported file type", 415)
    if UPLOAD_ALLOW_ALL_EXTS and ext not in EXTENSION_MIME_TYPES:
        return

    expected_mimes = EXTENSION_MIME_TYPES.get(ext, set())
    reported = _normalize_mime_type(getattr(file_storage, "mimetype", None))
    sniffed = _sniff_mime_type(_peek_stream(file_storage.stream))

    if expected_mimes:
        if reported in expected_mimes or sniffed in expected_mimes:
            return
        if reported == "application/octet-stream" and UPLOAD_ALLOW_OCTET_STREAM:
            return
        raise UploadValidationError("Unsupported file type", 415)

    if ALLOWED_MIME_TYPES:
        if reported in ALLOWED_MIME_TYPES or sniffed in ALLOWED_MIME_TYPES:
            return
        if reported == "application/octet-stream" and UPLOAD_ALLOW_OCTET_STREAM:
            return
        raise UploadValidationError("Unsupported file type", 415)


def _validate_upload_size(file_storage) -> None:
    if not UPLOAD_MAX_BYTES:
        return
    size_hint = getattr(file_storage, "content_length", None) or request.content_length
    if size_hint and size_hint > UPLOAD_MAX_BYTES:
        raise UploadValidationError("File exceeds the maximum allowed size", 413)


def _copy_stream_with_limit(src, dst, max_bytes: int | None) -> int:
    total = 0
    while True:
        chunk = src.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if max_bytes and total > max_bytes:
            raise UploadValidationError("File exceeds the maximum allowed size", 413)
        dst.write(chunk)
    return total


def _parse_content_range(value: str | None) -> tuple[int, int, int] | None:
    if not value:
        return None
    match = re.match(r"bytes\s+(\d+)-(\d+)/(\d+)$", value.strip())
    if not match:
        return None
    try:
        start = int(match.group(1))
        end = int(match.group(2))
        total = int(match.group(3))
    except (TypeError, ValueError):
        return None
    if start < 0 or end < start or total <= 0 or end >= total:
        return None
    return start, end, total


def _normalize_chunk_upload_id(value: str | None) -> str | None:
    if not value:
        return None
    raw = str(value).strip()
    if not raw or not CHUNK_UPLOAD_ID_RE.fullmatch(raw):
        return None
    return raw


def _chunk_upload_paths(base_dir: str, upload_id: str) -> tuple[str, str]:
    state_dir = os.path.join(base_dir, UPLOAD_SESSION_DIRNAME)
    meta_path = os.path.join(state_dir, f"{upload_id}.json")
    part_path = os.path.join(state_dir, f"{upload_id}.part")
    return meta_path, part_path


def _load_chunk_upload_meta(base_dir: str, upload_id: str) -> dict | None:
    meta_path, _ = _chunk_upload_paths(base_dir, upload_id)
    try:
        with open(meta_path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def _save_chunk_upload_meta(base_dir: str, upload_id: str, payload: dict) -> None:
    state_dir = os.path.join(base_dir, UPLOAD_SESSION_DIRNAME)
    os.makedirs(state_dir, exist_ok=True)
    meta_path, _ = _chunk_upload_paths(base_dir, upload_id)
    tmp_path = meta_path + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, separators=(",", ":"))
    os.replace(tmp_path, meta_path)


def _validate_chunk_upload_type(rel_path: str, sample: bytes, reported_mime: str | None) -> None:
    ext = _extract_extension(rel_path)
    if not ext:
        raise UploadValidationError("Missing file extension", 400)
    if not UPLOAD_ALLOW_ALL_EXTS and ext not in UPLOAD_ALLOWED_EXTS:
        raise UploadValidationError("Unsupported file type", 415)
    if UPLOAD_ALLOW_ALL_EXTS and ext not in EXTENSION_MIME_TYPES:
        return

    expected_mimes = EXTENSION_MIME_TYPES.get(ext, set())
    reported = _normalize_mime_type(reported_mime)
    sniffed = _sniff_mime_type(sample)

    if expected_mimes:
        if reported in expected_mimes or sniffed in expected_mimes:
            return
        if reported == "application/octet-stream" and UPLOAD_ALLOW_OCTET_STREAM:
            return
        raise UploadValidationError("Unsupported file type", 415)

    if ALLOWED_MIME_TYPES:
        if reported in ALLOWED_MIME_TYPES or sniffed in ALLOWED_MIME_TYPES:
            return
        if reported == "application/octet-stream" and UPLOAD_ALLOW_OCTET_STREAM:
            return
        raise UploadValidationError("Unsupported file type", 415)
