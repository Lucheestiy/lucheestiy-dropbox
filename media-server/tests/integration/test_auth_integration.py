from __future__ import annotations

from unittest.mock import MagicMock, patch
import pytest
from flask import Flask, jsonify

from app.legacy import app as real_app

@pytest.fixture
def client():
    # Use the real app for integration testing of auth logic
    # But we need to mock external dependencies like FileBrowser
    real_app.testing = True
    return real_app.test_client()

def test_admin_access_no_token(client):
    # Endpoint that requires admin access, e.g., /api/droppr/users
    resp = client.get("/api/droppr/users")
    assert resp.status_code == 401
    assert "Missing auth token" in resp.get_json()["error"]

def test_admin_access_invalid_token(client):
    with patch("app.legacy._validate_filebrowser_admin", return_value=401):
        resp = client.get("/api/droppr/users", headers={"X-Auth": "invalid"})
        assert resp.status_code == 401
        assert "Unauthorized" in resp.get_json()["error"]

def test_admin_access_too_many_attempts(client):
    with patch("app.legacy._validate_filebrowser_admin", return_value=429):
        resp = client.get("/api/droppr/users", headers={"X-Auth": "any"})
        assert resp.status_code == 429
        assert "Too many authentication attempts" in resp.get_json()["error"]

def test_admin_access_ip_blocked(client):
    with patch("app.legacy._admin_ip_allowed", return_value=False):
        resp = client.get("/api/droppr/users", headers={"X-Auth": "valid"})
        assert resp.status_code == 403
        assert "Admin access denied" in resp.get_json()["error"]

def test_admin_access_otp_required(client):
    # Mock successful filebrowser auth but OTP enabled and missing
    with patch("app.legacy._validate_filebrowser_admin", return_value=None):
        with patch("app.utils.totp.ADMIN_TOTP_ENABLED", True):
            with patch("app.legacy.ADMIN_TOTP_ENABLED", True):
                with patch("app.legacy._get_totp_code_from_request", return_value=None):
                    resp = client.get("/api/droppr/users", headers={"X-Auth": "valid"})
                    assert resp.status_code == 401
                    assert "OTP required" in resp.get_json()["error"]

def test_admin_access_password_expired(client):
    with patch("app.legacy._validate_filebrowser_admin", return_value=None):
        with patch("app.legacy._admin_password_expired", return_value=True):
            resp = client.get("/api/droppr/users", headers={"X-Auth": "valid"})
            assert resp.status_code == 403
            assert "Admin password expired" in resp.get_json()["error"]
