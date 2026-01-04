from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from app.routes.droppr_aliases import create_droppr_aliases_blueprint


@pytest.fixture
def mock_admin_auth():
    return MagicMock(return_value=(None, {"user": "admin"}))


@pytest.fixture
def app(mock_admin_auth):
    app = Flask(__name__)
    bp = create_droppr_aliases_blueprint(mock_admin_auth)
    app.register_blueprint(bp)
    return app


@pytest.fixture
def client(app):
    return app.test_client()


def test_list_share_aliases_success(client):
    mock_aliases = [{"id": 1, "alias": "foo"}]
    with patch("app.routes.droppr_aliases._list_share_aliases", return_value=mock_aliases) as mock_list:
        resp = client.get("/api/droppr/shares/aliases?limit=10")
        assert resp.status_code == 200
        assert resp.get_json()["aliases"] == mock_aliases
        mock_list.assert_called_once_with(limit=10)


def test_list_share_aliases_unauthorized(client, mock_admin_auth):
    mock_admin_auth.return_value = (({"error": "Unauthorized"}, 401), None)
    resp = client.get("/api/droppr/shares/aliases")
    assert resp.status_code == 401
    assert "Unauthorized" in resp.get_json()["error"]


def test_list_share_aliases_error(client):
    with patch("app.routes.droppr_aliases._list_share_aliases", side_effect=Exception("DB fail")):
        resp = client.get("/api/droppr/shares/aliases")
        assert resp.status_code == 500
        assert "Failed to list share aliases" in resp.get_json()["error"]
