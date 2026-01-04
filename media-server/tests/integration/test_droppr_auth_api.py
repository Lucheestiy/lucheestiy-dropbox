from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from app.routes.droppr_auth import create_droppr_auth_blueprint


@pytest.fixture
def auth_deps():
    return {
        "get_auth_token": MagicMock(return_value="fb-token"),
        "validate_filebrowser_admin": MagicMock(return_value=None),
        "log_auth_event": MagicMock(),
        "admin_totp_enabled": True, # Always enabled for test flexibility
        "get_totp_code_from_request": MagicMock(return_value=None),
        "is_valid_totp": MagicMock(return_value=True),
        "peek_jwt_payload": MagicMock(return_value={"iat": 1600000000}),
        "admin_password_expired": MagicMock(return_value=False),
        "issue_droppr_tokens": MagicMock(return_value={"access_token": "a", "refresh_token": "r"}),
        "get_droppr_refresh_claims": MagicMock(return_value=None),
        "get_refresh_token_record": MagicMock(return_value=None),
        "revoke_refresh_token": MagicMock(),
    }


@pytest.fixture
def app(auth_deps):
    app = Flask(__name__)
    bp = create_droppr_auth_blueprint(auth_deps)
    app.register_blueprint(bp)
    return app


@pytest.fixture
def client(app):
    return app.test_client()


def test_login_success(client, auth_deps):
    # Ensure OTP is valid
    auth_deps["is_valid_totp"].return_value = True
    resp = client.post("/api/droppr/auth/login")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["access_token"] == "a"
    auth_deps["issue_droppr_tokens"].assert_called_once()


def test_login_no_token(client, auth_deps):
    auth_deps["get_auth_token"].return_value = None
    resp = client.post("/api/droppr/auth/login")
    assert resp.status_code == 401
    assert "Missing auth token" in resp.get_json()["error"]


def test_login_otp_required(client, auth_deps):
    auth_deps["is_valid_totp"].return_value = False
    resp = client.post("/api/droppr/auth/login")
    assert resp.status_code == 401
    assert "OTP required" in resp.get_json()["error"]


def test_refresh_success(client, auth_deps):
    auth_deps["get_droppr_refresh_claims"].return_value = {
        "jti": "mock-jti", "fb_token": "fb", "fb_iat": 100, "otp": False
    }
    auth_deps["get_refresh_token_record"].return_value = {"revoked": False}
    
    resp = client.post("/api/droppr/auth/refresh")
    assert resp.status_code == 200
    assert resp.get_json()["access_token"] == "a"
    auth_deps["revoke_refresh_token"].assert_called_once_with("mock-jti")


def test_refresh_revoked(client, auth_deps):
    auth_deps["get_droppr_refresh_claims"].return_value = {"jti": "mock-jti"}
    auth_deps["get_refresh_token_record"].return_value = {"revoked": True}
    
    resp = client.post("/api/droppr/auth/refresh")
    assert resp.status_code == 401
    assert "revoked" in resp.get_json()["error"]


def test_logout(client, auth_deps):
    auth_deps["get_droppr_refresh_claims"].return_value = {"jti": "mock-jti"}
    resp = client.post("/api/droppr/auth/logout")
    assert resp.status_code == 204
    auth_deps["revoke_refresh_token"].assert_called_once_with("mock-jti")
