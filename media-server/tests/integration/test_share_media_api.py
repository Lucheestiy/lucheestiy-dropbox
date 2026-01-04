from __future__ import annotations

import json
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
        "video_exts": {"mp4", "mkv", "mov"},
        "image_exts": {"jpg", "jpeg", "png"},
        "select_preview_format": MagicMock(return_value=("jpg", "image/jpeg", True)),
        "parse_preview_time": MagicMock(return_value=1.0),
        "normalize_thumb_width": MagicMock(side_effect=lambda w: int(w) if w else 400),
        "thumb_max_width": 1200,
        "get_cache_path": MagicMock(return_value="/tmp/mock_cache.jpg"),
        "thumb_cache_basename": MagicMock(return_value="mock_base"),
        "preview_fallbacks": MagicMock(return_value=[]),
        "r2_thumb_key": MagicMock(return_value="r2/thumb"),
        "maybe_redirect_r2": MagicMock(return_value=None),
        "enqueue_r2_upload_file": MagicMock(),
        "ffmpeg_thumbnail_cmd": MagicMock(return_value=["ffmpeg"]),
        "thumb_sema": MagicMock(),
        "thumb_ffmpeg_timeout_seconds": 30,
        "preview_mimetype": MagicMock(return_value="image/jpeg"),
        "filebrowser_public_dl_api": "http://mock-fb/api/public/dl",
        "normalize_preview_format": MagicMock(side_effect=lambda f: f or "auto"),
        "ffprobe_video_meta": MagicMock(return_value={"duration": 100.0}),
        "thumb_multi_default": 3,
        "thumb_multi_max": 10,
        "fetch_public_share_json": MagicMock(return_value={"name": "test.mp4", "size": 1000, "path": "/test.mp4"}),
        "parse_bool": MagicMock(side_effect=lambda v: str(v).lower() in ("true", "1", "yes") if v else False),
        "proxy_cache_key": MagicMock(return_value="proxy_key"),
        "r2_proxy_key": MagicMock(return_value="r2/proxy"),
        "ensure_fast_proxy_mp4": MagicMock(return_value=("key", "/path", "/api/proxy/key.mp4", 500)),
        "hls_cache_key": MagicMock(return_value="hls_key"),
        "r2_hls_key": MagicMock(return_value="r2/hls"),
        "ensure_hls_package": MagicMock(return_value=("key", "/path", "/api/hls/key/master.m3u8")),
        "proxy_cache_dir": "/tmp/proxy",
        "r2_available_url": MagicMock(return_value=None),
        "hd_cache_key": MagicMock(return_value="hd_key"),
        "hls_cache_dir": "/tmp/hls",
        "enqueue_task": MagicMock(return_value=True),
        "ensure_hd_mp4": MagicMock(return_value=("key", "/path", "/api/proxy/hd_key.mp4", 1000)),
        "hls_renditions": [{"height": 720, "video_kbps": 2500, "audio_kbps": 128}],
        "ensure_video_meta_record": MagicMock(return_value={
            "status": "ready",
            "action": None,
            "error": None,
            "uploaded_at": 1600000000,
            "processed_at": 1600000001,
            "original_size": 1000,
            "processed_size": 800,
            "original_meta_json": '{"width": 1920, "height": 1080}',
            "processed_meta_json": '{"width": 1280, "height": 720}',
        }),
        "video_transcode_count": MagicMock(),
        "video_transcode_latency": MagicMock(),
        "thumbnail_count": MagicMock(),
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


def test_serve_preview_image_cached(client, mock_deps):
    with patch("os.path.exists", return_value=True):
        with patch("builtins.open", MagicMock()):
            resp = client.get("/api/share/hash/preview/image.jpg")
            assert resp.status_code == 200
            mock_deps["thumbnail_count"].labels.assert_called_with("hit")


def test_serve_preview_video_generate(client, mock_deps):
    with patch("os.path.exists", side_effect=[False, False, True]):  # cache miss, lock check miss, success check
        with patch("builtins.open", MagicMock()):
            with patch("fcntl.flock", MagicMock()):
                with patch("subprocess.run") as mock_run:
                    mock_run.return_value = MagicMock(returncode=0)
                    resp = client.get("/api/share/hash/preview/video.mp4")
                    assert resp.status_code == 200
                    mock_deps["thumbnail_count"].labels.assert_any_call("miss")
                    mock_deps["thumbnail_count"].labels.assert_any_call("success")


def test_share_video_thumbnails(client, mock_deps):
    resp = client.get("/api/share/hash/thumbnails/video.mp4?count=2")
    assert resp.status_code == 200
    data = resp.get_json()
    assert "thumbnails" in data
    assert len(data["thumbnails"]) == 2


def test_serve_proxy_redirect(client, mock_deps):
    resp = client.get("/api/share/hash/proxy/video.mp4")
    assert resp.status_code == 302
    assert resp.headers["Location"] == "/api/proxy/key.mp4"


def test_serve_hls_redirect(client, mock_deps):
    resp = client.get("/api/share/hash/hls/video.mp4")
    assert resp.status_code == 302
    assert resp.headers["Location"] == "/api/hls/key/master.m3u8"


def test_video_sources(client, mock_deps):
    resp = client.get("/api/share/hash/video-sources/video.mp4")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["path"] == "video.mp4"
    assert "fast" in data
    assert "hd" in data
    assert "hls" in data


def test_share_video_meta(client, mock_deps):
    resp = client.get("/api/share/hash/video-meta/video.mp4")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["status"] == "ready"
    assert data["recorded"] is True
    assert data["original"]["width"] == 1920
