import json
import time
from unittest.mock import MagicMock, patch
import pytest

def test_build_folder_share_file_list(app_module, monkeypatch):
    root = {
        "items": [
            {"isDir": True, "path": "/nested"},
            {"isDir": False, "path": "/photo.jpg", "name": "photo.jpg", "extension": ".jpg", "size": 10},
        ]
    }

    def fake_fetch(share_hash, subpath=None):
        assert subpath == "/nested"
        return {
            "items": [
                {"isDir": False, "path": "/nested/clip.mp4", "name": "clip.mp4", "extension": ".mp4", "size": 20}
            ]
        }

    import app.services.share as share_service
    import app.services.filebrowser as filebrowser_service
    # Patch in both places to be safe
    monkeypatch.setattr(share_service, "_fetch_public_share_json", fake_fetch)
    monkeypatch.setattr(filebrowser_service, "_fetch_public_share_json", fake_fetch)
    
    files = share_service._build_folder_share_file_list(
        request_hash="req", source_hash="src", root=root, recursive=True
    )
    assert {item["name"] for item in files} == {"photo.jpg", "clip.mp4"}


def test_get_share_files_caches_in_memory(app_module, monkeypatch):
    root = {
        "items": [
            {"isDir": False, "path": "/photo.jpg", "name": "photo.jpg", "extension": ".jpg", "size": 10}
        ]
    }
    calls = {"count": 0}

    def fake_fetch(share_hash, subpath=None):
        calls["count"] += 1
        return root

    import app.services.filebrowser as filebrowser_service
    # Must patch app_module (app.legacy) directly because it imported the function
    monkeypatch.setattr(app_module, "_fetch_public_share_json", fake_fetch)
    monkeypatch.setattr(filebrowser_service, "_fetch_public_share_json", fake_fetch)
    
    app_module._share_files_cache.clear()

    files_first = app_module._get_share_files(
        "req",
        source_hash="src",
        force_refresh=False,
        max_age_seconds=app_module.DEFAULT_CACHE_TTL_SECONDS,
        recursive=False,
    )
    files_second = app_module._get_share_files(
        "req",
        source_hash="src",
        force_refresh=False,
        max_age_seconds=app_module.DEFAULT_CACHE_TTL_SECONDS,
        recursive=False,
    )

    assert calls["count"] == 1
    assert files_first == files_second


def test_redis_share_cache_get_hit():
    import app.services.cache as cache
    mock_client = MagicMock()
    payload = {
        "source_hash": "src",
        "recursive": True,
        "created_at": time.time(),
        "files": [{"name": "test.jpg"}]
    }
    mock_client.get.return_value = json.dumps(payload)
    
    with patch("app.services.cache._get_redis_client", return_value=mock_client):
        res = cache._redis_share_cache_get("req", source_hash="src", recursive=True, max_age_seconds=60)
        assert res == [{"name": "test.jpg"}]


def test_redis_share_cache_get_expired():
    import app.services.cache as cache
    mock_client = MagicMock()
    payload = {
        "source_hash": "src",
        "recursive": True,
        "created_at": time.time() - 100,
        "files": [{"name": "test.jpg"}]
    }
    mock_client.get.return_value = json.dumps(payload)
    
    with patch("app.services.cache._get_redis_client", return_value=mock_client):
        res = cache._redis_share_cache_get("req", source_hash="src", recursive=True, max_age_seconds=60)
        assert res is None


def test_redis_share_cache_set():
    import app.services.cache as cache
    mock_client = MagicMock()
    
    with patch("app.services.cache._get_redis_client", return_value=mock_client):
        cache._redis_share_cache_set("req", source_hash="src", recursive=True, files=[{"name": "t"}], ttl_seconds=60)
        mock_client.setex.assert_called_once()


def test_redis_share_cache_delete():
    import app.services.cache as cache
    mock_client = MagicMock()
    
    with patch("app.services.cache._get_redis_client", return_value=mock_client):
        cache._redis_share_cache_delete("req")
        mock_client.delete.assert_called_once()