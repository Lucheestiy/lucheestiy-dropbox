from __future__ import annotations

import os
import secrets
import time
from urllib.parse import unquote

from flask import Blueprint, jsonify, request
from werkzeug.security import check_password_hash

from ..middleware.rate_limit import limiter


def create_droppr_requests_blueprint(require_admin_access, deps: dict):
    is_valid_share_hash = deps["is_valid_share_hash"]
    safe_root_path = deps["safe_root_path"]
    fetch_filebrowser_resource = deps["fetch_filebrowser_resource"]
    parse_bool = deps["parse_bool"]
    normalize_request_password = deps["normalize_request_password"]
    generate_password_hash = deps["generate_password_hash"]
    create_file_request_record = deps["create_file_request_record"]
    fetch_file_request = deps["fetch_file_request"]
    request_is_expired = deps["request_is_expired"]
    get_rate_limit_key = deps["get_rate_limit_key"]
    captcha_required_for_request = deps["captcha_required_for_request"]
    request_password_blocked = deps["request_password_blocked"]
    verify_captcha_token = deps["verify_captcha_token"]
    captcha_payload = deps["captcha_payload"]
    record_request_password_failure = deps["record_request_password_failure"]
    clear_request_password_failures = deps["clear_request_password_failures"]
    captcha_enabled = deps["captcha_enabled"]
    request_password_captcha_threshold = deps["request_password_captcha_threshold"]
    request_password_failure_max = deps["request_password_failure_max"]
    normalize_upload_rel_path = deps["normalize_upload_rel_path"]
    validate_upload_size = deps["validate_upload_size"]
    validate_upload_type = deps["validate_upload_type"]
    upload_validation_error = deps["upload_validation_error"]
    resolve_request_dir = deps["resolve_request_dir"]
    safe_join = deps["safe_join"]
    ensure_unique_path = deps["ensure_unique_path"]
    copy_stream_with_limit = deps["copy_stream_with_limit"]
    upload_max_bytes = deps["upload_max_bytes"]
    upload_allow_all_exts = deps["upload_allow_all_exts"]
    upload_allowed_exts = deps["upload_allowed_exts"]
    parse_content_range = deps["parse_content_range"]
    normalize_chunk_upload_id = deps["normalize_chunk_upload_id"]
    load_chunk_upload_meta = deps["load_chunk_upload_meta"]
    save_chunk_upload_meta = deps["save_chunk_upload_meta"]
    chunk_upload_paths = deps["chunk_upload_paths"]
    upload_session_dirname = deps["upload_session_dirname"]
    validate_chunk_upload_type = deps["validate_chunk_upload_type"]
    rate_limit_share_create = deps["rate_limit_share_create"]
    rate_limit_uploads = deps["rate_limit_uploads"]

    bp = Blueprint("droppr_requests", __name__)

    def _authorize_request_upload(row: dict, share_hash: str):
        stored_hash = row.get("password_hash")
        if not stored_hash:
            return None

        client_ip = get_rate_limit_key()
        if request_password_blocked(share_hash, client_ip):
            payload = {"error": "Too many failed attempts. Try again later."}
            payload.update(captcha_payload(True))
            return jsonify(payload), 429

        if captcha_required_for_request(share_hash, client_ip):
            captcha_token = request.headers.get("X-Captcha-Token") or request.form.get("captcha_token") or ""
            if not verify_captcha_token(captcha_token, client_ip):
                payload = {"error": "Captcha verification required."}
                payload.update(captcha_payload(True))
                return jsonify(payload), 403

        raw_password = request.headers.get("X-Request-Password") or request.form.get("password") or ""
        raw_password = unquote(raw_password) if raw_password else ""
        if not raw_password or not check_password_hash(str(stored_hash), raw_password):
            failures = record_request_password_failure(share_hash, client_ip)
            captcha_required = captcha_enabled and failures >= request_password_captcha_threshold
            payload = {"error": "Invalid password"}
            payload.update(captcha_payload(captcha_required))
            if failures >= request_password_failure_max:
                payload["error"] = "Too many failed attempts. Try again later."
                return jsonify(payload), 429
            return jsonify(payload), 401

        clear_request_password_failures(share_hash, client_ip)
        return None

    @bp.route("/api/droppr/requests", methods=["POST"])
    @limiter.limit(rate_limit_share_create)
    def droppr_create_request():
        error_resp, auth = require_admin_access()
        if error_resp:
            return error_resp
        token = auth.get("token") if auth else None

        payload = request.get_json(silent=True) or {}
        raw_path = payload.get("path") or payload.get("folder") or payload.get("dir")
        safe_path = safe_root_path(raw_path)
        if not safe_path:
            return jsonify({"error": "Invalid folder path"}), 400

        try:
            meta = fetch_filebrowser_resource(safe_path, token)
        except PermissionError:
            return jsonify({"error": "Unauthorized"}), 401
        except Exception:
            return jsonify({"error": "Failed to read folder metadata"}), 502

        if not meta or not parse_bool(meta.get("isDir")):
            return jsonify({"error": "Folder not found"}), 404

        hours_raw = payload.get("expires_hours") or payload.get("expiresHours") or payload.get("hours") or 0
        try:
            hours = int(str(hours_raw).strip() or "0")
        except (TypeError, ValueError):
            return jsonify({"error": "Invalid expiration hours"}), 400

        max_hours = 24 * 365 * 10
        if hours < 0 or hours > max_hours:
            return jsonify({"error": f"Hours must be between 0 and {max_hours}"}), 400

        password = normalize_request_password(payload.get("password"))
        if payload.get("password") and not password:
            return jsonify({"error": "Invalid password"}), 400

        password_hash = generate_password_hash(password) if password else None
        expires_at = int(time.time()) + (hours * 3600) if hours > 0 else None

        try:
            record = create_file_request_record(path=safe_path, password_hash=password_hash, expires_at=expires_at)
        except Exception:
            return jsonify({"error": "Failed to create request link"}), 500

        folder_name = os.path.basename(safe_path.rstrip("/")) or "Uploads"
        resp = jsonify(
            {
                "hash": record["hash"],
                "url": f"/request/{record['hash']}",
                "folder": folder_name,
                "expires_at": record["expires_at"],
                "requires_password": bool(password_hash),
            }
        )
        resp.headers["Cache-Control"] = "no-store"
        return resp

    @bp.route("/api/droppr/requests/<share_hash>", methods=["GET"])
    def droppr_request_info(share_hash: str):
        if not is_valid_share_hash(share_hash):
            return jsonify({"error": "Invalid request hash"}), 400

        try:
            row = fetch_file_request(share_hash)
        except Exception:
            return jsonify({"error": "Failed to load request"}), 500

        if not row:
            return jsonify({"error": "Request not found"}), 404

        if request_is_expired(row):
            return jsonify({"error": "Request expired"}), 410

        expires_at = row.get("expires_at")
        expires_in = None
        if expires_at:
            try:
                expires_in = max(0, int(expires_at) - int(time.time()))
            except (TypeError, ValueError):
                expires_in = None

        requires_password = bool(row.get("password_hash"))
        client_ip = get_rate_limit_key()
        captcha_required = requires_password and captcha_required_for_request(share_hash, client_ip)
        folder_name = os.path.basename(str(row.get("path") or "").rstrip("/")) or "Uploads"
        payload = {
            "hash": share_hash,
            "folder": folder_name,
            "expires_at": expires_at,
            "expires_in": expires_in,
            "requires_password": requires_password,
            "allowed_extensions": sorted(upload_allowed_exts) if not upload_allow_all_exts else [],
            "max_file_size": upload_max_bytes or None,
        }
        payload.update(captcha_payload(captcha_required))
        resp = jsonify(payload)
        resp.headers["Cache-Control"] = "no-store"
        return resp

    @bp.route("/api/droppr/requests/<share_hash>/upload", methods=["POST"])
    @limiter.limit(rate_limit_uploads)
    def droppr_request_upload(share_hash: str):
        if not is_valid_share_hash(share_hash):
            return jsonify({"error": "Invalid request hash"}), 400

        try:
            row = fetch_file_request(share_hash)
        except Exception:
            return jsonify({"error": "Failed to load request"}), 500

        if not row:
            return jsonify({"error": "Request not found"}), 404

        if request_is_expired(row):
            return jsonify({"error": "Request expired"}), 410

        auth_resp = _authorize_request_upload(row, share_hash)
        if auth_resp is not None:
            return auth_resp

        file_storage = request.files.get("file")
        if not file_storage or not file_storage.filename:
            return jsonify({"error": "Missing file"}), 400

        file_name = str(file_storage.filename or "").replace("\\", "/").split("/")[-1].strip()
        if not file_name:
            return jsonify({"error": "Invalid file name"}), 400

        rel_path = (
            request.form.get("relative_path")
            or request.form.get("relativePath")
            or request.form.get("relpath")
            or request.form.get("path")
            or request.headers.get("X-Upload-Path")
            or ""
        )
        rel_path = normalize_upload_rel_path(rel_path) if rel_path else None
        if not rel_path:
            rel_path = normalize_upload_rel_path(file_name)
        if not rel_path:
            return jsonify({"error": "Invalid file path"}), 400

        try:
            validate_upload_size(file_storage)
            validate_upload_type(file_storage, rel_path)
        except upload_validation_error as exc:
            return jsonify({"error": str(exc)}), exc.status_code

        base_dir = resolve_request_dir(str(row.get("path") or ""))
        if not base_dir:
            return jsonify({"error": "Invalid request folder"}), 400

        target = safe_join(base_dir, rel_path)
        if not target:
            return jsonify({"error": "Invalid file path"}), 400

        target_dir = os.path.dirname(target)
        try:
            os.makedirs(target_dir, exist_ok=True)
        except Exception:
            return jsonify({"error": "Failed to prepare upload folder"}), 500

        tmp_path = None
        stored_size = None
        try:
            target = ensure_unique_path(target)
            tmp_path = target + ".uploading"
            if hasattr(file_storage.stream, "seek"):
                try:
                    file_storage.stream.seek(0)
                except Exception:
                    pass
            with open(tmp_path, "wb") as handle:
                stored_size = copy_stream_with_limit(file_storage.stream, handle, upload_max_bytes or None)
            os.replace(tmp_path, target)
        except upload_validation_error as exc:
            try:
                if tmp_path and os.path.exists(tmp_path):
                    os.remove(tmp_path)
            except Exception:
                pass
            return jsonify({"error": str(exc)}), exc.status_code
        except Exception:
            try:
                if tmp_path and os.path.exists(tmp_path):
                    os.remove(tmp_path)
            except Exception:
                pass
            return jsonify({"error": "Failed to store upload"}), 500

        rel_stored = os.path.relpath(target, base_dir).replace(os.sep, "/")
        resp = jsonify(
            {
                "name": os.path.basename(target),
                "path": rel_stored,
                "size": stored_size if stored_size is not None else (os.path.getsize(target) if os.path.exists(target) else None),
            }
        )
        resp.headers["Cache-Control"] = "no-store"
        return resp

    @bp.route("/api/droppr/requests/<share_hash>/upload-chunk", methods=["POST", "PATCH"])
    @limiter.limit(rate_limit_uploads)
    def droppr_request_upload_chunk(share_hash: str):
        if not is_valid_share_hash(share_hash):
            return jsonify({"error": "Invalid request hash"}), 400

        try:
            row = fetch_file_request(share_hash)
        except Exception:
            return jsonify({"error": "Failed to load request"}), 500

        if not row:
            return jsonify({"error": "Request not found"}), 404

        if request_is_expired(row):
            return jsonify({"error": "Request expired"}), 410

        auth_resp = _authorize_request_upload(row, share_hash)
        if auth_resp is not None:
            return auth_resp

        content_range = parse_content_range(request.headers.get("Content-Range"))
        offset = None
        end = None
        total = None

        if content_range:
            offset, end, total = content_range
        else:
            try:
                offset = int(request.headers.get("X-Upload-Offset") or request.form.get("offset") or 0)
            except (TypeError, ValueError):
                offset = None
            try:
                total = int(request.headers.get("X-Upload-Length") or request.form.get("total") or 0)
            except (TypeError, ValueError):
                total = None
            length = request.content_length
            if offset is None or total is None or not length:
                return jsonify({"error": "Missing Content-Range or upload offset headers"}), 411
            end = offset + length - 1

        if offset is None or end is None or total is None or total <= 0:
            return jsonify({"error": "Invalid upload range"}), 400

        if upload_max_bytes and total > upload_max_bytes:
            return jsonify({"error": "File exceeds the maximum allowed size"}), 413

        base_dir = resolve_request_dir(str(row.get("path") or ""))
        if not base_dir:
            return jsonify({"error": "Invalid request folder"}), 400

        upload_id = normalize_chunk_upload_id(
            request.headers.get("X-Upload-Id") or request.form.get("upload_id") or request.args.get("upload_id")
        )

        rel_path = (
            request.form.get("relative_path")
            or request.form.get("relativePath")
            or request.form.get("relpath")
            or request.form.get("path")
            or ""
        )
        rel_path = normalize_upload_rel_path(rel_path) if rel_path else None
        file_name = (
            request.headers.get("X-Upload-Name")
            or request.form.get("filename")
            or request.form.get("file_name")
            or ""
        )
        file_name = str(file_name).replace("\\", "/").split("/")[-1].strip() if file_name else ""

        meta = None
        if upload_id:
            meta = load_chunk_upload_meta(base_dir, upload_id)
            if not meta:
                return jsonify({"error": "Upload session not found"}), 404

        if not upload_id:
            if offset != 0:
                return jsonify({"error": "Upload session not initialized"}), 409
            if not rel_path:
                rel_path = normalize_upload_rel_path(file_name)
            if not rel_path:
                return jsonify({"error": "Invalid file path"}), 400
            target = safe_join(base_dir, rel_path)
            if not target:
                return jsonify({"error": "Invalid file path"}), 400
            target_dir = os.path.dirname(target)
            os.makedirs(target_dir, exist_ok=True)
            target = ensure_unique_path(target)
            rel_path = os.path.relpath(target, base_dir).replace(os.sep, "/")
            upload_id = secrets.token_urlsafe(12)
            meta = {
                "target": target,
                "rel_path": rel_path,
                "total": total,
                "created_at": int(time.time()),
            }
            save_chunk_upload_meta(base_dir, upload_id, meta)

        if not meta or not isinstance(meta, dict):
            return jsonify({"error": "Upload session invalid"}), 400

        target = meta.get("target")
        stored_total = int(meta.get("total") or total or 0)
        if not target or stored_total <= 0:
            return jsonify({"error": "Upload session invalid"}), 400
        if total != stored_total:
            return jsonify({"error": "Upload size mismatch"}), 400

        state_dir = os.path.join(base_dir, upload_session_dirname)
        os.makedirs(state_dir, exist_ok=True)
        meta_path, part_path = chunk_upload_paths(base_dir, upload_id)

        current_size = os.path.getsize(part_path) if os.path.exists(part_path) else 0
        if current_size != offset:
            return jsonify({"error": "Offset mismatch", "offset": current_size}), 409

        reported_mime = request.headers.get("Content-Type")
        first_sample = b""
        bytes_written = 0
        try:
            with open(part_path, "ab") as handle:
                while True:
                    chunk = request.stream.read(1024 * 1024)
                    if not chunk:
                        break
                    if not first_sample:
                        first_sample = chunk[:64]
                    bytes_written += len(chunk)
                    if upload_max_bytes and (offset + bytes_written) > upload_max_bytes:
                        raise upload_validation_error("File exceeds the maximum allowed size", 413)
                    handle.write(chunk)

            expected = end - offset + 1
            if bytes_written != expected:
                return jsonify({"error": "Chunk size mismatch"}), 400

            if offset == 0:
                try:
                    validate_chunk_upload_type(meta["rel_path"], first_sample, reported_mime)
                except upload_validation_error as exc:
                    if os.path.exists(part_path):
                        os.remove(part_path)
                    if os.path.exists(meta_path):
                        os.remove(meta_path)
                    return jsonify({"error": str(exc)}), exc.status_code
        except upload_validation_error as exc:
            return jsonify({"error": str(exc)}), exc.status_code
        except Exception:
            return jsonify({"error": "Failed to store upload"}), 500

        new_offset = offset + bytes_written
        complete = new_offset >= stored_total
        rel_stored = meta.get("rel_path") or ""

        if complete:
            os.replace(part_path, target)
            try:
                if os.path.exists(meta_path):
                    os.remove(meta_path)
            except Exception:
                pass
            resp = jsonify(
                {
                    "upload_id": upload_id,
                    "complete": True,
                    "name": os.path.basename(target),
                    "path": rel_stored,
                    "size": os.path.getsize(target) if os.path.exists(target) else stored_total,
                }
            )
        else:
            resp = jsonify({"upload_id": upload_id, "complete": False, "offset": new_offset})

        resp.headers["Cache-Control"] = "no-store"
        return resp

    return bp
