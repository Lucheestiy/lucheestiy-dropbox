from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from app.routes.droppr_shares import create_droppr_shares_blueprint


@pytest.fixture
def mock_admin():
    return MagicMock(return_value=(None, {"token": "mock-token"}))


@pytest.fixture
def app(mock_admin):
    app = Flask(__name__)
    bp = create_droppr_shares_blueprint(mock_admin)
    app.register_blueprint(bp)
    return app


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def mock_services():
    services = MagicMock()
    services.filebrowser.fetch_public_share_json.return_value = {"path": "/test/path"}
    services.filebrowser.create_share.return_value = {"hash": "new-hash", "expire": 1700000000}
    return services


def test_update_share_expire_success(client, mock_admin, mock_services):
    with patch("app.routes.droppr_shares.get_services", return_value=mock_services):
        with patch("app.routes.droppr_shares._resolve_share_hash", return_value="source-hash"):
            with patch("app.routes.droppr_shares._upsert_share_alias") as mock_upsert:
                with patch("app.routes.droppr_shares.clear_share_cache") as mock_clear:
                    resp = client.post("/api/droppr/shares/valid-hash/expire", 
                                       data=json.dumps({"hours": 24, "path": "/test/path"}),
                                       content_type="application/json")
                    
                    assert resp.status_code == 200
                    data = resp.get_json()
                    assert data["hash"] == "valid-hash"
                    assert data["target_hash"] == "new-hash"
                    assert data["hours"] == 24
                    
                    mock_upsert.assert_called_once()
                    mock_clear.assert_called_once_with("valid-hash")


def test_update_share_expire_invalid_hash(client, mock_admin):
    with patch("app.routes.droppr_shares.is_valid_share_hash", return_value=False):
        resp = client.post("/api/droppr/shares/invalid-hash/expire", 
                           data=json.dumps({"hours": 24}),
                           content_type="application/json")
        assert resp.status_code == 400
        assert "Invalid share hash" in resp.get_json()["error"]


def test_update_share_expire_missing_hours(client, mock_admin):
    resp = client.post("/api/droppr/shares/valid-hash/expire", 
                       data=json.dumps({}),
                       content_type="application/json")
    assert resp.status_code == 400
    assert "Missing parameters to update" in resp.get_json()["error"]


def test_update_share_expire_unauthorized(client, mock_admin):
    mock_admin.return_value = (({"error": "Unauthorized"}, 401), None)
    resp = client.post("/api/droppr/shares/valid-hash/expire", 
                       data=json.dumps({"hours": 24}),
                       content_type="application/json")
    assert resp.status_code == 401
