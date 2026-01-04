from __future__ import annotations

import json
import logging
import os
import threading
import time

import redis

logger = logging.getLogger("droppr.cache")

REDIS_URL = (os.environ.get("DROPPR_REDIS_URL") or "").strip()
REDIS_SHARE_CACHE_PREFIX = os.environ.get("DROPPR_REDIS_SHARE_CACHE_PREFIX", "droppr:share-cache:")
REDIS_CONNECT_TIMEOUT_SECONDS = float(os.environ.get("DROPPR_REDIS_CONNECT_TIMEOUT_SECONDS", "2"))
REDIS_ENABLED = bool(REDIS_URL)

_redis_client: redis.Redis | None = None
_redis_lock = threading.Lock()


def _get_redis_client() -> redis.Redis | None:
    if not REDIS_ENABLED:
        return None
    global _redis_client
    if _redis_client is not None:
        return _redis_client
    with _redis_lock:
        if _redis_client is not None:
            return _redis_client
        try:
            client = redis.Redis.from_url(
                REDIS_URL,
                socket_connect_timeout=REDIS_CONNECT_TIMEOUT_SECONDS,
                socket_timeout=REDIS_CONNECT_TIMEOUT_SECONDS,
                decode_responses=True,
            )
            client.ping()
            _redis_client = client
        except Exception as exc:
            logger.warning("Redis unavailable: %s", exc)
            _redis_client = None
    return _redis_client


def _redis_share_cache_key(share_hash: str) -> str:
    return f"{REDIS_SHARE_CACHE_PREFIX}{share_hash}"


def _redis_share_cache_get(
    request_hash: str,
    *,
    source_hash: str,
    recursive: bool,
    max_age_seconds: int,
) -> list[dict] | None:
    client = _get_redis_client()
    if not client:
        return None
    try:
        raw = client.get(_redis_share_cache_key(request_hash))
    except Exception as exc:
        logger.warning("Redis cache get failed: %s", exc)
        return None
    if not raw:
        return None
    try:
        payload = json.loads(raw)
    except Exception:
        return None
    if payload.get("source_hash") != source_hash or payload.get("recursive") != recursive:
        return None
    created_at = float(payload.get("created_at") or 0)
    if created_at and max_age_seconds > 0 and (time.time() - created_at) > max_age_seconds:
        return None
    files = payload.get("files")
    return files if isinstance(files, list) else None


def _redis_share_cache_set(
    request_hash: str,
    *,
    source_hash: str,
    recursive: bool,
    files: list[dict],
    ttl_seconds: int,
) -> None:
    client = _get_redis_client()
    if not client:
        return
    payload = {
        "created_at": time.time(),
        "source_hash": source_hash,
        "recursive": recursive,
        "files": files,
    }
    try:
        ttl = max(1, int(ttl_seconds))
        client.setex(_redis_share_cache_key(request_hash), ttl, json.dumps(payload, separators=(",", ":")))
    except Exception as exc:
        logger.warning("Redis cache set failed: %s", exc)


def _redis_share_cache_delete(request_hash: str) -> None:
    client = _get_redis_client()
    if not client:
        return
    try:
        client.delete(_redis_share_cache_key(request_hash))
    except Exception as exc:
        logger.warning("Redis cache delete failed: %s", exc)
