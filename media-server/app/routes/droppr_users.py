from __future__ import annotations

import logging

from flask import Blueprint, jsonify, request

from ..services.container import get_services
from ..services.users import (
    USERNAME_RE,
    USER_PASSWORD_MIN_LEN,
    USER_PASSWORD_PWNED_CHECK,
    USER_PASSWORD_REQUIRE_DIGIT,
    USER_PASSWORD_REQUIRE_LOWER,
    USER_PASSWORD_REQUIRE_SYMBOL,
    USER_PASSWORD_REQUIRE_UPPER,
    USER_SCOPE_ROOT,
    _build_user_scope,
    _ensure_user_directory,
    _normalize_username,
    _password_rules_error,
)

logger = logging.getLogger("droppr.users")


def create_droppr_users_blueprint(require_admin_access):
    bp = Blueprint("droppr_users", __name__)

    @bp.route("/api/droppr/users", methods=["GET", "POST"])
    def droppr_users():
        error_resp, auth = require_admin_access()
        if error_resp:
            return error_resp
        token = auth.get("token") if auth else None

        if request.method == "GET":
            resp = jsonify(
                {
                    "root": USER_SCOPE_ROOT,
                    "username_pattern": USERNAME_RE.pattern,
                    "password_min_length": USER_PASSWORD_MIN_LEN,
                    "password_rules": {
                        "min_length": USER_PASSWORD_MIN_LEN,
                        "require_upper": USER_PASSWORD_REQUIRE_UPPER,
                        "require_lower": USER_PASSWORD_REQUIRE_LOWER,
                        "require_digit": USER_PASSWORD_REQUIRE_DIGIT,
                        "require_symbol": USER_PASSWORD_REQUIRE_SYMBOL,
                        "pwned_check": USER_PASSWORD_PWNED_CHECK,
                    },
                }
            )
            resp.headers["Cache-Control"] = "no-store"
            return resp

        payload = request.get_json(silent=True) or {}
        username = _normalize_username(payload.get("username") or payload.get("user") or payload.get("name"))
        if not username:
            return jsonify({"error": "Invalid username"}), 400

        password_raw = payload.get("password")
        password_error = _password_rules_error(password_raw)
        if password_error:
            return jsonify({"error": password_error}), 400
        password = str(password_raw)

        scope = _build_user_scope(username)
        try:
            _ensure_user_directory(scope)
        except Exception as exc:
            logger.error("Failed to create user directory for %s: %s", username, exc)
            return jsonify({"error": "Failed to create user directory"}), 500

        services = get_services()
        try:
            user = services.filebrowser.create_user(token=token, username=username, password=password, scope=scope)
        except FileExistsError:
            return jsonify({"error": "User already exists"}), 409
        except PermissionError:
            return jsonify({"error": "Unauthorized"}), 401
        except Exception as exc:
            logger.error("Failed to create user %s: %s", username, exc)
            return jsonify({"error": "Failed to create user"}), 502

        resp = jsonify(
            {
                "id": user.get("id") if isinstance(user, dict) else None,
                "username": username,
                "scope": scope,
                "root": USER_SCOPE_ROOT,
            }
        )
        resp.headers["Cache-Control"] = "no-store"
        return resp

    return bp
