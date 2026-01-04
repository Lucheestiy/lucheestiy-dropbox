from __future__ import annotations

import logging

from flask import Blueprint, jsonify, request

from ..services.aliases import _list_share_aliases
from ..services.analytics import _parse_int

logger = logging.getLogger("droppr.droppr")


def create_droppr_aliases_blueprint(require_admin_access):
    bp = Blueprint("droppr_aliases", __name__)

    @bp.route("/api/droppr/shares/aliases")
    def droppr_list_share_aliases():
        error_resp, _auth = require_admin_access()
        if error_resp:
            return error_resp

        limit = _parse_int(request.args.get("limit")) or 500
        try:
            aliases = _list_share_aliases(limit=limit)
        except Exception as exc:
            logger.error("Failed to list share aliases: %s", exc)
            return jsonify({"error": "Failed to list share aliases"}), 500

        resp = jsonify({"aliases": aliases})
        resp.headers["Cache-Control"] = "no-store"
        return resp

    return bp
