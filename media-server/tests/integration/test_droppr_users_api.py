from __future__ import annotations

import json
from unittest.mock import MagicMock, patch
import pytest
from flask import Flask

from app.routes.droppr_users import create_droppr_users_blueprint


@pytest.fixture
def mock_services():
    filebrowser_mock = MagicMock()
    filebrowser_mock.create_user.return_value = {
        "id": 1,
        "username": "testuser",
        "scope": "/media/users/testuser"
    }

    services_mock = MagicMock()
    services_mock.filebrowser = filebrowser_mock
    return services_mock


@pytest.fixture
def require_admin():
    def _require_admin():
        return None, {"token": "admin-token"}
    return _require_admin


@pytest.fixture
def app(require_admin):
    app = Flask(__name__)
    bp = create_droppr_users_blueprint(require_admin)
    app.register_blueprint(bp)
    return app


@pytest.fixture
def client(app):
    return app.test_client()


def test_get_users_config_success(client):
    """Test GET /api/droppr/users returns password configuration"""
    resp = client.get("/api/droppr/users")
    assert resp.status_code == 200

    data = resp.get_json()
    assert "root" in data
    assert "username_pattern" in data
    assert "password_min_length" in data
    assert "password_rules" in data

    rules = data["password_rules"]
    assert "min_length" in rules
    assert "require_upper" in rules
    assert "require_lower" in rules
    assert "require_digit" in rules
    assert "require_symbol" in rules
    assert "pwned_check" in rules

    assert resp.headers.get("Cache-Control") == "no-store"


@patch("app.routes.droppr_users.get_services")
@patch("app.routes.droppr_users._ensure_user_directory")
@patch("app.routes.droppr_users._log_audit_event")
def test_create_user_success(mock_audit, mock_ensure_dir, mock_get_services, client, mock_services):
    """Test POST /api/droppr/users successfully creates a user"""
    mock_get_services.return_value = mock_services

    payload = {
        "username": "testuser",
        "password": "SecureP@ss123"
    }

    resp = client.post(
        "/api/droppr/users",
        data=json.dumps(payload),
        content_type="application/json"
    )

    assert resp.status_code == 200
    data = resp.get_json()

    assert data["username"] == "testuser"
    assert data["id"] == 1
    assert "scope" in data
    assert "root" in data
    assert resp.headers.get("Cache-Control") == "no-store"

    mock_ensure_dir.assert_called_once()
    mock_services.filebrowser.create_user.assert_called_once()
    mock_audit.assert_called_once()


@patch("app.routes.droppr_users.get_services")
def test_create_user_missing_username(mock_get_services, client, mock_services):
    """Test POST /api/droppr/users fails with missing username"""
    mock_get_services.return_value = mock_services

    payload = {
        "password": "SecureP@ss123"
    }

    resp = client.post(
        "/api/droppr/users",
        data=json.dumps(payload),
        content_type="application/json"
    )

    assert resp.status_code == 400
    data = resp.get_json()
    assert "error" in data
    assert "username" in data["error"].lower()


@patch("app.routes.droppr_users.get_services")
@patch("app.routes.droppr_users._password_rules_error")
def test_create_user_invalid_password(mock_password_error, mock_get_services, client, mock_services):
    """Test POST /api/droppr/users fails with invalid password"""
    mock_get_services.return_value = mock_services
    mock_password_error.return_value = "Password must be at least 8 characters"

    payload = {
        "username": "testuser",
        "password": "weak"
    }

    resp = client.post(
        "/api/droppr/users",
        data=json.dumps(payload),
        content_type="application/json"
    )

    assert resp.status_code == 400
    data = resp.get_json()
    assert "error" in data
    assert "Password" in data["error"]


@patch("app.routes.droppr_users.get_services")
@patch("app.routes.droppr_users._ensure_user_directory")
def test_create_user_directory_creation_fails(mock_ensure_dir, mock_get_services, client, mock_services):
    """Test POST /api/droppr/users fails when directory creation fails"""
    mock_get_services.return_value = mock_services
    mock_ensure_dir.side_effect = OSError("Permission denied")

    payload = {
        "username": "testuser",
        "password": "SecureP@ss123"
    }

    resp = client.post(
        "/api/droppr/users",
        data=json.dumps(payload),
        content_type="application/json"
    )

    assert resp.status_code == 500
    data = resp.get_json()
    assert "error" in data
    assert "directory" in data["error"].lower()


@patch("app.routes.droppr_users.get_services")
@patch("app.routes.droppr_users._ensure_user_directory")
def test_create_user_already_exists(mock_ensure_dir, mock_get_services, client, mock_services):
    """Test POST /api/droppr/users fails when user already exists"""
    mock_get_services.return_value = mock_services
    mock_services.filebrowser.create_user.side_effect = FileExistsError("User exists")

    payload = {
        "username": "existing",
        "password": "SecureP@ss123"
    }

    resp = client.post(
        "/api/droppr/users",
        data=json.dumps(payload),
        content_type="application/json"
    )

    assert resp.status_code == 409
    data = resp.get_json()
    assert "error" in data
    assert "exists" in data["error"].lower()


@patch("app.routes.droppr_users.get_services")
@patch("app.routes.droppr_users._ensure_user_directory")
def test_create_user_unauthorized(mock_ensure_dir, mock_get_services, client, mock_services):
    """Test POST /api/droppr/users fails when unauthorized"""
    mock_get_services.return_value = mock_services
    mock_services.filebrowser.create_user.side_effect = PermissionError("Unauthorized")

    payload = {
        "username": "testuser",
        "password": "SecureP@ss123"
    }

    resp = client.post(
        "/api/droppr/users",
        data=json.dumps(payload),
        content_type="application/json"
    )

    assert resp.status_code == 401
    data = resp.get_json()
    assert "error" in data


@patch("app.routes.droppr_users.get_services")
@patch("app.routes.droppr_users._ensure_user_directory")
def test_create_user_filebrowser_error(mock_ensure_dir, mock_get_services, client, mock_services):
    """Test POST /api/droppr/users handles FileBrowser API errors"""
    mock_get_services.return_value = mock_services
    mock_services.filebrowser.create_user.side_effect = Exception("API Error")

    payload = {
        "username": "testuser",
        "password": "SecureP@ss123"
    }

    resp = client.post(
        "/api/droppr/users",
        data=json.dumps(payload),
        content_type="application/json"
    )

    assert resp.status_code == 502
    data = resp.get_json()
    assert "error" in data


def test_create_user_alternate_username_fields(client, mock_services):
    """Test POST /api/droppr/users accepts alternate username field names"""
    with patch("app.routes.droppr_users.get_services") as mock_get_services, \
         patch("app.routes.droppr_users._ensure_user_directory"), \
         patch("app.routes.droppr_users._log_audit_event"):

        mock_get_services.return_value = mock_services

        # Test with "user" field
        payload = {"user": "testuser", "password": "SecureP@ss123"}
        resp = client.post("/api/droppr/users", json=payload)
        assert resp.status_code == 200

        # Test with "name" field
        payload = {"name": "testuser2", "password": "SecureP@ss123"}
        resp = client.post("/api/droppr/users", json=payload)
        assert resp.status_code == 200
