from __future__ import annotations

import io
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from app.routes.droppr_requests import create_droppr_requests_blueprint

# Mock exception for validation
class UploadValidationError(Exception):
    def __init__(self, message, status_code=400):
        super().__init__(message)
        self.status_code = status_code

@pytest.fixture
def req_deps():
    return {
        "is_valid_share_hash": MagicMock(return_value=True),
        "safe_root_path": MagicMock(return_value="/srv/uploads"),
        "fetch_filebrowser_resource": MagicMock(return_value={"isDir": True}),
        "parse_bool": MagicMock(return_value=True),
        "normalize_request_password": MagicMock(side_effect=lambda p: p),
        "generate_password_hash": MagicMock(return_value="hashed"),
        "create_file_request_record": MagicMock(return_value={"hash": "req-hash", "expires_at": None}),
        "fetch_file_request": MagicMock(return_value={"hash": "req-hash", "path": "/uploads", "password_hash": None, "expires_at": None}),
        "request_is_expired": MagicMock(return_value=False),
        "get_rate_limit_key": MagicMock(return_value="1.2.3.4"),
        "captcha_required_for_request": MagicMock(return_value=False),
        "request_password_blocked": MagicMock(return_value=False),
        "verify_captcha_token": MagicMock(return_value=True),
        "captcha_payload": MagicMock(return_value={"captcha_enabled": False}),
        "record_request_password_failure": MagicMock(return_value=1),
        "clear_request_password_failures": MagicMock(),
        "captcha_enabled": False,
        "request_password_captcha_threshold": 3,
        "request_password_failure_max": 5,
        "normalize_upload_rel_path": MagicMock(side_effect=lambda p: p),
        "validate_upload_size": MagicMock(),
        "validate_upload_type": MagicMock(),
        "upload_validation_error": UploadValidationError,
        "resolve_request_dir": MagicMock(return_value="/srv/uploads"),
        "safe_join": MagicMock(return_value="/srv/uploads/file.txt"),
        "ensure_unique_path": MagicMock(return_value="/srv/uploads/file.txt"),
        "copy_stream_with_limit": MagicMock(return_value=100),
        "upload_max_bytes": 1024 * 1024,
        "upload_allow_all_exts": False,
        "upload_allowed_exts": {"jpg", "png"},
        "parse_content_range": MagicMock(return_value=None),
        "normalize_chunk_upload_id": MagicMock(side_effect=lambda x: x),
        "load_chunk_upload_meta": MagicMock(return_value=None),
        "save_chunk_upload_meta": MagicMock(),
        "chunk_upload_paths": MagicMock(return_value=("/tmp/meta", "/tmp/part")),
        "upload_session_dirname": ".droppr_sessions",
        "validate_chunk_upload_type": MagicMock(),
        "rate_limit_share_create": "100/hour",
        "rate_limit_uploads": "100/hour",
    }


@pytest.fixture
def requests_app(req_deps):
    app = Flask(__name__)
    app.extensions["limiter"] = MagicMock()
    app.extensions["limiter"].limit = lambda *args, **kwargs: lambda f: f
    
    # Mock require_admin_access
    require_admin = MagicMock(return_value=(None, {"token": "valid-token"}))
    
    bp = create_droppr_requests_blueprint(require_admin, req_deps)
    app.register_blueprint(bp)
    
    return app


@pytest.fixture
def client(requests_app):
    return requests_app.test_client()


def test_create_request_success(client, req_deps):
    payload = {"folder": "/uploads", "hours": 24}
    resp = client.post("/api/droppr/requests", json=payload)
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["hash"] == "req-hash"
    assert data["folder"] == "uploads"
    
    req_deps["create_file_request_record"].assert_called_once()


def test_request_info_public(client, req_deps):
    resp = client.get("/api/droppr/requests/req-hash")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["hash"] == "req-hash"
    assert data["requires_password"] is False


def test_request_info_not_found(client, req_deps):
    req_deps["fetch_file_request"].return_value = None
    resp = client.get("/api/droppr/requests/missing-hash")
    assert resp.status_code == 404


def test_upload_success(client, req_deps):
    # Mock file upload
    data = {
        "file": (io.BytesIO(b"content"), "test.jpg"),
    }
    with patch("os.makedirs"), patch("builtins.open"), patch("os.replace"):
        resp = client.post("/api/droppr/requests/req-hash/upload", data=data)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["name"] == "file.txt"
        
        req_deps["copy_stream_with_limit"].assert_called_once()


def test_upload_password_required(client, req_deps):
    # Enable password on request
    req_deps["fetch_file_request"].return_value = {
        "hash": "req-hash",
        "path": "/uploads",
        "password_hash": "hashed",
        "expires_at": None
    }
    
    # Mock check_password_hash to fail (dependency is not directly injectable via deps dict for check_password_hash?
    # Wait, check_password_hash IS imported in droppr_requests.py, it's NOT in deps.
    # But normalized_request_password IS in deps.
    
    # droppr_requests.py imports check_password_hash from werkzeug.security directly.
    # To mock it, we need to patch it where it is used.
    
    with patch("app.routes.droppr_requests.check_password_hash", return_value=False):
        data = {"file": (io.BytesIO(b"content"), "test.jpg")}
        resp = client.post("/api/droppr/requests/req-hash/upload", data=data)
        assert resp.status_code == 401
        assert "Invalid password" in resp.get_json()["error"]
    
    with patch("app.routes.droppr_requests.check_password_hash", return_value=True):
        # Recreate data because the previous stream was consumed/closed
        data_retry = {"file": (io.BytesIO(b"content"), "test.jpg")}
        # Also need headers
        with patch("os.makedirs"), patch("builtins.open"), patch("os.replace"):
            resp = client.post(
                "/api/droppr/requests/req-hash/upload",
                data=data_retry,
                headers={"X-Request-Password": "correct"}
            )
            assert resp.status_code == 200


def test_upload_chunked_success(client, req_deps):
    req_deps["parse_content_range"].return_value = (0, 9, 200) # 10 bytes
    
    with patch("os.makedirs"), patch("builtins.open"), patch("os.path.exists", return_value=False), patch("os.path.getsize", return_value=0):
        resp = client.post(
            "/api/droppr/requests/req-hash/upload-chunk",
            data=b"chunk data",
            headers={
                "Content-Range": "bytes 0-9/200",
                "Content-Type": "application/octet-stream",
                "X-Upload-Name": "test.dat"
            }
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert "upload_id" in data
        assert data["complete"] is False
        assert data["offset"] == 10


def test_upload_chunked_mismatch(client, req_deps):
    req_deps["parse_content_range"].return_value = (100, 199, 200)
    # Mock session meta for load_chunk_upload_meta
    req_deps["load_chunk_upload_meta"].return_value = {
        "target": "/tmp/target", "total": 200, "rel_path": "test.dat"
    }
    
    with patch("os.path.exists", return_value=True), patch("os.path.getsize", return_value=50), patch("os.makedirs"), patch("os.replace"):
        # We sent offset 100, but file size is 50 -> 409 Conflict
        resp = client.post(
            "/api/droppr/requests/req-hash/upload-chunk",
            data=b"data",
            headers={
                "Content-Range": "bytes 100-199/200",
                "X-Upload-Id": "existing-id"
            }
        )
        assert resp.status_code == 409
        assert resp.get_json()["offset"] == 50


def test_request_expired(client, req_deps):
    req_deps["request_is_expired"].return_value = True
    resp = client.get("/api/droppr/requests/req-hash")
    assert resp.status_code == 410
    assert "Request expired" in resp.get_json()["error"]


def test_upload_captcha_required(client, req_deps):
    req_deps["fetch_file_request"].return_value = {
        "hash": "req-hash",
        "path": "/uploads",
        "password_hash": "hashed",
        "expires_at": None
    }
    req_deps["captcha_required_for_request"].return_value = True
    req_deps["verify_captcha_token"].return_value = False
    
    resp = client.post("/api/droppr/requests/req-hash/upload", data={"file": (io.BytesIO(b"c"), "t.jpg")})
    assert resp.status_code == 403
    assert "Captcha verification required" in resp.get_json()["error"]

