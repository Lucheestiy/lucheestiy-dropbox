from __future__ import annotations

import threading

from .cache import _redis_share_cache_delete

_share_cache_lock = threading.Lock()
_share_files_cache: dict[str, tuple[float, str, bool, list[dict]]] = {}


def clear_share_cache(share_hash: str) -> None:
    with _share_cache_lock:
        _share_files_cache.pop(share_hash, None)
    _redis_share_cache_delete(share_hash)
