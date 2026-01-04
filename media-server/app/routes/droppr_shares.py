from __future__ import annotations

import logging

from flask import Blueprint, jsonify, request

from ..config import parse_bool
from ..services.aliases import _aliases_conn, _resolve_share_hash, _upsert_share_alias
from ..services.analytics import _log_audit_event
from ..services.container import get_services
from ..services.share_cache import clear_share_cache
from ..utils.validation import _encode_share_path, is_valid_share_hash

logger = logging.getLogger("droppr.droppr")


def create_droppr_shares_blueprint(require_admin_access):
    bp = Blueprint("droppr_shares", __name__)

    @bp.route("/api/droppr/shares/<share_hash>/expire", methods=["POST"])
    def droppr_update_share_expire(share_hash: str):
        if not is_valid_share_hash(share_hash):
            return jsonify({"error": "Invalid share hash"}), 400

        error_resp, auth = require_admin_access()
        if error_resp:
            return error_resp
        token = auth.get("token") if auth else None

        payload = request.get_json(silent=True) or {}
        hours_raw = payload.get("hours")
        if hours_raw is None:
            hours_raw = payload.get("expires_hours") or payload.get("expiresHours")

        limit_raw = payload.get("download_limit") or payload.get("downloadLimit")
        download_limit = None
        if limit_raw is not None:
            try:
                download_limit = int(str(limit_raw).strip())
                if download_limit < 0:
                    return jsonify({"error": "Download limit must be >= 0"}), 400
            except (TypeError, ValueError):
                return jsonify({"error": "Invalid download limit"}), 400

        allow_download_raw = payload.get("allow_download")
        if allow_download_raw is None:
            allow_download_raw = payload.get("allowDownload")
        allow_download = True if allow_download_raw is None else parse_bool(allow_download_raw)

        if hours_raw is None and download_limit is None and allow_download_raw is None:
            return jsonify({"error": "Missing parameters to update"}), 400

        hours = None
        if hours_raw is not None:
            try:
                hours = int(str(hours_raw).strip() or "0")
            except (TypeError, ValueError):
                return jsonify({"error": "Invalid hours"}), 400

            max_hours = 24 * 365 * 10
            if hours < 0 or hours > max_hours:
                return jsonify({"error": f"Hours must be between 0 and {max_hours}"}), 400

        services = get_services()
        try:
            path = payload.get("path")
            if not isinstance(path, str) or not path.strip():
                source_hash = _resolve_share_hash(share_hash)
                # Handle cases where source_hash might be None due to limit but we are the admin
                if source_hash is None:
                    # Try to find the original to_hash from DB directly to get the path
                    with _aliases_conn() as conn:
                        row = conn.execute(
                            "SELECT path, to_hash FROM share_aliases WHERE from_hash = ?",
                            (share_hash,),
                        ).fetchone()
                        if row:
                            path = row["path"]
                            source_hash = row["to_hash"]

                if not path:
                    meta = services.filebrowser.fetch_public_share_json(source_hash or share_hash)
                    path = meta.get("path") if isinstance(meta, dict) else None

            if not isinstance(path, str) or not path.strip():
                return jsonify({"error": "Missing share path"}), 400

            path_encoded = _encode_share_path(path)
            if not path_encoded:
                return jsonify({"error": "Invalid share path"}), 400

            if hours is not None:
                if not isinstance(token, str) or not token:
                    return jsonify({"error": "Unauthorized"}), 401
                new_share = services.filebrowser.create_share(
                    token=token, path_encoded=path_encoded, hours=hours
                )
                new_hash_raw = new_share.get("hash")
                new_expire = new_share.get("expire")
                if not isinstance(new_hash_raw, str) or not is_valid_share_hash(new_hash_raw):
                    raise RuntimeError("Share API returned invalid hash")
                new_hash = new_hash_raw
                target_expire = int(new_expire or 0) if new_expire is not None else None
            else:
                # If hours not provided, keep existing target_expire and to_hash
                with _aliases_conn() as conn:
                    row = conn.execute(
                        "SELECT to_hash, target_expire FROM share_aliases WHERE from_hash = ?",
                        (share_hash,),
                    ).fetchone()
                    if row:
                        to_hash = row["to_hash"]
                        new_hash = to_hash if isinstance(to_hash, str) else share_hash
                        target_expire = row["target_expire"]
                    else:
                        new_hash = share_hash
                        target_expire = None

            _upsert_share_alias(
                from_hash=share_hash,
                to_hash=new_hash,
                path=path,
                target_expire=target_expire,
                download_limit=download_limit,
                allow_download=allow_download,
            )

            clear_share_cache(share_hash)

            _log_audit_event(
                "update_share",
                target=share_hash,
                detail={
                    "path": path,
                    "hours": hours,
                    "download_limit": download_limit,
                    "allow_download": allow_download,
                    "target_hash": new_hash,
                },
            )

            result = {
                "hash": share_hash,
                "target_hash": new_hash,
                "path": path,
                "target_expire": target_expire,
                "hours": hours,
                "download_limit": download_limit,
                "allow_download": allow_download,
            }
        except Exception as exc:
            logger.error("Failed to update share expiration for %s: %s", share_hash, exc)
            return jsonify({"error": "Failed to update share expiration"}), 500

        resp = jsonify(result)
        resp.headers["Cache-Control"] = "no-store"
        return resp

    return bp
