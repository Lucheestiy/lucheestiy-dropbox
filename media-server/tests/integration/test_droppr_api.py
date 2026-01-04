from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from app.routes.droppr_auth import create_droppr_auth_blueprint
from app.routes.droppr_users import create_droppr_users_blueprint


@pytest.fixture
def auth_deps():
    return {
        "get_auth_token": MagicMock(return_value="valid-fb-token"),
        "validate_filebrowser_admin": MagicMock(return_value=None),  # None means OK
        "log_auth_event": MagicMock(),
        "admin_totp_enabled": False,
        "get_totp_code_from_request": MagicMock(return_value=None),
        "is_valid_totp": MagicMock(return_value=True),
        "peek_jwt_payload": MagicMock(return_value={"iat": 123}),
        "admin_password_expired": MagicMock(return_value=False),
        "issue_droppr_tokens": MagicMock(return_value={"token": "access", "refresh_token": "refresh"}),
        "get_droppr_refresh_claims": MagicMock(return_value={"jti": "jti-1", "fb_token": "fb-tok", "fb_iat": 123}),
        "get_refresh_token_record": MagicMock(return_value={"revoked": False}),
        "revoke_refresh_token": MagicMock(),
    }


@pytest.fixture
def app(auth_deps):
    app = Flask(__name__)
    
    # Auth Blueprint
    auth_bp = create_droppr_auth_blueprint(auth_deps)
    app.register_blueprint(auth_bp)
    
    # Users Blueprint
    # require_admin_access returns (error_response, auth_dict)
    require_admin = MagicMock(return_value=(None, {"token": "valid-token"}))
    users_bp = create_droppr_users_blueprint(require_admin)
    app.register_blueprint(users_bp)
    
    return app


@pytest.fixture
def client(app):
    return app.test_client()


def test_auth_login_success(client, auth_deps):
    resp = client.post("/api/droppr/auth/login")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["token"] == "access"
    
    auth_deps["validate_filebrowser_admin"].assert_called_with("valid-fb-token")
    auth_deps["issue_droppr_tokens"].assert_called_once()


def test_auth_login_unauthorized(client, auth_deps):
    # validate_filebrowser_admin returns status code on error
    auth_deps["validate_filebrowser_admin"].return_value = 401
    
    resp = client.post("/api/droppr/auth/login")
    assert resp.status_code == 401
    assert "Unauthorized" in resp.get_json()["error"]


def test_auth_refresh_success(client, auth_deps):
    resp = client.post("/api/droppr/auth/refresh")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["token"] == "access"
    
    auth_deps["revoke_refresh_token"].assert_called_with("jti-1")
    auth_deps["issue_droppr_tokens"].assert_called_once()


def test_auth_refresh_revoked(client, auth_deps):
    auth_deps["get_refresh_token_record"].return_value = {"revoked": True}
    
    resp = client.post("/api/droppr/auth/refresh")
    assert resp.status_code == 401
    assert "revoked" in resp.get_json()["error"]


def test_users_get_config(client):
    resp = client.get("/api/droppr/users")
    assert resp.status_code == 200
    data = resp.get_json()
    assert "username_pattern" in data
    assert "password_rules" in data


@patch("app.routes.droppr_users.get_services")
@patch("app.routes.droppr_users._ensure_user_directory")
def test_users_create_success(mock_ensure_dir, mock_get_services, client):
    mock_fb = MagicMock()
    mock_fb.create_user.return_value = {"id": 10}
    mock_services = MagicMock()
    mock_services.filebrowser = mock_fb
    mock_get_services.return_value = mock_services
    
    payload = {"username": "newuser", "password": "Password123!"}
    
    # We need to mock validation inside droppr_users or pass valid data according to rules
    # The rules are imported from services.users, but we can't easily mock them via patch 
    # if they are imported directly in the module scope.
    # However, "Password123!" should satisfy default rules (8 chars, upper, lower, digit, symbol).
    
    resp = client.post("/api/droppr/users", json=payload)
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["username"] == "newuser"
    assert data["id"] == 10
    
    mock_fb.create_user.assert_called_once()


@patch("app.routes.droppr_users.get_services")
@patch("app.routes.droppr_users._ensure_user_directory")
def test_users_create_exists(mock_ensure_dir, mock_get_services, client):
    mock_fb = MagicMock()
    mock_fb.create_user.side_effect = FileExistsError("Exists")
    mock_services = MagicMock()
    mock_services.filebrowser = mock_fb
    mock_get_services.return_value = mock_services
    
    payload = {"username": "newuser", "password": "Password123!"}
    resp = client.post("/api/droppr/users", json=payload)
    assert resp.status_code == 409
    assert "already exists" in resp.get_json()["error"]
