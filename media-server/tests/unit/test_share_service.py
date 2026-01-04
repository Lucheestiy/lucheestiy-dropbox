from __future__ import annotations

import pytest
from unittest.mock import patch, MagicMock

import app.services.share as share_service

def test_infer_gallery_type():
    assert share_service._infer_gallery_type({"type": "image"}, "txt") == "image"
    assert share_service._infer_gallery_type({"type": "video"}, "txt") == "video"
    assert share_service._infer_gallery_type({}, "jpg") == "image"
    assert share_service._infer_gallery_type({}, "mp4") == "video"
    assert share_service._infer_gallery_type({}, "pdf") == "file"

@patch("app.services.share._fetch_public_share_json")
def test_build_folder_share_file_list(mock_fetch):
    root = {
        "items": [
            {"isDir": False, "path": "/photo.jpg", "name": "photo.jpg", "size": 100, "extension": ".jpg"},
            {"isDir": True, "path": "/folder1", "name": "folder1"},
        ]
    }
    
    # Non-recursive
    res = share_service._build_folder_share_file_list(
        request_hash="req1", source_hash="src1", root=root, recursive=False
    )
    assert len(res) == 1
    assert res[0]["name"] == "photo.jpg"
    assert res[0]["type"] == "image"
    assert "download_url" in res[0]
    
    # Recursive
    mock_fetch.return_value = {
        "items": [
            {"isDir": False, "path": "/folder1/sub.mp4", "name": "sub.mp4", "size": 200, "extension": ".mp4"},
        ]
    }
    res_rec = share_service._build_folder_share_file_list(
        request_hash="req1", source_hash="src1", root=root, recursive=True
    )
    assert len(res_rec) == 2
    assert any(item["name"] == "sub.mp4" for item in res_rec)
    mock_fetch.assert_called_with("src1", subpath="/folder1")

def test_build_file_share_file_list():
    meta = {
        "path": "/video.mov",
        "name": "video.mov",
        "extension": ".mov",
        "size": 500
    }
    res = share_service._build_file_share_file_list(
        request_hash="req1", source_hash="src1", meta=meta
    )
    assert len(res) == 1
    assert res[0]["name"] == "video.mov"
    assert res[0]["type"] == "video"
    assert res[0]["download_url"] == "/api/share/req1/download"
