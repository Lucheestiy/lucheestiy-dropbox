from __future__ import annotations

import io
import subprocess
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from app.routes.droppr_media import create_droppr_media_blueprint


@pytest.fixture
def media_deps():
    return {
        "safe_root_path": MagicMock(side_effect=lambda p: p if p and not p.startswith("..") else None),
        "fetch_filebrowser_resource": MagicMock(return_value={"size": 100, "modified": "2023-01-01"}),
        "ensure_video_meta_record": MagicMock(return_value={
            "path": "/video.mp4",
            "status": "done",
            "action": None,
            "error": None,
            "uploaded_at": None,
            "processed_at": None,
            "original_size": 100,
            "processed_size": 50,
            "original_meta_json": None,
            "processed_meta_json": None,
        }),
        "select_preview_format": MagicMock(return_value=("jpg", "image/jpeg", False)),
        "normalize_thumb_width": MagicMock(return_value=240),
        "thumb_max_width": 800,
        "get_cache_path": MagicMock(return_value="/tmp/thumb.jpg"),
        "thumb_cache_basename": MagicMock(return_value="thumb"),
        "preview_fallbacks": MagicMock(return_value=[]),
        "r2_thumb_key": MagicMock(return_value="thumb.jpg"),
        "maybe_redirect_r2": MagicMock(return_value=None),
        "enqueue_r2_upload_file": MagicMock(),
        "ffmpeg_thumbnail_cmd": MagicMock(return_value=["ffmpeg", "..."]),
        "thumb_sema": MagicMock(),
        "thumb_ffmpeg_timeout_seconds": 10,
        "preview_mimetype": MagicMock(return_value="image/jpeg"),
        "filebrowser_base_url": "http://fb",
        "video_exts": {"mp4", "mov"},
        "image_exts": {"jpg", "png"},
        "parse_bool": MagicMock(return_value=False),
    }


@pytest.fixture
def media_app(media_deps):
    app = Flask(__name__)
    
    # Mock context manager for semaphore
    media_deps["thumb_sema"].__enter__ = MagicMock()
    media_deps["thumb_sema"].__exit__ = MagicMock()
    
    # Mock require_admin_access
    require_admin = MagicMock(return_value=(None, {"token": "valid-token"}))
    
    bp = create_droppr_media_blueprint(require_admin, media_deps)
    app.register_blueprint(bp)
    
    return app


@pytest.fixture
def client(media_app):
    return media_app.test_client()


def test_video_meta_success(client, media_deps):
    resp = client.get("/api/droppr/video-meta?path=/video.mp4")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["path"] == "/video.mp4"
    assert data["status"] == "done"
    
    media_deps["ensure_video_meta_record"].assert_called_once()


def test_video_meta_missing_path(client):
    resp = client.get("/api/droppr/video-meta")
    assert resp.status_code == 400


def test_video_meta_unsupported(client):
    resp = client.get("/api/droppr/video-meta?path=/file.txt")
    assert resp.status_code == 415


def test_preview_success_cache_hit(client, media_deps):
    # Mock file existence
    with patch("os.path.exists", return_value=True):
        with patch("os.utime"):
            with patch("builtins.open", new_callable=MagicMock) as mock_open:
                # Mock read returning bytes
                handle = MagicMock()
                handle.read.return_value = b"image-data"
                mock_open.return_value.__enter__.return_value = handle
                
                resp = client.get("/api/droppr/preview?path=/image.jpg")
                assert resp.status_code == 200
                assert resp.data == b"image-data"
                assert resp.mimetype == "image/jpeg"


def test_preview_generation_success(client, media_deps):
    # Mock cache miss then hit after generation
    # 1. Initial check (False)
    # 2. Inside lock check (False) -> Triggers generation
    # 3. Final check after generation (True)
    with patch("os.path.exists", side_effect=[False, False, True]): 
        with patch("builtins.open", new_callable=MagicMock) as mock_open:
            # Mock file handle for lock and cache read
            handle = MagicMock()
            handle.read.return_value = b"generated-data"
            mock_open.return_value.__enter__.return_value = handle
            
            with patch("fcntl.flock"):
                with patch("subprocess.run") as mock_run:
                    mock_run.return_value = MagicMock(returncode=0)
                    
                    resp = client.get("/api/droppr/preview?path=/video.mp4")
                    assert resp.status_code == 200
                    assert resp.data == b"generated-data"
                    
                    media_deps["ffmpeg_thumbnail_cmd"].assert_called()
                    mock_run.assert_called()


def test_preview_generation_failure(client, media_deps):
    # Mock cache miss and failure
    with patch("os.path.exists", side_effect=[False, False]): # Never exists
        with patch("builtins.open", new_callable=MagicMock):
            with patch("fcntl.flock"):
                with patch("subprocess.run") as mock_run:
                    mock_run.return_value = MagicMock(returncode=1, stderr=b"ffmpeg error")
                    
                    resp = client.get("/api/droppr/preview?path=/video.mp4")
                    assert resp.status_code == 500
                    assert "Thumbnail generation failed" in resp.get_json()["error"]
