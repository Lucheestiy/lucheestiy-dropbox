from __future__ import annotations

import fcntl
import json
import logging
import os
import subprocess
from urllib.parse import quote

from flask import Blueprint, Response, jsonify, redirect, request

logger = logging.getLogger("droppr.share_media")


def create_share_media_blueprint(deps: dict):
    is_valid_share_hash = deps["is_valid_share_hash"]
    resolve_share_hash = deps["resolve_share_hash"]
    safe_rel_path = deps["safe_rel_path"]
    video_exts = deps["video_exts"]
    image_exts = deps["image_exts"]
    select_preview_format = deps["select_preview_format"]
    parse_preview_time = deps["parse_preview_time"]
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
    filebrowser_public_dl_api = deps["filebrowser_public_dl_api"]
    normalize_preview_format = deps["normalize_preview_format"]
    ffprobe_video_meta = deps["ffprobe_video_meta"]
    thumb_multi_default = deps["thumb_multi_default"]
    thumb_multi_max = deps["thumb_multi_max"]
    fetch_public_share_json = deps["fetch_public_share_json"]
    parse_bool = deps["parse_bool"]
    proxy_cache_key = deps["proxy_cache_key"]
    r2_proxy_key = deps["r2_proxy_key"]
    ensure_fast_proxy_mp4 = deps["ensure_fast_proxy_mp4"]
    hls_cache_key = deps["hls_cache_key"]
    r2_hls_key = deps["r2_hls_key"]
    ensure_hls_package = deps["ensure_hls_package"]
    proxy_cache_dir = deps["proxy_cache_dir"]
    r2_available_url = deps["r2_available_url"]
    hd_cache_key = deps["hd_cache_key"]
    hls_cache_dir = deps["hls_cache_dir"]
    enqueue_task = deps["enqueue_task"]
    ensure_hd_mp4 = deps["ensure_hd_mp4"]
    hls_renditions = deps["hls_renditions"]
    ensure_video_meta_record = deps["ensure_video_meta_record"]

    bp = Blueprint("share_media", __name__)

    def _build_thumbnail_times(duration: float | None, raw_times: str | None, count: int | None) -> list[float]:
        times: list[float] = []
        if raw_times:
            for part in raw_times.split(","):
                t = parse_preview_time(part)
                if t is None:
                    continue
                times.append(t)
        else:
            total = count if count is not None else thumb_multi_default
            total = max(1, min(total, thumb_multi_max))
            if duration and duration > 0:
                if total == 3:
                    fractions = [0.1, 0.5, 0.9]
                else:
                    step = 1 / (total + 1)
                    fractions = [step * (i + 1) for i in range(total)]
                for frac in fractions:
                    times.append(max(0.0, min(duration, duration * frac)))
            else:
                base = 1.0
                for i in range(total):
                    times.append(base + (i * 2.0))

        result = []
        seen = set()
        for t in sorted(times):
            key = round(t, 2)
            if key in seen:
                continue
            seen.add(key)
            result.append(key)
        return result

    @bp.route("/api/share/<share_hash>/preview/<path:filename>")
    def serve_preview(share_hash: str, filename: str):
        if not is_valid_share_hash(share_hash):
            return "Invalid share hash", 400

        source_hash = resolve_share_hash(share_hash)

        filename = filename or ""
        safe = safe_rel_path(filename)
        if not safe:
            return "Invalid filename", 400

        ext = os.path.splitext(safe)[1].lstrip(".").lower()
        is_video = ext in video_exts
        is_image = ext in image_exts
        if not is_video and not is_image:
            return "Unsupported preview type", 415

        fmt, mimetype, vary_accept = select_preview_format(
            request.args.get("format"),
            request.headers.get("Accept"),
        )
        preview_time = parse_preview_time(request.args.get("t") or request.args.get("ts"))
        raw_width = request.args.get("w") or request.args.get("width")
        thumb_width = normalize_thumb_width(raw_width) if raw_width else thumb_max_width

        cache_key_name = safe
        if raw_width:
            cache_key_name = f"{cache_key_name}|w={thumb_width}"
        if preview_time is not None and is_video:
            cache_key_name = f"{cache_key_name}|t={preview_time}"

        cache_path = get_cache_path(source_hash, cache_key_name, ext=fmt)
        lock_path = cache_path + ".lock"
        cache_basename = thumb_cache_basename(source_hash, cache_key_name)
        fallback_formats = preview_fallbacks(fmt)
        fallback_paths = {
            fallback_fmt: get_cache_path(source_hash, cache_key_name, ext=fallback_fmt)
            for fallback_fmt in fallback_formats
        }

        r2_key = r2_thumb_key(cache_basename, fmt)
        r2_redirect = maybe_redirect_r2(r2_key, require_public=False)
        if r2_redirect:
            return r2_redirect

        # Check cache first (fast path)
        if os.path.exists(cache_path):
            try:
                # Touch the file to update access time (optional)
                os.utime(cache_path, None)
            except OSError:
                pass
            enqueue_r2_upload_file(
                f"r2:thumb:{cache_basename}:{fmt}",
                cache_path,
                r2_thumb_key(cache_basename, fmt),
                mimetype,
            )
            with open(cache_path, "rb") as handle:
                resp = Response(handle.read(), mimetype=mimetype)
                if vary_accept:
                    resp.headers["Vary"] = "Accept"
                return resp

        # Serialize generation for this specific file
        try:
            with open(lock_path, "w") as lock_file:
                # Acquire exclusive lock (blocking)
                fcntl.flock(lock_file, fcntl.LOCK_EX)
                try:
                    # Double-check cache after acquiring lock
                    if os.path.exists(cache_path):
                        with open(cache_path, "rb") as handle:
                            resp = Response(handle.read(), mimetype=mimetype)
                            if vary_accept:
                                resp.headers["Vary"] = "Accept"
                            return resp

                    # Generate thumbnail
                    src_url = f"{filebrowser_public_dl_api}/{source_hash}/{quote(safe, safe='/')}?inline=true"

                    def run_thumb(fmt_value: str, dst_path: str) -> subprocess.CompletedProcess:
                        cmd = ffmpeg_thumbnail_cmd(
                            src_url=src_url,
                            dst_path=dst_path,
                            seek_seconds=(
                                preview_time if (is_video and preview_time is not None) else (1 if is_video else None)
                            ),
                            fmt=fmt_value,
                            width=thumb_width,
                        )
                        result = subprocess.run(
                            cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=thumb_ffmpeg_timeout_seconds
                        )
                        if result.returncode != 0 and is_video:
                            cmd = ffmpeg_thumbnail_cmd(
                                src_url=src_url,
                                dst_path=dst_path,
                                seek_seconds=0,
                                fmt=fmt_value,
                                width=thumb_width,
                            )
                            result = subprocess.run(
                                cmd,
                                stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE,
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
                                safe,
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
                        logger.error("ffmpeg failed for %s: %s", safe, err)
                        return "Thumbnail generation failed", 500

                    if os.path.exists(cache_path):
                        enqueue_r2_upload_file(
                            f"r2:thumb:{cache_basename}:{fmt_used}",
                            cache_path,
                            r2_thumb_key(cache_basename, fmt_used),
                            mimetype_used,
                        )
                        with open(cache_path, "rb") as handle:
                            resp = Response(handle.read(), mimetype=mimetype_used)
                            if vary_accept:
                                resp.headers["Vary"] = "Accept"
                            return resp

                    return "Thumbnail not generated", 500

                finally:
                    # Release lock
                    fcntl.flock(lock_file, fcntl.LOCK_UN)
        except subprocess.TimeoutExpired:
            logger.error("ffmpeg timed out for %s", safe)
            return "Thumbnail generation timed out", 504
        except Exception as exc:
            logger.error("Error generating thumbnail for %s: %s", safe, exc)
            return "Internal Error", 500

    @bp.route("/api/share/<share_hash>/thumbnails/<path:filename>")
    def share_video_thumbnails(share_hash: str, filename: str):
        if not is_valid_share_hash(share_hash):
            return jsonify({"error": "Invalid share hash"}), 400

        source_hash = resolve_share_hash(share_hash)

        filename = filename or ""
        safe = safe_rel_path(filename)
        if not safe:
            return jsonify({"error": "Invalid filename"}), 400

        ext = os.path.splitext(safe)[1].lstrip(".").lower()
        if ext not in video_exts:
            return jsonify({"error": "Unsupported video type"}), 415

        raw_format = request.args.get("format")
        fmt = normalize_preview_format(raw_format)
        raw_times = request.args.get("times") or request.args.get("t")
        count_raw = request.args.get("count")
        raw_width = request.args.get("w") or request.args.get("width")
        thumb_width = normalize_thumb_width(raw_width) if raw_width else None
        count = None
        if count_raw is not None:
            try:
                count = int(count_raw)
            except (TypeError, ValueError):
                count = None

        duration = None
        try:
            src_url = f"{filebrowser_public_dl_api}/{source_hash}/{quote(safe, safe='/')}?inline=true"
            meta = ffprobe_video_meta(src_url)
            if meta and isinstance(meta.get("duration"), (int, float)):
                duration = float(meta["duration"])
        except Exception:
            duration = None

        times = _build_thumbnail_times(duration, raw_times, count)
        thumbnails = []
        encoded = quote(safe, safe="/")
        for t in times:
            url = f"/api/share/{share_hash}/preview/{encoded}?t={t}"
            if raw_width and thumb_width:
                url += f"&w={thumb_width}"
            if raw_format and fmt != "auto":
                url += f"&format={fmt}"
            thumbnails.append({"time": t, "url": url})

        resp = jsonify({"duration": duration, "thumbnails": thumbnails})
        resp.headers["Cache-Control"] = "no-store"
        return resp

    @bp.route("/api/share/<share_hash>/proxy/<path:filename>")
    def serve_proxy(share_hash: str, filename: str):
        if not is_valid_share_hash(share_hash):
            return "Invalid share hash", 400

        source_hash = resolve_share_hash(share_hash)

        filename = filename or ""
        safe = safe_rel_path(filename)
        if not safe:
            return "Invalid filename", 400

        ext = os.path.splitext(safe)[1].lstrip(".").lower()
        if ext not in video_exts:
            return "Unsupported proxy type", 415

        meta = fetch_public_share_json(source_hash, subpath="/" + safe)
        if not meta:
            return "File not found", 404
        if isinstance(meta.get("items"), list) or parse_bool(meta.get("isDir")):
            return "File not found", 404

        name = meta.get("name") if isinstance(meta.get("name"), str) else None
        meta_path = meta.get("path") if isinstance(meta.get("path"), str) else None
        # For single-file shares, FileBrowser ignores the subpath. Enforce name match.
        if (not meta_path or not meta_path.startswith("/")) and name and safe != name:
            return "File not found", 404

        size = int(meta.get("size") or 0)
        modified = meta.get("modified") if isinstance(meta.get("modified"), str) else None
        proxy_key = proxy_cache_key(share_hash=source_hash, file_path=safe, size=size, modified=modified)
        r2_redirect = maybe_redirect_r2(r2_proxy_key(proxy_key), require_public=False)
        if r2_redirect:
            return r2_redirect

        try:
            _, _, public_url, _ = ensure_fast_proxy_mp4(
                share_hash=source_hash, file_path=safe, size=size, modified=modified
            )
            return redirect(public_url, code=302)
        except subprocess.TimeoutExpired:
            logger.error("ffmpeg proxy timed out for %s", safe)
            return "Proxy generation timed out", 504
        except RuntimeError:
            return "Proxy generation failed", 500
        except Exception as exc:
            logger.error("Error generating proxy for %s: %s", safe, exc)
            return "Internal Error", 500

    @bp.route("/api/share/<share_hash>/hls/<path:filename>")
    def serve_hls(share_hash: str, filename: str):
        if not is_valid_share_hash(share_hash):
            return "Invalid share hash", 400

        source_hash = resolve_share_hash(share_hash)

        filename = filename or ""
        safe = safe_rel_path(filename)
        if not safe:
            return "Invalid filename", 400

        ext = os.path.splitext(safe)[1].lstrip(".").lower()
        if ext not in video_exts:
            return "Unsupported HLS type", 415

        meta = fetch_public_share_json(source_hash, subpath="/" + safe)
        if not meta:
            return "File not found", 404
        if isinstance(meta.get("items"), list) or parse_bool(meta.get("isDir")):
            return "File not found", 404

        name = meta.get("name") if isinstance(meta.get("name"), str) else None
        meta_path = meta.get("path") if isinstance(meta.get("path"), str) else None
        if (not meta_path or not meta_path.startswith("/")) and name and safe != name:
            return "File not found", 404

        size = int(meta.get("size") or 0)
        modified = meta.get("modified") if isinstance(meta.get("modified"), str) else None
        hls_key = hls_cache_key(share_hash=source_hash, file_path=safe, size=size, modified=modified)
        r2_redirect = maybe_redirect_r2(r2_hls_key(hls_key, "master.m3u8"), require_public=True)
        if r2_redirect:
            return r2_redirect

        try:
            _, _, public_url = ensure_hls_package(share_hash=source_hash, file_path=safe, size=size, modified=modified)
            return redirect(public_url, code=302)
        except subprocess.TimeoutExpired:
            logger.error("ffmpeg HLS timed out for %s", safe)
            return "HLS generation timed out", 504
        except RuntimeError:
            return "HLS generation failed", 500
        except Exception as exc:
            logger.error("Error generating HLS for %s: %s", safe, exc)
            return "Internal Error", 500

    @bp.route("/api/share/<share_hash>/video-sources/<path:filename>", methods=["GET", "POST"])
    def video_sources(share_hash: str, filename: str):
        if not is_valid_share_hash(share_hash):
            return jsonify({"error": "Invalid share hash"}), 400

        source_hash = resolve_share_hash(share_hash)

        filename = filename or ""
        safe = safe_rel_path(filename)
        if not safe:
            return jsonify({"error": "Invalid filename"}), 400

        ext = os.path.splitext(safe)[1].lstrip(".").lower()
        if ext not in video_exts:
            return jsonify({"error": "Unsupported video type"}), 415

        meta = fetch_public_share_json(source_hash, subpath="/" + safe)
        if not meta or isinstance(meta.get("items"), list) or parse_bool(meta.get("isDir")):
            return jsonify({"error": "File not found"}), 404

        name = meta.get("name") if isinstance(meta.get("name"), str) else None
        meta_path = meta.get("path") if isinstance(meta.get("path"), str) else None
        if (not meta_path or not meta_path.startswith("/")) and name and safe != name:
            return jsonify({"error": "File not found"}), 404

        original_size = int(meta.get("size") or 0)
        modified = meta.get("modified") if isinstance(meta.get("modified"), str) else None

        if meta_path and meta_path.startswith("/"):
            original_url = f"/api/public/dl/{source_hash}/{quote(safe, safe='/')}?inline=true"
        else:
            original_url = f"/api/public/file/{source_hash}?inline=true"

        proxy_key = proxy_cache_key(share_hash=source_hash, file_path=safe, size=original_size, modified=modified)
        proxy_path = os.path.join(proxy_cache_dir, f"{proxy_key}.mp4")
        proxy_url = f"/api/proxy-cache/{proxy_key}.mp4"

        proxy_ready = os.path.exists(proxy_path)
        proxy_size = os.path.getsize(proxy_path) if proxy_ready else None
        proxy_cdn_url = r2_available_url(r2_proxy_key(proxy_key), require_public=False)
        if proxy_cdn_url:
            proxy_url = proxy_cdn_url
            proxy_ready = True

        hd_key = hd_cache_key(share_hash=source_hash, file_path=safe, size=original_size, modified=modified)
        hd_path = os.path.join(proxy_cache_dir, f"{hd_key}.mp4")
        hd_url = f"/api/proxy-cache/{hd_key}.mp4"
        hd_ready = os.path.exists(hd_path)
        hd_size = os.path.getsize(hd_path) if hd_ready else None
        hd_cdn_url = r2_available_url(r2_proxy_key(hd_key), require_public=False)
        if hd_cdn_url:
            hd_url = hd_cdn_url
            hd_ready = True

        hls_key = hls_cache_key(share_hash=source_hash, file_path=safe, size=original_size, modified=modified)
        hls_dir = os.path.join(hls_cache_dir, hls_key)
        hls_master = os.path.join(hls_dir, "master.m3u8")
        hls_url = f"/api/hls-cache/{hls_key}/master.m3u8"
        hls_ready = os.path.exists(hls_master)
        hls_cdn_url = r2_available_url(r2_hls_key(hls_key, "master.m3u8"), require_public=True)
        if hls_cdn_url:
            hls_url = hls_cdn_url
            hls_ready = True

        prepare_targets: set[str] = set()
        if request.method == "POST":
            payload = request.get_json(silent=True) or {}
            raw_targets = payload.get("prepare") or payload.get("targets") or payload.get("target")
            if raw_targets is None:
                raw_targets = request.args.get("prepare") or request.args.get("targets")
        else:
            raw_targets = request.args.get("prepare") or request.args.get("targets")

        if raw_targets is not None:
            if isinstance(raw_targets, str):
                prepare_targets = {p.strip().lower() for p in raw_targets.split(",") if p.strip()}
            elif isinstance(raw_targets, list):
                prepare_targets = {
                    str(p).strip().lower() for p in raw_targets if p is not None and str(p).strip()
                }
        if "adaptive" in prepare_targets:
            prepare_targets.add("hls")

        if request.method == "POST" and not prepare_targets:
            prepare_targets = {"hd"}

        prepare_started = {"fast": False, "hd": False, "hls": False}
        if "fast" in prepare_targets and not proxy_ready:
            prepare_started["fast"] = enqueue_task(
                f"fast:{proxy_key}",
                "droppr.transcode_fast",
                ensure_fast_proxy_mp4,
                share_hash=source_hash,
                file_path=safe,
                size=original_size,
                modified=modified,
            )

        if "hd" in prepare_targets and not hd_ready:
            prepare_started["hd"] = enqueue_task(
                f"hd:{hd_key}",
                "droppr.transcode_hd",
                ensure_hd_mp4,
                share_hash=source_hash,
                file_path=safe,
                size=original_size,
                modified=modified,
            )

        if "hls" in prepare_targets and not hls_ready:
            prepare_started["hls"] = enqueue_task(
                f"hls:{hls_key}",
                "droppr.transcode_hls",
                ensure_hls_package,
                share_hash=source_hash,
                file_path=safe,
                size=original_size,
                modified=modified,
            )

        resp = jsonify(
            {
                "share": share_hash,
                "path": safe,
                "original": {
                    "url": original_url,
                    "size": original_size or None,
                },
                "fast": {
                    "url": proxy_url,
                    "ready": proxy_ready,
                    "size": proxy_size,
                },
                "hd": {
                    "url": hd_url,
                    "ready": hd_ready,
                    "size": hd_size,
                },
                "hls": {
                    "url": hls_url,
                    "ready": hls_ready,
                    "variants": [
                        {
                            "height": r["height"],
                            "video_kbps": r["video_kbps"],
                            "audio_kbps": r["audio_kbps"],
                        }
                        for r in hls_renditions
                    ],
                },
                "prepare": {
                    "requested": sorted(prepare_targets) if prepare_targets else [],
                    "started": prepare_started,
                },
            }
        )
        resp.headers["Cache-Control"] = "no-store"
        return resp

    @bp.route("/api/share/<share_hash>/video-meta/<path:filename>")
    def share_video_meta(share_hash: str, filename: str):
        if not is_valid_share_hash(share_hash):
            return jsonify({"error": "Invalid share hash"}), 400

        source_hash = resolve_share_hash(share_hash)

        filename = filename or ""
        safe = safe_rel_path(filename)
        if not safe:
            return jsonify({"error": "Invalid filename"}), 400

        ext = os.path.splitext(safe)[1].lstrip(".").lower()
        if ext not in video_exts:
            return jsonify({"error": "Unsupported video type"}), 415

        meta = fetch_public_share_json(source_hash, subpath="/" + safe)
        if not meta or isinstance(meta.get("items"), list) or parse_bool(meta.get("isDir")):
            return jsonify({"error": "File not found"}), 404

        name = meta.get("name") if isinstance(meta.get("name"), str) else None
        meta_path = meta.get("path") if isinstance(meta.get("path"), str) else None
        if (not meta_path or not meta_path.startswith("/")) and name and safe != name:
            return jsonify({"error": "File not found"}), 404

        current_size = int(meta.get("size") or 0) or None
        current_modified = meta.get("modified") if isinstance(meta.get("modified"), str) else None

        db_path = "/" + safe.lstrip("/")
        row = None
        try:
            src_url = f"{filebrowser_public_dl_api}/{source_hash}/{quote(safe, safe='/')}?inline=true"
            row = ensure_video_meta_record(
                db_path=db_path,
                src_url=src_url,
                current_size=current_size,
                current_modified=current_modified,
            )
        except Exception as exc:
            logger.error("Failed to build video meta for %s: %s", db_path, exc)
            return jsonify({"error": "Failed to read video metadata"}), 500

        if not row:
            resp = jsonify(
                {
                    "share": share_hash,
                    "path": safe,
                    "name": name or os.path.basename(safe),
                    "current": {"size": current_size, "modified": current_modified},
                    "recorded": False,
                }
            )
            resp.headers["Cache-Control"] = "no-store"
            return resp

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

        recorded = bool(original_meta or processed_meta)
        resp = jsonify(
            {
                "share": share_hash,
                "path": safe,
                "name": name or os.path.basename(safe),
                "current": {"size": current_size, "modified": current_modified},
                "recorded": recorded,
                "status": str(row["status"]),
                "action": (str(row["action"]) if row["action"] is not None else None),
                "error": (str(row["error"]) if row["error"] is not None else None),
                "uploaded_at": int(row["uploaded_at"] or 0) if row["uploaded_at"] else None,
                "processed_at": int(row["processed_at"] or 0) if row["processed_at"] else None,
                "original_size": int(row["original_size"] or 0) if row["original_size"] else None,
                "processed_size": int(row["processed_size"] or 0) if row["processed_size"] else None,
                "original": original_meta,
                "processed": processed_meta,
            }
        )
        resp.headers["Cache-Control"] = "no-store"
        return resp

    return bp
