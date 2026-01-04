from __future__ import annotations

import pytest
import time
from flask import Flask

from app.routes.seo import seo_bp


@pytest.fixture
def app():
    app = Flask(__name__)
    app.register_blueprint(seo_bp)
    return app


@pytest.fixture
def client(app):
    return app.test_client()


def test_sitemap_xml_returns_valid_xml(client):
    """Test /sitemap.xml returns valid XML sitemap"""
    resp = client.get("/sitemap.xml")

    assert resp.status_code == 200
    assert resp.mimetype == "application/xml"
    assert b'<?xml version="1.0" encoding="UTF-8"?>' in resp.data
    assert b"<urlset" in resp.data
    assert b"http://www.sitemaps.org/schemas/sitemap/0.9" in resp.data


def test_sitemap_includes_all_public_pages(client):
    """Test sitemap includes all public pages"""
    resp = client.get("/sitemap.xml")
    data = resp.data.decode("utf-8")

    # Check for main pages
    assert "request.html" in data
    assert "gallery.html" in data
    assert "stream-gallery.html" in data
    assert "video-player.html" in data


def test_sitemap_includes_required_elements(client):
    """Test sitemap includes required elements for each URL"""
    resp = client.get("/sitemap.xml")
    data = resp.data.decode("utf-8")

    # Each URL should have these elements
    assert "<loc>" in data
    assert "<lastmod>" in data
    assert "<changefreq>" in data
    assert "<priority>" in data


def test_sitemap_has_valid_priorities(client):
    """Test sitemap has valid priority values"""
    resp = client.get("/sitemap.xml")
    data = resp.data.decode("utf-8")

    # Homepage should have highest priority
    assert "<priority>1.0</priority>" in data

    # Other pages should have lower priorities
    assert "<priority>0.9</priority>" in data
    assert "<priority>0.8</priority>" in data
    assert "<priority>0.7</priority>" in data


def test_sitemap_includes_active_share_aliases(client, monkeypatch):
    """Active share aliases should appear in the sitemap"""
    now = int(time.time())
    alias = {
        "from_hash": "share123",
        "to_hash": "target123",
        "path": "/media",
        "target_expire": now + 1200,
        "download_limit": None,
        "download_count": 0,
        "allow_download": True,
        "created_at": now - 60,
        "updated_at": now,
    }

    monkeypatch.setattr("app.routes.seo._list_share_aliases", lambda limit: [alias])

    resp = client.get("/sitemap.xml")
    data = resp.data.decode("utf-8")

    assert "gallery.html#share123" in data
    assert "<priority>0.5</priority>" in data


def test_sitemap_excludes_expired_share_aliases(client, monkeypatch):
    """Expired share aliases should not appear in the sitemap"""
    now = int(time.time())
    alias = {
        "from_hash": "expired-share",
        "to_hash": "target-expired",
        "path": "/media",
        "target_expire": now - 10,
        "download_limit": None,
        "download_count": 0,
        "allow_download": True,
        "created_at": now - 120,
        "updated_at": now - 10,
    }

    monkeypatch.setattr("app.routes.seo._list_share_aliases", lambda limit: [alias])

    resp = client.get("/sitemap.xml")
    data = resp.data.decode("utf-8")

    assert "gallery.html#expired-share" not in data


def test_share_preview_image_active(client, monkeypatch):
    """Active share should serve a PNG preview"""
    alias = {
        "from_hash": "share123",
        "to_hash": "target123",
        "path": "/media",
        "target_expire": int(time.time()) + 3600,
        "download_limit": 5,
        "download_count": 2,
        "allow_download": True,
        "created_at": int(time.time()) - 600,
        "updated_at": int(time.time()),
    }

    monkeypatch.setattr("app.routes.seo._resolve_share_hash", lambda _: "target123")
    monkeypatch.setattr("app.routes.seo._get_share_alias_meta", lambda _: alias)

    resp = client.get("/og/share/share123.png")
    assert resp.status_code == 200
    assert resp.mimetype == "image/png"
    assert "Cache-Control" in resp.headers
    assert "max-age=7200" in resp.headers["Cache-Control"]


def test_share_preview_image_webp_preference(client, monkeypatch):
    """Share image requests preferring WebP should return WebP"""
    alias = {
        "from_hash": "share123",
        "to_hash": "target123",
        "path": "/media",
        "target_expire": int(time.time()) + 3600,
        "download_limit": 5,
        "download_count": 2,
        "allow_download": True,
        "created_at": int(time.time()) - 600,
        "updated_at": int(time.time()),
    }

    monkeypatch.setattr("app.routes.seo._resolve_share_hash", lambda _: "target123")
    monkeypatch.setattr("app.routes.seo._get_share_alias_meta", lambda _: alias)

    resp = client.get("/og/share/share123.png", headers={"Accept": "image/webp"})
    assert resp.status_code == 200
    assert resp.mimetype == "image/webp"
    assert "Cache-Control" in resp.headers
    assert "max-age=7200" in resp.headers["Cache-Control"]


def test_share_preview_image_inactive(client, monkeypatch):
    """Inactive share should be rejected"""
    monkeypatch.setattr("app.routes.seo._resolve_share_hash", lambda _: None)

    resp = client.get("/og/share/expired.png")
    assert resp.status_code == 404


def test_sitemap_has_cache_headers(client):
    """Test sitemap has appropriate cache headers"""
    resp = client.get("/sitemap.xml")

    assert "Cache-Control" in resp.headers
    assert "public" in resp.headers["Cache-Control"]
    assert "max-age=3600" in resp.headers["Cache-Control"]


def test_robots_txt_returns_plain_text(client):
    """Test /robots.txt returns plain text"""
    resp = client.get("/robots.txt")

    assert resp.status_code == 200
    assert resp.mimetype == "text/plain"


def test_robots_txt_disallows_api_paths(client):
    """Test robots.txt disallows API and private paths"""
    resp = client.get("/robots.txt")
    data = resp.data.decode("utf-8")

    # Should disallow private paths
    assert "Disallow: /api/" in data
    assert "Disallow: /files/" in data
    assert "Disallow: /settings/" in data
    assert "Disallow: /users/" in data
    assert "Disallow: /analytics/" in data
    assert "Disallow: /metrics" in data
    assert "Disallow: /health" in data


def test_robots_txt_allows_public_pages(client):
    """Test robots.txt allows public pages"""
    resp = client.get("/robots.txt")
    data = resp.data.decode("utf-8")

    # Should allow public pages
    assert "Allow: /gallery.html" in data
    assert "Allow: /request.html" in data
    assert "Allow: /video-player.html" in data
    assert "Allow: /stream-gallery.html" in data
    assert "Allow: /static/" in data


def test_robots_txt_includes_sitemap_reference(client):
    """Test robots.txt includes sitemap URL"""
    resp = client.get("/robots.txt")
    data = resp.data.decode("utf-8")

    assert "Sitemap: https://dropbox.lucheestiy.com/sitemap.xml" in data


def test_robots_txt_has_crawl_delay(client):
    """Test robots.txt specifies crawl delay"""
    resp = client.get("/robots.txt")
    data = resp.data.decode("utf-8")

    assert "Crawl-delay: 10" in data


def test_robots_txt_has_bot_specific_rules(client):
    """Test robots.txt has rules for specific bots"""
    resp = client.get("/robots.txt")
    data = resp.data.decode("utf-8")

    # Should have rules for specific bots
    assert "User-agent: Googlebot" in data
    assert "User-agent: Googlebot-Image" in data
    assert "User-agent: Bingbot" in data
    assert "User-agent: AhrefsBot" in data
    assert "User-agent: SemrushBot" in data


def test_robots_txt_slows_aggressive_scrapers(client):
    """Test robots.txt has higher crawl delay for aggressive scrapers"""
    resp = client.get("/robots.txt")
    data = resp.data.decode("utf-8")

    # Aggressive scrapers should have higher crawl delay
    lines = data.split("\n")

    # Find sections for aggressive scrapers
    ahrefsbot_section = []
    semrushbot_section = []

    current_agent = None
    for line in lines:
        if "User-agent: AhrefsBot" in line:
            current_agent = "ahrefs"
        elif "User-agent: SemrushBot" in line:
            current_agent = "semrush"
        elif line.startswith("User-agent:"):
            current_agent = None

        if current_agent == "ahrefs":
            ahrefsbot_section.append(line)
        elif current_agent == "semrush":
            semrushbot_section.append(line)

    # Both should have Crawl-delay: 30
    assert any("Crawl-delay: 30" in line for line in ahrefsbot_section)
    assert any("Crawl-delay: 30" in line for line in semrushbot_section)


def test_robots_txt_has_cache_headers(client):
    """Test robots.txt has appropriate cache headers"""
    resp = client.get("/robots.txt")

    assert "Cache-Control" in resp.headers
    assert "public" in resp.headers["Cache-Control"]
    assert "max-age=86400" in resp.headers["Cache-Control"]
