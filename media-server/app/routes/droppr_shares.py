from __future__ import annotations

import logging

from flask import Blueprint, jsonify, request

from ..services.aliases import _resolve_share_hash, _upsert_share_alias
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
        if hours_raw is None:
            return jsonify({"error": "Missing hours"}), 400

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
                meta = services.filebrowser.fetch_public_share_json(source_hash)
                path = meta.get("path") if isinstance(meta, dict) else None

            if not isinstance(path, str) or not path.strip():
                return jsonify({"error": "Missing share path"}), 400

            path_encoded = _encode_share_path(path)
            if not path_encoded:
                return jsonify({"error": "Invalid share path"}), 400

            new_share = services.filebrowser.create_share(token=token, path_encoded=path_encoded, hours=hours)
            new_hash = new_share.get("hash")
            new_expire = new_share.get("expire")
            if not is_valid_share_hash(new_hash):
                raise RuntimeError("Share API returned invalid hash")

            target_expire = int(new_expire or 0) if new_expire is not None else None
            _upsert_share_alias(from_hash=share_hash, to_hash=new_hash, path=path, target_expire=target_expire)

            clear_share_cache(share_hash)

            result = {
                "hash": share_hash,
                "target_hash": new_hash,
                "path": path,
                "target_expire": target_expire,
                "hours": hours,
            }
        except Exception as exc:
            logger.error("Failed to update share expiration for %s: %s", share_hash, exc)
            return jsonify({"error": "Failed to update share expiration"}), 500

        resp = jsonify(result)
        resp.headers["Cache-Control"] = "no-store"
        return resp

    return bp
