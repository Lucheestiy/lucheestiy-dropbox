
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

    monkeypatch.setattr(app_module, "_fetch_public_share_json", fake_fetch)
    files = app_module._build_folder_share_file_list(
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

    monkeypatch.setattr(app_module, "_fetch_public_share_json", fake_fetch)
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
