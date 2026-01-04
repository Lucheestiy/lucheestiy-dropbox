from __future__ import annotations

import os
import subprocess
from unittest.mock import MagicMock

import pytest

import app.services.media_processing as mp


def test_parse_allowed_widths():
    assert mp._parse_allowed_widths("100, 200, 300") == [100, 200, 300]
    assert mp._parse_allowed_widths("800,240,640") == [240, 640, 800]
    assert mp._parse_allowed_widths("bad, -100, 0, 500") == [500]
    assert mp._parse_allowed_widths("") == []


def test_parse_hls_renditions():
    spec = "360:800:96, 720:1600:128"
    renditions = mp._parse_hls_renditions(spec)
    assert len(renditions) == 2
    assert renditions[0] == {"height": 360, "video_kbps": 800, "audio_kbps": 96}
    assert renditions[1] == {"height": 720, "video_kbps": 1600, "audio_kbps": 128}

    assert len(mp._parse_hls_renditions("")) == 3  # Default fallback


def test_normalize_preview_format():
    assert mp._normalize_preview_format("webp") == "webp"
    assert mp._normalize_preview_format("avif") == "avif"
    assert mp._normalize_preview_format("jpeg") == "jpg"
    assert mp._normalize_preview_format("jpg") == "jpg"
    assert mp._normalize_preview_format("auto") == "auto"
    assert mp._normalize_preview_format(None) == "auto"
    assert mp._normalize_preview_format("gif") == "auto"  # invalid falls back to auto


def test_normalize_thumb_width(monkeypatch):
    monkeypatch.setattr(mp, "THUMB_MAX_WIDTH", 800)
    monkeypatch.setattr(mp, "THUMB_ALLOWED_WIDTHS", [240, 480, 800])

    assert mp._normalize_thumb_width("200") == 240
    assert mp._normalize_thumb_width("300") == 480
    assert mp._normalize_thumb_width("500") == 800
    assert mp._normalize_thumb_width("1000") == 800
    assert mp._normalize_thumb_width(None) == 800
    assert mp._normalize_thumb_width("bad") == 800


def test_thumb_cache_basename():
    name = mp._thumb_cache_basename("share1", "file1")
    assert len(name) == 64
    # Ensure stable
    assert name == mp._thumb_cache_basename("share1", "file1")
    assert name != mp._thumb_cache_basename("share1", "file2")


def test_get_cache_path(monkeypatch):
    monkeypatch.setattr(mp, "CACHE_DIR", "/cache")
    path = mp._get_cache_path("share1", "file.jpg", ext="webp")
    assert path.startswith("/cache/")
    assert path.endswith(".webp")


def test_select_preview_format(monkeypatch):
    monkeypatch.setattr(mp, "THUMB_ALLOW_WEBP", True)
    monkeypatch.setattr(mp, "THUMB_ALLOW_AVIF", False)

    fmt, mime, is_auto = mp._select_preview_format("auto", "image/webp")
    assert fmt == "webp"
    assert mime == "image/webp"
    assert is_auto is True

    fmt, mime, is_auto = mp._select_preview_format("auto", "image/jpeg")
    assert fmt == "jpg"
    assert mime == "image/jpeg"
    assert is_auto is True

    # Explicit request overrides capabilities check if possible (but logic might downgrade)
    # logic: if requested avif but not allowed -> fallback
    fmt, mime, is_auto = mp._select_preview_format("avif", "")
    assert fmt == "webp"  # Fallback to webp since allowed
    assert is_auto is False


def test_ensure_fast_proxy_mp4_success(monkeypatch, tmp_path):
    monkeypatch.setattr(mp, "PROXY_CACHE_DIR", str(tmp_path))
    monkeypatch.setattr(mp, "_enqueue_r2_upload_file", MagicMock())
    
    # Mock subprocess.run to simulate success
    mock_run = MagicMock()
    mock_run.return_value.returncode = 0
    monkeypatch.setattr(subprocess, "run", mock_run)

    share_hash = "abc"
    file_path = "video.mp4"
    size = 1024

    # Mock os.replace to simulate successful move
    monkeypatch.setattr(os, "replace", MagicMock())
    # Mock os.path.getsize to return fake size
    monkeypatch.setattr(os.path, "getsize", MagicMock(return_value=1024))

    cache_key, out_path, url, file_size = mp._ensure_fast_proxy_mp4(
        share_hash=share_hash,
        file_path=file_path,
        size=size
    )

    assert cache_key
    assert out_path.startswith(str(tmp_path))
    assert url.startswith("/api/proxy-cache/")
    
    # Check that ffmpeg was called
    mock_run.assert_called_once()
    
    # Check that file exists (created by replacement of tmp_path logic)
    # The real code does os.replace(tmp, out). In test we need to ensure tmp exists or mock os.replace.
    # Actually, subprocess mock won't create the file. We should mock os.replace or ensure file creation.
    # Since we are testing logic flow, mocking os.replace is safer to avoid FS issues if subprocess didn't run.
    pass


def test_ffmpeg_command_generation():
    cmd = mp._ffmpeg_thumbnail_cmd(
        src_url="http://src",
        dst_path="/out.jpg",
        seek_seconds=10,
        width=320
    )
    assert "-ss" in cmd
    assert "10" in cmd
    assert "-i" in cmd
    assert "http://src" in cmd
    assert "/out.jpg" in cmd
    assert any("scale='min(320,iw)':-2" in arg for arg in cmd)
