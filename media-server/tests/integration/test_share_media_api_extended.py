from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from app.routes.share_media import create_share_media_blueprint


@pytest.fixture
def mock_deps():
    return {
        "is_valid_share_hash": MagicMock(return_value=True),
        "resolve_share_hash": MagicMock(side_effect=lambda h: h),
        "safe_rel_path": MagicMock(side_effect=lambda p: p),
        "video_exts": {"mp4", "mkv"},
        "image_exts": {"jpg", "png"},
        "select_preview_format": MagicMock(return_value=("jpg", "image/jpeg", True)),
        "parse_preview_time": MagicMock(return_value=5.0),
        "normalize_thumb_width": MagicMock(return_value=320),
        "thumb_max_width": 800,
        "get_cache_path": MagicMock(return_value="/tmp/cache.jpg"),
        "thumb_cache_basename": MagicMock(return_value="base"),
        "preview_fallbacks": MagicMock(return_value=["webp"]),
        "r2_thumb_key": MagicMock(return_value="r2key"),
        "maybe_redirect_r2": MagicMock(return_value=None),
        "enqueue_r2_upload_file": MagicMock(),
        "ffmpeg_thumbnail_cmd": MagicMock(return_value=["ffmpeg"]),
        "thumb_sema": MagicMock(),
        "thumb_ffmpeg_timeout_seconds": 30,
        "preview_mimetype": MagicMock(return_value="image/jpeg"),
        "filebrowser_public_dl_api": "http://fb/api/public/dl",
        "normalize_preview_format": MagicMock(return_value="jpg"),
        "ffprobe_video_meta": MagicMock(return_value={"duration": 100}),
        "thumb_multi_default": 3,
        "thumb_multi_max": 10,
        "fetch_public_share_json": MagicMock(
            return_value={"name": "test.mp4", "size": 100, "items": None, "isDir": False}
        ),
        "parse_bool": MagicMock(return_value=False),
        "proxy_cache_key": MagicMock(return_value="proxykey"),
        "r2_proxy_key": MagicMock(return_value="r2proxy"),
        "ensure_fast_proxy_mp4": MagicMock(return_value=("key", "/p.mp4", "/url", 100)),
        "hls_cache_key": MagicMock(return_value="hlskey"),
        "r2_hls_key": MagicMock(return_value="r2hls"),
        "ensure_hls_package": MagicMock(return_value=("key", "/dir", "/url")),
        "proxy_cache_dir": "/tmp/proxy",
        "r2_available_url": MagicMock(return_value=None),
        "hd_cache_key": MagicMock(return_value="hdkey"),
        "hls_cache_dir": "/tmp/hls",
        "enqueue_task": MagicMock(),
        "ensure_hd_mp4": MagicMock(return_value=("key", "/hd.mp4", "/url", 200)),
        "hls_renditions": [],
        "ensure_video_meta_record": MagicMock(
            return_value={
                "path": "test.mp4",
                "status": "ready",
                "action": None,
                "error": None,
                "uploaded_at": 1000,
                "processed_at": 1100,
                "original_size": 100,
                "processed_size": None,
                "original_meta_json": "{}",
                "processed_meta_json": None,
            }
        ),
        "video_transcode_count": None,
        "video_transcode_latency": None,
        "thumbnail_count": None,
    }


@pytest.fixture
def app(mock_deps):
    app = Flask(__name__)
    bp = create_share_media_blueprint(mock_deps)
    app.register_blueprint(bp)
    return app


@pytest.fixture
def client(app):
    return app.test_client()


def test_serve_preview_r2_hit(client, mock_deps):
    from flask import redirect

    mock_deps["maybe_redirect_r2"].return_value = redirect("http://r2/redirect", code=302)
    resp = client.get("/api/share/hash1/preview/test.jpg")
    assert resp.status_code == 302
    assert resp.headers["Location"] == "http://r2/redirect"


def test_serve_preview_cache_hit(client, mock_deps):
    import io

    with patch("os.path.exists", return_value=True):
        with patch("builtins.open", return_value=io.BytesIO(b"fake-image")):
            resp = client.get("/api/share/hash1/preview/test.jpg")
            assert resp.status_code == 200
            assert resp.data == b"fake-image"


def test_share_video_proxy(client, mock_deps):
    resp = client.get("/api/share/hash1/proxy/test.mp4?size=100")
    assert resp.status_code == 302
    assert resp.headers["Location"] == "/url"


def test_share_video_hls(client, mock_deps):
    resp = client.get("/api/share/hash1/hls/test.mp4?size=100")
    assert resp.status_code == 302
    assert resp.headers["Location"] == "/url"


def test_share_video_meta(client, mock_deps):
    resp = client.get("/api/share/hash1/video-meta/test.mp4?size=100")
    assert resp.status_code == 200
    assert resp.get_json()["status"] == "ready"


def test_share_video_sources(client, mock_deps):
    resp = client.get("/api/share/hash1/video-sources/test.mp4?size=100")
    assert resp.status_code == 200
    data = resp.get_json()
    assert "original" in data
    assert "fast" in data
    assert "hls" in data
