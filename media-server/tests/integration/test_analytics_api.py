from __future__ import annotations

import sqlite3
import time
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from app.routes.analytics import create_analytics_blueprint
from app.models.analytics import DownloadEvent
from app.services.analytics import _analytics_conn, _ensure_analytics_db


@pytest.fixture
def analytics_app():
    app = Flask(__name__)
    
    # Mock require_admin_access
    require_admin = MagicMock(return_value=(None, {"token": "valid-token"}))
    
    bp = create_analytics_blueprint(require_admin)
    app.register_blueprint(bp)
    
    return app


@pytest.fixture
def client(analytics_app):
    return analytics_app.test_client()


@pytest.fixture
def seed_analytics_db(app_module):
    _ensure_analytics_db()
    with _analytics_conn() as conn:
        conn.execute("DELETE FROM download_events")
        conn.execute("DELETE FROM auth_events")
        
        now = int(time.time())
        
        conn.execute(
            DownloadEvent.__table__.insert(),
            [
                {
                    "share_hash": "hash1",
                    "event_type": "gallery_view",
                    "file_path": None,
                    "ip": "1.2.3.4",
                    "user_agent": "Mozilla",
                    "referer": None,
                    "created_at": now
                },
                {
                    "share_hash": "hash1",
                    "event_type": "file_download",
                    "file_path": "/file1.jpg",
                    "ip": "1.2.3.4",
                    "user_agent": "Mozilla",
                    "referer": None,
                    "created_at": now
                },
                 {
                    "share_hash": "hash2",
                    "event_type": "zip_download",
                    "file_path": None,
                    "ip": "5.6.7.8",
                    "user_agent": "Curl",
                    "referer": None,
                    "created_at": now - 100
                },
            ]
        )
    return now


@patch("app.routes.analytics.get_services")
def test_analytics_config(mock_get_services, client):
    mock_fb = MagicMock()
    mock_fb.fetch_shares.return_value = []
    mock_get_services.return_value.filebrowser = mock_fb
    
    resp = client.get("/api/analytics/config")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["enabled"] is True
    assert "retention_days" in data


@patch("app.routes.analytics.get_services")
def test_analytics_shares(mock_get_services, client, seed_analytics_db):
    mock_fb = MagicMock()
    # Mock shares returned by filebrowser
    mock_fb.fetch_shares.return_value = [
        {"hash": "hash1", "path": "/share1", "username": "alice"},
        {"hash": "hash2", "path": "/share2", "username": "bob"},
    ]
    mock_get_services.return_value.filebrowser = mock_fb
    
    resp = client.get("/api/analytics/shares")
    assert resp.status_code == 200
    data = resp.get_json()
    
    assert len(data["shares"]) >= 2
    
    s1 = next(s for s in data["shares"] if s["hash"] == "hash1")
    assert s1["gallery_views"] == 1
    assert s1["file_downloads"] == 1
    
    s2 = next(s for s in data["shares"] if s["hash"] == "hash2")
    assert s2["zip_downloads"] == 1


@patch("app.routes.analytics.get_services")
def test_analytics_share_detail(mock_get_services, client, seed_analytics_db):
    mock_fb = MagicMock()
    mock_fb.fetch_shares.return_value = [
        {"hash": "hash1", "path": "/share1"},
    ]
    mock_get_services.return_value.filebrowser = mock_fb
    
    resp = client.get("/api/analytics/shares/hash1")
    assert resp.status_code == 200
    data = resp.get_json()
    
    assert data["share"]["hash"] == "hash1"
    assert data["counts"]["gallery_view"] == 1
    assert data["counts"]["file_download"] == 1
    assert len(data["ips"]) == 1
    assert data["ips"][0]["ip"] == "1.2.3.4"
    assert len(data["events"]) == 2


@patch("app.routes.analytics.get_services")
def test_analytics_export_csv(mock_get_services, client, seed_analytics_db):
    mock_fb = MagicMock()
    mock_fb.fetch_shares.return_value = []
    mock_get_services.return_value.filebrowser = mock_fb
    
    resp = client.get("/api/analytics/shares/hash1/export.csv")
    assert resp.status_code == 200
    assert resp.content_type == "text/csv; charset=utf-8"
    
    csv = resp.get_data(as_text=True)
    assert "event_type,file_path,ip" in csv
    assert "gallery_view,,1.2.3.4" in csv
    assert "file_download,/file1.jpg,1.2.3.4" in csv
