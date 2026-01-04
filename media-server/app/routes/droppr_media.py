from __future__ import annotations

import fcntl
import json
import logging
import os
import subprocess
from urllib.parse import quote

from flask import Blueprint, Response, jsonify, request

logger = logging.getLogger("droppr.droppr")


def create_droppr_media_blueprint(require_admin_access, deps: dict):
    safe_root_path = deps["safe_root_path"]
    fetch_filebrowser_resource = deps["fetch_filebrowser_resource"]
    ensure_video_meta_record = deps["ensure_video_meta_record"]
    select_preview_format = deps["select_preview_format"]
    normalize_thumb_width = deps["normalize_thumb_width"]
    thumb_max_width = deps["thumb_max_width"]
    get_cache_path = deps["get_cache_path"]
    thumb_cache_basename = deps["thumb_cache_basename"]
    preview_fallbacks = deps["preview_fallbacks"]
    r2_thumb_key = deps["r2_thumb_key"]
    maybe_redirect_r2 = deps["maybe_redirect_r2"]
    enqueue_r2_upload_file = deps["enqueue_r2_upload_file"]
    ffmpeg_thumbnail_cmd = deps["ffmpeg_thumbnail_cmd"]
    thumb_sema = deps["thumb_sema"]
    thumb_ffmpeg_timeout_seconds = deps["thumb_ffmpeg_timeout_seconds"]
    preview_mimetype = deps["preview_mimetype"]
    filebrowser_base_url = deps["filebrowser_base_url"]
    video_exts = deps["video_exts"]
    image_exts = deps["image_exts"]
    parse_bool = deps["parse_bool"]

    bp = Blueprint("droppr_media", __name__)

    @bp.route("/api/droppr/video-meta")
    def droppr_video_meta():
        error_resp, auth = require_admin_access()
        if error_resp:
            return error_resp
        token = auth.get("token") if auth else None

        raw_path = request.args.get("path") or request.args.get("p")
        safe_path = safe_root_path(raw_path)
        if not safe_path or safe_path == "/":
            return jsonify({"error": "Missing or invalid path"}), 400

        ext = os.path.splitext(safe_path)[1].lstrip(".").lower()
        if ext not in video_exts:
            return jsonify({"error": "Unsupported video type"}), 415

        try:
            meta = fetch_filebrowser_resource(safe_path, token)
        except PermissionError:
            return jsonify({"error": "Unauthorized"}), 401
        except Exception as exc:
            logger.error("Failed to read file metadata for %s: %s", safe_path, exc)
            return jsonify({"error": "Failed to read file metadata"}), 502

        if not meta or isinstance(meta.get("items"), list) or parse_bool(meta.get("isDir")):
            return jsonify({"error": "File not found"}), 404

        current_size = int(meta.get("size") or 0) or None
        current_modified = meta.get("modified") if isinstance(meta.get("modified"), str) else None

        try:
            encoded_path = quote(safe_path.lstrip("/"), safe="/")
            src_url = f"{filebrowser_base_url}/api/raw/{encoded_path}"
            row = ensure_video_meta_record(
                db_path=safe_path,
                src_url=src_url,
                current_size=current_size,
                current_modified=current_modified,
                headers={"X-Auth": token},
            )
        except Exception as exc:
            logger.error("Failed to build video meta for %s: %s", safe_path, exc)
            return jsonify({"error": "Failed to read video metadata"}), 500

        if not row:
            return jsonify({"error": "Not found"}), 404

        original_meta = None
        processed_meta = None
        try:
            if row["original_meta_json"]:
                original_meta = json.loads(row["original_meta_json"])
        except Exception:
            original_meta = None

        try:
            if row["processed_meta_json"]:
                processed_meta = json.loads(row["processed_meta_json"])
        except Exception:
            processed_meta = None

        resp = jsonify(
            {
                "path": str(row["path"]),
                "status": str(row["status"]),
                "action": (str(row["action"]) if row["action"] is not None else None),
                "error": (str(row["error"]) if row["error"] is not None else None),
                "uploaded_at": int(row["uploaded_at"] or 0) if row["uploaded_at"] else None,
                "processed_at": int(row["processed_at"] or 0) if row["processed_at"] else None,
                "original_size": int(row["original_size"] or 0) if row["original_size"] else None,
                "processed_size": (
                    int(row["processed_size"] or 0) if row["processed_size"] else None
                ),
                "original": original_meta,
                "processed": processed_meta,
            }
        )
        resp.headers["Cache-Control"] = "no-store"
        return resp

    @bp.route("/api/droppr/preview")
    def droppr_preview():
        error_resp, auth = require_admin_access()
        if error_resp:
            return error_resp
        token = auth.get("token") if auth else None

        raw_path = request.args.get("path") or request.args.get("p")
        safe_path = safe_root_path(raw_path)
        if not safe_path or safe_path == "/":
            return jsonify({"error": "Missing or invalid path"}), 400

        ext = os.path.splitext(safe_path)[1].lstrip(".").lower()
        is_video = ext in video_exts
        is_image = ext in image_exts
        if not is_video and not is_image:
            return jsonify({"error": "Unsupported preview type"}), 415

        try:
            meta = fetch_filebrowser_resource(safe_path, token)
        except PermissionError:
            return jsonify({"error": "Unauthorized"}), 401
        except Exception as exc:
            logger.error("Failed to read file metadata for %s: %s", safe_path, exc)
            return jsonify({"error": "Failed to read file metadata"}), 502

        if not meta or isinstance(meta.get("items"), list) or parse_bool(meta.get("isDir")):
            return jsonify({"error": "File not found"}), 404

        size = int(meta.get("size") or 0) or None
        modified = meta.get("modified") if isinstance(meta.get("modified"), str) else None

        fmt, mimetype, vary_accept = select_preview_format(
            request.args.get("format"),
            request.headers.get("Accept"),
        )
        raw_width = request.args.get("w") or request.args.get("width")
        thumb_width = normalize_thumb_width(raw_width) if raw_width else thumb_max_width
        cache_token = safe_path
        if raw_width:
            cache_token = f"{cache_token}|w={thumb_width}"
        cache_key = f"{cache_token}|{size or ''}|{modified or ''}"
        cache_path = get_cache_path("__files__", cache_key, ext=fmt)
        lock_path = cache_path + ".lock"
        cache_basename = thumb_cache_basename("__files__", cache_key)
        fallback_formats = preview_fallbacks(fmt)
        fallback_paths = {
            fallback_fmt: get_cache_path("__files__", cache_key, ext=fallback_fmt)
            for fallback_fmt in fallback_formats
        }

        r2_redirect = maybe_redirect_r2(r2_thumb_key(cache_basename, fmt), require_public=False)
        if r2_redirect:
            return r2_redirect

        if os.path.exists(cache_path):
            try:
                os.utime(cache_path, None)
            except OSError:
                pass
            with open(cache_path, "rb") as handle:
                resp = Response(handle.read(), mimetype=mimetype)
                if vary_accept:
                    resp.headers["Vary"] = "Accept"
                resp.headers["Cache-Control"] = "private, max-age=86400"
                enqueue_r2_upload_file(
                    f"r2:thumb:{cache_basename}:{fmt}",
                    cache_path,
                    r2_thumb_key(cache_basename, fmt),
                    mimetype,
                )
                return resp

        try:
            with open(lock_path, "w") as lock_file:
                fcntl.flock(lock_file, fcntl.LOCK_EX)
                try:
                    if os.path.exists(cache_path):
                        with open(cache_path, "rb") as handle:
                            resp = Response(handle.read(), mimetype=mimetype)
                            if vary_accept:
                                resp.headers["Vary"] = "Accept"
                            resp.headers["Cache-Control"] = "private, max-age=86400"
                            return resp

                    encoded_path = quote(safe_path.lstrip("/"), safe="/")
                    src_url = f"{filebrowser_base_url}/api/raw/{encoded_path}"
                    headers = {"X-Auth": token}

                    def run_thumb(fmt_value: str, dst_path: str) -> subprocess.CompletedProcess:
                        cmd = ffmpeg_thumbnail_cmd(
                            src_url=src_url,
                            dst_path=dst_path,
                            seek_seconds=(1 if is_video else None),
                            headers=headers,
                            fmt=fmt_value,
                            width=thumb_width,
                        )
                        result = subprocess.run(
                            cmd,
                            check=False,
                            capture_output=True,
                            timeout=thumb_ffmpeg_timeout_seconds,
                        )
                        if result.returncode != 0 and is_video:
                            cmd = ffmpeg_thumbnail_cmd(
                                src_url=src_url,
                                dst_path=dst_path,
                                seek_seconds=0,
                                headers=headers,
                                fmt=fmt_value,
                                width=thumb_width,
                            )
                            result = subprocess.run(
                                cmd,
                                check=False,
                                capture_output=True,
                                timeout=thumb_ffmpeg_timeout_seconds,
                            )
                        return result

                    with thumb_sema:
                        result = run_thumb(fmt, cache_path)

                    fmt_used = fmt
                    mimetype_used = mimetype
                    if result.returncode != 0:
                        for fallback_fmt in fallback_formats:
                            fallback_path = fallback_paths.get(fallback_fmt)
                            if not fallback_path:
                                continue
                            logger.warning(
                                "preview failed for %s (%s), falling back to %s",
                                safe_path,
                                fmt,
                                fallback_fmt,
                            )
                            with thumb_sema:
                                result = run_thumb(fallback_fmt, fallback_path)
                            if result.returncode == 0:
                                fmt_used = fallback_fmt
                                mimetype_used = preview_mimetype(fallback_fmt)
                                cache_path = fallback_path
                                break

                    if result.returncode != 0:
                        err = result.stderr.decode(errors="replace") if result else "unknown error"
                        logger.error("ffmpeg failed for %s: %s", safe_path, err)
                        return jsonify({"error": "Thumbnail generation failed"}), 500

                    if os.path.exists(cache_path):
                        with open(cache_path, "rb") as handle:
                            resp = Response(handle.read(), mimetype=mimetype_used)
                            if vary_accept:
                                resp.headers["Vary"] = "Accept"
                            resp.headers["Cache-Control"] = "private, max-age=86400"
                            enqueue_r2_upload_file(
                                f"r2:thumb:{cache_basename}:{fmt_used}",
                                cache_path,
                                r2_thumb_key(cache_basename, fmt_used),
                                mimetype_used,
                            )
                            return resp

                    return jsonify({"error": "Thumbnail not generated"}), 500

                finally:
                    fcntl.flock(lock_file, fcntl.LOCK_UN)
        except subprocess.TimeoutExpired:
            logger.error("ffmpeg timed out for %s", safe_path)
            return jsonify({"error": "Thumbnail generation timed out"}), 504
        except Exception as exc:
            logger.error("Error generating thumbnail for %s: %s", safe_path, exc)
            return jsonify({"error": "Internal Error"}), 500

    return bp
