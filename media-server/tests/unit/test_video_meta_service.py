import json
from unittest.mock import MagicMock, patch
import pytest
import app.services.video_meta as vm

def test_parse_int():
    assert vm._parse_int("123") == 123
    assert vm._parse_int(None) is None
    assert vm._parse_int("abc") is None

def test_parse_iso8601_to_unix():
    assert vm._parse_iso8601_to_unix("2026-01-01T00:00:00Z") == 1767225600
    assert vm._parse_iso8601_to_unix("invalid") is None

def test_extract_ffprobe_meta():
    payload = {
        "streams": [
            {
                "codec_type": "video",
                "width": 1920,
                "height": 1080,
                "codec_name": "h264",
                "avg_frame_rate": "30/1"
            },
            {
                "codec_type": "audio",
                "codec_name": "aac",
                "channels": 2
            }
        ],
        "format": {
            "duration": "10.5",
            "size": "1000000"
        }
    }
    res = vm._extract_ffprobe_meta(payload)
    assert res["duration"] == 10.5
    assert res["video"]["width"] == 1920
    assert res["audio"]["codec"] == "aac"

def test_extract_ffprobe_meta_with_rotation():
    payload = {
        "streams": [
            {
                "codec_type": "video",
                "width": 1920,
                "height": 1080,
                "tags": {"rotate": "90"}
            }
        ]
    }
    res = vm._extract_ffprobe_meta(payload)
    assert res["video"]["display_width"] == 1080
    assert res["video"]["display_height"] == 1920

def test_parse_ratio():
    assert vm._parse_ratio("16:9") == (16.0, 9.0)
    assert vm._parse_ratio("4/3") == (4.0, 3.0)
    assert vm._parse_ratio("invalid") is None


def test_parse_fps():
    assert vm._parse_fps("30000/1001") == 30000 / 1001
    assert vm._parse_fps("25") == 25.0
    assert vm._parse_fps("0/0") is None


def test_sanitize_header_value():
    assert vm._sanitize_header_value("val\r\n") == "val"


@patch("app.services.video_meta._video_meta_conn")
@patch("app.services.video_meta._ffprobe_video_meta")
def test_ensure_video_meta_record(mock_ffprobe, mock_conn_ctx):
    mock_conn = MagicMock()
    mock_conn_ctx.return_value.__enter__.return_value = mock_conn
    
    # Existing record, no refresh needed
    uploaded_at = vm._parse_iso8601_to_unix("2026-01-04T00:00:00Z")
    mock_conn.execute.return_value.fetchone.return_value = {
        "status": "ready",
        "original_size": 100,
        "uploaded_at": uploaded_at,
        "original_meta_json": "{}",
        "processed_meta_json": None
    }
    
    with patch("fcntl.flock"):
        with patch("builtins.open", MagicMock()):
            res = vm._ensure_video_meta_record(
                db_path="path", src_url="url", current_size=100, current_modified="2026-01-04T00:00:00Z"
            )
    assert res["status"] == "ready"
    assert not mock_ffprobe.called

    # Refresh needed
    mock_conn.execute.return_value.fetchone.return_value = None
    mock_ffprobe.return_value = {"duration": 10, "size": 100}
    
    with patch("fcntl.flock"):
        with patch("builtins.open", MagicMock()):
            res = vm._ensure_video_meta_record(
                db_path="path", src_url="url", current_size=100, current_modified=None
            )
    assert mock_ffprobe.called
    assert mock_conn.execute.called # For upsert
