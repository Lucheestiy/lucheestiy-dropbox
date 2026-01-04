from __future__ import annotations

import json
from unittest.mock import MagicMock

import pytest
from flask import Flask

from app.routes.share import create_share_blueprint


@pytest.fixture
def mock_deps():
    return {
        "is_valid_share_hash": MagicMock(return_value=True),
        "resolve_share_hash": MagicMock(side_effect=lambda h: h),
        "parse_bool": MagicMock(side_effect=lambda v: str(v).lower() in ("true", "1", "yes") if v else False),
        "default_cache_ttl_seconds": 60,
        "get_share_files": MagicMock(return_value=[{"name": "test.jpg", "path": "/test.jpg"}]),
        "log_event": MagicMock(),
        "maybe_warm_share_cache": MagicMock(),
        "safe_rel_path": MagicMock(side_effect=lambda p: p),
        "rate_limit_downloads": "1000 per hour",
        "fetch_public_share_json": MagicMock(return_value={"items": []}),
        "filebrowser_public_dl_api": "http://mock-fb/api/public/dl",
        "with_internal_signature": MagicMock(return_value={}),
        "increment_share_alias_download_count": MagicMock(),
        "get_share_alias_meta": MagicMock(return_value={"allow_download": True}),
    }


@pytest.fixture
def app(mock_deps):
    app = Flask(__name__)
    # Mock limiter to avoid setting up redis/storage
    app.extensions["limiter"] = MagicMock()
    app.extensions["limiter"].limit = lambda *args, **kwargs: lambda f: f
    
    bp = create_share_blueprint(mock_deps)
    app.register_blueprint(bp)
    return app


@pytest.fixture
def client(app):
    return app.test_client()


def test_list_share_files_success(client, mock_deps):
    resp = client.get("/api/share/valid-hash/files")
    assert resp.status_code == 200
    data = resp.get_json()
    assert "files" in data
    assert "meta" in data
    assert len(data["files"]) == 1
    assert data["files"][0]["name"] == "test.jpg"
    assert data["meta"]["allow_download"] is True
    
    mock_deps["get_share_files"].assert_called_once()
    mock_deps["log_event"].assert_called_with("gallery_view", "valid-hash")


def test_list_share_files_invalid_hash(client, mock_deps):
    mock_deps["is_valid_share_hash"].return_value = False
    resp = client.get("/api/share/invalid-hash/files")
    assert resp.status_code == 400
    assert "Invalid share hash" in resp.get_json()["error"]


def test_list_share_files_not_found(client, mock_deps):
    mock_deps["get_share_files"].return_value = None
    resp = client.get("/api/share/valid-hash/files")
    assert resp.status_code == 404
    assert "Share not found" in resp.get_json()["error"]


def test_serve_file_redirect(client, mock_deps):
    resp = client.get("/api/share/valid-hash/file/folder/image.jpg")
    assert resp.status_code == 302
    assert resp.headers["Location"] == "/api/public/dl/valid-hash/folder/image.jpg?inline=true"


def test_download_all_redirect(client, mock_deps):
    # Case where fetch_public_share_json returns a single item (not list) -> redirect to file
    mock_deps["fetch_public_share_json"].return_value = {"items": None} # Not a list
    resp = client.get("/api/share/valid-hash/download")
    assert resp.status_code == 302
    assert resp.headers["Location"] == "/api/public/file/valid-hash"
