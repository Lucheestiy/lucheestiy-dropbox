from __future__ import annotations

import logging
from flask import Blueprint, jsonify, request
from ..services.comments import _add_comment, _get_comments, _delete_comment
from ..services.analytics import _log_audit_event
from ..utils.validation import is_valid_share_hash, _safe_rel_path

logger = logging.getLogger("droppr.comments")

def create_comments_blueprint(deps: dict):
    resolve_share_hash = deps["resolve_share_hash"]
    
    bp = Blueprint("comments", __name__)

    @bp.route("/api/share/<share_hash>/comments")
    def get_comments(share_hash: str):
        if not is_valid_share_hash(share_hash):
            return jsonify({"error": "Invalid share hash"}), 400
        
        file_path = request.args.get("path") or "/"
        if file_path != "/":
            file_path = _safe_rel_path(file_path)
            if not file_path:
                return jsonify({"error": "Invalid file path"}), 400

        try:
            comments = _get_comments(share_hash=share_hash, file_path=file_path)
            return jsonify({"comments": comments})
        except Exception as exc:
            logger.error("Failed to get comments: %s", exc)
            return jsonify({"error": "Internal server error"}), 500

    @bp.route("/api/share/<share_hash>/comments", methods=["POST"])
    def post_comment(share_hash: str):
        if not is_valid_share_hash(share_hash):
            return jsonify({"error": "Invalid share hash"}), 400
        
        payload = request.get_json(silent=True) or {}
        file_path = payload.get("path") or "/"
        if file_path != "/":
            file_path = _safe_rel_path(file_path)
            if not file_path:
                return jsonify({"error": "Invalid file path"}), 400
        
        author = str(payload.get("author") or "Anonymous").strip()[:50]
        content = str(payload.get("content") or "").strip()
        
        if not content:
            return jsonify({"error": "Comment content is required"}), 400
        if len(content) > 2000:
            return jsonify({"error": "Comment too long"}), 400

        try:
            comment = _add_comment(
                share_hash=share_hash,
                file_path=file_path,
                author=author,
                content=content
            )
            _log_audit_event(
                "post_comment",
                target=share_hash,
                detail={
                    "path": file_path,
                    "author": author,
                    "comment_id": comment.get("id")
                }
            )
            return jsonify(comment), 201
        except Exception as exc:
            logger.error("Failed to add comment: %s", exc)
            return jsonify({"error": "Internal server error"}), 500

    return bp
