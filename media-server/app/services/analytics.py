from __future__ import annotations

import fcntl
import ipaddress
import json
import logging
import os
import threading
import time
from collections import OrderedDict
from contextlib import contextmanager

from flask import request
from sqlalchemy.exc import OperationalError

from ..config import parse_bool
from ..models import ANALYTICS_DB_PATH, AnalyticsBase, get_analytics_engine
from ..models.analytics import AuditEvent, AuthEvent, DownloadEvent
from ..utils.validation import _normalize_ip

logger = logging.getLogger("droppr.analytics")

ANALYTICS_RETENTION_DAYS = int(os.environ.get("DROPPR_ANALYTICS_RETENTION_DAYS", "180"))
ANALYTICS_ENABLED = parse_bool(os.environ.get("DROPPR_ANALYTICS_ENABLED", "true"))
ANALYTICS_LOG_GALLERY_VIEWS = parse_bool(
    os.environ.get("DROPPR_ANALYTICS_LOG_GALLERY_VIEWS", "true")
)
ANALYTICS_LOG_FILE_DOWNLOADS = parse_bool(
    os.environ.get("DROPPR_ANALYTICS_LOG_FILE_DOWNLOADS", "true")
)
ANALYTICS_LOG_ZIP_DOWNLOADS = parse_bool(
    os.environ.get("DROPPR_ANALYTICS_LOG_ZIP_DOWNLOADS", "true")
)
ANALYTICS_IP_MODE = (os.environ.get("DROPPR_ANALYTICS_IP_MODE", "full") or "full").strip().lower()
ANALYTICS_CACHE_TTL_SECONDS = int(os.environ.get("DROPPR_ANALYTICS_CACHE_TTL_SECONDS", "30"))
ANALYTICS_CACHE_MAX_ITEMS = int(os.environ.get("DROPPR_ANALYTICS_CACHE_MAX_ITEMS", "256"))

_last_retention_sweep_at: float = 0.0
_analytics_db_ready: bool = False
_analytics_cache_lock = threading.Lock()
_analytics_cache: OrderedDict[str, tuple[float, dict]] = OrderedDict()
_ANALYTICS_ENGINE = get_analytics_engine()

MAX_ANALYTICS_DAYS = 3650


def _parse_int(value: str | None) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _get_time_range() -> tuple[int, int]:
    """
    Parses the 'since', 'until', and 'days' query parameters to determine
    the time range for analytics queries.

    Returns:
        A tuple of (start_timestamp, end_timestamp).
    """
    now = int(time.time())

    days = _parse_int(request.args.get("days"))
    if days is not None and days > 0:
        days = min(days, MAX_ANALYTICS_DAYS)
        return now - (days * 86400), now

    since = _parse_int(request.args.get("since"))
    until = _parse_int(request.args.get("until"))
    return max(0, since or 0), max(0, until or now)


def _get_client_ip() -> str | None:
    """
    Retrieves and optionally anonymizes the client's IP address
    based on the DROPPR_ANALYTICS_IP_MODE setting.
    """
    if ANALYTICS_IP_MODE == "off":
        return None

    candidates = [
        request.headers.get("CF-Connecting-IP"),
        request.headers.get("X-Forwarded-For"),
        request.headers.get("X-Real-IP"),
        request.remote_addr,
    ]

    ip = None
    for candidate in candidates:
        ip = _normalize_ip(candidate)
        if ip:
            break

    if not ip:
        return None

    if ANALYTICS_IP_MODE == "anonymized":
        try:
            addr = ipaddress.ip_address(ip)
            if isinstance(addr, ipaddress.IPv4Address):
                parts = ip.split(".")
                parts[-1] = "0"
                return ".".join(parts) + "/24"
            network = ipaddress.ip_network(f"{ip}/64", strict=False)
            return f"{network.network_address}/64"
        except ValueError:
            return None

    return ip


class _DriverConnection:
    """
    A simple wrapper for SQLAlchemy connection to provide a consistent
    interface for executing SQL and receiving mappings.
    """

    def __init__(self, conn) -> None:
        self._conn = conn

    def execute(self, sql, params: dict | tuple | list | None = None):
        if isinstance(sql, str):
            return self._conn.exec_driver_sql(sql, params or ()).mappings()
        return self._conn.execute(sql, params or {})


@contextmanager
def _analytics_conn():
    """
    Context manager for getting a connection to the analytics database.
    Ensures the database is initialized before yielding.
    """
    if not ANALYTICS_ENABLED:
        raise RuntimeError("Analytics disabled")

    _ensure_analytics_db()

    with _ANALYTICS_ENGINE.begin() as conn:
        yield _DriverConnection(conn)


def _init_analytics_db() -> None:
    if not ANALYTICS_ENABLED:
        return

    db_dir = os.path.dirname(ANALYTICS_DB_PATH)
    if db_dir:
        os.makedirs(db_dir, exist_ok=True)
    AnalyticsBase.metadata.create_all(_ANALYTICS_ENGINE)


def _ensure_analytics_db() -> None:
    global _analytics_db_ready

    if _analytics_db_ready or not ANALYTICS_ENABLED:
        return

    db_dir = os.path.dirname(ANALYTICS_DB_PATH)
    if db_dir:
        os.makedirs(db_dir, exist_ok=True)

    lock_path = f"{ANALYTICS_DB_PATH}.init.lock"
    lock_file = open(lock_path, "w")
    try:
        fcntl.flock(lock_file, fcntl.LOCK_EX)

        for attempt in range(10):
            try:
                _init_analytics_db()
                _analytics_db_ready = True
                return
            except OperationalError as exc:
                if "locked" in str(exc).lower() and attempt < 9:
                    time.sleep(0.05 * (attempt + 1))
                    continue
                logger.warning("Analytics init failed: %s", exc)
                return
            except Exception as exc:
                logger.warning("Analytics init failed: %s", exc)
                return
    finally:
        try:
            fcntl.flock(lock_file, fcntl.LOCK_UN)
        finally:
            lock_file.close()


def _maybe_apply_retention(conn) -> None:
    global _last_retention_sweep_at

    if ANALYTICS_RETENTION_DAYS <= 0:
        return

    now = time.time()
    if now - _last_retention_sweep_at < 3600:
        return

    cutoff = int(now - (ANALYTICS_RETENTION_DAYS * 86400))
    try:
        archived_at = int(now)
        conn.execute(
            """
            INSERT INTO download_events_archive (
                share_hash, event_type, file_path, ip, user_agent, referer, created_at, archived_at
            )
            SELECT share_hash, event_type, file_path, ip, user_agent, referer, created_at, ?
            FROM download_events
            WHERE created_at < ?
            """,
            (archived_at, cutoff),
        )
        conn.execute(
            """
            INSERT INTO auth_events_archive (
                event_type, path, ip, user_agent, success, detail, created_at, archived_at
            )
            SELECT event_type, path, ip, user_agent, success, detail, created_at, ?
            FROM auth_events
            WHERE created_at < ?
            """,
            (archived_at, cutoff),
        )
        conn.execute(
            """
            INSERT INTO audit_events_archive (
                action, target, detail, ip, user_agent, created_at, archived_at
            )
            SELECT action, target, detail, ip, user_agent, created_at, ?
            FROM audit_events
            WHERE created_at < ?
            """,
            (archived_at, cutoff),
        )
        conn.execute("DELETE FROM download_events WHERE created_at < ?", (cutoff,))
        conn.execute("DELETE FROM auth_events WHERE created_at < ?", (cutoff,))
        conn.execute("DELETE FROM audit_events WHERE created_at < ?", (cutoff,))
    finally:
        _last_retention_sweep_at = now


def _analytics_cache_get(key: str) -> dict | None:
    if ANALYTICS_CACHE_TTL_SECONDS <= 0:
        return None
    now = time.time()
    with _analytics_cache_lock:
        entry = _analytics_cache.get(key)
        if not entry:
            return None
        ts, value = entry
        if now - ts > ANALYTICS_CACHE_TTL_SECONDS:
            _analytics_cache.pop(key, None)
            return None
        _analytics_cache.move_to_end(key)
        return value


def _analytics_cache_set(key: str, value: dict) -> None:
    if ANALYTICS_CACHE_TTL_SECONDS <= 0:
        return
    now = time.time()
    with _analytics_cache_lock:
        _analytics_cache[key] = (now, value)
        _analytics_cache.move_to_end(key)
        max_items = max(1, ANALYTICS_CACHE_MAX_ITEMS)
        while len(_analytics_cache) > max_items:
            _analytics_cache.popitem(last=False)


def _should_log_event(event_type: str) -> bool:
    if not ANALYTICS_ENABLED:
        return False
    if event_type == "gallery_view":
        return ANALYTICS_LOG_GALLERY_VIEWS
    if event_type == "file_download":
        return ANALYTICS_LOG_FILE_DOWNLOADS
    if event_type == "zip_download":
        return ANALYTICS_LOG_ZIP_DOWNLOADS
    return True


def _log_event(event_type: str, share_hash: str, file_path: str | None = None) -> None:
    """
    Logs a download or gallery view event to the analytics database.
    """
    if not _should_log_event(event_type):
        return

    ip = _get_client_ip()
    user_agent = request.headers.get("User-Agent")
    referer = request.headers.get("Referer")
    created_at = int(time.time())

    for attempt in range(3):
        try:
            with _analytics_conn() as conn:
                _maybe_apply_retention(conn)
                conn.execute(
                    DownloadEvent.__table__.insert(),
                    {
                        "share_hash": share_hash,
                        "event_type": event_type,
                        "file_path": file_path,
                        "ip": ip,
                        "user_agent": user_agent,
                        "referer": referer,
                        "created_at": created_at,
                    },
                )
            return
        except OperationalError as exc:
            if "locked" not in str(exc).lower() or attempt == 2:
                logger.warning("Analytics logging failed: %s", exc)
                return
            time.sleep(0.05 * (attempt + 1))
        except Exception as exc:
            logger.warning("Analytics logging failed: %s", exc)
            return


def _log_auth_event(event_type: str, success: bool, detail: str | None = None) -> None:
    """
    Logs an authentication attempt (success or failure) to the analytics database.
    """
    if not ANALYTICS_ENABLED:
        return

    ip = _get_client_ip()
    user_agent = request.headers.get("User-Agent")
    path = request.path
    created_at = int(time.time())
    detail_value = str(detail) if detail is not None else None

    for attempt in range(3):
        try:
            with _analytics_conn() as conn:
                _maybe_apply_retention(conn)
                conn.execute(
                    AuthEvent.__table__.insert(),
                    {
                        "event_type": event_type,
                        "path": path,
                        "ip": ip,
                        "user_agent": user_agent,
                        "success": 1 if success else 0,
                        "detail": detail_value,
                        "created_at": created_at,
                    },
                )
            return
        except OperationalError as exc:
            if "locked" not in str(exc).lower() or attempt == 2:
                logger.warning("Auth logging failed: %s", exc)
                return
            time.sleep(0.05 * (attempt + 1))
        except Exception as exc:
            logger.warning("Auth logging failed: %s", exc)
            return


def _log_audit_event(action: str, target: str | None = None, detail: dict | None = None) -> None:
    """
    Logs an administrative audit event.
    """
    if not ANALYTICS_ENABLED:
        return

    ip = _get_client_ip()
    user_agent = request.headers.get("User-Agent")
    created_at = int(time.time())
    detail_json = json.dumps(detail) if detail is not None else None

    for attempt in range(3):
        try:
            with _analytics_conn() as conn:
                _maybe_apply_retention(conn)
                conn.execute(
                    AuditEvent.__table__.insert(),
                    {
                        "action": action,
                        "target": target,
                        "detail": detail_json,
                        "ip": ip,
                        "user_agent": user_agent,
                        "created_at": created_at,
                    },
                )
            return
        except OperationalError as exc:
            if "locked" not in str(exc).lower() or attempt == 2:
                logger.warning("Audit logging failed: %s", exc)
                return
            time.sleep(0.05 * (attempt + 1))
        except Exception as exc:
            logger.warning("Audit logging failed: %s", exc)
            return
