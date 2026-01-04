from __future__ import annotations

from flask import Blueprint, Response, jsonify


def create_droppr_auth_blueprint(deps: dict):
    get_auth_token = deps["get_auth_token"]
    validate_filebrowser_admin = deps["validate_filebrowser_admin"]
    log_auth_event = deps["log_auth_event"]
    admin_totp_enabled = deps["admin_totp_enabled"]
    get_totp_code_from_request = deps["get_totp_code_from_request"]
    is_valid_totp = deps["is_valid_totp"]
    peek_jwt_payload = deps["peek_jwt_payload"]
    admin_password_expired = deps["admin_password_expired"]
    issue_droppr_tokens = deps["issue_droppr_tokens"]
    get_droppr_refresh_claims = deps["get_droppr_refresh_claims"]
    get_refresh_token_record = deps["get_refresh_token_record"]
    revoke_refresh_token = deps["revoke_refresh_token"]

    bp = Blueprint("droppr_auth", __name__)

    @bp.route("/api/droppr/auth/login", methods=["POST"])
    def droppr_auth_login():
        token = get_auth_token()
        if not token:
            log_auth_event("droppr_login", False, "missing_token")
            resp = jsonify({"error": "Missing auth token"})
            resp.status_code = 401
            return resp

        try:
            status = validate_filebrowser_admin(token)
        except Exception as exc:
            log_auth_event("droppr_login", False, f"error:{exc}")
            resp = jsonify({"error": f"Failed to validate auth: {exc}"})
            resp.status_code = 502
            return resp

        if status is not None:
            if status == 429:
                log_auth_event("droppr_login", False, "rate_limited")
                resp = jsonify({"error": "Too many authentication attempts"})
                resp.status_code = 429
                return resp
            log_auth_event("droppr_login", False, "unauthorized")
            resp = jsonify({"error": "Unauthorized"})
            resp.status_code = status
            return resp

        otp_verified = False
        if admin_totp_enabled:
            code = get_totp_code_from_request()
            if not is_valid_totp(code):
                log_auth_event("droppr_login", False, "otp_required")
                resp = jsonify({"error": "OTP required", "otp_required": True})
                resp.status_code = 401
                return resp
            otp_verified = True
            log_auth_event("droppr_otp", True, "login")

        fb_payload = peek_jwt_payload(token) or {}
        fb_iat = None
        if fb_payload.get("iat") is not None:
            try:
                fb_iat = int(fb_payload.get("iat"))
            except (TypeError, ValueError):
                fb_iat = None

        if admin_password_expired(token, fb_iat):
            log_auth_event("droppr_login", False, "password_expired")
            resp = jsonify({"error": "Admin password expired", "password_expired": True})
            resp.status_code = 403
            return resp

        tokens = issue_droppr_tokens(otp_verified, fb_token=token, fb_iat=fb_iat)
        log_auth_event("droppr_login", True, "ok")
        resp = jsonify(tokens)
        resp.headers["Cache-Control"] = "no-store"
        return resp

    @bp.route("/api/droppr/auth/refresh", methods=["POST"])
    def droppr_auth_refresh():
        claims = get_droppr_refresh_claims()
        if not claims:
            log_auth_event("droppr_refresh", False, "missing_token")
            resp = jsonify({"error": "Missing refresh token"})
            resp.status_code = 401
            return resp

        jti = claims.get("jti")
        if not jti:
            log_auth_event("droppr_refresh", False, "invalid_token")
            resp = jsonify({"error": "Invalid refresh token"})
            resp.status_code = 401
            return resp

        record = get_refresh_token_record(str(jti))
        if not record or record.get("revoked"):
            log_auth_event("droppr_refresh", False, "revoked")
            resp = jsonify({"error": "Refresh token revoked"})
            resp.status_code = 401
            return resp

        otp_verified = bool(claims.get("otp"))
        if admin_totp_enabled and not otp_verified:
            code = get_totp_code_from_request()
            if not is_valid_totp(code):
                log_auth_event("droppr_refresh", False, "otp_required")
                resp = jsonify({"error": "OTP required", "otp_required": True})
                resp.status_code = 401
                return resp
            otp_verified = True
            log_auth_event("droppr_otp", True, "refresh")

        fb_token = claims.get("fb_token")
        if not fb_token:
            log_auth_event("droppr_refresh", False, "missing_fb_token")
            resp = jsonify({"error": "Invalid refresh token"})
            resp.status_code = 401
            return resp

        fb_iat = claims.get("fb_iat")
        if admin_password_expired(str(fb_token), fb_iat):
            log_auth_event("droppr_refresh", False, "password_expired")
            resp = jsonify({"error": "Admin password expired", "password_expired": True})
            resp.status_code = 403
            return resp

        revoke_refresh_token(str(jti))
        tokens = issue_droppr_tokens(otp_verified, fb_token=str(fb_token), fb_iat=fb_iat)
        log_auth_event("droppr_refresh", True, "ok")
        resp = jsonify(tokens)
        resp.headers["Cache-Control"] = "no-store"
        return resp

    @bp.route("/api/droppr/auth/logout", methods=["POST"])
    def droppr_auth_logout():
        claims = get_droppr_refresh_claims()
        jti = claims.get("jti") if claims else None
        if jti:
            revoke_refresh_token(str(jti))
        log_auth_event("droppr_logout", True, "ok")
        return Response(status=204)

    return bp
