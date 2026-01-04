from __future__ import annotations

import io
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


def test_write_hls_master(tmp_path):
    master_path = tmp_path / "master.m3u8"
    renditions = [
        {"height": 360, "video_kbps": 800, "audio_kbps": 96, "dir_name": "360p"},
        {"height": 720, "video_kbps": 1600, "audio_kbps": 128, "dir_name": "720p"},
    ]
    mp._write_hls_master(str(master_path), renditions)
    content = master_path.read_text()
    assert "#EXTM3U" in content
    assert 'BANDWIDTH=896000,NAME="360p"' in content
    assert "360p/stream.m3u8" in content


def test_thumb_cache_basename():
    name1 = mp._thumb_cache_basename("h1", "f1")
    name2 = mp._thumb_cache_basename("h1", "f1")
    name3 = mp._thumb_cache_basename("h2", "f1")
    assert name1 == name2
    assert name1 != name3


def test_select_preview_format():
    # Returns (format, mimetype, vary_accept)
    assert mp._select_preview_format("webp", "") == ("webp", "image/webp", False)
    assert mp._select_preview_format("auto", "image/webp") == ("webp", "image/webp", True)
    assert mp._select_preview_format("auto", "") == ("jpg", "image/jpeg", True)


def test_copy_stream_with_limit_error():
    src = io.BytesIO(b"too much data")
    dst = io.BytesIO()
    from app.utils.validation import UploadValidationError, _copy_stream_with_limit

    with pytest.raises(UploadValidationError, match="exceeds the maximum"):
        _copy_stream_with_limit(src, dst, max_bytes=5)


def test_ffmpeg_hls_cmd():
    cmd = mp._ffmpeg_hls_cmd(
        src_url="src", out_dir="out", height=720, video_kbps=1000, audio_kbps=128, fps=24
    )
    assert "ffmpeg" in cmd
    assert "720" in str(cmd)
    assert "1000k" in cmd
    assert "128k" in cmd


def test_ffmpeg_proxy_cmd():
    cmd = mp._ffmpeg_proxy_cmd(src_url="src", dst_path="dst")
    assert "ffmpeg" in cmd
    assert "libx264" in cmd
    assert "+faststart" in cmd


def test_ffmpeg_hd_remux_cmd():
    cmd = mp._ffmpeg_hd_remux_cmd(src_url="src", dst_path="dst")
    assert "ffmpeg" in cmd
    assert "copy" in cmd


def test_ensure_fast_proxy_mp4_hit(mock_fs, monkeypatch):
    monkeypatch.setattr(mp, "_enqueue_r2_upload_file", MagicMock())
    cache_key = mp._proxy_cache_key(share_hash="h", file_path="v.mp4", size=100)
    output_path = os.path.join(mp.PROXY_CACHE_DIR, f"{cache_key}.mp4")
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "wb") as f:
        f.write(b"data")

    res = mp._ensure_fast_proxy_mp4(share_hash="h", file_path="v.mp4", size=100)
    assert res[0] == cache_key
    assert res[3] == 4


def test_ensure_hd_mp4_hit(mock_fs, monkeypatch):
    monkeypatch.setattr(mp, "_enqueue_r2_upload_file", MagicMock())
    cache_key = mp._hd_cache_key(share_hash="h", file_path="v.mp4", size=100)
    output_path = os.path.join(mp.PROXY_CACHE_DIR, f"{cache_key}.mp4")
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "wb") as f:
        f.write(b"hd-data")

    res = mp._ensure_hd_mp4(share_hash="h", file_path="v.mp4", size=100)
    assert res[0] == cache_key
    assert res[3] == 7


def test_r2_upload_hls_package(monkeypatch, tmp_path):
    monkeypatch.setattr(mp, "R2_ENABLED", True)
    monkeypatch.setattr(mp, "R2_UPLOAD_ENABLED", True)
    mock_client = MagicMock()
    monkeypatch.setattr(mp, "_r2_client", MagicMock(return_value=mock_client))
    monkeypatch.setattr(mp, "_r2_object_exists", MagicMock(return_value=False))

    hls_dir = tmp_path / "hls_pkg"
    hls_dir.mkdir()
    (hls_dir / "stream.m3u8").write_text("playlist")
    (hls_dir / "seg_0001.ts").write_bytes(b"segment")

    res = mp._r2_upload_hls_package("cache-key", str(hls_dir))
    assert res is True
    assert mock_client.upload_file.call_count == 2
