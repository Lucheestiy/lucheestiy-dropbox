from __future__ import annotations

import fcntl
import hashlib
import logging
import os
import shutil
import subprocess
import threading
import time
from urllib.parse import quote

import boto3
from botocore.config import Config as BotoConfig
from botocore.exceptions import ClientError
from flask import Response, redirect

from ..config import parse_bool
from ..metrics import VIDEO_TRANSCODE_COUNT, VIDEO_TRANSCODE_LATENCY
from .filebrowser import FILEBROWSER_PUBLIC_DL_API
from .video_meta import _ffprobe_video_meta

logger = logging.getLogger("droppr.media_processing")

CACHE_DIR = os.environ.get("DROPPR_CACHE_DIR", "/tmp/thumbnails")
os.makedirs(CACHE_DIR, exist_ok=True)

THUMB_MAX_WIDTH = int(os.environ.get("DROPPR_THUMB_MAX_WIDTH", "800"))
THUMB_JPEG_QUALITY = int(os.environ.get("DROPPR_THUMB_JPEG_QUALITY", "6"))
THUMB_WEBP_QUALITY = int(os.environ.get("DROPPR_THUMB_WEBP_QUALITY", "80"))
THUMB_ALLOW_WEBP = parse_bool(os.environ.get("DROPPR_THUMB_ALLOW_WEBP", "true"))
THUMB_ALLOW_AVIF = parse_bool(os.environ.get("DROPPR_THUMB_ALLOW_AVIF", "false"))
THUMB_AVIF_CRF = int(os.environ.get("DROPPR_THUMB_AVIF_CRF", "35"))
THUMB_ALLOWED_WIDTHS_SPEC = os.environ.get("DROPPR_THUMB_ALLOWED_WIDTHS", "32,240,320,480,640,800")
THUMB_FFMPEG_TIMEOUT_SECONDS = int(os.environ.get("DROPPR_THUMB_FFMPEG_TIMEOUT_SECONDS", "25"))
THUMB_MAX_CONCURRENCY = int(os.environ.get("DROPPR_THUMB_MAX_CONCURRENCY", "2"))
_thumb_sema = threading.BoundedSemaphore(max(1, THUMB_MAX_CONCURRENCY))
THUMB_MULTI_MAX = int(os.environ.get("DROPPR_THUMB_MULTI_MAX", "8"))
THUMB_MULTI_DEFAULT = int(os.environ.get("DROPPR_THUMB_MULTI_DEFAULT", "3"))


def _parse_allowed_widths(spec: str) -> list[int]:
    widths: list[int] = []
    seen = set()
    for raw in (spec or "").split(","):
        item = raw.strip()
        if not item:
            continue
        try:
            value = int(item)
        except (TypeError, ValueError):
            continue
        if value <= 0 or value in seen:
            continue
        seen.add(value)
        widths.append(value)
    return sorted(widths)


THUMB_ALLOWED_WIDTHS = _parse_allowed_widths(THUMB_ALLOWED_WIDTHS_SPEC)

PROXY_CACHE_DIR = os.environ.get("DROPPR_PROXY_CACHE_DIR", "/tmp/proxy-cache")
os.makedirs(PROXY_CACHE_DIR, exist_ok=True)

PROXY_MAX_CONCURRENCY = int(os.environ.get("DROPPR_PROXY_MAX_CONCURRENCY", "1"))
_proxy_sema = threading.BoundedSemaphore(max(1, PROXY_MAX_CONCURRENCY))

PROXY_MAX_DIMENSION = int(os.environ.get("DROPPR_PROXY_MAX_DIMENSION", "1280"))
PROXY_H264_PRESET = os.environ.get("DROPPR_PROXY_H264_PRESET", "veryfast")
PROXY_CRF = int(os.environ.get("DROPPR_PROXY_CRF", "28"))
PROXY_AAC_BITRATE = os.environ.get("DROPPR_PROXY_AAC_BITRATE", "128k")
PROXY_FFMPEG_TIMEOUT_SECONDS = int(os.environ.get("DROPPR_PROXY_FFMPEG_TIMEOUT_SECONDS", "900"))
PROXY_PROFILE_VERSION = os.environ.get("DROPPR_PROXY_PROFILE_VERSION", "1")

HD_MAX_CONCURRENCY = int(os.environ.get("DROPPR_HD_MAX_CONCURRENCY", "1"))
_hd_sema = threading.BoundedSemaphore(max(1, HD_MAX_CONCURRENCY))

HD_MAX_DIMENSION = int(os.environ.get("DROPPR_HD_MAX_DIMENSION", "0"))
HD_H264_PRESET = os.environ.get("DROPPR_HD_H264_PRESET", "slow")
HD_CRF = int(os.environ.get("DROPPR_HD_CRF", "20"))
HD_AAC_BITRATE = os.environ.get("DROPPR_HD_AAC_BITRATE", "192k")
HD_FFMPEG_TIMEOUT_SECONDS = int(os.environ.get("DROPPR_HD_FFMPEG_TIMEOUT_SECONDS", "1800"))
HD_PROFILE_VERSION = os.environ.get("DROPPR_HD_PROFILE_VERSION", "1")

HLS_CACHE_DIR = os.environ.get("DROPPR_HLS_CACHE_DIR", "/tmp/hls-cache")
os.makedirs(HLS_CACHE_DIR, exist_ok=True)
HLS_SEGMENT_SECONDS = int(os.environ.get("DROPPR_HLS_SEGMENT_SECONDS", "6"))
HLS_MAX_CONCURRENCY = int(os.environ.get("DROPPR_HLS_MAX_CONCURRENCY", "1"))
_hls_sema = threading.BoundedSemaphore(max(1, HLS_MAX_CONCURRENCY))
HLS_PROFILE_VERSION = os.environ.get("DROPPR_HLS_PROFILE_VERSION", "1")
HLS_H264_PRESET = os.environ.get("DROPPR_HLS_H264_PRESET", "veryfast")
HLS_CRF = int(os.environ.get("DROPPR_HLS_CRF", "23"))
HLS_FFMPEG_TIMEOUT_SECONDS = int(os.environ.get("DROPPR_HLS_FFMPEG_TIMEOUT_SECONDS", "1800"))
HLS_RENDITIONS_SPEC = os.environ.get(
    "DROPPR_HLS_RENDITIONS",
    "360:800:96,720:1600:128,1080:3000:160",
)


def _parse_hls_renditions(spec: str) -> list[dict]:
    renditions = []
    seen = set()
    for raw in (spec or "").split(","):
        item = raw.strip()
        if not item:
            continue
        parts = [p.strip() for p in item.split(":") if p.strip()]
        if len(parts) < 2:
            continue
        try:
            height = int(parts[0])
            v_kbps = int(parts[1])
            a_kbps = int(parts[2]) if len(parts) > 2 else 96
        except (TypeError, ValueError):
            continue
        if height <= 0 or v_kbps <= 0 or a_kbps <= 0:
            continue
        if height in seen:
            continue
        seen.add(height)
        renditions.append(
            {
                "height": height,
                "video_kbps": v_kbps,
                "audio_kbps": a_kbps,
            }
        )
    if not renditions:
        renditions = [
            {"height": 360, "video_kbps": 800, "audio_kbps": 96},
            {"height": 720, "video_kbps": 1600, "audio_kbps": 128},
            {"height": 1080, "video_kbps": 3000, "audio_kbps": 160},
        ]
    return sorted(renditions, key=lambda r: r["height"])


HLS_RENDITIONS = _parse_hls_renditions(HLS_RENDITIONS_SPEC)

R2_ENDPOINT = (os.environ.get("DROPPR_R2_ENDPOINT") or "").strip()
R2_BUCKET = (os.environ.get("DROPPR_R2_BUCKET") or "").strip()
R2_ACCESS_KEY_ID = (os.environ.get("DROPPR_R2_ACCESS_KEY_ID") or "").strip()
R2_SECRET_ACCESS_KEY = (os.environ.get("DROPPR_R2_SECRET_ACCESS_KEY") or "").strip()
R2_REGION = (os.environ.get("DROPPR_R2_REGION") or "auto").strip() or "auto"
R2_PUBLIC_BASE_URL = (os.environ.get("DROPPR_R2_PUBLIC_BASE_URL") or "").strip().rstrip("/")
R2_PREFIX = (os.environ.get("DROPPR_R2_PREFIX") or "droppr-cache").strip().strip("/")
R2_ENABLED_FLAG = parse_bool(os.environ.get("DROPPR_R2_ENABLED", "true"))
R2_ENABLED = R2_ENABLED_FLAG and bool(
    R2_BUCKET and R2_ENDPOINT and R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY
)
R2_UPLOAD_ENABLED = parse_bool(os.environ.get("DROPPR_R2_UPLOAD_ENABLED", "true"))
R2_REDIRECT_ENABLED = parse_bool(os.environ.get("DROPPR_R2_REDIRECT_ENABLED", "true"))
R2_PRESIGN_TTL_SECONDS = int(os.environ.get("DROPPR_R2_PRESIGN_TTL_SECONDS", "3600"))
R2_PRESENCE_CACHE_TTL_SECONDS = int(os.environ.get("DROPPR_R2_PRESENCE_CACHE_TTL_SECONDS", "300"))
R2_CACHE_CONTROL = os.environ.get("DROPPR_R2_CACHE_CONTROL", "public, max-age=86400")

_r2_client_instance = None
_r2_presence_cache: dict[str, tuple[bool, float]] = {}
_r2_cache_lock = threading.Lock()
_enqueue_task_fn = None


def configure_enqueue_task(fn) -> None:
    global _enqueue_task_fn
    _enqueue_task_fn = fn


def _thumb_cache_basename(share_hash: str, cache_key: str) -> str:
    unique_str = f"{share_hash}:{cache_key}"
    return hashlib.sha256(unique_str.encode()).hexdigest()


def _normalize_preview_ext(fmt: str) -> str:
    if fmt == "webp":
        return "webp"
    if fmt == "avif":
        return "avif"
    return "jpg"


def _normalize_preview_format(value: str | None) -> str:
    fmt = (value or "").strip().lower()
    if fmt in ("", "auto"):
        return "auto"
    if fmt in ("webp", "jpg", "jpeg", "avif"):
        return "jpg" if fmt == "jpeg" else fmt
    return "auto"


def _select_preview_format(
    raw_value: str | None, accept_header: str | None
) -> tuple[str, str, bool]:
    """
    Selects the best preview format based on user preference and browser support (Accept header).

    Returns:
        A tuple of (format, mimetype, vary_accept_header).
    """
    fmt = _normalize_preview_format(raw_value)
    if fmt == "auto":
        accept = (accept_header or "").lower()
        if THUMB_ALLOW_AVIF and "image/avif" in accept:
            return "avif", "image/avif", True
        if THUMB_ALLOW_WEBP and "image/webp" in accept:
            return "webp", "image/webp", True
        return "jpg", "image/jpeg", True

    if fmt == "avif" and not THUMB_ALLOW_AVIF:
        if THUMB_ALLOW_WEBP:
            return "webp", "image/webp", False
        return "jpg", "image/jpeg", False
    if fmt == "webp" and not THUMB_ALLOW_WEBP:
        return "jpg", "image/jpeg", False

    if fmt == "avif":
        return "avif", "image/avif", False
    if fmt == "webp":
        return "webp", "image/webp", False
    return "jpg", "image/jpeg", False


def _preview_fallbacks(fmt: str) -> list[str]:
    """Returns fallback formats for a given preview format."""
    if fmt == "avif":
        return ["webp", "jpg"] if THUMB_ALLOW_WEBP else ["jpg"]
    if fmt == "webp":
        return ["jpg"]
    return []


def _preview_mimetype(fmt: str) -> str:
    """Returns the MIME type for a given preview format."""
    if fmt == "avif":
        return "image/avif"
    if fmt == "webp":
        return "image/webp"
    return "image/jpeg"


def _normalize_thumb_width(value: str | None) -> int:
    """
    Normalizes the requested thumbnail width to the closest allowed width.
    """
    if value is None:
        return THUMB_MAX_WIDTH
    raw = str(value).strip()
    if not raw:
        return THUMB_MAX_WIDTH
    try:
        width = int(raw)
    except (TypeError, ValueError):
        return THUMB_MAX_WIDTH
    if width <= 0:
        return THUMB_MAX_WIDTH
    width = min(width, THUMB_MAX_WIDTH)
    allowed = [w for w in THUMB_ALLOWED_WIDTHS if w <= THUMB_MAX_WIDTH]
    if allowed:
        for candidate in allowed:
            if candidate >= width:
                return candidate
        return allowed[-1]
    return width


def _r2_client():
    global _r2_client_instance
    if not R2_ENABLED:
        return None
    if _r2_client_instance is not None:
        return _r2_client_instance
    _r2_client_instance = boto3.client(
        "s3",
        endpoint_url=R2_ENDPOINT,
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        region_name=R2_REGION,
        config=BotoConfig(
            signature_version="s3v4", retries={"max_attempts": 3, "mode": "standard"}
        ),
    )
    return _r2_client_instance


def _r2_build_key(category: str, name: str) -> str:
    base = f"{category}/{name.lstrip('/')}"
    if R2_PREFIX:
        return f"{R2_PREFIX}/{base}"
    return base


def _r2_thumb_key(cache_basename: str, fmt: str) -> str:
    ext = _normalize_preview_ext(fmt)
    return _r2_build_key("thumbs", f"{cache_basename}.{ext}")


def _r2_proxy_key(cache_key: str) -> str:
    return _r2_build_key("proxy", f"{cache_key}.mp4")


def _r2_hls_key(cache_key: str, rel_path: str) -> str:
    return _r2_build_key("hls", f"{cache_key}/{rel_path.lstrip('/')}")


def _r2_cache_get(key: str) -> bool | None:
    now = time.time()
    with _r2_cache_lock:
        cached = _r2_presence_cache.get(key)
        if not cached:
            return None
        exists, expiry = cached
        if expiry <= now:
            _r2_presence_cache.pop(key, None)
            return None
        return exists


def _r2_cache_set(key: str, exists: bool) -> None:
    expiry = time.time() + max(30, R2_PRESENCE_CACHE_TTL_SECONDS)
    with _r2_cache_lock:
        _r2_presence_cache[key] = (exists, expiry)


def _r2_object_exists(key: str) -> bool:
    """Checks if an object exists in the R2 bucket, with local caching."""
    if not R2_ENABLED:
        return False
    cached = _r2_cache_get(key)
    if cached is not None:
        return cached
    client = _r2_client()
    if client is None:
        return False
    try:
        client.head_object(Bucket=R2_BUCKET, Key=key)
    except ClientError as exc:
        code = str(exc.response.get("Error", {}).get("Code", ""))
        if code in {"404", "NoSuchKey", "NotFound"}:
            _r2_cache_set(key, False)
            return False
        raise
    _r2_cache_set(key, True)
    return True


def _r2_object_url(key: str, *, require_public: bool) -> str | None:
    """Returns a public URL or a presigned URL for an R2 object."""
    if not R2_ENABLED or not R2_REDIRECT_ENABLED:
        return None
    if require_public and not R2_PUBLIC_BASE_URL:
        return None
    if R2_PUBLIC_BASE_URL:
        return f"{R2_PUBLIC_BASE_URL}/{key}"
    client = _r2_client()
    if client is None:
        return None
    try:
        return client.generate_presigned_url(
            "get_object",
            Params={"Bucket": R2_BUCKET, "Key": key},
            ExpiresIn=R2_PRESIGN_TTL_SECONDS,
        )
    except Exception:
        return None


def _r2_upload_file(local_path: str, key: str, content_type: str | None) -> bool:
    """Uploads a local file to the R2 bucket."""
    if not R2_ENABLED or not R2_UPLOAD_ENABLED:
        return False
    if _r2_object_exists(key):
        return False
    client = _r2_client()
    if client is None:
        return False
    extra_args: dict[str, str] = {}
    if content_type:
        extra_args["ContentType"] = content_type
    if R2_CACHE_CONTROL:
        extra_args["CacheControl"] = R2_CACHE_CONTROL
    client.upload_file(local_path, R2_BUCKET, key, ExtraArgs=extra_args)
    _r2_cache_set(key, True)
    return True


def _r2_upload_hls_package(cache_key: str, output_dir: str) -> bool:
    if not R2_ENABLED or not R2_UPLOAD_ENABLED:
        return False
    client = _r2_client()
    if client is None:
        return False
    for root, _, files in os.walk(output_dir):
        for name in files:
            local_path = os.path.join(root, name)
            rel_path = os.path.relpath(local_path, output_dir).replace(os.sep, "/")
            key = _r2_hls_key(cache_key, rel_path)
            if _r2_object_exists(key):
                continue
            content_type = None
            lower_name = name.lower()
            if lower_name.endswith(".m3u8"):
                content_type = "application/vnd.apple.mpegurl"
            elif lower_name.endswith(".ts"):
                content_type = "video/mp2t"
            extra_args: dict[str, str] = {}
            if content_type:
                extra_args["ContentType"] = content_type
            if R2_CACHE_CONTROL:
                extra_args["CacheControl"] = R2_CACHE_CONTROL
            client.upload_file(local_path, R2_BUCKET, key, ExtraArgs=extra_args)
            _r2_cache_set(key, True)
    return True


def _maybe_redirect_r2(key: str, *, require_public: bool) -> Response | None:
    url = _r2_object_url(key, require_public=require_public)
    if not url:
        return None
    try:
        if not _r2_object_exists(key):
            return None
    except Exception as exc:
        logger.warning("R2 HEAD failed for %s: %s", key, exc)
        return None
    return redirect(url, code=302)


def _r2_available_url(key: str, *, require_public: bool) -> str | None:
    url = _r2_object_url(key, require_public=require_public)
    if not url:
        return None
    try:
        if not _r2_object_exists(key):
            return None
    except Exception as exc:
        logger.warning("R2 HEAD failed for %s: %s", key, exc)
        return None
    return url


def _enqueue_r2_upload_file(
    task_id: str, local_path: str, key: str, content_type: str | None
) -> bool:
    if not R2_ENABLED or not R2_UPLOAD_ENABLED or _enqueue_task_fn is None:
        return False
    return _enqueue_task_fn(
        task_id, "droppr.r2_upload_file", _r2_upload_file, local_path, key, content_type
    )


def _enqueue_r2_upload_hls(task_id: str, cache_key: str, output_dir: str) -> bool:
    if not R2_ENABLED or not R2_UPLOAD_ENABLED or _enqueue_task_fn is None:
        return False
    return _enqueue_task_fn(
        task_id, "droppr.r2_upload_hls", _r2_upload_hls_package, cache_key, output_dir
    )


def _get_cache_path(share_hash: str, filename: str, ext: str = "jpg") -> str:
    # Create a safe unique filename for the cache
    hashed_name = _thumb_cache_basename(share_hash, filename)
    safe_ext = _normalize_preview_ext(ext)
    return os.path.join(CACHE_DIR, f"{hashed_name}.{safe_ext}")


def _get_files_cache_path(
    path: str, size: int | None, modified: str | None, ext: str = "jpg"
) -> str:
    cache_key = f"{path}|{size or ''}|{modified or ''}"
    return _get_cache_path("__files__", cache_key, ext=ext)


def _parse_preview_time(value: str | None) -> float | None:
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    try:
        t = float(raw)
    except (TypeError, ValueError):
        return None
    if t < 0:
        return None
    return min(t, 3600.0)


def _ffmpeg_thumbnail_cmd(
    *,
    src_url: str,
    dst_path: str,
    seek_seconds: int | None,
    headers: dict[str, str] | None = None,
    fmt: str = "jpg",
    width: int | None = None,
) -> list[str]:
    cmd = ["ffmpeg", "-hide_banner", "-nostdin", "-loglevel", "error", "-threads", "1"]
    if seek_seconds is not None:
        cmd += ["-ss", str(seek_seconds)]
    if headers:
        header_lines = "".join(f"{k}: {v}\r\n" for k, v in headers.items() if v)
        if header_lines:
            cmd += ["-headers", header_lines]
    scale_width = width if width and width > 0 else THUMB_MAX_WIDTH
    cmd += ["-i", src_url, "-vframes", "1", "-vf", f"scale='min({scale_width},iw)':-2"]
    if fmt == "webp":
        cmd += [
            "-c:v",
            "libwebp",
            "-q:v",
            str(THUMB_WEBP_QUALITY),
            "-preset",
            "picture",
            "-f",
            "webp",
        ]
    elif fmt == "avif":
        cmd += [
            "-c:v",
            "libaom-av1",
            "-crf",
            str(THUMB_AVIF_CRF),
            "-b:v",
            "0",
            "-still-picture",
            "1",
            "-pix_fmt",
            "yuv420p",
            "-f",
            "avif",
        ]
    else:
        cmd += [
            "-q:v",
            str(THUMB_JPEG_QUALITY),
            "-f",
            "image2",
            "-update",
            "1",
        ]
    cmd += ["-y", dst_path]
    return cmd


def _proxy_cache_key(
    *, share_hash: str, file_path: str, size: int, modified: str | None = None
) -> str:
    # Cache key is stable across requests and invalidates when the source changes or encoding profile changes.
    mod = (modified or "").strip()
    key = (
        f"proxy:{PROXY_PROFILE_VERSION}:{PROXY_MAX_DIMENSION}:{PROXY_CRF}:{PROXY_H264_PRESET}:{share_hash}:"
        f"{file_path}:{size}:{mod}"
    )
    return hashlib.sha256(key.encode()).hexdigest()


def _hd_cache_key(
    *, share_hash: str, file_path: str, size: int, modified: str | None = None
) -> str:
    mod = (modified or "").strip()
    key = f"hd:{HD_PROFILE_VERSION}:{HD_MAX_DIMENSION}:{HD_CRF}:{HD_H264_PRESET}:{share_hash}:{file_path}:{size}:{mod}"
    return hashlib.sha256(key.encode()).hexdigest()


def _hls_cache_key(
    *, share_hash: str, file_path: str, size: int, modified: str | None = None
) -> str:
    mod = (modified or "").strip()
    rendition_key = ";".join(
        f"{r['height']}:{r['video_kbps']}:{r['audio_kbps']}" for r in HLS_RENDITIONS
    )
    key = (
        f"hls:{HLS_PROFILE_VERSION}:{HLS_SEGMENT_SECONDS}:{HLS_H264_PRESET}:{HLS_CRF}:{rendition_key}:"
        f"{share_hash}:{file_path}:{size}:{mod}"
    )
    return hashlib.sha256(key.encode()).hexdigest()


def _ffmpeg_hls_cmd(
    *,
    src_url: str,
    out_dir: str,
    height: int,
    video_kbps: int,
    audio_kbps: int,
    fps: float | None,
) -> list[str]:
    gop = int(round((fps or 30) * max(1, HLS_SEGMENT_SECONDS)))
    gop = max(24, min(300, gop))
    scale = f"scale=w=-2:h={height}:force_original_aspect_ratio=decrease"
    return [
        "ffmpeg",
        "-hide_banner",
        "-nostdin",
        "-loglevel",
        "error",
        "-y",
        "-i",
        src_url,
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-sn",
        "-vf",
        scale,
        "-c:v",
        "libx264",
        "-preset",
        HLS_H264_PRESET,
        "-crf",
        str(HLS_CRF),
        "-maxrate",
        f"{video_kbps}k",
        "-bufsize",
        f"{int(video_kbps * 1.5)}k",
        "-g",
        str(gop),
        "-keyint_min",
        str(gop),
        "-sc_threshold",
        "0",
        "-c:a",
        "aac",
        "-b:a",
        f"{audio_kbps}k",
        "-ac",
        "2",
        "-f",
        "hls",
        "-hls_time",
        str(HLS_SEGMENT_SECONDS),
        "-hls_playlist_type",
        "vod",
        "-hls_list_size",
        "0",
        "-hls_flags",
        "independent_segments",
        "-hls_segment_filename",
        os.path.join(out_dir, "seg_%04d.ts"),
        os.path.join(out_dir, "stream.m3u8"),
    ]


def _write_hls_master(master_path: str, renditions: list[dict]) -> None:
    lines = ["#EXTM3U", "#EXT-X-VERSION:3"]
    for rendition in renditions:
        bandwidth = int((rendition["video_kbps"] + rendition["audio_kbps"]) * 1000)
        name = f"{rendition['height']}p"
        playlist = f"{rendition['dir_name']}/stream.m3u8"
        lines.append(f'#EXT-X-STREAM-INF:BANDWIDTH={bandwidth},NAME="{name}"')
        lines.append(playlist)
    content = "\n".join(lines) + "\n"
    with open(master_path, "w", encoding="utf-8") as handle:
        handle.write(content)


def _ffmpeg_proxy_cmd(*, src_url: str, dst_path: str) -> list[str]:
    # Cap the longer side to PROXY_MAX_DIMENSION while preserving aspect ratio.
    scale = f"scale='if(gt(iw,ih),min({PROXY_MAX_DIMENSION},iw),-2)':'if(gt(iw,ih),-2,min({PROXY_MAX_DIMENSION},ih))'"
    return [
        "ffmpeg",
        "-hide_banner",
        "-nostdin",
        "-loglevel",
        "error",
        "-y",
        "-i",
        src_url,
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-sn",
        "-vf",
        scale,
        "-c:v",
        "libx264",
        "-preset",
        PROXY_H264_PRESET,
        "-crf",
        str(PROXY_CRF),
        "-pix_fmt",
        "yuv420p",
        "-profile:v",
        "main",
        "-g",
        "60",
        "-keyint_min",
        "60",
        "-sc_threshold",
        "0",
        "-c:a",
        "aac",
        "-b:a",
        str(PROXY_AAC_BITRATE),
        "-movflags",
        "+faststart",
        "-f",
        "mp4",
        dst_path,
    ]


def _ensure_fast_proxy_mp4(
    *,
    share_hash: str,
    file_path: str,
    size: int,
    modified: str | None = None,
) -> tuple[str, str, str, int | None]:
    """
    Ensures that a fast-start H.264 proxy MP4 exists for the given video file.
    If not, it triggers synchronous or asynchronous generation.
    """
    cache_key = _proxy_cache_key(
        share_hash=share_hash, file_path=file_path, size=size, modified=modified
    )
    output_path = os.path.join(PROXY_CACHE_DIR, f"{cache_key}.mp4")
    public_url = f"/api/proxy-cache/{cache_key}.mp4"

    if os.path.exists(output_path):
        if VIDEO_TRANSCODE_COUNT:
            VIDEO_TRANSCODE_COUNT.labels("fast", "hit").inc()
        _enqueue_r2_upload_file(
            f"r2:hd:{cache_key}",
            output_path,
            _r2_proxy_key(cache_key),
            "video/mp4",
        )
        return cache_key, output_path, public_url, os.path.getsize(output_path)

    lock_path = output_path + ".lock"
    with open(lock_path, "w") as lock_file:
        fcntl.flock(lock_file, fcntl.LOCK_EX)

        if os.path.exists(output_path):
            return cache_key, output_path, public_url, os.path.getsize(output_path)

        if VIDEO_TRANSCODE_COUNT:
            VIDEO_TRANSCODE_COUNT.labels("fast", "miss").inc()

        tmp_path = output_path + ".tmp"
        try:
            os.remove(tmp_path)
        except FileNotFoundError:
            pass

        src_url = (
            f"{FILEBROWSER_PUBLIC_DL_API}/{share_hash}/{quote(file_path, safe='/')}?inline=true"
        )

        start_time = time.perf_counter()
        try:
            with _proxy_sema:
                cmd = _ffmpeg_proxy_cmd(src_url=src_url, dst_path=tmp_path)
                result = subprocess.run(
                    cmd,
                    check=False,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    timeout=PROXY_FFMPEG_TIMEOUT_SECONDS,
                )

            if result.returncode != 0:
                if VIDEO_TRANSCODE_COUNT:
                    VIDEO_TRANSCODE_COUNT.labels("fast", "error").inc()
                logger.error(
                    "ffmpeg proxy failed for %s: %s",
                    file_path,
                    result.stderr.decode(errors="replace"),
                )
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass
                raise RuntimeError("Proxy generation failed")

            if VIDEO_TRANSCODE_LATENCY:
                VIDEO_TRANSCODE_LATENCY.labels("fast").observe(time.perf_counter() - start_time)
            if VIDEO_TRANSCODE_COUNT:
                VIDEO_TRANSCODE_COUNT.labels("fast", "success").inc()

            os.replace(tmp_path, output_path)
        except Exception as e:
            if not isinstance(e, RuntimeError):
                logger.error("ffmpeg proxy exception for %s: %s", file_path, e)
            try:
                os.remove(tmp_path)
            except OSError:
                pass
            raise
        _enqueue_r2_upload_file(
            f"r2:proxy:{cache_key}",
            output_path,
            _r2_proxy_key(cache_key),
            "video/mp4",
        )
        return cache_key, output_path, public_url, os.path.getsize(output_path)


def _ffmpeg_hd_remux_cmd(*, src_url: str, dst_path: str) -> list[str]:
    """Returns a command to remux a video to MP4 without transcoding if possible."""
    return [
        "ffmpeg",
        "-hide_banner",
        "-nostdin",
        "-loglevel",
        "error",
        "-y",
        "-i",
        src_url,
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-sn",
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        "-f",
        "mp4",
        dst_path,
    ]


def _ffmpeg_hd_copy_video_cmd(*, src_url: str, dst_path: str) -> list[str]:
    return [
        "ffmpeg",
        "-hide_banner",
        "-nostdin",
        "-loglevel",
        "error",
        "-y",
        "-i",
        src_url,
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-sn",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        str(HD_AAC_BITRATE),
        "-movflags",
        "+faststart",
        "-f",
        "mp4",
        dst_path,
    ]


def _ffmpeg_hd_transcode_cmd(*, src_url: str, dst_path: str) -> list[str]:
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-nostdin",
        "-loglevel",
        "error",
        "-y",
        "-i",
        src_url,
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-sn",
    ]

    if HD_MAX_DIMENSION and HD_MAX_DIMENSION > 0:
        scale = f"scale='if(gt(iw,ih),min({HD_MAX_DIMENSION},iw),-2)':'if(gt(iw,ih),-2,min({HD_MAX_DIMENSION},ih))'"
        cmd += ["-vf", scale]

    cmd += [
        "-c:v",
        "libx264",
        "-preset",
        HD_H264_PRESET,
        "-crf",
        str(HD_CRF),
        "-pix_fmt",
        "yuv420p",
        "-profile:v",
        "high",
        "-g",
        "60",
        "-keyint_min",
        "60",
        "-sc_threshold",
        "0",
        "-c:a",
        "aac",
        "-b:a",
        str(HD_AAC_BITRATE),
        "-movflags",
        "+faststart",
        "-f",
        "mp4",
        dst_path,
    ]
    return cmd


def _ensure_hd_mp4(
    *,
    share_hash: str,
    file_path: str,
    size: int,
    modified: str | None = None,
) -> tuple[str, str, str, int | None]:
    """
    Ensures that an HD (High Definition) MP4 exists for the given video file.
    Tries remuxing, then copying video, then full transcode as fallbacks.
    """
    cache_key = _hd_cache_key(
        share_hash=share_hash, file_path=file_path, size=size, modified=modified
    )
    output_path = os.path.join(PROXY_CACHE_DIR, f"{cache_key}.mp4")
    public_url = f"/api/proxy-cache/{cache_key}.mp4"

    if os.path.exists(output_path):
        if VIDEO_TRANSCODE_COUNT:
            VIDEO_TRANSCODE_COUNT.labels("hd", "hit").inc()
        _enqueue_r2_upload_file(
            f"r2:proxy:{cache_key}",
            output_path,
            _r2_proxy_key(cache_key),
            "video/mp4",
        )
        return cache_key, output_path, public_url, os.path.getsize(output_path)

    lock_path = output_path + ".lock"
    with open(lock_path, "w") as lock_file:
        fcntl.flock(lock_file, fcntl.LOCK_EX)

        if os.path.exists(output_path):
            return cache_key, output_path, public_url, os.path.getsize(output_path)

        if VIDEO_TRANSCODE_COUNT:
            VIDEO_TRANSCODE_COUNT.labels("hd", "miss").inc()

        tmp_path = output_path + ".tmp"
        try:
            os.remove(tmp_path)
        except FileNotFoundError:
            pass

        src_url = (
            f"{FILEBROWSER_PUBLIC_DL_API}/{share_hash}/{quote(file_path, safe='/')}?inline=true"
        )

        attempts = [
            ("remux", _ffmpeg_hd_remux_cmd(src_url=src_url, dst_path=tmp_path)),
            ("copy_video", _ffmpeg_hd_copy_video_cmd(src_url=src_url, dst_path=tmp_path)),
            ("transcode", _ffmpeg_hd_transcode_cmd(src_url=src_url, dst_path=tmp_path)),
        ]

        last_err = None
        start_time = time.perf_counter()
        with _hd_sema:
            for label, cmd in attempts:
                try:
                    result = subprocess.run(
                        cmd,
                        check=False,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        timeout=HD_FFMPEG_TIMEOUT_SECONDS,
                    )
                except subprocess.TimeoutExpired:
                    last_err = f"{label}: timeout"
                    continue

                if result.returncode == 0:
                    if VIDEO_TRANSCODE_LATENCY:
                        VIDEO_TRANSCODE_LATENCY.labels("hd").observe(
                            time.perf_counter() - start_time
                        )
                    if VIDEO_TRANSCODE_COUNT:
                        VIDEO_TRANSCODE_COUNT.labels("hd", "success").inc()
                    os.replace(tmp_path, output_path)
                    _enqueue_r2_upload_file(
                        f"r2:hd:{cache_key}",
                        output_path,
                        _r2_proxy_key(cache_key),
                        "video/mp4",
                    )
                    return cache_key, output_path, public_url, os.path.getsize(output_path)

                last_err = f"{label}: {result.stderr.decode(errors='replace')}"
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass

        if VIDEO_TRANSCODE_COUNT:
            VIDEO_TRANSCODE_COUNT.labels("hd", "error").inc()
        if last_err:
            logger.error("ffmpeg hd failed for %s: %s", file_path, last_err)
        raise RuntimeError("HD generation failed")


def _ensure_hls_package(
    *,
    share_hash: str,
    file_path: str,
    size: int,
    modified: str | None = None,
) -> tuple[str, str, str]:
    """
    Ensures that an adaptive HLS package exists for the given video file.
    Generates multiple renditions as defined in HLS_RENDITIONS.
    """
    cache_key = _hls_cache_key(
        share_hash=share_hash, file_path=file_path, size=size, modified=modified
    )
    output_dir = os.path.join(HLS_CACHE_DIR, cache_key)
    master_path = os.path.join(output_dir, "master.m3u8")
    public_url = f"/api/hls-cache/{cache_key}/master.m3u8"

    if os.path.exists(master_path):
        if VIDEO_TRANSCODE_COUNT:
            VIDEO_TRANSCODE_COUNT.labels("hls", "hit").inc()
        _enqueue_r2_upload_hls(f"r2:hls:{cache_key}", cache_key, output_dir)
        return cache_key, output_dir, public_url

    lock_path = output_dir + ".lock"
    with open(lock_path, "w") as lock_file:
        fcntl.flock(lock_file, fcntl.LOCK_EX)

        if os.path.exists(master_path):
            return cache_key, output_dir, public_url

        if VIDEO_TRANSCODE_COUNT:
            VIDEO_TRANSCODE_COUNT.labels("hls", "miss").inc()

        tmp_dir = output_dir + ".tmp"
        shutil.rmtree(tmp_dir, ignore_errors=True)
        os.makedirs(tmp_dir, exist_ok=True)

        src_url = (
            f"{FILEBROWSER_PUBLIC_DL_API}/{share_hash}/{quote(file_path, safe='/')}?inline=true"
        )
        fps = None
        try:
            meta = _ffprobe_video_meta(src_url)
            fps_val = None
            if meta and isinstance(meta.get("video"), dict):
                fps_val = meta["video"].get("fps")
            fps = float(fps_val) if fps_val else None
        except Exception as exc:
            logger.warning("ffprobe failed for HLS %s: %s", file_path, exc)

        renditions = []
        start_time = time.perf_counter()
        with _hls_sema:
            for rendition in HLS_RENDITIONS:
                dir_name = f"v{rendition['height']}"
                variant_dir = os.path.join(tmp_dir, dir_name)
                os.makedirs(variant_dir, exist_ok=True)
                cmd = _ffmpeg_hls_cmd(
                    src_url=src_url,
                    out_dir=variant_dir,
                    height=rendition["height"],
                    video_kbps=rendition["video_kbps"],
                    audio_kbps=rendition["audio_kbps"],
                    fps=fps,
                )
                result = subprocess.run(
                    cmd,
                    check=False,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    timeout=HLS_FFMPEG_TIMEOUT_SECONDS,
                )
                if result.returncode != 0:
                    if VIDEO_TRANSCODE_COUNT:
                        VIDEO_TRANSCODE_COUNT.labels("hls", "error").inc()
                    err = result.stderr.decode(errors="replace")
                    shutil.rmtree(tmp_dir, ignore_errors=True)
                    logger.error("ffmpeg HLS failed for %s: %s", file_path, err)
                    raise RuntimeError("HLS generation failed")
                renditions.append({**rendition, "dir_name": dir_name})

        if VIDEO_TRANSCODE_LATENCY:
            VIDEO_TRANSCODE_LATENCY.labels("hls").observe(time.perf_counter() - start_time)
        if VIDEO_TRANSCODE_COUNT:
            VIDEO_TRANSCODE_COUNT.labels("hls", "success").inc()

        _write_hls_master(os.path.join(tmp_dir, "master.m3u8"), renditions)

        shutil.rmtree(output_dir, ignore_errors=True)
        os.replace(tmp_dir, output_dir)
        _enqueue_r2_upload_hls(f"r2:hls:{cache_key}", cache_key, output_dir)

    return cache_key, output_dir, public_url
