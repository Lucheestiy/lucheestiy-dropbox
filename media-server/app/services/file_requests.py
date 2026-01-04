from __future__ import annotations

import fcntl
import logging
import os
import secrets
import sqlite3
import threading
import time
from collections import deque
from contextlib import contextmanager

import requests

from ..utils.validation import _safe_join, _safe_root_path, is_valid_share_hash
from .users import USER_DATA_DIR

logger = logging.getLogger("droppr.requests")

try:
    REQUEST_PASSWORD_FAILURE_MAX = int(os.environ.get("DROPPR_REQUEST_PASSWORD_FAILURE_MAX", "5"))
except (TypeError, ValueError):
    REQUEST_PASSWORD_FAILURE_MAX = 5
REQUEST_PASSWORD_FAILURE_MAX = max(1, REQUEST_PASSWORD_FAILURE_MAX)

try:
    REQUEST_PASSWORD_FAILURE_WINDOW_SECONDS = int(
        os.environ.get("DROPPR_REQUEST_PASSWORD_FAILURE_WINDOW_SECONDS", "900")
    )
except (TypeError, ValueError):
    REQUEST_PASSWORD_FAILURE_WINDOW_SECONDS = 900

try:
    REQUEST_PASSWORD_CAPTCHA_THRESHOLD = int(
        os.environ.get("DROPPR_REQUEST_PASSWORD_CAPTCHA_THRESHOLD", "3")
    )
except (TypeError, ValueError):
    REQUEST_PASSWORD_CAPTCHA_THRESHOLD = 3
REQUEST_PASSWORD_CAPTCHA_THRESHOLD = max(1, REQUEST_PASSWORD_CAPTCHA_THRESHOLD)

CAPTCHA_SITE_KEY = os.environ.get("DROPPR_CAPTCHA_SITE_KEY", "").strip()
CAPTCHA_SECRET_KEY = os.environ.get("DROPPR_CAPTCHA_SECRET_KEY", "").strip()
CAPTCHA_VERIFY_URL = os.environ.get(
    "DROPPR_CAPTCHA_VERIFY_URL", "https://challenges.cloudflare.com/turnstile/v0/siteverify"
)
try:
    CAPTCHA_TIMEOUT_SECONDS = float(os.environ.get("DROPPR_CAPTCHA_TIMEOUT_SECONDS", "8"))
except (TypeError, ValueError):
    CAPTCHA_TIMEOUT_SECONDS = 8.0
CAPTCHA_ENABLED = bool(CAPTCHA_SITE_KEY and CAPTCHA_SECRET_KEY)

REQUESTS_DB_PATH = os.environ.get("DROPPR_REQUESTS_DB_PATH", "/database/droppr-requests.sqlite3")
try:
    REQUESTS_DB_TIMEOUT_SECONDS = float(os.environ.get("DROPPR_REQUESTS_DB_TIMEOUT_SECONDS", "30"))
except (TypeError, ValueError):
    REQUESTS_DB_TIMEOUT_SECONDS = 30.0

REQUEST_PASSWORD_MAX_LEN = int(os.environ.get("DROPPR_REQUEST_PASSWORD_MAX_LEN", "256"))

_request_password_failures_lock = threading.Lock()
_request_password_failures: dict[str, deque[float]] = {}
_requests_db_ready = False


def _normalize_request_password(value: str | None) -> str | None:
    """
    Validates and normalizes a file request password.
    Returns None if the password is too long or empty.
    """
    if value is None:
        return None
    value = str(value)
    if not value:
        return None
    if REQUEST_PASSWORD_MAX_LEN and len(value) > REQUEST_PASSWORD_MAX_LEN:
        return None
    return value


def _prune_failures(failures: deque[float], cutoff: float) -> None:
    while failures and failures[0] < cutoff:
        failures.popleft()


def _get_failure_count(
    store: dict[str, deque[float]], key: str, window_seconds: int, lock: threading.Lock
) -> int:
    now = time.time()
    with lock:
        failures = store.get(key)
        if not failures:
            return 0
        _prune_failures(failures, now - window_seconds)
        if not failures:
            store.pop(key, None)
            return 0
        return len(failures)


def _record_failure(
    store: dict[str, deque[float]], key: str, window_seconds: int, lock: threading.Lock
) -> int:
    now = time.time()
    with lock:
        failures = store.get(key)
        if not failures:
            failures = deque()
            store[key] = failures
        _prune_failures(failures, now - window_seconds)
        failures.append(now)
        return len(failures)


def _clear_failures(store: dict[str, deque[float]], key: str, lock: threading.Lock) -> None:
    with lock:
        store.pop(key, None)


def _request_password_key(share_hash: str, ip: str) -> str:
    return f"{share_hash}:{ip}"


def _request_password_failure_count(share_hash: str, ip: str) -> int:
    return _get_failure_count(
        _request_password_failures,
        _request_password_key(share_hash, ip),
        REQUEST_PASSWORD_FAILURE_WINDOW_SECONDS,
        _request_password_failures_lock,
    )


def _record_request_password_failure(share_hash: str, ip: str) -> int:
    return _record_failure(
        _request_password_failures,
        _request_password_key(share_hash, ip),
        REQUEST_PASSWORD_FAILURE_WINDOW_SECONDS,
        _request_password_failures_lock,
    )


def _clear_request_password_failures(share_hash: str, ip: str) -> None:
    _clear_failures(
        _request_password_failures,
        _request_password_key(share_hash, ip),
        _request_password_failures_lock,
    )


def _request_password_blocked(share_hash: str, ip: str) -> bool:
    if not ip:
        return False
    return _request_password_failure_count(share_hash, ip) >= REQUEST_PASSWORD_FAILURE_MAX


def _captcha_required_for_request(share_hash: str, ip: str) -> bool:
    """
    Determines if a CAPTCHA is required for a given file request based
    on the number of failed password attempts from the client's IP.
    """
    if not CAPTCHA_ENABLED or not ip:
        return False
    return _request_password_failure_count(share_hash, ip) >= REQUEST_PASSWORD_CAPTCHA_THRESHOLD


def _captcha_payload(required: bool) -> dict:
    if not CAPTCHA_ENABLED:
        return {"captcha_enabled": False, "captcha_required": False, "captcha_site_key": None}
    return {
        "captcha_enabled": True,
        "captcha_required": bool(required),
        "captcha_site_key": CAPTCHA_SITE_KEY,
    }


def _verify_captcha_token(token: str, ip: str | None) -> bool:
    """
    Verifies a CAPTCHA token with the provider (e.g., Cloudflare Turnstile).
    """
    if not CAPTCHA_ENABLED:
        return True
    token = (token or "").strip()
    if not token:
        return False

    payload = {"secret": CAPTCHA_SECRET_KEY, "response": token}
    if ip:
        payload["remoteip"] = ip

    try:
        resp = requests.post(CAPTCHA_VERIFY_URL, data=payload, timeout=CAPTCHA_TIMEOUT_SECONDS)
        resp.raise_for_status()
        data = resp.json()
        return bool(data.get("success"))
    except Exception as exc:
        logger.warning("Captcha verification failed: %s", exc)
        return False


@contextmanager
def _requests_conn():
    """
    Context manager for getting a connection to the file requests SQLite database.
    """
    _ensure_requests_db()

    conn = sqlite3.connect(
        REQUESTS_DB_PATH,
        timeout=REQUESTS_DB_TIMEOUT_SECONDS,
        isolation_level=None,
        check_same_thread=False,
    )
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.execute("PRAGMA temp_store=MEMORY;")
    conn.execute("PRAGMA busy_timeout=5000;")
    conn.execute("PRAGMA foreign_keys=ON;")
    try:
        yield conn
    finally:
        conn.close()


def _init_requests_db() -> None:
    db_dir = os.path.dirname(REQUESTS_DB_PATH)
    if db_dir:
        os.makedirs(db_dir, exist_ok=True)

    conn = sqlite3.connect(
        REQUESTS_DB_PATH,
        timeout=REQUESTS_DB_TIMEOUT_SECONDS,
        isolation_level=None,
        check_same_thread=False,
    )
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.execute("PRAGMA busy_timeout=5000;")
    conn.execute("PRAGMA foreign_keys=ON;")
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS file_requests (
                hash TEXT PRIMARY KEY,
                path TEXT NOT NULL,
                password_hash TEXT,
                created_at INTEGER NOT NULL,
                expires_at INTEGER
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_file_requests_expires_at ON file_requests(expires_at)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_file_requests_created_at ON file_requests(created_at)"
        )
    finally:
        conn.close()


def _ensure_requests_db() -> None:
    global _requests_db_ready

    if _requests_db_ready:
        return

    db_dir = os.path.dirname(REQUESTS_DB_PATH)
    if db_dir:
        os.makedirs(db_dir, exist_ok=True)

    lock_path = f"{REQUESTS_DB_PATH}.init.lock"
    lock_file = open(lock_path, "w")
    try:
        fcntl.flock(lock_file, fcntl.LOCK_EX)

        for attempt in range(10):
            try:
                _init_requests_db()
                _requests_db_ready = True
                return
            except sqlite3.OperationalError as exc:
                if "locked" in str(exc).lower() and attempt < 9:
                    time.sleep(0.05 * (attempt + 1))
                    continue
                logger.warning("Requests init failed: %s", exc)
                return
            except Exception as exc:
                logger.warning("Requests init failed: %s", exc)
                return
    finally:
        try:
            fcntl.flock(lock_file, fcntl.LOCK_UN)
        finally:
            lock_file.close()


def _request_is_expired(row: sqlite3.Row | dict) -> bool:
    expires_at = row.get("expires_at") if isinstance(row, dict) else row["expires_at"]
    if not expires_at:
        return False
    try:
        expires_at = int(expires_at)
    except (TypeError, ValueError):
        return False
    return expires_at > 0 and int(time.time()) > expires_at


def _resolve_request_dir(path: str) -> str | None:
    safe_path = _safe_root_path(path)
    if not safe_path:
        return None
    base_dir = USER_DATA_DIR or "/srv"
    target = _safe_join(base_dir, safe_path.lstrip("/"))
    return target


def _create_file_request_record(
    *, path: str, password_hash: str | None, expires_at: int | None
) -> dict:
    """
    Generates a unique share hash and creates a new file request record
    in the SQLite database. Retries if a hash collision occurs.
    """
    created_at = int(time.time())
    for _ in range(20):
        share_hash = secrets.token_urlsafe(6).rstrip("=")
        if not is_valid_share_hash(share_hash):
            continue
        try:
            with _requests_conn() as conn:
                conn.execute(
                    """
                    INSERT INTO file_requests (hash, path, password_hash, created_at, expires_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (share_hash, path, password_hash, created_at, expires_at),
                )
            return {
                "hash": share_hash,
                "path": path,
                "password_hash": password_hash,
                "created_at": created_at,
                "expires_at": expires_at,
            }
        except sqlite3.IntegrityError:
            continue
        except Exception as exc:
            logger.warning("Request creation failed: %s", exc)
            raise
    raise RuntimeError("Failed to generate request link")


def _fetch_file_request(share_hash: str) -> dict | None:
    """
    Retrieves a file request record by its unique share hash.
    """
    with _requests_conn() as conn:
        row = conn.execute(
            "SELECT hash, path, password_hash, created_at, expires_at FROM file_requests WHERE hash = ?",
            (share_hash,),
        ).fetchone()
    return dict(row) if row else None
