from __future__ import annotations

import os
import subprocess
import shutil
from unittest.mock import MagicMock, patch
from botocore.exceptions import ClientError
import pytest
import app.services.media_processing as mp

@pytest.fixture
def mock_fs(monkeypatch, tmp_path):
    monkeypatch.setattr(mp, "PROXY_CACHE_DIR", str(tmp_path / "proxy"))
    monkeypatch.setattr(mp, "HLS_CACHE_DIR", str(tmp_path / "hls"))
    os.makedirs(mp.PROXY_CACHE_DIR, exist_ok=True)
    os.makedirs(mp.HLS_CACHE_DIR, exist_ok=True)
    return tmp_path

def test_ensure_hd_mp4_fallback_logic(mock_fs, monkeypatch):
    monkeypatch.setattr(mp, "_enqueue_r2_upload_file", MagicMock())
    
    # Mock subprocess.run to fail twice then succeed
    results = [
        MagicMock(returncode=1, stderr=b"remux failed"),
        MagicMock(returncode=1, stderr=b"copy failed"),
        MagicMock(returncode=0)
    ]
    mock_run = MagicMock(side_effect=results)
    monkeypatch.setattr(subprocess, "run", mock_run)
    monkeypatch.setattr(os, "replace", MagicMock())
    monkeypatch.setattr(os.path, "getsize", MagicMock(return_value=2048))

    res = mp._ensure_hd_mp4(share_hash="h", file_path="v.mp4", size=100)
    assert res[0] # cache key
    assert mock_run.call_count == 3

def test_ensure_hd_mp4_all_fail(mock_fs, monkeypatch):
    monkeypatch.setattr(mp, "_enqueue_r2_upload_file", MagicMock())
    mock_run = MagicMock(return_value=MagicMock(returncode=1, stderr=b"fatal"))
    monkeypatch.setattr(subprocess, "run", mock_run)
    
    with pytest.raises(RuntimeError, match="HD generation failed"):
        mp._ensure_hd_mp4(share_hash="h", file_path="v.mp4", size=100)

def test_ensure_hls_package_success(mock_fs, monkeypatch):
    monkeypatch.setattr(mp, "_enqueue_r2_upload_hls", MagicMock())
    monkeypatch.setattr(mp, "_ffprobe_video_meta", MagicMock(return_value={"video": {"fps": 30}}))
    monkeypatch.setattr(mp, "HLS_RENDITIONS", [{"height": 360, "video_kbps": 800, "audio_kbps": 96}])
    
    mock_run = MagicMock(return_value=MagicMock(returncode=0))
    monkeypatch.setattr(subprocess, "run", mock_run)
    monkeypatch.setattr(os, "replace", MagicMock())
    monkeypatch.setattr(mp, "_write_hls_master", MagicMock())

    key, out_dir, url = mp._ensure_hls_package(share_hash="h", file_path="v.mp4", size=100)
    assert key
    assert "hls-cache" in url
    mock_run.assert_called_once()

def test_preview_fallbacks():
    assert "jpg" in mp._preview_fallbacks("webp")
    assert "webp" in mp._preview_fallbacks("avif")
    assert mp._preview_fallbacks("jpg") == []

def test_preview_mimetype():
    assert mp._preview_mimetype("webp") == "image/webp"
    assert mp._preview_mimetype("jpg") == "image/jpeg"

def test_r2_keys(monkeypatch):
    monkeypatch.setattr(mp, "R2_PREFIX", "test")
    assert "test/thumbs/" in mp._r2_thumb_key("base", "webp")
    assert "test/proxy/" in mp._r2_proxy_key("key")
    assert "test/hls/" in mp._r2_hls_key("key", "file.m3u8")


def test_r2_object_exists(monkeypatch):
    monkeypatch.setattr(mp, "R2_ENABLED", True)
    mock_client = MagicMock()
    monkeypatch.setattr(mp, "_r2_client", MagicMock(return_value=mock_client))
    
    # Cache miss, then success
    mock_client.head_object.return_value = {}
    assert mp._r2_object_exists("key1") is True
    assert mock_client.head_object.called
    
    # Cache hit
    mock_client.head_object.reset_mock()
    assert mp._r2_object_exists("key1") is True
    assert not mock_client.head_object.called

    # 404
    mock_client.head_object.side_effect = ClientError({"Error": {"Code": "404"}}, "head_object")
    assert mp._r2_object_exists("key2") is False


def test_r2_object_url(monkeypatch):
    monkeypatch.setattr(mp, "R2_ENABLED", True)
    monkeypatch.setattr(mp, "R2_REDIRECT_ENABLED", True)
    monkeypatch.setattr(mp, "R2_PUBLIC_BASE_URL", "https://pub.com")
    assert mp._r2_object_url("key", require_public=True) == "https://pub.com/key"
    
    monkeypatch.setattr(mp, "R2_PUBLIC_BASE_URL", "")
    mock_client = MagicMock()
    monkeypatch.setattr(mp, "_r2_client", MagicMock(return_value=mock_client))
    mock_client.generate_presigned_url.return_value = "https://signed.com/key"
    assert mp._r2_object_url("key", require_public=False) == "https://signed.com/key"


def test_parse_allowed_widths():
    assert mp._parse_allowed_widths("10,20,30") == [10, 20, 30]
    assert mp._parse_allowed_widths("30,10,20,20") == [10, 20, 30]
    assert mp._parse_allowed_widths("abc, 0, -5, 50") == [50]


def test_parse_preview_time():
    assert mp._parse_preview_time("10.5") == 10.5
    assert mp._parse_preview_time(None) is None
    assert mp._parse_preview_time("invalid") is None
    assert mp._parse_preview_time("-1") is None
    assert mp._parse_preview_time("5000") == 3600.0 # max


def test_ffmpeg_thumbnail_cmd():
    cmd = mp._ffmpeg_thumbnail_cmd(src_url="src", dst_path="dst", seek_seconds=5, width=100, fmt="webp")
    assert "ffmpeg" in cmd
    assert "-ss" in cmd
    assert "5" in cmd
    assert "libwebp" in cmd
    assert "scale='min(100,iw)':-2" in cmd
    
    cmd_avif = mp._ffmpeg_thumbnail_cmd(src_url="src", dst_path="dst", seek_seconds=None, fmt="avif")
    assert "libaom-av1" in cmd_avif
    
    cmd_jpg = mp._ffmpeg_thumbnail_cmd(src_url="src", dst_path="dst", seek_seconds=None, headers={"X": "Y"})
    assert "-headers" in cmd_jpg
    assert "X: Y\r\n" in cmd_jpg


def test_maybe_redirect_r2(monkeypatch):
    monkeypatch.setattr(mp, "_r2_object_url", MagicMock(return_value="http://r2/url"))
    monkeypatch.setattr(mp, "_r2_object_exists", MagicMock(return_value=True))
    resp = mp._maybe_redirect_r2("key", require_public=False)
    assert resp.status_code == 302
    assert resp.headers["Location"] == "http://r2/url"
    
    monkeypatch.setattr(mp, "_r2_object_exists", MagicMock(return_value=False))
    assert mp._maybe_redirect_r2("key", require_public=False) is None
