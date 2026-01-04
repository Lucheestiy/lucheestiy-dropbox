from __future__ import annotations

import logging

import requests
from flask import Blueprint, Response, jsonify, redirect, request, stream_with_context

from ..middleware.rate_limit import limiter

logger = logging.getLogger("droppr.share")


def create_share_blueprint(deps: dict):
    is_valid_share_hash = deps["is_valid_share_hash"]
    resolve_share_hash = deps["resolve_share_hash"]
    parse_bool = deps["parse_bool"]
    default_cache_ttl_seconds = deps["default_cache_ttl_seconds"]
    get_share_files = deps["get_share_files"]
    log_event = deps["log_event"]
    maybe_warm_share_cache = deps["maybe_warm_share_cache"]
    safe_rel_path = deps["safe_rel_path"]
    rate_limit_downloads = deps["rate_limit_downloads"]
    fetch_public_share_json = deps["fetch_public_share_json"]
    filebrowser_public_dl_api = deps["filebrowser_public_dl_api"]
    with_internal_signature = deps["with_internal_signature"]

    bp = Blueprint("share", __name__)

    @bp.route("/api/share/<share_hash>/files")
    def list_share_files(share_hash: str):
        if not is_valid_share_hash(share_hash):
            return jsonify({"error": "Invalid share hash"}), 400

        source_hash = resolve_share_hash(share_hash)

        force_refresh = parse_bool(request.args.get("refresh") or request.args.get("force"))
        max_age_param = request.args.get("max_age") or request.args.get("maxAge")
        max_age_seconds = default_cache_ttl_seconds
        if max_age_param is not None:
            try:
                max_age_seconds = max(0, int(max_age_param))
            except (TypeError, ValueError):
                max_age_seconds = default_cache_ttl_seconds

        recursive_param = request.args.get("recursive")
        recursive = True if recursive_param is None else parse_bool(recursive_param)

        files = get_share_files(
            share_hash,
            source_hash=source_hash,
            force_refresh=force_refresh,
            max_age_seconds=max_age_seconds,
            recursive=recursive,
        )
        if files is None:
            return jsonify({"error": "Share not found"}), 404

        resp = jsonify(files)
        resp.headers["Cache-Control"] = "no-store"
        log_event("gallery_view", share_hash)
        maybe_warm_share_cache()
        return resp

    @bp.route("/api/share/<share_hash>/file/<path:filename>")
    @limiter.limit(rate_limit_downloads)
    def serve_file(share_hash: str, filename: str):
        if not is_valid_share_hash(share_hash):
            return "Invalid share hash", 400

        source_hash = resolve_share_hash(share_hash)

        filename = filename or ""
        safe = safe_rel_path(filename)
        if not safe:
            return "Invalid filename", 400

        is_download = parse_bool(request.args.get("download") or request.args.get("dl"))
        if is_download:
            log_event("file_download", share_hash, file_path=safe)

        encoded = requests.utils.quote(safe, safe="/")
        if is_download:
            return redirect(f"/api/public/dl/{source_hash}/{encoded}?download=1", code=302)
        return redirect(f"/api/public/dl/{source_hash}/{encoded}?inline=true", code=302)

    @bp.route("/api/share/<share_hash>/download")
    @limiter.limit(rate_limit_downloads)
    def download_all(share_hash: str):
        if not is_valid_share_hash(share_hash):
            return "Invalid share hash", 400

        source_hash = resolve_share_hash(share_hash)

        data = fetch_public_share_json(source_hash)
        if data and not isinstance(data.get("items"), list):
            log_event("file_download", share_hash)
            inline = request.args.get("inline") or request.args.get("play")
            if inline:
                return redirect(f"/api/public/file/{source_hash}?inline=true", code=302)
            return redirect(f"/api/public/file/{source_hash}", code=302)

        try:
            req_url = f"{filebrowser_public_dl_api}/{source_hash}?download=1"
            req_headers = with_internal_signature({}, "GET", req_url)
            req = requests.get(req_url, headers=req_headers, stream=True, timeout=120)
            req.raise_for_status()
            log_event("zip_download", share_hash)

            headers = {}
            content_disposition = req.headers.get("Content-Disposition")
            if content_disposition:
                headers["Content-Disposition"] = content_disposition
            else:
                headers["Content-Disposition"] = f'attachment; filename="share_{share_hash}.zip"'

            return Response(
                stream_with_context(req.iter_content(chunk_size=8192)),
                status=req.status_code,
                content_type=req.headers.get("Content-Type"),
                headers=headers,
            )
        except Exception as exc:
            logger.error("Failed to download share for %s: %s", share_hash, exc)
            return "Failed to download share", 500

    return bp
